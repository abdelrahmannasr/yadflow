# Spec — EP-reported-fixes-S01: no spec-link warning on exempt commit types

Story: `EP-reported-fixes-S01` (epic `EP-reported-fixes`), engine repo. Issue: Product #186.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad commit` warns "no Task trailer … spec-link gate will fail on a code repo" for every commit type.
The spec-link gate exempts `ci`, `chore`, `build`, `test` and `docs` commits (`EXEMPT=` in
`checks/spec-link.sh`), so for those types the warning names a failure that cannot happen.

## Requirements

- R1. A commit whose type is `ci`, `chore`, `build`, `test` or `docs` and has no `Task:` trailer prints
  no spec-link warning, in a code repo or on the Product.
- R2. Every other type (`feat`, `fix`, `refactor`, `perf`, `revert`) with no trailer still warns, with the
  code-repo wording in a code repo and the Product wording on the Product.
- R3. The CLI's exempt list and the gate's `EXEMPT=` list are held equal by a test.

## Clarifications

### Session 2026-11-17
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface, no high-risk file; the engine has no risk map)

## Plan

Add `SPEC_LINK_EXEMPT_TYPES` beside `COMMIT_TYPES` in `cli/manifest.mjs`, and skip the warning in
`cli/commit.mjs` when `opts.type` is on it. `opts.type` is always a bare type there: `buildCommitMessage`
refuses anything not in `COMMIT_TYPES`, and `yad ship` reaches the same code through `runCommit`.
Extend the existing stage-aware warning test, and add a drift test that reads `EXEMPT=` from the gate.

## Tasks

<!-- yad:tasks -->
## T01 — Skip the warning for the gate's exempt types
**Files:**
- cli/manifest.mjs
- cli/commit.mjs
- cli/test.mjs

## T02 — Hold the CLI's exempt list equal to the gate's
**Files:**
- cli/test-checks.mjs
<!-- /yad:tasks -->
