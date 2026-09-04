---
id: EP-checkout
status: ready-for-build
kind: feature
thread: EP-checkout
owner: alice
technical_product_owner: winston
repos: [backend, mobile]
---

## Goal
Let customers check out a cart from the mobile app and track each order until it ships, so an order
is never lost between the customer and the merchant and the customer always knows where it stands.

## Scope
- Place an order (cart items + delivery address + payment) from the mobile app.
- Merchants view a pending queue and fulfil orders.
- Customers see status (placed → assigned → fulfilled) and read the fulfilment details.

## Out of scope
- Returns, refunds and cancellation flows (future epic).
- Discount codes or priority delivery handling.

## Context / background
Today orders arrive over scattered channels with no tracking. This epic creates a single,
auditable path from cart to shipped order across the mobile app and backend.

## Acceptance signals (user-level)
- A customer can place an order and later see its confirmation and shipping note in the app.
- A merchant can see the pending queue and fulfil an order.
- No order can be silently lost: every order has a status at all times.
