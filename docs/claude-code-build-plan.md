# Build Plan — AI-Assisted SDLC Workflow Module

**Audience: Claude Code.** This document is the specification for building a custom BMAD module that adds team-based, multi-repo, gated SDLC orchestration on top of BMAD-METHOD.

Read this whole document before writing any code. Follow the **Phase 0 verification step first** — do not skip it.

---

## Phase 0 — Verify the ground truth before building (MANDATORY)

The tools below are young and change often. **Do not rely on assumed paths, command names, or file formats.** Before writing any code, fetch and read the current docs, and record what you find in a file `RESEARCH-NOTES.md`. Only build against what you actually confirm.

Verify each of these and write down the real answer:

1. **BMAD-METHOD** (https://github.com/bmad-code-org/BMAD-METHOD)
   - Current stable vs alpha version. Which to target.
   - How a custom module is created (the "BMAD Builder" / BMB). Exact command.
   - Where custom modules live on disk after install (the folder that survives updates).
   - The module/agent/workflow file format (YAML? TOML? Markdown?).
   - The real agent codes in the BMM module (expected: `analyst`, `pm`, `architect`, `ux-designer`, `dev`, `sm`, `tea`). Confirm.
   - How a workflow defines steps and how a step calls an agent.
   - The project rules / context file (expected: `project-context.md`). Confirm name and location.

2. **Spec Kit** (https://github.com/github/spec-kit)
   - The real command names (expected: `specify`, `clarify`, `plan`, `tasks`, `analyze`, `checklist`, `implement`).
   - Where each command writes its output files.
   - How the constitution is created and where it lives.

3. **Repomix** (https://github.com/yamadashy/repomix)
   - How to call it from a script (CLI flags), confirm `--compress`, `--include`, `--include-logs`.
   - Whether to use it as CLI subprocess (preferred) — confirm flags exist.

4. **Impeccable** (https://github.com/pbakaus/impeccable)
   - How it installs into a project.
   - Confirm the commands `document`, `extract`, `craft`, and the no-AI CLI `detect`.
   - The output file it produces (expected: `DESIGN.md`).

**If any expected detail is wrong, build against the real one and note the difference. Do not invent paths.**

---

## 1. What we are building (the design — this part is fixed)

A custom BMAD module that turns BMAD from a solo-developer tool into a **team, multi-repo, gated SDLC engine**. It does not replace engineers — it keeps them in charge of high-level decisions and uses AI for the heavy and mechanical work.

The whole system is a **state machine**: each step (state) does its work, writes its output to a file, then waits at a gate. Who advances the gate (human or machine) is controlled per step.

### Design priorities (in order)
1. Code quality / production safety
2. Low review load on a small team
3. Speed of shipping
4. Consistency across projects

### Core rules that must hold everywhere
- **Talk to every tool through its commands and files, never through its internal code.** This keeps tools swappable.
- **All state lives in files on disk** (current step, approvals, dial settings). Nothing hidden. This is what makes later automation possible.
- **Front states never auto-advance.** They are human-authored with AI assist. Only the back states may move toward machine-advance, and only later.

---

## 2. The two dials (build as config per step)

Each step carries two independent settings:

- `assistance`: `none` | `review` | `heavy` — how much AI helps.
- `automation`: `human_approve` | `machine_advance` — who advances the step.

Store these per step in the product repo (see Section 6). Default for all steps at first: `automation: human_approve`. Front steps must be locked so they cannot be set to `machine_advance` in this version.

---

## 3. The six module pieces to build

Three are the real value, three are plumbing.

**Value:**
1. **Two dials** — the per-step settings above, read by the engine to decide whether to wait for a human.
2. **Team review gate** — a step type that waits for real engineer comments + approvals. Default rule: **owner + 1 reviewer**; escalate to domain owners when the change touches the shared contract, auth, or payments. Each gate has one owner who can advance it; others comment.
3. **Multi-repo contract** — holds one locked shared contract (API shape, events, data model) for a feature. Provides a check that fails a PR if its diff touches the contract surface without the contract file being updated first.

**Plumbing:**
4. **Backfill step** — calls Repomix (CLI) on a feature's files (`--compress`, `--include`, `--include-logs`), feeds the pack to an AI with a "describe what exists, do not invent" prompt, writes a draft spec, then requires human approval. Gated on touched features only.
5. **UI design step** — uses Impeccable. Existing project: `document` → `extract` → `craft`. New project: `craft` → `extract`. Output `DESIGN.md` goes through the team review gate.
6. **The glue** — the engine code that runs steps in order, reads/writes the state files, and calls BMAD agents, Spec Kit, Repomix, and Impeccable through their commands.

---

## 4. The workflow steps and their BMAD agents

Front states (human-authored, AI-assist, never auto-advance).

**Every authoring step is followed by its own review + approval step.** The pattern is identical for all four: author with AI assist → real engineers comment → owner addresses comments and iterates → reviewers approve → advance. No step advances until its review step is approved.

| # | Step | Type | BMAD agent assist | Output file |
|---|------|------|-------------------|-------------|
| 1 | Epic | author | `analyst` (shape idea) then `pm` (write epic) | `epic.md` |
| 2 | Review of epic | review+approve | `pm` (helps owner fix comments); humans review | `reviews/epic-*.md` |
| 3 | System architecture + contract | author | `architect` | `architecture.md`, `contract.md` |
| 4 | Review of architecture + contract | review+approve | `architect` (helps owner fix comments); humans review | `reviews/architecture-*.md` |
| 5 | UI design | author | `ux-designer` + Impeccable + Claude Design | `ui-design.md`, `DESIGN.md` |
| 6 | Review of UI design | review+approve | `ux-designer` (helps owner fix comments); humans review | `reviews/ui-design-*.md` |
| 7 | Split into user stories | author | `pm` (split) then `sm` (prepare each) | `stories/*.md` |
| 8 | Review of user stories | review+approve | `sm` (helps owner fix comments); each domain engineer reviews their repo's stories | `reviews/stories-*.md` |

How each `review+approve` step works (build this as ONE reusable step type — the team review gate, piece 2):
- The authored file is shared with the reviewers.
- Reviewers add comments (recorded as files in `reviews/`).
- The owner addresses comments with the listed agent's help; the authored file is updated; this repeats until reviewers are satisfied.
- Approval is recorded as a file in `reviews/`. Default rule: **owner + 1 reviewer**; escalate to domain owners when the step touches the shared contract, auth, or payments (so step 4, the contract review, escalates by default).
- For step 8 (stories), the relevant domain engineer reviews the stories that touch their repo — backend engineer reviews backend stories, etc.
- Only after approval is recorded does the workflow advance to the next authoring step.

Build pipeline (may automate first, end-first):

| # | Step | Assist | Where |
|---|------|--------|-------|
| 9 | Spec Kit per story per repo: specify→clarify→plan→tasks→analyze→checklist (heavy steps once per story; tasks+ per task) | `sm` | each repo `/specs/` |
| 10 | Implement (small diff, 1 task = 1 PR) | `dev` | each repo |
| 11 | Check gates (build, test, lint, contract check, spec-link check) | `tea` | each repo CI |
| 12 | AI review (e.g. CodeRabbit) | tool | each repo PR |
| 13 | Engineer review (human reads diff vs spec, owns merge) | human | each repo PR |
| 14 | Ship | — | each repo |

Note: BMAD already creates stories after architecture, matching this order. Confirm in Phase 0 and align to its real workflow mechanism rather than forcing ours.

---

## 5. Approval and contract rules (must enforce)

- A step with `automation: human_approve` does not advance until the gate's owner records approval (a file in `reviews/`).
- Team review gate: owner + 1 reviewer default; escalate by risk.
- Contract rule: a task may read the contract but must not silently change it. If a PR diff touches the contract surface (shared endpoints, events, data shapes) and `contract.md` was not updated in the same change set, the check gate fails and sends the change back to the architecture/design gate.
- Spec-link rule: a PR with no linked story/spec fails the check gate.

---

## 6. Where files live (build this layout)

**Product repo** (shared "thinking", one place all repos reference). One folder per epic; see Section 6b for exact names:
```
product-repo/
  epics/
    EP-<slug>/
      epic.md
      architecture.md
      contract.md          the locked shared contract
      ui-design.md
      DESIGN.md            from Impeccable
      stories/             one file per story (EP-<slug>-S01.md ...)
      reviews/             comments + approval records
      .sdlc/               state: current step, per-step dials, approvals
```

**Each code repo** (its own building work), one spec folder per story:
```
<repo>/
  specs/EP-<slug>-S01/     Spec Kit output: spec.md, plan.md, tasks.md, link.md
  ...code...
  .github/pull_request_template.md              (GitHub repos)
  .gitlab/merge_request_templates/Default.md    (GitLab repos)
  (each PR/MR links back to its story in the product repo)
```

The handover point is where Spec Kit begins: everything before it is shared in the product repo; everything from Spec Kit onward lives inside each code repo with a link back to the story.

---

## 6b. Naming, commit, and PR conventions (enforce everywhere)

This is the backbone that keeps everything traceable. One ID flows from epic → story → spec → branch → commit → PR, so anyone (and the engine) can follow the chain in either direction. **The engine must generate these IDs and names automatically; do not rely on engineers typing them by hand.**

### The ID system

Three short, stable IDs, assigned once and never changed:

- **Epic ID:** `EP-<slug>` where slug is 2-4 lowercase words joined by hyphens. Example: `EP-istifta-inquiries`. Assigned at epic creation.
- **Story ID:** `<EpicID>-S<NN>` — the epic ID plus a zero-padded story number. Example: `EP-istifta-inquiries-S01`. Assigned at the story-split step.
- **Task ID:** `<StoryID>-T<NN>` — the story ID plus a zero-padded task number. Example: `EP-istifta-inquiries-S01-T03`. Assigned when Spec Kit produces tasks.

Rules: IDs are lowercase except the fixed prefixes (`EP`, `S`, `T`); numbers are always two digits (`S01`, not `S1`); IDs never get renamed once assigned (rename breaks every downstream link); a story or task that spans repos keeps the same ID in each repo.

### File naming

**Product repo (shared thinking):**
```
epics/EP-istifta-inquiries/
  epic.md
  architecture.md
  contract.md
  ui-design.md
  DESIGN.md
  stories/
    EP-istifta-inquiries-S01.md
    EP-istifta-inquiries-S02.md
  reviews/
    epic--2026-06-04--approved.md
    architecture--2026-06-04--approved.md
    ui-design--2026-06-04--approved.md
    stories-S01--2026-06-04--approved.md
  .sdlc/
    state.json            current step, dial settings per step
    approvals.json         who approved what, when
```
Review file pattern: `<artifact>--<YYYY-MM-DD>--<status>.md` where status is `comments` or `approved`.

**Code repo (building), one folder per story (confirm exact base path in Phase 0):**
```
specs/EP-istifta-inquiries-S01/
  spec.md
  plan.md
  tasks.md
  link.md               points back to the story in the product repo
```
The `link.md` (or a frontmatter field) records the product-repo URL/path of the parent story. This is what the spec-link check reads.

### Branch naming

`<type>/<TaskID>-<short-desc>` — type is one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
Example: `feat/EP-istifta-inquiries-S01-T03-add-inquiry-endpoint`.
One atomic task = one branch = one PR.

### Commit conventions (Conventional Commits + task ID)

Format: `<type>(<scope>): <subject>  [<TaskID>]`
- `type`: `feat` | `fix` | `refactor` | `test` | `docs` | `chore` | `perf` | `build` | `ci`.
- `scope`: the area touched (e.g. `inquiry`, `auth`, `ui`). Optional but encouraged.
- `subject`: imperative, lowercase, no trailing period, <= 72 chars.
- Always end with the task ID in brackets so commits are traceable.

Example: `feat(inquiry): add submit-inquiry endpoint  [EP-istifta-inquiries-S01-T03]`

If the change touches the shared contract, add a body line: `Contract-Change: yes` — the check gate looks for this together with an updated `contract.md`.

### PR / MR conventions

- **Title:** `[<StoryID>] <type>: <summary>` — example: `[EP-istifta-inquiries-S01] feat: submit inquiry flow`.
- **One PR/MR per atomic task** (small diff, <= 3 files where possible).
- **Must link its story** (paste the product-repo story path/URL) — the spec-link check fails it without one.
- **Uses the platform template below.** GitHub repos use the PR template; GitLab repos use the MR template. Both carry the same sections so review is identical regardless of platform.

### Impact & Risk analysis (required in every PR and MR)

Both templates include an Impact & Risk block. Its purpose: force the author to state, before review, what could break and how to undo it. The reviewer reads this first. Keep it short and honest — "none" is a valid answer when true.

- **Impact** — what parts of the system this change affects (modules, endpoints, screens, data, other repos).
- **Risk level** — `low` | `medium` | `high`. High risk auto-escalates reviewers to the domain owners.
- **What could break** — the realistic failure if this is wrong.
- **Rollback** — how to undo this change safely.
- **Cross-repo effect** — does this change anything other repos depend on (the shared contract)? If yes, it must follow the contract rule.

### GitHub PR template (commit as `.github/pull_request_template.md` in each GitHub code repo)

```markdown
## Story
<!-- link to the parent story in the product repo, e.g. product-repo/epics/EP-.../stories/EP-...-S01.md -->
Story ID:
Task ID:

## What this PR does
<!-- 1-3 sentences, plain language -->

## Impact & Risk
- Impact (what this affects):
- Risk level: low / medium / high
- What could break:
- Rollback (how to undo):
- Cross-repo effect (shared contract?): none / yes — explain:

## Scope check
- [ ] Touches only the files listed in the task's spec
- [ ] <= 3 files changed (or coupling explained below)
- [ ] No unrelated changes

## Contract
- [ ] This PR does NOT change the shared contract
- [ ] OR: it changes the contract AND `contract.md` was updated first (link the contract change)

## Verification
- [ ] Build passes
- [ ] Tests pass and actually protect the new behavior
- [ ] Lint passes

## Reviewers
<!-- owner + 1 reviewer; add domain owners if risk is high or this touches contract/auth/payments -->
```

### GitLab MR template (commit as `.gitlab/merge_request_templates/Default.md` in each GitLab code repo)

GitLab reads templates from `.gitlab/merge_request_templates/`. The file name (without `.md`) becomes the template's selectable name in the MR form. Name it `Default.md` to apply by default, or add more (e.g. `Hotfix.md`) later.

```markdown
## Story
<!-- link to the parent story in the product repo -->
Story ID:
Task ID:

## What this MR does
<!-- 1-3 sentences, plain language -->

## Impact & Risk
- Impact (what this affects):
- Risk level: low / medium / high
- What could break:
- Rollback (how to undo):
- Cross-repo effect (shared contract?): none / yes — explain:

## Scope check
- [ ] Touches only the files listed in the task's spec
- [ ] <= 3 files changed (or coupling explained below)
- [ ] No unrelated changes

## Contract
- [ ] This MR does NOT change the shared contract
- [ ] OR: it changes the contract AND `contract.md` was updated first (link the contract change)

## Verification
- [ ] Build passes (pipeline green)
- [ ] Tests pass and actually protect the new behavior
- [ ] Lint passes

## Reviewers / Approvals
<!-- owner + 1 reviewer; add domain owners if risk is high or this touches contract/auth/payments -->

/assign me
/label ~"needs-review"
```

Note: the GitLab template can use quick actions (the `/assign`, `/label` lines) which GitHub PR templates cannot. Keep both templates' sections in sync so the workflow is identical across platforms; only the platform-specific extras differ.

### Story file template (the engine generates this at split time)

```markdown
---
id: EP-istifta-inquiries-S01
epic: EP-istifta-inquiries
repos: [backend, mobile]        # which repos must implement this story
status: draft                    # draft | approved | in-progress | shipped
owner:
---

## Story
As a <user>, I want <goal>, so that <reason>.

## Acceptance (user-level)
- ...

## Repo notes
- backend: ...
- mobile: ...

## Links
- Epic: ../epic.md
- Contract: ../contract.md
- UI: ../ui-design.md
```

### Epic file template (the engine generates this at epic creation)

```markdown
---
id: EP-istifta-inquiries
status: draft
owner:
technical_product_owner:
repos: [backend, mobile, dashboard]
---

## Goal
<!-- why this feature exists, 1-2 sentences -->

## Scope
## Out of scope
## Context / background
## Acceptance signals (user-level)
```

### One rule that ties it together

The same epic ID appears in: the epic folder name, every story file, every spec folder in every repo, every branch, every commit, and every PR title for that feature. **If you can read an ID anywhere, you can find everything related to it.** The engine enforces this; engineers never type IDs manually.

---

## 7. Engine shape (build CLI first)

- Build as a **CLI tool** (Node, since the team uses NestJS and the tools are Node/JS). It is git-driven: state is files, approvals are commits/PRs.
- Commands to build (confirm naming against BMAD's conventions in Phase 0):
  - `init` — set up a product repo and register the code repos for a project.
  - `link` — connect an existing code repo (drops `/specs` folder + the spec-link CI check). On-ramp for existing projects.
  - `backfill` — run the backfill step (piece 4) for a feature.
  - `feature` — start a new feature: runs the front states (epic → architecture → UI → stories) with their gates.
  - `check` — the CI command: verifies spec-link and contract rules for a PR.
- Design the engine so a future **service** can trigger the same steps (do not hardcode "a human typed this"; the trigger is a parameter). Do not build the service now.

---

## 8. Build order (do it in this order, smallest useful first)

1. **Phase 0 research** → `RESEARCH-NOTES.md`.
2. **Scaffold the custom BMAD module** using the real BMB command. Confirm it installs and survives an update.
3. **Team review gate (piece 2)** on one existing project, all dials `human_approve`. This alone gives the team a shared workflow. Ship and use this before anything else.
4. **The glue + state files (pieces 1 and 6)** — make the engine run steps in order and read/write `.sdlc/` state.
5. **UI design step (Impeccable)** and **backfill step (Repomix)**.
6. **Multi-repo contract (piece 3)** — add when a feature first spans more than one repo.
7. **End-first automation** — only after months of evidence the AI is trustworthy on this codebase. Move back steps toward `machine_advance` one at a time. Never the front steps in this version.

Add each tool only when it removes a real, measured bottleneck.

---

## 9. Constraints and cautions for the builder

- **Do not reproduce or rewrite the internals** of BMAD, Spec Kit, Repomix, or Impeccable. Call them; do not fork them into our code.
- **Do not hardcode any AI vendor.** Steps call whichever model/agent is configured. Vendor must be swappable.
- **Do not build browser storage or a database** in this version. Files + git are the source of truth.
- **Respect licenses.** BMAD and Impeccable are open-source with their own terms; note them in `RESEARCH-NOTES.md` if a commercial product is intended later.
- **Keep the front states human-authored.** Do not add any path that lets epic/architecture/UI auto-advance.
- If anything in this plan conflicts with what the real tools actually do (found in Phase 0), **prefer the real tool behavior** and note the deviation. This plan is the design intent; the tools are the ground.

---

## 10. Definition of done for the first deliverable

The first deliverable is NOT the whole system. It is:
- `RESEARCH-NOTES.md` with verified tool facts.
- A scaffolded custom BMAD module that installs cleanly.
- A working **team review gate** running on one real existing project, with state stored in `.sdlc/` files and approvals recorded as files.
- A short `README.md` showing the team how to run the epic → review → approve loop by hand.

Everything else (contract, backfill, UI step, automation) comes in later iterations.
