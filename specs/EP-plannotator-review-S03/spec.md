# Spec — EP-plannotator-review-S03: Build halts to the Inbox

Story: `EP-plannotator-review-S03` (epic `EP-plannotator-review`), engine repo. Option **I2** of the analysis.
Builds on S01 (`inboxReady`, #674) and S02 (`haltMessage`, `inboxBlock`, #675).

## Problem

When `yad-run` halts a Build step (a failing check, a scope overrun, a contract touch), the person learns it only
in the chat. When the Product uses Plannotator and it is here, the agent can also leave the halt in the person's
Inbox, with the reason, the failing output and a fix / skip / stop question. The answer steers what the agent
proposes; it never moves the step.

## Requirements

- R1. `yad build step <story> --repo <r> <step> blocked --reason <text> --json` adds a top-level `inbox` holding
  exactly one `halt` message (`haltMessage({ story, repo, step, reason })` from S02, wrapped by `inboxBlock`)
  when the move succeeds **and** `inboxReady(root, { detectRoot: cwd })` is true. `cwd` is the folder the
  person ran yad in (`toolboxAt.from` in `bin/yad.mjs`, the same folder `check` and `update` look for tools in),
  so a code repo's own plugins and servers count; the choice is read from the Product.
- R2. Only on the JSON path and only for `blocked`: a move to `in_progress`, `in_review` or `done`, a move that
  is already done, and the printed (not `--json`) command never add it and never scan the machine.
- R3. A failed move (a refused halt, a missing reason, a wrong step) throws before any `inbox` is built, so it
  adds none.
- R4. When the Inbox is not ready, the JSON is byte-for-byte what it was (a test compares it with the output of
  the same move with the feature off).
- R5. No new flag. The `--reason` text is the source: its first line is the "Why", the lines after it are the
  output block (the last 60, redacted, `(trimmed)` when cut). A one-line reason shows no output block. The
  stored `record.reason` is unchanged (the whole trimmed text, as today).
- R6. The message is S02's `haltMessage`, unchanged: title `Build halted — <story> in <repo>: <step>`, the
  question `{ prompt: 'What should happen next?', options: ['fix', 'skip', 'stop'] }` in that order, the
  closing line, and no `notice`.
- R7. `skills/yad-run/SKILL.md`, at the HALT step, says what to do with the `inbox` block and the answer:
  - post the message once, as the yad-guide skill's "Posting to the Inbox" says (its `key` is
    `halt:<story>:<step>:<repo>`, so a second halt of the same step supersedes the first);
  - `fix` → propose the fix in the chat (what, which files, inside the task's declared files); do it only on the
    person's go-ahead, then run the checks again;
  - `skip` → yad cannot skip one Build step. Say so. A whole lane can be skipped with
    `yad skip <epic> <story> --repo <r> --reason "<why>"` only before any work started in it, which a halted lane
    is past, so offer `fix` or `stop` instead. Never run `yad skip` yourself (it is `on-request`);
  - `stop` → do nothing more on this story; wait;
  - in every case, never run `yad build step … in_progress` (or any move of that step) until the person says
    the halt is resolved (`build-halts` rule). Then move it as today and post "Resumed." in the same thread.

## Out of scope

- `yad gate open` and `yad review nudge` (S04); `docs/CLI.md` for the `inbox` field (S06).
- A real one-step skip in yad: the option keeps its contract word `skip`, and the skill says what yad allows.

## Clarifications

### Session 2026-11-24
- Q: The story says on `skip`, "give the person the exact `yad skip …` command". But `yad skip` refuses a single
  Build step ("No single Build step can be skipped") and refuses a lane once work started. → A: the skill says
  this plainly and offers `fix` or `stop`; it never gives a command yad will refuse. The option stays in the
  message (the contract fixes the three options). To be raised at the engineer review as a possible change
  request (a step-level skip), not built here.
- Q: Which folder is scanned for the tool? → A: where yad ran (`toolboxAt.from`), as for `yad guide` (S02); the
  Product's choice decides whether it counts.
- Q: Build the block in `planStep` (pure) or `buildStep`? → A: `buildStep`, after the write succeeded and only
  when `json` is set; `planStep` stays pure and unchanged.
- Q: Light spec? → A: yes.

## Plan

`buildStep` gains `{ json, cwd, ready = inboxReady }`, and after a successful `blocked` move adds
`inbox: inboxBlock([haltMessage(…)])` when ready. `bin/yad.mjs` passes `json: o.json` and `cwd: toolboxAt?.from`.
Tests in `cli/test-build.mjs` with an injected `ready` (T01). Then the skill text (T02).

## Tasks

<!-- yad:tasks -->
## T01 — yad build step … blocked --json adds the halt message when the Inbox is ready
**Files:**
- cli/build.mjs
- bin/yad.mjs
- cli/test-build.mjs

## T02 — The yad-run skill posts the halt and turns the answer into a proposal, never a move
**Files:**
- skills/yad-run/SKILL.md
<!-- /yad:tasks -->
