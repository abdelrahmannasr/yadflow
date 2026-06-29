# Agent skills (all 34)

The CLI **installs and wires** the module; the skills below are the **agents you invoke by name** in your
AI IDE (e.g. *"run `yad-epic`"*) to actually do the work. State lives in files you can also edit
directly. Each skill stops at a gate and never auto-advances unless a step has *earned* automation.

For the big-picture concepts see the [README](../README.md); for the step-by-step path see
[`WALKTHROUGH.md`](WALKTHROUGH.md) or the [team guide](../TEAM-GUIDE.md). A condensed "when do I reach
for it" table is in the [team guide §11](../TEAM-GUIDE.md).

## Setup & code-awareness

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

## Living documentation (generated, themed, auto-kept-fresh)

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

## The learning layer (cross-cutting — any member, any stage)

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

## Front-zero — frame the whole project (once per project, optional, human-gated)

- **`yad-discovery`** — *Optional* front-zero, for **greenfield and brownfield**. With the analyst
  and pm, run market research, a **competitor study** (both modes), a feasibility study, and — in
  brownfield — a code-aware current-state study, then distil a **functional + non-functional
  requirements** list and a **phased roadmap** (an explicit **MVP** phase, then later phases) under the
  reserved `EP-discovery` ("epic zero"). It is gated by the same review gate (base rule: owner + 1
  reviewer); on approval it terminates at `discovery-done` (no build half). Its `roadmap.md` is the menu
  of features — each `yad-epic` reads it for project context (reference-only; discovery never
  auto-seeds epics).

## Front half — author the "thinking" (once per epic, human-gated)

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

## The review gate (cross-cutting — used by every review)

- **`yad-review-gate`** — The reusable team review + approve gate. Shares an authored artifact, records
  reviewer comments and approvals as files, enforces the **owner + 1 reviewer** rule (escalating to
  domain owners on contract/auth/payments), and advances the epic state **only** when approval is
  recorded.
- **`yad-hub-bridge`** — The templated PR/MR bridge for the front-half gate. When the hub has a platform
  (`.sdlc/hub.json`), it opens a review PR/MR per artifact, sets the required reviewers/labels, and
  provides the read-only `gh`/`glab` recipes that sync platform comments + approvals back into the file
  ledger. The file ledger stays the source of truth; degrades to a file-only gate with no platform.

## Build half — turn stories into shipped code (once per story, per repo)

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

## Automation & status

- **`yad-run`** — The Phase 4 orchestrator. Drives a story's back-half loop (spec → tasks → implement →
  checks) on each step's automation dial, recording every run in the trust log. A clean `checks` pass
  auto-advances to engineer-review; any failure, scope overrun, or contract-surface touch HALTS for a
  human. Also sets a step's dial (gated by trust evidence) and flips the system-wide kill switch.
- **`yad-status`** — Read-only view of an epic: the current step, each step's dials (assistance/
  automation) and status, which approvals are still required, per-story back-half trust records, the
  kill-switch state, and a fleet roll-up across epics.

## Post-lock change management — feature threads (Phase 6)

After the contract locks and code ships, a change must **not** mutate a locked artifact — it becomes a
**new epic threaded to its parent**. A feature is a *thread* of linked epics (genesis → change → defect →
…); a change-epic **inherits** the front artifacts it does not change (by reference) and **re-authors**
only what it does. So artifacts never go stale — they are *superseded*; the feature's current truth is the
head of the thread. This is what keeps the SDLC a trusted source of truth for AI on the next change.

- **`yad-change`** — the intake + triage. Classifies the change *depth* (defect-fix /
  behavioral-no-surface / contract-surface / new-capability), seeds a new `EP-<slug>` threaded to its
  parent (lineage frontmatter, an inherited-step `state.json`, a pointer-lock `contract-lock.json`,
  `change.json`), and for hotfixes opens `reconcile-debt.json`. Never auto-advances — hands off to the
  normal authoring skills + the review gate.
- **`yad-timeline`** — render the thread as an evolution view (yad-docs shell + `TIMELINE.md`) and emit
  `thread-resolved.md`, the composed **current-truth map** (which epic owns each artifact now).
- **`yad-defects`** — a per-epic/per-thread quality-gap report aggregating defects by **`escape_stage`**
  (the gate that should have caught it) + `root_cause` — *where the SDLC leaks*, so the team hardens the
  originating stage.
- **`yad-reconcile`** — a read-only drift/orphan/debt sweep across threads (mirrors `yad-docs-sync`; never
  a gate). The hard block is the CI gates.

Three CI gates (in `yad-checks`) enforce it: **lineage-check** (a change links a real threaded epic),
**epic-open** (a *sealed* epic — all stories shipped — refuses new behaviour, forcing a change-epic so the
front artifacts can never go stale), and **reconcile-debt** (a thread with open hotfix debt is frozen
until paid). Two read-only CLIs surface it: `yad thread <epic>` (the thread + resolved truth + open debt)
and `yad reconcile` (the drift sweep).
