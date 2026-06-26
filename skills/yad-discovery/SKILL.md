---
name: yad-discovery
description: 'Optional front-zero of the gated SDLC — the once-per-project discovery phase. With the field-expert lenses (analyst + pm), run market research, a competitor study, a feasibility study, and (brownfield) a current-state study, then distil a functional + non-functional requirements list and a phased roadmap (MVP and beyond) into the reserved EP-discovery. Greenfield AND brownfield. Its roadmap.md becomes the menu of features each yad-epic reads. Seeds the EP-discovery state and hands off to the team review gate; never auto-advances. Use when the user says "start the project", "do discovery", "market research / feasibility / roadmap", or "what should we build first".'
---

# SDLC — Project Discovery (optional front-zero, "epic zero")

**Goal:** Produce a human-authored, AI-assisted **project-level discovery set** — the field expert's
requirement-gathering for the whole product — under the reserved `EP-discovery` ("epic zero"), then
hand off to `yad-review-gate`. The output `roadmap.md` is the menu of features; each feature is later
taken into the normal `yad-epic` flow, which reads the roadmap for project context.

This is a **front state**: human-authored with AI assist and **never auto-advances**. It runs **once
per project** and is **optional** — a team that already knows what to build can skip it and start at
`yad-epic`. It supports **both greenfield and brownfield**, and produces a **competitor study in both**.

This skill enforces the build plan's core rules: all state lives in files; IDs are engine-assigned
(the reserved `EP-discovery`, never a typed feature slug); front steps are locked to `human_approve`.

## Conventions

- `{project-root}` resolves from the project working directory.
- Discovery artifacts live under `{project-root}/epics/EP-discovery/` (the reserved "epic zero").
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## On Activation

### Step 1 — Entry guard (runs once per project)
The id is the reserved `EP-discovery` — never a feature slug. Discovery seeds its state exactly once:
if `{project-root}/epics/EP-discovery/.sdlc/state.json` already exists, **STOP** and point the user at
`yad next EP-discovery` (the phase is in review or done; edit the artifacts in place, don't re-seed).
When no `state.json` exists yet, proceed and seed state in Step 5.

Detect the project mode from `{project-root}/.sdlc/hub.json` `profile.codebase`
(`greenfield` | `brownfield`, set by `yad setup`). If absent, ask the user; default `greenfield`.

### Step 2 — Shape with the field-expert lenses (assist: analyst + pm)
Adopt the **analyst** lens (`bmad-agent-analyst`, Mary) and the **pm** lens (`bmad-agent-pm`) to gather
requirements as a domain expert would. Drive the existing BMAD research skills as the assist — they
already exist in this project:
- `bmad-market-research` — market size, segments, demand, trends, positioning.
- `bmad-domain-research` — the problem domain, regulations, and constraints of the field.
- `bmad-product-brief` — personas, value proposition, success metrics.

Pressure-test: who are the users, what problem, what is the market, **who are the competitors and how
do we differ** (required in BOTH modes), what is feasible, what is the smallest valuable slice (MVP),
and what sequences after it.

### Step 2b — Brownfield current-state (make discovery code-aware)
Read the registry `{project-root}/.sdlc/repos.json` (`config.yaml` `code_context`). For **every
connected repo**, load the lightweight code-map `{project-root}/.sdlc/code-context/<repo>/code-map.md`
and base `current-state.md` on **what already exists** — modules, endpoints, data, gaps — so the
roadmap extends the real system rather than re-proposing it.

- **Greenfield-safe:** if `repos.json` is absent/empty (greenfield), `current-state.md` is a short
  "clean slate / assumptions & non-goals" note, and you proceed.
- **Staleness:** if a repo's current HEAD (`git -C <path> rev-parse HEAD`) ≠ its registry `syncedHead`,
  warn and suggest `yad repo refresh <repo>` (a human decision — flag, never auto-refresh).
- **Backfill pointer:** for an existing codebase, point the user at `yad-backfill` to capture specs for
  already-built features; discovery frames the *forward* roadmap, backfill captures the *current* one.

### Step 3 — Open the authoring branch
Open the discovery authoring branch `discovery/EP-discovery` per the shared procedure
(`../yad-epic/references/state-schema.md` → "Authoring branches"): git-safe (skip with a note if
`{project-root}` is not a git work tree), check out the branch if it exists, else create it from the
hub's default branch. Author and commit the discovery set on it. Distinct from the bridge's
`review/EP-discovery/discovery` branch.

### Step 4 — Write the discovery set
Write these files under `{project-root}/epics/EP-discovery/`. Each is a normal Markdown artifact; the
gate binds to the **whole set** (editing any one revokes approvals). `roadmap.md` summarises and links
the others and is the spine of the review.

- `market-research.md` — market, segments, demand, trends (assist: `bmad-market-research`).
- `competitor-analysis.md` — competitors, capabilities, gaps, our differentiation (**both modes**).
- `current-state.md` — brownfield: what exists today (Step 2b); greenfield: clean-slate assumptions.
- `feasibility.md` — technical/operational/economic feasibility, risks, viability, go/no-go.
- `requirements.md` — the consolidated requirements list, **functional AND non-functional**, as a
  table (see `references/discovery-schema.md`). Functional rows are candidate features (registration,
  login, …); non-functional rows are cross-cutting (performance, security, accessibility, i18n …).
- `roadmap.md` — the phased plan with an explicit **MVP** phase, then later phases. Each feature row
  carries a proposed `EP-<slug>` id, its target phase, and a `status:` of `planned`
  (see `references/discovery-schema.md` for the exact templates).

Leave `owner` for the user to set in each frontmatter. Fill the bodies with the user.

### Step 5 — Seed the state machine
Create `{project-root}/epics/EP-discovery/.sdlc/state.json` describing the **2-step** front-zero
sequence, both steps `automation: human_approve` and `locked`, with the `kind: "discovery"` marker the
engine keys off. Use this exact shape (see `references/discovery-schema.md`):

```json
{
  "epicId": "EP-discovery",
  "kind": "discovery",
  "createdAt": "<YYYY-MM-DD>",
  "currentStep": "discovery-review",
  "steps": [
    { "id": "discovery",        "type": "author",         "artifact": "discovery/", "assistance": "review", "automation": "human_approve", "locked": true, "status": "done",      "risk_tags": [] },
    { "id": "discovery-review", "type": "review+approve", "artifact": "discovery/", "assistance": "review", "automation": "human_approve", "locked": true, "status": "in_review", "risk_tags": [] }
  ]
}
```

Notes:
- The review step's artifact is the virtual base `discovery/` — the gate fingerprints the whole
  discovery file set (`market-research`, `competitor-analysis`, `current-state`, `feasibility`,
  `requirements`, `roadmap`), so editing any of them revokes prior approvals (mirrors `stories/`).
  **All six must exist to review:** if any is missing the set is incomplete and non-reviewable (the
  hash is `null`) and `yad gate open`/`sync` warn — so write all six (Step 4) before the gate.
- `discovery-review` carries no `risk_tags` — it is the **base** rule (owner + 1 reviewer); discovery
  never escalates to domain owners (no contract surface is touched yet).
- Also create an empty approvals ledger `.sdlc/approvals.json` and comments ledger
  `.sdlc/comments.json`, each containing `[]`, and the `reviews/` directory.

### Step 6 — Stop at the gate (do NOT advance)
Report: the path to the discovery set, and that the next action is **review** via `yad-review-gate`
(base rule: owner + 1 reviewer) on the virtual artifact `discovery/`. **Never mark discovery-review
approved here** — only real reviewers do that through the gate. When the discovery gate passes, the
state moves to the `discovery-done` sentinel (not `ready-for-build` — discovery has no build half); the
roadmap is now the input that each `yad-epic` reads (its "Step 2c — read the roadmap"). When the hub
has a platform, the gate opens a review PR on the hub (via `yad-hub-bridge`) and
`yad-review-gate action: sync` pulls platform approvals/comments into the ledger; otherwise the review
is recorded file-only.

## Reference
- Discovery artifact templates + the 2-step state shape: `references/discovery-schema.md`.
- State schema, chain shapes, and the authoring-branch procedure:
  `../yad-epic/references/state-schema.md`.
- The epic step that consumes `roadmap.md`: `../yad-epic/SKILL.md` (Step 2c).
- Capturing already-built features in a brownfield codebase: `../yad-backfill/SKILL.md`.
- Connecting code repos + the code-context the brain reads: `../yad-connect-repos/SKILL.md`.
