# Phase 5 — Build Plan (preview, trigger-gated): the optional service layer

> **Status: PREVIEW — do not build.** This document exists so the team knows *what* Phase 5 would be
> and, more importantly, *what must be measured before a single line of it is written*. Phase 5 is the
> only forward item after Phase 4; by its own rule it is built **only when a real bottleneck is
> measured**, not because it would be nice. Until the trigger below fires, the answer to "should we
> build Phase 5?" is **no**.

## Context

Phases 0–4 deliver a complete, file-driven, gated SDLC that a team runs by hand (and, for earned back
steps, with the `sdlc-run` orchestrator). Everything lives in git: `.sdlc/state.json`,
`approvals.json`, `build-state/`, `trust-log.json`, `build-log.json`, the contract lock, the specs in
each code repo. **Git is the system of record.** That is the whole safety model — anyone can read the
truth from files, and nothing is hidden in a database or a service.

Phase 5 is the *optional* layer that sits **on top** of that truth: a rebuildable read-index and/or a
small daemon that runs **already-earned** automation unattended, plus a read-only dashboard across
features and projects. It changes nothing about who decides what — it only removes manual *fetching*
and *nudging* once those have been proven safe. The single inviolable rule: **the service is a
cache and a trigger, never the source of truth; delete it and `git` reconstructs it exactly.**

## The trigger — what must be MEASURED first (the gate on this whole phase)

Do not build Phase 5 until the CLI + harness genuinely can't keep up, shown with numbers from the data
Phase 4 already records. Concretely, build only when **two or more** of these are measured and
sustained over a few weeks:

- **Scale of read:** status/trust questions span enough epics/projects that answering "what is
  waiting, where, and why" by reading files no longer fits in a person's head or a single
  `sdlc-status` run (rough order: >~10 active epics or >~3 code repos per epic).
- **Nudge cost:** humans spend meaningful time manually triggering steps that are **already earned to
  `machine_advance`** — i.e. the automation is approved but still hand-started. Instrument this: count
  earned-step advances that waited on a human and the wall-clock they waited.
- **Idle automation value:** earned steps could safely run overnight/off-hours (e.g. a clean
  `implement → checks` hand-off) but don't, because no one is at the CLI. Measure the backlog that
  accrues outside working hours.
- **Cross-project blindness:** the team repeatedly needs one view across projects (which the per-epic
  files can't give at a glance) and is hand-assembling it.

If fewer than two fire, the CLI is keeping up — **do not build.** Record the measurement in
`RESEARCH-NOTES.md` (a "Phase 5 trigger" section) the day it fires, the same way every other phase
recorded its ground truth.

## What Phase 5 would be (only once triggered)

Three pieces, smallest-first; build only the one(s) the measurement justifies:

1. **Read-index (rebuildable cache).** A derived index over all `.sdlc/` files + `build-log.json` +
   `trust-log.json` across epics/projects, for fast cross-cutting queries (what's at which gate, which
   steps are earned, trust trends). **Pure projection** — built by scanning git, never written to by
   hand, reconstructable in one command. If it disagrees with the files, the files win and the index
   is rebuilt.
2. **Watcher daemon (runs earned automation unattended).** A small process that watches repos and,
   when a story reaches a step **already earned to `machine_advance`**, invokes the *same* `sdlc-run`
   the human would — no new decision logic. It is a scheduler for already-approved automation, nothing
   more. It **cannot** advance a `human_approve` step, a `locked` step, a front state, or the engineer
   review; it halts-and-escalates (notifies a human) on any failing check, scope overrun, or
   contract-surface touch, exactly as the CLI does today.
3. **Read-only dashboard.** A view across features/projects: gates waiting, trust records, kill-switch
   state, recent ships. **Read-only** — every write still goes through the skills/gates and lands in
   git. The dashboard renders the read-index; it has no authority.

## Hard rules (inherited from Phases 1–4, non-negotiable)

- **Git stays the source of truth.** The service is a rebuildable layer; deleting it loses nothing.
  No state originates in the service.
- **No new authority.** The daemon runs only steps already earned via the trust log; the dashboard is
  read-only. Phase 5 adds *convenience*, never *decisions*.
- **Front states and the engineer review stay `human_approve`, permanently.** A daemon does not change
  this — it would refuse them exactly as `sdlc-run` does.
- **Kill switch still global and instant.** One command (or a dashboard toggle that writes the same
  `config.yaml` line) reverts everything to manual, daemon included.
- **Halt-and-escalate beats guess, with a human in the loop.** Unattended runs that hit ambiguity, a
  failing check, a scope overrun, or a contract touch **stop and notify a human** — they never proceed
  on a guess just because no one is watching.
- **Earned, with evidence.** The daemon automates a step on a project only if that project's trust log
  earned it — same threshold, same per-project/per-step dials as Phase 4.

## Explicitly NOT in Phase 5

- No business logic, gate logic, or contract logic in the service — all of that stays in the skills
  and the files.
- No write path that bypasses a gate. No "the dashboard approved it." Approvals stay human, in files.
- No service that becomes load-bearing — if turning the daemon off breaks the team's ability to ship,
  Phase 5 was built wrong.
- No build at all until the trigger above is measured.

## What to instrument now (so the trigger is decidable later)

Cheap, file-only additions that make the "should we build Phase 5?" question answerable from data:

- In `sdlc-run`, when an **earned** step waits on a human to start it, note that wait (a counter/line
  in `trust-log.json` or a sibling `automation-metrics.json`) — this directly measures "nudge cost".
- In `sdlc-status`, surface a one-line **fleet roll-up** when multiple epics exist (count at each
  gate) — this measures whether "scale of read" is becoming painful before a dashboard is needed.

These are small, reversible, and stay in git. They cost little and turn the Phase 5 decision from a
gut call into a measured one — which is the entire point of how this system is built.

## Definition of done (only if/when Phase 5 is actually built)

- The trigger was measured and recorded in `RESEARCH-NOTES.md` before any service code was written.
- The read-index/dashboard is provably rebuildable: delete it, run one command, it returns identical —
  demonstrated.
- The daemon runs an earned `implement → checks` hand-off unattended on a demo project, halts on a
  seeded failure and notifies a human, and refuses a `human_approve`/front/engineer-review step —
  demonstrated.
- The kill switch stops the daemon system-wide in one move — demonstrated.
- Turning the whole service off leaves the team able to ship by hand exactly as in Phase 4 —
  demonstrated.
