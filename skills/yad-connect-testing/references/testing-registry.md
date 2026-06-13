# Testing registry — schema + freshness rule

The registry is the product hub's record of which testing tool is connected and how to reach it. It is
**project-wide** (one testing tool per project, shared across every epic), so it lives at the product
root, not under any `epics/EP-<slug>/.sdlc/`.

## Location

`{project-root}/.sdlc/testing.json`

(`config.yaml` `testing.registry`.) Create the file and its parent `.sdlc/` on the first `connect`.

## Schema

```json
{
  "tool": "playwright",                              // playwright | cypress | pytest | <adapter id> | none (artifacts-only)
  "provider": "playwright-mcp",                      // the concrete MCP: playwright-mcp | cypress-mcp | pytest-mcp | null
  "project_url": "tests/playwright.config.ts",       // project/config reference; null if none yet
  "auth": "user",                                    // ALWAYS the user's own MCP session — never a token
  "suites": { "backend": null, "mobile": null },     // optional default suite refs per repo
  "connectedAt": "2026-06-13",                       // first connect (YYYY-MM-DD)
  "lastSyncedAt": "2026-06-13",                       // last connect/refresh
  "source": "playwright-mcp"                          // the MCP detected at connect | unavailable (degraded)
}
```

## Rules

- **`tool`** selects the adapter; it MUST be one of `config.yaml` `testing.tools` (or `none`). At
  **connect** time an unknown tool is normalized to `testing.primary` with a warning (so the registry
  never persists an unknown value); a registry hand-edited to an unknown or missing tool **fails
  `doctor`** with `YAD-CFG-003` and must be fixed.
- **Auth is never stored.** No token, API key, or any credential in the registry. `project_url` and
  `suites` are plain references; `connect` reaches the tool through the user's authenticated MCP session.
- **`connect` overwrites in place** — a project carries exactly one testing connection at a time;
  switching tools is just another `connect`. There is no array (unlike `repos.json`).
- **`source`** is the authority for availability: an MCP id (`playwright-mcp` / `cypress-mcp` / …) means
  `yad-test-cases` can generate/link; `unavailable` means `yad-test-cases` degrades to artifacts-only.
  `refresh` re-detects and may flip it.
- **`tool: "none"`** is a valid, deliberate state: a project that has chosen artifacts-only.
  `yad-test-cases` treats it exactly like an absent registry.
- **`disconnect`** removes the file (or sets `tool: "none"`). The testing tool's own project/suites are
  never touched.

## Git tracking

Commit the **registry** (`testing.json`) — it is small, reviewable, and holds no secrets (references
only). This mirrors how `repos.json`, `hub.json`, and `design.json` are committed.

## Greenfield

A brand-new product hub has no `testing.json`. That is valid — `yad-test-cases` treats "no testing tool
connected" the same as `tool: "none"` and produces the Markdown test-case artifact only. The registry
appears the first time `connect` runs.
