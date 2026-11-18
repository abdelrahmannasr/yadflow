# Spec — EP-factory-safety-S01: read the Product's state files only as plain files

Story: `EP-factory-safety-S01` (epic `EP-factory-safety`), engine repo. Issue: Product #212, part 1.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

PR #590 made `readJSON`, `readJSONStrict` and `writeJSON` refuse a Product JSON file that is a link or
not a regular file. About a dozen commands still read Product state files with `fs.readFileSync`, so a
committed link (`.sdlc/repos.json -> /dev/zero`) can hang `yad brain`, the live map or `yad update`, or
make yad read a file outside the Product.

## Requirements

- R1. `cli/lib.mjs` exports `readPlainFile` and `NOT_PLAIN_FILE`, and adds `readPlainJSON` (the parsed
  file as written, no `schemaVersion` stamp; missing, not plain and broken each throw their own error)
  and `readPlainBytes` (raw bytes, for the Product index's hash).
- R2. These read Product files only as plain files: owners (owner files, epic state), members, the
  Product index and brain inputs, the live map and `yad update` (`repos.json`, `product.json`),
  history, usage, the issues approvals check, brand (product name), guide (committed version) and
  doctor's mirrored-pair check.
- R3. Each keeps its answer for a missing or broken file. A link or non-regular file gets the answer a
  broken file gets, with a reason that names it; a link to `/dev/zero` answers at once.

## Out of scope

`yad migrate`, the IDE settings files, `local-setup.json`, the CI member check and the guard test are
S02. Files that are not the Product's (the git-folder capture cache, a code repo's Spec Kit file, the
reports folder, the engine's own files) are left as they are.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

Swap each read for the helper that keeps its answers (`readJSON` where any error gave a fallback,
`readPlainJSON` / `readPlainBytes` where the caller tells missing from broken). Tests put a link, a
folder and a link to `/dev/zero` in place of each file, the last in a child process with a time limit.

## Tasks

<!-- yad:tasks -->
## T01 — Add plain JSON and byte reads that refuse links
**Files:**
- cli/lib.mjs
- cli/test.mjs

## T02 — Read owner files and epic state only as plain files
**Files:**
- cli/owners.mjs
- cli/test.mjs

## T03 — Read member files only as plain files
**Files:**
- cli/members.mjs
- cli/test-members.mjs

## T04 — Read the Product index inputs and the live map's registry only as plain files
**Files:**
- cli/product-index.mjs
- cli/map-view.mjs
- cli/test.mjs

## T05 — Read history and usage ledgers only as plain files
**Files:**
- cli/history.mjs
- cli/usage.mjs
- cli/test.mjs

## T06 — Read the registry and Product config only as plain files in yad update
**Files:**
- cli/update-commit.mjs
- cli/test.mjs

## T07 — Count a linked approvals.json as records in the issues check
**Files:**
- cli/issues-write.mjs
- cli/test-issues-write.mjs

## T08 — Read the product name, the committed version and the mirror shape only as plain files
**Files:**
- cli/brand-cmd.mjs
- cli/guide.mjs
- cli/doctor.mjs

## T09 — Cover the guide, brand and doctor reads
**Files:**
- cli/test.mjs
<!-- /yad:tasks -->
