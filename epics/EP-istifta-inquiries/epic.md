---
id: EP-istifta-inquiries
status: ready-for-build
owner: alice
technical_product_owner: winston
repos: [backend, mobile]
---

## Goal
Let users submit religious inquiries (istifta) to scholars and track each inquiry until it is
answered, so questions are not lost in email threads and answers are reusable.

## Scope
- Submit an inquiry (text + optional category) from the mobile app.
- Scholars view a queue and post answers.
- Users see status (submitted → assigned → answered) and read the answer.

## Out of scope
- Public Q&A library / search across past answers (future epic).
- Payment or priority handling.

## Context / background
Today inquiries arrive over scattered channels with no tracking. This epic creates a single,
auditable path from question to scholarly answer across the mobile app and backend.

## Acceptance signals (user-level)
- A user can submit an inquiry and later see its answer in the app.
- A scholar can see the pending queue and answer an inquiry.
- No inquiry can be silently lost: every inquiry has a status at all times.
