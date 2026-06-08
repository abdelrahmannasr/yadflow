# `.sdlc/` state schema

All SDLC state lives in plain files under `epics/EP-<slug>/.sdlc/` (build plan §1: "All state lives
in files on disk. Nothing hidden."). No database, no browser storage.

## `state.json`
The per-epic state machine.

| Field | Meaning |
|-------|---------|
| `epicId` | The stable `EP-<slug>` ID. Never renamed. |
| `createdAt` | ISO date the epic was created. |
| `currentStep` | `id` of the step the workflow is waiting on right now. |
| `steps[]` | Ordered list of every front-state step. |

Each `steps[]` entry:

| Field | Values | Meaning |
|-------|--------|---------|
| `id` | `analysis`, `analysis-review`, `epic`, `epic-review`, `architecture`, `architecture-review`, `ui-design`, `ui-design-review`, `stories`, `stories-review` | Step identity. |

### Two valid chain shapes (analysis is optional)

The `analysis` step (and its `analysis-review` gate) is **optional** — it exists only when the team
ran `sdlc-author-analysis` before the epic. The entry-point skill (whichever runs first) is the one
that assigns `EP-<slug>` and seeds `state.json` + the empty ledgers; the other skill detects an
existing `state.json` and does **not** re-seed.

- **With analysis** (10 steps — `sdlc-author-analysis` seeded the chain):
  `analysis → analysis-review → epic → epic-review → architecture → architecture-review → ui-design →
  ui-design-review → stories → stories-review`. Seeded `currentStep` is `analysis-review`; `epic`
  starts `blocked`.
- **Without analysis** (8 steps — `sdlc-author-epic` is the entry point, the default):
  `epic → epic-review → … → stories-review`. Seeded `currentStep` is `epic-review`.

After `stories-review` passes, `currentStep` becomes the `ready-for-build` sentinel either way.
`analysis-review` carries no `risk_tags` (base rule: owner + 1 reviewer).

### Authoring branches

Each front **authoring** step opens its own git branch at the start of the step, named
`<step>/EP-<slug>` where `<step>` ∈ `analysis | epic | architecture | ui-design | stories`
(`config.yaml` `defaults.front_authoring_branch`). This is **distinct** from the review branch
`review/EP-<slug>/<artifact-base>` that `sdlc-hub-bridge` opens later for the review PR/MR.

The shared procedure (run once the `EP-<slug>` is known):
1. **Git-safe / greenfield-safe:** if `{project-root}` is not a git work tree
   (`git rev-parse --is-inside-work-tree` fails), skip branching with a note and author on the current
   tree — no error.
2. Branch name = `<step>/EP-<slug>`. If it already exists, check it out; otherwise create it from the
   hub's default branch (`git checkout -b <step>/EP-<slug>`).
3. Author and commit the step's artifact(s) on that branch. The bridge's `review/…` branch is created
   separately at review time and is untouched by this step.
| `type` | `author` \| `review+approve` | Authoring step or a team review gate. |
| `artifact` | filename or folder | The file/folder this step produces or gates. |
| `assistance` | `none` \| `review` \| `heavy` | Dial 1 — how much AI helps (build plan §2). |
| `automation` | `human_approve` \| `machine_advance` | Dial 2 — who advances (build plan §2). |
| `locked` | `true` \| `false` | Front steps are `true`: may NOT be set to `machine_advance` in this version. |
| `status` | `blocked` \| `in_progress` \| `in_review` \| `done` | Lifecycle. `blocked` = upstream step not yet approved. |
| `risk_tags` | subset of `contract`, `auth`, `payments` | Drives review escalation (build plan §4). |

## `approvals.json`
Append-only ledger (an array). Each entry:

```json
{ "artifact": "epic.md", "step": "epic-review", "approver": "<name>", "role": "owner|reviewer|domain-owner", "domain": "<repo-or-area, optional>", "status": "approved", "date": "<YYYY-MM-DD>", "source": "<bridge, optional>" }
```

`source: "bridge"` marks an approval synced from a hub review PR/MR by `sdlc-review-gate action: sync`
(via `sdlc-hub-bridge`). Manual approvals omit `source` and are never altered by `sync`.

## `comments.json`
Append-only ledger (an array), the machine-readable counterpart to the `reviews/*--comments.md` markdown
("who reviewed/commented", as `approvals.json` is "who approved"). Written by `sdlc-review-gate`'s
`comment` action; feeds the `approved.md` participation roster, not the gate predicate. Each entry:

```json
{ "artifact": "epic.md", "step": "epic-review", "commenter": "<name>", "role": "owner|reviewer|domain-owner", "domain": "<optional>", "round": <n>, "count": <comments this round>, "date": "<YYYY-MM-DD>" }
```

## `hub-prs.json`
Present only when the front-half review runs through the platform bridge. Per review step, the review
PR/MR opened on the hub (sibling of `approvals.json`, so the locked `state.json` step shape is untouched):

```json
{ "step": "<review step id>", "artifact": "<artifact>", "platform": "github|gitlab", "number": <n>, "url": "<pr/mr url>", "branch": "review/EP-<slug>/<artifact-base>", "lastSyncedAt": "<YYYY-MM-DD or null>" }
```

## `reviews/`
Human-readable review records, one file per round:
`reviews/<artifact-base>--<YYYY-MM-DD>--<status>.md` where `status` ∈ `comments` | `approved`
and `<artifact-base>` is the artifact without extension (e.g. `epic`, `architecture`, `stories-S01`).

## Dial defaults & locks
- Every step defaults to `automation: human_approve` (build plan §2).
- The four authoring front steps and their reviews are `locked: true` — the engine refuses to set
  them to `machine_advance` in this version (build plan §1, §8.7). Only back states (build pipeline,
  steps 9–14) may move toward machine-advance in a later iteration.

---

# Phase 4 build-half state (the back half made dial-bearing)

Phase 3 recorded build progress only *after the fact* in `build-log.json`. Phase 4 needs the back
steps to carry their own `automation` dial so the orchestrator (`sdlc-run`) can read it and decide
whether to advance on its own. Two new files under `.sdlc/` do this.

## `build-state/<story-id>.json`
One file per story that has entered the build half. The build half is **per-story, per-repo**, so the
steps live under each repo (mirrors the per-repo shape of `build-log.json`).

```json
{
  "story": "EP-<slug>-S0N",
  "repos": {
    "backend": {
      "currentStep": "checks",
      "steps": [
        { "id": "spec",            "automation": "human_approve",  "locked": false, "status": "done" },
        { "id": "tasks",           "automation": "human_approve",  "locked": false, "status": "done" },
        { "id": "implement",       "automation": "human_approve",  "locked": false, "status": "done" },
        { "id": "checks",          "automation": "machine_advance","locked": false, "status": "in_progress" },
        { "id": "engineer-review", "automation": "human_approve",  "locked": true,  "status": "blocked" }
      ]
    }
  }
}
```

Each `steps[]` entry:

| Field | Values | Meaning |
|-------|--------|---------|
| `id` | `spec`, `tasks`, `implement`, `checks`, `engineer-review` | Back-half step identity (the `back_steps` from `config.yaml` + the human merge gate). |
| `automation` | `human_approve` \| `machine_advance` | Dial 2. Defaults to `human_approve`; flipped to `machine_advance` only after the trust threshold is met (and never for `locked` steps). |
| `locked` | `true` \| `false` | `engineer-review` is `true` — it never auto-advances (build plan §E). |
| `status` | `blocked` \| `in_progress` \| `in_review` \| `done` | Lifecycle. `sdlc-run` advances `done` steps and `blocked`s on a halt. |

`currentStep` is the `id` the orchestrator is waiting on / about to run for that repo. The file is
created when a story enters the build half; all dials start `human_approve` (the `config.yaml`
`automation.default`).

## `trust-log.json`
Append-only ledger (an array), the back-half analogue of `approvals.json`. **This is the evidence
base** that decides when a step is safe to automate (build plan Step A). One entry per step run:

```json
{
  "story": "EP-<slug>-S0N",
  "repo": "backend",
  "step": "checks",
  "automation": "human_approve",
  "verdict": "approved-unchanged",
  "signals": { "checks": "pass", "human_edited_diff": false, "scope_overrun": false, "contract_touch": false },
  "ranBy": "machine",
  "date": "<YYYY-MM-DD>",
  "note": "<optional>"
}
```

| Field | Values | Meaning |
|-------|--------|---------|
| `step` | a `back_steps` id | Which step this run is recorded against. |
| `automation` | dial in force at run time | So the log shows whether the run was a manual or an automated advance. |
| `verdict` | `approved-unchanged` \| `approved-with-edits` \| `rejected` | The trust signal. **Provisional verdict is derived** (below); the human gate for that step confirms or overrides it and finalizes the entry. |
| `signals` | object | The raw inputs the provisional verdict was derived from. The fields present depend on the step (table below). |
| `ranBy` | `machine` \| `human` | Whether the orchestrator advanced it or a human did. |

**Per-step `signals` fields** (only the relevant ones are set; others may be omitted or `n/a`):

| Step | Signals | Finalized at (the human gate) |
|------|---------|-------------------------------|
| `spec` | `human_edited_spec` | the human who accepts `specs/<story>/` (`sdlc-spec` Step 8) |
| `tasks` | `task_rescoped` | first consume by `sdlc-implement` (Step 8) |
| `implement` | `human_edited_diff`, `scope_overrun`, `contract_touch` | engineer review at `sdlc-ship` |
| `checks` | `checks` (`pass`\|`fail`) | the gate run itself (objective) |

**Deriving the provisional verdict** (build plan Step A; extended for `spec`/`tasks` in Phase 4b — the
same three-way shape, anchored to each step's human gate, never self-graded):
- any check FAIL, scope overrun, contract-surface touch, or a discarded/regenerated artifact → `rejected`;
- accepted after a human edited the output (`human_edited_diff` / `human_edited_spec` / `task_rescoped`) → `approved-with-edits`;
- accepted as produced → `approved-unchanged`.

**Trust threshold** (from `config.yaml` `automation.trust_threshold`): a step is a candidate for
`machine_advance` only when its slice of `trust-log.json` (same `step`, this story's repo or the
project) has `>= min_runs` entries AND the fraction with `verdict == "approved-unchanged"` is
`>= min_approved_unchanged`. The dial-setter in `sdlc-run` enforces this; `sdlc-status` surfaces it.
