# `.sdlc/` state schema

All SDLC state lives in plain files under `epics/EP-<slug>/.sdlc/` (build plan §1: "All state lives
in files on disk. Nothing hidden."). No database, no browser storage.

## Every file states its shape — `schemaVersion`

Each JSON **object** the CLI writes under a `.sdlc/` directory carries a `"schemaVersion"` as its
first key, holding the shape this release writes — **10** today. It says what shape the file is in, so
a future release can recognise an older file and upgrade it instead of guessing.

**When you author one of these files by hand, include the key**, exactly as the examples below show.
Several kinds here — `state.json` on the seeding path, `change.json`, `contract-lock.json`,
`build-state/<story-id>.json`, `design-links.json`, `test-links.json` — are written by skills, not by
the CLI. `state.json` is the one both write, so omitting the key there makes the file flip between two
byte forms: the skill writes it without, the next `yad gate sync` adds it back. Write it and there is
nothing to flip.

```json
{
  "schemaVersion": 10,
  "epicId": "EP-checkout"
}
```

Three rules go with it, and they are permanent (`docs/roadmap-idea-1.md`, Part 2):

1. **A file with no version counts as version 1.** Nothing has to be rewritten to be readable. Files
   written before the stamp existed are read as shape 1, and get the key the next time the engine
   writes them.
2. **The list files never carry it.** `approvals.json`, `comments.json`, `hub-prs.json` (also written
   as `product-prs.json`) and `reconcile-debt.json` are JSON arrays at the top level, and an array cannot hold a key. Rule 1
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
| `profile` | The lifecycle route this chain came from — `classic` \| `analysis-first` \| `chore` \| `spike` \| `discovery` \| `foundation`. Shape 6 on (`foundation` from shape 8). See "Lifecycle profiles" below. |
| `currentStep` | `id` of the step the workflow is waiting on right now. |
| `steps[]` | Ordered list of every Shape step. |

Each `steps[]` entry:

| Field | Values | Meaning |
|-------|--------|---------|
| `id` | `analysis`, `analysis-review`, `epic`, `epic-review`, `architecture`, `architecture-review`, `ui-design`, `ui-design-review`, `stories`, `stories-review`, `test-cases`, `test-cases-review` | Step identity. |
| `type` | `author` \| `review+approve` | Authoring step or a team review gate. |
| `artifact` | filename or folder | The file/folder this step produces or gates. |
| `assistance` | `none` \| `review` \| `heavy` | Dial 1 (driver) — who does the work. **The name the engine reads.** |
| `driver` | `human` \| `pair` \| `agent` | Dial 1, shape-4 name, written beside `assistance`: `human`=`none`, `pair`=`review`, `agent`=`heavy`. |
| `automation` | `human_approve` \| `machine_advance` | Dial 2 (advance) — who moves it forward. **The name the engine reads.** |
| `advance` | `human` \| `auto` | Dial 2, shape-4 name, written beside `automation`: `human`=`human_approve`, `auto`=`machine_advance`. A review step is NEVER `auto`. |
| `locked` | `true` \| `false` | Seeded `true` on every Shape step. Since E34 it decides nothing about the dial on a step the catalogue knows: an author step may be set to `auto` (for the whole project, in `.sdlc/automation.json`), and a review gate is `human` because it is a gate. It is still read as a gate on a step id the catalogue does not know. |
| `status` | one of the **step states** below | Where the step stands. |
| `record` | `{ reason, by, date, link? }` | Present on a `skipped`, `deferred`, `satisfied` or `blocked` step: WHY it is in that state. |
| `closed` | `{ by, date, via, pr?, commit?, hash?, mergedBy?, run?, waived? }` | Present on a `done` step that closed from this release on: HOW it closed (E18). See "Closing records" below. |
| `risk_tags` | subset of `contract`, `auth`, `payments` | Sets the step's full approver count (build plan §4): `contract` +2, `auth`/`payments` +1 on top of a base of 1 (the highest tag, never the sum). Only the base is enforced until the capacity cap (E72); the risk step is advisory and reported as a shortfall. A team gate reports `rule: "count"`. A step with one of these tags has its review PR name and label the epic's `repos`. |

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

**The kill switch and the Shape dials live in `.sdlc/automation.json` (E34)**, also a Product-level file,
also absent by default:

```json
{ "schemaVersion": 10, "kill": { "on": true, "reason": "bad deploy", "by": "al", "date": "2026-09-15" },
  "steps": { "architecture": "auto" } }
```

`kill` is written by `yad kill --reason "<why>"` / `yad unkill`; while `on`, every step is held at
`advance: human`; the record a `yad unkill` or a second `yad kill` replaces is kept as `kill.previous`, one level
deep. `steps` lists the feature Shape AUTHOR steps (not the Foundation's) the project set to `auto` with `yad dial <step> --to
auto` — `human` is the key's absence. A Shape `auto` is **recorded, not acted on**: nothing drives a Shape
step on its own until the engine runs agents (E26). A Build step's dial is not here; it is on its lane in
`build-state`. A review gate is never `auto`. A file that will not parse is read as the kill switch ON,
and nothing writes over it. `yad doctor` reports a broken file (`automation`), an active switch
(`automation:kill`), a gate set to auto (`automation:gate`), a Build step listed here
(`automation:build-step`), an unknown id or value (`automation:unknown`), and a `kill_switch: true` left in
`_bmad/sdlc/config.yaml`, which nothing reads any more (`automation:legacy-kill`).

**When a chain disagrees with the catalogue, the chain wins.** A change-epic seeded by hand before E42
may carry a chain the engine would not write, a project may run a chain from a newer release, and leaving a step out is normal
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

A **profile** is a named, ordered chain of catalogue steps — the route an epic takes. Six are
defined, in `LIFECYCLE_PROFILES` (`cli/epic-state.mjs`, E5). `classic`, `analysis-first` and `discovery`
are routes the skills already seeded by hand; the two short lanes (E40) and `foundation` (E75) came later:

| Profile | Steps | Seeded by |
|---|---|---|
| `classic` | the 10-step chain, `epic` first | `yad-epic`, `yad-stub`, `yad-change` |
| `analysis-first` | the 12-step chain, `analysis` before `epic` | `yad-analysis` |
| `chore` | `epic` · `epic-review` · `stories` · `stories-review` | `yad-epic --profile chore` |
| `spike` | the chore lane with `analysis` · `analysis-review` in front | `yad-analysis --profile spike` |
| `discovery` | `discovery` · `discovery-review` | the OLD spelling of the Product level — still read; `yad migrate --apply` converts it |
| `foundation` | `foundation` · `foundation-review` | `yad foundation new`, then `yad-discovery` authors the sections (E75) |

`ui-design` and its gate are the optional pair on `classic` and `analysis-first`. The short lanes mark
**nothing** optional — they drop the steps they do not need from the chain instead, so `yad skip` on
one is refused outright rather than pointing at a broken chain. **Which steps an epic may skip
comes from the route that epic is on**, and from nowhere else (E35): there is no engine-wide list of
skippable steps, so a route that drops a step no longer makes it skippable on every other route too.
The engine reads the route the epic **records** (`profile`, shape 6), and keeps reading it even when the
chain no longer fits — a chain written by a newer release carries steps this one does not know, and
treating that as "no route" would make a skip the epic already recorded start failing its gate.
`yad doctor` reports the disagreement rather than deciding it. An epic with no route at all — none
recorded that this release knows, and no match from its steps — has nothing optional, because inventing
one would let a step be skipped on the strength of a route nobody chose.

The parallel, non-blocking `test-cases` track is NOT recorded in the profile: `advanceState` still
decides it from the step id, and a second copy of that rule sitting unread in the profile would be
free to drift.

**Each epic records its route in `state.json` as `profile`** (shape 6). The value is one of `classic`,
`analysis-first`, `chore`, `spike`, `discovery` and `foundation`. `yad epic new` writes it when it seeds the chain,
the seeding skills write it in their templates, and `yad migrate` fills it in for an epic that predates
the field by reading the chain that epic already carries.

**`yad migrate` only ever writes `classic`, `analysis-first` or `discovery`.** It answers a question about the past, and
the matching rule picks the SHORTEST route a chain fits — so a chain built only from `epic`,
`epic-review`, `stories` and `stories-review` reads as `chore` now and read as `classic` before. No
chain yadflow has ever seeded is affected, because every shipped seed carries `architecture` and no
short lane has it; the freeze is what makes that a guarantee rather than a fact about today's data. An
epic seeded on a short lane never needs the stamp: `yad epic new` writes its `profile` at seed time.

The chain is still the truth. The recorded name says which route the epic was STARTED on; matching the
chain (`matchLifecycleProfile`) says which route the steps are on NOW, and `yad doctor` compares them:

| Check | Fires when |
|---|---|
| `profile:unknown` | `profile` holds a value no release carries |
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
| Discover | Shape | `analysis` · `epic`, each with its review gate |
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
- The `currentStep` markers are not steps and never appear in `steps[]`. Two of them
  (`backfill-pending`, `backfill-done`) have no phase. **`ready-for-build` is the exception:** an epic
  sitting on it is in Build, and stays there for the rest of its life, because the individual Build
  steps live per story per repo in `build-state/` rather than in this file.
- The **Product level** — `EP-foundation` in `foundation/`, or `EP-discovery`, its older spelling — is
  not on the six-phase ladder. It has a ladder of its own with one phase, **Foundation**, and it is in
  that phase for its whole life, `foundation-done` / `discovery-done` included: the phase is decided by
  the ledger's `kind`, not by the step id (E75).

`yad doctor` reports a step id no phase claims. That is the same table that binds a step to its skill,
so an id with no phase is an id no skill runs.

### Two valid chain shapes (analysis is optional)

The `analysis` step (and its `analysis-review` gate) is **optional** — it exists only when the team
ran `yad-analysis` before the epic. The entry-point skill (whichever runs first) assigns `EP-<slug>`
and runs **`yad epic new`**, which writes `state.json` and the empty ledgers; the other skill sees an
existing `state.json` and does **not** re-seed.

**The engine owns the chain.** No skill writes one by hand on these two routes any more — `yad-epic`
runs `yad epic new EP-<slug>`, `yad-analysis` runs it with `--profile analysis-first`, and `yad-stub`
runs it with `--stub`, and `yad-discovery` runs `yad foundation new` for the Product level (E75). `yad-change`
runs it with `--parent` and `--inherits` for a threaded chain whose inherited steps are bound to the
owning epic's artifact hashes (E42). A seeded chain leaves its first author step **open**, not `done` — the
command runs before the artifact exists; `yad gate open` closes it when the gate opens.

- **With analysis** — the `analysis-first` route, 12 steps:
  `analysis → analysis-review → epic → epic-review → architecture → architecture-review → ui-design →
  ui-design-review → stories → stories-review → test-cases → test-cases-review`. Seeded `currentStep`
  is `analysis`, which starts `in_progress`; everything after it starts `todo`.
- **Without analysis** — the `classic` route, 10 steps, and the default:
  `epic → epic-review → … → stories-review → test-cases → test-cases-review`. Seeded `currentStep` is
  `epic`, which starts `in_progress`.

**The two short lanes.** Not every piece of work is the size of a feature, and before these the only
way to make the chain shorter was to skip steps — which `classic` does not allow, since only
`ui-design` is optional on it.

- **`chore`, 4 steps:** `epic → epic-review → stories → stories-review`. Upkeep somebody has already
  decided on: a dependency bump, a CI move.
- **`spike`, 6 steps:** the same lane with `analysis → analysis-review` in front. A timeboxed
  question, where finding the answer is the work.

Both drop `architecture`, `ui-design` and `test-cases` with their gates, and each is **absent, not
`optional`** — a recorded reason for skipping a step the route never had is noise in the audit trail.
Dropping the architecture gate drops the contract with it: a short-lane epic has no `contract.md` and
no lock, which is the point. **Work that moves the shared cross-repo surface belongs on `classic`,
whatever its size.**

Neither lane drops `epic` or `stories`, and that is not a matter of taste: `epic.md` carries the
work-item type and the `parent:` lineage, and `stories-review` is the step that makes the epic ready
for Build. The type and the route are chosen separately — `--type chore --profile classic` is right
for large upkeep that does touch the contract.

Both seeded values move to the review gate when `yad gate open` runs, which is also what closes the
authoring step. Before E17b the seeds recorded the gate directly, because a skill only seeded once it
had already written the artifact; a chain seeded that way is still perfectly valid and nothing rewrites
it.

Every other review gate — `analysis-review`, `epic-review`, `ui-design-review`, `stories-review` and
`test-cases-review` — carries no `risk_tags`: it needs 1 approval, and its full approver count is 1.

### The step states (shape 7)

`status` is one of eight words. Seven are the model (`docs/roadmap-idea-1.md`, Part 1); `in_review` is
the eighth, and is `in_progress` on a step that is a review gate.

| State | Meaning | Chain continues past it | Artifact written here | Must record |
|-------|---------|-------------------------|-----------------------|-------------|
| `todo` | Not started | no | no | — |
| `in_progress` | Being worked on | no | no | — |
| `in_review` | Its review gate is open | no | no | — |
| `done` | Completed here | yes | **yes** | the artifact |
| `skipped` | Consciously chose not to | yes | no | reason + who + when |
| `deferred` | Will do it, later — `yad defer` | yes | no | reason (saying who waits) + who + when |
| `satisfied` | Done elsewhere | yes | no | link + who + when |
| `blocked` | Cannot proceed, **not our choice** | no | no | who or what we wait for |

Two columns, not one, and the engine reads them through `isPassed` and `isAuthored`
(`cli/epic-state.mjs`). "The chain may continue" and "there is an artifact here to audit" are different
questions: a `skipped` step lets `stories` start and has nothing to hash, so a gate audit skips it
while `preconditionsMet` walks straight past it.

The four states at the bottom carry a `record`:

```json
{ "reason": "backend-only epic, no user-facing surface", "by": "@al", "date": "2026-07-08" }
```

`reason` is required; `by` and `date` are best-effort and may be `null` (attribution is a nicety on the
audit trail, never a gate). A `satisfied` record also carries `link`, naming where the work happened.
`yad doctor` reports a recorded state with no record as `step:no-record`.

### Closing records (E18)

A `done` step says **how it closed**, in its own key, `closed`. It is not `record`: `record` says why a
step is *not* done, and `blocked` is read by whether it has one, so the two never share a key.

```json
{ "id": "architecture-review", "status": "done",
  "closed": { "by": "yad-gate-sync[bot]", "date": "2026-06-08", "via": "merge", "pr": 7,
              "commit": "c0ffee1", "hash": "sha256:…", "mergedBy": "al" } }
```

| Field | Meaning |
|---|---|
| `by` | Who **wrote** the record, as on every record: the platform login `gh`/`glab` reports, else git `user.name` (on CI, usually the bot's git name). Best-effort, may be `null`. |
| `date` | When the step closed: the merge date for a merge, otherwise the day the command ran. |
| `via` | How it closed — see the table below. |
| `pr` | The review PR/MR number, when there is one. |
| `commit` | The merge commit, when the platform reports it. |
| `hash` | The artifact hash the step closed on — the one approvals bind to. |
| `mergedBy` | The platform login that merged the PR, when the platform reports it. |
| `run` | Build lanes only: the `uid` of the trust-log run that moved past the step. |
| `waived` | `solo` on a **review** step that passed while solo mode waived its approvals (E10). Absent when the gate counted approvals, and never on the author step it closes. |

| `via` | Written by | When |
|---|---|---|
| `merge` | `yad gate sync` / `yad gate ci` | A review gate passed on its merge |
| `approved` | the `yad-review-gate` skill, by hand | A review gate passed on recorded approvals on a Product with no platform: nothing merged, so no `pr` or `commit` |
| `review-passed` | `yad gate sync` / `yad gate ci`, or that skill | Its author step, closed when its gate passed because nothing closed it earlier |
| `review-opened` | `yad gate open` (local ledger) / `yad gate sync` | An author step, closed when its review opened |
| `repair` | `yad gate repair` | A stranded author step — an escape hatch, so it says so |
| `auto` / `human` | the `yad-run` skill, in `build-state` | A Build lane step: the dial let the run go on by itself, or it stopped for a person |

- **Optional keys are left out**, never written as `null`: a close with no PR has no `pr`.
- **The first close wins.** A step that already has a `closed` keeps it; a re-sync never rewrites it.
- **Nothing is invented.** A field the closer does not know is left out.
- **Steps closed before this release carry none**, and nothing asks for one: `yad doctor` does not warn.
- **No shape change.** An older release ignores the key, and nothing reads `done` differently because it
  is there.
- `yad gate status` prints it under each review step. An author step's record has no reader yet;
  `yad history` (E20) is the command that will read both.

**`blocked` changed meaning in shape 7.** Before it, every writer used `blocked` for "waiting on an
earlier step" — what is now `todo`. The two are told apart by the record, not by the shape number:

> `blocked` with **no** record is the old word and reads as `todo`.
> `blocked` **with** a record is a real blocker, and the record says on whom.

No release before shape 7 ever wrote a record, so that is exact. The converse is why clearing a blocker
has a verb: `yad unblock EP-<slug> <step>` (E37) moves `status` off `blocked` **and** removes the record
in one write, because deleting only the record would turn the step silently into a `todo`. An author
step whose earlier steps have all passed goes to `in_progress`; anything else, a review gate included,
goes to `todo`. It never touches `build-state/<story>.json`, which the `yad-run` skill writes. On a verified
Product it refuses once the epic's ledger is on the default branch: CI owns `state.json` there and has no
step for it yet.

A status this release does not know is left alone — the file wins — and reported as
`step:unknown-status`. It fails closed: the step counts as neither passed nor authored.

### `ui-design` is optional (skippable)

Optional **on the routes that say so**, which today is `classic` and `analysis-first` — see the
profiles section above. The `chore` and `spike` lanes mark nothing optional, because they drop
`ui-design` from the chain rather than carrying it as skippable. The step (and its `ui-design-review` gate) is optional for an epic with no
user-facing surface — a backend/API service, a data pipeline, infra work. Unlike `analysis` (which is
optional by being **omitted** from the chain at seed time), `ui-design` is **always seeded** and then
**marked N/A in place** so the skip stays visible and auditable. The single mechanism is
`yad skip EP-<slug> ui-design --reason "<why>"` (reverse with `yad unskip EP-<slug> ui-design`, or the
older spelling `yad skip … --undo`), usable at epic-authoring time or any point **up to authoring the
`ui-design` step**. On a verified Product the window is shorter: once the epic's ledger is on the default
branch (its first review PR has merged), `state.json` is CI's alone, and `yad skip`, `unskip`, `defer`,
`undefer` and `unblock` refuse and write nothing. So there, skip `ui-design` before that first PR merges:
right after seeding on `classic`, and during the analysis step on `analysis-first`, whose first review PR
is the analysis review.

When each verb is too late is a rule about the chain, not about `ui-design` (E36):

- **A skip** is refused once the step's review gate has opened (the work is committed by then), or once
  work has started on **any later step**.
- **An un-skip** is refused once work has started on any step **past the step after the pair**. "The
  step after the pair" is the first later step that is not itself skipped — the step the skip opened.
  It may still be under way, and un-skipping pushes it back to `todo` — but not finished: a `done` step
  was written on the assumption the skipped step did not apply, so that refuses too.
- **"Work has started"** means the step is `in_progress`, `in_review` or `done` in this chain. `skipped`,
  `satisfied`, `deferred` and `blocked` are not work done here and never count. A status this release
  cannot name counts as started. A non-step entry after the pair is refused as a malformed chain.

On `classic` and `analysis-first` the step after the `ui-design` pair is `stories`: a skip is refused
once `stories` starts, and an un-skip once `stories` is finished or its review opens.

**`currentStep` on an un-skip.** The restored author step becomes `currentStep` again when every earlier
step has passed — unless the epic **earned** `ready-for-build`: its `stories-review` is `done` (or `satisfied`, reviewed
in the parent epic) and comes before the restored step. That step then runs beside Build, as `test-cases` does, and `currentStep` stays
put. An epic that reached `ready-for-build` only by skipping (a `chore` whose stories pair was skipped by
hand) is moved back to the restored step.

A skipped step is `status: "skipped"` with a `record`, and keeps four legacy fields beside them:

| Field | Values | Meaning |
|-------|--------|---------|
| `status` | `"skipped"` | The step's own state (shape 7). Short-circuited by `gatePredicate` (`rule: "skipped"`) so no review is required. |
| `record` | `{ reason, by, date }` | Why it was skipped, who marked it and when. |
| `skipped` | `true` | The pre-shape-7 spelling, still written and still read (rule 3, add before you remove). |
| `skipReason` | string | Why it was skipped (e.g. "backend-only service, no UI"). |
| `skippedBy` | login/name or `null` | Who marked it N/A (best-effort: the platform login from `gh`/`glab`, else git `user.name`). |
| `skippedAt` | `YYYY-MM-DD` or `null` | When it was marked N/A. |

A pre-shape-7 file spells the same step `status: "done"` with `skipped: true` beside it, and `yad
migrate` translates it. Either spelling reads identically: `stepStatus` treats the flag as a legacy
encoding **only when `status` is `done`** — a `skipped: true` on an unstarted step is a hand edit, and
reading it as finished would let anyone unblock a chain by typing one word into a file.

Both the `ui-design` **and** `ui-design-review` entries carry these fields. `advanceState` steps over
any skipped step, so approving `architecture-review` on a UI-less epic lands directly on `stories`;
`preconditionsMet` treats it as passed (never as authored). `unskipStep` (via `yad unskip`, or
`yad skip … --undo`) strips the fields — the record included — and restores the chain to `todo`,
refused once the step after the pair is finished or a step past it has started (on `classic`, once `stories` is done or `stories-review` opens). `ui-design` is the
only step any route marks optional today; the engine reads that off the epic's own route
(`optionalStepsFor`) rather than from a list of its own.

### Deferring an optional step (`yad defer`)

A step the route marks optional can also be **deferred**: it applies, and the team will do it later.
`yad defer EP-<slug> ui-design --reason "<why, and who is waiting>"` writes this on both the author step
and its `-review` gate:

```json
{ "id": "ui-design", "type": "author", "artifact": "ui-design.md",
  "status": "deferred",
  "record": { "reason": "screens come with the redesign; @design is waiting on it", "by": "@al", "date": "2026-09-14" } }
```

There are no legacy fields: `deferred` was new in shape 7, so no older reader needs them. `by` is who
wrote the record, as on every record. `yad undefer EP-<slug> ui-design` removes the record and puts the
step back.

A deferral follows the skip rules above:

- **Same permission.** Only a route-optional step can be deferred, because the chain continues past a
  deferred step (`isPassed`) with no approvals on its review. The review is not waived, though:
  `gatePredicate` gives a deferred step no short-circuit (E38), so it still reports what is missing, and
  `yad gate status` prints the step as "deferred (still owed)".
- **Same window to set aside.** `yad defer` is refused where `yad skip` is. Putting it back is
  different — see "Picking a deferral up late" below.
- **Same walk.** `advanceState` and the shared skip/defer code (`setAsideStep`, `restoreStep`) step over
  `skipped` **and** `deferred` steps (`isSetAside`). `yad gate open` refuses a set-aside step, and
  `yad sync-status` leaves its artifact's `status:` line alone. A `deferred` status typed by hand onto a
  required step is walked past too, as a hand-typed `skipped` always was; `yad doctor` reports both
  (`skip:not-optional`).
- **Not interchangeable.** Deferring a skipped step, or skipping a deferred one, is refused with the
  command that puts it back first, so neither record is lost.

### Picking a deferral up late (E41)

For a skip, the un-skip window is the meaning: work finished without the step was built on it not
applying, so `yad unskip` is still refused once the step after the pair is finished. A deferral promised
to come back, so `yad undefer` has **no closing window** — except on a verified Product, where it refuses once the epic's
ledger is on the default branch. Before later work has finished it behaves like
`yad unskip`. After it has finished, it **re-opens** the pair behind that work:

| Field | After a late `yad undefer` |
|-------|----------------------------|
| author step `status` | `in_progress` (or `todo` if an earlier step has not passed); `record` removed |
| `-review` gate `status` | `todo`; `record` removed |
| every later step | unchanged |
| `currentStep` | unchanged |
| `debt` | kept, if the deferral carried it |

A late re-open needs later work that is **finished** here. If later work has only started, or holds a
status this release cannot name, `yad undefer` is refused as before. A re-opened step can be deferred
again with `yad defer` (not skipped: the finished work was built without it), so a late undefer is not
a one-way door.

**A re-opened step is read off the chain, never off a flag:** an unfinished step with a later step
**completed here** (`status: "done"`, not inherited, not skipped) that is not its own `-review` gate.
Such a step runs beside the chain, like `test-cases`:

- `preconditionsMet` does not name it the blocker of a step past that finished work. It still blocks
  the steps between itself and that work, its own gate included.
- `markInReview` moves `currentStep` only forward, so opening its review does not pull the chain back.
- `advanceState`, for a gate that passed behind the chain (`currentStep` past it, or `ready-for-build`),
  closes the gate and changes nothing else. In the forward case it walks past every step that has already
  passed — skipped, deferred, inherited (`satisfied`) or `done` — and opens the next one only if it is `todo`.
- `yad next` lists it under `reopened` (JSON) and prints `re-opened lane: …`.

Only `done` counts as finished work. A skipped, deferred or `satisfied` step after an unfinished step is
not work built here, so it never turns that step into a lane.

### Debt on a deferral (`debt: true`, E41)

`yad defer EP-<slug> <step> --reason "<why>" --debt` writes the deferral with one more key on both steps
of the pair:

```json
{ "id": "ui-design", "type": "author", "artifact": "ui-design.md",
  "status": "deferred", "debt": true,
  "record": { "reason": "launch date; @design is waiting on it", "by": "@al", "date": "2026-09-14" } }
```

| Rule | Detail |
|------|--------|
| What it means | owed back — set aside under pressure, and reminded until paid |
| Where it may sit | a `deferred` pair only; `yad skip --debt` is refused, since a skip owes nothing |
| What it changes | nothing about the state: a debt is exactly as passed, and as unauthored, as any deferral |
| Adding it later | `yad defer … --debt` on a step already deferred adds the flag and keeps the record |
| Paying it back | `yad undefer`, early or late; the flag stays on while the step is worked on. Not on a verified Product once the ledger is on the default branch: there a debt cannot be paid back until CI has a step for it |
| Setting it aside again | `yad defer` again keeps the flag; `yad skip` is refused on a step owed as debt, because a skip owes nothing and its review would never run again |
| When it clears | `advanceState` removes it from both steps when the `-review` gate passes — nothing else does |
| Reminders | `yad next` (a warning per debt, a count in the all-epics list, `debt` in JSON), `yad doctor` (`step:debt`, a warn), `yad gate status` ("deferred (still owed, as debt)") |

Step debt is **not** `reconcile-debt.json`. That file is a hotfix's whole change owed back to a feature
thread and is enforced by the `reconcile-debt` CI gate. Step debt is one step of one epic, and it is a
reminder, never a gate.

### `test-cases` is a parallel, non-blocking track

`test-cases` (and its `test-cases-review` gate) sit in `steps[]` after `stories-review`, but they are a
**parallel track that does not gate Build**. When `stories-review` passes, `advanceState`:
- sets `currentStep` to the **`ready-for-build`** sentinel — so Build (`yad-spec` → … keyed off
  `currentStep == "ready-for-build"`) can start **immediately**, and
- opens `test-cases` (`todo` → `in_progress`) so the tester can work **in parallel**.

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

**How the seed reaches the default branch.** The `.sdlc/` ledger is seeded once — by `yad epic new`
(or `yad foundation new` for the Product level) — on the **entry** step's authoring branch (`analysis/…`,
`epic/…`, `change/…`, `foundation/…`, or `discovery/…` for a product level still in its old spelling).
No CI path creates one (`yad gate ci` only *advances* an existing chain, at merge, on the default branch).
So for the **first** gate of an epic, cut `review/EP-<slug>/<artifact-base>` from that authoring
branch: the review PR/MR then carries the seed alongside the artifact, and the ledger lands on the
default branch when it merges. In verified mode `ledger-guard` exempts exactly this case — **creation,
not mutation** (#162) — so no direct push to a protected default branch is needed. For every **later**
gate the ledger is already on the default branch: cut the review branch from there, commit the
artifact only, and leave `.sdlc/{state,approvals,comments,product-prs,hub-prs}.json` and `reviews/*.md` to CI.

## `approvals.json`
Append-only ledger (an array). Each entry:

```json
{ "artifact": "epic.md", "step": "epic-review", "approver": "<platform login>", "status": "approved", "date": "<YYYY-MM-DD>", "source": "<bridge, optional>" }
```

`approver` is the platform login (on a Product with no platform, the name the reviewer gave). The gate
counts distinct approvers and checks no role. An entry with an empty `approver` counts as nobody. An older entry
may still carry `role` and `domain` fields from the removed roster, and name the person by the roster's
name. The gate never reads the role. While the roster is on disk, the next sync write (`yad gate sync`,
`yad gate ci`) records the login on such an entry when the roster places it for certain, removes `role`
and `domain`, and keeps the old name in `rosterName` (E64). Some entries are left as they are — a name two
logins share, or several records that do not prove they are one review (most GitLab role records); see
`yad-hub-bridge/references/login-roster.md`. The dated `approved.md` still prints the roles as recorded.

`source: "bridge"` marks an approval synced from a Product review PR/MR by `yad-review-gate action: sync`
(via `yad-hub-bridge`). Manual approvals omit `source` and are never altered by `sync`, except for the
login recorded on an older entry (above). A manual approval has no `artifactHash`, so an edit to the
artifact does not revoke it.

A **bridge** approval carries more fields, all written by `sync` and all about *what was approved*
rather than *who approved*:

| Field | Meaning |
|-------|---------|
| `artifactHash` | the content fingerprint the approval is bound to (`sha256:…`). The gate drops any approval whose hash ≠ the artifact's current one — this is revoke-on-change. For architecture it is the locked contract surface, for stories the whole `stories/` set. Every file is fingerprinted without its frontmatter `status:` line, which the gate and Build rewrite after review (shape 9); a hash an older release recorded over the whole file is still accepted. |
| `approvedAt` | when the platform says the review was submitted: GitHub's submission time, or GitLab's `approved_at`. Used to tell a genuine re-approval from the same review read again, which needs a time on both sides. A GitLab instance that does not send `approved_at`, and every GitLab record written before E64, hold the day the sync first recorded the approval — a date, which is read as "time unknown" and never compared with a time. Such a record takes the platform's time the next time the same approval is read, and keeps its `artifactHash`. |
| `pr` | the PR/MR number the approval arrived on. The second proof of a genuine re-approval, and the only one available on GitLab: a re-opened review is always a new PR, so an approval on a different number cannot be the old one re-read. Records written before this field existed are stamped once, from the `hub-prs.json` pointer they were recorded against. |
| `commit`, `url`, `reviewId` | the platform's evidence for the review (E64): the commit it was given on, its link, and its node id. GitHub only, and only when the read gave them — never written `null`. An MR approval on GitLab is not tied to a commit, so none is recorded there. For the record only; the gate never reads them. |
| `rosterName` | on an older entry whose login was recorded from the roster (E64), the name it had. The gate lets an exact submission time move such an entry to the person who really submitted that review. |
| `engagement` | `verified` when the approval carried the companion's engagement marker, else `none`. Advisory unless `hub.review.requireEngagement` is on. |

`date` is when the sync **recorded** the approval, not when it was given — it is preserved across an
unchanged re-sync so that re-reading a review never churns the ledger.

## `comments.json`
Append-only ledger (an array), the machine-readable counterpart to the `reviews/*--comments.md` markdown
("who reviewed/commented", as `approvals.json` is "who approved"). Written by `yad-review-gate`'s
`comment` action and by `yad gate sync`; feeds the `approved.md` participation list, not the gate predicate. Each entry:

```json
{ "artifact": "epic.md", "step": "epic-review", "commenter": "<platform login>", "round": <n>, "count": <comments this round>, "date": "<YYYY-MM-DD>" }
```

`commenter` is the platform login (on a Product with no platform, the name the reviewer gave). An older entry may still carry `role` and `domain`; the gate never reads them, and while the roster is on disk the next sync write records the login on it, keeping the old name in `rosterName` — unless two records in one round would then name the same login (E64).

## `hub-prs.json`
Present only when the Shape review runs through the platform bridge. Per review step, the review
PR/MR opened on the Product (sibling of `approvals.json`, so the locked `state.json` step shape is untouched):

```json
{ "step": "<review step id>", "artifact": "<artifact>", "platform": "github|gitlab", "number": <n>, "url": "<pr/mr url>", "branch": "review/EP-<slug>/<artifact-base>", "lastSyncedAt": "<YYYY-MM-DD or null>" }
```

The same array is written under two names: `product-prs.json` (the name from shape 3) and `hub-prs.json`
(the old name, kept for one major). `yad gate sync` may add `nudged`, the logins it has already asked to
use the review companion, so it never asks them twice.

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
- Every Shape step is seeded `locked: true`. A review gate is never `advance: auto`. Since E34 a feature
  Shape author step may be set to `auto` project-wide in `.sdlc/automation.json`, but that is recorded,
  not acted on (see the kill switch section above). A Build step's dial lives on its lane in `build-state`.

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
> gate file — `state/approvals/comments/product-prs/hub-prs.json`, `reviews/*.md` — so `ledger-guard` never trips).
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
        { "id": "engineer-review", "automation": "human_approve", "advance": "human",  "locked": true,  "status": "todo" }
      ]
    }
  }
}
```

Each `steps[]` entry:

| Field | Values | Meaning |
|-------|--------|---------|
| `id` | `spec`, `tasks`, `implement`, `checks`, `engineer-review` | Build step identity (the `back_steps` from `config.yaml` + the human merge gate). |
| `automation` / `advance` | `human_approve`/`human` \| `machine_advance`/`auto` | Dial 2, written under both names (the OLD one is read). Defaults to `human_approve`; `yad dial <epic> <story> --repo <r> <step> --to auto` flips it (E34 — nothing to earn), never on the `engineer-review` gate. |
| `locked` | `true` \| `false` | `engineer-review` is `true` — it never auto-advances (build plan §E). |
| `closed` | `{ by, date, via, run }` | Written by the `yad-run` skill when it moves the lane past the step: `via` is `auto` or `human`, and `run` names the trust-log run (E18). See "Closing records". |
| `status` | the same **step states** as the Shape chain | Lifecycle. This file is **not** migrated to shape 7 — the `yad-run` / `yad-implement` skills write it, not the engine, so a rewrite would be undone by their next write. `yad-run` advances `done` steps and marks a halted lane `blocked` **with a `record`** naming the halt cause (a failed check, a scope overrun, a contract touch): that record is what separates a halted lane from one nobody started, because a bare `blocked` is the pre-shape-7 spelling of `todo` and still reads that way here. A lane halted by an older `yad-run` carries no record and reads as `todo` until the next run rewrites it — nothing advances past it either way. |

`currentStep` is the `id` the orchestrator is waiting on / about to run for that repo. The file is
created when a story enters Build; all dials start `advance: human` (`automation: human_approve`) (the `config.yaml`
`automation.default`).

**A lane skipped whole (E39).** When a story declares a repo that turns out to need no change,
`yad skip <epic> <story> --repo <name> --reason "<why>"` writes that repo's entry as a skipped lane —
no `steps`, just the state and its record:

```json
{ "story": "EP-<slug>-S0N", "repos": { "web": { "status": "skipped", "record": { "reason": "no UI change", "by": "<login>", "date": "<YYYY-MM-DD>" } } } }
```

- Refused before `stories-review` has passed (edit the story's `repos:` then), for a repo the story does
  not declare, once work has started in the lane or a ship is recorded for it, and for the story's last
  lane. `yad unskip <epic> <story> --repo <name>` removes the entry again.
- **Only a whole lane.** No single Build step is ever `skipped` or `deferred` — `yad doctor` reports one.
  `yad-run` adds a missing repo's entry to an existing file, and never drives a skipped lane.
- It is not written into the story's `repos:` list, because that list is part of what the stories review
  approved. `yad checkpoint --push` commits it with the rest of the Build state.
- Readers: `yad next` prints `skipped (N/A)` with the reason (and still points at `yad-run` while every
  recorded lane is skipped and nothing has started); `yad foundation status` counts the lane as finished
  once another lane really shipped; `yad checkpoint --retro-ship` refuses it, and `yad-engineer-review`
  checks for it before recording a ship.
- `skipped` is honoured only over a lane with no work in it. An entry that says `skipped` beside steps that
  have started — including a status word this release does not know — is read as the work, and
  `yad doctor` fails it as a contradiction.

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
  `trust-log/` shard dir, and **concatenate** — every entry is a distinct run and the run record
  counts re-runs, so **never dedup by `(story, repo, step)`**. (The only guard: a shard whose FULL
  identity `(story, repo, step, uid)` already appears in the folded `runs` is a half-applied tidy and is
  skipped — keying on `uid` alone would wrongly drop a different run that happened to reuse a token.) A legacy epic with only
  the folded file and no shard dir still reads correctly — nothing to union.
- **`yad tidy up`** (manual, one person) folds a SHIPPED story's finished shards into the folded file's
  `runs` and deletes them. Writers never fold — they only add shards; `yad checkpoint` commits the shard
  dir, and `yad tidy up` is the Build analogue of `git gc` folding loose objects.
- The **run record** `yad dial` prints reads this same union, filtered to the step and repo.

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

**The run record is advice (E34).** There is no trust threshold. `yad dial` prints a step's slice — runs
and the fraction `approved-unchanged`, from the union above — beside its dial, and never refuses on it; the
team decides. `yad-status` shows the same record.

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
- the **same 10-step Shape chain** as a normal epic, every step `status: "todo"` (so `validateState`
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
only re-authored steps run. `yad epic new <slug> --type <change|defect|hotfix> --parent <EP-parent> --inherits <bases>`
writes it (E42) and sets `currentStep` to the first re-authored step.

```json
{ "id": "architecture", "type": "author", "artifact": "architecture.md",
  "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true,
  "status": "satisfied", "inherited": true, "inheritedFrom": "EP-checkout",
  "boundHash": "sha256:…", "risk_tags": [] }
```

- `inherited` — `true` when this step's artifact is taken by reference from the thread (not authored here).
- `inheritedFrom` — the epic along the parent's line that owns the referenced artifact (not always the parent).
- `boundHash` — the artifact's hash at inherit time (contract surface hash for `architecture`; the
  `storiesHash`/file hash for others — without the frontmatter `status:` line from shape 9, and an older
  whole-file hash is still accepted). The gate predicate short-circuits an `inherited` step as
  **satisfied** iff `boundHash` still equals the current hash of that artifact in the owning epic
  (`inheritedFrom`) — which holds unless the owner's copy changes, so inherited steps never block and are
  never re-reviewed. Compare against the owner's copy, not the child's: a change-epic writes its own
  `epic.md` (the change brief), which is not the epic it carries.

`approvals.json` gets a **provenance** record per inherited gate (not a forged approval):

```json
{ "artifact": "architecture.md", "step": "architecture-review", "status": "inherited",
  "from": "EP-checkout", "boundHash": "sha256:…", "date": "<YYYY-MM-DD>" }
```

**What may be inherited (E42).** The engine carries a base only from the epic that owns it along the
PARENT's line (`inheritedFrom` — a sibling change off the same genesis is not something this epic builds
on), and only when that owner wrote AND approved it: both the step and its `-review` are `done`, and the
artifact is on disk. `epic`, `architecture` + `contract` (always together) and `ui-design` may be
inherited; `analysis` rides with `epic`. `stories` and `test-cases` never are — the thread's set is the
union of every contributor, and `stories-review` is what hands an epic to Build. Everything else is
refused before anything is written:

| Upstream | Refused because | Instead |
|---|---|---|
| the step is `skipped` | a skip is a decision, not an artifact — carrying it would claim a review nobody did | leave the base out, then `yad skip` it on this epic |
| the step is `deferred` | the work is still owed | leave the base out and author it here, so the owed work follows the thread |
| the step or its review is unfinished | nothing approved exists yet | finish it on the owner first |
| architecture approved, but no usable lock | rule 5 — you may skip authoring a contract, never having one | lock the owner's surface first |
| the owner's surface no longer matches its lock | a pointer would pass the drift down the thread | re-lock the owner first |
| the route has no such step (a short lane) | nothing to inherit | leave the base out |

A brownfield anchor (`kind: stub`, or a light-promoted `backfill-done`) is the one exception: its chain
was never started, so its bases carry `boundHash: null` and no pointer-lock is written.

## The pointer-lock — `contract-lock.json` in a change-epic

When `architecture` is inherited, `yad epic new` writes a **derived** `contract-lock.json` carrying the
parent's hash **verbatim** so `contract-check.sh` (which reads only `hash`) passes unchanged. There is
no `contract.md` in the child to edit, so the surface physically cannot drift.

```json
{ "artifact": "contract.md", "hash": "sha256:<parent hash, verbatim>", "lockedAt": "<date>",
  "inheritedFrom": "EP-checkout", "ref": "../../EP-checkout/.sdlc/contract-lock.json" }
```

Omitting `architecture` from `inherits` (depth `contract-surface`) is what triggers a **real re-lock**:
`yad-architecture` re-authors `contract.md`, computes a **new** hash, and `architecture-review` carries
`risk_tags: ["contract"]` → the usual contract-risk review (full approver count 3; only the base 1 is enforced until the capacity cap, E72). This unifies "route back to the
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
