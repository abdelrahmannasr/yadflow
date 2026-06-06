---
id: EP-istifta-inquiries-S01
epic: EP-istifta-inquiries
status: shipped
repos: [backend]
---

## Story
As the system, I want the backend to accept and persist a submitted inquiry with an authoritative
status, so that no inquiry is ever lost and status has a single source of truth.

## Acceptance criteria
- [ ] `POST /inquiries` creates an `Inquiry` with `status: "submitted"` and returns `{ id, status }`.
- [ ] `text` is required; `category` is optional.
- [ ] Status is server-owned; there is no API path for a client to set status directly.

## Notes for build
- Contract surface touched: `POST /inquiries`, `Inquiry`, `InquiryStatus`.
- Architecture component: backend Inquiry service (sole writer of status).
