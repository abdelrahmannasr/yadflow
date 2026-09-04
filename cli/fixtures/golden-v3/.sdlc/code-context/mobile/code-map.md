---
repo: mobile
artifact: code-map
syncedHead: 691297e715678d65cce7d559dcd9aae6e5aa644f
generated: 2026-06-08
source: repomix
---

# Code-map — mobile

> Describes what is **already built** in `demo-repos/mobile` (from the Repomix pack + git history).
> Not a design. Unclear items are marked `<!-- unverified -->`.

## Stack & conventions
- Node.js, **frameworkless** thin-client modules (a `src/api` client + `src/screens` view logic). No UI
  framework wired in this demo.
- Tooling (`package.json`): `test` = `node --test`, `lint` = `node --check` over `src/**.js`, `build` = no-op.
- The mobile repo is a **thin client** over the backend's contract — it consumes endpoints, exposes none.

## Entry points
- `src/screens/MerchantQueue.js` — Merchant Queue screen logic (`loadQueue(http)`).
- `src/api/orders.js` — the orders HTTP client.

## Public endpoints / APIs
- None exposed (client only). **Consumes** these backend endpoints via `src/api/orders.js`:
  - `GET /orders/queue` → `getQueue(http)` returns `items` (`{ items: Order[] }`).
  - `POST /orders/{id}/assign` → `assign(http, id)`.
  - `POST /orders/{id}/fulfil` → `fulfil(http, id, body)`.
<!-- unverified: assign/fulfil are called here but have no handler in the backend repo's route table yet. -->

## Events
- None.

## Data models / entities
- Consumes `Order`; the Merchant Queue maps each to `{ id, itemCount, status }` for display (status shown only,
  not mutated client-side).

## Module layout
- `src/api/orders.js` — `getQueue`, `assign`, `fulfil` against the orders surface.
- `src/screens/MerchantQueue.js` — `loadQueue` (reads the queue, projects display fields).
- `specs/EP-checkout-S03/` — forward spec (+ `contracts/queue.md`) for the queue slice.
