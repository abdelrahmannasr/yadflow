# Spec — EP-factory-prep-S01: the review PR opens even when a domain label is missing

Story: `EP-factory-prep-S01` (epic `EP-factory-prep`), engine repo. Issue: engine #584.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad gate open` labels a review PR with `domain:<repo>` for each repo the step names (the stories review,
or an escalated step). On GitHub, `gh pr create --label x` refuses the whole PR when label x does not
exist in the repo. yad then only warns "could not open PR", and the review never opens. A factory run
would stop here at the first review in a repo that has never had the label.

## Requirements

- R1. On GitHub, before opening the review PR, yad reads the Product repo's labels and makes each missing
  `domain:<repo>` label, then opens the PR with the labels.
- R2. A label that already exists (names compared without case) is not made again; no other label is made.
  A label someone else made at the same moment ("already exists") counts as made.
- R3. A label that cannot be made is left off; the others stay. A warning names each label left off and
  the command that makes it (`gh label create "domain:x"`).
- R4. When the labels cannot be read, they are sent as they are. If the platform still refuses the PR
  because of a label, yad opens it once more without labels, with the same warning.
- R5. On GitLab the labels are sent as they are: GitLab makes a missing label itself.
- R6. Nothing changes when the review carries no labels. A failure that is not about a label is not retried.

## Clarifications

### Session 2026-11-17
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface, no high-risk file; the engine has no risk map)

## Plan

In `cli/gate.mjs`, add `domainLabels` (target from `prTarget` and the Product's git URL; `readLabels` and
`createLabel` from `cli/issues.mjs`) and `labelHint`, and call them in `gateOpen` before the creator; add
the one retry without labels; skip the label step on GitLab. `gateOpen` takes `runner` and `env` for tests, like `creator`. Tests in
`cli/test.mjs` beside the gateOpen tests, with a fake `gh`.

## Tasks

<!-- yad:tasks -->
## T01 — Make missing domain labels before opening the review PR, or open it without them
**Files:**
- cli/gate.mjs
- cli/test.mjs
<!-- /yad:tasks -->
