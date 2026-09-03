---
id: EP-checkout-queue-filter
artifact: test-cases
thread: EP-checkout
testing: none
---

# Test cases — EP-checkout-queue-filter (defect regression)

These cases close the gap that let the defect ship: the original `test-cases` for
`EP-checkout` asserted the *happy* queue path but **no negative case** that a `fulfilled`
order is excluded. This is the `escape_stage: test-cases` / `root_cause: missing-negative-test` fix.

## TC-QF-01 — queue returns only placed orders (happy path, retained)
- **Given** orders in states `placed`, `assigned`, `fulfilled`
- **When** `GET /orders/queue` (merchant role)
- **Then** the response contains the `placed` order.

## TC-QF-02 — queue EXCLUDES fulfilled orders (the missing negative case)
- **Given** an order with `status: "fulfilled"`
- **When** `GET /orders/queue` (merchant role)
- **Then** the fulfilled order is **NOT** in the response — `items` contains no order whose
  `status != "placed"`.
- **Why this case exists:** its absence is the documented `escape_stage` for this defect. It is now a
  permanent regression test (the suite is the durable memory of the bug).

## TC-QF-03 — queue EXCLUDES assigned orders
- **Given** an order with `status: "assigned"`
- **When** `GET /orders/queue`
- **Then** the assigned order is not returned.
