# Spec — EP-seed-doctor-test-S01: a test that `yad doctor` and `yad migrate` keep `seed`

Story: `EP-seed-doctor-test-S01` (epic `EP-seed-doctor-test`, a defect threaded off
`EP-foundation-first-epic`), engine repo. Contract: inherited, unchanged.

## Problem

`EP-foundation-first-epic-S01` added `seed` to an epic's `state.json`. Its R6 says `yad doctor` and
`yad migrate` accept a ledger with `seed` and leave it as it is, with the shape version unchanged. The
behaviour is right on `main`, but no test holds it, so a later change to either command could drop or flag
the key and the suite would still pass.

## Requirements

- **R1.** One test makes a Product with an epic seeded `bootstrap`, then `pack`, and a plain Product with
  the same epic id and no seed.
- **R2.** `collectDoctor` gives the seeded Product exactly the findings it gives the plain one (with the
  temporary folder taken out of each message).
- **R3.** `planMigration` holds a row for the epic's `state.json` with `action: 'unchanged'` and
  `changes: false`.
- **R4.** After `runMigrate(T, { apply: true })`, the ledger's bytes are what `yad epic new` wrote:
  `seed` right after `profile`, and `schemaVersion` the engine's shape.
- **R5.** No product code changes.

## Verification

- The test passes alone and in the full `npm test`.
- Mutation check, by hand, both reverted:
  1. `cli/migrate.mjs` `stamped()` also deleting `seed` → the test fails with
     "bootstrap: yad migrate wants to stamp it".
  2. `collectDoctor` pushing a `warn` for a ledger with `seed` → the test fails with
     "bootstrap: doctor reports something the plain Product does not".

<!-- yad:tasks -->
## T01 — test that doctor and migrate keep `seed`
**Files:**
- `cli/test.mjs`

**Done when:** R1–R5 hold, the test passes in the full `npm test`, and both mutations above make it fail.
<!-- /yad:tasks -->
