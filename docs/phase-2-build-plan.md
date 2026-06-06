# Phase 2 — Build Plan

Builds directly on Phase 0 (research) and Phase 1 (the `sdlc` module: author-epic, review-gate, status, dials, gate rule, worked demo). Same rules apply: talk to tools through their interfaces, all state in files, front states never auto-advance, smallest-useful-first.

**Carry the three Phase 0 deviations into everything below:**
- There is no `sm` agent — use `pm` for story breakdown and `architect`/`pm` for story prep.
- Custom modules live in `skills/` — keep authoring there; `install.sh` links into IDE skill dirs.
- Spec Kit and Impeccable are **harness slash-commands, not subprocess CLIs** — the glue invokes them as slash-commands, not via shell-out. Confirm in this phase whether Repomix is a real CLI or also a slash-command, and record it in `RESEARCH-NOTES.md`.

---

## Goal of Phase 2

Complete the **front states** (the human-authored, AI-assisted planning half) end to end, so a feature can go from epic all the way to approved, repo-tagged user stories — entirely by hand, with every gate working. This is the half that holds your core value (authorship + team review). The build half (Spec Kit onward) is Phase 3.

By the end of Phase 2, a feature should walk: epic → review → architecture+contract → review → UI design → review → stories → review, with state advancing only on recorded approvals, and stories correctly tagged by repo.

---

## What to build, in order

### 1. `sdlc-author-architecture` — front state 3
- Agent: `architect` authors `architecture.md` and the locked `contract.md`.
- Reads `epic.md` as input context.
- `contract.md` holds only the shared cross-repo surface: API shape, events, data model. Keep it at charter altitude — no per-repo implementation detail.
- Seeds the contract surface in a form the later contract-check can compare against (record the chosen representation in `RESEARCH-NOTES.md` — a hash of the contract section is the simplest; confirm it works before building more).
- Advances state `architecture` → `architecture-review`.

### 2. Reuse `sdlc-review-gate` for the architecture review
- No new gate code — this is the proof the gate is truly reusable.
- This gate **escalates by default**: architecture touches the shared contract, so the rule requires the relevant domain owners, not just owner + 1.
- On approval: `architecture-review` → `ui-design`.

### 3. `sdlc-author-ui` — front state 5
- Agent: `ux-designer` for UX thinking.
- Invoke Impeccable **as harness slash-commands** (per Phase 0 deviation): existing project → `document` then `extract` then `craft`; new project → `craft` then `extract`. Confirm the exact slash-command names against the installed Impeccable and note them.
- Outputs `ui-design.md` and `DESIGN.md`.
- Advances `ui-design` → `ui-design-review`, then reuse the gate → `stories`.

### 4. `sdlc-author-stories` — front state 7
- Agents: `pm` breaks the epic into stories (no `sm` — deviation); `pm` or `architect` prepares each story's detail.
- Reads epic, architecture, contract, and UI outputs as context.
- Assigns story IDs `EP-<slug>-S01`, `S02`, … (zero-padded, never renamed).
- Each story records `repos: [...]` — which repos must implement it. This is the field the later build phase reads to know where to scaffold specs.
- Writes one file per story under `epics/EP-<slug>/stories/`.
- Advances `stories` → `stories-review`.

### 5. Story review gate (reuse, with per-repo reviewers)
- Reuse `sdlc-review-gate`.
- Rule variation: each domain engineer reviews the stories that touch **their** repo (backend engineer on backend stories, etc.). Build this as a reviewer-routing option on the existing gate, not a new gate.
- On full approval: `stories-review` → `ready-for-build` (the Phase 3 handoff point).

### 6. `sdlc-status` extension
- Extend the existing read-only view to show the full front-state chain, which gate is pending, who still needs to approve, and the per-step dial settings.
- No new concepts — just surface the now-longer state machine.

---

## Cross-cutting requirements

- **One reusable gate.** All three new reviews (architecture, UI, stories) use the Phase 1 `sdlc-review-gate`. If any of them needs gate code copied or forked, stop — fix the gate to take options (reviewer routing, escalation trigger) instead. Proving the single gate covers all four reviews (epic + 3 new) is a primary success criterion.
- **IDs flow unbroken.** The `EP-<slug>` from Phase 1 must appear in the epic folder, every story file, and every story ID. The engine assigns them; never hand-typed.
- **Staleness guard carries forward.** The Phase 1 guard (an approval is invalidated if the artifact changes after approval) must apply to architecture, UI, and stories too.
- **Front states stay locked.** None of the four front-state authors may be set to `machine_advance` in this version. Verify the lock holds for the three new ones.
- **Tools via their real interface.** Impeccable through slash-commands. If Phase 2 introduces Repomix (it shouldn't yet — backfill is later), confirm its interface first.

---

## Explicitly NOT in Phase 2

- No Spec Kit (specify/clarify/plan/tasks) — that is Phase 3.
- No backfill / Repomix — Phase 3 or later.
- No multi-repo contract *enforcement* in CI — Phase 2 only produces and locks `contract.md`; the check gate that fails a PR on contract drift comes with the build half.
- No automation of any front state — assistance can be heavy, advancing stays human.

---

## Definition of done for Phase 2

- Three new skills authored in `skills/sdlc/` in the verified v6.8.0 format: `sdlc-author-architecture`, `sdlc-author-ui`, `sdlc-author-stories`.
- All three reviews run through the **same** `sdlc-review-gate` (with options for escalation and reviewer routing) — no forked gate code.
- `sdlc-status` shows the full front-state chain.
- `RESEARCH-NOTES.md` updated with: the contract representation chosen, the Impeccable slash-command names, and the Repomix interface (CLI vs slash-command).
- Worked demo extended: `EP-istifta-inquiries` walks the full front half — epic → review → architecture+contract → review → UI → review → stories (tagged by repo) → review → `ready-for-build`. Show at least one escalation (contract review needing a domain owner) and one per-repo story review in the demo.
- `README.md` updated so the team can run the whole front half by hand.

---

## Then Phase 3 (preview, do not build yet)

The build half: Spec Kit per story per repo (specify→clarify→plan→tasks→analyze→checklist, heavy once per story, tasks per PR), the `dev` implement step, check gates (build/test/lint + contract-check + spec-link), AI review, engineer review, ship. Plus the backfill step (Repomix) for existing code, and the PR/MR templates committed into each code repo. Automation (end-first) and the multi-repo contract enforcement come after that.
