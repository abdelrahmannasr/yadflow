# Review comments — architecture.md — 2026-06-06

## bob (reviewer)
- The submit response only returns `id` and `status` — confirm the mobile app doesn't need the full
  `Inquiry` echoed back on create. (Owner: confirmed; mobile re-reads via GET, kept lean.)
- "Assign" has no endpoint in the contract. Is assignment purely a backend-internal transition?

## carol (domain-owner — backend)
- The contract says backend is the sole writer of `status`. Good — but make the `inquiry.answered`
  event payload explicit (id + timestamp) so consumers don't have to re-fetch to know *when*.
- `Answer` should be part of the `Inquiry` read shape, not a separate fetch.

## dave (domain-owner — mobile)
- Mobile needs `GET /inquiries?mine=true` for the list and `GET /inquiries/{id}` for detail — both are
  present. 👍
- Please confirm `category` is optional on submit so the form can ship without a taxonomy.

## Resolution (owner: alice, architect-assisted)
- Addressed bob's "assign has no endpoint": added explicit scholar-only endpoints to the contract —
  `GET /inquiries/queue` (pending queue) and `POST /inquiries/{id}/assign` (scholar claims an inquiry,
  `submitted → assigned`). Status stays backend-owned; the endpoint is the only trigger.
- `contract.md` updated: `inquiry.answered` payload is `{ inquiryId, answeredAt }`; `Inquiry` read
  shape embeds `answer?: Answer`; `category` is optional on `POST /inquiries`.
- Contract surface re-locked after these edits; `.sdlc/contract-lock.json` reflects the final hash.
- Reviewers and both domain owners asked to re-check the locked surface before approving.
