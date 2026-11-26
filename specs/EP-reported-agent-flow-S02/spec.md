# Spec — EP-reported-agent-flow-S02: record a Build step as an agent's work, and correct a closed step's record

Story: `EP-reported-agent-flow-S02` (epic `EP-reported-agent-flow`), engine repo. Issue: engine #658.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad build step <story> --repo <r> <step> done` closes a Build lane step and writes its closing record,
`closed` — the record of who closed the step, when, and how (`via`). Today `via` has two values:

- `human` — a person did the step. It is the default: `bin/yad.mjs` line 1366 passes `via: o.via || 'human'`
  to `buildStep`.
- `auto` — the step's dial (its automation setting) was `auto`, and the orchestrator moved past it on its own.

**What the code does today.**

- `planStep` (`cli/build.mjs` line 110) is the pure function that moves a step. Line 168 refuses any `via`
  other than `auto` or `human` (`--via must be auto or human`). Lines 170–174 refuse `--via auto` unless the
  dial in force is `auto` (`effectiveAdvance`, `cli/epic-state.mjs` line 4981; the kill switch holds it at
  `human`). Line 185 writes `closed = { by, date, via, run?, task? }`.
- `buildStep` (`cli/build.mjs` lines 349–395) reads the files and calls `planStep`. Lines 355–366 check a
  `--run <uid>` (the trust run — one entry of the trust log, the record of each step run and its verdict):
  it must exist for this story, repo, step and task, and no earlier close may name it. Lines 368–373 add,
  for `--via auto` only: `--run` is required, and the run's verdict must not be `rejected`.
- The usage line in `bin/yad.mjs` line 412 and the `docs/CLI.md` row (line 142) say `--via auto|human`.

**The gap.** An agent that does a step on a dial that is not `auto` has no true value to record. `--via auto`
is refused (the dial is `human`), so the close says `human`: a person's work. The `yad-run` skill does exactly
this on a `human` dial (`skills/yad-run/SKILL.md` line 159, `references/run-loop.md` line 68:
`done --run <uid>` with no `--via`). The agent rule `record-truly` (`cli/agent-rules.mjs` line 357) names only
`--via auto`, which the agent cannot use there.

**Why a wrong record cannot be put right.** Once a step is closed:

- `done` again returns "already done" and changes nothing (`cli/build.mjs` line 127, message at line 380).
- Any other move is refused (lines 133–137). For `spec` and `tasks` the hint is `a closed step is not
  reopened`: only the per-task steps (`PER_TASK`, line 54 — `implement` and `checks`) reopen, and only for
  the next task.
- The schema says "the first close wins" (`skills/yad-epic/references/state-schema.md` line 375).

So a `spec` or `tasks` close recorded as `human` stays `human` for good.

**Who reads `closed.via` today.** A Build lane step's `closed` lives in `build-state/<story>.json`. A front
(Shape) step's `closed` lives in `state.json` and uses other values (`merge`, `approved`, …).

| Reader | What it reads | Reads Build lane `via`? |
|---|---|---|
| `CLOSED_VIA` (`cli/epic-state.mjs` line 1920) | the list of known values; held by `cli/test.mjs` line 10195 | lists `auto`, `human` |
| `cli/build.mjs` `planAutoOpen` (lines 1096–1127) | a lane close's `run`, for `yad open-pr --via auto` | no — `run` only |
| `cli/standup.mjs` lines 449–460 | `closed` of `state.json` steps; prints `(via)` | no — Build lanes are not read |
| `closedLine` (`cli/gate.mjs` lines 55–58), used by `yad gate status` (line 1639) and `yad history show` (`cli/history.mjs` line 503) | front step `closed`; prints `via <value>` | no |
| `cli/status.mjs` (`yad status`) | a lane's active step, status and halt reason (lines 99–112, 123–129) | no — no closing record |
| `skills/yad-status/SKILL.md` section 7 | the Build chain from `build-state`: status, dial, `locked` | no — `closed` is printed only for front steps (line 100) |
| trust record: `cli/dial.mjs` lines 141–142, `yad-status` section 8 | counts runs and `approved-unchanged` runs | no; and `ranBy` is read nowhere — every run counts the same |

Every reader that prints a `via` prints it through `printable`/`safe`, so a new value does not crash any of
them. But no command shows a Build step's `via` at all today, so "an agent's work" can be shown nowhere yet.

`cli/find-product.mjs` and `cli/reports.mjs` have a `via` of their own (how the Product or the reports folder
was found); neither reads `closed.via`.

## Requirements

- R1. `yad build step <story> --repo <r> <step> done --via agent` closes the step with `closed.via: "agent"`.
  It needs no `--run`. A `--run` given is checked as today (lines 355–366). (AC 1)
- R2. `--via agent` on `done` is refused when the dial in force is `auto` (`effectiveAdvance(...).advance ===
  'auto'`). The message says the step advances on its own, and the hint names `--via auto --run <uid>`. With
  the kill switch on, the dial in force is `human`, so `--via agent` is allowed. (AC 1)
- R3. `--via` must be `auto`, `agent` or `human`; any other value is refused with that list. No `--via`, or
  `--via human`, behaves exactly as today. (`--via` given with no value is refused by the parser, `--via
  expects a value`, as today.) (AC 5)
- R4. `CLOSED_VIA` lists `agent`. (AC 3, the addition)
- R5. A correction command (proposed: `yad build amend`, see Clarifications) changes the `via` of a Build step
  that is already closed, to `human`, `agent` or `auto`. It needs `--via` and a non-empty `--reason`. It works
  on `spec` and `tasks` as on `implement` and `checks`. (AC 2)
- R6. The correction keeps history inside the step's closing record: it appends
  `{ via: <earlier via>, by, date, reason }` (and `run: <earlier run>` when there was one and it changes) to
  `closed.amended`, a list, then sets `closed.via` to the new value. `by` is the local identity
  (`recordActor`), `date` is today. The original `by` and `date` of the close stay. Because the history lives
  in `closed`, a per-task step reopened later moves it into `runs` with the close (the `keep` function,
  lines 140–148), so nothing is lost. (AC 2)
- R7. The correction refuses, and writes nothing, when: the step is not `done`, or has no `closed` record (a
  step closed before closing records existed); the step is `engineer-review` (see Clarifications); `--via` is
  missing or not one of the three; `--reason` is missing or empty; `--task <T>` is given and is not
  `closed.task`. The same `via` as now is "nothing changed", with no history entry. (AC 2)
- R8. `--via auto` in a correction needs `--run <uid>`: a trust run of this story, repo, step (and task), not
  `rejected`, recorded while the dial was `auto` (its `advance` is `auto`, or its older `automation` is
  `machine_advance` — `trustEntry`, lines 219–222), and not named by another close of the step. It sets
  `closed.run` to that uid. (AC 2)
- R9. `done` on a step already closed still changes nothing, and its hint now names the correction command.
- R10. `yad standup` lists Build lane closes from `build-state` (in the window, attributed to `closed.by`, a
  robot skipped as today). The words keep the three apart: `human` reads as a person's work, `agent` as an
  agent's work that a person advanced, `auto` as advanced on its own. The JSON item carries `via` as given.
  The Markdown and HTML pages (`--format md|html`, written from the same items) show the same words. An
  unknown `via` prints safely, as today. (AC 3)
- R11. The `yad-status` skill's Build chain (section 7) prints each closed step's `via` with the same three
  meanings, and a correction when `closed.amended` is there. Its run record (section 8) says that a run an
  agent recorded with `--ran-by machine` counts as any other run, as `dial.mjs` counts it. (AC 3)
- R12. The rule `record-truly` names `--via agent` for a step an agent did on a dial that is not `auto`, and
  `--via auto` only when the dial is `auto`, with `--ran-by machine` on the trust run in both cases.
  `skills/yad-guide/SKILL.md` is regenerated from it. The `yad-run` skill closes a step it ran on a `human`
  dial with `--via agent`. (AC 4)
- R13. The correction command has a class in `COMMAND_CLASS` (`cli/agent-rules.mjs`), so the test
  "every command bin/yad.mjs knows has a class" (`cli/test-guide.mjs` line 73) holds.
- R14. `docs/CLI.md` (the `yad build step` row and a new row for the correction) and
  `skills/yad-epic/references/state-schema.md` (the `via` table at line 372, the build-state `closed` row at
  line 843, and "the first close wins" at line 375) list `agent`, the correction, and `closed.amended`. (AC 6)

## Non-goals

- `yad open-pr --via` (`cli/openpr.mjs` lines 308–309) keeps `auto|human`.
- Front (Shape) steps: they never get `agent`, and the correction does not touch `state.json`.
- Correcting a close already moved into a step's `runs` (an earlier task's close of `implement`/`checks`).
- Changing how the trust record counts runs, or what earns a dial.
- The Product's own `AGENTS.md` block: it is written from the same rules and is refreshed by `yad update` in
  each Product, not in this repo.
- `yad status` (the CLI, `cli/status.mjs`) printing closing records (see Clarifications).

## Clarifications

### Session 2026-11-25

- Q: Light spec? → A: yes (the person, Plannotator Inbox, 2026-11-25).
- Q: How should yad record a Build step an agent closed? → A: a third value, --via agent (an agent did the work, a person still advances it), plus a way to correct a closed step's record, kept in its history (the person, Plannotator Inbox, 2026-11-25).
- Q: the correction command's name → A: `yad build amend <story> --repo <r> <step> --via human|agent|auto --reason "<why>" [--run <uid>] [--task <T>]`. Why: the `build` family names one verb per record (`start`, `step`, `trust`, `ship`, `merged`, `done`, `sync`, `ACTIONS.build` in `bin/yad.mjs` line 773); a correction moves no step, so it does not fit `build step`, whose state word is required; and it reuses flags the parser already knows (`--via`, `--reason`, `--run`, `--task` in `cli/argv-flags.mjs`), so no new flag. Other names: `yad build correct` (plainer word), or `yad build step … --correct-via <value>` (a new flag on `step`, which would make the state word optional). Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: the correction's class for an agent → A: `on-request`: it rewrites a record, as `yad build trust --uid` (finalizing a verdict) is `on-request`, so an agent runs it only when the person asked. The other choice is `local-write`, as `yad build step`, so an agent may fix its own wrong record without asking. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: may the correction change `engineer-review`? → A: no: `yad build done` closes it (`closeReview`, line 272) as a person's merge review, so `agent` or `auto` would never be true there. The story says "any Build step"; this narrows it to the four author steps. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: should `yad standup` list every Build lane close (`human` and `auto` too), not only `agent`? → A: yes: today it lists none, and showing `agent` "apart from a person's and from an earned auto" needs all three. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: should `yad status` (the CLI) also print closing records? → A: no for this story: it prints no closing record of any step today; the `yad-status` skill's Build chain is where steps and their records are shown. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: should `--via agent --run <uid>` refuse a run recorded `--ran-by human`? → A: no: `ranBy` is read nowhere today, and the rule (R12) tells the agent to record `--ran-by machine`; a refusal would be a new check the story does not ask for. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.

## Plan

Grow the value set first (`CLOSED_VIA`), then let `planStep` accept `agent` with its one refusal. Add the
correction as a pure planner, `planAmend(buildState, { story, repo, step, via, reason, run, task, runRecord,
by, date })`, beside `planStep` in `cli/build.mjs`, and a command `buildAmend(root, …)` that reads the story
(`storyContext`), finds and checks the run for `--via auto` (as `buildStep` does), calls the planner and
writes the file. Export it from `bin/commands.mjs`. Then wire the CLI: the `build` action list, the usage
lines, the dispatch, and the command's class in `cli/agent-rules.mjs`. Change `record-truly` in the same task,
and regenerate `skills/yad-guide/SKILL.md` with `node scripts/agent-guide.mjs` (it rewrites the `classes` and
`rules` sections of that one file; `cli/test-agents-file.mjs` line 1346 runs its check). Then the docs and
schema, the standup reader, and the skill text (the `yad-run` change carries its test in `cli/test.mjs`). Each task leaves `npm test` green.

## Tasks

<!-- yad:tasks -->
## T01 — the closing record's value set lists agent
**Files:**
- `cli/epic-state.mjs`
- `cli/test.mjs`

**Done when:** R4 holds: `CLOSED_VIA` (line 1920) and its comment list `agent`, and the assertion at `cli/test.mjs` line 10195 lists it.

## T02 — yad build step … done --via agent closes a step as an agent's work
**Files:**
- `cli/build.mjs`
- `bin/yad.mjs`
- `cli/test-build.mjs`

**Done when:** R1–R3 hold in `planStep`; the `yad build step` usage line says `--via auto|agent|human`; tests cover a close with and without `--run`, the refusal on an `auto` dial naming `--via auto`, the kill switch allowing it, a bad value, and no `--via` writing `human` as before.

## T03 — the correction planner and command, with its history entry
**Files:**
- `cli/build.mjs`
- `bin/commands.mjs`
- `cli/test-build.mjs`

**Done when:** R5–R9 hold in `planAmend` and `buildAmend` (exported from `bin/commands.mjs`); tests cover a `spec` and a `tasks` close corrected to `agent`, the `closed.amended` entry, a step not closed, a step with no `closed`, `engineer-review`, no reason, a wrong `--task`, the same value, `auto` with and without a valid run (rejected, wrong step, dial not `auto` at run time, already used), and the "already done" hint naming the correction.

## T04 — the CLI takes the correction, and the agent rule names --via agent
**Files:**
- `bin/yad.mjs`
- `cli/agent-rules.mjs`
- `skills/yad-guide/SKILL.md`

**Done when:** R12 (the rule) and R13 hold: `amend` is in `ACTIONS.build.known`, has usage lines and a dispatch to `buildAmend`; `build amend` has its class in `COMMAND_CLASS`; `record-truly` is rewritten; `node scripts/agent-guide.mjs` has regenerated the `classes` and `rules` sections of `skills/yad-guide/SKILL.md`, and `node scripts/agent-guide.mjs --check` exits 0.

## T05 — the correction through the CLI, in the docs and the schema
**Files:**
- `cli/test-build.mjs`
- `docs/CLI.md`
- `skills/yad-epic/references/state-schema.md`

**Done when:** R14 holds, and a test runs `yad build amend … --json` and `yad build step … done --via agent` through `bin/yad.mjs` on a fixture Product and reads the written `build-state` file.

## T06 — yad standup shows Build lane closes, an agent's work apart
**Files:**
- `cli/standup.mjs`
- `cli/test-standup.mjs`

**Done when:** R10 holds; tests cover a lane close of each value in the window (terminal text, JSON `via`, and the Markdown and HTML pages), one outside the window, a robot's, and an unknown `via` printed safely.

## T07 — the yad-run skill closes a human-dial step it ran with --via agent
**Files:**
- `skills/yad-run/SKILL.md`
- `skills/yad-run/references/run-loop.md`
- `cli/test.mjs`

**Done when:** the `yad-run` part of R12 holds: the `human`-dial close in both files is `done --via agent --run <uid>`; the assertions at `cli/test.mjs` lines 10506 and 10510 (which match `<step> done --run <uid>` today) match the new line, and the `--via auto` assertions (lines 10505, 10509) are unchanged.

## T08 — the yad-status skill shows how each Build step closed
**Files:**
- `skills/yad-status/SKILL.md`

**Done when:** R11 holds: section 7 prints each closed Build step's `via` (a person's work, an agent's work a person advanced, or advanced on its own) and any `closed.amended` entry, and section 8 says a run an agent recorded with `--ran-by machine` counts as any other run.
<!-- /yad:tasks -->
