---
name: sdlc-review-gate
description: 'The reusable team review + approve gate for the SDLC. Shares an authored artifact for review, records reviewer comments and approvals as files, enforces the owner + 1 reviewer rule (escalating to domain owners on contract/auth/payments), and advances the epic state ONLY when approval is recorded. Use when the user says "review the analysis/epic/architecture/UI/stories", "comment", "approve", or "advance the gate".'
---

# SDLC — Team Review Gate (build plan §3 piece 2, §4, §5)

**Goal:** One reusable step type that turns any authored artifact into a gated, human-approved
review. Every `review+approve` step in the workflow (the optional analysis, epic, architecture+contract,
UI, stories) uses this exact gate. **No step advances until its review is approved** and recorded as a
file. The `analysis-review` and `epic`/`ui-design` reviews use the **base** rule (owner + 1 reviewer);
escalation applies only where `risk_tags` or per-repo routing call for it.

This gate is **swappable and file-driven**: it talks only through files. A front step advances only on a
human act — recording an approval and `advance`, or (with the bridge) **merging the approved,
fully-resolved review PR/MR**. It works the same whether a human or the `sdlc gate` CLI triggers it — the
trigger is a parameter, not a hardcoded human.

## Conventions
- `{project-root}` resolves from the project working directory.
- Operate on one epic: `{project-root}/epics/EP-<slug>/`.
- State files: `.sdlc/state.json`, `.sdlc/approvals.json`, `.sdlc/comments.json`, and (when the bridge is
  used) `.sdlc/hub-prs.json`. Review records: `reviews/`.
- The artifact base name drops the extension (`epic.md` → `epic`; story `stories/...S01.md` → `stories-S01`).

## Inputs
- `epic`: the `EP-<slug>` to operate on.
- `artifact`: the file under the epic being reviewed (e.g. `epic.md`).
- `action`: one of `open` | `comment` | `approve` | `sync` | `advance` (default: `open`).
- For `comment` / `approve`: the reviewer name and role (`owner` | `reviewer` | `domain-owner`),
  and for domain owners the `domain` (repo/area). Ask if not provided.
- `sync` needs no reviewer input — it reads the platform PR/MR review state (via `sdlc-hub-bridge`).

## On Activation

### Step 1 — Load state
Read `.sdlc/state.json`. Find the `review+approve` step whose `artifact` matches the input (or the
step named `currentStep` if it is a review step). Read `.sdlc/approvals.json`. Read `epic.md` for the
epic's `repos` (the **touched domains**). Determine the **reviewer rule** for this step:
- **Base rule:** `owner + 1 reviewer` — at least one `owner` approval AND at least one distinct
  non-owner `reviewer` approval.
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
touched `repos` — never a forked or copied gate.

### Step 2 — Dispatch on `action`

**`open`** — Present the artifact for review. Summarise what changed, list the required reviewers per
the rule above, and tell reviewers how to comment/approve. Set the step `status` to `in_review` and
`currentStep` to this step in `state.json` if not already. Do not advance.

If `.sdlc/hub.json` has a non-null `platform`, `bridge_enabled: true`, `config.yaml` `hub.bridge: true`,
and `gh`/`glab` is authenticated, **also open a review PR/MR on the hub** by invoking
`sdlc-hub-bridge action: open` (epic + artifact). Record the PR in `epics/<epic>/.sdlc/hub-prs.json`
(`{step, artifact, platform, number, url, branch, lastSyncedAt}`) and report the URL + required
reviewers. Otherwise (no platform / disabled / no CLI) proceed **file-only** exactly as before — no
error. Opening the PR records no approvals and never advances.

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
Deviation 1). Update the authored artifact in place.
Repeat comment→address rounds until reviewers are satisfied. **Commenting never advances the gate.**

**`approve`** — Record an approval. Append to `.sdlc/approvals.json`:
```json
{ "artifact": "<artifact>", "step": "<step id>", "approver": "<name>", "role": "<owner|reviewer|domain-owner>", "domain": "<optional>", "status": "approved", "date": "<YYYY-MM-DD>" }
```
Also write/refresh `reviews/<artifact-base>--<YYYY-MM-DD>--approved.md` as a **named roster** with three
sections, so every participant is attributable in one place:

```markdown
# Approval record — <artifact> — <YYYY-MM-DD>

Reviewer rule in force: **<base | escalated | per-repo>** (<why — e.g. risk_tags / touched repos>).

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

**`sync`** — (the platform bridge input path) Pull the hub review PR/MR's review state into the ledger,
then re-evaluate the rule (Step 3). Read the PR for this step from `.sdlc/hub-prs.json` and use
`sdlc-hub-bridge`'s read recipes (`../sdlc-hub-bridge/references/bridge.md`) to fetch reviews + comments
via the local user's `gh`/`glab`. For each:
- map the platform `login` → SDLC `name` + `role` via `.sdlc/hub.json`'s roster (a roster `name` equal
  to a repo's `domain_owner` in `repos.json` becomes that repo's `domain-owner` for a touched domain;
  an unmapped login is a plain `reviewer`, flagged, never promoted);
- an `APPROVED` review / MR approval → append an `approved` record to `approvals.json` tagged
  `"source": "bridge"`; a `COMMENTED`/`CHANGES_REQUESTED`/note → write to
  `reviews/<artifact-base>--<YYYY-MM-DD>--comments.md` + `comments.json` (never an approval).
**Idempotent:** upsert bridge approvals by `(step, approver, role, domain)`, supersede revoked ones, and
key comments on the platform comment id (re-running `sync` does not duplicate). **Manual approvals (no
`source` tag) are never touched.** For the architecture+contract step, discard bridge approvals dated
before a new contract lock (re-lock invalidates platform approvals too). Then refresh the `approved.md`
roster, set `hub-prs.json` `lastSyncedAt`, and **re-evaluate Step 3**. Under the PR-driven CLI (`sdlc
gate sync`), `sync` advances the step when Step 3 passes on a **merged**, fully-resolved, approved PR
(the merge is the human act); otherwise it records state and holds the step `in_review`.

**`advance`** — Run the gate predicate (Step 3). Only advance if it passes.

### Step 3 — Gate predicate (the only path that advances)
The step may advance **iff ALL hold**:
1. `automation` is `human_approve` (it always is for front steps) and the required approvals exist:
   ≥1 `owner` AND ≥`review_gate.default_reviewers` (1) distinct non-owner `reviewer`, AND — if the
   step is escalated — ≥1 `domain-owner` for each touched domain.
2. The artifact has not changed since the latest approval round (no newer authored edit than the
   newest `approved` record). If it changed, approvals are stale → return to `comment`. For the
   **architecture+contract** review, also recompute the contract-surface hash (see
   `../sdlc-author-architecture/references/contract-format.md`): if it no longer matches
   `.sdlc/contract-lock.json`, the surface changed → approvals stale → return to `comment` and re-lock.

If the predicate **fails**: report exactly which approvals are still missing and STOP. Do not modify
`currentStep`.

If the predicate **passes**:
- Mark this review step `status: "done"`.
- If there **is** a next step in `steps[]`: set it `status` from `blocked` to `in_progress`
  (authoring) or `in_review`, and set `currentStep` to that next step.
- If this is the **last** step (`stories-review`, the final review): there is no further front step —
  set `currentStep: "ready-for-build"` (the Phase 3 handoff sentinel; it is intentionally not a
  `steps[]` entry). The front half is complete.
- Write `state.json`. Report the advance and what the next authored artifact is (or that the epic is
  now `ready-for-build`).

### PR-driven automation (the `sdlc gate` CLI)
When the hub has a platform, the mechanical `open`/`sync`/`advance` is performed deterministically by the
**`sdlc gate` CLI** (`sdlc gate open|sync|comments|status`), which writes the same `.sdlc/` + `reviews/`
records this skill describes. The skill's job is then the human half: presenting the artifact, helping the
owner address comments, and narrating the gate. The CLI is the single implementation of the gh/glab
mechanics — do not hand-run gh/glab recipes when it is installed.

Under that CLI the gate **advances on merge**: a review PR/MR whose reviewer rule is satisfied, whose
comment threads are **all resolved**, and which has been **merged** auto-marks the step `done` and
unblocks the next step. (Until those three hold, the step stays `in_review`.)

### Hard rules (build plan §1, §5)
- **The merge click is the human approval act.** A front step advances only when a human merges the
  approved, fully-resolved review PR — there is no machine-driven advance. A step `locked: true` may not
  be switched to `machine_advance`; refuse such a request.
- **Approvals are revoked when the reviewed artifact changes.** `sync` re-hashes the artifact (the locked
  contract surface for architecture) and drops any approval bound to a stale hash, so a reviewer must
  re-approve the new content. Unresolved comments / `CHANGES_REQUESTED` hold the gate `in_review`.
- The gate talks only through `.sdlc/` and `reviews/` files — never hidden state.
- **The platform is an input path only.** `open`/`sync` use the local user's own `gh`/`glab` (no stored
  tokens), and the **file ledger remains the source of truth** — the Step 3 predicate is unchanged
  whether approvals arrive manually or via `sync`. With no hub platform / no CLI, the gate runs file-only
  with no error (record approvals manually and `advance`).

## Reference
- Gating details and worked example: `references/gating.md`.
- The platform PR/MR bridge (`open`/`sync` mechanics, read recipes, roster): `../sdlc-hub-bridge/SKILL.md`.
