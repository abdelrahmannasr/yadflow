---
name: sdlc-pr-template
description: 'Build-half Step D of the gated SDLC. Detect a code repo''s platform and commit the matching PR/MR template — .github/pull_request_template.md (GitHub) or .gitlab/merge_request_templates/Default.md (GitLab). The template carries an Impact & Risk block; a high risk level (or a touched contract/auth/payments surface) routes the review to domain owners, reusing sdlc-review-gate''s escalation. Includes risk-route.sh to print the required reviewers from a PR body. Never auto-advances. Use when the user says "add the PR template" or "set up the MR template" for a repo.'
---

# SDLC — PR/MR Template (build-half Step D)

**Goal:** Commit the platform-correct PR/MR template into a code repo so every PR/MR carries an
**Impact & Risk** block and a checklist tied to the check gates. A **high** risk level (or a touched
contract/auth/payments surface) **routes the review to domain owners** — the same escalation
`sdlc-review-gate` applies on the front-half gates (owner + 1 reviewer, plus one domain-owner per
touched domain). This step **never auto-advances**; it sets up the template and the routing helper.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo (holds the
  canonical templates under this skill).
- Code repos are separate git repos under `{project-root}/demo-repos/<repo>/`.
- Canonical sources live in this skill's `templates/`:
  - `templates/github/pull_request_template.md` → installs to `<repo>/.github/pull_request_template.md`
  - `templates/gitlab/merge_request_templates/Default.md` → installs to
    `<repo>/.gitlab/merge_request_templates/Default.md`
  - `templates/checks/risk-route.sh` → installs to `<repo>/checks/risk-route.sh` (advisory routing helper)
- The Impact & Risk block reuses the conventions of earlier steps: the `Task: <story>-<task>` trailer
  (`sdlc-implement`), the contract surface (`sdlc-author-architecture` / contract-check), and the
  domain-owner escalation (`sdlc-review-gate`).
- **PR/MR title.** One atomic task = one branch = one PR/MR, so the title **defaults to that task's
  commit subject** and follows the same Conventional Commits style — `<type>: <lowercase imperative
  description, no trailing period>`, proper nouns/acronyms keep their case (`config.yaml`
  `build.pr_title_style`; see `CONTRIBUTING.md`). Because PRs are squash-merged, the title becomes the
  merge commit subject — so it must be the clean, lowercase-after-the-type form, not `Fix: ...` or a
  trailing period.

## Inputs

- `repo`   — the code repo to add the template to (one of an epic's repos).
- `action` — `wire` (commit the matching template + helper) | `route` (print required reviewers from a
  PR body). Default `wire`.
- `body`   — for `route`: a file holding the PR/MR description to evaluate.

## On Activation

### Step 1 — Resolve the code repo and detect the platform
Map `repo` → `{project-root}/demo-repos/<repo>/`. Detect the platform: a GitHub remote or `.github/`
→ GitHub; a GitLab remote or `.gitlab/` → GitLab. If ambiguous, ask.

### Step 2 — `wire` (drop only the matching template)
Copy from this skill's `templates/`:
- GitHub → `templates/github/pull_request_template.md` to `<repo>/.github/pull_request_template.md`.
- GitLab → `templates/gitlab/merge_request_templates/Default.md` to
  `<repo>/.gitlab/merge_request_templates/Default.md`.
Drop **only the matching** template (drop both only if the repo genuinely uses both). Also install
`templates/checks/risk-route.sh` to `<repo>/checks/` (`chmod +x`). Commit the template on the repo's
default branch (shared infrastructure, not a task diff).

### Step 3 — `route` (show who must review)
Run `bash checks/risk-route.sh <body>` to parse the PR description's Impact & Risk block and print the
required reviewers:
- **low | medium** risk → base rule: owner + 1 reviewer.
- **high** risk (or a contract/auth/payments surface touched) → base rule **plus** one domain-owner
  approval per touched domain — identical to `sdlc-review-gate`'s escalation. The actual approvals are
  recorded by the engineer review (Step E), via `sdlc-review-gate`.

### Step 4 — Stop (no auto-advance)
Report what was committed (or the routing result). The template and routing are advisory inputs to the
human review (Step E); they do not approve or merge. Do not touch the epic's `.sdlc/` state.

## Hard rules (build plan §D, Cross-cutting)

- **Drop only the matching template** for the detected platform.
- **High risk routes to domain owners** — the same escalation as the gate; never a separate rule.
- **Nothing auto-advances.** The template sets up review; the human owns the merge.

## Reference
- The Impact & Risk block, the risk levels, and the routing rule: `references/risk-routing.md`.
- The escalation this reuses: `../sdlc-review-gate/SKILL.md` and its `references/gating.md`.
- The check gates the checklist references: `../sdlc-checks/references/check-gates.md`.
