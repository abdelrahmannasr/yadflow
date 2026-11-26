# Spec — EP-foundation-first-epic-S01: `yad epic new --seed bootstrap|pack`

Story: `EP-foundation-first-epic-S01` (epic `EP-foundation-first-epic`), engine repo. Issue: engine #694.
Contract: the locked `contract.md` of the epic — the API row `yad epic new <slug> --seed …` and the data
model row `state.json` → `seed`. This story implements those two rows and nothing else of the contract.

## Problem

`yad epic new` seeds an epic's ledger (`seedState` in `cli/epic-state.mjs`, called by `runEpicNew` in
`cli/epic.mjs`). Nothing in the ledger can say "this epic is the Product's setup epic". The later stories
of this epic (the guide's proposal, the setup line in `foundation status`, the skill outlines) all key off
such a mark. `kind` is taken: it is the lifecycle marker (`stub`, `foundation`). So a new key, `seed`.

## Requirements

- **R1.** `yad epic new <slug> --seed bootstrap` or `--seed pack` writes `"seed": "<kind>"` into the new
  `state.json`, right after `profile` in key order. Nothing else in the ledger changes.
- **R2.** `--json` output adds `"seed": "<kind>"` on success. With no `--seed`, the ledger bytes and the
  output (text and `--json`) are exactly today's.
- **R3.** It is refused with code `YAD-STATE-012`, writing nothing (no epic folder, no ledger, no
  `reviews/`), and exit code 1, when any of these holds. All the checks run before anything is
  written, in this order:
  1. the value is not `bootstrap` or `pack` → `--seed takes bootstrap or pack, not "<value>"`;
  2. `--stub`, `--parent` or `--issue` is given → `--seed cannot go with --<flag>: a seeded epic is a new
     feature epic of its own`;
  3. the type is not `feature` (from `--type`, or from an existing `epic.md` header) → `--seed needs a
     feature epic (this is a <type>): drop --type, or drop --seed`;
  4. the route is not `classic` or `analysis-first` → `--seed needs the full chain (classic or
     analysis-first): a walking skeleton fixes the first contract, and <profile> has no architecture
     step`.
  The value printed back is cleaned (`forTerminal`).
- **R4.** On success the text output adds one line, after the "seeded" line:
  `✓ <EP> seeded as a <kind> epic: the yad-epic skill writes its scope from the Foundation`.
- **R5.** `yad next <EP>` and the `yad next` list show the kind beside the epic id, dim, as
  `seed: <kind>`, the way the theme tag is shown. `yad next --json` is unchanged (the golden test holds it).
- **R6.** `yad doctor` and `yad migrate` accept a ledger with `seed` and leave the key as it is. The shape
  version (`SCHEMA_VERSION`) does not change.
- **R7.** `YAD-STATE-012` is added to `CODES` in `cli/errors.mjs`, and to the error table in `docs/CLI.md`.
- **R8.** `docs/CLI.md`: the `yad epic new` row names `--seed bootstrap|pack`; `bin/yad.mjs` usage names it.

## Non-goals

- The guide's first-epic proposal (S02), `yad repo features` (S03), the setup line in `foundation status`
  (S04), the skill outlines (S05).
- Changing a `seed` after seeding. There is no command for it, on purpose.

## Clarifications

- **Q1. Why not `YAD-STATE-007`, "an epic cannot be seeded"?** The locked contract names `YAD-STATE-012`,
  and a code change there would re-lock it. 012 is narrower: the seed flag's own refusals. 007 stays the
  code for a profile `seedState` cannot seed.
- **Q2. `yad status <EP>`.** The story's criterion names it, but `yad status` takes no epic (it refuses
  one). The kind is shown in `yad next`, which is the per-epic view. `yad status --json` is left as is,
  since the contract adds nothing to it.
- **Q3. `--issue` with `--seed`.** Today `--issue` refuses any flag it does not take. `--seed` is checked
  first, so the refusal is the seed one with its code, as the contract says.
- **Q4. An existing `epic.md` that says `chore`.** The type then comes from the header, so R3.3 refuses it.

## Tasks

- **T01** — R1–R8 in `cli/epic.mjs`, `cli/epic-state.mjs`, `cli/errors.mjs`, `cli/argv-flags.mjs`,
  `bin/yad.mjs`, `cli/next.mjs`, `docs/CLI.md`, with tests in `cli/test.mjs` (or the file the existing
  `yad epic new` tests are in).
