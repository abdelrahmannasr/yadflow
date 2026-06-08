---
name: sdlc-status
description: 'Read-only view of an SDLC epic: prints the current step, each step''s dials (assistance/automation) and status, and which approvals are still required at the active gate. For stories in the build half it also prints each back-half step''s automation dial, status, and trust record (runs / % approved-unchanged / whether it clears the threshold to be earned), plus the system-wide kill-switch state — so the team can see WHY a step is automated and reverse it with evidence. Surfaces the Phase 5 instrumentation signals: per-step "earned but manual" (nudge cost) and, across multiple epics, a fleet roll-up (scale of read). Use when the user says "sdlc status", "where is epic EP-...", "what is blocking the gate", "show the trust record", or "fleet status".'
---

# SDLC — Status (read-only)

**Goal:** Make the file-driven state legible at a glance. This skill **never writes** — it only
reads `.sdlc/` and `reviews/` and reports.

## Conventions
- `{project-root}` resolves from the project working directory.
- Operate on one epic: `{project-root}/epics/EP-<slug>/`.

## On Activation

### Step 1 — Resolve the epic
If no `EP-<slug>` was given, list the epics under `{project-root}/epics/` and ask which one (or
report all if the user asked for an overview).

### Step 2 — Read state
Read `.sdlc/state.json`, `.sdlc/approvals.json`, `epic.md` frontmatter (for `repos`), and — if present
— `.sdlc/contract-lock.json`. For the build half (Phase 4), also read — if present — every
`.sdlc/build-state/<story-id>.json`, `.sdlc/trust-log.json`, and the `automation` block of
`skills/sdlc/config.yaml` (`back_steps`, `trust_threshold`, `locked_steps`, `kill_switch`). Do not
modify any of them.

### Step 3 — Report
Print, in this order:

1. **Epic:** `epicId`, `status` from `epic.md` frontmatter, `currentStep`, and `repos` (the touched
   domains).
2. **Steps table** — for every front step in `steps[]` order (8, or 10 when the optional analysis step
   was run): `id`, `type`, `status`, `assistance`, `automation`, `locked`, and `risk_tags`. Mark the
   `currentStep` with `→`. The full front-state chain is `[analysis → analysis-review →] epic →
   epic-review → architecture → architecture-review → ui-design → ui-design-review → stories →
   stories-review` (then `ready-for-build`); the bracketed `analysis` prefix is present only when
   `sdlc-author-analysis` seeded it. Always render exactly the steps present in `steps[]`.
3. **Active gate** — for the `currentStep` (if it is a `review+approve` step), compute and show:
   - the reviewer rule in force — **base** (`owner + 1 reviewer`), **escalated** (list the required
     domains), or **per-repo** for `stories-review` (list each repo needing sign-off),
   - approvals **recorded so far** (from `approvals.json`), and
   - approvals **still required** to pass the gate (name the missing domains/repos).
   Do not advance — just state whether the gate would pass right now.

   Apply the same predicate `sdlc-review-gate` uses (restated here so this skill is
   self-contained). From the `approved` records in `approvals.json` for the current step:
   - `owners` = records with `role == "owner"`; `reviewers` = distinct `role == "reviewer"`;
     `domainOwners` = `role == "domain-owner"`, grouped by `domain`.
   - **Base pass:** `|owners| >= 1` AND `|reviewers| >= 1` (the configured `default_reviewers`).
   - **Escalated pass** (step `risk_tags` ∩ `{contract, auth, payments}` ≠ ∅): base pass AND, for
     every touched domain, `|domainOwners[domain]| >= 1`. Touched domains = `epic.repos` for
     `architecture-review`; the union of every story's `repos` for `stories-review`.
   - Approvals are **stale** (gate fails) if the artifact was edited after the newest `approved`
     record. For `architecture-review`, also flag staleness if the contract-surface hash no longer
     matches `.sdlc/contract-lock.json`.
4. **Contract lock** — if `.sdlc/contract-lock.json` exists, show the locked hash and `lockedAt`
   (and, when at/after `architecture-review`, whether the current surface still matches it).
5. **Stories** — if `stories/` has files, list each story `id` and its `repos` tags.
6. **Files** — list the review records present under `reviews/` for the current artifact.
7. **Build half (per story, per repo)** — if any `.sdlc/build-state/<story-id>.json` exists, then for
   each such story and each of its repos print the back-half chain
   `spec → tasks → implement → checks → engineer-review`, marking each step's `status`, its
   `automation` dial, and `locked`. Mark that repo's `currentStep` with `→`. This shows, at a glance,
   which back steps are automated and where a run is waiting.
8. **Automation & trust** — print the system-wide **kill switch** state from `config.yaml`
   `automation.kill_switch` (when `on`, note that every step is forced to `human_approve`). Then, for
   each back-half step that has entries in `.sdlc/trust-log.json`, print its **trust record**: number
   of runs, the fraction with `verdict == "approved-unchanged"`, and whether that clears
   `automation.trust_threshold` (`min_runs`, `min_approved_unchanged`) — i.e. whether the step is
   **earned** (eligible to be flipped to `machine_advance`) or still **gathering evidence**. Restate
   the predicate (self-contained): `earned = runs >= min_runs AND unchanged/runs >= min_approved_unchanged`.
   Never recommend flipping a locked step or a front state — those can never be `machine_advance`.

   **Nudge-cost signal (Phase 5 instrumentation).** For each back step that is **earned but its dial
   is still `human_approve`** (and it is not locked / not a front state), flag it:
   `⚠ earned but manual — could be machine_advance`. This is the *nudge cost* the Phase 5 trigger
   watches: automation that is proven safe but still hand-started. It is a read-only observation, not a
   recommendation to flip — earning the evidence and flipping the dial stay deliberate human acts
   (`sdlc-run action: set-dial`). See `docs/phase-5-build-plan.md` §"What to instrument now".

9. **Fleet roll-up (overview only).** When the user asked for an overview, or more than one epic exists
   under `{project-root}/epics/`, print a one-line-per-epic roll-up across the fleet: each epic's
   `currentStep` (front gate) and, for stories in the build half, a count of back-half steps **waiting
   at a human gate** and of steps flagged **earned-but-manual**. Close with fleet totals (epics at each
   front gate; total earned-but-manual back steps). This is the *scale-of-read* signal the Phase 5
   trigger watches — when this roll-up stops fitting in one glance, that is the measured bottleneck.
   Still strictly read-only; it only scans the per-epic files.

### Hard rule
This skill is strictly read-only. If the user wants to comment, approve, or advance, point them to
`sdlc-review-gate`.
