---
name: yad-connect-design
description: 'Connects a design tool (Figma, or another tool — pluggable) to the product hub so the UI design step can materialize the full feature design (mobile screens / web pages) inside it, not just Markdown. Registers the tool into the project-wide .sdlc/design.json (local-user / MCP-session auth, no stored tokens), detecting whether a design-tool MCP is available and degrading to markdown-only when it is not. Run at setup or any time the design tool changes. Reusable, idempotent, refreshable. Use when the user says "connect Figma", "connect a design tool", "refresh the design connection", or "list the design connection".'
---

# SDLC — Connect a Design Tool (make the UI step design-tool aware)

**Goal:** Let the UI design step (`yad-ui`) produce the **actual feature design** — the mobile screens
and/or web pages — inside a design tool such as **Figma**, alongside the Markdown artifacts
(`ui-design.md` / `DESIGN.md`). This skill **connects** a design tool to the product hub and records
*how* to reach it (the tool, the project/file references, which MCP renders it) — never a credential.

This is **setup/maintenance**, not a gated front state — it never touches `.sdlc/state.json` or any
epic's approvals. It only writes the project-wide design registry. `yad-ui` consumes it: when a tool is
connected and its MCP is available, the `ux-designer` lens **generates** screens into the tool (or
**links** an existing human-made design and reads it back); when nothing is connected, `yad-ui` runs
markdown-only exactly as before.

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- The integration is **Figma-first but pluggable** (`config.yaml` `design.tools`): a design-tool
  *adapter*, like the GitHub/GitLab platform adapter. Figma is the primary provider; `pencil`
  (the `.pen` web/mobile editor) is a second, write-capable provider; `none` → markdown-only.
- **The design tool is reached through its MCP** (a harness MCP server), NOT a subprocess CLI — the same
  shape as Impeccable's slash-commands, not Repomix's `npx`. The skill detects the MCP and degrades when
  it is absent; it never installs an MCP server.
- Registry: `{project-root}/.sdlc/design.json` (project-wide, shared across all epics — NOT per-epic),
  the sibling of `.sdlc/repos.json` and `.sdlc/hub.json`.
- Per-epic screen→frame links are written later by `yad-ui` (`epics/EP-<slug>/.sdlc/design-links.json`),
  not here.
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `action` — `connect` (default) | `refresh` | `list` | `disconnect`.
- `tool` — `figma` | `pencil` | another adapter id (`config.yaml` `design.tools`). `none` records a
  deliberate markdown-only project.
- `project_url` — the design tool's team/project/file reference (e.g. a Figma project or file URL).
  Optional — a connection with no file yet is valid; `yad-ui` can create one on first generate.
- `files` — optional default file mapping per platform (`{ web: <ref>, mobile: <ref> }`).

## On Activation

### Step 1 — Resolve the tool and its MCP (the design-tool adapter)
Determine which tool is being connected from `tool` (default `figma`); reject a `tool` not in
`config.yaml` `design.tools` (fall back to the configured `design.primary` with a warning, the same way
`registerRepo` falls back on an unknown platform). Then **detect the tool's MCP** in this harness:

- **figma** → a Figma MCP server (Dev Mode MCP for read/link; html.to.design for HTML→Figma *generate*).
- **pencil** → the `pencil` MCP (`batch_design` writes `.pen` web/mobile screens — generate-capable).
- another adapter → its named MCP.

Record `provider` (the concrete MCP, e.g. `figma-mcp` | `html-to-design` | `pencil-mcp`) and whether it
is available. **Auth is the local user's own** — the user's authenticated MCP session. The skill
**stores no tokens**; `project_url`/`files` are plain references, never credentials.

**Graceful degradation:** if no design-tool MCP is available, record `source: "unavailable"` and report
that `yad-ui` will run **markdown-only** until an MCP is connected (no error — the design tool is purely
additive, exactly like Impeccable being absent). Do **not** install an MCP server as part of this step.

### Step 2 — Record the connection in the registry
Upsert into `{project-root}/.sdlc/design.json` (create the file + parent `.sdlc/` if absent):

```json
{
  "tool": "figma",
  "provider": "figma-mcp",
  "project_url": "https://www.figma.com/files/project/<id>/<name>",
  "auth": "user",
  "files": { "web": null, "mobile": null },
  "connectedAt": "<YYYY-MM-DD>",
  "lastSyncedAt": "<YYYY-MM-DD>",
  "source": "figma-mcp"
}
```

- `tool: "none"` records a deliberate markdown-only project: `{ "tool": "none", "provider": null,
  "source": "unavailable", ... }`.
- `connect` is **idempotent** — re-running it overwrites the single connection in place (a project has
  one design tool at a time; switching tools is just another `connect`).

### Step 3 — Report (never auto-advance)
Report the connected `tool`, its `provider`, whether the MCP is available (or that `yad-ui` will degrade
to markdown-only), the `project_url`, and that **`yad-ui` will now generate/link the design here**.
Nothing auto-advances; this is setup.

## Other actions

- **`refresh`** — re-detect the MCP and update `lastSyncedAt` (after the user authenticates a session or
  changes tools). Same machinery as `connect`. Re-detection may flip `source` between an MCP id and
  `unavailable` — report the change.
- **`list`** — print the current connection: `tool`, `provider`, `project_url`, the file mapping, and a
  **available/unavailable** flag for the MCP (best-effort, the user's own session). No design tool
  connected ⇒ "markdown-only".
- **`disconnect`** — remove the registry file (or set `tool: "none"`). The design tool's own
  project/files are **never touched** — only the hub's record of them.

## Hard rules

- **Local-user / MCP-session auth only; store no tokens.** Connect through the user's authenticated MCP
  session; never embed a Figma PAT or any credential in the registry. `project_url`/`files` are plain
  references.
- **Degrade gracefully.** No design tool / no MCP → `yad-ui` runs markdown-only with no error. The design
  tool is additive, never a blocker — the same discipline as Impeccable and the `gh`/`glab` bridge.
- **Setup, not a gate.** Never touch `.sdlc/state.json`, approvals, or the contract lock from here.
- **Idempotent + refreshable.** `connect`/`refresh` are safe to re-run; a project carries one design
  connection at a time.
- **Describe the connection; do not design here.** This skill records *how to reach* the tool. The actual
  screens are generated/linked by `yad-ui`, per epic.

## Reference
- Registry schema + freshness rule: `references/design-registry.md`.
- MCP detection per provider, the generate-vs-link recipes, the degrade path, and the honest
  write-vs-read-only MCP capability note: `references/design-context.md`.
- The connect pattern this mirrors (code repos): `../yad-connect-repos/SKILL.md`.
- The consumer — how `yad-ui` generates/links and writes `design-links.json`: `../yad-ui/SKILL.md`.
