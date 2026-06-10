# The bridge — PR/MR ↔ ledger mapping, read recipes, idempotency

The bridge maps platform review state onto the **same file records** the manual gate writes, so the gate
predicate (`../sdlc-review-gate/references/gating.md`) runs unchanged. The bridge only changes the
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
  approval act — there is no separate machine advance. (`sdlc gate sync` performs this deterministically.)
- **Revoke on artifact change.** Each bridge approval is stamped with the content hash it was given
  against (the file bytes; the locked contract surface for architecture). On re-sync, an approval whose
  stamped hash ≠ the current hash is **dropped** — the reviewer must re-approve the changed artifact. A
  genuinely newer review (later `submittedAt`) re-stamps against the new hash. This is "revoke only when
  the artifact changed", not "revoke on any PR commit".

## Event-driven sync (hub CI)

The `wire` action (SKILL.md Step 4) installs a CI workflow on the hub so the platform events drive
`sdlc gate ci` instead of waiting on a manual `sdlc gate sync`. The CLI entry is self-sufficient: it
derives the epic + artifact from the `review/EP-<slug>/<artifact-base>` head branch and takes the PR/MR
number from the event payload — it even upserts the `hub-prs.json` entry when the author never committed
it, so the first CI commit converges the views. `sdlc gate ci` with no `--branch` sweeps every open
review PR (the scheduled path).

| Platform event | CI action |
|---|---|
| review submitted (approve / changes requested) or dismissed | `gate ci --branch <head> --pr <n>` → sync the ledger; the predicate may hold or pass |
| PR/MR `synchronize` (new commits on the review branch) | same — promptly re-stamps/revokes approvals on artifact change |
| PR/MR closed **and merged** (the human act) | same — predicate sees `merged: true` and advances the step |
| GitLab schedule (`*/15 * * * *`, `SDLC_GATE_SYNC=true`) | `gate ci` sweep — the **only** GitLab path that sees a bare approval (≤ ~15 min latency) |

**The overlay.** Pre-merge, the artifact under review exists only on the review branch, while the
ledger lives on the default branch. `gate ci` checks out the default branch, fetches the head ref and
overlays just the artifact paths (for architecture: `architecture.md` + `contract.md` +
`.sdlc/contract-lock.json`; for stories: `stories/`) so `artifactHash` binds each approval to **what the
reviewers actually approved** — then drops the overlay before committing. Only
`epics/<epic>/.sdlc/*.json` + `reviews/*.md` are committed (message `chore(gate): … [skip ci]`); the
artifact reaches the default branch exclusively via the human merge.

**Loop prevention & races.** The GitHub triggers (`pull_request_review`, `pull_request`) cannot fire on
a push to the default branch, `[skip ci]` guards every other workflow on both platforms, and a
repo-wide concurrency group serializes runs; the ledger push retries with a rebase (ledger-only commits
across epics touch disjoint files).

**Tokens.**
- GitHub: the ephemeral `github.token` with `contents: write` + `pull-requests: read` — nothing stored.
- GitLab: a masked `SDLC_GATE_TOKEN` project access token (`read_api` + `write_repository`) — the one
  documented bend of the no-stored-tokens rule; `CI_JOB_TOKEN` can neither read the approvals API nor
  push.
- Protected default branch (GitHub): prefer a ruleset bypass for Actions; else a fine-grained PAT as
  `SDLC_GATE_TOKEN` passed to `actions/checkout`; else leave it — the run fails **visibly** and manual
  `sdlc gate sync` remains the fallback. Never wire branch protection that couples the merge itself to
  the gate.

**Manual sync stays first-class.** `sdlc gate sync <epic> [artifact]` is unchanged and always valid —
the CI is the same sync on a trigger, and the file ledger is still the source of truth.

### Manual end-to-end verification (GitHub)

1. On a scratch hub: `sdlc setup` (platform github, roster with a second account) → `sdlc check --fix`
   installs `.github/workflows/sdlc-gate-sync.yml`; commit + push it.
2. Author an epic → `sdlc gate open EP-x epic.md` → the review PR opens.
3. Second account **approves** → the Actions run commits `approvals.json` to the default branch.
4. Second account **requests changes** → the run records the blocking comment; `sdlc gate status EP-x`
   (after `git pull`) shows the gate held.
5. Resolve the thread, approve again, a human **merges** → the closed-event run advances `state.json`
   (`epic-review: done`, `currentStep: architecture`).
6. `git pull` locally — `sdlc gate status EP-x` matches the platform history.

GitLab variant: same flow on an MR; a bare approval appears after the next schedule tick.
