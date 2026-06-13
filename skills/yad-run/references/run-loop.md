# `yad-run` — the loop, the trust verdict, the threshold

This is the detail behind `SKILL.md`. It restates the orchestration so the skill is self-contained,
and pins down the two judgments the skill makes: **what trust verdict to record** and **when a step
has earned `machine_advance`**.

## The back-half steps

From `config.yaml` `automation.back_steps` plus the human merge gate:

```
spec → tasks → implement → checks → engineer-review(locked)
```

`spec` and `tasks` are the two legs of `yad-spec` (the heavy ceremony, then the atomic `tasks.md`).
`implement` is one atomic task via `yad-implement`. `checks` is `yad-checks (action: run)`.
`engineer-review` is the human gate at `yad-ship` — always a stop, never automated.

## The loop (pseudocode)

```
cfg   = config.yaml.automation
bs    = build-state/<story>.json.repos[<repo>]        # create from defaults if absent
step  = from or bs.currentStep

while step is a back step (not engineer-review):
    result = run_step_skill(step)                     # yad-spec | yad-implement | yad-checks

    signals = derive_signals(step, result)            # see "Deriving signals"
    verdict = derive_verdict(signals)                 # rejected | approved-with-edits | approved-unchanged
    append trust-log entry { story, repo, step, automation: bs.step.automation,
                             verdict, signals, ranBy, date }

    eff = effective_dial(step, bs, cfg)               # see "Effective dial"

    if result is a HALT (failed / scope overrun / contract touch / ambiguous):
        bs.step.status = "blocked"; persist; STOP and report the human action needed
    elif eff == "machine_advance":
        bs.step.status = "done"; advance bs.currentStep to next; persist; continue   # Step B advance
    else:  # human_approve
        bs.step.status = "done"; persist; STOP and report "waiting for human at <next>"

# reached engineer-review: always stop, hand to yad-ship (human gate, finalizes the verdict)
```

`ranBy` is `machine` when the *previous* step's effective dial caused this step to run without a human
nudge; otherwise `human`. Persist build-state after every transition so a halt leaves an accurate,
resumable record.

## Effective dial (kill switch & locks always win)

```
eff = bs.step.automation                 # human_approve | machine_advance
if cfg.kill_switch == true:        eff = "human_approve"
if bs.step.locked == true:         eff = "human_approve"
if step in cfg.locked_steps:       eff = "human_approve"
```

So a kill switch, a `locked` flag, or membership in `locked_steps` forces a stop no matter what the
per-step dial says. `engineer-review` and the five front states are covered by `locked` / `locked_steps`.

## Deriving signals & the provisional verdict

`signals` are the raw facts of the run; the **provisional `verdict`** is derived from them. The human
gate for each step (the engineer review at `yad-ship` for `implement`; spec acceptance for `spec`;
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

`derive_verdict(signals)` — the same three-way shape for every back step:
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
the machine's work was accepted as-is. Any human correction is `approved-with-edits` (useful but not
yet trustworthy enough to automate); any failure or boundary breach is `rejected`.

## The trust threshold (when a step is earned)

A step is a **candidate** for `machine_advance` only when its trust evidence clears
`config.yaml` `automation.trust_threshold`. `set-dial` enforces this predicate before flipping a step
to `machine_advance`:

```
slice = trust-log entries for this step (this story's repo; widen to the project if you track it there)
runs  = len(slice)
unchanged = count(e.verdict == "approved-unchanged" in slice)
earned = runs >= trust_threshold.min_runs
         AND (unchanged / runs) >= trust_threshold.min_approved_unchanged
```

Defaults: `min_runs: 5`, `min_approved_unchanged: 0.8`. If `earned` is false, `set-dial` refuses and
reports `runs`, the `unchanged/runs` fraction, and how far short of the bar it is.

Reverting (`to: human_approve`) is never gated — automation must be reversible in one move.

## What stays human, always

- `engineer-review` — the merge gate. `yad-run` always stops here and hands to `yad-ship`.
- The five front states (`epic`, `architecture`, `ui-design`, `stories`, `test-cases`) — not in
  `back_steps`, in `locked_steps`; the dial-setter refuses them.
- Any contract-surface change — halts the loop and routes back to the architecture gate, regardless of
  the dial.
