---
id: EP-istifta-queue-filter-S01
epic: EP-istifta-queue-filter
status: shipped
repos: [backend]
---

## Story
As the team, I want a regression test that proves the pending queue excludes non-`submitted` inquiries,
so that a future refactor of the queue can never silently start leaking answered questions past CI.

## Acceptance criteria
- [ ] A test asserts `GET /inquiries/queue` (its `pending()` read model) **excludes** a known `answered`
  inquiry.
- [ ] A test asserts it excludes a known `assigned` inquiry.
- [ ] The happy path (a `submitted` inquiry IS returned) stays covered.

## Notes for build
- Contract surface touched: **none** — `GET /inquiries/queue` and `InquiryStatus` are unchanged. The
  read path is already correct; this story adds the **missing negative test** (a repo-private test
  change, not the cross-repo surface).
- Inherits the genesis contract by reference (pointer-lock `sha256:4abbbbc5…`); no re-lock.
- Architecture component: backend Inquiry service (the queue read path, `src/inquiry/queue.js`).
