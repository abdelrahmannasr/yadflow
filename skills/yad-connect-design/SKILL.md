---
name: yad-connect-design
description: 'Connects a design tool (Figma, or another tool — pluggable) to the Product so the UI design step can materialize the full feature design (mobile screens / web pages) inside it, not just Markdown. Registers the tool into the project-wide .sdlc/design.json (local-user / MCP-session auth, no stored tokens), detecting whether a design-tool MCP is available and degrading to markdown-only when it is not. Run at setup or any time the design tool changes. Reusable, idempotent, refreshable. Use when the user says "connect Figma", "connect a design tool", "refresh the design connection", or "list the design connection".'
---

# SDLC — Connect a Design Tool (make the UI step design-tool aware)

**Goal:** Let the UI design step (`yad-ui`) produce the **actual feature design** — the mobile screens
and/or web pages — inside a design tool such as **Figma**, alongside the Markdown artifacts
(`ui-design.md` / `DESIGN.md`). This skill **connects** a design tool to the Product and records
*how* to reach it (the tool, the project/file references, which MCP renders it) — never a credential.

This is **setup/maintenance**, not a gated Shape step — it never touches `.sdlc/state.json` or any
epic's approvals. It only writes the project-wide design registry. `yad-ui` consumes it: when a tool is
connected and its MCP is available, the `ux-designer` lens **generates** screens into the tool (or
**links** an existing human-made design and reads it back); when nothing is connected, `yad-ui` runs
markdown-only exactly as before.

## When a tool is missing

<!-- Written from yadflow's cli/toolbox.mjs (E87). Change the words there: a test holds this section to it. -->

No tool below is required. When one is missing, this skill still finishes, using the fallback written
beside it.

Before you fall back because a tool the team uses is not on this machine (not turned off, not removed
by the team), offer to connect it, once: run `yad toolbox connect <id> --json` and follow the
connect-tool rule. On a no, or when a step fails, use the fallback.

Tell the person which tools you used and which fallbacks, and why.

- **Figma** (`figma`, a connector). This skill connects it, by writing `.sdlc/design.json` as the steps below say. The other skills follow that file, not yad's toolbox answer.
  - Fallback — markdown-only: yad-ui writes ui-design.md and DESIGN.md only.
- **Pencil (pen.dev)** (`pencil`, a connector). This skill connects it, by writing `.sdlc/design.json` as the steps below say. The other skills follow that file, not yad's toolbox answer.
  - Fallback — markdown-only: yad-ui writes ui-design.md and DESIGN.md only.
- **OpenPencil** (`openpencil`, a connector). This skill connects it, by writing `.sdlc/design.json` as the steps below say. The other skills follow that file, not yad's toolbox answer.
  - Fallback — markdown-only: yad-ui writes ui-design.md and DESIGN.md only.

<!-- end: When a tool is missing -->

## Conventions

- `{project-root}` resolves from the project working directory (the **Product**).
- The integration is **Figma-first but pluggable** (`config.yaml` `design.tools`): a design-tool
  *adapter*, like the GitHub/GitLab platform adapter. Figma is the primary provider; `pencil`
  (the `.pen` web/mobile editor) is a second, write-capable provider; `openpencil` (OpenPencil, an
  open-source editor whose CLI writes a design file in the repo with no account and no app open, E164)
  is a third; `none` → markdown-only.
- **The design tool is reached through its MCP** (a harness MCP server) — the same shape as Impeccable's
  slash-commands, not Repomix's `npx`. **One exception: OpenPencil** is reached through its CLI
  (`openpencil` on PATH) first, and its MCP only while its desktop app is open. The skill detects the MCP
  (or, for OpenPencil, the CLI) and, when it is absent, offers to connect it with `yad toolbox connect`
  (E165) before it degrades; it never installs anything another way.
- Registry: `{project-root}/.sdlc/design.json` (project-wide, shared across all epics — NOT per-epic),
  the sibling of `.sdlc/repos.json` and `.sdlc/product.json`.
- Per-epic screen→frame links are written later by `yad-ui` (`epics/EP-<slug>/.sdlc/design-links.json`),
  not here.
- Speak in the `communication_language` set in `{project-root}/.sdlc/config.yaml`; write documents in `document_output_language`.

## Inputs

- `action` — `connect` (default) | `refresh` | `list` | `disconnect`.
- `tool` — `figma` | `pencil` | `openpencil` | another adapter id (`config.yaml` `design.tools`). `none` records a
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
- **openpencil** → its **CLI** first (`openpencil`, found on PATH): `openpencil eval <file> --code … --write`
  runs Figma Plugin API code on the design file and saves it, with no app open — generate-capable. Its MCP
  server (`open-pencil`, `openpencil-mcp`) is only a bridge to the running desktop app, so it is used only
  when the app is open with the file; it reads only files inside `OPENPENCIL_MCP_ROOT` (the folder it
  starts in by default; the home folder on Windows). Each epic keeps its design file in its own folder,
  `epics/EP-<slug>/design/` (for example `epics/EP-<slug>/design/screens.fig`), so `project_url` may stay
  empty. No account: `auth` stays `"user"` and there is nothing to sign in to. Record `provider`
  `openpencil-cli` when the CLI is found, `openpencil-mcp` when only the MCP is.
- another adapter → its named MCP.

Record `provider` (the concrete MCP) and whether it is available. For Figma, say which server it is,
because a UI task checks it before it starts (#358): `figma-desktop` (the Dev Mode MCP server inside the
running desktop app — the app must be open), `figma` (Figma's hosted server — a sign-in, no app), or
`html-to-design` (writes screens only, cannot read a frame). For Pencil, `pencil-mcp`. For OpenPencil, `openpencil-cli` (or `openpencil-mcp`, above). The older value
`figma-mcp` does not say which Figma server it is: on a refresh, record the exact one. **Auth is the local user's own** — the user's authenticated MCP session. The skill
**stores no tokens**; `project_url`/`files` are plain references, never credentials.

**Offer to connect it first (E165):** when the tool is not found, run `yad toolbox connect <tool> --json`
and follow the connect-tool rule: show its `ask` word for word, ask once, and on a yes run only its `agent`
steps, hand over its `person` steps, then run the `verify` command it gives (`yad toolbox connect <tool> --verify --json`,
with `--replace` only when its question said which tool it replaces). Never install
it any other way. When `--verify` passes, detect again — you can reach the tool when you find
its MCP server in your session (in Claude Code, `/mcp`), or for OpenPencil its CLI on PATH. **If you can**, go on to Step 2 and record what you found. **If you cannot**, the server is
most likely just added: a new MCP server is loaded when the agent starts. Then do **not** write the file:
skip the degrade below and Step 2, and in Step 3 tell the person to restart the agent and run this skill
again with `action: refresh`. On a no, or when a step fails, degrade:

**Graceful degradation** (never right after a `--verify` that passed — see above)**:** if no design-tool MCP is available (for OpenPencil: neither its CLI on PATH nor
its MCP), record `source: "unavailable"` and report
that `yad-ui` will run **markdown-only** until an MCP is connected (no error — the design tool is purely
additive, exactly like Impeccable being absent).

### Step 2 — Record the connection in the registry
Upsert into `{project-root}/.sdlc/design.json` (create the file + parent `.sdlc/` if absent):

```json
{
  "tool": "figma",
  "provider": "figma-desktop",
  "project_url": "https://www.figma.com/files/project/<id>/<name>",
  "auth": "user",
  "files": { "web": null, "mobile": null },
  "connectedAt": "<YYYY-MM-DD>",
  "lastSyncedAt": "<YYYY-MM-DD>",
  "source": "figma-desktop"
}
```

- `tool: "none"` records a deliberate markdown-only project: `{ "tool": "none", "provider": null,
  "source": "unavailable", ... }`.
- `connect` is **idempotent** — re-running it overwrites the single connection in place (a project has
  one design tool at a time; switching tools is just another `connect`).

### Step 3 — Report (never auto-advance)
Report the connected `tool`, its `provider`, whether the MCP is available (or that `yad-ui` will degrade
to markdown-only), the `project_url`, and that **`yad-ui` will now generate/link the design here**.
Nothing auto-advances; this is setup. **Right after a `--verify` that passed but could not reach the
tool yet:** report only that it is installed and recorded as the team's tool, that its server loads when the
agent starts, and that the person restarts the agent and runs this skill again with `action: refresh` —
not what `yad-ui` will do, which that refresh decides.

## Other actions

- **`refresh`** — re-detect the MCP (for OpenPencil, the CLI first) and update `lastSyncedAt` (after the user authenticates a session or
  changes tools). Same machinery as `connect`. Re-detection may flip `source` between an MCP id and
  `unavailable` — report the change.
- **`list`** — print the current connection: `tool`, `provider`, `project_url`, the file mapping, and a
  **available/unavailable** flag for the MCP (best-effort, the user's own session). No design tool
  connected ⇒ "markdown-only".
- **`disconnect`** — remove the registry file (or set `tool: "none"`). The design tool's own
  project/files are **never touched** — only the Product's record of them.

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
