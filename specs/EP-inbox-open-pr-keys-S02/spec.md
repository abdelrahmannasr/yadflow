# Spec — EP-inbox-open-pr-keys-S02: yad open-pr on a review branch carries the review message

Story: `EP-inbox-open-pr-keys-S02` (epic `EP-inbox-open-pr-keys`), engine repo. Implements the `yad open-pr --json`
row of the re-locked contract (lock `sha256:bed4cf42…`).

## Problem

On the Product, from a `review/EP-<slug>/<base>` branch, `yad open-pr` pushes the branch and opens the review PR
through `gateOpen` (`cli/openpr.mjs`, the `product-shape` branch). It passes neither `json` nor the folder to look
from, and `bin/yad.mjs` gives `runOpenPr` neither. So `yad open-pr --json` never has `inbox`, and the reviewer
never gets the message `yad gate open --json` would give. Since S01, that message's key names the branch base
(`review:<epic>:<base>:gate`), so a per-story review (`stories-S01`) now gets its own key through this path.

## Requirements

- R1. `bin/yad.mjs` (`open-pr`) passes `json: !!o.json` and `cwd: toolboxAt?.from ?? null` to `runOpenPr`, as the
  other commands do (`open-pr` is in `REPO_CMDS`, so `toolboxAt` is worked out for it).
- R2. `runOpenPr` (`cli/openpr.mjs`) passes `json` and `cwd` to `gateOpen` in the `product-shape` branch only.
  Nothing else in `runOpenPr` reads them, so a code-repo task PR is unchanged. `runShip` (`cli/ship.mjs`) still
  calls `runOpenPr` without `json`, so `yad ship` is unchanged.
- R3. `cli/gate.mjs`: the comment above `gateOpen` no longer says "never `open-pr`'s delegation".
- R4. With the Inbox not ready, a failed push or create, or a PR that already exists: no `inbox`, and the exit code
  is what it was (`gateOpen` builds the message only after a URL came back).
- R5. Tests (`cli/test-inbox.mjs`), through the CLI, in the `inboxWorkspace` pattern (an empty HOME, a PATH of
  linked `node`, `git` and `which` plus a fake `gh`, `isolatedEnv`, a local bare `origin`):
  - TC-06: on `review/EP-x/architecture`, `yad open-pr --json` → `inbox` with one `review` message, key
    `review:EP-x:architecture:gate`, the PR URL in `links`, the notice.
  - TC-07: the same workspace twice: `yad gate open EP-x architecture --json` in one and `yad open-pr --json` in the
    other → deep-equal `inbox` blocks.
  - TC-08: Plannotator not chosen → no `inbox`; the JSON with `inbox` removed equals the chosen run's.
  - TC-09: a fake `gh` whose `pr create` fails → no `inbox`, exit code 1.
  - TC-10: from the workspace's code repo on a task branch, `yad open-pr --json` → no `inbox`. `yad ship` is checked
    by reading (it needs a staged commit and a story): `runShip` calls `runOpenPr` without `json`. Mutation check,
    once by hand: removing the wiring in `bin/yad.mjs` or `cli/openpr.mjs` makes TC-06 fail.

## Out of scope

- `yad ship --json` on a review branch (architecture: out of scope).
- Skills and `docs/CLI.md` (S03).

## Plan

The wiring (T01), then the CLI tests (T02).

## Tasks

<!-- yad:tasks -->
## T01 — yad open-pr passes --json and the folder to look from to yad gate open
**Files:**
- bin/yad.mjs
- cli/openpr.mjs
- cli/gate.mjs

## T02 — Prove yad open-pr --json on a review branch through the CLI
**Files:**
- cli/test-inbox.mjs
<!-- /yad:tasks -->
