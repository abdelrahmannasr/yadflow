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

## Out of scope

Changing what counts as yad's own commit (#231 set that). Making `yad update` commit on the default branch from
a detached Product worktree (it still needs `--allow-branch` there). A new commit path for the status change
`yad sync-status` writes back.

## Clarifications

### Session 2026-11-20
- Q: Hint or have the re-run redo the flip? → A: the hint (the story prefers it). A re-run of `gate ci` sees no
  advance, so redoing the flip there would change when it writes statuses.
- Q: When does the update recheck act? → A: `commitAndPush` reads the raw branch, so a detached Product worktree
  is skipped unless `--allow-branch` lets it past; that is the only case where the recheck can refuse. On the
  default branch in the main checkout it returns true at once. The update commit's subject
  (`chore(yad-update): …`) is not yad's own default-branch subject, so the recheck refuses every update commit
  from a detached Product worktree. Before, that push went to `HEAD:HEAD` and failed after a rebase attempt.
- Q: Only the commit literal? → A: no. The `git add` of a written file and the read of what was staged must be
  literal too, or the person's file is already staged and listed before the commit runs.
- Q: Who commits the status `yad sync-status` writes back? → A: open. No yad command does: a re-run of
  `gate ci` stages status files only when a step advances, and `yad checkpoint` stages a story file only when it
  has a build-log ship and already says `in-build` or `shipped`. The hint says the change is uncommitted. A
  Build status (`in-build`, `shipped`) that the reset dropped is not written back by `sync-status` either.
- Q: `--literal-pathspecs` or `:(literal)` per path? → A: the flag. `:(literal)x` is read as a plain name when the
  person's environment sets `GIT_LITERAL_PATHSPECS=1`, and matches nothing. The flag sets that variable for any
  hook the commit runs; yad's own hook is off for this commit (`YAD_HOOK_DISABLE=1`), and CI has no hooks.
- Q: Tests in `cli/test.mjs`? → A: the #231 tests are in `cli/test-worktree.mjs`, so R1 and R2 go there; the
  `gate ci --merged` tests (and `scaffoldCiProduct`) are in `cli/test.mjs`, so R3 goes there. The E48
  source scan in `cli/test-hooks.mjs` counts `['commit',` in `cli/gate.mjs` and must allow the flag before it.

## Plan

- `cli/productcommit.mjs`: one more clause in the `explainForeignFile` hint.
- `cli/update-commit.mjs`: import `recheckBeforePush`; call it after the commit, before `pushWithRebase`, when
  `isProduct`.
- `cli/gate.mjs`: a local `lit(...)` helper (`git('--literal-pathspecs', ...)`) for the staging and the staged
  read; `--literal-pathspecs` before `commit` in the commit call.

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
<!-- /yad:tasks -->
