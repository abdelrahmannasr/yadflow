# The bridge — PR/MR ↔ ledger mapping, read recipes, idempotency

The bridge maps platform review state onto the **same file records** the manual gate writes, so the gate
predicate (`../yad-review-gate/references/gating.md`) runs unchanged. The bridge only changes the
*input path*; it never changes what passing the gate means.

## State mapping (platform → ledger)

| Platform review state | Ledger effect |
|---|---|
| GitHub review `APPROVED` / GitLab MR approval (`approved_by`) | an `approved` record in `approvals.json`, role resolved from the roster (owner/reviewer) or derived domain-owner, tagged `"source": "bridge"` |
| GitHub `COMMENTED` / `CHANGES_REQUESTED`; GitLab discussions/notes | a line under `## <name> (<role>)` in `reviews/<artifact>--<date>--comments.md` + a `comments.json` record; **never** an approval. `CHANGES_REQUESTED` is also flagged as blocking in the comments file |
| GitHub review dismissed / GitLab approval revoked | the prior bridge `approved` record for that approver is removed on re-sync (see idempotency) |

`approvals.json` records from the bridge carry `"source": "bridge"`; **manual** approvals have no such
tag and are **never** touched by `sync` — the two coexist.

## Read recipes (read-only, local-user auth — no tokens)

**GitHub** (`gh`, the reviewer/runner's own auth):
```
gh pr view <n> --json reviews,comments,reviewDecision,latestReviews
gh api repos/{owner}/{repo}/pulls/{n}/comments        # inline review comments
```
- `reviews[].state` ∈ {APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED}; `reviews[].author.login` is
  the login to resolve. Use `latestReviews` so a superseded earlier review doesn't double-count.

**GitLab** (`glab` / `glab api`):
```
glab mr view <n>
glab api projects/:id/merge_requests/:iid/approvals     # approved_by[].user.username
glab api projects/:id/merge_requests/:iid/notes          # discussion notes (comments)
```

All commands run as the **local user**; the bridge stores no tokens. If the CLI is missing/unauthenticated
or the remote is unreachable, the bridge stops and the gate falls back to file-only (no error).

> **GitLab read parity (GAP-6).** `readPrGitLab` reads approvals (`approved_by[]`) and discussions but
> does **not** map a "Request changes" reviewer state to `CHANGES_REQUESTED` — on GitLab the blocking
> signal is an **unresolved discussion**. So on GitLab the gate is held by unresolved threads, not by a
> reviewer state. (GitHub maps both.) If you need GitLab "Request changes" honored, read
> `reviewers[].state` from the MR and map it to `CHANGES_REQUESTED`.

## Open recipes (request the reviewers — used by `yad gate open` / `yad open-pr`)

Opening the review PR/MR must **request the required reviewers**, or an escalated gate is opened with
nobody asked. The CLI (`createPr` in `cli/platform.mjs`) does this; an agent opening a PR by hand uses:

**GitHub** — create, then add each reviewer (a bad/non-collaborator login WARNS instead of aborting the
whole create):
```bash
gh pr create --title "review: <artifact> (<epic>)" --body <body> --base <default> --head <branch> \
  --assignee @me --label domain:<repo>
gh pr edit <n> --add-reviewer <login>      # once per required reviewer
```

**GitLab** — a Free/Core MR carries a **single** reviewer field (multiple reviewers is Premium), so
assign the first required reviewer and **@-mention the rest in a note** so they are still notified/routed:
```bash
glab mr create --title "review: <artifact> (<epic>)" --description <body> \
  --target-branch <default> --source-branch <branch> --reviewer <first-login> --label domain:<repo> --yes
glab mr note <iid> -m "Review requested (owner + reviewer rule): @<l2> @<l3> — please review and approve/comment on this MR (this drives the gate)."
```
The read side counts a mentioned reviewer normally: their eventual **approval** still appears in
`…/approvals → approved_by[]`, and their **note** in `…/discussions` — so the single-reviewer-field cap
loses only the native "Reviewers" UI chip, not the gate routing.

Required reviewers = the hub's `reviewer`/`domain-owner` roster logins for the touched scopes, PLUS any
repo whose ownership lives only in `repos.json` `domain_owner`/`domain_owners` (those are resolved to a
login and requested too — otherwise an escalated step is structurally unsatisfiable through routing).

## Login → role resolution (order)

1. Roster (`.sdlc/hub.json`) maps `login` → `name` + base `role` (owner/reviewer).
2. If that `name` equals a repo's `domain_owner` in `repos.json` **and** that repo is a touched domain
   for this step → also emit a `domain-owner` record with `domain: <repo>`.
3. Login not in the roster → `name: <login>`, `role: reviewer`, flagged
   `<!-- unverified login: <login> -->`. **Never** auto-promoted to owner/domain-owner.

(Full detail + per-repo routing: `login-roster.md`.)

## Idempotent re-sync

- Key bridge approvals on `(step, approver, role, domain)`. On re-sync, **upsert** — do not append a
  duplicate. Remove any bridge approval whose platform review was dismissed/revoked.
- Key synced comments on the platform comment id so the same comment is not appended twice.
- Update the step's `hub-prs.json` `lastSyncedAt` after a successful sync.
- Running `sync` twice with no platform change is a no-op on the ledger.

## Contract re-lock invalidates prior platform approvals too

For the **architecture+contract** review, the gate already drops approvals when the contract-surface hash
no longer matches `.sdlc/contract-lock.json`. The bridge extends this to platform-sourced approvals:
`sync` discards bridge `approved` records for the architecture step dated **before** the new lock, and
posts a comment on the review PR noting "contract re-locked — re-approval required". The escalation
(`risk_tags: ["contract"]` → a domain-owner per repo) is unchanged.

## CHANGES_REQUESTED & unresolved threads hold the gate

`CHANGES_REQUESTED` and any **unresolved review thread** are recorded as comments and surfaced as
**blocking**. Under the PR-driven gate they actively hold the step `in_review`: the predicate does not
pass while any thread is unresolved, even if the approval counts are met. The owner addresses the
comments, replies, the reviewer **resolves** their thread, then `sync` runs again.

## Merge advances; an artifact change revokes approvals

- **Merge → advance.** When the reviewer rule is satisfied, every thread is resolved, **and the review
  PR/MR is merged**, `sync` marks the step `done` and unblocks the next step. The merge is the human
  approval act — there is no separate machine advance. (`yad gate sync` performs this deterministically.)
- **Revoke on artifact change (checked at merge).** Path B reconciles at merge, so an approval given
  to an earlier revision must not count for the merged content. How that is enforced differs by
  platform:
  - **GitHub — in code.** Each approval carries the **commit SHA it was made on**; `mapApprovers`
    drops any approval whose commit ≠ the merged head (`headOid`). The reviewer approved an older
    revision → their review is stale → dropped. No platform setting required.
  - **GitLab — platform setting.** GitLab approvals expose no per-approval commit SHA (the reader omits
    it), so the in-code SHA check does not apply and the approval is kept. Revoke-on-change there is the
    platform's **"remove all approvals when commits are added to the source branch"** setting — **enable
    it** (required for the guarantee on GitLab; safe under Path B because CI never pushes the source
    branch, so only the owner's own artifact pushes drop approvals).
  - **Degraded GitHub read — fail closed.** If the GitHub commit read fails (the reader returns a
    `null` commit), the approval is **dropped**: a transient failure holds the gate rather than
    advancing on approvals whose freshness cannot be proven (re-run `yad gate sync` to recover).
    CHANGES_REQUESTED is still honored, so a degraded read can only ever *hold* the gate.
  The `artifactHash` stamp still binds architecture approvals to the locked contract surface (see
  "Contract re-lock" above).
- **Known limitation — protect the hub default branch.** The advance hashes the artifact from the
  default branch as it stands when CI runs, while approvals are SHA-bound to the reviewed PR/MR head.
  Those can differ if the artifact changes on the **base** outside this review while the PR/MR is open
  (the merge then integrates a change the reviewers never saw) or if a later out-of-band commit edits
  the merged artifact before a delayed reconcile advances it. In both cases each approval's commit
  still equals the reviewed head, so the SHA check passes, yet the live content was not reviewed. Close
  it operationally: **require branch protection on the hub default branch so `epics/**` artifacts can
  only change through their own review PR/MR** (one open review per artifact) — then the base copy of an
  artifact cannot move while its review is open, so the merged/live content always equals the reviewed
  content. (The complete in-code fix would hash the artifact at the reviewed PR-head revision before
  advancing; deferred in favor of the branch-protection mitigation.)

## Event-driven sync (hub CI) — Path B

The `wire` action (SKILL.md Step 4) installs CI on the hub so a **merge** drives `yad gate ci` —
**CI is the SOLE writer of the ledger, and it writes only at merge, only to the default branch.**
During review CI writes nothing: the platform PR/MR is the source of truth (native approvals +
threads). The CLI is self-sufficient at merge: it derives the epic + artifact from the
`review/EP-<slug>/<artifact-base>` head branch, takes the PR/MR number from the event (GitHub) or
resolves it from the platform (GitLab), upserts the `hub-prs.json` entry itself, and **re-reads
approvals fresh from the platform** — so no ledger needs to be pre-seeded on the branch.

| Platform event | Phase | CI action |
|---|---|---|
| PR/MR opened / reopened / pushed / reviewed | pre-merge | **none** — review state lives on the platform; CI never touches the branch |
| PR/MR closed **and merged** (the human act) | merge | `gate ci --branch <head> --pr <n> --merged` → re-read approvals, advance the step + flip the artifact `status:` **on the default branch** |
| Schedule (`*/15`) | reconcile | Safety net: enumerate recently-**merged** `review/EP-*` PRs/MRs via the API and advance any not yet `done` (idempotent). Recovers a merge whose merge-time run failed transiently, and on GitLab also picks up a squash merge whose commit dropped the branch name (and a bare approval — GitLab fires no pipeline on one). **GitHub:** a scheduled workflow, automatic once committed. **GitLab:** a pipeline schedule with `SDLC_GATE_SYNC=true` (one-time setup) |

**Why no pre-merge write fixes the gate.** Keeping CI off the PR head means an in-flight approval is
never dismissed by a CI commit, and the PR's required checks never strand on a `[skip ci]` CI commit.
Correctness is unaffected: at merge CI re-reads the PR/MR approvals from the platform and re-checks
each `artifactHash` against the merged content, so revoke-on-change still holds. The only ledger
commit — the advance plus the `draft → approved` status flip — lands on the **default branch** with
`[skip ci]`.

**The ledger is CI-owned (bridge mode only).** Humans never commit gate-state files: the `ledger-guard`
check (yad-checks) FAILs any commit on a review PR that touches `.sdlc/{state,approvals,comments,hub-prs}
.json` or `reviews/*.md` (`.sdlc/contract-lock.json` is artifact-side and allowed). Under Path B **no
CI commit lands in a review PR at all**, so the only ledger change the guard can see there is a human
edit — which it rejects. (The `verified-commits` gate still vets every commit's signature + author;
its gate-bot exemption is now vestigial in-PR because CI no longer commits there.) `yad gate open`
opens the PR only; local `yad gate sync` is advisory in bridge mode (writes nothing). After a merge,
everyone `git checkout <default> && git pull`. (Without the bridge, humans own the ledger locally and
these guards are no-ops.)

**The one sanctioned human ledger write: `yad gate repair`.** It heals a `YAD-STATE-005` chain (an
authoring step stranded behind a review gate that already advanced) by writing `state.json` alone. This
is not a `ledger-guard` gap: the repair commits to the **default branch**, where `ledger-guard` — which
only inspects review PRs — never runs, and where the `yad-update-guard` (platform-Verified signature +
roster-allowlisted author) vets it instead, exactly as it does for `yad checkpoint` and `yad update`.
The command refuses to commit off the default branch unless `--allow-branch` is passed.

**Loop prevention & races.** The only ledger commit lands on the **default branch** at merge, which
fires no PR trigger; it carries `[skip ci]` to guard sibling workflows. Because CI never pushes the
review branch, there is no `synchronize` / MR-pipeline loop to prevent — and it is now **safe to enable**
the platform's **"dismiss stale approvals on push"** (GitHub) / **"remove all approvals when commits
are added to the source branch"** (GitLab): only the owner's own artifact pushes dismiss approvals,
which is exactly the intended revoke-on-change. Merge advances serialize on the default branch; the
push retries with a rebase.

**Tokens.**
- GitHub: the ephemeral `github.token` with `contents: write` + `pull-requests: read` — nothing stored.
  Only the merge job pushes, and only the default branch.
- GitLab: a masked `SDLC_GATE_TOKEN` project access token (`read_api` + `write_repository`) — the one
  documented bend of the no-stored-tokens rule; `CI_JOB_TOKEN` can neither read the approvals API nor
  push. Used only for the merge-time default-branch push + the API reads.
- Protected default branch (GitHub): the merge advance needs to push it — prefer a ruleset bypass for
  Actions, else a fine-grained PAT as `SDLC_GATE_TOKEN` on the mergesync checkout.

**Manual sync & recovery.** In bridge mode `yad gate sync` is **advisory** (read-only) — it prints the
predicate but writes nothing, so it is **not** a recovery path when CI fails. If a merge-time run fails
(can't push, API hiccup), recovery is the scheduled **reconcile** job (automatic; it re-advances merged
reviews not yet `done`). To force it immediately, a maintainer runs the same command CI runs, locally on
the default branch: `yad gate ci --branch <review-branch> --pr <n> --merged` (this writes + pushes,
unlike advisory `yad gate sync`). File-only mode (no platform) keeps `yad gate sync` as the local writer.
The file ledger is still the source of truth.

### Manual end-to-end verification (GitHub)

1. On a scratch hub: `yad setup` (platform github, roster with a second account) → `yad check --fix`
   installs `.github/workflows/yad-gate-sync.yml`; commit + push it.
2. Author an epic → `yad gate open EP-x epic.md` → the review PR opens. CI writes nothing yet — review
   state lives on the platform.
3. Second account **approves** / **requests changes** → no CI run touches the branch; the PR's native
   approvals + threads are the source of truth (local `yad gate sync` is advisory and shows the
   predicate without writing).
4. Resolve the thread, approve again, a human **merges** → the mergesync run advances `state.json`
   (`epic-review: done`, `currentStep: architecture`) + flips `epic.md` to `approved` **on the
   default branch**.
5. `git checkout <default> && git pull` locally — `yad gate status EP-x` matches the platform history.

GitLab variant: same flow on an MR; the advance lands on the merge push (or the next schedule tick if
a squash merge dropped the branch name).
