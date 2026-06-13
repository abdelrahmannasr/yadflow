# Learning registry — schema + freshness rule

The registry is the product hub's record of which learning tool is connected and how to reach it. It is
**project-wide** (one learning tool per project, shared across every epic), so it lives at the product
root, not under any `epics/EP-<slug>/.sdlc/`.

## Location

`{project-root}/.sdlc/learning.json`

(`config.yaml` `learning.registry`.) Create the file and its parent `.sdlc/` on the first `connect`.

## Schema

```json
{
  "tool": "deeptutor",                               // deeptutor | <adapter id> | none (harness-native)
  "provider": "deeptutor-cli",                       // the concrete CLI: deeptutor-cli | null
  "version": "1.4.5",                                // CLI version reported at detect time; null if absent
  "kb": "yadflow-istifta",                           // grounded knowledge-base name; null if not built
  "kb_sources": ["epic.md", "architecture.md", "contract.md", "ui-design.md", "stories/", "code-context/*/code-map.md"],
  "auth": "user",                                    // ALWAYS the user's own DeepTutor config / LLM keys — never a token
  "connectedAt": "2026-06-14",                       // first connect (YYYY-MM-DD)
  "lastSyncedAt": "2026-06-14",                       // last connect/refresh
  "source": "deeptutor-cli"                          // deeptutor-cli (CLI on PATH) | harness-native (degraded)
}
```

## Rules

- **`tool`** selects the adapter; it MUST be one of `config.yaml` `learning.tools` (or `none`). At
  **connect** time an unknown tool is normalized to `learning.primary` with a warning (so the registry
  never persists an unknown value); a registry hand-edited to an unknown or missing tool **fails
  `doctor`** with `YAD-CFG-004` and must be fixed.
- **Auth is never stored.** No LLM key, token, or any credential in the registry. `kb`/`kb_sources` are
  plain references; DeepTutor is reached through the user's own `deeptutor` config.
- **`connect` overwrites in place** — a project carries exactly one learning connection at a time;
  switching tools is just another `connect`. There is no array (unlike `repos.json`). The original
  `connectedAt` is preserved across re-connects; only `lastSyncedAt` moves.
- **`source`** is the authority for availability: `deeptutor-cli` means `yad-learn` can drive the CLI
  (grounded in `kb`); `harness-native` means `yad-learn` tutors via the harness model reading the
  artifacts directly. `refresh` re-detects and may flip it.
- **`ground` is not persisted.** The `ground: true|false` input only governs whether the AI connect
  step builds/refreshes the knowledge base at connect time; the registry records the *result* (`kb` +
  `kb_sources`), never the flag itself.
- **`tool: "none"`** is a valid, deliberate state: a project that has chosen harness-native tutoring.
  `yad-learn` treats it exactly like an absent registry — it still tutors, just without DeepTutor.
- **`disconnect`** removes the file (or sets `tool: "none"`). DeepTutor's own config and knowledge bases
  are never touched.

## Git tracking

Commit the **registry** (`learning.json`) — it is small, reviewable, and holds no secrets (references
only). This mirrors how `repos.json`, `hub.json`, `design.json`, and `testing.json` are committed.

## Greenfield

A brand-new product hub has no `learning.json`. That is valid — `yad-learn` treats "no learning tool
connected" the same as `tool: "none"` and tutors harness-native. The registry appears the first time
`connect` runs.
