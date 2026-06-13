# Design registry — schema + freshness rule

The registry is the product hub's record of which design tool is connected and how to reach it. It is
**project-wide** (one design tool per project, shared across every epic), so it lives at the product
root, not under any `epics/EP-<slug>/.sdlc/`.

## Location

`{project-root}/.sdlc/design.json`

(`config.yaml` `design.registry`.) Create the file and its parent `.sdlc/` on the first `connect`.

## Schema

```json
{
  "tool": "figma",                                   // figma | pencil | <adapter id> | none (markdown-only)
  "provider": "figma-mcp",                           // the concrete MCP: figma-mcp | html-to-design | pencil-mcp | null
  "project_url": "https://www.figma.com/files/project/123/feature", // team/project/file reference; null if none yet
  "auth": "user",                                    // ALWAYS the user's own MCP session — never a token
  "files": { "web": null, "mobile": null },          // optional default file refs per platform
  "connectedAt": "2026-06-13",                       // first connect (YYYY-MM-DD)
  "lastSyncedAt": "2026-06-13",                      // last connect/refresh
  "source": "figma-mcp"                              // the MCP detected at connect | unavailable (degraded)
}
```

## Rules

- **`tool`** selects the adapter; it MUST be one of `config.yaml` `design.tools` (or `none`). At
  **connect** time an unknown tool is normalized to `design.primary` with a warning (so the registry
  never persists an unknown value); a registry hand-edited to an unknown or missing tool **fails
  `doctor`** with `YAD-CFG-002` and must be fixed.
- **Auth is never stored.** No Figma PAT, OAuth token, or any credential in the registry. `project_url`
  and `files` are plain references; `connect` reaches the tool through the user's authenticated MCP
  session.
- **`connect` overwrites in place** — a project carries exactly one design connection at a time;
  switching tools is just another `connect`. There is no array (unlike `repos.json`).
- **`source`** is the authority for availability: an MCP id (`figma-mcp` / `pencil-mcp` / …) means
  `yad-ui` can generate/link; `unavailable` means `yad-ui` degrades to markdown-only. `refresh`
  re-detects and may flip it.
- **`tool: "none"`** is a valid, deliberate state: a project that has chosen markdown-only. `yad-ui`
  treats it exactly like an absent registry.
- **`disconnect`** removes the file (or sets `tool: "none"`). The design tool's own project/files are
  never touched.

## Git tracking

Commit the **registry** (`design.json`) — it is small, reviewable, and holds no secrets (references
only). This mirrors how `repos.json` and `hub.json` are committed.

## Greenfield

A brand-new product hub has no `design.json`. That is valid — `yad-ui` treats "no design tool connected"
the same as `tool: "none"` and produces the Markdown artifacts only. The registry appears the first time
`connect` runs.
