---
id: EP-checkout
artifact: architecture
status: draft
repos: [backend, mobile]
---

## Overview
A customer places an order from the mobile app; the backend persists it, puts it on the merchant
queue, and tracks a single authoritative status until a merchant fulfils it. The mobile app is a thin
client over the backend API and reacts to status changes; the backend owns all order state and the
fulfilment record. No third repo is involved (the web storefront is out of scope for this epic).

## Components by repo

### backend
- **Order service** — owns the `Order` lifecycle (`placed → assigned → fulfilled`) and the
  `Fulfilment` record. Single writer of order status; exposes assign/fulfil as merchant-only endpoints.
- **Queue read model** — exposes the pending-order queue merchants work from (`GET /orders/queue`).
- **Notification hook** — emits the `order.fulfilled` event (in-app status only; push/email out of
  scope).

### mobile
- **Checkout flow** — captures cart items, delivery address and payment, and calls the place endpoint.
- **My-orders list** — polls/reads order status and renders the fulfilment when present.
- **Merchant queue view** — for merchant accounts, lists the pending queue and fulfils orders.

## Cross-repo flows
1. **Checkout:** mobile `POST /orders` → backend creates `Order{status: placed}` → returns id.
2. **Queue:** merchant `GET /orders/queue` → backend returns pending (`placed`) orders.
3. **Assign:** merchant `POST /orders/{id}/assign` → backend moves `placed → assigned` (the
   merchant claims it). Status is still backend-owned; the endpoint is the only trigger.
4. **Fulfil:** merchant `POST /orders/{id}/fulfil` → backend writes `Fulfilment`, sets
   `status: fulfilled`, emits `order.fulfilled`.
5. **Track:** mobile reads `GET /orders?mine=true` and `GET /orders/{id}` to show status/fulfilment.

## Data ownership
- The **backend** owns the `Order` and `Fulfilment` entities and is the sole writer of `status`.
- The **mobile** app holds no durable order state — it renders what the backend returns.

## Risks & decisions
- **Single source of status** (backend-owned) is the core invariant behind the epic's "no order is
  silently lost" signal. Status is never set client-side.
- The cross-repo surface is small: six endpoints, one event, two shared entities. That surface is the
  contract (`contract.md`) and is what both repos must honour.
- The order carries an opaque `payment` reference from the provider — no card details ever reach the
  shop — but the surface still touches money, so the architecture review escalates on `contract` and
  `payments`. Auth/roles (customer vs merchant) come from the existing platform and are unchanged,
  so `auth` is not tagged.
