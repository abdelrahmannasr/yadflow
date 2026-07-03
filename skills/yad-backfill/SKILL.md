---
name: yad-backfill
description: 'Build-half Step G of the gated SDLC — backfill: generate specs for already-built features in an existing repo so new work does not break them. Confirm Repomix (the one true CLI subprocess: npx repomix), pack ONE feature at a time (compress + git logs, secret-scan), feed it to AI with a "describe what exists, do not invent" prompt, and write a DRAFT spec marked unverified. Require human approval (reuse yad-review-gate) before the spec counts as real. Boundary is auto-proposed from the project convention and human-confirmed. A change is blocked only until the features IT touches have approved specs. The `promote` action flips a brownfield stub epic (minted by yad-stub, so defects could thread off it) to a real, verified feature epic once its backfill spec is approved. Use when the user says "backfill specs", "document an existing feature", "spec the legacy code", or "promote the stub epic".'
---

# SDLC — Backfill (existing-code specs)

**Goal:** Bring an existing repo (no specs) under the gated SDLC one **feature** at a time, by
generating a spec for what is **already built** — so future changes have a contract to check against
(build plan §G). The generated spec is a **draft, unverified** until a human approves it; only then does
it count. Gating is **per touched feature**: a new change is blocked only until the features it touches
have approved specs — never the whole repo at once.

## Conventions

- `{project-root}` resolves from the project working directory; code repos are separate git repos under
  `{project-root}/demo-repos/<repo>/`.
- **Repomix is a true CLI subprocess** (Phase 0 / RESEARCH-NOTES §3): `npx repomix@latest [flags]` —
  NOT a slash-command. It secret-scans by default (Secretlint).
- Backfilled specs live in the code repo at `specs/backfill/<feature>/spec.md`.
- A **feature** is the project's natural unit from the constitution (e.g. a module / a `src/<feature>/`
  directory). Auto-propose the boundary from the convention; **a human confirms** it where the code
  does not follow it.

## Inputs

- `repo` — the existing code repo to backfill.
- `feature` — the feature name (and its file globs, e.g. `src/<feature>/**`).
- `action` — `pack` | `draft` | `approve` | `gate` | `promote` (default `pack`).
- `epic` — `promote` only: the stub epic `EP-<slug>` (minted by `yad-stub`) to flip to real once the
  feature's backfill spec is approved.

## On Activation

### Step 1 — Propose the boundary (auto-propose, human-confirm)
From the constitution's convention (e.g. module = feature, or `src/<feature>/`), propose the feature's
file set. Present it and **ask the human to confirm or adjust** the boundary before packing. Never
guess silently where the code breaks the convention.

### Step 2 — `pack` (Repomix, one feature)
Run, from inside the repo, over **only this feature's files**:
```
npx repomix@latest --compress --include "<feature globs>" --include-logs --style markdown -o <out>.md
```
`--compress` (Tree-sitter structural compression) keeps it small; `--include-logs` adds the relevant
git history (default 50; `--include-logs-count N` to change); Secretlint secret-scans by default. If a
secret is reported, STOP and have it removed/redacted before continuing. (If `npx repomix` is
unavailable, degrade: hand-assemble the same feature context and record `repomix: unavailable`.)

### Step 3 — `draft` (describe what exists — do NOT invent)
Feed the packed context to the AI with the **"describe what exists, do not invent"** instruction
(`references/backfill.md`). Write `specs/backfill/<feature>/spec.md` describing the feature's actual
endpoints/behaviour/data as built, with frontmatter:
```yaml
---
feature: <feature>
repo: <repo>
artifact: backfill-spec
status: draft
verified: false        # not real until a human approves
source: repomix         # or "repomix: unavailable" when degraded
generated: <YYYY-MM-DD>
---
```
Mark every uncertain item explicitly (`<!-- unverified: ... -->`); do not fill gaps with invented
behaviour.

### Step 4 — `approve` (human approval — reuse the gate)
A human reads the draft against the real code and approves it with the same `human_approve` discipline
as `yad-review-gate` (owner + 1 reviewer). On approval set the frontmatter `verified: true` and record
the approver(s) + date. Only a `verified: true` backfill spec counts as real.

### Step 5 — `gate` (block changes per touched feature)
`bash checks/backfill-check.sh <base>` blocks a change that touches a feature being backfilled until
that feature's spec is `verified: true`. It is **per touched feature** — a change touching feature A is
not blocked by an unverified feature B. Forward-spec'd features (those with their own `specs/<story>/`)
are not this gate's concern.

### Step 6 — `promote` (flip a stub epic → real, once its spec is approved)
When a brownfield feature was anchored with a **stub genesis epic** (`yad-stub`) so that defects could
thread off it, `promote` is what makes that anchor real — run it once the feature's backfill spec is
`verified: true`. Given `epic EP-<slug>` (a stub: `stub: backfill-pending` / `verified: false`):
- **Verify readiness:** the matching `specs/backfill/<feature>/spec.md` must exist and be
  `verified: true`. If not, STOP — approve the spec first (Step 4).
- **Clear the stub markers ATOMICALLY.** A stub is marked in two files at once — `epic.md`
  (`stub: backfill-pending`) **and** `state.json` (top-level `kind: "stub"` + `currentStep:
  "backfill-pending"`). Promote must clear **all** of them together, or `yad next` (reads `state.json`)
  and `yad thread` / `yad-status` (read `epic.md`) will disagree about whether the epic is still a stub.
  - **`epic.md`:** set `verified: true`, **remove** the `stub:` marker, and add a `backfill:` block linking
    the approved spec, e.g. `backfill: { spec: specs/backfill/<feature>/spec.md, promoted: <YYYY-MM-DD> }`.
  - **`state.json`:** **remove** the top-level `kind: "stub"`, and move `currentStep` off the
    `backfill-pending` sentinel (per the promote flavour below).
- **Light promote (default):** the feature's documentation lives in the approved backfill spec — do NOT
  wake the front chain. Set `state.json` `currentStep: "backfill-done"` (a terminal sentinel, like
  `discovery-done`): the epic is now a real, verified anchor and its later evolution threads normally with
  `yad-change`. `yad next` then reports it as a documented anchor, not a pending stub.
- **Full promote (opt-in):** to bring the feature fully under the front half and lock a real contract,
  "wake" the state chain — set `currentStep: "epic"`, `epic` step `status: "in_progress"` — then run
  `yad-epic` → `yad-architecture` → … the normal way. This re-locks a contract that subsequent thread
  changes will inherit.
- Never auto-advances; a human confirms the promotion.

### Step 7 — Stop (no auto-advance)
Report the packed feature, the draft path (or the approval / promotion), and what is still unverified.
Nothing auto-advances; a human owns the approval.

## Hard rules (build plan §G, Cross-cutting)

- **Describe what exists; never invent.** A backfill spec is a record of built behaviour, not a design.
- **Draft until human-approved.** `verified: false` specs do not count; approval reuses the gate.
- **One feature at a time; gate per touched feature.** Never block the whole repo.
- **Repomix via its real CLI** (Phase 0); secret-scan before any AI sees the code.

## Reference
- The "describe what exists" prompt, the spec shape, and the gate: `references/backfill.md`.
- The human approval discipline reused: `../yad-review-gate/SKILL.md`.
- Minting the stub epic that `promote` later flips to real (brownfield thread anchor):
  `../yad-stub/SKILL.md`.
- Repomix flags: `RESEARCH-NOTES.md` §3.
