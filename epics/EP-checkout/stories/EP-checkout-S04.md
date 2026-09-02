---
id: EP-checkout-S04
epic: EP-checkout
status: draft
repos: [mobile]
---

## Story
As a customer, I want to see my orders and read the shipping note when it arrives, so that I can
track each order from checkout to delivery.

## Acceptance criteria
- [ ] My Orders list reads `GET /orders?mine=true` and shows a status pill per item.
- [ ] Order Detail reads `GET /orders/{id}` and renders the fulfilment when `status == "fulfilled"`.
- [ ] Empty, loading, and error states are handled for both screens.

## Notes for build
- Contract surface touched: `GET /orders?mine=true`, `GET /orders/{id}`, `Order`, `Fulfilment`.
- UI screens: My Orders (list), Order Detail; components StatusPill, FulfilmentCard.
