---
name: sdlc-author-architecture
description: 'Front state 3 of the gated SDLC. With the architect, author architecture.md and the locked contract.md (the shared cross-repo surface), then hash-lock the contract surface into .sdlc/contract-lock.json. Reads epic.md as input. Never auto-advances — hands off to the team review gate (which escalates on the contract risk tag). Use when the user says "author the architecture" or after the epic gate passes.'
---

# SDLC — Author Architecture + Contract (front state 3)

**Goal:** Produce a human-authored, AI-assisted `architecture.md` and the **locked** `contract.md`
for an approved epic, then record a hash-lock of the contract surface so a later contract-check can
detect drift. This is a **front state**: human-authored with AI assist, **never auto-advances**.
When both artifacts are drafted, control passes to `sdlc-review-gate`, which **escalates** this review
by default (the architecture step carries `risk_tags: ["contract"]`).

This skill enforces the build plan's core rules: all state lives in files; the contract holds only the
shared cross-repo surface at charter altitude; front steps stay locked to `human_approve`.

## Conventions

- `{project-root}` resolves from the project working directory.
- Artifacts live under `{project-root}/epics/EP-<slug>/` (build plan §6).
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## On Activation

### Step 1 — Resolve the epic and check the gate
Resolve the `EP-<slug>` (ask if not provided). Read `{project-root}/epics/EP-<slug>/.sdlc/state.json`.
Only proceed when `currentStep == "architecture"` and that step's `status == "in_progress"` (the epic
review must already have passed). If not, stop and point the user at `sdlc-status` / the gate.

### Step 1b — Open the authoring branch
Open the architecture authoring branch `architecture/EP-<slug>` per the shared procedure
(`../sdlc-author-epic/references/state-schema.md` → "Authoring branches"): git-safe (skip with a note
if `{project-root}` is not a git work tree), check out the branch if it exists, else create it from the
hub's default branch. Author and commit `architecture.md` / `contract.md` / `contract-lock.json` on it.
This is **distinct** from the bridge's `review/…` branch.

### Step 2 — Read the epic as input context
Read `epic.md`. Note `repos` (the touched domains), the goal, scope, and acceptance signals. The
architecture must serve every repo listed in `repos`.

### Step 2b — Load existing-code context (make the brain code-aware)
Read the registry `{project-root}/.sdlc/repos.json` (`config.yaml` `code_context`). For **each repo in
`epic.repos`**, load the lightweight code-map `{project-root}/.sdlc/code-context/<repo>/code-map.md`
**and**, because this phase locks the contract, the full pack `.../pack.md` when you need depth on the
existing **endpoints, events, and data models**. This is the context that stops the architecture from
re-defining or contradicting what is already built. (`pack.md` is **not committed** — if it is absent
locally, regenerate it with `sdlc-connect-repos action: refresh repo:<repo>`; the committed `code-map.md`
is always present.)

- **Greenfield-safe:** if `repos.json` is absent/empty, note "no repos connected" and proceed — design
  from scratch as before.
- **Staleness:** if a repo's current HEAD ≠ its registry `syncedHead`, warn and suggest
  `sdlc-connect-repos action: refresh`; stamp `code-context: stale` in the frontmatter.
- **Traceability:** record the loaded maps in the `code-context:` frontmatter of both `architecture.md`
  and `contract.md`.
- For an area not in the code-map, do a live on-demand read (`sdlc-connect-repos`
  `references/code-context.md`).

### Step 3 — Author the architecture (assist: architect)
Adopt the **architect** lens (`bmad-agent-architect`, Winston) and write
`{project-root}/epics/EP-<slug>/architecture.md` using EXACTLY this template:

```markdown
---
id: EP-<slug>
artifact: architecture
status: draft
owner: <inherit from epic.md owner>   # the epic owner carries through; not retyped
repos: [<inherit from epic>]
code-context: { repos: [], loaded: <YYYY-MM-DD or none> }   # code-maps cross-checked (Step 2b/4b)
---

## Overview
<!-- the shape of the solution across repos, 2-4 sentences -->

## Components by repo
<!-- one subsection per repo in `repos`; responsibilities at charter altitude -->

## Cross-repo flows
<!-- the key request/event flows that span repos -->

## Data ownership
<!-- which repo owns which entity/store -->

## Risks & decisions
<!-- notable trade-offs; anything that drove the contract surface -->
```

Keep per-repo detail at responsibility altitude — implementation detail belongs in stories/specs, not
here.

### Step 4 — Author the locked contract (assist: architect)
Write `{project-root}/epics/EP-<slug>/contract.md`. The contract holds **only the shared cross-repo
surface**: API shape, events, and data model — at charter altitude, **no per-repo implementation
detail**. Wrap that surface in a single delimited block bounded by the exact markers
`<!-- CONTRACT-SURFACE:BEGIN -->` and `<!-- CONTRACT-SURFACE:END -->` so the hash-lock and the later
contract-check operate on a stable, unambiguous region. Use EXACTLY this template:

```markdown
---
id: EP-<slug>
artifact: contract
status: locked
repos: [<inherit from epic>]
code-context: { repos: [], loaded: <YYYY-MM-DD or none> }   # not hashed — frontmatter sits outside CONTRACT-SURFACE
---

# Contract — EP-<slug>

> Shared cross-repo surface only. Charter altitude. Changing anything inside the
> CONTRACT-SURFACE block re-locks the hash and invalidates prior approvals.

<!-- CONTRACT-SURFACE:BEGIN -->
## API
<!-- endpoints: method + path + purpose; request/response shape at field level, no impl -->

## Events
<!-- event name + payload shape + producer/consumer repos -->

## Data model
<!-- shared entities + fields that cross a repo boundary -->
<!-- CONTRACT-SURFACE:END -->

## Notes
<!-- anything outside the surface: rationale, open questions (not hashed) -->
```

### Step 4b — Cross-check the surface against existing code (BEFORE locking)
Using the code-context loaded in Step 2b, compare the proposed `CONTRACT-SURFACE` against what the
connected repos **already expose** (their code-maps' endpoints / events / data models):

- If a proposed endpoint, event, or entity **collides with or duplicates** an existing one, do not
  silently re-define it — either **reuse** the existing surface, or record the deliberate change in
  `architecture.md` "Risks & decisions" (it will likely need a `Contract-Change` later).
- If the new surface **depends on** existing behaviour, name that dependency in "Cross-repo flows" /
  "Risks & decisions" so stories build on it rather than rebuilding it.
- Reconcile every conflict **before** Step 5 — the hash locks whatever you settle on, so the surface
  must already be consistent with the code when it is locked.

If no repos are connected (greenfield), skip this step.

### Step 5 — Lock the contract surface (hash)
Compute the SHA-256 of the **exact bytes between** the `CONTRACT-SURFACE:BEGIN` and
`CONTRACT-SURFACE:END` markers (the content between the markers, excluding the marker lines
themselves) and write `{project-root}/epics/EP-<slug>/.sdlc/contract-lock.json`:

```json
{ "artifact": "contract.md", "hash": "sha256:<hex>", "lockedAt": "<YYYY-MM-DD>" }
```

Canonicalization (so the hash round-trips): hash the surface region as written between the markers,
LF line endings, no leading/trailing blank-line normalization beyond what is in the file. Recompute
the same way later; if it differs, the contract surface changed. The reference command:

```bash
awk '/CONTRACT-SURFACE:BEGIN/{f=1;next} /CONTRACT-SURFACE:END/{f=0} f' \
  epics/EP-<slug>/contract.md | shasum -a 256
```

(See `references/contract-format.md` for the altitude rule and the exact hashing recipe.)

### Step 6 — Advance the authoring step (NOT the gate)
In `state.json`: set `architecture.status: "done"`, set `architecture-review.status: "in_review"`, and
set `currentStep: "architecture-review"`. Write `state.json`. Do **not** touch `approvals.json` — only
real reviewers approve, through the gate.

### Step 7 — Stop at the gate (do NOT advance)
Report: the paths to `architecture.md`, `contract.md`, and `contract-lock.json`; the contract hash;
and that the next action is **review** via `sdlc-review-gate`. Note that this review **escalates**
(risk tag `contract`): it needs owner + 1 reviewer **plus a domain owner for each touched repo**.
**Never record approval here.** Front states do not auto-advance. When the hub has a platform, the gate
opens a review PR on the hub (via `sdlc-hub-bridge`, labelled per touched repo) and
`sdlc-review-gate action: sync` pulls platform approvals/comments into the ledger; a contract re-lock
invalidates prior platform approvals too. Otherwise the review is recorded file-only.

## Reference
- Contract surface, altitude rule, and hashing recipe: `references/contract-format.md`.
- State schema and field meanings: `../sdlc-author-epic/references/state-schema.md`.
- Connecting code repos + the code-context cross-checked here: `../sdlc-connect-repos/SKILL.md`.
