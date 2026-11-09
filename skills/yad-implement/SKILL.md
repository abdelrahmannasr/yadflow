---
name: yad-implement
description: 'Build Step B of the gated SDLC. With the dev lens, implement ONE atomic task from a story''s Spec Kit tasks.md as a small diff (≤3 files) on its own branch in the code repo. The diff stays inside the files the task declared — flag and STOP if it would grow beyond them. Commit per convention, ending with the task ID; add Contract-Change: yes only if the diff touches the locked contract surface (which routes back to the architecture gate). The step never advances itself; it produces a committed branch and hands off to the check gates, which the orchestrator (yad-run) may auto-run once the team sets `implement` to `advance: auto` (`yad dial`) — the merge still needs the gates and the engineer review. Use when the user says "implement task <id>" or after a story is spec''d.'
---

# SDLC — Implement Task (Build Step B)

**Goal:** Turn ONE atomic task from a story's `tasks.md` (produced by Step A `yad-spec`) into a small,
reviewable diff on its own branch in the code repo. **One atomic task = one branch = one PR/MR**
(build plan §B). This is the **light per-task loop**: it runs once per task; the heavy spec ceremony
already ran once for the story.

This step **never auto-advances**. When the task is implemented and committed, control passes to the
**check gates** (Step C — `yad-checks`: spec-link, contract-check, build/test/lint) and then human/AI
review (Steps D–E, not built yet). Implementation here produces a branch + commit and stops.

The implementing lens is **`dev`**. The dev writes only what the task
declares; it does not redesign, does not widen the contract, and does not pick up sibling tasks.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo.
- The work happens **inside the code repo** (a separate git repo) at
  `{project-root}/demo-repos/<repo>/` (`config.yaml` `build.code_repos_root`). Use absolute paths.
- **Branch name:** `feat/<story-id>-<task-id>-<short-slug>` (e.g.
  `feat/EP-checkout-S01-T01-create-order`). Branched off the code repo's default branch.
- **Commit message:** a conventional subject, body describing the change, and a **required `Task:`
  trailer** (e.g. `Task: EP-checkout-S01-T01`) in the trailer block. Add `Contract-Change: yes`
  **only** if the diff touches the locked contract surface (see Step 5), and a per-commit
  `Co-Authored-By:` for any AI tool that helped author the diff (the human author owns the commit;
  trailer order `Task:` → `Contract-Change:` → `Co-Authored-By:`). The skill installs a `.gitmessage`
  template that scaffolds these (Step 2).
- Speak in the `communication_language` set in `{project-root}/.sdlc/config.yaml`; write code/comments in `document_output_language`.

## Inputs

- `epic`  — the `EP-<slug>` (ask if not provided).
- `story` — the `EP-<slug>-S0N` whose spec is being implemented (ask if not provided).
- `repo`  — the code repo the story's spec lives in (one of the story's `repos`).
- `task`  — the ONE atomic task ID to implement, e.g. `T01` (ask if not provided).

## Ask the human-only questions first, in one batch

<!-- The same section is in yad-spec and yad-implement: a test holds the two copies equal (#357). -->

Some decisions belong to the human alone. If one turns up late, the long work stops and waits for it.
So before the long work starts, list every such decision together with every open question, and ask
them all in **one** message.

**Human-only decisions** — never decide these yourself, and never pick a default just to keep going:
- **Security trade-offs.** Who may call or see what, what data is stored, logged or shown, how
  people sign in, and any check made weaker on purpose.
- **Secrets and tokens.** Which secret or token the work needs, who creates it, where it is kept,
  and what it may access.
- **Contract changes.** The work needs the shared cross-repo surface (the locked `contract.md`) to
  change. Nobody decides this here, and no answer lets the step go on: it goes back to the
  architecture gate, or, on a short lane, to a new epic on `classic`. Name it in the batch so the
  person learns it now, not halfway through. Then end the step with this skill's own contract STOP
  (`yad-spec` Step 3, `yad-implement` Step 5), and its `contract touch` halt under `yad-run`.
- **Changes that cannot be undone.** Deleting data, or a data migration with no way back.

**How to ask:**
1. Number each item. For each one, say what must be decided, why only a human can decide it, and the
   options, with your recommendation where a safe one exists.
2. Wait for the answers, then record them where the step below says, so no later step asks again.
   `yad-implement` first reads the answers `yad-spec` recorded in `spec.md`, and asks only what is
   still open.
3. If nothing is open, say "no human-only decisions or open questions" and go on.
4. If a new one still turns up later, stop, collect any others that are open at that point, and ask
   them together. In the report, say the first batch missed it.
5. **Run by the orchestrator (`yad-run`):** a stop to ask — the first batch or a later one — is its
   own halt, **waiting on human decisions**. Run `yad build step <story> --repo <repo> <step> blocked
   --reason "waiting on human decisions: <the questions, short>"` (add `--task <task>` on the
   implement leg). Write **no** trust entry: the step's output is not finished, and files already
   drafted (such as `spec.md`) are not output to judge. Then stop. Once a person answers, the step
   runs again and goes on from what is already drafted. That is a resume, not a re-run, so it is not
   graded `rejected` for being run again.

<!-- end: Ask the human-only questions first -->

## On Activation

### Step 1 — Resolve the spec and the task
Read `demo-repos/<repo>/specs/<story>/tasks.md` — or, for a **light spec** (`link.md` says
`spec-mode: light`, #348), the lines between `<!-- yad:tasks -->` and `<!-- /yad:tasks -->` in its
`spec.md`, and nothing outside them. Find the block for `<task>` (`## <task> — …`). Read
its one-line goal and its **Files:** list (the declared file boundary) and the acceptance criterion it
satisfies. If the task ID is not in `tasks.md` (or the light block), STOP. Confirm the spec exists (Step A ran); if not,
STOP and point at `yad-spec`.

### Step 2 — Resolve the code repo and branch
Confirm `demo-repos/<repo>/` is its own git repo (`.git` present). From its default branch, create the
task branch `feat/<story>-<task>-<short-slug>`. When agents work in parallel, work in the epic's own
worktree of the repo instead (`yad worktree add <epic> --repo <repo>` makes `<repo>--<epic>/` beside it,
#115): create the task branch there from `origin/<default>`, since the default branch is checked out in
the main tree. If a branch for this task already exists, reuse it
rather than forking a second one (one task = one branch).

**On the first implement in a repo, install the commit template** (idempotent): copy this skill's
`templates/.gitmessage` to `<repo>/.gitmessage` and run `git -C <repo> config commit.template .gitmessage`
so every commit is pre-scaffolded with the `Task:` trailer and the commented per-commit `Co-Authored-By:`
choices (`config.yaml` `build.ai_coauthor.allowed`). Do the same at the Product root for Product commit. Skip if
already configured.

### Step 3 — Read the spec inputs (do NOT re-derive the contract)
Read the story's `spec.md`, `plan.md`, `data-model.md`, and `contracts/` for this task's context. A
light spec has only `spec.md`: its `## Plan` section is the plan, and it has no contract slice. The
contract slice is **quoted** from the product repo's locked `contract.md` — implement to it, never
change it here.

**For a task with UI, read its design frames (#354).** Run `yad story frames <story> --json` (yad finds
the Product from the code repo). Its `frames` list names each design-tool frame the story builds, with
its `name`, `platform` and `url`; `spec.md`'s `## Design frames` section, when there is one, says the
same. Build to those frames: open them through the connected design tool's MCP when there is one, and
read them from their `url` otherwise. Never pick a frame by its look or its name alone. An ID it cannot
find is an open question for the batch below, not a guess.

**Before any code for a task with UI, check the design tool can be reached (#358).** When that answer's
`preflight.reachable` is `check`, make the check `preflight.probe` describes (an MCP call, or for a tool's
CLI — `preflight.local` is true — a command in your terminal). If it fails because the
tool is not on this machine at all (no such MCP server in your session, or for a CLI no such
program — not a closed app, the wrong file or a sign-in) and the answer has `preflight.connect`, offer it first, under the connect-tool rule, and probe again once it is
found. A new MCP server is loaded when the agent starts: if your session does not see it yet (in Claude
Code, `/mcp`), **STOP** and tell the person to restart the agent and run this step again — they may
still choose to go on from the frame links, recorded as below. On a no, when a step fails, if it still fails, or if another
file is open, **STOP**: print `preflight.stop` word for word and wait. Go on without the design tool, from
the frame links only, only when the person says so, and record that in the commit's `Decisions:`
paragraph (Step 6) as `design tool not reachable: continued from the frame links, on <person>'s word`.
`not-checkable` means there is nothing to probe: go on from the links. `preflight: null` means no frames.

**In a Unity repo, check the build through Unity MCP (#321).** A Unity repo is one with
`ProjectSettings/ProjectVersion.txt` and an `Assets/` folder at its root (a Unity project in a subfolder is
not read as one).

- **Reach.** Run the yad commands from inside the folder you edit — the Unity repo, or its worktree
  (`<repo>--<epic>`) when there is one (`cd` there): `yad toolbox list --json`, then
  find `unity-mcp` and use it when its `status.state` is `installed`. If it is not found, offer `yad toolbox
  connect unity-mcp --json` once, under the connect-tool rule, and hand the person its steps (they are done in
  the Unity Editor). Unity registers the server for its own project folder only, so its tools load only in an
  agent started in that folder: if your session started elsewhere (the Product, say) or does not see the
  server (in Claude Code, `/mcp`), tell the person to start the agent in the folder you edit — or to set
  **Client Project Dir** in the MCP for Unity window to the folder the agent starts in, and press Configure
  again (a worktree is a new folder, so it needs this too) — and restart it, then run this step again.
- **Probe once.** Read the console (`read_console`). If it fails, or the Editor is open on another folder
  than the one you edit (a worktree, `<repo>--<epic>`, is another folder), ask the person to open the Editor
  on the folder you edit and start the server from the MCP for Unity window; if they cannot, use the fallback
  below.
- **With it, only these tools:** `refresh_unity` with `compile: "request"` (it does not compile unless asked),
  `read_console`, `run_tests` with `get_test_job` (the run is started, then read by its job id), and the
  read-only finders `find_gameobjects` and `find_in_file`. If `run_tests` is not offered, its Testing group
  is off in the MCP for Unity window's Tools section: ask the person to turn it on, or use the fallback. Never `execute_code`, `execute_menu_item`, `manage_packages`, `manage_build`,
  `batch_execute`, a `generate_*` tool, or any tool that writes a scene, prefab or asset: they run code in the
  Editor or change files the task did not declare, and the agent guard does not see MCP calls. After each
  edit, refresh, read the console and fix every error your change caused before you commit; when the task
  declares tests, run them (EditMode or PlayMode).
- **Unity's files.** Unity writes a `.meta` file beside each new file and folder under `Assets/` (it holds the
  ID): a declared file's own `.meta`, and the `.meta` of a folder made for it, go in the commit with it, and a
  declared file deleted or renamed takes its `.meta` with it. They do not count against the ≤3-file rule —
  `yad commit` counts a `.meta` only when its own file or folder is not staged. Any other file
  the Editor writes — `Packages/manifest.json`, `packages-lock.json`, `ProjectSettings/*` — is left unstaged
  and named to the person; whether the team commits the `com.coplaydev.unity-mcp` package is theirs to decide,
  never part of a task commit.
- **Without it**, or on a no, the toolbox's fallback holds:
  `files only: yad-implement edits the C# and asks the person to open Unity and report its console errors`.
  Ask before the commit, fix what they paste, and when the task declares tests ask them to run those too and
  report the result. Record `Unity not reachable: console checked by <person>` in the commit's `Decisions:`
  paragraph (Step 6), and the test result in the Step 7 report.

**Then ask the batch (#357)** that **Ask the human-only questions first** above describes, before
writing any code. Read `spec.md`'s `## Clarifications` first: `yad-spec` recorded its answers there.
Ask only what is still open for THIS task, from its block in `tasks.md`, `plan.md` and the contract
slice (on a light spec: its block and `## Plan` in `spec.md`). Record the answers in the commit body (Step 6), in a `Decisions:` paragraph above the trailer
block — not in `spec.md`, which is outside the task's declared files. Until that commit they are on
no disk, so after a question halt the person gives the answers to the resumed run, which uses them
and does not ask again. If an answer changes what
`spec.md`, `plan.md` or `tasks.md` says (a light spec: anything in `spec.md`), that is a spec gap: STOP and re-run `yad-spec`, as for a file
outside the declared list in Step 4.

### Step 4 — Implement the task (dev lens), inside the declared files ONLY
Adopt the **dev** lens. Implement the task's goal so it satisfies its acceptance criterion, touching
**only the files in the task's `Files:` list** (≤3 where possible). Write real, working code — tests
must exercise behavior, not just pass (build plan §C). **Before committing, run a smoke or test that
actually exercises the task's acceptance criterion** — the task is not done until the criterion is
demonstrably met (record the result in the Step 7 report).

**File-boundary rule (hard):** if the implementation genuinely needs a file **not** in the declared
list (in a Unity repo, a declared file's own `.meta`, and the `.meta` of a folder made for it, are part of it: see "In a Unity repo" in Step 3), **flag and STOP** — do not silently widen the diff. Report the extra file(s) needed so the
task's spec can be corrected (re-run `yad-spec` / re-scope the task) before implementing. A task whose
declared files are wrong is a spec bug, not an implementation decision.

This stop is a **scope overrun** — a halt condition that pulls in a human regardless of any automation
dial. When this step is driven by the orchestrator (`yad-run`, Phase 4), the stop must be legible to
it: `yad build step <story> --repo <repo> implement blocked --task <task> --reason "scope overrun: <which file>"`
(it writes the step's `record`) — and
surface `scope_overrun: true` so the run records a `rejected` trust entry and halts (it never advances
past a boundary breach). The same applies to the Step 5 contract-surface stop (`contract_touch: true`).

The record is what makes the halt legible. Since shape 7 (E38) a `blocked` step carrying nothing
reads as `todo` — "not started" — because that is what the word meant in every file written before
shape 7. The record is the only thing that separates a lane that stopped from a lane nobody began.

### Step 5 — Contract-surface check (local pre-flight for Step C)
Determine whether the diff touches the **locked contract surface** (the API/event/data-model shapes in
`epics/<epic>/contract.md`'s `CONTRACT-SURFACE` block). Normal implementation **consumes** the
contract (e.g. implementing `POST /orders` to the agreed shape) — that is **not** a contract change.
A contract change means the diff alters the agreed cross-repo shape itself.

- If the diff does **not** change the surface: proceed; no `Contract-Change` trailer.
- If the task **requires** changing the surface: **flag and STOP**. The contract is owned upstream;
  route back to the **architecture gate** to amend and re-lock `contract.md` first — on a route that
  has one; the short lanes do not, see the bullet below. Only then return
  here, and record `Contract-Change: yes` in the commit body (the Step C contract-check will require a
  matching, already-updated contract).
- **Short-lane epics have no contract and no architecture gate.** Read
  `epics/<epic>/.sdlc/state.json`'s `profile` (or, on an epic seeded before file shape 6, what its
  `steps[]` contains): on `chore` and `spike` there is no `contract.md`, so
  there is no surface block to compare against and **no gate to route back to**. Never write
  `Contract-Change: yes` on a short-lane task: there is no lock for the check to verify it against, so
  the claim cannot be true of anything. Where the Product repo is reachable the gate now FAILS it
  outright; where it is not, the check defers and nothing catches it. If the task needs the shared cross-repo surface to change, **STOP and escalate
  to a human**: the work belongs to a new epic on `classic`.

### Step 6 — Commit on the task branch
Stage only the declared files (in a Unity repo, a declared file's own `.meta`, and the `.meta` of a folder made for it, are part of it: see "In a Unity repo" in Step 3). Commit with the convention: a conventional subject, a short body (with
the `Decisions:` paragraph when Step 3 asked anything — pass the body with `yad commit --body`, as
`yad ship` takes no body), and a
`Task: <story>-<task>` trailer (plus `Contract-Change: yes` if Step 5 applies). The human author owns the
commit; **no `Co-Authored-By:` footer by default** — add one only when the human explicitly asks
(`yad commit --ai <id>` / the `.gitmessage` choices from `config.yaml` `build.ai_coauthor.allowed`),
never on the AI's own initiative. Keep all trailers in one contiguous block. Do not commit sibling tasks' work.

### Step 6b — Scan the change (E172)

**Run standalone** (not by `yad-run`): once the commit in Step 6 has landed, run the `yad-scan` skill for this task and
repo. It files security findings, technical debt and suggestions on the repo's tracker. It never blocks: if it fails,
say so and carry on to Step 7. A halted task has no commit to scan, so it skips this step.

**Run by `yad-run`:** skip this step. `yad-run` runs the scan itself, once the checks have passed.

### Step 7 — Report; the advance decision belongs to the dial (Phase 4)
Report: the branch name, the files changed, how the change satisfies the task's acceptance criterion,
the result of any test/smoke run, and the next action — the **check gates** (Step C — `yad-checks`)
then the PR and review (Steps D–E). Do **not** open a PR, merge, or hand-edit the epic's Shape
`state.json`. Step B ends at a committed task branch.

- **Run standalone:** stop here; a human triggers the gates. Before the push, `yad run checks` runs every
  gate on this machine, as CI will.
- **Run by the orchestrator** (`yad-run`): this skill still just produces the committed branch and
  signals success (or a scope/contract halt). The orchestrator records the `implement` step's status
  and trust entry and, when `implement` is set to `advance: auto` (`yad dial`), **auto-runs
  the check gates** instead of waiting for a manual nudge. The diff still cannot merge without the
  gates passing and the engineer review — Step D removes only the "now run the gates" hand-off.

### Step 8 — Record the `tasks` trust signal on first consume (Phase 4b)
Resolving a task from `tasks.md` (Step 1) is the moment the generated task list "survives contact" —
part of the run record `yad dial` shows beside the `tasks` dial. When driven by `yad-run`,
finalize a `tasks` trust entry, anchored to what the human/dev actually did with the list:
- the task is implemented with its declared `Files:`/scope **as generated** → `approved-unchanged`;
- the task is **re-scoped** first (its `Files:`/boundary edited) → `approved-with-edits`
  (signal `task_rescoped: true`);
- the task list is discarded / regenerated → `rejected`.
Under `yad-run` the run is already recorded: finalize it with
`yad build trust <story> --repo <repo> tasks --uid <uid> --verdict <v>`, where `<uid>` is `closed.run` on the
`tasks` step in `build-state/<story>.json`. Never write the shard by hand. Schema: `../yad-epic/references/state-schema.md`. The record is advice: the `tasks` dial
is whatever the team sets with `yad dial`. (The `implement` step's own verdict is finalized later,
at the engineer review in `yad-engineer-review`: merged as authored → `approved-unchanged`; edited first →
`approved-with-edits`; scope/contract/checks halt → `rejected`.)

## Hard rules (build plan §B, Cross-cutting)

- **One atomic task = one branch = one PR/MR.** Never bundle tasks; never exceed the declared files (a Unity `.meta` beside one is part of it). The one
  exception (#350): several SMALL tasks of the same story may share one branch and PR/MR, each commit
  keeping its own `Task:` line, under the Product's `group_limit` (default 200 lines, 10 files) — `yad open-pr`
  warns when a group is over it.
- **Light loop per task.** Do not re-run the heavy spec ceremony; that already ran once in Step A.
- **Never widen the contract here.** Surface changes go back to the architecture gate (Step 5).
- **Human-only decisions are asked first, in one batch** (#357), before any code — never decided by
  the agent.
- **The step never advances itself.** A scope overrun or contract touch always halts. The
  `implement → checks` hand-off advances only when the orchestrator's `implement` dial is
  `advance: auto` (`yad dial`) — and never past the engineer review, which is always human.
  Standalone, the step stops at a committed branch.

## Reference
- Branch/commit conventions, the file-boundary rule, the Contract-Change rule: `references/implement-conventions.md`.
- The task list this step consumes: Step A's `references/spec-handoff.md` (`../yad-spec/...`).
- Contract surface + hash recipe: `../yad-architecture/references/contract-format.md`.
