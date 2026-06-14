---
name: yad-docs-overview
description: 'Generates the project-level SDLC-overview interactive site — the same React/Vite/Tailwind shell as the per-epic docs — showing every yadflow stage from setup → ship: the pipeline as a flow canvas, each skill/gate as a flow step, the durable .sdlc state objects as system components, and the lenses as stakeholder roles. Themed with yadflow''s own brand palette for continuity, built from config.yaml + module-help.csv + the overview diagram. Supersedes docs/index.html with a thin redirect and deploys via `yad docs deploy --overview`. This is project documentation, not a gated state — it never touches any epic''s state or approvals. Use when the user says "generate the overview site", "build the SDLC overview docs", or after the pipeline (module-help.csv / config.yaml / skill count) changes.'
---

# SDLC — Author the Overview Site (project-level, the pipeline as a living map)

**Goal:** Render the **whole yadflow pipeline** — every stage from setup → ship — as an interactive site,
reusing the same shell as the per-epic docs (`skills/yad-docs/templates/app/`). Where `yad-docs`
animates one epic's flows, this animates the **workflow itself**: the front gates, the build half, the
automation dial, the setup connectors. It is the regenerable successor to the hand-maintained
`docs/index.html` overview.

This is **project documentation, not a gated state** — there is no epic, no `state.json`, no approvals.
It only reads the pipeline definition and writes a project-level site. When a docs target is connected
(`.sdlc/docs.json`) it builds + deploys; otherwise it build-only.

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- The overview site lives at `{project-root}/docs/sdlc-site/`; its `dist/`/`node_modules/` are gitignored,
  the generated **source is committed**. The overview build manifest is `docs/sdlc-site/.docs-build.json`.
- The shell template is `skills/yad-docs/templates/app/` — copied **verbatim**, themed only in the
  `:root` of `index.css`. Generated data satisfies `src/data/types.ts`.
- Theme: **yadflow's own brand palette** (the `:root` of `docs/index.html`) — for visual continuity with
  the existing overview, not an epic's design tokens.
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `action` — `generate` (default) | `refresh` | `deploy`.
- `login_gate` — `true` | `false` (default `false`).

## On Activation

### Step 1 — Read the pipeline definition (the data sources)
There is no epic; the inputs are the workflow's own config + manifest (full mapping in
`references/pipeline-model.md`):

- `skills/sdlc/config.yaml` — the front/back steps, the **two dials** (assistance, automation),
  defaults, the review-gate rule, the build conventions, the automation/trust thresholds.
- `skills/sdlc/module-help.csv` — the **canonical skill manifest**: each skill's `phase`,
  `preceded-by` / `followed-by`, and `outputs`. This is the ordering source of truth.
- `docs/diagrams/sdlc-overview.mmd` — the overview diagram (the node/edge shape + the node classes:
  artifact / gate / earns / locked / sentinel).
- the build-plan docs under `docs/` — phase narratives for the section copy.

### Step 1b — Open the authoring branch
Open the `docs/overview` authoring branch per the shared procedure
(`../yad-epic/references/state-schema.md` → "Authoring branches"): git-safe (skip with a note if not a
git work tree). Generate and commit on it.

### Step 2 — Model the pipeline with the shell primitives
Map the pipeline onto the same data structures `yad-docs` uses (concrete mapping in
`references/pipeline-model.md`):

- **Flow paths** = the **phases** — `Setup`, `Front half`, `Build half`, `Automation`.
- **Flow steps** = the **skills/gates in order** (from `module-help.csv` `preceded-by`/`followed-by`),
  each step's `messages` = the skill's `outputs`, and `sideEffects` = the `.sdlc/` files it writes.
- **System components** = the **durable state objects** — the product hub, each `.sdlc/*.json`
  (`state.json`, `approvals.json`, `repos.json`, `design.json`, `testing.json`, `learning.json`,
  `docs.json`, `contract-lock.json`, `build-state/*`, `trust-log.json`), the connected code repos, the
  design/testing/learning tools, and the platform.
- **Roles** = the **lenses** (analyst / pm / architect / ux / dev / tester / reviewer / engineer) → each
  to its relevant sections + paths.

### Step 3 — Generate the site into `docs/sdlc-site/`
Copy the shell from `templates/app/` **verbatim**, generate `src/data/*.ts` deterministically (same
determinism rules as `yad-docs`: stable-ID sort by skill pipeline order / phase, fixed key order, no
timestamps in the data files), theme the `:root` of `index.css` from **yadflow's brand palette** — the
`docs/index.html` `:root`: `--accent: #2471a3` and the node colors (`--artifact-*`, `--gate-*`,
`--earns-*`, `--locked-*`, `--sentinel-*`) — and substitute the Vite base from `.sdlc/docs.json`
`basePath` (the overview sits at the base root, e.g. `/<repo>/`).

### Step 4 — Write the overview build manifest (the staleness baseline)
Write `docs/sdlc-site/.docs-build.json` — `yad-docs-sync` compares against it:

```json
{
  "builtAt": "<YYYY-MM-DD>",
  "theme": "yadflow-brand",
  "artifactHash": "<sha256 of config.yaml + module-help.csv + docs/diagrams/sdlc-overview.mmd>",
  "skillCount": <number of yad-* skills>,
  "deployUrl": "<url or null>",
  "templateVersion": "<shell template version = the yad CLI version>"
}
```

The overview's freshness inputs are the **config + manifest + diagram** (plus the `templateVersion`, so a
doc-shell upgrade triggers a rebuild). `skillCount` rides along in the manifest as an informational field
— it is **not** a separate hash input, since `module-help.csv` already moves whenever the skill set does.
Not per-epic artifacts/repo heads.

### Step 5 — Supersede `docs/index.html` (one release)
Turn `docs/index.html` into a **thin redirect** to `docs/sdlc-site/` (e.g. a `<meta http-equiv="refresh">`
+ a one-line link), and **note in the report** that the hand-maintained overview is superseded by the
generated site for this release. This generalizes the standing rule that feature work hand-updates
`docs/index.html`: the overview site now **regenerates** instead.

### Step 6 — Build / deploy (`action`)
- `action: generate` (default) — generate source + manifest; stop.
- `action: deploy` — drive **`yad docs deploy --overview`**: npm-build, ensure the Pages CI workflow,
  report the deploy URL. Degrades to local `dist/` when no platform CLI / `target: "none"`.

### Step 7 — Stop. Report (no gate, no epic)
Report: the site path (`docs/sdlc-site/`), the data files produced, that the theme is the yadflow brand
palette, the deploy URL or "build-only", the staleness baseline, and that `docs/index.html` now
redirects to the generated site. Never touches any epic state.

## Hard rules

- **Project documentation, not a gate.** No epic, no `state.json`, no approvals — this skill never reads
  or writes any epic's gated state.
- **The overview regenerates on pipeline change.** This **generalizes** the standing rule that feature
  work hand-updates `docs/index.html` + the overview diagram + skill counts: the overview site now
  regenerates whenever `module-help.csv` / `config.yaml` / the skill count changes — and `yad-docs-sync`
  **enforces** that (it flags the overview stale when those inputs move).
- **Brand-palette themed, copy the shell verbatim.** Theme only the `:root`; generate only `src/data/*.ts`
  + the Vite base. Never hand-edit `templates/app/`.
- **Deterministic generation.** Same stable-sort / fixed-key / no-timestamp discipline as `yad-docs`.
- **Degrade gracefully.** No docs target → build-only; no `.mmd` / no build-plan docs → omit those
  sections with a note, never invent.

## Reference
- The concrete mapping of every setup→ship stage to flow paths / steps / components / roles, with each
  `yad-*` skill in pipeline order + its phase + outputs: `references/pipeline-model.md`.
- The per-epic counterpart (shell, determinism, theming): `../yad-docs/SKILL.md`.
- The connected docs target + base-path resolution: `../yad-connect-docs/SKILL.md`.
- The staleness/CI reconciler that enforces overview regeneration: `../yad-docs-sync/SKILL.md`.
