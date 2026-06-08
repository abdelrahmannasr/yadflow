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

## CHANGES_REQUESTED

Recorded as a comment and surfaced as **blocking** in the comments file and the gate's report. It does
not by itself fail the count-based predicate (approvals decide the gate), but `advance` should not be run
while an unresolved change-request stands — the owner addresses it, the reviewer re-reviews, `sync` again.
