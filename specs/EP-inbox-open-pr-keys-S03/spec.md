# Spec — EP-inbox-open-pr-keys-S03: the skills and docs say what the Inbox keys and yad open-pr now do

Story: `EP-inbox-open-pr-keys-S03` (epic `EP-inbox-open-pr-keys`), engine repo. Documentation only: it describes
S01 (#686, the keys) and S02 (#688, `yad open-pr --json`). No code, no surface change.

## Problem

Four passages still describe the code before this epic:
- `skills/yad-run/SKILL.md`: the main halt command has no `--task`, though on a task's first walk the halt key can
  only name the task from it; and "Its `key` names the story, step and repo".
- `skills/yad-review-gate/SKILL.md`, "The review in the Inbox": "`yad open-pr` on a review branch adds no `inbox`".
- `docs/CLI.md`, "The Plannotator Inbox: the `inbox` field": "four commands" twice; the `gate open` row says
  `yad open-pr` adds none; the `key` row gives the old patterns.

## Requirements

- R1. `skills/yad-run/SKILL.md`, step 4 "HALT": the command is
  `yad build step <story> --repo <repo> <step> blocked [--task <task>] --reason "<the halt cause>"`, with a
  sentence: pass `--task` (the task being walked) for `implement` and `checks`. "The halt in the Inbox": the key
  names the story, step, repo and, for `implement` and `checks`, the task, so a second halt of the same step and
  task replaces the first, and a halt on another task gets its own message.
- R2. `skills/yad-review-gate/SKILL.md`: the last sentence of "The review in the Inbox" is replaced: run from the
  review branch as `yad open-pr --json`, the open gives the same `review` message, with the same key, so post it
  the same way, once.
- R3. `docs/CLI.md`, "The Plannotator Inbox: the `inbox` field":
  - "four commands" (the intro and "When it appears") become "five commands";
  - the `gate open` row loses "but adds no `inbox`", and a new row follows it:
    `yad open-pr --json`, on the Product from a `review/EP-<slug>/<base>` branch | the review PR/MR was opened |
    the same `review` as `yad gate open` gives, with the same key;
  - the `key` row gives the four patterns (`hand-off:<epic>:<step>:<act>`, `halt:<story>:<step>:<repo>:<task>`,
    `review:<epic>:<base>:gate`, `review:<repo>:<pr>:nudge`), says a missing part is `-`, and what `<task>` and
    `<base>` are.
- R4. `node scripts/skill-fallbacks.mjs --check` and `node scripts/agent-guide.mjs --check` pass (regenerate
  anything they name); `npm test` passes.

## Out of scope

- Release notes (semantic-release writes them from the commit subjects).

## Plan

The skills (T01), then the docs (T02).

## Tasks

<!-- yad:tasks -->
## T01 — The yad-run and yad-review-gate skills describe the halt key's task and yad open-pr's message
**Files:**
- skills/yad-run/SKILL.md
- skills/yad-review-gate/SKILL.md

## T02 — docs/CLI.md lists yad open-pr and the key pattern for each kind
**Files:**
- docs/CLI.md
<!-- /yad:tasks -->
