---
on:
  schedule: weekly on monday
  workflow_dispatch:

permissions:
  contents: read
  issues: read

engine: copilot

network:
  allowed:
    - api.securityscorecards.dev

safe-outputs:
  create-issue:
    title-prefix: '[scorecard] '
    labels: [security, scorecard]
    max: 3
    close-older-issues: true
  close-issue:
  add-labels:
  update-issue:
---

# OpenSSF Scorecard Monitor

Monitor the OpenSSF Scorecard for this repository and create actionable improvement issues.

## Instructions

1. Fetch the latest OpenSSF Scorecard results from:
   `https://api.securityscorecards.dev/projects/github.com/dorlugasigal/TermBeam`

2. Parse the JSON response and analyze each check's score (0-10 scale).

3. Identify checks scoring below 7 that have **actionable** improvements (skip these non-actionable checks):
   - `Maintained` — depends on project age, not fixable
   - `Contributors` — depends on external contributors, not fixable
   - `CII-Best-Practices` — requires external badge program enrollment
   - `Signed-Releases` — only relevant if releases exist

4. For each actionable low-scoring check, create a GitHub issue with:
   - **Title**: `[scorecard] Improve <CheckName> (currently <score>/10)`
   - **Body** that includes:
     - Current score and reason from the scorecard
     - Specific details/warnings from the `details` array
     - Concrete steps the maintainer can take to improve the score
     - Link to the scorecard docs for that check
   - **Labels**: `security`, `scorecard`

5. If a check has improved to >= 7 since the last run, close its existing issue with a celebratory comment noting the improvement.

6. If the overall score is >= 8, create a summary issue celebrating the achievement instead.

## Context

- The repository is a Node.js CLI tool (TermBeam) published on npm
- Workflows live in `.github/workflows/`
- Dependencies: npm (root + src/frontend/ + packages/), pip (docs/requirements.txt), Docker, GitHub Actions
- Branch protection, code review, and fuzzing are common improvement areas
- The scorecard runs weekly via `.github/workflows/scorecard.yml`
