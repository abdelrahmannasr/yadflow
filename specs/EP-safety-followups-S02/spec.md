# Spec — EP-safety-followups-S02: a test fails when new engine code writes a file with plain fs

Story: `EP-safety-followups-S02` (epic `EP-safety-followups`), engine repo. Issue: Product #235 (part 2).
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

A file in the Product or a code repo is the team's: anyone who can commit there can put a link where yad
writes, and a plain `fs.writeFileSync` follows that link. Engine PR #627 moved the team-file writers to the
safe helpers in `cli/lib.mjs` (`writeFileAtomic`, `writeJSON`, `copyFile`, `copyDir`), which refuse a linked
folder. Nothing stops new code from going back to a plain write, so the rule can wear away.

## Requirements

- R1. A guard test in `cli/test.mjs` walks the engine sources with the read guards' own walk
  (`engineSources()`: `cli/` and its subfolders, no tests, fixtures or `vendor/`) and finds every
  `writeFileSync(`, `appendFileSync(`, `renameSync(` and `copyFileSync(` call, as `fs.x(`, `nodeFs.x(` or a
  bare `x(`, outside `cli/lib.mjs`. A comment line is not counted.
- R2. A short allowlist names each file that may keep such calls, with one reason and an expected `count`.
  Every call is counted, two on one line count twice, so a new write in a listed file fails too. The
  allowlist covers only files that are not the team's: yad's own temp folders, the git folder (the capture
  cache, `info/exclude`), the reports folder, `--out` paths the person names, the engine's own assets, and
  link-safe temp-and-rename or guarded rename spots, and a restore of bytes yad itself just removed, only
  where no file is now.
- R3. The failure message names the file and line, and says to use `writeFileAtomic` / `writeJSON` /
  `copyFile` from `cli/lib.mjs`. This holds for a write in an unlisted file and for a count that grew in a
  listed one.
- R4. A self-test runs the matcher over sample lines: each plain shape is seen, the safe helpers are not.

## Out of scope

Changing any writer. `scripts/` and `bin/` (the read guards' walk does not cover them; `bin/` has no plain
writes, `scripts/` has two maintainer-only writes). Async and stream shapes (`fs.promises.writeFile`,
`fs.writeFile`, `createWriteStream`) and a write reached through another name: review catches those.

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Scan `scripts/` too? → A: no. Follow the read guards' walk exactly (`engineSources()`, `cli/` only).
- Q: Count lines or calls? → A: calls. Several writes share one line in places (a temp write and its rename).
- Q: `cli/plan.mjs` renames a person's own files in a team folder; change it? → A: no. Both paths are refused
  by `refuseLinkedWrite` before the first move (#235), and a rename moves a link, never writes through it.
  It is listed with that reason.

## Plan

Next to the two read guards in `cli/test.mjs`: a global regex `DIRECT_WRITE`, a `writeCalls(line)` helper
that counts matches on a non-comment line, and `DIRECT_WRITE_ALLOWED` with `{ file, count, reason }`. One test
checks the matcher on sample lines; one walks `engineSources()`, skips `cli/lib.mjs`, collects each hit as
`file:line: text`, fails on an unlisted file, and checks each entry's count, printing its hit lines.

## Tasks

<!-- yad:tasks -->
## T01 — Add the plain-write guard test and its allowlist
**Files:**
- cli/test.mjs

## T02 — Make the guard's reasons and entry checks exact (review fixes)
**Files:**
- cli/test.mjs
<!-- /yad:tasks -->
