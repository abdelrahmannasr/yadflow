---
name: sdlc-author-ui
description: 'Front state 5 of the gated SDLC. With the ux-designer, author ui-design.md and DESIGN.md for an approved architecture, driving Impeccable as harness slash-commands (document/extract/craft) when installed, or authoring directly when not. Reads epic + architecture as input. Never auto-advances — hands off to the team review gate. Use when the user says "author the UI design" or after the architecture gate passes.'
---

# SDLC — Author UI Design (front state 5)

**Goal:** Produce a human-authored, AI-assisted `ui-design.md` and `DESIGN.md` for an approved
architecture. This is a **front state**: human-authored with AI assist, **never auto-advances**. When
the UI is drafted, control passes to `sdlc-review-gate` (base rule: owner + 1 reviewer).

UI work is shaped by **Impeccable**, invoked as **harness slash-commands** (not a subprocess CLI) per
the Phase 0 deviation. If Impeccable is not installed, the `ux-designer` lens authors the same outputs
directly — the workflow does not block on the tool.

## Conventions

- `{project-root}` resolves from the project working directory.
- Artifacts live under `{project-root}/epics/EP-<slug>/` (build plan §6).
- `DESIGN.md` is Impeccable's conventional root design-system file (RESEARCH-NOTES §4).
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## On Activation

### Step 1 — Resolve the epic and check the gate
Resolve the `EP-<slug>` (ask if not provided). Read `.sdlc/state.json`. Only proceed when
`currentStep == "ui-design"` and that step's `status == "in_progress"` (the architecture review must
already have passed). If not, stop and point the user at `sdlc-status` / the gate.

### Step 2 — Read inputs
Read `epic.md` (user-level acceptance signals, scope) and `architecture.md` (flows, components by
repo). The UI must cover the user-facing flows the architecture defines.

### Step 3 — Shape the UI (assist: ux-designer + Impeccable slash-commands)
Adopt the **ux-designer** lens (`bmad-agent-ux-designer`, Sally). Drive Impeccable as slash-commands:

- **Existing project** (a codebase/design system already exists): `/impeccable document` → then
  `/impeccable extract` → then `/impeccable craft`.
- **New project** (no design system yet): `/impeccable craft` → then `/impeccable extract`.

`/impeccable document` generates the root `DESIGN.md` from existing code; `/impeccable extract` pulls
components/tokens into the design system; `/impeccable craft` is shape-then-build for the new screens.

**Graceful degradation:** if Impeccable is not installed (no `/impeccable …` commands available), the
`ux-designer` lens authors `ui-design.md` and `DESIGN.md` directly, and you **note in `ui-design.md`
that Impeccable was not used**. Do not run `npx impeccable skills install` as part of this step — tool
installation is out of scope for the front half.

### Step 4 — Write the UI artifacts
Write `{project-root}/epics/EP-<slug>/ui-design.md` using EXACTLY this template:

```markdown
---
id: EP-<slug>
artifact: ui-design
status: draft
repos: [<inherit from epic>]
impeccable: <used | not-installed>
---

## Screens & states
<!-- one subsection per screen: purpose, key states (empty/loading/error/success) -->

## User flows
<!-- the click-paths that satisfy the epic's acceptance signals -->

## Components & tokens
<!-- components used; reference DESIGN.md tokens; what is new vs reused -->

## Accessibility & responsiveness
<!-- a11y notes; breakpoints/viewports covered -->
```

Also create/update `{project-root}/epics/EP-<slug>/DESIGN.md` (Impeccable's design-system file, or a
hand-authored equivalent when degraded) capturing the design tokens/components the screens rely on.

### Step 5 — Advance the authoring step (NOT the gate)
In `state.json`: set `ui-design.status: "done"`, set `ui-design-review.status: "in_review"`, and set
`currentStep: "ui-design-review"`. Write `state.json`. Do **not** touch `approvals.json`.

### Step 6 — Stop at the gate (do NOT advance)
Report: the paths to `ui-design.md` and `DESIGN.md`, whether Impeccable was used, and that the next
action is **review** via `sdlc-review-gate` (base rule: owner + 1 reviewer). **Never record approval
here.** Front states do not auto-advance.

## Reference
- Impeccable commands and the slash-command-vs-CLI deviation: `RESEARCH-NOTES.md` §4 + Deviation 3.
- State schema and field meanings: `../sdlc-author-epic/references/state-schema.md`.
