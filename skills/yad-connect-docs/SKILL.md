---
name: yad-connect-docs
description: 'Connects a docs/Pages publishing target to the product hub so the interactive-docs steps can build and deploy the generated SPA — not just commit its source. Registers the target into the project-wide .sdlc/docs.json (GitHub Pages / GitLab Pages / build-only), auto-detecting the platform from .sdlc/hub.json and resolving the Vite base path, with local-user auth and no stored tokens. Detects whether gh/glab is present and degrades to build-only when absent. Run at setup or any time the publish target changes. Reusable, idempotent, refreshable. Use when the user says "connect docs", "connect Pages", "refresh the docs connection", or "list the docs connection".'
---

# SDLC — Connect a Docs/Pages Target (make the docs steps publishable)

**Goal:** Let the interactive-docs steps (`yad-docs` per epic, `yad-docs-overview` project-wide)
**build and deploy** the generated React/Vite SPA to a real URL — a GitHub Pages or GitLab Pages site —
instead of only committing its source. This skill **connects** a publishing target to the product hub
and records *how* to reach it (the platform, the publish scope, the base path) — never a credential.

This is **setup/maintenance**, not a gated front state — it never touches `.sdlc/state.json` or any
epic's approvals. It only writes the project-wide docs registry. `yad-docs` / `yad-docs-overview`
consume it: when a target is connected, they theme + generate the site and drive `yad docs deploy`;
when nothing is connected (`target: "none"`), they still generate and **npm-build** the site but stop
at a local `dist/` — build-only, no publish, exactly as before.

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- The target is **GitHub-Pages-first but pluggable** — a *publish adapter*, mirroring the GitHub/GitLab
  platform adapter the hub already uses. `github-pages` and `gitlab-pages` are the providers; `none` →
  build-only (deliberate, no error).
- The platform CLI (`gh` / `glab`) is a **subprocess**, used read/deploy-only via the user's own auth —
  never installed by this skill, never given a token. Absent ⇒ degrade to build-only (`source:
  "unavailable"`).
- Registry: `{project-root}/.sdlc/docs.json` (project-wide, shared across all epics + the overview —
  NOT per-epic), the sibling of `.sdlc/hub.json`, `.sdlc/repos.json`, and `.sdlc/design.json`.
- Per-epic / overview build manifests (`docs-build.json`) are written later by `yad-docs` /
  `yad-docs-overview`, not here. This skill describes the *connection*; it does not build.
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `action` — `connect` (default) | `refresh` | `list` | `disconnect`.
- `target` — `github-pages` | `gitlab-pages` | `none`. Default **auto-detected** from `.sdlc/hub.json`
  `platform` (github → `github-pages`, gitlab → `gitlab-pages`, null/no hub → `none`).
- `scope` — `hub` (default) | `<repo-name>` | `dedicated`. Where the Pages site is published from (the
  hub repo, one connected code repo, or a dedicated docs repo).
- `public` — `true` (default) | `false`. Whether the published site is public.
- `base_path` — optional explicit override of the Vite `base` (otherwise resolved, Step 2).

## On Activation

### Step 1 — Resolve the target + detect the platform (the publish adapter)
Determine the `target`. If not given, read `{project-root}/.sdlc/hub.json` `platform` and map it the same
way the hub bridge maps repos: `github` → `github-pages`, `gitlab` → `gitlab-pages`, `null`/no hub →
`none` (deliberate build-only). Reject a `target` value outside the three providers (fall back to the
detected default with a warning, the way `registerRepo` falls back on an unknown platform).

Then **probe the platform CLI** in the user's own session — `gh --version` / `gh auth status` for
GitHub, `glab --version` / `glab auth status` for GitLab. Record `source`:
- CLI present + authenticated → `source: "gh"` | `"glab"` (deploy can publish via the platform).
- CLI absent or unauthenticated → `source: "unavailable"` — record it and report that `yad-docs` will
  **build-only** (npm build to a local `dist/`, no publish) until the CLI is available. No error — the
  publish is purely additive, exactly like the `gh`/`glab` review bridge degrading.

**Auth is the local user's own** (`gh`/`glab`/git already on this device). The skill **stores no
tokens**; everything in the registry is a plain reference. Do **not** install a CLI as part of this step.

### Step 2 — Decide the publish scope + resolve the base path
Resolve `scope` → `publishRepo`:
- `hub` (default) → publish from the hub repo (read its name from `hub.json` `git_url`).
- `<repo-name>` → publish from that connected code repo (must exist in `.sdlc/repos.json`).
- `dedicated` → a dedicated docs repo the user names (recorded as `publishRepo`).

Resolve `basePath` (the Vite `base`) per the table in `references/docs-registry.md`:
- **GitHub *project* Pages** (a repo that is not `<user>.github.io`) serve under `/<repo>/` → `basePath =
  "/<repo>/"`. Per-epic sites nest under `/<repo>/epics/EP-<slug>/`; the overview under `/<repo>/`.
- **GitHub user/org Pages** (`<user>.github.io`) and **GitLab Pages** serve at the domain root → `basePath
  = "/"`.
- An explicit `base_path` input always wins (recorded verbatim, normalized to a leading + trailing `/`).

### Step 3 — Record the connection in the registry (idempotent)
Upsert into `{project-root}/.sdlc/docs.json` (create the file + parent `.sdlc/` if absent):

```json
{
  "target": "github-pages",
  "scope": "hub",
  "publishRepo": "<repo or hub name>",
  "basePath": "/<repo>/",
  "public": true,
  "auth": "user",
  "connectedAt": "<YYYY-MM-DD>",
  "lastSyncedAt": "<YYYY-MM-DD>",
  "source": "gh"
}
```

- `target: "none"` records a deliberate build-only project: `{ "target": "none", "scope": "hub",
  "publishRepo": null, "basePath": "/", "source": "unavailable", ... }`.
- `connect` is **idempotent** — re-running it overwrites the single connection in place (a project has
  one docs target at a time; switching targets is just another `connect`).

### Step 4 — Report (never auto-advance)
Report the connected `target`, its `scope`/`publishRepo`, the resolved `basePath`, whether the platform
CLI is available (or that the docs steps will degrade to **build-only**), and that **`yad-docs` /
`yad-docs-overview` will now build + deploy here**. Nothing auto-advances; this is setup. **Do not build
the site here — `yad-docs` builds.**

## Other actions

- **`refresh`** — re-detect the platform CLI and re-resolve the base path (after the user authenticates a
  session, renames the publish repo, or switches `scope`), updating `lastSyncedAt`. Same machinery as
  `connect`. Re-detection may flip `source` between `gh`/`glab` and `unavailable` — report the change.
- **`list`** — print the current connection: `target`, `scope`/`publishRepo`, `basePath`, `public`, and a
  **available/unavailable** flag for the platform CLI (best-effort, the user's own session). No target
  connected ⇒ "build-only".
- **`disconnect`** — remove the registry file (or set `target: "none"`). The platform's own Pages site is
  **never touched** — only the hub's record of it.

## Hard rules

- **Local-user auth only; store no tokens.** Connect through the user's own `gh`/`glab`/git; never embed a
  PAT or any credential in the registry. Everything recorded is a plain reference.
- **Degrade gracefully.** No target / no platform CLI → the docs steps **build-only** (local `dist/`) with
  no error. Publishing is additive, never a blocker — the same discipline as the `gh`/`glab` review bridge.
- **Setup, not a gate.** Never touch `.sdlc/state.json`, approvals, or the contract lock from here.
- **Idempotent + refreshable.** `connect`/`refresh` are safe to re-run; a project carries one docs
  connection at a time.
- **Describe the connection; do not build here.** This skill records *how to reach* the target.
  `yad-docs` / `yad-docs-overview` generate, build, and deploy the site.

## Reference
- Registry schema, the base-path resolution table, and the freshness/degrade rules:
  `references/docs-registry.md`.
- The connect pattern this mirrors (design tool): `../yad-connect-design/SKILL.md`.
- The connect pattern this mirrors (code repos + hub detection): `../yad-connect-repos/SKILL.md`.
- The consumers — how `yad-docs` / `yad-docs-overview` build + deploy: `../yad-docs/SKILL.md`,
  `../yad-docs-overview/SKILL.md`.
