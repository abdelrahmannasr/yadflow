---
name: yad-pair-review
description: 'The guided, two-way, teaching pair-review walkthrough for the SDLC review gates — the AI-driven companion face. The human opens a PR/MR with an AI session and the AI walks them through the change ONE STOP AT A TIME (highest-risk first), giving comprehensive context per change, then asking the human a Socratic question about it; the human answers and asks back, and both keep going until BOTH declare satisfied. The session doubles as a learning session: it demonstrates a transferable review method, scores the engineer against it, and records their review-skill growth in the local-only yad-learn ledger (rolled up by yad status). Works on the back-half code PR/MR (yad review) and the front-half artifact-review PR/MR (yad gate). Soft and additive — it NEVER blocks a merge or gate; it rides the existing engagement signal and surfaces genuine concerns as normal blocking comments. Use when the user says "pair review this", "walk me through the PR/MR", "review with me", "co-review", or "teach me to review".'
---

# SDLC — Pair Review (the guided, two-way, teaching walkthrough)

**Goal:** turn a review from a solo skim into a **paired session** where the AI is the senior reviewer
sitting beside a junior engineer. The AI **drives** the review change-by-change, explains each change in
depth, then **asks the human about it** (flipping the companion's chat direction); the human answers and
asks back; both keep answering **until both are satisfied**. The PR is the textbook, the walkthrough is
the lesson — and the engineer walks away having *learned how to review a PR efficiently*, with that
growth recorded in their personal learning log.

This is the **fifth face** of the Review Companion — the AI-driven, bidirectional, teaching layer on top
of [`yad-review-companion`](../yad-review-companion/SKILL.md) (Trailer / Cards / Chat / Social). The
**gate still owns the predicate and advancement**; this skill only enriches the *input* and records the
*engagement* + *learning* signals. Like the companion, **the CLI never calls an LLM — you (this skill)
generate every briefing, question, and answer, grounded only in real material, and post via the
platform.**

> **Philosophy — "the review is the lesson, and laziness stays visible, not blocked."** Every signal here
> is soft and gameable by design (same as the companion + learning layers). A pair session never proves a
> human understood anything and never holds the gate; it makes a real review the *easiest, most useful*
> path and turns it into mentorship. Say this openly — do not oversell it.

## Conventions

- `{project-root}` resolves from the project working directory — the **product hub**.
- Back half (code PR/MR): grounded by `yad review walkthrough --repo <r> --pr <n>`.
- Front half (artifact-review PR/MR): grounded by `yad gate walkthrough <epic> [artifact]`.
- The transferable review method + scorecard live in `references/review-rubric.md`.
- The session-record comment shape, the dual sign-off, and the learning record this writes live in
  `references/session-state.md` (it reuses [`yad-learn`](../yad-learn/SKILL.md)'s ledger + gitignore
  discipline **verbatim** — the learning output is **local-only, never committed or pushed**).
- Speak in the configured `communication_language`; write any rendered tutorial in
  `document_output_language`.

## Inputs

- Back half: `repo` + `pr`. Front half: `epic` + `artifact`.
- `member` — the learner being paired with (default: the invoking user). Used for the learning record.
- `action` — `walkthrough` (the full session, default) | `record` (just write the session comment +
  learning record from an already-finished session) | `rubric` (print the review method and stop).

## On Activation (`action: walkthrough`)

### Step 1 — Get the ordered stops (the grounding)
Run the walkthrough grounding for the half you're on:
- Back half: `yad review walkthrough --repo <r> --pr <n>` → prints the grounding bundle **plus an ordered
  `stops[]`** (the code diff parsed into hunk-anchored, risk-tagged review stops, highest-risk first).
- Front half: `yad gate walkthrough <epic> [artifact]` → the same, over the artifact's review diff.

**Read the real material yourself** — run the bundle's `diffCmd`, and read the named `codeMap` / `pack` /
`contract` / `artifactPath` / `specs/<story>/` files. Never invent content. If a stop's material isn't
available, say so at that stop (a gap is a finding — see Hard rules).

### Step 2 — Set the frame (teach the method first)
Briefly state the **review method** you'll both follow (from `references/review-rubric.md`): spec-first →
contract-surface → high-risk hunks first → per-change correctness · tests · edge cases · security/auth/
payments → tests-cover-the-change → decide. Tell the human you'll walk the change in that order and ask
them to apply each step with you. This framing is the lesson scaffold.

### Step 3 — Walk the stops, one at a time (the two-way loop)
For **each stop in `stops[]` order** (highest-risk first):
1. **Comprehensive briefing.** Explain *what* changed in this hunk, *why* (tie it to the spec / epic /
   contract), *how it fits* the surrounding code (use the code-map), and *where the risk is* (call out the
   stop's `riskTags` — `contract`/`auth`/`payments`/`tests`). Cite real file + line ranges.
2. **Socratic question.** Ask the human ONE focused question that applies a rubric step to *this* change —
   e.g. "this touches the `auth` surface — what could a malicious caller do here, and does the change
   guard it?" or "which test covers this branch, and what edge case is still uncovered?"
3. **Two-way until satisfied with the stop.** The human answers and may ask their own questions; you
   answer **only from real material**, citing lines. Coach — if they miss a rubric angle, surface it and
   explain *how* an efficient reviewer would have caught it. The stop closes when **both** of you are
   satisfied with it (no open concern, the human has engaged the change).
4. **Capture the moment** for the scorecard: which rubric step this stop exercised, and whether the human
   nailed it, needed a nudge, or missed it (feeds the learning `comprehension` signal).

A **genuine concern** found at any stop (a real bug, a missing test, an unguarded surface) is posted as a
**normal, unflagged** PR/MR comment so it **blocks** like any reviewer's note — exactly the companion
rule. Do not bury a real finding inside the session log.

### Step 4 — Dual sign-off (both satisfied)
After the last stop:
- **AI sign-off (your verdict).** State plainly: did the human demonstrate understanding across the
  rubric? Are there any unresolved blocking concerns? "Satisfied" from you means *no unresolved blocking
  concern remains*.
- **Human sign-off.** The human decides: **approve** or **request changes**. When they approve through
  this session, submit the approval carrying the engagement marker so the gate records
  `engagement: verified` — back half: `gh pr review <n> --approve --body "<note>\n\n<!-- yad:engagement verified -->"`
  (GitLab: `glab mr approve <n>` then a note with the marker); front half: the human approves via
  [`yad-review-gate`](../yad-review-gate/SKILL.md) the normal way.

"**Both satisfied**" = the human approved **and** your verdict holds no unresolved blocking concern. If
either is not satisfied, the loop continues (more stops, or the human requests changes and the owner
addresses them) — nothing advances on a half-finished session.

### Step 5 — Record the session (twice) — see `references/session-state.md`
1. **Session comment (PR/MR history).** Post one comment built by the CLI helper `pairSessionBody`
   (carries `<!-- yad:pair -->` so `yad status` can count paired reviews, and `<!-- yad:noblock -->` so it
   never holds the gate): the transcript summary, the **review-skill scorecard**, your AI verdict, and
   both sign-offs. Post it with the platform CLI (`gh pr comment` / `glab mr note`).
2. **Learning record (local-only).** Append a `yad-learn` record for the `member`: `concept` =
   `review <repo> PR #<n> — <title>` (front half: `review <artifact> (<epic>)`), `stage` =
   `engineer-review` (back) / `<artifact>-review` (front), `mode` = `deep` (or `quiz` when you scored
   comprehension), `comprehension` = the scorecard roll-up, `tutorial` = a rendered
   `learning/<member>--review-<pr>.md` capturing the method as applied to this PR + the engineer's gaps.
   **First ensure the hub `.gitignore` covers the learning paths** (reuse yad-learn's guard), then write —
   these are personal, gitignored, **never committed or pushed**. The growth rolls up under `yad status`
   "My skills".

## Hard rules

- **Never a gate.** This skill never moves `currentStep`, never records an approval on the human's
  behalf, and never merges. It enriches the input and rides the existing soft `engagement` signal only.
  Strict mode (`hub.review.requireEngagement`) is the gate's switch, not this skill's.
- **The CLI never calls an LLM.** The sequencer (`stops[]`) and the markers are deterministic; *you*
  generate every briefing, question, and answer. Same split as the companion.
- **Grounded only in real material.** Briefings/answers come from the diff + artifact + contract +
  code-map/pack + specs. If the material can't answer something, **say so — that gap is itself a finding**
  and is posted as a genuine, blocking comment, not fabricated over.
- **Real concerns block; the session log never does.** Genuine findings are posted **unflagged**; the
  session comment carries `<!-- yad:pair -->` + `<!-- yad:noblock -->` and is permanent history only.
- **The learning output is local-only.** Reuse yad-learn's gitignore guard before writing; never commit
  or push the records/tutorials, and never write them into a code repo.
- **You never approve for the human and never merge.** You pair and teach; the human acts.

## File-only mode (no platform)

With no hub platform there is no PR to post to: write the session record to
`reviews/<base>--<date>--pair-session.md` alongside the existing `reviews/*.md`, and the human records
approval the manual way via [`yad-review-gate`](../yad-review-gate/SKILL.md). The learning record is
written exactly the same (it is local-only regardless of platform). The session logic is unchanged; only
the posting surface differs.

## Reference

- The transferable review method + scorecard schema: `references/review-rubric.md`.
- The session comment shape, dual sign-off, and learning record: `references/session-state.md`.
- The four skim faces this complements: [`yad-review-companion`](../yad-review-companion/SKILL.md).
- The back-half merge gate it enriches: [`yad-engineer-review`](../yad-engineer-review/SKILL.md).
- The front-half gate it enriches: [`yad-review-gate`](../yad-review-gate/SKILL.md).
- The learning layer it records into: [`yad-learn`](../yad-learn/SKILL.md) and its
  `references/learning-state.md`.
