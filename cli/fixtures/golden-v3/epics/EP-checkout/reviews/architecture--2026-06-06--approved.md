# Approval record — architecture.md — 2026-06-06

Reviewer rule in force: **escalated** (`risk_tags: ["contract", "payments"]`). The architecture+contract
review touches the shared surface and the payment reference carried on the order, so it needs owner +
1 reviewer **plus a domain-owner for each repo in `epic.repos` ([backend, mobile])**.

Contract surface locked: `sha256:3c8094c88f7d347910fb1bc623a3b42c61d57f986c789c7d5c1871573f025831`
(`.sdlc/contract-lock.json`). Approvals below are against this locked surface.

## Approved so far
- alice — owner — approved 2026-06-06
- bob — reviewer — approved 2026-06-06
- carol — domain-owner (backend) — approved 2026-06-06
- dave — domain-owner (mobile) — approved 2026-06-06

## Still required to pass the gate
- none

Gate status: **PASSED** — owner + 1 reviewer + a domain owner for every touched repo (backend, mobile)
satisfied, and the contract-surface hash matches the lock. Workflow advances to `ui-design`.
