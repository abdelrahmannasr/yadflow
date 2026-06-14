---
name: yad-docs
description: 'Generates the per-epic interactive documentation site — a vendored React/Vite/Tailwind SPA with an animated flow canvas and role-based stakeholder doc pages — from the epic''s approved artifacts (epic, architecture, the locked contract, UI design, stories, code-context, test cases). Themes it from the design tokens, wires the docs.json base path, and drives `yad docs build/deploy` to publish to Pages (or build-only when no target). This is an OUTPUT ENRICHMENT, never a gated front state: it never mutates state.json steps, approvals, or the contract lock. Use when the user says "generate the docs site", "build the interactive docs", or "deploy the epic docs".'
---

# SDLC — Author the Interactive Docs Site (per-epic, output enrichment)

**Goal:** Turn an epic's approved artifacts into a **living, interactive documentation site** — a
vendored React 19 + Vite 7 + Tailwind v4 SPA with an animated **flow canvas** (system components on a
canvas, animated messages, playback, a system-logs terminal, a right detail panel) and **role-based
stakeholder doc pages** (each lens → a set of doc sections). The shell is generic; the **content** is
generated entirely into `src/data/*.ts` and the theme into `src/index.css`.

This is an **output enrichment**, exactly like `design-links.json` / `test-links.json` — **NOT a gated
front state.** It **never** mutates `.sdlc/state.json` `steps[]`, `approvals.json`, or
`contract-lock.json`, and it never adds a `state.json` step. It reads the *approved* shape and renders
it; it never decides approval. When a docs target is connected (`yad-connect-docs` → `.sdlc/docs.json`)
the site is built + deployed; when none is, it is npm-built to a local `dist/` (build-only).

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- Artifacts live under `{project-root}/epics/EP-<slug>/`. The generated site lives at
  `epics/EP-<slug>/docs-site/`; its `dist/` and `node_modules/` are gitignored, the generated **source
  is committed**.
- The shell template is `skills/yad-docs/templates/app/` — copied **verbatim**, never modified in place.
  Generated data must satisfy the types in `src/data/types.ts`.
- The docs target is recorded in `{project-root}/.sdlc/docs.json` (`yad-connect-docs`). The per-epic
  build manifest (the staleness baseline) is `epics/EP-<slug>/.sdlc/docs-build.json`.
- The actual data-file **generation** (reading artifacts → writing `src/data/*.ts`, theming
  `index.css`) is the **AI step** inside this skill; the `yad docs` CLI only does the npm build +
  platform deploy + staleness hashing.
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `epic` — `EP-<slug>` (ask if not provided).
- `action` — `generate` (default) | `refresh` | `deploy`.
- `login_gate` — `true` | `false` (default `false`). When on, the generated site gates behind a local
  login screen (`useAuthStore`); default off (public docs).

## On Activation

### Step 1 — Resolve the epic + check the *shape* is approved (NOT the gate)
Resolve `EP-<slug>`. Read `.sdlc/state.json`. Require **at least** that the epic exists and its
`epic-review` step has `status == "done"` (so the docs never describe an *unapproved* shape) — but do
**NOT** require any specific `currentStep`. Docs are an enrichment that runs over whatever is approved
so far. **Never touch `approvals.json` or `contract-lock.json`.** If `epic-review` has not passed, stop
and point the user at the gate (`yad-review-gate`); do not render an unapproved epic.

### Step 1b — Open the authoring branch
Open the `docs/EP-<slug>` authoring branch per the shared procedure
(`../yad-epic/references/state-schema.md` → "Authoring branches"): git-safe (skip with a note if
`{project-root}` is not a git work tree), check out the branch if it exists, else create it from the
hub's default branch. Generate and commit the site source on it.

### Step 2 — Read the inputs (the data sources)
Load each artifact and note what it feeds (full table in `references/data-mapping.md`):

- `epic.md` → **ExecutiveSummary** + **PMRoadmap** sections.
- `architecture.md` → **system components** (`components.ts`) + **flow paths** + the **Deployment** and
  **Security** doc sections.
- `contract.md` `CONTRACT-SURFACE` → **ApiReference** / **StatusMachine** / **DbSchema** — the
  **authoritative** API source. The docs **cannot drift** from the locked contract; render the surface
  exactly as locked (cross-check `contract-lock.json`'s hash matches, but never modify it).
- `ui-design.md` + `DESIGN.md` + `.sdlc/design-links.json` → flow-path **UI states**, the `index.css`
  **theme**, and a **Screens** section (linking the design-tool frames when present).
- `stories/*.md` → **one FlowPath each** (acceptance criteria → animated `FlowStep` messages +
  `sideEffects`).
- `.sdlc/repos.json` + `.sdlc/code-context/<repo>/code-map.md` (for each repo in `epic.repos`) → real
  module/endpoint names that **enrich** the components. **Staleness:** if a repo's current HEAD ≠ its
  registry `syncedHead`, **warn** and stamp `code-context: stale` in the manifest — suggest `yad repo
  refresh <repo>` (a human decision); **never auto-refresh**.
- `test-cases.md` + `.sdlc/test-links.json` → the **TestPlan** section.

Greenfield-safe: any absent input (no design tool, no test cases, no repos) degrades that section to
empty/omitted with a note — never invent content.

### Step 3 — Generate the site into `epics/EP-<slug>/docs-site/`
Copy the shell from `templates/app/` **verbatim**, then:

1. **Generate `src/data/*.ts` deterministically** — `paths.ts`, `components.ts`, `roles.ts`,
   `docSections.ts`, `referenceData.ts` (mapping in `references/data-mapping.md`). Sort by **stable
   IDs** (story `S0N`, repo name, endpoint `method+path`), use a **fixed key order**, and write **NO
   timestamps inside the data files** — so regenerating an unchanged input yields a byte-identical file
   (the staleness hash depends on it). Data must satisfy `src/data/types.ts`
   (`FlowPath`/`FlowStep`/`AnimatedMessage`/`SystemComponent`/`StakeholderView`, etc.).
2. **Derive stakeholder roles** (`roles.ts`) from the hub roster roles (`.sdlc/hub.json`) ∩ the yadflow
   lens set (analyst / pm / architect / ux / dev / tester / reviewer / engineer) ∩ the stories' `repos:`
   tags — each role → its relevant doc `sectionIds` + `relevantPathIds` (`references/data-mapping.md`).
3. **Theme the `:root` block of `src/index.css`** from the design tokens, by the 4-tier priority in
   `references/theme-map.md`: **DESIGN.md → design.json/design-links.json palette → code-map tokens →
   default theme** (stamp `theme: default` in the manifest when it falls through to the shell default).
   Keep fonts Space Grotesk + Noto Sans and the `.glass-panel`/`.flow-grid`/`.code-block` utilities.
4. **Substitute the Vite base** from `.sdlc/docs.json` `basePath` (per-epic sites nest under
   `/<repo>/epics/EP-<slug>/`). Read `docs.json` for the base path + target; if absent, default base
   `/` and treat as build-only.
5. **Set the login-gate flag** (`login_gate`, default off).

### Step 4 — Write the build manifest (the staleness baseline)
Write `epics/EP-<slug>/.sdlc/docs-build.json` — the baseline `yad-docs-sync` compares against:

```json
{
  "builtAt": "<YYYY-MM-DD>",
  "theme": "design.json | DESIGN.md | default",
  "artifactHash": "<sha256 of epic.md + architecture.md + contract.md CONTRACT-SURFACE + ui-design.md + each story>",
  "repoHeads": { "<repo>": "<HEAD sha>" },
  "deployUrl": "<url or null>",
  "templateVersion": "<shell template version>"
}
```

Do **NOT** add a `state.json` step — docs are an enrichment, exactly like `design-links.json`.
Optionally record a `docs:` line in a `DOCS.md` index under the epic.

### Step 5 — Build / deploy (`action`)
- `action: generate` (default) — generate the source + manifest; stop. The CLI may npm-build to verify,
  but no publish.
- `action: deploy` — drive **`yad docs deploy --epic <id>`**: it npm-builds the site (`npm ci && npm run
  build` as a subprocess, like `yad-spec` shelling `npx repomix`), ensures the Pages CI workflow is
  present, and reports the deploy URL (publish happens via CI). **Degrades** to the local `dist/` path
  when no platform CLI / `target: "none"` (build-only).

### Step 6 — Stop. Report (NEVER auto-advance)
Report: the site path (`epics/EP-<slug>/docs-site/`), the data files produced, the **theme source** (or
the default-theme degrade), the **deploy URL** or "build-only", and the **staleness baseline**
(`docs-build.json`). **NEVER auto-advance, NEVER record approval — this is not a gate.** Note any
`code-context: stale` warning so the human can refresh the repo cache.

## Hard rules

- **Output enrichment, never a gate.** This skill **MUST NEVER** mutate `.sdlc/state.json` `steps[]`,
  `approvals.json`, or `contract-lock.json`, and never adds a state step — exactly how `yad-ui` writes
  `design-links.json` without changing the locked step shape.
- **Docs cannot drift from the locked contract.** The contract surface is the authoritative API source;
  render it as locked. Never edit `contract-lock.json` or the contract here.
- **Deterministic generation.** Stable-ID sort, fixed key order, no timestamps inside `src/data/*.ts` —
  so an unchanged input regenerates byte-identically and the staleness hash is meaningful.
- **Never auto-refresh a stale repo.** HEAD ≠ `syncedHead` ⇒ warn + stamp `code-context: stale`; the
  refresh is a human decision (`yad repo refresh`).
- **Degrade gracefully.** No docs target → build-only (local `dist/`). No design tokens → default theme.
  Absent inputs → omitted sections. No error — the site is additive.
- **Copy the shell verbatim.** Generate only `src/data/*.ts`, the `:root` of `index.css`, and the Vite
  base. Never hand-edit `templates/app/`.

## Reference
- The deterministic DESIGN-token → CSS-custom-property mapping + 4-tier priority + default fallback:
  `references/theme-map.md`.
- The full artifact → data-structure table, determinism rules, and role derivation:
  `references/data-mapping.md`.
- The connected docs target + base-path resolution: `../yad-connect-docs/SKILL.md`.
- The design tokens this themes from: `../yad-connect-design/SKILL.md`.
- The code-context the data enriches: `../yad-connect-repos/SKILL.md`.
- The authoring pattern (front-state author that writes link artifacts without gating):
  `../yad-ui/SKILL.md`.
- State schema + the "Authoring branches" procedure: `../yad-epic/references/state-schema.md`.
- The project overview site + the staleness/CI reconciler: `../yad-docs-overview/SKILL.md`,
  `../yad-docs-sync/SKILL.md`.
