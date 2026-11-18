# Spec — EP-reported-gitlab-S02: read the Product's default branch in a local run with no record

Story: `EP-reported-gitlab-S02` (epic `EP-reported-gitlab`), engine repo. Issue: engine #597, part 2.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad run checks` writes the Product clone's `origin/<default_branch>` to the path that
`.sdlc/product-link.json` on the base names, so the four Product-reading gates (contract-check,
lineage-check, epic-open, reconcile-debt) read what CI reads. When nothing can be written there — no
record on the base, a record with no `git_url`, or a Product clone without that branch — the gates
follow `product-repo` in a `link.md`, which points at the Product's main folder. When that folder is on
another branch, the gates report "orphan story link" for a story that exists on the default branch,
while CI (which reaches no Product and defers) passes. They also read unmerged edits there.

## Requirements

- R1. When no copy can go where CI puts the Product (no record on the base, no `git_url` in it, or no
  copy written there) and no folder is already there, `yad run checks` writes the found Product clone's
  default branch to a temp folder of its own, outside the repo, and removes it after the four gates.
  With a recorded `default_branch` the clone lacks, the clone's `origin/HEAD` branch is read, with a note.
- R2. The run passes that folder to those four gates only, in `YAD_LOCAL_PRODUCT`, and never passes on a
  value from the shell.
- R3. Where the four gates would read an untracked folder on disk that `product-repo` (or the record)
  reaches, they read `YAD_LOCAL_PRODUCT` instead, only when it is a folder and none of `CI`,
  `GITHUB_ACTIONS`, `GITLAB_CI` is set, with a note. A value that reaches nothing, no `product-repo`, or a
  Product kept on the base is answered as before, so a FAIL CI gives still fails here. In CI nothing
  changes.
- R4. The Product clone's branch, index and files are never touched, and its unmerged edits are never read.
- R5. Nothing changes with no Product clone, a Product kept in the same git repo, a record that fails
  product-checkout, or a folder already at the record's path.
- R6. `--json` marks the copy with `product.local: true`.

## Out of scope

A folder already at the record's path (it is read as it is, as documented). The repo's
`.sdlc/managed.json` hashes of its own `checks/` copies (already stale before this story).

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

One identical patch in `product_for`, inside the block the four gates share byte for byte: at the point
where it reads an untracked folder on disk, swap `prod` for `YAD_LOCAL_PRODUCT` outside CI.
In `cli/run-checks.mjs`, split the private-index write out of `placeProduct` (`writeCommit`), add
`placeLocal`, call it when nothing was placed and nothing was already there, and pass the variable in a
per-gate env. The repo's own `checks/` copies are refreshed to match the templates. The shared-block test
in `cli/test-checks.mjs` fails between T01 and T02, so those two are committed back to back.

## Tasks

<!-- yad:tasks -->
## T01 — Read YAD_LOCAL_PRODUCT outside CI in lineage-check, epic-open and reconcile-debt
**Files:**
- skills/yad-checks/templates/checks/lineage-check.sh
- skills/yad-checks/templates/checks/epic-open.sh
- skills/yad-checks/templates/checks/reconcile-debt-check.sh

## T02 — Read YAD_LOCAL_PRODUCT outside CI in contract-check, with tests for the four gates
**Files:**
- skills/yad-checks/templates/checks/contract-check.sh
- cli/test-checks.mjs

## T03 — Refresh this repo's own lineage-check, epic-open and reconcile-debt copies
**Files:**
- checks/lineage-check.sh
- checks/epic-open.sh
- checks/reconcile-debt-check.sh

## T04 — Refresh this repo's own contract-check copy
**Files:**
- checks/contract-check.sh

## T05 — Write the Product's default branch to a temp folder when nothing can go where CI puts it
**Files:**
- cli/run-checks.mjs
- cli/test-run-checks.mjs

## T06 — Document the local Product copy
**Files:**
- docs/CLI.md
- docs/GATES.md
- skills/yad-checks/references/check-gates.md
<!-- /yad:tasks -->
