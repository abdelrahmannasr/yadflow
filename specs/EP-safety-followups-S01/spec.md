# Spec — EP-safety-followups-S01: every yad write refuses a linked folder

Story: `EP-safety-followups-S01` (epic `EP-safety-followups`), engine repo. Issue: Product #235 (part 1).
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

A linked folder is a folder in the Product (or in a code repo) that is a symbolic link to somewhere else.
Engine PR #620 (EP-factory-hardening S02, #214) made the `cli/lib.mjs` helpers — the plain reads,
`writeFileAtomic`, `writeJSON`, `copyFile` and `copyDir` — refuse a Product file under a linked folder. Some
writers still use plain `fs` calls and follow the link: the status line in story and epic files, the gate's
review comment and approval records, the stub `epic.md` that `yad issues` writes, and a few setup files. And
the writes into a code repo name no `within` folder, so a link inside a code repo kept beside the Product is
never checked. An automated Build run with no person watching could write outside the Product.

## Requirements

- R1. The status-line rewrite (`setFrontmatterStatus`, `setBuildStatus`, `lowerFrontmatterStatus` in
  `cli/artifact-status.mjs`) and the lane and story restore of `yad build done` go through `writeFileAtomic`.
- R2. The gate's review comments record and approval record (`cli/gate.mjs`) go through `writeFileAtomic`, with
  no `mkdirSync` first, so no folder is made through a link.
- R3. The stub `epic.md` that `yad epic new --issue` makes goes through `writeFileAtomic` (`writeStubEpic`).
- R4. Every write `cli/plan.mjs` makes for an action rooted in a folder passes that folder as `within` (wired
  files, skill copies, `.claude/settings.json` and the other agent settings, `AGENTS.md`/`CLAUDE.md` blocks,
  `.sdlc/managed.json`, `.sdlc/product-link.json`), and the matching reads do too, so a linked folder in a code
  repo shows as a refused row before anything is applied. `copyFile` and `copyDir` take `within`. The kept-files
  move of `yad update --open-pr` is refused before its first rename.
- R5. The other Product and team files written with plain `fs` move to the helpers: the Product's `.gitignore`
  (`ensurePackIgnored`, `ensureBackupsIgnored`), `.sdlc/brain/.gitignore`, the Pages workflow, the doc site's
  brand files, a code repo's `.coderabbit.yaml` and `.gitmessage`, and the toolbox skill sections.
- R6. A refused write is a YAD-STATE-001 with the same message shape and hint as the helpers give today
  ("<folder> is a link, so yad did not write <file> …"; hint: remove the link, restore the real folder, run the
  command again), and nothing is written where the link points.
- R7. A write that succeeds keeps the file's bytes (line endings, trailing newline) and, for a rewrite in place,
  its mode (`writeFileAtomic`'s new `keepMode` option).

- R8. A write whose refusal would leave a run half applied is checked before the first change: a code repo's
  linked `.sdlc` stops the repo plan at the ledger read and makes `product-link.json` a refused row; a legacy
  rename under a linked folder is a refused row before the old copy is removed; `yad build ship` checks the
  story file before the ship record; gate sync checks `reviews/` before the ledger; `yad sync-status` checks every
  file of an epic before the first rewrite; the doc-site brand checks its three files before the first write.

## Out of scope

Deletes through a linked folder (`fs.rmSync` in `cli/plan.mjs`). Reads that still use plain `fs` before a write
that is now refused. Writes left on plain `fs` on purpose — temp folders, the git folder (`info/exclude`, the
members access cache, git hooks), the reports folder with its own lock, a path the person names with `--out`,
the engine's own `skills/` synced by `scripts/agent-guide.mjs` and `scripts/brain-skills.mjs`, writers that
already do their own link-safe temp-and-rename (`brain.mjs` `writePlain`, `setup.mjs` `placeFile`), and the
pack restore in `repo-publish.mjs`. S02 turns that list into a guard-test allowlist.

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Which folder is `within` for a plan action? → A: the action's own `root`: the Product's folder or the code repo's. Passing the Product's folder again adds no check and changes nothing.
- Q: A story file made read-only can now be rewritten (a rename replaces it). Is that a change to keep? → A: yes; it is how every `writeFileAtomic` write already behaves. The test that used a read-only file to make the write fail uses a read-only folder instead.

## Plan

`lib.mjs` gives `copyFile` and `copyDir` a `within` option, exports `refuseLinkedWrite` for a writer that moves
files itself, and gives `writeFileAtomic` a `keepMode` option that keeps the mode of the plain file already
there. `plan.mjs` passes each action's `root` as `within` to its reads and writes, and drops the `mkdirSync`
before the settings write. Then each plain-`fs` writer moves to `writeFileAtomic` (or `copyFile`), with
`keepMode` where it rewrites a file in place and `within` where it writes into a code repo. Tests next to the
#214 tests link `epics/`, `epics/EP-x/stories`, `epics/EP-x/reviews`, an epic folder, and a code repo's
`checks/` and `.sdlc/`, and check each write is refused and the link's target is untouched.

## Tasks

<!-- yad:tasks -->
## T01 — Let the write helpers check a code repo's own folders, and pass the repo's folder as within in plan
**Files:**
- cli/lib.mjs
- cli/plan.mjs
- cli/test.mjs

## T02 — Write the story and epic status line through writeFileAtomic
**Files:**
- cli/artifact-status.mjs
- cli/test-build.mjs
- cli/test.mjs

## T03 — Write the gate's review records and the build done restore through writeFileAtomic
**Files:**
- cli/gate.mjs
- cli/build.mjs
- cli/test.mjs

## T04 — Write the stub epic.md of yad issues through writeFileAtomic
**Files:**
- cli/issues-write.mjs
- cli/test.mjs

## T05 — Write the Product's .gitignore files and a repo's .coderabbit.yaml through writeFileAtomic
**Files:**
- cli/setup.mjs
- cli/migrate.mjs
- cli/brain.mjs

## T06 — Write the Pages workflow, the doc site brand files and .gitmessage through the helpers
**Files:**
- cli/docs.mjs
- cli/docs-brand.mjs
- cli/commit.mjs

## T07 — Write the toolbox skill sections through writeFileAtomic, and say so in the docs
**Files:**
- cli/toolbox.mjs
- docs/CLI.md

## T08 — Refuse a code repo's linked .sdlc at plan time: its ledger read and product-link.json
**Files:**
- cli/lib.mjs
- cli/plan.mjs
- cli/test.mjs

## T09 — Make a legacy rename under a linked folder a refused row, and name the linked folder in a rules-block refusal
**Files:**
- cli/plan.mjs
- cli/test.mjs

## T10 — Check the story, reviews/ and the doc-site brand files before the first write in build ship, gate sync and docs brand
**Files:**
- cli/build.mjs
- cli/gate.mjs
- cli/docs-brand.mjs

## T11 — Check every file of an epic before sync-status rewrites the first, and test applyKeepingOwn and keepMode
**Files:**
- cli/artifact-status.mjs
- cli/test.mjs

## T12 — Skip the read-only-folder build done test on Windows
**Files:**
- cli/test-build.mjs
<!-- /yad:tasks -->
