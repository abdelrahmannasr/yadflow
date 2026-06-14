# `.sdlc/docs.json` — the docs/Pages registry

Project-wide, shared across every epic's docs site **and** the project overview site (NOT per-epic).
The sibling of `.sdlc/hub.json`, `.sdlc/repos.json`, and `.sdlc/design.json`. Written by
`yad-connect-docs`; read by `yad-docs`, `yad-docs-overview`, `yad-docs-sync`, and the `yad docs` CLI.
Holds **no credentials** — every field is a plain reference. Auth is always the local user's own
`gh`/`glab`/git session.

## Schema

```json
{
  "target": "github-pages | gitlab-pages | none",
  "scope": "hub | <repo-name> | dedicated",
  "publishRepo": "<repo or hub name>",
  "basePath": "/<repo>/",
  "public": true,
  "auth": "user",
  "connectedAt": "<YYYY-MM-DD>",
  "lastSyncedAt": "<YYYY-MM-DD>",
  "source": "gh | glab | unavailable"
}
```

| Field | Meaning |
|-------|---------|
| `target` | The publish adapter. `none` = deliberate build-only (no publish, no error). |
| `scope` | Where the Pages site publishes from: the `hub` repo, one connected `<repo-name>`, or a `dedicated` docs repo. |
| `publishRepo` | The concrete repo name resolved from `scope`. `null` when `target: "none"`. |
| `basePath` | The Vite `base` substituted into each generated site (resolution table below). Normalized to a leading + trailing `/`. |
| `public` | Whether the published site is public. |
| `auth` | Always `"user"` — local-user / platform-CLI session. No token is ever stored. |
| `connectedAt` / `lastSyncedAt` | ISO dates the connection was first written / last re-detected. |
| `source` | `gh`/`glab` when the platform CLI is present + authenticated (publish works); `unavailable` when absent (build-only). |

`target: "none"` records `{ "target": "none", "publishRepo": null, "basePath": "/", "source":
"unavailable", ... }`.

## Platform auto-detection (from `.sdlc/hub.json`)

When `target` is not given, map the hub's `platform` the same way `yad-connect-repos` maps a repo host:

| `hub.json` `platform` | default `target` |
|-----------------------|------------------|
| `github` | `github-pages` |
| `gitlab` | `gitlab-pages` |
| `null` / no hub.json | `none` (build-only) |

## Base-path resolution table

GitHub serves *project* Pages under a `/<repo>/` prefix, so Vite's `base` must match or every asset 404s.
User/org Pages and GitLab Pages serve at the domain root.

| Target + repo kind | `basePath` | Per-epic site URL | Overview site URL |
|--------------------|------------|-------------------|-------------------|
| GitHub **project** Pages (repo ≠ `<user>.github.io`) | `/<repo>/` | `/<repo>/epics/EP-<slug>/` | `/<repo>/` |
| GitHub **user/org** Pages (`<user>.github.io`) | `/` | `/epics/EP-<slug>/` | `/` |
| GitLab Pages | `/` | `/epics/EP-<slug>/` | `/` |
| explicit `base_path` input | as given (normalized) | nests `epics/EP-<slug>/` under it | the given base |

An explicit `base_path` input always wins. `yad-docs` substitutes `basePath` into the shell's Vite
config; per-epic sites append `epics/EP-<slug>/` so they nest under the overview without colliding.

## Freshness + degrade rules

- **Freshness** here is connection-level, not content-level: `lastSyncedAt` reflects the last `refresh`.
  *Site* staleness (artifacts/repos moved, shell upgraded) is tracked separately in each site's
  `docs-build.json` and reconciled by `yad-docs-sync` — not here.
- **`list`** flags the platform CLI **available/unavailable** by probing `gh auth status` / `glab auth
  status` in the user's own session (best-effort). A flip to `unavailable` means the docs steps
  degrade to build-only until the CLI is back.
- **Degrade is silent + non-blocking.** No target / no CLI ⇒ `yad-docs` still generates + npm-builds the
  site to a local `dist/`; only the publish step is skipped. The same discipline as the design-tool MCP
  and the `gh`/`glab` review bridge being absent.
