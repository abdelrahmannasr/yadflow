---
name: yad-open-pr
description: 'Build-half helper of the gated SDLC. Open a code-repo task PR/MR from the committed platform template — detect GitHub/GitLab, push the current task branch, and create the PR/MR with the template body prefilled (Summary / Story-task / Impact & Risk) and the title defaulting to the commit subject. Auto-assigns from the hub roster: assignee = the committer, reviewers = the repo''s reviewers + domain-owners. High risk / contract surface routes to domain owners (risk-route.sh). Drives the `yad open-pr` CLI; never merges. Use when the user says "open the PR", "open the MR", or "raise the merge request".'
---

# SDLC — Open Task PR/MR (build-half helper)

**Goal:** Open the PR/MR for the current task branch from the repo's committed PR/MR template
(installed by `yad-pr-template`, Step D), with the body prefilled and the right reviewers requested.
This is the standalone open-PR step; it **never merges** — the engineer review (`yad-engineer-review`,
Step E) owns the merge. Distinct from `yad gate open`, which opens a front-half artifact-review PR on
the product hub.

## Conventions

- Run **inside the code repo** under `{project-root}/demo-repos/<repo>/` (or pass `--repo <name>` to
  resolve it from `.sdlc/repos.json`). The branch must be the task branch, not the default branch.
- **Platform** is detected from the `origin` remote (or the registry / `--platform`).
- **Title** — defaults to the last commit subject (one atomic task = one branch = one PR/MR), so it
  follows the same Conventional-Commits style and passes the `pr-title` gate. Override with `--title`.
- **Body** — the committed template (`.github/pull_request_template.md` /
  `.gitlab/merge_request_templates/Default.md`) with `Task:`, `Risk level:`, `Contract surface
  touched:`, and `Domains` prefilled; the rest is left for the author. This satisfies the `pr-template`
  gate.
- **Stage-aware on the product hub** — `open-pr` mirrors the `--head` split the hub gates apply:
  - a **`review/EP-*/<artifact>`** branch is a front-half artifact-review PR → it **delegates to
    `yad gate open`** (artifact-review title `review: <artifact> (EP-<slug>)`, the hub artifact-review
    body, and the gate ledger bookkeeping all in one place). Any `--title`/`-m` is ignored here.
  - any **other hub branch** is a tooling/CI change → it uses the bundled **code-task** template
    (`## Summary` / `Risk level:` / `## Checklist`) instead of the hub's artifact-review
    `pull_request_template.md`, so the hub `pr-template` gate passes.
  In a code repo nothing changes — it reads the repo's own committed code-task template.
- **Base branch** — **resolved, never assumed.** In order: `--base` → the repo's `default_branch` in
  `.sdlc/repos.json` → (for a PR against the hub itself) `hub.json`'s `default_branch` → what the
  platform reports (`gh repo view --json defaultBranchRef` / `glab api projects/:id`) → local
  `origin/HEAD` → `main`. The same **configuration-outranks-the-remote** order `yad repo sync` and the
  contract-check gate already use (they stop at `origin/HEAD`; only this chain also asks the platform).
  The CLI prints which rung answered.
  **If the resolved base is not the platform's default branch it warns and still opens** — that is a
  legitimate stacked-PR / release-branch move, but it costs the AI first pass: CodeRabbit decides
  auto-review eligibility from the base at PR-**open** time, and retargeting afterwards does not undo
  the skip. Hardcoding `main` here is the same bug the check gates already refuse to make (see
  `../yad-checks/references/check-gates.md`).
- **Auto-assign** — from the hub roster scoped to this repo: assignee = the committer (resolved from
  the local git identity), reviewers = the repo's `reviewer`/`domain-owner` logins minus the committer.
  Degrades cleanly when there is no roster.
- **Routing** — `low`/`medium` → base rule (owner + 1 reviewer); `high` (or a touched
  contract/auth/payments surface) → plus one domain-owner per touched domain. `bash
  checks/risk-route.sh <body>` prints the required reviewers.

## Inputs

- `repo`           — target a registered repo by name (optional; else the current dir).
- `risk`           — `low|medium|high` (default `low`); prefilled into the body.
- `contractChange` — flag; marks the contract surface touched and triggers escalation.
- `base`           — override the PR/MR base (optional; defaults to the repo's own default branch —
  see **Base branch** above). Only pass it deliberately: a non-default base loses the AI first pass.
- `platform` / `title` — optional overrides.

## On Activation

### Step 1 — Confirm the branch and template
Confirm you are on the task branch (not the default branch) and that the PR/MR template is committed
(if not, run `yad-pr-template` first). The branch's commits should already carry the `Task:` trailer.

### Step 2 — Open the PR/MR
Run from the repo root:
```
yad open-pr [--repo <name>] [--risk <level>] [--contract-change] [--title "<subject>"]
```
The CLI pushes the branch (sets upstream, the user's own auth), fills the template, and creates the
PR/MR with the auto-assigned assignee + reviewers. It prints the base it resolved and where that came
from.

The non-default-base warning is **advisory — it does not block, and the PR/MR is already open by the
time you read it.** If the base was intended (a stacked PR, a release branch), carry on. If it was
not, do **not** just retarget the open PR — that leaves the AI first pass skipped. Close it, fix the
cause (the repo's `default_branch`, or drop the wrong `--base`), and re-run `yad open-pr` so the PR
is *created* against the right base.

### Step 3 — Route the review (if escalated)
On `high` risk or a contract touch, run `bash checks/risk-route.sh <pr-body>` to print the required
domain-owner reviewers — the same escalation `yad-engineer-review` enforces.

### Step 3b — Post the review trailer (optional, recommended)
Make the reviewer's job easy: generate the 60-sec briefing and post it to the new PR/MR so it greets
every reviewer in the UI (idempotent; safe to re-run after a push):
```bash
yad review trailer --repo <name> --pr <n> --body "<companion-generated briefing>"
```
The full fun-review flow (cards + grounded chat + engagement) is driven by the
[Review Companion](../yad-review-companion/SKILL.md) during `yad-engineer-review`. Non-blocking by
design — companion comments carry `<!-- yad:noblock -->`.

### Step 4 — Stop (no merge)
Report the PR/MR URL and the requested reviewers. The PR now runs the check gates (Step C); the human
engineer review and merge happen in `yad-engineer-review` (Step E).

## Hard rules

- **One task = one branch = one PR/MR.** Never open a PR from the default branch.
- **The base is the repo's default branch** unless you deliberately chose otherwise with `--base`.
  Never hardcode `main`, and never ignore the non-default-base warning silently.
- **Title follows the commit subject** — Conventional-Commits style, so the `pr-title` gate passes.
- **High risk routes to domain owners** — the same escalation as the gate; never a separate rule.
- **Opening a PR never merges.** The human owns the merge in Step E.

## Reference
- The PR/MR template + the Impact & Risk block + routing: `../yad-pr-template/references/risk-routing.md`.
- The gates the PR must pass: `../yad-checks/references/check-gates.md` (incl. `pr-title`, `pr-template`).
- Commit first: `../yad-commit/SKILL.md`; commit + open in one step: `../yad-ship/SKILL.md`.
- The engineer review + merge that follow: `../yad-engineer-review/SKILL.md`.
