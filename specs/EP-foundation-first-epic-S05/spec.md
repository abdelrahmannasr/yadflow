# Spec — EP-foundation-first-epic-S05: the skills carry the bootstrap and pack outlines

Story: `EP-foundation-first-epic-S05` (epic `EP-foundation-first-epic`), engine repo. Issue: engine #694.
Contract: none new. The skills read `seed` (S01, #700), `firstEpic` (S02, #702) and `yad repo features --json`
(S03) as the epic's locked contract gives them. Text only.

## Problem

The engine now seeds a setup epic (`--seed bootstrap|pack`) and the guide proposes it, but the skills that
write the epic and its stories do not know what a setup epic holds. And the skills and docs still say "the
Foundation never auto-seeds epics", which no longer describes what happens.

## Requirements

- **R1. `yad-epic`, a new Step 2d** (only when `state.json` has `seed`): read the approved Foundation and
  write `epic.md` from the outline.
  - `bootstrap`: five Scope parts, each tagged with its repos from `repos.md`: make and register each repo;
    tooling as `stack.md` names it; CI and yadflow's gates (`yad-checks`); the design system and identity
    (`DESIGN.md`, `yad brand init`); a walking skeleton deployed to the target `stack.md` gives — with none,
    stop and ask.
  - `pack`: run `yad repo features --json`, show the list, and have the person rename, merge, split or leave
    out boundaries before the scope is written; the Scope records the chosen list, Out of scope the rest.
  - Every human-only act (a platform repo, branch protection, CI secrets or variables, deploy credentials, a
    signing key) is written as the person's, with its exact command or steps.
- **R2. `yad-stories`, Step 3**: for a setup epic, one story per bootstrap concern (in order, tagged with its
  repos), or one story per chosen pack boundary: anchor it with a stub epic (`yad-stub`, `yad epic new --stub`),
  document it with `yad-backfill`, then `yad backfill promote EP-<stub> --repo <repo> --feature <feature>` once
  its spec is approved `verified: true` and the person chose light or full; done when the anchor is promoted,
  or the feature is recorded as left out. Human-only acts are acceptance
  criteria the person meets.
- **R3. `yad-discovery`, Step 6**: once the review passes, `yad guide --json` proposes the first epic; the
  agent shows it and runs its command only on the person's yes, or the person picks a roadmap item.
- **R4.** "the Foundation never auto-seeds epics" becomes "the Foundation proposes a first epic, and seeds it
  only on the person's yes" everywhere it appears: `skills/yad-epic/SKILL.md`, `docs/SKILLS.md`,
  `skills/sdlc/config.yaml`, `skills/yad-docs-overview/references/pipeline-model.md`,
  `docs/sdlc-site/src/data/paths.ts`.
- **R5.** Without `seed`, the skills read exactly as before (the new text is conditional on it). No generated
  block (`<!-- generated: … -->`) is edited, and the skill checks pass.

- **R6.** `yad brand init` is named as run only when the person asks (it is `on-request`); registering a repo
  is the `yad-connect-repos` skill's, making it on the platform the person's.

## Clarifications

- **Q1. The stub step.** `yad backfill promote` only promotes a stub (`cli/backfill.mjs`), so a pack story
  first mints one; the epic's architecture and story said "backfill, then promote" without it.

## Non-goals

- Any engine code. The engine writes no `epic.md` or story text (the analysis left out option C).
- Stack-specific scaffolds (option E).

## Tasks

<!-- yad:tasks -->
## T01 — the bootstrap and pack outlines in the skills
**Files:**
- `skills/yad-epic/SKILL.md`
- `skills/yad-stories/SKILL.md`
- `skills/yad-discovery/SKILL.md`
- `skills/yad-docs-overview/references/pipeline-model.md`
- `skills/sdlc/config.yaml`
- `docs/SKILLS.md`
- `docs/sdlc-site/src/data/paths.ts`

**Done when:** R1–R5 hold, `git grep "never auto-seeds"` finds nothing, and `npm test` (with its skill-text
checks) passes.
<!-- /yad:tasks -->
