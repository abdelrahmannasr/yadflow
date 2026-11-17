# Spec — EP-reported-fixes-S02: a runnable by-hand hint when the update's PR/MR does not open

Story: `EP-reported-fixes-S02` (epic `EP-reported-fixes`), engine repo. Issue: engine #562 (in part).
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

When `yad update --open-pr` pushes a repo's update branch but its PR/MR does not open, the hint says
"open one from '<head>' into '<base>' by hand" and names neither the folder nor the command. glab and gh
take the project from the git remote of the folder they run in, so a person (or agent) who runs
`glab mr create` from the Product folder opens it against the Product, and GitLab answers 422 "Source
project is not a fork of the target project". That is what the report describes.

## Requirements

- R1. The "did not open" hint gives the command to run and the folder to run it in, relative to the
  Product: `cd <folder> && glab mr create --source-branch <head> --target-branch <base> --fill --yes`
  on GitLab, `cd <folder> && gh pr create --head <head> --base <base> --fill` on GitHub.
- R2. For the Product itself (`.`), the command has no `cd`.
- R3. A folder with characters a shell treats specially is single-quoted for a POSIX shell; Windows
  separators are written as `/`.
- R4. The "no platform is recorded" hint names the folder too.

## Out of scope

Naming the project on every PR/MR call (`glab -R`, `gh --repo`). The first failure's own reason is not in
the report, and a project path with no host can point a self-hosted GitLab at gitlab.com. #562 stays
open until the reporter shares the failure's reason.

## Clarifications

### Session 2026-11-17
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface, no high-risk file; the engine has no risk map)

## Plan

In `cli/update-commit.mjs`, add three small helpers beside `openUpdatePrs`: `folderOf` (the repo's
folder relative to the Product, with `/` separators, `.` for the Product), `shellPath` (POSIX quoting
only when needed) and `byHand` (the command per platform). Use them in the two hints of
`openUpdatePr`. Test with a code repo inside a Product and a creator that fails with the 422.

## Tasks

<!-- yad:tasks -->
## T01 — Name the folder and the exact command in the by-hand hints
**Files:**
- cli/update-commit.mjs
- cli/test-guide.mjs
<!-- /yad:tasks -->
