---
on:
  # Fire whenever the required `Security` workflow finishes on `main`. We only act on a
  # failure (see the `if:` below), which is exactly the situation that blocks every
  # Dependabot PR: `main` requires the Security checks green, so an ambient CVE on `main`
  # strands all bumps until it is remediated.
  workflow_run:
    workflows: ['Security']
    types: [completed]
    branches: [main]
  # Weekly safety net: catch newly-disclosed CVEs even if nothing pushed to `main` this
  # week (a scan can start failing when the vulnerability DB updates, with no new commit).
  schedule:
    - cron: '17 6 * * 1'
  # Manual button in the Actions tab.
  workflow_dispatch:
  # gh-aw requires an explicit role gate; scheduled/dispatch runs have no actor to check,
  # and workflow_run is already constrained to the repo, so allow all and rely on the
  # trigger constraints above.
  roles: all

# Only do work when there is actually something to fix. A scheduled or manual run always
# proceeds (it re-derives the current findings); a `workflow_run` run proceeds only when
# the Security workflow failed.
if: >-
  github.event_name != 'workflow_run' ||
  github.event.workflow_run.conclusion == 'failure'

permissions:
  contents: read
  pull-requests: read
  actions: read
  issues: read
  security-events: read

engine: copilot

# Needs the npm registry to reproduce audits, apply `npm audit fix`, and re-resolve
# lockfiles after adding `overrides`.
network:
  allowed:
    - node

tools:
  github:
    toolsets: [default]

steps:
  # Full checkout so the agent can edit every package manifest/lockfile and reproduce the
  # scans. `persist-credentials: false` keeps the checkout token out of the agent's git
  # config — the PR is created by the permission-scoped safe-output job, not the agent.
  - uses: actions/checkout@v6
    with:
      fetch-depth: 0
      persist-credentials: false
  - uses: actions/setup-node@v6
    with:
      node-version: 22

safe-outputs:
  create-pull-request:
    # Not a draft, so the companion auto-merge workflow can queue it immediately.
    draft: false
    labels: [dependencies, security-autofix]
    # Stable branch name so `dependabot-automerge.yml` can watch `deps/**` and so repeated
    # runs refresh the same PR instead of piling up new branches.
    preserve-branch-name: true
    recreate-ref: true
    # Security fixes edit lockfiles + manifests + Dockerfile + `.trivyignore`, all of which
    # gh-aw protects by default; open protection so the fix can be pushed. The prompt still
    # forbids touching CI workflow files, CODEOWNERS, and instruction files, and
    # `.github/**` pushes remain impossible without a `workflows: write` token.
    protected-files: allowed
    if-no-changes: 'ignore'
    # Dependency remediations can touch several lockfiles at once.
    max-patch-files: 500
    # The created PR is authored by github-actions[bot]; PRs from GITHUB_TOKEN do not
    # trigger CI, so push an empty commit with a real PAT to kick the required checks.
    # (Authoring by the bot, not the code-owner PAT, is deliberate: the auto-merge workflow
    # approves the PR as the code owner, and a PR author cannot approve their own PR.)
    github-token-for-extra-empty-commit: ${{ secrets.GH_AW_CI_TRIGGER_TOKEN }}
    # Force PR creation via GITHUB_TOKEN so the author is github-actions[bot], NOT the
    # code-owner PAT. This is essential: @dorlugasigal is the sole CODEOWNER, and GitHub
    # forbids approving your own PR — if the PAT authored it, the required code-owner
    # review could never be satisfied and the PR would never merge.
    github-token: ${{ secrets.GITHUB_TOKEN }}
  add-comment:
    target: '*'
    max: 1
  # Silence gh-aw automation-noise issues (no-op runs / transient failures). The run
  # itself is already visible in the Actions tab; a fresh issue per run is pure spam.
  noop:
    report-as-issue: false
  report-failure-as-issue: false
---

# Security Auto-Fix

You keep this repository's **required `Security` workflow green on `main`**. That workflow
runs `npm audit`, a Trivy **filesystem** scan, and a Trivy **Docker image** scan. When any
of them fails on `main`, every open Dependabot pull request is blocked (branch protection
requires the Security checks to pass and the branch to be up to date), so your job is to
open one pull request that makes all three scans pass again — without changing the
application's behavior. A companion workflow (`dependabot-automerge.yml`) approves and
merges your PR once its checks are green; you only need to produce a correct, green fix.

## Context

- This repository is **TermBeam**, a Node.js CLI tool. Conventions live in
  `.github/copilot-instructions.md` — read it before making changes.
- The repository is already checked out in your workspace.
- The Security workflow is defined in `.github/workflows/security.yml`. Read it to see
  exactly how each scan is configured (severities, `ignore-unfixed: true`, `skip-dirs`,
  which lockfiles and image it scans). **Do not edit that file** — treat it as the source
  of truth for what "green" means.
  {{#if github.event.workflow_run}}
- You were triggered because the `Security` workflow concluded with
  **{{ github.event.workflow_run.conclusion }}** on `main`. Read that run's failing jobs
  to get the live findings.
  {{else}}
- You were triggered on a schedule or manually. Re-derive the current findings yourself
  (there may be nothing to do — that is a valid outcome).
  {{/if}}

## Step 1 — Guard against duplicate work

List open PRs authored by `github-actions[bot]` (or with the **`security-autofix`** label)
whose head branch is `deps/security-autofix`.

- If such a PR already exists and its Security checks are **passing or still running**,
  do nothing — a fix is already in flight. Stop.
- If such a PR exists but its Security checks are **failing**, you may refine it: check
  out `deps/security-autofix`, build on top of the existing fix, and open/refresh the PR
  (the `deps/security-autofix` branch is reused). Do not open a second PR.
- Otherwise, proceed to create a fresh fix.

## Step 2 — Gather the current findings

Reproduce every failing scan so you fix real findings, not guesses.

1. **npm audit.** For each directory that has a `package-lock.json` — the repo root,
   `src/frontend`, `packages/site`, and `packages/demo-video` — run `npm ci` then
   `npm audit --audit-level=moderate` and record every advisory that has a fix available.
   (The Security workflow only runs `npm audit` at the repo root, but fixing the
   sub-packages too keeps the Trivy filesystem scan green.)
2. **Trivy filesystem.** This scan walks every `package-lock.json` in the repo except
   `packages/demo-video` (it is in `skip-dirs`). Read the failing `Trivy (filesystem)`
   job log from the most recent failing Security run (use the GitHub tools) to get the
   exact `Library`, `Installed Version`, and `Fixed Version` for each HIGH/CRITICAL
   finding, and which lockfile it came from.
3. **Trivy Docker image.** **You cannot run this scan in your sandbox** (there is no
   Docker daemon and no Trivy vulnerability database), and — critically — **`npm audit`
   does NOT cover it.** The Docker image is built with `npm ci --omit=dev`, so it contains
   production dependencies _and everything they bundle_, including third-party CLIs that
   vendor their own `node_modules` which `npm audit` cannot see. **Do not assume the image
   is clean just because `npm audit` passes.** Instead, read the most recent failing
   `Trivy (Docker image)` job log via the GitHub tools and record every HIGH/CRITICAL
   finding with its `Library`, `Installed Version`, `Fixed Version`, and the **file path**
   Trivy reports. In particular, dependencies bundled under
   `node_modules/@github/copilot/**` (the Copilot CLI, pulled in transitively by the
   `@github/copilot-sdk` production dependency — e.g. `adm-zip`, `sharp`) are a recurring
   source of image-only findings that are **not** in any lockfile you control.

## Step 3 — Remediate each finding by category

Apply the **smallest** change that makes each scan pass. Match every finding to one of
these categories:

1. **Direct dependency you can bump.** Raise the version in the owning `package.json` to
   the patched release and run `npm install` in that directory to update its lockfile.
2. **Transitive dependency (not a direct dep).** Add or extend an `overrides` block in
   the owning `package.json` pinning the vulnerable package to its `Fixed Version`
   (choose the lowest patched version at or above the installed major where possible),
   then run `npm install` in that directory so the lockfile resolves to the pinned
   version. Confirm the new resolved version in the lockfile is at/above the fixed
   version. Do this in **each** package whose lockfile Trivy flagged the dependency in
   (root, `src/frontend`, `packages/site`).
3. **`npm audit` advisory.** Run `npm audit fix` (never `--force`) in the affected
   directory and commit the lockfile change. If `npm audit fix` cannot resolve it without
   `--force`, fall back to an `overrides` pin as in (2).
4. **Docker base image.** If a finding is in the base OS image, bump the `node:*` tag in
   the `Dockerfile` to a patched digest/tag.
5. **Vendored inside a third-party package you cannot patch.** Some Docker-image findings
   live inside a CLI that TermBeam depends on but does not control — for example
   `adm-zip` and `sharp` bundled under `node_modules/@github/copilot/**`, which is pulled
   in transitively by `@github/copilot-sdk`. These are **not** in any lockfile you can
   edit and `overrides` cannot reach them. Handle them like this, in order:
   a. Check whether bumping the parent dependency (e.g. `@github/copilot-sdk`) to its
   latest version resolves the finding. If it does, do that (category 1).
   b. If no released version of the parent fixes it, add the specific vulnerability IDs
   (the `CVE-...` / `GHSA-...` shown by Trivy) to a **`.trivyignore`** file at the
   repository root, one ID per line, each with a `#` comment naming the package, the
   vendoring parent, and why it cannot be fixed in this repo (upstream-vendored, not in
   a controllable lockfile). Trivy reads `.trivyignore` from the repo root
   automatically. **Only** suppress findings that genuinely cannot be fixed in our own
   dependency tree — never use `.trivyignore` to dodge a finding you could fix via a
   bump or an override.

## Step 4 — Constraints (do not break the app)

- **Do NOT** change application logic, business behavior, public APIs, the WebSocket/HTTP
  protocol, or any security decision documented in `.github/copilot-instructions.md`.
- **Do NOT** weaken, skip, or delete tests.
- **Do NOT** edit CI/workflow files under `.github/`, `CODEOWNERS`, or agent-instruction
  files (`AGENTS.md`, `.github/copilot-instructions.md`). You physically cannot push to
  `.github/**` anyway.
- Touch only: `package.json` / `package-lock.json` files, the `Dockerfile`, and
  `.trivyignore`.
- Prefer the **lowest** patched version that clears each finding, to minimise behavioural
  change. Do not perform unrelated major upgrades.

## Step 5 — Verify before opening the PR

- Re-run `npm audit --audit-level=moderate` at the repo root and in each sub-package you
  changed; it must report no fixable advisories at moderate+ severity.
- For every `overrides` pin, confirm the lockfile now resolves the package at/above the
  `Fixed Version`.
- Run `npm ci` in the root and `cd src/frontend && npm ci && npm run build` to confirm the
  refreshed lockfiles still install and the frontend still builds.
- Run `npm run format` so lockfile/manifest formatting matches the repo style.
- **You cannot re-run the Trivy Docker-image scan locally.** For image-only findings,
  trust the findings you read from the failing `Trivy (Docker image)` log and make sure
  each one is either resolved by a bump you made or listed in `.trivyignore` with
  justification — do not leave an image finding unhandled on the assumption that
  `npm audit` covers it (it does not).

## Step 6 — Open the pull request

Create **one** pull request with the **create-pull-request** safe output:

- Branch: `deps/security-autofix`.
- Title: `fix(deps): remediate security scan findings` (Conventional Commit).
- Body: a concise summary listing, per scan (npm audit / Trivy filesystem / Trivy image),
  which package + version you bumped/overrode/ignored and why. For every `.trivyignore`
  entry, state explicitly that it is an upstream-vendored dependency that cannot be fixed
  in this repository. Confirm you changed no application logic.
- Labels: `dependencies`, `security-autofix` (already applied by the workflow).

The companion `dependabot-automerge.yml` workflow will approve the PR as a code owner,
keep its branch up to date, and enable auto-merge, so it lands automatically once the
Security and CI checks are green. You do not need to merge it yourself.

If, after gathering findings, there is genuinely nothing fixable (every finding is either
already fixed or unfixable and already suppressed), open no PR — post a single short
comment on the most recent failing Security run's commit, or simply stop, reporting that
there is nothing to remediate.

## Usage

This workflow runs automatically when the `Security` workflow fails on `main`, weekly as a
safety net, and on manual `workflow_dispatch`. It opens a single remediation PR on the
`deps/security-autofix` branch that the auto-merge workflow lands once green.

**Required secrets:**

- `COPILOT_GITHUB_TOKEN` — the Copilot-entitled token used by the `copilot` engine
  (shared with `dependabot-autofix` and `scorecard-monitor`). Must be a valid,
  non-expired fine-grained PAT or the agent fails at startup with
  `No authentication information found`.
- `GH_AW_CI_TRIGGER_TOKEN` — a fine-grained PAT with `Contents: Read & Write`. gh-aw uses
  it to push an empty commit that triggers the required checks on the created PR (a PR
  authored by `GITHUB_TOKEN` does not trigger CI on its own).

**Companion workflow — auto-merge:** `dependabot-automerge.yml` recognises this PR by its
`security-autofix` label / `deps/**` branch, approves it as a code owner, updates its
branch, and enables native auto-merge, so the fix lands with no human clicks.
