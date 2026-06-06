# Impact & Risk block and review routing

The PR/MR template (Phase 3 build plan §D) carries an **Impact & Risk** block so every change states
its blast radius before review, and so high-risk changes pull in the right reviewers automatically —
reusing the escalation `sdlc-review-gate` already applies on the front-half gates.

## The Impact & Risk block

```
## Impact & Risk
- **Domains / repos touched:** <backend | mobile | …>
- **Contract surface touched:** no
- **Risk level:** low
- **Rollback plan:** <how to revert>
```

- **Domains / repos touched** — the domains this change affects; these are the candidate domain owners
  when the change escalates.
- **Contract surface touched** — `yes` means the diff changes the shared contract surface. That path is
  governed by `contract-check` (needs `Contract-Change: yes` + a re-locked contract) AND it escalates
  the review (contract is a `sdlc-review-gate` risk tag).
- **Risk level** — `low | medium | high`. The author's assessment of blast radius.
- **Rollback plan** — how to revert safely.

## Routing rule (reuses the gate's escalation)

| Condition | Required reviewers |
|-----------|--------------------|
| `low` / `medium`, no sensitive surface | **base rule:** owner + 1 reviewer |
| `high`, OR a touched contract/auth/payments surface | base rule **plus one domain-owner approval per touched domain** |

This is exactly `sdlc-review-gate`'s rule (`references/gating.md`): the base rule is owner + 1
reviewer; escalation adds a domain-owner per touched domain. The PR template applies the same logic at
the code-review boundary so a risky PR cannot be approved by just any two people. The **approvals are
recorded by the engineer review (Step E) through `sdlc-review-gate`** — the template and `risk-route.sh`
only *route* (advisory); they never approve or merge.

## risk-route.sh

`bash checks/risk-route.sh <pr-description-file>` parses the Impact & Risk block and prints the required
reviewers. Example (high risk, two domains):

```
Risk level: high
Contract surface touched: no
Domains touched: backend, mobile
ROUTE: ESCALATED (risk: high) -> owner + 1 reviewer PLUS one domain-owner approval per touched domain
       (same escalation as sdlc-review-gate). Required domain owners:
  - domain-owner: backend
  - domain-owner: mobile
```

It is **advisory** — not a blocking gate. CI may run it to comment the required reviewers; the human
review (Step E) still owns the merge.
