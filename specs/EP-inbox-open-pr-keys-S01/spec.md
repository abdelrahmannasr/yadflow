# Spec — EP-inbox-open-pr-keys-S01: each halt of a task and each review PR has its own Inbox key

Story: `EP-inbox-open-pr-keys-S01` (epic `EP-inbox-open-pr-keys`, a contract-surface change threaded off
`EP-inbox-guide-scan`), engine repo. Implements the `halt` and gate `review` rows of the re-locked contract's
`key` patterns (lock `sha256:bed4cf42…`).

## Problem

An agent replaces an Inbox message that has the same `key`. Two keys are too coarse today:
- `halt:<story>:<step>:<repo>` (`cli/inbox.mjs` `haltMessage`). `implement` and `checks` are walked once per task
  (`PER_TASK`, `cli/build.mjs`), so a halt on T02 has the key of the halt on T01 and replaces it.
- `review:<epic>:<artifact>:gate` (`reviewMessage`, built by `gateOpen` in `cli/gate.mjs`). The artifact is the
  ledger's path, which is `stories/` for every story, so two stories' review PRs share one key.

## Requirements

- R1. `haltMessage` takes `task`. Its key is `keyOf('halt', story, step, repo, task)`: a fifth part, `-` when
  `task` is missing. No other field changes.
- R2. `reviewMessage` takes `base`. For a gate review (`artifact` given) the key's third part is `base`, and when
  `base` is not given it is `artifactBase(artifact)` (`cli/epic-state.mjs`: `epic.md` → `epic`, `stories/` →
  `stories`). The title and body still name `artifact`. The nudge key (`repo`, `pr`) is unchanged.
- R3. `buildStep` (`cli/build.mjs`) passes the halt a task only for a step in `PER_TASK`: the `--task` given (not
  `true`), else the `task` the lane's step holds after the move, else none. For any other step, none, even when
  `--task` is given.
- R4. `gateOpen` (`cli/gate.mjs`) passes `base: parseReviewBranch(branch)?.base` (the branch it opened, which is
  `head` when `yad open-pr` gave one). The comment above `gateOpen` names the key.
- R5. With the Inbox not ready, no output changes (the builders run only when it is ready).
- R6. Tests:
  - `cli/test-inbox.mjs`: TC-01 (halt key with a task, and `-` without); TC-04 unit (two `stories-S0N` bases →
    two keys; no `base` → `artifactBase`); TC-05 (with and without the new parts, every field but `key` is the
    same; hand-off and nudge keys unchanged); the existing key assertions updated
    (`review:EP-x:architecture:gate`, and the TC-04 CLI part: `yad gate open … --json` through the CLI).
  - `cli/test-build.mjs`: TC-02 (`implement` halts with `--task T01`, then a reopened `implement` for T02 with and
    without `--task` → `:T01`, `:T02`; a first walk with no task → `:-`); TC-03 (`spec` with `--task T02` → `:-`);
    the existing `halt:EP-l-S01:spec:api` assertion becomes `halt:EP-l-S01:spec:api:-`.

## Out of scope

- `yad open-pr`'s `json` and `cwd` wiring (S02); skills and `docs/CLI.md` (S03).
- Storing a task on a step's first walk (`planStep`): the yad-run skill passes `--task` instead (S03).

## Plan

The builder (T01), then the halt wiring (T02), then the gate wiring (T03). Each task keeps the suite green: T01
gives `base` a default (`artifactBase`), so the gate key changes in T01 and T03 only makes it come from the
branch.

## Tasks

<!-- yad:tasks -->
## T01 — The halt key names the task and the gate review key names the base
**Files:**
- cli/inbox.mjs
- cli/test-inbox.mjs

## T02 — A halt of a per-task step passes its task
**Files:**
- cli/build.mjs
- cli/test-build.mjs

## T03 — yad gate open gives the review branch's base for the key
**Files:**
- cli/gate.mjs
- cli/test-inbox.mjs
<!-- /yad:tasks -->
