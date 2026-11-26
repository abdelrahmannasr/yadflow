# Spec — EP-reported-agent-flow-S04: skip and unskip an optional step through a PR that CI applies

Story: `EP-reported-agent-flow-S04` (epic `EP-reported-agent-flow`), engine repo. Issue: engine #682.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

**`yad skip` refuses once CI owns the ledger.** On a verified Product, an epic's `state.json` is CI's
alone once it is on the default branch. `ciOwnsLedger` in `cli/skip.mjs` (71–89, rule text 58–70) asks
the same question the `ledger-guard` hook asks: `seededSlugs(root, productConfig, runner)`
(`cli/hook.mjs` 250) lists the epics whose ledger is on origin's default branch. When the epic is in
that list, the verb prints "`yad skip` is refused: …state.json is on the default branch, and on a
verified Product only CI writes it — nothing is written", says "CI has no step for `yad skip` yet",
and sets exit code 1. `runSetAside` (91–149) calls it at line 101, before any state change, for `skip`,
`unskip`, `defer` and `undefer`; `runUnblock` calls it at 214. Before the epic's first review PR merges
(the ledger is not on the base), or on a Product that is not verified, the verb writes `state.json`
itself. The pure rules are `skipStep` / `unskipStep` (`cli/epic-state.mjs` 2539–2540), over
`setAsideStep` (2351) and `restoreStep` (2473). `restoreStep` refuses an un-skip once the step after the
pair is `done`, or any step past it has started.

**`yad gate ci` only applies review branches.** `gateCi` (`cli/gate.mjs` 1122) builds its job list from
`parseReviewBranch(branch)` (1166). `parseReviewBranch` (`cli/epic-state.mjs` 425–428) accepts only
`review/(EP-[a-z0-9-]+)/(.+)`. Any other branch prints "is not a review/EP-*/<artifact> branch —
nothing to sync" and returns. A merge run stages its own files by an allowlist (`.sdlc` and `reviews`
of each touched epic, 1449–1457), commits as the bot with `[skip ci]` (subject built at 1484–1498),
and pushes the default branch. The reconcile job replays every PR merged in the last 7 days, so each
run must be idempotent. `readPr` (`cli/platform.mjs` 283) returns `merged`, `mergedBy`, `mergeCommit`
and `headOid`, but not the base branch. `prBranch` (342) reads the head branch, and `getPrBody` (591)
reads the body. `cli/test-inbox.mjs` and `cli/test.mjs` fake `readPr`'s exact `gh pr view --json`
field list, so that call is left as it is.

**The gate-sync templates run only for `review/EP-*`.**
- GitHub (`skills/yad-product-bridge/templates/github/yad-gate-sync.yml`): the `mergesync` job runs on
  `startsWith(github.event.pull_request.head.ref, 'review/EP-')` (77). The head ref reaches the shell
  only through `env: HEAD_REF` (150–159); the comment at 146–149 explains why. A name like
  `review/EP-x$(curl …)` still passes the `if:`. The `reconcile` job runs `gate ci` only in
  `case "$REF" in review/EP-*)` (259–261).
- GitLab (`skills/yad-product-bridge/templates/gitlab/yad-gate-sync.gitlab-ci.yml`): the merge rules
  match `$CI_COMMIT_MESSAGE =~ /review\/EP-/` (103, 105). The sweep keeps MRs whose `source_branch`
  starts with `review/EP-` (227). The merge path pulls the branch out of the commit message with
  `grep -oE 'review/EP-[A-Za-z0-9._/-]+'` (236). That character list is GitLab's guard against unsafe
  names: nothing outside it reaches the shell or the API URL at 240.

**The ledger guard does not look at branch names.** `skills/yad-checks/templates/checks/ledger-guard.sh`
checks every commit in the PR range (318–357). A commit that changes `epics/*/.sdlc/{state,approvals,
comments,product-prs,hub-prs}.json` or `epics/*/reviews/*.md` fails unless it is a verified gate-bot
commit (`trusted_bot`, 217–224) or a new epic's seed (`is_seeding`, 272). So a `skip/…` PR that
changes a ledger file already fails. It needs a test, not new code.

**A non-review Product PR must pass the tooling checks.** `pr-title.sh` and `pr-template.sh`
(`checks/`, byte-identical to `skills/yad-pr-template/templates/checks/`) treat any head that is not
`review/EP-*` as a tooling PR. It needs a Conventional-Commits title (`check_code_title`, 112) and the
code template (`check_code_body`, 208: `## Summary`, `## Impact & Risk` with a real `Risk level:`,
`## Checklist`). It fails if it changes any path under `epics/**` or `foundation/**`
(`artifact_changed`, 68 / 70) other than three exempt records.

**Other places say the skip cannot happen.** `cli/guide.mjs` 280–281 gives `skip: { command: null,
note: '…CI has no step for a skip yet…' }` when CI owns the ledger, and 562 prints "optional, but it
cannot be skipped here". Its `UNREAD` and `ASFETCHED` notes (160–161, used for skip at 284–285) say the
command "is refused" once CI owns the ledger. `cli/skip.mjs` 81 tells a person who skips early that
`yad unskip` "is refused until CI has a step for it". `skills/yad-epic/SKILL.md` 255 and
`skills/yad-analysis/SKILL.md` 188–191 say "now is the only time" to skip. `skills/yad-ui/SKILL.md`
115–117 says none of the verbs works. `docs/CLI.md` says the same at 401–405 and 1325–1330,
`TEAM-GUIDE.md` at 848, and `docs/YADFLOW-EXPLAINED.md` at 375–376.

## Requirements

**Opening a request (`yad skip` / `yad unskip`).**
- R1. On a verified Product where `ciOwnsLedger` would refuse, `yad skip EP-x <step> --reason "…"` no
  longer refuses. It opens a skip request instead (R3–R6), and writes nothing in the working tree.
  `yad unskip EP-x <step>` does the same, as an unskip request. (Story AC 1, 3.)
- R2. Before it pushes anything, the verb reads the epic's `state.json` from the base ref (origin's
  default branch, as last fetched). It runs `skipStep` or `unskipStep` on a copy of that state. A throw
  is the same refusal, with the same `YAD-STATE-004` message as today, and nothing is pushed. So a step
  that is not optional is still refused, a skip with no reason is still refused, and an unskip after the
  step following the pair is `done` (or a later step has started) is still refused. An unskip of a step
  that is not skipped is refused too ("is not skipped"), as today. A skip of a step already skipped
  prints that it was already skipped (with its record), opens nothing, and exits 0, as today.
  (AC 1, 3.)
- R3. The request branch is `skip/<epic>/<step>` or `unskip/<epic>/<step>`. The epic matches
  `isValidEpicId`. The step matches `^[a-z0-9]+(-[a-z0-9]+)*$` and is an author step in the chain.
- R4. The branch holds exactly one commit, on the base tip. The commit is empty: its tree is the base
  tree, so it changes no file, and no ledger file. It is built without touching the checkout, as
  `commitMember` builds a member commit (`cli/members.mjs` 459–493: `commit-tree`, signed when
  `commit.gpgsign` is true). Its subject passes `checks/commit-message.sh --profile product`.
- R5. The branch is pushed with `git push origin <sha>:refs/heads/<branch>`, with no force and no
  lease. When the branch already exists on origin, nothing is pushed. The verb names the PR on that
  branch, if `findPrForBranch` finds one, and exits 1. (Whether to pass `--no-verify`, as
  `publishMember` does at `cli/members.mjs` 523, is an open question below.)
- R6. The PR/MR is opened with `createPr` (`cli/platform.mjs` 639), through an injected `creator`, as
  `gateOpen` does (`cli/gate.mjs` 1969). Its title is Conventional (`chore(gate): skip <step> in
  <epic>`, or `unskip`). Its body passes `pr-template.sh --profile product` for a non-review head:
  `## Summary`, `## Impact & Risk` with `Risk level: low`, and `## Checklist`. The body carries the
  reason between `<!-- yad:reason -->` and `<!-- /yad:reason -->`. It also says that merging the PR is
  the decision, and that CI then marks the step. If the push worked and the PR did not open, the verb
  says the branch is pushed and gives the command that opens the PR.
- R7. The verb refuses, and pushes nothing, when the gate-sync pin (`ciPin`, `cli/gate.mjs` 1774) is
  older than `SET_ASIDE_SINCE`. T02 sets it to the release that ships this story. This is the same rule as
  `REOPEN_SINCE` for `yad gate reopen` (1800). An older CI would never apply the request.
- R8. `--json` answers `{ epic, step, state, changed: false, request: { kind, branch, commit, url,
  opened } }`. `state` is the step's state on the base.
- R9. `yad defer`, `yad undefer` and `yad unblock` keep today's refusal, word for word. Before the
  first review merges, and on a Product that is not verified, `yad skip` and `yad unskip` write the
  same state as today. One line changes: the note at `cli/skip.mjs` 81 no longer says `yad unskip` is
  refused after the first review merges; it says the unskip then goes through a PR that CI applies.
  The note stays word for word for `yad defer`. (AC 6.)

**Applying a request (`yad gate ci`).**
- R10. A new pure `parseSetAsideBranch(branch)` in `cli/epic-state.mjs` returns `{ kind, epic, step }`
  for `^(skip|unskip)/(EP-[a-z0-9-]+)/([a-z0-9]+(?:-[a-z0-9]+)*)$`, and null for anything else. It
  never reads `unskip/…` as `skip/…`. A name holding `$`, a backtick, a space, `..` or a second `/` in
  the step is null. `gateCi` asks it when `parseReviewBranch` returns null.
- R11. A request job runs only with `--merged`. Without it, it prints one line and writes nothing.
- R12. The job reads the PR from the platform (`readPr`, and `requestFacts` from R19). It goes on only when all of
  these hold. If one does not, or the platform cannot answer, the run fails (exit 1) and writes nothing:
  - the PR is merged;
  - its head branch is exactly `--branch`;
  - its base branch is the Product's trunk (the branch `gate ci` pushes);
  - `mergedBy` is not null.
- R13. Only the newest request for a step counts. The job asks the platform for the merged PRs/MRs on
  both `skip/<epic>/<step>` and `unskip/<epic>/<step>`. When a higher number than `--pr` is among them,
  the job prints that a newer request merged after it, and writes nothing. The run stays green. This is
  what stops the 7-day reconcile from replaying an old skip after a newer unskip.
- R14. For a skip, the reason is the text between the `yad:reason` markers in the merged PR's body,
  trimmed, with control characters replaced by spaces. An empty or missing reason fails the run and
  writes nothing.
- R15. The job applies `skipStep(state, step, { reason, by: mergedBy, at: today })`, or
  `unskipStep(state, step)`, to the ledger on the checked-out default branch. The record holds the
  reason, the merger's login and the date, in exactly the shape a local skip writes. So the step then
  behaves exactly as a step skipped before the first review. (AC 2.)
- R16. Replay is quiet. A skip on a step already skipped, or an unskip on a step not skipped, changes
  nothing and commits nothing (byte-identical ledger).
- R17. A rule that refuses at merge time (for example, a later step started after the PR opened) prints
  the `YAD-STATE-004` message, writes nothing, and fails the run.
- R18. The commit is the bot's, through the existing allowlist and push path. Its subject is
  `chore(gate): skip <epic>/<step> on merge [skip ci]` (or `unskip`). The run stages nothing more than
  a review merge run stages today: the epic's `.sdlc` and `reviews`, plus what the existing merge-run
  steps after the job loop add (the E64 login stamps of other epics, the shape-8 move, the Product
  index).
- R19. `readPr` and its `gh pr view --json` field list do not change. A new
  `requestFacts(platform, n)` in `cli/platform.mjs` returns `{ ok, base, head, body }` in one call
  (`gh pr view <n> --json baseRefName,headRefName,body`; `glab mr view <n> -F json`, reading
  `target_branch`, `source_branch`, `description`). A new `mergedRequestNumbers(platform, branches)`
  returns the merged PR/MR numbers per branch, or `{ ok: false, reason }`. Both take an injected
  `runner` and never throw.

**The CI templates.**
- R20. GitHub: `mergesync` also runs for heads starting `skip/EP-` or `unskip/EP-`. The head ref still
  reaches the shell only through `env: HEAD_REF`. The comment at 146–149 names the new branch kinds.
  `reconcile` runs `gate ci` for `review/EP-*|skip/EP-*|unskip/EP-*`, with `"$REF"` quoted as today.
  (AC 4.)
- R21. GitLab: the two merge rules match `(review|skip|unskip)\/EP-`. The sweep keeps all three
  prefixes. The merge path extracts with `grep -oE '(review|unskip|skip)/EP-[A-Za-z0-9._/-]+'`: the
  same character list, so the same guard runs before any shell or URL use. A commit message naming
  `unskip/EP-x/s` yields `unskip/EP-x/s`. (AC 4.)
- R22. A test runs the real ledger guard on a `skip/EP-x/ui-design` range whose commit changes
  `state.json`, and sees it fail. A second test sees the empty request commit pass. (AC 5.)

**Text.**
- R23. `yad guide` offers `yad skip …` when CI owns the ledger, with a note that it opens a PR that CI
  applies on merge. The printed line no longer says "it cannot be skipped here". For skip, the
  `UNREAD` and `ASFETCHED` notes no longer say the command is refused; the blocked-step text (`yad
  unblock`) keeps them.
- R24. `skills/yad-epic/SKILL.md`, `skills/yad-analysis/SKILL.md`, `skills/yad-ui/SKILL.md`,
  `docs/CLI.md`, `skills/yad-product-bridge/references/bridge.md`, `TEAM-GUIDE.md` (848) and
  `docs/YADFLOW-EXPLAINED.md` (375–376) describe the request path. They still say `defer`, `undefer`
  and `unblock` are refused once CI owns the ledger. (AC 7.)

## Non-goals

- `yad defer`, `yad undefer` and `yad unblock` through CI. They keep today's refusal (epic, Out of scope).
- Build lane skips (`yad skip <epic> <story> --repo`). They write build-state, not the ledger.
- A sweep run with no `--branch` does not look for requests. Only named merged branches are applied.
- Deleting a merged request branch. The platform's own setting decides.

## Clarifications

### Session 2026-11-25

- Q: On a verified Product, how should a skip of an optional step reach CI? → A: a request branch, skip/EP-x/<step>: its PR carries the reason, and merging it makes CI apply the skip (the person, Plannotator Inbox, 2026-11-25).
- Q: A PR needs at least one commit. What does the request commit hold, and where does `gate ci` read the reason? → A: an empty commit on the base tip (same tree), built like `commitMember`. It cannot touch a ledger file, and it passes `pr-title.sh` / `pr-template.sh` with no change to them. A file under `epics/**` would fail `artifact_changed` on a non-review head, and the exemption would add four byte-identical script copies to this story. The reason is read from the PR body, between `yad:reason` markers, which is what the story and the person's answer say. Trade-off: a body can be edited until, and after, the merge. Only the first application reads it, because a replay of an applied request changes nothing (R16). A file in the commit would be fixed in git history instead. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Spec form for S04? → A: the full Spec Kit set (the person, Plannotator Inbox, 2026-11-25).
- Q: Accept the security trade-offs for a skip through CI (whoever can merge decides; the reason comes from the PR body between `yad:reason` markers; `gate ci` checks merged, head and base before writing)? → A: accept them (the person, Plannotator Inbox, 2026-11-25).
- Q: Verify the empty-commit request PR on GitHub only, with GitLab left to its tests? → A: yes: check on GitHub; GitLab by its tests only (the person, Plannotator Inbox, 2026-11-25). This replaces "each platform" in the answer below.
- Q: Do GitHub and GitLab open and merge a PR/MR whose only commit is empty, with every merge method (merge, squash, rebase; GitLab merge, squash, fast-forward)? → A: yes. `docs/CLI.md` (row `yad gate ci`) already tells people to open a fresh review PR with `git commit --allow-empty`. Check it on a real GitHub repo before release; GitLab is covered by its tests (see the answer above). If a method refuses, fall back to a request file and the `artifact_changed` exemption. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: The reconcile replays merged PRs for 7 days. How does an old skip not undo a newer unskip? → A: only the newest merged request for the step, by PR/MR number across both branches, is applied (R13). This needs no new field in `state.json`. `withoutSetAside` (`cli/epic-state.mjs` 2235) deletes the record, so a marker on the step could not survive an unskip anyway. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: A request that a rule refuses at merge time fails the run (R17). The reconcile then repeats that red run every 15 minutes for 7 days. Is that acceptable? → A: yes for now. It matches how a failed review read is red. The alternative is a warning plus one PR comment; it needs a way to post only once. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Security — a branch name reaches a CI runner that holds write access. → A: the name never reaches a shell through `${{ }}` (GitHub `env:`), and GitLab's character list still runs first. `gate ci` then parses it strictly (R10). It also checks with the platform that the PR is merged, that its head is that branch, and that its base is the trunk (R12). Without the base check, the reconcile (which reads merged PRs into any base) could apply a request merged into an unprotected side branch. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Security — who may decide a skip? → A: whoever can merge to the trunk, as for a review PR. A team that wants a second person sets a required approval on the branch. The merger is recorded as `by`, not the person who opened the request. A person who can both open and merge can skip alone, as they could before the first review. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Security — the reason is text from a PR body, and `gate ci` prints it in the CI log. → A: control characters are replaced by spaces before it is stored or printed (R14), so a `\r::error::` cannot start a workflow command line. This is the rule `ledger-guard.sh` already follows for author text. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: A second skip after an unskip meets the first, merged `skip/…` branch on origin. → A: refuse and name it (R5). The person deletes the old branch, or the platform deletes merged branches. yad never force-pushes it. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Should `yad skip` also check that the wired gate-sync file on the base runs for `skip/EP-`? → A: no; the pin check (R7) is enough, and `yad check` already reports a stale wired file. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Should the request push pass `--no-verify`, as `publishMember` does (`cli/members.mjs` 523)? → A: no. yadflow wires no git pre-push hook (`skills/yad-checks/templates/hooks/` holds harness hooks only), and the project rules forbid skipping hooks. A team's own pre-push hook then runs on the request, as on any push. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: The story says unskip "is refused once the review that the skip short-circuited has opened". `restoreStep` (`cli/epic-state.mjs` 2473) refuses once the step after the pair is `done`, or any step past it has started. Which rule? → A: the code's rule, unchanged. It is the rule `unskip` has today, which is what the story asks to keep. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.


## Plan and tasks

The approach is in `plan.md`, the decisions in `research.md`, the shapes in `data-model.md`, and the
eight tasks in `tasks.md`.
