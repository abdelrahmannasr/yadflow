---
name: yad-docs-sync
description: 'The maintenance/CI reconciler for the generated docs sites — mirroring the `yad check` / `yad gate ci` drift pattern. Recomputes each site''s freshness hashes (per-epic: the artifact hash + repo HEADs; overview: config.yaml + module-help.csv + the overview diagram + skill count) and compares them to each docs-build.json baseline: a site is stale when any hash differs or its shell template is out of date. `--check` (default, read-only) reports which sites are stale and WHY; `--refresh` regenerates + redeploys each stale site; `--wire` commits the CI workflow that runs the check on push and rebuilds on staleness. Refresh is always a human/CI decision, never silent; docs are never a gate. Use when the user says "sync the docs", "check docs staleness", "refresh stale docs sites", or "wire the docs CI".'
---

# SDLC — Sync the Docs Sites (the staleness reconciler)

**Goal:** Keep the generated docs sites in step with the artifacts they render — the per-epic sites
(`epics/EP-<slug>/docs-site/`) and the project overview (`docs/sdlc-site/`). It mirrors the `yad check`
/ `yad gate ci` reconcile pattern: it does **not** re-author content; it **detects drift** between each
site's `docs-build.json` baseline and the current inputs, and reports / refreshes / wires CI accordingly.

Docs are an output enrichment, so this skill is **never a gate** — it never touches `state.json`,
approvals, or the contract lock. Refreshing a stale site is always a **human or CI decision**, never
silent (the same discipline as `yad repo refresh`).

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- Per-epic baseline: `epics/EP-<slug>/.sdlc/docs-build.json` (written by `yad-docs`). Overview baseline:
  `docs/sdlc-site/.docs-build.json` (written by `yad-docs-overview`).
- The hashing + build + deploy is the **`yad docs sync` CLI**'s job; the regeneration of a stale site is
  delegated back to `yad-docs` / `yad-docs-overview` (the AI generation step). This skill orchestrates
  the reconcile.
- The docs target is `.sdlc/docs.json` (`yad-connect-docs`).
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `action` — `check` (default, read-only) | `refresh` | `wire`.
- `epic` — optional. Default: **sweep all epics** under `epics/` **plus the overview**. Given an
  `EP-<slug>`, scope to that one site.

## On Activation

### Step 1 — Compute the current freshness hashes per target
For each target in scope, recompute its hash inputs (exact inputs in `references/staleness.md`):

- **Per-epic** (`epics/EP-<slug>/`): the `artifactHash` (sha256 of `epic.md` + `architecture.md` +
  `contract.md` CONTRACT-SURFACE + `ui-design.md` + each story) **and** `repoHeads` (current
  `git -C <path> rev-parse HEAD` for each repo in `epic.repos`).
- **Overview** (`docs/sdlc-site/`): sha256 of `skills/sdlc/config.yaml` + `skills/sdlc/module-help.csv`
  + `docs/diagrams/sdlc-overview.mmd` + the current `skillCount` (number of `yad-*` skills).

This is the same drift computation `yad check` runs for repos; reuse the repos.json HEAD-sha rule.

### Step 2 — Compare to each build manifest
Read each `docs-build.json` and compare. A site is **stale** when **any** of:
- its `artifactHash` differs (a rendered artifact moved), or
- any `repoHeads[<repo>]` differs from the repo's current HEAD (the code the components cite advanced —
  the same head-sha staleness as `repos.json`), or
- for the overview, `config.yaml` / `module-help.csv` / the `.mmd` / `skillCount` moved, or
- its `templateVersion` < the current shell template version (the shell was upgraded).

A missing `docs-build.json` (a site never generated) counts as **stale → needs generate**.

### Step 3 — Act on `action`
- **`check`** (default, **read-only**) — print which sites are stale and **WHY**, in `yad check` drift
  style: *which artifact moved* (name it), *which repo HEAD advanced* (`<repo>: <old>→<new>`), *config /
  manifest / diagram / skill-count changed*, or *shell upgraded* (`templateVersion`). Writes nothing.
- **`refresh`** — for each stale site, re-run the generator (`yad-docs` for an epic site, `yad-docs-overview`
  for the overview) to regenerate `src/data/*.ts` + theme + manifest, then redeploy via `yad docs deploy`
  (degrading to build-only when no platform CLI). Report every site refreshed. **Never silent** — refresh
  is a deliberate human/CI act, surfaced exactly like `yad repo refresh`.
- **`wire`** — commit the CI workflow (Step 4) that automates the check + rebuild.

### Step 4 — `wire`: the CI auto-rebuild workflow
Commit the platform-matched workflow (GitHub `.github/workflows/yad-docs.yml`, or a GitLab `pages` job at
`.gitlab/ci/yad-docs.yml` that must be `include:`d from the root `.gitlab-ci.yml` —
`include: { local: .gitlab/ci/yad-docs.yml }`, the same fragment+include shape as the `yad-checks` gates):
- on push, run **`yad docs sync --check`**; on detected staleness, **rebuild + deploy** the affected
  site(s);
- carry **`[skip ci]`** on any commit the workflow itself makes (the regenerated source / manifest) and
  a **concurrency group** (one docs deploy at a time) — both to **prevent deploy loops** (a rebuild must
  not retrigger the workflow). See `references/staleness.md`.

### Step 5 — Report
Report per target: **fresh** or **stale (why)**; for `refresh`, what was regenerated + the deploy URL or
"build-only"; for `wire`, the workflow path committed. Never advance any epic; docs are not a gate.

## Hard rules

- **Refresh is never silent.** A stale site is *reported*; regenerating + redeploying is a human or CI
  decision (the `yad repo refresh` discipline). `check` is strictly read-only.
- **Docs are never a gate.** This skill never touches `state.json`, `approvals.json`, or
  `contract-lock.json`. Staleness blocks nothing in the SDLC; it only flags out-of-date docs.
- **HEAD-sha staleness, reused.** Repo drift uses the exact `repos.json` `syncedHead`-vs-current-HEAD
  rule. The overview uses config + manifest + diagram + skill-count.
- **Loop-prevention is mandatory in CI.** The wired workflow must carry `[skip ci]` on its own commits
  and a concurrency group so a deploy never retriggers a deploy.
- **Reconcile, don't re-author.** This skill detects drift and delegates regeneration to `yad-docs` /
  `yad-docs-overview`; it does not generate `src/data/*.ts` itself.

## Reference
- The manifest schema (per-epic + overview), the exact hash inputs, the head-sha staleness rule, and the
  CI loop-prevention note: `references/staleness.md`.
- The generators this delegates to: `../yad-docs/SKILL.md`, `../yad-docs-overview/SKILL.md`.
- The docs target it deploys to: `../yad-connect-docs/SKILL.md`.
- The drift / refresh discipline this mirrors: `../yad-connect-repos/SKILL.md` (HEAD-sha staleness).
