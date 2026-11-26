# Spec — EP-foundation-first-epic-S04: the setup epic stays off the roadmap

Story: `EP-foundation-first-epic-S04` (epic `EP-foundation-first-epic`), engine repo. Issue: engine #694.
Contract: the locked `contract.md` of the epic. This story implements the API rows `yad foundation status` and
`yad foundation publish`, and the data-model row `SetupEpic`. It reads the `seed` key S01 (#700) writes.

## Problem

A setup epic (`bootstrap` or `pack`) is not a roadmap feature. Today `yad foundation status` would list it
under `unlisted` ("feature epics no row proposes"), as if the roadmap had missed a feature, and a roadmap row
that names its id would be published as a roadmap item.

## Requirements

- **R1.** `ledgerSeed(root, id)` (`cli/epic-state.mjs`) returns the epic's `seed` when it is a known kind, else
  `null` (not seeded, another word, or a ledger that does not load).
- **R2.** `yad foundation status --json` always has `setup`: one `{ epicId, seed, status }` per epic whose
  ledger has a known `seed`, Product level left out. `status` is `featureStatus`, the roadmap rows' words. It
  may be empty.
- **R3.** An epic in `setup` is never in `unlisted`.
- **R4.** The text output adds, after the roadmap rows and before the "not on the roadmap" line, a block
  `setup  (outside the roadmap, never published as an item)` with one row per setup epic
  (`<mark> <epicId>  <seed>  <status>`, the roadmap's marks). Only when `setup` is not empty.
- **R5.** `yad foundation publish` leaves out a roadmap row whose epic is seeded, in a dry run too, and adds a
  `notes` line: `<EP> is the <seed> setup epic, so its row was left out`. No item is opened for it.
- **R6.** `docs/CLI.md`: the two rows say so.

## Non-goals

- Changing what publish does for roadmap features, or the roadmap's own rows.
- The proposal (S02) and the skill outlines (S05).

## Clarifications

- **Q1. A row that names a setup epic** is still shown among the roadmap rows by `foundation status` (it is
  the roadmap's own text); only publish leaves it out, and `setup` lists the epic.

## Tasks

<!-- yad:tasks -->
## T01 — `setup` in `yad foundation status`; `publish` leaves setup epics out
**Files:**
- `cli/epic-state.mjs`
- `cli/epic.mjs`
- `cli/foundation-publish.mjs`
- `cli/test-foundation-publish.mjs`
- `docs/CLI.md`

**Done when:** R1–R6 hold. The tests in `cli/test-foundation-publish.mjs` cover `setup` empty and filled,
`unlisted` without the setup epic, the text block present and absent, and publish (dry run and real) leaving a
seeded row out with its note. They fail when the publish filter is dropped, or when `unlisted` counts the setup
epic.
<!-- /yad:tasks -->
