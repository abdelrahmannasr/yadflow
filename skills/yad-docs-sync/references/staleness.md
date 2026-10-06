# Docs staleness — manifests, hash inputs, and the CI loop note

`yad-docs-sync` reconciles each generated site against a **build manifest** (`docs-build.json`) written
when the site was last generated. A site is **stale** when the manifest's recorded hashes no longer match
the current inputs, or its shell template is out of date. This mirrors the `repos.json`
`syncedHead`-vs-current-HEAD drift rule used across the SDLC.

## Build manifest schema

### Per-epic — `epics/EP-<slug>/.sdlc/docs-build.json` (written by `yad-docs`)

```json
{
  "builtAt": "<YYYY-MM-DD>",
  "theme": "design.json | DESIGN.md | default",
  "artifactHash": "<sha256 of epic.md + architecture.md + contract.md CONTRACT-SURFACE + ui-design.md + each story>",
  "repoHeads": { "<repo>": "<HEAD sha>" },
  "deployUrl": "<url or null>",
  "shellVersion": "<the `version` in templates/app/package.json>"
}
```

### Overview — `docs/sdlc-site/.docs-build.json` (written by `yad-docs-overview`)

```json
{
  "builtAt": "<YYYY-MM-DD>",
  "theme": "yadflow-brand",
  "artifactHash": "<sha256 of config.yaml + module-help.csv + docs/diagrams/sdlc-overview.mmd>",
  "skillCount": <number of yad-* skills>,
  "deployUrl": "<url or null>"
}
```

## Exact hash inputs

| Target | `artifactHash` inputs | head inputs |
|--------|-----------------------|-------------|
| **per-epic** | `epic.md` + `architecture.md` + `contract.md` **CONTRACT-SURFACE only** + `ui-design.md` + **each** `stories/*.md` (concatenated in stable story-id order, hashed sha256) | `repoHeads`: `git -C <path> rev-parse HEAD` for each repo in `epic.repos` |
| **overview** | `skills/sdlc/config.yaml` + `skills/sdlc/module-help.csv` + `docs/diagrams/sdlc-overview.mmd`, concatenated in that order, hashed sha256 (`skillCount` is an informational manifest field, not a hash input — `module-help.csv` already moves when the skill set does) | — (no repos) |

Because `yad-docs` generates `src/data/*.ts` **deterministically** (stable-ID sort, fixed key order, no
embedded timestamps), an unchanged input set re-hashes identically — so a hash move means a *real*
content move, not a regeneration artifact. The contract uses the **CONTRACT-SURFACE block only** so
non-surface edits to `contract.md` don't churn the docs.

## Staleness rule

A site is **stale** when ANY holds:

1. recomputed `artifactHash` ≠ manifest `artifactHash` — a rendered artifact moved (name it in the report);
2. for any repo, current HEAD ≠ manifest `repoHeads[<repo>]` — the cited code advanced (`<repo>:
   <old>→<new>`). **Identical to the `repos.json` `syncedHead` staleness rule** — and, as there, a stale
   repo is *flagged*, never auto-refreshed: the `code-context` itself is refreshed by a human via
   `yad repo refresh`, and the docs are regenerated only on an explicit `refresh`/CI decision;
3. (overview) `config.yaml` / `module-help.csv` / the `.mmd` moved — the pipeline changed (this is what
   enforces "the overview regenerates whenever the workflow definition or skill set changes");
4. (per-epic) manifest `shellVersion` ≠ the `version` in `templates/app/package.json` — the shell was
   upgraded, so the site should re-copy it. The overview has no shell version (it is updated in place).
   A manifest's older `templateVersion` field held the yad CLI version, which moved on every release, so
   it is never compared: a manifest with only that field counts as built on shell `0.0.0`, the one version
   the shell had before `shellVersion` existed. It reads fresh today, and a real shell upgrade still shows;
5. the `docs-build.json` is **missing** — the site was never generated (treat as stale → generate).

`check` reports which of these tripped and why; `refresh` regenerates + redeploys; neither blocks any
SDLC step (docs are never a gate).

## CI note

The `wire` workflow (`.github/workflows/yad-docs.yml`, or the GitLab `pages` job at
`.gitlab/ci/yad-docs.yml` included from the root `.gitlab-ci.yml`) builds every committed site and
deploys them on each push to the default branch. It does not check staleness and commits nothing:
regenerating a site's `src/data/*.ts` stays a local `yad docs sync --refresh` that a person commits.
So it cannot start itself again; a **concurrency group** (`yad-docs-pages`, cancel-in-progress) keeps
it to one deploy at a time.

A site that fails to build fails the run, and the run names every site that failed. A red run uploads
nothing, so the last good deployment stays live. (Before this, a failed site was silently left out and
the run went green — that is how a site could lose a page.) `yad doctor` warns when the wired file is an
older version (`docs-workflow`); run `yad docs sync --wire` again and commit it.
