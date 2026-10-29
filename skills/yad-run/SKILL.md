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
- Automation config is `.sdlc/config.yaml` → `automation:` (`back_steps`, `default`). The kill
  switch and the Shape dials live in `.sdlc/automation.json`, and are read and written **only through the
  engine** — `yad dial … --json`, `yad kill`, `yad unkill`. Never read or edit either file for a dial.
- Per-story Build state: `epics/<epic>/.sdlc/build-state/<story-id>.json` (per repo), written by
  `yad build start` and `yad build step` — never by hand.
- Trust ledger: **shard-then-fold**, written by `yad build trust` — each run is its own shard file
  `epics/<epic>/.sdlc/trust-log/<story>-<repo>-<step>-<uid>.json` (a fresh `uid` per run, so concurrent
  writers never conflict); readers UNION the folded `trust-log.json` with every loose shard, and
  `yad tidy up` folds finished shards back into `trust-log.json`. Schemas:
  `../yad-epic/references/state-schema.md`.
- These machine-written Build files (`build-state/<story>.json`, the `trust-log/` shards) are
  committed by **`yad checkpoint`** — the Build analogue of the Shape `yad gate` sync; the loop
  calls it each iteration so the state is durable and shared without a human commit — its `--push`, which
  lands on the default branch, only after the person says yes (E158). (`yad checkpoint`
  stages the shard dirs; `yad tidy up` later folds finished shards — loose objects + `git gc`.)
- The orchestrator **calls the existing step skills unchanged** — `yad-spec` (A), `yad-implement`
  (B), `yad-checks` (C). It owns only the *advance decision*, never what a step does.
- To see (read-only, without driving the loop) the next build sub-step per story/repo, use
  `yad next <epic>` — it reads the same `build-state/<story-id>.json` and prints the next sub-step plus
  the remaining chain and the automation dial.

## Inputs

- `epic` / `story` / `repo` — the story and code repo to drive (ask if not provided).
- `action` — `run` (default) | `set-dial` | `kill` | `unkill`.
- For `run`: `task` (the atomic task id for the `implement`/`checks` legs — when not given, the task
  `yad-implement` works on; every trust run and close on those legs names it with `--task`) and `from`. The lane
  is walked in order, so `from` may only name the lane's current step — or, with `task`, `implement`
  once the lane is at `engineer-review`: that reopens `implement` and `checks` for the next task
  (`yad build step <story> --repo <repo> implement in_progress --task <task>`).
- For `set-dial`: `step` (a `back_steps` id), `to` — `human` | `auto` (the older `human_approve` |
  `machine_advance` mean the same two things).
- For `kill`: `reason` (required). For `unkill`: an optional `reason`.

## On Activation

### Step 0 — Load state
Read `config.yaml` `automation` (for `back_steps`), the story's `build-state/<story>.json`, and
`trust-log.json` (treat missing as `[]`). Resolve the code repo. If the story has **no lane for this
`repo`** (no file, or a file without that repo's entry), run `yad build start <story> --repo <repo>` **before
the loop starts**: it writes the lane from the `back_steps` defaults (all `advance: human`,
`engineer-review` locked) and never touches another repo's entry, and `yad next` reads that file to know
the lane exists. Never write `build-state/` or `trust-log/` by hand — the `yad build` commands write them
in the shape every reader expects (#346).
 If this repo's entry is **`status: skipped`** (E39: the whole lane was set aside with
`yad skip <epic> <story> --repo <repo>`, because the story needs no change in this repo), **do not drive
it**: stop, report the recorded `record.reason`, and point at `yad unskip <epic> <story> --repo <repo>` if
the lane is owed after all. **Never write a Build step as `skipped` or `deferred`**: a lane is skipped
whole or not at all, and `yad doctor` reports a single step set aside.

Also read **which skill runs each step** — `yad skill list --epic <epic> --json`, whose `steps[]` gives
each step id its `skills` array. Always pass `--epic`: a project may bind a step for one route only
(`profiles.<route>` in `.sdlc/skills.json`, E51), and that line wins for an epic on the route — the
plain `yad skill list` shows the project-wide answer, which may be the wrong skill for this epic. That
is the project's choice (`.sdlc/skills.json`, E6) and the engine's default when it has made none. Read
it once here; it does not change during a run.

### `action: run` — drive the loop
Walk the steps for `repo` starting at `from`/`currentStep`. For each step:

1. **Run the step's skill — use the list from Step 0, never a name written here.** Look the step id
   up in `yad skill list --epic <epic> --json` and run every entry of its `skills` **in order**, each one seeing what
   the one before it produced; the last output is the result. (`yad next <epic> --json` gives the same
   answer per lane once `build-state/<story>.json` is on disk, if you already have it open.) Which
   skill runs a step is the project's setting, so a hardcoded name here would make this loop do one
   thing while `yad next` tells the user another — on the same project, with the automation half
   winning. Unbound, the engine answers `spec`→`yad-spec`, `tasks`→ the tasks leg of `yad-spec`,
   `implement`→`yad-implement`, `checks`→`yad-checks`, which is what this step used to say. Pass
   `action: run` to `yad-checks`. Capture the result.
2. **Derive trust signals & record the run** — `yad build trust <story> --repo <repo> <step> --verdict <v>
   --signal <name>=<value> … --ran-by <machine|human> --json` writes the entry to its own shard with a fresh
   `uid` and prints it (`ranBy: machine` if this advance was automated, else `human`) — see
   `references/run-loop.md` for the derivation. Do this for *every* step run, pass or fail; the log is the
   evidence base. Keep the `uid`: the closing record names it. **One exception (#357):** when the
   step's skill stopped to ask its human-only questions (its first batch or a later one), the step's
   output is not finished, and a draft is not output to judge: record no trust entry. Run
   `yad build step <story> --repo <repo> <step> blocked [--task <task>] --reason "waiting on human
   decisions: <the questions, short>"`, ask the person before `yad checkpoint --push` (a push to the default
   branch is asked about every time, E158), and stop — skip steps 3 and 4.
   **Not when the skill also hit its contract STOP** (a contract-change item in its batch): no answer
   lifts that, so it is the step-4 contract-touch halt, with its trust entry, as before.
3. **Ask the engine for the effective dial:** `yad dial <epic> <story> --repo <repo> <step> --json`, and use
   its `advance`. It is `human` whenever the step is a gate (`why: gate` — a read never refuses one), the kill switch
   is on, or `.sdlc/automation.json` cannot be read (`automationError` says so) — so never work the dial out from the files yourself.
4. **Decide:**
   - **HALT** if the step failed — any check FAIL, a scope overrun (`yad-implement` stopped on the
     file-boundary rule), a contract-surface touch, or any ambiguity other than the human-only
     questions step 2 already halted on. Run
     `yad build step <story> --repo <repo> <step> blocked --reason "<the halt cause>"` (it writes the
     step's `record`) — the trust entry step 2 recorded for this run is the `rejected` one, so record
     no second entry — **stop the loop**, and report what a human must resolve. The record is not decoration: since shape 7 a `blocked` step with nothing recorded
     on it reads as `todo` ("not started"), so a halt written without one is indistinguishable from a
     lane nobody has begun. `yad doctor` reports the difference as `step:no-record`.
   - else if effective dial is **`advance: auto`** → `yad build step <story> --repo <repo> <step> done
     --via auto --run <uid>` (it writes the `closed` record and moves `currentStep` on), and **continue the
     loop** (this is the Step B auto-advance for `checks`).
   - else (**`advance: human`**) → `yad build step <story> --repo <repo> <step> done --run <uid>`, then
     **stop** and report "waiting for a human at `<next-step>`".
   - On the `implement`/`checks` legs, pass `--task <task>` to `yad build trust` and `yad build step`, so
     each task's run and close are kept apart (the engineer review finalizes the right one).
   - `closed` is the step's **closing record** (E18): how the lane moved past it, and which run did it.
     Never write one over a `closed` already on the step. See `references/run-loop.md`.
5. **Opening the task's PR/MR (#356).** Once `checks` has closed `done` for a task — by either dial, before
   you stop — ask
   `yad dial open-pr --json` and use its `advance`. **`auto`** — the project's standing approval: from the
   task branch, run `yad open-pr --via auto` **without asking**. It refuses (and pushes nothing) unless the
   dial is auto, the `checks` step is closed now, and each task the branch's commits carry (one, or a
   group of small tasks of the story — #350) has its newest close naming it (so close it with `--task <T>`)
   with a run that passed (`checks=pass`) and was not rejected; it records the opened PR/MR on the lane (`opened`). If it refuses, stop and report why.
   **`human`** — stop and ask the person to approve opening it, then run `yad open-pr`. The merge is
   always a person's, whatever the dial.
6. **Always stop at `engineer-review`** (it is `locked`): hand off to `yad-engineer-review` for the human merge
   gate, which finalizes the trust verdict (confirm/override the provisional one).

**Commit the machine-written state.** After each iteration's writes (the trust-log shard in 2 and the
build-state change in 4), ask the person, then run `yad checkpoint --push` from `{project-root}` (a push to
the default branch is asked about every time, E158). It commits *only* the
`trust-log/` shards + `build-state/<story>.json` (never a Shape gate file) as one `chore(product): …`
audit-trail commit, and only ever on the default branch. It is a safe no-op when nothing changed, so
offer it every iteration — teammates don't review these machine writes, but CI and the `yad-status` skill on
other machines must see current trust evidence. Never run it off the default branch (it will refuse):
an unpushed or branch-stranded trust log leaves the run record `yad dial` shows out of date.

### `action: set-dial` — set (or revert) a step's advance dial
Only when the person asked for this exact change (E158): run
`yad dial <epic> <story> --repo <repo> <step> --to <human|auto>` (map `human_approve` → `human` and
`machine_advance` → `auto` first). The engine writes both dial names on the lane step, refuses a gate and
a lane step `yad-run` has not written yet, and prints the step's run record in that repo **as advice**.
Relay its output. There is **no threshold** (E34): the team decides, and "it seems fine" is theirs to
judge. `--to human` is always accepted. Never edit `build-state` for a dial yourself.

For a Shape author step the team wants on auto, point at `yad dial <step> --to auto` — project-wide, and
recorded only: this loop never drives a Shape step.

### `action: kill` / `action: unkill` — the kill switch
Only when the person asked for it (E158): run `yad kill --reason "<why>"` or `yad unkill [--reason "<why>"]`. The engine records who, when and why
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
- **One epic per folder when agents run in parallel (#115).** Each orchestrator runs in its epic's own
  worktrees (`yad worktree add <epic> --all`), never in a checkout another agent is using; `yad build`
  and `yad checkpoint` run from there reach that epic's Product worktree.

## Reference
- The loop and the trust-verdict derivation: `references/run-loop.md`.
- State/trust schemas: `../yad-epic/references/state-schema.md`.
- The steps it drives: `../yad-spec/`, `../yad-implement/`, `../yad-checks/`; the human gate it
  hands off to: `../yad-engineer-review/`.
