---
id: EP-checkout-queue-filter
status: draft
kind: defect
parent: EP-checkout
thread: EP-checkout
inherits: [epic, architecture, contract, ui-design]
supersedes: []
owner: alice
repos: [backend]
origin: qa
severity: sev3
escape_stage: test-cases
root_cause: missing-negative-test
---

## Change

QA review found that the merchant **pending queue** (`GET /orders/queue`) has **no regression test
asserting it excludes `fulfilled`/`assigned` orders**. The read path itself is correct today
(`queue.js` filters `status === 'placed'`), but that exclusion is **completely untested** — a latent
quality gap: any future refactor of the queue could silently start leaking fulfilled orders and pass
CI. The contract is unchanged (the queue is defined as the pending/`placed` queue). So this is a
`defect-fix` whose fix is the **missing negative test**, not a code or contract change.

## Resolved current truth (input)

`yad thread EP-checkout` resolves the genesis epic (`EP-checkout`) as the owner of
`epic` / `architecture` / `contract` / `ui-design`. This change inherits all four **by reference** and
re-authors only `stories` + `test-cases`.

## Re-authored vs inherited

- **Re-authored:** `stories` (a regression story stating the queue excludes fulfilled orders),
  `test-cases` (the negative case that would have caught this).
- **Inherited (by reference, not re-reviewed):** `epic`, `architecture`, `contract` (the surface is
  unchanged — the pointer-lock carries the genesis hash verbatim), `ui-design`.

## Escape analysis

- **Escaped at:** the `test-cases` gate — no case asserted the queue's negative behaviour, so the
  build-half tests passed against an incomplete spec of behaviour.
- **Root cause:** `missing-negative-test`. The fix adds the regression test so the gap closes
  permanently (the suite is the durable memory of the bug).
