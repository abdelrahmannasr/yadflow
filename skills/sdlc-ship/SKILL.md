---
name: sdlc-ship
description: 'Build-half Step E of the gated SDLC — AI review, engineer review, then ship. Wire an advisory AI first-pass (CodeRabbit) on the PR/MR; record the human engineer review with the same human_approve discipline as the front gates (owner + 1 reviewer, escalating to domain owners on high risk / contract / auth / payments — the Step D routing); and on merge, record the ship in the epic build-log and update the story state so the epic → story → task → PR chain is traceable. Never auto-advances — the human owns the merge. Use when the user says "ship this task", "record the engineer review", or "wire the AI review".'
---

# SDLC — Review & Ship (build-half Step E)

**Goal:** Take a task PR/MR that has passed the **check gates** (Step C) through two sets of eyes and
out to production: an **AI first-pass** (advisory) and a **human engineer review** (the authority),
then **ship** — merge, record the ship, and update the story state. This is the last build-half step
(build plan §E). It is a **human gate**, the same `human_approve` discipline as the front states:
**nothing auto-advances**; the engineer owns the merge.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo (the source of
  truth: it holds the story and the build ledger).
- Code repos are separate git repos under `{project-root}/demo-repos/<repo>/`.
- The build ledger is `{project-root}/epics/<epic>/.sdlc/build-log.json` (append-only).
- The engineer-review rule reuses `sdlc-review-gate`: base = at least one `owner` AND one distinct
  `reviewer`; **escalated** (the PR's Impact & Risk is `high`, or it touches contract/auth/payments) =
  base PLUS one `domain-owner` per touched domain — the same routing `sdlc-pr-template`'s
  `risk-route.sh` prints.
- AI review wiring: `templates/.coderabbit.yaml` → `<repo>/.coderabbit.yaml`.

## Inputs

- `epic` / `story` / `task` / `repo` — the PR under review (the task branch `feat/<story>-<task>-…`).
- `action` — `ai-review` | `approve` | `ship` (default `ai-review`).
- For `approve`: the reviewer `name` and `role` (`owner` | `reviewer` | `domain-owner`), and for a
  domain owner the `domain`.

## On Activation

### Step 1 — `ai-review` (advisory first pass)
Ensure the AI reviewer is wired: copy `templates/.coderabbit.yaml` to `<repo>/.coderabbit.yaml` (commit
on the default branch if missing). CodeRabbit reviews each PR automatically and posts comments — it is
a **second set of eyes, never the authority**: it cannot approve or merge. Where CodeRabbit can't run
(no remote), run an equivalent AI first-pass by hand and capture its notes. Record that the AI review
ran; surface its findings to the engineer. Do **not** treat AI approval as a gate.

### Step 2 — `approve` (the engineer review — the human gate)
A human engineer reads the diff **against the spec** (`specs/<story>/`) and the acceptance criteria,
and records an approval. Determine the rule from the PR's Impact & Risk block (run
`../sdlc-pr-template/templates/checks/risk-route.sh` on the PR body): base, or escalated to a
domain-owner per touched domain. Record each approval; re-evaluate whether the rule is satisfied.
Recording an approval does **not** ship — shipping is a separate, explicit step. Front-half discipline:
the gate talks only through files; refuse to treat AI review as a human approval.

### Step 3 — `ship` (merge + record + update state)
Ship **iff ALL hold**: the check gates pass (Step C), the AI review has run (advisory), and the
engineer-review rule is satisfied (Step 2). Then:
- **Merge** the task branch into the repo's default branch (the human performs/authorises the merge).
- **Record the ship** — append to `epics/<epic>/.sdlc/build-log.json`:
  ```json
  { "story": "<story>", "task": "<task>", "repo": "<repo>", "branch": "feat/<story>-<task>-…",
    "pr": "<url|#>", "mergeCommit": "<sha>", "gates": ["spec-link","contract-check","build-test-lint"],
    "ai_review": "coderabbit (advisory)", "engineer_review": [{"approver":"<name>","role":"<role>","domain":"<opt>"}],
    "risk": "<low|medium|high>", "shippedAt": "<YYYY-MM-DD>" }
  ```
- **Update the story state** — when **every** task in `specs/<story>/tasks.md` has a ship record, set
  the story frontmatter `status: shipped`; otherwise `status: in-build`. The chain
  **epic → story → task → PR → mergeCommit** is now traceable end to end.

### Step 4 — Stop
Report what shipped and the story's state. Do not advance anything else; the front-half `state.json`
stays as it was (`ready-for-build`). The build half is recorded in `build-log.json` + the story status.

## Hard rules (build plan §E, Cross-cutting)

- **AI review is advisory, never the authority.** Only a human engineer approval counts toward the gate.
- **High risk routes to domain owners** — the same escalation as `sdlc-review-gate` / `risk-route.sh`.
- **Ship only after gates + engineer review.** No gate skipped; the human owns the merge.
- **Nothing auto-advances.** Step E records human decisions in files; it never machine-advances.

## Reference
- The build ledger + story-state rules: `references/ship-and-record.md`.
- The escalation reused: `../sdlc-review-gate/SKILL.md`; the routing helper: `../sdlc-pr-template/`.
- The gates that must pass first: `../sdlc-checks/references/check-gates.md`.
