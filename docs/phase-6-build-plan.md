# Phase 6 — Build Plan: post-lock change management via feature threads

> **Status: built.** Adds the change/defect/hotfix track that was missing after the contract locks. A
> change becomes a new epic **threaded** to its parent; artifacts are never mutated, only **superseded**.
> Engine, three CI gates, four skills (`yad-change`, `yad-timeline`, `yad-defects`, `yad-reconcile`),
> `yad thread` / `yad reconcile` CLI, and a worked demo all ship in this phase.

## Context

Phases 2–5 take a feature from idea to shipped code, forward-only: `epic → architecture (+ locked
contract) → ui → stories → build → ship`, every code change tracing to a story via the `Task:` trailer +
`specs/<story>/link.md`. The only post-lock change mechanism was a *contract-surface* change → re-lock →
architecture gate. Two gaps remained:

1. **No change-request or defect/bug intake.** Every change had to be born from a story, so a post-lock
   fix had nowhere idiomatic to enter.
2. **Silent staleness.** A behavioural change that does **not** touch the contract surface shipped through
   the build half *without updating* `epic.md` / `stories/` / `spec.md` / `test-cases.md`. Those source
   artifacts drifted from reality, so the SDLC stopped being a trusted source of truth for AI on the next
   change — exactly the value the system exists to protect.

## The decision: a change is a new epic, threaded to its parent

Mutating a locked artifact fights the immutability/audit philosophy and destroys the lock. Instead **every
change request becomes a new epic, threaded to its parent**. A feature is a **thread** of linked epics
(genesis → change → defect → …). A change-epic **inherits** the front artifacts it does not change (by
reference) and **re-authors** only the ones it does. So:

- Artifacts are never stale — they are **superseded**. The feature's current truth is the **head of the
  thread**, composed by the resolver; the chain *is* the evolution timeline.
- Defects are first-class (`kind: defect`, carrying `escape_stage` + `root_cause`), so a report can show
  *where quality gaps systematically come from*.
- Hotfixes ship-first then reconcile-after, with **debt** that freezes the thread's next change until paid.

**Why it's cheap.** The CI gates already derive an epic from a story by stripping the `-S0N` suffix and
read *that epic's own* `contract-lock.json`. A change-epic is a new `EP-<slug2>` with its own stories, so
every existing derivation, the review gate, the bridge, and `yad next` keep working. `contract-check.sh`
and `spec-link.sh` stay byte-for-byte unchanged.

## What gets built

### 1. The lineage layer (schema + engine)
- `epic.md` frontmatter: `kind` (feature|change|defect|hotfix), `parent`, `thread` (a derived cache),
  `inherits`, `supersedes`, and for defects `origin`/`severity`/`escape_stage`/`root_cause`.
- Two per-epic ledgers: `change.json` (intake + triage) and `reconcile-debt.json` (hotfix ship-first debt).
- `cli/epic-state.mjs`: `resolveThread` (cycle/missing-safe), `threadEpics`, `resolveCurrentArtifacts`
  (the current-truth resolver), and an **inherited-step short-circuit** in `gatePredicate` (an inherited
  artifact is satisfied upstream; a drifted `boundHash` is corruption, not a stale).
- `cli/thread.mjs`: `yad thread` (print a thread + resolved truth + open debt) and `yad reconcile`.
- `cli/doctor.mjs`: `threadChecks` (broken lineage fails; open debt warns).

### 2. Three CI gates (in `yad-checks`, fail-closed bash, GitHub + GitLab)
- **lineage-check** — a change/defect/hotfix epic must thread to a real `parent`.
- **epic-open** — an epic **sealed** (all stories shipped) refuses new behaviour, forcing a new threaded
  change-epic. This is the staleness preventer.
- **reconcile-debt** — a thread with open hotfix debt is frozen for new changes until paid.

All three resolve the owning epic via `specs/<story>/link.md`'s `product-repo` path (like contract-check)
and degrade to a PASS-with-note when the hub is not reachable from CI.

### 3. Four skills
- **yad-change** — intake + triage; seeds the threaded change-epic (lineage, inherited state, pointer-lock,
  `change.json`, hotfix debt). Never auto-advances.
- **yad-timeline** — render the thread as an evolution view + emit `thread-resolved.md` (the current-truth
  map). Output enrichment, never a gate.
- **yad-defects** — per-epic/per-thread quality-gap report by `escape_stage` + `root_cause`. Enrichment.
- **yad-reconcile** — read-only drift/orphan/debt sweep (mirrors `yad-docs-sync`). Never a gate.

### 4. The two unifying seams (the heart of it)
- **Contract inheritance = a pointer-lock.** An inherited `architecture` writes a derived
  `contract-lock.json` carrying the parent hash *verbatim*, so `contract-check` passes unchanged and the
  surface physically cannot drift. Omitting `architecture` from `inherits` is what triggers a real re-lock
  + the escalated architecture review — unifying "route back to the architecture gate" with "open a
  contract-surface change-epic".
- **Inherited steps don't get re-reviewed.** They are pre-`done` with `inherited: true` + a `boundHash`;
  the gate predicate short-circuits them as satisfied, so only the changed artifacts are re-reviewed.

## Definition of done (Phase 6)
- A post-lock change is filed as a threaded change-epic; `yad thread` resolves the current-truth map
  (the change-epic owns what it re-authored; genesis owns the rest).
- `epic-open` fails a further change to a sealed epic (forcing a new change-epic); `lineage-check` passes a
  properly threaded change; `contract-check` passes on an inherited pointer-lock with no surface touch.
- A hotfix opens `reconcile-debt`; `yad reconcile` / `yad doctor` flag it; `reconcile-debt` blocks the next
  change until paid.
- `yad-timeline` + `yad-defects` render the thread (the defect attributes to its `escape_stage`).
- Engine unit-tested (`cli/test-threads.mjs`); the full suite + lint green; the worked demo
  (`EP-istifta-inquiries` → `EP-istifta-queue-filter`) proves the loop end-to-end.

## Explicitly NOT in Phase 6
- No mutation of any locked artifact — ever. A change is a new epic.
- No auto-advance of any front state (a change-epic's re-authored steps are `human_approve`, like genesis).
- No new derivation in the existing gates — `spec-link`/`contract-check` are unchanged; the thread is
  derived from `parent:` frontmatter, not a registry.
