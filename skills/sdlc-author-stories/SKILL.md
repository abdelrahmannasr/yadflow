---
name: sdlc-author-stories
description: 'Front state 7 of the gated SDLC. With the pm, break the approved epic into user stories, each tagged with the repos that must implement it. Assigns zero-padded EP-<slug>-S0N IDs and writes one file per story under stories/. Reads epic + architecture + contract + UI as input. Never auto-advances — hands off to the team review gate (per-repo reviewer routing). Use when the user says "author the stories" or after the UI gate passes.'
---

# SDLC — Author Stories (front state 7)

**Goal:** Break an approved epic into human-authored, AI-assisted user stories, each with a stable
`EP-<slug>-S0N` ID and a `repos` tag listing which repos must implement it. This is a **front state**:
human-authored with AI assist, **never auto-advances**. When the stories are drafted, control passes
to `sdlc-review-gate`, which routes **per-repo reviewers** (each repo's engineer reviews the stories
touching their repo).

There is **no `sm` agent** (Phase 0 Deviation 1): the `pm` lens breaks down the epic; the `pm` or
`architect` lens prepares each story's detail. IDs are engine-assigned and never renamed.

## Conventions

- `{project-root}` resolves from the project working directory.
- Stories live under `{project-root}/epics/EP-<slug>/stories/` (build plan §6).
- Story files are named `EP-<slug>-S0N.md` (zero-padded, e.g. `EP-istifta-inquiries-S01.md`).
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## On Activation

### Step 1 — Resolve the epic and check the gate
Resolve the `EP-<slug>` (ask if not provided). Read `.sdlc/state.json`. Only proceed when
`currentStep == "stories"` and that step's `status == "in_progress"` (the UI review must already have
passed). If not, stop and point the user at `sdlc-status` / the gate.

### Step 1b — Open the authoring branch
Open the stories authoring branch `stories/EP-<slug>` per the shared procedure
(`../sdlc-author-epic/references/state-schema.md` → "Authoring branches"): git-safe (skip with a note
if `{project-root}` is not a git work tree), check out the branch if it exists, else create it from the
hub's default branch. Author and commit the story files under `stories/` on it. This is **distinct**
from the bridge's `review/…` branch.

### Step 2 — Read inputs
Read `epic.md` (scope, acceptance signals, `repos`), `architecture.md` (components by repo, flows),
`contract.md` (the shared surface stories must honour), and `ui-design.md` (screens/flows). Stories
must collectively satisfy the epic's acceptance signals and stay within the contract surface.

### Step 2b — Load existing-code context (make the brain code-aware)
Read the registry `{project-root}/.sdlc/repos.json` (`config.yaml` `code_context`). For **each repo in
`epic.repos`**, load the code-map `{project-root}/.sdlc/code-context/<repo>/code-map.md` so each story's
**"Notes for build"** can point at the **real existing modules/files** a story extends — giving the
Phase 3 build (Spec Kit per repo) accurate anchors instead of invented ones.

- **Greenfield-safe:** if `repos.json` is absent/empty, note "no repos connected" and proceed.
- **Staleness:** if a repo's current HEAD ≠ its registry `syncedHead`, warn and suggest
  `sdlc-connect-repos action: refresh`; stamp `code-context: stale` in the story frontmatter.
- **Traceability:** record the loaded maps in each story's `code-context:` frontmatter field.

### Step 3 — Break down the epic (assist: pm)
Adopt the **pm** lens (`bmad-agent-pm`, John). Decompose the epic into the smallest set of
independently reviewable, independently buildable stories. For each story decide which repos it touches
(must be a subset of the epic's `repos`). Prefer stories scoped to a clear slice of user value.

### Step 4 — Assign IDs (engine-assigned, never by hand)
Scan `stories/` for existing `EP-<slug>-S0N.md`. Assign the next zero-padded numbers continuing from
the highest existing one (`S01`, `S02`, …). **Never renumber or rename** an existing story — IDs are
permanent downstream links (build plan §6b).

### Step 5 — Prepare each story (assist: pm / architect)
Write one file per story, `{project-root}/epics/EP-<slug>/stories/EP-<slug>-S0N.md`, using EXACTLY this
template (see `references/story-schema.md`):

```markdown
---
id: EP-<slug>-S0N
epic: EP-<slug>
status: draft
owner: <inherit from epic.md owner>   # the epic owner carries through; not retyped
repos: [<subset of epic.repos this story implements>]
code-context: { repos: [], loaded: <YYYY-MM-DD or none> }   # code-maps anchoring "Notes for build" (Step 2b)
---

## Story
As a <role>, I want <capability>, so that <outcome>.

## Acceptance criteria
- [ ] <testable criterion>
- [ ] <testable criterion>

## Notes for build
<!-- contract surface touched, architecture components involved, UI screens -->
<!-- this is the context the Phase 3 build (Spec Kit per repo) will read -->
```

`repos` is the field the later build phase reads to know where to scaffold specs — set it precisely.

### Step 6 — Advance the authoring step (NOT the gate)
In `state.json`: set `stories.status: "done"`, set `stories-review.status: "in_review"`, and set
`currentStep: "stories-review"`. Write `state.json`. Do **not** touch `approvals.json`.

### Step 7 — Stop at the gate (do NOT advance)
Report: the story IDs created, the repos each touches, and that the next action is **review** via
`sdlc-review-gate`. Note that this review routes **per-repo reviewers**: owner + 1 reviewer **plus**, for
each repo appearing in any story's `repos`, a `domain-owner` approval for that repo. **Never record
approval here.** Front states do not auto-advance. When the hub has a platform, the gate opens a review
PR on the hub (via `sdlc-hub-bridge`, with a `domain:<repo>` label per touched repo) and
`sdlc-review-gate action: sync` pulls platform approvals/comments into the ledger; otherwise the review
is recorded file-only.

## Reference
- Story frontmatter and body template: `references/story-schema.md`.
- State schema and field meanings: `../sdlc-author-epic/references/state-schema.md`.
- Connecting code repos + the code-context the brain reads: `../sdlc-connect-repos/SKILL.md`.
