---
id: EP-istifta-inquiries
artifact: contract
status: locked
repos: [backend, mobile]
---

# Contract — EP-istifta-inquiries

> Shared cross-repo surface only. Charter altitude. Changing anything inside the
> CONTRACT-SURFACE block re-locks the hash and invalidates prior approvals.

<!-- CONTRACT-SURFACE:BEGIN -->
## API

- `POST /inquiries` — submit an inquiry.
  - request: `{ text: string, category?: string }`
  - response: `{ id: string, status: "submitted" }`
- `GET /inquiries?mine=true` — list the caller's inquiries.
  - response: `{ items: Inquiry[] }`
- `GET /inquiries/{id}` — read one inquiry (with answer when present).
  - response: `Inquiry`
- `GET /inquiries/queue` — list the pending (`submitted`) queue (scholar role only).
  - response: `{ items: Inquiry[] }`
- `POST /inquiries/{id}/assign` — scholar claims an inquiry (scholar role only).
  - request: `{}`
  - response: `Inquiry` (with `status: "assigned"`)
- `POST /inquiries/{id}/answer` — scholar posts an answer (scholar role only).
  - request: `{ body: string }`
  - response: `Inquiry` (with `status: "answered"` and `answer` populated)

## Events

- `inquiry.answered`
  - payload: `{ inquiryId: string, answeredAt: string }`
  - producer: backend · consumer: mobile (in-app status refresh only)

## Data model

- `Inquiry`: `{ id: string, text: string, category?: string, status: InquiryStatus, answer?: Answer }`
- `InquiryStatus`: `"submitted" | "assigned" | "answered"`
- `Answer`: `{ body: string, answeredAt: string }`
<!-- CONTRACT-SURFACE:END -->

## Notes
- `category` is free-form for now; a controlled taxonomy is a future epic.
- Push/email notification of `inquiry.answered` is explicitly out of scope — the event drives in-app
  status only.
