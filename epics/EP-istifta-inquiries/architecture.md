---
id: EP-istifta-inquiries
artifact: architecture
status: draft
repos: [backend, mobile]
---

## Overview
A user submits an inquiry from the mobile app; the backend persists it, assigns it to the scholar
queue, and tracks a single authoritative status until a scholar answers. The mobile app is a thin
client over the backend API and reacts to status changes; the backend owns all inquiry state and the
answer record. No third repo is involved (the dashboard is out of scope for this epic).

## Components by repo

### backend
- **Inquiry service** — owns the `Inquiry` lifecycle (`submitted → assigned → answered`) and the
  `Answer` record. Single writer of inquiry status; exposes assign/answer as scholar-only endpoints.
- **Queue read model** — exposes the pending-inquiry queue scholars work from (`GET /inquiries/queue`).
- **Notification hook** — emits the `inquiry.answered` event (in-app status only; push/email out of
  scope).

### mobile
- **Submit flow** — captures inquiry text + optional category and calls the submit endpoint.
- **My-inquiries list** — polls/reads inquiry status and renders the answer when present.
- **Scholar queue view** — for scholar accounts, lists the pending queue and posts answers.

## Cross-repo flows
1. **Submit:** mobile `POST /inquiries` → backend creates `Inquiry{status: submitted}` → returns id.
2. **Queue:** scholar `GET /inquiries/queue` → backend returns pending (`submitted`) inquiries.
3. **Assign:** scholar `POST /inquiries/{id}/assign` → backend moves `submitted → assigned` (the
   scholar claims it). Status is still backend-owned; the endpoint is the only trigger.
4. **Answer:** scholar `POST /inquiries/{id}/answer` → backend writes `Answer`, sets
   `status: answered`, emits `inquiry.answered`.
5. **Track:** mobile reads `GET /inquiries?mine=true` and `GET /inquiries/{id}` to show status/answer.

## Data ownership
- The **backend** owns the `Inquiry` and `Answer` entities and is the sole writer of `status`.
- The **mobile** app holds no durable inquiry state — it renders what the backend returns.

## Risks & decisions
- **Single source of status** (backend-owned) is the core invariant behind the epic's "no inquiry is
  silently lost" signal. Status is never set client-side.
- The cross-repo surface is small: four endpoints, one event, two shared entities. That surface is the
  contract (`contract.md`) and is what both repos must honour.
- Auth/roles (user vs scholar) are assumed from the existing platform; this epic does not change them,
  so the architecture review escalates only on `contract`, not `auth`.
