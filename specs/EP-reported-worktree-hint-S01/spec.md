# Spec — EP-reported-worktree-hint-S01: the default-branch refusal names `yad worktree add` in a plain git worktree

Story: `EP-reported-worktree-hint-S01` (epic `EP-reported-worktree-hint`), engine repo. Issue: engine #692.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`guardDefaultBranch(branch, defaultBranch, { allowBranch, cmd, root })` in `cli/productcommit.mjs` is the
guard every yad command that commits to the Product's default branch runs first. It has four callers, and
each passes `root`:

| Caller | Command |
|---|---|
| `cli/checkpoint.mjs` | `yad checkpoint` |
| `cli/gate.mjs` | the gate commands that commit (`gate repair`, `gate reopen`) |
| `cli/repo-publish.mjs` | `yad repo refresh --push` |
| `cli/tidy.mjs` | `yad tidy up` |

It has two refusal paths:

- **A detached HEAD** (`branch === 'HEAD'`). In a linked Product worktree (`isProductWorktree(root)`) it
  already gives a worktree-aware hint (#597). This story leaves it alone.
- **A named branch that is not the default.** It prints
  `on '<b>', not the default branch '<d>' — <cmd> commits go to the default branch …` and the hint
  `switch to '<d>' and re-run, or pass --allow-branch to override (if '<d>' is wrong, set default_branch in …)`.
  It is the same everywhere.

In a linked worktree of the Product that yad did not make (a plain `git worktree add -b <branch> …`), the
first half of that hint does not work. `git switch <d>` fails there while another folder has `<d>` checked
out, which is the usual case, since the main checkout holds it. That leaves `--allow-branch` and a manual
push, which is the wrong way. The supported ways are:

- `yad worktree add <epic>`: its Product worktree sits detached at `origin/<d>`, and `yad checkpoint`
  commits there and pushes `HEAD:<d>` (#115).
- `git switch --detach origin/<d>` in the same folder. A plain linked Product worktree on a detached HEAD
  counts as the default branch, while it holds only yad's own commits (#597; `branchToCommitOn`).

The two helpers this needs already exist:

- `isProductWorktree(root)` (`cli/productcommit.mjs`) is true for a linked worktree of the Product:
  one yad made for an epic, or a plain one with no record. It is never true for the main checkout, or
  for a folder whose record names a code repo, or whose record cannot be read.
- `worktreeAt(root)` (`cli/worktree-record.mjs`, already imported) returns the record that
  `yad worktree add` leaves, or `null`.

So "linked Product worktree with no record" is `isProductWorktree(root) && !worktreeAt(root)`.

## Requirements

- **R1.** On a named branch that is not the default, with `allowBranch` false, in a folder where
  `isProductWorktree(root) && !worktreeAt(root)`, the guard prints the same `fail` line as today. Its
  `hand` line says this is a second checkout of the Product that yad did not make, names
  `yad worktree add <epic>` (run from the main checkout, which makes a Product worktree that commits and
  pushes to `<d>`), and names `git switch --detach origin/<d>` here, then re-running. It still names
  `--allow-branch` as the override, and still names where `default_branch` is set. It does not say
  `switch to '<d>'`.
- **R2.** The guard still returns `false` and sets `process.exitCode = 1` in that case. Nothing is
  committed.
- **R3.** With `allowBranch` true, the guard behaves as today in every folder: the same warning, and it
  returns `true`.
- **R4.** In the main checkout on a named branch, the `fail` and `hand` lines are exactly today's.
- **R5.** In a worktree that `yad worktree add` made (`worktreeAt(root)` is a Product record) on a named
  branch, the lines are exactly today's.
- **R6.** In a folder whose record names a code repo, or with no `root`, the lines are exactly today's.
- **R7.** The detached-HEAD path is unchanged.
- **R8.** Branch and default-branch names are printed cleaned (`forTerminal`), as today.
- **R9.** `docs/CLI.md`, in the `yad checkpoint [--push]` row, says that on a branch in a plain linked
  worktree of the Product, the refusal points at `yad worktree add <epic>` or
  `git switch --detach origin/<default>` (#692).

## Non-goals

- Changing what `--allow-branch` does, or removing it.
- Making `yad checkpoint` commit by itself on a branch in a plain worktree.
- Naming the epic in the hint. The guard does not know it, so the hint writes `<epic>`.
- The detached-HEAD path (#597).

## Clarifications

- **Q1. Must the hint check that `<d>` really is checked out in another folder?** No. In a linked
  worktree, `yad worktree add` and `git switch --detach origin/<d>` are the right advice either way,
  and the check would cost a `git worktree list` call on every refusal. The hint does not claim that
  `git switch <d>` fails; it gives the ways that work.

## Plan

One change in `guardDefaultBranch`, in the not-detached path after the `allowBranch` branch:
choose the `hand` text by `isProductWorktree(root) && !worktreeAt(root)`. The `fail` line, the return
value and the exit code stay as they are.

Tests go in `cli/test-worktree.mjs`, beside "a detached HEAD in the main Product checkout is refused…". It
has `workspace()` (a real Product with an origin) and runs `yad` end to end. The cases are:

- a plain `git worktree add -b wip <dir> origin/main` of the Product (R1, R2);
- the same with `--allow-branch` (R3);
- the main checkout on `wip` (R4);
- a `yad worktree add EP-x` worktree switched to a branch (R5);
- a plain worktree of a code repo (R6).

## Tasks

<!-- yad:tasks -->
## T01 — the default-branch refusal names `yad worktree add` in a plain Product worktree
**Files:**
- `cli/productcommit.mjs`
- `cli/test-worktree.mjs`
- `docs/CLI.md`

**Done when:** R1–R9 hold. The new tests run real git worktrees through `yad checkpoint --push`, and they
fail when the new hint is removed (the plain worktree then gets `switch to 'main'`).
<!-- /yad:tasks -->
