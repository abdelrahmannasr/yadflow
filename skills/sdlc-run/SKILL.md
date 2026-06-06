---
name: sdlc-run
description: 'Phase 4 (automation) — the orchestrator that makes the second dial real. Drives a story''s back-half loop (spec → tasks → implement → checks) in one code repo, reading each step''s automation dial from build-state: on machine_advance it advances on its own, on human_approve it stops for a human. Records every run in the trust log (the evidence base for earning automation). Realizes Step B: when checks is earned, a clean gate pass auto-advances to engineer-review; any failure, scope overrun, or contract-surface touch HALTS and pulls in a human. Also sets a step''s dial (gated by trust evidence) and flips the system-wide kill switch. Never advances a front state or the engineer review. Use when the user says "run the build half", "advance story <id>", "set the checks dial", or "kill switch".'
---

# SDLC — Run (Phase 4 orchestrator)

**Goal:** Be the **engine** that the `automation` dial finally drives. Until Phase 4 the dial was inert
config; this skill reads it and acts. For ONE story in ONE code repo, walk the back-half steps —
`spec → tasks → implement → checks → engineer-review` — and at each step either **advance on its own**
(dial `machine_advance`, step succeeded) or **stop for a human** (dial `human_approve`, or any halt
condition). Every run is recorded in the **trust log**, the evidence that earns a step its automation.

This is the most dangerous skill in the system, so it is built to **halt-and-escalate over guess**:
a failing check, ambiguity, a scope overrun, or a contract-surface touch stops the loop and pulls in a
human regardless of any dial. The **front states and the engineer review never auto-advance** — they
are not in `automation.back_steps` and `engineer-review` is `locked`.

Phase 4a earns exactly one step: **`checks`** (Step B — the safest, because a gate's pass/fail was
never human judgment). `tasks` and `implement` advance are Phase 4b; their dials exist but stay
`human_approve` until earned.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo (source of
  truth: it holds the story, the build-state, and the trust log).
- Code repos are separate git repos under `{project-root}/demo-repos/<repo>/`
  (`config.yaml` `build.code_repos_root`). Operate inside them with absolute paths.
- Automation config is `skills/sdlc/config.yaml` → `automation:` (`back_steps`, `default`,
  `trust_threshold`, `locked_steps`, `kill_switch`).
- Per-story build-half state: `epics/<epic>/.sdlc/build-state/<story-id>.json` (per repo).
- Trust ledger: `epics/<epic>/.sdlc/trust-log.json` (append-only). Schemas:
  `../sdlc-author-epic/references/state-schema.md`.
- The orchestrator **calls the existing step skills unchanged** — `sdlc-spec` (A), `sdlc-implement`
  (B), `sdlc-checks` (C). It owns only the *advance decision*, never what a step does.

## Inputs

- `epic` / `story` / `repo` — the story and code repo to drive (ask if not provided).
- `action` — `run` (default) | `set-dial` | `kill` | `unkill`.
- For `run`: optional `from` (the step id to start at; default the repo's `currentStep` in
  build-state) and `task` (the atomic task id for the `implement`/`checks` legs).
- For `set-dial`: `step` (a `back_steps` id), `to` (`human_approve` | `machine_advance`).

## On Activation

### Step 0 — Load state
Read `config.yaml` `automation`, the story's `build-state/<story>.json` (create it from the
`back_steps` defaults if absent — all `human_approve`, `engineer-review` `locked:true`), and
`trust-log.json` (treat missing as `[]`). Resolve the code repo.

### `action: run` — drive the loop
Walk the steps for `repo` starting at `from`/`currentStep`. For each step:

1. **Run the step's skill** — `spec`→`sdlc-spec`, `tasks`→ the tasks leg of `sdlc-spec`,
   `implement`→`sdlc-implement`, `checks`→`sdlc-checks (action: run)`. Capture its result.
2. **Derive trust signals & append a trust-log entry** (`ranBy: machine` if this advance was
   automated, else `human`) — see `references/run-loop.md` for the derivation. Do this for *every*
   step run, pass or fail; the log is the evidence base.
3. **Compute the effective dial.** Start from the step's `automation` in build-state, then **force it
   to `human_approve`** if `automation.kill_switch` is true OR the step is `locked` OR the step id is
   in `automation.locked_steps`. (So a kill switch or a lock always wins.)
4. **Decide:**
   - **HALT** if the step failed — any check FAIL, a scope overrun (`sdlc-implement` stopped on the
     file-boundary rule), a contract-surface touch, or any ambiguity. Set the step `status: blocked`,
     write the `rejected` trust entry, **stop the loop**, and report what a human must resolve.
   - else if effective dial is **`machine_advance`** → set the step `done`, advance `currentStep` to
     the next step, and **continue the loop** (this is the Step B auto-advance for `checks`).
   - else (**`human_approve`**) → set the step `done`/`in_review`, **stop** and report
     "waiting for a human at `<next-step>`".
5. **Always stop at `engineer-review`** (it is `locked`): hand off to `sdlc-ship` for the human merge
   gate, which finalizes the trust verdict (confirm/override the provisional one).

### `action: set-dial` — earn (or revert) a step's automation
Flip `step`'s `automation` to `to` in build-state. Enforce, in order:
- **Refuse** if `step` is in `automation.locked_steps` or is a front state or `engineer-review` —
  these can never be `machine_advance` (front-state lock, build plan §E). Report the refusal reason.
- For `to: machine_advance`, **refuse unless the trust threshold is met**: the step's slice of
  `trust-log.json` has `>= trust_threshold.min_runs` entries AND the fraction with
  `verdict == "approved-unchanged"` is `>= trust_threshold.min_approved_unchanged`. If it is not met,
  report the current evidence (runs, % unchanged) and how far short it is — "it seems fine" is not
  evidence.
- `to: human_approve` is **always allowed** (reverting automation is one move, never gated).

### `action: kill` / `action: unkill` — the kill switch
Set `automation.kill_switch` to `true` (`kill`) or `false` (`unkill`) in `config.yaml`. While true,
**every** step's effective dial is `human_approve` system-wide — no per-step edits, instantly
reversible (build plan §Safety). Report the new state and that `sdlc-status` will show it.

## Hard rules (phase-4-build-plan.md)

- **Earned per step, with evidence.** A step goes `machine_advance` only after its trust log clears
  the threshold; `set-dial` enforces it.
- **Reversible in one move.** `human_approve` is never gated; the kill switch reverts everything with
  one command and no code change.
- **Halt-and-escalate beats guess.** A failing check, ambiguity, scope overrun, or contract-surface
  touch halts the loop and pulls in a human, regardless of the dial.
- **Front states and the engineer review never auto-advance.** They are not in `back_steps`;
  `engineer-review` is `locked`; the kill switch and locks always override the dial.
- **The orchestrator never changes what a step does** — it calls the existing skills and owns only the
  advance decision and the trust record.

## Reference
- The loop, the trust-verdict derivation, and the threshold predicate: `references/run-loop.md`.
- State/trust schemas: `../sdlc-author-epic/references/state-schema.md`.
- The steps it drives: `../sdlc-spec/`, `../sdlc-implement/`, `../sdlc-checks/`; the human gate it
  hands off to: `../sdlc-ship/`.
