# Spec — EP-engine-reports-S02: git hooks that run in a `yad worktree add` worktree, or a warning

Story: `EP-engine-reports-S02` (epic `EP-engine-reports`), engine repo. Issue: engine #619.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad worktree add` links a code repo's ignored `node_modules` from the main checkout instead of
installing, so npm's `prepare` script never runs in the new worktree. husky v9 points `core.hooksPath`
at `.husky/_`, a folder `prepare` makes and fills with a `.gitignore` of `*`. git resolves a relative
`core.hooksPath` against each worktree's own root, so in the new worktree the folder is missing and every
hook silently does nothing — while yad prints "its git hooks run in the worktree too".

## Requirements

- R1. When a code repo's `core.hooksPath` is relative, stays inside the repo (no `..`, not under `.git`),
  is a real folder in the main checkout reached through no link, git tracks nothing in it and would add
  nothing from it (husky's inner `*` `.gitignore`, or a root ignore line), `yad worktree add` links it into
  the new worktree as it links `node_modules`: only where the worktree has nothing there and the link's
  parent is a plain folder of the worktree; excluded in `info/exclude` under its own mark so a
  `git add -A` never stages it; recorded in the worktree's `links`, so `yad worktree remove` and the add
  rollback take it back (and its exclude pair).
- R2. A tracked, absolute (or `~/`), already-present, linked or escaping `core.hooksPath` gets no link.
- R3. After the add, when a relative `core.hooksPath` folder is not in the worktree, yad warns that the
  hooks will not run there and prints the fix: `cd <worktree> && npx husky` for a `.husky/…` path, else
  `git -C <main> config core.hooksPath <absolute folder>`; when the main checkout lacks it too, it says so.
  It no longer says "its git hooks run in the worktree too" in that case; otherwise that line is unchanged.
- R4. `--dry-run` (and its `--json` `links`) lists the hooks link with the `node_modules` links.
- R5. `docs/CLI.md` describes the hooks link and the warning.

## Out of scope

The Product's own worktree (yad links nothing there today, and the hooks line is for code repos only).
Running a tool's install in the worktree. A `core.hooksPath` set per worktree (`extensions.worktreeConfig`).

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: husky v9's `.husky/_` is not matched by `git check-ignore` (its ignore is a `*` inside it): what counts as ignored? → A: git tracks nothing under it and `git ls-files --others --exclude-standard` lists nothing under it.

## Plan

`hooksLink(main)` reads `core.hooksPath` and returns the folder to link, or null, by the R1 rules. The
add plan appends it to the `node_modules` links and keeps it as `p.hooks`; the shared linker (renamed
`linkFromMain`) checks the link's parent is a plain worktree folder and writes the `#619` exclude mark for
it; `dropExcludeLines` drops either mark. After the add, `deadHooks` checks the worktree on disk and picks
the warning with its fix or the existing info line. Tests build husky's real shape (a relay `_/pre-commit`
calling the tracked `.husky/pre-commit` from `$0`), commit in the worktree and see the hook run, then
cover the tracked, absolute, linked and escaping paths, the warning, dry-run, remove and rollback.

## Tasks

<!-- yad:tasks -->
## T01 — Link husky's ignored hooks folder into a worktree, or warn that its hooks will not run
**Files:**
- cli/worktree.mjs
- cli/test-worktree.mjs
- docs/CLI.md
<!-- /yad:tasks -->
