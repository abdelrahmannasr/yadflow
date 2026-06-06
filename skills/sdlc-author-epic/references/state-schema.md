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
| `id` | `epic`, `epic-review`, `architecture`, `architecture-review`, `ui-design`, `ui-design-review`, `stories`, `stories-review` | Step identity. |
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
{ "artifact": "epic.md", "step": "epic-review", "approver": "<name>", "role": "owner|reviewer|domain-owner", "domain": "<repo-or-area, optional>", "status": "approved", "date": "<YYYY-MM-DD>" }
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
| `verdict` | `approved-unchanged` \| `approved-with-edits` \| `rejected` | The trust signal. **Provisional verdict is derived** (below); the engineer review in `sdlc-ship` confirms or overrides it and finalizes the entry. |
| `signals` | object | The raw inputs the provisional verdict was derived from. |
| `ranBy` | `machine` \| `human` | Whether the orchestrator advanced it or a human did. |

**Deriving the provisional verdict** (build plan Step A / confirmed Phase 4 decision):
- any check FAIL, scope overrun, or contract-surface touch → `rejected`;
- merged after a human edited the diff → `approved-with-edits`;
- merged as authored → `approved-unchanged`.

**Trust threshold** (from `config.yaml` `automation.trust_threshold`): a step is a candidate for
`machine_advance` only when its slice of `trust-log.json` (same `step`, this story's repo or the
project) has `>= min_runs` entries AND the fraction with `verdict == "approved-unchanged"` is
`>= min_approved_unchanged`. The dial-setter in `sdlc-run` enforces this; `sdlc-status` surfaces it.
