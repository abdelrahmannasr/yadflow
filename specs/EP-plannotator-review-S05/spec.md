# Spec — EP-plannotator-review-S05: line notes in Plannotator during a Shape review

Story: `EP-plannotator-review-S05` (epic `EP-plannotator-review`), engine repo. Option **B** of the analysis.
Builds on S01 (the `plannotator` toolbox entry, #674). Independent of S02–S04. Skill text only: no CLI change, no
contract surface.

## Problem

A Shape artifact (epic, architecture, stories…) is reviewed as raw Markdown in a PR. Line-level notes are
clumsy there. Plannotator's `/plannotator-annotate <file>` opens the file in a local window where the person
marks lines and leaves notes, which come back to the agent so it can revise the draft. The skills should offer it
when the tool is ready — and say plainly that those notes are not a yadflow record.

## Requirements

- R1. `skills/yad-review-companion/SKILL.md` and `skills/yad-pair-review/SKILL.md` each get a short section,
  "Line notes in Plannotator (Shape, optional)", that applies to a **Shape** artifact only (not a code PR).
- R2. **Only when ready.** The agent offers `/plannotator-annotate epics/<epic>/<artifact>` only when
  `yad toolbox check --json` lists `plannotator` in `used` and has no `findings` entry for it (the Product chose it
  and this machine has it). Otherwise it says nothing about Plannotator.
- R3. **Not a record.** The offer says, in plain words, that the notes go to the agent so it can revise the draft,
  and are **not** a yadflow comment or approval: a comment for the record is `yad gate comment`, and an approval is
  `yad gate approve` (or the review on the PR), both the person's. A Plannotator "Approve" in that window records
  nothing either.
- R4. **Where the agent revises.** Only on the artifact's authoring branch (the branch the review branch was cut
  from), never on the review branch and never in `.sdlc/` files. A revision after the review opened is pushed as
  usual, so the review sees the change.
- R5. **Privacy.** Before anyone shares a Plannotator link, recommend `PLANNOTATOR_SHARE=disabled` (or a
  self-hosted share server): a share sends the artifact to an outside host.
- R6. The skill-fallback check (`node scripts/skill-fallbacks.mjs --check`) and the skill tests pass. The
  toolbox entry's `usedBy` stays `[]`: the offer is conditional text, not a tool the skill needs, so no
  "When a tool is missing" section is generated (that section would say something when the tool is absent).

## Out of scope

- A code PR (`/plannotator-review`): S06 documents it in `yad-engineer-review` as optional.
- Reading Plannotator's notes into the comments ledger (option E, deferred in the epic).

## Clarifications

### Session 2026-11-24
- Q: How does a skill know the tool is ready? → A: `yad toolbox check --json`: `plannotator` in `used` (chosen)
  and no finding for it (present here). The same two facts `inboxReady` checks.
- Q: Add the skills to the toolbox entry's `usedBy`? → A: no (R6).
- Q: Light spec? → A: yes.

## Plan

One task: the same short section in both skills, placed where the Shape review is walked.

## Tasks

<!-- yad:tasks -->
## T01 — Offer line notes in Plannotator during a Shape review, never as a record
**Files:**
- skills/yad-review-companion/SKILL.md
- skills/yad-pair-review/SKILL.md
<!-- /yad:tasks -->
