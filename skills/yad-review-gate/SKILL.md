---
name: yad-review-gate
description: 'The reusable team review + approve gate for the SDLC. Shares an authored artifact for review, records reviewer comments and approvals as files, enforces the owner + 1 reviewer rule (escalating to domain owners on contract/auth/payments), and advances the epic state ONLY when approval is recorded. Use when the user says "review the analysis/epic/architecture/UI/stories/test-cases", "comment", "approve", or "advance the gate".'
---

# SDLC — Team Review Gate (build plan §3 piece 2, §4, §5)

**Goal:** One reusable step type that turns any authored artifact into a gated, human-approved
review. Every `review+approve` step in the workflow (the optional analysis, epic, architecture+contract,
UI, stories, test-cases) uses this exact gate. **No step advances until its review is approved** and
recorded as a file. The `analysis-review`, `epic`/`ui-design`, and `test-cases` reviews use the **base**
rule (owner + 1 reviewer); escalation applies only where `risk_tags` or per-repo routing call for it.

This gate is **swappable and file-driven**: it talks only through files. A Shape step advances only on a
human act — recording an approval and `advance`, or (with a verified ledger) **merging the approved,
fully-resolved review PR/MR**. It works the same whether a human or the `yad gate` CLI triggers it — the
trigger is a parameter, not a hardcoded human.

## Conventions
- `{project-root}` resolves from the project working directory.
- Operate on one epic: `{project-root}/epics/EP-<slug>/`.
- State files: `.sdlc/state.json`, `.sdlc/approvals.json`, `.sdlc/comments.json`, and (when the verified ledger is
  used) `.sdlc/hub-prs.json`. Review records: `reviews/`.
- The artifact base name drops the extension (`epic.md` → `epic`; story `stories/...S01.md` → `stories-S01`).

## Inputs
- `epic`: the `EP-<slug>` to operate on.
- `artifact`: the file under the epic being reviewed (e.g. `epic.md`).
- `action`: one of `open` | `comment` | `approve` | `sync` | `advance` (default: `open`).
- For `comment` / `approve`: the reviewer name and role (`owner` | `reviewer` | `domain-owner`),
  and for domain owners the `domain` (repo/area). Ask if not provided.
- `sync` needs no reviewer input — it reads the platform PR/MR review state (via `yad-hub-bridge`).

## On Activation

### Step 1 — Load state
Read `.sdlc/state.json`. Find the `review+approve` step whose `artifact` matches the input (or the
step named `currentStep` if it is a review step). Read `.sdlc/approvals.json`. Read `epic.md` for the
epic's `repos` (the **touched domains**). Determine the **reviewer rule** for this step:
- **Base rule:** `owner + 1 reviewer` — at least one `owner` approval AND at least one distinct
  non-owner `reviewer` approval.
- **The count, reported beside the rules below but not yet holding the gate:** the step asks for
  `base + risk step` **distinct approvers** — base 1, plus 2 when the step carries `contract` or 1 when
  it carries `auth`/`payments` (the highest tag, never the sum). It names no role, so one person holding
  two roles is one approver. It is ADVISORY until the capacity cap ships (E72): the roadmap's rule caps
  it at the number of active people, and an uncapped count would deadlock a small team on a contract
  gate. So report the shortfall; never block on it. `yad gate status` and `yad gate sync` print the
  arithmetic — read it from there rather than recomputing it.
- **Escalation option (risk-driven):** if the step's `risk_tags` intersect `{contract, auth,
  payments}`, ALSO require at least one `domain-owner` approval **per touched domain** (build plan §4,
  §5). For the **architecture+contract** review (`risk_tags: ["contract"]`), the touched domains are
  the epic's `repos` — each repo's owner must sign off on the shared surface, so it escalates by
  default.
- **Per-repo routing option (stories):** for the **stories** review, the relevant domain engineer
  reviews the stories touching their repo: treat each repo's engineer as a `domain-owner` for that
  repo's stories. The touched domains are the **union of every story's `repos`** under `stories/`
  (build plan §4 step 8). The `domain` field on each approval is the repo name.

Escalation and per-repo routing are **options of this one gate**, selected by `risk_tags` and the
touched `repos` — never a forked or copied gate. The count is not an option either: it is computed for
every step and reported every time, and it decides nothing until E72 caps it.

### Step 2 — Dispatch on `action`

> **Check the mode first — in verified mode you write nothing to the ledger.** Read `.sdlc/hub.json`:
> **verified mode** is `platform` set AND `ledger: "verified"` — or, on a project that has not run `yad migrate` yet, `bridge_enabled` (or legacy `bridge`) `true`. `ledger` wins whenever it is present. Under the verified ledger
> the ledger is CI-owned — `ledger-guard` rejects any non-bot commit touching
> `epics/*/.sdlc/{state,approvals,comments,hub-prs}.json` or `epics/*/reviews/*.md`, local `yad gate
> sync` is advisory, and `yad gate ci --merged` writes the whole transition when the review PR merges.
> So every "set / append / write" instruction below is the **local, or a platform with no
> gate-sync CI** path. In verified mode do the human-facing half — present the artifact, route the
> required reviewers, help the owner address comments — and let the platform PR/MR carry the review
> state; the approvals, comments, review records and the advance all land through CI at merge.

**`open`** — Present the artifact for review. Summarise what changed, list the required reviewers per
the rule above, and tell reviewers how to comment/approve. Then make the transition with the engine:

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
(epic + artifact), and report the URL + required reviewers. **CI records the PR** in
`epics/<epic>/.sdlc/hub-prs.json` (`{step, artifact, platform, number, url, branch, lastSyncedAt}`) —
write that file yourself only on the local path. Otherwise (no platform / disabled / no CLI)
proceed **local** exactly as before — no error. Opening the PR records no approvals and never
advances.

**`comment`** — Capture reviewer feedback. Append/create a review file
`reviews/<artifact-base>--<YYYY-MM-DD>--comments.md` with a heading per reviewer:

```markdown
# Review comments — <artifact> — <YYYY-MM-DD>

## <reviewer> (<role>)
- <comment>
- <comment>
```

Also append a **machine-readable** participation record to `.sdlc/comments.json` (create as `[]` if
absent — the markdown stays the human-readable record, this makes commenter names queryable, the
counterpart to `approvals.json`):
```json
{ "artifact": "<artifact>", "step": "<step id>", "commenter": "<name>", "role": "<owner|reviewer|domain-owner>", "domain": "<optional>", "round": <n>, "count": <comments this round>, "date": "<YYYY-MM-DD>" }
```
`round` increments each comment→address cycle for the artifact; upsert by `(step, commenter, round)`.

Then help the **owner address the comments** using the agent lens listed for this step
(analysis → `analyst`; epic → `pm`; architecture → `architect`; ui-design → `ux-designer`;
stories → `pm`, with `architect` for technical detail — there is **no `sm` agent**, Phase 0
Deviation 1; test-cases → `test architect` / Murat, `bmad-tea`). Update the authored artifact in place.
Repeat comment→address rounds until reviewers are satisfied. **Commenting never advances the gate.**

**`approve`** — Record an approval. Append to `.sdlc/approvals.json`:
```json
{ "artifact": "<artifact>", "step": "<step id>", "approver": "<name>", "role": "<owner|reviewer|domain-owner>", "domain": "<optional>", "status": "approved", "date": "<YYYY-MM-DD>", "engagement": "<verified|none>" }
```
`engagement` records whether the approval came through the [Review Companion](../yad-review-companion/SKILL.md)
(a real trailer/cards/chat session = `verified`) or as a bare click (`none`). It is soft by default
(both count; a bare approve draws a friendly nudge) and only gates when `hub.review.requireEngagement`
is on — see `references/gating.md`. The signal is gameable by design ("visible, not impossible").
Also write/refresh `reviews/<artifact-base>--<YYYY-MM-DD>--approved.md` as a **named roster** with three
sections, so every participant is attributable in one place:

```markdown
# Approval record — <artifact> — <YYYY-MM-DD>

Reviewer rule in force: **<base | escalated | per-repo>** (<why — e.g. risk_tags / touched repos>).
Approver count (advisory, not enforced): **<have> of <needed>** — <the sum, e.g. `3 approvers = base 1 + contract risk 2`>[, short <N> — recorded here, never blocking].

## Approved by
- <name> — <role>[ (<domain>)] — approved <date>

## Reviewed / commented by (participation, from comments.json)
- <name> — <role> — <n> comment(s) across <r> round(s)

## Still required to pass the gate
- <missing owner/reviewer/domain-owner, or "none">

Gate status: **<PASSED | BLOCKED>** — <reason>.
```

Then **re-evaluate the rule** (Step 3). Recording an approval does NOT itself advance — advancement is
a separate, explicit check.

**`sync`** — (the platform bridge input path) Pull the Product review PR/MR's review state into the ledger,
then re-evaluate the rule (Step 3). Read the PR for this step from `.sdlc/hub-prs.json` and use
`yad-hub-bridge`'s read recipes (`../yad-hub-bridge/references/bridge.md`) to fetch reviews + comments
via the local user's `gh`/`glab`. For each:
- map the platform `login` → SDLC `name` + `role` via `.sdlc/hub.json`'s roster (a roster `name` equal
  to a repo's `domain_owner` in `repos.json` becomes that repo's `domain-owner` for a touched domain;
  an unmapped login is a plain `reviewer`, flagged, never promoted);
- an `APPROVED` review / MR approval → append an `approved` record to `approvals.json` tagged
  `"source": "bridge"`; a `COMMENTED`/`CHANGES_REQUESTED`/note → write to
  `reviews/<artifact-base>--<YYYY-MM-DD>--comments.md` + `comments.json` (never an approval).
**Idempotent:** upsert bridge approvals by `(step, approver, role, domain)`, supersede revoked ones
**while the step is open** (a step already `done` keeps its approvals — they are the record of why it
passed), and key comments on the platform comment id (re-running `sync` does not duplicate). **Manual approvals (no
`source` tag) are never touched.** For the architecture+contract step, discard bridge approvals dated
before a new contract lock (re-lock invalidates platform approvals too). Then refresh the `approved.md`
roster, set the PR ledger's `lastSyncedAt`, and **re-evaluate Step 3**. **Never hand-write either PR-ledger file.** It lives under two names while the rename settles — `product-prs.json` and `hub-prs.json` — and the engine writes both together. Writing one leaves the pair disagreeing, and `yad doctor` will report it. Use `yad gate` / `yad review`, which keep them in step.  Under the PR-driven CLI (`yad
gate sync`), `sync` advances the step when Step 3 passes on a **merged**, fully-resolved, approved PR
(the merge is the human act); otherwise it records state and holds the step `in_review`.

**`advance`** — Run the gate predicate (Step 3). Only advance if it passes.

### Step 3 — Gate predicate (the only path that advances)
The step may advance **iff ALL hold**:
1. the advance dial is `human` (`automation: human_approve` — it always is for Shape steps) and the required approvals exist:
   ≥1 `owner` AND ≥`review_gate.default_reviewers` (1) distinct non-owner `reviewer`, AND — if the
   step is escalated — ≥1 `domain-owner` for each touched domain. **The approver count (Step 1) is NOT
   a condition here** — it is advisory until the capacity cap ships (E72), so a step that is short of it
   still advances when the three role conditions hold. Report the shortfall in the record; do not hold
   the step on it. This matches `gatePredicate`, which returns the count as `gateRule`/`have`/`short`
   and never puts it in `missing`.
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
> One other skill still writes a chain by hand, and it is not an oversight: `yad-change` seeds a
> threaded chain bound to a parent's artifact hashes (E42 owns inheritance). `yad-backfill promote`
> rewrites one too, and needs its own verb. (`yad-discovery` used to be the third; since E75 it runs
> `yad foundation new`.)

- Mark this review step `status: "done"`.
- **Close its paired authoring step if it is not `done` already.** `advanceState` does this defensively
  (issue #131) because a passed gate can never leave its author step behind. Skipping it strands every
  later step behind `YAD-STATE-005`.
- **`stories-review`** is the end of the gating chain: set `currentStep: "ready-for-build"` (the Phase 3
  handoff sentinel; intentionally not a `steps[]` entry) **and** open the parallel **`test-cases`** track
  (set its step `blocked` → `in_progress`). Build can now start **and** the tester can work
  `test-cases` at the same time.
- **`test-cases-review`** is the parallel track's gate: mark it `done` but **leave `currentStep` at
  `ready-for-build`** — completing test cases must never pull the epic back from Build.
- **`foundation-review`** (the Product level, `foundation/`) ends at its own sentinel: set
  `currentStep: "foundation-done"`, never `ready-for-build` — the product level has no Build part. The
  old spelling does the same: **`discovery-review`** sets `currentStep: "discovery-done"`.
- Any **other** review step: set the next step in `steps[]` from `blocked` to `in_progress` (authoring)
  or `in_review`, and set `currentStep` to that next step.
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

Under that CLI the gate **advances on merge**: a review PR/MR whose reviewer rule is satisfied, whose
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
  contract surface for architecture) and drops any approval bound to a stale hash, so a reviewer must
  re-approve the new content. Unresolved comments / `CHANGES_REQUESTED` hold the gate `in_review`.
- The gate talks only through `.sdlc/` and `reviews/` files — never hidden state.
- **The platform is an input path only.** `open`/`sync` use the local user's own `gh`/`glab` (no stored
  tokens), and the **file ledger remains the source of truth** — the Step 3 predicate is unchanged
  whether approvals arrive manually or via `sync`. With no Product platform / no CLI, the gate runs local
  with no error (record approvals manually and `advance`).

## Reference
- Gating details and worked example: `references/gating.md`.
- The platform PR/MR bridge (`open`/`sync` mechanics, read recipes, roster): `../yad-hub-bridge/SKILL.md`.
