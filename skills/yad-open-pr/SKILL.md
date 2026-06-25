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
- `base` / `platform` / `title` — optional overrides.

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
PR/MR with the auto-assigned assignee + reviewers.

### Step 3 — Route the review (if escalated)
On `high` risk or a contract touch, run `bash checks/risk-route.sh <pr-body>` to print the required
domain-owner reviewers — the same escalation `yad-engineer-review` enforces.

### Step 4 — Stop (no merge)
Report the PR/MR URL and the requested reviewers. The PR now runs the check gates (Step C); the human
engineer review and merge happen in `yad-engineer-review` (Step E).

## Hard rules

- **One task = one branch = one PR/MR.** Never open a PR from the default branch.
- **Title follows the commit subject** — Conventional-Commits style, so the `pr-title` gate passes.
- **High risk routes to domain owners** — the same escalation as the gate; never a separate rule.
- **Opening a PR never merges.** The human owns the merge in Step E.

## Reference
- The PR/MR template + the Impact & Risk block + routing: `../yad-pr-template/references/risk-routing.md`.
- The gates the PR must pass: `../yad-checks/references/check-gates.md` (incl. `pr-title`, `pr-template`).
- Commit first: `../yad-commit/SKILL.md`; commit + open in one step: `../yad-ship/SKILL.md`.
- The engineer review + merge that follow: `../yad-engineer-review/SKILL.md`.
