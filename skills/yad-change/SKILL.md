---
name: yad-change
description: 'Phase 6 post-lock change management — the change-request/defect INTAKE + TRIAGE step of a feature thread. After the contract locks and code ships, a change must NOT mutate a locked artifact; it becomes a NEW epic threaded to its parent. This skill classifies the change DEPTH (defect-fix / behavioral-no-surface / contract-surface / new-capability), seeds a new EP-<slug> change-epic threaded to its parent (lineage frontmatter kind/parent/thread/inherits/supersedes + a state.json whose inherited steps are pre-marked done and only the changed steps run; a pointer-lock contract-lock.json when architecture is inherited), and records the intake in change.json (escape_stage + root_cause for defects). For hotfixes it records the ship-first exception and opens reconcile-debt.json. Never auto-advances — hands off to the normal authoring skills + the team review gate. Use when the user says "log a change request", "file a defect", "thread a change off EP-…", "open a hotfix", or after a shipped feature needs a fix.'
---

# SDLC — Change/Defect Intake + Triage (Phase 6, the entry of a feature thread)

**Goal:** Turn a post-lock change request, defect, or hotfix into a **new epic threaded to its parent**,
so the feature's locked artifacts are never mutated — only *superseded*. The change-epic **inherits**
the front artifacts it does not change (by reference) and **re-authors** only the ones it does, so the
thread head always describes current behaviour and the SDLC stays a trusted source of truth for the next
change. This skill does the **intake + triage + seeding** and then hands off to the normal authoring
skills + `yad-review-gate`. It is a **front state**: human-confirmed, **never auto-advances**.

This is the answer to "the front/spec docs go stale after the contract locks": a behavioural change can
no longer ship through the build half against an old story — `epic-open` seals a fully-shipped epic, so
new behaviour must enter here, and its re-authored stories/test-cases describe the change.

## Conventions

- `{project-root}` resolves from the product hub.
- Artifacts live under `{project-root}/epics/EP-<slug>/` — the change-epic gets its OWN `EP-<slug>`
  (assigned here, never renamed) and its own `stories/EP-<slug>-S0N`, so every existing gate, the bridge,
  `yad next`, and the build-half traceability keep working unchanged.
- The thread is **derived** from `parent:` frontmatter (no registry); `thread:` is a cache that must
  equal the computed root (`yad doctor` flags a mismatch). Thread id = the genesis epic's id.
- Lineage frontmatter, the inherited-step shape, the pointer-lock, `change.json`, and
  `reconcile-debt.json` are all defined in `../yad-epic/references/state-schema.md` (Phase 6 section).
- Genesis epics authored before Phase 6 must be **migrated once** (`kind: feature`, `thread: <self>` in
  their `epic.md`) before a change threads off them — see `references/triage.md`.
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `parent` — **required.** The `EP-<slug>` this change evolves (the thread predecessor; usually the
  feature's current tip).
- `title` — **required.** One line describing the change.
- `kind` — `change` | `defect` | `hotfix` (default `change`). `feature` is reserved for a genesis epic
  (use `yad-epic`, not this skill).
- `origin` — defect/hotfix only: `production` | `staging` | `qa` | `review`.
- `severity` — defect/hotfix only: `sev1`..`sev4`.
- `escape_stage` — defect/hotfix only: the SDLC gate that *should* have caught it (`stories`,
  `test-cases`, `architecture`, …). Feeds the `yad-defects` quality report.
- `root_cause` — defect/hotfix only: a short tag (e.g. `missing-negative-test`).
- `description` — free text: what is wrong / what must change.
- `affected` — the artifacts the requester believes change (the triage confirms/adjusts this).

## On Activation

### Step 1 — Resolve the parent + thread (validate; STOP on a broken lineage)
Confirm `parent` exists (`epics/<parent>/epic.md` + `.sdlc/state.json`). Read its lineage and resolve
the thread root (`yad thread <parent>` / `resolveThread`). **STOP** if the parent is missing, or its
lineage is broken (a cycle, or a `thread` cache ≠ the computed root) — fix the parent first. If the
parent is a **genesis epic not yet migrated** (no `kind:`), migrate it now: add `kind: feature` and
`thread: <its own id>` to its `epic.md` (a one-line, non-gated frontmatter add).

**Missing parent (brownfield) — never silent.** If the requested `parent` does **not exist at all**
because the feature was built before it had an epic, do NOT dead-end: point the user at **`yad-stub`** to
mint a stub genesis epic (a minimal `kind: feature` thread anchor) for that feature first, then re-run
this skill with that stub as the `parent`. A change MUST still thread to a real parent — `yad-stub` just
creates the smallest real one so the defect can be captured now (the `yad-reconcile` → anchor → change
discipline).

The new epic's `thread` = the parent's thread (the genesis id). Its `parent` = the given `parent` (the
immediate predecessor — usually the current tip; if the parent is not the tip, see "concurrent changes"
in `references/triage.md`).

### Step 2 — Gather the change + triage the DEPTH (auto-propose, human-confirm)
With the requester, classify the change into one **depth** (the `yad-backfill` discipline: auto-propose,
human-confirm). The depth decides which front states are **re-authored** vs **inherited**:

| depth | re-authors (active) | inherits (pre-done, by reference) | first step |
|-------|---------------------|-----------------------------------|-----------|
| **defect-fix** — the spec was right, code/coverage was wrong | `stories` (a regression story), `test-cases` (the missing case) | epic, architecture, contract, ui-design | `stories` |
| **behavioral-no-surface** — behaviour changes, contract surface unchanged | epic (delta), `stories`, `test-cases` (+ ui-design if visible) | architecture, **contract (no re-lock)** | `stories` (or `ui-design`) |
| **contract-surface** — the shared cross-repo surface changes | **architecture + contract (RE-LOCK)**, `stories`, `test-cases` (+ epic/ui as needed) | whatever is genuinely untouched | `architecture` |
| **new-capability** — not a change to this feature, a new one | full chain (`epic`…`test-cases`) | lineage/context only | `epic` |

Print the chosen depth and the **re-author vs inherit** split; **get explicit confirmation** before
seeding. A `new-capability` is usually a *new genesis epic* (`yad-epic`) — only thread it when it truly
extends this feature's evolution.

### Step 3 — Derive the change-epic id + open the authoring branch
Derive a distinct `EP-<slug>` from the title (2–4 lowercase words; check `epics/` for collisions, append
a word if needed). Create `{project-root}/epics/EP-<slug>/`. Open the `change/EP-<slug>` authoring branch
per the shared "Authoring branches" procedure (git/greenfield-safe).

### Step 4 — Write `epic.md` (the change brief + lineage frontmatter)
Write a thin brief carrying the lineage frontmatter:

```markdown
---
id: EP-<slug>
status: draft
kind: <change|defect|hotfix>
parent: <EP-parent>
thread: <EP-genesis>
inherits: [<the inherited bases>]
supersedes: [<parent story ids this replaces, optional>]
owner:
repos: [<inherit from the resolved current truth / parent>]
# defect/hotfix only:
origin: <…>
severity: <sevN>
escape_stage: <stage>
root_cause: <tag>
---

## Change
<!-- what is wrong / what must change, and why now -->

## Resolved current truth (input)
<!-- run `yad thread <parent>`: which epic currently owns each artifact this change builds on -->

## Re-authored vs inherited
<!-- the Step 2 split, for the reviewers -->
```

For a **contract-surface** depth, do NOT inherit `architecture` — it will be re-authored (and re-locked)
by `yad-architecture` downstream.

### Step 5 — Seed `state.json` (inherited steps pre-done; only the changed steps run)
Create `.sdlc/state.json` with the **same 10-step chain** as `yad-epic` (so `advanceState`/`nextAction`/
`gatePredicate`/the bridge run unchanged), but:
- **Inherited** authoring steps **and their review gates**: `status: "done"`, `"inherited": true`,
  `"inheritedFrom": "<owning epic from the resolved truth>"`, `"boundHash": "<that artifact's current
  hash>"`.
- The **first re-authored** authoring step: `status: "in_progress"`; its review: `status: "in_review"`
  only once authored — seed it `blocked` and let the authoring skill open it. Set `currentStep` to the
  first re-authored authoring step.
- Remaining re-authored steps: `blocked`.

Seed `.sdlc/approvals.json` with one **provenance** record per inherited gate (NOT a forged approval):
`{ "artifact": "<art>", "step": "<…-review>", "status": "inherited", "from": "<epic>", "boundHash": "<hash>", "date": "<today>" }`.
Seed `.sdlc/comments.json` = `[]` and create `reviews/`.

When `architecture` is **inherited**, materialize the **pointer-lock** `.sdlc/contract-lock.json`:
`{ "artifact": "contract.md", "hash": "<parent surface hash, verbatim>", "lockedAt": "<today>", "inheritedFrom": "<epic>", "ref": "../../<epic>/.sdlc/contract-lock.json" }`.
There is no `contract.md` in the change-epic, so the surface cannot drift, and `contract-check` passes
unchanged because the hash is identical. (Exact recipe + field shapes: `references/triage.md`.)

**Stub parent (brownfield, no locked surface yet).** When the `parent` is a **stub**
(`stub: backfill-pending` / `verified: false`, minted by `yad-stub`), it has no `architecture.md` /
`contract.md` / `ui-design.md` to inherit — the surface has not been documented yet. So for the bases the
stub lacks, mark the inherited steps `"inherited": true, "inheritedFrom": "<stub>", "boundHash": null`
(a `null` boundHash is treated as "nothing locked upstream → no drift" by the gate predicate, so the step
passes and never blocks), and write **NO** `contract-lock.json` (there is no surface to point at — the
child never touches `specs/*/contracts/**`, so `contract-check` passes trivially). Contract protection on
this thread begins only after `yad-backfill promote` documents and locks the feature. Record
`"parentStub": true` in `change.json` so it is auditable that the change threaded off an undocumented
stub. Prefer the `defect-fix` / `behavioral-no-surface` depth against a stub — a `contract-surface`
change against an undocumented feature should wait until the stub is promoted (backfilled + a real
contract locked).

### Step 6 — Write `.sdlc/change.json` (intake + triage record)
Record the intake: `epicId`, `thread`, `parent`, `kind`, `depth`, `intakeBy`, `intakeDate`, `title`,
`description`, `affectedArtifacts`, `reauthors`, `inherits`, and for a defect/hotfix the `defect` block
(`origin`, `severity`, `escape_stage`, `root_cause`). This is what `yad-defects` reads to attribute the
defect to the gate that should have caught it. Add `"parentStub": true` when the parent is an
un-promoted stub (Step 5) — omit it (or `false`) otherwise.

### Step 7 — Hotfix only: record the ship-first exception + open reconcile debt
If `kind: hotfix`, the build half MAY run before these front gates approve (severity demands it). Record
`hotfix: { "shipFirst": true }` in `change.json` and **append** to `.sdlc/reconcile-debt.json`:
`{ "thread": "<…>", "epicId": "<…>", "openedDate": "<today>", "reason": "<why>", "requires": ["artifacts-updated","regression-test"], "status": "open", "paidDate": null, "paidBy": null, "evidence": { "artifacts": [], "regressionTest": "" } }`.
Tell the user the debt **freezes the next normal change** on this thread (`reconcile-debt` gate) until it
is paid (front artifacts updated **and** a regression test added, then `status: "paid"`).

### Step 8 — Stop; hand off (NO auto-advance)
Report: the new `EP-<slug>`, its thread + parent, the re-author-vs-inherit split, the seeded
`currentStep`, and the next skill — `yad-architecture` (contract-surface), else `yad-stories` /
`yad-test-cases` — followed by `yad-review-gate`. Front states do not auto-advance. Suggest
`yad thread <thread>` to see the evolution and `yad-timeline` / `yad-defects` to render it.

## Hard rules

- **Never mutate a locked artifact.** A change is a new threaded epic, not an edit to a shipped one.
- **A change MUST thread to a real parent.** Validate the parent + thread first; STOP on a broken lineage.
- **Inherit by reference, never copy.** Inherited steps are pre-done with `inherited: true` + a
  `boundHash`; the pointer-lock carries the parent hash verbatim. The gate never re-reviews them.
- **Contract-surface ⇒ re-author architecture.** Omitting `architecture` from `inherits` is the ONLY way
  to change the surface; it re-locks (new hash) and routes through the escalated architecture review —
  the same mechanism as the build-half `Contract-Change` route, unified.
- **A hotfix opens debt, never waives it.** Ship-first is allowed once; the thread freezes for new work
  until the debt is paid.
- **Never auto-advances.** This skill seeds + records; humans author and approve via the normal gates.

## Reference
- Minting a stub genesis epic when the feature has no epic (brownfield): `../yad-stub/SKILL.md`.
- Depth triage details, the exact seeding shape, the pointer-lock recipe, genesis migration, and the
  concurrent-change (re-parent) rule: `references/triage.md`.
- The lineage frontmatter + ledger schemas: `../yad-epic/references/state-schema.md` (Phase 6).
- The authoring skills this hands off to: `../yad-architecture/`, `../yad-stories/`, `../yad-test-cases/`,
  and the gate `../yad-review-gate/`.
- The thread view + reports: `yad thread`, `../yad-timeline/`, `../yad-defects/`.
- The gates that enforce it: `../yad-checks/` (lineage-check, epic-open, reconcile-debt).
