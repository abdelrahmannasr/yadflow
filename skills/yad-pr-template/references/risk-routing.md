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

**The count is reported, not enforced, on a code PR.** Branch protection holds the merge — at least 1
approval (GitHub blocks self-approval; GitLab only if its settings do). The risk step is **advisory**
here. The capacity cap (roadmap E72) caps a count at the active people less one. It is reported, not
enforced, on the Shape gates for now, and on the Build half it stays reported even once the Shape cap
is enforced: `yad open-pr` prints the count capped by the active people, while `risk-route.sh` cannot cap, because a code repo's CI has no Product to count people
from. There are no roles: no owner, no reviewer, no
domain owner. This is `yad-review-gate`'s rule (`references/gating.md`) applied at the code-review
boundary. The **approvals are recorded by the engineer review (Step E) through `yad-review-gate`** — the
template and `risk-route.sh` only *route* (advisory); they never approve or merge.

**The risk map counts too (E66).** A code repo's `.sdlc/risk-map` (E65) gives each directory a level —
`high`, `medium` or `low`. A change that touches a `high` directory adds the high step (+1), the same
step a body saying `Risk level: high` adds. The rules:

- The map is read from the **base branch**, never the PR's own copy, so a PR cannot lower its count by
  editing or deleting the map.
- The **larger** step wins. A body saying `low` on a change to a `high` directory still counts +1, and
  the output says the two disagree. A body saying `high` still counts +1 when the map says `low`.
- A `guessed` level counts as a `confirmed` one does: a level only raises the count, never lowers it.
- `medium` is printed and adds nothing. An `unset` line, or a directory no line covers, adds nothing.
- A deleted or moved file counts where it was.
- If the map cannot be read (no base, a shallow clone, a newer map version, or a `checks/risk-map-check.sh`
  older than this count, which `yad update` refreshes), the output says so and counts the body alone. It
  never guesses a level.

## risk-route.sh

`bash checks/risk-route.sh <pr-description-file> [<base>]` parses the Impact & Risk block, asks
`checks/risk-map-check.sh --level` for the level the change takes from the base branch's risk map, and
prints the approver count. **Run it inside the code repo, on the PR's branch.** On the base branch itself
the change is empty, and it says so. `<base>` defaults the way the checks resolve it (the configured
`default_branch`, then `origin/HEAD`, then `origin/main`). Example (high risk, two domains):

```
Risk level: high
Contract surface touched: no
Domains touched: backend, mobile
Risk map (origin/main): low — nothing this change touches is high
ROUTE: 2 approvers = base 1 + high risk 1 (risk: high)
       Branch protection (when configured) holds the merge, not this count: at least 1 approval (GitHub blocks self-approval; GitLab only if its settings do).
       The risk step is advisory, and not capped here — `yad open-pr` shows the count capped by the active people.
       Ask reviewers who know the touched domains:
  - backend
  - mobile
```

With a touched contract surface the line reads `ROUTE: 3 approvers = base 1 + contract risk 2 (contract
surface touched)`. With neither it reads `ROUTE: 1 approver = base 1 (no risk step).` When the map raises
a body that says `low`:

```
Risk map (origin/main): high — src/payments/ (guessed)
  worked there in the last 30 days: Alice (@alice)
ROUTE: 2 approvers = base 1 + high risk 1 (high on the risk map: src/payments/ (guessed))
       The body says Risk level: low, but the risk map on origin/main marks src/payments/ (guessed) high — the larger counts.
       Branch protection (when configured) holds the merge, not this count: at least 1 approval (GitHub blocks self-approval; GitLab only if its settings do).
       The risk step is advisory, and not capped here — `yad open-pr` shows the count capped by the active people.
       This change touches src/payments/ (guessed), so it asks for an approval from someone who has
       committed there in the last 30 days (its own authors left out):
  - Alice (@alice)
       Ask reviewers who know the touched domains:
  (Domains line not filled in — list each touched domain so the right reviewers can be asked.)
```

**Proven history (E67).** When a `high` directory is touched, the script also names the people who have
committed there in the **last 30 days**, read from the base branch's history, with this change's own
authors left out (an approval has to come from someone else). A robot is never listed. A person is shown
as their git name, plus `(@login)` only when their commit address is a platform `noreply` one — yadflow
prints no e-mail addresses. A name holding an `@` is shown as the bare login (`- @carol`), else as `a name
that is an e-mail address` or `a name written like a login`, so a printed `@word` is always a real login. "Recent" is git's `--since`, which uses the **committer** date, so a rebased
or squashed commit counts from when it landed. Work in a `low` directory *inside* a `high` one is not
history for the `high` one: the deepest map line decides, and git applies that itself — one query per
directory, excluding the listed directories below it, so no file name is ever read back out of git.

When a change touches more than one `high` directory, the people are printed as ONE list: someone who
has worked in any of them meets the ask, and the output does not say who worked where.

Two answers are not a list of people, and both are said plainly:

- `nobody else has committed there in the last 30 days` — the count stands on its own.
- `who has worked there lately: not read — …` — a shallow clone, or git could not read the history. The
  ask is unknown, never "nobody".

The CI `risk-map` job prints the map's part on every PR as a `COUNT [risk-map]:` line. It does not read
the body, so `risk-route.sh` is where the two meet. `yad open-pr` prints the same joined count once the
PR is open, and leaves the body's level as the author wrote it.

It is **advisory** — not a blocking gate, and not a CI job (the user's decision, 2026-09-18): the CI
`risk-map` job prints the map's half, and the human review (Step E), which runs this script, owns the
merge. No reviewers are requested automatically: ask them on the PR/MR itself.
