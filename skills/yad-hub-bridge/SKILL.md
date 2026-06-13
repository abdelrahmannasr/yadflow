---
name: yad-hub-bridge
description: 'The templated PR/MR bridge for the front-half review gate. When the product hub has a platform (.sdlc/hub.json), it opens a review PR/MR on the hub for an authored artifact (the optional analysis / epic / architecture+contract / ui-design / stories / test-cases), sets the required reviewers/labels from the routing rule, and provides the read-only gh/glab recipes that yad-review-gate uses to pull platform comments + approvals back into the file ledger. Can also wire event-driven sync on the hub: a CI workflow that runs `yad gate ci` whenever a reviewer approves / requests changes / a human merges, committing the ledger to the default branch. Local-user auth only — no stored tokens. The file ledger stays the source of truth; degrades to the file-only gate when there is no platform / no CLI. Use when the user says "open the review PR", "route the review", "wire the gate sync", or it is invoked by yad-review-gate open/sync.'
---

# SDLC — Hub Review Bridge (the templated PR/MR bridge)

**Goal:** Run the front-half review/comment/approval cycle through a **real PR/MR on the product hub**,
without changing the gate's predicate or making the file ledger optional. The bridge is an **alternate
input path** into `yad-review-gate`: it opens a review PR for an artifact, reviewers approve/comment on
the platform with **their own** `gh`/`glab` auth, and the gate's `sync` action (which calls this skill's
read recipes) maps that platform state into `approvals.json` / `comments.json` / `reviews/*.md`, then
runs the **unchanged** predicate. The file ledger remains the source of truth.

This skill owns the **branch/PR mechanics + the gh/glab recipes** (mirroring how `yad-pr-template`
keeps platform mechanics out of the gate). `yad-review-gate` *calls* it; it never advances a step.

## Conventions

- `{project-root}` is the **product hub**. Hub platform + reviewer roster live in `.sdlc/hub.json`
  (`config.yaml` `hub.config`; schema in `../yad-connect-repos/references/hub-config.md`).
- Per-step review-PR record: `epics/EP-<slug>/.sdlc/hub-prs.json` (`config.yaml` `hub.pr_ledger`) — a
  sibling ledger to `approvals.json`, so `state.json`'s locked step shape is untouched.
- The review-PR body is the hub template from `yad-pr-template` (`templates/hub/<platform>/…`).
- Branch per artifact: `review/EP-<slug>/<artifact-base>` (`config.yaml` `hub.artifact_branch`).
- **Local-user auth only; store no tokens.** Use the user's own `gh`/`glab`. If neither is installed/
  authenticated, STOP this path and tell the gate to fall back to file-only — never embed a credential.

## Inputs

- `epic`     — the `EP-<slug>` under review.
- `artifact` — the artifact file (`analysis.md` | `epic.md` | `architecture.md` | `ui-design.md` | `stories/` | `test-cases.md`).
- `action`   — `open` | `route` | `wire` (default `route`). (`sync`'s ledger writes live in
  `yad-review-gate`; this skill provides the read recipes `sync` calls — see `references/bridge.md`.)

## Preconditions (the bridge runs only when all hold)

`.sdlc/hub.json` exists with a non-null `platform`, `bridge_enabled: true`, `config.yaml` `hub.bridge:
true`, and `gh` (GitHub) / `glab` (GitLab) installed **and authenticated**. If any fails, report that the
gate proceeds **file-only** (no error) and stop.

## On Activation

### Step 1 — Resolve platform + routing
Read `.sdlc/hub.json` for the platform and roster, `epics/<epic>/epic.md` for `repos` + `owner`, and the
matching `review+approve` step's `risk_tags` from `.sdlc/state.json`. Compute the **required reviewers**
with `route` (below) — the same rule `yad-review-gate` enforces: base (owner + 1 reviewer); escalated
(`risk_tags` ∩ {contract,auth,payments}, or the stories step) adds a domain-owner per touched repo. Map
each required domain-owner to a platform `login` via the roster (a roster `name` equal to a repo's
`domain_owner` in `repos.json` is that repo's domain-owner).

### Step 2 — `open` (create the review PR/MR)
1. From the hub default branch, create `review/EP-<slug>/<artifact-base>` and ensure the artifact file
   (and, for architecture, `contract.md` + `.sdlc/contract-lock.json`) is committed on it. Push as the
   local user.
2. Open the PR/MR with `gh`/`glab` using the hub body template (`yad-pr-template` `templates/hub/…`),
   filled with the epic, artifact, gate step, owner, `epic.repos`, and the step's risk tags.
3. **Request the required reviewers** (their logins) and add a `domain:<repo>` label per touched repo so
   per-repo routing is legible on the PR.
4. Upsert a record into `epics/<epic>/.sdlc/hub-prs.json`:
   ```json
   { "step": "<review step id>", "artifact": "<artifact>", "platform": "github|gitlab",
     "number": <n>, "url": "<pr/mr url>", "branch": "review/EP-<slug>/<artifact-base>", "lastSyncedAt": null }
   ```
5. Report the PR/MR URL and the required reviewers. **Do not** record approvals or advance — reviewers
   act on the platform; `yad-review-gate action: sync` pulls it back.

### Step 3 — `route` (print required reviewers)
Compute and print the required reviewers as above. Use `templates/checks/hub-route.sh <body>` to parse a
PR/MR body's Impact & Risk block when given one; otherwise derive from `epic.repos` + the step's
`risk_tags`. Advisory only — it routes the human review, it does not approve.

### Step 4 — `wire` (event-driven sync on the hub)
Install the hub CI that turns platform actions — a review **approval**, a **change request**, a review
dismissal, or the human **merge** — into an automatic `yad gate ci` run that syncs the ledger and
commits it to the hub's default branch. No more waiting on a manual `yad gate sync`; the manual command
remains valid and is the fallback whenever CI cannot push.

1. Run `yad check --fix` (the wiring is manifest-driven, like `yad-checks`): with a platform +
   enabled bridge in `.sdlc/hub.json` it installs
   - GitHub → `.github/workflows/yad-gate-sync.yml` (from `templates/github/yad-gate-sync.yml`)
   - GitLab → `.gitlab/ci/yad-gate-sync.yml` (from `templates/gitlab/yad-gate-sync.gitlab-ci.yml`)
   - plus the hub-side **verified-commits** gate (`checks/verified-commits.sh` + its workflow/fragment,
     owned by `yad-checks`) so review PRs accept only signed commits from roster-known authors
2. **GitLab only — two one-time steps** (see the fragment's header for the exact recipes):
   - add `include: - local: '.gitlab/ci/yad-gate-sync.yml'` to the root `.gitlab-ci.yml`, or write
     `templates/gitlab/gitlab-ci.include-root.yml` as the root when none exists;
   - create the 15-minute pipeline **schedule** (variable `SDLC_GATE_SYNC=true`) and the masked
     `SDLC_GATE_TOKEN` project-access-token variable (`read_api` + `write_repository`). GitLab fires no
     pipeline on an approval alone, so the schedule is the path that picks approvals up (≤ ~15 min
     latency); MR events and the merge are near-immediate.
3. Commit the workflow to the hub. GitHub needs nothing else — the ephemeral `github.token` reads the
   PR and pushes the ledger. If the default branch is protected, see the workflow header for the
   bypass / PAT options; until then the run fails visibly and manual `yad gate sync` still works.

## Hard rules

- **Local-user auth only; store no tokens.** Reviewers use their own `gh`/`glab`.
- **The bridge is an input path, never the authority.** It opens PRs and reads state; the **file ledger
  is the source of truth** and the gate predicate (in `yad-review-gate`) is unchanged.
- **The bridge never approves on a reviewer's behalf.** Reviewers approve/merge with their own auth. The
  step advances when a human **merges** the approved, fully-resolved review PR (the merge is that human
  act) — `yad gate sync` records the approvals + resolution + merged state and advances; unresolved
  comments or a changed artifact hold it `in_review`. The mechanical sync is the `yad gate` CLI.
- **CI never approves and never merges.** The wired workflow only runs `gate ci` — the same sync +
  unchanged predicate — and commits the **ledger files only** to the default branch; the artifact lands
  on the default branch exclusively via the human merge. Front gates stay permanently human.
- **The CI tokens are the one documented bend of "no stored tokens".** GitHub uses the platform's own
  ephemeral `github.token` (nothing stored). GitLab requires a stored masked `SDLC_GATE_TOKEN`
  project access token because `CI_JOB_TOKEN` can neither read the approvals API nor push — say so
  when wiring, and scope it to `read_api` + `write_repository` only.
- **Degrade gracefully.** No platform / disabled bridge / no CLI → the gate runs file-only with no error.

## Reference
- PR-body→ledger mapping, the read-only gh/glab recipes, idempotent re-sync, contract re-lock handling:
  `references/bridge.md`.
- Roster schema, login→role resolution, unverified-login fallback, per-repo routing: `references/login-roster.md`.
- The gate this feeds (open hook + sync action + unchanged predicate): `../yad-review-gate/SKILL.md`, `../yad-review-gate/references/gating.md`.
- The hub PR/MR body template + the code-repo routing analogue: `../yad-pr-template/`.
