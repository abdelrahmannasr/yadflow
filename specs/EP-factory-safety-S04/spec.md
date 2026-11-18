# Spec — EP-factory-safety-S04: judge repo folders before build and worktree run git

Story: `EP-factory-safety-S04` (epic `EP-factory-safety`), engine repo. Issue: Product #217.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`registeredRepo` (`cli/build.mjs`) and `targetsOf` (`cli/worktree.mjs`) treat a registered folder as a
clone when it holds `.git`, and then run git there. A committed link to another clone on the machine, a
path outside the workspace, or a path through `.git` gets through. The other commands already use the
shared judgement in `cli/workspace.mjs` (E125).

## Requirements

- R1. `yad build` (ship, done, sync and the Spec Kit pin) finds the repo's checkout with `judgedRepos`. A
  refused entry runs no git and is named with its reason (`YAD-STATE-009`); sync and the pin warn instead.
- R2. `yad worktree add`, `list` and `remove` act only on entries the judgement accepts. `add` and
  `remove --repo <it>` stop with the reason; `list` and `remove --all` warn and list them under
  `skipped` in `--json`.
- R3. A repo not cloned on this machine, and a monorepo entry inside another repo, behave as today.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

Use `judgedRepos(root, {repos:[meta]})` in `registeredRepo` and in `targetsOf`, as `notCheckoutWhy`
(`cli/setup.mjs`) does. Tests use a logging git on `PATH` with a linked clone and a bare-shaped folder,
and check that no git runs there.

## Tasks

<!-- yad:tasks -->
## T01 — Judge the registered repo before yad build runs git in it
**Files:**
- cli/build.mjs
- cli/test-build.mjs

## T02 — Judge registered repos before yad worktree runs git in them
**Files:**
- cli/worktree.mjs
- cli/test-worktree.mjs
- docs/CLI.md
<!-- /yad:tasks -->
