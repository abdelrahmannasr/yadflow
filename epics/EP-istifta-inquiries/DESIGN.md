# DESIGN.md — EP-istifta-inquiries

> Conventionally Impeccable's root design-system file. Hand-authored here (Impeccable not installed).

## Tokens
- **color.status.submitted** — neutral/grey
- **color.status.assigned** — info/blue
- **color.status.answered** — success/green
- **spacing** — 4pt base scale (4/8/12/16/24)
- **radius** — 8pt cards, 4pt pills
- **type** — inherit platform scale (title / body / caption)

## Components
- **StatusPill** — label + dot; one variant per `InquiryStatus`. Label always present (a11y).
- **InquiryRow** — title (truncated `text`), `StatusPill`, chevron. Tap → Inquiry Detail.
- **AnswerCard** — answer `body` + `answeredAt`, shown only when `status == answered`.
- **PrimaryButton** — submit/post; explicit disabled + loading states.
- **TextArea** — labelled multi-line input for inquiry text / answer body.

## Notes
- Components map directly onto the contract surface (`InquiryStatus`, `Answer`) — no UI-invented
  fields beyond what `contract.md` defines.
