---
name: sdlc-status
description: 'Read-only view of an SDLC epic: prints the current step, each step''s dials (assistance/automation) and status, and which approvals are still required at the active gate. Use when the user says "sdlc status", "where is epic EP-...", or "what is blocking the gate".'
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
Read `.sdlc/state.json` and `.sdlc/approvals.json`. Do not modify them.

### Step 3 — Report
Print, in this order:

1. **Epic:** `epicId`, `status` from `epic.md` frontmatter, `currentStep`.
2. **Steps table** — for every step: `id`, `type`, `status`, `assistance`, `automation`,
   `locked`, and `risk_tags`. Mark the `currentStep` with `→`.
3. **Active gate** — for the `currentStep` (if it is a `review+approve` step), compute and show:
   - the reviewer rule in force (base `owner + 1 reviewer`, or escalated with the required domains),
   - approvals **recorded so far** (from `approvals.json`), and
   - approvals **still required** to pass the gate.
   Do not advance — just state whether the gate would pass right now.

   Apply the same predicate `sdlc-review-gate` uses (restated here so this skill is
   self-contained). From the `approved` records in `approvals.json` for the current step:
   - `owners` = records with `role == "owner"`; `reviewers` = distinct `role == "reviewer"`;
     `domainOwners` = `role == "domain-owner"`, grouped by `domain`.
   - **Base pass:** `|owners| >= 1` AND `|reviewers| >= 1` (the configured `default_reviewers`).
   - **Escalated pass** (step `risk_tags` ∩ `{contract, auth, payments}` ≠ ∅): base pass AND, for
     every touched domain, `|domainOwners[domain]| >= 1`.
   - Approvals are **stale** (gate fails) if the artifact was edited after the newest `approved`
     record.
4. **Files** — list the review records present under `reviews/` for the current artifact.

### Hard rule
This skill is strictly read-only. If the user wants to comment, approve, or advance, point them to
`sdlc-review-gate`.
