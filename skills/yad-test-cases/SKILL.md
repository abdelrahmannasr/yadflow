---
name: yad-test-cases
description: 'Front state 9 of the gated SDLC — a PARALLEL, non-blocking track. Opens when the stories gate passes (the epic is already ready-for-build, so the build half can start at the same time) and runs alongside implementation. With the test architect (Murat), author test-cases.md for the approved stories, and — when a testing tool is connected — generate/link the actual automation tests in it; otherwise produce the test-case artifact only. Reads epic + architecture + contract + UI + stories as input. Never auto-advances — hands off to the team review gate. Use when the user says "author the test cases" or after the stories gate passes.'
---

# SDLC — Author Test Cases (front state 9 — parallel, non-blocking)

**Goal:** Produce a human-authored, AI-assisted `test-cases.md` for an approved epic — the risk-based
test cases that cover the stories' acceptance criteria — **and**, when a testing tool is connected, the
**actual automation tests** inside the connected code repo(s), linked back from the artifact. This is a
**front state**: human-authored with AI assist, **never auto-advances**. When the test cases are
drafted, control passes to `yad-review-gate` (base rule: owner + 1 reviewer).

**This step does NOT block the build half.** It opens when the **stories** gate passes — at which point
the epic is already `ready-for-build`, so implementation (`yad-spec` → `yad-implement` → …) can start
**at the same time** the tester works here. The test-cases track is driven by its own step `status`
(it opens to `in_progress` when `stories-review` passes) and its review **never moves `currentStep`
away from `ready-for-build`**, so the two run in parallel.

Test work is shaped by the **test architect** lens — **Murat** (`bmad-tea`), driving
`bmad-testarch-test-design` for the cases and `bmad-testarch-automate` for the automation. The
automation is materialized in the **testing tool connected via `yad-connect-testing`**
(`.sdlc/testing.json`), reached through its MCP. When a tool is connected the lens **generates** tests
into it (or **links** an existing suite and reads it back); when none is connected, the step degrades to
the Markdown artifact only — the testing tool is additive, exactly like the design tool.

## Conventions

- `{project-root}` resolves from the project working directory.
- Artifacts live under `{project-root}/epics/EP-<slug>/` (build plan §6).
- The connected testing tool is recorded in `{project-root}/.sdlc/testing.json` (`config.yaml`
  `testing`), written by `yad-connect-testing`. The per-epic case→test map is `test-links.json`
  (Step 4b).
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## On Activation

### Step 1 — Resolve the epic and check the track
Resolve the `EP-<slug>` (ask if not provided). Read `.sdlc/state.json`. Only proceed when the
**`test-cases` step's `status == "in_progress"`** — it opens when `stories-review` passes (the epic is
already `ready-for-build` by then; `currentStep` stays there because this is a parallel track, so do
**not** gate on `currentStep`). If `test-cases` is still `blocked`, the stories review has not passed —
stop and point the user at `yad-status` / the gate.

### Step 1b — Open the authoring branch
Open the test-cases authoring branch `test-cases/EP-<slug>` per the shared procedure
(`../yad-epic/references/state-schema.md` → "Authoring branches"): git-safe (skip with a note if
`{project-root}` is not a git work tree), check out the branch if it exists, else create it from the
hub's default branch. Author and commit `test-cases.md` on it. This is **distinct** from the bridge's
`review/…` branch.

### Step 2 — Read inputs
Read `epic.md` (user-level acceptance signals, scope), `architecture.md` (flows, components by repo),
`contract.md` (the shared surface under test), `ui-design.md` (screens/states the tests exercise), and
**all** approved `stories/EP-<slug>-S0N.md`. Each story's **acceptance criteria are the source of truth**
for the cases — the test cases must collectively verify every story's criteria.

### Step 2b — Load existing-code context (make the brain code-aware)
Read the registry `{project-root}/.sdlc/repos.json` (`config.yaml` `code_context`). For **each repo in
`epic.repos`**, load the code-map `{project-root}/.sdlc/code-context/<repo>/code-map.md` so the
automation **targets real existing endpoints/components and reuses existing fixtures** rather than
inventing parallel ones.

- **Greenfield-safe:** if `repos.json` is absent/empty, note "no repos connected" and proceed.
- **Staleness:** if a repo's current HEAD ≠ its registry `syncedHead`, warn and suggest
  `yad repo refresh <repo>` (a human decision — flag and stop, never auto-refresh); stamp
  `code-context: stale` in the frontmatter.
- **Traceability:** record the loaded maps in the `test-cases.md` `code-context:` frontmatter field.

### Step 3 — Author the test cases (assist: test architect)
Adopt the **test architect** lens (`bmad-tea`, Murat), driving `bmad-testarch-test-design`. For each
story / user flow shape risk-based test cases:

- **Risk assessment** — categorize and score what can fail (probability × impact); depth scales with
  impact (Murat's "risk-based testing" principle).
- **Coverage plan** — assign each case a priority **P0 (critical) / P1 (high) / P2 (medium) / P3 (low)**
  and a level, preferring the lowest useful level (unit > integration > E2E).
- **Entry/exit criteria** and any **NFR** thresholds (security, performance, reliability) in scope.
- Each case: a stable label, the story it covers, preconditions, steps, and expected result.

### Step 3b — Materialize the automation in the connected tool (generate or link)
Read `{project-root}/.sdlc/testing.json` (`config.yaml` `testing.registry`). Decide the path:

- **No tool / `tool: "none"` / `source: "unavailable"`** (or the file is absent): **degrade** — author
  the Markdown artifact only and record `testing: none` in the frontmatter with a one-line note
  (mirrors the `design: none` degrade). Skip to Step 4.
- **A tool is connected and its MCP is available:** adopt the `test architect` lens and, using the
  provider recorded in `testing.json` (Playwright via a Playwright MCP, Cypress/pytest via theirs) drive
  `bmad-testarch-automate`:
  - **Generate** — when the provider is write-capable, author one automation test per high-priority
    (P0/P1) case into the connected code repo(s) for the repos in `epic.repos`, reusing the code-maps
    (Step 2b) and existing fixtures so tests target built endpoints/components, then run them via the MCP
    to confirm they execute.
  - **Link** — when the user points at an existing suite (or the provider is read-only), reference it and
    **read the tests back** so `test-cases.md` reflects the real suite.

  Capture each test's `name`, `repo`, `level`, `path`, and `url`. Record which direction was used
  (`generated | linked`). Honest-capability rule: a read-only MCP supports **link** only — never claim a
  test was generated that the provider cannot produce. See
  `../yad-connect-testing/references/testing-context.md`.

### Step 4 — Write the test-cases artifact
Write `{project-root}/epics/EP-<slug>/test-cases.md` using EXACTLY this template:

```markdown
---
id: EP-<slug>
epic: EP-<slug>
artifact: test-cases
status: draft
owner: <inherit from epic.md owner>   # the epic owner carries through; not retyped
repos: [<inherit from epic>]
code-context: { repos: [], loaded: <YYYY-MM-DD or none> }   # code-maps that informed the tests (Step 2b)
testing: <none | { tool: <playwright|cypress|pytest|…>, direction: <generated|linked>, suite: <url/path>, tests: <N> }>   # the connected testing tool (Step 3b)
---

## Test strategy & risk
<!-- risk assessment (category, probability, impact, score), entry/exit criteria, NFR thresholds in scope -->

## Test cases
<!-- one row/subsection per case: id, story covered, priority (P0–P3), level, preconditions, steps, expected -->

## Coverage & traceability
<!-- story -> case map; confirm every story's acceptance criteria are covered -->

## Automation (<tool>)
<!-- omit this section when testing: none. one row per automation test, linking to it in the repo.
     mirrors test-links.json (Step 4b). -->
<!-- - <Case id> -> <repo>:<test path> (<level>) — <url> -->
```

### Step 4b — Write the test-links map (when a tool was used)
When Step 3b generated or linked automation, write the machine-readable case→test map to
`{project-root}/epics/EP-<slug>/.sdlc/test-links.json` (sibling of `contract-lock.json` /
`design-links.json`):

```json
{
  "tool": "playwright",
  "suite": "tests/playwright.config.ts",
  "generatedAt": "<YYYY-MM-DD>",
  "direction": "generated | linked",
  "tests": [
    { "case": "TC-01", "story": "EP-<slug>-S01", "repo": "backend", "level": "e2e",
      "path": "tests/inquiry.spec.ts", "url": "<repo url to the test>" }
  ],
  "source": "playwright-mcp"
}
```

Keep the `## Automation (<tool>)` section of `test-cases.md` in step with this file. When Step 3b
degraded (`testing: none`), do **not** write `test-links.json`.

### Step 5 — Advance the authoring step (NOT the gate)
In `state.json`: set `test-cases.status: "done"` and set `test-cases-review.status: "in_review"`. **Leave
`currentStep` at `ready-for-build`** — this is the parallel track; moving `currentStep` would pull it
back from the build half. Write `state.json`. Do **not** touch `approvals.json`.

### Step 6 — Stop at the gate (do NOT advance)
Report: the path to `test-cases.md`, the connected testing tool and what it produced (e.g. "Playwright —
6 tests generated", the suite path + `test-links.json` path, or "no testing tool — artifacts-only"), that
the build half may already be underway in parallel, and that the next action is **review** via
`yad-review-gate` (base rule: owner + 1 reviewer). **Never record approval here.** Front states do not
auto-advance. When the hub has a platform, the gate opens a review
PR on the hub (via `yad-hub-bridge`) and `yad-review-gate action: sync` pulls platform approvals/comments
into the ledger; otherwise the review is recorded file-only.

## Reference
- Test-cases frontmatter, body template, and the `test-links.json` schema: `references/test-cases-schema.md`.
- State schema and field meanings: `../yad-epic/references/state-schema.md`.
- Connecting a testing tool (Playwright, pluggable) + generate-vs-link recipes and the degrade path:
  `../yad-connect-testing/SKILL.md` (+ `references/testing-context.md`).
- Connecting code repos + the code-context the brain reads: `../yad-connect-repos/SKILL.md`.
