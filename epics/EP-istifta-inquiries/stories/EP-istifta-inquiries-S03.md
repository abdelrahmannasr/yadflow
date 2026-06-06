---
id: EP-istifta-inquiries-S03
epic: EP-istifta-inquiries
status: in-build
repos: [backend, mobile]
---

## Story
As a scholar, I want to see the pending inquiry queue and post an answer, so that questions are
answered through a single auditable path.

## Acceptance criteria
- [ ] `GET /inquiries/queue` (scholar role only) returns the pending (`submitted`) inquiries.
- [ ] `POST /inquiries/{id}/assign` (scholar role only) moves an inquiry `submitted → assigned`.
- [ ] `POST /inquiries/{id}/answer` (scholar role only) writes the `Answer` and sets
      `status: "answered"`.
- [ ] Mobile Scholar Queue lists pending items, lets a scholar claim (assign) one, and provides a
      compose-and-post answer flow.

## Notes for build
- Contract surface touched: `GET /inquiries/queue`, `POST /inquiries/{id}/assign`,
  `POST /inquiries/{id}/answer`, `Answer`, `InquiryStatus` (assigned, answered).
- Architecture components: backend Inquiry service + Queue read model; mobile Scholar Queue view.
