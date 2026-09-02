---
id: EP-checkout
artifact: contract
status: locked
repos: [backend, mobile]
---

# Contract — EP-checkout

> Shared cross-repo surface only. Charter altitude. Changing anything inside the
> CONTRACT-SURFACE block re-locks the hash and invalidates prior approvals.

<!-- CONTRACT-SURFACE:BEGIN -->
## API

- `POST /orders` — place an order from the cart.
  - request: `{ items: { sku: string, qty: number }[], address: string, payment: string, note?: string }`
  - response: `{ id: string, status: "placed" }`
- `GET /orders?mine=true` — list the caller's orders.
  - response: `{ items: Order[] }`
- `GET /orders/{id}` — read one order (with fulfilment when present).
  - response: `Order`
- `GET /orders/queue` — list the pending (`placed`) queue (merchant role only).
  - response: `{ items: Order[] }`
- `POST /orders/{id}/assign` — merchant claims an order (merchant role only).
  - request: `{}`
  - response: `Order` (with `status: "assigned"`)
- `POST /orders/{id}/fulfil` — merchant ships the order (merchant role only).
  - request: `{ note: string }`
  - response: `Order` (with `status: "fulfilled"` and `fulfilment` populated)

## Events

- `order.fulfilled`
  - payload: `{ orderId: string, fulfilledAt: string }`
  - producer: backend · consumer: mobile (in-app status refresh only)

## Data model

- `Order`: `{ id: string, items: { sku: string, qty: number }[], address: string, payment: string, note?: string, status: OrderStatus, fulfilment?: Fulfilment }`
- `OrderStatus`: `"placed" | "assigned" | "fulfilled"`
- `Fulfilment`: `{ note: string, fulfilledAt: string }`
<!-- CONTRACT-SURFACE:END -->

## Notes
- `payment` is an opaque reference returned by the payment provider — the shop never stores card
  details. `note` is free-form for now; structured delivery instructions are a future epic.
- Push/email notification of `order.fulfilled` is explicitly out of scope — the event drives in-app
  status only.
