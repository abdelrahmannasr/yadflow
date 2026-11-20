# Spec — EP-review-followups-S02: the last two plain writes of Product files go through the link-safe helper

Story: `EP-review-followups-S02` (epic `EP-review-followups`), engine repo. Issue: Product #246.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Two places write files inside the Product with plain `fs` instead of `writeFileAtomic` (`cli/lib.mjs`),
the helper that writes a temp file and renames it, and refuses a linked folder between `within` and the file.

- `cli/repo-publish.mjs` puts a code-map pack back after the publish commit with
  `if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf)`. `existsSync` follows a link, so a dangling link at
  that path reads as "no file", and `writeFileSync` then writes the pack's bytes wherever the link points.
- `cli/brain.mjs` `writePlain` writes the `.sdlc/brain/` files (and the `--html` page) by a temp file and a
  rename, but does not refuse a linked folder itself. It relies on every caller checking the folder first.

The plain-write guard in `cli/test.mjs` (`DIRECT_WRITE_ALLOWED`, PR #633) lists both as known exceptions.

## Requirements

- R1. The pack is put back only where nothing stands now, checked with `lstat` (a dangling link counts as
  something there). It is written with `writeFileAtomic(abs, buf, { within: root })`.
- R2. A pack that is not put back (something stands at its path, or a linked folder is on the way) is named:
  a warning says which pack and why, and a hint says how to fix it and that `yad repo refresh` makes the pack
  again. The commit still counts as done (the pack is a cache). Each pack is handled on its own, so one
  refusal never stops the others or replaces the commit's own result.
- R3. `writePlain(dir, name, data, { within })` writes through `writeFileAtomic`. `within` is the Product
  root for the `.sdlc/brain/` files and the page's own folder for the `--html` page. A linked folder on the
  way is refused with YAD-STATE-001, and nothing is written through it.
- R4. `writeOwnFile` (`cli/local-page.mjs`) keeps its `null | problem` answer: a refusal comes back as a
  problem string, not a throw.
- R5. `DIRECT_WRITE_ALLOWED`: the `cli/repo-publish.mjs` entry is removed, and the `cli/brain.mjs` entry
  drops to 1 (`.git/info/exclude`). The guard tests pass.
- R6. Tests: a dangling link at a pack path, and a linked folder on the way to a pack, are not written
  through; a linked `.sdlc/brain/` folder is refused by `writePlain`. Each fails on the old code.

## Out of scope

The pack's read before the commit (`fs.readFileSync`): `packPathspecs` already drops a pack whose path holds
a link. Any other writer.

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Does a dangling link count as "no file"? → A: no. Anything at the path (a file, a folder, a link,
  dangling or not) is left as it is. `writeFileAtomic` would replace a link safely, but yad did not put it
  there, so it is not yad's to remove.
- Q: Warn or fail when a pack is not put back? → A: warn and hand a fix. The commit went through, and the
  pack is a cache that `yad repo refresh` makes again, so the exit code stays 0.
- Q: `within` for the `--html` page? → A: the page's own folder. The walk starts below `within`, so that
  folder itself may be a link the person made; the Product root is still walked when a command set it.

## Plan

`cli/repo-publish.mjs`: a `restorePack(root, held)` function, called per pack from the `finally`. It first
refuses a linked folder on the way (`refuseLinkedWrite`, as `lstat` looks through one), then runs `lstat`; a
plain file there returns; anything else is named; nothing there is written with `writeFileAtomic`,
and a refusal is caught and named (`warn` + `hand`). `held` keeps the pack's relative path for the message.
`cli/brain.mjs`: `writePlain` becomes one `writeFileAtomic` call; its four callers pass `{ within: root }`.
`cli/local-page.mjs`: `writeOwnFile` passes `{ within: dir }` and turns a YAD-STATE-001 into its problem
string. `cli/test.mjs`: one test per change, and the guard entries.

## Tasks

<!-- yad:tasks -->
## T01 — Put a code-map pack back only where nothing stands, through writeFileAtomic
**Files:**
- cli/repo-publish.mjs
- cli/test.mjs

## T02 — Make writePlain refuse a linked folder itself
**Files:**
- cli/brain.mjs
- cli/local-page.mjs
- cli/test.mjs
<!-- /yad:tasks -->
