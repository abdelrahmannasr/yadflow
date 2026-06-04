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
| `skills/sdlc-review-gate/` | The reusable **team review + approve gate** (the core piece). |
| `skills/sdlc-status/` | Read-only view of an epic's state and what's blocking the gate. |
| `epics/EP-istifta-inquiries/` | A worked demo epic that has been run through the gate. |

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

## Run the epic → review → approve loop by hand

The loop is just files under `epics/EP-<slug>/`. The skills below guide you, but you can also edit
the files directly — that's the point.

### 1. Author an epic
Invoke **`sdlc-author-epic`** with a one-line idea. It:
- shapes the idea (analyst lens) and writes `epic.md` (pm lens) from the standard template,
- assigns the stable `EP-<slug>` ID (you never type IDs by hand),
- seeds `.sdlc/state.json` (all steps `human_approve`, front steps locked) and an empty
  `.sdlc/approvals.json`, and stops at the gate.

### 2. Review it
Invoke **`sdlc-review-gate`** with `action: open`. Reviewers leave comments → they land in
`reviews/<artifact>--<date>--comments.md`. The owner addresses them (pm-assisted) and edits
`epic.md`. Repeat until reviewers are happy. **Commenting never advances the gate.**

### 3. Approve it
Each reviewer runs the gate with `action: approve` (name + role). Each approval is appended to
`.sdlc/approvals.json` and reflected in `reviews/<artifact>--<date>--approved.md`.

**The gate rule:** `owner + 1 reviewer`. If the step touches the **contract, auth, or payments**
(`risk_tags`), it escalates and also needs the relevant **domain owner**. (The architecture+contract
review escalates by default.)

### 4. Advance
Run the gate with `action: advance`. It advances **only if** the rule is satisfied; otherwise it
tells you exactly which approval is missing and stays put. On pass it marks the review step `done`,
unblocks the next authoring step, and moves `currentStep`.

### Check status anytime
Invoke **`sdlc-status`** (read-only) to see the current step, every step's dials/status, and which
approvals the active gate still needs.

## Worked example (already in this repo)

`epics/EP-istifta-inquiries/` shows a full pass:
- `epic.md` authored from the template, ID assigned.
- `reviews/epic--2026-06-04--comments.md` — reviewer *bob*'s comments + owner resolution.
- Owner *alice* approved (owner) — gate **blocked** (0/1 reviewers).
- Reviewer *bob* approved — gate **passed**; `state.json` advanced `currentStep` from `epic-review`
  to `architecture`, with `epic-review: done` and `architecture: in_progress`.

The committed files show the **post-advance** state (the gate has already passed): `currentStep`
is `architecture` and `epic-review` is `done`. The "blocked" step above is the historical
intermediate snapshot, not what you'll see on disk now.

Inspect it:
```bash
cat epics/EP-istifta-inquiries/.sdlc/state.json
cat epics/EP-istifta-inquiries/.sdlc/approvals.json
ls  epics/EP-istifta-inquiries/reviews/
```

## What's intentionally NOT built yet

Per the build plan's smallest-useful-first order, later iterations add: the Node CLI engine
(`init`/`link`/`backfill`/`feature`/`check`), the multi-repo **contract check**, the Repomix
**backfill** step, the Impeccable **UI design** step, PR/MR templates, and any move toward
`machine_advance` (back states only, never the front). See `docs/claude-code-build-plan.md` §8.
