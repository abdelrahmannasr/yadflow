# Ship — the build ledger and the story state

Step E (`yad-engineer-review`) closes the build half: AI review (advisory) → engineer review (the human gate) →
ship. Shipping records the merge and updates the story state so the whole chain is traceable.

## Two sets of eyes

1. **AI review (advisory).** CodeRabbit (`.coderabbit.yaml`) reviews each PR and comments. It is a
   second set of eyes — it **never approves or merges**. Its findings inform the engineer; they do not
   gate. Where CodeRabbit can't run (no remote), an equivalent AI first-pass is run by hand and its
   notes captured.
2. **Engineer review (the authority).** A human reads the diff against the spec and the acceptance
   criteria and records an approval. The rule is `yad-review-gate`'s:
   - **base:** at least one `owner` AND one distinct `reviewer`.
   - **escalated:** when the PR's Impact & Risk is `high`, or it touches contract/auth/payments — base
     PLUS one `domain-owner` per touched domain (exactly what `risk-route.sh` prints).

## The build ledger — `epics/<epic>/.sdlc/build-log.json`

Append-only. One record per shipped task:

```json
{
  "epic": "EP-istifta-inquiries",
  "ships": [
    {
      "story": "EP-istifta-inquiries-S01",
      "task": "T01",
      "repo": "backend",
      "branch": "feat/EP-istifta-inquiries-S01-T01-create-inquiry",
      "pr": "<url|#|local>",
      "mergeCommit": "<sha>",
      "gates": ["spec-link", "contract-check", "build-test-lint"],
      "ai_review": "coderabbit (advisory)",
      "engineer_review": [
        { "approver": "amelia", "role": "owner", "engagement": "verified" },
        { "approver": "carol", "role": "reviewer", "engagement": "none" }
      ],
      "companion": { "trailer": true, "cards": true, "chat": false },
      "risk": "low",
      "shippedAt": "2026-06-06"
    }
  ]
}
```

This is the back-half analogue of the front half's `approvals.json` — files only, no hidden state, so a
future service can drive ship by writing the same records.

**Engagement (the Review Companion).** Each `engineer_review` entry carries `engagement: verified | none`
— `verified` when the engineer reviewed through the [companion](../../yad-review-companion/SKILL.md)
(`yad review trailer/context/nudge`, a real trailer/cards/chat session over the diff), `none` for a bare
approve. The optional `companion` block records which faces ran. It is **soft by default** (both count;
a bare approve draws a friendly `yad review nudge`); it only gates ship when
`hub.review.requireEngagement: true`. `yad review reconcile --epic <id> --repo <r> --pr <n>` reads the
code PR's approvals (with the engagement signal) and stamps them onto the matching ship record — the
back-half **bridge**, the analogue of `yad gate sync`. The signal is gameable by design ("visible, not
impossible"): it makes engineer-review quality visible, it does not prove a human read the diff. It sits
**beside** the CI gates (build/test/lint/contract/verified-commits) — never above them; CI still
decides machine safety, the merge is still the human act.

## Story state

The story frontmatter `status` reflects build progress:

- `in-build` — at least one, but not all, of the story's tasks (from `specs/<story>/tasks.md`) have ship
  records.
- `shipped` — **every** task in `tasks.md` has a ship record.

So the chain is traceable both ways: from the epic down (`epic.md` → `stories/<story>.md` →
`tasks.md` → `build-log.json` ship → `mergeCommit`) and from a merge commit back up (its `Task:`
trailer → story → epic).

## Preconditions for ship (all required)

1. The three **check gates** pass (Step C) — re-run them on the PR branch if unsure.
2. The **AI review** has run (advisory; findings surfaced to the engineer).
3. The **engineer review** rule is satisfied (base or escalated per the Impact & Risk block).

Only then does the human merge and `yad-engineer-review` record it. Nothing auto-advances.
