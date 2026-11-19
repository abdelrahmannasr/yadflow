# Spec — EP-factory-hardening-S04: keep control and invisible characters out of the risk map and the setup output

Story: `EP-factory-hardening-S04` (epic `EP-factory-hardening`), engine repo. Issue: Product #216.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad risk-map draft` writes a line for every folder nothing covers. `validDir` refuses a space, a tab,
CR, LF and `#*?[\`, but a folder name that holds an escape (ESC), a bell (BEL), DEL, a C1 control or a
bidi control passes, and is written into the committed `.sdlc/risk-map`. Every tool that later shows the
map meets that name raw. `yad setup` and `yad init` also print repo names and paths raw in several places
(a found folder, its prompt, a registered repo, a refused path, the files wired into a repo), and
`yad risk-map` echoes an unknown repo name raw. A name like that can move the cursor, change the window
title or reorder what a line shows.

## Requirements

- R1. `yad risk-map draft` never writes a folder whose name holds a C0 control, DEL, a C1 control, or an
  invisible character `forTerminal` replaces. Such a folder is listed as one it could not write; the
  terminal line shows it cleaned and `--json` keeps the raw name. One shared predicate in `cli/lib.mjs`
  (`changedForTerminal`) says which names those are, so the two lists cannot drift.
- R2. `validDir`, `dirToAdd` and the `uncovered` finding are unchanged: each has an awk twin in
  `checks/risk-map-check.sh` that a parity test holds equal, and the check reads a hand-written line the
  same way in both.
- R2b. A flagged folder below the top level is covered by its deepest parent folder with a clean name:
  `yad risk-map draft` adds that parent's line when it has none, and still lists the flagged folder as not
  added. The risk-map reference tells an agent never to hand-write such a name.
- R3. The repo names and paths `yad setup` prints go through `forTerminal`: a found folder (its prompt,
  `registered`, the greenfield note), a repo named by `--add-repo` or typed in, a path refused before git
  runs, an unknown platform, and each file wired into a repo. A name inside a command to copy uses `asArg`.
  The registry keeps the raw values.
- R4. `yad init` prints a Product folder it found (and the repos it found) through `forTerminal`, in every
  line, also with a single Product; the `cd` hint to copy names `<the Product folder>` when the name is not
  a plain folder name.
- R5. `yad risk-map`'s "unknown repo" line cleans the name it echoes.

## Out of scope

Refusing such a name when a person writes it into the map by hand (the check reads it as the awk twin
does). The skipped-repo lines, already cleaned since engine #591. Text the person types at a prompt that is
used as a default value (it is kept as typed).

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

`validDir` is twinned in awk, which cannot match C1 or Unicode characters the same way in every locale,
so the draft filters on top of it rather than changing it. Move the character test inside `forTerminal` into a small function and export `changedForTerminal` beside
it. `draftRiskMap` writes a folder only when `validDir` accepts it and `changedForTerminal` does not; the
rest go to `unwritable`, which the command already prints cleaned. Wrap each raw print in `setup.mjs` and
`workspace.mjs` in `forTerminal` (`shown`). Tests: a pure draft test with ESC, BEL, DEL, a C1 control, a
bidi control and a line separator; a CLI test that drafts a repo holding a folder with an escape (cleaned
on screen, raw in `--json`, absent from the map) and echoes an unknown repo; a setup test with a found
folder holding an escape; an init test with a Product folder holding one.

## Tasks

<!-- yad:tasks -->
## T01 — Never write a folder name holding a control or invisible character into the risk map
**Files:**
- cli/lib.mjs
- cli/riskmap.mjs
- cli/test.mjs

## T02 — Name such a folder cleaned in yad risk-map draft, and clean the unknown-repo echo
**Files:**
- cli/riskmap-command.mjs
- cli/test.mjs
- docs/CLI.md

## T03 — Print repo names and paths cleaned in yad setup
**Files:**
- cli/setup.mjs
- cli/test.mjs

## T04 — Print a found Product folder name cleaned in yad init
**Files:**
- cli/workspace.mjs
- cli/test.mjs

## T05 — Cover a flagged nested folder by its clean parent's line
**Files:**
- cli/riskmap.mjs
- cli/test.mjs
- cli/test-checks.mjs

## T06 — Say how such folders are covered, and never to hand-write them
**Files:**
- docs/CLI.md
- skills/yad-connect-repos/references/risk-map.md
<!-- /yad:tasks -->
