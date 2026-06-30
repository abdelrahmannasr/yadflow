# The review method + scorecard (the transferable skill)

This is the repeatable, efficient PR/MR review method the pair walkthrough demonstrates on the real
change and scores the engineer against. It is **transferable** — the point is that after a few paired
sessions the engineer reviews this way on their own. `action: rubric` prints this method and stops.

## The method (the order the walkthrough follows)

1. **Spec first — know what it should do.** Read the acceptance criteria / story / `specs/<story>/`
   before the diff. You can't judge a change you can't measure against its intent.
2. **Contract surface — did it move the locked surface?** Map the diff against the locked contract
   (`contract.md` / `contract-lock.json`). A change to the surface without a `Contract-Change` is a
   routing problem, not just a code problem (it must go back to the architecture gate).
3. **Risk first — walk the dangerous hunks first.** The grounding orders stops highest-risk first
   (`contract` > `auth`/`payments` > everything; larger hunks before smaller). Spend your attention where
   a mistake costs the most; don't read top-to-bottom.
4. **Per change — the four lenses.** For each hunk ask: **correctness** (does it do what the spec says,
   including the unhappy path?), **tests** (is the new behaviour covered?), **edge cases** (nulls, empty,
   concurrency, large input, failure/rollback), **security** (auth/authz, injection, secrets, payments
   integrity) — weight the last two hard on `auth`/`payments`/`contract` stops.
5. **Tests cover the change.** A `tests`-tagged stop should map to the behaviour stops. Behaviour with no
   test is a finding; a test that doesn't exercise the new branch is a finding.
6. **Decide — approve or request changes.** A clear verdict with the *why*. "Looks good" is not a review;
   name what you checked and what convinced you.

## The scorecard (feeds the learning signal)

At each stop, capture which rubric step it exercised and how the engineer did. Roll the stops up into a
compact scorecard for the session comment and the `comprehension` field of the learning record.

Per-step grade (one of):

| grade | meaning |
|-------|---------|
| ✅ nailed | the engineer applied the step correctly unprompted |
| 💡 nudged | they got there after a Socratic hint — a learning moment |
| ⚠️ missed | they didn't catch it; the AI surfaced it and explained how to next time |
| — n/a | the step didn't apply to this change |

`comprehension` for the learning record is a short roll-up, e.g. `4/6 steps nailed, 2 nudged
(contract-surface, edge-cases)` — honest about where the engineer is still growing. It is a soft,
gameable signal (a learning aid), never a gate — say so.

## Example scorecard block (rendered into the session comment)

```
| Rubric step            | Grade   | Note                                                |
|------------------------|---------|-----------------------------------------------------|
| 1 Spec first           | ✅ nailed | read the AC before the diff                         |
| 2 Contract surface     | 💡 nudged | spotted the surface change after a hint             |
| 3 Risk first           | ✅ nailed | started on the auth hunk                            |
| 4 Four lenses          | ⚠️ missed | missed the missing authz check on the new endpoint  |
| 5 Tests cover          | ✅ nailed | flagged the uncovered error branch                  |
| 6 Decide               | ✅ nailed | clear request-changes with the why                  |
Comprehension: 4/6 nailed, 1 nudged, 1 missed (four-lenses/security)
```
