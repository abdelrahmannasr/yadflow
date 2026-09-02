---
id: EP-checkout-S05
epic: EP-checkout
status: draft
repos: [backend]
---

## Story
As the system, I want the backend to emit `order.fulfilled` when an order ships, so that the
mobile app can refresh in-app status without polling tightly.

## Acceptance criteria
- [ ] Fulfilling an order emits `order.fulfilled` with payload `{ orderId, fulfilledAt }`.
- [ ] The event is emitted exactly once per order, after `status` is set to `fulfilled`.
- [ ] No push/email is sent (out of scope) — the event drives in-app status only.

## Notes for build
- Contract surface touched: event `order.fulfilled`.
- Architecture component: backend Notification hook (in-app status only).
