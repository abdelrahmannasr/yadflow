# Review comments — epic.md — 2026-06-04

## bob (reviewer)
- "Out of scope" should explicitly mention notifications — are customers notified when an order ships?
- Acceptance signals are good. Add a signal that a merchant cannot fulfil the same order twice.

## Resolution (owner: alice, pm-assisted)
- Clarified in `epic.md`: notifications are out of scope for this epic (status visible in-app only).
- Added acceptance signal that every order has a status at all times (covers no-double-fulfil
  intent at the user level; detailed rule deferred to architecture).
- Reviewers asked to re-check the updated epic before approving.
