# Phase 4 — Build Plan

> **Status:** Split into **4a** (Steps A + B) and **4b** (Steps C + D). **4a + Step D are built;
> Step C is gated.** The `automation` dial is read by the orchestrator `sdlc-run`; every run is
> recorded in `.sdlc/trust-log.json`; back-half state lives in `.sdlc/build-state/<story>.json`. Earned
> and demonstrated: `checks` (Step B) and `implement` → checks hand-off (Step D), each with 5 runs at
> 100% approved-unchanged. `tasks` (Step C) and `spec` have their dials + trust hooks but stay
> `human_approve` — they have no historical evidence to seed from and are earned only on genuine runs
> (never fabricated). The kill switch + front-state/engineer-review locks are enforced throughout. See
> `docs/phase-4b-build-plan.md`. The most dangerous phase is taken one earned step at a time.

Builds on Phases 0–3 (research; module + gate; full front half; full build half shipping real code through check gates, reviews, multi-repo, and backfill).

Phase 4 is **automation**: letting the machine advance some steps on its own, while humans stay in control of the decisions that matter. This is the most dangerous phase. Up to now a human pressed the button at every gate, so a mistake was always caught by a person. Automation removes that person from some steps — so the entire design here is about **earning** each piece of automation with evidence, never granting it by default.

Same rules throughout: tools via their real interface, all state in files, git as source of truth, and — the rule that governs this whole phase — **automate end-first, never the front states**.

---

## Goal of Phase 4

Turn the second dial (`automation`) from `human_approve` to `machine_advance` on the **safe, mechanical back steps only**, one step at a time, each gated by recorded evidence that the AI is trustworthy on this codebase for that step. The front states (epic, architecture, UI, stories) stay `human_approve` permanently in this version.

End state: the back of the pipeline (e.g. tasks → implement → checks) can run unattended for a story, halting only when a check fails or when it reaches a step still set to `human_approve`. The human is pulled in for decisions and exceptions, not for every routine advance.

---

## The one principle that governs everything here

**Automation is earned per step, with evidence, and is reversible in one move.**

- A step is only switched to `machine_advance` after it has run enough times under `human_approve` that you have data showing the AI's output at that step is reliable.
- Every automated step must be instantly reversible: flipping the dial back to `human_approve` is one config change, no code change, no migration.
- The order of automation runs from the **safest end inward**. Never jump ahead.

---

## Build order (strict — do not reorder)

### Step A — Make the dial real and measurable (before automating anything)   — Phase 4a ✅
- The `automation` dial already exists as config (Phase 1). Now make flipping it actually change engine behavior: when a step is `machine_advance`, the engine advances it without waiting for a human approval file.
- Build a small **trust log**: for each step, record every run — what the AI produced, whether the human approved it unchanged, approved with edits, or rejected. This is the evidence base for deciding when a step is safe to automate.
- Build nothing automated yet. First just measure. A step becomes a candidate for automation only after its trust log shows a high rate of "approved unchanged" over a real number of runs.

### Step B — Automate the safest step first: the check gates' *advance*   — Phase 4a ✅
- The check gates (build/test/lint/spec-link/contract-check) are already objective pass/fail — no judgment. The automation here is simply: on all-pass, advance automatically to the next step instead of waiting for a human to click through.
- A failing check still halts and pulls in a human. Nothing about *what* is checked changes — only that a clean pass no longer needs a manual nudge.
- This is the safest possible first automation: the gate's decision was never human judgment to begin with.

### Step C — Automate `tasks` generation advance   — Phase 4b (hook built; dial gated on evidence)
- Once a story's plan is approved (a front-ish step, stays human), generating the atomic task list and advancing into the per-task loop can become `machine_advance`, because it is derived mechanically from an already-approved plan.
- Trust log must support it first.

### Step D — Automate the `implement` → check handoff   — Phase 4b ✅
- After `dev` produces a diff, automatically run it into the check gates rather than waiting for a human to trigger them.
- The diff still cannot merge without the check gates passing AND the engineer review (Step E stays human in this version).
- Scope guard stays hard: if the diff grows beyond the task's declared files, halt and pull in a human regardless of dial settings.

### Step E — What stays human, permanently in this version
- **Engineer review before merge** stays `human_approve`. AI review (CodeRabbit) remains advisory and never becomes the authority to merge.
- **All four front states** (epic, architecture+contract, UI, stories) stay `human_approve` and remain locked against `machine_advance`. This is the core protection of the whole system — the engineer stays the author of the high-level decisions.
- **Any contract-surface change** always routes back to a human at the architecture gate, regardless of automation elsewhere.

---

## Safety mechanisms (build these alongside the automation)

- **Kill switch.** One command sets every step back to `human_approve` system-wide. If anything feels wrong, the whole pipeline reverts to fully manual instantly.
- **Per-project, per-step dials.** Automation is set per project and per step, not globally. A mature project can automate more; a fragile or newly-onboarded one stays manual. Existing projects just brought in via backfill start fully manual.
- **Halt-and-escalate beats guess.** Any automated step that hits ambiguity, a failing check, a scope overrun, or a contract-surface touch must halt and pull in a human, not proceed on a guess.
- **The trust log is visible.** `sdlc-status` shows, per step, its dial setting and its recent trust record, so the team can see *why* a step is automated and reverse it with evidence.

---

## Explicitly NOT in Phase 4

- **No automation of any front state.** Not now, not in this version. Heavy AI assistance at the front is fine; auto-advancing the front is forbidden.
- **No removing the engineer review before merge.**
- **No service/daemon yet** — automation runs within the existing CLI + harness + CI. The unattended-service layer is Phase 5, built only if the CLI genuinely can't keep up.
- **No automating a step without trust-log evidence.** "It seems fine" is not evidence.

---

## Definition of done

**Phase 4a (Steps A + B) — done:**
- The `automation` dial actually changes engine behavior; flipping a step to `machine_advance` makes it advance without a human, and flipping it back restores the manual gate — with no code change.
- A trust log records every step's runs and is surfaced in `sdlc-status`.
- The check-gate advance (Step B) runs automatically on clean pass, halts on failure — demonstrated both ways.
- The four front states (and the engineer review) are verified locked to `human_approve`; an attempt to set one to `machine_advance` is refused, as is flipping a back step whose trust evidence is short.
- Kill switch works: one command returns the whole system to manual, demonstrated.
- A scope overrun and a contract-surface touch are each shown halting an otherwise-automated run and pulling in a human.
- `README.md` updated: how to read the trust log, how to earn automation for a step, how to use the kill switch.

**Phase 4b Step D — done:**
- The `implement → check` hand-off runs `machine_advance` on a project that has earned it (`implement` trust slice clears the threshold — 5 runs, 100% unchanged, seeded honestly from the real ships), demonstrated on the demo story; a scope overrun and a contract-surface touch are each shown halting the otherwise-automated run.
- `spec` and `tasks` trust hooks record a defined, human-anchored verdict, surfaced in `sdlc-status`.

**Phase 4b Step C — gated (hook built, dial not flipped):**
- `tasks` advance is built into the engine and its trust hook records evidence, but the dial stays `human_approve` until genuine `tasks`/`spec` runs clear the threshold — no evidence was fabricated to unlock it. It is enabled per project only on real runs (or left manual with the reason shown in `sdlc-status`).

---

## Then Phase 5 (preview, do not build unless needed)

The optional service layer: a small, rebuildable read-index and/or a daemon that can watch repos and run earned-automation steps unattended (e.g. overnight), plus a read-only dashboard across features and projects. Built ONLY when the CLI genuinely can't keep up — and even then, git stays the source of truth and the service stays a rebuildable layer on top, never the system of record. Add it when a real bottleneck is measured, not before.

The full trigger-gated build plan — its three independently-shipped parts, what must be **measured** before each is built, the hard rules they inherit, and the instrumentation already shipped in `sdlc-status` so the decision is data-driven — is `docs/phase-5-build-plan.md`.
