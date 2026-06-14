---
name: yad-ship
description: 'Build-half helper of the gated SDLC — commit AND open the task PR/MR in one step. A thin orchestration over yad-commit then yad-open-pr: commit the staged atomic change by the conventions (Conventional-Commits subject, Task → Contract-Change → Co-Authored-By trailers, --ai footer, ≤3-file atomic guard), then push the branch and open the PR/MR from the committed template with the roster auto-assigned. The PR step runs ONLY if the commit lands (a failed commit, tripped guard, or --dry-run stops before pushing). Drives the `yad ship` CLI; never merges. Use when the user says "ship this task", "commit and open the PR", or "commit and raise the MR". (For the engineer review + merge, use yad-engineer-review.)'
---

# SDLC — Commit + Open PR/MR (build-half helper)

**Goal:** Do the two routine build-half hand-actions for ONE atomic task in a single step — **commit by
convention, then open the task PR/MR** — so an implemented diff becomes a reviewable PR/MR without two
separate invocations. It is a thin wrapper over `yad-commit` and `yad-open-pr`; it holds no logic of
its own and **never merges**. The engineer review + merge are Step E (`yad-engineer-review`).

## Conventions

- Run **inside the code repo** under `{project-root}/demo-repos/<repo>/` (or `--repo <name>`), on the
  task branch with the atomic change **already staged** (`git add`).
- Inherits every convention of the two steps it wraps:
  - Commit: subject `<type>: <lowercase imperative, no trailing period>`, fixed trailer order
    `Task → Contract-Change → Co-Authored-By`, the `--ai` co-author footer, the ≤3-file atomic guard
    (`../yad-commit/SKILL.md`).
  - PR/MR: pushed branch, the committed template prefilled, title defaulting to the commit subject,
    roster auto-assign, risk routing (`../yad-open-pr/SKILL.md`).
- **Order matters:** the PR/MR is opened **only if the commit lands**. A failed commit, a tripped
  atomic guard, or `--dry-run` stops the step before anything is pushed.

## Inputs

- `type` / `message` — the commit type + subject (required), `--type <t> -m "<subject>"`.
- `ai`              — co-author footer: `claude|copilot|cursor|coderabbit|none` (default `none`).
- `task`           — Task trailer (optional; derived from the branch when omitted).
- `contractChange` — flag; marks the contract surface touched (commit trailer + PR escalation).
- `repo` / `risk` / `base` / `platform` / `title` — PR/MR options (see `yad-open-pr`).

## On Activation

### Step 1 — Confirm the staged atomic change
Confirm you are on the task branch (not the default branch) and the atomic change is staged within its
file boundary. Preview the commit with `--dry-run` if unsure.

### Step 2 — Commit + open in one step
Run from the repo root:
```
yad ship --type <type> -m "<subject>" [--ai <id>] [--task <id>] [--contract-change] \
         [--repo <name>] [--risk <level>] [--title "<subject>"]
```
The CLI runs `yad commit` and, only if it succeeds, `yad open-pr` — committing the change, pushing the
branch, and opening the PR/MR with the template prefilled and reviewers auto-assigned.

### Step 3 — Route + stop (no merge)
On `high` risk or a contract touch, run `bash checks/risk-route.sh <pr-body>` for the required
domain-owner reviewers. Report the commit + the PR/MR URL. The PR now runs the check gates (Step C);
the engineer review and merge are Step E (`yad-engineer-review`).

## Hard rules

- **One staged atomic task = one commit = one PR/MR.** Never bundle; never open from the default branch.
- **No PR without a landed commit.** A failed/`--dry-run` commit stops the step before pushing.
- **High risk routes to domain owners** — the same escalation as the gate.
- **Shipping here never merges.** The human owns the merge in `yad-engineer-review`.

## Reference
- The two steps this wraps: `../yad-commit/SKILL.md` and `../yad-open-pr/SKILL.md`.
- The gates the PR must pass: `../yad-checks/references/check-gates.md`.
- The engineer review + merge that follow: `../yad-engineer-review/SKILL.md`.
