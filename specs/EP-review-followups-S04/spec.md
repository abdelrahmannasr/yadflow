# Spec — EP-review-followups-S04: a delete of a team file refuses a linked folder, as a write does

Story: `EP-review-followups-S04` (epic `EP-review-followups`), engine repo. Issue: Product #248.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Engine PR #627 made every yad write refuse a linked folder: `writeFileAtomic(p, data, { within })` and
`refuseLinkedWrite(p, within)` (`cli/lib.mjs`) walk each folder from the Product's folder (`setProductRoot`)
and from `within` down to the file, and stop with YAD-STATE-001 at the first one that is a link. Deletes were
not covered. Outside `cli/lib.mjs` about 47 `rmSync` / `unlinkSync` / `rmdirSync` calls delete by a plain
path. A path that passes through a folder committed as a link (for example `hooks/` or
`epics/EP-x/reviews`) makes such a delete remove files outside the Product or the code repo.

## Requirements

- R1. `cli/lib.mjs` has two delete helpers:
  - `removeFile(p, { within, force = true })` deletes one file (`rmSync`; a folder is refused by `rmSync`
    itself, `ERR_FS_EISDIR`).
  - `removeDir(p, { within, emptyOnly = false })` deletes a folder and all it holds, or with `emptyOnly`
    only an empty folder (`rmdirSync`, ENOTEMPTY otherwise).
  - Both refuse a path under a linked folder with the same check and error as `refuseLinkedWrite`: the
    Product-root walk when `setProductRoot` is set, the `within` walk, YAD-STATE-001, the same `folder` and
    `kind`, and the same fix (`LINKED_FOLDER_FIX`). The message says "did not delete" where a write says
    "did not write".
  - A link AT the path itself is removed as a link: `rmSync` and `rmdirSync` never follow the last link, so
    what it points at stays. A test proves it for a link to a file and a link to a folder.
- R2. Every delete of a team file (a Product file, a code-repo file) moves to the helpers, passing the same
  `within` as the write next to it. Deletes in yad's own temp folders (mkdtemp), the git folder, the reports
  folder beside the checkout, a temp file yad just made with a fresh name, a lock folder yad made with an
  exclusive mkdir, and a link yad made itself may stay plain.
- R3. A guard test in `cli/test.mjs`, modelled on the plain-write guard (`DIRECT_WRITE_ALLOWED`): it fails a
  new `rmSync` / `unlinkSync` / `rmdirSync` call outside `cli/lib.mjs`. A counted allowlist
  (`DIRECT_DELETE_ALLOWED`) has one reason per entry; each entry has a reason, names a file that exists, and
  has a count above 0. A self-test covers the matcher. The failure names the file:line and the helper to use.
- R4. A behaviour test: with `hooks/` in the Product committed as a link, the hook scripts that
  `yad check --fix` unwires (`orphanCaptureHookActions`, `orphanHookActions` in `cli/plan.mjs`) are refused
  on apply, and nothing where the link points is removed. It runs once with the Product root set and once
  with `within` only. It fails on the old code. It is skipped on Windows (`E125B_SKIP`).

## Out of scope

- `rmTree` (`cli/lib.mjs`) and its callers in `cli/migrate.mjs`, `fs.rm`, `fs.unlink` and `fs.promises.rm`:
  the guard does not see these shapes, and the guard's comment says so.
- A plan-time "refused" row for a removal under a linked folder. The planner's convention for a write or a
  rename is such a row (`writesNothing` + `refused`, from `linkedOnTheWay` or `wiredFileState`), which
  `yad check --fix` and setup warn about and step past. Here a refused removal throws YAD-STATE-001 from its
  action's `apply`, so the run stops at it, with the actions before it already applied. Nothing is deleted
  through the link either way; a refused row for removals is a follow-up.
- Any write, and any refactor beyond the deletes.

## Clarifications

### Session 2026-11-21
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Extend `rmTree`? → A: no. `rmTree` opens read-only folders for `cli/migrate.mjs`; it stays as it is.
  The new helpers sit beside it.
- Q: The same message as a write? → A: the same check, code, `folder`, `kind` and fix; the verb is
  "delete" (`… is a link, so yad did not delete <file> (it deletes a file there only through real folders)`).
- Q: An empty-folder delete after a file (`owners.mjs`, `checkpoint.mjs`)? → A: `removeDir(…, { emptyOnly: true })`,
  so a folder that still holds other files is never removed. Its refusal is caught with the ENOTEMPTY it
  sits beside, which is fine: the file delete before it has already checked the same folders.
- Q: The Product copy `yad run-checks` writes into a code repo? → A: kept plain. `readRecord` refuses a link
  on the way before the copy is made, and the delete removes only what this run made.

## Plan

`cli/lib.mjs`: `refuseLinkedWrite` becomes one line over a private `refuseLinked(p, within, verb)`; the two
helpers call it with `'delete'`. Each call site below is moved or kept.

| File | Moved to the helpers | Kept plain (reason) |
|---|---|---|
| `cli/plan.mjs` | 11: the keep-own side folder, legacy skill renames (2), removed skills (2), legacy wired-file rename, orphan hook scripts, orphan git hooks, capture script, activity script, retired hook script | 1: the local setup notice copy in the git folder |
| `cli/ledger.mjs` | 1: folded log entries | 2: the lock folder (exclusive mkdir, empty-only rmdir) |
| `cli/owners.mjs` | 2: the owner file, then its folder (empty only) | — |
| `cli/checkpoint.mjs` | 2: the dry-run shard, then its folder (empty only) | — |
| `cli/build.mjs` | 1: the build-state file put back | — |
| `cli/skip.mjs` | 1: the build-state file of an un-skip | — |
| `cli/members.mjs` | 1: the member file | 2: mkdtemp folders |
| `cli/brain.mjs` | 1: `.sdlc/brain/repos/<repo>/files.txt` | — |
| `cli/repo-publish.mjs` | 1: a tracked pack removed for the publish commit | — |
| `cli/run-checks.mjs` | — | 6: mkdtemp scratch (4); the Product copy this run made, its path checked for links (2) |
| `cli/setup.mjs` | — | 3: the mkdtemp Repomix folder (2); `placeFile`'s fresh temp file (1) |
| `cli/worktree.mjs` | — | 3: links yad made itself, removed as links |
| `cli/reports-dir.mjs` | — | 7: the reports folder (yad's own output) |
| `cli/capture.mjs`, `cli/epic-state.mjs`, `cli/fold.mjs` | — | 1 each: mkdtemp folders |

`cli/test.mjs`: the helpers' unit test, the behaviour test, and the guard.

## Tasks

<!-- yad:tasks -->
## T01 — Add removeFile and removeDir, which refuse a linked folder on the way
**Files:**
- cli/lib.mjs
- cli/test.mjs

## T02 — Delete the team files yad check --fix removes through the helpers
**Files:**
- cli/plan.mjs
- cli/test.mjs

## T03 — Delete ledger entries, owner files and dry-run shards through the helpers
**Files:**
- cli/ledger.mjs
- cli/owners.mjs
- cli/checkpoint.mjs

## T04 — Delete build-state and member files through the helpers
**Files:**
- cli/build.mjs
- cli/skip.mjs
- cli/members.mjs

## T05 — Delete the brain file list and the publish-time packs through the helpers
**Files:**
- cli/brain.mjs
- cli/repo-publish.mjs

## T06 — Guard: a plain delete outside cli/lib.mjs fails unless it is listed with its reason
**Files:**
- cli/test.mjs
<!-- /yad:tasks -->
