# Spec — EP-review-followups-S01: close the gaps left after the default-branch push recheck

Story: `EP-review-followups-S01` (epic `EP-review-followups`), engine repo. Issue: Product #245.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Engine PR #631 (Product #231) added `recheckBeforePush` in `cli/productcommit.mjs`. It judges the commits
ahead of `origin/<default>` once more, right before a default-branch command pushes from a Product worktree.
Three gaps remain:

1. After a refusal, the hint says to keep the commits on a branch, `git reset --hard origin/<default>`,
   restore yad's own files and re-run. A story `status:` change in a file that is also the person's (so it is
   not in the restore list) is dropped by the reset, and the re-run does not write it again: `gate ci` flips
   statuses only when a step advances, and the restored ledger says the step is already done.
2. `yad update --push` (`commitAndPush` in `cli/update-commit.mjs`) pushes with `pushWithRebase` and no
   recheck.
3. `gate ci` stages, reads and commits the files it wrote with plain pathspecs. A written file whose name holds
   `*`, `?` or `[` (a story file named `*.md`) also matches other files: the staging and the commit take a
   person's unstaged edit of a file beside it.

## Requirements

- R1. The refusal hint in `explainForeignFile` says, after the reset and the restore and before the re-run, to
  run `yad sync-status`, which writes again, uncommitted, an artifact's `status:` change the reset dropped. The
  fallback hint of `recheckBeforePush` (no file named) is unchanged: it has no restore step, so the ledger is
  origin's again and `sync-status` would have nothing new to read.
- R2. `commitAndPush` calls `recheckBeforePush(root, git, <default branch>)` before its push, for the Product
  only (a code repo's worktree is not judged by the Product's rules). On a refusal it returns
  `{ committed: true, pushed: false, error: true }`, so `commitUpdates` says the update is incomplete, and
  `process.exitCode` is 1 (set by the recheck).
- R3. `gate ci` passes `--literal-pathspecs` to the `git add` calls that stage its files, the
  `git diff --cached --name-only` that reads them back, and the `git commit` that takes them. A name with `*`
  matches only itself.
- R4. One test per gap: the hint followed word for word brings the status back; the update refusal happens
  before any push; the `gate ci` commit leaves a person's unstaged edit out. Each fails on the old code.
- R5 (review). The `sync-status` clause comes only with the restore step (when yad's own files are named), says
  plainly that the status it writes stays uncommitted and reaches the default branch with `<branch>` once that
  is reviewed and merged (so the person may `git restore` it then), and names the epic,
  `yad sync-status <epic>`, when yad's files belong to exactly one epic (`epics/<id>/…`, or `foundation/…` for
  `EP-foundation`); otherwise it stays bare.
- R6 (review). `commitAndPush` refuses a detached HEAD before it stages or commits anything, even with
  `--allow-branch`, as `guardDefaultBranch` does (#597). It returns `skipped` and says to run `yad update` from
  the main checkout on the default branch. The recheck from R2 stays as a guard only: no detached HEAD reaches
  it now, and for an update it could only refuse.
- R7 (review). `gate reopen --push` stages, reads and commits the files it wrote with `--literal-pathspecs`,
  as R3 does for `gate ci`.

## Out of scope

Changing what counts as yad's own commit (#231 set that). Making `yad update` commit on the default branch from
a detached Product worktree (it is refused there; run it from the main checkout). A new commit path for the status change
`yad sync-status` writes back.

## Clarifications

### Session 2026-11-20
- Q: Hint or have the re-run redo the flip? → A: the hint (the story prefers it). A re-run of `gate ci` sees no
  advance, so redoing the flip there would change when it writes statuses.
- Q: When does the update recheck act? → A: before T04, only on a detached Product worktree that
  `--allow-branch` let past the branch check; it refused every update commit there, since `chore(yad-update): …`
  is not yad's own default-branch subject. Before T02, that push went to `HEAD:HEAD` and failed after a rebase
  attempt. Since T04 a detached HEAD is refused before staging, so the recheck cannot refuse through
  `commitAndPush`; it stays as a guard, and its own behaviour is covered by the #231 tests.
- Q: Only the commit literal? → A: no. The `git add` of a written file and the read of what was staged must be
  literal too, or the person's file is already staged and listed before the commit runs.
- Q: Who commits the status `yad sync-status` writes back? → A: no yad command, and none is added. The change
  is already in a commit on `<branch>`, and it reaches the default branch when that branch is reviewed and
  merged. The local write only shows the right status in the meantime; the hint says it stays uncommitted and
  may be dropped (`git restore`) once `<branch>` carries it. A re-run of `gate ci` stages status files only when
  a step advances, and `yad checkpoint` stages a story file only when it has a build-log ship and already says
  `in-build` or `shipped`. A Build status (`in-build`, `shipped`) the reset dropped is not written back by
  `sync-status` either; it too comes back with `<branch>`.
- Q: `--literal-pathspecs` or `:(literal)` per path? → A: the flag. `:(literal)x` is read as a plain name when the
  person's environment sets `GIT_LITERAL_PATHSPECS=1`, and matches nothing. The flag sets that variable for any
  hook the commit runs; yad's own hook is off for this commit (`YAD_HOOK_DISABLE=1`), and CI has no hooks.
- Q: Tests in `cli/test.mjs`? → A: the #231 tests are in `cli/test-worktree.mjs`, so R1 and R2 go there; the
  `gate ci --merged` tests (and `scaffoldCiProduct`) are in `cli/test.mjs`, so R3 goes there. The E48
  source scan in `cli/test-hooks.mjs` counts `['commit',` in `cli/gate.mjs` and must allow the flag before it.
  The reopen test (R7) sits beside the other `#322 gate reopen` tests in `cli/test.mjs`.

## Plan

- `cli/productcommit.mjs`: one more clause in the `explainForeignFile` hint.
- `cli/update-commit.mjs`: import `recheckBeforePush`; call it after the commit, before `pushWithRebase`, when
  `isProduct`.
- `cli/gate.mjs`: a local `lit(...)` helper (`git('--literal-pathspecs', ...)`) for the staging and the staged
  read; `--literal-pathspecs` before `commit` in the commit call. The same in `gateReopen` (T05), including its
  `git reset` after a failed commit.
- `cli/productcommit.mjs` (T04): `epicOf(files)` finds the one epic yad's files belong to; the clause moves into
  the restore step.
- `cli/update-commit.mjs` (T04): a `branch === 'HEAD'` refusal before the branch check.

## Tasks

<!-- yad:tasks -->
## T01 — The refusal hint names `yad sync-status` after the reset
**Files:**
- cli/productcommit.mjs
- cli/test-worktree.mjs

## T02 — `yad update --push` rechecks the Product's commits before its push
**Files:**
- cli/update-commit.mjs
- cli/test-worktree.mjs

## T03 — `gate ci` stages, reads and commits its files by literal name
**Files:**
- cli/gate.mjs
- cli/test.mjs
- cli/test-hooks.mjs

## T04 — The status hint says what happens to the status and names the epic; `yad update` refuses a detached HEAD (review fixes)
**Files:**
- cli/productcommit.mjs
- cli/update-commit.mjs
- cli/test-worktree.mjs

## T05 — `gate reopen` stages and commits its files by literal name (review fix)
**Files:**
- cli/gate.mjs
- cli/test.mjs
<!-- /yad:tasks -->
