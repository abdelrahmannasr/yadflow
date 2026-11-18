# Spec — EP-factory-prep-S05: safe JSON reads and a safe npx

Story: `EP-factory-prep-S05` (epic `EP-factory-prep`), engine repo. Issue: Product #2 (E125), part (b).
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Anyone who can commit to the Product controls its files. `readJSON`, `readJSONStrict` and the read inside
`writeJSON` follow links: a committed `.sdlc/repos.json -> /dev/zero` makes yad hang, and a link can make
yad read a file outside the Product. `yad repo refresh` runs `npx repomix` with the registered repo as its
working folder, so npm reads a `.npmrc` committed there, which can point it at another registry whose
"repomix" then runs.

## Requirements

- R1. The JSON helpers check the entry first (`lstat`) and never open a link, folder, device or pipe; the
  file is opened with no-follow and non-blocking flags and checked again.
- R2. `readJSONStrict` refuses such a file with an error naming it (`YAD-STATE-001`, hint
  `git checkout -- <file>`); a dangling link is refused too. `readJSON` returns its fallback and names the
  file once per run. `writeJSON` replaces a link instead of reading it. A missing file behaves as today.
- R3. `packRepo` runs `npx` from a new temporary folder (removed afterwards), with
  `--registry=https://registry.npmjs.org/`, and passes the repo folder and the output file as absolute paths.
  The temp folder holds its own `package.json`, so npm stops there and never reads a `.npmrc` from a shared
  temp folder such as `/tmp`; if it cannot be made, the pack is skipped with a warning.

## Out of scope

Product JSON files read without these helpers (`map-view.mjs`, `brand-cmd.mjs`, `owners.mjs`,
`claims.mjs`, `issues-write.mjs`, parts of `doctor.mjs`, `build.mjs`, `product-index.mjs`, `migrate.mjs`),
and the `npx repomix` lines in the `yad-connect-repos` and `yad-backfill` skills. Listed as follow-ups.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface; the engine has no risk map)
- Q: repomix sorts files by git history in its working folder — keep the repo as the working folder? → A: no; a temp folder keeps npm from reading the repo's `.npmrc`, and repomix reads its `repomix.config.*` from the working folder. The pack's file order changes; its git log section does not.

## Plan

`readPlainFile` in `cli/lib.mjs`, used by the three helpers. `DEFAULT_REGISTRY` exported from
`cli/update-notice.mjs`; `packRepo` in `cli/setup.mjs` uses it with a temp working folder. Tests in
`cli/test.mjs`; the link tests skip on Windows.

## Tasks

<!-- yad:tasks -->
## T01 — Refuse a link or non-plain file in the JSON read and write helpers
**Files:**
- cli/lib.mjs
- cli/test.mjs

## T02 — Run repomix from an empty temp folder with the npm registry named
**Files:**
- cli/setup.mjs
- cli/update-notice.mjs
- cli/test.mjs
<!-- /yad:tasks -->
