---
name: sdlc-review-gate
description: 'The reusable team review + approve gate for the SDLC. Shares an authored artifact for review, records reviewer comments and approvals as files, enforces the owner + 1 reviewer rule (escalating to domain owners on contract/auth/payments), and advances the epic state ONLY when approval is recorded. Use when the user says "review the epic/architecture/UI/stories", "comment", "approve", or "advance the gate".'
---

# SDLC — Team Review Gate (build plan §3 piece 2, §4, §5)

**Goal:** One reusable step type that turns any authored artifact into a gated, human-approved
review. Every `review+approve` step in the workflow (epic, architecture+contract, UI, stories) uses
this exact gate. **No step advances until its review is approved** and recorded as a file.

This gate is **swappable and file-driven**: it talks only through files and never auto-advances a
front step. It works the same whether a human or (later) a service triggers it — the trigger is a
parameter, not a hardcoded human.

## Conventions
- `{project-root}` resolves from the project working directory.
- Operate on one epic: `{project-root}/epics/EP-<slug>/`.
- State files: `.sdlc/state.json`, `.sdlc/approvals.json`. Review records: `reviews/`.
- The artifact base name drops the extension (`epic.md` → `epic`; story `stories/...S01.md` → `stories-S01`).

## Inputs
- `epic`: the `EP-<slug>` to operate on.
- `artifact`: the file under the epic being reviewed (e.g. `epic.md`).
- `action`: one of `open` | `comment` | `approve` | `advance` (default: `open`).
- For `comment` / `approve`: the reviewer name and role (`owner` | `reviewer` | `domain-owner`),
  and for domain owners the `domain` (repo/area). Ask if not provided.

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

**`comment`** — Capture reviewer feedback. Append/create a review file
`reviews/<artifact-base>--<YYYY-MM-DD>--comments.md` with a heading per reviewer:

```markdown
# Review comments — <artifact> — <YYYY-MM-DD>

## <reviewer> (<role>)
- <comment>
- <comment>
```

Then help the **owner address the comments** using the agent lens listed for this step (epic → `pm`;
architecture → `architect`; ui-design → `ux-designer`; stories → `pm`, with `architect` for technical
detail — there is **no `sm` agent**, Phase 0 Deviation 1). Update the authored artifact in place.
Repeat comment→address rounds until reviewers are satisfied. **Commenting never advances the gate.**

**`approve`** — Record an approval. Append to `.sdlc/approvals.json`:
```json
{ "artifact": "<artifact>", "step": "<step id>", "approver": "<name>", "role": "<owner|reviewer|domain-owner>", "domain": "<optional>", "status": "approved", "date": "<YYYY-MM-DD>" }
```
Also write/refresh `reviews/<artifact-base>--<YYYY-MM-DD>--approved.md` listing who has approved so
far and who is still required. Then **re-evaluate the rule** (Step 3). Recording an approval does
NOT itself advance — advancement is a separate, explicit check.

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

### Hard rules (build plan §1, §5)
- **Front steps never auto-advance.** Even with `assistance: heavy`, a human must record approval.
- A step `locked: true` may not be switched to `machine_advance`; refuse such a request.
- The gate talks only through `.sdlc/` and `reviews/` files — never hidden state.

## Reference
- Gating details and worked example: `references/gating.md`.
