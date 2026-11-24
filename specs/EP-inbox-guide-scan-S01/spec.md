# Spec — EP-inbox-guide-scan-S01: yad guide finds Plannotator from the top of the checkout

Story: `EP-inbox-guide-scan-S01` (epic `EP-inbox-guide-scan`, a defect threaded off `EP-plannotator-review`),
engine repo. No contract surface changes (the epic inherits the parent's contract by a pointer lock).

## Problem

`yad guide --json` adds the `inbox` block when the Product chose Plannotator and it is found on this machine. The
other three commands that carry it look for it from the top of the checkout or Product they ran in
(`toolboxAt.from` in `bin/yad.mjs`, the folder `yad toolbox list` uses); `yad guide` passes the exact folder it
ran in (`o.dir`). Detection reads `<folder>/.claude/…` and `<folder>/.mcp.json` and never walks up, so run from
`engine/src` it misses the repo's own Inbox server. Also, `yad gate open --json` was never run through the CLI,
so its `json` and `cwd` wiring is untested.

## Requirements

- R1. `runGuide` (`cli/guide.mjs`) takes an `inboxAt` option: the folder the Inbox scan looks from. It defaults
  to `cwd`, so every existing caller is unchanged. `withInbox` is given `inboxAt` as its `cwd` (its
  `detectRoot`). Nothing else `runGuide` or `buildGuide` does with `cwd` changes ("here", the checkout,
  `situation`).
- R2. `bin/yad.mjs` passes `inboxAt: toolboxAt?.from ?? o.dir` to `runGuide`. `guide` is in `REPO_CMDS`, so
  `toolboxAt` is already worked out for it; `cwd: o.dir` stays as it is.
- R3. Tests (`cli/test-inbox.mjs`), through the CLI, with an empty HOME and a PATH of linked `node`, `git` and
  `which` plus the test's fakes:
  - TC-01 / TC-02: a workspace whose code repo `engine` has its own `.mcp.json` naming `plannotator-inbox`, an
    `engine/src` folder, and a Product that chose Plannotator: `yad guide <epic> --json` from `engine/src` has
    `inbox` with one `hand-off` per `person[]` entry; from the Product, none.
  - TC-03: from `engine/src`, the JSON with the Inbox found equals (with `inbox` removed) the JSON with it not
    chosen; the printed guide is byte-for-byte the same both ways.
  - TC-04: not chosen → no `inbox`, byte-for-byte the not-chosen answer.
  - TC-05 / TC-06: a Product on GitHub with a review step ready and its review branch on `origin` (a local bare
    repo), a fake `gh` that answers `pr create` with a PR URL, the Product choosing Plannotator and an Inbox
    server found where yad runs: `yad gate open <epic> <artifact> --json` has one `review` message whose `links`
    hold the PR URL and which has the notice; not chosen → no `inbox`. Checked once by hand: removing the
    `json` or `cwd` wiring for `gate open` in `bin/yad.mjs` makes TC-05 fail.
- R4. `docs/CLI.md`, "The Plannotator Inbox: the `inbox` field": the sentence that says `yad guide` looks from
  the exact folder it ran in is replaced, so all four commands look from the top of the checkout or Product
  (TC-07).

## Out of scope

- The three contract follow-ups (the Inbox message on `yad open-pr`, the task in the halt key, the `review` key
  pattern): the second change epic.

## Clarifications

### Session 2026-11-24
- Q: Change what `cwd` means for `runGuide`? → A: no; `cwd` is also how the guide reads "here". The Inbox scan
  gets its own option (`inboxAt`), defaulting to `cwd`.
- Q: Light spec? → A: yes.

## Plan

The fix and its guide tests (T01), then the `gate open` CLI test (T02), then the docs sentence (T03).

## Tasks

<!-- yad:tasks -->
## T01 — yad guide looks for Plannotator from the top of the checkout, like the other three commands
**Files:**
- cli/guide.mjs
- bin/yad.mjs
- cli/test-inbox.mjs

## T02 — Prove yad gate open --json through the CLI
**Files:**
- cli/test-inbox.mjs

## T03 — Say all four commands look from the same folder
**Files:**
- docs/CLI.md
<!-- /yad:tasks -->
