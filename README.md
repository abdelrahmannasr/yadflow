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

As of **Phase 4a** the `automation` dial is no longer inert: the orchestrator `sdlc-run` reads it and,
for the safe **back** steps, advances on its own when a step is set to `machine_advance` (and has
*earned* it — see "Run the back half on the dial" below). The engineer review and all four front
states stay `human_approve` forever.

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

## Run the full build half by hand (Phase 3)

From a `ready-for-build` story, the **build half** turns one atomic task into shipped code through
gates that protect production. Per-repo specs live in each code repo; the contract stays singular in
the product repo. Code repos are **separate git repos** under `demo-repos/<repo>/` (gitignored;
`demo-repos/README.md` explains regeneration). **Nothing auto-advances** — every gate is human-owned.

1. **Spec** — `sdlc-spec` runs the heavy Spec Kit ceremony **once per story per repo**
   (`specify`→`clarify`→`plan`→`analyze`→`checklist`→`tasks`), writing `specs/<story-id>/` and a
   `link.md` back to the story (drives `/speckit.*` when installed, else degrades). It **quotes** the
   locked contract; it never widens it.
2. **Implement** — `sdlc-implement` (the `dev` step): one atomic task = one branch
   (`feat/<story>-<task>-…`) = one PR. The diff stays inside the files the task declared; the commit
   ends with a `Task:` trailer (and `Contract-Change: yes` only if the locked surface is touched).
3. **Check gates** — `sdlc-checks` wires three CI gates (GitHub + GitLab) that must pass before merge:
   **spec-link** (links a real story/spec), **contract-check** (a contract-surface change without
   `Contract-Change` + a re-locked contract FAILS, routing back to the architecture gate),
   **build/test/lint**. They fail closed on a bad base ref.
4. **PR/MR template + risk routing** — `sdlc-pr-template` drops the platform-matched template with an
   Impact & Risk block; `high` risk (or a contract/auth/payments surface) routes the review to domain
   owners (`risk-route.sh`), the same escalation as the gate.
5. **AI review → engineer review → ship** — `sdlc-ship`: CodeRabbit is an advisory first pass (never
   the authority); a human engineer approves (owner + 1 reviewer, escalating to domain owners); on
   merge the ship is recorded in `.sdlc/build-log.json` and the story state becomes `in-build` →
   `shipped`. The epic → story → task → PR → mergeCommit chain is traceable both ways.

**Multi-repo:** a story tagged `repos: [backend, mobile]` runs the above in each repo independently from
the **one** locked contract; the contract-check blocks a surface bypass in either repo.

**Backfill existing code:** `sdlc-backfill` packs one feature with **Repomix** (`npx repomix`, secret-scan
by default), drafts an *unverified* spec ("describe what exists, do not invent"), a human approves it,
and `backfill-check.sh` blocks a change to that feature until its spec is approved — gated per touched
feature, never the whole repo.

The build half is walked end to end on the worked epic: story **S01** shipped (`status: shipped`,
three tasks in `build-log.json`), **S03** built across backend + mobile, and a `health` feature
backfilled. The code repos are regenerable from `demo-repos/README.md`.

## Run the back half on the dial (Phase 4a — automation, earned)

Phase 4 is **automation, earned with evidence and reversible in one move**. Phase 4a makes the
`automation` dial real and automates exactly the safest step — the check-gate advance. The engine is
`sdlc-run`; the evidence lives in two new files per epic under `.sdlc/`: `build-state/<story-id>.json`
(the back steps with their dials, per repo) and `trust-log.json` (every run's verdict). See
`docs/phase-4-build-plan.md`.

- **Drive a story's back half:** `sdlc-run {story} {repo}` walks `spec → tasks → implement → checks`,
  reading each step's dial. On `machine_advance` it advances on its own; on `human_approve` it stops
  for a human; on any FAIL, scope overrun, or contract-surface touch it **halts and pulls in a human**.
  It always stops at the engineer review (`sdlc-ship`), which is never automated.
- **Read the trust log:** `sdlc-status {epic}` shows each back step's dial, status, and trust record —
  runs, % `approved-unchanged`, and whether that clears the threshold (`automation.trust_threshold` in
  `config.yaml`, default ≥5 runs and ≥80% unchanged). The engineer review records each run's verdict
  (a diff merged as-authored is `approved-unchanged`; one edited first is `approved-with-edits`; a
  failed one is `rejected`).
- **Earn automation for a step:** once a step's trust record clears the threshold,
  `sdlc-run action: set-dial step: checks to: machine_advance` flips it. The setter **refuses** if the
  evidence is short, or for any front state / the engineer review. Reverting
  (`to: human_approve`) is always allowed — automation is reversible in one move.
- **Kill switch:** `sdlc-run action: kill` forces every step back to `human_approve` system-wide
  instantly (no code change, no per-step edits); `sdlc-run action: unkill` restores earned automation.

Phase 4a ships the engine + trust log and earns only `checks` (Step B). Automating `tasks` and the
`implement → check` handoff (Steps C–D) is Phase 4b, earned with the trust evidence this phase
collects.

## What's intentionally NOT built yet

**Phase 4b:** automating the next two back steps — `tasks` generation advance and the
`implement → check` handoff — each earned with trust-log evidence, with the scope guard and
contract-surface halt always overriding the dial. **Front states and the engineer review stay
human_approve, permanently.**

**Phase 5 (conditional):** the optional service layer (watch repos, run earned-automation steps
unattended, read-only dashboards), built only when the CLI genuinely can't keep up, with git remaining
the source of truth. See `docs/phase-4-build-plan.md` §"Then Phase 5" and `docs/claude-code-build-plan.md` §8.
