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

### Step 1b — Open the authoring branch
Open the UI authoring branch `ui-design/EP-<slug>` per the shared procedure
(`../sdlc-author-epic/references/state-schema.md` → "Authoring branches"): git-safe (skip with a note
if `{project-root}` is not a git work tree), check out the branch if it exists, else create it from the
hub's default branch. Author and commit `ui-design.md` / `DESIGN.md` on it. This is **distinct** from
the bridge's `review/…` branch.

### Step 2 — Read inputs
Read `epic.md` (user-level acceptance signals, scope) and `architecture.md` (flows, components by
repo). The UI must cover the user-facing flows the architecture defines.

### Step 2b — Load existing-code context (make the brain code-aware)
Read the registry `{project-root}/.sdlc/repos.json` (`config.yaml` `code_context`). For **each repo in
`epic.repos`**, load the code-map `{project-root}/.sdlc/code-context/<repo>/code-map.md` so the UI
**reuses existing components and conventions** rather than inventing parallel ones. This complements
Impeccable's `/impeccable document` (Step 3), which reads code directly for the design system — when
Impeccable is absent, the code-map is the brain's view of what UI/components already exist.

- **Greenfield-safe:** if `repos.json` is absent/empty, note "no repos connected" and proceed.
- **Staleness:** if a repo's current HEAD ≠ its registry `syncedHead`, warn and suggest
  `sdlc-connect-repos action: refresh`; stamp `code-context: stale` in the frontmatter.
- **Traceability:** record the loaded maps in the `ui-design.md` `code-context:` frontmatter field.

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
owner: <inherit from epic.md owner>   # the epic owner carries through; not retyped
repos: [<inherit from epic>]
impeccable: <used | not-installed>
code-context: { repos: [], loaded: <YYYY-MM-DD or none> }   # code-maps that informed component reuse (Step 2b)
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
here.** Front states do not auto-advance. When the hub has a platform, the gate opens a review PR on the
hub (via `sdlc-hub-bridge`) and `sdlc-review-gate action: sync` pulls platform approvals/comments into
the ledger; otherwise the review is recorded file-only.

## Reference
- Impeccable commands and the slash-command-vs-CLI deviation: `RESEARCH-NOTES.md` §4 + Deviation 3.
- State schema and field meanings: `../sdlc-author-epic/references/state-schema.md`.
- Connecting code repos + the code-context the brain reads: `../sdlc-connect-repos/SKILL.md`.
