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
  "templateVersion": "<shell template version>"
}
```

### Overview — `docs/sdlc-site/.docs-build.json` (written by `yad-docs-overview`)

```json
{
  "builtAt": "<YYYY-MM-DD>",
  "theme": "yadflow-brand",
  "artifactHash": "<sha256 of config.yaml + module-help.csv + docs/diagrams/sdlc-overview.mmd + skill count>",
  "skillCount": <number of yad-* skills>,
  "deployUrl": "<url or null>",
  "templateVersion": "<shell template version>"
}
```

## Exact hash inputs

| Target | `artifactHash` inputs | head inputs |
|--------|-----------------------|-------------|
| **per-epic** | `epic.md` + `architecture.md` + `contract.md` **CONTRACT-SURFACE only** + `ui-design.md` + **each** `stories/*.md` (concatenated in stable story-id order, hashed sha256) | `repoHeads`: `git -C <path> rev-parse HEAD` for each repo in `epic.repos` |
| **overview** | `skills/sdlc/config.yaml` + `skills/sdlc/module-help.csv` + `docs/diagrams/sdlc-overview.mmd` + the `skillCount` (count of `yad-*` skills), concatenated in that order, hashed sha256 | — (no repos) |

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
3. (overview) `config.yaml` / `module-help.csv` / the `.mmd` / `skillCount` moved — the pipeline changed
   (this is what enforces "the overview regenerates whenever the workflow definition or skill count
   changes");
4. manifest `templateVersion` < the current shell template version — the `templates/app/` shell was
   upgraded, so every site should re-copy it;
5. the `docs-build.json` is **missing** — the site was never generated (treat as stale → generate).

`check` reports which of these tripped and why; `refresh` regenerates + redeploys; neither blocks any
SDLC step (docs are never a gate).

## CI loop-prevention note

The `wire` workflow (`.github/workflows/yad-docs.yml` or a `pages` job in `.gitlab-ci.yml`) runs
`yad docs sync --check` on push and rebuilds + deploys on staleness. Because the rebuild **commits** the
regenerated `src/data/*.ts` + refreshed `docs-build.json`, that commit would re-trigger the same workflow
— a deploy loop. Two guards, both mandatory:

- **`[skip ci]`** in the message of any commit the workflow itself makes (the regenerated source +
  manifest), so the workflow does not re-fire on its own output;
- a **concurrency group** (e.g. `concurrency: { group: yad-docs-deploy, cancel-in-progress: true }`) so
  at most one docs build/deploy runs at a time, and a queued one is superseded rather than stacking.

Together these make the CI rebuild idempotent: a push that moves an artifact deploys exactly one fresh
site, and the resulting bot commit does not start another round.
