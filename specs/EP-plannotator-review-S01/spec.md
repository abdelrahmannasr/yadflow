# Spec — EP-plannotator-review-S01: Plannotator in the toolbox, and `inboxReady`

Story: `EP-plannotator-review-S01` (epic `EP-plannotator-review`), engine repo. Option **A** of the analysis.

## Problem

yadflow does not know Plannotator. A Product cannot choose it, `yad toolbox check` cannot say whether it is
ready here, and the later stories (S02–S05) have no single answer to "is the Inbox ready?". Without that
answer, the `inbox` block in `--json` output could not be shown only when it should be (architecture D2).

## Requirements

- R1. A `plannotator` entry in `TOOLBOX` (`cli/toolbox.mjs`), in the recommended group, after `docker-mcp`:
  - `name: 'Plannotator'`, `tier: 'recommended'`, `role`: a local review page and Inbox for agents
    (plan review, line notes on files, and messages an agent leaves for you).
  - `licence: 'Apache-2.0 OR MIT'`, `source: 'https://github.com/backnotprop/plannotator'`, `checked: '2026-11-24'`.
  - `vetted`: `on: '2026-11-24'`, `licenceFrom` (the repo's `LICENSE-APACHE` blob URL), `source`,
    `release: 'v0.29.3'`, `packages: []`, and a note: the repo carries both licence files; the
    `plannotator` program ships as signed GitHub release binaries (SLSA provenance since v0.17.2).
  - `install`: `{ type: 'script', command: 'curl -fsSL https://plannotator.ai/install.sh | bash -s -- --version v0.29.3 --verify-attestation --skip-claude-plugin' }`
    and `{ type: 'plugin', command: '/plugin marketplace add backnotprop/plannotator, then /plugin install plannotator@plannotator' }`.
  - `manual: null`.
  - `detect: { bins: ['plannotator'], plugins: ['plannotator'], mcp: ['plannotator-inbox'] }` — exactly the
    contract's toolbox row.
  - `versions: null`.
  - `fallback: 'nothing changes: hand-offs, Build halts and review notices stay in the chat'` (no full stop).
  - `records: null` (no skill records a line for it).
  - `note`: set `PLANNOTATOR_SHARE=disabled` (a share link sends the page to Plannotator's host); never put a
    secret in a message; the plugin's hook runs the `plannotator` program, so both are needed.
  - `usedBy: []` (S02–S05 add the commands and skills that use it).
- R2. A recipe `RECIPES.plannotator` (`cli/toolbox-connect.mjs`), in this order:
  1. a person step: the same pinned installer as R1. Why: `SCRIPT` (a remote install script is yours).
  2. a person step: `claude plugin marketplace add backnotprop/plannotator`. Why: it adds a plugin source
     from outside the official marketplace to your agent, and trusting it is your choice.
  3. an agent step: `claude plugin install plannotator@plannotator`.
  4. a person step (text): restart your agent. Why: an agent loads a new plugin's hooks when it starts.
  `recipeProblems` reports nothing: the only agent step holds no download, pipe, `@latest` or second command.
- R3. A new module `cli/inbox.mjs` with `inboxReady(productRoot, { detectRoot = productRoot, items = null, has = onPath } = {})`:
  true only when the Product's choices put `plannotator` in use (`toolUse(...).used`, which for a
  recommended tool means `.sdlc/toolbox.json` `shipped.plannotator: "use"`) **and** `toolStatus` says
  `installed`. It reuses `toolboxRows` with `tools: [plannotator]`. No Product → false. A plugin that the
  settings turn off is `disabled`, not installed → false. The module has no network, no write and no child process.
- R4. `docs/CLI.md`: the `yad toolbox list` row names Plannotator among the recommended tools; the toolbox
  section gains its row and the privacy note (`PLANNOTATOR_SHARE=disabled`).
- R5. Tests:
  - the entry passes `toolProblems` and `vettingProblems`, is listed under Recommended, is found by each of
    its three signals (and the MCP name in any case), and `yad toolbox add plannotator` records `use`;
  - `connectPlan('plannotator')` gives the four steps in order, one `agent` step, `ask` naming the script
    as yours, and the `verify` command; `recipeProblems` is empty;
  - `inboxReady` for the four combinations (chosen × installed), a disabled plugin, and no Product;
  - the existing toolbox tests still pass unchanged.

## Out of scope

- The `inbox` output block and its builders (S02–S04). `cli/inbox.mjs` starts with `inboxReady` only.
- Any skill text (S02, S03, S05) and the engineer-review docs (S06).

## Clarifications

### Session 2026-11-24
- Q: The story says "install through the plugin marketplace, never `curl | bash`", but the plugin's hook runs
  the `plannotator` program, which only its install script installs. How is it installed? → A (the person,
  2026-11-24): the person runs the pinned, signature-checked script and adds the marketplace; the agent
  installs the plugin. So **the agent never runs a script**, which is what the story's rule protects. This is
  the same shape as Maestro's recipe, and `docs/CLI.md` already says "a remote install script … is yours".
- Q: Pin the plugin too? → A: a marketplace plugin cannot be pinned by the install command. The program is
  pinned (`--version v0.29.3`) and `--skip-claude-plugin` stops the script from updating the plugin. The
  plugin follows the marketplace, which `vetted.note` says.
- Q: Is `plannotator-inbox` the plugin's MCP server name? → A: not confirmed. It is the name Plannotator's
  docs give a server you add yourself (`claude mcp add … plannotator-inbox -- plannotator inbox mcp`). It is
  one of three signals; the program on PATH (`bins`) is the one every install has.
- Q: Light spec? → A: yes. One `spec.md` holds the spec, the plan and the tasks.

## Plan

The entry and recipe copy the `docker-mcp` and `maestro` patterns. `inboxReady` asks the existing toolbox
code (`toolboxRows`, `toolUse`, `toolStatus`), so "chosen" and "found" mean exactly what `yad toolbox list`
shows. Tests go beside the code they test: the entry in `cli/test-detect.mjs` (next to the `docker-mcp`
test), `inboxReady` in a new `cli/test-inbox.mjs`, added to the `test` script.

## Tasks

<!-- yad:tasks -->
## T01 — Add Plannotator to the toolbox, with its connect recipe
**Files:**
- cli/toolbox.mjs
- cli/toolbox-connect.mjs
- cli/test-detect.mjs

## T02 — Add inboxReady: Plannotator is chosen here and found on this machine
**Files:**
- cli/inbox.mjs
- cli/test-inbox.mjs
- package.json

## T03 — Document Plannotator in the toolbox docs
**Files:**
- docs/CLI.md
<!-- /yad:tasks -->
