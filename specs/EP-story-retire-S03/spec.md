# Spec — EP-story-retire-S03: rmTree refuses a linked folder, and the delete guard counts its calls

Story: `EP-story-retire-S03` (epic `EP-story-retire`), engine repo. Issue: Product #252.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`rmTree` (`cli/lib.mjs`) deletes a whole folder tree, read-only folders too, and checks no link. Its only
callers today are in `applyProductMove` (`cli/migrate.mjs`), which refuses a linked folder before its first
copy (`linkedMoveFolder`). The delete guard test in `cli/test.mjs` (`DIRECT_DELETE_ALLOWED`) counts plain
`rmSync` / `unlinkSync` / `rmdirSync` calls but not `rmTree(`, so a new `rmTree` call anywhere else would pass
the guard and could delete through a linked folder into files outside the Product.

## Requirements

- R1. `rmTree(p, { within })` refuses, before deleting anything, a path under a linked folder: the same walk
  and the same YAD-STATE-001 ("did not delete", with the `git rm <folder>` way out) as `removeDir`, from the
  Product's folder and from `within`. A link AT the path is removed as the link, as `removeDir` does, and what
  it points at stays. Without `within` it checks nothing, as before.
- R2. Every `rmTree` call in `applyProductMove` passes `within: root`, so a folder that became a link after
  `linkedMoveFolder` is not deleted through.
- R3. The delete guard's matcher also counts an `rmTree(` call that has no `within` after it on the same line.
  No file needs an allowlist entry for it today. The matcher self-test covers counted and uncounted shapes.

## Out of scope

- `cpMerge` (`cli/lib.mjs`), which copies and takes no `within`.
- The three `readJSON` reads in `cli/migrate.mjs` that take no `within` (noted in the S02 review).
- A cleanup in `applyProductMove`'s failure path that is refused (a folder made a link mid-run) now throws that
  refusal instead of the original error; the move stops either way and deletes nothing through the link.

## Clarifications

### Session 2026-11-21
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Refuse a link at `p` itself? → A: no, as `removeDir`: `lstat` sees the link, and `rmSync` removes the link,
  never what it points at. Only the folders on the way are checked, and only at the top call (the walk below
  never follows a link).
- Q: Count every `rmTree(` call, or only the ones without `within`? → A: only those without `within`: a call with
  it is as safe as `removeDir`, so it needs no allowlist entry.

## Plan

`cli/lib.mjs`: `rmTree(p, { within } = {})` calls the delete check (`refuseLinked(p, within, 'delete')`) when
`within` is given. `cli/migrate.mjs`: the four calls pass `{ within: root }`, comments updated. `cli/test.mjs`:
a `#252` test beside the `#248` `removeDir` test; the guard regex gains `\brmTree\((?![^\n]*\bwithin\b)`, its
comment and the self-test lines change. The comment in `cli/test-migrate.mjs` above the #248 move test is updated.

## Tasks

<!-- yad:tasks -->
## T01 — rmTree refuses a linked folder with within, and the delete guard counts its calls
**Files:**
- cli/lib.mjs
- cli/migrate.mjs
- cli/test.mjs

## T02 — docs: say rmTree takes within in the #248 migrate test comment
**Files:**
- cli/test-migrate.mjs
<!-- /yad:tasks -->
