---
id: EP-checkout-S02
epic: EP-checkout
status: draft
repos: [mobile]
---

## Story
As a customer, I want to check out my cart from the mobile app, so that I can buy what I picked
without leaving the app or losing the order.

## Acceptance criteria
- [ ] Checkout screen shows the cart items and captures a delivery address, payment and optional note.
- [ ] On place, the app calls `POST /orders` and shows placing/error/success states.
- [ ] On success, the customer lands on My Orders with the new order shown as `placed`.

## Notes for build
- Contract surface touched: `POST /orders` (consumer).
- UI screens: Checkout; transitions into My Orders.
