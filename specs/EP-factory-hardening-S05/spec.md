# Spec — EP-factory-hardening-S05: a later build sync records the tasks of a grouped PR an earlier one missed

Story: `EP-factory-hardening-S05` (epic `EP-factory-hardening`), engine repo. Issue: Product #218.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad build sync` records every task of the story a grouped (squash-merged) PR carries, by reading the
PR's commits from the platform (#583). But it reads a PR only when it has just recorded the branch's own
task from it. Once that task has a ship, a later sync never asks the PR again. So a group missed once —
the platform read failed, the list was cut short, the run was a `--dry-run`, or an older yadflow recorded
only the branch's task — stays missed, and a person must record each other task with
`yad build ship --task`.

## Requirements

- R1. `yad build sync` also reads again the PR/MR of every ship that names one, for each story in scope
  (the epic given, or all) whose status is not `shipped`, and records the tasks of that story it carries
  that have no ship. A `--dry-run` lists them in `planned`, like any other group.
- R2. A PR/MR is asked at most once per sync, however many ships or findings name it; one that cannot be
  read is listed in `unread` once per run, and the note says the next sync asks again.
- R3. A task that already has a ship is never recorded twice.
- R4. A shipped story's PRs/MRs are not asked, so the platform calls grow only with stories still open.
- R5. `docs/CLI.md` says what a later sync reads again, in place of "a later sync does not read that
  PR/MR again".

## Out of scope

Reading again the PR of a ship whose story file is missing or has no status, a retroactive ship, or a ship
with no PR/MR (`pr: "none"`). Grouped PRs of 100 commits or more (still listed for a person).

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

In `buildSync` (`cli/build.mjs`), before the group loop, add each ship with a PR number (parsed from its
URL or `#n`) of a story in scope that is not shipped. Run each (repo, PR, story) group once, and cache the
PR's commit read per (repo, PR), so a PR is asked once per run. `shipGroup` already skips a task that has
a ship. The test in `cli/test-build.mjs` runs syncs in a row against a stub `gh`: a failed read, a read
naming only T01, a dry run, a full read, a repeat (one ask), and a shipped story (no ask).

## Tasks

<!-- yad:tasks -->
## T01 — Read again the grouped PRs of stories not shipped yet in build sync
**Files:**
- cli/build.mjs
- cli/test-build.mjs
- docs/CLI.md
<!-- /yad:tasks -->
