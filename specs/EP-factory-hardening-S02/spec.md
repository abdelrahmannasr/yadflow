# Spec — EP-factory-hardening-S02: never read or write a Product file through a linked folder

Story: `EP-factory-hardening-S02` (epic `EP-factory-hardening`), engine repo. Issue: Product #214.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

The plain reads in `cli/lib.mjs` (`readPlainFile`, `readPlainBytes`, `readPlainJSON`, and `readJSON` /
`readJSONStrict` through them) and the writes (`writeJSON`, `writeFileAtomic`) refuse a link at the file's
own name only. A folder above the file is followed. Anyone who can commit to the Product can commit
`.sdlc`, `epics/`, an epic's folder or `.sdlc/build-state/` as a link, and yad then reads and writes the
files there, outside the Product, under the Product's names. `yad risk-map` reads and writes a code repo's
`.sdlc/risk-map` with raw `fs` calls, so it follows a link at the file too. And the lib names a refused file
by the path its caller passed, which can be absolute and lands in the `warnings` of `yad doctor --json`.

## Requirements

- R1. For a path inside the Product, the plain reads and `writeJSON` / `writeFileAtomic` check each folder
  between the Product's folder and the file with `lstat`. When one is a link, they refuse with the
  `NOT_PLAIN_FILE` error (`kind: 'link'`, `folder`), whose message names the linked folder and the file by
  their paths in the Product. A read checks before its first look, so a linked folder never reads as "no
  file". A write checks before any folder is made, and refuses with `YAD-STATE-001` and a hint, keeping
  `kind` and `folder`; `copyFile` and `copyDir` check their destination the same way. The hint says to
  remove the link (`git rm <folder>`) and restore the real folder from a commit where it was one: a plain
  `git checkout -- <folder>` brings the committed link back. Callers that name the file themselves (migrate,
  doctor, the local setup script, setup's IDE settings) name the linked folder too.
- R2. The Product's folder is set once per command (`setProductRoot`), where yad settles it: every Product
  and repo command in `bin/yad.mjs` (the Product found, never a `--dir` subfolder), `yad setup`,
  `yad toolbox`, and inside `yad new`, `init` and `join` (`cli/workspace.mjs`). Both spellings of the
  folder count (`/var/…` and `/private/var/…` on macOS), and on macOS and Windows a spelling in another case
  is the same folder. A path outside the Product is read as before. Where the folder of a Product that
  already exists is set, a `.sdlc` that is itself a link stops the command with `YAD-STATE-001`: the
  settings in it say whether the Product is verified, and a lenient read would run it as an unverified one.
  `join`'s registry problem keeps its words when the lib names the file by its Product path.
- R3. Each read and write takes `{ within }`, a folder checked as well as the Product's. `yad risk-map`
  reads and writes `.sdlc/risk-map` through the helpers, within the code repo: a map that is a link, too
  big, or in a linked `.sdlc` is not read, `draft` exits 1 with nothing written, and `check` and
  `yad doctor` name it as `unreadable`. The map is written through a new file and a rename.
- R4. With the Product's folder known, the lib names a file inside it by its path there in every message
  (link, too big, cannot read, does not parse), so no absolute path reaches `--json` warnings. `readJSON`
  names a linked folder once per run, not once for each file under it.
- R5. A Product with no linked folders works exactly as before. Folders are checked on every read and write
  (a few microseconds each), never cached: yad can swap a folder mid-command (a `git checkout`).

## Out of scope

The editor hooks (`yad hook …`, `yad capture --hook`) and `yad signing check` set no Product folder. The
ledger guard reads the Product's settings to decide whether to block an edit, and a settings file it cannot
read counts as "not verified", which lets the edit through: refusing that read would loosen the guard. The
capture hook writes only its cache in the git folder (`yad-capture.json`). `yad signing check` only reads.
Reads and writes with raw `fs` calls (S03 owns the committed CI and gate files). A link swapped in between
the check and the open (the file's own name keeps its O_NOFOLLOW check).

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: A code repo kept inside the Product's folder, reached through a link? → A: refused like any linked folder in the Product, with no exemption from `.sdlc/repos.json` (it is committed, so anyone could claim one); `{ within }` adds the repo's folder to the Product's, never replaces it.
- Q: A linked `.claude/` or `.cursor/` folder in the Product? → A: refused like any linked folder in the Product.

## Plan

Add the root, the `lstat` walk and the Product-relative names in `cli/lib.mjs`, and set the root where each
command settles the Product. Tests link `.sdlc`, `epics/` and `epics/EP-x/.sdlc/build-state/` to a folder
outside the Product and check every read and write refuses, naming the folder, with the folder left as it
was; that a normal Product, a Product reached through a link and a path outside the Product work as
before; that `yad doctor --json` names a 100 MiB `.sdlc/repos.json` without the temp folder's path; that
`yad epic new` under a linked `epics/` and `yad init` through a linked `.sdlc` stop and write nothing; and
that `yad risk-map draft` refuses a linked `.sdlc` and a linked map in the code repo.

## Tasks

<!-- yad:tasks -->
## T01 — Refuse a file under a linked folder of the Product, and name it by its Product path
**Files:**
- cli/lib.mjs
- cli/test.mjs

## T02 — Set the Product's folder once per command, in yad and in yad new, init and join
**Files:**
- bin/yad.mjs
- cli/workspace.mjs
- cli/test.mjs

## T03 — Read and write the risk map through the plain helpers, in the repo's own folders
**Files:**
- cli/riskmap-command.mjs
- cli/test.mjs

## T04 — Name a linked folder in the error table and the risk map's draft
**Files:**
- docs/CLI.md

## T05 — Stop a command on a linked .sdlc, and keep published in a refused refresh
**Files:**
- bin/yad.mjs
- cli/workspace.mjs
- cli/repo.mjs

## T06 — Name the linked folder in migrate, doctor and setup's messages
**Files:**
- cli/migrate.mjs
- cli/doctor.mjs
- cli/plan.mjs

## T07 — Name the linked folder in local-setup's messages and hint
**Files:**
- cli/local-setup.mjs
<!-- /yad:tasks -->
