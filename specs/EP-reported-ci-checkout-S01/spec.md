# Spec — EP-reported-ci-checkout-S01: contract-check reads the PR head commit, not GitHub's merge commit

Story: `EP-reported-ci-checkout-S01` (epic `EP-reported-ci-checkout`), engine repo. Issue: engine #708.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

On a `pull_request` event, `actions/checkout` checks out `refs/pull/<n>/merge` by default: a merge
commit GitHub makes on the fly, with the base branch and the PR head as its two parents. So in every
GitHub job, `HEAD` is that merge commit.

The quote rule in `checks/contract-check.sh` (`quote_story`, the "rebased onto the base" check) passes a
slice that the branch's own commits change only when `git merge-base --is-ancestor "$BASE" HEAD` holds
and `git rev-list --merges "$BASE..HEAD"` is empty. On the merge ref the second list always holds
GitHub's merge commit. So a PR that adds a quoted contract slice always fails with "not rebased onto
<base> (or holds merge commits) … Rebase it, then push again", and a rebase cannot help.

The script was written for `HEAD` = the branch tip: it builds the merge into the base itself with
`git merge-tree`, and reads every changed file from that. The other gates are not affected:
`commit-message`, `lineage-check`, `epic-open` and `reconcile-debt` read `--no-merges`, and
`build-test-lint` should go on testing the merged tree.

## Requirements

- R1. In `skills/yad-checks/templates/github/yad-checks.yml`, the `contract-check` job's checkout reads
  `with: { fetch-depth: 0, persist-credentials: false, ref: "${{ github.event.pull_request.head.sha }}" }`.
- R2. No other job in a GitHub gate template sets `ref:` on its checkout.
- R3. The value is in `with:`, never in a `run:` script (the #703 rule still holds, and its test passes).
- R4. A test fails when the `contract-check` job's checkout loses that `ref:`, or another job gains a `ref:`.
- R5. A script test shows the cause and the fix: on a branch rebased onto the base, with a quoted slice,
  the gate passes when `HEAD` is the branch tip, and fails with the "not rebased onto … (or holds merge
  commits)" message when `HEAD` is a merge commit of that branch into the base.
- R6. A branch that is behind its base still fails with the same message (the existing review-5 test
  stays as it is).
- R7. `skills/yad-checks/references/check-gates.md` and `docs/GATES.md` say that `contract-check` checks
  out the PR head commit on GitHub, and why.

## Non-goals

- The other jobs, and the GitLab templates (MR pipelines run on the branch head; a "merged results"
  pipeline is a separate look).
- Any change to `checks/contract-check.sh` or to what the gate decides.
- The engine's own installed `.github/workflows/yad-checks.yml`: `yad update` refreshes it after a release.

## Clarifications

### Session 2026-11-27

- Q: Light spec, one `spec.md` holding the spec, the plan and the tasks? → A: yes, as the person chose for the earlier chore stories (EP-reported-ci-hygiene). The story qualifies: chore route, no contract, no high-risk file. Chosen by the agent; the person confirms at the engineer review.
- Q: One PR for the two tasks, or one each? → A: one PR, one commit per task, as for EP-reported-ci-hygiene. Chosen by the agent; the person confirms at the engineer review.
- Q: Pin the head by `github.event.pull_request.head.sha` or by `refs/pull/<n>/head`? → A: the sha. It is the exact commit the run was started for, `actions/checkout` documents it for this use, and it works for a fork PR too.

## Plan

T01 changes the one checkout and adds the two tests that hold it (R1–R6). T02 writes the two docs (R7).
Each task is checked by the full test suite. The yad check jobs on this PR still run the engine's own
installed workflow, which `yad update` refreshes after a release; the fix is proven on GitHub once a
code repo has updated.

## Tasks

<!-- yad:tasks -->
## T01 — contract-check checks out the PR head commit, held by two tests
**Files:**
- `skills/yad-checks/templates/github/yad-checks.yml`
- `cli/test-ci-check.mjs`
- `cli/test-checks.mjs`

**Done when:** R1–R6 hold: the new checkout test passes and fails when the `ref:` is removed or added to another job, and the new script test passes on the branch tip and fails on a merge commit on top.

## T02 — the docs say contract-check reads the PR head, and why
**Files:**
- `skills/yad-checks/references/check-gates.md`
- `docs/GATES.md`

**Done when:** R7 holds, and the full test suite passes.
<!-- /yad:tasks -->
