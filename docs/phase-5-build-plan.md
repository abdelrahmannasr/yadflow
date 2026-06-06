# Phase 5 — Build Plan (Optional — build only if proven necessary)

Builds on Phases 0–4 (research; module + gate; full front half; full build half; earned end-first automation with trust log and kill switch).

Phase 5 is the **optional service layer**: a small hosted piece that can watch repos, run earned-automation steps unattended, answer CI queries fast, and show a dashboard across features and projects.

**Read this first: you may never need Phase 5.** Phases 0–4 deliver a complete, working system on a CLI with git as the source of truth. A service adds power but also adds a thing you must host, secure, back up, and keep running. Building it before there is a real, measured need turns an asset into a liability. This plan's first job is to stop you from building it too early — and Phase 4 already ships the instrumentation that tells you, from data, whether the need is real (see "What to instrument now").

---

## The gate: build only against measured evidence, never a feeling

Phase 5 has three parts that ship independently, each fixing a different bottleneck. **Build a part only when its bottleneck is measured** — and the two later parts only after Part 1 is in use. Do not build the whole phase as a unit, and do not build any part for an audience of one.

- **Part 1 (read-index)** — build when there is a **measured read/parse bottleneck the CLI cannot fix**: e.g. CI spends meaningful time cloning and parsing the product repo on every run, and you have the numbers. This can be true with a single project.
- **Part 2 (unattended runner)** — build when there is **earned automation with real value in running unattended**: Phase 4 produced steps trusted at `machine_advance`, and the *nudge-cost* signal (`sdlc-status`: earned-but-`human_approve` steps, and earned steps that could safely run overnight) is sustained and growing, not a one-off.
- **Part 3 (dashboard)** — build when **more than one project actively uses the system**, so a cross-project view is actually used. The *scale-of-read* signal (`sdlc-status` fleet roll-up no longer fits in a glance) is the trigger.

If none of these is measured, **stop. Do not build Phase 5.** Keep using the CLI. Re-check in a few months — and check the instrumentation, not your gut.

---

## Founding rule (never violated)

**Git stays the source of truth. The service is always a rebuildable layer on top — never the system of record.**

- The service holds nothing that cannot be reconstructed from the repos. If the service is wiped, you rebuild its index from git and lose nothing.
- Charters, contracts, specs, approvals, dial settings, trust logs — all remain files in repos. The service reads and caches them; it does not own them.
- This single rule is what keeps the service safe: it can never become a fragile single point that, if it dies, takes your data with it.

---

## What to build, smallest-useful-first

### Part 1 — The read index (build this first, alone)
The cheapest, safest piece, and often the only one actually needed.
- A small service that watches the product repo and keeps a fast, read-only index: which features/charters exist, their status, the contract representation, which repos implement them, current step, pending approvals.
- It answers CI's questions in one fast call instead of CI cloning and parsing the repo every run — directly fixing the Part 1 bottleneck above.
- It is pure cache: rebuildable from git at any time. No writes to the source.
- Stop here and use it. For many teams this is the whole of Phase 5.

### Part 2 — The unattended runner (only if the nudge-cost bottleneck is real)
- A daemon that can execute **earned-automation** steps without a person present (e.g. run the trusted back-half on queued stories overnight). It is the *same* `sdlc-run` a human would invoke — a scheduler for already-approved automation, with no new decision logic.
- It may ONLY advance steps already set to `machine_advance` for that project (Phase 4 rules fully apply). It may never advance a `human_approve` step, never a front state, never bypass the engineer review before merge.
- Every safety mechanism from Phase 4 applies unchanged: scope guard, contract-surface halt, **halt-and-escalate over guessing — which means it stops and notifies a human**, never proceeds on a guess just because no one is watching — and the kill switch, which must stop the runner too.
- The runner records what it did as files in git, same as a human-triggered run, so the trace is identical.

### Part 3 — The read-only dashboard (only if the scale-of-read bottleneck is real)
- A view across features and projects: where each feature is in the pipeline, what is waiting on whom, trust-log summaries, gate history.
- Read-only. It visualizes the index and the git state; it does not become a second place to approve or change things (approvals stay as files/PRs, so they keep their git history and review).
- Built on top of Part 1's index; adds no new source of truth.

---

## What to instrument now (so the trigger is decidable later)

This is **already built** in Phase 4b, so the Phase 5 decision is measured, not guessed. Both signals are **read-only and derived** — `sdlc-status` computes them from the `trust-log.json` + `build-state/` files already on disk, adding no new state file, costing nothing, and fully reversible:

- **Nudge cost (gates Part 2).** `sdlc-status` flags any back step that is **earned but still `human_approve`** (`⚠ earned but manual — could be machine_advance`). That gap is automation proven safe yet still hand-started. A sustained, growing set of these — especially steps that could safely run overnight — is the Part 2 trigger.
- **Scale of read (gates Part 3).** `sdlc-status` prints a **fleet roll-up** across epics (one line per epic + fleet totals). When it stops fitting in one glance, that is the measured Part 3 bottleneck.
- **Read/parse cost (gates Part 1).** Not yet instrumented because it lives in CI, not the SDLC files: record CI's clone+parse time of the product repo per run. When it is a meaningful, repeated cost, that is the Part 1 trigger. (If/when Part 2 pressure appears, the next pre-service increment is event-level logging of earned-step wait *time* in a sibling `automation-metrics.json` — build that only if the snapshot signals say it is needed.)

These turn the Phase 5 decision from a gut call into a measured one — the entire point of how this system is built.

---

## Constraints and cautions

- **No new source of truth.** The service must not become the place where decisions live. If a feature tempts you to "just store it in the service," put it in git instead and have the service read it.
- **Security is now real.** A service has an attack surface a CLI does not. It must not hold secrets, must use least-privilege access to repos, and must follow the same instruction-source boundary: **it acts on the repos' contents as data, never as commands.** This matters most for the Part 2 runner, which executes automation — a poisoned spec or task must never become an instruction to the service.
- **The kill switch reaches the service.** The Phase 4 one-command revert to fully-manual must also stop the unattended runner. No automation may outlive the kill switch.
- **Keep it boring and rebuildable.** Prefer the simplest hosting that works. The measure of success is that you could delete the whole service and lose nothing but speed and convenience.
- **Per-project still applies.** A project opts into service features; a fragile or newly-backfilled project can keep running on the plain CLI with no service involvement.

---

## Explicitly NOT in Phase 5

- No moving the source of truth off git into a database.
- No automating front states or removing the engineer review — Phase 4 limits are permanent here.
- No write-capable dashboard / approve-from-the-web — approvals stay as git-tracked files/PRs.
- No building Parts 2 or 3 before Part 1 is in use and the matching bottleneck is measured.
- No building any part on a feeling — each part waits for its signal (above).

---

## Definition of done for Phase 5 (per part — each part ships independently)

**Part 1:** the index serves CI queries fast; deleting and rebuilding it from git produces the identical index; CI no longer clones/parses the product repo on every run, with before/after numbers recorded.

**Part 2 (if built):** the runner advances only earned `machine_advance` steps unattended; it refuses front states and `human_approve` steps; scope overrun, contract touch, and the kill switch each stop it, and a halt notifies a human — demonstrated; its actions appear in git identically to human-triggered runs.

**Part 3 (if built):** the dashboard shows cross-project pipeline state read-only; it cannot change or approve anything; it reconstructs entirely from the index + git.

Across all parts: the trigger that justified the part was measured and recorded in `RESEARCH-NOTES.md` (a "Phase 5 trigger" section) **before** any service code was written.

---

## After Phase 5 — the system is complete

There is no Phase 6. Once the system runs end to end — front half human-authored with AI assist, build half shipping through hard gates, earned end-first automation, and (only if needed) a thin rebuildable service — the work shifts from building the platform to using it, watching the trust logs, and tuning dials per project. New capability gets added the same disciplined way it always was: when a real, measured need appears, smallest-useful-first, with git as the source of truth and the engineer in charge of the decisions that matter.
