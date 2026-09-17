# Impact & Risk block and review routing

The PR/MR template (Phase 3 build plan §D) carries an **Impact & Risk** block so every change states
its blast radius before review, and so a high-risk change shows how many approvers it asks for —
the same count `yad-review-gate` prints on the Shape gates.

## The Impact & Risk block

```
## Impact & Risk
- **Domains / repos touched:** <backend | mobile | …>
- **Contract surface touched:** no
- **Risk level:** low
- **Rollback plan:** <how to revert>
```

- **Domains / repos touched** — the domains this change affects. When the count is raised,
  `risk-route.sh` lists them as a hint for whom to ask. yadflow keeps no list of people, so no names come from it.
- **Contract surface touched** — `yes` means the diff changes the shared contract surface. That path is
  governed by `contract-check` (needs `Contract-Change: yes` + a re-locked contract) AND it raises the
  approver count (contract is a `yad-review-gate` risk tag).
- **Risk level** — `low | medium | high`. The author's assessment of blast radius.
- **Rollback plan** — how to revert safely.

## Routing rule (reuses the gate's count)

The count is `base 1 + risk step`:

| Condition | Risk step | Approvers |
|-----------|-----------|-----------|
| `low` / `medium`, no contract surface | +0 | 1 (the base) |
| `high` | +1 | 2 |
| contract surface touched | +2 | 3 |

`high` risk and a touched contract surface together take the **larger** step (contract, +2), never the
sum. Approvers are counted as distinct people, and the base approver should not be the author.

**Only the base is enforced.** A merge needs 1 approval (GitHub blocks self-approval; GitLab only if its settings do). The risk step
is **advisory** until the capacity cap (roadmap E72) lands. There are no roles: no owner, no reviewer, no
domain owner. This is `yad-review-gate`'s rule (`references/gating.md`) applied at the code-review
boundary. The **approvals are recorded by the engineer review (Step E) through `yad-review-gate`** — the
template and `risk-route.sh` only *route* (advisory); they never approve or merge.

**The risk map does not change this count yet.** A code repo's `.sdlc/risk-map` (E65) gives each
directory a level — `high`, `medium`, `low` — and `checks/risk-map-check.sh` warns when it is stale, but
the count here still comes from the body's `Risk level` and `Contract surface touched`. E66 will add the
high step for a change that touches a `high` directory, reading the map from the base branch. Whether a
`guessed` level counts there, or only a `confirmed` one, is an open question in the E66 row.

## risk-route.sh

`bash checks/risk-route.sh <pr-description-file>` parses the Impact & Risk block and prints the approver
count. Example (high risk, two domains):

```
Risk level: high
Contract surface touched: no
Domains touched: backend, mobile
ROUTE: 2 approvers = base 1 + high risk 1 (risk: high)
       Only the base holds the merge until the capacity cap: 1 approval (GitHub blocks self-approval; GitLab only if its settings do).
       The risk step is advisory. Ask reviewers who know the touched domains:
  - backend
  - mobile
```

With a touched contract surface the line reads `ROUTE: 3 approvers = base 1 + contract risk 2 (contract
surface touched)`. With neither it reads `ROUTE: 1 approver = base 1 (no risk step).`

It is **advisory** — not a blocking gate. CI may run it to comment the count; the human review (Step E)
still owns the merge. No reviewers are requested automatically: ask them on the PR/MR itself.
