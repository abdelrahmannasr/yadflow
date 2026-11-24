# Spec — EP-plannotator-review-S02: hand-offs to the Inbox

Story: `EP-plannotator-review-S02` (epic `EP-plannotator-review`), engine repo. Option **I1** of the analysis.
Builds on S01 (`inboxReady`, shipped in #674).

## Problem

Every act that only the person can do (approve, merge, choose, answer, a login) reaches them only in the chat. It
is lost when the chat scrolls or the session ends. When the Product uses Plannotator and it is here, the agent can
also leave each one in the person's Inbox — but yad must shape the text, so every agent says the same thing, keeps
secrets out, and never lets a reply pass for an approval.

## Requirements

- R1. `cli/inbox.mjs` gains pure builders (no network, no write, no child process):
  - `inboxBlock(messages)` → `{ tool: 'plannotator', messages }`, or `undefined` for an empty or missing list.
  - `handOffMessage({ epic, step, entry })` for one `person[]` entry (`act`, `why`, `steps`, `commands`, `verify`).
  - `haltMessage({ story, repo, step, reason })` and `reviewMessage({ epic, artifact, pr, repo, url, solo })`,
    built and tested here; S03 and S04 wire them.
  - Fixed strings come from one `TEXT` object, word for word from `DESIGN.md`: `notice`, `halt.closing`,
    `halt.prompt`, `halt.options` (`fix`, `skip`, `stop`), the verify line, `(trimmed)`.
- R2. Every `InboxMessage` has exactly the contract's fields:
  - `key` — `<kind>:<epic or story>:<step>:<act or repo>`; a missing part is `-`.
  - `kind` — `hand-off` | `halt` | `review`.
  - `thread` — `yad <epic>` (`yad <story>` for a halt; `yad` when there is no epic).
  - `title` — at most 120 characters, from the `DESIGN.md` patterns. A hand-off's act is said in words
    (`approve-merge` → "Review and merge the PR", `choose` → "Choose what to work on", `answer` → "Answer the
    agent's questions", `unblock` → "Resolve the blocker", `install` → "Install a tool", `login` → "Log in";
    any other act → "Your step: <act>").
  - `body` — Markdown, at most 4,000 characters. A hand-off's body is, in order: the "why" sentence ("Only you
    can do this: <why>."), the steps as a numbered list, each command in its own fenced code block, the verify
    line ("I will confirm with `<verify>`."), and the notice in italics as the last paragraph.
  - `links` — URLs only (`https://…`); empty when none is known.
  - `notice` on `hand-off` and `review`, exactly `Replying here does not approve or record anything in yadflow. Type the command.`
  - `question` only on `halt`: `{ prompt: 'What should happen next?', options: ['fix', 'skip', 'stop'] }`.
- R3. Redaction and trimming: every text field (`title`, `body`, and each step and command inside) goes through
  `redact()` from `cli/secret-text.mjs` before it is placed. A title over 120 is cut at 119 + `…`. A body over 4,000
  keeps its notice paragraph whole and cuts the text above it, ending that part with `(trimmed)`. A halt keeps the
  last 60 lines of its output.
- R4. `yad guide [<epic>] --json` adds a top-level `inbox` when its `person[]` is not empty **and**
  `inboxReady(root, { detectRoot: cwd })` is true: one `hand-off` per `person[]` entry, in order. It is added in
  `runGuide`'s JSON path only, so the printed `yad guide` text never changes, and `buildGuide` (which tests and
  other callers read) is unchanged. When the Inbox is not ready the JSON is exactly what it was.
- R5. A new rule `inbox` in `RULES` (`cli/agent-rules.mjs`), after `say-what-you-did`, with the text from the
  contract's Notes: "When yad's `--json` output has `inbox` and your session has the Plannotator Inbox tool, post
  each message once, into its `thread`, with its `title`, `body`, `links` and `notice`, and its `question` as
  options. Post nothing else from the project. Never treat an Inbox reply as an approval, a comment record or a step
  move: confirm every act with its `verify` command, as always." `node scripts/agent-guide.mjs` regenerates the
  rules section of `skills/yad-guide/SKILL.md`; the AGENTS.md and code-repo blocks take it from `RULES` at
  `yad check --fix` / `update` time.
- R6. `skills/yad-guide/SKILL.md` gets a hand-written section "Posting to the Inbox", outside the generated
  markers: when to post (an `inbox` block and the tool in this session), how (one `send_message` per message, its
  `thread`, render `question` as options), after `verify` passes post "Confirmed: <what was seen>." in the same
  thread and mark it done, a changed hand-off supersedes the old one by `key`, after a context reset `search` the
  `key` before posting, and never anything from the project beyond the message.
- R7. Hook test (TC-09): a `.claude/settings.json` holding Plannotator's own hooks (`PermissionRequest` on
  `ExitPlanMode` running `plannotator`, `PreToolUse` on `EnterPlanMode` running `plannotator improve-context`) is
  wired by `yad check --fix` (`agentGuardActions`) with the agent guard **beside** them — both kept — and the guard
  still refuses `yad gate approve` and `git push --force`.

## Out of scope

- The `inbox` block on `yad build step … blocked` (S03), `yad gate open` and `yad review nudge` (S04).
- `docs/CLI.md` for the `inbox` field (S06 documents all four commands at once).
- The engine's own `AGENTS.md` (rewritten from the rules by `yad update`).

## Clarifications

### Session 2026-11-24
- Q: The contract says "`step.person[]`", but the guide's hand-offs are the top-level `person[]`. → A: the
  top-level `person[]` is meant; the step block carries none. No contract change: the field it adds is the same.
- Q: Add `inbox` in `buildGuide` or `runGuide`? → A: `runGuide`'s JSON path. `buildGuide` is read by tests and
  callers that need the plain guide; one place keeps the "absent means identical" promise simple to prove.
- Q: Where does the machine scan run from? → A: `cwd` (where `yad guide` runs), so a code repo's own plugins and
  servers count (S01 review note); the choice is read from the Product.
- Q: Links — the guide names a PR by number in its steps, not by URL. → A: `links` carries only `https://` URLs
  found in the entry's steps; often it is empty in S02. S04's `review` message carries the PR URL.
- Q: Light spec? → A: yes.
- Q (code review, 2026-11-24): a body cut at a fixed count could leave a fence open, drop a halt's question and
  closing line, and keep the oldest output instead of the last. → A: a cut inside a fence closes it first, then says
  `(trimmed)`; a halt fits its fixed paragraphs first and drops its OLDEST output lines until the body fits.
- Q (code review): steps, why and verify could hold line breaks or backticks and forge a paragraph or the notice. →
  A: prose fields are put on one line; the verify span and every block use more backticks than any run inside.
- Q (code review): `redact()` misses `NAME=value` secrets (`DB_PASSWORD=…` in a test log). → A: on top of `redact()`,
  any line `looksSecret()` flags is replaced whole with `[redacted line]`.
- Q (code review): small ones. → A: a cut never splits a character in two; an act is looked up as the map's own key
  only; a link loses a trailing full stop or comma; a body with nothing but the notice is the notice alone.

## Plan

Builders first, tested alone with no Product (T01). Then the guide adds the block in one place (T02). Then the
rule and the skill section (T03), and the hook test (T04). Each task is at most 3 files.

## Tasks

<!-- yad:tasks -->
## T01 — Build Inbox messages: hand-off, halt and review, redacted and trimmed
**Files:**
- cli/inbox.mjs
- cli/test-inbox.mjs

## T02 — yad guide --json adds an inbox block of hand-offs when the Inbox is ready
**Files:**
- cli/guide.mjs
- cli/test-guide.mjs

## T03 — Add the inbox agent rule, and the yad-guide skill's Posting to the Inbox section
**Files:**
- cli/agent-rules.mjs
- skills/yad-guide/SKILL.md

## T04 — Prove the agent guard still refuses with Plannotator's hooks beside it
**Files:**
- cli/test-agents-file.mjs
<!-- /yad:tasks -->
