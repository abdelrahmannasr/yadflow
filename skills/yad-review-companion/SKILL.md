---
name: yad-review-companion
description: 'The fun, easy, transparent review companion for the SDLC review gates. Generates a 60-second AI "trailer" of what changed and where the risk is, deals a swipe-through deck of small review "cards", and runs a grounded chat where a reviewer asks anything and their questions become the review record — then records an engagement signal on the approval (verified vs none) and posts a friendly public nudge on a bare rubber-stamp. Works on the front-half artifact-review PR/MR (yad gate) and the back-half code PR/MR (yad review). Use when the user says "review this", "run the companion", "give me the trailer/cards", or wants reviewing to be less of a chore.'
---

# SDLC — Review Companion (fun & easy, transparent review)

**Goal:** make the honest review the *easiest, most enjoyable* path, and make laziness **visible**, not
blocked. This companion does **not** try to prove a human read something — no quiz, no un-fakeable
proof (a quiz is answerable by AI, swipes can be spammed). Instead it removes the friction that makes
reviewers skip, and it makes review *quality* visible to the whole team.

> **Philosophy — "visible, not impossible."** Every engagement signal here is gameable by design. It
> raises the cost of a bare rubber-stamp and shines a light on it; it never claims certainty. State that
> openly — do not oversell it.

This companion is the AI layer on top of [`yad-review-gate`](../yad-review-gate/SKILL.md) (front half)
and [`yad-engineer-review`](../yad-engineer-review/SKILL.md) (back half). The **gate** still owns the
predicate and advancement; the companion only enriches the *input* and records the *engagement* field.
The CLI never calls an LLM — **you** (this skill) generate the text and post it via the platform.

## The four faces

1. **🎬 Trailer (A)** — a 60-second briefing: what this change does, where the risk is (from the step's
   `risk_tags`), and an honest read-time estimate. Posted to the **PR/MR description** as a delimited
   `<!-- yad:trailer --> … <!-- /yad:trailer -->` block so everyone sees it in the UI. Regenerated when
   the artifact changes (it must never lie about the current content).
2. **🃏 Cards (B)** — split the change into small **atomic claims**, one per card, each anchored to real
   line numbers / hunks and tagged with risk. Posted as PR/MR comment threads the reviewer skims 👍/🤔.
3. **💬 Chat (C)** — a grounded Q&A: the reviewer asks anything; you answer **only from real material**
   (the artifact + diff + contract + the repo `code-map.md`/`pack.md` + sister docs). The reviewer's
   questions and flagged concerns become the review record. If you **cannot** answer from the material,
   say so — that gap is itself a finding (post it as a genuine, blocking comment).
4. **🏆 Social (E)** — a verified-engagement mark on a real companion review, a friendly public
   @-mention nudge on a bare approve, and light read-only gamification surfaced by `yad status`.

## Markers (the contract with the gate — all live in PLATFORM data, never a ledger file)

- `<!-- yad:trailer -->` / `<!-- /yad:trailer -->` — the trailer block in the PR/MR description.
- `<!-- yad:noblock -->` — on **every** companion-posted comment (card deck, chat log) and the nudge.
  The gate **excludes** these threads from the blocking check, so they stay unresolved as a permanent
  PR/MR history trail and never hold the gate. A reviewer's *genuine* concern is posted **without** this
  marker, so it blocks normally.
- `<!-- yad:engagement verified -->` — embedded in the body of a companion-driven **Approve** review.
  A bare UI click has no marker → `engagement: none`. (Definitions live in `cli/companion.mjs`.)

## On activation

Inputs: `epic` + `artifact` (front half) **or** `repo` + `pr` (back half); and the `action`
(`trailer` | `cards` | `chat` | `approve` | `nudge`, default the full flow).

1. **Get the grounding bundle.** Front half: `yad gate review <epic> [artifact]` prints JSON with the
   artifact path, risk tags, PR number, contract path, touched domains, repo code-map paths, and
   `requireEngagement`. Back half: `yad review chat --repo <r>` (see `yad-engineer-review`) provides the
   diff + code-map grounding. Read the named files yourself — never invent content.
2. **Trailer.** Generate ≤6 lines (what / risk / read-time), grounded only in the bundle. Post it:
   `yad gate trailer <epic> <artifact> --body "<text>" [--pr <n>]` (idempotent; re-run after edits).
3. **Cards.** Produce atomic claims, each citing real lines. Post the deck as a single comment carrying
   `<!-- yad:noblock -->`. A reviewer's 🤔 with a real concern → re-post as a **normal, unflagged**
   comment so it blocks.
4. **Chat.** Answer from the material with cited lines. Append the Q&A log as a `<!-- yad:noblock -->`
   comment so it persists in history without blocking. Turn genuine concerns into unflagged comments.
5. **Approve.** When the reviewer is satisfied, submit an Approve whose body carries
   `<!-- yad:engagement verified -->` (so the gate records `engagement: verified`). GitHub:
   `gh pr review <n> --approve --body "<note>\n\n<!-- yad:engagement verified -->"`. GitLab: approve,
   then post the marker as a note (`glab mr approve <n>` + `glab mr note <n> -m "…<!-- yad:engagement verified -->"`).
6. **Nudge.** A bare approve (engagement `none`) still counts under the soft default; `yad gate sync`
   posts the friendly @-mention automatically. You may also post it directly with the
   `<!-- yad:noblock -->` marker.

## Hard rules

- **Never write a ledger file.** Post comments / the trailer / the approval to the PLATFORM (the
  reviewer's own `gh`/`glab`). CI writes `approvals.json`/`comments.json`; the `ledger-guard` check
  rejects a human ledger edit on a review PR. The markers ride in platform data only.
- **Trailer/cards/chat are grounded ONLY in real material.** If the material does not answer a
  question, say so and record the gap — do not fabricate.
- **Companion comments never block; genuine concerns always do.** Flag the former with `yad:noblock`;
  leave the latter unflagged.
- **The engagement signal is gameable and you say so.** It makes review quality visible; it is not
  proof. The strict-mode switch is `hub.review.requireEngagement` (off by default).
- **The companion never approves on a human's behalf and never merges.** It assists; the human acts.

## File-only mode (no platform)

With no hub platform, there is no PR to post to: write the trailer to
`reviews/<artifact-base>--<date>--trailer.md` and the card/chat notes alongside the existing
`reviews/*.md`, and the reviewer records approval the manual way (`yad-review-gate` `approve`). The same
generation logic applies; only the surface changes.
