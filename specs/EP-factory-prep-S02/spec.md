# Spec — EP-factory-prep-S02: `yad build sync` records every task a grouped PR carries

Story: `EP-factory-prep-S02` (epic `EP-factory-prep`), engine repo. Issue: engine #583.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad build sync` finds merged work through `shipDrift`: `Task:` lines on the default branch, and the
platform's merged PRs mapped to one task each by their branch name. A squash merge leaves no `Task:` line
on the default branch, so when one PR carries T01 and T02 of a story, only T01 (named in the branch) is
recorded and the story never shows as shipped. `yad build ship --pr` already reads a PR's commits
(`prTasks`) and accepts such a grouped PR, but only when a person runs it for each task.

## Requirements

- R1. After sync records a task from a merged PR, it reads that PR's commits and records every other task
  of the same story whose `Task:` line appears there and that has no ship yet, from the same PR.
- R2. Each task is handled once per run (a `--no-ff` merge can report it again); a second sync records nothing.
- R3. A task of another story in the PR is not recorded; sync lists it with `yad build ship … --pr <n>`.
- R4. When the PR's commits cannot be read, or are cut off (100 or more), nothing extra is recorded, and
  sync says so with the command to run for each other task.
- R5. `--dry-run` lists the grouped tasks it would record; `--no-fetch` is passed through.

## Out of scope

Follow-up PRs. A later sync does not read a PR again once its branch's task has a ship, so a task missed
by a failed read (or by an older yadflow) is recorded by hand with the command sync prints.

## Clarifications

### Session 2026-11-17
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface, no high-risk file; the engine has no risk map)

## Plan

In `cli/build.mjs` `buildSync`: a `shipGroup` step after each ship recorded from a PR, using `prTasks`
and `buildShip` (which checks the group again through `prCarries`); a set of tasks handled in the run.
Tests in `cli/test-build.mjs` with the `groupedMerge` helper (a squash with no trailer) and the sync fake.

## Tasks

<!-- yad:tasks -->
## T01 — Record every task of a grouped PR in build sync
**Files:**
- cli/build.mjs
- cli/test-build.mjs
<!-- /yad:tasks -->
