# Spec — EP-plannotator-review-S06: document the Plannotator integration

Story: `EP-plannotator-review-S06` (epic `EP-plannotator-review`), engine repo. Option **D** of the analysis, and
the docs for S01–S05 (#674–#678). Docs and skill text only: no CLI change, no contract surface. Shipped last, so
the docs describe what was built.

## Requirements

- R1. `docs/CLI.md` gets a section "### The Plannotator Inbox: the `inbox` field", after `yad guide --json`:
  - **what it is:** an optional top-level `inbox` block, `{ tool: 'plannotator', messages: [InboxMessage] }`,
    that yad shapes and the agent posts with its own Inbox tool; yad never calls, reads or writes Plannotator;
  - **when it appears:** only under `--json`, only when the Product chose Plannotator (`yad toolbox add
    plannotator`) **and** it is found where yad ran; otherwise the JSON is byte-for-byte what it was;
  - **the four commands**, one row each, with when and what: `yad guide [<epic>] --json` (one `hand-off` per
    `person[]` entry), `yad build step … blocked --reason … --json` (one `halt`; the reason's first line is the
    why, the rest the output block, last 60 lines), `yad gate open <epic> <artifact> --json` (one `review`, after
    the PR opened; not on `yad open-pr`'s delegation), `yad review nudge --repo <r> --pr <n> --json` (one
    `review`, after the PR was read);
  - **the `InboxMessage` fields** (from the contract): `key`, `kind`, `thread`, `title` (≤120), `body` (≤4,000,
    Markdown, redacted), `links`, `notice` (on `hand-off` and `review`, the fixed text), `question` (on `halt`:
    `fix`, `skip`, `stop`);
  - **the rule:** a reply never approves, comments, records or moves a step (the `inbox` agent rule);
  - **privacy:** every text field is redacted, and a line that looks like a secret is dropped whole; never put
    a secret in a message; the Inbox keeps its data on this machine in `~/.plannotator/inbox/`; set
    `PLANNOTATOR_SHARE=disabled`, because a share link sends the page to Plannotator's host.
- R2. `docs/CLI.md`'s toolbox section gets a short paragraph on the `plannotator` entry: `recommended`, not used
  until the team adds it; what `detect` looks for; that `yad toolbox connect plannotator` hands every step to the
  person (the pinned, attested install script, then the plugin), and why; the fallback (nothing changes).
- R3. `skills/yad-engineer-review/SKILL.md`, at the engineer review: `/plannotator-review <PR_URL>` as an
  optional aid, offered only when the tool is ready (as S05's readiness check, with the `plannotator-review`
  command in the session). Its "Approve" only tells the agent "LGTM"; it is not the engineer review record — the
  review is recorded as the skill says, and the merge is still the person's. A real concern goes on the PR.
- R4. `docs/SKILLS.md` says, in each skill's entry, where it uses Plannotator: `yad-guide` (posting the Inbox
  messages, S02), `yad-run` (halts, S03), `yad-review-gate` and `yad-engineer-review` (review messages, S04, and
  `/plannotator-review`, S06), `yad-review-companion` and `yad-pair-review` (line notes, S05).
- R5. The docs and skill checks pass (`npm test`, `node scripts/skill-fallbacks.mjs --check`,
  `node scripts/agent-guide.mjs --check`).

## Clarifications

### Session 2026-11-24
- Q: One section or notes spread across each command's row? → A: one section, so the four commands read the
  same and there is one place to change.
- Q: Light spec? → A: yes.
- Q (docs review, 2026-11-24): the docs said things the code does not do. → A: fixed against the code — the
  `review` key is `review:<epic or repo>:<artifact or PR>:gate|nudge` (the contract's one-line key pattern fits
  only hand-off and halt; raised at the engineer review); a line holding a known token is dropped whole as
  `[redacted line]`; a hand-off's `links` are the `https` links in its steps; the install script is not pinned —
  `--version` and `--verify-attestation` apply to the program it fetches; the program alone gives no Inbox tool;
  local-only storage is Plannotator's, not a yad promise; thread `yad` when none is known; the notice is the last
  paragraph, in italics.
- Q (docs review): `yad guide` passes the exact folder it ran in, while the other three pass the top of the
  checkout (`toolboxAt.from`), so `yad guide` run from a subfolder misses a repo-level plugin or server. → A:
  documented as it is; the code change (pass `toolboxAt?.from ?? o.dir` in `bin/yad.mjs`) is out of this docs
  story and raised at the engineer review as a follow-up.

## Plan

The CLI reference first (T01), then the skill and the skills list (T02).

## Tasks

<!-- yad:tasks -->
## T01 — Document the inbox field, the Plannotator toolbox entry and its privacy notes in docs/CLI.md
**Files:**
- docs/CLI.md

## T02 — Name /plannotator-review in the engineer review, and where each skill uses Plannotator
**Files:**
- skills/yad-engineer-review/SKILL.md
- docs/SKILLS.md
<!-- /yad:tasks -->
