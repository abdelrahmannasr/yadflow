---
id: EP-checkout
artifact: ui-design
status: draft
repos: [backend, mobile]
impeccable: not-installed
---

> Impeccable is not installed in this environment, so the `ux-designer` lens authored this design and
> `DESIGN.md` directly (graceful degradation per `yad-ui`). When Impeccable is available, run
> `/impeccable document → extract → craft` (existing project) to regenerate these from code.

## Screens & states

### Checkout
- **purpose:** review the cart, capture delivery address and payment, and place the order.
- **states:** empty cart (prompt to browse) · editing · placing (disabled button) · error (retry) ·
  success (navigates to My Orders with the new order at top, `status: placed`).

### My Orders (list)
- **purpose:** show the customer's orders with current status.
- **states:** empty ("No orders yet") · loading skeleton · loaded (rows with status pill) · error.

### Order Detail
- **purpose:** read one order and its fulfilment when present.
- **states:** loading · placed/assigned (status pill, "awaiting shipment") · fulfilled (shipping note +
  fulfilledAt) · error.

### Merchant Queue (merchant role)
- **purpose:** list pending orders, claim one, and fulfil it.
- **states:** empty queue · loaded list · claiming (assign → `assigned`) · fulfilling (compose shipping
  note) · fulfilled (item leaves queue).

## User flows
1. **Checkout → track:** Checkout → success → My Orders → tap row → Order Detail (satisfies
   "a customer can place an order and later see its confirmation and shipping note").
2. **Merchant fulfil:** Merchant Queue → claim item (`placed → assigned`) → compose shipping note →
   ship → item becomes `fulfilled` (satisfies "a merchant can see the pending queue and fulfil an
   order").

## Components & tokens
- `StatusPill` (placed/assigned/fulfilled) — new; maps 1:1 to `OrderStatus` from the contract.
- `OrderRow`, `FulfilmentCard`, `PrimaryButton`, `TextArea` — see `DESIGN.md` tokens.
- Reuses existing platform navigation and typography tokens.

## Accessibility & responsiveness
- Status conveyed by **label + color**, never color alone (a11y).
- Single-column phone layout; comfortable tap targets (≥44pt); order items list scrollable.
- Form fields labelled; place-order disabled state announced to screen readers.
