# Plan — EP-reported-agent-flow-S04 (engine)

## Approach

Build the CI side first, so a request never opens before something can apply it.

1. Add `parseSetAsideBranch` to `cli/epic-state.mjs`. Add `requestFacts` and `mergedRequestNumbers` to
   `cli/platform.mjs`, leaving `readPr` as it is (T01).
2. In `gateCi`, when `parseReviewBranch` returns null, try `parseSetAsideBranch`. A request job runs the
   checks in R11–R14, applies the pure rule (R15–R17), and joins the existing `touched` set. The existing
   allowlist, commit and push then carry it, with the subject in R18. Export `ciPin` and add
   `SET_ASIDE_SINCE` (T02).
3. Add the two branch kinds to both gate-sync templates, and test the real steps, as the #434 tests in
   `cli/test-checks.mjs` do. Add the two ledger-guard tests there (T03).
4. Add `cli/skip-request.mjs`: read the base state, run the dry check, build the empty commit, push, open
   the PR. Call it from `ciOwnsLedger`'s refusal path for `skip` and `unskip` only. The #162 refusal test
   in `cli/test.mjs` changes in the same task (T04).
5. Update `yad guide` (T05), then the docs and skills (T06–T08).

## Branches

One branch per task, stacked: each starts from the one before, so they merge in order. The spec files
land as their own `docs:` commit at the bottom of T01's branch, so every later commit's `Task:` trailer
resolves to `specs/EP-reported-agent-flow-S04/link.md`.

## Testing

- `npm test`, `npm run lint`, `node scripts/agent-guide.mjs --check` and
  `node scripts/skill-fallbacks.mjs --check` pass on each task branch.
- Tests use the injected `runner`, `reader`, `branchOf` and `creator`, as the existing skip and gate ci
  tests do. One test runs the real `commit-message.sh`, `pr-title.sh` and `pr-template.sh` on the commit,
  title and body that R4 and R6 produce.
- On a real platform, before T04 ships: an empty-commit request PR on GitHub, opened from a scratch
  branch and closed afterwards; GitLab is covered by its tests (the person's answer). That push needs the person's
  yes, asked right before it.
- By hand, once: removing the `parseSetAsideBranch` call in `gateCi`, or a template's new branch kind,
  makes its test fail.
