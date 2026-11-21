# Spec — EP-story-retire-S02: yad migrate --apply checks each file from the Product's own folder

Story: `EP-story-retire-S02` (epic `EP-story-retire`), engine repo. Issue: Product #251.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad migrate --apply` (`cli/migrate.mjs`) reads and writes its per-file rows with the plain-read and safe-write
helpers (`readPlainFile`, `readPlainJSON`, `readPlainBytes`, `writeFileAtomic`, `writeJSON` in `cli/lib.mjs`),
but passes no `within`. A linked folder on the way is then refused only when the global Product root
(`setProductRoot`) is set. The CLI sets it, but a caller that does not (a test, a future command) reads a row
through a linked `epics/` and writes its backup and its new bytes into the folder the link points at.

## Requirements

- R1. Every per-file write in `cli/migrate.mjs` passes `within: root` (the Product's folder): the drift repair
  (`settleDrift`, both writes), `.gitignore` (`ensureBackupsIgnored`), each row's backup, its partner's backup
  and its rewrite (`runMigrate`), and the product-level move's relabel and reshape writes (`applyProductMove`).
- R2. Every read those writes depend on passes the same `within`: `readRaw` (the plan's and the apply's row
  read, and the product-level move's ledger reads), `describeDrift`, `bytesOrNull`, `checkDrift`'s parse check,
  the backup reads, and the move's `plainJSON`. So with no Product root set, a row under a linked `epics/` is an
  `unreadable` row naming the folder (the run fails, exit 1), the same answer the CLI gives with the root set.
- R3. The mirrored product config is written by `writeProductConfig`, which takes no `within`: both of its names
  are checked with `refuseLinkedWrite(path, root)` before it is called.
- R4. A folder made a link after the row was read is refused at the write (YAD-STATE-001), and nothing is
  written where the link points.
- R5. The plain-write guard (`DIRECT_WRITE_ALLOWED` in `cli/test.mjs`) is unchanged: no plain write is added.

## Out of scope

- `rmTree` and its calls in `applyProductMove` (story S03).
- `writeState` (`cli/epic-state.mjs`), called once by `applyProductMove`: it takes no `within`, and
  `linkedMoveFolder` checks that exact path from `root` at the top of `applyProductMove`.
- `cpMerge` and `readJSON` (`cli/lib.mjs`), which take no `within`.
- `refreshIndexAfterWrite` / `writeIndex` (`cli/product-index.mjs`), which writes `.sdlc/index.json` with no
  `within`: another module.

## Clarifications

### Session 2026-11-21
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Pass `within` on the reads too, not only the writes? → A: yes. With writes only, a static linked `epics/`
  and no Product root would throw YAD-STATE-001 out of `runMigrate` part way through the rows; with the reads
  too, the row is `unreadable` before anything is written, as the CLI already says.
- Q: Change `writeProductConfig` in `cli/lib.mjs` to take `within`? → A: no. Its two names are checked in
  `cli/migrate.mjs` before the call, which keeps `cli/lib.mjs` out of this story.

## Plan

`cli/migrate.mjs`: `readRaw(file, root)`, `describeDrift(a, b, root)` and `bytesOrNull(abs, root)` take the
Product's folder; every read and write listed in R1–R2 passes `{ within: root }`; the mirrored write checks
both names first (R3). `cli/test-migrate.mjs`, beside the #248 tests: a static linked `epics/` with no Product
root (R2), and an `epics/` swapped for a link between the row's read and its write, through the `migrations`
seam (R4). Both are skipped on Windows (`LINK_SKIP`).

## Tasks

<!-- yad:tasks -->
## T01 — Check every migrate --apply read and write from the Product's own folder
**Files:**
- cli/migrate.mjs
- cli/test-migrate.mjs
<!-- /yad:tasks -->
