# Spec — EP-footprint-S01: shorten every yad-* skill description

Story: `EP-footprint-S01` (epic `EP-footprint`), engine repo. Product issue #240.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

An AI agent loads the `description:` of every installed skill into its context in every session, even a
session with no yadflow work. The 42 `yad-*` descriptions hold 31,438 characters together (measured on
engine `28240fdd`); the longest, `yad-product-bridge`, holds 1,019. Most of that text is detail the agent
only needs once the skill is loaded: file names, flags, error codes and step numbers.

## Requirements

- R1. Every `skills/yad-*/SKILL.md` description is 1–2 sentences: what the skill does, then its
  "Use when the user says…" phrases. No file names, flags or error codes.
- R2. The detail a description drops stays in that skill's body. When the body does not already say it,
  at most one sentence is added at the end of the skill's intro paragraph (see Clarifications).
- R3. Every trigger phrase in today's descriptions is still in the new description, word for word. The
  PR lists, per skill, the phrases before and after.
- R4. The test in `cli/test-agents-file.mjs` ("every skill's description fits…") checks: each `yad-*`
  description ≤300 characters, and all of them together ≤10,000. It fails when a skill has no one-line
  `description:`, instead of skipping it.
- R5. With one description made 301 characters long, the test fails and names the skill.
- R6. The stale "41 skills" count is corrected to 42 in `package.json` (description), `README.md`,
  `docs/SKILLS.md`, `TEAM-GUIDE.md` and the comment in `cli/next.mjs`.

## Acceptance criteria (copied from the story)

- [ ] Every `skills/yad-*/SKILL.md` description is 1–2 sentences: what the skill does, then its "Use when the user says…" phrases. No file names, flags or error codes.
- [ ] The detail a description drops is kept in that skill's body (a short "What this skill does" paragraph near the top) unless the body already says it.
- [ ] Every trigger phrase in today's descriptions is still in the new description. The story's PR lists, per skill, the phrases before and after (a short table or a script's output).
- [ ] The existing test in `cli/test-agents-file.mjs` ("every skill's description fits…") checks: each `yad-*` description ≤300 characters, and all of them together ≤10,000. It fails when a skill has no one-line `description:`, instead of skipping it.
- [ ] Test: make one description 301 characters long; the test fails and names the skill.
- [ ] The stale "41 skills" count is corrected to the real number in `package.json` (description), `README.md`, `docs/SKILLS.md`, `TEAM-GUIDE.md` and the comment in `cli/next.mjs`.

## Out of scope

- Any change to a skill body beyond the one sentence R2 allows. No text between yad markers
  (`<!-- generated: … -->` … `<!-- end: … -->`) changes, and no block is added at the top of a body:
  story EP-footprint-S02 adds a generated block there.
- The `skills/sdlc` module folder (it has no `SKILL.md`).
- Any change to how skills are installed (`cli/manifest.mjs`).

## Clarifications

### Session 2026-11-21
- Q: Human-only decisions (security trade-offs, secrets, contract changes, changes that cannot be undone)? → A: none — the story edits skill text, one test and a count.
- Q: Where does dropped detail go, given S02 edits the top of each body at the same time? → A: at most one sentence at the end of the skill's intro paragraph, and only when the body does not say it already. No new "What this skill does" block, so the two stories do not edit the same lines.
- Q: The rewrite spans 42 files, over the 3-file atomic guard. → A: the person allowed `yad commit --force` for the description-rewrite tasks only. The test and count tasks stay ≤3 files each.

## Checklist

- [x] Every requirement traces to an acceptance criterion.
- [x] No contract surface; no `contracts/` folder.
- [x] Each task declares its files.
- [x] The tasks keep CI green one by one: the stricter test lands last, after every description fits it.
