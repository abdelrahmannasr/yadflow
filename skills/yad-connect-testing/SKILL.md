---
name: yad-connect-testing
description: 'Connects a testing tool (Playwright, or another tool — pluggable) to the product hub so the test-cases step can implement the actual automation tests, not just Markdown test cases. Registers the tool into the project-wide .sdlc/testing.json (local-user / MCP-session auth, no stored tokens), detecting whether a testing-tool MCP is available and degrading to artifacts-only when it is not. Run at setup or any time the testing tool changes. Reusable, idempotent, refreshable. Use when the user says "connect Playwright", "connect a testing tool", "refresh the testing connection", or "list the testing connection".'
---

# SDLC — Connect a Testing Tool (make the test-cases step automation-aware)

**Goal:** Let the test-cases step (`yad-test-cases`) produce the **actual automation tests** — the
runnable specs in a connected code repo — alongside the Markdown artifact (`test-cases.md`). This skill
**connects** a testing tool such as **Playwright** to the product hub and records *how* to reach it (the
tool, the suite references, which MCP runs it) — never a credential.

This is **setup/maintenance**, not a gated front state — it never touches `.sdlc/state.json` or any
epic's approvals. It only writes the project-wide testing registry. `yad-test-cases` consumes it: when a
tool is connected and its MCP is available, the `test architect` lens **generates** automation tests
into the connected repo(s) (or **links** an existing suite and reads it back); when nothing is
connected, `yad-test-cases` runs artifacts-only exactly as before.

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- The integration is **Playwright-first but pluggable** (`config.yaml` `testing.tools`): a testing-tool
  *adapter*, like the GitHub/GitLab platform adapter or the design-tool adapter. Playwright is the
  primary provider; `cypress` and `pytest` are second providers; `none` → artifacts-only.
- **The testing tool is reached through its MCP** (a harness MCP server), NOT a subprocess CLI — the
  same shape as the design tool's MCP, not Repomix's `npx`. The skill detects the MCP and degrades when
  it is absent; it never installs an MCP server.
- Registry: `{project-root}/.sdlc/testing.json` (project-wide, shared across all epics — NOT per-epic),
  the sibling of `.sdlc/repos.json`, `.sdlc/hub.json`, and `.sdlc/design.json`.
- Per-epic test→suite links are written later by `yad-test-cases`
  (`epics/EP-<slug>/.sdlc/test-links.json`), not here.
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `action` — `connect` (default) | `refresh` | `list` | `disconnect`.
- `tool` — `playwright` | `cypress` | `pytest` | another adapter id (`config.yaml` `testing.tools`).
  `none` records a deliberate artifacts-only project.
- `project_url` — the testing tool's project/config reference (e.g. a `playwright.config.ts` path or a
  test-runner project URL). Optional — a connection with no suite yet is valid; `yad-test-cases` can
  create one on first generate.
- `suites` — optional default suite mapping per repo (`{ <repo>: <ref> }`).

## On Activation

### Step 1 — Resolve the tool and its MCP (the testing-tool adapter)
Determine which tool is being connected from `tool` (default `playwright`); reject a `tool` not in
`config.yaml` `testing.tools` (fall back to the configured `testing.primary` with a warning, the same
way `registerRepo` falls back on an unknown platform). Then **detect the tool's MCP** in this harness:

- **playwright** → a Playwright MCP server (drives a browser, generates/runs E2E + API specs).
- **cypress** → the Cypress MCP (generate/run Cypress specs).
- **pytest** → a pytest MCP (generate/run service-layer tests).
- another adapter → its named MCP.

Record `provider` (the concrete MCP, e.g. `playwright-mcp` | `cypress-mcp` | `pytest-mcp`) and whether
it is available. **Auth is the local user's own** — the user's authenticated MCP session. The skill
**stores no tokens**; `project_url`/`suites` are plain references, never credentials.

**Graceful degradation:** if no testing-tool MCP is available, record `source: "unavailable"` and report
that `yad-test-cases` will run **artifacts-only** until an MCP is connected (no error — the testing tool
is purely additive, exactly like the design tool being absent). Do **not** install an MCP server as part
of this step.

### Step 2 — Record the connection in the registry
Upsert into `{project-root}/.sdlc/testing.json` (create the file + parent `.sdlc/` if absent):

```json
{
  "tool": "playwright",
  "provider": "playwright-mcp",
  "project_url": "tests/playwright.config.ts",
  "auth": "user",
  "suites": { "backend": null, "mobile": null },
  "connectedAt": "<YYYY-MM-DD>",
  "lastSyncedAt": "<YYYY-MM-DD>",
  "source": "playwright-mcp"
}
```

- `tool: "none"` records a deliberate artifacts-only project: `{ "tool": "none", "provider": null,
  "source": "unavailable", ... }`.
- `connect` is **idempotent** — re-running it overwrites the single connection in place (a project has
  one testing tool at a time; switching tools is just another `connect`).

### Step 3 — Report (never auto-advance)
Report the connected `tool`, its `provider`, whether the MCP is available (or that `yad-test-cases` will
degrade to artifacts-only), the `project_url`, and that **`yad-test-cases` will now generate/link the
automation tests here**. Nothing auto-advances; this is setup.

## Other actions

- **`refresh`** — re-detect the MCP and update `lastSyncedAt` (after the user authenticates a session or
  changes tools). Same machinery as `connect`. Re-detection may flip `source` between an MCP id and
  `unavailable` — report the change.
- **`list`** — print the current connection: `tool`, `provider`, `project_url`, the suite mapping, and a
  **available/unavailable** flag for the MCP (best-effort, the user's own session). No testing tool
  connected ⇒ "artifacts-only".
- **`disconnect`** — remove the registry file (or set `tool: "none"`). The testing tool's own
  project/suites are **never touched** — only the hub's record of them.

## Hard rules

- **Local-user / MCP-session auth only; store no tokens.** Connect through the user's authenticated MCP
  session; never embed a token or any credential in the registry. `project_url`/`suites` are plain
  references.
- **Degrade gracefully.** No testing tool / no MCP → `yad-test-cases` runs artifacts-only with no error.
  The testing tool is additive, never a blocker — the same discipline as the design tool and Impeccable.
- **Setup, not a gate.** Never touch `.sdlc/state.json`, approvals, or the contract lock from here.
- **Idempotent + refreshable.** `connect`/`refresh` are safe to re-run; a project carries one testing
  connection at a time.
- **Describe the connection; do not author tests here.** This skill records *how to reach* the tool. The
  actual automation tests are generated/linked by `yad-test-cases`, per epic.

## Reference
- Registry schema + freshness rule: `references/testing-registry.md`.
- MCP detection per provider, the generate-vs-link recipes, the degrade path, and the honest
  write-vs-read-only MCP capability note: `references/testing-context.md`.
- The connect pattern this mirrors (design tool): `../yad-connect-design/SKILL.md`.
- The consumer — how `yad-test-cases` generates/links and writes `test-links.json`:
  `../yad-test-cases/SKILL.md`.
