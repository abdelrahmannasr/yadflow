---
name: sdlc-implement
description: 'Build-half Step B of the gated SDLC. With the dev lens, implement ONE atomic task from a story''s Spec Kit tasks.md as a small diff (≤3 files) on its own branch in the code repo. The diff stays inside the files the task declared — flag and STOP if it would grow beyond them. Commit per convention, ending with the task ID; add Contract-Change: yes only if the diff touches the locked contract surface (which routes back to the architecture gate). Never auto-advances — hands off to the check gates. Use when the user says "implement task <id>" or after a story is spec''d.'
---

# SDLC — Implement Task (build-half Step B)

**Goal:** Turn ONE atomic task from a story's `tasks.md` (produced by Step A `sdlc-spec`) into a small,
reviewable diff on its own branch in the code repo. **One atomic task = one branch = one PR/MR**
(build plan §B). This is the **light per-task loop**: it runs once per task; the heavy spec ceremony
already ran once for the story.

This step **never auto-advances**. When the task is implemented and committed, control passes to the
**check gates** (Step C — `sdlc-checks`: spec-link, contract-check, build/test/lint) and then human/AI
review (Steps D–E, not built yet). Implementation here produces a branch + commit and stops.

The implementing lens is **`dev`** (`bmad-agent-dev`, Amelia). The dev writes only what the task
declares; it does not redesign, does not widen the contract, and does not pick up sibling tasks.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo.
- The work happens **inside the code repo** (a separate git repo) at
  `{project-root}/demo-repos/<repo>/` (`config.yaml` `build.code_repos_root`). Use absolute paths.
- **Branch name:** `feat/<story-id>-<task-id>-<short-slug>` (e.g.
  `feat/EP-istifta-inquiries-S01-T01-create-inquiry`). Branched off the code repo's default branch.
- **Commit message:** a conventional subject, body describing the change, and a **final trailer line
  that is the task ID** (e.g. `Task: EP-istifta-inquiries-S01-T01`). Add `Contract-Change: yes` in the
  body **only** if the diff touches the locked contract surface (see Step 5).
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
STOP and point at `sdlc-spec`.

### Step 2 — Resolve the code repo and branch
Confirm `demo-repos/<repo>/` is its own git repo (`.git` present). From its default branch, create the
task branch `feat/<story>-<task>-<short-slug>`. If a branch for this task already exists, reuse it
rather than forking a second one (one task = one branch).

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
task's spec can be corrected (re-run `sdlc-spec` / re-scope the task) before implementing. A task whose
declared files are wrong is a spec bug, not an implementation decision.

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
final `Task: <story>-<task>` trailer (plus `Contract-Change: yes` if Step 5 applies). Do not commit
sibling tasks' work.

### Step 7 — Stop (no auto-advance)
Report: the branch name, the files changed, how the change satisfies the task's acceptance criterion,
the result of any test/smoke run, and that the next action is the **check gates** (Step C —
`sdlc-checks`) then the PR and review (Steps D–E, not built yet). Do **not** open a PR, merge, or touch
the epic's `.sdlc/` state. Step B ends at a committed task branch.

## Hard rules (build plan §B, Cross-cutting)

- **One atomic task = one branch = one PR/MR.** Never bundle tasks; never exceed the declared files.
- **Light loop per task.** Do not re-run the heavy spec ceremony; that already ran once in Step A.
- **Never widen the contract here.** Surface changes go back to the architecture gate (Step 5).
- **Nothing auto-advances.** Step B stops at a committed branch; gates and review are separate steps.

## Reference
- Branch/commit conventions, the file-boundary rule, the Contract-Change rule: `references/implement-conventions.md`.
- The task list this step consumes: Step A's `references/spec-handoff.md` (`../sdlc-spec/...`).
- Contract surface + hash recipe: `../sdlc-author-architecture/references/contract-format.md`.
