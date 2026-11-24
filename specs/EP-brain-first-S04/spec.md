# Spec — EP-brain-first-S04: the brain block in the four skills says "brain first"

Story: `EP-brain-first-S04` (epic `EP-brain-first`), engine repo.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Four skills (`yad-architecture`, `yad-stories`, `yad-spec`, `yad-implement`) carry the block "Ask the
project brain (E179)", built by `brainBlockLines` in `cli/brain-skills.mjs` and written by
`node scripts/brain-skills.mjs`. The block says what to ask the brain. It does not say that the brain is
asked before the agent searches or reads files for the same answer. The `brain-first` rule (S03) now
says so for all agent work; the block should say the same thing.

## Requirements

- R1. The block holds one more paragraph, "Brain first", after its opening paragraph. It says: for the
  questions the block asks, ask the brain before searching the repo or reading files, the pack or the
  code-map for the same answer; go to those only when the brain has no answer (it is none, the answer is
  empty, or the command refuses or is declined); what a file contains is not a brain question.
- R2. Everything the block says today stays, word for word: the brain is optional, "never stop for it",
  "Do not run it inside this step", "never lifts a rule above", the three states, and each skill's asks.
- R3. The blocks in the four `SKILL.md` files are written by `node scripts/brain-skills.mjs`; `--check`
  exits 0. Only those four skills hold the block.
- R4. Tests: `cli/test-brain.mjs` holds the new words with one more pattern for each of the four blocks.
  Every pattern it holds today still passes.
- R5. Each commit passes the tests and holds at most 3 files.

## Out of scope

The `brain-first` rule (S03). Where each skill places its block. The order of a skill's own steps: a
skill that reads the code-maps before its block still does. The pre-approved command list.

## Clarifications

### Session 2026-11-23
- Q: Light spec? → A: yes (decided for S01 to S04 when each qualifies: chore route, no contract surface,
  no risk map in this repo).
- Q: Human-only decisions (security, secrets, contract, changes that cannot be undone)? → A: none found.
- Q: Does "before reading the code-map" undo a skill's own step that loads the code-maps first? → A: no.
  The paragraph is about the questions the block asks ("for the same answer"), and the block's line
  "It never lifts a rule above" stays. This matches the S03 rule: it adds to a skill's steps.
- Q: One source file, four generated files and a test are six files, and a test fails while a block
  differs from its source. How is it split? → A: in four steps, each one passing:
  1. the source learns the paragraph, written only for a skill marked `brainFirst` (none yet);
  2. two skills are marked and written again;
  3. the other two are marked and written again;
  4. the mark is taken out: the paragraph is in every block. No skill file changes in this step.
- Q: "The questions in step 2": which step 2 (review 1)? → A: the block's own list. Each skill also has a
  heading "Step 2", so the paragraph now says `under "2. Ask it" below`.
- Q: Two skills load the code-maps before the block. Does the paragraph clash with that (review 1)? → A: no,
  and it now says so: the skill's own steps still stand, and a code-map a step above already loaded
  stays loaded. It also says that after a declined prompt the brain is not asked again in the session,
  as the S03 rule does.
- Q: How are the new words split into commits (review 1)? → A: the same way as before: the source learns
  the new words for a marked skill (T05), two skills at a time are marked and written (T06, T07), then
  the mark and the old words are taken out, with a sentence in `docs/CLI.md` (T08).

## Plan

`cli/brain-skills.mjs`: an exported constant, `BRAIN_FIRST_LINE`, and in `brainBlockLines` the paragraph
after the opening one. During tasks T01 to T03 it is written when the skill's entry in `BRAIN_SKILLS` has
`brainFirst: true`; T04 writes it always and drops the mark. `cli/test-brain.mjs`: T01 holds the
constant's words; T04 holds them in each of the four blocks.

Check after each task: `node scripts/brain-skills.mjs --check`, `node cli/test-brain.mjs`.

## Tasks

<!-- yad:tasks -->
## T01 — Teach the brain block the "Brain first" paragraph, for a marked skill
**Files:**
- cli/brain-skills.mjs
- cli/test-brain.mjs

## T02 — Write the paragraph into the architecture and stories skills
**Files:**
- cli/brain-skills.mjs
- skills/yad-architecture/SKILL.md
- skills/yad-stories/SKILL.md

## T03 — Write the paragraph into the spec and implement skills
**Files:**
- cli/brain-skills.mjs
- skills/yad-spec/SKILL.md
- skills/yad-implement/SKILL.md

## T04 — Write the paragraph in every block, and hold it with a test
**Files:**
- cli/brain-skills.mjs
- cli/test-brain.mjs

## T05 — Teach the block the clearer Brain first words, for a marked skill (review fixes)
**Files:**
- cli/brain-skills.mjs
- cli/test-brain.mjs

## T06 — Write the clearer words into the architecture and stories skills
**Files:**
- cli/brain-skills.mjs
- skills/yad-architecture/SKILL.md
- skills/yad-stories/SKILL.md

## T07 — Write the clearer words into the spec and implement skills
**Files:**
- cli/brain-skills.mjs
- skills/yad-spec/SKILL.md
- skills/yad-implement/SKILL.md

## T08 — Keep only the clearer words, and say brain first in the command reference
**Files:**
- cli/brain-skills.mjs
- cli/test-brain.mjs
- docs/CLI.md
<!-- /yad:tasks -->
