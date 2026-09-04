# Review comments — ui-design.md — 2026-06-06

## bob (reviewer)
- Status pill must not rely on color alone — confirm a text label is always shown. (Owner: confirmed;
  noted under Accessibility and in `DESIGN.md` StatusPill.)
- Add an explicit empty state for My Orders so a first-time user isn't staring at a blank screen.

## Resolution (owner: alice, ux-designer-assisted)
- `ui-design.md` now lists an empty state ("No orders yet") for My Orders and an empty Merchant
  Queue state.
- StatusPill documented as label + color (never color alone) in both `ui-design.md` and `DESIGN.md`.
- Reviewer asked to re-check before approving.
