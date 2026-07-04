---
name: yad-implement
description: 'Build-half Step B of the gated SDLC. With the dev lens, implement ONE atomic task from a story''s Spec Kit tasks.md as a small diff (≤3 files) on its own branch in the code repo. The diff stays inside the files the task declared — flag and STOP if it would grow beyond them. Commit per convention, ending with the task ID; add Contract-Change: yes only if the diff touches the locked contract surface (which routes back to the architecture gate). The step never advances itself; it produces a committed branch and hands off to the check gates, which the orchestrator (yad-run) may auto-run once `implement` is earned to machine_advance (Phase 4b Step D) — the merge still needs the gates and the engineer review. Use when the user says "implement task <id>" or after a story is spec''d.'
---

# SDLC — Implement Task (build-half Step B)

**Goal:** Turn ONE atomic task from a story's `tasks.md` (produced by Step A `yad-spec`) into a small,
reviewable diff on its own branch in the code repo. **One atomic task = one branch = one PR/MR**
(build plan §B). This is the **light per-task loop**: it runs once per task; the heavy spec ceremony
already ran once for the story.

This step **never auto-advances**. When the task is implemented and committed, control passes to the
**check gates** (Step C — `yad-checks`: spec-link, contract-check, build/test/lint) and then human/AI
review (Steps D–E, not built yet). Implementation here produces a branch + commit and stops.

The implementing lens is **`dev`** (`bmad-agent-dev`, Amelia). The dev writes only what the task
declares; it does not redesign, does not widen the contract, and does not pick up sibling tasks.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo.
- The work happens **inside the code repo** (a separate git repo) at
  `{project-root}/demo-repos/<repo>/` (`config.yaml` `build.code_repos_root`). Use absolute paths.
- **Branch name:** `feat/<story-id>-<task-id>-<short-slug>` (e.g.
  `feat/EP-istifta-inquiries-S01-T01-create-inquiry`). Branched off the code repo's default branch.
- **Commit message:** a conventional subject, body describing the change, and a **required `Task:`
  trailer** (e.g. `Task: EP-istifta-inquiries-S01-T01`) in the trailer block. Add `Contract-Change: yes`
  **only** if the diff touches the locked contract surface (see Step 5), and a per-commit
  `Co-Authored-By:` for any AI tool that helped author the diff (the human author owns the commit;
  trailer order `Task:` → `Contract-Change:` → `Co-Authored-By:`). The skill installs a `.gitmessage`
  template that scaffolds these (Step 2).
- Speak in the configured `communication_language`; write code/comments in `document_output_language`.

## Inputs

- `epic`  — the `EP-<slug>` (ask if not provided).
- `story` — the `EP-<slug>-S0N` whose spec is being implemented (ask if not provided).
- `repo`  — the code repo the story's spec lives in (one of the story's `repos`).
- `task`  — the ONE atomic task ID to implement, e.g. `T01` (ask if not provided).

## On Activation

### Step 1 — Resolve the spec and the task
Read `demo-repos/<repo>/specs/<story>/tasks.md`. Find the block for `<task>` (`## <task> — …`). Read
its one-line goal and its **Files:** list (the declared file boundary) and the acceptance criterion it
satisfies. If the task ID is not in `tasks.md`, STOP. Confirm the spec exists (Step A ran); if not,
STOP and point at `yad-spec`.

### Step 2 — Resolve the code repo and branch
Confirm `demo-repos/<repo>/` is its own git repo (`.git` present). From its default branch, create the
task branch `feat/<story>-<task>-<short-slug>`. If a branch for this task already exists, reuse it
rather than forking a second one (one task = one branch).

**On the first implement in a repo, install the commit template** (idempotent): copy this skill's
`templates/.gitmessage` to `<repo>/.gitmessage` and run `git -C <repo> config commit.template .gitmessage`
so every commit is pre-scaffolded with the `Task:` trailer and the commented per-commit `Co-Authored-By:`
choices (`config.yaml` `build.ai_coauthor.allowed`). Do the same at the hub root for hub commits. Skip if
already configured.

### Step 3 — Read the spec inputs (do NOT re-derive the contract)
Read the story's `spec.md`, `plan.md`, `data-model.md`, and `contracts/` for this task's context. The
contract slice is **quoted** from the product repo's locked `contract.md` — implement to it, never
change it here.

### Step 4 — Implement the task (dev lens), inside the declared files ONLY
Adopt the **dev** lens. Implement the task's goal so it satisfies its acceptance criterion, touching
**only the files in the task's `Files:` list** (≤3 where possible). Write real, working code — tests
must exercise behavior, not just pass (build plan §C). **Before committing, run a smoke or test that
actually exercises the task's acceptance criterion** — the task is not done until the criterion is
demonstrably met (record the result in the Step 7 report).

**File-boundary rule (hard):** if the implementation genuinely needs a file **not** in the declared
list, **flag and STOP** — do not silently widen the diff. Report the extra file(s) needed so the
task's spec can be corrected (re-run `yad-spec` / re-scope the task) before implementing. A task whose
declared files are wrong is a spec bug, not an implementation decision.

This stop is a **scope overrun** — a halt condition that pulls in a human regardless of any automation
dial. When this step is driven by the orchestrator (`yad-run`, Phase 4), the stop must be legible to
it: mark the `implement` step `status: blocked` in `build-state/<story>.json` and surface
`scope_overrun: true` so the run records a `rejected` trust entry and halts (it never advances past a
boundary breach). The same applies to the Step 5 contract-surface stop (`contract_touch: true`).

### Step 5 — Contract-surface check (local pre-flight for Step C)
Determine whether the diff touches the **locked contract surface** (the API/event/data-model shapes in
`epics/<epic>/contract.md`'s `CONTRACT-SURFACE` block). Normal implementation **consumes** the
contract (e.g. implementing `POST /inquiries` to the agreed shape) — that is **not** a contract change.
A contract change means the diff alters the agreed cross-repo shape itself.

- If the diff does **not** change the surface: proceed; no `Contract-Change` trailer.
- If the task **requires** changing the surface: **flag and STOP**. The contract is owned upstream;
  route back to the **architecture gate** to amend and re-lock `contract.md` first. Only then return
  here, and record `Contract-Change: yes` in the commit body (the Step C contract-check will require a
  matching, already-updated contract).

### Step 6 — Commit on the task branch
Stage only the declared files. Commit with the convention: a conventional subject, a short body, and a
`Task: <story>-<task>` trailer (plus `Contract-Change: yes` if Step 5 applies). The human author owns the
commit; **no `Co-Authored-By:` footer by default** — add one only when the human explicitly asks
(`yad commit --ai <id>` / the `.gitmessage` choices from `config.yaml` `build.ai_coauthor.allowed`),
never on the AI's own initiative. Keep all trailers in one contiguous block. Do not commit sibling tasks' work.

### Step 7 — Report; the advance decision belongs to the dial (Phase 4)
Report: the branch name, the files changed, how the change satisfies the task's acceptance criterion,
the result of any test/smoke run, and the next action — the **check gates** (Step C — `yad-checks`)
then the PR and review (Steps D–E). Do **not** open a PR, merge, or hand-edit the epic's front-half
`state.json`. Step B ends at a committed task branch.

- **Run standalone:** stop here; a human triggers the gates.
- **Run by the orchestrator** (`yad-run`): this skill still just produces the committed branch and
  signals success (or a scope/contract halt). The orchestrator records the `implement` step's status
  and trust entry and, when `implement` is earned to `machine_advance` (Step D, Phase 4b), **auto-runs
  the check gates** instead of waiting for a manual nudge. The diff still cannot merge without the
  gates passing and the engineer review — Step D removes only the "now run the gates" hand-off.

### Step 8 — Record the `tasks` trust signal on first consume (Phase 4b)
Resolving a task from `tasks.md` (Step 1) is the moment the generated task list "survives contact" —
the evidence that could later earn the `tasks` step a `machine_advance`. When driven by `yad-run`,
finalize a `tasks` trust entry, anchored to what the human/dev actually did with the list:
- the task is implemented with its declared `Files:`/scope **as generated** → `approved-unchanged`;
- the task is **re-scoped** first (its `Files:`/boundary edited) → `approved-with-edits`
  (signal `task_rescoped: true`);
- the task list is discarded / regenerated → `rejected`.
Write the entry to its own shard `epics/<epic>/.sdlc/trust-log/<story>-<repo>-tasks-<uid>.json` (a fresh
`uid` per run, so concurrent writers never conflict; readers union the folded `trust-log.json` + the
loose shards, skipping any shard whose full `(story, repo, step, uid)` already appears folded — a
half-applied `yad tidy up` — so entries are never double-counted). Schema: `../yad-epic/references/state-schema.md`. `tasks` stays `human_approve` until its slice clears
the threshold — this only *gathers* evidence. (The `implement` step's own verdict is finalized later,
at the engineer review in `yad-engineer-review`: merged as authored → `approved-unchanged`; edited first →
`approved-with-edits`; scope/contract/checks halt → `rejected`.)

## Hard rules (build plan §B, Cross-cutting)

- **One atomic task = one branch = one PR/MR.** Never bundle tasks; never exceed the declared files.
- **Light loop per task.** Do not re-run the heavy spec ceremony; that already ran once in Step A.
- **Never widen the contract here.** Surface changes go back to the architecture gate (Step 5).
- **The step never advances itself.** A scope overrun or contract touch always halts. The
  `implement → checks` hand-off advances only when the orchestrator's `implement` dial is
  `machine_advance` (earned, Step D) — and never past the engineer review, which is always human.
  Standalone, the step stops at a committed branch.

## Reference
- Branch/commit conventions, the file-boundary rule, the Contract-Change rule: `references/implement-conventions.md`.
- The task list this step consumes: Step A's `references/spec-handoff.md` (`../yad-spec/...`).
- Contract surface + hash recipe: `../yad-architecture/references/contract-format.md`.
