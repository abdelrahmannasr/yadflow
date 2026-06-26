---
name: yad-defects
description: 'Phase 6 output enrichment (never a gate) — the quality-gap report. Generates a per-epic AND per-thread defect/bug report (the vendored React/Vite/Tailwind shell HTML + a DEFECTS.md) that aggregates every kind:defect change-epic + each change.json defect block + shipped regressions in build-log.json BY escape_stage (the SDLC gate that should have caught the defect) and root_cause, and visualizes WHERE quality gaps systematically come from — e.g. "% of this feature''s defects that escaped at the test-cases gate" — so the team hardens the originating stage instead of just fixing symptoms. Degrades to markdown-only when no docs target is connected. Use when the user says "show the defect report", "where are our quality gaps", "generate the bug report for this epic", or "which gate is leaking defects".'
---

# SDLC — Quality-Gap Report (Phase 6, output enrichment)

**Goal:** Turn the thread's defects into a **systemic quality signal**. Because every defect is a
first-class `kind: defect` change-epic carrying an `escape_stage` (the gate that *should* have caught it)
and a `root_cause`, this report can show not just *what* broke but *where the SDLC let it through* — so
the team fixes the originating stage (weak test design, an under-specified story, a missed architecture
risk), not just the symptom. It is an **output enrichment**, exactly like `yad-docs` — **never a gate**.

## Conventions

- `{project-root}` resolves from the product hub.
- Reuses the **`yad-docs` shell** verbatim (`../yad-docs/templates/app/`) — generated `src/data/*.ts`,
  themed, deployed via `yad docs deploy`; build-only / markdown-only when no docs target.
- Per **epic** (one epic's defects) and per **thread** (the whole feature; the thread report lives under
  the genesis epic, since `thread == genesis id`). The thread is derived from `parent:` frontmatter.
- Deterministic generation, like `yad-docs` (stable sort, fixed key order, no timestamps in data).

## Inputs

- `epic` — scope to one epic's defects, OR `thread` — `EP-<genesis>` for the whole feature. Ask if
  neither is given; default to the thread.
- `action` — `generate` (default) | `deploy`.

## On Activation

### Step 1 — Collect the defects
Resolve the scope (`yad thread <id> --json` for a thread). Collect, across the scoped epic(s):
- every `kind: defect` (and `kind: hotfix`) change-epic + its `.sdlc/change.json` `defect` block
  (`origin`, `severity`, `escape_stage`, `root_cause`);
- the shipped regression fixes from each `.sdlc/build-log.json` (the fix that closed the defect, linking
  the change-epic → its regression story/test);
- open reconcile debt (a hotfix whose front truth is not yet restored).

### Step 2 — Attribute each defect to the gate that should have caught it
A defect is attributed to its **earliest** responsible SDLC stage. Use `change.json.escape_stage`
(human-set at intake), cross-checked against the fix's shape: a missing negative test → `test-cases`; a
wrong/absent contract field → `architecture`; an unstated acceptance criterion → `stories`; a missed
market/requirement → `discovery`/`epic`. Record the attribution per defect.

### Step 3 — Aggregate the quality signal
Compute, for the scope:
- **defects per escape-stage** (count + **% of scope defects** — the headline "X% escaped at the
  `<stage>` gate");
- **defects per root_cause**;
- **severity mix** and **genesis→defect age** (how long after ship the defect surfaced);
- an **escape rate** per gate = defects attributed to a stage ÷ artifacts that passed that stage (a
  normalized "how leaky is this gate").

### Step 4 — Render the report (yad-docs shell)
Generate the site into `epics/<scope>/defects-site/` with sections:
1. **Summary** — total defects, severity mix, escape rate.
2. **Escape-stage breakdown** — the bar/heat view of where defects leak (the actionable headline).
3. **Root-cause breakdown.**
4. **Per-defect detail** — each defect linked to its change-epic and its regression test.
5. **Severity & age.**
6. **Recommendations** — which originating stage to harden, derived from the top escape-stages.

Also write a plain `epics/<scope>/DEFECTS.md` mirror. On `action: deploy`, `yad docs deploy` the site
(build-only when no target).

## Hard rules

- **Never a gate.** No writes to `state.json`, `approvals.json`, or any `contract-lock.json`. It reads
  defect data and renders it.
- **Attribute honestly.** Use the recorded `escape_stage`; when it is absent or contradicted by the fix,
  cross-check and say so — do not invent an attribution.
- **Derived + deterministic.** Re-running on unchanged data yields byte-identical output.
- **Degrade gracefully.** No docs target → `DEFECTS.md` only; never fail because a tool is absent.

## Reference
- The defect data: `.sdlc/change.json` `defect` blocks + `build-log.json` (`../yad-epic/references/state-schema.md`, Phase 6).
- The shell + deterministic generation it reuses: `../yad-docs/SKILL.md`, `../yad-docs/references/data-mapping.md`.
- The companion evolution view: `../yad-timeline/SKILL.md`.
- The intake that records `escape_stage` + `root_cause`: `../yad-change/SKILL.md`.
