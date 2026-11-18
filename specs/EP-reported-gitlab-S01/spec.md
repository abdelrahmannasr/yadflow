# Spec — EP-reported-gitlab-S01: save Build state from a plain detached Product worktree

Story: `EP-reported-gitlab-S01` (epic `EP-reported-gitlab`), engine repo. Issue: engine #597, part 1.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

The commands that commit Build state on the default branch (`yad checkpoint`, `tidy up`, `gate repair`,
`gate reopen`, `repo refresh --push`, `yad index`) treat a detached HEAD as the default branch only in a
Product worktree that `yad worktree add` made, because only that command writes the `yad-worktree.json`
record. A worktree made with `git worktree add --detach <dir> origin/<default>` (because another folder
holds the default branch) is refused with "on 'HEAD', not the default branch", and the refusal suggests
`--allow-branch`. Following that hint is unsafe: the push goes to the branch it is on, a branch named
`HEAD`. `yad gate ci` repeats the same worktree check.

## Requirements

- R1. In any linked worktree of the Product (with a yad record for the Product, or with no record) whose
  detached HEAD holds nothing beyond `origin/<default>` but yad's own `[skip ci]` commits, the
  default-branch commands commit on the default branch and push to `origin/<default>`.
- R2. A linked worktree holding a commit that is not yad's own is still refused, and so is a detached HEAD
  in the main checkout. A record that names a code repo does not count.
- R3. `yad gate ci` uses the same worktree rule: in a linked Product worktree a detached HEAD with commits
  of its own is refused.
- R4. When the branch is a detached `HEAD`, the refusal never suggests `--allow-branch`; it says to check
  out the default branch, or to work from a worktree at its tip.

## Out of scope

Engine #597 part 2. Refusing `--allow-branch` itself on a detached HEAD (it still commits there when a
person passes it). A linked worktree of a code repo: these commands run in the Product only.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

Add `isProductWorktree(root)` to `cli/productcommit.mjs`: a linked worktree (`linkedGitDir`) with no yad
record, or one whose record is the Product's. `branchToCommitOn`, the refusal hint in
`guardDefaultBranch`, and `detachedWorktree` in `gate ci` use it in place of the record check. The guard
gives a detached HEAD in the main checkout its own hint, without `--allow-branch`. Tests in
`cli/test-worktree.mjs` make a plain `--detach` worktree at `origin/main` against a bare origin and
check the branch, an end-to-end `checkpoint --push`, a non-yad commit refused (also by `gate ci`), and
the main checkout's hint. Docs: `docs/CLI.md` for `yad checkpoint` and `yad gate ci`, and the comment at the `yad index` caller.

## Tasks

<!-- yad:tasks -->
## T01 — Count a plain detached Product worktree as the default branch, and drop the --allow-branch hint for HEAD
**Files:**
- cli/productcommit.mjs
- cli/gate.mjs
- cli/test-worktree.mjs

## T02 — Document the plain Product worktree for the default-branch commands
**Files:**
- docs/CLI.md
- cli/index-command.mjs
<!-- /yad:tasks -->
