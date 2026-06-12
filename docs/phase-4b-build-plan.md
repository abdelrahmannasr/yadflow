# Phase 4b — Build Plan (Steps C + D): earn `tasks` and the `implement → check` handoff

> **Status:** **Step D built and earned; Step C hook built, dial gated.** Phase 4a shipped the engine
> (`yad-run`), the trust log, per-story build-state, and earned `checks` (Step B). Phase 4b adds the
> two trust hooks (`spec`, `tasks`), and earns `implement` (Step D — the `implement → check` hand-off)
> by seeding its evidence honestly from the five real ships (diffs merged as authored). `tasks`
> (Step C) has its hook + gate but stays `human_approve`: there is no historical signal to seed it
> from, so it is earned only on genuine runs (never fabricated). Front states and the engineer review
> stay `human_approve` permanently.

## Context

Phase 4a made the `automation` dial real and proved it on the safest step. The orchestrator
`yad-run` already **walks every back step generically** (`spec → tasks → implement → checks`) reading
each step's dial, and `set-dial` can already flip any non-locked back step once its trust slice clears
the threshold. So the *engine* for C and D already exists. What 4b adds is the part 4a deliberately
left out: **the evidence and the per-step trust signal** that let `tasks` and `implement` be earned
honestly — plus the two step-specific behaviours below.

The reason 4b is its own phase (not folded into 4a) is the governing rule: **automation is earned per
step, with evidence.** `checks` had five real runs to point at (the shipped tasks' gate passes).
`tasks` and `implement` advance need their own recorded runs before they can be trusted — and the
trust signal for a step that doesn't emit a pass/fail gate has to be *defined*, which is the core of
this plan.

## The gap 4a left: trust signals for non-`checks` steps

4a's verdict derivation is gate-shaped: `checks FAIL → rejected`, human edited the diff →
`approved-with-edits`, else `approved-unchanged`. That works for `checks` and `implement` (both
produce a diff a human can accept or edit) but not for `spec`/`tasks` (which produce *documents*, not a
gate result). 4b defines the missing signals and, crucially, **where each is captured**.

| Step | Output | `approved-unchanged` | `approved-with-edits` | `rejected` | Captured at |
|------|--------|----------------------|-----------------------|------------|-------------|
| `spec` | `specs/<story>/` (spec/plan/tasks) | human approves the spec untouched | human edits the generated spec before approving | human rejects / re-runs the ceremony | the spec review (reuse `yad-review-gate` on the spec artifact) |
| `tasks` | `tasks.md` (atomic task list) | task list implemented as generated | a task's `Files:`/scope edited before implementing | task list discarded / regenerated | the moment `yad-implement` first consumes a task (the list "survived contact") |
| `implement` | task diff on a branch | merged as authored | engineer edited the diff before merge | scope overrun / contract touch / checks FAIL | the engineer review at `yad-ship` (already records this in 4a) |
| `checks` | gate pass/fail | gates pass | n/a | any gate FAIL | the gate run (4a — done) |

Two new capture points to build: a **spec-review trust hook** and a **tasks-survived-implementation
hook**. `implement`'s signal already exists (the engineer review's confirm/override). This keeps the
human-in-the-loop principle intact: every trust signal is anchored to an existing human gate, never a
machine self-grade.

## Build order (strict — safest end inward, continuing 4a)

### Step C — automate the `tasks` advance
- `tasks` is derived **mechanically from an already-approved plan/spec** (the heavy `yad-spec`
  ceremony ran and was human-approved). Auto-advancing from "spec approved" into "atomic task list
  generated, enter the per-task loop" is low-risk *because the judgement already happened upstream at
  the spec review*.
- **What to build:** the tasks-survived-implementation trust hook (above); accumulate `tasks` runs;
  once the slice clears the threshold, `set-dial step: tasks to: machine_advance` lets `yad-run`
  generate `tasks.md` and advance into the loop without a manual nudge.
- **Halts unchanged:** if the spec is not approved, or the generated task list is empty/ambiguous,
  `yad-run` halts and pulls in a human regardless of dial.

### Step D — automate the `implement → check` handoff
- After `yad-implement` produces a committed task branch, **auto-run the check gates** instead of
  waiting for a human to trigger `yad-checks`. In 4a's loop this is exactly `implement`'s dial being
  `machine_advance` (the loop already continues `implement → checks`); 4b *earns* it.
- **The diff still cannot merge** without the check gates passing AND the engineer review (which stays
  `human_approve`, locked). Step D only removes the manual "now run the gates" nudge.
- **Scope guard stays hard (the central protection):** if the diff grows beyond the task's declared
  files, or touches the contract surface, `yad-implement` halts and `yad-run` blocks — regardless of
  any dial. This is already wired in 4a (`scope_overrun` / `contract_touch` → `rejected` + halt);
  4b must demonstrate it still fires under an automated `implement → checks` run.

### What stays human, permanently (unchanged from 4a)
- The **engineer review before merge** (`engineer-review`, `locked`).
- **All four front states** (`epic`, `architecture`, `ui-design`, `stories`) — never `machine_advance`.
- **Any contract-surface change** routes back to the architecture gate.

## What gets built (small — the engine is already there)

1. **Spec-review trust hook** — when the human accepts (or edits) the generated `specs/<story>/`,
   append a `spec` entry to `trust-log.json` with the derived verdict. Implemented in `yad-spec`
   Step 8 (the spec-acceptance point), so no separate review-gate skill is needed. (Edit:
   `skills/yad-spec/SKILL.md`.)
2. **Tasks-survived hook** — when `yad-implement` first consumes a task from `tasks.md`, append a
   `tasks` entry: `approved-unchanged` if the task's declared `Files:`/scope were used as generated,
   `approved-with-edits` if the human re-scoped it first. (Edit: `skills/yad-implement/SKILL.md`.)
3. **No engine change** — `yad-run`'s loop, `set-dial`, the threshold predicate, the kill switch, and
   the locks all already cover `tasks`/`implement`. Verify, don't rebuild.
4. **Docs** — update `README.md` (earning `tasks`/`implement`), `docs/phase-4-build-plan.md` (mark
   C/D delivered), `RESEARCH-NOTES.md` (Phase 4b decisions), and `state-schema.md` if the trust-log
   `signals` grow a field (e.g. `human_edited_spec`, `task_rescoped`).

## Earning the evidence (the honest part)

- **`implement`** can be seeded like `checks` was: the five real ships in `build-log.json` are diffs
  that merged as authored → five `implement` runs, `approved-unchanged`. That clears the threshold,
  so Step D can be demonstrated immediately and faithfully.
- **`tasks`/`spec`** have **no recorded history** — there is no prior signal to seed from without
  inventing one. These must accrue from real runs under `human_approve` first (or a deliberate,
  labelled backfill review of the existing specs). Do **not** fabricate `tasks`/`spec` evidence to
  unlock Step C; that violates the one principle. Step C ships the hook + the gate, and is *enabled*
  per project only once genuine runs clear the bar.

## Definition of done (Phase 4b)
- `spec` and `tasks` runs are recorded in `trust-log.json` with a defined, human-anchored verdict;
  `yad-status` surfaces them alongside `checks`/`implement`.
- With evidence present, `tasks` (Step C) auto-advances from an approved spec into the per-task loop;
  flipping its dial back restores the manual step — no code change.
- With evidence present, `implement` (Step D) auto-runs the check gates after a committed branch; a
  scope overrun and a contract-surface touch are each shown halting that automated run and pulling in
  a human.
- The engineer review and all four front states are re-verified locked; the kill switch still reverts
  everything in one move.
- No `tasks`/`spec` evidence was fabricated to unlock automation; Step C is enabled only on genuine
  runs that clear the threshold (demonstrated on a project that has earned it, or explicitly left
  `human_approve` with the reason shown in `yad-status`).

## Explicitly NOT in Phase 4b
- No automation of any front state; no removing the engineer review before merge.
- No service/daemon — that remains the conditional Phase 5 (build only when the CLI can't keep up).
- No earning a step on fabricated or borrowed evidence — `tasks`/`spec` accrue their own.
