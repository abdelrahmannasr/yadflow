# Spec — EP-reported-gitlab-S03: check direct pushes to a trunk that is not the default branch

Story: `EP-reported-gitlab-S03` (epic `EP-reported-gitlab`), engine repo. Issue: engine #599.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

The update guard (the CI job that checks the signature and subject of every commit pushed straight to a
branch, with no pull request) runs only on a push to the platform's default branch. A team whose trunk
— the branch the Product's registry names as `default_branch`, for example `testing` — is another branch
gets no check on direct pushes to that trunk. yad copies the CI files as they are, with no branch filled
in per repo, so the file cannot name the trunk itself. `yad ci check` does not say anything about it.

## Requirements

- R1. The GitLab update-guard fragment also runs on a push pipeline for the branch a `YAD_TRUNK` CI/CD
  variable names. Unset or empty, that rule never matches, so the jobs run as before.
- R2. The GitHub update-guard workflow's job also runs on a push to the branch the `YAD_TRUNK` repository
  variable names. Unset, it is `''` and never matches. Every branch push already starts the workflow, so
  the job's `if:` is what decides.
- R3. `yad ci check` shows a `trunk` row (a warning, `suggest`) for a repo that runs yad's CI when the
  branch yad's files name is not the platform's default branch. It names the variable, the value, where
  to set it (a project or group CI/CD variable on GitLab, a repository variable on GitHub) and the
  settings page, and says "if it is not set already", since yad cannot read a variable's value. The same
  branch, or a repo that runs no yad CI, gets no row.
- R4. The CLI reference, the gates doc, the branch-protection guide, the yad-checks skill and its
  reference, and the docs site's command list name the variable.

## Out of scope

Reading the variable's value from the platform (it needs Maintainer access on GitLab). Filling the
branch into the files per repo. Changing which branch `yad update --push` pushes to.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: A warning or a gap? → A: a warning (`suggest`): yad cannot read the variable, so a gap could never clear.

## Plan

Add a second `rules:` entry to the GitLab fragment, guarded by `$YAD_TRUNK &&`, and an `||` to the GitHub
job's `if:`. A test in `cli/test.mjs` pins both conditions. Add `trunkRow` to `platformRows` in
`cli/ci-check.mjs`, comparing the declared branch with the platform's default (both already read), and
test it on GitHub and GitLab next to "E160b case 8". The managed-file record (`.sdlc/managed.json`) holds
the hash of what yad wrote, so `yad update` brings the new templates to every install as `outdated`.

## Tasks

<!-- yad:tasks -->
## T01 — Run the update guard on a push to the YAD_TRUNK branch too
**Files:**
- skills/yad-checks/templates/gitlab/yad-update-guard.gitlab-ci.yml
- skills/yad-checks/templates/github/yad-update-guard.yml
- cli/test.mjs

## T02 — Warn in yad ci check when the trunk is not the platform's default branch
**Files:**
- cli/ci-check.mjs
- cli/test-ci-check.mjs

## T03 — Name YAD_TRUNK in the CLI reference, the gates doc and the branch-protection guide
**Files:**
- docs/CLI.md
- docs/GATES.md
- docs/branch-protection.md

## T04 — Name YAD_TRUNK in the yad-checks skill, its reference and the docs site
**Files:**
- skills/yad-checks/SKILL.md
- skills/yad-checks/references/check-gates.md
- docs/sdlc-site/src/data/referenceData.ts
<!-- /yad:tasks -->
