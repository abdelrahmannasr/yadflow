---
name: yad-connect-learning
description: 'Connects a learning/tutoring tool (DeepTutor, or another tool — pluggable) to the product hub so the cross-cutting learning layer can tutor any team member, at any SDLC stage, in the context of what is being built. Registers the tool into the project-wide .sdlc/learning.json (local-user auth, no stored tokens), detecting whether the DeepTutor CLI is on PATH and degrading to harness-native tutoring (the harness model reading project artifacts) when it is not. Optionally builds a project knowledge base from the SDLC artifacts + secret-scanned code-maps so tutoring is grounded. Run at setup or any time the learning tool changes. Reusable, idempotent, refreshable. Use when the user says "connect DeepTutor", "connect a learning tool", "refresh the learning connection", or "list the learning connection".'
---

# SDLC — Connect a Learning Tool (the cross-cutting learning layer)

**Goal:** Let any team member pause at **any** SDLC stage and ask to learn a concept — and get tutored
*in the context of what the team is actually building*. This skill **connects** a learning tool such as
**DeepTutor** to the product hub and records *how* to reach it (the tool, the CLI, an optional grounded
knowledge base) — never a credential. The consumer skill **`yad-learn`** does the tutoring per request
and records the team's skills.

This is **setup/maintenance**, not a gated state — it never touches `.sdlc/state.json` or any epic's
approvals. It only writes the project-wide learning registry. `yad-learn` consumes it: when DeepTutor is
available it drives the CLI (grounded in the knowledge base); when nothing is connected, `yad-learn`
degrades to **harness-native** tutoring — the harness model reads the project artifacts directly and
explains the concept. The learning layer is **purely opt-in and never blocks a gate**.

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- The integration is **DeepTutor-first but pluggable** (`config.yaml` `learning.tools`): a learning-tool
  *adapter*, like the design/testing adapters. `none` → harness-native (yad-learn still tutors via the
  harness model).
- **DeepTutor is reached as a CLI SUBPROCESS** (`deeptutor …`), the same shape as Repomix's `npx` — NOT
  an MCP like the design/testing tools (DeepTutor ships no MCP server). The skill detects the **binary on
  PATH** and degrades when it is absent; it never installs DeepTutor.
- Registry: `{project-root}/.sdlc/learning.json` (project-wide, shared across all epics — NOT per-epic),
  the sibling of `.sdlc/repos.json`, `.sdlc/hub.json`, `.sdlc/design.json`, and `.sdlc/testing.json`.
- Per-epic, per-member learning records + rendered tutorials are written later by `yad-learn`
  (`epics/EP-<slug>/.sdlc/learning-records.json` and `epics/EP-<slug>/learning/`), not here.
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `action` — `connect` (default) | `refresh` | `list` | `disconnect`.
- `tool` — `deeptutor` | another adapter id (`config.yaml` `learning.tools`). `none` records a deliberate
  harness-native project.
- `kb` — optional knowledge-base name (default `yadflow-<project-slug>`). The DeepTutor kb that grounds
  tutoring in this project.
- `ground` — `true` (default) | `false`. When `true` and DeepTutor is available, build/refresh the
  knowledge base from the SDLC artifacts + code-maps (the "grounded in the project" piece).

## On Activation

### Step 1 — Resolve the tool and detect the CLI (the learning-tool adapter)
Determine which tool is being connected from `tool` (default `deeptutor`); reject a `tool` not in
`config.yaml` `learning.tools` (fall back to the configured `learning.primary` with a warning, the same
way `registerRepo`/`registerDesign` fall back). Then **detect the tool's CLI on PATH**:

- **deeptutor** → run a best-effort `deeptutor --version` (or `deeptutor config show`). If it succeeds,
  record `provider: "deeptutor-cli"` and the reported `version`.
- another adapter → its named CLI.

**Auth is the local user's own** — DeepTutor's own config (`deeptutor init`, `data/user/settings/`) and
the user's LLM provider keys. The skill **stores no tokens**; `kb`/`kb_sources` are plain references.

**Graceful degradation:** if the `deeptutor` binary is not on PATH, record `source: "harness-native"`
and report that `yad-learn` will still tutor **using the harness model reading the project artifacts**
(no error — the learning layer is additive and always works; DeepTutor only adds knowledge-base
grounding, quizzes, and deep research). Do **not** install DeepTutor as part of this step.

### Step 2 — Ground it in the project (optional, when DeepTutor is available)
When `ground: true` and DeepTutor is available, build or refresh a project **knowledge base** so tutoring
quotes what is actually being built:

```
deeptutor kb create <kb>            # idempotent: reuse if it exists
deeptutor kb add <kb> --doc <path>  # per source below
```

Add only **already-committed** artifacts + the **secret-scanned code-maps** (never raw repos): each
epic's `epic.md`, `architecture.md`, `contract.md`, `ui-design.md`, the `stories/` files, and every
`.sdlc/code-context/<repo>/code-map.md`. Record the kb name and the source globs in the registry. Skip
silently (record `kb: null`) when there are no artifacts yet (greenfield-safe).

### Step 3 — Record the connection in the registry
Upsert into `{project-root}/.sdlc/learning.json` (create the file + parent `.sdlc/` if absent):

```json
{
  "tool": "deeptutor",
  "provider": "deeptutor-cli",
  "version": "1.4.5",
  "kb": "yadflow-<project-slug>",
  "kb_sources": ["epic.md", "architecture.md", "contract.md", "ui-design.md", "stories/", "code-context/*/code-map.md"],
  "auth": "user",
  "connectedAt": "<YYYY-MM-DD>",
  "lastSyncedAt": "<YYYY-MM-DD>",
  "source": "deeptutor-cli"
}
```

- `tool: "none"` records a deliberate harness-native project: `{ "tool": "none", "provider": null,
  "kb": null, "source": "harness-native", ... }`.
- A DeepTutor connection whose CLI is absent records `{ "tool": "deeptutor", "provider": null,
  "kb": null, "source": "harness-native", ... }` until a `refresh` finds the binary.
- `connect` is **idempotent** — re-running it overwrites the single connection in place; the original
  `connectedAt` is preserved and only `lastSyncedAt` moves.

### Step 4 — Report (never auto-advance)
Report the connected `tool`, its `provider`, whether the CLI is available (or that `yad-learn` will run
harness-native), the `kb`, and that **`yad-learn` will now tutor team members on request**. Nothing
auto-advances; this is setup.

## Other actions

- **`refresh`** — re-detect the CLI, rebuild the knowledge base from the latest artifacts, and update
  `lastSyncedAt`. Same machinery as `connect`. Re-detection may flip `source` between `deeptutor-cli` and
  `harness-native` — report the change.
- **`list`** — print the current connection: `tool`, `provider`, `version`, the `kb`, and an
  **available/harness-native** flag for the CLI (best-effort). No learning tool connected ⇒
  "harness-native".
- **`disconnect`** — remove the registry file (or set `tool: "none"`). DeepTutor's own config and
  knowledge bases are **never touched** — only the hub's record of them.

## Hard rules

- **Local-user auth only; store no tokens.** Connect through the user's own DeepTutor config / LLM keys;
  never embed a key or any credential in the registry. `kb`/`kb_sources` are plain references.
- **Degrade gracefully.** No DeepTutor CLI → `yad-learn` tutors harness-native with no error. The
  learning layer is additive and always works — never a blocker.
- **Setup, not a gate.** Never touch `.sdlc/state.json`, approvals, or the contract lock from here.
- **Idempotent + refreshable.** `connect`/`refresh` are safe to re-run; a project carries one learning
  connection at a time.
- **Ground only committed, secret-scanned sources.** Feed the knowledge base from committed SDLC
  artifacts + the already-scanned code-maps — never raw repository contents.
- **Describe the connection; do not tutor here.** This skill records *how to reach* the tool. The actual
  tutoring + the personal, local-only learning records are produced by `yad-learn`, per request.
- **The registry is the only committed learning file.** `.sdlc/learning.json` is shared, reviewable
  config (no secrets, no personal data). The records ledger and tutorials `yad-learn` writes are
  local-only — gitignored, never committed or pushed.

## Reference
- Registry schema + freshness rule: `references/learning-registry.md`.
- CLI detection, the knowledge-base build recipe, the mode→capability map, and the harness-native degrade
  path: `references/learning-context.md`.
- The connect pattern this mirrors (testing tool): `../yad-connect-testing/SKILL.md`.
- The consumer — how `yad-learn` tutors and writes `learning-records.json`: `../yad-learn/SKILL.md`.
