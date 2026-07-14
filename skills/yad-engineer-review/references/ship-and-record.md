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

## The build ledger — shard-then-fold (`epics/<epic>/.sdlc/build-log/` → `build-log.json`)

Append-only, one record per shipped task. **Storage mirrors the trust log's "loose objects + `git gc`"
model** so two people shipping different tasks of the same epic never collide on one file:
- **Per-ship shard:** each ship is its own file `epics/<epic>/.sdlc/build-log/<story>-<task>-<repo>.json`
  = ONE ship object (the record below). `(story, task, repo)` is already unique, so no `uid` is needed;
  concurrent shippers write different files → zero merge conflict.
- **Folded file:** `epics/<epic>/.sdlc/build-log.json` = `{ "epic": "<id>", "ships": [ … ] }` — the
  legacy single-file layout, and where `yad tidy up` folds finished shards.
- **Union-read rule:** to read the ledger, union the folded `ships` with every `build-log/` shard,
  **deduping by `(story, task, repo)`** — a loose shard WINS over a stale folded ship of the same key.
- `yad review reconcile` stamps the engagement signal by **mutating the ship's shard** where it lives
  (or the folded entry if the story was already tidied) — see below.
- `yad checkpoint` commits the shard dir; `yad tidy up` (manual, one person) folds a shipped story's
  finished shards into `build-log.json`.

The folded file is shown below; a **shard** file is just one element of `ships` (the bare ship object,
without the `{ epic, ships }` wrapper):

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
future service can drive ship by writing the same records. Like the trust log and build-state, it is a
machine-written ledger committed by **`yad checkpoint`** (the back-half analogue of `yad gate` sync),
not by hand: after recording the ship, `yad checkpoint --push` lands the new `build-log/` shard as a
`chore(hub): …` audit-trail commit on the default branch (allowlist-scoped to the back-half ledgers,
never a front-half gate file); `yad tidy up` folds finished shards into `build-log.json` later.

### Retroactive ship — a pre-tracking story (#142)

A story that was merged and shipped **before** the back-half ledger existed has no build-log ship, so
`yad checkpoint` can't carry its `status: shipped` flip (the flip is only carried when a ship backs it,
#112) — leaving a raw `git push origin main` as the only way to land it, against the never-raw-git
convention. To reconcile it through yad, record a **retroactive** ship, then checkpoint carries the flip
in the same commit:

```
yad checkpoint --retro-ship <epic>/<story> --repo <r> [--task <t>] [--merge-commit <sha>] [--push]
```

It writes ONE minimal ship shard marked `retroactive: true` (`task` defaults to the sentinel `retro`;
`mergeCommit` is written only if you pass `--merge-commit`; `shippedAt` is the backfill date), then runs
the normal checkpoint so the story's already-made `status:` flip rides along in the **same** commit. It
refuses when the story already has a real ship (then it isn't pre-tracking — use the normal flow). It
does **not** author the story frontmatter — and to keep evidence and the flip atomic (the no-drift
invariant), it **refuses** unless you have already set `status: shipped` in `stories/<story>.md`, so a
ship shard is never committed while the artifact still says `approved`.

**Engagement (the Review Companion).** Each `engineer_review` entry carries `engagement: verified | none`
— `verified` when the engineer reviewed through the [companion](../../yad-review-companion/SKILL.md)
(`yad review trailer/context/nudge`, a real trailer/cards/chat session over the diff), `none` for a bare
approve. The optional `companion` block records which faces ran. It is **soft by default** (both count;
a bare approve draws a friendly `yad review nudge`); it only gates ship when
`hub.review.requireEngagement: true`. `yad review reconcile --epic <id> --repo <r> --pr <n>` reads the
code PR's approvals (with the engagement signal) and stamps them onto the matching ship record — writing
back into the ship's shard where it lives (or its folded entry if the story was already tidied) — the
back-half **bridge**, the analogue of `yad gate sync`. The signal is gameable by design ("visible, not
impossible"): it makes engineer-review quality visible, it does not prove a human read the diff. It sits
**beside** the CI gates (build/test/lint/contract/verified-commits) — never above them; CI still
decides machine safety, the merge is still the human act.

## Story state

The story frontmatter `status` reflects build progress:

- `in-build` — at least one, but not all, of the story's tasks (from `specs/<story>/tasks.md`) have ship
  records.
- `shipped` — **every** task in `tasks.md` has a ship record.

You write this flip into `stories/<story>.md`, but **do not hand-commit it** — the next
`yad checkpoint --push` carries it in the same `chore(hub)` commit as the ledgers (the story now has a
build-log ship, so checkpoint stages it; #112). This is what keeps the story artifact from drifting
from `build-log.json`, so there is never a reason to fall back to a raw `git push origin main`.

So the chain is traceable both ways: from the epic down (`epic.md` → `stories/<story>.md` →
`tasks.md` → `build-log.json` ship → `mergeCommit`) and from a merge commit back up (its `Task:`
trailer → story → epic).

## Preconditions for ship (all required)

1. The three **check gates** pass (Step C) — re-run them on the PR branch if unsure.
2. The **AI review** has run (advisory; findings surfaced to the engineer).
3. The **engineer review** rule is satisfied (base or escalated per the Impact & Risk block).

Only then does the human merge and `yad-engineer-review` record it. Nothing auto-advances.
