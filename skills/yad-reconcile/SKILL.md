---
name: yad-reconcile
description: 'Phase 6 maintenance/CI — the change reconciler (mirrors yad-docs-sync; NEVER a gate). Detects post-lock DRIFT and ORPHANS across feature threads: shipped code or a repo HEAD advance (the repos.json syncedHead-vs-current-HEAD rule) with NO owning change-epic in any thread, a broken lineage (cycle, missing parent, or a thread cache that disagrees with the computed root), and open hotfix reconcile debt — reporting which thread drifted and WHY. `check` (default, read-only) reports; `refresh` points the human at opening a reconcile change-epic with yad-change (never silent); `wire` commits an advisory CI job ([skip ci] + concurrency, like yad-docs-sync) that runs the check on push. The hard merge BLOCK is the lineage-check / epic-open / reconcile-debt CI gates — this only DISCOVERS. Use when the user says "reconcile the changes", "check for thread drift", "is anything shipped without an epic", or "find open hotfix debt".'
---

# SDLC — Change Reconciler (Phase 6, the drift/orphan sweep)

**Goal:** Keep the feature threads honest the way `yad-docs-sync` keeps the doc sites honest — by
**detecting drift, not authoring**. It answers: is any shipped code missing an owning change-epic in a
thread? Is any lineage broken? Is any hotfix debt still open (freezing the next change)? It **reports**;
the human decides. It is **never a gate** — it never touches `state.json`, approvals, or the contract
lock. The hard enforcement is the CI gates (`lineage-check`, `epic-open`, `reconcile-debt`); this skill
is the read-only counterpart that surfaces problems *before* a PR hits those gates.

## Conventions

- `{project-root}` resolves from the product hub.
- It drives the **`yad reconcile` CLI** (`cli/thread.mjs`): `yad reconcile [check|refresh|wire]
  [--thread EP-<genesis>]`. The CLI is the engine; this skill orchestrates + explains.
- The thread is **derived** from `parent:` frontmatter (no registry). Repo drift uses the exact
  `repos.json` `syncedHead`-vs-current-HEAD rule (`config.yaml` `code_context.staleness: head-sha`),
  reused from `yad-docs-sync` / `yad repo`.
- Refresh is **never silent** — it points at `yad-change`, the same discipline as `yad repo refresh`.

## Inputs

- `action` — `check` (default, read-only) | `refresh` | `wire`.
- `thread` — optional `EP-<genesis>` to scope to one feature thread; default sweeps every thread.

## On Activation

### Step 1 — `check` (default, read-only) — detect drift + orphans + debt
Run `yad reconcile check` (optionally `--thread EP-<genesis>`). For each thread it reports, in
`yad check` drift style, any of:
- **Broken lineage** — a change-epic whose `parent` is missing, a cycle, or a `thread` cache that
  disagrees with the computed root (the same signal `yad doctor` reports).
- **Orphan / drift** — code shipped (`build-log.json`) or a touched repo's HEAD advanced past its
  `repos.json` `syncedHead` with **no owning change-epic** in any thread — i.e. behaviour reached
  production that no epic in the thread describes. Name the repo (`<repo>: <old>→<new>`).
- **Open hotfix debt** — a `reconcile-debt.json` entry still `open`; the next normal change on that
  thread is blocked until it is paid.

Writes nothing. This is the read-only sweep a human (or CI) runs to see the picture.

### Step 2 — `refresh` (advisory, never silent)
For each flagged thread, **point the human at the fix** — open a reconcile change-epic with `yad-change`
(`kind: change`, threaded to the affected feature) to bring the front artifacts back in step with what
shipped, and pay any open debt (update the artifacts + add a regression test, then set the
`reconcile-debt.json` entry `status: paid`). It never seeds the epic itself — opening a change-epic is a
human, triaged act (`yad-change` Step 2).

### Step 3 — `wire` (advisory CI, no block)
Commit an advisory CI job that runs `yad reconcile --check` on push, carrying `[skip ci]` on any commit
it makes and a concurrency group — the same loop-prevention `yad-docs-sync` uses. The job **reports**;
it never blocks. The blocking enforcement is the `yad-checks` gates, not this.

### Step 4 — Report
Summarise per thread: clean, or the concrete drift/debt found and what to do. Never advance any epic;
the reconciler is advisory.

## Hard rules

- **Never a gate.** It never touches `state.json`, `approvals.json`, or any `contract-lock.json`. Drift
  blocks nothing here — it only flags. The CI gates do the blocking.
- **Reconcile, don't author.** It detects; opening a change-epic is delegated to `yad-change` (a human,
  triaged act). `refresh` is never silent.
- **HEAD-sha drift, reused.** Repo drift uses the exact `repos.json` `syncedHead` rule, like
  `yad-docs-sync` and `yad repo`.
- **Loop-prevention in CI.** The wired job carries `[skip ci]` + a concurrency group.

## Reference
- The drift/refresh/wire discipline this mirrors: `../yad-docs-sync/SKILL.md`.
- The thread model + ledgers: `../yad-epic/references/state-schema.md` (Phase 6).
- The change-epic this hands off to: `../yad-change/SKILL.md`.
- The gates that block at merge: `../yad-checks/` (lineage-check, epic-open, reconcile-debt).
