# Spec — EP-reported-gitlab-S04: waive a clean merge of nearby lines in the verified-commits gate

Story: `EP-reported-gitlab-S04` (epic `EP-reported-gitlab`), engine repo. Issue: engine #600.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

The verified-commits gate waives the signature of a merge commit that adds no content of its own. It
decides that with the combined diff (`git diff-tree --cc`), which prints every hunk that differs from
all parents. When both sides of a merge edited nearby lines of one file, git merges them on its own, yet
the combined diff still prints those hunks. So a clean merge made with a platform merge button (GitLab
never signs it) fails the gate although it adds nothing. The same check also waives a conflict resolved
by hand to one side, because the result equals a parent.

## Requirements

- R1. With git 2.36 or newer and a merge of exactly two parents that share a merge base, the gate waives
  an unsigned merge when `git show --remerge-diff` (with `--no-ext-diff --no-textconv
  --ignore-submodules=none --no-relative`) prints nothing. Any output is final: the merge needs a
  verified signature.
- R2. The git version is read from `git --version` in portable bash ("git version 2.39.5 (Apple
  Git-154)" works); a version it cannot read counts as older.
- R3. On older git, when the parents share no merge base (a shallow clone, unrelated histories), when a
  command fails, and for a merge of three or more parents, the gate keeps today's combined-diff check.
  An error never waives a merge.
- R4. A merge that adds its own change (in the merged file, or a submodule pointer even under
  `diff.ignoreSubmodules=all`), or a conflict resolved by hand, fails.
- R5. `checks/verified-commits.sh` stays a byte-for-byte copy of the template.
- R6. The gate's header, `skills/yad-checks/references/check-gates.md` and `docs/GATES.md` describe the
  new rule.

## Out of scope

Signing merge commits on the platform; the signature check itself; how CI fetches history.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

Add `git_has_remerge_diff` (version parse, once per run) and try `--remerge-diff` first inside
`merge_introduces_no_content`, falling back to `--cc`. Copy the template over `checks/verified-commits.sh`.
Tests build real merges in a temp repo with a failing `glab` shim: nearby lines waived; Apple version
string waived; a `git` shim reporting 2.30.0 (and an unreadable version) falls back and fails; an
amended extra change fails; a submodule pointer fails under `diff.ignoreSubmodules=all`; a conflict
resolved to one side fails; a depth-2 clone with no merge base falls back and waives a disjoint merge.

## Tasks

<!-- yad:tasks -->
## T01 — Decide a merge's own content by redoing the merge in the verified-commits gate
**Files:**
- skills/yad-checks/templates/checks/verified-commits.sh
- checks/verified-commits.sh
- cli/test.mjs

## T02 — Describe the redone-merge rule in the gate docs
**Files:**
- skills/yad-checks/references/check-gates.md
- docs/GATES.md
<!-- /yad:tasks -->
