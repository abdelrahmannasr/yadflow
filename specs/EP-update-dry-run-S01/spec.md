# Spec — EP-update-dry-run-S01: make yad update --dry-run a preview instead of a real update

Story: `EP-update-dry-run-S01` (epic `EP-update-dry-run`), engine repo. Source: engine PR #601, written
by a team member; its commit is kept with its author.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad update` parsed `--dry-run` but never passed it on, so the flag was ignored and every repo was
updated for real (in an empty Product it wrote 218 files).

## Requirements

- R1. `yad update --dry-run` runs the same read-only reconcile as `yad check --scope=changed`: it lists
  what would be added or changed and writes no file.
- R2. `--dry-run` with `--push` or `--open-pr` is refused before anything is written.
- R3. A plain `yad update` is unchanged.
- R4. The dry run's closing hint names `yad update` (the command that applies it), not `yad check --fix`.

## Out of scope

A dry run for other writing commands; any change to what a real `yad update` writes.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

In the `update` dispatch in `bin/yad.mjs`, route `--dry-run` to the read-only reconcile and refuse it with
`--push` / `--open-pr`. A test in `cli/test-detect.mjs` runs the three cases on a temporary Product.
T02: `reconcile()` in `cli/reconcile.mjs` takes a `previewOf` option; the `update --dry-run` dispatch passes
`'update'`, and the read-only hint then names `yad update`.

## Tasks

<!-- yad:tasks -->
## T01 — Make yad update --dry-run a preview instead of a real update
**Files:**
- bin/yad.mjs
- cli/test-detect.mjs
- docs/CLI.md
## T02 — Name yad update in the dry run's hint
**Files:**
- cli/reconcile.mjs
- bin/yad.mjs
- cli/test-detect.mjs
<!-- /yad:tasks -->
