# Spec — EP-engine-reports-S04: the gate sync follows YAD_TRUNK

Story: `EP-engine-reports-S04` (epic `EP-engine-reports`), engine repo. Issue: Product #232.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad-gate-sync` is the Product CI job that moves a gate on after its review PR/MR merges. It follows only
the platform's default branch. A team whose trunk (the Product's `default_branch` in `.sdlc/product.json`)
is another branch sets the CI variable `YAD_TRUNK`, which the update guard has followed since engine #609
(issue #599). The gate sync ignores it: on GitLab a merge push to the trunk does not start the job, and
both platforms' sweeps check out the default branch, while `yad gate ci` pushes the advance to the trunk.
`yad ci check` says so in its Product `trunk` row and tells the team to change the default branch.

## Requirements

- R1. GitLab: the merge rule also fires on a push to `$YAD_TRUNK` when it is set (same commit-message
  match). The script picks one branch: the pushed branch on the merge path, `${YAD_TRUNK:-$CI_DEFAULT_BRANCH}`
  on the sweep, and every fetch and checkout goes to it.
- R2. GitHub: the reconcile job checks out `vars.YAD_TRUNK || github.event.repository.default_branch`. The
  merge job already checks out the branch the review merged into, and `pull_request: closed` has no branch
  filter, so a merge into the trunk already starts it; no push trigger is added.
- R3. With `YAD_TRUNK` unset or empty, both templates act exactly as today. The first GitLab rule and the
  `yad-pin` blocks are unchanged.
- R4. `yad ci check`'s Product `trunk` row drops the sentence and the step saying the gate sync follows
  only the default branch; it says the gate sync follows the variable too.
- R5. `docs/CLI.md`, the site's reference data, `docs/GATES.md`, `docs/branch-protection.md`, the
  `yad-product-bridge` skill and its `bridge.md` say the gate sync follows `YAD_TRUNK`.

## Out of scope

Reading the variable's value (`yad ci check` still cannot). Checking that `YAD_TRUNK` equals the Product's
declared trunk. Any change to `yad gate ci`, which already pushes to the declared trunk. The code repos'
templates, which run no gate sync.

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: On GitLab, which branch does the merge path check out when `YAD_TRUNK` is set? → A: the branch that was pushed (`$CI_COMMIT_BRANCH`), as the GitHub merge job checks out the PR's base. Unset, that is the default branch, as today.
- Q: Does the GitHub template need a push trigger for the trunk? → A: no. It has none; `pull_request: closed` already covers a merge into any branch.

## Plan

Copy #609's pattern: GitLab rules read `$YAD_TRUNK && $CI_COMMIT_BRANCH == $YAD_TRUNK`, and GitHub reads
`vars.YAD_TRUNK`, which is `''` when unset. A template test next to the update-guard one checks the rules,
the checkout refs and the trigger, and runs the GitLab branch pick in `sh` with the variable unset, empty and
set. Then the `ci check` row and its test, and the docs.

## Tasks

<!-- yad:tasks -->
## T01 — Make both gate-sync templates follow YAD_TRUNK when it is set
**Files:**
- skills/yad-product-bridge/templates/gitlab/yad-gate-sync.gitlab-ci.yml
- skills/yad-product-bridge/templates/github/yad-gate-sync.yml
- cli/test.mjs

## T02 — Drop the "gate sync follows only the default branch" text from yad ci check's trunk row
**Files:**
- cli/ci-check.mjs
- cli/test-ci-check.mjs
- docs/CLI.md

## T03 — Say the gate sync follows YAD_TRUNK in the docs
**Files:**
- docs/sdlc-site/src/data/referenceData.ts
- docs/branch-protection.md
- docs/GATES.md

## T04 — Say the gate sync follows YAD_TRUNK in the bridge skill
**Files:**
- skills/yad-product-bridge/SKILL.md
- skills/yad-product-bridge/references/bridge.md
<!-- /yad:tasks -->
