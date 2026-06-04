# Gate predicate — details & worked example

## Reviewer rule
Let `A` = the set of `approved` records in `.sdlc/approvals.json` for this step.

- `owners = { a in A : a.role == "owner" }`
- `reviewers = { a in A : a.role == "reviewer" }`  (distinct by `approver`)
- `domainOwners = { a in A : a.role == "domain-owner" }`  (grouped by `a.domain`)

**Base pass:** `|owners| >= 1` AND `|reviewers| >= default_reviewers` (default `1`).

**Escalated pass** (step `risk_tags` ∩ `{contract, auth, payments}` ≠ ∅): base pass AND, for every
touched `domain`, `|domainOwners[domain]| >= 1`.

- Epic / UI / generic story reviews: base rule.
- Architecture+contract review: escalated (`risk_tags: ["contract"]`) — needs owner + 1 reviewer +
  the contract domain owner.
- Stories review: each repo's engineer is the `domain-owner` for that repo's stories.

## Staleness
An approval round is invalidated if the authored artifact was edited after the newest `approved`
record's date/round. When that happens, drop back to `comment` — reviewers must re-approve the new
content. This prevents "approve, then quietly change it" (build plan §5 spirit).

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
   `currentStep=architecture`. Gate reports the advance.

## Why this shape
- Owner + 1 reviewer keeps review load low on a small team (design priority 2) while still requiring
  a second pair of eyes (priority 1, code quality / production safety).
- Risk-based escalation spends scarce domain-owner attention only where a change can break a shared
  surface (contract/auth/payments).
- Everything is a file, so a future service can drive the same gate by writing the same records.
