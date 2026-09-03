# Approval record — stories/ — 2026-06-06

Reviewer rule in force: **per-repo routing**. Base rule (owner + 1 reviewer) **plus** a `domain-owner`
for every repo appearing in any story's `repos`. Touched repos (union over all stories): **backend,
mobile**.

Story → repos map:
- S01 → backend
- S02 → mobile
- S03 → backend, mobile
- S04 → mobile
- S05 → backend

## Approved so far
- alice — owner — approved 2026-06-06
- bob — reviewer — approved 2026-06-06
- carol — domain-owner (backend) — approved 2026-06-06
- dave — domain-owner (mobile) — approved 2026-06-06

## Still required to pass the gate
- none (backend ✓ carol, mobile ✓ dave)

Gate status: **PASSED** — owner + 1 reviewer + a domain owner for every touched repo (backend, mobile)
satisfied. Workflow advances to `ready-for-build` (the Phase 3 handoff point).
