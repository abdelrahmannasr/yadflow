# Spec — EP-plannotator-review-S04: review prompts to the Inbox

Story: `EP-plannotator-review-S04` (epic `EP-plannotator-review`), engine repo. Option **I3** of the analysis.
Builds on S01 (`inboxReady`, #674) and S02 (`reviewMessage`, `inboxBlock`, #675). Independent of S03.

## Problem

When a review is ready — a Shape review PR that `yad gate open` opens, or a code PR a reviewer is nudged on with
`yad review nudge` — the person hears it only in the chat or from the platform. When the Product uses Plannotator
and it is on this machine, the agent can also leave a `review` message in the person's Inbox: the PR link (the
Inbox shows it as a live card) and the notice that a reply records nothing. The Inbox is per machine, so this
helps the reviewer only on their own machine; the epic accepts that.

## Requirements

- R1. `readPr` (`cli/platform.mjs`) also returns the PR/MR's web `url` (GitHub: `url` added to the
  `gh pr view --json` fields; GitLab: the `web_url` `glab mr view` already returns), or `null` when the platform
  does not say. Nothing that reads `readPr` today changes.
- R2. `yad gate open <epic> <artifact> --json` adds a top-level `inbox` with one `review` message
  (`reviewMessage({ epic, artifact, url, solo })`) when the review PR/MR was opened (`opened: true`) **and**
  `inboxReady(root, { detectRoot: cwd })` is true. `url` is the opened PR's URL; `solo` is `isSolo(productConfig)`.
  `cwd` is where yad ran (`toolboxAt.from`, as for `yad build step`, S03).
- R3. `yad review nudge --repo <r> --pr <n> --json` adds the same when the PR was read (the command succeeded)
  **and** the Inbox is ready: `reviewMessage({ repo, pr, url, solo })`, with `repo` the registered repo's name,
  `url` from `readPr` (R1), and `solo` from the Product's config. `cwd` is the folder yad ran in (a repo
  command keeps it); the choice is read from the Product.
- R4. Never on: a failed open (no platform, the platform refused, a step set aside, a branch not on origin) or a
  failed nudge (no `--pr`, the repo or platform not found, the PR not read); the printed (not `--json`) path;
  `yad open-pr`'s delegation to `gateOpen` (the contract names `yad gate open` only). None of these scans the
  machine.
- R5. When the Inbox is not ready, both commands' JSON is byte-for-byte what it was.
- R6. The message is S02's `reviewMessage`, unchanged: title `Review ready — <artifact> for <epic>` or
  `Review ready — PR #<n> in <repo>`; the "what is asked" line (the solo wording when solo); the `notice`;
  `links` holding the PR/MR URL (empty when the URL is not known).
- R7. Skills:
  - `yad-review-gate`: after `yad gate open --json`, when the result has `inbox` and the session has the Inbox
    tool, post its `review` message as the yad-guide skill's "Posting to the Inbox" says; once the gate passes
    (`yad gate status` shows it), post "Confirmed: <the gate> passed." in the same thread and mark it done.
    A reply never approves, comments or advances.
  - `yad-engineer-review`, where it names `yad review nudge`: run it with `--json` and post the `inbox`
    message the same way; mark it done once the PR is merged.

## Out of scope

- `yad open-pr` (and `yad ship`) on a review branch: they delegate to `gateOpen` but the contract adds `inbox` to
  `yad gate open` only. Raised at the engineer review as a possible change.
- `docs/CLI.md` for the `inbox` field (S06).

## Clarifications

### Session 2026-11-24
- Q: "opened or found" — does `gate open` find an existing PR? → A: no; it opens one or reports it could not.
  `inbox` follows `opened: true` only.
- Q: The nudge's PR URL — `readPr` does not return it on GitHub. → A: add it (R1), a field read in the same call,
  rather than a second platform call or a URL built by hand (it would be wrong on a self-hosted host).
- Q: Light spec? → A: yes.

## Plan

`readPr` returns `url` first (T01). Then `gateOpen` (T02) and `reviewNudge` (T03) each take
`{ json, cwd, ready = inboxReady }` and add the block at the end of their success path; `bin/yad.mjs` passes
`json` and `cwd`. Tests inject `ready`, `creator`, `reader` and `poster`. Then the two skills (T04).

## Tasks

<!-- yad:tasks -->
## T01 — readPr also returns the PR/MR's web URL
**Files:**
- cli/platform.mjs
- cli/test.mjs

## T02 — yad gate open --json adds a review message when the Inbox is ready
**Files:**
- cli/gate.mjs
- bin/yad.mjs
- cli/test-inbox.mjs

## T03 — yad review nudge --json adds a review message when the Inbox is ready
**Files:**
- cli/review.mjs
- bin/yad.mjs
- cli/test-inbox.mjs

## T04 — The review-gate and engineer-review skills post the review message and close it
**Files:**
- skills/yad-review-gate/SKILL.md
- skills/yad-engineer-review/SKILL.md
<!-- /yad:tasks -->
