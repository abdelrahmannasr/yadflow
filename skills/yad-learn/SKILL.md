---
name: yad-learn
description: 'The cross-cutting learning layer: at ANY SDLC stage, a team member can ask to learn a concept and be tutored in the context of what the team is building. Routes the request to the connected learning tool (.sdlc/learning.json, DeepTutor-first) grounded in the project knowledge base, or degrades to harness-native tutoring (the harness model reading the artifacts) when no tool is connected. Renders a tutorial artifact and appends to a per-member learning ledger that is kept LOCAL-ONLY — gitignored, never committed or pushed to the product hub or any code repo — so it stays a private, personal skills log (yad-status rolls up the local records). Purely opt-in — it NEVER blocks a gate and never touches epic state, approvals, or the contract lock. Use when the user says "teach me <concept>", "learn about <concept>", or "yad-learn".'
---

# SDLC — Learn (the cross-cutting tutor)

**Goal:** At any SDLC stage, a team member can pause and ask to learn a concept — e.g. *"teach me why the
architecture hash-locks the contract surface"* — and get tutored **in the context of this project**. The
tutorial is rendered as an artifact and the request is recorded in a **personal, local skills log**
(`yad-status` shows the roll-up of your local records). This makes a learner's own understanding — and
therefore their **control over what is being built** — explicit, without ever exposing who-learned-what
to the team.

**Learning output is LOCAL-ONLY.** The records ledger and the rendered tutorials are personal artifacts:
they are **gitignored and must never be committed or pushed** — not to the product hub and not to any
code repo. The skill ensures the product hub's `.gitignore` lists these paths before it writes them. The
only committed, shared learning file is the connection registry `.sdlc/learning.json` (no secrets, no
personal data) — written by `yad-connect-learning`, not here.

This is a **cross-cutting, opt-in** skill (like `yad-status`, it runs any time). It is **never a gate**:
it does not move `currentStep`, never records an approval, and never touches `.sdlc/state.json`, the
approvals ledger, or the contract lock. It writes only the local learning ledger + tutorial artifacts.

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- The tutor is reached via the project's learning connection (`.sdlc/learning.json`, written by
  `yad-connect-learning`). **DeepTutor-first** (a CLI subprocess); when no tool is connected (or the
  `deeptutor` binary is absent) it degrades to **harness-native** tutoring — the harness model reads the
  scoped artifacts and explains the concept itself. Either way `yad-learn` always works and always
  records.
- Per-epic learning records: `epics/EP-<slug>/.sdlc/learning-records.json` (append-only personal log).
  Rendered tutorials: `epics/EP-<slug>/learning/`.
- When no epic is scoped, records go to `.sdlc/learning-records.json` and tutorials to `.sdlc/learning/`
  (cross-project learning).
- **Local-only, never committed.** All of the above paths are personal output. Before writing any of
  them, ensure the **product hub's** `.gitignore` ignores learning output (idempotent — append only if
  the lines are absent):
  ```
  # yadflow learning layer — personal, local-only (never commit or push)
  .sdlc/learning-records.json
  .sdlc/learning/
  epics/*/.sdlc/learning-records.json
  epics/*/learning/
  ```
  Never write learning output into a connected **code repo** — it lives only in the product hub, and only
  on the local machine. `.sdlc/learning.json` (the connection registry) is the sole committed learning
  file and is NOT ignored.
- Speak in the configured `communication_language`; write tutorials in `document_output_language`.

## Inputs

- `concept` — **required.** The idea to learn (e.g. "contract versioning", "async/await", "the per-repo
  stories gate").
- `context` — optional free text narrowing the focus (e.g. "why the surface is hash-locked", "in the
  backend event loop").
- `epic` — optional `EP-<slug>` to scope the tutorial + record to one epic (default: cross-project).
- `stage` — optional SDLC stage the learner is at (e.g. `architecture-review`, `implement`), recorded for
  the skills roll-up.
- `member` — the learner (default: the invoking user).
- `mode` — `explain` (default) | `deep` | `quiz` (`config.yaml` `learning.capabilities`).
- `action` — `learn` (default) | `list` | `complete`.

## On Activation (`action: learn`)

### Step 1 — Resolve the connection and route
Read `.sdlc/learning.json`:

- **DeepTutor available** (`source: "deeptutor-cli"`): run the CLI with the mapped capability
  (`explain→chat`, `deep→deep_research`, `quiz→deep_question`), grounded in the kb:
  ```
  deeptutor run <capability> "<concept> — in the context of <epic/stage + scoped artifact>" \
    --kb <kb> --format json
  ```
  Parse the NDJSON: concatenate `content` events into the tutorial body; capture `session_id` from the
  `done` event. `mode: quiz` issues a `deep_question` follow-up and records the comprehension signal.
- **Harness-native** (`tool: "none"`, absent registry, or `source: "harness-native"`): tutor with the
  harness model. Read the scoped epic's `epic.md` / `architecture.md` / `contract.md` and any connected
  `code-context/<repo>/code-map.md`, and write a focused explanation grounded in them. No error — this is
  the normal degraded path.

Keep the tutorial focused (usually < 600 words): explain the concept, then tie it to **one concrete
example from this project** (an artifact line, a contract field, a story).

### Step 2 — Render the tutorial artifact (local-only)
First ensure the product hub's `.gitignore` lists the learning-output paths (see Conventions — append the
block only if absent, so the artifacts can never be committed or pushed). Then write the tutorial to
`epics/EP-<slug>/learning/<member>--<concept-slug>.md` (or `.sdlc/learning/` when no epic is scoped).
Front-matter the file with `member`, `concept`, `stage`, `tool`, and `requestedAt`.

### Step 3 — Record in the learning ledger (append-only)
Append to `epics/EP-<slug>/.sdlc/learning-records.json` (create the array if absent):

```json
{
  "member": "alice",
  "concept": "contract versioning",
  "context": "why the architecture hash-locks the surface",
  "stage": "architecture-review",
  "mode": "explain",
  "tool": "deeptutor",
  "sessionId": "…",
  "tutorial": "learning/alice--contract-versioning.md",
  "comprehension": null,
  "status": "in-progress",
  "requestedAt": "<YYYY-MM-DD>",
  "completedAt": null
}
```

`tool` is `deeptutor` or `harness-native`. `comprehension` holds the quiz signal when `mode: quiz`,
else `null`.

### Step 4 — Present + confirm (record-only, NO gate)
Show the tutorial and ask the member to confirm they've reviewed it. This is **record-keeping only** —
there is no approval and no gate. The learner runs `action: complete` (below) when done.

## Other actions

- **`list`** — print the learning records for the scoped epic (or cross-project): who learned what, by
  stage, with status. Read-only.
- **`complete`** — mark a record `status: "learned"` and set `completedAt` (match on `member` + `concept`,
  newest in-progress record). Record-only; advances nothing.

## Hard rules

- **Opt-in, never a gate.** `yad-learn` never moves `currentStep`, never records an approval, and never
  blocks any step. Learning is additive.
- **Read-only except the learning ledger.** It writes only `learning-records.json` + tutorial artifacts;
  it never touches `state.json`, `approvals.json`, `comments.json`, or the contract lock.
- **Local-only output.** The records ledger and tutorials are gitignored personal artifacts — never
  commit or push them, and never write them into a code repo. Ensure the hub `.gitignore` covers them
  before writing (see Conventions).
- **Always works.** No DeepTutor / no connection → tutor harness-native. Never fail because a tool is
  absent.
- **Grounded.** Prefer the project's own artifacts/kb; a generic answer with no project tie-in is a last
  resort, and say so when that happens.
- **Attributable.** Every record names the `member` and `stage`, so the `yad-status` roll-up is a true
  picture of the local learner's own skills log.

## Reference
- Record schema, the mode→capability map, and the harness-native degrade path:
  `references/learning-state.md`.
- The connection this consumes: `../yad-connect-learning/SKILL.md`.
- The read-only roll-up: `../yad-status/SKILL.md` (the local skills-log section).
