---
id: EP-checkout-queue-filter-S01
epic: EP-checkout-queue-filter
status: shipped
repos: [backend]
---

## Story
As the team, I want a regression test that proves the pending queue excludes non-`placed` orders,
so that a future refactor of the queue can never silently start leaking fulfilled orders past CI.

## Acceptance criteria
- [ ] A test asserts `GET /orders/queue` (its `pending()` read model) **excludes** a known `fulfilled`
  order.
- [ ] A test asserts it excludes a known `assigned` order.
- [ ] The happy path (a `placed` order IS returned) stays covered.

## Notes for build
- Contract surface touched: **none** — `GET /orders/queue` and `OrderStatus` are unchanged. The
  read path is already correct; this story adds the **missing negative test** (a repo-private test
  change, not the cross-repo surface).
- Inherits the genesis contract by reference (pointer-lock `sha256:3c8094c8…`); no re-lock.
- Architecture component: backend Order service (the queue read path, `src/order/queue.js`).
