---
on:
  workflow_run:
    # Watch every required workflow that gates a Dependabot merge, not just CI.
    # In practice the check that most often goes red on a bump is `Security`
    # (npm audit / Trivy), which used to leave the PR stuck because this agent
    # only listened to `CI`. Listening to both makes the auto-fix resilient to
    # whichever required workflow actually fails.
    workflows: ['CI', 'Security']
    types: [completed]
    branches:
      - 'dependabot/**'
  bots: ['dependabot[bot]']
  # Dependabot has no repo write permission, so gh-aw's default role gate
  # (admin/maintainer/write) would block activation. Allow all actors — the
  # `bots:` filter already restricts activation to Dependabot-authored runs.
  roles: all
  workflow_dispatch:
    inputs:
      pr:
        description: 'Dependabot PR number to fix'
        required: true
        type: string

# Only act when CI actually failed (manual dispatch always allowed).
if: >-
  github.event_name == 'workflow_dispatch' ||
  github.event.workflow_run.conclusion == 'failure'

permissions:
  contents: read
  pull-requests: read
  actions: read
  issues: read

engine: copilot

# npm registry so the agent can `npm ci`, reproduce the failure, and verify its fix.
network:
  allowed:
    - node

tools:
  github:
    toolsets: [default]

steps:
  # Check out the Dependabot PR branch so the agent has the code that is failing.
  - name: Resolve PR head ref
    id: head
    env:
      HEAD_BRANCH: ${{ github.event.workflow_run.head_branch }}
      HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
      PR_INPUT: ${{ github.event.inputs.pr }}
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: |
      set -euo pipefail
      if [ -n "${PR_INPUT:-}" ]; then
        REF=$(gh pr view "$PR_INPUT" --repo "$GITHUB_REPOSITORY" --json headRefOid --jq '.headRefOid')
      else
        REF="${HEAD_SHA}"
      fi
      echo "ref=${REF}" >> "$GITHUB_OUTPUT"
  - name: Checkout PR head
    uses: actions/checkout@v6
    with:
      ref: ${{ steps.head.outputs.ref }}
      fetch-depth: 0
      persist-credentials: false
  - uses: actions/setup-node@v6
    with:
      node-version: 22

safe-outputs:
  push-to-pull-request-branch:
    target: '*'
    labels: [dependencies]
    if-no-changes: 'ignore'
    # Dependency fixes must edit npm manifests + lockfiles, which gh-aw protects by
    # default, so protection is opened here. Guardrails that remain in force:
    #   - only fires on Dependabot-triggered runs (bots filter) for `dependencies` PRs;
    #   - pushing to `.github/workflows/**` is impossible without a GitHub App
    #     `workflows:write` token (GITHUB_TOKEN cannot grant it), so CI files can't be
    #     altered by this workflow regardless of policy;
    #   - required status checks on `main` gate every merge.
    # The prompt additionally forbids touching CI, CODEOWNERS, and instruction files.
    protected-files: allowed
  add-comment:
    target: '*'
    max: 2
  add-labels:
    target: '*'
    allowed: [dependencies, agent-fixed, needs-human]
    max: 2
  # Silence gh-aw's automation-noise issues. Without these, every run that finds
  # nothing to fix opens an "[aw] No-Op Runs" issue and every transient failure opens
  # an "[aw] … failed" issue — the failing run is already visible in the Actions tab.
  noop:
    report-as-issue: false
  report-failure-as-issue: false
---

# Dependabot Auto-Fix

You are the owner of this repository's Dependabot pull requests. A dependency-update
PR opened by Dependabot has a **failing required check**, and your job is to make every
check green again — without changing the application's behavior.

## Context

{{#if github.event.inputs.pr}}

- You were dispatched manually to fix PR **#{{ github.event.inputs.pr }}**.
  {{else}}
- The `{{ github.event.workflow_run.name }}` workflow just concluded with **failure**
  on the branch `{{ github.event.workflow_run.head_branch }}`
  (commit `{{ github.event.workflow_run.head_sha }}`). This may be the `CI` workflow
  (tests, lint, frontend build, e2e, coverage) **or** the `Security` workflow
  (`npm audit`, Trivy filesystem/Docker scans, secret detection) — inspect the PR's
  actual failing checks to see which.
  {{/if}}
- This repository is **TermBeam**, a Node.js CLI tool. Conventions live in
  `.github/copilot-instructions.md` — read it before making changes.
- The failing PR's branch is already checked out in your workspace.

## Step 1 — Identify the pull request

Use the GitHub tools to find the open Dependabot pull request for this branch:

- If you were given a PR number above, use it.
- Otherwise, list open PRs by author `app/dependabot` and match the one whose head
  branch is `{{ github.event.workflow_run.head_branch }}`.

Confirm the PR author is `dependabot[bot]`. If it is **not** a Dependabot PR, stop and
do nothing.

**`github-actions` bumps — fix what you can, escalate only the workflow edit:** a
`dependabot/github_actions/**` branch bumps an action pinned inside
`.github/workflows/**`, and you cannot push changes to those files (that needs a
`workflows: write` token this workflow deliberately lacks). **However, do not blanket
early-exit.** Inspect the PR's _actual_ failing checks first:

- If the only change required to make the checks green lives under `.github/workflows/**`
  (e.g. the action reference itself must be edited), add the **`needs-human`** label,
  post a one-line comment saying a maintainer must update the workflow manually, and stop.
- If the failing checks can be made green by editing files you _are_ allowed to push
  (lockfiles, `package.json`, `Dockerfile`, `.trivyignore`, source, tests, snapshots) —
  for example a `github_actions` bump that turns CI or the Security scan red for an
  unrelated reason — then proceed to fix those, exactly as you would for any other
  ecosystem. Only escalate the part that genuinely requires a workflow-file edit.

## Step 2 — Loop guard (do this before any work)

Read the PR's labels **and** its recent comment history from this workflow.

- If the PR already carries the **`needs-human`** label, stop immediately. A human has
  been asked to take over; do not push more commits.
- If the PR already carries the **`agent-fixed`** label, you have pushed a fix before.
  Decide whether to try again or escalate — **do not blindly escalate, and do not loop
  forever:**
  1. Read the checks that are failing **now** and compare them to what your previous
     comment said you fixed.
  2. **If a genuinely different check is now failing** than the one you previously
     addressed (e.g. you fixed `npm audit` last time and now a `Trivy` finding or a test
     is red for a new reason), this is real progress, not a loop — make **one** more fix
     pass for the new failure, then continue to Step 5.
  3. **If the same check is still failing** the way it was after your last fix, or you
     have already pushed **two** fix commits to this PR (count your prior
     `agent-fixed` comments), do not loop: post a single comment explaining what is still
     broken and what a human must decide (e.g. a genuine breaking change in the
     dependency), add the **`needs-human`** label, and stop.

Only proceed to a normal fix if neither label is present.

## Step 3 — Reproduce and diagnose

1. Read the failing check runs on the PR to see which jobs failed (test, lint,
   frontend build, e2e, coverage, `npm audit`, Trivy filesystem/Docker scans, etc.)
   and read their logs.
2. Reproduce locally in your workspace. Typical commands:
   - `npm ci`
   - `cd src/frontend && npm ci && npm run build && cd ../..`
   - `npm test` (or the specific failing test file, e.g.
     `node --test 'test/server/*.test.js'`)
   - `npm run lint`
   - `cd src/frontend && npx tsc --noEmit`
   - For **`Security` workflow** failures: `npm audit --audit-level=moderate` to
     reproduce an audit failure; for a Trivy failure, read the scan output on the PR
     to identify the vulnerable package (or, for the Docker image scan, the vulnerable
     base image in the `Dockerfile`).
3. Determine the **root cause** caused by the dependency bump — e.g. a renamed export,
   a changed API signature, a stricter type, an updated snapshot, a lockfile that is
   out of sync, a transitive-dependency conflict, or a newly-introduced known
   vulnerability (CVE) surfaced by `npm audit` / Trivy.

## Step 4 — Fix it (minimal, behavior-preserving)

Apply the **smallest** change that makes the checks pass:

- Update lockfiles (`package-lock.json`, `src/frontend/package-lock.json`), type
  definitions, mocks, snapshots, and call sites to match the new dependency versions.
- Adapt code only where the new version _requires_ it (renamed imports, changed
  signatures, moved types).
- For a **`Security`** failure, remediate the vulnerability the scanner reported: run
  `npm audit fix` (without `--force`) or bump the specific vulnerable dependency to a
  patched version, and for a Trivy Docker-image failure bump the base image tag in the
  `Dockerfile` to a patched release. Only fix vulnerabilities that actually have a fix
  available (the scans use `ignore-unfixed: true`, so a failure means a fix exists).
  Note that Trivy's **filesystem** scan covers every `package-lock.json` in the repo
  (root, `src/frontend`, `packages/site`; `packages/demo-video` is skipped), so a
  finding may live in a sub-package's lockfile — fix it there. For a **transitive**
  dependency you cannot bump directly, add an `overrides` entry to the owning
  `package.json` pinning the patched version and re-run `npm install` to refresh that
  lockfile. If a Trivy **Docker-image** finding comes from a vendored third-party tool
  that is not in any lockfile you control (for example a CLI bundled under
  `node_modules/@github/copilot/**`), you cannot patch it — leave it for the
  `security-autofix` workflow, which owns repo-wide scan remediation.
- Follow repo conventions: CommonJS, `node:test`, Prettier (`npm run format`),
  Conventional Commits.

**Do NOT:**

- Change critical application logic, business behavior, security decisions, public
  APIs, or the WebSocket/HTTP protocol.
- Weaken, skip, or delete tests to make them pass.
- Downgrade or pin a dependency below the version Dependabot proposed just to dodge the
  failure. If the bump genuinely cannot be adapted without a behavioral change, treat it
  as a "needs human" case (Step 2 rules) rather than guessing.
- Touch files unrelated to the dependency update.
- Modify CI/workflow files (`.github/`), `CODEOWNERS`, or agent-instruction files
  (`AGENTS.md`, `.github/copilot-instructions.md`, etc.). If a bump genuinely requires
  a CI or config change, treat it as a "needs human" case (Step 2) — do not attempt it.

Re-run the relevant checks locally and confirm they pass before pushing.

## Step 5 — Push and report

1. Commit your changes onto the checked-out PR branch and push them using the
   **push-to-pull-request-branch** safe output (supply the PR number you found).
   Use a Conventional Commit message such as
   `fix(deps): adapt to <package> <version>`.
2. Add the **`agent-fixed`** label to the PR (so a second failure triggers the loop
   guard in Step 2 instead of an endless retry).
3. Post one short comment on the PR summarizing:
   - which checks were failing,
   - the root cause,
   - exactly what you changed (and confirm you did not change application logic).

CI will re-run automatically on your pushed commit. You do not need to merge the PR —
your job is done once the fix is pushed and reported.

## Usage

This workflow runs automatically whenever the `CI` **or** `Security` workflow fails on a
`dependabot/**` branch. To fix a specific PR on demand, trigger it from the **Actions**
tab (`workflow_dispatch`) and pass the PR number.

**Required secrets:**

- `COPILOT_GITHUB_TOKEN` — used by the `copilot` engine (shared with the
  `scorecard-monitor` workflow). This must be a **valid, non-expired** Copilot-entitled
  token: if it expires the agent fails at startup with `No authentication information
found` and never runs. Rotate it (`gh secret set COPILOT_GITHUB_TOKEN`) if agentic
  runs start failing with that error.
- `GH_AW_CI_TRIGGER_TOKEN` — a fine-grained PAT with `Contents: Read & Write`. gh-aw
  uses this magic secret to push an empty commit that re-triggers CI on the fixed
  branch. Without it, the fix is pushed but CI will not re-run automatically (a human
  must close/reopen the PR to kick CI).

**Companion workflow — auto-merge:** Fixing red PRs is only half the job. The
`dependabot-automerge.yml` workflow handles the other half: when a Dependabot PR's CI
is **green**, it approves the PR and enables native GitHub auto-merge on your behalf, so
green PRs merge with no manual clicks. Together the two workflows mean you never touch a
Dependabot PR: this one turns red PRs green, and the companion merges green PRs.

**Limitation — `github-actions` bumps:** This agent cannot push changes under
`.github/workflows/**` (that needs a GitHub App token with `workflows: write` that
`GITHUB_TOKEN` cannot grant). If a `github-actions` bump fails **only** because the
workflow file itself must change, the agent adds the **`needs-human`** label and comments
instead. It will still fix any failure on such a branch that can be resolved outside the
workflow files (lockfiles, `Dockerfile`, `.trivyignore`, source, tests).

**Companion workflow — security-autofix:** Repo-wide scan failures that are **not** tied
to a single Dependabot bump (ambient `npm audit` / Trivy findings on `main`, including
transitive deps in sub-package lockfiles and vulnerabilities vendored inside third-party
CLIs) are owned by `security-autofix.md`, which opens its own remediation PR and lets the
auto-merge workflow land it. This keeps `main` green so Dependabot PRs can merge.
