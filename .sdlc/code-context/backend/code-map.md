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
- `src/inquiry/index.js` — the Inquiry service (`create`), the sole writer of inquiry status.

## Public endpoints / APIs (as implemented)
- `POST /inquiries` — `postInquiries(body)`; request `{ text, category? }` → `201 { id, status: "submitted" }`.
  Validates `text` is a non-blank string (else `400 "text is required"`).
- `GET /inquiries/queue` — `getQueue(items)`; → `200 { items: Inquiry[] }`, filtered to `status === "submitted"`.
<!-- unverified: the contract references POST /inquiries/{id}/assign and /answer (the mobile client calls
     them), but the backend route table here implements ONLY the two endpoints above — assign/answer have
     no handler in this repo yet. -->

## Events
- None found in the code. <!-- unverified: the epic contract names an `inquiry.answered` event; no producer
     exists in this repo. -->

## Data models / entities
- `Inquiry { id (uuid), text, category?, status }`. Observed `status` value: `"submitted"`.
- Persistence: in-memory `Map` (`src/inquiry/store.js`, `save()` only) — explicitly a repo-local concern,
  not contract surface. No `list()`/read API on the store yet (queue projection takes items from the caller).

## Module layout
- `src/routes.js` — HTTP route wiring.
- `src/inquiry/` — `index.js` (service `create`), `store.js` (in-memory save), `queue.js` (`pending` read
  model), `validate.js` (input validation).
- `src/health/healthcheck.js` — liveness/readiness (`{ status, uptimeMs, checks }`); pre-SDLC feature, has a
  backfill spec under `specs/backfill/health/`.
- `specs/` — forward specs `EP-istifta-inquiries-S01`, `-S03` (+ their `contracts/` slices); `specs/backfill/health`.
