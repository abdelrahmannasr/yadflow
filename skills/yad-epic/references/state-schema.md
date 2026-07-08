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
| `id` | `analysis`, `analysis-review`, `epic`, `epic-review`, `architecture`, `architecture-review`, `ui-design`, `ui-design-review`, `stories`, `stories-review`, `test-cases`, `test-cases-review` | Step identity. |

### Two valid chain shapes (analysis is optional)

The `analysis` step (and its `analysis-review` gate) is **optional** — it exists only when the team
ran `yad-analysis` before the epic. The entry-point skill (whichever runs first) is the one
that assigns `EP-<slug>` and seeds `state.json` + the empty ledgers; the other skill detects an
existing `state.json` and does **not** re-seed.

- **With analysis** (12 steps — `yad-analysis` seeded the chain):
  `analysis → analysis-review → epic → epic-review → architecture → architecture-review → ui-design →
  ui-design-review → stories → stories-review → test-cases → test-cases-review`. Seeded `currentStep`
  is `analysis-review`; `epic` starts `blocked`.
- **Without analysis** (10 steps — `yad-epic` is the entry point, the default):
  `epic → epic-review → … → stories-review → test-cases → test-cases-review`. Seeded `currentStep` is
  `epic-review`.

`analysis-review`, `ui-design-review`, and `test-cases-review` carry no `risk_tags` (base rule:
owner + 1 reviewer).

### `ui-design` is optional (skippable)

The `ui-design` step (and its `ui-design-review` gate) is **optional** for an epic with no
user-facing surface — a backend/API service, a data pipeline, infra work. Unlike `analysis` (which is
optional by being **omitted** from the chain at seed time), `ui-design` is **always seeded** and then
**marked N/A in place** so the skip stays visible and auditable. The single mechanism is
`yad skip EP-<slug> ui-design --reason "<why>"` (reverse with `--undo`), usable at epic-authoring time
or any point **up to authoring the `ui-design` step** — the skip is refused once its review gate has
opened (the UI work is committed by then) or once `stories` has started. `--undo` is allowed until the
`stories` review opens.

A skipped step gets four extra fields and is pre-marked `done`:

| Field | Values | Meaning |
|-------|--------|---------|
| `skipped` | `true` | This step is N/A for this epic; pre-marked `done`, short-circuited by `gatePredicate` (`rule: "skipped"`) so no review is required. |
| `skipReason` | string | Why it was skipped (e.g. "backend-only service, no UI"). |
| `skippedBy` | login/name or `null` | Who marked it N/A (best-effort, from the roster/git identity). |
| `skippedAt` | `YYYY-MM-DD` or `null` | When it was marked N/A. |

Both the `ui-design` **and** `ui-design-review` entries carry these fields. `advanceState` steps over
any `skipped` step, so approving `architecture-review` on a UI-less epic lands directly on `stories`;
`preconditionsMet` treats the pre-`done` steps as satisfied. `unskipStep` (via `yad skip … --undo`)
strips the fields and restores the chain, refused once `stories-review` has opened. Only `ui-design` is
skippable today (engine `SKIPPABLE_STEPS`).

### `test-cases` is a parallel, non-blocking track

`test-cases` (and its `test-cases-review` gate) sit in `steps[]` after `stories-review`, but they are a
**parallel track that does not gate the build half**. When `stories-review` passes, `advanceState`:
- sets `currentStep` to the **`ready-for-build`** sentinel — so the build half (`yad-spec` → … keyed off
  `currentStep == "ready-for-build"`) can start **immediately**, and
- opens `test-cases` (`blocked` → `in_progress`) so the tester can work **in parallel**.

The `test-cases` track is therefore driven by its own step `status`, **not** by `currentStep`:
`yad-test-cases` proceeds when `test-cases.status == "in_progress"`, and neither it nor the
`test-cases-review` gate (`advanceState` / `markInReview`) ever moves `currentStep` away from
`ready-for-build`. So implementation and test-case authoring run at the same time; the epic is
`ready-for-build` the moment the **stories** gate passes, whether or not test cases are done. (For an old
epic seeded before this step existed, `stories-review` → `ready-for-build` with no test-cases track —
unchanged.)

### Authoring branches

Each front **authoring** step opens its own git branch at the start of the step, named
`<step>/EP-<slug>` where `<step>` ∈ `analysis | epic | architecture | ui-design | stories | test-cases`
(`config.yaml` `defaults.front_authoring_branch`). This is **distinct** from the review branch
`review/EP-<slug>/<artifact-base>` that `yad-hub-bridge` opens later for the review PR/MR.

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

`source: "bridge"` marks an approval synced from a hub review PR/MR by `yad-review-gate action: sync`
(via `yad-hub-bridge`). Manual approvals omit `source` and are never altered by `sync`.

## `comments.json`
Append-only ledger (an array), the machine-readable counterpart to the `reviews/*--comments.md` markdown
("who reviewed/commented", as `approvals.json` is "who approved"). Written by `yad-review-gate`'s
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

## `design-links.json`
Present only when the `ui-design` step materialized the design in a connected design tool
(`yad-connect-design` → `.sdlc/design.json`). Written by `yad-ui`, the machine-readable screen→frame map
(sibling of `contract-lock.json`; the locked `state.json` step shape is untouched). The `ui-design` step
chain is unchanged — this is an *output enrichment*, mirrored by the `design:` frontmatter block and the
`## Design (<tool>)` section in `ui-design.md`. Absent when the step ran markdown-only (`design: none`).

```json
{ "tool": "figma", "fileUrl": "<url>", "generatedAt": "<YYYY-MM-DD>", "direction": "generated|linked",
  "screens": [ { "name": "<screen>", "platform": "mobile|web", "nodeId": "<id>", "url": "<frame url>" } ],
  "source": "<mcp id>" }
```

## `test-links.json`
Present only when the `test-cases` step materialized automation in a connected testing tool
(`yad-connect-testing` → `.sdlc/testing.json`). Written by `yad-test-cases`, the machine-readable
case→test map (sibling of `contract-lock.json` / `design-links.json`; the locked `state.json` step shape
is untouched). The `test-cases` step chain is unchanged — this is an *output enrichment*, mirrored by the
`testing:` frontmatter block and the `## Automation (<tool>)` section in `test-cases.md`. Absent when the
step ran artifacts-only (`testing: none`).

```json
{ "tool": "playwright", "suite": "<url/path>", "generatedAt": "<YYYY-MM-DD>", "direction": "generated|linked",
  "tests": [ { "case": "<id>", "story": "EP-<slug>-S0N", "repo": "<name>", "level": "unit|integration|e2e", "path": "<test path>", "url": "<url>" } ],
  "source": "<mcp id>" }
```

## `reviews/`
Human-readable review records, one file per round:
`reviews/<artifact-base>--<YYYY-MM-DD>--<status>.md` where `status` ∈ `comments` | `approved`
and `<artifact-base>` is the artifact without extension (e.g. `epic`, `architecture`, `stories-S01`).

## Dial defaults & locks
- Every step defaults to `automation: human_approve` (build plan §2).
- The five authoring front steps and their reviews are `locked: true` — the engine refuses to set
  them to `machine_advance` in this version (build plan §1, §8.7). Only back states (build pipeline,
  steps 9–14) may move toward machine-advance in a later iteration.

---

# Phase 4 build-half state (the back half made dial-bearing)

Phase 3 recorded build progress only *after the fact* in `build-log.json`. Phase 4 needs the back
steps to carry their own `automation` dial so the orchestrator (`yad-run`) can read it and decide
whether to advance on its own. Two new files under `.sdlc/` do this.

> **Who commits these.** `build-state/<story-id>.json`, `trust-log.json`, and `build-log.json` are
> **machine-written** by the back half (`yad-run`, `yad-engineer-review`) and committed by
> **`yad checkpoint`** — the back-half analogue of the front-half `yad gate ci` sync. It lands them as
> one `chore(hub): sync back-half state — <epic>/<story> by @<login>` audit-trail commit, on the
> default branch, staging **only** these three ledgers by an explicit allowlist (never a front-half
> gate file — `state/approvals/comments/hub-prs.json`, `reviews/*.md` — so `ledger-guard` never trips).
> Teammates don't review these machine writes; the commit exists so CI, `yad status`, and other
> machines always see current trust evidence.

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
| `status` | `blocked` \| `in_progress` \| `in_review` \| `done` | Lifecycle. `yad-run` advances `done` steps and `blocked`s on a halt. |

`currentStep` is the `id` the orchestrator is waiting on / about to run for that repo. The file is
created when a story enters the build half; all dials start `human_approve` (the `config.yaml`
`automation.default`).

`yad next` reads these files too: once an epic is `ready-for-build`, `yad next <epic>` resolves each
story/repo's `currentStep` into the next build sub-step (`spec`/`tasks` → `yad-spec`, `implement` →
`yad-implement`, `checks` → `yad-checks`, `engineer-review` → `yad-engineer-review`) and prints it with
the remaining chain and the step's automation dial — so the build half is guided, not just hinted at.

## `trust-log.json` (shard-then-fold)
Append-only ledger, the back-half analogue of `approvals.json`. **This is the evidence base** that
decides when a step is safe to automate (build plan Step A). One entry per step run.

**Storage — loose shards + a folded file (the "loose objects + `git gc`" model).** Two people driving
different stories of the same epic used to both append to one `trust-log.json` → a git merge conflict on
push. So each writer now writes ONE small shard file per entry under a shard dir, and readers union it
back:
- **Shard dir & name:** `epics/<epic>/.sdlc/trust-log/<story>-<repo>-<step>-<uid>.json` — each file is
  ONE trust entry object. `uid` is a short unique token the writer generates fresh per run (never
  reused), so re-runs of the same `(story, repo, step)` stay distinct files → concurrent writers touch
  different files → zero conflict by construction.
- **Folded file:** `epics/<epic>/.sdlc/trust-log.json` = `{ "epic": "<id>", "runs": [ <entry>, … ] }`
  (also the legacy single-file layout, and the output of `yad tidy up`).
- **Union-read rule:** to read the ledger, take the folded file's `runs` array PLUS every file in the
  `trust-log/` shard dir, and **concatenate** — every entry is a distinct run and the trust threshold
  counts re-runs, so **never dedup by `(story, repo, step)`**. (The only guard: a shard whose FULL
  identity `(story, repo, step, uid)` already appears in the folded `runs` is a half-applied tidy and is
  skipped — keying on `uid` alone would wrongly drop a different run that happened to reuse a token.) A legacy epic with only
  the folded file and no shard dir still reads correctly — nothing to union.
- **`yad tidy up`** (manual, one person) folds a SHIPPED story's finished shards into the folded file's
  `runs` and deletes them. Writers never fold — they only add shards; `yad checkpoint` commits the shard
  dir, and `yad tidy up` is the back-half analogue of `git gc` folding loose objects.
- The **threshold slice** (below) reads this same union, filtered to the step (and repo).

```json
{
  "story": "EP-<slug>-S0N",
  "repo": "backend",
  "step": "checks",
  "uid": "<short-unique-token>",
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
| `uid` | short unique token | Generated fresh per run (never reused) — makes each shard file and each re-run distinct; also the folded/loose de-dup guard. Legacy folded entries may lack it. |
| `automation` | dial in force at run time | So the log shows whether the run was a manual or an automated advance. |
| `verdict` | `approved-unchanged` \| `approved-with-edits` \| `rejected` | The trust signal. **Provisional verdict is derived** (below); the human gate for that step confirms or overrides it and finalizes the entry. |
| `signals` | object | The raw inputs the provisional verdict was derived from. The fields present depend on the step (table below). |
| `ranBy` | `machine` \| `human` | Whether the orchestrator advanced it or a human did. |

**Per-step `signals` fields** (only the relevant ones are set; others may be omitted or `n/a`):

| Step | Signals | Finalized at (the human gate) |
|------|---------|-------------------------------|
| `spec` | `human_edited_spec` | the human who accepts `specs/<story>/` (`yad-spec` Step 8) |
| `tasks` | `task_rescoped` | first consume by `yad-implement` (Step 8) |
| `implement` | `human_edited_diff`, `scope_overrun`, `contract_touch` | engineer review at `yad-engineer-review` |
| `checks` | `checks` (`pass`\|`fail`) | the gate run itself (objective) |

**Deriving the provisional verdict** (build plan Step A; extended for `spec`/`tasks` in Phase 4b — the
same three-way shape, anchored to each step's human gate, never self-graded):
- any check FAIL, scope overrun, contract-surface touch, or a discarded/regenerated artifact → `rejected`;
- accepted after a human edited the output (`human_edited_diff` / `human_edited_spec` / `task_rescoped`) → `approved-with-edits`;
- accepted as produced → `approved-unchanged`.

**Trust threshold** (from `config.yaml` `automation.trust_threshold`): a step is a candidate for
`machine_advance` only when its slice of the trust ledger — the **union** of the folded `trust-log.json`
`runs` plus every `trust-log/` shard, filtered to the same `step` (this story's repo or the project) —
has `>= min_runs` entries AND the fraction with `verdict == "approved-unchanged"` is
`>= min_approved_unchanged`. The dial-setter in `yad-run` enforces this; `yad-status` surfaces it.

## `build-log.json` (shard-then-fold)
The build ledger records one ship per merged task. Its schema and the ship record's fields are
documented authoritatively in `../../yad-engineer-review/references/ship-and-record.md`; only its
storage layout is noted here (it mirrors `trust-log.json`):
- **Shard dir & name:** `epics/<epic>/.sdlc/build-log/<story>-<task>-<repo>.json` — each file is ONE
  ship object. `(story, task, repo)` is already a natural unique key, so no `uid` is needed.
- **Folded file:** `epics/<epic>/.sdlc/build-log.json` = `{ "epic": "<id>", "ships": [ <ship>, … ] }`
  (also the legacy single-file layout, and the output of `yad tidy up`).
- **Union-read rule:** union the folded `ships` with every `build-log/` shard, **deduping by
  `(story, task, repo)`** — a shard WINS over a stale folded ship (so a `yad review reconcile` edit to a
  ship's shard is authoritative until it is folded).
- `yad checkpoint` commits the shard dir; `yad tidy up` folds a shipped story's finished shards into the
  folded file (loose objects + `git gc`).

---

# Phase 6 — feature threads (post-lock change management)

After the contract locks and code ships, a change must not **mutate** a locked artifact (that destroys
the lock + the audit trail). Instead every change request becomes a **new epic, threaded to its parent**
(`config.yaml` `change:`). A feature is a **thread** of linked epics (genesis → change → defect → …); a
change-epic **inherits** unchanged front artifacts from its parent by reference and only **re-authors**
what it changes. So artifacts are never stale, only *superseded*; the feature's current truth is the
head of the thread, composed by the resolver (`yad-timeline`). `yad-change` seeds a change-epic;
`yad-defects` / `yad-timeline` render the thread; `yad-reconcile` flags drift; three CI gates enforce it.

## Lineage frontmatter (added to `epic.md`)

An enrichment block on `epic.md` — like the `design:` / `testing:` blocks, it does **not** change the
locked `state.json` step shape. Genesis epics are backfilled once with `kind: feature`, `thread: <self>`.

| Field | Values | Meaning |
|-------|--------|---------|
| `kind` | `feature` \| `change` \| `defect` \| `hotfix` | Genesis is `feature` (default when absent). |
| `thread` | `EP-<genesis>` | Stable thread id = the genesis epic's id (never renamed → stablest anchor). A **derived cache** — the authoritative thread is `parent` walked to the root; a mismatch is detectable corruption (`yad doctor`). Genesis: `thread == id`. |
| `parent` | `EP-<slug>` | The immediate predecessor epic. **Absent ⇔ `kind: feature`.** |
| `inherits` | subset of `[epic, architecture, contract, ui-design, stories, test-cases]` | Artifact bases carried **by reference**, not re-authored. The rest are re-authored in this epic. |
| `supersedes` | `[EP-<slug>-S0N, …]` | Optional — specific parent story IDs this epic replaces in the head. |
| `origin` | `production` \| `staging` \| `qa` \| `review` | **defect/hotfix only.** Where the defect was found. |
| `severity` | `sev1` … `sev4` | **defect/hotfix only.** |
| `escape_stage` | an SDLC stage id (`stories`, `test-cases`, `architecture`, …) | **defect/hotfix only.** The gate that *should* have caught it — feeds the `yad-defects` quality report. |
| `root_cause` | short tag | **defect/hotfix only.** e.g. `missing-negative-test`. |
| `stub` | `backfill-pending` | **stub genesis only** (`yad-stub`). A brownfield feature anchored so a change can thread off it before it is documented. Cleared by `yad-backfill promote`. |
| `verified` | `true` \| `false` | `false` on a stub genesis (not yet documented/human-authored); `yad-backfill promote` sets it `true`. Absent ⇒ treated as a normal (verified) epic. |

## Stub genesis epics (brownfield anchors — `yad-stub`)

In a brownfield repo not every already-built feature has an epic, so a defect/change has no parent to
thread from (`yad-change` requires one; `lineage-check` rejects a missing parent). `yad-stub` mints the
smallest **real** node — a **stub genesis epic** — so the bug can be captured now and formalized later.

A stub is a normal genesis (`kind: feature`, `thread == id`, no `parent`) whose `epic.md` carries
`stub: backfill-pending` + `verified: false` and whose `state.json` uses a **sentinel**, mirroring
`EP-discovery` / `discovery-done`:
- top-level `kind: "stub"` and `currentStep: "backfill-pending"`;
- the **same 10-step front chain** as a normal epic, every step `status: "blocked"` (so `validateState`
  passes and `promote` can "wake" the chain into normal authoring with no re-seed);
- empty `approvals.json` / `comments.json`; **no** `contract-lock.json` (no surface locked yet).

`nextAction` routes a stub to a `backfill-pending` action (`yad-backfill` → `yad-backfill promote`), never
to authoring. A change threaded off a stub inherits only what exists — the undocumented surface bases are
marked `inherited: true` with `boundHash: null` (the gate predicate reads `null` as "nothing locked → no
drift → pass"), no pointer-lock is written, and `change.json` records `parentStub: true`.

**The stub invariant (two files, kept in lockstep).** A stub is encoded in *both* `epic.md`
(`stub: backfill-pending`) *and* `state.json` (top-level `kind: "stub"` + `currentStep:
"backfill-pending"`), because two readers use different sources: `isStubEpic` / `yad thread` / `yad-status`
read the frontmatter, while `nextAction` / `yad next` is pure-ledger and reads `state.json`. So:

> **A stub ⟺ `epic.md stub:backfill-pending` AND `state.kind:stub` AND `currentStep:backfill-pending`.**
> Any promote MUST clear all three atomically, or the two readers disagree.

`yad-backfill promote` enforces this: it sets `epic.md` `verified: true`, removes `stub:`, links the
approved backfill spec, **and** rewrites `state.json` — removing `kind: "stub"` and moving `currentStep`
off the sentinel:
- **light promote (default)** → `currentStep: "backfill-done"`, a **terminal sentinel** (like
  `discovery-done`): the feature is a real, verified anchor documented by its backfill spec; `nextAction`
  reports "documented anchor — evolve it by threading a change/defect", never a pending stub, and no build
  half runs directly against it;
- **full promote (opt-in)** → `currentStep: "epic"`, `epic.status: "in_progress"`, to run the normal front
  half and lock a real contract.

From promotion on, the thread's contract protection is live.

## Inherited steps in `state.json`

A change-epic's `state.json` is structurally identical (so `advanceState` / `nextAction` / `gatePredicate`
/ the bridge run unchanged), but **inherited** steps are pre-marked `done` with two extra fields, and
only re-authored steps run. The seeder sets `currentStep` to the first re-authored step.

```json
{ "id": "architecture", "type": "author", "artifact": "architecture.md",
  "assistance": "review", "automation": "human_approve", "locked": true,
  "status": "done", "inherited": true, "inheritedFrom": "EP-istifta-inquiries",
  "boundHash": "sha256:…", "risk_tags": [] }
```

- `inherited` — `true` when this step's artifact is taken by reference from the thread (not authored here).
- `inheritedFrom` — the epic in the thread that owns the referenced artifact.
- `boundHash` — the artifact's hash at inherit time (contract surface hash for `architecture`; the
  `storiesHash`/file hash for others). The gate predicate short-circuits an `inherited` step as
  **satisfied** iff `boundHash` still equals the thread's current hash for that artifact — always true,
  since the artifact lives in the parent and can't be edited from the child, so inherited steps never
  block and are never re-reviewed.

`approvals.json` gets a **provenance** record per inherited gate (not a forged approval):

```json
{ "artifact": "architecture.md", "step": "architecture-review", "status": "inherited",
  "from": "EP-istifta-inquiries", "boundHash": "sha256:…", "date": "<YYYY-MM-DD>" }
```

## The pointer-lock — `contract-lock.json` in a change-epic

When `architecture` is inherited, the seeder writes a **derived** `contract-lock.json` carrying the
parent's hash **verbatim** so `contract-check.sh` (which reads only `hash`) passes unchanged. There is
no `contract.md` in the child to edit, so the surface physically cannot drift.

```json
{ "artifact": "contract.md", "hash": "sha256:<parent hash, verbatim>", "lockedAt": "<date>",
  "inheritedFrom": "EP-istifta-inquiries", "ref": "../../EP-istifta-inquiries/.sdlc/contract-lock.json" }
```

Omitting `architecture` from `inherits` (depth `contract-surface`) is what triggers a **real re-lock**:
`yad-architecture` re-authors `contract.md`, computes a **new** hash, and `architecture-review` carries
`risk_tags: ["contract"]` → the usual domain-owner escalation. This unifies "route back to the
architecture gate" with "open a contract-surface change-epic" — one mechanism, not two.

## `change.json`
Intake + triage record, one per change/defect/hotfix epic (sibling of `approvals.json`).

```json
{ "epicId": "EP-istifta-queue-filter", "thread": "EP-istifta-inquiries", "parent": "EP-istifta-inquiries",
  "kind": "defect", "depth": "defect-fix", "intakeBy": "alice", "intakeDate": "<YYYY-MM-DD>",
  "title": "Pending queue returns answered inquiries", "description": "…",
  "affectedArtifacts": ["stories", "test-cases"],
  "reauthors": ["stories", "test-cases"], "inherits": ["epic", "architecture", "contract", "ui-design"],
  "defect": { "origin": "production", "severity": "sev2", "escape_stage": "test-cases",
              "root_cause": "missing-negative-test" },
  "hotfix": null }
```

`depth` ∈ `defect-fix | behavioral-no-surface | contract-surface | new-capability` (`config.yaml`
`change.depths`). `defect` is `null` for a plain `change`; `hotfix` is `{ "shipFirst": true }` only for
a `hotfix`. `parentStub: true` is added when the epic threads off an un-promoted stub genesis
(`yad-stub`) — a brownfield feature not yet documented, so no contract surface is inherited yet.
Thread-level rollups (`yad-timeline` / `yad-defects`) are **derived** — walk every epic
sharing `thread` and read each `change.json`; there is no duplicated thread registry.

## `reconcile-debt.json`
Append-only ledger of hotfix ship-first debt (a hotfix shipped code before its front gates approved).

```json
[ { "thread": "EP-istifta-inquiries", "epicId": "EP-istifta-hotfix-x", "openedDate": "<date>",
    "reason": "prod outage", "requires": ["artifacts-updated", "regression-test"],
    "status": "open", "paidDate": null, "paidBy": null,
    "evidence": { "artifacts": [], "regressionTest": "" } } ]
```

`status: "open"` blocks the **next** normal change on the thread (`reconcile-debt-check.sh`) until it is
`"paid"` (evidence: the front artifacts updated **and** a regression test added). The debt lets a hotfix
jump the queue once, but freezes new thread work until the SDLC again describes production.
