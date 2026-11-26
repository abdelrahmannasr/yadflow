# Research — EP-reported-agent-flow-S04

## Decisions

- **A request is an empty commit on its own branch.** `skip/<epic>/<step>` or `unskip/<epic>/<step>`,
  one commit whose tree is the base tree, built with `commit-tree` as `commitMember` builds a member
  commit (`cli/members.mjs` 459–493). It changes no file, so it cannot trip the ledger guard or
  `artifact_changed` in `pr-template.sh`, and no check script changes. The reason lives in the PR body,
  between `<!-- yad:reason -->` markers.
- **Merging the PR is the decision.** `yad gate ci --merged` reads the PR from the platform, checks that
  it is merged, that its head is the named branch and its base is the trunk, and records the merger as
  `by`. It applies the existing pure rules (`skipStep` / `unskipStep`), so the record is the one a
  local skip writes.
- **The newest request wins.** The 7-day reconcile replays merged PRs. Only the highest-numbered merged
  request across `skip/…` and `unskip/…` for a step is applied, so an old skip never undoes a newer
  unskip. No new field goes in `state.json`.
- **`readPr` is left as it is.** Its `gh pr view --json` field list is faked word for word in
  `cli/test-inbox.mjs` and `cli/test.mjs`. The base, head and body come from a new `requestFacts`.
- **The CI side lands first** (T01–T03), so no release can open a request that nothing applies. `yad
  skip` also refuses when CI's pinned yadflow is older than `SET_ASIDE_SINCE` (R7).
- **Spec Kit.** The Spec Kit skills are on this machine, but the engine repo was never set up for it (no
  `.specify/`), so its commands cannot run here. The files are written by hand in its layout, and
  `link.md` records `speckit: not-installed`.
- **Commit type.** The CLI and template changes reach users through a release: `feat:` for the request
  path (T04), `fix:` or `feat:` for the CI side, `docs:` for T06–T08.

## Checked against the code (origin/main `a4d7bc9e`, 2026-11-25)

Every function the spec names is where it says: `ciOwnsLedger` (`cli/skip.mjs` 71), `runSetAside` (91),
`runUnblock` (209), `parseReviewBranch` (`cli/epic-state.mjs` 425), `setAsideStep` (2351), `restoreStep`
(2473), `skipStep` / `unskipStep` (2539–2540), `gateCi` (`cli/gate.mjs` 1122), `ciPin` (1774),
`REOPEN_SINCE` (1800), `readPr` (`cli/platform.mjs` 283), `findPrForBranch` (298), `prBranch` (342),
`getPrBody` (591), `createPr` (639). `newestPrNumber` (322) is the newest PR in the whole repo, not per
branch, so R13 needs the new `mergedRequestNumbers`.

## Unknowns

- **The real-platform check** is settled: GitHub only, with GitLab covered by its tests (the person,
  2026-11-25). The check is a push of a scratch request branch and a PR closed afterwards. The person's
  yes is asked right before that push.
- **`SET_ASIDE_SINCE`.** The release that ships this story is not known until semantic-release cuts it.
  T02 sets it to the next minor after the current release, and the PR says so.
