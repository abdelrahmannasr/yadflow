---
id: EP-istifta-inquiries-S04
epic: EP-istifta-inquiries
status: draft
repos: [mobile]
---

## Story
As a user, I want to see my inquiries and read an answer when it arrives, so that I can track each
question from submission to answer.

## Acceptance criteria
- [ ] My Inquiries list reads `GET /inquiries?mine=true` and shows a status pill per item.
- [ ] Inquiry Detail reads `GET /inquiries/{id}` and renders the answer when `status == "answered"`.
- [ ] Empty, loading, and error states are handled for both screens.

## Notes for build
- Contract surface touched: `GET /inquiries?mine=true`, `GET /inquiries/{id}`, `Inquiry`, `Answer`.
- UI screens: My Inquiries (list), Inquiry Detail; components StatusPill, AnswerCard.
