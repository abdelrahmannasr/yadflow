---
repo: backend
artifact: code-map
syncedHead: 4826e8ff2b6d423eca3fcd2457cf6526003f7448
generated: 2026-06-08
source: repomix
---

# Code-map — backend

> Describes what is **already built** in `demo-repos/backend` (from the Repomix pack + git history).
> Not a design. Unclear items are marked `<!-- unverified -->`.

## Stack & conventions
- Node.js, **frameworkless**. HTTP is a plain route map `"METHOD /path" -> handler(body) -> { status, body }`
  (`src/routes.js`), not Express/Fastify.
- Tooling (`package.json`): `test` = `node --test`, `lint` = `node --check` over `src/**.js`, `build` = no-op.
- Contract slices are **quoted in code comments** at each handler; status is **server-owned** (a client
  cannot set `status`).

## Entry points
- `src/routes.js` — the route table (`routes` map) + exported handlers.
- `src/order/index.js` — the Order service (`create`), the sole writer of order status.

## Public endpoints / APIs (as implemented)
- `POST /orders` — `postOrders(body)`; request `{ items, address, payment, note? }` → `201 { id, status: "placed" }`.
  Validates `items` is a non-empty array (else `400 "items is required"`).
- `GET /orders/queue` — `getQueue(items)`; → `200 { items: Order[] }`, filtered to `status === "placed"`.
<!-- unverified: the contract references POST /orders/{id}/assign and /fulfil (the mobile client calls
     them), but the backend route table here implements ONLY the two endpoints above — assign/fulfil have
     no handler in this repo yet. -->

## Events
- None found in the code. <!-- unverified: the epic contract names an `order.fulfilled` event; no producer
     exists in this repo. -->

## Data models / entities
- `Order { id (uuid), items, address, payment, note?, status }`. Observed `status` value: `"placed"`.
- Persistence: in-memory `Map` (`src/order/store.js`, `save()` only) — explicitly a repo-local concern,
  not contract surface. No `list()`/read API on the store yet (queue projection takes items from the caller).

## Module layout
- `src/routes.js` — HTTP route wiring.
- `src/order/` — `index.js` (service `create`), `store.js` (in-memory save), `queue.js` (`pending` read
  model), `validate.js` (input validation).
- `src/health/healthcheck.js` — liveness/readiness (`{ status, uptimeMs, checks }`); pre-SDLC feature, has a
  backfill spec under `specs/backfill/health/`.
- `specs/` — forward specs `EP-checkout-S01`, `-S03` (+ their `contracts/` slices); `specs/backfill/health`.
