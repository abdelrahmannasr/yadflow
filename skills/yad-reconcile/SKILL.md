---
name: yad-reconcile
description: 'Find drift across feature threads: shipped code with no epic, broken lineage, open hotfix debt. Never a gate. Use when the user says "reconcile the changes", "check for thread drift", "is anything shipped without an epic", or "find open hotfix debt".'
---

# SDLC — Change Reconciler (Phase 6, the drift/orphan sweep)

**Goal:** Keep the feature threads honest the way `yad-docs-sync` keeps the doc sites honest — by
**detecting drift, not authoring**. It answers: is any shipped code missing an owning change-epic in a
thread? Is any lineage broken? Is any hotfix debt still open (freezing the next change)? It **reports**;
the human decides. It is **never a gate** — it never touches `state.json`, approvals, or the contract
lock. The hard enforcement is the CI gates (`lineage-check`, `epic-open`, `reconcile-debt`); this skill
is the read-only counterpart that surfaces problems *before* a PR hits those gates.

## Conventions

- `{project-root}` resolves from the Product.
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
- **Orphan / drift** — code shipped (the build ledger) or a touched repo's HEAD advanced past its
  `repos.json` `syncedHead` with **no owning change-epic** in any thread — i.e. behaviour reached
  production that no epic in the thread describes. Name the repo (`<repo>: <old>→<new>`).
- **Open hotfix debt** — a `reconcile-debt.json` entry still `open`; the next normal change on that
  thread is blocked until it is paid.
- **Build records (issue #365, `check` only)** — merged work the build ledger does not record, read from
  each registered repo's clone (its default branch as the clone last saw it; nothing is fetched) and, when
  `gh` / `glab` answers, the source branch names of PRs/MRs merged into the default branch (a squash merge
  keeps only the title, so the branch is where a squashed task still shows). It lists:
  - a **merged task with no ship record** — a `Task:` trailer, a merge commit naming a task branch, a full
    task ID in a commit subject (not a revert), or a merged task branch. For a story that has no ship in
    that repo it offers `yad checkpoint --retro-ship …` once, for a story that predates ledger tracking
    (its status must be `in-build` or `shipped` first); otherwise record the ship with
    `yad build ship <story> --task <T> --repo <r> --pr <n>`. **`yad build sync [<epic>]` (#365) records them all
    at once**: each through `yad build ship` — from the PR/MR that merged it, or from its merge commit where the
    platform confirms no PR/MR did — then `yad build done` for each story now fully shipped; what it cannot
    record (no platform to read, a refusal, a story with no Build lane there — it may predate tracking) it lists
    with the command to run. `--dry-run` only says what it
    would run. A retroactive ship covers only the tasks merged up to it (by its merge commit or date);
  - a story whose every repo holds merged work or a ship, but whose `status:` is not `shipped` — a hint,
    not counted: if no task is left, run `yad build done <story>` — when it refuses (no lane yet, a repo
    not cloned), its message names what to run first;
  - a **possible match** to check by hand, for a story not yet shipped or recorded in that repo: a full
    story ID in a commit subject with no task, or a short scope tag such as `feat(s06):`. Never counted. A
    story ID only in a commit body is not evidence.
  git runs only in a repo `yad repo clone` would accept as present, or the Product itself for `path: "."`
  (a committed folder shaped like a bare repo would have git read its config), and never fetches; a
  shallow clone is not read. A folder inside a shared checkout reads only its own non-merge commits — never
  a merge title, and never the platform, since neither can be told to belong to one folder (the output
  says so). A repo,
  ledger or `repos.json` that cannot be read in full — including a repo a story names that is not
  registered — says why, and then there is no all-clear. It also lists a merged task whose story no file
  holds (a typo in a `Task:` trailer), and a story that is not compared: it names no repo while more than
  one is registered, or two story files claim its ID even after each falls back to its file name. Only SHAs, PR/MR numbers
  and IDs are printed, never a commit message or a branch name.

Writes nothing. This is the read-only sweep a human (or CI) runs to see the picture.

> **Read the build ledger as a union — a missed ship reads as "no drift".** It is **shard-then-fold**:
> union the folded `.sdlc/build-log.json` `ships` with every loose `.sdlc/build-log/` shard, deduped by
> `(story, task, repo)` (a shard WINS over a folded ship of the same key). Reading `build-log.json` alone
> drops every ship not yet folded by `yad tidy up` — including every `yad checkpoint --retro-ship` backfill,
> and every ship on a story still at `in-build`, which `tidy up` never folds. Those are exactly the ships
> most likely to be orphaned, so missing them turns this check into a false all-clear. See
> `../yad-engineer-review/references/ship-and-record.md`.

### Step 2 — `refresh` (advisory, never silent)
For each flagged thread, **point the human at the fix** — open a reconcile change-epic with `yad-change`
(type `change`, threaded to the affected feature) to bring the Shape artifacts back in step with what
shipped, and pay any open debt (update the artifacts + add a regression test, then set the
`reconcile-debt.json` entry `status: paid`). It never seeds the epic itself — opening a change-epic is a
human, triaged act (`yad-change` Step 2).

**Orphan code with no epic at all (brownfield):** when the drift is shipped code that belongs to a
feature with **no owning epic in any thread**, there is nothing to thread a change off yet. Point the
human at **`yad-stub`** first — mint a stub genesis epic (a minimal `feature`-type thread anchor) for
that feature — then thread the reconcile change off that stub (and run `yad-backfill` +
`yad backfill promote` to make the anchor real). The reconciler never mints the stub itself.

### Step 3 — `wire` (advisory CI, no block)
Commit an advisory CI job that runs `yad reconcile --check` on push, carrying `[skip ci]` on any commit
it makes and a concurrency group, so it never retriggers itself. The job **reports**;
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
- Anchoring brownfield code that has no epic (before a change can thread off it): `../yad-stub/SKILL.md`.
- The gates that block at merge: `../yad-checks/` (lineage-check, epic-open, reconcile-debt).
