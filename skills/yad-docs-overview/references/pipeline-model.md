# Pipeline model — the yadflow workflow as `src/data/*.ts`

`yad-docs-overview` reuses the per-epic shell, but the *content* is the **workflow itself** rather than
one epic's flows. This file pins how the setup→ship pipeline maps onto the shell's primitives. The
ordering source of truth is `skills/sdlc/module-help.csv` (`phase`, `preceded-by`, `followed-by`,
`outputs`); the dials/thresholds come from `skills/sdlc/config.yaml`; the node classes come from
`docs/diagrams/sdlc-overview.mmd`.

## Primitive mapping

| Shell primitive | Overview meaning |
|-----------------|------------------|
| `FlowPath` (`paths.ts`) | a **phase**: Setup, Front half, Build half, Automation. |
| `FlowStep` (within a path) | a **skill or gate** in order; `messages` = its `outputs`; `sideEffects` = the `.sdlc/` files it writes; `status`/`bookingStatus` annotate gated vs. enrichment vs. earned. |
| `SystemComponent` (`components.ts`) | a **durable state object** (the hub, each `.sdlc/*.json`, code repos, the design/testing/learning tools, the platform). |
| `RoleConfig` (`roles.ts`) | a **lens** → its relevant sections + paths. |
| doc sections (`docSections.ts`/`referenceData.ts`) | the phase narratives + the dial/threshold reference tables (from `config.yaml` + the build-plan docs). |

## Flow paths = phases, with their skills in order

Order each path's steps by `module-help.csv` `phase` then the `preceded-by`/`followed-by` chain.

### Path: Setup (`phase: 0-setup`)
The connectors that make the brain context-aware and the outputs publishable. Each writes a `.sdlc/*.json`
and never gates.

| Step (skill) | Outputs / sideEffects |
|--------------|------------------------|
| `yad-connect-repos` | `repos.json`, `code-context/<repo>/pack.md` + `code-map.md` (+ `detect-hub`/`roster` → `hub.json`) |
| `yad-connect-design` | `design.json` |
| `yad-connect-testing` | `testing.json` |
| `yad-connect-learning` | `learning.json` |
| `yad-connect-docs` | `docs.json` |

### Path: Front-zero (`phase: 0-front`)
The OPTIONAL once-per-project discovery phase, modelled as the reserved "epic zero" `EP-discovery`.
Greenfield AND brownfield; a 2-step author→review chain whose review binds to the whole artifact set
and terminates at `discovery-done` (no build half).

| Step (skill) | Gate | Outputs / sideEffects |
|--------------|------|------------------------|
| `yad-discovery` *(optional)* | → `discovery-review` (base rule) | `market-research.md`, `competitor-analysis.md`, `current-state.md`, `feasibility.md`, `requirements.md`, `roadmap.md`; seeds `EP-discovery/.sdlc/state.json` |

`roadmap.md` is the menu of features each `yad-epic` reads (Step 2c) — reference-only, never
auto-seeds epics.

### Path: Front half (`phase: 1-front`)
The gated authoring chain + the reusable review gate (10 steps, or 12 with the optional analysis).

| Step (skill) | Gate | Outputs / sideEffects |
|--------------|------|------------------------|
| `yad-analysis` *(optional)* | → `analysis-review` | `analysis.md`, seeds `state.json` |
| `yad-epic` | → `epic-review` | `epic.md`, seeds `state.json` |
| `yad-architecture` | → `architecture-review` (escalates on contract) | `architecture.md`, `contract.md`, `contract-lock.json` |
| `yad-ui` | → `ui-design-review` | `ui-design.md`, `DESIGN.md`, `design-links.json` |
| `yad-stories` | → `stories-review` (per-repo routing) | `stories/EP-<slug>-S0N.md` |
| `yad-test-cases` | → `test-cases-review` (parallel, non-blocking) | `test-cases.md`, `test-links.json` |
| `yad-review-gate` | the shared gate | `reviews/*.md`, `approvals.json`, `comments.json` |
| `yad-hub-bridge` | the platform PR/MR bridge | `hub-prs.json` |
| `yad-review-comments` | comment scaffolds | repo comment templates |

### Path: Build half (`phase: 3-build`)
Per-story, per-repo: `spec → tasks → implement → checks → engineer-review`, plus the commit/PR helpers.

| Step (skill) | Outputs / sideEffects |
|--------------|------------------------|
| `yad-spec` | `specs/<story-id>/` (Spec Kit layout), `link.md` |
| `yad-implement` | a branch + commit per atomic task |
| `yad-checks` | `checks/*.sh`, CI workflows |
| `yad-pr-template` | PR/MR template + routing helpers |
| `yad-commit` / `yad-open-pr` / `yad-ship` | one commit / one PR/MR |
| `yad-engineer-review` | engineer review + ship recorded in `build-log.json` |
| `yad-backfill` | DRAFT specs for legacy features |

### Path: Automation (the second dial + observation)
The orchestrator + the trust evidence + the read-only views. Maps the **earns** / **locked** / **sentinel**
node classes from the diagram.

| Step (skill) | Outputs / sideEffects |
|--------------|------------------------|
| `yad-run` | drives the back-half loop; `build-state/<story>.json`, `trust-log.json`, kill switch |
| `yad-learn` | tutoring; `learning-records.json` (LOCAL-ONLY, gitignored) |
| `yad-status` | read-only view (no writes) |
| `yad-docs` / `yad-docs-overview` / `yad-docs-sync` | the docs sites + their `docs-build.json` manifests |

## System components = the durable state objects

`components.ts` renders these on the canvas (deterministic positions): the **product hub**; each
`.sdlc/*.json` (`state.json`, `approvals.json`, `comments.json`, `hub.json`, `repos.json`, `design.json`,
`testing.json`, `learning.json`, `docs.json`, `contract-lock.json`, `build-state/*`, `trust-log.json`);
the **connected code repos**; the **design / testing / learning tools**; and the **platform**
(GitHub/GitLab + Pages). A skill's `sideEffects` link its step to the component it writes.

## Roles = the lenses

The eight yadflow lenses, each to its relevant phase sections + paths:

| Lens | Relevant phases / sections |
|------|----------------------------|
| analyst | Setup intent, project discovery (front-zero), analysis step, front-half discovery |
| pm | project discovery (market/feasibility/roadmap), epic, stories; the front gates |
| architect | architecture + the locked contract; escalation |
| ux | UI design, design tool connection, the design system |
| dev | build half: spec → implement, the per-repo loop |
| tester | test-cases (parallel track), the testing tool, checks |
| reviewer | the review gate, comments, the hub bridge |
| engineer | engineer review + ship, the merge gate, automation dial/trust |

## Determinism + theme
Same discipline as `yad-docs`: stable-sort steps by phase then pipeline order, fixed key order, **no
timestamps** in `src/data/*.ts` (build time lives only in `.docs-build.json`). Theme the `:root` from
**yadflow's brand palette** (the legacy report's `:root`): `--accent: #2471a3`, and carry the node-class
colors through to step/path colors — `--artifact-* #b7950b`, `--gate-* #ca6f1e`, `--earns-* #2471a3`,
`--locked-* #566573`, `--sentinel-* #1e8449` — so the canvas reads like the existing diagram.
