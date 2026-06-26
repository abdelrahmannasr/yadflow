# Yadflow — the gated, team, multi-repo SDLC on top of BMAD

[![npm version](https://img.shields.io/npm/v/yadflow?logo=npm)](https://www.npmjs.com/package/yadflow)
[![CI](https://github.com/abdelrahmannasr/yadflow/actions/workflows/ci.yml/badge.svg)](https://github.com/abdelrahmannasr/yadflow/actions/workflows/ci.yml)
[![provenance](https://img.shields.io/badge/npm-provenance-blue?logo=npm)](https://docs.npmjs.com/generating-provenance-statements)
[![node](https://img.shields.io/node/v/yadflow?logo=node.js)](https://github.com/abdelrahmannasr/yadflow/blob/main/package.json)
[![security policy](https://img.shields.io/badge/security-policy-brightgreen)](https://github.com/abdelrahmannasr/yadflow/blob/main/SECURITY.md)
[![report](https://img.shields.io/badge/docs-Yadflow%20report-2471a3)](https://abdelrahmannasr.github.io/yadflow/)

> 📖 **Start here: the [Yadflow Terminology & Workflow Structure Report](https://abdelrahmannasr.github.io/yadflow/)** —
> the full picture of every term, artifact, gate and skill in one richly illustrated page.

**Yadflow** (*yahd-flow* — from **يد**, Arabic for "hand") is the AI-driven SDLC where a human hand
moves every gate. *AI builds. The hand decides.* On npm and GitHub as `yadflow`.

A custom BMAD module that turns BMAD from a solo tool into a **team, gated, file-driven SDLC
engine**. Every step does its work, writes its output to a file, and **waits at a gate**. Who
advances the gate (human now; machine later) is a per-step setting. All state lives in files —
nothing hidden, no database.

This repo is the **first deliverable** (see `docs/claude-code-build-plan.md` §10): verified research,
a scaffolded module that installs cleanly, and a working **team review gate** you run by hand.

## The workflow at a glance

The whole lifecycle, from an empty project to shipped code. Setup is one-time; the optional
**front-zero** (`yad-discovery`) frames the whole project once — market, feasibility, and a phased
roadmap; the **front half** is human-gated and runs once per epic in the product hub; the **build
half** runs once per story per code repo; **automation** is opt-in and earned. `yad-status` reads it
all; `yad-hub-bridge` mirrors front-half reviews to real PR/MRs.

<!-- Source: docs/diagrams/sdlc-overview.mmd — edit the .mmd and run `npm run diagrams` to regenerate -->
![Yadflow SDLC overview — setup, human-gated front half, per-story build half, earned automation](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/diagrams/sdlc-overview.svg)

**Legend.** <span>🟨</span> **artifact** = an author step writes a file and stops; <span>🟧</span>
**gate** = a human review that must pass (`open → comment → approve → advance`); <span>🟦</span>
**earns automation** = a back step that can be set to `machine_advance` once it proves itself;
<span>⬜ dashed</span> **locked** = the engineer review and every front state, **permanently
human**. Detailed walkthroughs for each phase follow below.

## What's here

| Path | What it is |
|------|-----------|
| `RESEARCH-NOTES.md` | Verified Phase 0 facts about BMAD, Spec Kit, Repomix, Impeccable + deviations. |
| `skills/sdlc/` | Module source of truth (`config.yaml`, `module-help.csv`, `install.sh`). Survives BMAD updates. |
| `bin/`, `cli/` | The `yad` setup/update CLI (published to npm as `yadflow`). |
| `skills/yad-discovery/` | Optional front-zero (once per project, greenfield + brownfield): market research, competitor study, feasibility, current-state, requirements (functional + non-functional) and a phased roadmap (MVP+) under the reserved `EP-discovery`. `roadmap.md` is the menu of features each epic reads. |
| `skills/yad-analysis/` | Optional front state 1: pressure-test the idea with the analyst into `analysis.md` (skippable). |
| `skills/yad-epic/` | Front state 1: author an epic with AI assist, assign its `EP-<slug>` ID, seed state. |
| `skills/yad-architecture/` | Front state 3: author `architecture.md` + the locked `contract.md`; hash-lock the contract surface. |
| `skills/yad-ui/` | Front state 5: author `ui-design.md` + `DESIGN.md` (Impeccable slash-commands, or graceful fallback). |
| `skills/yad-stories/` | Front state 7: break the epic into repo-tagged stories with stable `EP-<slug>-S0N` IDs. |
| `skills/yad-test-cases/` | Front state 9: with the test architect author `test-cases.md`; implement the automation in the connected testing tool, or produce artifacts only. |
| `skills/yad-connect-repos/` | Connect code repos to the hub (GitHub/GitLab, local-user auth); cache a Repomix pack + **code-map** per repo so the front phases are code-aware. |
| `skills/yad-connect-learning/` | Connect a learning tool (DeepTutor-first, pluggable) — a CLI subprocess like Repomix; record `.sdlc/learning.json` + an optional grounded knowledge base. |
| `skills/yad-learn/` | The cross-cutting **learning layer**: tutor any member, at any stage, in the context of what's being built; records a personal, local-only skills log (gitignored, never committed/pushed). Opt-in, never gates. |
| `skills/yad-review-gate/` | The reusable **team review + approve gate** (used for all five reviews). |
| `skills/yad-spec/` | Build Step A: run the Spec Kit ceremony once per story per repo → `specs/<story-id>/`. |
| `skills/yad-implement/` | Build Step B: implement ONE atomic task as a small diff on its own branch. |
| `skills/yad-checks/` | Build Step C: wire + run the CI gates (spec-link, contract-check, build/test/lint, verified-commits). |
| `skills/yad-pr-template/` | Build Step D: install the platform PR/MR template + risk routing (code repos **and** the hub). |
| `skills/yad-review-comments/` | Install platform-matched PR/MR review-comment scaffolds (code repos and the hub). |
| `skills/yad-hub-bridge/` | The templated PR/MR **review bridge**: open a review PR/MR on the hub and sync platform approvals/comments into the file ledger. |
| `skills/yad-commit/` | Build helper: commit ONE staged atomic change by the conventions (Conventional subject, trailers, `--ai` footer, ≤3-file guard). |
| `skills/yad-open-pr/` | Build helper: open a code-repo task PR/MR from the committed template (push, prefill, roster auto-assign). |
| `skills/yad-ship/` | Build helper: commit **and** open the task PR/MR in one step (`yad commit` then `yad open-pr`). |
| `skills/yad-engineer-review/` | Build Step E: AI review (advisory) → engineer review → merge + record in the build log. |
| `skills/yad-backfill/` | Generate a human-verified spec for already-built code (Repomix), gated per touched feature. |
| `skills/yad-run/` | Phase 4 orchestrator: drive a story's back half on the `automation` dial; kill switch. |
| `skills/yad-status/` | Read-only view: front chain, build-half dials, trust record, fleet roll-up. |
| `epics/EP-istifta-inquiries/` | A worked demo epic run **end to end** (front half + build half + automation). |
| `demo-repos/` | Throwaway code repos for the build half (separate git repos; regenerable — see `demo-repos/README.md`). |
| `docs/` | The phased build plans (`phase-2`…`phase-5`) and the original workflow design. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Commit & PR/MR title convention (Conventional Commits, lowercase after the type). |

## The `yad` CLI (install, update, reconcile)

The module ships a zero-dependency CLI, published to npm as
[`yadflow`](https://www.npmjs.com/package/yadflow). Run it
with `npx` from your **product hub** repo — no clone needed.

> **Platform support.** Linux and macOS are first-class — the test suite, the bash check gates, and
> the end-to-end harness all run on both in CI. The CLI shells out to `git` (and the bash gate
> scripts), so on **Windows use [WSL](https://learn.microsoft.com/windows/wsl/)**; native PowerShell
> is not yet supported. Requires **Node.js ≥ 18**.

| Command | What it does |
|---------|--------------|
| `npx yadflow setup` | Guided first-run wizard — a short **profile interview** (solo/team, greenfield/brownfield, monorepo/separate) then the branched steps below. Pre-answer for CI/scripts with `--solo`/`--team <n>`, `--greenfield`/`--brownfield`, `--monorepo`/`--separate`, `--tools`. |
| `yad next [<epic>]` | **Where am I / what next.** With no epic: project-wide orientation — the one next action (run setup, start an epic, or the single active epic's step). With an epic: that epic's exact next action (a skill to invoke or a `yad` command to run). `yad next <epic> --check <step>` exits non-zero when a step is run out of order (the precondition guard); `yad next --all` lists every epic's next action. |
| `npx yadflow check` | Read-only report: what is **missing** / **outdated** (drifted) / **stale** (code-context) / **legacy** (pre-2.0 `sdlc-*` names) vs the bundled manifest. |
| `npx yadflow check --fix` | Reconcile: fill what is missing **and** update what changed — touches nothing already correct. |
| `npx yadflow update` | Apply drift only (alias for `check --fix --scope=changed`). Also migrates a pre-2.0 install in place: `sdlc-*` skill copies and marker-owned `sdlc-*.yml` CI files are replaced by their `yad-*` names (a same-named file *you* authored is never touched). |
| `npx yadflow doctor [--json]` | Environment + state health: tools on PATH and platform auth, config files parse and point at real repos, every epic ledger loads. Exit 1 on any failure; `--json` for CI and bug reports. |
| `yad roster list` / `yad roster add <login>` | Manage the reviewer roster + per-repo roles **any time** (not just at setup). `add` upserts a member then walks each connected repo asking for their role; `grant`/`revoke <name> <repo> <role>` and `remove <login>` round it out. A `domain-owner` grant keeps `repos.json` `domain_owners` in sync. |
| `yad gate open <epic> <artifact>` | Open the front-half **review PR/MR** for an artifact and mark the step `in_review`. |
| `yad gate sync <epic> [artifact]` | Pull the PR/MR's reviews + comment threads into the file ledger; **auto-advance** the step when approvals are satisfied, all threads are resolved, and the PR is merged. |
| `yad gate comments <epic> [artifact]` | Fetch the unresolved review comments to address (then reply on the PR; reviewers resolve their threads). |
| `yad gate status <epic>` | Show each review step and its recorded approvals. |
| `yad gate ci [--branch <head>] [--pr <n>]` | The CI entry the hub workflow calls on review/merge events: derive the epic/artifact from the `review/EP-*` branch, run the same sync, and commit **only the ledger** to the hub default branch (sweep every open review PR when no `--branch`). |
| `yad commit --type <t> -m <subject>` | Commit by the SDLC convention — Conventional subject, `Task`/`Contract-Change`/`Co-Authored-By` trailers, atomic-file guard. |
| `yad open-pr [--repo <name>]` | Open a **task** PR/MR from the platform template (build half). **Stage-aware on the hub:** a `review/EP-*` branch opens the front-half artifact-review PR (delegates to `yad gate open`); any other hub branch uses the code-task template (so hub tooling PRs pass the `pr-template` gate). |
| `yad ship --type <t> -m <subject>` | Commit **and** open the task PR/MR in one step (`yad commit` then `yad open-pr`) — stage-aware, same as `open-pr`. |
| `yad repo list` / `yad repo refresh [name]` | List connected repos as **fresh / stale**, and re-pack a stale one — staleness is now an explicit human decision, never an automatic skill side-effect. |
| `yad repo sync [name]` | Switch every connected repo to its **default branch** and fast-forward it from origin (one or all). Dirty repos are skipped, never overwritten; fast-forward only. |
| `npx yadflow --version` | Print the installed CLI version. |

Flags: `--dir <path>` targets a project other than the cwd; `--force` re-copies unchanged files (or
bypasses the commit atomic guard). Commit flags: `--type`, `-m/--message`, `--task`, `--ai
<claude\|copilot\|cursor\|coderabbit\|none>`, `--contract-change`, `--dry-run`. `open-pr` flags:
`--repo`, `--risk <low\|medium\|high>`, `--contract-change`. `ship` takes the union of the `commit`
and `open-pr` flags (it runs `open-pr` only if the commit lands).

### The PR-driven review gate

The front-half gate now rides the **PR/MR you open per step** (`yad gate open`). Reviewers approve and
comment on the platform; `yad gate sync` maps that state into the file ledger (`approvals.json`,
`comments.json`, `reviews/*.md`) — which stays the source of truth — and the step **auto-advances on
merge** once three things hold: the reviewer rule is satisfied (owner + 1 reviewer, plus a domain-owner
per touched repo on escalated steps), every comment thread is resolved, and the review PR/MR is merged.
The merge click is the human approval act, so front steps still never `machine_advance`. Approvals are
**revoked when the reviewed artifact actually changes** (re-hash), giving reviewers a fresh pass. With no
hub platform / no `gh`/`glab`, the gate degrades to file-only with no error.

**Solo mode.** A lone developer can't approve their own PR on GitHub, so an approval requirement would
deadlock them. Opt in (`yad setup --solo`, recorded as `solo: true` in `.sdlc/hub.json`) and the gate
**waives the approval requirement only** — the review PR/MR and its merge stay, so CI still runs on the
PR and the **merge** advances the step. Net: the gate passes on *merged + all threads resolved*. It's a
documented, reversible relaxation; `yad doctor` warns if branch protection still "requires approvals"
(which would block the solo dev's own merge).

**Event-driven sync.** Wire the hub once (`yad check --fix` installs `.github/workflows/yad-gate-sync.yml`,
or the GitLab fragment + schedule) and every **approval, change request, and merge** on a review PR/MR
triggers `yad gate ci` in the hub's own CI: the ledger updates land directly on the hub's default branch
— no manual `yad gate sync` needed (it stays valid as the fallback). CI never approves and never merges;
the human keeps the merge click. GitLab caveat: approvals are only picked up by the ~15-min scheduled
sweep (GitLab fires no pipeline on approval) — details in `skills/yad-hub-bridge/references/bridge.md`.
Concurrency caveat: on GitHub the workflow's `concurrency` group serializes runs repo-wide and every
sync re-reads the full platform state, so racing reviewer events lose nothing. Outside that group —
a manual `yad gate sync` racing CI, or GitLab pipelines — two simultaneous syncs serialize their
*commits* via the rebase retry but each works from the state it read at start, so the rarer of two
simultaneous advancements can be lost; the next event or scheduled sweep re-syncs and converges.

### What `setup` walks you through (a guided, branching interview)

Setup opens with a short **profile interview** — *solo or team (how many)? greenfield or brownfield?
monorepo or separate repos?* — and the answers (recorded in `.sdlc/hub.json` as `solo` + `profile`)
branch the rest so you only answer what your situation needs. Each step prints inline guidance (what it
does / why / what to enter / what skipping means), and the step count adapts.

0. **Profile** — the three questions above, plus "configure optional tools now?". Pre-answer for
   CI/scripts with `--solo`/`--team <n>`, `--greenfield`/`--brownfield`, `--monorepo`/`--separate`, `--tools`.
1. **Preflight** — confirm the hub is a git repo (offers `git init`); check `git`/`node`/`npx`.
2. **Install the module** — copy all 31 `yad-*` skills into the IDE skill dirs you pick
   (`.claude/`, `.agents/`, `.zencoder/`, `.opencode/`) and register `_bmad/sdlc/`.
3. **Hub platform & roster** — detect GitHub/GitLab from the remote; record reviewers → `.sdlc/hub.json`.
   **Solo skips the roster** (you review by merging your own PR). Edit the roster any time with `yad roster`.
4. **Optional tools** — design (Figma/pencil), testing (Playwright/cypress/pytest), learning (DeepTutor).
   Configure now, or **defer with one prompt** → all recorded as `none` (connect later with the
   `yad-connect-*` skills; the MCPs/CLIs are confirmed there).
5. **Connect code repos** — register repos into `.sdlc/repos.json`. **Monorepo** connects one repo and
   skips domain-owner prompts; **greenfield** skips the Repomix pack (run `yad repo refresh` once it has code).
6. **Wire each repo** — CI gates, PR/MR template, and review-comment scaffold.
7. **AI review** — optionally write `.coderabbit.yaml`.
8. **Done** — stamp `.sdlc/cli-version.json` and print a **profile-tailored next step** (brownfield →
   `yad-backfill` first; everyone → `yad next` and your first epic via `yad-epic`).

The deterministic file work runs automatically; the AI-only steps are handed to the Claude Code skills
with a printed next-action. Re-run `… check --fix` any time the workflow updates — it never re-asks for
input you already gave; re-running `setup` carries your profile forward.

**Releases:** automated via semantic-release on merge to `main` (Conventional Commits → npm, with
provenance). See [`RELEASING.md`](RELEASING.md).

**Maintainers / no-CLI fallback:** the underlying copy is still a single script —
`bash skills/sdlc/install.sh` — which the CLI's install step is a port of. The **source** stays in
`skills/`, which a `bmad-method` update does not touch, so after any BMAD update just re-run the CLI
(`… check --fix`) or the script.

> **Releases are automated.** A `feat:`/`fix:` commit merged to `main` triggers
> [semantic-release](https://semantic-release.gitbook.io/): it computes the version from the
> [Conventional Commits](CONTRIBUTING.md), publishes to npm with build provenance (tokenless OIDC),
> ships the `CHANGELOG.md` in the tarball, and cuts a GitHub release. No manual `npm publish`. See
> [`RELEASING.md`](RELEASING.md).

### Troubleshooting (`yad doctor` + error codes)

When something is off, run `yad doctor` first — it checks the environment (git, gh/glab auth, node
version), the project state (`.sdlc/*.json` parse and point at real repos), and every epic ledger,
with a fix-it hint per finding. Failures carry stable, greppable codes, also printed by any failing
`yad` command:

| Code | Meaning | Fix |
|------|---------|-----|
| `YAD-ENV-001` | git is not installed or not on PATH | install git — every yad command needs it |
| `YAD-ENV-002` | platform CLI (gh/glab) missing or not authenticated | install it and authenticate — `gh auth login` (GitHub) or `glab auth login` (GitLab); the gate degrades to file-only without it |
| `YAD-ENV-003` | Node.js older than the supported range | install Node >= 18 |
| `YAD-STATE-001` | a ledger/config JSON file exists but does not parse | fix the file or restore from git — never delete a ledger blindly |
| `YAD-STATE-002` | a ledger/config file parses but has the wrong shape | fix the file or restore from git (the message names the field) |
| `YAD-STATE-003` | a registered repo path is missing or not a git repo | fix the path in `.sdlc/repos.json` or re-connect the repo |
| `YAD-CFG-001` | `hub.json` names an unknown platform | expected `github`, `gitlab`, or `null` — fix it or re-run `yad setup` |
| `YAD-CFG-002` | `design.json` names an unknown design tool | expected one of `config.yaml` `design.tools` (e.g. `figma`, `pencil`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-003` | `testing.json` names an unknown testing tool | expected one of `config.yaml` `testing.tools` (e.g. `playwright`, `cypress`, `pytest`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-004` | `learning.json` names an unknown learning tool | expected one of `config.yaml` `learning.tools` (e.g. `deeptutor`), or `none` — fix it or re-run `yad setup` |

Filing a bug? Attach `yad doctor --json` — it contains no secrets (names, paths, and check results only).

## Agent skills (all 31)

The CLI **installs and wires** the module; the skills below are the **agents you invoke by name** in your
AI IDE (e.g. *“run `yad-epic`”*) to actually do the work. State lives in files you can also edit
directly. Each skill stops at a gate and never auto-advances unless a step has *earned* automation.

### Setup & code-awareness

- **`yad-connect-repos`** — Connects code repos to the product hub so the front/"brain" phases are
  code-aware. Registers N code repos (GitHub or GitLab, local-user auth, no stored tokens) into
  `.sdlc/repos.json`, then caches an AI-readable picture of each — a compressed Repomix pack and a
  lightweight code-map (existing endpoints/events/data-models/modules), secret-scanned. Idempotent and
  refreshable; staleness tracked by HEAD sha.
- **`yad-sync-repos`** — Brings every connected repo up to date in one shot: switches each repo in
  `.sdlc/repos.json` to its `default_branch` and fast-forwards it from origin (local-user git, no stored
  tokens). A working-tree-only maintenance op — never a gate, never writes the registry. A dirty repo is
  skipped and reported (never overwritten); a diverged branch is left for manual resolution. Drives
  `yad repo sync [name]`.
- **`yad-connect-design`** — Connects a design tool (Figma-first, pluggable) so the UI step can
  materialize the actual feature design (mobile screens / web pages) inside it, alongside the Markdown.
  Records the tool + project/file references in `.sdlc/design.json` (local-user / MCP-session auth, no
  stored tokens), detecting the design-tool MCP and degrading to markdown-only when absent. Idempotent
  and refreshable; one connection per project.
- **`yad-connect-testing`** — Connects a testing tool (Playwright-first, pluggable) so the test-cases
  step can implement the actual automation tests inside it, alongside the Markdown. Records the tool +
  project/suite references in `.sdlc/testing.json` (local-user / MCP-session auth, no stored tokens),
  detecting the testing-tool MCP and degrading to artifacts-only when absent. Idempotent and
  refreshable; one connection per project.
- **`yad-connect-learning`** — Connects a learning/tutoring tool (DeepTutor-first, pluggable) so the
  cross-cutting learning layer can tutor any team member in the context of what's being built. Records
  the tool + an optional grounded knowledge base in `.sdlc/learning.json` (local-user auth, no stored
  tokens), detecting the **DeepTutor CLI on PATH** (a subprocess like Repomix — DeepTutor ships no MCP)
  and degrading to **harness-native** tutoring when absent. Idempotent and refreshable; one connection
  per project.
- **`yad-connect-docs`** — Connects a docs/Pages target (GitHub Pages / GitLab Pages, auto-detected from
  `hub.json`) so the generated documentation sites can deploy. Records the target + scope + base path in
  `.sdlc/docs.json` (local-user auth, no stored tokens), degrading to **build-only** when no Pages host /
  CLI is present. Idempotent and refreshable; one connection per project.

### Living documentation (generated, themed, auto-kept-fresh)

- **`yad-docs`** — Generates an **interactive documentation site** for an epic (a React + Vite + Tailwind
  SPA: an animated front-stage flow canvas + role-based stakeholder doc pages) from the authored
  artifacts — `epic.md`, `architecture.md`, the locked `contract.md`, `ui-design.md`, the stories — into
  `epics/EP-<slug>/docs-site/`, themed by the **connected design system** (`DESIGN.md` / `design.json`
  tokens → the site's CSS). The content lives in generated `src/data/*.ts`; the shell is a vendored
  template. An **output enrichment, never a gate** — it never touches epic state, approvals, or the
  contract lock. `generate` / `refresh` / `deploy`.
- **`yad-docs-overview`** — Generates the project **SDLC-overview site** (`docs/sdlc-site/`) — every
  stage from setup → ship as flow paths / system components / stakeholder roles, reusing the same shell —
  superseding the hand-maintained `docs/index.html` (folded into the site as `public/report.html`, linked
  from the nav).
- **`yad-docs-sync`** — Keeps the sites fresh: detects staleness (a content hash of the authored
  artifacts + the connected repos' HEAD shas vs each site's build manifest), regenerates + redeploys, and
  can wire a CI job that rebuilds on push. Generalizes the rule that feature work must hand-update the
  docs — the overview now regenerates whenever the skill set / pipeline changes.

### The learning layer (cross-cutting — any member, any stage)

- **`yad-learn`** — At **any** SDLC stage, a team member can ask to learn a concept and be tutored *in
  the context of what the team is building* — e.g. *"teach me why the architecture hash-locks the
  contract surface"*. Routes the request to the connected learning tool (`.sdlc/learning.json`,
  DeepTutor-first) grounded in the project knowledge base, or degrades to **harness-native** tutoring
  (the harness model reading the artifacts) when nothing is connected — so it always works. Renders a
  tutorial artifact and appends to a per-member **learning ledger** kept **local-only** (gitignored,
  never committed or pushed — to the hub or any code repo) so it stays a private, personal **skills log**
  (`yad-status` rolls up the local records). **Purely opt-in — it never blocks a gate** and
  never touches epic state, approvals, or the contract lock. *AI builds, the hand decides* — and now the
  hand can also learn, on demand, what it is deciding about.

### Front-zero — frame the whole project (once per project, optional, human-gated)

- **`yad-discovery`** — *Optional* front-zero, for **greenfield and brownfield**. With the analyst
  and pm, run market research, a **competitor study** (both modes), a feasibility study, and — in
  brownfield — a code-aware current-state study, then distil a **functional + non-functional
  requirements** list and a **phased roadmap** (an explicit **MVP** phase, then later phases) under the
  reserved `EP-discovery` ("epic zero"). It is gated by the same review gate (base rule: owner + 1
  reviewer); on approval it terminates at `discovery-done` (no build half). Its `roadmap.md` is the menu
  of features — each `yad-epic` reads it for project context (reference-only; discovery never
  auto-seeds epics).

### Front half — author the "thinking" (once per epic, human-gated)

- **`yad-analysis`** — *Optional* front state 1. With the analyst, pressure-test a feature idea
  and write the discovery brief into `analysis.md`. Assigns the `EP-<slug>` ID and seeds `.sdlc/` state
  (the 12-step chain that puts analysis before epic). If skipped, the epic step does this shaping inline.
- **`yad-epic`** — The epic front state. Shape the idea with the analyst (or read `analysis.md`
  when it already ran), then write the epic with the pm into `epic.md`. The entry point when analysis is
  skipped: assigns the `EP-<slug>` ID and seeds `.sdlc/` state.
- **`yad-architecture`** — Front state 3. With the architect, author `architecture.md` and the
  locked `contract.md` (the shared cross-repo surface), then hash-lock the contract surface into
  `.sdlc/contract-lock.json`. Reads `epic.md`; escalates on the contract risk tag.
- **`yad-ui`** — Front state 5. With the ux-designer, author `ui-design.md` and `DESIGN.md`,
  driving Impeccable as harness slash-commands (document/extract/craft) when installed, or authoring
  directly when not. When a design tool is connected (`yad-connect-design`), also **materializes the
  feature design** — mobile screens / web pages — in the tool (generate or link), recording the
  screen→frame map in `design-links.json`; degrades to markdown-only otherwise. Reads epic + architecture.
- **`yad-stories`** — Front state 7. With the pm, break the approved epic into user stories, each
  tagged with the repos that must implement it. Assigns zero-padded `EP-<slug>-S0N` IDs, one file per
  story under `stories/`. Reads epic + architecture + contract + UI.
- **`yad-test-cases`** — Front state 9, a **parallel, non-blocking** track: it opens when the stories
  gate passes (the epic is already `ready-for-build`, so the build half runs alongside it). With the
  test architect (Murat), author `test-cases.md` covering the approved stories (risk-based P0–P3 cases +
  story→case traceability). When a testing tool is connected (`yad-connect-testing`), also **implements
  the automation tests** in the connected code repo(s) (generate or link), recording the case→test map in
  `test-links.json`; degrades to artifacts-only otherwise. Reads epic + architecture + contract + UI +
  stories.

### The review gate (cross-cutting — used by every review)

- **`yad-review-gate`** — The reusable team review + approve gate. Shares an authored artifact, records
  reviewer comments and approvals as files, enforces the **owner + 1 reviewer** rule (escalating to
  domain owners on contract/auth/payments), and advances the epic state **only** when approval is
  recorded.
- **`yad-hub-bridge`** — The templated PR/MR bridge for the front-half gate. When the hub has a platform
  (`.sdlc/hub.json`), it opens a review PR/MR per artifact, sets the required reviewers/labels, and
  provides the read-only `gh`/`glab` recipes that sync platform comments + approvals back into the file
  ledger. The file ledger stays the source of truth; degrades to a file-only gate with no platform.
- **`yad-review-comments`** — Installs platform-matched PR/MR review-comment scaffolds so reviewers
  leave structured, attributable feedback that maps cleanly into the file ledger.

### Build half — turn stories into shipped code (once per story, per repo)

- **`yad-spec`** — Step A. For one ready-for-build story and one of its repos, run the Spec Kit ceremony
  once (specify → clarify → plan → analyze → checklist → tasks) → `specs/<story-id>/`. Drives `/speckit.*`
  when installed; references the locked contract — never re-invents the surface.
- **`yad-implement`** — Step B. With the dev lens, implement **one** atomic task as a small diff
  (≤3 files) on its own branch. The diff stays inside the files the task declared (flag and STOP if it
  would grow). Commit ends with the task ID; `Contract-Change: yes` only if it touches the locked
  contract surface.
- **`yad-checks`** — Step C, the production-safety gates. Wire and run the CI gates: **spec-link**
  (every change links a real story/spec), **contract-check** (a contract-surface diff without a
  re-locked contract FAILS), **build/test/lint**, **verified-commits** (signed + roster-known authors),
  and the **pattern gates** — **commit-message** (Conventional subject + trailer order), **pr-title**,
  and **pr-template** (the PR/MR body uses the template). Profile-aware (`code`|`hub`), so they run on
  both code repos and the product hub. CI-agnostic bash for GitHub Actions and GitLab CI.
- **`yad-pr-template`** — Step D. Detect the repo's platform and commit the matching PR/MR template with
  an Impact & Risk block; high risk (or a contract/auth/payments surface) routes the review to domain
  owners. Includes `risk-route.sh` plus the `pr-title.sh` / `pr-template.sh` gate scripts.
- **`yad-commit`** — build helper. Commit ONE staged atomic change by the conventions (Conventional
  subject, `Task → Contract-Change → Co-Authored-By` trailers, the `--ai` co-author footer, the ≤3-file
  atomic guard). Drives `yad commit`.
- **`yad-open-pr`** — build helper. Open a code-repo task PR/MR from the committed template: push the
  branch, prefill the body, auto-assign the repo-scoped roster. Drives `yad open-pr`.
- **`yad-ship`** — build helper. Commit **and** open the task PR/MR in one step (`yad commit` then
  `yad open-pr`; the PR step runs only if the commit lands). Drives `yad ship`.
- **`yad-engineer-review`** — Step E. AI review (CodeRabbit, advisory) → engineer review (the human gate,
  owner + 1 reviewer with the same escalation) → on merge, record the ship in the epic build-log and
  update the story state so the epic → story → task → PR chain stays traceable.
- **`yad-backfill`** — Step G. Generate specs for already-built features in an existing repo so new work
  doesn't break them: pack one feature at a time with Repomix, write a DRAFT spec, require human approval
  before it counts. A change is blocked only until the features it touches have approved specs.

### Automation & status

- **`yad-run`** — The Phase 4 orchestrator. Drives a story's back-half loop (spec → tasks → implement →
  checks) on each step's automation dial, recording every run in the trust log. A clean `checks` pass
  auto-advances to engineer-review; any failure, scope overrun, or contract-surface touch HALTS for a
  human. Also sets a step's dial (gated by trust evidence) and flips the system-wide kill switch.
- **`yad-status`** — Read-only view of an epic: the current step, each step's dials (assistance/
  automation) and status, which approvals are still required, per-story back-half trust records, the
  kill-switch state, and a fleet roll-up across epics.

## The two dials (per step, build plan §2)

- **assistance:** `none` | `review` | `heavy` — how much AI helps.
- **automation:** `human_approve` | `machine_advance` — who advances the step.

Defaults: every step starts `human_approve`. The four **front** authoring steps (epic, architecture,
UI, stories) and their reviews are **locked** — they may not be set to `machine_advance` in this
version. A front state advances only on a **human act** — recording an approval and `advance`, or
merging the approved, fully-resolved review PR — never on a machine.

As of **Phase 4a** the `automation` dial is no longer inert: the orchestrator `yad-run` reads it and,
for the safe **back** steps, advances on its own when a step is set to `machine_advance` (and has
*earned* it — see "Run the back half on the dial" below). The engineer review and all five front
states stay `human_approve` forever.

## Using the workflow end to end (all the steps, in order)

This is the full path from nothing to shipped code. Each numbered step names the skill to invoke; the
detailed sections below expand every phase. Invoke a skill by name in your agent/IDE (e.g. *“run
`yad-epic`”*); state lives in files you can also edit directly.

### 0 — One-time setup

> **Shortcut:** `npx yadflow setup` runs the guided wizard interactively — module install, hub
> detect + roster, connect a design/testing/learning tool (each optional), connect repos, wire each
> repo. Run `… check --fix` any time afterwards to reconcile. The manual steps below are the
> long-hand equivalent and still work.

1. **Install the module:** `bash skills/sdlc/install.sh` (re-run after any BMAD update).
2. **Have your code repo(s).** They are **separate git repos** (one `.git` each). For the demo they
   live under `demo-repos/<repo>/` — regenerate from `demo-repos/README.md`.
3. **Optional tools** (the workflow degrades gracefully and records it if any are absent): **Spec Kit**
   (`/speckit.*`), **Impeccable** (`/impeccable …`), **Repomix** (`npx repomix`, used by
   `yad-connect-repos` and `yad-backfill`), **CodeRabbit** (advisory AI review), **DeepTutor**
   (`deeptutor`, the learning layer's tutor — degrades to harness-native, used by `yad-connect-learning`
   and `yad-learn`).
4. **Wire each code repo once:** `yad-checks repo:<repo> action: wire` (installs the CI gates —
   *merges* with any existing CI, never clobbers), `yad-pr-template repo:<repo> action: wire` (PR/MR
   template + risk routing), `yad-review-comments repo:<repo> action: wire` (review-comment scaffold).
5. **Connect each code repo to the hub** (so the front phases see what's already built):
   `yad-connect-repos action: connect repo:<repo> path:<path-or-git_url> domain_owner:<who>`. It
   registers the repo in `.sdlc/repos.json` and caches a Repomix pack + a lightweight **code-map**
   (existing endpoints/events/data-models/modules, secret-scanned). Clones/fetches as the **local user**
   (SSH or credential helper; GitHub or GitLab; no stored tokens). Re-run for any new repo. Freshness is a
   **human decision**: `yad repo list` shows fresh/stale, `yad repo refresh [name]` re-packs a moved repo
   (skills flag staleness and point here — they never silently re-pack). Greenfield → skip it.
6. **(Optional) Connect tools** so the matching steps do real work (each degrades gracefully and is
   recorded if absent): `yad-connect-design action: connect` (Figma-first → `design.json`, lets
   `yad-ui` materialize screens), `yad-connect-testing action: connect` (Playwright-first →
   `testing.json`, lets `yad-test-cases` implement automation), `yad-connect-learning action: connect`
   (DeepTutor-first → `learning.json`, powers the cross-cutting learning layer).
7. **(Optional) Put the hub on a platform** so the front-half review runs through real PRs:
   `yad-connect-repos action: detect-hub`, then `yad roster add <login>` once per reviewer (login →
   SDLC name + per-repo roles — the `add` walk asks for each connected repo's role; `yad roster grant`
   sets one directly), and `yad-pr-template repo:hub action: wire` / `yad-review-comments repo:hub
   action: wire` / `yad-checks repo:hub action: wire`. With no hub platform the front gate runs file-only.
8. **Conventions:** commits and PR/MR titles follow Conventional Commits (lowercase after the type), the
   human author owns each commit with an optional per-commit `Co-Authored-By` AI trailer — see
   [`CONTRIBUTING.md`](CONTRIBUTING.md).

### A — Front half (human-authored, once per epic)
Each author step writes its artifact, sets itself `done`, moves `currentStep` to its review, and
**stops at the gate**. Run every gate with **`yad-review-gate`** — or, when the hub is on a platform,
drive it deterministically with the **`yad gate`** CLI (`open → sync → … → merge`): the review rides
the per-step PR/MR and the step **auto-advances on merge** once approvals are satisfied and all comment
threads are resolved. Details: **“Run the full front half by hand”** below.

0. *(optional, once per project)* `yad-discovery` → the discovery set (`market-research.md`,
   `competitor-analysis.md`, `current-state.md`, `feasibility.md`, `requirements.md`, `roadmap.md`)
   under the reserved `EP-discovery` → review (base rule) → `currentStep: discovery-done`. The whole
   set is required to review; its `roadmap.md` then frames each epic below (read once it is approved).
6. `yad-epic` → `epic.md` (assigns `EP-<slug>`, seeds state) → review (base rule).
7. `yad-architecture` → `architecture.md` + locked `contract.md` → review (**escalated**: contract).
8. `yad-ui` → `ui-design.md` + `DESIGN.md` → review (base rule).
9. `yad-stories` → repo-tagged `stories/EP-<slug>-S0N.md` → review (**per-repo**).
   → `state.json` reaches `currentStep: ready-for-build` — **the build half can start now.**
10. `yad-test-cases` → `test-cases.md` (+ automation tests when a testing tool is connected) → review (base rule).
    **Parallel, non-blocking:** opens when the stories gate passes and runs alongside the build half; its
    review never moves `currentStep` off `ready-for-build`.

### B — Build half (per story, per repo)
From a `ready-for-build` story, for **each** repo the story is tagged with. Details: **“Run the full
build half by hand”** below.

10. `yad-spec story:<id> repo:<repo>` → writes `specs/<story-id>/` (spec/plan/tasks + `link.md`).
11. `yad-implement story:<id> repo:<repo> task:<T0N>` → one atomic task = one branch = one commit
    (repeat per task). Commit by convention with **`yad commit --type <t> -m <subject> [--ai <tool>]`**
    (Task/Contract-Change/Co-Authored-By trailers, atomic-file guard).
12. `yad-checks repo:<repo> action: run` → spec-link, contract-check, build/test/lint, verified-commits
    (platform-Verified signature + roster-allowlisted author), and commit-message must pass. (The
    `pr-title` / `pr-template` gates need the PR title + body, so they run in CI once the PR exists —
    step 13.)
13. Open the PR/MR from the wired template with **`yad open-pr --repo <repo> [--risk <level>]`** (or do
    12+13 in one step with **`yad ship --type <t> -m <subject> --repo <repo>`**). The PR's CI now also
    runs the `pr-title` and `pr-template` gates; `yad-pr-template repo:<repo> action: route` prints the
    required reviewers from the Impact & Risk block.
14. `yad-engineer-review` → `ai-review` (advisory) → `approve` (the human engineer gate) → `ship` (merge,
    record in `build-log.json`, update story status to `in-build`/`shipped`).
    - **Multi-repo:** repeat 10–14 in each repo, all from the **one** locked contract.
    - **Existing code:** `yad-backfill` first, to produce a human-verified spec for a built feature.

### C — Automation (optional, earned over time)
15. After a back step accumulates trust evidence, earn it:
    `yad-run action: set-dial step:<step> to: machine_advance` (refused if evidence is short or for a
    front state / the engineer review).
16. Drive a story's back half on the dials: `yad-run story:<id> repo:<repo>` — it auto-advances
    earned steps and stops for a human otherwise, always halting at the engineer review.
17. **Kill switch any time:** `yad-run action: kill` (everything → manual) / `action: unkill`.
Details: **“Run the back half on the dial”** below.

### Any time
- **`yad-status [EP-<slug>]`** — read-only: the front chain, each build step's dial + status, the
  trust record, and (across epics) the fleet roll-up. Start here to see what's blocking.

## Run the full front half by hand

Optionally preceded once per project by the **front-zero** — **`yad-discovery` → review →
`discovery-done`** — which frames the whole product (market, competitor, feasibility, requirements,
roadmap) under the reserved `EP-discovery`; its approved `roadmap.md` then feeds each epic. The front
half itself walks **epic → review → architecture+contract → review → UI design → review → stories
→ review → `ready-for-build`**, then **test cases → review** runs as a **parallel, non-blocking track**
alongside the build half. It is all files under `epics/EP-<slug>/`. The skills below guide you, but you
can also edit the files directly — that's the point.

Each authoring step is the same shape: an author skill produces an artifact, sets its step `done`,
moves `currentStep` to the matching review, and **stops at the gate**. Then **`yad-review-gate`**
(one gate, reused for all five reviews) takes `open → comment → approve → advance`. When the hub is on a
platform, the **`yad gate`** CLI runs that gate over a real PR/MR — `open` raises the review PR, `sync`
pulls approvals + comment threads into the ledger, and the step **auto-advances when the approved,
fully-resolved PR is merged** (the merge is the human approval act).

**Code-aware (when repos are connected).** If you ran `yad-connect-repos` in setup, each author step
first loads the connected repos' **code-maps** (from `.sdlc/code-context/<repo>/`) so it considers what
already exists: the epic references existing behaviour, **the architecture cross-checks the contract
surface against existing endpoints/events/entities before hash-locking it**, the UI reuses existing
components, and stories anchor to real modules. Each artifact stamps what it read in its `code-context:`
frontmatter; a repo that has moved since connect triggers a staleness warning — the step **flags it and
stops**, pointing you at `yad repo refresh <repo>` (refreshing is a human decision, never an automatic
side-effect). With no repos connected the steps proceed exactly as before (greenfield-safe).

### Author steps
1. **`yad-epic`** (state 1) → `epic.md`; assigns the stable `EP-<slug>` ID; seeds
   `.sdlc/state.json` (all `human_approve`, front steps locked) + empty `.sdlc/approvals.json`.
2. **`yad-architecture`** (state 3) → `architecture.md` + the locked `contract.md`; writes the
   contract-surface SHA-256 to `.sdlc/contract-lock.json`.
3. **`yad-ui`** (state 5) → `ui-design.md` + `DESIGN.md` (drives Impeccable
   `document|extract|craft` slash-commands when installed; otherwise authors directly).
4. **`yad-stories`** (state 7) → one file per story `stories/EP-<slug>-S0N.md`, each tagged
   with the `repos` it implements.

### The one gate (every review)

Every review is the same loop — author writes, reviewers comment (which never advances), approvals
accumulate, and the step moves forward only when the rule is met. **File-only** ends in an explicit
`advance`; **PR-driven** (hub on a platform) ends when the approved, fully-resolved review PR is
**merged**:

<!-- Source: docs/diagrams/review-loop.mmd — edit the .mmd and run `npm run diagrams` to regenerate -->
![Review gate loop — author, open, comment, approve, advance](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/diagrams/review-loop.svg)

**File-only** — invoke **`yad-review-gate`** with `open` (present the artifact; reviewers comment in
`reviews/<artifact>--<date>--comments.md`), `approve` (name + role → `.sdlc/approvals.json`), and
`advance` (moves **only if** the rule is satisfied, else it names the missing approval).

**PR-driven** — when the hub is on a platform, the **`yad gate`** CLI runs the same gate over a PR/MR:
- `yad gate open <epic> <artifact>` — raise the review PR/MR; mark the step `in_review`.
- `yad gate sync <epic> [artifact]` — pull approvals + comment threads into the **same** ledger (your
  own `gh`/`glab`, no stored tokens) and **auto-advance on merge** once the rule is met and every thread
  is resolved. Approvals are **revoked when the reviewed artifact changes** (re-hash), so reviewers get
  a fresh pass. Unresolved comments hold the step `in_review`.
- `yad gate comments <epic>` fetches the open threads to address; `yad gate status <epic>` shows
  approvals (counting only the non-stale ones). The file ledger stays the source of truth; with no
  platform / no CLI it degrades to file-only.

**The gate rule, by review:**
- **Base** (epic, UI): `owner + 1 reviewer`.
- **Escalated** (architecture+contract — `risk_tags: ["contract"]`): base **plus a domain owner for
  every repo in `epic.repos`**. The contract-surface hash must still match `.sdlc/contract-lock.json`
  (a changed surface invalidates approvals).
- **Per-repo** (stories): base **plus a domain owner (the repo's engineer) for every repo that appears
  in any story's `repos`**.

### Check status anytime
Invoke **`yad-status`** (read-only) to see the full 10-step chain, every step's dials/status, the
contract lock, story repo tags, and which approvals the active gate still needs.

## Worked example (already in this repo)

`epics/EP-istifta-inquiries/` shows the **whole front half** walked end to end:
- `epic.md` authored + approved (epic gate, base rule) — 2026-06-04.
- `architecture.md` + `contract.md` authored; contract surface hash-locked in
  `.sdlc/contract-lock.json`. Architecture gate **escalated** (contract): owner *alice* + reviewer
  *bob* + domain owners *carol* (backend) and *dave* (mobile).
- `ui-design.md` + `DESIGN.md` authored (Impeccable not installed → graceful fallback). UI gate base
  rule (alice + bob).
- Five repo-tagged stories `stories/EP-istifta-inquiries-S01..S05.md`. Stories gate **per-repo**: base
  rule + a domain owner for each touched repo (carol/backend, dave/mobile).
- `state.json` now reads `currentStep: ready-for-build`, every front step `done` — the Phase 3
  handoff point.

Inspect it:
```bash
cat epics/EP-istifta-inquiries/.sdlc/state.json
cat epics/EP-istifta-inquiries/.sdlc/approvals.json
cat epics/EP-istifta-inquiries/.sdlc/contract-lock.json
ls  epics/EP-istifta-inquiries/reviews/
ls  epics/EP-istifta-inquiries/stories/
# re-verify the contract surface still matches its lock:
awk '/CONTRACT-SURFACE:BEGIN/{f=1;next} /CONTRACT-SURFACE:END/{f=0} f' \
  epics/EP-istifta-inquiries/contract.md | shasum -a 256
```

## Run the full build half by hand (Phase 3)

From a `ready-for-build` story, the **build half** turns one atomic task into shipped code through
gates that protect production. Per-repo specs live in each code repo; the contract stays singular in
the product repo. Code repos are **separate git repos** under `demo-repos/<repo>/` (gitignored;
`demo-repos/README.md` explains regeneration). **Nothing auto-advances** — every gate is human-owned.

1. **Spec** — `yad-spec` runs the heavy Spec Kit ceremony **once per story per repo**
   (`specify`→`clarify`→`plan`→`analyze`→`checklist`→`tasks`), writing `specs/<story-id>/` and a
   `link.md` back to the story (drives `/speckit.*` when installed, else degrades). It **quotes** the
   locked contract; it never widens it.
2. **Implement** — `yad-implement` (the `dev` step): one atomic task = one branch
   (`feat/<story>-<task>-…`) = one PR. The diff stays inside the files the task declared. Commit with
   **`yad commit`** — it builds the conventional subject, derives the `Task:` trailer from the branch
   (add `--contract-change` only if the locked surface is touched), appends an optional `--ai` co-author,
   and refuses a non-atomic stage. Open the PR with **`yad open-pr --repo <repo>`** (template prefilled),
   or do both in one step with **`yad ship`** (commit then open-pr).
3. **Check gates** — `yad-checks` wires the CI gates (GitHub + GitLab) that must pass before merge:
   **spec-link** (links a real story/spec), **contract-check** (a contract-surface change without
   `Contract-Change` + a re-locked contract FAILS, routing back to the architecture gate),
   **build/test/lint**, **verified-commits**, and the **pattern gates** **commit-message** / **pr-title**
   / **pr-template** (profile-aware `code`|`hub`, so they also run on the product hub). They fail closed
   on a bad base ref.
4. **PR/MR template + risk routing** — `yad-pr-template` drops the platform-matched template with an
   Impact & Risk block; `high` risk (or a contract/auth/payments surface) routes the review to domain
   owners (`risk-route.sh`), the same escalation as the gate.
5. **AI review → engineer review → merge** — `yad-engineer-review`: CodeRabbit is an advisory first pass
   (never the authority); a human engineer approves (owner + 1 reviewer, escalating to domain owners); on
   merge the ship is recorded in `.sdlc/build-log.json` and the story state becomes `in-build` →
   `shipped`. The epic → story → task → PR → mergeCommit chain is traceable both ways.

**Multi-repo:** a story tagged `repos: [backend, mobile]` runs the above in each repo independently from
the **one** locked contract; the contract-check blocks a surface bypass in either repo.

**Backfill existing code:** `yad-backfill` packs one feature with **Repomix** (`npx repomix`, secret-scan
by default), drafts an *unverified* spec ("describe what exists, do not invent"), a human approves it,
and `backfill-check.sh` blocks a change to that feature until its spec is approved — gated per touched
feature, never the whole repo.

The build half is walked end to end on the worked epic: story **S01** shipped (`status: shipped`,
three tasks in `build-log.json`), **S03** built across backend + mobile, and a `health` feature
backfilled. The code repos are regenerable from `demo-repos/README.md`.

## Run the back half on the dial (Phase 4 — automation, earned)

Phase 4 is **automation, earned with evidence and reversible in one move**. Phase 4a made the
`automation` dial real and earned the safest step (the check-gate advance); Phase 4b added the
`implement → check` hand-off and the `spec`/`tasks` trust hooks. The engine is `yad-run`; the
evidence lives in two new files per epic under `.sdlc/`: `build-state/<story-id>.json` (the back steps
with their dials, per repo) and `trust-log.json` (every run's verdict). See
`docs/phase-4-build-plan.md` and `docs/phase-4b-build-plan.md`.

- **Drive a story's back half:** `yad-run {story} {repo}` walks `spec → tasks → implement → checks`,
  reading each step's dial. On `machine_advance` it advances on its own; on `human_approve` it stops
  for a human; on any FAIL, scope overrun, or contract-surface touch it **halts and pulls in a human**.
  It always stops at the engineer review (`yad-engineer-review`), which is never automated.
- **Read the trust log:** `yad-status {epic}` shows each back step's dial, status, and trust record —
  runs, % `approved-unchanged`, and whether that clears the threshold (`automation.trust_threshold` in
  `config.yaml`, default ≥5 runs and ≥80% unchanged). The engineer review records each run's verdict
  (a diff merged as-authored is `approved-unchanged`; one edited first is `approved-with-edits`; a
  failed one is `rejected`).
- **Earn automation for a step:** once a step's trust record clears the threshold,
  `yad-run action: set-dial step: checks to: machine_advance` flips it. The setter **refuses** if the
  evidence is short, or for any front state / the engineer review. Reverting
  (`to: human_approve`) is always allowed — automation is reversible in one move.
- **Kill switch:** `yad-run action: kill` forces every step back to `human_approve` system-wide
  instantly (no code change, no per-step edits); `yad-run action: unkill` restores earned automation.

**Earned so far:** `checks` (Step B, Phase 4a) and `implement` (Step D, Phase 4b — the
`implement → check` hand-off; the scope/contract halts and the engineer review still gate the merge).
`tasks` (Step C) and `spec` have their dials + trust hooks but stay `human_approve` until their own
runs clear the threshold — there is no historical signal to seed them from, so they are earned only on
genuine runs (never fabricated). See `docs/phase-4b-build-plan.md`.

## What's intentionally NOT built yet

**Phase 4b Step C** (the remaining automation): `tasks` generation advance — gated until real
`tasks`/`spec` trust evidence accrues. The hook that records that evidence is built; the dial flips
only once the threshold is genuinely met. The scope guard and contract-surface halt always override
the dial, and **front states and the engineer review stay `human_approve`, permanently.**

**Phase 5 (conditional):** the optional service layer (watch repos, run earned-automation steps
unattended, read-only dashboards), built only when the CLI genuinely can't keep up, with git remaining
the source of truth. It is **trigger-gated** — `docs/phase-5-build-plan.md` is the build plan: its
three parts (read-index, unattended runner, dashboard) each ship only when *their* bottleneck is
measured, with the hard rules they inherit and the instrumentation (already shipped in `yad-status`)
that makes the decision data-driven. See also `docs/claude-code-build-plan.md` §8.
