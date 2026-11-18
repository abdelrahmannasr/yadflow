# Spec — EP-factory-hardening-S01: refuse a Product file larger than any real one before reading it

Story: `EP-factory-hardening-S01` (epic `EP-factory-hardening`), engine repo. Issue: Product #215.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

The plain reads in `cli/lib.mjs` (`readPlainFile`, `readPlainBytes`, `readPlainJSON`, and `readJSON` /
`readJSONStrict` through them) refuse a link, a folder or a device, but read a plain file of any size.
Anyone who can commit to the Product can commit a file of hundreds of megabytes (a `.sdlc/repos.json`, an
IDE settings file, the local setup script), and every command that reads it loads it whole into memory:
slow at best, out of memory at worst. Only `cli/detect.mjs` has a size limit, of its own.

## Requirements

- R1. The plain reads refuse a file larger than 64 MiB, checked on the open handle (`fstat`) before any
  byte is read. A file of exactly 64 MiB is still read.
- R2. The refusal has its own error code, `YAD_FILE_TOO_BIG` (exported as `FILE_TOO_BIG`), and a message
  that names the file and the limit. The words after the name are exported (`TOO_BIG_SAID`), so a caller
  that knows the file's path inside the Product names it by that path, never by an absolute one.
- R3. `readJSON` returns the caller's fallback and names the file once per run, with a fix that fits (git
  holds no smaller copy to restore); `readJSONStrict` throws `YAD-STATE-001` named like a link is.
- R4. Each caller gives the answer it gives for a broken file. A caller that refused only a link, and threw
  anything else, now refuses a too-big file the same way: IDE settings (setup's plan, the old hook script
  check, reconcile's shared text), migrate (its rows, its 7 -> 8 move, its drift words, `.gitignore`) and the
  local setup script. A too-big file is never read as a missing one, which would write a new file over the
  team's. Readers that say why a file was not read (usage, history, the index, owner and member files) say
  it in words, not by the bare code.
- R5. The limit is one exported constant, `MAX_PLAIN_BYTES`, also used by `cli/detect.mjs` for its config
  files. Its 1 MiB limit for a skill or agent file stays. It lives in `cli/manifest.mjs` (which `cli/lib.mjs`
  imports and re-exports), so `mirrorDrift` there uses it too: two names whose sizes differ, or a name over
  the limit, are drift without a read of either file.
- R6. The read never trusts the size `fstat` gave: it reads into a buffer of at most the limit plus one byte,
  so a file that grew after the check is refused, not read to its end.
- R7. Each plain read takes an optional `{ max }`. The brain's code graph and file list, which Graphify
  generates and which grow with the code, are read up to 256 MiB (`BRAIN_GRAPH_MAX_BYTES`), and a graph
  that is refused is named with the reason, never as one Graphify did not write.

## Out of scope

A linked `.sdlc` or epic folder (S02, #214), and the committed CI and gate files still read with
`readFileSync` (S03, #222). The AGENTS.md / CLAUDE.md rules block reads with `readFileSync` and has no limit
yet (S03 owns those reads). The CI member check template has its own reads. Naming the file by its Product
path inside `cli/lib.mjs` itself: the lib does not know the Product's folder until S02; its message keeps
the path the caller passed, as the link message does.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: 64 MiB, the same as detect's config limit? → A: yes; the same reads load Markdown, `.gitignore`, the local setup script and migrate's backups, so the limit is generous on purpose.

## Plan

Add the constant, the code and the check in `readPlainOrThrow`, then route the new code at each caller that
branched on `NOT_PLAIN_FILE` or printed the raw error. Tests make a sparse file one byte over the limit (it
takes no room on disk) and check each helper refuses it with the new code, a file of exactly the limit is
read, and `yad repo list --json` names a 100 MiB `.sdlc/repos.json` with the limit and no absolute path.
Each caller's test checks its broken-file answer and that the file is left as it is.

## Tasks

<!-- yad:tasks -->
## T01 — Refuse a plain file over 64 MiB before reading it, with one limit detect shares
**Files:**
- cli/lib.mjs
- cli/detect.mjs
- cli/test.mjs

## T02 — Refuse a too-big IDE settings file like one that does not parse
**Files:**
- cli/plan.mjs
- cli/reconcile.mjs
- cli/test-hooks.mjs

## T03 — Name a too-big file in yad migrate by its Product path
**Files:**
- cli/migrate.mjs
- cli/test-migrate.mjs

## T04 — Never rebuild a too-big local setup script as a missing one
**Files:**
- cli/local-setup.mjs
- cli/test-local-setup.mjs

## T05 — Say "too big" in words in history and usage
**Files:**
- cli/history.mjs
- cli/usage.mjs
- cli/test.mjs

## T06 — Say "too big" in words for the index and owner files
**Files:**
- cli/product-index.mjs
- cli/owners.mjs
- cli/test.mjs

## T07 — Say "too big" in words for a member file
**Files:**
- cli/members.mjs
- cli/test-members.mjs

## T08 — Name the size limit in the error table
**Files:**
- docs/CLI.md

## T09 — Read code graphs up to their own, larger limit, and name a refused one truthfully
**Files:**
- cli/product-index.mjs
- cli/brain.mjs
- cli/test-brain.mjs
<!-- /yad:tasks -->
