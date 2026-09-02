# DESIGN.md — EP-checkout

> Conventionally Impeccable's root design-system file. Hand-authored here (Impeccable not installed).

## Tokens
- **color.status.placed** — neutral/grey
- **color.status.assigned** — info/blue
- **color.status.fulfilled** — success/green
- **spacing** — 4pt base scale (4/8/12/16/24)
- **radius** — 8pt cards, 4pt pills
- **type** — inherit platform scale (title / body / caption)

## Components
- **StatusPill** — label + dot; one variant per `OrderStatus`. Label always present (a11y).
- **OrderRow** — summary (first item + count), `StatusPill`, chevron. Tap → Order Detail.
- **FulfilmentCard** — shipping `note` + `fulfilledAt`, shown only when `status == fulfilled`.
- **PrimaryButton** — place order / ship; explicit disabled + loading states.
- **TextArea** — labelled multi-line input for the delivery note / shipping note.

## Notes
- Components map directly onto the contract surface (`OrderStatus`, `Fulfilment`) — no UI-invented
  fields beyond what `contract.md` defines.
