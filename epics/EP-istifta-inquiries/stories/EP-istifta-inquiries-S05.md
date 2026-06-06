---
id: EP-istifta-inquiries-S05
epic: EP-istifta-inquiries
status: draft
repos: [backend]
---

## Story
As the system, I want the backend to emit `inquiry.answered` when an answer is posted, so that the
mobile app can refresh in-app status without polling tightly.

## Acceptance criteria
- [ ] Posting an answer emits `inquiry.answered` with payload `{ inquiryId, answeredAt }`.
- [ ] The event is emitted exactly once per answer, after `status` is set to `answered`.
- [ ] No push/email is sent (out of scope) — the event drives in-app status only.

## Notes for build
- Contract surface touched: event `inquiry.answered`.
- Architecture component: backend Notification hook (in-app status only).
