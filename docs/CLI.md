# The `yad` CLI — install, update, reconcile, drive the gates

The full command reference for the `yad` CLI. For the big-picture concepts see the
[README](../README.md); for a step-by-step walkthrough see [`WALKTHROUGH.md`](WALKTHROUGH.md) or the
[plain-language team guide](../TEAM-GUIDE.md).

The module ships a zero-dependency CLI, published to npm as
[`yadflow`](https://www.npmjs.com/package/yadflow). Run it with `npx` from your **product hub** repo —
no clone needed.

> **Platform support.** Linux and macOS are first-class — the test suite, the bash check gates, and
> the end-to-end harness all run on both in CI. The CLI shells out to `git` (and the bash gate
> scripts), so on **Windows use [WSL](https://learn.microsoft.com/windows/wsl/)**; native PowerShell
> is not yet supported. Requires **Node.js ≥ 18**.

## Commands

| Command | What it does |
|---------|--------------|
| `npx yadflow setup` | Guided first-run wizard — a short **profile interview** (solo/team, greenfield/brownfield, monorepo/separate) then the branched steps below. Pre-answer for CI/scripts with `--solo`/`--team <n>`, `--greenfield`/`--brownfield`, `--monorepo`/`--separate`, `--tools`. |
| `yad next [<epic>]` | **Where am I / what next.** With no epic: project-wide orientation — the one next action (run setup, start an epic, or the single active epic's step). With an epic: that epic's exact next action (a skill to invoke or a `yad` command to run). Once the epic is `ready-for-build`, it reads each story's `build-state` and prints the next **build sub-step per repo** (`spec → tasks → implement → checks → engineer-review`) plus the remaining chain and the automation dial — so the build half is guided too, not just hinted at. `yad next <epic> --check <step>` exits non-zero when a step is run out of order (the precondition guard); `yad next --all` lists every epic's next action. |
| `npx yadflow check` | Read-only report: what is **missing** / **outdated** (drifted) / **stale** (code-context) / **legacy** (pre-2.0 `sdlc-*` names) / **removed** (a skill dropped in a later release that still lingers in the install) vs the bundled manifest. |
| `npx yadflow check --fix` | Reconcile: fill what is missing **and** update what changed — touches nothing already correct. |
| `npx yadflow update` | Apply drift only (alias for `check --fix --scope=changed`). Also migrates a pre-2.0 install in place: `sdlc-*` skill copies and marker-owned `sdlc-*.yml` CI files are replaced by their `yad-*` names (a same-named file *you* authored is never touched), **and** purges any skill removed in a later release that a prior install left behind. |
| `npx yadflow update --push` | Everything `update` does, **then commits each repo's applied changes and pushes them straight to the default branch** of the hub and every connected repo — one `chore(yad-update): sync SDLC install to yadflow vX.Y.Z` commit per repo, so a version upgrade "just lands" instead of leaving dirty trees to hand-commit across N repos. Stages an **explicit per-repo allowlist** (never `git add -A`); commits **only on each repo's default branch** (a repo on a feature branch is **skipped with a warning**, never disrupted; `--allow-branch` overrides). No PR/MR — so the `pull_request`/`merge_request` gate suite never fires; the push-on-default-branch **`yad-update-guard`** workflow/fragment runs **only** `verified-commits` + `commit-message` over it (deliberately **no** `[skip ci]`). Prints an announce banner first — **announce the team & pause merges until it completes**. Also spelled `check --fix --push`. |
| `npx yadflow doctor [--json]` | Environment + state health: tools on PATH and platform auth, config files parse and point at real repos, every epic ledger loads. Exit 1 on any failure; `--json` for CI and bug reports. |
| `yad report [-m <text>]` | **Self issue reporter.** File a bug in the yadflow repo with **auto-scrubbed** diagnostics — only the yadflow/node/os version, tool present+authenticated booleans, the hub platform enum, the error code/hint, a path-scrubbed message, and the failing command + flag *names*. Never posts paths, hostnames, git URLs, repo names, logins, epic IDs, branch names, or flag values. Searches open issues first (dedupe), shows the exact payload, and asks before posting; files via an authenticated `gh`/`glab` or a prefilled `issues/new` URL. Also **offered automatically** after an unexpected failure (interactive only). `YAD_NO_REPORT=1` (or `SDLC_NONINTERACTIVE`) disables it. |
| `yad roster list` / `yad roster add <login>` | Manage the reviewer roster + per-repo roles **any time** (not just at setup). `add` upserts a member then walks each connected repo asking for their role; `grant`/`revoke <name> <repo> <role>` and `remove <login>` round it out. A `domain-owner` grant keeps `repos.json` `domain_owners` in sync. |
| `yad usage` | **Team-member usage & behavior report (for an EM/team-lead).** Reconstructs each roster member's audit trail — *authored / commented / approved / shipped*, in order — entirely from data **already in git** (the approval/comment/ship ledgers + git authorship), then renders it as a portable **HTML** report (also `--format json\|md`). Derived and **read-only**: it hooks no commands and writes no tracked state (rebuildable any time, like `yad-status`). Flags: `--out <path>` (default `./usage-report.html`), `--since <YYYY-MM-DD> --until <YYYY-MM-DD>` or `--all`, `--member <name>`, `--repos` (include connected-repo commits). Surfaces factual **workflow-hygiene** flags (e.g. a ship with no recorded engineer review, a dormant roster member) — never a judgmental score. Emits **no emails, commit messages, or comment bodies**. (Attributing git-authored artifacts needs a member's `email` in the roster; ledger events attribute by name regardless.) |
| `yad gate open <epic> <artifact>` | Open the front-half **review PR/MR** for an artifact and mark the step `in_review`. |
| `yad gate sync <epic> [artifact]` | Pull the PR/MR's reviews + comment threads into the file ledger; **auto-advance** the step when approvals are satisfied, all threads are resolved, and the PR is merged. |
| `yad gate comments <epic> [artifact]` | Fetch the unresolved review comments to address (then reply on the PR; reviewers resolve their threads). |
| `yad gate status <epic>` | Show each review step and its recorded approvals. |
| `yad gate ci [--branch <head>] [--pr <n>]` | The CI entry the hub workflow calls on review/merge events: derive the epic/artifact from the `review/EP-*` branch, run the same sync, and commit **only the ledger** to the hub default branch (sweep every open review PR when no `--branch`). |
| `yad commit --type <t> -m <subject>` | Commit by the SDLC convention — Conventional subject, `Task`/`Contract-Change`/`Co-Authored-By` trailers, atomic-file guard. |
| `yad open-pr [--repo <name>]` | Open a **task** PR/MR from the platform template (build half). **Stage-aware on the hub:** a `review/EP-*` branch opens the front-half artifact-review PR (delegates to `yad gate open`); any other hub branch uses the code-task template (so hub tooling PRs pass the `pr-template` gate). |
| `yad ship --type <t> -m <subject>` | Commit **and** open the task PR/MR in one step (`yad commit` then `yad open-pr`) — stage-aware, same as `open-pr`. |
| `yad checkpoint [--push]` | Commit the **machine-written back-half hub state** — `trust-log.json`, `build-log.json`, `build-state/<story>.json` — **plus any story `status:` flip** (`approved → in-build/shipped`) that now has a `build-log` ship, as one `chore(hub): sync back-half state — <epic>/<story> by @<login>` audit-trail commit (no `Task` trailer, no AI footer). The back-half analogue of `yad gate ci`: it stages **only** those ledgers + ship-backed story flips by an explicit allowlist (never a front-half gate file, so `ledger-guard` never trips) and commits **only on the default branch** (so the commit never enters a PR range where its `[skip ci]` would strand checks). Carrying the story flip is what keeps the story artifact from drifting from `build-log.json` — so no operator ever falls back to a raw `git push origin main` (#112). A **no-op** when nothing changed; `--push` lands it on `origin/<default>`; `--allow-branch` overrides the default-branch guard. The SDLC back half (`yad-run`, `yad-engineer-review`) calls it so teammates never have to hand-commit machine audit state. |
| `yad tidy up [<epic>] [--push]` | Fold a **shipped story's** finished `trust-log`/`build-log` **shards** back into the single folded ledger file, as one `chore(hub)` commit — the manual "pack it up" companion to the shard-then-fold storage (like `git gc` for its loose objects). Concurrent back-half writers each write their own shard file (so parallel stories of one epic never conflict), and readers union the folded file + loose shards; `tidy up` is the on-demand compaction. Default branch only; `--push` lands it on `origin/<default>`; a **no-op** when nothing is foldable. |
| `yad repo list` / `yad repo refresh [name]` | List connected repos as **fresh / stale**, and re-pack a stale one — staleness is now an explicit human decision, never an automatic skill side-effect. |
| `yad repo refresh [name] --push` | After the re-pack (and the AI regenerating the code-map), commit the tracked code-maps + `.sdlc/repos.json` as an audit-trail `chore(hub): sync code-context … [skip ci]` commit and push it straight to the hub's **default branch** (`--allow-branch` to override). The code-context analogue of `yad checkpoint`. |
| `yad repo sync [name]` | Switch every connected repo to its **default branch** and fast-forward it from origin (one or all). Dirty repos are skipped, never overwritten; fast-forward only. |
| `yad thread [<epic>]` | **Feature threads (Phase 6).** No arg: list every thread. With an epic: show its thread (genesis → changes → defects), the **resolved current-truth** map (which epic owns each artifact now), and any open hotfix debt. `--json` for tooling. Read-only. |
| `yad reconcile [check\|refresh\|wire]` | Sweep threads for **drift / orphans / open hotfix debt** and report which thread drifted and why (mirrors `yad docs sync`; advisory — the CI gates block at merge). |
| `npx yadflow --version` | Print the installed CLI version. |

Flags: `--dir <path>` targets a project other than the cwd; `--force` re-copies unchanged files (or
bypasses the commit atomic guard). Commit flags: `--type`, `-m/--message`, `--task`, `--ai
<claude\|copilot\|cursor\|coderabbit\|none>`, `--contract-change`, `--dry-run`. `open-pr` flags:
`--repo`, `--risk <low\|medium\|high>`, `--contract-change`. `ship` takes the union of the `commit`
and `open-pr` flags (it runs `open-pr` only if the commit lands).

## The PR-driven review gate

The front-half gate now rides the **PR/MR you open per step** (`yad gate open`). Reviewers approve and
comment on the platform; `yad gate sync` maps that state into the file ledger (`approvals.json`,
`comments.json`, `reviews/*.md`) — which stays the source of truth — and the step **auto-advances on
merge** once three things hold: the reviewer rule is satisfied (owner + 1 reviewer, plus a domain-owner
per touched repo on escalated steps), every comment thread is resolved, and the review PR/MR is merged.
The merge click is the human approval act, so front steps still never `machine_advance`. Approvals are
**revoked when the reviewed artifact actually changes** (re-hash), giving reviewers a fresh pass. With no
hub platform / no `gh`/`glab`, the gate degrades to file-only with no error.

**Solo mode.** A lone developer can't approve their own PR on GitHub, so an approval requirement would
deadlock them. Opt in (`yad setup --solo`, recorded as `solo: true` in `.sdlc/hub.json`) and the gate
**waives the approval requirement only** — the review PR/MR and its merge stay, so CI still runs on the
PR and the **merge** advances the step. Net: the gate passes on *merged + all threads resolved*. It's a
documented, reversible relaxation; `yad doctor` warns if branch protection still "requires approvals"
(which would block the solo dev's own merge).

**Event-driven sync.** Wire the hub once (`yad check --fix` installs `.github/workflows/yad-gate-sync.yml`,
or the GitLab fragment + schedule) and every **approval, change request, and merge** on a review PR/MR
triggers `yad gate ci` in the hub's own CI: the ledger updates land directly on the hub's default branch
— no manual `yad gate sync` needed (it stays valid as the fallback). CI never approves and never merges;
the human keeps the merge click. GitLab caveat: approvals are only picked up by the ~15-min scheduled
sweep (GitLab fires no pipeline on approval) — details in `skills/yad-hub-bridge/references/bridge.md`.
Concurrency caveat: on GitHub the workflow's `concurrency` group serializes runs repo-wide and every
sync re-reads the full platform state, so racing reviewer events lose nothing. Outside that group —
a manual `yad gate sync` racing CI, or GitLab pipelines — two simultaneous syncs serialize their
*commits* via the rebase retry but each works from the state it read at start, so the rarer of two
simultaneous advancements can be lost; the next event or scheduled sweep re-syncs and converges.

## What `setup` walks you through (a guided, branching interview)

Setup opens with a short **profile interview** — *solo or team (how many)? greenfield or brownfield?
monorepo or separate repos?* — and the answers (recorded in `.sdlc/hub.json` as `solo` + `profile`)
branch the rest so you only answer what your situation needs. Each step prints inline guidance (what it
does / why / what to enter / what skipping means), and the step count adapts.

0. **Profile** — the three questions above, plus "configure optional tools now?". Pre-answer for
   CI/scripts with `--solo`/`--team <n>`, `--greenfield`/`--brownfield`, `--monorepo`/`--separate`, `--tools`.
1. **Preflight** — confirm the hub is a git repo (offers `git init`); check `git`/`node`/`npx`.
2. **Install the module** — copy the `yad-*` skills into the IDE skill dirs you pick
   (`.claude/`, `.agents/`, `.zencoder/`, `.opencode/`) and register `_bmad/sdlc/`.
3. **Hub platform & roster** — detect GitHub/GitLab from the remote; record reviewers → `.sdlc/hub.json`.
   **Solo skips the roster** (you review by merging your own PR). Edit the roster any time with `yad roster`.
4. **Optional tools** — design (Figma/pencil), testing (Playwright/cypress/pytest), learning (DeepTutor).
   Configure now, or **defer with one prompt** → all recorded as `none` (connect later with the
   `yad-connect-*` skills; the MCPs/CLIs are confirmed there).
5. **Connect code repos** — register repos into `.sdlc/repos.json`. **Monorepo** connects one repo and
   skips domain-owner prompts; **greenfield** skips the Repomix pack (run `yad repo refresh` once it has code).
6. **Wire each repo** — CI gates and PR/MR template.
7. **AI review** — optionally write `.coderabbit.yaml`.
8. **Done** — stamp `.sdlc/cli-version.json` and print a **profile-tailored next step** (brownfield →
   `yad-backfill` first; everyone → `yad next` and your first epic via `yad-epic`).

The deterministic file work runs automatically; the AI-only steps are handed to the Claude Code skills
with a printed next-action. Re-run `… check --fix` any time the workflow updates — it never re-asks for
input you already gave; re-running `setup` carries your profile forward.

**Maintainers / no-CLI fallback:** the underlying copy is still a single script —
`bash skills/sdlc/install.sh` — which the CLI's install step is a port of. The **source** stays in
`skills/`, which a `bmad-method` update does not touch, so after any BMAD update just re-run the CLI
(`… check --fix`) or the script.

> **Releases are automated.** A `feat:`/`fix:` commit merged to `main` triggers
> [semantic-release](https://semantic-release.gitbook.io/): it computes the version from the
> [Conventional Commits](../CONTRIBUTING.md), publishes to npm with build provenance (tokenless OIDC),
> ships the `CHANGELOG.md` in the tarball, and cuts a GitHub release. No manual `npm publish`. See
> [`RELEASING.md`](../RELEASING.md).

## Troubleshooting (`yad doctor` + error codes)

When something is off, run `yad doctor` first — it checks the environment (git, gh/glab auth, node
version), the project state (`.sdlc/*.json` parse and point at real repos), and every epic ledger,
with a fix-it hint per finding. Failures carry stable, greppable codes, also printed by any failing
`yad` command:

| Code | Meaning | Fix |
|------|---------|-----|
| `YAD-ENV-001` | git is not installed or not on PATH | install git — every yad command needs it |
| `YAD-ENV-002` | platform CLI (gh/glab) missing or not authenticated | install it and authenticate — `gh auth login` (GitHub) or `glab auth login` (GitLab); the gate degrades to file-only without it |
| `YAD-ENV-003` | Node.js older than the supported range | install Node >= 18 |
| `YAD-STATE-001` | a ledger/config JSON file exists but does not parse | fix the file or restore from git — never delete a ledger blindly |
| `YAD-STATE-002` | a ledger/config file parses but has the wrong shape | fix the file or restore from git (the message names the field) |
| `YAD-STATE-003` | a registered repo path is missing or not a git repo | fix the path in `.sdlc/repos.json` or re-connect the repo |
| `YAD-CFG-001` | `hub.json` names an unknown platform | expected `github`, `gitlab`, or `null` — fix it or re-run `yad setup` |
| `YAD-CFG-002` | `design.json` names an unknown design tool | expected one of `config.yaml` `design.tools` (e.g. `figma`, `pencil`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-003` | `testing.json` names an unknown testing tool | expected one of `config.yaml` `testing.tools` (e.g. `playwright`, `cypress`, `pytest`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-004` | `learning.json` names an unknown learning tool | expected one of `config.yaml` `learning.tools` (e.g. `deeptutor`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-005` | `hub.json` sets a platform but is missing `git_url` (needed to scope auth + open PRs) | add `git_url` to `.sdlc/hub.json`, or re-run `yad setup` — it backfills it from the origin remote |

Filing a bug? The fastest path is **`yad report`** — it files the issue for you in the yadflow repo
with **auto-scrubbed** diagnostics (versions, tool present+authenticated booleans, the hub platform
enum, the error code/hint, a path-scrubbed message, and the failing command + flag *names* only). It
never posts absolute paths, hostnames, git URLs, repo names, roster logins/emails, epic IDs, branch
names, or flag values; it shows you the exact payload and asks before posting to the public repo, and
searches for duplicates first. After an unexpected failure the CLI also **offers** to run it for you —
set `YAD_NO_REPORT=1` to opt out. Prefer a hand-written issue? Attach `yad doctor --json` (names,
paths, and check results only — review and redact before posting).
