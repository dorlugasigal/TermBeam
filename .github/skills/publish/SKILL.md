---
name: publish
description: >
  Use this skill when the user wants to "publish", "release", "ship",
  "push a release", "deploy a new version", "create a PR", "open a PR",
  or "submit changes" for TermBeam.
  It orchestrates the full publish workflow: local tests, docs check,
  push to main (or PR flow), CI verification, and triggering the release workflow.
---

# TermBeam Publish Workflow

You are executing the TermBeam publish workflow. Follow every step in order.
Do NOT skip steps. If any step fails, stop and report the failure to the user.

## Step 1 — Run tests locally

```bash
cd <repo-root>
npm test
```

All tests must pass. If any test fails, stop and report the failure.

## Step 2 — Lint check

```bash
npm run lint
```

Must exit cleanly. If it fails, stop and report.

## Step 3 — Run coverage check

```bash
npm run test:coverage
```

Coverage must meet the 92% threshold. If it drops below 80%, stop and report
which files/areas lost coverage. The coverage summary is written to
`coverage/coverage-summary.json` — you can inspect it for details.

## Step 4 — Check documentation is up to date

Review the staged/unstaged changes by running:

```bash
git --no-pager diff HEAD
```

Compare the changes against the documentation files. Check:

- **`README.md`** — if any CLI flags, features, or defaults changed, README must reflect them.
- **`docs/configuration.md`** — if CLI flags or env vars changed.
- **`docs/security.md`** — if auth, headers, or security behavior changed.
- **`docs/api.md`** — if HTTP or WebSocket API changed.
- **`docs/architecture.md`** — if system design or module responsibilities changed.
- **`docs/getting-started.md`** — if installation or first-run steps changed.
  and any other docs files relevant to the changes.

Use read-only subagents to verify documentation accuracy. Assign each subagent
to a doc area (e.g., CLI/config, API/WebSocket, security, architecture).
Each subagent should compare the code changes to the relevant docs and report
any mismatches or missing updates. If any subagent flags an issue, update the
docs before proceeding.

If docs are outdated, update them before proceeding. Show the user what you updated.

If the changes are purely UI/cosmetic (e.g., CSS, HTML template changes in `public/`),
docs updates are likely NOT needed — use your judgment.

## Step 5 — Commit and push

Stage all changes (including any doc updates from Step 4), commit with a
conventional commit message:

```bash
git add -A
git commit -m "<type>(<scope>): <description>"
```

Use the appropriate conventional commit type based on the changes:
`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.
If there are multiple types of changes, use the most significant one.

### Choosing the push strategy

- **Default (direct push):** If the user did NOT ask to create a PR, push
  directly to `main` and continue to Step 6.

  ```bash
  git push origin main
  ```

- **PR flow:** If the user explicitly asked to create a PR:
  1. **Ensure an issue exists.** Every PR must reference an issue. If the
     user mentioned an issue number, use it. Otherwise, verify that a matching
     issue already exists or create one:

     ```bash
     gh issue list --state open --search "<keywords>" --limit 5
     gh issue create --title "<short description>" --body "<brief context>"
     ```

     Note the issue number for the branch name and PR body.

  2. **Create the branch** using the naming convention:

     ```
     <github-username>/<type>/<issue-number>/<short-kebab-description>
     ```

     - `<github-username>` — the repo owner's GitHub handle (get via
       `gh api user --jq .login` if unknown)
     - `<type>` — matches the commit type: `feature`, `fix`, `docs`,
       `refactor`, `test`, `chore`, `perf`
     - `<issue-number>` — the linked issue number
     - `<short-kebab-description>` — 2-4 word kebab-case summary

     Example: `dorlu/feature/123/kill-pty`

     ```bash
     git checkout -b <branch-name>
     git push origin <branch-name>
     ```

  3. **Open the PR.** The description should be minimal, conversational,
     no emojis — just a plain explanation of what changed and why.

     ```bash
     gh pr create --base main --head <branch-name> \
       --title "<commit message>" \
       --body "<1-3 plain sentences describing what this PR changes. Reference the issue with Closes #N.>"
     ```

  4. **Watch CI on the PR.** If CI fails:
     - Fetch logs: `gh run view <run-id> --log-failed`
     - If the fix is straightforward, apply it automatically, push, and
       watch CI again.
     - If the failure requires major code changes, **stop and ask the user**:
       > CI failed due to X. Do you want me to attempt an automatic fix,
       > or would you like to review the issues and provide instructions?

  5. Once CI passes, **ask the user for approval** before merging.
     Do NOT continue to the release steps until the user approves.

  6. After approval, merge the PR:

     ```bash
     gh pr merge <pr-number> --squash --delete-branch
     ```

     Then continue to Step 6 (CI on `main`).

## Step 6 — Wait for CI to pass (ALL jobs, including E2E)

**CRITICAL: Do NOT proceed to the release step until every CI job has
completed successfully — this includes unit tests, coverage, lint, AND
all E2E jobs (ubuntu, windows, macos).** A run showing `conclusion: success`
at the top level means all jobs passed; if any job is still `in_progress`,
keep waiting.

Use the GitHub CLI to find the workflow runs triggered by the push and poll
until they complete:

```bash
# Get the latest CI run on main
gh run list --workflow=ci.yml --branch=main --limit=1 --json databaseId,status,conclusion

# Watch it until it completes (timeout after 10 minutes)
gh run watch <run-id> --exit-status
```

After the run completes, **verify every job passed** — especially E2E:

```bash
gh run view <run-id> --json conclusion,jobs \
  --jq '{conclusion, jobs: [.jobs[] | {name, conclusion}]}'
```

All jobs must show `conclusion: "success"`. If any job failed or was
cancelled, do NOT proceed.

If CI fails:

1. Fetch the failed job logs: `gh run view <run-id> --log-failed`
2. Report the failure to the user with the relevant error output.
3. Do NOT proceed to the release step.

## Step 7 — Wait for docs pages deployment (if applicable)

Only if docs files (`docs/**` or `mkdocs.yml`) were changed in the push:

```bash
gh run list --workflow=pages.yml --branch=main --limit=1 --json databaseId,status,conclusion
gh run watch <run-id> --exit-status
```

If the docs deployment fails, report it but still allow the release to proceed
(docs failures are non-blocking for npm releases).

## Step 8 — Determine version bump type

Check if the user already specified the bump type in their prompt
(e.g., "publish patch", "release minor", "ship major").

If the bump type was already provided, use it directly — do NOT ask again.

If the bump type was NOT specified, ask the user:

> What type of version bump is this?

Provide choices: `patch`, `minor`, `major`

Explain briefly:

- **patch** — bug fixes, cosmetic changes, small improvements
- **minor** — new features, non-breaking additions
- **major** — breaking changes

Wait for the user's response before proceeding.

## Step 9 — Trigger the release workflow

Once the user has chosen the bump type, trigger the release:

```bash
gh workflow run release.yml -f bump=<chosen-bump-type> -f dry-run=false
```

Then watch the release workflow:

```bash
# Wait a moment for the run to appear
sleep 5
gh run list --workflow=release.yml --limit=1 --json databaseId,status,conclusion
gh run watch <run-id> --exit-status
```

## Step 10 — Wait for smoke test

The smoke test workflow runs automatically after a successful release. Wait for it:

```bash
# Wait a moment for the smoke test to trigger
sleep 15
gh run list --workflow=smoke.yml --limit=1 --json databaseId,status,conclusion
gh run watch <run-id> --exit-status
```

The smoke test installs the just-published version from npm via `npx termbeam@latest --help`
and verifies it works. If it fails, report the error — the npm package may need
investigation.

## Step 11 — Report success

Once the release workflow completes successfully, report to the user:

- The new version number (from the release workflow output or by checking
  the latest git tag: `git fetch --tags && git describe --tags --abbrev=0`)
- Link to the GitHub release page
- Link to the npm package page: https://www.npmjs.com/package/termbeam

If the release workflow fails, fetch logs and report the error.
