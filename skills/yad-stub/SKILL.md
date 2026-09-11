---
name: yad-stub
description: 'Phase 6 brownfield helper — mint a STUB genesis epic for an already-built feature that has no epic in the Product, so a defect/change can thread off it TODAY. In a brownfield repo not every feature has an epic; yad-change requires a real parent and dead-ends without one. This skill creates the smallest real thread anchor — a tiny epic.md (type feature under both names, thread:self, verified:false, stub:backfill-pending) + a seeded state.json + empty ledgers — never inventing behaviour. Defects thread off it immediately (gates pass, the bug list is derived by the thread rollup), and yad-backfill + its promote step later fill/flip it into a real feature epic. Never auto-advances. Use when the user says "there is no epic for this feature", "file a bug on a legacy feature", "anchor a brownfield feature", or when yad-change / yad-reconcile point here because a parent epic is missing.'
---

# SDLC — Stub Genesis Epic (Phase 6, the brownfield thread anchor)

**Goal:** Give an **already-built feature that has no epic** the smallest node that is still *real* — a
**stub genesis epic** — so a defect or change can thread off it right now (`yad-change` needs a real
parent), the gates pass, and the list of linked bugs is **derived for free** by the thread rollup. The
stub is a **thread anchor, not a spec**: it invents no behaviour. It stays `verified: false` until
`yad-backfill` documents the feature and its `promote` step flips the stub into a real feature epic.

This is the missing connective tissue in a brownfield adoption: `yad-backfill` produces a *draft spec in
the code repo*, and `yad-reconcile` *detects* shipped code with no owning epic — but neither mints the
Product epic a defect must thread from. `yad-stub` does exactly that, and only that.

## Conventions

- `{project-root}` resolves from the Product. Epic artifacts live under
  `{project-root}/epics/EP-<slug>/` (build plan §6), exactly like a normal genesis epic.
- **A stub is NOT a reserved-empty id.** An epic in yad *is* a directory + `epic.md`; the tooling skips
  any epic dir lacking `epic.md` (`threadEpics`) and `lineage-check` rejects a parent that is not a real
  `epic.md`. So the stub is a real (if minimal) genesis — that is what makes it a valid parent.
- The stub is a **genesis** (type `feature` under both names, `thread == id`, no `parent`) — the root of a new thread.
  Lineage frontmatter, the sentinel state, and the `stub`/`verified` fields are defined in
  `../yad-epic/references/state-schema.md` (Phase 6 section).
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## Inputs

- `feature` — **required.** The already-built feature's name (→ slugged into `EP-<slug>`).
- `repos` — the code repo(s) this feature lives in (for the backfill boundary later).
- `description` — one line: what the feature is (as built). **Do not** describe design or invent
  behaviour — a stub records that the feature exists, nothing more.

## On Activation

### Step 1 — Confirm there really is no epic (auto-propose, human-confirm)
Check `{project-root}/epics/` for an existing epic that already owns this feature (a genesis or any
thread). **If one exists, STOP** and point at `yad-change` (`--parent <that epic>`) — a stub is only for
a feature with *no* epic at all. If the code is already forward-spec'd or has a `specs/<story>/`, it is
not a stub case either. Confirm the brownfield-no-epic situation with the human before creating anything.

### Step 2 — Derive the stub epic id (engine-assigned, never by hand)
Derive `EP-<slug>` where `slug` is **2–4 lowercase words** from the feature name (e.g.
`EP-legacy-billing`). `EP-discovery` is **reserved** — never use it. Check `epics/` for collisions;
append a distinguishing word if the slug exists. **The id is assigned once and never renamed** (a rename
breaks every downstream link) — so pick from the best-known feature name and accept it as permanent.

### Step 3 — Open the authoring branch
Open `epic/EP-<slug>` per the shared "Authoring branches" procedure
(`../yad-epic/references/state-schema.md`): git-safe (skip with a note if `{project-root}` is not a git
work tree), check out if it exists, else create from the Product's default branch.

### Step 4 — Write the stub `epic.md` (thread anchor — never invent behaviour)
Write `{project-root}/epics/EP-<slug>/epic.md` using EXACTLY this shape:

**Every key below is read by a machine, so write them BARE — no trailing `#` comment.** The
frontmatter readers keep the whole rest of the line, so a comment becomes part of the value: a
commented `stub:` stops `yad thread` and `yad-status` seeing the stub at all, and a commented `kind:`
makes `lineage-check` refuse every commit that links a story to this epic. What they mean:

| Key | Why it is here |
|---|---|
| `kind` + `type` | the work-item type, the same value under both names — `feature`, because a stub is a genesis / thread root and a valid parent for `lineage-check` |
| `thread` | `thread == id` for a genesis |
| `theme` | the optional grouping tag — one word or short phrase, in any language, shared by every epic in the group. Usually **empty here**: a stub is minted from code that already exists, not shaped in conversation, so there is normally nobody to say which group it is in. Fill it only if the user names one, and then copy an existing spelling exactly — `yad doctor` reports one theme spelled two ways, because two spellings group as two. One tag, never a list, and no `#` (the readers keep the whole rest of the line; the `#` the commands print is decoration on the screen) |
| `verified` | `false` — not a real, human-authored epic yet, a stub awaiting backfill |
| `stub` | `backfill-pending` — the honest marker; cleared on promote |

```markdown
---
id: EP-<slug>
status: draft
kind: feature
type: feature
thread: EP-<slug>
theme:
verified: false
stub: backfill-pending
origin: brownfield
owner:
repos: [<the code repos this feature lives in>]
created: <YYYY-MM-DD>
---

## Feature (stub)
<!-- one line: what this already-built feature IS. No design, no invented behaviour. -->

## Known issues
<!-- Do not hand-maintain a list. `yad thread EP-<slug>` derives every defect/change threaded off this
     stub from lineage — it is always current. -->

## Backfill
<!-- To make this real: run `yad-backfill` for <repo> (globs for this feature), get the spec approved
     (verified: true), then `yad-backfill promote EP-<slug>`. -->
```

Leave `owner` for the human to set. Set `repos` to the code repo(s) the feature lives in.

### Step 5 — Seed the stub `state.json` (a `backfill-pending` sentinel)

**Run the engine. Do not hand-write the chain.**

```bash
yad epic new EP-<slug> --stub
```

That writes `{project-root}/epics/EP-<slug>/.sdlc/state.json` with the **same 10-step `classic` chain**
a normal epic walks, but with **every step `blocked`**, the top-level marker `kind: "stub"`, and
`currentStep: "backfill-pending"`. It also writes the empty `approvals.json` and `comments.json` and
the `reviews/` directory. It writes no `epic.md`, no branch and no commit, and it refuses an epic that
already has a `state.json`.

**Do NOT** write a `contract-lock.json` — a stub has no locked surface yet.

Notes:
- **`kind` and `type` are different things and a stub carries both.** `kind: "stub"` is the lifecycle
  marker the engine keys off; `type: "feature"` is the work-item type, copied from `epic.md`. A stub is
  always a `feature` and always `classic` — `--type` and `--profile` are refused here, because
  `yad-backfill promote` wakes the chain at its `epic` step and upkeep leaves nothing to backfill.
- The blocked chain is what makes the state valid (`validateState` needs a non-empty `steps` and a
  string `currentStep`) and what lets `promote` **wake** it into normal authoring with zero re-seeding.
- Nothing in the chain is runnable until then: `preconditionsMet` refuses every step of an anchor, and
  `yad next` routes the epic to `yad-backfill` rather than to authoring.
- Commit the seed on this step's authoring branch; it reaches the Product's default branch through the
  epic's **first** review PR/MR (or, for a stub, the PR that carries the stub itself). In verified mode
  `ledger-guard` exempts a new epic's ledger — creation, not mutation (#162) — while every later change
  to it stays CI's. See `../yad-epic/references/state-schema.md`, "Authoring branches".

### Step 6 — Stop; hand off (NO auto-advance)
Report the new `EP-<slug>`, that it is a **stub (backfill pending)**, and the two next moves:
- **File bugs now:** `yad-change` (`--parent EP-<slug>`, type `defect|change`) — the defect threads off
  the stub, its gates pass, and `yad thread EP-<slug>` lists it. A defect off a stub inherits only what
  exists (the stub `epic.md`), re-authors its own stories/test-cases, and locks no contract (there is no
  surface yet — see `../yad-change/SKILL.md`).
- **Make it real later:** `yad-backfill` for the code repo, then `yad-backfill promote EP-<slug>` to flip
  the stub to `verified: true`.

Shape steps do not auto-advance. Suggest `yad next EP-<slug>` (prints the backfill-pending guidance) and
`yad thread EP-<slug>` to see the anchor and everything threaded off it.

## Hard rules

- **A stub is an anchor, not a spec.** Never invent behaviour in `epic.md`. It records only that the
  feature exists so a change can thread off it.
- **Only for a feature with NO epic.** If any epic already owns the feature, use `yad-change` instead.
- **Never `verified: true` here.** A stub is `verified: false` / `stub: backfill-pending` until
  `yad-backfill promote` flips it — approval is earned by documenting the real code, not by minting.
- **You never implement directly against a stub.** It owns no `stories/`, so there is nothing to
  implement against directly — real work threads off it as a change/defect epic (which has its own
  stories). (This is a convention of the empty stub, not a hard gate: `lineage-check` passes a
  `feature`-type genesis and `epic-open` treats a story-less epic as un-sealed, so neither blocks a
  story mistakenly linked to the stub — keep the stub story-less.)
- **Never auto-advances.** This skill seeds the anchor and stops; humans thread changes and run backfill.

## Reference
- The lineage frontmatter, the `stub`/`verified` fields, and the `kind: "stub"` /
  `currentStep: "backfill-pending"` sentinel: `../yad-epic/references/state-schema.md` (Phase 6).
- Threading a defect/change off the stub: `../yad-change/SKILL.md`.
- Documenting the code + promoting the stub to real: `../yad-backfill/SKILL.md`.
- Detecting brownfield code with no owning epic: `../yad-reconcile/SKILL.md`.
