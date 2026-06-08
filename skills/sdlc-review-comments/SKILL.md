---
name: sdlc-review-comments
description: 'Installs platform-matched PR/MR review-comment scaffolds into a repo so reviewers leave structured, attributable feedback that maps cleanly into the SDLC file ledger. Works for code repos and the product hub. GitHub has no repo-level multi-comment template, so the scaffold is a committed REVIEW_COMMENTS.md reviewers copy from (saved as Saved Replies on GitHub / comment templates on GitLab). Each canned comment carries an attributable `**<name> (<role>)**` header that matches the `## <name> (<role>)` headings sdlc-review-gate writes. Use when the user says "add the comment templates" or "set up review comments" for a repo.'
---

# SDLC — Review Comment Templates

**Goal:** Give reviewers a consistent, **attributable** set of canned PR/MR comments so review feedback
reads the same across repos and **maps cleanly into the file ledger** the gate keeps. The headers match
the `## <name> (<role>)` shape `sdlc-review-gate` writes into `reviews/<artifact>--<date>--comments.md`
and the per-commenter record in `comments.json`, so a synced or copy-pasted comment lands without
reformatting.

## Platform reality (why this is a committed doc, not a config file)

Neither GitHub nor GitLab has a **repo-level** multi-comment template convention: GitHub *Saved Replies*
are per-account and GitLab *comment templates* are per-user/group, both set in the UI — there is no
`.github/comment_templates/` or `.gitlab/comment_templates/` the repo can ship. The pragmatic mechanism
on **both** is a single committed doc reviewers copy from (and optionally paste once into their personal
Saved Replies / comment templates). This skill ships that doc.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo (holds the
  canonical templates under this skill).
- Canonical sources live in this skill's `templates/`:
  - `templates/github/REVIEW_COMMENTS.md` → installs to `<repo>/.github/REVIEW_COMMENTS.md`
  - `templates/gitlab/REVIEW_COMMENTS.md` → installs to `<repo>/.gitlab/REVIEW_COMMENTS.md`
- The two variants are identical except a footer line (GitHub: "save these as Saved Replies"; GitLab:
  "save these as comment templates").

## Inputs

- `repo`   — the repo to add the scaffold to (one of an epic's repos), or `hub` for the product hub.
- `action` — `wire` (install the matching scaffold). Default `wire`.

## On Activation

### Step 1 — Resolve the repo and detect the platform
Map `repo` → its path (`{project-root}/demo-repos/<repo>/` or the registry `path`); for `repo: hub` the
target is `{project-root}` and the platform comes from `.sdlc/hub.json`. Detect the platform: a GitHub
remote or `.github/` → GitHub; a GitLab remote or `.gitlab/` → GitLab. If ambiguous, ask.

### Step 2 — `wire` (drop only the matching scaffold)
Copy the matching `templates/<platform>/REVIEW_COMMENTS.md` into the repo's `.github/` or `.gitlab/`.
Do not clobber an existing non-SDLC file of the same name — back it up / ask. Commit on the repo's
default branch (shared infrastructure, not a task diff). Idempotent — re-running refreshes in place.

### Step 3 — Stop (no auto-advance)
Report what was committed. The scaffold is an aid to human review; it approves nothing and touches no
`.sdlc/` state.

## Hard rules

- **Drop only the matching scaffold** for the detected platform.
- **Attributable headers** — every canned comment keeps the `**<name> (<role>)**` form so the gate's
  ledger and the PR thread agree.
- **Nothing auto-advances.** Comments feed the human review and (via the bridge) `sdlc-review-gate`.

## Reference
- Comment conventions + the full scaffold contents: `references/comment-conventions.md`.
- The ledger headings these match: `../sdlc-review-gate/SKILL.md` (comment action) and `references/gating.md`.
- The review bridge that syncs platform comments into the ledger: `../sdlc-hub-bridge/SKILL.md`.
