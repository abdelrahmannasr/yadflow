---
id: EP-istifta-queue-filter
artifact: test-cases
thread: EP-istifta-inquiries
testing: none
---

# Test cases — EP-istifta-queue-filter (defect regression)

These cases close the gap that let the defect ship: the original `test-cases` for
`EP-istifta-inquiries` asserted the *happy* queue path but **no negative case** that an `answered`
inquiry is excluded. This is the `escape_stage: test-cases` / `root_cause: missing-negative-test` fix.

## TC-QF-01 — queue returns only submitted (happy path, retained)
- **Given** inquiries in states `submitted`, `assigned`, `answered`
- **When** `GET /inquiries/queue` (scholar role)
- **Then** the response contains the `submitted` inquiry.

## TC-QF-02 — queue EXCLUDES answered inquiries (the missing negative case)
- **Given** an inquiry with `status: "answered"`
- **When** `GET /inquiries/queue` (scholar role)
- **Then** the answered inquiry is **NOT** in the response — `items` contains no inquiry whose
  `status != "submitted"`.
- **Why this case exists:** its absence is the documented `escape_stage` for this defect. It is now a
  permanent regression test (the suite is the durable memory of the bug).

## TC-QF-03 — queue EXCLUDES assigned inquiries
- **Given** an inquiry with `status: "assigned"`
- **When** `GET /inquiries/queue`
- **Then** the assigned inquiry is not returned.
