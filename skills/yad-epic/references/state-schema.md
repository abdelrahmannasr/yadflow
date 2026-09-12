# `.sdlc/` state schema

All SDLC state lives in plain files under `epics/EP-<slug>/.sdlc/` (build plan §1: "All state lives
in files on disk. Nothing hidden."). No database, no browser storage.

## Every file states its shape — `schemaVersion`

Each JSON **object** the CLI writes under a `.sdlc/` directory carries a `"schemaVersion"` as its
first key, holding the shape this release writes — **6** today. It says what shape the file is in, so
a future release can recognise an older file and upgrade it instead of guessing.

**When you author one of these files by hand, include the key**, exactly as the examples below show.
Several kinds here — `state.json` on the seeding path, `change.json`, `contract-lock.json`,
`build-state/<story-id>.json`, `design-links.json`, `test-links.json` — are written by skills, not by
the CLI. `state.json` is the one both write, so omitting the key there makes the file flip between two
byte forms: the skill writes it without, the next `yad gate sync` adds it back. Write it and there is
nothing to flip.

```json
{
  "schemaVersion": 6,
  "epicId": "EP-checkout"
}
```

Three rules go with it, and they are permanent (`docs/roadmap-idea-1.md`, Part 2):

1. **A file with no version counts as version 1.** Nothing has to be rewritten to be readable. Files
   written before the stamp existed are read as shape 1, and get the key the next time the engine
   writes them.
2. **The four list files never carry it.** `approvals.json`, `comments.json`, `hub-prs.json` and
   `reconcile-debt.json` are JSON arrays at the top level, and an array cannot hold a key. Rule 1
   covers them: no version means version 1.
3. **`schemaVersion` is not the CLI version.** `.sdlc/cli-version.json` records which release of the
   `yad` CLI set the project up, and changes on every release. `schemaVersion` describes the file's
   shape and changes only when that shape really changes — which is rare, and always paired with a
   `yad migrate` step that moves existing projects onto it.

## `state.json`
The per-epic state machine.

| Field | Meaning |
|-------|---------|
| `epicId` | The stable `EP-<slug>` ID. Never renamed. |
| `createdAt` | ISO date the epic was created. |
| `type` | The work-item type — `feature` \| `change` \| `defect` \| `hotfix` \| `chore` — copied from `epic.md`. Shape 5 on. **Not the same field as `steps[].type`**, which is `author` \| `review+approve`, and not the same as the top-level `kind` a stub or the discovery front-zero carries. |
| `profile` | The lifecycle route this chain came from — `classic` \| `analysis-first` \| `discovery`. Shape 6 on. See "Lifecycle profiles" below. |
| `currentStep` | `id` of the step the workflow is waiting on right now. |
| `steps[]` | Ordered list of every Shape step step. |

Each `steps[]` entry:

| Field | Values | Meaning |
|-------|--------|---------|
| `id` | `analysis`, `analysis-review`, `epic`, `epic-review`, `architecture`, `architecture-review`, `ui-design`, `ui-design-review`, `stories`, `stories-review`, `test-cases`, `test-cases-review` | Step identity. |

### The step catalogue

Every one of those ids is defined in **one place in the code** — `STEPS` in `cli/epic-state.mjs` (E4).
A row says which phase the step is in, whether it authors an artifact or gates one, which file it
writes, which skill runs it, and — for a gate — which step it reviews. The phase table, the skill
tables and the Build order are all views of it, held to it by tests, so a step cannot exist in one and
be missing from another.

The catalogue is code. Nothing about it is written into `state.json`, so no file shape changed.

**The one column a project overrides is the skill.** Which skill runs a step is not a fact about the
lifecycle — it depends on what a team installed — so it lives in `.sdlc/skills.json`, a Product-level
file the engine reads before it falls back to the catalogue (E6):

```json
{ "schemaVersion": 6, "steps": { "architecture": "our-arch-skill", "stories": ["shape-it", "yad-stories"] } }
```

A value may be one skill or a list; a list runs as a **chain**, in order, each skill seeing what the
one before it produced, and the last output is the artifact. Write it with `yad skill bind <step>
<skill>…` (`yad skill list` shows what runs each step now, `yad skill unbind <step>` drops the line).
Nothing checks the skill NAME — the engine cannot know what you installed — but `yad doctor` reports a
binding that will never run: a value that is not a skill name (`YAD-CFG-006`), a step id this release
does not know (`skills:unknown-step`) and a review gate, which `yad gate` drives (`skills:review-step`).
It never rewrites the file.

**When a chain disagrees with the catalogue, the chain wins.** `yad-discovery` and `yad-change` still
write a chain by hand, a project may run a chain from a newer release, and leaving a step out is normal
— not every epic has screens. `yad doctor` reports five disagreements it can see and rewrites nothing:
`step:artifact` (a step naming a different file from the one the gate hashes — different spellings of
the SAME artifact are fine, since `stories`, `stories/` and `stories.md` are one gate),
`step:no-artifact` (a step naming no file at all, the one case that stops `yad gate` outright),
`step:kind` (a step on the wrong side of the author / review line), `step:orphan-gate` (a gate whose
step is not in the chain, so nothing tells anyone to write what it reviews) and `step:off-route` (a
chain matching no lifecycle profile — see below). `skip:not-optional` is reported the same way: a step
marked N/A that this epic's route does not mark optional. An id the catalogue does not carry is left to
`phase:unknown`.

### Lifecycle profiles

A **profile** is a named, ordered chain of catalogue steps — the route an epic takes. Three are
defined, in `LIFECYCLE_PROFILES` (`cli/epic-state.mjs`, E5), and all three are routes the skills
already seeded by hand:

| Profile | Steps | Seeded by |
|---|---|---|
| `classic` | the 10-step chain, `epic` first | `yad-epic`, `yad-stub`, `yad-change` |
| `analysis-first` | the 12-step chain, `analysis` before `epic` | `yad-analysis` |
| `discovery` | `discovery` · `discovery-review` | `yad-discovery` |

`ui-design` and its gate are the optional pair in both feature routes. **Which steps an epic may skip
comes from the route that epic is on**, and from nowhere else (E35): there is no engine-wide list of
skippable steps, so a route that drops a step no longer makes it skippable on every other route too.
An epic whose chain is on **no** route has nothing optional — `yad doctor` reports that chain as
`step:off-route`, and guessing a route to answer the question would let a step be skipped on the
strength of a route nobody chose.

The parallel, non-blocking `test-cases` track is NOT recorded in the profile: `advanceState` still
decides it from the step id, and a second copy of that rule sitting unread in the profile would be
free to drift.

**Each epic records its route in `state.json` as `profile`** (shape 6). The value is one of `classic`,
`analysis-first` and `discovery`. `yad epic new` writes it when it seeds the chain, the seeding skills
write it in their templates, and `yad migrate` fills it in for an epic that predates the field by
reading the chain that epic already carries.

The chain is still the truth. The recorded name says which route the epic was STARTED on; matching the
chain (`matchLifecycleProfile`) says which route the steps are on NOW, and `yad doctor` compares them:

| Check | Fires when |
|---|---|
| `profile:unknown` | `profile` holds a value that is not one of the three |
| `profile:disagree` | the chain is cleanly on a route, and it is not the one recorded |
| `step:off-route` | the chain is on no route at all — a step no route has, or two out of order |

A chain missing steps still matches — dropping `ui-design` is normal. An epic whose chain matches
nothing gets NO `profile` key from the migration: inventing one would silence `step:off-route` by
making the file agree with itself.

> **Two different things are called a profile.** This one is the lifecycle route. `hub.json.profile` is
> the unrelated setup record `yad setup` writes: `{ codebase, repo_layout, team_size }`.

### The six phases

Every step belongs to one of six named phases, and each phase sits inside one of the three parts:

| Phase | Part | Steps |
|---|---|---|
| Discover | Shape | `discovery` · `analysis` · `epic`, each with its review gate |
| Design | Shape | `architecture` · `ui-design`, each with its review gate |
| Plan | Shape | `stories` · `test-cases`, each with its review gate |
| Build | Build | `spec` · `tasks` · `implement` · `checks` · `engineer-review` |
| Release | Run | **planned, not built** |
| Operate | Run | **planned, not built** |

**A phase is never written into `state.json`.** It is worked out from `currentStep`, so there is
nothing to author, nothing to keep in step, and no way for it to disagree with the step it describes.

- A Shape review gate takes the phase of the artifact it reviews, so `epic-review` is Discover beside
  `epic`. Build steps have no such gates — `engineer-review` is a step in its own right — so
  `checks-review` is not a step and resolves to nothing.
- The `currentStep` markers are not steps and never appear in `steps[]`. Three of them
  (`backfill-pending`, `backfill-done`, `discovery-done`) have no phase. **`ready-for-build` is the
  exception:** an epic sitting on it is in Build, and stays there for the rest of its life, because
  the individual Build steps live per story per repo in `build-state/` rather than in this file.
- `EP-discovery` has no phase at all. It is the product-level front-zero and does not walk the feature
  lifecycle.

`yad doctor` reports a step id no phase claims. That is the same table that binds a step to its skill,
so an id with no phase is an id no skill runs.

### Two valid chain shapes (analysis is optional)

The `analysis` step (and its `analysis-review` gate) is **optional** — it exists only when the team
ran `yad-analysis` before the epic. The entry-point skill (whichever runs first) assigns `EP-<slug>`
and runs **`yad epic new`**, which writes `state.json` and the empty ledgers; the other skill sees an
existing `state.json` and does **not** re-seed.

**The engine owns the chain.** No skill writes one by hand on these two routes any more — `yad-epic`
runs `yad epic new EP-<slug>`, `yad-analysis` runs it with `--profile analysis-first`, and `yad-stub`
runs it with `--stub`. Two seeds are still hand-written and neither is an oversight: `yad-discovery`
seeds the product front-zero, and `yad-change` seeds a threaded chain whose inherited steps are bound
to a parent's artifact hashes. A seeded chain leaves its first author step **open**, not `done` — the
command runs before the artifact exists; `yad gate open` closes it when the gate opens.

- **With analysis** — the `analysis-first` route, 12 steps:
  `analysis → analysis-review → epic → epic-review → architecture → architecture-review → ui-design →
  ui-design-review → stories → stories-review → test-cases → test-cases-review`. Seeded `currentStep`
  is `analysis`, which starts `in_progress`; everything after it starts `blocked`.
- **Without analysis** — the `classic` route, 10 steps, and the default:
  `epic → epic-review → … → stories-review → test-cases → test-cases-review`. Seeded `currentStep` is
  `epic`, which starts `in_progress`.

Both seeded values move to the review gate when `yad gate open` runs, which is also what closes the
authoring step. Before E17b the seeds recorded the gate directly, because a skill only seeded once it
had already written the artifact; a chain seeded that way is still perfectly valid and nothing rewrites
it.

`analysis-review`, `ui-design-review`, and `test-cases-review` carry no `risk_tags` (base rule:
owner + 1 reviewer).

### `ui-design` is optional (skippable)

Optional **on the routes that say so**, which today is every feature route — see the profiles section
above. The step (and its `ui-design-review` gate) is optional for an epic with no
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
strips the fields and restores the chain, refused once `stories-review` has opened. `ui-design` is the
only step any route marks optional today; the engine reads that off the epic's own route
(`optionalStepsFor`) rather than from a list of its own.

### `test-cases` is a parallel, non-blocking track

`test-cases` (and its `test-cases-review` gate) sit in `steps[]` after `stories-review`, but they are a
**parallel track that does not gate Build**. When `stories-review` passes, `advanceState`:
- sets `currentStep` to the **`ready-for-build`** sentinel — so Build (`yad-spec` → … keyed off
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
(`config.yaml` `defaults.shape_authoring_branch`). This is **distinct** from the review branch
`review/EP-<slug>/<artifact-base>` that `yad-hub-bridge` opens later for the review PR/MR.

The shared procedure (run once the `EP-<slug>` is known):
1. **Git-safe / greenfield-safe:** if `{project-root}` is not a git work tree
   (`git rev-parse --is-inside-work-tree` fails), skip branching with a note and author on the current
   tree — no error.
2. Branch name = `<step>/EP-<slug>`. If it already exists, check it out; otherwise create it from the
   Product's default branch (`git checkout -b <step>/EP-<slug>`).
3. Author and commit the step's artifact(s) on that branch. The verified ledger's `review/…` branch is created
   separately at review time and is untouched by this step.

**How the seed reaches the default branch.** The `.sdlc/` ledger is seeded once, by hand, on the
**entry** step's authoring branch (`analysis/…`, `epic/…`, `change/…`, `discovery/…`) — no CLI or CI
path creates one (`yad gate ci` only *advances* an existing chain, at merge, on the default branch).
So for the **first** gate of an epic, cut `review/EP-<slug>/<artifact-base>` from that authoring
branch: the review PR/MR then carries the seed alongside the artifact, and the ledger lands on the
default branch when it merges. In verified mode `ledger-guard` exempts exactly this case — **creation,
not mutation** (#162) — so no direct push to a protected default branch is needed. For every **later**
gate the ledger is already on the default branch: cut the review branch from there, commit the
artifact only, and leave `.sdlc/{state,approvals,comments,hub-prs}.json` and `reviews/*.md` to CI.
| `type` | `author` \| `review+approve` | Authoring step or a team review gate. |
| `artifact` | filename or folder | The file/folder this step produces or gates. |
| `assistance` | `none` \| `review` \| `heavy` | Dial 1 (driver) — who does the work. **The name the engine reads.** |
| `driver` | `human` \| `pair` \| `agent` | Dial 1, shape-4 name, written beside `assistance`: `human`=`none`, `pair`=`review`, `agent`=`heavy`. |
| `automation` | `human_approve` \| `machine_advance` | Dial 2 (advance) — who moves it forward. **The name the engine reads.** |
| `advance` | `human` \| `auto` | Dial 2, shape-4 name, written beside `automation`: `human`=`human_approve`, `auto`=`machine_advance`. A review step is NEVER `auto`. |
| `locked` | `true` \| `false` | Shape steps are `true`: may NOT be set to `advance: auto` in this version. |
| `status` | `blocked` \| `in_progress` \| `in_review` \| `done` | Lifecycle. `blocked` = upstream step not yet approved. |
| `risk_tags` | subset of `contract`, `auth`, `payments` | Drives review escalation (build plan §4). |

## `approvals.json`
Append-only ledger (an array). Each entry:

```json
{ "artifact": "epic.md", "step": "epic-review", "approver": "<name>", "role": "owner|reviewer|domain-owner", "domain": "<repo-or-area, optional>", "status": "approved", "date": "<YYYY-MM-DD>", "source": "<bridge, optional>" }
```

`source: "bridge"` marks an approval synced from a Product review PR/MR by `yad-review-gate action: sync`
(via `yad-hub-bridge`). Manual approvals omit `source` and are never altered by `sync`.

A **bridge** approval carries four more fields, all written by `sync` and all about *what was approved*
rather than *who approved*:

| Field | Meaning |
|-------|---------|
| `artifactHash` | the content fingerprint the approval is bound to (`sha256:…`). The gate drops any approval whose hash ≠ the artifact's current one — this is revoke-on-change. For architecture it is the locked contract surface, for stories the whole `stories/` set. |
| `approvedAt` | when the platform says the review was submitted. Used to tell a genuine re-approval from the same review read again; **absent on GitLab**, which exposes no per-approval timestamp. |
| `pr` | the PR/MR number the approval arrived on. The second proof of a genuine re-approval, and the only one available on GitLab: a re-opened review is always a new PR, so an approval on a different number cannot be the old one re-read. Records written before this field existed are stamped once, from the `hub-prs.json` pointer they were recorded against. |
| `engagement` | `verified` when the approval carried the companion's engagement marker, else `none`. Advisory unless `hub.review.requireEngagement` is on. |

`date` is when the sync **recorded** the approval, not when it was given — it is preserved across an
unchanged re-sync so that re-reading a review never churns the ledger.

## `comments.json`
Append-only ledger (an array), the machine-readable counterpart to the `reviews/*--comments.md` markdown
("who reviewed/commented", as `approvals.json` is "who approved"). Written by `yad-review-gate`'s
`comment` action; feeds the `approved.md` participation roster, not the gate predicate. Each entry:

```json
{ "artifact": "epic.md", "step": "epic-review", "commenter": "<name>", "role": "owner|reviewer|domain-owner", "domain": "<optional>", "round": <n>, "count": <comments this round>, "date": "<YYYY-MM-DD>" }
```

## `hub-prs.json`
Present only when the Shape review runs through the platform bridge. Per review step, the review
PR/MR opened on the Product (sibling of `approvals.json`, so the locked `state.json` step shape is untouched):

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
- Every step defaults to `automation: human_approve` / `advance: human` (build plan §2).
- The five authoring Shape steps and their reviews are `locked: true` — the engine refuses to set
  them to `advance: auto` in this version (build plan §1, §8.7). Only back states (build pipeline,
  steps 9–14) may move toward machine-advance in a later iteration.

---

# Phase 4 Build state (Build made dial-bearing)

Phase 3 recorded build progress only *after the fact* in `build-log.json`. Phase 4 needs the Build
steps to carry their own advance dial so the orchestrator (`yad-run`) can read it and decide
whether to advance on its own. Two new files under `.sdlc/` do this.

> **Who commits these.** `build-state/<story-id>.json`, `trust-log.json`, and `build-log.json` are
> **machine-written** by Build (`yad-run`, `yad-engineer-review`) and committed by
> **`yad checkpoint`** — the Build analogue of the Shape `yad gate ci` sync. It lands them as
> one `chore(hub): sync Build state — <epic>/<story> by @<login>` audit-trail commit, on the
> default branch, staging **only** these three ledgers by an explicit allowlist (never a Shape
> gate file — `state/approvals/comments/hub-prs.json`, `reviews/*.md` — so `ledger-guard` never trips).
> Teammates don't review these machine writes; the commit exists so CI, `yad status`, and other
> machines always see current trust evidence.

## `build-state/<story-id>.json`
One file per story that has entered Build. Build is **per-story, per-repo**, so the
steps live under each repo (mirrors the per-repo shape of `build-log.json`).

```json
{
  "story": "EP-<slug>-S0N",
  "repos": {
    "backend": {
      "currentStep": "checks",
      "steps": [
        { "id": "spec",            "automation": "human_approve", "advance": "human",  "locked": false, "status": "done" },
        { "id": "tasks",           "automation": "human_approve", "advance": "human",  "locked": false, "status": "done" },
        { "id": "implement",       "automation": "human_approve", "advance": "human",  "locked": false, "status": "done" },
        { "id": "checks",          "automation": "machine_advance", "advance": "auto","locked": false, "status": "in_progress" },
        { "id": "engineer-review", "automation": "human_approve", "advance": "human",  "locked": true,  "status": "blocked" }
      ]
    }
  }
}
```

Each `steps[]` entry:

| Field | Values | Meaning |
|-------|--------|---------|
| `id` | `spec`, `tasks`, `implement`, `checks`, `engineer-review` | Build step identity (the `back_steps` from `config.yaml` + the human merge gate). |
| `automation` / `advance` | `human_approve`/`human` \| `machine_advance`/`auto` | Dial 2, written under both names (the OLD one is read). Defaults to `human_approve`; flipped to `machine_advance` only after the trust threshold is met (and never for `locked` steps). |
| `locked` | `true` \| `false` | `engineer-review` is `true` — it never auto-advances (build plan §E). |
| `status` | `blocked` \| `in_progress` \| `in_review` \| `done` | Lifecycle. `yad-run` advances `done` steps and `blocked`s on a halt. |

`currentStep` is the `id` the orchestrator is waiting on / about to run for that repo. The file is
created when a story enters Build; all dials start `advance: human` (`automation: human_approve`) (the `config.yaml`
`automation.default`).

`yad next` reads these files too: once an epic is `ready-for-build`, `yad next <epic>` resolves each
story/repo's `currentStep` into the next build sub-step and prints it with the remaining chain and the
step's advance dial — so Build is guided, not just hinted at. The skill it names comes from
`.sdlc/skills.json` when the project bound one (see "The one column a project overrides is the skill"
above); unbound, the defaults are `spec`/`tasks` → `yad-spec`, `implement` → `yad-implement`,
`checks` → `yad-checks`, `engineer-review` → `yad-engineer-review`.

## `trust-log.json` (shard-then-fold)
Append-only ledger, the Build analogue of `approvals.json`. **This is the evidence base** that
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
  dir, and `yad tidy up` is the Build analogue of `git gc` folding loose objects.
- The **threshold slice** (below) reads this same union, filtered to the step (and repo).

```json
{
  "story": "EP-<slug>-S0N",
  "repo": "backend",
  "step": "checks",
  "uid": "<short-unique-token>",
  "automation": "human_approve", "advance": "human",
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
| `automation` | dial in force at run time (recorded in the OLD vocabulary — this is history, and `yad migrate` deliberately does not rewrite it) | So the log shows whether the run was a manual or an automated advance. |
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
- **Union-read rule (binding on every reader — never read the folded file alone):** union the folded
  `ships` with every `build-log/` shard, **deduping by `(story, task, repo)`** — a shard WINS over a stale
  folded ship (so a `yad review reconcile` edit to a ship's shard is authoritative until it is folded).
  `build-log.json` on its own is only the *folded* half of the ledger: it omits every ship `yad tidy up`
  has not folded, including every `yad checkpoint --retro-ship` backfill, and — because `tidy up` folds
  only a story whose frontmatter is `shipped` — every ship on a story still at `in-build`, indefinitely.
  A reader that skips the union silently under-reports what shipped (#167).
- `yad checkpoint` commits the shard dir; `yad tidy up` folds a shipped story's finished shards into the
  folded file (loose objects + `git gc`). No **ship** path ever appends to the folded file — that is what
  keeps concurrent shippers conflict-free. (`yad review reconcile` does write it, but only to stamp a ship
  already folded there; see `updateShip`.)

---

# Phase 6 — feature threads (post-lock change management)

After the contract locks and code ships, a change must not **mutate** a locked artifact (that destroys
the lock + the audit trail). Instead every change request becomes a **new epic, threaded to its parent**
(`config.yaml` `change:`). A feature is a **thread** of linked epics (genesis → change → defect → …); a
change-epic **inherits** unchanged Shape artifacts from its parent by reference and only **re-authors**
what it changes. So artifacts are never stale, only *superseded*; the feature's current truth is the
head of the thread, composed by the resolver (`yad-timeline`). `yad-change` seeds a change-epic;
`yad-defects` / `yad-timeline` render the thread; `yad-reconcile` flags drift; three CI gates enforce it.

## Lineage frontmatter (added to `epic.md`)

An enrichment block on `epic.md` — like the `design:` / `testing:` blocks, it does **not** change the
locked `state.json` step shape. Genesis epics are backfilled once with `kind: feature`, `type: feature`
and `thread: <self>`.

**The work-item type has two names.** `kind:` is the original and is still the one that is READ;
`type:` is the same value under the name from shape 5 on. **Write both, with the same value.** Writing
`type:` alone on a `change`/`defect`/`hotfix` is the one mistake that breaks something:
`lineage-check.sh` runs inside the code repo, reads `kind:`, finds none, defaults to `feature`, and
stops requiring the `parent:` those three must have. `yad doctor` fails on it (`type:gate-blind`).

| Field | Values | Meaning |
|-------|--------|---------|
| `kind` | `feature` \| `change` \| `defect` \| `hotfix` \| `chore` | The work-item type, under the name that is still read. Genesis is `feature` (default when absent). |
| `type` | the same five values | The same value under the name from shape 5 on. Write it beside `kind`, never instead of it. |
| `theme` | any word or short phrase, in any language, e.g. `checkout-revamp` | **Optional grouping tag.** Puts several epics under one heading. It is what this method has instead of a rung above the Epic: the ladder stays Product → Epic → Story → Task, and grouping is a label rather than a level. No fixed list and nothing to register. **One tag, never a list** — `theme: [a, b]` is read as no theme at all. Spell an existing theme exactly as the other epics do; `yad doctor` reports one theme spelled two ways (`theme:variants`), because two spellings group as two, and a `#` inside the value (`theme:commented`), because the reader keeps the whole rest of the line. Lives only in `epic.md` — there is no copy in `state.json`, so no file shape changed. Read by `yad next` (printed) and `yad thread --json`. |
| `thread` | `EP-<genesis>` | Stable thread id = the genesis epic's id (never renamed → stablest anchor). A **derived cache** — the authoritative thread is `parent` walked to the root; a mismatch is detectable corruption (`yad doctor`). Genesis: `thread == id`. |
| `parent` | `EP-<slug>` | The immediate predecessor epic. **Absent for the genesis types (`feature`, `chore`); required for `change`, `defect` and `hotfix`.** A chore — a dependency bump, a CI move — usually has no feature to hang off, and an invented parent would file it under a feature it has nothing to do with. |
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

A stub is a normal genesis (type `feature` under both names, `thread == id`, no `parent`) whose `epic.md` carries
`stub: backfill-pending` + `verified: false` and whose `state.json` uses a **sentinel**, mirroring
`EP-discovery` / `discovery-done`:
- top-level `kind: "stub"` and `currentStep: "backfill-pending"`;
- the **same 10-step Shape chain** as a normal epic, every step `status: "blocked"` (so `validateState`
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
  reports "documented anchor — evolve it by threading a change/defect", never a pending stub, and Build
  never runs directly against it;
- **full promote (opt-in)** → `currentStep: "epic"`, `epic.status: "in_progress"`, to run the normal Shape
  part and lock a real contract.

From promotion on, the thread's contract protection is live.

## Inherited steps in `state.json`

A change-epic's `state.json` is structurally identical (so `advanceState` / `nextAction` / `gatePredicate`
/ the verified ledger run unchanged), but **inherited** steps are pre-marked `done` with two extra fields, and
only re-authored steps run. The seeder sets `currentStep` to the first re-authored step.

```json
{ "id": "architecture", "type": "author", "artifact": "architecture.md",
  "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true,
  "status": "done", "inherited": true, "inheritedFrom": "EP-checkout",
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
  "from": "EP-checkout", "boundHash": "sha256:…", "date": "<YYYY-MM-DD>" }
```

## The pointer-lock — `contract-lock.json` in a change-epic

When `architecture` is inherited, the seeder writes a **derived** `contract-lock.json` carrying the
parent's hash **verbatim** so `contract-check.sh` (which reads only `hash`) passes unchanged. There is
no `contract.md` in the child to edit, so the surface physically cannot drift.

```json
{ "artifact": "contract.md", "hash": "sha256:<parent hash, verbatim>", "lockedAt": "<date>",
  "inheritedFrom": "EP-checkout", "ref": "../../EP-checkout/.sdlc/contract-lock.json" }
```

Omitting `architecture` from `inherits` (depth `contract-surface`) is what triggers a **real re-lock**:
`yad-architecture` re-authors `contract.md`, computes a **new** hash, and `architecture-review` carries
`risk_tags: ["contract"]` → the usual domain-owner escalation. This unifies "route back to the
architecture gate" with "open a contract-surface change-epic" — one mechanism, not two.

## `change.json`
Intake + triage record, one per change/defect/hotfix epic (sibling of `approvals.json`).

```json
{ "epicId": "EP-checkout-queue-filter", "thread": "EP-checkout", "parent": "EP-checkout",
  "kind": "defect", "type": "defect", "depth": "defect-fix", "intakeBy": "alice", "intakeDate": "<YYYY-MM-DD>",
  "title": "Pending queue returns fulfilled orders", "description": "…",
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
Append-only ledger of hotfix ship-first debt (a hotfix shipped code before its Shape gates approved).

```json
[ { "thread": "EP-checkout", "epicId": "EP-checkout-hotfix-x", "openedDate": "<date>",
    "reason": "prod outage", "requires": ["artifacts-updated", "regression-test"],
    "status": "open", "paidDate": null, "paidBy": null,
    "evidence": { "artifacts": [], "regressionTest": "" } } ]
```

`status: "open"` blocks the **next** normal change on the thread (`reconcile-debt-check.sh`) until it is
`"paid"` (evidence: the Shape artifacts updated **and** a regression test added). The debt lets a hotfix
jump the queue once, but freezes new thread work until the SDLC again describes production.
