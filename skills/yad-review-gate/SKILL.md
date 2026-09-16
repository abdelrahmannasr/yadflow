---
name: yad-review-gate
description: 'The reusable team review + approve gate for the SDLC. Shares an authored artifact for review, records reviewer comments and approvals as files, enforces the approver count (1 distinct approver; contract/auth/payments raise the full count, which is advisory for now), and advances the epic state ONLY when approval is recorded. Use when the user says "review the analysis/epic/architecture/UI/stories/test-cases", "comment", "approve", or "advance the gate".'
---

# SDLC — Team Review Gate (build plan §3 piece 2, §4, §5)

**Goal:** One reusable step type that turns any authored artifact into a gated, human-approved
review. Every `review+approve` step in the workflow (the optional analysis, epic, architecture+contract,
UI, stories, test-cases) uses this exact gate. **No step advances until its review is approved** and
recorded as a file. Every review uses the same **count** rule: distinct approvers, base 1. A step's
`risk_tags` raise the full count, and that raise is advisory until the capacity cap (E72) lands.

This gate is **swappable and file-driven**: it talks only through files. A Shape step advances only on a
human act — recording an approval and `advance`, or (with a verified ledger) **merging the approved,
fully-resolved review PR/MR**. It works the same whether a human or the `yad gate` CLI triggers it — the
trigger is a parameter, not a hardcoded human.

## Conventions
- `{project-root}` resolves from the project working directory.
- Operate on one epic: `{project-root}/epics/EP-<slug>/`. The Product level is the exception:
  `EP-foundation` lives at `{project-root}/foundation/` (its `.sdlc/` and `reviews/` are there).
- State files: `.sdlc/state.json`, `.sdlc/approvals.json`, `.sdlc/comments.json`, and (when the verified ledger is
  used) `.sdlc/hub-prs.json`. Review records: `reviews/`.
- The artifact base name drops the extension (`epic.md` → `epic`; story `stories/...S01.md` → `stories-S01`).

## Inputs
- `epic`: the `EP-<slug>` to operate on.
- `artifact`: the file under the epic being reviewed (e.g. `epic.md`).
- `action`: one of `open` | `comment` | `approve` | `sync` | `advance` (default: `open`).
- For `comment` / `approve`: the reviewer's platform login (or the name they give, when there is no
  platform). No role and no domain. Ask if not provided.
- `sync` needs no reviewer input — it reads the platform PR/MR review state (via `yad-hub-bridge`).

## On Activation

### Step 1 — Load state
Read `.sdlc/state.json`. Find the `review+approve` step whose `artifact` matches the input (or the
step named `currentStep` if it is a review step). Read `.sdlc/approvals.json`. Read `epic.md` for the
epic's `repos` (the **touched domains**). Determine the **count** for this step. It counts people, not
roles — there are no roles, and yadflow keeps no list of people:
- **Base (enforced):** at least **1 distinct approver**, who should not be the author. The engine does
  not check that: GitHub stops you approving your own PR, GitLab does only when the project's approval
  settings say so, and on a local ledger nothing does — so do not record the author's own approval.
- **Full count (advisory):** `needed = base 1 + risk step`. The risk step comes from the step's
  `risk_tags`: `contract` +2, `auth`/`payments` +1 (the "high" tier). Take the highest tag, never the
  sum. The risk step is ADVISORY until the capacity cap ships (E72): the roadmap's rule caps the count
  at the number of active people, and an uncapped count would deadlock a small team on a contract gate.
  So report the shortfall (`short`); never block on it. `yad gate status` and `yad gate sync` print the
  arithmetic — read it from there rather than recomputing it.
- **Touched domains** only name and label the review; they add no approvals. For a step with a risk
  tag (the **architecture+contract** review) they are the epic's `repos`. For the **stories** review they
  are the **union of every story's `repos`** under `stories/`. `stories-review` is an ordinary count gate.

This is **one gate** for every step — never a forked or copied gate. The tags change the full count
and nothing else.

### Step 2 — Dispatch on `action`

> **Check the mode first — in verified mode you write nothing to the ledger.** Read `.sdlc/hub.json`:
> **verified mode** is `platform` set AND `ledger: "verified"` — or, on a project that has not run `yad migrate` yet, `bridge_enabled` (or legacy `bridge`) `true`. `ledger` wins whenever it is present. Under the verified ledger
> the ledger is CI-owned — `ledger-guard` rejects any non-bot commit touching
> `epics/*/.sdlc/{state,approvals,comments,hub-prs}.json` or `epics/*/reviews/*.md`, local `yad gate
> sync` is advisory, and `yad gate ci --merged` writes the whole transition when the review PR merges.
> So every "set / append / write" instruction below is the **local, or a platform with no
> gate-sync CI** path. In verified mode do the human-facing half — present the artifact, say how many
> approvers the step needs, help the owner address comments — and let the platform PR/MR carry the review
> state; the approvals, comments, review records and the advance all land through CI at merge.

**`open`** — Present the artifact for review. Summarise what changed, say how many approvers the step
needs (base, and the full count from its risk tags), and tell reviewers how to comment/approve. Then
make the transition with the engine:

```bash
yad gate open <epic> <artifact>
```

**Do not hand-write this one.** It does three things, and the second is the one a transcription keeps
forgetting:

1. marks the review step `in_review`;
2. **closes the paired authoring step as `done`** — a gate cannot open on an unauthored artifact, and
   an author step left `in_progress` behind a passed gate blocks every step after it
   (`YAD-STATE-005`, issue #131) until someone runs `yad gate repair`;
3. moves `currentStep` to the gate — **except** when the epic is already `ready-for-build`, where it
   leaves it alone, so opening the parallel `test-cases` gate never pulls the epic back from Build.

With **no platform** configured it writes the ledger and simply opens no PR, so this works offline.
With a platform, the `review/<epic>/<artifact>` branch must already be **on origin** — cut it from the
authoring branch and push it, or run `yad open-pr` from it, which pushes first and then delegates here.
In **verified mode** the command deliberately writes nothing: CI owns the ledger and performs the whole
transition at merge.

Do not advance.

If `.sdlc/hub.json` has a non-null `platform` and `ledger: "verified"` (or, before `yad migrate`, `bridge_enabled: true` / legacy `bridge: true` —
`.sdlc/hub.json` is the only source the CLI reads, see `isVerifiedLedger` in `cli/manifest.mjs`), and `gh`/`glab`
is authenticated, **also open a review PR/MR on the Product** by invoking `yad-hub-bridge action: open`
(epic + artifact), and report the URL. The PR requests **no reviewers**; the command prints
`no reviewers were requested — ask them on the PR itself`, so tell the author to ask people on the PR.
**CI records the PR** in
`epics/<epic>/.sdlc/hub-prs.json` (`{step, artifact, platform, number, url, branch, lastSyncedAt}`) —
write that file yourself only on the local path. Otherwise (no platform / disabled / no CLI)
proceed **local** exactly as before — no error. Opening the PR records no approvals and never
advances.

**`comment`** — Capture reviewer feedback. Append/create a review file
`reviews/<artifact-base>--<YYYY-MM-DD>--comments.md` with a heading per reviewer:

```markdown
# Review comments — <artifact> — <YYYY-MM-DD>

## <reviewer>
- <comment>
- <comment>
```

Also append a **machine-readable** participation record to `.sdlc/comments.json` (create as `[]` if
absent — the markdown stays the human-readable record, this makes commenter names queryable, the
counterpart to `approvals.json`):
```json
{ "artifact": "<artifact>", "step": "<step id>", "commenter": "<platform login, or the name given with no platform>", "round": <n>, "count": <comments this round>, "date": "<YYYY-MM-DD>" }
```
Write no `role` or `domain`. Older records may carry them; nothing reads them.
`round` increments each comment→address cycle for the artifact; upsert by `(step, commenter, round)`.

Then help the **owner address the comments** using the agent lens listed for this step
(analysis → `analyst`; epic → `pm`; architecture → `architect`; ui-design → `ux-designer`;
stories → `pm`, with `architect` for technical detail; test-cases → `test architect`). Update the authored artifact in place.
Repeat comment→address rounds until reviewers are satisfied. **Commenting never advances the gate.**

**`approve`** — Record an approval. Append to `.sdlc/approvals.json`:
```json
{ "artifact": "<artifact>", "step": "<step id>", "approver": "<platform login, or the name given with no platform>", "status": "approved", "date": "<YYYY-MM-DD>", "engagement": "<verified|none>" }
```
One record per person. Write no `role` or `domain`. The approver must not be the artifact's author.
`engagement` records whether the approval came through the [Review Companion](../yad-review-companion/SKILL.md)
(a real trailer/cards/chat session = `verified`) or as a bare click (`none`). It is soft by default
(both count; a bare approve draws a friendly nudge) and only gates when `hub.review.requireEngagement`
is on — see `references/gating.md`. The signal is gameable by design ("visible, not impossible").
Also write/refresh `reviews/<artifact-base>--<YYYY-MM-DD>--approved.md` as a **named record** with three
sections, so every participant is attributable in one place:

```markdown
# Approval record — <artifact> — <YYYY-MM-DD>

Count: **<have> distinct approver(s)** — <the sum, e.g. `3 approvers = base 1 + contract risk 2`>; base 1 enforced[, risk step advisory, short <N> — recorded here, never blocking].

## Approved by
- <approver> — approved <date>[ (<source>)]

## Reviewed / commented by (participation, from comments.json)
- <commenter> — <n> comment(s) across <r> round(s)

## Still required to pass the gate
- <"1 approval(s)", or "none">

Gate status: **<PASSED | BLOCKED>** — <reason>.
```

Then **re-evaluate the rule** (Step 3). Recording an approval does NOT itself advance — advancement is
a separate, explicit check.

**`sync`** — (the platform bridge input path) Pull the Product review PR/MR's review state into the ledger,
then re-evaluate the rule (Step 3). Read the PR for this step from `.sdlc/hub-prs.json` and use
`yad-hub-bridge`'s read recipes (`../yad-hub-bridge/references/bridge.md`) to fetch reviews + comments
via the local user's `gh`/`glab`. For each:
- the platform `login` is the name written — `approver` / `commenter` is the login itself. There is no
  lookup and no role (see `../yad-hub-bridge/references/login-roster.md`);
- an `APPROVED` review / MR approval → append an `approved` record to `approvals.json` tagged
  `"source": "bridge"`; a `COMMENTED`/`CHANGES_REQUESTED`/note → write to
  `reviews/<artifact-base>--<YYYY-MM-DD>--comments.md` + `comments.json` (never an approval).
**Idempotent:** upsert bridge approvals by `(step, approver)` — one record per person. An older record
that still carries `role`/`domain` and names a person by their old roster name is recognised as
`../yad-hub-bridge/references/login-roster.md` → "Older records" describes, and replaced by one
login-named record that keeps its fingerprint. Supersede revoked ones
**while the step is open** (a step already `done` keeps its approvals — they are the record of why it
passed), and key comments on the platform comment id (re-running `sync` does not duplicate). **Manual approvals (no
`source` tag) are never touched.** For the architecture+contract step, discard bridge approvals dated
before a new contract lock (re-lock invalidates platform approvals too). Then refresh the `approved.md`
record, set the PR ledger's `lastSyncedAt`, and **re-evaluate Step 3**. **Never hand-write either PR-ledger file.** It lives under two names while the rename settles — `product-prs.json` and `hub-prs.json` — and the engine writes both together. Writing one leaves the pair disagreeing, and `yad doctor` will report it. Use `yad gate` / `yad review`, which keep them in step.  Under the PR-driven CLI (`yad
gate sync`), `sync` advances the step when Step 3 passes on a **merged**, fully-resolved, approved PR
(the merge is the human act); otherwise it records state and holds the step `in_review`.

**`advance`** — Run the gate predicate (Step 3). Only advance if it passes.

### Step 3 — Gate predicate (the only path that advances)
The step may advance **iff ALL hold**:
1. the advance dial is `human` (`automation: human_approve` — it always is for Shape steps) and the base
   is met: **≥1 distinct approver** (counted by `approver`, so two records from one person are one).
   If it is not, the missing line is `1 approval(s)`. **The risk step (Step 1) is NOT a condition
   here** — it is advisory until the capacity cap ships (E72), so a step that is short of the full count
   still advances when the base holds. Report the shortfall in the record; do not hold the step on it.
   This matches `gatePredicate`, which returns `rule: "count"` and the count as `gateRule`/`have`/`short`,
   and never puts the risk step in `missing`. With `hub.review.requireEngagement` on, only `verified`
   approvals count.
2. The artifact has not changed since the latest approval round (no newer authored edit than the
   newest `approved` record). If it changed, approvals are stale → return to `comment`. For the
   **architecture+contract** review, also recompute the contract-surface hash (see
   `../yad-architecture/references/contract-format.md`): if it no longer matches
   `.sdlc/contract-lock.json`, the surface changed → approvals stale → return to `comment` and re-lock.

If the predicate **fails**: report exactly which approvals are still missing and STOP. Do not modify
`currentStep`.

If the predicate **passes**:

> **These rules are a TRANSCRIPTION of `advanceState`, and that is deliberate — it is the one
> transition with no engine verb behind it.** Everything else this skill does now calls the engine, and
> so do the authoring skills: `yad epic new` seeds a chain, `yad gate open` closes an authoring step and
> opens its gate. But there is no verb for *"an approval landed, advance the chain"* on a Product with
> **no platform**: `yad gate sync` and `yad gate ci` both return immediately without one, and
> `advanceState` — the function holding the rules below — has no other caller. So on a local-only
> Product these bullets ARE the engine's rules, written out. Keep them in step with `advanceState` in
> `cli/epic-state.mjs`, including the author-step close, until a local approve verb exists.
>
> With a platform, you do not perform them at all: `yad gate sync` (local ledger) or `yad gate ci`
> (verified) runs the same transition from that function.
>
> One other skill still writes a chain by hand, and it is not an oversight: `yad-backfill promote`
> rewrites one, and needs its own verb. (`yad-discovery` used to be one; since E75 it runs
> `yad foundation new`. `yad-change` used to seed a threaded chain by hand; since E42 it runs
> `yad epic new --parent`.)

- Mark this review step `status: "done"` **and give it a closing record** (E18):
  `"closed": { "by": "<who performs this advance, or null>", "date": "<YYYY-MM-DD>", "via": "approved", "hash": "<the artifact hash the approvals bind to>" }`.
  `approved`, not `merge`: nothing merged, so there is no `pr` or `commit` to write.
  **In solo mode** (`solo: true` in `.sdlc/hub.json`, or the older `review_gate.solo: true`), add `"waived": "solo"` to that record: the gate passed
  without counting approvals, and the record says so (E10). Only on the review step, never on its author step.
- **Close its paired authoring step if it is not `done` already.** `advanceState` does this defensively
  (issue #131) because a passed gate can never leave its author step behind. Skipping it strands every
  later step behind `YAD-STATE-005`. Give it `"closed": { "by": …, "date": …, "via": "review-passed" }`.
- **Never write a `closed` over one already on a step.** The first close wins.
- **`stories-review`** is the end of the gating chain: set `currentStep: "ready-for-build"` (the Phase 3
  handoff sentinel; intentionally not a `steps[]` entry) **and** open the parallel **`test-cases`** track
  (if its step is `todo`, set it to `in_progress`). Build can now start **and** the tester can work
  `test-cases` at the same time.
- **`test-cases-review`** is the parallel track's gate: mark it `done` but **leave `currentStep` at
  `ready-for-build`** — completing test cases must never pull the epic back from Build.
- **`foundation-review`** (the Product level, `foundation/`) ends at its own sentinel: set
  `currentStep: "foundation-done"`, never `ready-for-build` — the product level has no Build part. The
  old spelling does the same: **`discovery-review`** sets `currentStep: "discovery-done"`.
- **On any review step that passes**, remove `"debt": true` from it, and from its author step once that
  step is `done` — passing the review is what pays a debt back (E41), and nothing else clears the flag.
- A review step that passed **behind the chain** — a step re-opened with a late `yad undefer`, where
  `currentStep` is already past it or is `ready-for-build` — changes nothing else: do not open the step
  after it (that work is already finished) and do not move `currentStep`.
- Any **other** review step: find the next step in `steps[]` that has not already passed — not `skipped`,
  `deferred`, `satisfied` (inherited from a parent epic) or `done` — set
  it to `in_progress` (authoring) or `in_review` **only if it is `todo`**, and set `currentStep` to it. A
  skipped step was marked N/A with `yad skip`, and a deferred one set aside for later with `yad defer`;
  both stay as they are. A step already started or finished keeps its status.
  If every later step is skipped or deferred, set `currentStep: "ready-for-build"`. A step waiting its turn is `todo` from shape 7 on. An older file may still say
  `blocked` with no `record` on it, which means the same thing; a `blocked` step **with** a `record` is
  waiting on someone outside the workflow, so leave it as it is.
- When a gate **opens** (the review starts), move `currentStep` to it only if it is not already past it:
  opening the review of a re-opened step never pulls the chain back.
- Write `state.json`. Report the advance and what the next authored artifact is (or that the epic is
  now `ready-for-build`, with `test-cases` running in parallel).

### PR-driven automation (the `yad gate` CLI)
When the Product has a platform, **CI is the sole writer of the ledger**. `yad gate open` opens the review
PR only — against the `review/<epic>/<artifact>` branch, which must already exist (create it and run
`yad open-pr` from it, which pushes it first). CI (`yad gate ci`) writes the `.sdlc/` + `reviews/`
records this skill describes. The skill's
job is the human half: presenting the artifact, helping the owner address comments, and narrating the
gate. Local `yad gate sync` is advisory in verified mode (reads the platform, prints status, writes
nothing); a human must never commit gate-state files (the `ledger-guard` check rejects it, and the
`hooks/ledger-guard.sh` harness hook refuses an agent the edit up front, naming `yad gate open`
instead — see `yad-checks`). The single
exception is an epic's **seed** — no CI path can create a ledger, so a brand-new epic's `.sdlc/` rides
its **first** review PR/MR, cut from the authoring branch (creation, not mutation, #162).

Under that CLI the gate **advances on merge**: a review PR/MR whose base count is met, whose
comment threads are **all resolved**, and which has been **merged** auto-marks the step `done` and
unblocks the next step. (Until those three hold, the step stays `in_review`.)

**Re-reviewing a step that already advanced.** A step is advanced **once** — the chain is never pulled
backward. But a step that is `done` is still *synced*: when the artifact is edited (for architecture, a
re-locked contract surface) its prior approvals go stale, and the approvals arriving on the new review
PR/MR are recorded and bound to the new content. `yad gate status` then shows the truth — how many
approvals are live against what is in the file today, and how many were revoked — instead of a `done`
step whose approvals all belong to the version before the edit.

The flow is **merge-driven** (wired by `yad-hub-bridge` `wire`): during review CI writes nothing — the
platform PR/MR is the source of truth (native approvals + threads), and CI never touches the review
branch (so an in-flight approval is never dismissed and required checks never strand). On the human
**merge** CI re-reads approvals, advances the step, and flips the artifact `status:` on the **default
branch**. After a merge, `git checkout <default> && git pull` to see it. The predicate and the human
merge are unchanged — CI never approves and never merges. Local mode (no platform) keeps the local
write path.

### Hard rules (build plan §1, §5)
- **The merge click is the human approval act.** A Shape step advances only when a human merges the
  approved, fully-resolved review PR — there is no machine-driven advance. A step `locked: true` may not
  be switched to `advance: auto`; refuse such a request.
- **Approvals are revoked when the reviewed artifact changes.** `sync` re-hashes the artifact (the locked
  contract surface for architecture; every other file without its frontmatter `status:` line, which the
  gate and Build rewrite after review) and drops any approval bound to a stale hash, so a reviewer must
  re-approve the new content. Unresolved comments / `CHANGES_REQUESTED` hold the gate `in_review`.
- The gate talks only through `.sdlc/` and `reviews/` files — never hidden state.
- **The platform is an input path only.** `open`/`sync` use the local user's own `gh`/`glab` (no stored
  tokens), and the **file ledger remains the source of truth** — the Step 3 predicate is unchanged
  whether approvals arrive manually or via `sync`. With no Product platform / no CLI, the gate runs local
  with no error (record approvals manually and `advance`).

## Reference
- Gating details and worked example: `references/gating.md`.
- The platform PR/MR bridge (`open`/`sync` mechanics, read recipes, login attribution): `../yad-hub-bridge/SKILL.md`.
