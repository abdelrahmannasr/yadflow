---
id: EP-checkout-S03
epic: EP-checkout
status: in-build
repos: [backend, mobile]
---

## Story
As a merchant, I want to see the pending order queue and fulfil an order, so that every order ships
through a single auditable path.

## Acceptance criteria
- [ ] `GET /orders/queue` (merchant role only) returns the pending (`placed`) orders.
- [ ] `POST /orders/{id}/assign` (merchant role only) moves an order `placed → assigned`.
- [ ] `POST /orders/{id}/fulfil` (merchant role only) writes the `Fulfilment` and sets
      `status: "fulfilled"`.
- [ ] Mobile Merchant Queue lists pending items, lets a merchant claim (assign) one, and provides a
      compose-and-ship flow.

## Notes for build
- Contract surface touched: `GET /orders/queue`, `POST /orders/{id}/assign`,
  `POST /orders/{id}/fulfil`, `Fulfilment`, `OrderStatus` (assigned, fulfilled).
- Architecture components: backend Order service + Queue read model; mobile Merchant Queue view.
