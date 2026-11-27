# Spec — EP-foundation-first-epic-S03: `yad repo features`

Story: `EP-foundation-first-epic-S03` (epic `EP-foundation-first-epic`), engine repo. Issue: engine #694.
Contract: the locked `contract.md` of the epic. This story implements the API row `yad repo features` and
the data-model row `FeatureBoundary`. It does not depend on S01 or S02.

## Problem

A pack epic brings an existing codebase into yadflow, one story per feature. Nothing lists a codebase's
features: the code map's module list is prose, and `yad-backfill` takes one feature at a time. A large repo
can have hundreds of folders, so the list needs a cap to stay reviewable.

## Requirements

- **R1.** `yad repo features [<repo>] [--max <n>] [--json]` lists, for each connected repo in
  `.sdlc/repos.json` (or only `<repo>`), a row `{ repo, head, behind, features, problem? }`. `--json` is
  `{ ok, repos: [...] }`. An unknown `<repo>` is refused (exit 1). The Product itself, if registered, is
  not listed.
- **R2.** It reads the files committed at `HEAD` (`git ls-tree -r -z --name-only HEAD`), never the working
  tree or the index. Lines come from the same commit (`git grep -I -c -z -e '' HEAD`), text files only.
- **R3.** Boundaries: when any tracked file is under `src/`, `lib/`, `packages/` or `apps/`, the
  boundaries are their subfolders (`<container>/<x>/**`, named `x`; a file directly in a container is the
  container's own boundary, `<container>/*`), and other top-level folders are not feature roots. Otherwise
  the top-level folders (`<x>/**`). Left out everywhere: top-level files; hidden folders; folders named
  for tests, docs, build output or dependencies; `*.test.*`, `*.spec.*`, `*_test.go` files. Two boundaries
  with one name are named by their path. With no boundary at all, one row `(top level)` holds the
  top-level files.
- **R4.** Rows are sorted by lines, then files, then name. `--max` defaults to 25 and takes a whole number
  from 1 to 200 (anything else is refused). Past it, the first `max - 1` rows stay and the rest become one
  `other` row, last: its `paths` are theirs, `files` and `lines` their sums, `grouped` their count.
- **R5.** `head` is the short SHA. `behind` is `git rev-list --count HEAD..refs/remotes/origin/<default>`,
  where `<default>` is the registry's `default_branch` (checked as a branch name), else `origin/HEAD`, else
  `main`; `null` when that ref does not exist. No fetch, no network.
- **R6.** A repo with no local clone, a refused path, or no commit is a row with `problem`, `head` and
  `behind` null and `features` empty. The other repos are still listed, and the exit code is 0.
- **R7.** Nothing is written, in the Product or the clone.
- **R8.** The printed lines follow `ui-design.md` §3: a header `<repo>  <sha>  (tracked files at HEAD)`, a
  `!` line `<n> commits behind origin/<default> — pull to list the latest` when behind, one `•` row per
  boundary (name, files, lines, paths; the `other` row gives its groups instead of paths), and a closing
  `→ a starting list: rename, merge or split these before the pack epic's stories are written`. A problem
  row is a `!` line.
- **R9.** `bin/yad.mjs` usage and `docs/CLI.md` name the command.

## Non-goals

- Refreshing a code map, fetching, or pulling.
- Writing the pack epic or its stories (S05, the skills).

## Clarifications

- **Q1. A binary file** counts in `files`, not in `lines`.
- **Q3. Which files decide that containers are used.** Only files that count (R3's leave-outs applied): a repo
  whose only `src/` files are tests uses its top-level folders, not `(top level)`.
- **Q4. What git reads.** A submodule (a `commit` entry in the tree) is not a file. The person's own git
  settings that would change the output (`color.*`, `grep.fullName`) are switched off for these reads, and a
  git error while counting lines is a `problem`, never "0 lines".
- **Q5. Names from the repo** (folder names, paths) are cleaned for the terminal in the text output; `--json`
  keeps them as they are.
- **Q2. A repo kept inside another checkout** (`apps/web` in the Product's own repo) is read from its own
  folder, so its paths are relative to it.

## Tasks

<!-- yad:tasks -->
## T01 — `yad repo features`
**Files:**
- `cli/repo-features.mjs`
- `cli/repo.mjs`
- `cli/argv-flags.mjs`
- `bin/yad.mjs`
- `cli/test.mjs`
- `docs/CLI.md`

**Done when:** R1–R9 hold. The tests in `cli/test.mjs` run against real git repos: a monorepo with
`packages/` and `apps/`, a flat repo with uncommitted changes, the cap and the `--max` refusals, a missing
clone, an empty repo, an unknown name, and a clone behind its remote. They fail when the leave-out filter is
dropped, or when the index is read instead of `HEAD`.
<!-- /yad:tasks -->
