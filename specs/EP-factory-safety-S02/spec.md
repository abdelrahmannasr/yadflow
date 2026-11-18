# Spec — EP-factory-safety-S02: read migrate, IDE settings and local-setup files only as plain files

Story: `EP-factory-safety-S02` (epic `EP-factory-safety`), engine repo. Issue: Product #212, part 2.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

S01 moved the Product's state files onto the plain reads in `cli/lib.mjs`. Other Product files are
still read with `fs.readFileSync`: the files `yad migrate` converts, the IDE settings files committed in
the Product (`.claude/settings.json` and the others), `.sdlc/local-setup.json`, the design source of
`yad brand`, and the two names of the Product config that every command compares. A committed link
there (to `/dev/zero`, or to a file outside the Product) can hang yad, or make it read or rewrite a file
it never owned. Nothing stops new code from adding such a read again.

## Requirements

- R1. `yad migrate` reads each file once, as a plain file. A missing or broken file keeps its answer and
  its roll-back; a link or non-regular file is named as one and never rewritten, and the files are still
  compared as written.
- R2. The IDE settings files committed in the Product are read as plain files by setup's plan and apply,
  doctor, reconcile and detect (project scope only; files in the home folder still follow links). A link,
  a dangling link or a folder is reported and never rewritten.
- R3. `.sdlc/local-setup.json` is read as a plain file; a file with a byte-order mark still works.
- R4. The CI member check refuses a `product.json` or `hub.json` that is a link or not a regular file,
  with its own `lstat` (the template cannot import the engine).
- R5. `yad brand` reads its design source only when it is a plain file (a pipe answers at once).
- R6. The check that compares `.sdlc/product.json` with its old name `.sdlc/hub.json` on every command
  counts a link or non-regular file as "different", so the command refuses (YAD-STATE-008) instead of
  hanging. yad writes both as plain copies, so a Product yad set up is not affected.
- R7. A test fails when code in `cli/` parses `readFileSync` output directly, except a listed set of files
  that are not the Product's, each with its count and reason.

## Out of scope

A size limit on JSON reads (#215) and a linked `.sdlc` folder (#214). Files that are not the Product's:
the git-folder caches (capture, members, local-setup answers, worktree records), a code repo's Spec Kit
file, the map's side file in the reports folder, the engine's own files, a file the user names.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

Swap each read for `readPlainFile` / `readPlainJSON` / `readPlainBytes`, keeping each site's answer for a
missing or broken file. Tests put a link, a dangling link, a folder and a link to `/dev/zero` in place of
each file, the last in a child process with a time limit. The guard test scans `cli/*.mjs` with an
allowlist and checks its own matcher on sample lines.

## Tasks

<!-- yad:tasks -->
## T01 — Read the files yad migrate converts only as plain files
**Files:**
- cli/migrate.mjs
- cli/test-migrate.mjs

## T02 — Read the IDE settings files only as plain files in setup's plan and apply
**Files:**
- cli/plan.mjs
- cli/test-hooks.mjs

## T03 — Read the project's IDE settings only as plain files in detect
**Files:**
- cli/detect.mjs
- cli/test-detect.mjs

## T04 — Name a linked IDE settings file in doctor
**Files:**
- cli/doctor.mjs
- cli/test-hooks.mjs

## T05 — Read shared settings text only as a plain file in reconcile
**Files:**
- cli/reconcile.mjs
- cli/test-guide.mjs

## T06 — Read local-setup.json only as a plain file
**Files:**
- cli/local-setup.mjs
- cli/test-local-setup.mjs

## T07 — Refuse a linked Product config in the CI member check
**Files:**
- skills/yad-checks/templates/checks/member-check.mjs
- cli/test-members.mjs

## T08 — Read the brand's design source only as a plain file
**Files:**
- cli/brand-cmd.mjs
- cli/doctor.mjs
- cli/test-brand.mjs

## T09 — Count a linked Product config name as different instead of hanging
**Files:**
- cli/manifest.mjs
- cli/test.mjs

## T10 — Fail a test when new code parses a file read directly
**Files:**
- cli/test.mjs
<!-- /yad:tasks -->
