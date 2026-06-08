# Repos registry — schema + freshness rule

The registry is the product hub's record of which code repos are connected and where their cached
code-context lives. It is **project-wide** (shared across every epic), so it lives at the product root,
not under any `epics/EP-<slug>/.sdlc/`.

## Location

`{project-root}/.sdlc/repos.json`

(`config.yaml` `code_context.registry`.) Create the file and its parent `.sdlc/` on the first
`connect`.

## Schema

```json
{
  "repos": [
    {
      "name": "backend",                         // short name = the key used in stories' `repos:` tag
      "path": "demo-repos/backend",              // path to the code repo, rel. to {project-root} (or absolute)
      "git_url": "git@github.com:org/backend.git", // optional remote; SSH or HTTPS; GitHub or GitLab; null if local-only
      "platform": "github",                       // github | gitlab (from the URL host); null when local-only
      "domain_owner": "carol",                    // engineer who owns this repo's domain (review routing)
      "default_branch": "main",
      "connectedAt": "2026-06-08",                // first connect (YYYY-MM-DD)
      "lastSyncedAt": "2026-06-08",               // last connect/refresh
      "syncedHead": "5bd7e8d…",                   // code repo HEAD sha at last pack — drives staleness
      "contextPack": ".sdlc/code-context/backend/pack.md",
      "codeMap": ".sdlc/code-context/backend/code-map.md",
      "source": "repomix"                         // repomix | repomix-unavailable (degraded pack)
    }
  ]
}
```

## Rules

- **`name`** is the join key. It MUST match the names used in epic/story `repos:` tags so the front
  phases can map `epic.repos` → registry entries → code-maps. Keep it stable.
- **Auth is never stored.** No tokens, passwords, or PATs in the registry. `git_url` is a plain remote;
  `connect` clones/fetches as the local user (SSH key or git credential helper).
- **`connect` upserts by `name`** — re-connecting an existing repo refreshes its entry in place; it
  never creates a duplicate.
- **`syncedHead`** is the authority for freshness. A repo is **stale** when
  `git -C <path> rev-parse HEAD` ≠ `syncedHead`. `list` flags it; `refresh` clears it.
- **`disconnect`** removes the entry and deletes `{project-root}/.sdlc/code-context/<name>/`. The code
  repo on disk is never touched.

## Git tracking

Commit the **registry** (`repos.json`) and each repo's **`code-map.md`** — they are small, reviewable,
and are what the front phases actually read (a diff on a code-map shows when a repo's surface moved).
**Ignore** the full Repomix `pack.md` — it is large and regenerable (`action: refresh`). The product
hub's `.gitignore` carries `.sdlc/code-context/*/pack.md` for this. This mirrors how the per-epic
`.sdlc/` state (state.json, approvals.json, build-log.json) is committed.

## Greenfield

A brand-new product hub has no `repos.json` (or an empty `{ "repos": [] }`). That is valid — the front
phases treat "no repos connected" as "nothing to consider yet" and proceed unchanged. The registry
appears the first time `connect` runs.
