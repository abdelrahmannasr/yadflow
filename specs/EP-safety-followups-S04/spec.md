# Spec — EP-safety-followups-S04: the agent-guard tests pass on a slow CI runner

Story: `EP-safety-followups-S04` (epic `EP-safety-followups`), engine repo. Issue: Product #234.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

The agent guard refuses any command it cannot judge within `JUDGE_BUDGET_MS` (5 s, `cli/agent-guard.mjs`).
The test "the agent guard lets the rest through" in `cli/test-agents-file.mjs` calls `agentGuardDecision`
in the test's own process, with that real budget. Its longest line (`bash <(case y in y) :;; esac; …)`,
40,000 times) takes about 1.7 s under coverage on a laptop; a CI runner more than three times slower passes
5 s, the line is refused, and the test fails at random (engine PR #609, `test (ubuntu-latest, node 24)`,
passed on re-run). No worker or `GUARD_WALL_MS` is involved. The #492 and #498 tests already avoid this with
a copy of the guard's source rewritten to read `globalThis.YAD_TEST_BUDGET`.

## Requirements

- R1. `cli/agent-guard.mjs` exports `setJudgeBudgetForTests(ms)`: it sets the budget each judgement gets in
  this module instance and returns the budget it replaced; with no value it puts `JUDGE_BUDGET_MS` back.
  `JUDGE_BUDGET_MS` stays the exported constant 5000. No environment variable is read.
- R2. The hook entry ignores the test setting: `yad hook agent-guard` judges in a worker thread, which loads
  its own copy of the module and so always has the real 5 s. A test sets a spent budget in the test thread,
  sees the line refused there, and sees the same line allowed through `judgeInWorker` and through the spawned
  `yad hook agent-guard`. `GUARD_WALL_MS` stays `2 * JUDGE_BUDGET_MS + 2000`.
- R3. The "lets the rest through" test judges its lines with no deadline, so its verdicts do not depend on
  the runner's speed. The budget is put back after it, however it ends.
- R4. The #492 and #498 tests keep timing the guard against its real budget with their slow-runner
  allowance (`within`, `SLOW`); their `uncut` judgements and the #535 budgets use the setter instead of a
  rewritten copy of the source.

## Out of scope

Changing `JUDGE_BUDGET_MS`, `GUARD_WALL_MS` or any reading of the guard. Other test files that call
`agentGuardDecision` with the real budget (`cli/test.mjs`, `cli/test-guide.mjs`, `cli/test-setup-agent.mjs`,
`cli/test-hooks.mjs`). The #492/#498 assertions that expect an exact verdict from the real guard outside
coverage.

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: An exported setter or an environment variable? → A: the setter. A worker thread inherits the environment, so a variable could reach the real hook; module state cannot.
- Q: A larger finite budget, or none, for the "lets the rest through" test? → A: none (`Infinity`), as the existing `uncut` judgements: any finite budget still depends on the runner's speed. The #492/#498 tests still catch a reading that turned slow.

## Plan

A module-level `budgetMs`, set by `setJudgeBudgetForTests`, replaces `JUDGE_BUDGET_MS` in the one line that
sets the deadline. The test file gets a `withBudget(ms, fn)` helper that sets it and puts it back in a
`finally`; the "lets the rest through" test runs inside `withBudget(Infinity, …)`. Two new tests check the
setter and that the hook entry ignores it. Then the source-rewriting `guardCopy` helper becomes
`budgetedGuard`, built on the same setter, and the #535 test sets its budgets through `withBudget`.

## Tasks

<!-- yad:tasks -->
## T01 — Let a test set the guard's budget; judge the "lets the rest through" lines with no deadline
**Files:**
- cli/agent-guard.mjs
- cli/test-agents-file.mjs

## T02 — Build the #492/#498/#535 budgets on the setter, not a rewritten copy of the source
**Files:**
- cli/test-agents-file.mjs
<!-- /yad:tasks -->
