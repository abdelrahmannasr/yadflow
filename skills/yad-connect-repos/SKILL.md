---
name: yad-connect-repos
description: 'Connects code repos to the product hub so the front/"brain" phases are code-aware. Registers N code repos (GitHub or GitLab, local-user auth, no stored tokens) into the project-wide .sdlc/repos.json, then caches an AI-readable picture of each — a compressed Repomix pack and a lightweight code-map (existing endpoints/events/data-models/modules), secret-scanned. Run at one-time setup or any time a new repo is added. Reusable, idempotent, refreshable; staleness is tracked by HEAD sha. `yad repo refresh --push` publishes the refreshed code-maps + registry to the hub default branch as a chore(hub): sync code-context [skip ci] audit commit. Use when the user says "connect a repo", "connect the code repos", "refresh the code context", "list connected repos", or "push the code-map refresh".'
---

# SDLC — Connect Code Repos (make the brain code-aware)

**Goal:** Give the front/"brain" phases (`yad-epic` → `-architecture` → `-ui` → `-stories`)
full context about what **already exists** in the code, so the AI does not author a contract, UI, or
stories that contradict or duplicate what is built. This skill **connects** code repos to the product
hub and caches an AI-readable picture of each. It is the product → code half of the 2-way link (the
code → product half is the existing `link.md` back-pointer each spec carries).

This is **setup/maintenance**, not a gated front state — it never touches `.sdlc/state.json` or any
epic's approvals. It only writes the project-wide registry and the per-repo context cache.

## Conventions

- `{project-root}` resolves from the project working directory (the **product hub**).
- The **product repo is the front-phase toolchain hub** (`config.yaml` `code_context`): Repomix (and
  Impeccable, later) are installed/run **here** and target the connected code repos **by path**. The
  code repos themselves need no install for this. (The build-half CI gates are the exception — they
  live inside each code repo; see `yad-checks`.)
- **Repomix is a true CLI subprocess** (Phase 0 / RESEARCH-NOTES §3): `npx repomix@latest [flags]` —
  NOT a slash-command. It secret-scans by default (Secretlint).
- Registry: `{project-root}/.sdlc/repos.json` (project-wide, shared across all epics — NOT per-epic).
- Per-repo cache: `{project-root}/.sdlc/code-context/<repo>/` holds `pack.md` + `code-map.md`.

## Inputs

- `action` — `connect` | `refresh` | `list` | `disconnect` | `detect-hub` | `roster` (default `connect`).
- `repo` — the repo's short name (the key used in stories' `repos:` tag, e.g. `backend`).
- `login`, `name`, `email`, `roles` — for `roster` (map login → name + commit email + the per-scope
  `roles` map, e.g. `roles: hub=owner,reviewer backend=domain-owner`). Validate the login against the
  hub (`gh api users/<login>` / `glab api users?username=`); a miss is flagged `unverified` (warn-only).
- `path` — local path to the code repo (relative to `{project-root}` or absolute). For local repos.
- `git_url` — optional remote (SSH or HTTPS; GitHub or GitLab). Used when the repo is not yet on disk.
- `domain_owners` — the engineer(s) who own this repo's domain (a repo may have several; drives per-repo
  review routing). Each name is also written into that person's `roles[<repo>]` map in `hub.json`.

## On Activation

### Step 1 — Resolve the repo and its auth (GitHub + GitLab, local user)
Determine where the code is:
- If `path` is given and is a git repo (`.git` present) → use it in place.
- Else if `git_url` is given → **clone it as the local user** into a working location
  (`{code_repos_root}/<repo>/` by `config.yaml` `build.code_repos_root`, or a path the user names):
  ```
  git clone <git_url> <dest>
  ```
  Authentication is **the local user's own** — SSH keys or the git credential helper already on this
  device. This works identically for **GitHub and GitLab** (and self-hosted instances); the skill
  **stores no tokens**. If `gh`/`glab` are installed and authenticated they may be used, but plain
  `git` over the user's credentials is the baseline. If the clone/fetch fails on auth, STOP and tell
  the user to authenticate (`gh auth login` / `glab auth login` / add an SSH key) — never embed a token.
- Detect the platform from the URL host: `github.com` → `github`, `gitlab.com`/self-hosted GitLab →
  `gitlab`; record it as `platform`. A local-only repo with no remote records `platform: null`.

### Step 2 — Pack the repo (Repomix, the full cached context layer)
From the code repo, run (flags from `config.yaml` `code_context.pack_flags`):
```
npx repomix@latest --compress --include-logs --style markdown -o {project-root}/.sdlc/code-context/<repo>/pack.md
```
`--compress` (Tree-sitter structural compression) keeps it small and signal-dense; `--include-logs`
adds recent git history; Secretlint secret-scans by default. **If a secret is reported, STOP and have
it redacted before any AI reads the pack.** Pack the whole repo, or the source boundary from the
project's constitution if one is defined. (If `npx repomix` is unavailable, degrade: hand-assemble the
same context — the repo's source tree + recent git log — and record `source: repomix-unavailable`.)

### Step 3 — Build the code-map (the lightweight index layer)
Feed the pack to the AI with the **"describe what exists, do not invent"** instruction
(`references/code-context.md`) and write `{project-root}/.sdlc/code-context/<repo>/code-map.md`: a small
index of **stack/conventions, entry points, public endpoints/APIs, events, data models/entities, and
module layout**. Mark anything unclear `<!-- unverified: ... -->`; never fill gaps with invented
behaviour. This is the cheap artifact every front phase loads by default (the full pack is read only
when a phase needs depth).

### Step 4 — Record the repo in the registry
Upsert the repo into `{project-root}/.sdlc/repos.json` (create the file if absent). Record the current
HEAD sha as `syncedHead` (this drives staleness):
```json
{
  "repos": [
    {
      "name": "<repo>",
      "path": "<path rel. to project-root>",
      "git_url": "<url or null>",
      "platform": "github|gitlab|null",
      "domain_owners": ["<owner>", "…"],
      "domain_owner": "<domain_owners[0] — legacy mirror>",
      "default_branch": "<branch>",
      "connectedAt": "<YYYY-MM-DD>",
      "lastSyncedAt": "<YYYY-MM-DD>",
      "syncedHead": "<git HEAD sha at pack time>",
      "contextPack": ".sdlc/code-context/<repo>/pack.md",
      "codeMap": ".sdlc/code-context/<repo>/code-map.md",
      "source": "repomix"
    }
  ]
}
```
`connect` is **idempotent** — re-running it for an existing repo refreshes its entry in place. Adding a
new repo later is the same `connect` action.

### Step 5 — Report
Report the connected repo, its `platform`, the pack + code-map paths, the secret-scan result, and that
the front phases will now load this repo's code-map. Nothing auto-advances; this is setup.

## Other actions

- **`refresh`** — re-run Steps 2–4 for an already-connected repo (after its code moves). Updates
  `syncedHead` + `lastSyncedAt`. Same machinery as `connect`. Once the AI has regenerated the
  `code-map.md` (Step 3), publish it to the product hub with **`yad repo refresh <repo> --push`**: it
  commits the tracked code-maps + `.sdlc/repos.json` (never the gitignored `pack.md`) as one
  audit-trail commit `chore(hub): sync code-context — <repos> by @<login> [skip ci]` and pushes it
  straight to the hub's **default branch** (add `--allow-branch` to commit on a non-default branch).
  This is the code-context analogue of `yad checkpoint` — human-owned machine state, no Task trailer,
  no Co-Authored-By.
- **`list`** — print every registry entry with a **fresh/stale** flag: compare each repo's current HEAD
  (`git -C <path> rev-parse HEAD`) to its `syncedHead`; differ ⇒ **stale** (suggest `refresh`).
- **`disconnect`** — remove the repo from the registry and delete its cache dir. Leaves the **code repo
  itself untouched**.

## Hub detection + reviewer roster (the front-half review bridge)

The hub is itself a git repo on a platform. These actions record that so the front-half review/comment/
approval cycle can run through a real PR/MR on the hub (`yad-review-gate` + `yad-hub-bridge`). They
write only `{project-root}/.sdlc/hub.json` (`config.yaml` `hub.config`) — never an epic's state/approvals.

- **`detect-hub`** — detect the hub's own platform and upsert `.sdlc/hub.json`. Run
  `git remote get-url origin` **on the hub** and read the host with the SAME logic Step 1 uses for code
  repos: `github.com` → `github`, GitLab host → `gitlab`, no remote → `platform: null`. Record
  `git_url`, `default_branch`, `detectedAt`, and `bridge_enabled: true` (preserve an existing roster).
  Auth is the local user's own `gh`/`glab`/git; **store no tokens**. Idempotent — safe to re-run.
- **`roster`** — set one roster entry mapping a platform `login` → SDLC `name` + `email` + a per-scope
  `roles` map (`roles: { hub: ["owner","reviewer"], <repo>: ["domain-owner", …] }`). Upsert by `login`;
  a person may hold several roles across several scopes, and a repo several people per role. Validate the
  `login` against the hub (warn-only; flag `unverified` on a miss). `domain-owner` is written into
  `roles[<repo>]` (and still **derived** as a fallback when a roster `name` equals a repo's
  `domain_owner`/`domain_owners` in `repos.json` — see `references/hub-config.md`). An unmapped login
  degrades to a plain `reviewer`, never auto-promoted to owner/domain-owner.
  **The deterministic half is the `yad roster` CLI command** — runnable any time, not just at setup:
  `yad roster list`; `yad roster add <login>` (upsert, then a repo-driven walk that asks for each
  connected repo's role); `yad roster grant|revoke <name> <repo> <role>`; `yad roster remove <login>`.
  A `domain-owner` grant/revoke keeps `repos.json` `domain_owners` in sync so the gate never drifts.

If the hub has no remote (`platform: null`) or the bridge is disabled, the front-half gate runs
file-only with no error — the bridge is purely additive.

## Live on-demand (the third context layer)
The cached pack + map are the default. When a front phase needs an **area** not in the map, it may
re-run Repomix **live**, scoped to that area:
```bash
npx repomix@latest --compress --include "<area globs>" --style markdown -o -
```
Same CLI, invoked ad hoc — no registry write. A **stale repo** (HEAD ≠ `syncedHead`) is different: the
phase **flags it and stops**, pointing the human at `yad repo refresh <repo>` (or `yad check --fix`) —
it does not silently re-pack. Refreshing the cache is a human decision. Documented in
`references/code-context.md`.

## Hard rules

- **Local-user auth only; store no tokens.** Clone/fetch as the user running the command; never embed
  credentials in the registry. Works for GitHub and GitLab alike.
- **Secret-scan before any AI sees the code.** Secretlint runs by default; a hit STOPS the pack.
- **Describe what exists; never invent.** The code-map records built behaviour, not a design.
- **Setup, not a gate.** Never touch `.sdlc/state.json`, approvals, or the contract lock from here.
- **Idempotent + refreshable.** `connect`/`refresh` are safe to re-run; staleness is HEAD-sha based.

## Reference
- Registry schema + freshness rule: `references/repos-registry.md`.
- Hub config + reviewer roster (the review bridge): `references/hub-config.md`.
- Repomix command, secret-scan, degrade path, the code-map prompt, and live on-demand:
  `references/code-context.md`.
- The repomix discipline this reuses (one-feature-at-a-time variant): `../yad-backfill/references/backfill.md`.
- Repos convention + per-repo review routing: `../yad-stories/references/story-schema.md`.
