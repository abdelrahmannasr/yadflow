---
name: sdlc-hub-bridge
description: 'The templated PR/MR bridge for the front-half review gate. When the product hub has a platform (.sdlc/hub.json), it opens a review PR/MR on the hub for an authored artifact (the optional analysis / epic / architecture+contract / ui-design / stories), sets the required reviewers/labels from the routing rule, and provides the read-only gh/glab recipes that sdlc-review-gate uses to pull platform comments + approvals back into the file ledger. Local-user auth only — no stored tokens. The file ledger stays the source of truth; degrades to the file-only gate when there is no platform / no CLI. Use when the user says "open the review PR", "route the review", or it is invoked by sdlc-review-gate open/sync.'
---

# SDLC — Hub Review Bridge (the templated PR/MR bridge)

**Goal:** Run the front-half review/comment/approval cycle through a **real PR/MR on the product hub**,
without changing the gate's predicate or making the file ledger optional. The bridge is an **alternate
input path** into `sdlc-review-gate`: it opens a review PR for an artifact, reviewers approve/comment on
the platform with **their own** `gh`/`glab` auth, and the gate's `sync` action (which calls this skill's
read recipes) maps that platform state into `approvals.json` / `comments.json` / `reviews/*.md`, then
runs the **unchanged** predicate. The file ledger remains the source of truth.

This skill owns the **branch/PR mechanics + the gh/glab recipes** (mirroring how `sdlc-pr-template`
keeps platform mechanics out of the gate). `sdlc-review-gate` *calls* it; it never advances a step.

## Conventions

- `{project-root}` is the **product hub**. Hub platform + reviewer roster live in `.sdlc/hub.json`
  (`config.yaml` `hub.config`; schema in `../sdlc-connect-repos/references/hub-config.md`).
- Per-step review-PR record: `epics/EP-<slug>/.sdlc/hub-prs.json` (`config.yaml` `hub.pr_ledger`) — a
  sibling ledger to `approvals.json`, so `state.json`'s locked step shape is untouched.
- The review-PR body is the hub template from `sdlc-pr-template` (`templates/hub/<platform>/…`).
- Branch per artifact: `review/EP-<slug>/<artifact-base>` (`config.yaml` `hub.artifact_branch`).
- **Local-user auth only; store no tokens.** Use the user's own `gh`/`glab`. If neither is installed/
  authenticated, STOP this path and tell the gate to fall back to file-only — never embed a credential.

## Inputs

- `epic`     — the `EP-<slug>` under review.
- `artifact` — the artifact file (`analysis.md` | `epic.md` | `architecture.md` | `ui-design.md` | `stories/`).
- `action`   — `open` | `route` (default `route`). (`sync`'s ledger writes live in `sdlc-review-gate`;
  this skill provides the read recipes `sync` calls — see `references/bridge.md`.)

## Preconditions (the bridge runs only when all hold)

`.sdlc/hub.json` exists with a non-null `platform`, `bridge_enabled: true`, `config.yaml` `hub.bridge:
true`, and `gh` (GitHub) / `glab` (GitLab) installed **and authenticated**. If any fails, report that the
gate proceeds **file-only** (no error) and stop.

## On Activation

### Step 1 — Resolve platform + routing
Read `.sdlc/hub.json` for the platform and roster, `epics/<epic>/epic.md` for `repos` + `owner`, and the
matching `review+approve` step's `risk_tags` from `.sdlc/state.json`. Compute the **required reviewers**
with `route` (below) — the same rule `sdlc-review-gate` enforces: base (owner + 1 reviewer); escalated
(`risk_tags` ∩ {contract,auth,payments}, or the stories step) adds a domain-owner per touched repo. Map
each required domain-owner to a platform `login` via the roster (a roster `name` equal to a repo's
`domain_owner` in `repos.json` is that repo's domain-owner).

### Step 2 — `open` (create the review PR/MR)
1. From the hub default branch, create `review/EP-<slug>/<artifact-base>` and ensure the artifact file
   (and, for architecture, `contract.md` + `.sdlc/contract-lock.json`) is committed on it. Push as the
   local user.
2. Open the PR/MR with `gh`/`glab` using the hub body template (`sdlc-pr-template` `templates/hub/…`),
   filled with the epic, artifact, gate step, owner, `epic.repos`, and the step's risk tags.
3. **Request the required reviewers** (their logins) and add a `domain:<repo>` label per touched repo so
   per-repo routing is legible on the PR.
4. Upsert a record into `epics/<epic>/.sdlc/hub-prs.json`:
   ```json
   { "step": "<review step id>", "artifact": "<artifact>", "platform": "github|gitlab",
     "number": <n>, "url": "<pr/mr url>", "branch": "review/EP-<slug>/<artifact-base>", "lastSyncedAt": null }
   ```
5. Report the PR/MR URL and the required reviewers. **Do not** record approvals or advance — reviewers
   act on the platform; `sdlc-review-gate action: sync` pulls it back.

### Step 3 — `route` (print required reviewers)
Compute and print the required reviewers as above. Use `templates/checks/hub-route.sh <body>` to parse a
PR/MR body's Impact & Risk block when given one; otherwise derive from `epic.repos` + the step's
`risk_tags`. Advisory only — it routes the human review, it does not approve.

## Hard rules

- **Local-user auth only; store no tokens.** Reviewers use their own `gh`/`glab`.
- **The bridge is an input path, never the authority.** It opens PRs and reads state; the **file ledger
  is the source of truth** and the gate predicate (in `sdlc-review-gate`) is unchanged.
- **Never approve or merge.** Merging the review PR does not advance the step — `sdlc-review-gate
  advance` does. Do not wire branch protection that couples the merge to the gate.
- **Degrade gracefully.** No platform / disabled bridge / no CLI → the gate runs file-only with no error.

## Reference
- PR-body→ledger mapping, the read-only gh/glab recipes, idempotent re-sync, contract re-lock handling:
  `references/bridge.md`.
- Roster schema, login→role resolution, unverified-login fallback, per-repo routing: `references/login-roster.md`.
- The gate this feeds (open hook + sync action + unchanged predicate): `../sdlc-review-gate/SKILL.md`, `../sdlc-review-gate/references/gating.md`.
- The hub PR/MR body template + the code-repo routing analogue: `../sdlc-pr-template/`.
