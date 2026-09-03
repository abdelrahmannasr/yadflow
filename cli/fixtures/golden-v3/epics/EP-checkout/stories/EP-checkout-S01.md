---
id: EP-checkout-S01
epic: EP-checkout
status: shipped
repos: [backend]
---

## Story
As the system, I want the backend to accept and persist a placed order with an authoritative
status, so that no order is ever lost and status has a single source of truth.

## Acceptance criteria
- [ ] `POST /orders` creates an `Order` with `status: "placed"` and returns `{ id, status }`.
- [ ] `items`, `address` and `payment` are required; `note` is optional.
- [ ] Status is server-owned; there is no API path for a client to set status directly.

## Notes for build
- Contract surface touched: `POST /orders`, `Order`, `OrderStatus`.
- Architecture component: backend Order service (sole writer of status).
