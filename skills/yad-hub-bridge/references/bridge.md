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
- **Revoke on artifact change.** Each bridge approval is stamped with the content hash it was given
  against (the file bytes; the locked contract surface for architecture). On re-sync, an approval whose
  stamped hash ≠ the current hash is **dropped** — the reviewer must re-approve the changed artifact. A
  genuinely newer review (later `submittedAt`) re-stamps against the new hash. This is "revoke only when
  the artifact changed", not "revoke on any PR commit".

## Event-driven sync (hub CI)

The `wire` action (SKILL.md Step 4) installs CI on the hub so platform events drive `yad gate ci` —
**CI is the SOLE writer of the ledger.** The CLI is self-sufficient: it derives the epic + artifact from
the `review/EP-<slug>/<artifact-base>` head branch, takes the PR/MR number from the event, and upserts
the `hub-prs.json` entry itself — so the first run (the `opened` event) seeds the ledger.

Two phases, and CI writes the ledger to a **different place** in each:

| Platform event | Phase | CI action |
|---|---|---|
| PR/MR opened / reopened | pre-merge | `gate ci --branch <head> --pr <n>` → seed markInReview + hub-prs **on the review branch** |
| review submitted (approve / changes requested) or dismissed | pre-merge | same → sync approvals/threads onto the review branch (predicate holds) |
| PR/MR `synchronize` (new commits on the review branch) | pre-merge | same → re-stamp / revoke approvals on artifact change |
| PR/MR closed **and merged** (the human act) | merge | `gate ci --branch <head> --pr <n> --merged` → the branch ledger reached the default branch via the merge; CI advances the step + flips the artifact `status:` **on the default branch** |
| GitLab schedule (`*/15`, `SDLC_GATE_SYNC=true`) | sweep | the only GitLab path that sees a bare approval (≤ ~15 min). Two passes: (a) `gate ci` on the default branch advances any merged-but-stuck review (e.g. a squash merge whose message dropped the branch name); (b) `git ls-remote` enumerates open `review/EP-*` branches and runs `gate ci --branch <ref>` on each (the in-flight ledger lives on the branch, so the default-branch sweep alone can't see it) |

**No overlay.** The artifact and the ledger live together on the review branch during review, so
`artifactHash` binds each approval to the reviewed content directly — the old overlay-then-drop is gone.
Pre-merge, CI writes `epics/<epic>/.sdlc/*.json` + `reviews/*.md` to the **review branch**; they reach
the default branch via the human merge. At merge, CI commits the advance — and the `draft → approved`
status flip — to the **default branch**. Both commits carry `[skip ci]`.

**The ledger is CI-owned (bridge mode only).** Humans never commit gate-state files: the `ledger-guard`
check (yad-checks) FAILs any commit on a review PR that touches `.sdlc/{state,approvals,comments,hub-prs}
.json` or `reviews/*.md` unless it is a **verified gate-bot commit** — bot-authored AND platform-Verified
(author text alone is spoofable, so the Verified signature is what proves CI authorship). The co-wired
`verified-commits` waives the allowlist for the bot but still demands its signature; `.sdlc/contract-lock
.json` is artifact-side and allowed. `yad gate open` opens the PR only; local `yad gate sync` is advisory
in bridge mode (writes nothing). After a merge, everyone `git checkout <default> && git pull`. (Without
the bridge, humans own the ledger locally and these guards are no-ops.)

**Loop prevention & races.** A pre-merge ledger push lands on the review branch, which would otherwise
re-fire `synchronize` / the MR pipeline — the `[skip ci]` on the commit makes the platform skip it. The
merge advance lands on the default branch (no PR trigger). Pre-merge runs serialize per review branch;
the merge advance serializes on the default branch; the push retries with a rebase.

**Tokens.**
- GitHub: the ephemeral `github.token` with `contents: write` + `pull-requests: read` — nothing stored.
  Pre-merge pushes target the (unprotected) review branch; only the merge job pushes the default branch.
- GitLab: a masked `SDLC_GATE_TOKEN` project access token (`read_api` + `write_repository`) — the one
  documented bend of the no-stored-tokens rule; `CI_JOB_TOKEN` can neither read the approvals API nor push.
- Protected default branch (GitHub): only the merge advance needs to push it now — prefer a ruleset
  bypass for Actions, else a fine-grained PAT as `SDLC_GATE_TOKEN` on the mergesync checkout. Also enable
  **"dismiss stale approvals on push"** so revoke-on-change survives a force-push that wipes CI's
  `approvals.json` (which CI rebuilds from the platform on the next event).

**Manual sync.** In bridge mode `yad gate sync` is advisory (CI owns the writes). File-only mode (no
platform) keeps the local write path. The file ledger is still the source of truth.

### Manual end-to-end verification (GitHub)

1. On a scratch hub: `yad setup` (platform github, roster with a second account) → `yad check --fix`
   installs `.github/workflows/yad-gate-sync.yml`; commit + push it.
2. Author an epic → `yad gate open EP-x epic.md` → the review PR opens (CI seeds the ledger on the
   review branch via the `opened` event).
3. Second account **approves** → the presync run records `approvals.json` **on the review branch**.
4. Second account **requests changes** → the run records the blocking comment on the review branch;
   checking the PR (or local `yad gate sync`, advisory) shows the gate held.
5. Resolve the thread, approve again, a human **merges** → the mergesync run advances `state.json`
   (`epic-review: done`, `currentStep: architecture`) + flips `epic.md` to `approved` **on the
   default branch**.
6. `git checkout <default> && git pull` locally — `yad gate status EP-x` matches the platform history.

GitLab variant: same flow on an MR; a bare approval appears after the next schedule tick.
