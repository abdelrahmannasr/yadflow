# Tasks — EP-reported-agent-flow-S04

## T01 — parse request branches and read a PR's base, head and body
**Files:**
- cli/epic-state.mjs
- cli/platform.mjs
- cli/test.mjs

**Done when:** R10 and R19 hold. Tests cover `skip/…` and `unskip/…` names, `unskip` never read as `skip`, unsafe names returning null, and `requestFacts` / `mergedRequestNumbers` parsing faked `gh` and `glab` output. `readPr`'s call is unchanged, so `cli/test-inbox.mjs` still passes.

## T02 — `yad gate ci` applies a merged skip or unskip request
**Files:**
- cli/gate.mjs
- cli/test.mjs

**Done when:** R11–R18 hold, `ciPin` is exported and `SET_ASIDE_SINCE` is defined. Tests cover: apply with merger and reason, the unmerged run, each R12 failure, a newer request winning, a quiet replay, a refused rule, and the bot commit holding the epic's `state.json` change under the R18 subject.

## T03 — the gate-sync templates run for request branches
**Files:**
- skills/yad-product-bridge/templates/github/yad-gate-sync.yml
- skills/yad-product-bridge/templates/gitlab/yad-gate-sync.gitlab-ci.yml
- cli/test-checks.mjs
- cli/test.mjs (added with the person's yes, 2026-11-25: the #232 test's two expected GitLab rule strings)

**Done when:** R20–R22 hold. The real reconcile and merge steps are run on mixed branch lists, and a GitLab commit message naming `unskip/EP-x/s` yields that branch. The existing template tests in `cli/test.mjs` (no job reads the event action) and `cli/test-ci-check.mjs` (no run is cancelled) still pass.

## T04 — `yad skip` and `yad unskip` open a request PR when CI owns the ledger
**Files:**
- cli/skip-request.mjs
- cli/skip.mjs
- cli/test.mjs

**Done when:** R1–R9 hold. The #162 refusal test in `cli/test.mjs` now expects a request for `skip` and `unskip` and the old refusal for `defer`, `undefer` and `unblock`. A test runs the real `commit-message.sh`, `pr-title.sh` and `pr-template.sh` on the commit, title and body.

## T05 — `yad guide` offers the request path
**Files:**
- cli/guide.mjs
- cli/test-guide.mjs

**Done when:** R23 holds, and the skip test in `cli/test-guide.mjs` expects the offered command and its note.

## T06 — the CLI reference and the epic and analysis skills describe the request path
**Files:**
- docs/CLI.md
- skills/yad-epic/SKILL.md
- skills/yad-analysis/SKILL.md

**Done when:** R24 holds for these files: the `yad skip`, `yad gate ci` and `yad guide --json` text, the verified-Product section, and the CI table. Neither skill says "now is the only time".

## T07 — the UI skill and the bridge reference describe the request path
**Files:**
- skills/yad-ui/SKILL.md
- skills/yad-product-bridge/references/bridge.md

**Done when:** R24 holds for these files. The bridge's merge and reconcile rows name `skip/EP-*` and `unskip/EP-*`.

## T08 — the team guide and the explainer describe the request path
**Files:**
- TEAM-GUIDE.md
- docs/YADFLOW-EXPLAINED.md

**Done when:** R24 holds for these files: `TEAM-GUIDE.md` and `docs/YADFLOW-EXPLAINED.md` say skip and unskip go through a PR that CI applies, and defer and unblock are still refused.
