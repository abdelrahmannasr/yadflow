---
name: yad-timeline
description: 'Phase 6 output enrichment (never a gate) — render a feature THREAD as an evolution view AND resolve its current truth. Walks the thread (genesis -> changes -> defects, linked by parent: frontmatter), renders the evolution as the vendored React/Vite/Tailwind shell HTML + a TIMELINE.md summary (each node: kind, what it re-authored vs inherited, ship events, contract re-lock history, open debt), and emits thread-resolved.md — the composed CURRENT-TRUTH map (the latest epic that owns each artifact + the resolved contract-lock hash). That resolved map is the source-of-truth AI/humans read to plan the next change, instead of a stale genesis epic. Degrades to markdown-only when no docs target is connected. Use when the user says "show the feature timeline", "how did this feature evolve", "resolve the current truth", or "render the thread".'
---

# SDLC — Feature Timeline + Current-Truth Resolver (Phase 6, output enrichment)

**Goal:** Make a feature's *evolution* legible and its *current truth* explicit. A feature is a thread of
linked epics; this skill renders that thread (genesis → changes → defects) as an interactive evolution
view and resolves the inheritance chain into the authoritative **current artifact set** — so an AI or a
human planning the next change reads *what the feature actually is now*, not a superseded genesis epic.
It is an **output enrichment**, exactly like `yad-docs` — **never a gate**: it never touches
`state.json`, approvals, or the contract lock.

## Conventions

- `{project-root}` resolves from the product hub.
- Reuses the **`yad-docs` shell** verbatim (`../yad-docs/templates/app/`) — generated `src/data/*.ts`,
  themed, deployed via `yad docs deploy`; build-only / markdown-only when no docs target
  (`.sdlc/docs.json`). The resolver part drives the **`yad thread` CLI** (`cli/thread.mjs`).
- The thread is **derived** from `parent:` frontmatter (no registry). The thread report lives under the
  **genesis** epic (`thread == genesis id`).
- Deterministic generation (stable-id sort, fixed key order, no timestamps in data files), like
  `yad-docs`, so an unchanged thread re-renders byte-identically.

## Inputs

- `thread` — `EP-<genesis>` (or any epic in the thread; it resolves to the root). Ask if not given.
- `action` — `generate` (default) | `deploy`.

## On Activation

### Step 1 — Resolve the thread
Run `yad thread <thread> --json` (`resolveThread` + `threadEpics` + `resolveCurrentArtifacts`). This
gives the genesis-first chain, each epic's lineage (`kind`, `parent`, `inherits`), the resolved
current-truth map, and any open reconcile debt. **STOP** and report if the lineage is broken (point at
`yad doctor` / `yad-reconcile`).

### Step 2 — Read each node's evolution facts
For each epic in the chain read `epic.md` (lineage + the change brief), `.sdlc/change.json` (depth,
defect block), `.sdlc/build-log.json` (ship events), and the contract-lock (a real lock = a re-lock
event; a pointer-lock = inherited). Greenfield-safe: an absent input degrades its part of the view.

### Step 3 — Render the evolution view (yad-docs shell)
Generate the site into `epics/<thread>/timeline-site/` (copy the shell verbatim; generate `src/data/*.ts`
deterministically; theme from the design system). The thread maps onto the shell primitives:
- **Flow path** = the thread; **flow steps** = the epics in order (genesis → tip), each step's messages
  = what it re-authored, its side-effects = the ships it produced + any contract re-lock.
- **System components** = the artifacts (epic/architecture/contract/ui/stories/test-cases), each labelled
  with the epic that currently **owns** it (from the resolved map).
- Colour nodes by `kind` (feature/change/defect/hotfix); mark sealed epics and open debt.

### Step 4 — Emit `thread-resolved.md` (the current-truth map — derived, non-authoritative)
Write `epics/<thread>/thread-resolved.md`: for each artifact base, the **owning epic** (the latest in the
chain that re-authored it) and, for the contract, the **resolved lock hash**. Mark it clearly as a
*derived, regenerable* file (it is composed from immutable artifacts; it is not itself an artifact). This
is the file the next `yad-change` / `yad-epic` reads as "the feature's current truth".

### Step 5 — Emit `TIMELINE.md` + (optional) deploy
Write a short `epics/<thread>/TIMELINE.md` (the chain, what each node changed, ships, open debt) for a
plain-text read. On `action: deploy`, `yad docs deploy` the site (build-only when no target).

## Hard rules

- **Never a gate.** No writes to `state.json`, `approvals.json`, or any `contract-lock.json`. It reads
  the thread and renders it.
- **Derived, regenerable.** `thread-resolved.md` and the site are composed from immutable artifacts;
  re-running yields byte-identical output. They are enrichment, never the source of approval.
- **Degrade gracefully.** No docs target → markdown-only (`TIMELINE.md` + `thread-resolved.md`); never
  fail because a tool is absent.

## Reference
- The resolver + thread engine: `cli/thread.mjs` (`yad thread`), `cli/epic-state.mjs`
  (`resolveThread` / `resolveCurrentArtifacts`).
- The shell + deterministic generation it reuses: `../yad-docs/SKILL.md`,
  `../yad-docs/references/data-mapping.md`.
- The thread model + ledgers: `../yad-epic/references/state-schema.md` (Phase 6).
- The companion report: `../yad-defects/SKILL.md`.
