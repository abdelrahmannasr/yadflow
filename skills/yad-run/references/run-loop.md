# `yad-run` — the loop and the trust verdict

This is the detail behind `SKILL.md`. It restates the orchestration so the skill is self-contained,
and pins down the judgment the skill makes: **what trust verdict to record**. Whether a step advances on
its own is not a judgment any more — the team sets the dial with `yad dial` (E34), and the engine answers
what applies.

## The Build steps

From `config.yaml` `automation.back_steps` plus the human merge gate:

```
spec → tasks → implement → checks → engineer-review(locked)
```

**These names are the engine's DEFAULTS, not a fixed wiring.** Which skill runs a step is the
project's setting in `.sdlc/skills.json` — for every epic, or for one route only — so the loop reads
`yad skill list --epic <epic> --json` (that epic's route, E51) once at Step 0 and
runs every entry of that step's `skills`, in order, when it is bound to more than one. Unbound: `spec` and `tasks` are the two legs of `yad-spec` (the heavy ceremony, then the atomic
`tasks.md`, or the tasks block of a light `spec.md`, #348), `implement` is one atomic task via `yad-implement`, and `checks` is
`yad-checks (action: run)`. `engineer-review` is the human gate at `yad-engineer-review` — always a
stop, never automated, and bindable like any other step.

## The loop (pseudocode)

```
cfg   = config.yaml.automation
bs    = build-state/<story>.json.repos[<repo>]        # absent: `yad build start <story> --repo <repo>` seeds it
                                                      #   from the defaults (it never touches another repo's
                                                      #   entry). Never write this file by hand (#346).
if bs.status == "skipped":                            # E39: the whole lane was set aside with
    STOP — report bs.record.reason                    #   `yad skip <epic> <story> --repo <repo>`; do not drive it.
                                                      #   `yad unskip <epic> <story> --repo <repo>` puts it back.
                                                      # Never write a single Build step as skipped or deferred.
step  = from or bs.currentStep                       # from: the lane's current step only
if task and bs.currentStep == "engineer-review" and task has no close on implement:
    yad build step <story> --repo <repo> implement in_progress --task <task>   # reopens implement and checks
    step = "implement"                                                          #   for the next task

while step is a Build step (not engineer-review):
    result = run_step_skill(step)                     # the skill(s) `yad next --json` names for this lane
                                                      #   (yad-spec moves spec/tasks to in_progress itself,
                                                      #   which pins Spec Kit's feature folder — #348)

    if result stopped to ask human-only questions — its first batch or a later one (#357) —
       and did NOT hit its contract STOP (a contract item is the contract-touch HALT below):
        # the output is not finished (a draft spec.md is not output), so no trust entry — only the halt
        yad build step <story> --repo <repo> <step> blocked [--task <T>] --reason "waiting on human decisions: <the questions, short>"
        checkpoint; STOP and report the questions

    signals = derive_signals(step, result)            # see "Deriving signals"
    verdict = derive_verdict(signals)                 # rejected | approved-with-edits | approved-unchanged
    uid = `yad build trust <story> --repo <repo> <step> --verdict <verdict> --signal <name>=<value> …
           --ran-by <machine|human> {--task <T>} --json`.uid        # writes ONE shard, trust-log/<story>-<repo>-<step>-<uid>.json,
                                                       #   with a fresh uid and the dial in force; never by hand

    eff = effective_dial(step, bs, cfg)               # see "Effective dial"

    if result is a HALT (failed / scope overrun / contract touch / ambiguous):
        # `blocked` needs its `record` (E38) — that is what separates a halted lane from one that has
        # simply not started. `reason` is the halt cause you already have in hand.
        yad build step <story> --repo <repo> <step> blocked [--task <T>] --reason "<check FAIL | scope overrun | contract touch | ambiguous>"
        checkpoint; STOP and report the human action needed
    elif eff == "auto":
        yad build step <story> --repo <repo> <step> done --via auto --run <uid> {--task <T>}   # the closing record; currentStep moves on
        checkpoint; if step == checks: OPEN_PR; continue  # Step B advance
    else:  # "human"
        yad build step <story> --repo <repo> <step> done --run <uid> {--task <T>}
        checkpoint; if step == checks: OPEN_PR; STOP and report "waiting for human at <next>"

# OPEN_PR — checks closed for a task, by either dial: open its PR/MR (#356)
if `yad dial open-pr --json`.advance == "auto":
    yad open-pr --via auto            # from the task branch; refuses unless the checks step is closed now
                                      #   and each task the commits carry (a group, #350) has its newest
                                      #   close (--task above) with a run that passed and was not rejected;
                                      #   records `opened` on the lane, once per task
else:
    STOP and ask the person to approve opening it; then `yad open-pr`

# {--task <T>}: REQUIRED on the implement and checks legs, left out on spec and tasks. <T> is the `task`
# input, else the task `yad-implement` worked on. Without it the checks close names no task, and
# `yad open-pr --via auto` refuses it.

# reached engineer-review: always stop, hand to yad-engineer-review (human gate, finalizes the verdict)
```

`closed` is the step's **closing record** (E18): who wrote it, when, and how the lane moved past the
step. `via: "auto"` means the dial let the run go on by itself; `via: "human"` means it stopped for a
person. `run` is the `uid` of the trust-log shard this run wrote, so the record points at the evidence.
`by` is the login `gh api user` / `glab api user` reports, else git `user.name`, else `null`
(`YAD_PLATFORM_LOGIN=0` turns the lookup off).
Write it only when you write `done`, and never over a `closed` already on the step.

`ranBy` is `machine` when the *previous* step's effective dial caused this step to run without a human
nudge; otherwise `human`. Persist build-state after every transition so a halt leaves an accurate,
resumable record.

`checkpoint` = ask the person, then run `yad checkpoint --push` from `{project-root}` (it pushes to the default
branch, which an agent asks about every time, E158). It commits the machine-written
Build ledgers (in this loop, the loose `trust-log/` shards this run wrote + `build-state/<story>.json`;
also the `build-log/` shards at engineer-review) — the shard dirs are what checkpoint stages, the same
way `git gc` folds loose objects later (`yad tidy up` folds finished shards into the folded
`trust-log.json` / `build-log.json`) — plus any story `status:` flip (→ in-build/shipped) once that
story has a build-log ship (#112) — as one
`chore(product): sync Build state — <epic>/<story> by @<login> [skip ci]`
audit-trail commit (`@<login>` when the platform login is known, else the git `user.name`, else `unknown`), on the default branch only,
staging *only* those files by an explicit allowlist (never a Shape gate file — so `ledger-guard`
never trips). It is idempotent (a no-op when nothing changed), so calling it after every transition —
including a halt — is safe and keeps the shared trust evidence current for CI, teammates, and
the `yad-status` skill on other machines. It refuses to run off the default branch (an unsigned `[skip ci]`
commit inside a future PR range would fail `verified-commits` and strand the PR).

## Effective dial (the kill switch and gates always win)

```
eff = (yad dial <epic> <story> --repo <repo> <step> --json).advance    # "human" | "auto"
```

The engine reads the lane step's dial under either spelling (the OLD name wins), and answers `human`
when the step is a gate (`engineer-review`) or the kill switch in `.sdlc/automation.json` is on — whatever
the dial says. Its `why` says which: `lane`, `gate`, `kill` or `unknown` (a step id this release does not know), and `automationError` is present when the file cannot be read.

## Deriving signals & the provisional verdict

`signals` are the raw facts of the run; the **provisional `verdict`** is derived from them. The human
gate for each step (the engineer review at `yad-engineer-review` for `implement`; spec acceptance for `spec`;
first-consume for `tasks`; the gate itself for `checks`) later confirms or overrides the verdict and
finalizes the entry — a human always has the last word on the trust signal.

`signals` (only the relevant ones are set per step — see the table in
`../yad-epic/references/state-schema.md`):
- `checks` — `pass` | `fail` | `n/a` (only the `checks` step runs the three gates).
- `human_edited_diff` — `true` if a human changed the produced **diff** before merge (`implement`).
- `human_edited_spec` — `true` if a human edited the generated **spec/plan/tasks** before accepting (`spec`).
- `task_rescoped` — `true` if a task's declared `Files:`/scope was edited before implementing (`tasks`).
- `scope_overrun` — `true` if `yad-implement` stopped on the file-boundary rule (diff outside the
  task's declared files).
- `contract_touch` — `true` if the diff touched the locked contract surface without an upstream
  re-lock (routes back to the architecture gate).

`derive_verdict(signals)` — the same three-way shape for every Build step:
```
edited = human_edited_diff or human_edited_spec or task_rescoped
if checks == "fail" or scope_overrun or contract_touch:   verdict = "rejected"
elif edited:                                              verdict = "approved-with-edits"
else:                                                     verdict = "approved-unchanged"
```

This is the **provisional** verdict from the recorded signals. The human gate that finalizes the entry
may also override it to `rejected` — e.g. the human discards/regenerates the spec or the task list, or
rejects the diff at the engineer review for a reason no signal captured. A human override always wins.

Rationale: the trust log should count an output as fully trustworthy (`approved-unchanged`) only when
the machine's work was accepted as-is. Any human correction is `approved-with-edits` (useful, and a sign
the step still wants a person); any failure or boundary breach is `rejected`.

## The run record as advice (E34)

`yad dial` prints a step's record when someone sets its dial, and whenever it is asked with no `--to`:

```
all   = trust-log.json.runs + [read each file in trust-log/]   # UNION; every shard is a distinct run
slice = entries in `all` for this step in this repo
runs  = len(slice)
unchanged = count(e.verdict == "approved-unchanged" in slice)
```

It is **advice, never a rule.** There is no threshold and no refusal: the team decides whether a step
runs on auto, and the record is what they read to decide. A step with no runs says so — no evidence either
way is not evidence against.

Reverting (`--to human`) and the kill switch are always one move.

## What stays human, always

- `engineer-review` — the merge gate. `yad-run` always stops here and hands to `yad-engineer-review`.
  Opening a task's PR/MR asks a person too, unless the project gave a standing approval with
  `yad dial open-pr --to auto` (#356) — the kill switch holds it at human.
  The merge stays a person's; whether it happened is asked of the platform with
  `yad build merged <story> --task <T> --repo <r> --ship` (#355) — never waited for in chat.
- The Shape steps — this loop never drives them. A Shape author step's dial may be set to auto for the
  project (`yad dial <step> --to auto`), and is only recorded until the engine runs agents (E26); every
  Shape review gate is a person.
- Any contract-surface change — halts the loop and routes back to the architecture gate, regardless of
  the dial.
