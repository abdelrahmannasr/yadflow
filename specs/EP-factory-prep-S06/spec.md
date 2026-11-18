# Spec — EP-factory-prep-S06: clean Product-written text before printing it

Story: `EP-factory-prep-S06` (epic `EP-factory-prep`), engine repo. Issue: Product #2 (E125), part (c).
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Text held in the Product's files (step ids in `state.json`, reconcile-debt reasons, capture workflow file
names, risk-map folder names, CODEOWNERS lines) is printed raw by `yad doctor`, `yad risk-map`, `yad
thread` and `yad codeowners`. A committed file can then write terminal control codes: set the window
title, clear the screen, or overwrite a line.

## Requirements

- R1. Every line `yad doctor` prints (each check's message and hint) goes through `forTerminal` once,
  before colour is added, so yad's own colours stay.
- R2. `yad risk-map` prints finding codes, targets, messages, repo names, roots and the draft's lists
  cleaned.
- R3. `yad thread` prints open debt (epic id, reason, requirements) cleaned; `yad codeowners` prints its
  finding messages cleaned.
- R4. Normal text prints unchanged; `--json` output keeps the raw values.

## Out of scope

The risk-map draft still writes a folder name holding ESC or BEL into the map file (a file, not the
terminal). Listed as a follow-up.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface; the engine has no risk map)

## Plan

`forTerminal` (`cli/lib.mjs`) at each print boundary: doctor's printer in `runDoctor`, `findingLine` and
the other risk-map prints, the debt lines of `runThread`, and the codeowners warnings. Tests feed escape
codes through Product files and check that none reach the output, and that `--json` keeps them.

## Tasks

<!-- yad:tasks -->
## T01 — Clean Product-file text in yad doctor's printed lines
**Files:**
- cli/doctor.mjs
- cli/test.mjs

## T02 — Clean folder names in yad risk-map output
**Files:**
- cli/riskmap-command.mjs
- cli/test.mjs

## T03 — Clean the debt lines of yad thread and the codeowners warnings
**Files:**
- cli/thread.mjs
- cli/codeowners-command.mjs
- cli/test-threads.mjs
<!-- /yad:tasks -->
