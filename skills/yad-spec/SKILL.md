---
name: yad-spec
description: 'Build-half Step A of the gated SDLC. For one ready-for-build story and one of its repos, run the heavy Spec Kit ceremony ONCE (specify → clarify → plan → analyze → checklist → tasks) inside that code repo, writing specs/<story-id>/ in Spec Kit''s own layout. Drives /speckit.* as harness slash-commands when installed; authors the same files by hand and records speckit: not-installed when absent. References the locked contract — never re-invents the surface. Writes link.md back to the story. Never auto-advances. Use when the user says "spec story <id> in <repo>" or after a story is ready-for-build.'
---

# SDLC — Author Spec (build-half Step A)

**Goal:** Turn ONE `ready-for-build` story into a per-repo Spec Kit spec/plan/tasks inside that
story's code repo. The heavy spec ceremony runs **once per story per repo**; the light
tasks → implement loop is **Step B** (`yad-implement`). This step **never re-locks the contract** —
the cross-repo surface is owned upstream by the architecture gate (build plan §A, Cross-cutting
"Heavy spec once per story, light loop per task"). It does not advance the front-half state machine;
when driven by the orchestrator (`yad-run`, Phase 4) it records a `spec`/`tasks` trust signal
(Step 8) — but it never auto-advances a contract change or a front state.

Spec Kit is driven as **harness slash-commands** (`/speckit.*`), not a subprocess CLI (Phase 0
Deviation 3). When Spec Kit is not installed, the same files are hand-authored in Spec Kit's exact
layout and the spec is marked `speckit: not-installed` — the workflow does not block on the tool. This
is the same graceful-degradation pattern `yad-ui` uses for Impeccable.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo (epic
  "thinking" + per-epic `.sdlc/` state live here).
- **Code repos are separate git repos**, one `.git` each, under `{project-root}/demo-repos/<repo>/`
  (`config.yaml` `build.code_repos_root`). All Spec Kit outputs land **inside the code repo**, never
  in the product repo.
- `{feature-id}` is the **story ID** (e.g. `EP-istifta-inquiries-S01`) — **pinned**, never Spec Kit's
  numbered auto-slug (which is unstable and severs the permanent story link). The spec folder is
  `specs/<story-id>/`.
- Spec Kit output layout (RESEARCH-NOTES §2): `specs/<feature-id>/spec.md` (+ `research.md`,
  `data-model.md`, `contracts/`), `plan.md`, `tasks.md`; constitution at `.specify/memory/constitution.md`.
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `epic`  — the `EP-<slug>` to operate on (ask if not provided).
- `story` — the ONE story to spec, `EP-<slug>-S0N` (ask if not provided).
- `repo`  — one entry from that story's `repos` (the ONE repo to spec; ask if the story lists more
  than one).

## On Activation

### Step 1 — Resolve the story and check readiness
Read `{project-root}/epics/<epic>/.sdlc/state.json`. Proceed only when
`currentStep == "ready-for-build"` (the gating front half — through the **stories** gate — is `done`).
The **`test-cases` track may still be `in_progress`**: it is parallel and non-blocking, so the build
half runs alongside it — its status does not affect readiness here. Read the story file
`epics/<epic>/stories/<story>.md`; confirm `repo` is in its `repos`. If the epic is not ready, STOP
and point the user at `yad-status`. **Do not mutate front-half state** — `ready-for-build` semantics
stay intact.

### Step 2 — Resolve the target code repo
Map `repo` → `{project-root}/demo-repos/<repo>/`. Confirm it exists and is its own git repo
(`demo-repos/<repo>/.git` present). If missing, STOP and point the user at `demo-repos/README.md`
(how to regenerate the throwaway repo). Operate **inside this repo** with absolute paths.

### Step 3 — Read the contract (reference, do NOT re-invent)
Read `epics/<epic>/contract.md` and `epics/<epic>/.sdlc/contract-lock.json`. The spec's contract
inputs (the API shapes, data-model entities, and events the story touches) are **quoted from the
locked surface**, not re-authored. The spec MUST stay within that surface. If the story needs surface
the contract does not define, STOP and route back to the **architecture gate** — never extend the
contract here.

### Step 4 — Detect Spec Kit
Check for `/speckit.*` slash-commands and/or `demo-repos/<repo>/.specify/`. Record the result for
Step 6's frontmatter (`speckit: installed | not-installed`).

### Step 5 — Run the heavy ceremony ONCE (or degrade)
**Installed** — from inside `demo-repos/<repo>/`, drive, in order:
`/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.analyze` →
`/speckit.checklist` → `/speckit.tasks`. **Pin the feature to `<story>`** (do not accept an
auto-slug). Seed `specify` from the story's acceptance criteria and the contract elements from Step 3.
`/speckit.constitution` and `/speckit.implement` are **out of scope for Step A** (implement is Step B).

**Not installed (degrade)** — hand-author the identical files in Spec Kit's layout under
`demo-repos/<repo>/specs/<story>/`: `spec.md`, `research.md`, `data-model.md`, `contracts/`,
`plan.md`, `tasks.md`. The content is what a real Spec Kit run would produce, traceable to the story's
acceptance criteria and the locked contract surface. `tasks.md` MUST be numbered atomic tasks (`T01…`),
each declaring the files it may touch, so Step B's "stay inside the declared files" rule has something
to read. See `references/spec-handoff.md` for the exact file map and per-file degradation rules.

### Step 6 — Write link.md back to the story
Write `demo-repos/<repo>/specs/<story>/link.md` (template in `references/spec-handoff.md`) with
frontmatter linking the spec back to the product repo: `story`, `epic`, `repo`, `feature-id`,
`product-repo` (path), `contract-lock` (the hash **copied** from `contract-lock.json`, NOT recomputed
in the code repo), `speckit` (`installed | not-installed`), `generated` (date). This `link.md` plus the
spec folder is the authoritative record that this story's spec exists.

### Step 7 — Stop (front-half state untouched)
Report: the spec folder path, the files written, whether Spec Kit was used, the task count from
`tasks.md`, and that the next action is **Step B — `yad-implement`**. Do **not** edit the epic's
`state.json`, `approvals.json`, or `contract-lock.json`. Step A is a generation step, not a front gate.

### Step 8 — Record the `spec` trust signal (Phase 4b)
When this step runs under the orchestrator (`yad-run`), the generated spec is a back-half run that the
trust log measures (it is the evidence that could later earn the `spec` step a `machine_advance`). The
verdict is **anchored to the human who accepts the spec**, never self-graded:
- the human approves the generated `specs/<story>/` untouched → `approved-unchanged`;
- the human edits the spec/plan/tasks before accepting → `approved-with-edits` (signal
  `human_edited_spec: true`);
- the spec is rejected or the ceremony re-run → `rejected`.
`yad-run` records a provisional entry when the spec is generated; this acceptance finalizes it (same
pattern as the engineer review finalizing `implement` at `yad-ship`). Append the finalized entry to
`epics/<epic>/.sdlc/trust-log.json` (schema:
`../yad-epic/references/state-schema.md`). **Run standalone, no trust entry is written** — the
log measures orchestrated runs. `spec` stays `human_approve` until its slice clears the threshold;
this step only *gathers* the evidence, it does not flip the dial.

## Hard rules (build plan §A, Cross-cutting)

- **Heavy spec once per story, not per task.** specify/clarify/plan/analyze/checklist/tasks run once
  per story per repo. Do not re-run the ceremony for each task.
- **Per-repo spec, shared contract.** Spec/plan/tasks live in the code repo; the contract stays
  singular in the product repo. Never widen the contract surface from here.
- **Nothing auto-advances.** Step A generates files and stops; no state machine is advanced.

## Reference
- Command list, output map, degradation rules, link.md template: `references/spec-handoff.md`.
- Contract surface format + hash recipe: `../yad-architecture/references/contract-format.md`.
- Spec Kit facts and the slash-command-vs-CLI deviation: `RESEARCH-NOTES.md` §2 + Phase 3 decisions + Deviation 3.
