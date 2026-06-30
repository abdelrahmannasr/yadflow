# The session record, the dual sign-off, and the learning record

The pair walkthrough writes its outcome to **two** places, neither of which is a gate ledger and neither
of which ever blocks the gate. The gate's predicate (approvals + resolved threads + merge) is untouched.

## 1. The session comment (PR/MR platform history)

Built by the CLI helper `pairSessionBody({ summary, scorecard, verdict, humanSignoff, aiSignoff })` in
`cli/companion.mjs`. It carries **both** markers:

- `<!-- yad:pair -->` — so this is countable as a *paired review* in the `yad status` 🏆 roll-up.
- `<!-- yad:noblock -->` — so the thread is excluded from the gate's blocking check and persists as
  permanent history (a deliberate, unresolved trail), exactly like the companion's card/chat threads.

It **never** carries an engagement marker — the session comment is *history*, not the approval. The
approval is a separate act (Step 4) and carries `<!-- yad:engagement verified -->` on its own.

Sections (you generate the prose; the helper composes them):
- **summary** — what was walked, how many stops, where the risk was, what the human engaged with.
- **scorecard** — the rubric table + comprehension roll-up from `references/review-rubric.md`.
- **verdict** — the AI sign-off: understanding demonstrated? any unresolved blocking concern?
- **humanSignoff / aiSignoff** — the two satisfaction statements ("both satisfied").

Post it with the platform CLI (`gh pr comment <n> -b "<body>"` / `glab mr note <n> -m "<body>"`). In
file-only mode write it to `reviews/<base>--<date>--pair-session.md` instead.

## 2. The learning record (local-only, reuses yad-learn)

This is the "review **is** the lesson" half. It reuses [`yad-learn`](../../yad-learn/SKILL.md)'s ledger
schema and gitignore discipline **verbatim** — see `yad-learn/references/learning-state.md`. Do not
invent a new store.

**Before writing anything**, ensure the **product hub's** `.gitignore` covers the learning paths
(idempotent — append only if absent), the same block yad-learn uses:

```
# yadflow learning layer — personal, local-only (never commit or push)
.sdlc/learning-records.json
.sdlc/learning/
epics/*/.sdlc/learning-records.json
epics/*/learning/
```

Then append one record to `epics/EP-<slug>/.sdlc/learning-records.json` (or `.sdlc/learning-records.json`
cross-project), using yad-learn's exact field shape:

```json
{
  "member": "alice",
  "concept": "review backend PR #42 — add refund endpoint",
  "context": "pair-review walkthrough; risk: payments, contract",
  "stage": "engineer-review",
  "mode": "quiz",
  "tool": "harness-native",
  "sessionId": null,
  "tutorial": "learning/alice--review-42.md",
  "comprehension": "4/6 nailed, 1 nudged, 1 missed (four-lenses/security)",
  "status": "learned",
  "requestedAt": "<YYYY-MM-DD>",
  "completedAt": "<YYYY-MM-DD>"
}
```

Field notes:
- `stage` = `engineer-review` (back half) or `<artifact>-review` (front half, e.g. `architecture-review`).
- `mode` = `deep` for a walkthrough that didn't score, `quiz` when you captured a comprehension roll-up.
- `comprehension` = the scorecard roll-up string (null when `mode: deep`).
- `tool` = `harness-native` (or `deeptutor` if a DeepTutor session backed the tutoring).
- `status` = `learned` once the session completed (set `completedAt`); `in-progress` if paused.

Also render the tutorial artifact `epics/EP-<slug>/learning/<member>--review-<pr>.md` (front-matter:
`member`, `concept`, `stage`, `tool`, `requestedAt`) — the review method as applied to *this* PR plus the
engineer's specific gaps and how to close them. Both files are **local-only, gitignored, never committed
or pushed, and never written into a code repo** — they are a private personal skills log. `yad status`
rolls them up by stage (e.g. "engineer-review: 3").

## Optional: stamp the build-log (back half)

When the task later ships, [`yad-engineer-review`](../../yad-engineer-review/SKILL.md) may record on the
ship record's `companion` block that a pair session ran: `"companion": { "trailer": true, "cards": false,
"chat": false, "pair": true }`. This is informational only — it never changes whether the ship is
allowed.
