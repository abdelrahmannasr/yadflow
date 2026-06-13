# Learning state — record schema, capability map, degrade path

How `yad-learn` records a learner's own learning, drives DeepTutor, and degrades. The records are the
evidence base for the **local skills-log roll-up** in `yad-status`.

## Location

- Per-epic ledger: `epics/EP-<slug>/.sdlc/learning-records.json` (append-only JSON array).
- Cross-project ledger (no epic scoped): `.sdlc/learning-records.json`.
- Rendered tutorials: `epics/EP-<slug>/learning/<member>--<concept-slug>.md` (or `.sdlc/learning/`).

(`config.yaml` `learning.records` and `learning.artifacts`.)

**Local-only.** Every path above is personal output and is **gitignored — never committed or pushed**, to
the product hub or any code repo. `yad-learn` ensures the hub `.gitignore` lists them before writing. The
only committed learning file is the connection registry `.sdlc/learning.json`.

## Record schema

```json
{
  "member": "alice",                                 // the learner (default: invoking user)
  "concept": "contract versioning",                  // what was learned
  "context": "why the surface is hash-locked",        // optional focus
  "stage": "architecture-review",                     // SDLC stage the learner was at; null if unscoped
  "mode": "explain",                                  // explain | deep | quiz
  "tool": "deeptutor",                                // deeptutor | harness-native
  "sessionId": "…",                                   // DeepTutor session id; null when harness-native
  "tutorial": "learning/alice--contract-versioning.md",
  "comprehension": null,                              // quiz signal (e.g. "4/5") when mode: quiz, else null
  "status": "in-progress",                            // in-progress | learned
  "requestedAt": "2026-06-14",
  "completedAt": null                                 // set by `action: complete`
}
```

## Rules

- **Append-only.** `learn` pushes a new record. `complete` mutates the newest in-progress record matching
  `member` + `concept` (status → `learned`, set `completedAt`). Never rewrite history.
- **Attributable.** `member` + `stage` are always set so the local roll-up is accurate.
- **No secrets.** Records hold concept text + references only — never keys or raw tool output beyond the
  rendered tutorial.
- **Never commit the ledger or tutorials.** They are personal, local-only artifacts: gitignored, never
  committed or pushed (to the hub or a code repo). Only `.sdlc/learning.json` is committed.

## Mode → DeepTutor capability

| mode | capability | invocation |
|------|------------|------------|
| `explain` | `chat` | `deeptutor run chat "<concept> — in context of <…>" --kb <kb> --format json` |
| `deep` | `deep_research` | `deeptutor run deep_research "<…>" --kb <kb> --format json` |
| `quiz` | `deep_question` | `deeptutor run deep_question "<…>" --kb <kb> --format json` → record `comprehension` |

`--format json` is **NDJSON**: one event per line, each with `type` (`content` | `tool_call` |
`tool_result` | `done`) and `session_id`. Concatenate `content` into the tutorial; read `session_id` from
`done`.

## Harness-native degrade

When `.sdlc/learning.json` is absent, `tool: "none"`, or `source: "harness-native"`:

1. Read the scoped epic's `epic.md` / `architecture.md` / `contract.md` and any
   `code-context/<repo>/code-map.md`.
2. Explain `concept` (+ `context`) grounded in what those say, with one concrete example from the project.
3. Write the tutorial + record exactly as the DeepTutor path does, with `"tool": "harness-native"` and
   `"sessionId": null`.

The learning layer therefore **always works and always records** — DeepTutor only adds kb grounding,
deep research, and quizzes.

## Greenfield / no epic

With no epic scoped, write to the cross-project ledger `.sdlc/learning-records.json` and tutorials to
`.sdlc/learning/`. `yad-status` reads both the per-epic and cross-project ledgers for the local roll-up.
