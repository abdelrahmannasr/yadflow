# The `yad` CLI — install, update, reconcile, drive the gates

The full command reference for the `yad` CLI. For the big-picture concepts see the
[README](../README.md); for a step-by-step walkthrough see [`WALKTHROUGH.md`](WALKTHROUGH.md) or the
[plain-language team guide](../TEAM-GUIDE.md).

The module ships a zero-dependency CLI, published to npm as
[`yadflow`](https://www.npmjs.com/package/yadflow). Run it with `npx` from your **Product** repo —
no clone needed.

> **Platform support.** Linux and macOS are first-class — the test suite, the bash check gates, and
> the end-to-end harness all run on both in CI. The CLI shells out to `git` (and the bash gate
> scripts), so on **Windows use [WSL](https://learn.microsoft.com/windows/wsl/)**; native PowerShell
> is not yet supported. Requires **Node.js ≥ 18**.

## Commands

| Command | What it does |
|---------|--------------|
| `npx yadflow setup` | Guided first-run wizard — a short **profile interview** (solo/team, greenfield/brownfield, monorepo/separate) then the branched steps below. Pre-answer for CI/scripts with `--solo`/`--team <n>`, `--greenfield`/`--brownfield`, `--monorepo`/`--separate`, `--tools`. |
| `yad epic new <slug>` | **Start an epic — the engine writes its lifecycle.** Seeds `epics/EP-<slug>/.sdlc/state.json` with the step chain of a [lifecycle profile](#lifecycle-profiles-the-route-an-epic-takes), plus an empty `approvals.json`, an empty `comments.json` and the `reviews/` directory. `--type feature\|chore` (default `feature`) — a `change`, `defect` or `hotfix` threads off an epic that already exists, so its chain inherits that epic's approved steps and the `yad-change` skill seeds it instead. `--profile classic\|analysis-first\|chore\|spike` (default `classic`) — `chore` and `spike` are the [short lanes](#the-short-lanes), and neither carries an architecture gate, so neither may move the contract surface. The `discovery` front-zero has a fixed id and no `epic.md`, so `yad-discovery` stays its author. `--stub` mints a brownfield **anchor** instead: the same `classic` chain with every step `blocked`, the marker `kind: "stub"` and `currentStep: "backfill-pending"`, so a defect can thread off a feature that shipped before the Product existed (`yad-backfill promote` wakes it). A stub is always a `feature` and always `classic`; `--type` and `--profile` are refused with it. `--json` for a script — its `next` key names the skill to run now, with a `nextSkills` array beside it when the step is bound to a chain (the same rule `yad next --json` follows: the array appears only when there is more than one). It writes **no `epic.md`, no branch and no commit**: the epic document is prose you author with the skill the chain names next. **Refuses an epic that already has a `state.json`** — nothing here overwrites a ledger, and there is no flag for it. The skills that start an epic run this rather than writing a chain of their own; `yad-discovery` and `yad-change` still write one, because the engine deliberately seeds neither. |
| `yad next [<epic>]` | **Where am I / what next.** With no epic: project-wide orientation — the one next action (run setup, start an epic, or the single active epic's step). With an epic: that epic's exact next action (a skill to invoke or a `yad` command to run). Once the epic is `ready-for-build`, it reads each story's `build-state` and prints the next **build sub-step per repo** (`spec → tasks → implement → checks → engineer-review`) plus the remaining chain and the automation dial — so Build is guided too, not just hinted at. `yad next <epic> --check <step>` exits non-zero when a step is run out of order (the precondition guard); `yad next --all` lists every epic's next action. **`--json`** emits the same answer as a machine-readable action object instead of prose — for an agent or a CI job that would otherwise have to regex the coloured output. Exit codes are unchanged. |
| `yad skill list` / `yad skill bind <step> <skill>…` / `yad skill unbind <step>` | **Choose which skill runs which step.** The engine ships a default for every step; a project that wants its own records it in `.sdlc/skills.json`, and `yad next` names that one from then on. `list` shows every step a skill runs — Shape review gates are excluded, since `yad gate` drives those — what runs each one, and where that answer came from: `project` (you bound it), `engine` (the default) or `ignored` (your file has a line for that step and the line names no skill, so the default still runs). `--json` for a script. `bind` takes one skill or several — several run as a **chain**, in the order given, each seeing what the one before it produced, and the last output is the artifact; every extra skill is another model run, so the command says so. A **Shape review gate** is refused (nothing would ever invoke the binding); `engineer-review` is a Build step in its own right and **is** bindable. A step this release does not know is recorded with a warning, because your file wins. `unbind` drops the line and the step goes back to the engine's default. See [choosing the skill for a step](#choosing-the-skill-for-a-step). |
| `npx yadflow check` | Read-only report: what is **missing** / **outdated** (drifted) / **modified** (a managed file *you* edited — see [managed files](#managed-files-what-yad-owns-and-what-you-edited)) / **stale** (code-context) / **legacy** (pre-2.0 `sdlc-*` names) / **removed** (a skill dropped in a later release that still lingers in the install) vs the bundled manifest. |
| `npx yadflow check --fix` | Reconcile: fill what is missing **and** update what changed — touches nothing already correct, and never overwrites a managed file reported as `modified`. |
| `npx yadflow update` | Apply drift only (alias for `check --fix --scope=changed`). Also migrates a pre-2.0 install in place: `sdlc-*` skill copies and marker-owned `sdlc-*.yml` CI files are replaced by their `yad-*` names (a same-named file *you* authored is never touched), **and** purges any skill removed in a later release that a prior install left behind. A gate script or CI file a newer release **adds** to a repo's wiring is installed on every repo that is already wired (reported as `new`); a wired file you deleted on purpose stays deleted (the provenance record proves yad wrote it — on a repo wired before that record existed, 3.16.0, the first update re-adds such a file once; delete it again and it is recorded and stays gone), and a repo with none of its wiring is left for `yad check --fix`. A managed file you edited is reported and **left alone**; `--overwrite-local` replaces it after saving a `<file>.yad-orig` backup. |
| `npx yadflow update --push` | Everything `update` does, **then commits each repo's applied changes and pushes them straight to the default branch** of the Product and every connected repo — one `chore(yad-update): sync SDLC install to yadflow vX.Y.Z` commit per repo, so a version upgrade "just lands" instead of leaving dirty trees to hand-commit across N repos. Stages an **explicit per-repo allowlist** (never `git add -A`); commits **only on each repo's default branch** (a repo on a feature branch is **skipped with a warning**, never disrupted; `--allow-branch` overrides). No PR/MR — so the `pull_request`/`merge_request` gate suite never fires; the push-on-default-branch **`yad-update-guard`** workflow/fragment runs **only** `verified-commits` + `commit-message` over it (deliberately **no** `[skip ci]`). Prints an announce banner first — **announce the team & pause merges until it completes**. Also spelled `check --fix --push`. |
| `npx yadflow doctor [--json]` | Environment + state health: tools on PATH and platform auth, config files parse and point at real repos, every epic ledger loads, **each epic's `contract-lock.json` still matches its surface**, and **no completed review gate is left holding no approval (fail) or only stale ones (warn)** — solo mode waives the first, since approval is waived there by design. Exit 1 on any failure; `--json` for CI and bug reports. |
| `npx yadflow migrate [--apply] [--json]` | **Move this project's state files onto the shape this yadflow expects.** Prints a table of what *would* change and writes nothing until `--apply`, which copies every file it rewrites to `<file>.yad-orig` first. Safe to run twice — the second run reports there is nothing to do. A file newer than this engine, or one that does not parse, is reported and never touched (exit 1). In `verified` mode the CI-owned gate ledger is skipped and named: CI stamps it on its next sync. See [file shape](#file-shape-schemaversion). |
| `yad report [-m <text>]` | **Self issue reporter.** File a bug in the yadflow repo with **auto-scrubbed** diagnostics — only the yadflow/node/os version, tool present+authenticated booleans, the Product platform enum, the error code/hint, a path-scrubbed message, and the failing command + flag *names*. Never posts paths, hostnames, git URLs, repo names, logins, epic IDs, branch names, or flag values. Searches open issues first (dedupe), shows the exact payload, and asks before posting; files via an authenticated `gh`/`glab` or a prefilled `issues/new` URL. Also **offered automatically** after an unexpected failure (interactive only). `YAD_NO_REPORT=1` (or `SDLC_NONINTERACTIVE`) disables it. |
| `yad roster list` / `yad roster add <login>` | Manage the reviewer roster + per-repo roles **any time** (not just at setup). `add` upserts a member then walks each connected repo asking for their role; `grant`/`revoke <name> <repo> <role>` and `remove <login>` round it out. A `domain-owner` grant keeps `repos.json` `domain_owners` in sync. |
| `yad usage` | **Team-member usage & behavior report (for an EM/team-lead).** Reconstructs each roster member's audit trail — *authored / commented / approved / shipped*, in order — entirely from data **already in git** (the approval/comment/ship ledgers + git authorship), then renders it as a portable **HTML** report (also `--format json\|md`). Derived and **read-only**: it hooks no commands and writes no tracked state (rebuildable any time, like `yad-status`). Flags: `--out <path>` (default `./usage-report.html`), `--since <YYYY-MM-DD> --until <YYYY-MM-DD>` or `--all`, `--member <name>`, `--repos` (include connected-repo commits). Surfaces factual **workflow-hygiene** flags (e.g. a ship with no recorded engineer review, a dormant roster member) — never a judgmental score. Emits **no emails, commit messages, or comment bodies**. (Attributing git-authored artifacts needs a member's `email` in the roster; ledger events attribute by name regardless.) |
| `yad gate open <epic> <artifact>` | Open the Shape **review PR/MR** for an artifact and mark the step `in_review` (in verified mode CI owns the ledger, so it only opens the PR). The `review/<epic>/<artifact>` branch must already be **on origin** — it does not create or push one; `yad open-pr`, run from the branch, pushes it and then delegates here. For an epic's **first** gate, cut that branch from the authoring branch (`epic/…`, `change/…`) so the PR/MR carries the `.sdlc/` **seed**: no CI path can create a ledger, so `ledger-guard` exempts a new epic's ledger there — creation, not mutation (#162) — and it lands on the default branch at merge. |
| `yad gate sync <epic> [artifact] [--pr <n>]` | Pull the PR/MR's reviews + comment threads into the file ledger; **auto-advance** the step when approvals are satisfied, all threads are resolved, and the PR is merged. With no PR recorded in the ledger (the normal bridge case, where CI records it only at merge) it resolves the PR from the `review/<epic>/<artifact>` branch; `--pr <n>` names one outright and overrides a stale recorded pointer, after confirming the number really is that branch's PR. In **verified mode this stays advisory** — the writing recovery is `yad gate ci … --merged`. |
| `yad gate comments <epic> [artifact]` | Fetch the unresolved review comments to address (then reply on the PR; reviewers resolve their threads). |
| `yad gate status <epic>` | Show each review step and its recorded approvals. |
| `yad gate repair <epic>` | Close an authoring step left stranded behind a review gate that already passed (`YAD-STATE-005`). Writes only `state.json`. `--push` commits it to the default branch with a `chore(gate): repair…[skip ci]` audit-trail message (`--allow-branch` to override the default-branch guard, `--dry-run` to preview). |
| `yad gate ci [--branch <head>] [--pr <n>]` | The CI entry the Product workflow calls **at merge** (and from its scheduled reconcile — nothing fires pre-merge, where the platform PR/MR holds the review state): derive the epic/artifact from the `review/EP-*` branch, run the same sync, and commit **only the ledger** to the Product default branch. The wired jobs always name a branch: they discover merged reviews through the platform API and call `--branch <ref> --pr <n> --merged` per review. With no `--branch` it falls back to a local sweep of the review PRs *already recorded in the ledger* whose step is not yet `done` — it does no platform discovery of its own, so a review the ledger never saw is only reachable by naming it. **Idempotent down to the bytes:** the ledgers are written in a canonical order, so re-syncing an already-`done` step (what the 15-minute sweep does for a week after every merge) produces a byte-identical file and commits nothing. Before the #163 fix the re-sync re-appended each step's approvals at the tail, so a sweep over N merged reviews rotated `approvals.json` and committed the reorder on every pass — an unbounded commit loop (#163). |
| `yad commit --type <t> -m <subject>` | Commit by the SDLC convention — Conventional subject, `Task`/`Contract-Change`/`Co-Authored-By` trailers, atomic-file guard. |
| `yad open-pr [--repo <name>]` | Open a **task** PR/MR from the platform template (Build). **The base is resolved, never assumed:** `--base` → the repo's `default_branch` in `.sdlc/repos.json` → (for a Product PR) `hub.json`'s `default_branch` → the platform's own default (`gh repo view --json defaultBranchRef` / `glab api projects/:id`) → local `origin/HEAD` → `main` — the same configuration-outranks-the-remote order `yad repo sync` and the contract-check gate use. It prints which rung answered, and **warns (never blocks) when the base is not the platform default**: CodeRabbit decides auto-review eligibility from the base at PR-**open** time, so a mis-based PR gets no AI first pass and retargeting afterwards does not undo it (#168). **Stage-aware on the Product:** a `review/EP-*` branch opens the Shape artifact-review PR (delegates to `yad gate open`); any other Product branch uses the code-task template (so Product tooling PRs pass the `pr-template` gate). |
| `yad ship --type <t> -m <subject>` | Commit **and** open the task PR/MR in one step (`yad commit` then `yad open-pr`) — stage-aware, same as `open-pr`. |
| `yad checkpoint [--push]` | Commit the **machine-written Build state on the Product** — `trust-log.json`, `build-log.json`, `build-state/<story>.json` — **plus any story `status:` flip** (`approved → in-build/shipped`) that now has a `build-log` ship, as one `chore(hub): sync Build state — <epic>/<story> by @<login>` audit-trail commit (no `Task` trailer, no AI footer). The Build analogue of `yad gate ci`: it stages **only** those ledgers + ship-backed story flips by an explicit allowlist (never a Shape gate file, so `ledger-guard` never trips) and commits **only on the default branch** (so the commit never enters a PR range where its `[skip ci]` would strand checks). Carrying the story flip is what keeps the story artifact from drifting from `build-log.json` — so no operator ever falls back to a raw `git push origin main` (#112). A **no-op** when nothing changed; `--push` lands it on `origin/<default>`; `--allow-branch` overrides the default-branch guard. The SDLC Build (`yad-run`, `yad-engineer-review`) calls it so teammates never have to hand-commit machine audit state. |
| `yad checkpoint --retro-ship <epic>/<story> --repo <r>` | Reconcile a **pre-tracking** story — merged and shipped **before** the Build ledger existed, so it has no `build-log` ship and plain `checkpoint` can't carry its `status: shipped` flip (#142). Records **one** retroactive ship shard marked `retroactive: true` (`--task <t>` overrides the default `retro` sentinel; `--merge-commit <sha>` records the SHA — never invented; `shippedAt` is the backfill date), then runs the normal checkpoint so the story's already-made flip rides the **same** `chore(hub)` commit. **One repo per run:** a story that shipped in several repos is recorded by re-running once per `--repo` (the flip rides the first commit; each later run lands only its own shard) — the guard is per **(story, repo)**, so recording one repo never locks out the rest (#166), and after each run it names the story's declared repos that still have no evidence. Because a ship is permanent audit evidence, `--repo` must be one the story's `repos:` frontmatter declares (or, when it declares none, one the Product's `.sdlc/repos.json` connects) — a typo'd or invented repo is **refused**, not recorded — and a name that would share a build-log **shard filename** with an already-recorded repo (`api.v2` vs `api_v2`, both sanitized to `api_v2`) is refused too, so a retro ship can never overwrite another repo's record. **Refuses** when the story already has a ship **in that repo** (then it isn't pre-tracking there — use the normal flow); does **not** author the story frontmatter and **refuses unless you have already set a Build `status:`** — `in-build` or `shipped` — (so a ship is never committed while the artifact still says `approved` — evidence and flip stay atomic); `--push`/`--allow-branch`/`--dry-run` behave as for `checkpoint`. **Where the record lands:** like every ship, it is written as a **shard** under `.sdlc/build-log/` — the folded `.sdlc/build-log.json` is *not* appended to (that is what would make concurrent shippers conflict). Readers **union** the folded file with every shard, so the ship is fully visible immediately; `yad tidy up` folds it into `build-log.json` once the story is `shipped` (a backfill against an `in-build` story stays a loose shard until then). An empty `build-log.json` right after a backfill is the design, not a lost write (#167). This is the supported alternative to a raw `git push origin main` for a legacy shipped story. |
| `yad tidy up [<epic>] [--push]` | Fold a **shipped story's** finished `trust-log`/`build-log` **shards** back into the single folded ledger file, as one `chore(hub)` commit — the manual "pack it up" companion to the shard-then-fold storage (like `git gc` for its loose objects). Concurrent Build writers each write their own shard file (so parallel stories of one epic never conflict), and readers union the folded file + loose shards; `tidy up` is the on-demand compaction. A fold reads shards, merges them, then deletes them, so it holds the ledger's exclusive lock for that whole span — a ship written or stamped mid-fold can never be folded away without its change, or deleted without being folded (`YAD-STATE-006` if another writer holds it). Default branch only; `--push` lands it on `origin/<default>`; a **no-op** when nothing is foldable. |
| `yad repo list` / `yad repo refresh [name]` | List connected repos as **fresh / stale**, and re-pack a stale one — staleness is now an explicit human decision, never an automatic skill side-effect. |
| `yad repo refresh [name] --push` | After the re-pack (and the AI regenerating the code-map), commit the tracked code-maps + `.sdlc/repos.json` as an audit-trail `chore(hub): sync code-context … [skip ci]` commit and push it straight to the Product's **default branch** (`--allow-branch` to override). The code-context analogue of `yad checkpoint`. |
| `yad repo sync [name]` | Switch every connected repo to its **default branch** and fast-forward it from origin (one or all). Dirty repos are skipped, never overwritten; fast-forward only. |
| `yad thread [<epic>]` | **Feature threads.** No arg: list every thread. With an epic: show its thread (genesis → changes → defects), the **resolved current-truth** map (which epic owns each artifact now), and any open hotfix debt. `--json` for tooling, where each node carries its work-item `type`, its grouping `theme` and the lifecycle `phase` its current step is in. Read-only. |
| `yad reconcile [check\|refresh\|wire]` | Sweep threads for **drift / orphans / open hotfix debt** and report which thread drifted and why (mirrors `yad docs sync`; advisory — the CI gates block at merge). |
| `yad hook ledger-guard` | **Harness-invoked, never typed.** The local half of the `ledger-guard` rule: in verified mode the gate ledger is CI-owned, so an agent that hand-edits `epics/*/.sdlc/state.json` is refused **at the moment of the edit** and told the command that owns the transition (`yad gate open`) — instead of discovering it twenty minutes later in a failed pipeline (#171). Reads a tool-call payload as JSON on **stdin** (or `--path <p>`); **exit 0 allows, exit 2 denies** with the reason on stderr, which is Claude Code's `PreToolUse` contract and any other harness's too. Same scope as the CI gate, including the new-epic seed exemption (#162); a **no-op** with a local ledger. **Fails open** — no `yad`, no Product, an unreadable config all allow, because the CI gate is the one that fails closed. `YAD_HOOK_DISABLE=1` skips it. Wired by `setup` / `check --fix`; `yad doctor` reports whether it is armed. |
| `npx yadflow --version` | Print the installed CLI version. |

Flags: `--dir <path>` targets a project other than the cwd; `--force` re-copies unchanged files (or
bypasses the commit atomic guard) — it never reaches a `modified` managed file; `--overwrite-local`
replaces those (see below). Commit flags: `--type`, `-m/--message`, `--task` (a
`<story>-T<NN>` id — an explicit value is validated against the spec-link gate and `yad commit`
fails locally if it is malformed), `--ai
<claude\|copilot\|cursor\|coderabbit\|none>`, `--contract-change`, `--dry-run`. `open-pr` flags:
`--repo`, `--risk <low\|medium\|high>`, `--contract-change`, `--base <branch>` (override the resolved
base — only pass it deliberately; a non-default base loses the AI first pass), `--platform`,
`--title`. `ship` takes the union of the `commit`
and `open-pr` flags (it runs `open-pr` only if the commit lands).

### `yad next --json` (the driver, machine-readable)

`yad next` renders coloured English, which is the wrong shape for the agents and CI jobs that drive
this workflow. `--json` emits the action object the router already computed. One envelope covers
every route, so a caller never branches on the output shape:

```jsonc
// yad next --json  /  yad next <epic> --json
{ "version": "3.13.1", "ok": true, "actions": [ /* one per epic, EP-discovery included */ ] }

// yad next <epic> --check <step> --json      (exit 1 when the step is blocked, as in prose)
{ "version": "3.13.1", "ok": false, "check": { "epic": "EP-x", "step": "architecture-review", "ok": false, "reason": "…" } }

// the project has no `yad setup` yet
{ "version": "3.13.1", "ok": true, "setUp": false, "actions": [] }

// bad epic id, or an epic with no state.json
{ "version": "3.13.1", "ok": false, "error": "invalid epic id: …" }
```

Each action carries `epicId`, `kind`
(`new|author|review-open|review-sync|build|discovery-done|backfill-pending|backfill-done`), `step`,
`status`, `artifact`, `skill`, `command`, `pr`, `parallel`, `builds` (the per-story/per-repo lanes)
`why`, and `lineageKind` — the work-item type (`feature|change|defect|hotfix|chore`). That key keeps
its older name on purpose: the golden compatibility test deep-equals this output, and a deep-equal
breaks on an added key as hard as on a renamed one.

`skill` is the **first** skill that runs the step, and it is always a single name. A step bound to
several ([below](#choosing-the-skill-for-a-step)) carries a `skills` array beside it holding the whole
chain in order. That key appears **only** when there is more than one, for the deep-equal reason
above — a project that binds nothing emits exactly the JSON it always did. For the same reason the grouping `theme` is **not**
here: `yad next` prints it for a person to read, and a machine reads it from `yad thread --json`.
`--all` is implied — the array always carries every epic. Exit codes are
identical to the prose path, and the prose path itself is unchanged.

## The PR-driven review gate

The Shape gate now rides the **PR/MR you open per step** (`yad gate open`). Reviewers approve and
comment on the platform; `yad gate sync` maps that state into the file ledger (`approvals.json`,
`comments.json`, `reviews/*.md`) — which stays the source of truth — and the step **auto-advances on
merge** once three things hold: the approval rules are satisfied, every comment thread is resolved, and
the review PR/MR is merged.
The merge click is the human approval act, so Shape steps still never advance on their own. Approvals are
**revoked when the reviewed artifact actually changes** (re-hash), giving reviewers a fresh pass. With no
Product platform / no `gh`/`glab`, the gate degrades to local with no error.

**Two approval rules, both enforced.** The first is the roster rule — owner + 1 reviewer, plus a
domain-owner per touched repo on an escalated step. The second names no person, role or step: a step
needs `base + risk step` **distinct approvers**, where base is 1 (one human who is not the author) and
the risk step comes from the step's own risk tags — `contract` +2, `auth`/`payments` +1, nothing +0, the
highest tag and never the sum. So an ordinary step needs 1 approver and the architecture+contract gate
needs 3. Every surface that reports a gate prints the arithmetic (`2 of 3 approver(s) — base 1 + contract
risk 2`) instead of a bare refusal, because neither rule is capped by how many people the project
actually has yet. One person holding two roles satisfies two roles but is one approver.

**Solo mode.** A lone developer can't approve their own PR on GitHub, so an approval requirement would
deadlock them. Opt in (`yad setup --solo`, recorded as `solo: true` in `.sdlc/hub.json`) and the gate
**waives the approval requirement only** — the review PR/MR and its merge stay, so CI still runs on the
PR and the **merge** advances the step. Net: the gate passes on *merged + all threads resolved*. It's a
documented, reversible relaxation; `yad doctor` warns if branch protection still "requires approvals"
(which would block the solo dev's own merge).

**Event-driven sync.** Wire the Product once (`yad check --fix` installs `.github/workflows/yad-gate-sync.yml`,
or the GitLab fragment + schedule) and every **approval, change request, and merge** on a review PR/MR
triggers `yad gate ci` in the Product's own CI: the ledger updates land directly on the Product's default branch
— no manual `yad gate sync` needed (it stays valid as the fallback). CI never approves and never merges;
the human keeps the merge click. GitLab caveat: approvals are only picked up by the ~15-min scheduled
sweep (GitLab fires no pipeline on approval) — details in `skills/yad-hub-bridge/references/bridge.md`.
Concurrency caveat: the wired jobs serialize runs repo-wide — a `concurrency` group on GitHub, the
equivalent `resource_group` on GitLab — and every sync re-reads the full platform state, so racing
reviewer events lose nothing. Outside that group — a manual `yad gate sync` racing CI — two
simultaneous syncs serialize their *commits* via the rebase retry but each works from the state it
read at start, so the rarer of two simultaneous advancements can be lost; the next event or scheduled
sweep re-syncs and converges.

## What `setup` walks you through (a guided, branching interview)

Setup opens with a short **profile interview** — *solo or team (how many)? greenfield or brownfield?
monorepo or separate repos?* — and the answers (recorded in `.sdlc/hub.json` as `solo` + `profile`)
branch the rest so you only answer what your situation needs. Each step prints inline guidance (what it
does / why / what to enter / what skipping means), and the step count adapts.

0. **Profile** — the three questions above, plus "configure optional tools now?". Pre-answer for
   CI/scripts with `--solo`/`--team <n>`, `--greenfield`/`--brownfield`, `--monorepo`/`--separate`, `--tools`.
1. **Preflight** — confirm the Product is a git repo (offers `git init`); check `git`/`node`/`npx`.
2. **Install the module** — copy the `yad-*` skills into the IDE skill dirs you pick
   (`.claude/`, `.agents/`, `.zencoder/`, `.opencode/`) and register `_bmad/sdlc/`.
3. **Product platform & roster** — detect GitHub/GitLab from the remote; record reviewers → `.sdlc/hub.json`.
   **Solo skips the roster** (you review by merging your own PR). Edit the roster any time with `yad roster`.
4. **Optional tools** — design (Figma/pencil), testing (Playwright/cypress/pytest/maestro), learning (DeepTutor).
   Configure now, or **defer with one prompt** → all recorded as `none` (connect later with the
   `yad-connect-*` skills; the MCPs/CLIs are confirmed there).
5. **Connect code repos** — register repos into `.sdlc/repos.json`. **Monorepo** connects one repo and
   skips domain-owner prompts; **greenfield** skips the Repomix pack (run `yad repo refresh` once it has code).
6. **Wire each repo** — CI gates and PR/MR template, recording each written file's sha in that repo's
   `.sdlc/managed.json` so a later `update` can tell a stale copy from one you edited
   ([managed files](#managed-files-what-yad-owns-and-what-you-edited)).
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

> **The publish is automated; the decision is not.** Merging to `main` publishes nothing. When a person
> fast-forwards the `release` branch to `main`, [semantic-release](https://semantic-release.gitbook.io/)
> computes the version from the [Conventional Commits](../CONTRIBUTING.md), publishes to npm with build
> provenance (tokenless OIDC), ships the `CHANGELOG.md` in the tarball, and cuts a GitHub release. No
> manual `npm publish`. See [`RELEASING.md`](../RELEASING.md).

## Managed files: what `yad` owns, and what you edited

`setup` / `check --fix` / `update` write a fixed set of **managed files** into the Product and every
connected repo — the `checks/*.sh` gate scripts, the CI workflow/fragment, the PR/MR template, and (on
a verified Product) `hooks/ledger-guard.sh`, the agent guardrail. They are yad's to rewrite, which is how a
version upgrade lands new gate logic everywhere at once.

One wired file is deliberately **not** managed in that sense: `.claude/settings.json` belongs to your
team, and yad owns exactly **one entry** inside it — the `PreToolUse` hook that invokes
`hooks/ledger-guard.sh`. It is merged additively and claimed only by an **exact** command match (the
current spelling or a documented past one), so re-running never duplicates it, nothing else in the
file is touched, and a hook of your own that merely names a similar path is never hijacked. A
`settings.json` that does not parse is reported `modified` and **never** rewritten — not even by
`--overwrite-local`, which has no shipped template to restore here; fix the JSON and re-run. It is
also never staged by `--push`: every other path in that allowlist is a file yad wrote in full.

The catch (#164): "the file differs from the shipped template" cannot, on its own, tell a **stale**
copy (rewrite it) from one your team deliberately **customized** (ask first). So every write records
the sha256 of what it wrote in that repo's `.sdlc/managed.json`, and the next run compares:

| On disk | Reported | What `--fix` / `update` does |
|---------|----------|------------------------------|
| = the shipped template | `ok` | nothing |
| ≠ template, = the sha we recorded | `outdated` | rewrites it silently — it is provably our stale copy |
| ≠ template, ≠ the sha we recorded | **`modified`** | **nothing.** Names the file and moves on |
| ≠ template, no record at all | `outdated` | rewrites it, but saves `<file>.yad-orig` first |

A `modified` file is reported on **every** check until you resolve it — that visible drift is the
point, and it is the honest cost of keeping a local edit to a managed file. To resolve it:

- **keep the edit** — leave it; the update never touches it. Better: move the knowledge into a file
  yad does not manage (an ADR under `docs/`) so an upgrade cannot strand it;
- **take the shipped version** — `yad update --overwrite-local`, which replaces every `modified` file
  after writing your version next to it as `<file>.yad-orig` (review it, then delete it).

`.sdlc/managed.json` is committed, so the record travels with the repo instead of living in one
clone. The last row is the migration path for an install made before this record existed: nothing is
proven there, so the routine upgrade still lands but never discards content it cannot account for.
A record that exists but cannot be read as one (corrupt JSON, a bad merge resolution) is an **error**,
never a silent reset — restore it from git, or delete it to start over from that last row.

> **Not yet supported:** marking a customization as *accepted* so it stops being reported (an
> opt-out list of managed paths you own). Until then, `modified` is a permanent, deliberate nag.

## The six phases

The lifecycle has three **parts** — Shape, Build and Run. Inside them sit six named **phases**, and
every step belongs to exactly one:

| Phase | Part | Steps |
|---|---|---|
| Discover | Shape | `discovery` · `analysis` · `epic`, each with its review gate |
| Design | Shape | `architecture` (with the locked contract) · `ui-design`, each with its review gate |
| Plan | Shape | `stories` · `test-cases`, each with its review gate |
| Build | Build | `spec` · `tasks` · `implement` · `checks` · `engineer-review` |
| Release | Run | **planned, not built** — release notes · version · deploy record · gate |
| Operate | Run | **planned, not built** — defects · feedback · retrospective · improvements |

`yad next <epic>` prints all six with the current one marked and the two planned ones greyed, so the
lifecycle does not appear to stop at merge.

An epic sitting on the `ready-for-build` marker is in **Build**, and stays there for the rest of its
life: the individual Build steps run per story per code repo, so the epic-level view names the phase
rather than the step. No line is printed at all for a stub epic, for `EP-discovery` (which is
product-level and does not walk this lifecycle), or for a step id this release does not recognise —
showing the wrong phase would be worse than showing none.

A phase is worked out from the step id. It is **not stored in any file**, so there is nothing to keep
in step, nothing to migrate, and no way for it to disagree with the step it describes. `yad doctor`
reports a step id no phase claims (`phase:unknown`) — that is also a step no skill runs and `yad next`
cannot guide, so it is usually a typo or a file from a newer release.

## The step catalogue

Every step the engine knows is defined in **one place in the code**: its phase, whether it writes an
artifact or reviews one, which file it produces, which skill runs it, and which step a review gate
gates. Before this there was no single answer — the phase came from one table, the skill from another,
and the artifact only from the chain a skill hand-wrote into your project.

You do not edit the catalogue. The one part of it you can change is **which skill runs a step** — that
is a project setting, not a fact about the lifecycle, and it lives in a file: see
[choosing the skill for a step](#choosing-the-skill-for-a-step). The rest matters for two reasons.

**Your file wins.** When your `state.json` describes a step differently from the catalogue, nothing is
rewritten. A project may run a chain the tool does not know, and leaving a step out is normal — not
every epic has screens, so many have no `ui-design`. `yad doctor` says what it noticed and stops there.

**Six things it can now notice**, all warnings in the `shape` section:

| Check | What it means |
|---|---|
| `step:artifact` | A step names a different file from the one the catalogue expects. This matters because the review gate hashes that file, so a wrong name binds the approval to the wrong thing. Different **spellings** of the same artifact are fine and are not reported: `stories`, `stories/` and `stories.md` are one gate. |
| `step:no-artifact` | A step names no file at all. This is the one case that stops `yad gate` outright rather than quietly misfiring, because the field is read, not defaulted. |
| `step:kind` | A step is on the wrong side of the author / review line. An author step is run by a skill and a review step by `yad gate`, so on the wrong side nothing drives it. |
| `step:orphan-gate` | A review gate is in the chain but the step it reviews is not. Nothing then tells anyone to write the artifact being reviewed, and for a folder artifact the gate has nothing to bind an approval to. |
| `step:off-route` | The chain matches no lifecycle profile. See the section above: leaving a step out is fine, a step no route has or two in the wrong order is not. |
| `skip:not-optional` | A step is marked N/A but this epic's route does not mark it optional. Nothing breaks today: the step is already done, so a gate sync reports that the rule no longer holds and changes nothing. What is lost is the justification — the gate stops treating the skip as the reason the step passed. Silent when `profile:disagree` already names the epic, because correcting that clears this too. |

A step id the catalogue does not carry is left to `phase:unknown`, which is the check for that.

## Lifecycle profiles: the route an epic takes

The step catalogue says what each step is. A **profile** says which steps an epic walks and in what
order. Five exist, and they are written down once — in code, which is what `yad epic new` seeds from:

| Profile | What it is | Used by |
|---|---|---|
| `classic` | The 10-step chain, starting at the epic | Most epics, and every change, defect and hotfix |
| `analysis-first` | The 12-step chain, which puts the analysis before the epic | An idea shaped by the analyst before it becomes an epic |
| `chore` | The upkeep lane: four steps, the epic then the stories | Work somebody has already decided on — a dependency bump, a CI move |
| `spike` | The investigation lane: six steps, the analysis then the upkeep lane | A timeboxed question, where finding the answer is the work |
| `discovery` | The product front-zero, two steps and no Build | The one `EP-discovery` item, which frames the whole product |

The first three of those are routes the tool already used, written by hand into five skill files
before the engine held them. `chore` and `spike` are new.

### The short lanes

Before them the engine had one shape of work: a dependency bump was seeded on the same 10-step chain
as a payments rewrite. A shorter **route** says the difference honestly, once, where a person picks
it — rather than letting every epic skip whatever it likes.

Both lanes drop the same three pairs, and each is **absent** rather than optional. An optional step
stays in the chain with a recorded reason for skipping it; a step the route never had needs no
reason, and writing one would fill the audit trail with notes about screens nobody was going to draw.

| Dropped | Why |
|---|---|
| `architecture` + its gate | No architecture gate means no `contract.md` and no lock. These lanes are for work that does not move the shared cross-repo surface. **Work that does move it belongs on `classic`, whatever its size.** |
| `ui-design` + its gate | A chore is upkeep with no user-visible change, by the definition of the type. A spike's prototype is thrown away. |
| `test-cases` + its gate | Neither lane introduces behaviour to pin. The tests guarding the code a chore touches already exist, and its Build gates still run them. |

Neither lane drops `epic` or `stories`. `epic.md` is where the work-item type and the `parent:`
lineage are authored, and an epic without one is invisible to `yad thread`. `stories` is what tags
the repos Build runs in, and approving `stories-review` is what makes the epic ready for Build.

**`spike` is `chore` with the analyst's brief in front.** The difference is whether the answer is
already known. Upkeep is decided work; a spike is a question, so reducing the uncertainty is its first
artifact. Everything after that is the same short route.

The type and the route are chosen separately. `--type chore --profile classic` stays legal, and is
the right call for a large piece of upkeep that does touch the contract.

**The choice is final.** `yad epic new` refuses an epic that already has a chain and there is no
re-seed flag, so pick the route before seeding. If a short-lane epic turns out to need the shared
surface to move, it records the finding and the surface change belongs to a new epic on `classic`.
The contract gate enforces this rather than trusting the prose: a commit claiming `Contract-Change:
yes` fails when the epic has no lock at all — provided the Product repo is reachable from the build,
which is what lets the gate tell "this epic has no lock" from "nothing is checked out here". Where it
is not reachable the check defers, as it always has.

**`yad next` marks a phase a short lane never enters.** A chore epic has no architecture or UI-design
step, so its phase line reads `Design (not on this route)` rather than printing Design exactly as a
classic epic does, which would make a phase it will never visit look like one already passed. The mark
appears only when the epic **recorded** its route: a chain that says nothing gets the line it always
had, because greying out a phase on a guess would be wrong for every hand-written ledger.

**A short lane has no optional steps**, so `yad skip` is refused on one. That is a different answer
from "this chain is on no route", and the two now say so separately — a short-lane epic is told which
route it is on, not sent to a health check that cannot fire for it.

**Each epic records its route.** `epics/<epic>/.sdlc/state.json` carries a `profile` key from file
shape 6 on, and `yad epic new` writes it when it seeds the chain. An epic created before that key
existed gets it from `yad migrate`, read off the chain it already carries — see
[shape 6](migrations/shape-6.md).

The chain stays the truth. The recorded name says which route the epic was **started** on; matching
the steps says which route it is on **now**, and `yad doctor` compares the two:

| Check | Fires when |
|---|---|
| `profile:unknown` | the recorded value is not one of the five |
| `profile:disagree` | the chain is cleanly on a route, and it is not the one recorded |
| `step:off-route` | the chain is on no route at all |

**Leaving a step out keeps you on the route.** An epic with no screens drops the UI design step and is
still `classic`. What takes an epic off its route is a step no route has, or two steps in the wrong
order. `yad doctor` reports that as `step:off-route`, because the guidance command reads the chain in
the order it is written: off the route, it names whatever sits next rather than what comes next.

**The route also says which steps may be skipped.** A profile marks some of its steps optional, and
`yad skip <epic> <step> --reason "<why>"` marks one N/A for one epic — pre-marked done with the reason
recorded, visible in the chain, reversible with `--undo`. The engine keeps **no list of its own**: it
asks the route the epic is on, so a shorter route that drops a step does not make that step skippable
for every other epic in the project. `classic` and `analysis-first` both mark the same one step,
`ui-design`. The short lanes mark **none** — they leave the steps they do not need out of the chain
altogether, so there is nothing on them to mark N/A, and `yad skip` says so rather than reporting the
chain as broken.

**The recorded route is the answer, even when the chain disagrees with it.** An epic records its route
in `state.json`, and that is what the engine reads. Working it out from the steps instead would guess,
and a chain written by a **newer** release carries steps this one has never heard of — reading that as
"no route" would strip an epic of its optional steps and make a skip it already recorded start failing
its gate. `yad doctor` reports the disagreement (`profile:disagree`, `step:off-route`); it does not
decide the question.

An epic with **no** route — it records none this release knows, and its steps match none — has nothing
optional, and the refusal says so. Inventing a route to answer the question would let a step be skipped
on the strength of a route nobody chose.

## Choosing the skill for a step

The step catalogue names a skill for every step it runs: `yad-architecture` writes the architecture,
`yad-stories` writes the stories. Those are **defaults**, not the only possible answer. Your project
picks its own in `.sdlc/skills.json`:

```jsonc
{
  "schemaVersion": 6,
  "steps": {
    "architecture": "our-architecture-skill",
    "stories": ["shape-the-stories", "yad-stories"]
  }
}
```

The easiest way to write it is the command, which stamps the file and checks what it can:

```bash
yad skill list                                   # what runs each step, and whose choice that is
yad skill bind architecture our-architecture-skill
yad skill bind stories shape-the-stories yad-stories
yad skill unbind architecture                    # back to the engine's default
```

**Several skills on one step are a chain, never a contest.** They run in the order you wrote them,
each one seeing what the one before it produced, and the last output is the artifact. There is no
"run three and pick the best": picking needs a judge, which is either a person reading three
architectures or an AI deciding for you, and neither belongs inside a tool whose job is the audit
trail. Every extra skill is another model run and costs more, so `yad skill bind` and `yad next` both
say so when a step has more than one.

**Your file wins, and `yad doctor` only reports.** Nothing here checks that a skill exists — the engine
cannot know which skills your team installed, and binding one it has never heard of is the point. What
it does report, in the `project` section, is a line that will never do anything:

| Check | Fires when |
|---|---|
| `skills` (fail) | the file does not parse, or `steps` is not a JSON object |
| `skills` (warn, `YAD-CFG-006`) | a value is not a skill name — an empty string, a number, an empty list |
| `skills:unknown-step` | the step id is one this release does not run, so nothing will look the binding up |
| `skills:review-step` | the step is a **Shape review gate**, which `yad gate` drives — no skill ever runs it |
| `skills:bound` (ok) | the summary: how many steps are bound, and how many to more than one skill |

`yad skill list` marks the same lines with a red `!`, so a binding that does nothing is visible where
you go to look at bindings rather than only in the health check.

`bind` refuses an id that is not shaped like a step id — lower-case letters, digits and dashes. That
is a shape check and not a list of known steps: `release` goes through with a warning, because your
file wins.

**A file that does not parse stops a write, and only a write.** `yad skill bind` and `yad skill unbind`
read the whole document before editing it, so writing over bytes they could not read would delete every
binding the file holds. They refuse and say so. `yad next` keeps working — it treats an unreadable file
as an empty one, because a command whose job is to say what to do next must still answer.

**Shape review gates** are the one thing `yad skill bind` refuses outright rather than warning about,
because a binding on one would record a decision that never happens. Bind the step being reviewed
instead: `architecture`, not `architecture-review`. `engineer-review` is not one of them — it is a
Build step in its own right, the locked human merge gate, and it has a skill, so it can be bound.

## Grouping: the `theme` tag

A **theme** is a free label you put on an epic to say which group of work it belongs to. Write it in
`epic.md`, next to the other frontmatter keys:

```markdown
theme: checkout-revamp
```

That is the whole feature. There is no list of allowed themes, nothing to register first, and no
command to run. Any word or short phrase in any language does. Most epics have no theme, and that
is normal — leave the key empty.

The theme is what this method has **instead of a level above the Epic**. The ladder stays Product →
Epic → Story → Task. Grouping is a label, not a rung you have to create and keep in step. If you later
move to a tracker that has an Initiative level, a theme maps onto one.

Four things are worth knowing:

- **One tag, not a list.** `theme: [checkout, billing]` is read as **no theme at all**, so the epic
  drops out of every grouping. `yad doctor` reports it (`theme:unreadable`).
- **No `#` in the value.** The commands print the tag as `#checkout-revamp`, but that `#` is decoration
  on the screen. The header reader keeps the whole rest of the line, so `theme: checkout # the big one`
  becomes a tag of `checkout # the big one` — it still reads, and it still groups, but only with other
  epics carrying that exact text. `yad doctor` reports it (`theme:commented`).
- **Spelling is the grouping.** `checkout-revamp` and `Checkout Revamp` are two themes, not one.
  `yad doctor` reports a theme spelled more than one way (`theme:variants`) so it does not split a
  group in silence. Copy the spelling from an epic already in the group.
- **Set it when you write the epic.** The epic review gate is bound to a hash of the whole `epic.md`
  file, so editing any frontmatter key — the theme included — after the gate has been approved drops
  that approval as stale and the step has to be approved again. This is not new to themes; it is how
  every edit to an approved artifact behaves. Before the gate, edit freely.
- **A child gets a copy, not a link.** When `yad-change` opens a change or defect epic off a parent, it
  writes the parent's theme onto the new epic. A brownfield stub minted by `yad-stub` normally has
  none: it is captured from code that already exists, so there is nobody to ask which group it is in. Nothing works it out afterwards, so if you add a theme
  to a parent later, add it to the children too.

Where it shows up: `yad next` prints it beside the epic id (`Epic EP-cart #checkout-revamp`), in the
single-epic view and in the several-epics roll-up. `yad thread` with no argument prints each thread's
theme beside its id, and `yad thread <epic>` prints it on each node and carries it in `--json`. It lives only in `epic.md` — there is
no copy in any ledger file, so no file shape changed and there is nothing to migrate.

## File shape: `schemaVersion`

Every JSON **object** `yad` writes under a `.sdlc/` directory starts with a `"schemaVersion"` — **6**
in this release. It records what shape the file is in, so a later release can recognise a file written
by an older one and upgrade it rather than guess.

You do not have to do anything about it. Three things are worth knowing:

- **An older project is not broken.** A file with no `schemaVersion` counts as shape 1. Existing
  projects keep working untouched, and each file picks up the key the next time `yad` writes it.
- **Four files never carry it.** `approvals.json`, `comments.json`, `hub-prs.json` and
  `reconcile-debt.json` are JSON lists, and a list cannot hold a key. They count as shape 1 too.
- **It is not the CLI version.** `.sdlc/cli-version.json` says which release of `yad` set the project
  up and moves with every release. `schemaVersion` describes the file itself and moves only when the
  shape genuinely changes.

Files `yad` writes that are not part of a project — your editor's `.claude/settings.json`, the daily
update-check cache in your home directory — are never stamped.

## Staying up to date

Every `yad` command checks — at most once a day, and never in CI — whether a newer `yadflow` has been
published to npm. When one has, it prints a notice on **stderr** after the command finishes:

```text
  ! yadflow update available — 3.10.1 → 3.11.0
    Changelog:  https://github.com/abdelrahmannasr/yadflow/releases/tag/v3.11.0
    Update:     npm install yadflow -g
    Then:       yad update   (re-sync this project's yad-* skills)
```

Both lines matter. `npm install yadflow -g` upgrades the CLI; `yad update` then re-syncs the installed
`yad-*` skills and gate scripts in your project, which are still stamped at the old version in
`.sdlc/cli-version.json` (`yad doctor` flags the mismatch until you do).

The notice never touches stdout or the exit code, so `--json` output, the grounding bundles, and
`yad next <epic> --check <step>` are unaffected. It is silent when `CI` is set, when
`YAD_NO_UPDATE_NOTIFIER=1` or `SDLC_NONINTERACTIVE` is set, and when `yad` is run from a source
checkout. If the registry is unreachable the check fails silently — it can never fail your command.
The last result is cached in `update-check.json`, resolved in this order: `$YAD_CACHE_DIR/` (the
override), else `$XDG_CACHE_HOME/yadflow/`, else `%LOCALAPPDATA%\yadflow\` on Windows, else
`~/.cache/yadflow/`. On macOS `XDG_CACHE_HOME` is normally unset, so the file lands in `~/.cache/yadflow/`.

On a **major** upgrade the notice says one extra thing: preview the migration first, with
`npx yadflow@<new version> migrate`. A major is the only release allowed to change the shape of your
state files, and that command shows you exactly what would change in *your* project without writing
anything. It names `npx` rather than your installed `yad` on purpose — the migration steps ship inside
the version that introduces them, so the copy you already have would report that nothing changes.
Minor and patch upgrades never say this, because everything below a major is additive.

Major versions are also published to a separate channel first. `npm install yadflow` always gives you
the stable line; `npm install yadflow@next` opts you into the next major while it is being proven.

## Troubleshooting (`yad doctor` + error codes)

### The `shape` section — is this project on the right file shape?

`yad doctor` reports what shape your state files are in, against the shape this release writes, one
line for the project and one per epic:

```text
  shape
  ✓ this project is on shape 6, the engine is on shape 6
  ✓ EP-checkout is on shape 6, the engine is on shape 6
```

| What it says | What it means | What to do |
|---|---|---|
| on the same shape | nothing to do | nothing |
| *N file(s) do not record it yet* | those files predate the stamp. They count as shape 1, so they are **correct**, just silent | optional: `yad migrate --apply` writes it in |
| *N file(s) are **behind*** (warn) | this release expects a newer shape | `yad migrate` to preview, then `yad migrate --apply` |
| *N file(s) are **newer** than this yadflow* (fail) | they were written by a newer release | upgrade the CLI. **Never** migrate — that would move them backward and lose what the newer version wrote |
| *N are **CI-owned** and behind* (warn) | in verified mode CI is the only writer of those files, so `yad migrate` will not touch them | nothing. The next `yad gate` command, or CI's next gate sync, moves them and the warning clears |
| *N step(s) belong to no phase* (warn) | a step id this release does not recognise — so no skill runs it and `yad next` cannot guide it | check the spelling, or upgrade if the step comes from a newer release |
| *N epic(s) record a lifecycle profile nobody defined* (warn) | `profile` in `state.json` is not one of the three routes | set it to the route the chain walks, or delete the key and let it be derived |
| *N epic(s) record a route their chain is not on* (warn) | the recorded name and the steps disagree, and the steps are cleanly on another route | the chain is what every gate walks. Correct `profile` in `.sdlc/state.json` |

The reading comes from the same code `yad migrate` previews with, so the two can never disagree. In
`--json`, each shape check carries a `shape` object with the engine's version and a per-file list, so
CI can act on the detail rather than parsing the sentence.

When something is off, run `yad doctor` first — it checks the environment (git, gh/glab auth, node
version), the project state (`.sdlc/*.json` parse and point at real repos), and every epic ledger,
with a fix-it hint per finding. Failures carry stable, greppable codes, also printed by any failing
`yad` command:

### Gate-integrity findings (no code — the message names the epic and step)

Three checks verify that what the ledger *claims* is still true of the files on disk. They carry no
`YAD-*` code because each is about one epic's contents, not a malformed install:

| Finding | Meaning | Fix |
|---------|---------|-----|
| `contract surface drifted from its lock` (**fail**) | `contract.md`'s `CONTRACT-SURFACE` block no longer hashes to what `.sdlc/contract-lock.json` pins — the surface was edited without a re-lock, so the lock proves nothing and every downstream `contract-check` compares against a stale value | re-run the `yad-architecture` Step 5 recipe and re-open the architecture gate |
| `contract-lock.json exists but carries no usable sha256 hash` (**fail**) | the lock file is present but empty/`null`/malformed. An epic that simply has not locked yet has **no file**, so "present but unusable" is a decorative lock, never a pre-lock state | re-lock the surface, or delete the file |
| `pointer-lock` findings (**fail**) | a change-epic that inherited architecture copies its parent's hash verbatim; this fires when the parent re-locked (the copy is stale), when the referenced lock is missing, or when `ref` resolves outside `epics/` | re-copy the parent hash, or re-author architecture in this epic (`yad-change`) |
| `<step> is done, but all N approval(s) are bound to an older <artifact>` (**warn**) | the artifact changed after the gate passed. The chain is one-way by design, so nothing pulls the step back — this is the only place that state is visible | re-open the review (a fresh PR/MR) so the record matches what shipped |

> **Upgrading to the aligned contract hash?** The CLI used to omit the trailing newline the documented
> `awk … | shasum` recipe includes, so its digest differed from every lock file's. Lock files are now
> verifiable, but architecture approvals recorded under the old digest go stale once — expect the
> `…all N approval(s) are bound to an older…` warn on a step that already passed, and a re-approval on
> one still in review. See `skills/yad-architecture/SKILL.md` Step 5.

| Code | Meaning | Fix |
|------|---------|-----|
| `YAD-ENV-001` | git is not installed or not on PATH | install git — every yad command needs it |
| `YAD-ENV-002` | platform CLI (gh/glab) missing or not authenticated | install it and authenticate — `gh auth login` (GitHub) or `glab auth login` (GitLab); the gate degrades to local without it |
| `YAD-ENV-003` | Node.js older than the supported range | install Node >= 18 |
| `YAD-STATE-001` | a ledger/config JSON file exists but does not parse | fix the file or restore from git — never delete a ledger blindly |
| `YAD-STATE-002` | a ledger/config file parses but has the wrong shape | fix the file or restore from git (the message names the field) |
| `YAD-STATE-003` | a registered repo path is missing or not a git repo | fix the path in `.sdlc/repos.json` or re-connect the repo. A repo *outside* the project root (a sibling, `../backend`) that is simply absent from this checkout is a **warn**, not this failure |
| `YAD-STATE-004` | an epic step cannot be skipped / un-skipped in its current state | the step must be one the epic's own [lifecycle route](#lifecycle-profiles-the-route-an-epic-takes) marks optional — `ui-design` on every route today — and needs a `--reason`; it can be skipped only up to authoring it (before its review opens / before `stories` start); `--undo` before the stories review opens. A chain on **no** route has nothing optional: fix `step:off-route` first |
| `YAD-STATE-005` | an authoring step is stranded behind its completed review gate | a pre-3.11 `gate sync` could advance a review step while leaving its author step `in_progress`, silently blocking every later step (and the parallel `test-cases` track). Run `yad gate repair <epic>` |
| `YAD-STATE-006` | a Build ledger (`build-log`/`trust-log`) is locked by another yad process writing it | every read-modify-write on these ledgers (`--retro-ship`, `yad review reconcile`, `yad tidy up`) takes an exclusive lock, so two runs can never interleave and lose an entry. Wait for the other command and re-run; a lock left by a killed process is reclaimed automatically after 30s, or delete the `.lock` directory the message names |
| `YAD-CFG-001` | `hub.json` names an unknown platform | expected `github`, `gitlab`, or `null` — fix it or re-run `yad setup` |
| `YAD-CFG-002` | `design.json` names an unknown design tool | expected one of `config.yaml` `design.tools` (e.g. `figma`, `pencil`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-003` | `testing.json` names an unknown testing tool | expected one of `config.yaml` `testing.tools` (e.g. `playwright`, `cypress`, `pytest`, `maestro`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-004` | `learning.json` names an unknown learning tool | expected one of `config.yaml` `learning.tools` (e.g. `deeptutor`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-005` | `hub.json` sets a platform but is missing `git_url` (needed to scope auth + open PRs) | add `git_url` to `.sdlc/hub.json`, or re-run `yad setup` — it backfills it from the origin remote |

Filing a bug? The fastest path is **`yad report`** — it files the issue for you in the yadflow repo
with **auto-scrubbed** diagnostics (versions, tool present+authenticated booleans, the Product platform
enum, the error code/hint, a path-scrubbed message, and the failing command + flag *names* only). It
never posts absolute paths, hostnames, git URLs, repo names, roster logins/emails, epic IDs, branch
names, or flag values; it shows you the exact payload and asks before posting to the public repo, and
searches for duplicates first. After an unexpected failure the CLI also **offers** to run it for you —
set `YAD_NO_REPORT=1` to opt out. Prefer a hand-written issue? Attach `yad doctor --json` (names,
paths, and check results only — review and redact before posting).
