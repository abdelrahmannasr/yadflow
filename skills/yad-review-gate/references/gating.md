# Gate predicate — details & worked example

## Reviewer rule
Let `A` = the set of `approved` records in `.sdlc/approvals.json` for this step.

- `owners = { a in A : a.role == "owner" }`
- `reviewers = { a in A : a.role == "reviewer" }`  (distinct by `approver`)
- `domainOwners = { a in A : a.role == "domain-owner" }`  (grouped by `a.domain`)

**Base pass:** `|owners| >= 1` AND `|reviewers| >= default_reviewers` (default `1`).

**Escalated pass** (step `risk_tags` ∩ `{contract, auth, payments}` ≠ ∅): base pass AND, for every
touched `domain`, `|domainOwners[domain]| >= 1`.

**Engagement (the Review Companion).** Each approval carries `engagement: verified | none` —
`verified` when it was recorded through the companion (a real trailer/cards/chat session), `none` for a
bare UI click. By **default (soft)** both count: a bare approve still passes the gate but is recorded
`none` and draws a friendly public @-mention nudge, so review *quality* is visible without blocking
anyone. When `hub.review.requireEngagement: true`, only `verified` approvals are counted toward the
sets above (a determined faker can still run an empty session — the signal is **gameable by design**;
it raises the cost of a rubber-stamp and makes laziness visible, it does not prove a human read the
artifact). Philosophy: *visible, not impossible.*

**Touched domains** are resolved from files, not hardcoded:
- Architecture+contract review: the touched domains are the epic's `repos` (every repo shares the
  contract surface).
- Stories review: the touched domains are the **union of every story's `repos`** under `stories/`.

So one gate, two option-shapes:
- Epic / UI / test-cases reviews: base rule (no risk tags, no per-repo routing).
- Architecture+contract review: escalated (`risk_tags: ["contract"]`) — owner + 1 reviewer + a
  `domain-owner` for **each** repo in `epic.repos`. (A small team may have one engineer own several
  repos — one person can supply several `domain-owner` records with different `domain` values.)
- Stories review: per-repo routing — owner + 1 reviewer + a `domain-owner` (the repo's engineer) for
  **each** repo that appears in any story's `repos`.

## Staleness
An approval round is invalidated if the authored artifact was edited after the newest `approved`
record's date/round. When that happens, drop back to `comment` — reviewers must re-approve the new
content. This prevents "approve, then quietly change it" (build plan §5 spirit).

For the architecture+contract review there is a second, content-based staleness check: recompute the
SHA-256 of the contract-surface block and compare it to `.sdlc/contract-lock.json`. A mismatch means
the locked surface changed even if the file's mtime looks fine — approvals are stale, re-lock and
re-approve. (Hash recipe: `yad-architecture/references/contract-format.md`.)

## Worked example — epic gate

1. `action: open` → `reviews/epic--2026-06-04--comments.md` seeded; step `epic-review` set
   `in_review`; `currentStep = epic-review`.
2. Reviewer *bob* leaves comments → captured in the comments file; owner *alice* (pm-assisted)
   edits `epic.md`.
3. `action: approve` approver *alice* role *owner* → ledger entry added. Predicate re-evaluated:
   `|owners|=1, |reviewers|=0` → **fails** (need 1 reviewer). Gate reports "missing: 1 reviewer".
4. `action: approve` approver *bob* role *reviewer* → ledger entry added. Predicate:
   `|owners|=1, |reviewers|=1` → **base pass**.
5. `action: advance` → `epic-review.status=done`, `architecture.status=in_progress`,
   `currentStep=architecture`. Gate reports the advance. The paired authoring step (`epic`) is closed
   too, if it was not already — a gate cannot have passed on an unauthored artifact. `doctor` reports
   any surviving violation as `YAD-STATE-005`; `yad gate repair <epic>` heals it.

## Participation record (comments.json)
`approvals.json` answers "who approved"; `.sdlc/comments.json` answers "who reviewed/commented". The
gate appends a record per commenter per round on every `comment` action (the machine-readable
counterpart to the `reviews/*--comments.md` markdown). It does **not** feed the predicate — approvals
alone decide the gate — but it makes the `approved.md` roster's "Reviewed / commented by" section
attributable, and it is the same shape a future service or the platform bridge can write.

## Non-blocking companion comments (`<!-- yad:noblock -->`)
The Review Companion posts scaffolding comments (the card deck, the chat log) and the social nudge.
These are fun/interactive aids, **not** review objections, so they must never hold the PR/MR — yet they
are deliberately **left unresolved** so they remain in the PR/MR history forever (anyone can scroll back
to see the trailer, cards, chat, and nudges). Every such comment carries a `<!-- yad:noblock -->`
marker, and the gate **excludes marked threads** from the unresolved-thread blocking check (so it does
not "resolve to pass" — it ignores them). A reviewer's *genuine* concern is posted **without** the
marker and blocks normally, exactly as a `CHANGES_REQUESTED` or any unresolved human thread does.

## Platform-backed input (the bridge)
When the hub has a platform (`.sdlc/hub.json`) and the bridge is enabled, reviewers can approve/comment
on a real PR/MR instead of (or as well as) the skill recording it directly. `action: sync`
(`yad-hub-bridge`) reads that platform state with the reviewer's own `gh`/`glab` and writes the **same**
`approvals.json` / `comments.json` / `reviews/*.md` records the manual path writes — bridge approvals
tagged `"source": "bridge"`. **The predicate above is unchanged**: it counts owner/reviewer/domain-owner
approvals regardless of how they were recorded.

- login → role(s) via the roster's **per-scope map** (`roles: { hub: [...], <repo>: [...] }`): a person
  can hold owner + reviewer + domain-owner at once, and a repo can list several people per role. The
  `hub` roles plus each touched domain's `roles[<repo>]` are emitted; `domain-owner` is also **derived**
  when a roster `name` equals a repo's `domain_owner`/`domain_owners` (legacy fallback) and that repo is a
  touched domain; an unmapped login is a plain `reviewer`, never promoted.
- On PR/MR open the assignee is the committer and reviewers are the scope's `reviewer` + `domain-owner`
  members (minus the committer); the owner/author is recorded, not requested. See
  `../yad-hub-bridge/references/login-roster.md`.
- `sync` is idempotent (upsert by `(step, approver, role, domain)`; supersede revoked; key comments on
  comment id) and never touches **manual** approvals.
- The architecture+contract staleness rule applies to bridge approvals too: a re-lock discards bridge
  approvals dated before the new lock.
- No platform / no CLI → the gate runs file-only with no error. Detail: `../yad-hub-bridge/references/bridge.md`.

## Why this shape
- Owner + 1 reviewer keeps review load low on a small team (design priority 2) while still requiring
  a second pair of eyes (priority 1, code quality / production safety).
- Risk-based escalation spends scarce domain-owner attention only where a change can break a shared
  surface (contract/auth/payments).
- Everything is a file, so a future service can drive the same gate by writing the same records.
