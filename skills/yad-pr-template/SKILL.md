---
name: yad-pr-template
description: 'Build-half Step D of the gated SDLC. Detect a code repo''s platform and commit the matching PR/MR template — .github/pull_request_template.md (GitHub) or .gitlab/merge_request_templates/Default.md (GitLab). The template carries an Impact & Risk block; a high risk level (or a touched contract/auth/payments surface) routes the review to domain owners, reusing yad-review-gate''s escalation. Includes risk-route.sh to print the required reviewers from a PR body. Never auto-advances. Use when the user says "add the PR template" or "set up the MR template" for a repo.'
---

# SDLC — PR/MR Template (build-half Step D)

**Goal:** Commit the platform-correct PR/MR template into a code repo so every PR/MR carries an
**Impact & Risk** block and a checklist tied to the check gates. A **high** risk level (or a touched
contract/auth/payments surface) **routes the review to domain owners** — the same escalation
`yad-review-gate` applies on the front-half gates (owner + 1 reviewer, plus one domain-owner per
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
  - **Hub variants** (`repo: hub`) — front-half artifact-review PR/MR bodies:
    `templates/hub/github/pull_request_template.md` → `{project-root}/.github/pull_request_template.md`;
    `templates/hub/gitlab/merge_request_templates/Default.md` →
    `{project-root}/.gitlab/merge_request_templates/Default.md`. The hub body carries no `Task:` trailer
    (hub PRs change artifacts, not code); its routing helper is `yad-hub-bridge`'s `hub-route.sh`.
- The Impact & Risk block reuses the conventions of earlier steps: the `Task: <story>-<task>` trailer
  (`yad-implement`), the contract surface (`yad-architecture` / contract-check), and the
  domain-owner escalation (`yad-review-gate`).
- **PR/MR title.** One atomic task = one branch = one PR/MR, so the title **defaults to that task's
  commit subject** and follows the same Conventional Commits style — `<type>: <lowercase imperative
  description, no trailing period>`, proper nouns/acronyms keep their case (`config.yaml`
  `build.pr_title_style`; see `CONTRIBUTING.md`). Because PRs are squash-merged, the title becomes the
  merge commit subject — so it must be the clean, lowercase-after-the-type form, not `Fix: ...` or a
  trailing period.

## Inputs

- `repo`   — the code repo to add the template to (one of an epic's repos), or `hub` for the product hub.
- `action` — `wire` (commit the matching template + helper) | `route` (print required reviewers from a
  PR body). Default `wire`.
- `body`   — for `route`: a file holding the PR/MR description to evaluate.

## On Activation

### Step 1 — Resolve the repo and detect the platform
Map `repo` → `{project-root}/demo-repos/<repo>/` (or the registry `path`). Detect the platform: a GitHub
remote or `.github/` → GitHub; a GitLab remote or `.gitlab/` → GitLab. If ambiguous, ask. For
`repo: hub`, the target is `{project-root}` itself and the platform comes from `.sdlc/hub.json`.

### Step 2 — `wire` (drop only the matching template)
Copy from this skill's `templates/`:
- GitHub → `templates/github/pull_request_template.md` to `<repo>/.github/pull_request_template.md`.
- GitLab → `templates/gitlab/merge_request_templates/Default.md` to
  `<repo>/.gitlab/merge_request_templates/Default.md`.
- **`repo: hub`** → use the `templates/hub/<platform>/…` variants, installed into `{project-root}`'s own
  `.github/`/`.gitlab/`. The hub's routing helper (`hub-route.sh`) is installed by `yad-hub-bridge`.
Drop **only the matching** template (drop both only if the repo genuinely uses both). For code repos also
install `templates/checks/risk-route.sh` to `<repo>/checks/` (`chmod +x`). If the target already has a
non-SDLC PR/MR template, do not clobber it — back it up / ask. Commit the template on the repo's default
branch (shared infrastructure, not a task diff).

### Step 3 — `route` (show who must review)
Run `bash checks/risk-route.sh <body>` to parse the PR description's Impact & Risk block and print the
required reviewers:
- **low | medium** risk → base rule: owner + 1 reviewer.
- **high** risk (or a contract/auth/payments surface touched) → base rule **plus** one domain-owner
  approval per touched domain — identical to `yad-review-gate`'s escalation. The actual approvals are
  recorded by the engineer review (Step E), via `yad-review-gate`.

When the PR/MR is actually opened with `yad open-pr`, these reviewers are **requested automatically**
from the repo-scoped roster (everyone with `reviewer`/`domain-owner` for the repo, minus the committer),
and the **committer is set as the assignee**. `risk-route.sh` remains the advisory printout of who the
gate will require.

### Step 4 — Stop (no auto-advance)
Report what was committed (or the routing result). The template and routing are advisory inputs to the
human review (Step E); they do not approve or merge. Do not touch the epic's `.sdlc/` state.

## Hard rules (build plan §D, Cross-cutting)

- **Drop only the matching template** for the detected platform.
- **High risk routes to domain owners** — the same escalation as the gate; never a separate rule.
- **Nothing auto-advances.** The template sets up review; the human owns the merge.

## Reference
- The Impact & Risk block, the risk levels, and the routing rule: `references/risk-routing.md`.
- The escalation this reuses: `../yad-review-gate/SKILL.md` and its `references/gating.md`.
- The check gates the checklist references: `../yad-checks/references/check-gates.md`.
