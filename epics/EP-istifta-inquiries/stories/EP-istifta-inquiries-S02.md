---
id: EP-istifta-inquiries-S02
epic: EP-istifta-inquiries
status: draft
repos: [mobile]
---

## Story
As a user, I want to submit an inquiry from the mobile app, so that I can ask a scholar a question
without using scattered channels.

## Acceptance criteria
- [ ] Submit screen captures inquiry text and an optional category.
- [ ] On submit, the app calls `POST /inquiries` and shows submitting/error/success states.
- [ ] On success, the user lands on My Inquiries with the new item shown as `submitted`.

## Notes for build
- Contract surface touched: `POST /inquiries` (consumer).
- UI screens: Submit Inquiry; transitions into My Inquiries.
