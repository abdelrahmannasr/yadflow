---
name: yad-run
description: 'Phase 4 (automation) — the orchestrator that makes the second dial real. Drives a story''s Build loop (spec → tasks → implement → checks) in one code repo, reading each step''s advance dial from build-state: on `auto` it advances on its own, on `human` it stops for a human. Records every run in the trust log, the run record `yad dial` shows as advice. With `checks` on auto, a clean gate pass advances to engineer-review; any failure, scope overrun, or contract-surface touch HALTS and pulls in a human. Also sets a step''s dial (`yad dial`, nothing to earn since E34) and flips the kill switch (`yad kill` / `yad unkill`). Never advances a Shape step or the engineer review. Use when the user says "run Build", "advance story <id>", "set the checks dial", or "kill switch".'
---

# SDLC — Run (Phase 4 orchestrator)

**Goal:** Be the **engine** that the advance dial finally drives. Until Phase 4 the dial was inert
config; this skill reads it and acts. For ONE story in ONE code repo, walk the Build steps —
`spec → tasks → implement → checks → engineer-review` — and at each step either **advance on its own**
(dial `advance: auto`, step succeeded) or **stop for a human** (dial `advance: human`, or any halt
condition). Every run is recorded in the **trust log** — the run record `yad dial` shows the team, as
advice, when it sets a dial.

This is the most dangerous skill in the system, so it is built to **halt-and-escalate over guess**:
a failing check, ambiguity, a scope overrun, or a contract-surface touch stops the loop and pulls in a
human regardless of any dial. This skill **drives Build only**: it never drives a Shape step, and the
**engineer review is a gate** — always a person.

**Nothing has to be earned (E34).** Automation used to be unlocked per step once its trust log cleared a
threshold. Now the team sets each lane step's dial with `yad dial`, which prints that step's run record
beside it as advice and never refuses on it. The kill switch (`yad kill`) holds every step at `human`.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo (source of
  truth: it holds the story, the build-state, and the trust log).
- Code repos are separate git repos under `{project-root}/demo-repos/<repo>/`
  (`config.yaml` `build.code_repos_root`). Operate inside them with absolute paths.
- Automation config is `skills/sdlc/config.yaml` → `automation:` (`back_steps`, `default`). The kill
  switch and the Shape dials live in `.sdlc/automation.json`, and are read and written **only through the
  engine** — `yad dial … --json`, `yad kill`, `yad unkill`. Never read or edit either file for a dial.
- Per-story Build state: `epics/<epic>/.sdlc/build-state/<story-id>.json` (per repo).
- Trust ledger: **shard-then-fold** — each run is its own shard file
  `epics/<epic>/.sdlc/trust-log/<story>-<repo>-<step>-<uid>.json` (a fresh `uid` per run, so concurrent
  writers never conflict); readers UNION the folded `trust-log.json` with every loose shard, and
  `yad tidy up` folds finished shards back into `trust-log.json`. Schemas:
  `../yad-epic/references/state-schema.md`.
- These machine-written Build files (`build-state/<story>.json`, the `trust-log/` shards) are
  committed by **`yad checkpoint`** — the Build analogue of the Shape `yad gate` sync; the loop
  calls it each iteration so the state is durable and shared without a human commit. (`yad checkpoint`
  stages the shard dirs; `yad tidy up` later folds finished shards — loose objects + `git gc`.)
- The orchestrator **calls the existing step skills unchanged** — `yad-spec` (A), `yad-implement`
  (B), `yad-checks` (C). It owns only the *advance decision*, never what a step does.
- To see (read-only, without driving the loop) the next build sub-step per story/repo, use
  `yad next <epic>` — it reads the same `build-state/<story-id>.json` and prints the next sub-step plus
  the remaining chain and the automation dial.

## Inputs

- `epic` / `story` / `repo` — the story and code repo to drive (ask if not provided).
- `action` — `run` (default) | `set-dial` | `kill` | `unkill`.
- For `run`: optional `from` (the step id to start at; default the repo's `currentStep` in
  build-state) and `task` (the atomic task id for the `implement`/`checks` legs).
- For `set-dial`: `step` (a `back_steps` id), `to` — `human` | `auto` (the older `human_approve` |
  `machine_advance` mean the same two things).
- For `kill`: `reason` (required). For `unkill`: an optional `reason`.

## On Activation

### Step 0 — Load state
Read `config.yaml` `automation` (for `back_steps`), the story's `build-state/<story>.json` (create it from the
`back_steps` defaults if absent — all `advance: human` (`automation: human_approve`), `engineer-review` `locked:true`, and
**write it to disk before the loop starts**, because `yad next` reads that file to know this lane
exists), and `trust-log.json` (treat missing as `[]`). Resolve the code repo.

If the file exists but has **no entry for this `repo`**, add that repo's entry from the same `back_steps`
defaults — the file may already hold another repo, or a skipped lane — and never remove an entry you did
not add. If this repo's entry is **`status: skipped`** (E39: the whole lane was set aside with
`yad skip <epic> <story> --repo <repo>`, because the story needs no change in this repo), **do not drive
it**: stop, report the recorded `record.reason`, and point at `yad unskip <epic> <story> --repo <repo>` if
the lane is owed after all. **Never write a Build step as `skipped` or `deferred`**: a lane is skipped
whole or not at all, and `yad doctor` reports a single step set aside.

Also read **which skill runs each step** — `yad skill list --json`, whose `steps[]` gives each step id
its `skills` array. That is the project's choice (`.sdlc/skills.json`, E6) and the engine's default
when it has made none. Read it once here; it does not change during a run.

### `action: run` — drive the loop
Walk the steps for `repo` starting at `from`/`currentStep`. For each step:

1. **Run the step's skill — use the list from Step 0, never a name written here.** Look the step id
   up in `yad skill list --json` and run every entry of its `skills` **in order**, each one seeing what
   the one before it produced; the last output is the result. (`yad next <epic> --json` gives the same
   answer per lane once `build-state/<story>.json` is on disk, if you already have it open.) Which
   skill runs a step is the project's setting, so a hardcoded name here would make this loop do one
   thing while `yad next` tells the user another — on the same project, with the automation half
   winning. Unbound, the engine answers `spec`→`yad-spec`, `tasks`→ the tasks leg of `yad-spec`,
   `implement`→`yad-implement`, `checks`→`yad-checks`, which is what this step used to say. Pass
   `action: run` to `yad-checks`. Capture the result.
2. **Derive trust signals & write a trust-log shard** — write the entry to its own file
   `trust-log/<story>-<repo>-<step>-<uid>.json` (a fresh `uid` per run; never append to a shared file),
   with `ranBy: machine` if this advance was automated, else `human` — see `references/run-loop.md` for
   the derivation. Do this for *every* step run, pass or fail; the log is the evidence base.
3. **Ask the engine for the effective dial:** `yad dial <epic> <story> --repo <repo> <step> --json`, and use
   its `advance`. It is `human` whenever the step is a gate (`why: gate` — a read never refuses one), the kill switch
   is on, or `.sdlc/automation.json` cannot be read (`automationError` says so) — so never work the dial out from the files yourself.
4. **Decide:**
   - **HALT** if the step failed — any check FAIL, a scope overrun (`yad-implement` stopped on the
     file-boundary rule), a contract-surface touch, or any ambiguity. Set the step `status: blocked`
     **with a `record`** — `{ "reason": "<the halt cause>", "by": "<login or null>", "date":
     "<YYYY-MM-DD>" }` — write the `rejected` trust entry, **stop the loop**, and report what a human
     must resolve. The record is not decoration: since shape 7 a `blocked` step with nothing recorded
     on it reads as `todo` ("not started"), so a halt written without one is indistinguishable from a
     lane nobody has begun. `yad doctor` reports the difference as `step:no-record`.
   - else if effective dial is **`advance: auto`** → set the step `done` **with a `closed`** —
     `{ "by": "<login or null>", "date": "<YYYY-MM-DD>", "via": "auto", "run": "<the trust-log uid>" }` —
     advance `currentStep` to the next step, and **continue the loop** (this is the Step B auto-advance
     for `checks`).
   - else (**`advance: human`**) → set the step `done`/`in_review`, and give a `done` step a `closed` —
     `{ "by": "<login or null>", "date": "<YYYY-MM-DD>", "via": "human", "run": "<the trust-log uid>" }` —
     then **stop** and report "waiting for a human at `<next-step>`".
   - `closed` is the step's **closing record** (E18): how the lane moved past it, and which run did it.
     Never write one over a `closed` already on the step. See `references/run-loop.md`.
5. **Always stop at `engineer-review`** (it is `locked`): hand off to `yad-engineer-review` for the human merge
   gate, which finalizes the trust verdict (confirm/override the provisional one).

**Commit the machine-written state.** After each iteration's writes (the trust-log shard in 2 and the
build-state change in 4), run `yad checkpoint --push` from `{project-root}`. It commits *only* the
`trust-log/` shards + `build-state/<story>.json` (never a Shape gate file) as one `chore(hub): …`
audit-trail commit, and only ever on the default branch. It is a safe no-op when nothing changed, so
call it every iteration — teammates don't review these machine writes, but CI and `yad status` on
other machines must see current trust evidence. Never run it off the default branch (it will refuse):
an unpushed or branch-stranded trust log leaves the run record `yad dial` shows out of date.

### `action: set-dial` — set (or revert) a step's advance dial
Run `yad dial <epic> <story> --repo <repo> <step> --to <human|auto>` (map `human_approve` → `human` and
`machine_advance` → `auto` first). The engine writes both dial names on the lane step, refuses a gate and
a lane step `yad-run` has not written yet, and prints the step's run record in that repo **as advice**.
Relay its output. There is **no threshold** (E34): the team decides, and "it seems fine" is theirs to
judge. `--to human` is always accepted. Never edit `build-state` for a dial yourself.

For a Shape author step the team wants on auto, point at `yad dial <step> --to auto` — project-wide, and
recorded only: this loop never drives a Shape step.

### `action: kill` / `action: unkill` — the kill switch
Run `yad kill --reason "<why>"` or `yad unkill [--reason "<why>"]`. The engine records who, when and why
in `.sdlc/automation.json`; while the switch is on, **every** step's effective dial is `human`. Tell the
user to commit that file so every machine and CI sees it. Never set a `kill_switch` in `config.yaml`:
nothing reads it, and `yad doctor` fails on one left `true`.

## Hard rules (phase-4-build-plan.md)

- **The dial is the team's (E34).** `yad dial` sets it and shows the run record as advice; nothing is
  earned, and nothing is refused on evidence. A gate is never auto.
- **Reversible in one move.** `yad dial … --to human` is never refused; `yad kill --reason "<why>"` holds
  every step at human, with no code change.
- **Halt-and-escalate beats guess.** A failing check, ambiguity, scope overrun, or contract-surface
  touch halts the loop and pulls in a human, regardless of the dial.
- **This skill never drives a Shape step, and never passes the engineer review.** The review is a gate,
  and the kill switch holds every step at human.
- **The orchestrator never changes what a step does** — it calls the existing skills and owns only the
  advance decision and the trust record.

## Reference
- The loop and the trust-verdict derivation: `references/run-loop.md`.
- State/trust schemas: `../yad-epic/references/state-schema.md`.
- The steps it drives: `../yad-spec/`, `../yad-implement/`, `../yad-checks/`; the human gate it
  hands off to: `../yad-engineer-review/`.
