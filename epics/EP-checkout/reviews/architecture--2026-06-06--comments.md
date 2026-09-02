# Review comments — architecture.md — 2026-06-06

## bob (reviewer)
- The place-order response only returns `id` and `status` — confirm the mobile app doesn't need the full
  `Order` echoed back on create. (Owner: confirmed; mobile re-reads via GET, kept lean.)
- "Assign" has no endpoint in the contract. Is assignment purely a backend-internal transition?

## carol (domain-owner — backend)
- The contract says backend is the sole writer of `status`. Good — but make the `order.fulfilled`
  event payload explicit (id + timestamp) so consumers don't have to re-fetch to know *when*.
- `Fulfilment` should be part of the `Order` read shape, not a separate fetch.

## dave (domain-owner — mobile)
- Mobile needs `GET /orders?mine=true` for the list and `GET /orders/{id}` for detail — both are
  present. 👍
- Please confirm `note` is optional at checkout so the form can ship without delivery instructions.

## Resolution (owner: alice, architect-assisted)
- Addressed bob's "assign has no endpoint": added explicit merchant-only endpoints to the contract —
  `GET /orders/queue` (pending queue) and `POST /orders/{id}/assign` (merchant claims an order,
  `placed → assigned`). Status stays backend-owned; the endpoint is the only trigger.
- `contract.md` updated: `order.fulfilled` payload is `{ orderId, fulfilledAt }`; `Order` read
  shape embeds `fulfilment?: Fulfilment`; `note` is optional on `POST /orders`.
- Contract surface re-locked after these edits; `.sdlc/contract-lock.json` reflects the final hash.
- Reviewers and both domain owners asked to re-check the locked surface before approving.
