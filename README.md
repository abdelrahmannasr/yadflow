# SDLC Workflow — gated, team, multi-repo SDLC on top of BMAD

A custom BMAD module that turns BMAD from a solo tool into a **team, gated, file-driven SDLC
engine**. Every step does its work, writes its output to a file, and **waits at a gate**. Who
advances the gate (human now; machine later) is a per-step setting. All state lives in files —
nothing hidden, no database.

This repo is the **first deliverable** (see `docs/claude-code-build-plan.md` §10): verified research,
a scaffolded module that installs cleanly, and a working **team review gate** you run by hand.

## What's here

| Path | What it is |
|------|-----------|
| `RESEARCH-NOTES.md` | Verified Phase 0 facts about BMAD, Spec Kit, Repomix, Impeccable + deviations. |
| `skills/sdlc/` | Module source of truth (`config.yaml`, `module-help.csv`, `install.sh`). Survives BMAD updates. |
| `skills/sdlc-author-epic/` | Front state 1: author an epic with AI assist, assign its `EP-<slug>` ID, seed state. |
| `skills/sdlc-author-architecture/` | Front state 3: author `architecture.md` + the locked `contract.md`; hash-lock the contract surface. |
| `skills/sdlc-author-ui/` | Front state 5: author `ui-design.md` + `DESIGN.md` (Impeccable slash-commands, or graceful fallback). |
| `skills/sdlc-author-stories/` | Front state 7: break the epic into repo-tagged stories with stable `EP-<slug>-S0N` IDs. |
| `skills/sdlc-review-gate/` | The reusable **team review + approve gate** (used for all four reviews). |
| `skills/sdlc-status/` | Read-only view of the full front-state chain and what's blocking the gate. |
| `epics/EP-istifta-inquiries/` | A worked demo epic run through the **whole front half** (epic → … → ready-for-build). |

## Install (and re-install after a BMAD update)

```bash
bash skills/sdlc/install.sh
```

This copies the `sdlc-*` skills into the IDE skill dirs (`.claude/`, `.agents/`, `.zencoder/`,
`.opencode/`) and registers the module under `_bmad/sdlc/`. The **source** stays in `skills/`, which
a `bmad-method` update does not touch — so after any BMAD update, just re-run the script.

## The two dials (per step, build plan §2)

- **assistance:** `none` | `review` | `heavy` — how much AI helps.
- **automation:** `human_approve` | `machine_advance` — who advances the step.

Defaults: every step starts `human_approve`. The four **front** authoring steps (epic, architecture,
UI, stories) and their reviews are **locked** — they may not be set to `machine_advance` in this
version. Front states never auto-advance.

## Run the full front half by hand

The front half walks **epic → review → architecture+contract → review → UI design → review → stories
→ review → `ready-for-build`**. It is all files under `epics/EP-<slug>/`. The skills below guide you,
but you can also edit the files directly — that's the point.

Each authoring step is the same shape: an author skill produces an artifact, sets its step `done`,
moves `currentStep` to the matching review, and **stops at the gate**. Then **`sdlc-review-gate`**
(one gate, reused for all four reviews) takes `open → comment → approve → advance`.

### Author steps
1. **`sdlc-author-epic`** (state 1) → `epic.md`; assigns the stable `EP-<slug>` ID; seeds
   `.sdlc/state.json` (all `human_approve`, front steps locked) + empty `.sdlc/approvals.json`.
2. **`sdlc-author-architecture`** (state 3) → `architecture.md` + the locked `contract.md`; writes the
   contract-surface SHA-256 to `.sdlc/contract-lock.json`.
3. **`sdlc-author-ui`** (state 5) → `ui-design.md` + `DESIGN.md` (drives Impeccable
   `document|extract|craft` slash-commands when installed; otherwise authors directly).
4. **`sdlc-author-stories`** (state 7) → one file per story `stories/EP-<slug>-S0N.md`, each tagged
   with the `repos` it implements.

### The one gate (every review)
Invoke **`sdlc-review-gate`**:
- `action: open` — present the artifact; reviewers leave comments in
  `reviews/<artifact>--<date>--comments.md`. The owner addresses them and edits the artifact in place.
  **Commenting never advances.**
- `action: approve` (name + role) — appended to `.sdlc/approvals.json` and reflected in
  `reviews/<artifact>--<date>--approved.md`.
- `action: advance` — advances **only if** the rule is satisfied; otherwise it names the missing
  approval and stays put.

**The gate rule, by review:**
- **Base** (epic, UI): `owner + 1 reviewer`.
- **Escalated** (architecture+contract — `risk_tags: ["contract"]`): base **plus a domain owner for
  every repo in `epic.repos`**. The contract-surface hash must still match `.sdlc/contract-lock.json`
  (a changed surface invalidates approvals).
- **Per-repo** (stories): base **plus a domain owner (the repo's engineer) for every repo that appears
  in any story's `repos`**.

### Check status anytime
Invoke **`sdlc-status`** (read-only) to see the full 8-step chain, every step's dials/status, the
contract lock, story repo tags, and which approvals the active gate still needs.

## Worked example (already in this repo)

`epics/EP-istifta-inquiries/` shows the **whole front half** walked end to end:
- `epic.md` authored + approved (epic gate, base rule) — 2026-06-04.
- `architecture.md` + `contract.md` authored; contract surface hash-locked in
  `.sdlc/contract-lock.json`. Architecture gate **escalated** (contract): owner *alice* + reviewer
  *bob* + domain owners *carol* (backend) and *dave* (mobile).
- `ui-design.md` + `DESIGN.md` authored (Impeccable not installed → graceful fallback). UI gate base
  rule (alice + bob).
- Five repo-tagged stories `stories/EP-istifta-inquiries-S01..S05.md`. Stories gate **per-repo**: base
  rule + a domain owner for each touched repo (carol/backend, dave/mobile).
- `state.json` now reads `currentStep: ready-for-build`, every front step `done` — the Phase 3
  handoff point.

Inspect it:
```bash
cat epics/EP-istifta-inquiries/.sdlc/state.json
cat epics/EP-istifta-inquiries/.sdlc/approvals.json
cat epics/EP-istifta-inquiries/.sdlc/contract-lock.json
ls  epics/EP-istifta-inquiries/reviews/
ls  epics/EP-istifta-inquiries/stories/
# re-verify the contract surface still matches its lock:
awk '/CONTRACT-SURFACE:BEGIN/{f=1;next} /CONTRACT-SURFACE:END/{f=0} f' \
  epics/EP-istifta-inquiries/contract.md | shasum -a 256
```

## What's intentionally NOT built yet

Per the build plan's smallest-useful-first order, the **build half** (Phase 3) adds: Spec Kit per
story per repo (`specify`→`clarify`→`plan`→`tasks`…), the `dev` implement step, check gates
(build/test/lint + **contract-check** + spec-link), AI + engineer review, ship, the Repomix
**backfill** step, PR/MR templates, and any move toward `machine_advance` (back states only, never the
front). See `docs/phase-2-build-plan.md` §"Then Phase 3" and `docs/claude-code-build-plan.md` §8.
