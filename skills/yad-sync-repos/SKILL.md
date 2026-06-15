---
name: yad-sync-repos
description: 'Brings every connected code repo up to date in one shot: switches each repo in .sdlc/repos.json to its registry default_branch and fast-forwards it to the latest from origin (local-user git, no stored tokens). A working-tree-only maintenance op — never a gate; it reads the registry but never writes it. A repo with uncommitted local changes is skipped and reported, never overwritten; a diverged branch is left for manual resolution (fast-forward only). After pulling, a repo''s cached code-context pack goes stale, so it points the human at `yad repo refresh`. Use when the user says "sync the repos", "switch all repos to the default branch", "pull latest on every repo", or "get the latest from the default branch".'
---

# SDLC — Sync Connected Repos (one command, every repo on its default branch)

**Goal:** Before front/build work starts, get every connected code repo onto its default branch at the
latest commit, so nobody implements on a stale or wrong branch. This is the deterministic counterpart to
the `sync-before-implementation` discipline: one command instead of N manual `git checkout && git pull`.

This is **setup/maintenance, not a gated state** — it never touches `.sdlc/state.json`, any epic's
approvals, or the contract lock. It reads the project-wide registry and only mutates each repo's working
tree (branch + fast-forward). It writes **nothing** back to the registry.

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- Registry: `{project-root}/.sdlc/repos.json` (project-wide; the same file `yad-connect-repos` writes).
  Each repo entry supplies `path` (local path, relative to `{project-root}` or absolute) and
  `default_branch` (the branch to land on).
- **Local-user auth only.** Fetch as the user running the command — their SSH key or git credential
  helper. Store no tokens. Works for GitHub and GitLab alike. If a fetch fails on auth, the repo is
  skipped (STOP and tell the user to authenticate); never embed a credential.
- The deterministic half is the **`yad repo sync` CLI command** — `yad repo sync` (all repos) or
  `yad repo sync <name>` (one). This skill drives that command and explains the result.

## Inputs

- `action` — `sync` (this skill's only action).
- `repo` — optional short name (the registry `name`, e.g. `backend`) to sync a single repo; omit for all.

## On Activation

Run `yad repo sync [<repo>]`. For each target repo it performs, in order:

### Step 1 — Locate and validate the repo
Resolve the local path from the registry. If the path is not a git repo (no readable `HEAD`), warn and
skip — there is nothing to switch.

### Step 2 — Skip a dirty working tree (never overwrite local work)
If `git status --porcelain` is non-empty, the repo has uncommitted changes: **skip it and warn**
(`<name> dirty → SKIPPED (commit/stash first)`). The skill never stashes, resets, or force-checks-out —
preserving local work is a hard rule.

### Step 3 — Determine the default branch
Use the registry `default_branch`. If absent, fall back to the remote's `origin/HEAD`, else `main`.

### Step 4 — Fetch the latest
If the repo has an `origin` remote: `git fetch origin <default_branch> --prune`. A local-only repo
(no remote) skips the fetch and just switches branch.

### Step 5 — Switch to the default branch
If not already on it, `git checkout <default_branch>` (git creates the tracking branch from `origin/`
when needed).

### Step 6 — Fast-forward only
`git merge --ff-only origin/<default_branch>`. If the branch has diverged (a real merge would be
required), **do not pull** — warn (`<name> diverged → not fast-forwarded`) and leave it for the human.
Never create a merge commit, rebase, or force.

### Step 7 — Report
Per repo: `switched to <branch>, pulled (ff)` / `already current` / `SKIPPED (...)`. Pulling moves HEAD,
so any repo whose `HEAD` now differs from its registry `syncedHead` has a **stale code-context pack** —
the command ends by pointing the human at `yad repo refresh` to repack (that is a separate human
decision; this skill never repacks or writes the registry).

## Hard rules

- **Dirty = skip.** Never stash, reset, or discard uncommitted changes.
- **Fast-forward only.** A diverged branch is reported and left alone — no merge/rebase/force.
- **Local-user auth; store no tokens.** Fetch as the user; an auth failure skips that repo.
- **Working-tree only; not a gate.** Never write `.sdlc/repos.json`, `.sdlc/state.json`, approvals, or
  the contract lock. Refreshing the cached pack is the separate, human-invoked `yad repo refresh`.

## Reference
- Registry schema + the HEAD-sha freshness rule this reports against: `../yad-connect-repos/references/repos-registry.md`.
- Connecting / refreshing repos and the code-context cache: `../yad-connect-repos/SKILL.md`.
