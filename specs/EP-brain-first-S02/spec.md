# Spec — EP-brain-first-S02: the repo skills give the brain build as the last step of a refresh

Story: `EP-brain-first-S02` (epic `EP-brain-first`), engine repo.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Three skill files and one doc describe a refresh of a repo's code context. Each stops at the publish
(`yad repo refresh --push`). None says that the project brain (`.sdlc/brain/graph.json`,
`yad brain build`) is behind after it, or when to build it again:

- `skills/yad-connect-repos/SKILL.md`: Step 5 offers the first build; the `refresh` action ends at the
  publish.
- `skills/yad-connect-repos/references/code-context.md`: the refresh part ends at the publish.
- `skills/yad-sync-repos/SKILL.md`: Step 7 points the person at `yad repo refresh` and ends at the
  publish.
- `docs/CLI.md`, the brain section: it says when the brain is `behind`, not what to do after a refresh.

## Requirements

- R1. `skills/yad-connect-repos/SKILL.md`, the `refresh` action, gives the order: `yad repo refresh`,
  write the code-map again, the publish when it is run, then `yad brain build` last (`--repo <name>` for
  one repo). It says why: the brain reads the registry and the code-map, so a build before the code-map
  is written again leaves the brain `behind`. It says the build needs no asking and never stops the work.
- R2. The same skill's Step 5 stays an offer for the first build. It points at the `refresh` action for
  the builds after a later refresh.
- R3. `skills/yad-connect-repos/references/code-context.md` says the same order and reason in its
  refresh part.
- R4. `skills/yad-sync-repos/SKILL.md`, Step 7, names `yad brain build` as the step after the refresh
  and the code-map. The refresh stays the person's decision; the hard rules do not change.
- R5. `docs/CLI.md`, the brain section, says the build runs after a refresh, last, and why. The line
  "It never runs the build inside its step" stays, with one sentence that a build after a refresh is not
  inside a step.
- R6. No skill `description:` line changes. No text between yad markers changes.

## Out of scope

Any code or test. The `brain-after-refresh` rule and the output of `yad repo refresh` (S01). The
`brain-first` rule (S03). The brain block in the four skills (S04). The lines "a human decision — flag
and stop, never auto-refresh" in the planning skills.

## Clarifications

### Session 2026-11-23
- Q: Light spec? → A: yes (decided for S01 to S04 when each qualifies: chore route, no contract surface,
  no risk map in this repo).
- Q: Human-only decisions (security, secrets, contract, changes that cannot be undone)? → A: none found.
- Q: Does the text say the brain reads the pack? → A: no. It reads the registry (`.sdlc/repos.json`),
  each code-map and each repo's code graph (`cli/brain.mjs`), never `pack.md` (S01, review 1).
- Q: Where does the publish sit in the order? → A: before the build. The publish stamps the registry,
  which the brain reads. The words match the S01 rule.
- Q: Four files, and a commit is held to three. How is it split? → A: two tasks: the two
  `yad-connect-repos` files, then the sync skill and the doc.
- Q: Is there a test for this text? → A: no test holds it. The description limits in
  `cli/test-agents-file.mjs` and the generated-block checks must still pass.

## Plan

Words only. Each edit adds to the text that is there; no sentence about who decides a refresh changes.

- `skills/yad-connect-repos/SKILL.md`: one sentence at the end of the brain paragraph of Step 5; one
  new bullet part at the end of the `refresh` action.
- `skills/yad-connect-repos/references/code-context.md`: one short paragraph after the refresh part.
- `skills/yad-sync-repos/SKILL.md`: two sentences at the end of Step 7.
- `docs/CLI.md`: one paragraph after "When is it current?"; one sentence in the `behind` bullet.

Check: `node scripts/agent-guide.mjs --check`, `node scripts/brain-skills.mjs --check`,
`node cli/test-agents-file.mjs`, then `yad run checks`.

## Tasks

<!-- yad:tasks -->
## T01 — Give the brain build as the last step of a refresh in the connect-repos skill
**Files:**
- skills/yad-connect-repos/SKILL.md
- skills/yad-connect-repos/references/code-context.md

## T02 — Name the brain build after a refresh in the sync skill and the command reference
**Files:**
- skills/yad-sync-repos/SKILL.md
- docs/CLI.md
<!-- /yad:tasks -->
