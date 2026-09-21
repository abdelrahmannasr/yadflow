# Gate predicate — details & worked example

## Reviewer rule
Let `A` = the set of `approved` records in `.sdlc/approvals.json` for this step.

- `approvers = { a.approver : a in A }`  (distinct people — two records from one person are one)

**Pass (team mode):** `|approvers| >= 1` — the **base**. Missing, the gate reports `1 approval(s)`.

There are no roles. yadflow keeps no list of people, so there is no owner rule, no reviewer rule and no
domain-owner rule. Older records may still carry `role` and `domain`; they stay on disk and nothing
reads them. The gate's `rule` label for a team gate is `count` (`solo`, `inherited` and `skipped` are
unchanged).

## The per-step count rule

The count is the whole rule. It counts people, not roles:

`needed = base + risk step`, where `base` is `1` — one human approval from someone other than the author.
The engine never compares the approver with the author: GitHub stops you approving your own PR, GitLab
does only when the project's approval settings say so, and on a local-only ledger nothing does — so do
not record the author's own approval — and the **risk step** comes from the step's own
`risk_tags`:

| Tags on the step | Risk | Risk step | `needed` |
|---|---|---|---|
| none | normal | +0 | 1 |
| `auth` and/or `payments` | high | +1 | 2 |
| `contract` | contract surface | +2 | 3 |

Several tags take the **highest** step, never the sum — a gate is one decision about the riskiest thing
it touches. `have` is the number of **distinct approvers**. The tags are read from the step as the epic
records it in `state.json`, so adding `auth` to a step by hand raises that epic's full count.

**What holds the gate: the base — until E73.** The base (1) holds every team gate. The rule is one
formula: `needed = base + risk step`, **capped** at `active − 1`, with a floor of 1. `active` is the live
count of people who committed or approved lately (E71); `yad gate status` and `yad gate sync` print it,
and the predicate carries it as `active`. Since E72 the engine **computes, prints and records** the cap,
but it does **not enforce** it — the risk step stays advisory, capped or not, and its shortfall is
reported as `short`, never blocking:

| Active people | Contract gate: capped ask (full count 3) |
|---|---|
| 2 | 1 |
| 3 | 2 |
| 4 or more | 3 |

The `− 1` is **one seat left for the author**. It is a seat, not a check: the engine does not know who
the author is. The platform decides whether the author may approve (GitHub never allows it; GitLab only
when its settings say so; a local ledger checks nothing). The floor of 1 means the cap only ever trims
the risk step.

**Why the cap is not enforced yet.** The count of people errs high in the normal case. A commit is
counted by its git name, an approval by its platform login, and yadflow never joins the two without
exact evidence. So an ordinary two-person team can read as **four**. At four the cap lowers nothing,
and an enforced contract gate would ask three approvals of a team with one person who is not the author
— a gate it could never pass. **E73** turns the capped count on together with `yad gate lower --reason`,
the way out of a gate that cannot be met.

**When the people cannot be counted** (`active: null` — a source could not be read), **no cap is
computed or shown**, and the base holds as always. The engine never guesses a small number from an
unknown. Product CI is usually this case: it checks out only the hub, so on a Product with connected
repos the repos are not on disk.

**Every cap is recorded.** When a **team** gate passes while the cap lowered its ask, its closing record
gets `capped: { needed, to, active }` beside `waived` — the full count, the capped ask, and the count of
people it read. It records what the gate ASKED, not what held it (the base held). It is not written in
solo mode, where nothing was counted. `yad gate status` prints it as
`count capped from 3 to 1 (2 active people)`. The generated review-PR body also keeps the count as it
was when the PR was opened.

Why count people: the rule names no person, no role and no step. A stored list of people goes
stale; repository access decides who can approve.

Several surfaces print the same arithmetic, each in its own sentence: `yad gate sync`, `yad gate
status`, the generated review-PR body and `yad open-pr`. The suffix appears only when the step has a
risk step. It names the cap only when the cap lowered the ask, and always ends by saying what holds:
- ` — capped to 1: 2 active people, less one seat for the author — base enforced, risk step advisory` — the cap lowered the ask;
- ` — base enforced, risk step advisory` — the cap lowered nothing, or the people could not be counted.

Where each surface puts it:
- `yad gate sync`: `1 approved; count: 3 approvers = base 1 + contract risk 2 — capped to 1: 2 active people, less one seat for the author — base enforced, risk step advisory`
- `yad gate status`: `; count: <sum>` with the same suffix, after the distinct-people count. Above the
  gates it prints the count of people and what it does, for example
  `active people: 4 in the last 90 days — caps each gate's count at 3 approvers (one seat is left for the author); reported, only the base is enforced until E73`,
  or, when it cannot count them, `active people: NOT COUNTED — <reason> — no cap can be shown, and only the base holds each gate`.
- the generated review-PR body: `- **Approvals needed:** 1 (enforced) · full count 3 approvers = base 1 + contract risk 2, capped to 1 for 2 active people when this PR was opened (the risk step is advisory until E73)`.
  With no cap: `- **Approvals needed:** 1 (enforced) · full count 3 approvers = base 1 + contract risk 2 (the risk step is advisory until E73)`.
- `yad open-pr` (a code-repo task PR, Build half): `this PR asks for 3 approvers = base 1 + contract risk 2, capped to 1 for 2 active people — base enforced, risk step advisory`.

`yad gate review` prints JSON, and it carries the rule as an object under `step.gateRule`, and the cap under `step.cap` (null when the people were not counted), instead of a sentence.

Solo mode waives approvals entirely, exactly as before, and reports no shortfall. No `capped` record is
written in solo mode. The merge and the
resolved threads still advance the step, and the review step's closing record carries `waived: "solo"`
(E10). Switch with `yad mode solo --reason "<why>"` / `yad mode team`.

**Engagement (the Review Companion).** Each approval carries `engagement: verified | none` —
`verified` when it was recorded through the companion (a real trailer/cards/chat session), `none` for a
bare UI click. By **default (soft)** both count: a bare approve still passes the gate but is recorded
`none` and draws a friendly public @-mention nudge, so review *quality* is visible without blocking
anyone. When `hub.review.requireEngagement: true`, only `verified` approvals are counted toward the
approvers above; when that leaves the gate short, it adds a line saying how many approvals did not count (a determined faker
can still run an empty session — the signal is **gameable by design**; it raises the cost of a
rubber-stamp and makes laziness visible, it does not prove a human read the artifact). Philosophy:
*visible, not impossible.*

**Touched domains** are resolved from files, not hardcoded. They name and label a review (`domain:<repo>`
labels on the review PR); they add no approvals:
- A step with a risk tag (e.g. architecture+contract review): the epic's `repos`.
- Stories review: the **union of every story's `repos`** under `stories/`.

So one gate, one shape — only the full count changes with the tags:
- Epic / UI / stories / test-cases reviews (no risk tags): the count asks for 1.
- Architecture+contract review (`risk_tags: ["contract"]`): the full count asks for **3 distinct
  approvers** (base 1 + contract 2). The base (1) holds the gate; a shortfall against 3 is reported
  without blocking.
- `stories-review` is an ordinary count gate. It no longer routes per repo.

## Staleness
An approval round is invalidated if the authored artifact was edited after the newest `approved`
record's date/round. When that happens, drop back to `comment` — reviewers must re-approve the new
content. This prevents "approve, then quietly change it" (build plan §5 spirit).

The engine checks this by content, not by date. A bridge approval records `artifactHash`, the
fingerprint of what was approved. When the artifact's fingerprint no longer matches, the approval is
counted as revoked: it stays on disk, it no longer counts, and the gate reports `N approval(s) revoked —
artifact changed; re-approve`. An approval recorded with no `artifactHash` is never treated as stale.
A hand-written approval (the `approve` action, on a Product with no platform) carries no fingerprint and
no platform evidence, so an edit to the artifact does **not** revoke it: after a real change, remove the
old approval and record it again once the reviewer has seen the new content.

For the architecture+contract review there is a second, content-based staleness check: recompute the
SHA-256 of the contract-surface block and compare it to `.sdlc/contract-lock.json`. A mismatch means
the locked surface changed even if the file's mtime looks fine — approvals are stale, re-lock and
re-approve. (Hash recipe: `yad-architecture/references/contract-format.md`.) `yad` computes the
identical digest, so `yad doctor` performs this comparison for every epic and FAILs on a surface that
drifted from its lock — run it rather than recomputing by hand.

## Worked example — epic gate

1. `action: open` → step `epic-review` set `in_review`; `currentStep = epic-review`.
2. Reviewer *bob* leaves comments → captured in the comments file; the author *alice* (pm-assisted)
   edits `epic.md`.
3. Predicate before any approval: `|approvers|=0` → **fails**. Gate reports "missing: 1 approval(s)".
   *alice* wrote the artifact, so her own approval is not recorded.
4. `action: approve` approver *bob* → ledger entry added. Predicate: `|approvers|=1` → **base pass**
   (`epic-review` has no risk tags, so the full count is also 1 and nothing is short).
5. `action: advance` → `epic-review.status=done`, `architecture.status=in_progress`,
   `currentStep=architecture`. Gate reports the advance. The paired authoring step (`epic`) is closed
   too, if it was not already — a gate cannot have passed on an unauthored artifact. Each step it closes
   gets a `closed` record: `via: "approved"` on the review step, `via: "review-passed"` on the author step (E18). In solo mode the
   review step's record also carries `waived: "solo"` (E10). `doctor` reports
   any surviving violation as `YAD-STATE-005`; `yad gate repair <epic>` heals it.

## Participation record (comments.json)
`approvals.json` answers "who approved"; `.sdlc/comments.json` answers "who reviewed/commented". The
gate appends a record per commenter per round on every `comment` action (the machine-readable
counterpart to the `reviews/*--comments.md` markdown). It does **not** feed the predicate — approvals
alone decide the gate — but it makes the `approved.md` record's "Reviewed / commented by" section
attributable, and it is the same shape a future service or the platform bridge can write.

## Non-blocking companion comments (`<!-- yad:noblock -->`)
The Review Companion posts scaffolding comments (the card deck, the chat log) and the social nudge.
These are fun/interactive aids, **not** review objections, so they must never hold the PR/MR — yet they
are deliberately **left unresolved** so they remain in the PR/MR history forever (anyone can scroll back
to see the trailer, cards, chat, and nudges). Every such comment carries a `<!-- yad:noblock -->`
marker, and the gate **excludes marked threads** from the unresolved-thread blocking check (so it does
not "resolve to pass" — it ignores them). A reviewer's *genuine* concern is posted **without** the
marker and blocks normally, exactly as a `CHANGES_REQUESTED` or any unresolved human thread does.

## Platform-backed input (the verified ledger)
When the Product has a platform (`.sdlc/hub.json`), reviewers can approve/comment
on a real PR/MR instead of (or as well as) the skill recording it directly. The sync reads that platform
state with the local user's own `gh`/`glab` and writes the **same**
`approvals.json` / `comments.json` / `reviews/*.md` records the manual path writes — bridge approvals
tagged `"source": "bridge"`. With a local ledger `yad gate sync` writes them; with a verified ledger
`yad gate ci` writes them at merge, and a local `yad gate sync` only prints. **The predicate above is
unchanged**: it counts distinct approvers regardless of how they were recorded.

- The `approver` / `commenter` is the platform login that reviewed. There is no lookup and no role.
- On PR/MR open the assignee is whoever opens it: `@me` on GitHub, and the login `glab` reports on GitLab.
  **No reviewers are requested** — the command prints `no reviewers were requested — ask them on the
  PR itself`. `domain:<repo>` labels for the touched domains are still applied. See
  `../yad-hub-bridge/references/login-roster.md`.
- `sync` is idempotent (upsert by `(step, approver)`, one record per person; comment records by
  `(step, commenter, round)`, an unchanged round rewritten in place) and never touches **manual** approvals. An older bridge record that carries `role`/`domain` is
  recognised as `../yad-hub-bridge/references/login-roster.md` → "Older records" describes, and replaced
  by one login-named record that keeps its fingerprint. Every sync write (`yad gate sync`, `yad gate ci`)
  also records the login on the older records the roster can place for certain; only those it cannot
  place still need the roster on a later sync. A bridge approval records the
  platform's evidence (`approvedAt`, and on GitHub `commit`, `url`, `reviewId`) — for the record only. A revoked approval is superseded **while the step is open**; once
  the step is `done` its approvals are kept as the record of why it passed, and a re-sync only re-binds
  new ones (see `../yad-hub-bridge/references/bridge.md` → "Idempotent re-sync").
- The architecture+contract staleness rule applies to bridge approvals too: a re-lock changes the
  surface fingerprint, so bridge approvals of the old surface stop counting (they stay on disk as revoked).
- No platform / no CLI → the gate runs local with no error. Detail: `../yad-hub-bridge/references/bridge.md`.

## Why this shape
- One approver who is not the author keeps review load low on a small team (design priority 2) while
  still requiring a second pair of eyes (priority 1, code quality / production safety).
- The risk step asks for more people only where a change can break a shared surface
  (contract/auth/payments). It is advisory for now: the capacity cap (E72) is reported, and E73 enforces
  it together with `yad gate lower --reason`, so a gate that asks for more people than the team has
  always has a way out.
- No stored list of people: it goes stale, and repository access already decides who can approve.
- Everything is a file, so a future service can drive the same gate by writing the same records.
