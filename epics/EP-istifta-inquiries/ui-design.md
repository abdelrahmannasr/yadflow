---
id: EP-istifta-inquiries
artifact: ui-design
status: draft
repos: [backend, mobile]
impeccable: not-installed
---

> Impeccable is not installed in this environment, so the `ux-designer` lens authored this design and
> `DESIGN.md` directly (graceful degradation per `sdlc-author-ui`). When Impeccable is available, run
> `/impeccable document → extract → craft` (existing project) to regenerate these from code.

## Screens & states

### Submit Inquiry
- **purpose:** capture inquiry text + optional category and submit.
- **states:** empty (placeholder prompt) · typing · submitting (disabled button) · error (retry) ·
  success (navigates to My Inquiries with the new item at top, `status: submitted`).

### My Inquiries (list)
- **purpose:** show the user's inquiries with current status.
- **states:** empty ("No inquiries yet") · loading skeleton · loaded (rows with status pill) · error.

### Inquiry Detail
- **purpose:** read one inquiry and its answer when present.
- **states:** loading · submitted/assigned (status pill, "awaiting answer") · answered (answer body +
  answeredAt) · error.

### Scholar Queue (scholar role)
- **purpose:** list pending inquiries, claim one, and post an answer.
- **states:** empty queue · loaded list · claiming (assign → `assigned`) · answering (compose answer) ·
  posted (item leaves queue).

## User flows
1. **Submit → track:** Submit Inquiry → success → My Inquiries → tap row → Inquiry Detail (satisfies
   "a user can submit an inquiry and later see its answer").
2. **Scholar answer:** Scholar Queue → claim item (`submitted → assigned`) → compose → post → item
   becomes `answered` (satisfies "a scholar can see the pending queue and answer an inquiry").

## Components & tokens
- `StatusPill` (submitted/assigned/answered) — new; maps 1:1 to `InquiryStatus` from the contract.
- `InquiryRow`, `AnswerCard`, `PrimaryButton`, `TextArea` — see `DESIGN.md` tokens.
- Reuses existing platform navigation and typography tokens.

## Accessibility & responsiveness
- Status conveyed by **label + color**, never color alone (a11y).
- Single-column phone layout; comfortable tap targets (≥44pt); answer body scrollable.
- Form fields labelled; submit disabled state announced to screen readers.
