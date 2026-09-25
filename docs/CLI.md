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
| `yad epic new <slug>` | **Start an epic — the engine writes its lifecycle.** Seeds `epics/EP-<slug>/.sdlc/state.json` with the step chain of a [lifecycle profile](#lifecycle-profiles-the-route-an-epic-takes), plus an empty `approvals.json`, an empty `comments.json` and the `reviews/` directory. `--type feature\|chore` (default `feature`). **A `change`, `defect` or `hotfix` needs `--parent EP-<slug>`** (E42) and takes the parent's route — a `--profile` naming any other route is refused. `--inherits epic,architecture,contract,ui-design` carries those steps by reference: each is written `satisfied`, with `inherited: true`, `inheritedFrom` (the epic along the parent's line that owns the artifact) and `boundHash` (that artifact's hash), and `approvals.json` gets one `inherited` provenance record per carried gate. `analysis` rides with `epic`. Carrying `architecture` and `contract` (always together) writes a **pointer-lock** — `contract-lock.json` holding the owner's hash verbatim, with `inheritedFrom` and `ref` — instead of a second contract: you may skip authoring a contract, never having one. `stories` and `test-cases` are never inherited. It refuses to carry anything the owner did not write **and** approve: a skipped step (skip it on the new epic instead), a deferred one (author it here, so the owed work follows the thread), an unfinished one, a missing artifact, and an approved architecture with no lock or with a surface that no longer matches its lock. Off a brownfield anchor the bases carry `boundHash: null` and no lock is written. `parent:` and `inherits:` in an existing `epic.md` win over no flag, and a flag that contradicts them is refused. The `yad-change` skill decides what is inherited, then runs this. `--profile classic\|analysis-first\|chore\|spike` (default `classic`) — `chore` and `spike` are the [short lanes](#the-short-lanes), and neither carries an architecture gate, so neither may move the contract surface. Both Product-level ids (`EP-foundation`, `EP-discovery`) and both product routes are refused: the Product level has a fixed id and no `epic.md`, so `yad foundation new` seeds it. `--stub` mints a brownfield **anchor** instead: the same `classic` chain with every step `todo`, the marker `kind: "stub"` and `currentStep: "backfill-pending"`, so a defect can thread off a feature that shipped before the Product existed (`yad-backfill promote` wakes it). A stub is always a `feature` and always `classic`; `--type` and `--profile` are refused with it. `--json` for a script — its `next` key names the skill to run now, with a `nextSkills` array beside it when the step is bound to a chain (the same rule `yad next --json` follows: the array appears only when there is more than one). It writes **no `epic.md`, no branch and no commit**: the epic document is prose you author with the skill the chain names next. **Refuses an epic that already has a `state.json`** — nothing here overwrites a ledger, and there is no flag for it. Every skill that starts an epic runs this rather than writing a chain of its own — `yad-change` included, since E42. |
| `yad foundation new` | **Start the Foundation — the Product level (E75).** Seeds `foundation/.sdlc/state.json` with the two-step `foundation` route (`foundation` → `foundation-review`), under the fixed id `EP-foundation`, plus an empty `approvals.json`, an empty `comments.json` and `foundation/reviews/`. Run once per product, before any epic; then the `yad-discovery` skill writes the sections — `purpose.md`, `scope.md`, `mvp.md`, `roadmap.md`, `stack.md`, `repos.md`, and the optional `market.md` and `risks.md` — and `yad gate open EP-foundation foundation/` opens its review. It writes **no section, no branch and no commit**. A section that still holds nothing but its template makes `yad gate open` and `yad gate sync` warn "Foundation not written yet", and `yad doctor` reports it as `foundation:unwritten` once the review has opened or passed (E76) — a warning, never a refusal. **Refuses a second Foundation**, and **refuses a product still on the old `epics/EP-discovery/`** — a product has one product level, and `yad migrate --apply` converts the old one on a local ledger ([shape 8](migrations/shape-8.md)). `--json` for a script: `next` names the skill to run, and `sections` lists the required and optional files. |
| `yad foundation status [--json]` | **Which roadmap features are started — read, never written.** Reads the feature tables in the Foundation's `roadmap.md` (any table whose header has a `Proposed epic id` column, under its phase heading) and reports each feature from its epic's ledger: `planned` (no ledger — no `state.json` — for that id yet), `in-shape` (seeded, still in Shape), `in-build` (Shape done, not shipped yet) or `shipped` (every story in the epic's `stories/` has a Build state, every repo each story declares has a lane, and every lane is shipped — or the epic is a brownfield anchor). A table inside a code fence is an example and is not read; a heading ends a table. A row whose id is not a valid feature id, or whose ledger does not load, is named as a problem. It also lists feature epics no row proposes (folders with a ledger only; the type comes from `epic.md`, or from the ledger when there is none), since `yad-epic` may give an epic a different id. When both product levels exist it reads `foundation/` and warns. The roadmap's `Status` column is **no longer kept by hand** — editing that table after the Foundation is approved makes its approvals read as stale — so a written status is shown only where it disagrees with the ledgers (`epic-started`, the old word for a seeded epic, agrees with `in-shape` and `in-build`). Reads the old `epics/EP-discovery/` spelling too. Refuses when there is no Foundation or no `roadmap.md`. `--json`: `{ ok, epic, roadmap, approved, features: [{ phase, feature, epicId, status, written, disagrees?, problem? }], unlisted, warnings? }`. |
| `yad next [<epic>]` | **Where am I / what next.** With no epic: project-wide orientation — the one next action (run setup, start an epic, or the single active epic's step). With an epic: that epic's exact next action (a skill to invoke or a `yad` command to run). Once the epic is `ready-for-build`, it reads each story's `build-state` and prints the next **build sub-step per repo** (`spec → tasks → implement → checks → engineer-review`) plus the remaining chain and the automation dial — so Build is guided too, not just hinted at. `yad next <epic> --check <step>` exits non-zero when a step is run out of order (the precondition guard); `yad next --all` lists every epic's next action. **`--json`** emits the same answer as a machine-readable action object instead of prose — for an agent or a CI job that would otherwise have to regex the coloured output. Exit codes are unchanged. In solo mode the project view (no epic) first suggests `yad mode team` when more than one person may work on the Product (E74, see [When solo mode may be wrong](#the-pr-driven-review-gate)). |
| `yad skill list` / `yad skill bind <step> <skill>…` / `yad skill unbind <step>` | **Choose which skill runs which step.** The engine ships a default for every step; a project that wants its own records it in `.sdlc/skills.json`, and `yad next` names that one from then on. `list` shows every step a skill runs — Shape review gates are excluded, since `yad gate` drives those — what runs each one, and where that answer came from: `project` (you bound it), `engine` (the default) or `ignored` (your file has a line for that step and the line names no skill, so the default still runs). `--json` for a script. `bind` takes one skill or several — several run as a **chain**, in the order given, each seeing what the one before it produced, and the last output is the artifact; every extra skill is another model run, so the command says so. A **Shape review gate** is refused (nothing would ever invoke the binding); `engineer-review` is a Build step in its own right and **is** bindable. A step this release does not know is recorded with a warning, because your file wins. `unbind` drops the line and the step goes back to the engine's default. See [choosing the skill for a step](#choosing-the-skill-for-a-step). |
| `yad dial <step> [--to auto\|human]` / `yad dial <epic> <story> --repo <name> <step> [--to auto\|human]` / `yad kill --reason <text>` / `yad unkill [--reason <text>]` | **Set a step's advance dial, and the kill switch (E34).** Automation is no longer earned: the team sets the dial, and the engine shows the step's run record beside it as **advice, never a refusal**. With one word, `yad dial` sets a **Shape author step** for the whole project, in `.sdlc/automation.json`; that choice is **recorded, not acted on** — nothing drives a Shape step on its own until the engine runs agents. With an epic, a story and `--repo`, it sets a **Build lane step** (`spec`, `tasks`, `implement`, `checks`) in `build-state/<story>.json`, writing both dial names, and prints that step's run record in that repo (runs, % `approved-unchanged`); the `yad-run` skill then moves past the step on its own after a clean run. No `--to` only reads, and a gate asked that way answers `human` — it is always a person. The Foundation steps are Product-level and refused. A review gate — the engineer review and every Shape review — is refused, and so is a lane step `yad-run` has not written yet, an undeclared repo and a skipped lane. `yad kill --reason` holds **every** step at `advance: human`, recorded with who, when and why in `.sdlc/automation.json`; `yad unkill` lets each step follow its own dial again, keeping the record it replaces as `kill.previous`. An `automation.json` that will not parse is read as the kill switch ON, and neither command writes over it. `--json` on all three. `yad next` says when a dial is held by the kill switch, and that a Shape `auto` is only recorded. The old `kill_switch` line in `_bmad/sdlc/config.yaml` is no longer read — `yad doctor` fails on one left `true`. |
| `yad mode` / `yad mode solo --reason <text>` / `yad mode team [--reason <text>]` | **Who must approve (E10).** Solo mode waives the approval requirement on every review gate — the merge and the resolved threads still decide — and team mode counts approvals. With no word it reads the mode the gates act on and the last change; in solo mode it also counts the active people and suggests `yad mode team` when more than one person may work on the Product (E74 — a suggestion only, see [When solo mode may be wrong](#the-pr-driven-review-gate)). `yad mode solo` needs `--reason`, because every open gate stops counting approvals, CI's included on a verified Product; `yad mode team` takes one optionally. The change is recorded as `mode_set` (`from`, `to`, `by`, `date`, `reason`) in `.sdlc/product.json` / `hub.json`, and `mode: solo\|team` is written beside the `solo` flag — `solo` is still the one the gates read this major. **Nothing looks back:** a gate that already passed keeps its record, and the command names each open review, which follows the new mode from its next sync. A gate that passes in solo mode records `waived: "solo"` on its closing record, and `yad gate status` prints it. On a verified Product the open reviews live on the platform, so it says that every open review PR/MR follows the new mode from its next CI run, and `--json` carries `openReviewsKnown: false`. The Product config that is read (`hub.json` while it exists) is never written over when it will not parse. `--json` for both. |
| `npx yadflow check` | Read-only report: what is **missing** / **outdated** (drifted) / **modified** (a managed file *you* edited — see [managed files](#managed-files-what-yad-owns-and-what-you-edited)) / **stale** (code-context) / **legacy** (pre-2.0 `sdlc-*` names) / **removed** (a skill dropped in a later release that still lingers in the install) vs the bundled manifest. |
| `npx yadflow check --fix` | Reconcile: fill what is missing **and** update what changed — touches nothing already correct, and never overwrites a managed file reported as `modified`. |
| `npx yadflow update` | Apply drift only (alias for `check --fix --scope=changed`). Also migrates a pre-2.0 install in place: `sdlc-*` skill copies and marker-owned `sdlc-*.yml` CI files are replaced by their `yad-*` names (a same-named file *you* authored is never touched), **and** purges any skill removed in a later release that a prior install left behind. A gate script or CI file a newer release **adds** to a repo's wiring is installed on every repo that is already wired (reported as `new`); a wired file you deleted on purpose stays deleted (the provenance record proves yad wrote it — on a repo wired before that record existed, 3.16.0, the first update re-adds such a file once; delete it again and it is recorded and stays gone), and a repo with none of its wiring is left for `yad check --fix`. A managed file you edited is reported and **left alone**; `--overwrite-local` replaces it after saving a `<file>.yad-orig` backup. |
| `npx yadflow update --push` | Everything `update` does, **then commits each repo's applied changes and pushes them straight to the default branch** of the Product and every connected repo — one `chore(yad-update): sync SDLC install to yadflow vX.Y.Z` commit per repo, so a version upgrade "just lands" instead of leaving dirty trees to hand-commit across N repos. Stages an **explicit per-repo allowlist** (never `git add -A`); commits **only on each repo's default branch** (a repo on a feature branch is **skipped with a warning**, never disrupted; `--allow-branch` overrides). No PR/MR — so the `pull_request`/`merge_request` gate suite never fires; the push-on-default-branch **`yad-update-guard`** workflow/fragment runs **only** `verified-commits` + `commit-message` over it (deliberately **no** `[skip ci]`). Prints an announce banner first — **announce the team & pause merges until it completes**. Also spelled `check --fix --push`. |
| `npx yadflow doctor [--json]` | Environment + state health: tools on PATH and platform auth, config files parse and point at real repos, every epic ledger loads, **each epic's `contract-lock.json` still matches its surface**, and **no completed review gate is left holding no approval (fail) or only stale ones (warn)** — solo mode waives the first, since approval is waived there by design. It also **warns** when people data an older release wrote is still on disk and no longer decides anything — a `roster` (`people:roster-unused`; its name → login pairs let a gate write record the login on older approval and comment records, and the hint counts the records still waiting — and in which epics — or says it is safe to delete; `people:roster-ambiguous` names a roster name given to two logins; `people:allowlist-gate-stale` names an older `checks/verified-commits.sh` that still enforces the author list), repo `domain_owner(s)` (`people:domain-owners-unused`) or an author allowlist (`people:verified-authors-unused`); it never deletes them. In solo mode it counts the active people and warns `mode:suggest-team` when more than one person may work on the Product, or when the people could not be counted (E74). Exit 1 on any failure; `--json` for CI and bug reports. |
| `npx yadflow migrate [--apply] [--json]` | **Move this project's state files onto the shape this yadflow expects.** Prints a table of what *would* change and writes nothing until `--apply`, which copies every file it rewrites to `<file>.yad-orig` first. Safe to run twice — the second run reports there is nothing to do. A file newer than this engine, or one that does not parse, is reported and never touched (exit 1). In `verified` mode the CI-owned gate ledger is skipped and named: CI stamps it on its next sync. See [file shape](#file-shape-schemaversion). |
| `yad report [-m <text>]` | **Self issue reporter.** File a bug in the yadflow repo with **auto-scrubbed** diagnostics — only the yadflow/node/os version, tool present+authenticated booleans, the Product platform enum, the error code/hint, a path-scrubbed message, and the failing command + flag *names*. Never posts paths, hostnames, git URLs, repo names, logins, epic IDs, branch names, or flag values. Searches open issues first (dedupe), shows the exact payload, and asks before posting; files via an authenticated `gh`/`glab` or a prefilled `issues/new` URL. Also **offered automatically** after an unexpected failure (interactive only). `YAD_NO_REPORT=1` (or `SDLC_NONINTERACTIVE`) disables it. |
| `yad usage` | **Team-member usage & behavior report (for an EM/team-lead).** Reconstructs each contributor's audit trail — *authored / commented / approved / shipped*, in order — entirely from data **already in git** (the approval/comment/ship ledgers + git authorship), then renders it as a portable **HTML** report (also `--format json\|md`). Derived and **read-only**: it hooks no commands and writes no tracked state (rebuildable any time, like `yad-status`). Flags: `--out <path>` (default `./usage-report.html`), `--since <YYYY-MM-DD> --until <YYYY-MM-DD>` or `--all`, `--member <name>`, `--repos` (include connected-repo commits). Surfaces factual **workflow-hygiene** flags (e.g. a ship with no recorded engineer review) — never a judgmental score. Emits **no emails, commit messages, or comment bodies**. People come from activity, not from a stored list: a ledger event is attributed to the name it records (an older record under a roster name is read through the roster's name → login table, as `yad gate sync` reads it), and a git commit to its author — or to the login a GitHub/GitLab noreply address carries, which joins it to that login's approvals. Someone whose git name differs from their login may appear twice. |
| `yad gate open <epic> <artifact>` | Open the Shape **review PR/MR** for an artifact and mark the step `in_review` (in verified mode CI owns the ledger, so it only opens the PR). The `review/<epic>/<artifact>` branch must already be **on origin** — it does not create or push one; `yad open-pr`, run from the branch, pushes it and then delegates here. For an epic's **first** gate, cut that branch from the authoring branch (`epic/…`, `change/…`) so the PR/MR carries the `.sdlc/` **seed**: no CI path can create a ledger, so `ledger-guard` exempts a new epic's ledger there — creation, not mutation (#162) — and it lands on the default branch at merge. |
| `yad gate sync <epic> [artifact] [--pr <n>]` | Pull the PR/MR's reviews + comment threads into the file ledger; **auto-advance** the step when approvals are satisfied, all threads are resolved, and the PR is merged. With no PR recorded in the ledger (the normal bridge case, where CI records it only at merge) it resolves the PR from the `review/<epic>/<artifact>` branch; `--pr <n>` names one outright and overrides a stale recorded pointer, after confirming the number really is that branch's PR. In **verified mode this stays advisory** — the writing recovery is `yad gate ci … --merged`. |
| `yad gate comments <epic> [artifact]` | Fetch the unresolved review comments to address (then reply on the PR; reviewers resolve their threads). |
| `yad gate status <epic>` | Show each review step, its recorded approvals, how many distinct people they came from, that step's approval count (the base holds the gate; a risk step is advisory, shown capped by the active people), and how a closed step closed (when, on which PR, who merged it, and whether the cap lowered its ask). In solo mode it also suggests `yad mode team` when more than one person may work on the Product (E74, see [When solo mode may be wrong](#the-pr-driven-review-gate)). |
| `yad gate approve <epic> <artifact> --by <name> [--engagement verified\|none]` | **The review gate on a Product with no platform (E112).** Records one approval in `approvals.json`, bound to the artifact's fingerprint (`artifactHash`), so an edit to the artifact revokes it as it revokes a platform approval. One record per person: a second approval by the same name replaces the first, and the same content approved again changes nothing. Writes the ledger only — the dated `reviews/*--approved.md` record is the `yad-review-gate` skill's. Prints the verdict; **never advances** — that is `yad gate advance`, a second act, the way approving a PR never merges it. Warns (never refuses) when `--by` is the epic's `owner:` or the artifact's last git author. The review must be open (`yad gate open`); a step already passed still records the approval against today's content. `--by` is refused if it holds a line break, a control character or a space at either end, because it is printed on other people's screens. **Refused with a platform** — the approvals are the PR/MR's; run `yad gate sync` (on a verified ledger, CI writes them at merge). `--json`: `approver`, `changed`, and the `gate` verdict. |
| `yad gate comment <epic> <artifact> --by <name> [--count <n>] [--new-round]` | **No platform only (E112).** Records who commented, and how many comments, in `comments.json`: one record per `(step, commenter, round)`. The round is the step's latest (or 1), or the next one with `--new-round`, after the owner addressed the last round — but only when the artifact has changed since the latest round was opened (a round keeps the fingerprint it was opened with, and a record joining it later carries the same one; a round written before E112 has none, so `--new-round` always opens the next round after it), so a retry, or a second reviewer who also types it, joins the round instead of opening one that never happened. A name that differs from one already on the step only by case is refused, for `approve` too: one person, one spelling, or the gate would count them twice. The words stay in `reviews/*--comments.md`, which the `yad-review-gate` skill writes. A comment never holds the gate here — with no platform there are no threads to resolve. Refused with a platform, as `approve` is. `--json`: `commenter`, `round`, `count`, `changed`. |
| `yad gate advance <epic> <artifact>` | **No platform only (E112).** Runs the gate check on the recorded approvals and, when it passes, advances the chain with the engine's one advance function (the one a merge runs through `yad gate sync`): the review step is `done` with a closing record `via: "approved"` (no PR, no commit), its author step is closed `via: "review-passed"`, a debt is cleared, and the next step opens. In solo mode no approval is needed and the record says `waived: "solo"`. When the check fails it writes nothing, exits 1 and lists what is missing. A review not opened yet is refused (`yad gate open` first), and so is a step already passed (the chain is one-way) or deferred (`yad undefer` first). Refused with a platform — the merge is the advance there. `--json`: `advanced`, `currentStep`, and the `gate` verdict. |
| `yad gate repair <epic>` | Close an authoring step left stranded behind a review gate that already passed (`YAD-STATE-005`). Writes only `state.json`. `--push` commits it to the default branch with a `chore(gate): repair…[skip ci]` audit-trail message (`--allow-branch` to override the default-branch guard, `--dry-run` to preview). |
| `yad gate ci [--branch <head>] [--pr <n>]` | The CI entry the Product workflow calls **at merge** (and from its scheduled reconcile — nothing fires pre-merge, where the platform PR/MR holds the review state): derive the epic/artifact from the `review/EP-*` branch, run the same sync, and commit **only the ledger** to the Product default branch. On a merge run it also records the platform login on older roster-era approval and comment records in **every** epic, including one with no open review (E64), skipping an epic with uncommitted changes under `.sdlc` or `reviews`. **One exception, once:** on a verified Product it also moves an old-spelling product level (`epics/EP-discovery/` → `foundation/`, shape 8) after its jobs, under the commit subject `chore(gate): move the product level to foundation/ (shape 8)` — only on the default branch, only once the product level's own review has passed, never from a checkout with uncommitted changes under either folder, and not while the checks committed in the repo predate the Foundation (docs/migrations/shape-8.md). A later merge of a `review/EP-discovery/*` branch finds the moved ledger in `foundation/`. The wired jobs always name a branch: they discover merged reviews through the platform API and call `--branch <ref> --pr <n> --merged` per review. With no `--branch` it falls back to a local sweep of the review PRs *already recorded in the ledger* whose step is not yet `done` — it does no platform discovery of its own, so a review the ledger never saw is only reachable by naming it. **Idempotent down to the bytes:** the ledgers are written in a canonical order, so re-syncing an already-`done` step (what the 15-minute sweep does for a week after every merge) produces a byte-identical file and commits nothing. Before the #163 fix the re-sync re-appended each step's approvals at the tail, so a sweep over N merged reviews rotated `approvals.json` and committed the reorder on every pass — an unbounded commit loop (#163). |
| `yad commit --type <t> -m <subject>` | Commit by the SDLC convention — Conventional subject, `Task`/`Contract-Change`/`Co-Authored-By` trailers, atomic-file guard. |
| `yad open-pr [--repo <name>]` | Open a **task** PR/MR from the platform template (Build). **The base is resolved, never assumed:** `--base` → the repo's `default_branch` in `.sdlc/repos.json` → (for a Product PR) `hub.json`'s `default_branch` → the platform's own default (`gh repo view --json defaultBranchRef` / `glab api projects/:id`) → local `origin/HEAD` → `main` — the same configuration-outranks-the-remote order `yad repo sync` and the contract-check gate use. It prints which rung answered, and **warns (never blocks) when the base is not the platform default**: CodeRabbit decides auto-review eligibility from the base at PR-**open** time, so a mis-based PR gets no AI first pass and retargeting afterwards does not undo it (#168). **Stage-aware on the Product:** a `review/EP-*` branch opens the Shape artifact-review PR (delegates to `yad gate open`), first warning when that step's files have changes no `yad fold` has committed (E44); any other Product branch uses the code-task template (so Product tooling PRs pass the `pr-template` gate). **Once a code-repo PR is open it prints how many approvers it asks for** (E66): the larger of the body's level (`--risk`, `--contract-change`) and the risk map on `origin/<base>` — see [The risk map](#the-risk-map-a-level-per-directory). Printed only; the body keeps the author's level. On a code-repo PR it then prints a **reviewer suggestion** (E68): who has committed in the touched folders in the last 30 days, and what CODEOWNERS lists — a hint, never a request (see "Who may know this code" at the end of [The risk map](#the-risk-map-a-level-per-directory)). |
| `yad ship --type <t> -m <subject>` | Commit **and** open the task PR/MR in one step (`yad commit` then `yad open-pr`) — stage-aware, same as `open-pr`. |
| `yad checkpoint [--push]` | Commit the **machine-written Build state on the Product** — `trust-log.json`, `build-log.json`, `build-state/<story>.json` — **plus any story `status:` flip** (`approved → in-build/shipped`) that now has a `build-log` ship, as one `chore(hub): sync Build state — <epic>/<story> by @<login>` audit-trail commit (no `Task` trailer, no AI footer). The Build analogue of `yad gate ci`: it stages **only** those ledgers + ship-backed story flips by an explicit allowlist (never a Shape gate file, so `ledger-guard` never trips) and commits **only on the default branch** (so the commit never enters a PR range where its `[skip ci]` would strand checks). Carrying the story flip is what keeps the story artifact from drifting from `build-log.json` — so no operator ever falls back to a raw `git push origin main` (#112). A **no-op** when nothing changed; `--push` lands it on `origin/<default>`; `--allow-branch` overrides the default-branch guard. The SDLC Build (`yad-run`, `yad-engineer-review`) calls it so teammates never have to hand-commit machine audit state. |
| `yad checkpoint --retro-ship <epic>/<story> --repo <r>` | Reconcile a **pre-tracking** story — merged and shipped **before** the Build ledger existed, so it has no `build-log` ship and plain `checkpoint` can't carry its `status: shipped` flip (#142). Records **one** retroactive ship shard marked `retroactive: true` (`--task <t>` overrides the default `retro` sentinel; `--merge-commit <sha>` records the SHA — never invented; `shippedAt` is the backfill date), then runs the normal checkpoint so the story's already-made flip rides the **same** `chore(hub)` commit. **One repo per run:** a story that shipped in several repos is recorded by re-running once per `--repo` (the flip rides the first commit; each later run lands only its own shard) — the guard is per **(story, repo)**, so recording one repo never locks out the rest (#166), and after each run it names the story's declared repos that still have no evidence. Because a ship is permanent audit evidence, `--repo` must be one the story's `repos:` frontmatter declares (or, when it declares none, one the Product's `.sdlc/repos.json` connects) — a typo'd or invented repo is **refused**, not recorded — and a name that would share a build-log **shard filename** with an already-recorded repo (`api.v2` vs `api_v2`, both sanitized to `api_v2`) is refused too, so a retro ship can never overwrite another repo's record. **Refuses** when the story already has a ship **in that repo** (then it isn't pre-tracking there — use the normal flow); does **not** author the story frontmatter and **refuses unless you have already set a Build `status:`** — `in-build` or `shipped` — (so a ship is never committed while the artifact still says `approved` — evidence and flip stay atomic); `--push`/`--allow-branch`/`--dry-run` behave as for `checkpoint`. **Where the record lands:** like every ship, it is written as a **shard** under `.sdlc/build-log/` — the folded `.sdlc/build-log.json` is *not* appended to (that is what would make concurrent shippers conflict). Readers **union** the folded file with every shard, so the ship is fully visible immediately; `yad tidy up` folds it into `build-log.json` once the story is `shipped` (a backfill against an `in-build` story stays a loose shard until then). An empty `build-log.json` right after a backfill is the design, not a lost write (#167). This is the supported alternative to a raw `git push origin main` for a legacy shipped story. |
| `yad capture [--no-push]` | **Background capture of Shape artifacts (E43).** Commits every changed file under `epics/` and `foundation/` — except the ledger (any `.sdlc/` folder and `reviews/`; `contract-lock.json`, `change.json`, `design-links.json` and `test-links.json` are included) — onto a private branch per epic, `yad/wip/<git user.name, made branch-safe>/<epic>` (a name with no Latin letters falls back to the git email's local part, then to a short fingerprint). A Product in a subfolder of its repository works the same. Built with git plumbing in a throwaway index, so the checkout, the staged changes and the current branch are never touched, and no git hook runs. A capture with nothing new commits nothing. Each commit is `wip(<epic>): capture` with `Yad-Epic`, `Yad-Base` (the HEAD it was built on) and `Yad-Branch` lines, unsigned on purpose; the ref moves by compare-and-swap, so two captures at once cannot lose each other's. A branch whose edits were undone is captured back to what is on disk, but only while HEAD is still the one it was captured from. Then it pushes every `yad/wip/<you>/*` branch — a plain push, never forced, so a branch someone pushed from a second machine is refused rather than overwritten, and named as stuck until one copy is deleted (`git branch -D` here, then `yad capture` continues origin's); with no local branch, a capture continues origin's, and a capture by hand fetches your capture branches first (`--no-verify`, no prompts); `--no-push` skips that. No remote: local only, said, never a failure. **`--hook`** is the harness's post-edit form (wired by `yad check --fix` in both ledger modes: Claude Code `PostToolUse`, Cursor `afterFileEdit`): it always exits 0, prints nothing to stdout — except, with `--format claude`, one PostToolUse JSON note when an edit changed a file someone else has a claim on (see `yad claims`) — and starts the push, and a fetch of everyone's capture branches, in the background at most once every 5 minutes. Off with `"capture": false` in the Product config or `YAD_CAPTURE=0`. `--json`: `name`, `captured` (`epic`, `branch`, `commit`, `files`, `changed`), `unchanged`, `errors`, `pushed`, `off`, `claims`. |
| `yad claims [<epic>] [--no-fetch]` | **Who else is editing which artifact (E46) — advice, not a lock.** Read from the capture branches, with nothing recorded by hand: a claim is a file of the epic that differs between a `yad/wip/<name>/<epic>` branch's last save and its `Yad-Base` (the person's own edits, never what a pull brought in; when that commit is not in this clone, the previous save is used and the claim says `basis: parent`). A claim ends 4 hours after the branch's last save, or at once when the file on the default branch matches it. Fetches `+refs/heads/yad/wip/*` and the default branch first (`--prune`, 30 s, no prompts); `--no-fetch` reads what is here; with no remote it reads only your own. The capture hook warns when an edit changes a file someone else has a claim on — as PostToolUse JSON the agent reads under Claude Code (`--format claude`, passed by `hooks/yad-capture.sh` when `CLAUDE_PROJECT_DIR` is set), on stderr elsewhere — at most once an hour per person and file; its background push also fetches everyone's capture branches. `--json`: `fetched` (`done`, `failed`, `local`, `skipped`), `expireHours`, `defaultBranch`, `claims` (`path`, `epic`, `name`, `person`, `lastSavedAt`, `mine`, `basis`). |
| `yad fold <epic> <step>` | **The step-boundary commit (E44).** Commits ONE authoring step's files as `docs(<epic>): author <step>` with `Yad-Epic`, `Yad-Step` and `Yad-Folded` (the capture branch's tip, or `none`) lines. The files: the ones the step's review covers, plus what its skill writes beside them (`DESIGN.md` + `.sdlc/design-links.json` for `ui-design`, `.sdlc/test-links.json` for `test-cases`); the epic's other changed artifacts are named and left on disk. `ledger: local`: the epic's changed ledger files go in the same commit. `ledger: verified`: ledger changes are left for CI, except a brand-new epic's (no `.sdlc/state.json` in HEAD) new ledger files — its seed, which `ledger-guard` allows; refused on the default branch and on a detached HEAD, and it warns when commit signing is off. While the epic is brand new, its new person-written `.sdlc/` files (`change.json`, a pointer `contract-lock.json`) ride the fold too, in both modes. Runs one quiet capture first, then a normal `git commit --only` — signed when git signs, commit hooks run, anything else you staged stays staged. The capture branch is left alone. Steps: `foundation` (epic `EP-foundation`), `discovery`, `analysis`, `epic`, `architecture`, `ui-design`, `stories`, `test-cases`. Refused when the step's files have no changes. `--json`: `epic`, `step`, `commit`, `subject`, `branch`, `folded`, `files`, `seed`, `ledger`, `leftForCi`, `leftOnDisk`. |
| `yad tidy up [<epic>] [--push]` | Fold a **shipped story's** finished `trust-log`/`build-log` **shards** back into the single folded ledger file, as one `chore(hub)` commit — the manual "pack it up" companion to the shard-then-fold storage (like `git gc` for its loose objects). Concurrent Build writers each write their own shard file (so parallel stories of one epic never conflict), and readers union the folded file + loose shards; `tidy up` is the on-demand compaction. A fold reads shards, merges them, then deletes them, so it holds the ledger's exclusive lock for that whole span — a ship written or stamped mid-fold can never be folded away without its change, or deleted without being folded (`YAD-STATE-006` if another writer holds it). Default branch only; `--push` lands it on `origin/<default>`; a **no-op** when nothing is foldable. |
| `yad index [--json]` | **Rebuild the Product index, `.sdlc/index.json` (E19)** — one summary per work item, so a reader opens one file instead of walking `epics/*`. The index is **derived**: it is rebuilt from each item's own `.sdlc/state.json`, `epic.md` and `.sdlc/change.json`, and never edited by hand. It is written **on the default branch only**, with no override, and the command never commits it: commit it with the change it describes. On a **verified** Product it writes nothing, because CI rebuilds the index in the commit that records a merge. `--json` prints the index built live from the files, on any branch, and writes nothing. See [the Product index](#the-product-index-sdlcindexjson). |
| `yad history [list\|show\|search]` | **What the Product has done (E20)**, read live from each work item's own files, on any branch, writing nothing. `list` shows every work item, open and shape-done (its Shape steps closed; Build is not counted), newest first, with `--type`, `--theme`, `--thread`, `--open` or `--done` to narrow it. `show <id>` prints one item's steps with their closing records and the approvals recorded for each review step. `search <text>` finds text in ids, titles, themes, types and repos, and in who closed or merged a step, its PR and its commit. `--json` on all three. See [Work-item history](#work-item-history-yad-history). |
| `yad repo list` / `yad repo refresh [name]` | List connected repos as **fresh / stale**, and re-pack a stale one — staleness is now an explicit human decision, never an automatic skill side-effect. |
| `yad repo refresh [name] --push` | After the re-pack (and the AI regenerating the code-map), commit the tracked code-maps + `.sdlc/repos.json` as an audit-trail `chore(hub): sync code-context … [skip ci]` commit and push it straight to the Product's **default branch** (`--allow-branch` to override). The code-context analogue of `yad checkpoint`. |
| `yad risk-map check [repo] [--json]` | Check a code repo's **risk map** (`.sdlc/risk-map`: a risk level per directory, no names — see [The risk map](#the-risk-map-a-level-per-directory)). Warns about a directory no line covers, a line whose directory is gone, a line still `unset` or `guessed`, and a line it cannot read. `repo` is a name from `.sdlc/repos.json` or a path; with none, every connected repo — or the current directory, but only when there is no `repos.json` at all (an empty or unreadable registry is refused, so a map is never written into the Product). **Advisory:** it never sets a failing exit code for a warning. The PR check `checks/risk-map-check.sh` says the same about one change. |
| `yad risk-map draft [repo] [--dry-run]` | Add an `unset` line for every directory the map does not cover, creating the file when there is none. **Never changes a line that is already there.** A directory whose name a line cannot hold (a space, `#`, `*`, `?`, `[` or `\`) is covered by its parent's line instead, or — at the top level — named as not added. Refuses a map written for a newer version. The levels themselves come from the `yad-connect-repos` skill, which has your AI agent read the code. |
| `yad codeowners check [repo] [--json] [--platform github\|gitlab]` | Warn where a code repo's **CODEOWNERS** file looks stale — see **Is CODEOWNERS stale? (E69)** under [The risk map](#the-risk-map-a-level-per-directory). Facts: a line that matches no file, a second CODEOWNERS file the platform never reads, a GitHub file of 3 MB or more, a line yad cannot read. Plus one hint: the `@logins` with no commit in the last 90 days that carries their `noreply` address. `repo` works as in `yad risk-map check`. **Advisory:** it never sets a failing exit code for a warning, and it **never writes the file** — there is no `--write`. |
| `yad repo sync [name]` | Switch every connected repo to its **default branch** and fast-forward it from origin (one or all). Dirty repos are skipped, never overwritten; fast-forward only. |
| `yad thread [<epic>]` | **Feature threads.** No arg: list every thread. With an epic: show its thread (genesis → changes → defects), the **resolved current-truth** map (which epic owns each artifact now), and any open hotfix debt. `--json` for tooling, where each node carries its work-item `type`, its grouping `theme` and the lifecycle `phase` its current step is in. Read-only. |
| `yad reconcile [check\|refresh\|wire]` | Sweep threads for **drift / orphans / open hotfix debt** and report which thread drifted and why (mirrors `yad docs sync`; advisory — the CI gates block at merge). |
| `yad docs [list\|build\|deploy\|sync] [--epic <id>\|--overview]` | **The generated documentation sites** (the per-epic `docs-site/` and the overview `docs/sdlc-site/`). `list` shows each site and whether it is stale. `build` runs `npm install` (or `npm ci` when there is a lockfile) and `npm run build` in each site; `deploy` does the same, then points at the Pages CI workflow that publishes on push. `sync` checks which sites are stale (`--check`, the default), rebuilds the stale ones (`--refresh`), or installs the Pages CI workflow (`--wire`). **A failed build exits 1.** Every site is tried, even after one fails, and the command exits 1 at the end if any failed: a failed `npm install` or `npm run build`, or a site named with `--epic`/`--overview` that was never generated. npm missing from PATH fails `build`, but is only a warning for `deploy` and `sync --refresh`, because the CI workflow builds on push. `list` and the `sync` check only read, so they never fail on a site; a site that was never generated reads as stale there. `--json`: `build`/`deploy` answer `built` (how many sites built) and `sites: [{ site, built, error }]` — `error` says why a site was not built, or is null; `sync` (check or `--refresh`) answers `stale`, `built` and `sites: [{ site, stale, built, error }]`, where `built` is null when no build was tried; `sync --wire` answers `wired`, the workflow file it wrote. `list` answers `target` and `sites` as a list of names — the same key holds names there and rows elsewhere, so read `command` first. A failed build is a refusal whose `error` names the site; a second failure is in `warnings`. Before 4.0 a failed build exited 0. |
| `yad hook ledger-guard` | **Harness-invoked, never typed.** The local half of the `ledger-guard` rule: in verified mode the gate ledger is CI-owned, so an agent that hand-edits `epics/*/.sdlc/state.json` is refused **at the moment of the edit** and told the command that owns the transition (`yad gate open`) — instead of discovering it twenty minutes later in a failed pipeline (#171). Reads a tool-call payload as JSON on **stdin** (or `--path <p>`). Two answer protocols: by default **exit 0 allows, exit 2 denies** with the reason on stderr, which is Claude Code's `PreToolUse` contract; with `--format cursor` the verdict is JSON on **stdout** instead (`{"permission":"allow"}`, or `{"permission":"deny","user_message":…,"agent_message":…}`, both exiting 0), because Cursor's `preToolUse` is a permission hook that treats an empty or off-schema answer as a refusal — the exit protocol there would block every file write. The `.cursor` wiring points at `hooks/ledger-guard-cursor.sh`, which speaks it; never wire `hooks/ledger-guard.sh` into Cursor directly. Same scope as the CI gate, including the new-epic seed exemption (#162); a **no-op** with a local ledger. **Fails open** — no `yad`, no Product, an unreadable config all allow, because the CI gate is the one that fails closed. `YAD_HOOK_DISABLE=1` skips it. Wired by `setup` / `check --fix`; `yad doctor` reports whether it is armed. |
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

### `--json` on every command (E1)

`--json` is a flag on **every** command except `yad hook`. It turns the command's answer into one
JSON object on stdout (standard output), which a script, a CI job or an app can read. This is the
engine's machine door (rule 8: `--json` and, later, MCP — nothing else).

**One envelope.** Every answer, from every command, is one object with the same five keys around the
command's own keys:

```jsonc
{
  "jsonVersion": 1,            // the number of THIS format — see "What moves the number" below
  "version": "4.0.0",          // the yadflow package that answered
  "command": "gate status",    // the command as typed, with its action (`history show`, `skill list`)
  "ok": true,                  // true exactly when the exit code is 0
  // …the command's own keys, at the top level (`epic`, `gates`, `actions`, …)
  "warnings": []               // every warning the run printed, as plain text
}
```

A **refusal** (the command would not, or could not, do what was asked) has `"ok": false` and always
carries three more keys, so a reader never checks whether one exists:

```jsonc
{ "jsonVersion": 1, "version": "4.0.0", "command": "unskip", "ok": false,
  "error": "ui-design is not skipped",   // what went wrong, in one line
  "code": "YAD-STATE-004",               // the error code (see Troubleshooting), or null
  "hint": "nothing to un-skip",          // what to do next, or null
  "warnings": [] }
```

`"ok": false` **without** `error` is an answer, not a refusal: the command ran and its answer is "no"
— `yad doctor` found a failing check, `yad next --check` found the step blocked. The exit code is 1
in both cases, exactly as without `--json`.

**A refusal still says what was done.** When a command did part of its work before it failed, the
refusal carries that too. `yad ship` whose push failed answers `"ok": false` with the push error **and**
`"committed": true`; `yad checkpoint --push` and `yad tidy up --push` do the same. Read `error` for what
went wrong and the other keys for what already happened.

**The rules every command keeps:**

| Rule | What it means |
|---|---|
| One object on stdout | Under `--json`, stdout holds the answer and nothing else. Every other line — progress, `✓`/`!` lines, a subprocess's output (`npm run build`) — goes to **stderr** (standard error). Parse stdout; show stderr to a person if you like. |
| Same exit codes | `--json` changes the rendering only. A command exits 0 or 1 exactly as it does without the flag — with one exception that is older than E1: `yad index --json` is a read and never writes, so it answers (exit 0) on a branch where `yad index`, which writes the file, refuses (exit 1). |
| A failure is still an object | A flag with no value, an unknown command, a thrown error, a refusal — each is one refusal object. An empty stdout never happens. |
| No prompts | A `--json` run never asks a question. A command that would have to ask is refused with `YAD-CLI-001` at that question. Only some of `yad setup`'s questions have a flag (`--solo`/`--team`, `--greenfield`/`--brownfield`, `--monorepo`/`--separate`, `--tools`, `--ide-targets`); the rest do not, so a scripted `yad setup --json` needs `SDLC_NONINTERACTIVE=1`, which takes the usual defaults, as without `--json`. A refusal can come after an earlier step has already written. |
| Never posts for you | `yad report --json` prints the scrubbed payload (`title`, `body`, `labels`, the prefilled `url`, `related` open issues) and never files an issue. |
| Always-JSON bundles | `yad gate review`, `yad gate walkthrough`, `yad review context` / `chat` / `cards` / `walkthrough` answer in this envelope with or without the flag — a skill parses them. |
| `yad hook` takes no `--json` | Its stdout is already the protocol Claude Code and Cursor read. `yad hook … --json` is refused. |

**What moves the number.** `jsonVersion` is the contract's own number, starting at 1. **Adding** a key
keeps the number, so a reader must ignore keys it does not know. **Renaming or removing** a key, or
changing what a key means, bumps it — and that is a breaking change of yadflow itself. `version` is
the package and moves every release; the state-file `schemaVersion` describes files on disk and
appears in an answer only where the answer IS a file (`yad index --json`).

**What moved in E1 (a breaking change).** Before E1 each command chose its own shape. If a script read
one of these, update it:

| Command | Before | Now |
|---|---|---|
| `yad next`, `yad doctor`, `yad migrate` | `version` first, no `jsonVersion` | the envelope; a refusal gains `code` and `hint` |
| `yad history` | `schemaVersion` (the file shape) | `jsonVersion`; no `schemaVersion` |
| `yad index` | `schemaVersion` first | the envelope around the file's own keys, `schemaVersion` kept among them |
| `yad thread`, `yad gate review` / `walkthrough`, `yad review context` / `walkthrough` | a bare object, no `ok` | the envelope; a bundle's error is a refusal object on stdout (it was a text line) |
| `yad dial`, `yad kill`, `yad mode`, `yad skill list`, `yad epic new`, `yad foundation`, `yad risk-map`, `yad codeowners` | `ok` without `jsonVersion`; some refusals without `hint` | the envelope |
| `yad foundation status` | `warnings` only when there was one | `warnings` always present |
| `yad docs build` / `deploy` / `sync --refresh` | a failed npm install or build exited 0 and answered `ok: true` — `{ action, built }` for build/deploy, `{ action, sync, stale }` for sync | exit 1 and a refusal naming the site; `sites` says what happened to each site (a change of the plain exit code too) |
| `yad usage --json` | the bare report model | the envelope around the model, plus `out`. `--format json` is a report FORMAT and still prints (or writes) the bare model |
| every other command | no `--json` | the envelope around what the command did |

What each command adds is the facts it prints: `yad gate status` a `gates` list (each review step's
state, approvals, people counted, the rule and its shortfall); `yad gate sync` the `gates` it read and
whether it wrote; `yad skip` / `defer` / `unblock` the step as the file now holds it; `yad commit` the
message, files and commit; `yad check` the `counts` and every managed `items` row; and so on. Read the
keys from one real answer — every key a command sets is always present, as `null`, `false` or `[]`
when there is nothing.

### `yad next --json` (the driver, machine-readable)

`yad next` renders coloured English, which is the wrong shape for the agents and CI jobs that drive
this workflow. `--json` emits the action object the router already computed. One envelope covers
every route, so a caller never branches on the output shape:

```jsonc
// Every answer is inside the E1 envelope (above); `…` stands for jsonVersion, version, command, and
// `warnings` closes each one.

// yad next --json  /  yad next <epic> --json
{ …, "ok": true, "actions": [ /* one per epic, the Foundation (EP-foundation) included */ ] }

// yad next <epic> --check <step> --json      (exit 1 when the step is blocked, as in prose)
{ …, "ok": false, "check": { "epic": "EP-x", "step": "architecture-review", "ok": false, "reason": "…" } }

// the project has no `yad setup` yet
{ …, "ok": true, "setUp": false, "actions": [] }

// bad epic id, or an epic with no state.json — a refusal
{ …, "ok": false, "error": "invalid epic id: …", "code": null, "hint": null }
```

Each action carries `epicId`, `kind`
(`new|author|review-open|review-sync|build|blocked|foundation-done|discovery-done|backfill-pending|backfill-done`), `step`,
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
**revoked when the reviewed artifact actually changes** (re-hash), giving reviewers a fresh pass. The
frontmatter `status:` line is not part of that hash: the gate flips it to `approved` at merge and Build
flips a story to `in-build`, and neither is an edit ([shape 9](migrations/shape-9.md)). With no
Product platform / no `gh`/`glab`, the gate degrades to local with no error.

**One approval rule, and no roles.** yadflow keeps no list of people (the roster was removed in E62):
anyone with access to the repo can approve, and each approval is recorded under the approver's platform
login. A step asks for `base + risk step` **distinct approvers**. The base is 1 — one human approval from
someone other than the author. yadflow does not compare the two: GitHub never lets you approve your own
PR, and GitLab stops it only when the project's approval settings say so. The risk
step comes from the step's own risk tags — `contract` +2, `auth`/`payments` +1, nothing +0, the highest
tag and never the sum. So an ordinary step asks for 1 approver and the architecture+contract gate asks for 3.

**Only the base holds the gate.** The base is always enforced, and for now it is the only part that is. A gate passes with one approver, and the rest of the
count is reported as a shortfall.

**The capacity cap (E72).** The engine caps the count at the number of **active people less one**, and
never below 1. It computes, prints and records the capped count, but does **not enforce** it yet. The
`− 1` is one seat left for the author — a seat, not a check: yadflow does not know who the author is, and
the platform decides whether they may approve.

| Active people | Contract gate: capped ask (full count 3) |
|---|---|
| 0–1 | 1 (never below 1) |
| 2 | 1 (one seat is left for the author) |
| 3 | 2 |
| 4 or more | 3 |

**Why the cap is not enforced yet.** The count of people reads high in the normal case. A commit is
counted by its git name, an approval by its platform login, and yadflow never joins the two without
exact evidence — so a two-person team can read as four. At four the cap lowers nothing, and an enforced
contract gate would ask three approvals of a team with one person who is not the author: a gate it could
never pass. A later yadflow change turns the capped count on together with `yad gate lower --reason`,
the way out of a gate that cannot be met, once the count is accurate.

**When a gate may not pass (E73).** `yad gate status` and `yad gate sync` print a warning line under a
team review gate that has not passed yet, when the count of people suggests the gate may not pass. It is a
**warning only**: it never holds a gate, never changes whether the gate passed, and writes nothing. There
are two kinds of line:

- `! may not be met: …` is about **today's rule**: the one approval that is always required (the base) may
  have nobody but the author to give it.
- `! if the risk step were enforced: …` is a **what-if**. Today only the base is enforced, so the gate can
  still pass, and the line ends by saying that nothing beyond the one enforced approval is needed today.
  It says what would happen if a later yadflow change enforced the extra approvals that risk tags add
  (the risk step). "The approvals asked" means the count after the cap. The cap limits the count to the
  active people less one, and never below 1.

Every line talks about **the people counted**, and says "may" or "if", because the count can be wrong both
ways. It is too low when a reviewer has not committed or approved inside the counting window (the same
window as the `active people:` line), because nothing in that window records them. It is too high when
one person commits with a work email (recorded as a name) and approves on GitHub (recorded as a login):
yadflow never joins a name and a login without proof, so that person counts twice.

| Kind | When it prints | Example line (a 90-day window) |
|---|---|---|
| Today | 0 or 1 active person counted, and no approval in the window | ``! may not be met: only 1 active person counted and no approval in the last 90 days, so if nobody but the author can approve, this gate cannot pass. Someone who has not committed or approved in the last 90 days is not counted. Another person's approval settles it, or use the recorded way out, `yad mode solo --reason` `` |
| Today | Exactly 2 people counted, one not matched to a platform login and one login, and no approval in the window. Example: one developer who commits with a work email and also through GitHub's web editor, which records the login | ``! may not be met: 1 of the 2 people counted is not matched to a platform login and may be the same person as the one login, and there is no approval in the last 90 days, so the team may be one person. Then, if nobody but the author can approve, this gate cannot pass. Another person's approval settles it, or use the recorded way out, `yad mode solo --reason` `` |
| What-if | The cap lowered the count, and the approvals do not show more people than were counted | `! if the risk step were enforced: with no cap, the full count of 3 is more than 2 active people can give (one seat is left for the author), so if nobody else joins, this gate could not pass. Nothing beyond the one enforced approval is needed today` |
| What-if | Some people are not matched to a platform login and at least one is a login, and the smallest possible team could not give the approvals asked | `! if the risk step were enforced: 2 of the 4 people counted are not matched to a platform login, and up to 2 of them may be the same people as the logins, so the team may be as small as 2. That leaves room for 1 of the 3 approvals asked, so if the team is that small, this gate could not pass. Nothing beyond the one enforced approval is needed today` |

A what-if line is not printed when a today line is. When the cap lowered the count, the last line says
"approvals asked after the cap", because the full-count line above it quotes the number before the cap.

"Not matched to a platform login" means yadflow knows the person only by a name: a git author name, or an
approval record that carries no login (an older hand-written one, or an engineer-review record, even when
it holds a login, because nothing in it proves that). Each such name may be a second row for one of the
logins, so the smallest possible team is the larger of the two groups: the logins, or the names. It is
never fewer people than the approvals prove.

**An approval is evidence.** Any approval in the counting window shows that approvals can be given, so no
today line prints. It also raises the smallest team a what-if line assumes: at least the approvals on this
step plus one (the author), and at least two people once anyone has approved anything. That assumes
authors cannot approve their own work: always true on GitHub, true on GitLab only when its settings say
so, and never checked on a Product with no platform. Where it is not true, the smallest team is guessed
too high, so a what-if line may stay quiet when it should speak; it never raises a false alarm because of
this.

A Product with no platform (every record is a name) gets no name line, because there is no login to
compare against. Two spellings of one name (`bo` and `Bo Chen`) still count as two people; no line can
see that yet.

No line prints in solo mode, under a step that passed, under a waived step (inherited from a parent epic,
skipped, or deferred), or when the people could not be counted. A line about the whole Product prints
once per command, under the first step it applies to.

Run `yad gate status` yourself while the review is still open: reviewers can still approve then, and a
merged review PR cannot take approvals. Do not wait for CI to show it. The wired Product workflow runs only
for merged review PRs (at the merge, and in a scheduled sweep of merged PRs), and it usually cannot count
people, because the connected repos are not on disk there.

**When the people cannot be counted, no cap is computed or shown**, and the base holds as always.
Product CI is usually this case: it checks out only the product repo, so on a Product with connected
repos the repos are not on disk.

When a **team** gate passes on its counted approvals while the cap lowered its ask, the step's closing
record gets `capped: { needed, to, active }`, beside `waived`. It records what the gate asked, not what
held it. It is not written in solo mode, where nothing was counted, nor on a step that passed by its
skip or inherited shortcut, where nothing was asked. The full rules are in
`skills/yad-epic/references/state-schema.md` (Closing records). `yad gate status` prints it as
`count capped from 3 to 1 (2 active people)`.

Four surfaces print the count with its cap: `yad gate sync`, `yad gate status` (the same sum after
the distinct-people count), the generated review-PR body and `yad open-pr`. `checks/risk-route.sh` and
`checks/hub-route.sh` print it without the cap, because they cannot count people. `yad gate sync` and `yad gate
status` share one suffix; the review-PR body and `yad open-pr` word the cap their own way. The shared
suffix names a cap only when it lowered the ask, and always says what holds: `— capped to 1: 2 active
people, less one seat for the author — base enforced, risk step advisory` (at 1 active person:
`— capped to 1: 1 active person (never below 1) — base enforced, risk step advisory`; at 0 it reads
`0 active people (never below 1)`), or just
`— base enforced, risk step advisory`. For example
`yad gate sync` prints `1 approved; count: 3 approvers = base 1 + contract risk 2 — capped to 1: 2 active
people, less one seat for the author — base enforced, risk step advisory`, and the review-PR body says
`Approvals needed: 1 (enforced) · full count 3 approvers = base 1 + contract risk 2, capped to 1 for 2
active people when this PR was opened (the risk step is advisory)`. `yad gate review --json`
carries the rule as an object under `step.gateRule`, and the cap under `step.cap` — an object
`{ active, limit, to, capped }`, where `to` is the count asked for after the cap and `capped` is true
when the cap lowered it. The whole `step.cap` field is `null` when the people were not counted.

**How many people are there to ask?** The engine counts that live, and prints it beside the ask
(`active people: 4 in the last 90 days — caps each gate's count at 3 approvers (one seat is left for the author); reported, only the base is enforced`). "Active" means committed or approved — read from the approval
and ship records, plus git authorship in the product repo and every connected code repo. The window
scales with how fast the team merges: the span of the last 20 merged pull requests, bounded to between
30 and 180 days, and the wide end when there are fewer than 20. Nothing is stored; it is counted fresh
every time.

If any source cannot be read — a code repo that is not on this machine, a shallow clone, a clone that is
behind, a file that does not parse, a date that does not parse — the answer is **`NOT COUNTED`**, never a
number, and the line ends `— no cap can be shown, and only the base holds each gate`. That is deliberate. A
small count lowers the number of approvals a gate asks for, so an unreadable input must never look like a
small team. The line names the first source that failed and
says how many others did.

Running `yad open-pr` from inside a code repo also reads `not counted`: the count is a fact about the
product and everything connected to it, and a code repo on its own cannot see that.

On a Shape gate the cap is **reported** (above). On the Build half — a code repo's task PR —
`yad open-pr` shows the count capped by the active people when run from the Product, and it stays reported even once the Shape cap is enforced: the
platform's branch protection holds a Build merge. `checks/risk-map-check.sh` and `checks/risk-route.sh`
cannot cap at all, because a code repo's CI has no product to count people from. `risk-route.sh` says so in
its output; `risk-map-check.sh` says so in its header comment.

Review PRs request no reviewers — ask them on the PR itself. A record's `by` (who wrote a skip, a
deferral or a closing record) is the login `gh api user` / `glab api user` reports, else your git
`user.name`; set `YAD_PLATFORM_LOGIN=0` to skip the lookup (for example offline). `YAD_PLATFORM_READ=0`
does the same for `yad doctor`'s read of each repo's branch protection.

**Solo mode.** A lone developer can't approve their own PR on GitHub, so an approval requirement would
deadlock them. Opt in (`yad setup --solo`, recorded as `solo: true` in `.sdlc/hub.json`) and the gate
**waives the approval requirement only** — the review PR/MR and its merge stay, so CI still runs on the
PR and the **merge** advances the step. Net: the gate passes on *merged + all threads resolved*. It's a
documented, reversible relaxation; `yad doctor` warns if the platform still requires an approval — in
classic branch protection, a GitHub ruleset or a GitLab approval rule. On GitHub that blocks the solo
dev's own merge unless they may bypass the rule, which yad does not read; on GitLab it may block it,
through a project setting yad does not read either (see [the `protection` section](#the-protection-section--does-the-platform-require-an-approval-e70)). Switch it later with `yad mode solo --reason "<why>"` or
`yad mode team`, which records who, when and why; each gate that passes in solo mode records
`waived: "solo"` on its closing record.

**When solo mode may be wrong (E74).** In solo mode, four commands count the active people (the same count
as the `active people:` line) and suggest team mode when the count shows more than one person may work on
the Product: `yad mode` with no argument, `yad gate status` (under the `active people:` line), `yad next`
(the project view, first) and `yad doctor` (the check `mode:suggest-team`, a warning). It is a
**suggestion only**: nothing is switched and nothing is written. Only a person switches, with
`yad mode team`. Team mode reads no new count, so it costs nothing new. In solo mode, `yad mode`,
`yad next` and `yad doctor` now read the git history of every connected repo once per run
(`yad gate status` already did, in both modes).

It suggests **team mode only, never solo mode.** Switching to solo mode removes every approval, and the
count of people is wrong in both directions, so a wrong "go solo" would weaken the gates without anyone
noticing. The E73 line `! may not be met: …` already names `yad mode solo --reason` under a team gate.

"The count disagrees with the mode" is the whole trigger. Nothing is stored, so the line repeats on every
run until someone switches or the evidence leaves the counting window. Either of these is evidence:

| Evidence | Why it counts | Example line (a 90-day window) |
|---|---|---|
| The smallest possible team is 2 or more. That is the larger of two groups: the platform logins, and the names not matched to a login (the same rule as E73's what-if line) | One developer who commits with a work email and through GitHub's web editor is 1 login and 1 name, so the smallest team is 1, and nothing prints. A team whose commits all use work emails is names only | ``! solo mode is on, but 3 different names not matched to a platform login committed or approved in the last 90 days, so more than one person may work on this Product. If so, `yad mode team` makes each review gate ask for approvals, which solo mode waives`` |
| Someone **with a platform login** approved a review in the window, and more than one person is counted | On GitHub an author cannot approve their own work, so such an approval shows a second person. An approval with no login (a hand-written one on a local ledger, or an engineer-review record) proves nothing here, because an author can approve their own work on a local ledger; it still counts as a name in the row above | ``! solo mode is on, but someone approved a review in the last 90 days, so more than one person may work on this Product. If so, `yad mode team` makes each review gate ask for approvals, which solo mode waives`` |

A person whose every record is dated after today (a mistyped year, for example) is left out of this
suggestion, and an approval dated only after today is not proof of a second person, so the line can
stop. Both still count for the `active people:` line.

When the count is unknown (a connected repo is not on disk, for example), nothing is suggested.
`yad mode` says so, with the reason: `the people could not be counted (<why>), so no switch to team mode
is suggested`. `yad doctor` says the same as a **warning**, with a hint to fix what could not be read.
`yad gate status` does not repeat it, because its `active people: NOT COUNTED` line already says it, and
`yad next` stays quiet about it. `yad mode --json` carries the same answer as `suggest`
(`{ known, line }`, or `null` in team mode).

**Known limits.** The line says "may", because each of these reads as more than one person when it is
not, or no longer is:

- one person with two platform accounts;
- one person whose git name has two spellings (`ada` and `Ada Lovelace`);
- a robot that commits under a plain name with no `[bot]` at the end (for example `semantic-release-bot`,
  or `github-actions` set by hand in a workflow), which counts as a name;
- a workflow that approves PRs automatically: GitHub reports a bot's login without `[bot]`, so its
  approval reads as a second person;
- on GitLab, an author who approves their own MR, where the project's approval settings allow it;
- someone who committed to a connected repo but cannot approve Product reviews;
- someone who left but is still inside the counting window (up to 180 days on a young Product);
- on a local ledger, one person's own approval recorded under a different name from their commits (it
  reads as a second name).

The other way round, a second person who has neither committed nor approved inside the window is not seen.

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
   CI/scripts with `--solo`/`--team <n>`, `--greenfield`/`--brownfield`, `--monorepo`/`--separate`, `--tools`,
   and `--ide-targets <a,b>` for step 2's directories (an unsupported name fails before anything is written).
1. **Preflight** — confirm the Product is a git repo (offers `git init`); check `git`/`node`/`npx`.
2. **Install the module** — copy the `yad-*` skills into the agent skill dirs you pick, and copy the
   module config to `.sdlc/config.yaml`. The prompt names the agents that read each directory:

   | Directory | Agents that read it |
   | --- | --- |
   | `.claude/` | Claude Code (Cursor also reads it) |
   | `.agents/` | Codex CLI, Gemini CLI, Cursor, GitHub Copilot |
   | `.cursor/` | Cursor |
   | `.gemini/` | Gemini CLI |
   | `.zencoder/` | Zencoder |
   | `.opencode/` | opencode — flat `commands/<skill>.md`, not skill folders |

   A project with none of them is offered `.claude,.agents`, which covers every agent listed. A
   project that already has an INSTALL in one of them — a `skills/` folder, or an armed hook entry —
   is offered that one; a `.cursor/` holding only Cursor rules is not an install. `--ide-targets`
   overrides all of it. A project whose stamp
   (`.sdlc/cli-version.json`) is missing or unreadable falls back to `.claude` alone — a recovery
   restores the minimum, it does not enrol you in a newer default.
3. **Product platform** — detect GitHub/GitLab from the remote → `.sdlc/hub.json`. No people are
   collected: anyone with access approves on the platform. Solo reviews by merging their own PR. A
   re-run on a Product with no solo/team mode recorded asks with **team** as the default (unless a recorded
   `profile.team_size` of 1 says solo) — solo waives
   every approval, so it is never what a scripted re-run falls into. (`yad roster` was removed; typing
   it prints where the people model went.)
4. **Optional tools** — design (Figma/pencil), testing (Playwright/cypress/pytest/maestro), learning (DeepTutor).
   Configure now, or **defer with one prompt** → all recorded as `none` (connect later with the
   `yad-connect-*` skills; the MCPs/CLIs are confirmed there).
5. **Connect code repos** — register repos into `.sdlc/repos.json`. **Monorepo** connects one repo;
   **greenfield** skips the Repomix pack (run `yad repo refresh` once it has code).
6. **Wire each repo** — CI gates and PR/MR template, recording each written file's sha in that repo's
   `.sdlc/managed.json` so a later `update` can tell a stale copy from one you edited
   ([managed files](#managed-files-what-yad-owns-and-what-you-edited)).
7. **AI review** — optionally write `.coderabbit.yaml`.
8. **Done** — stamp `.sdlc/cli-version.json` and print a **profile-tailored next step** (brownfield →
   `yad-backfill` first; everyone → `yad next` and your first epic via `yad-epic`).

The deterministic file work runs automatically; the AI-only steps are handed to the Claude Code skills
with a printed next-action. Re-run `… check --fix` any time the workflow updates — it never re-asks for
input you already gave; re-running `setup` carries your profile forward.

**Maintainers:** the source of every skill and of the module config stays in `skills/`. After you change
one, re-run `… check --fix` to copy it into the IDE folders and `.sdlc/config.yaml`. The old
`skills/sdlc/install.sh` script, which the install step was ported from, was removed in E3.

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
| Discover | Shape | `analysis` · `epic`, each with its review gate |
| Design | Shape | `architecture` (with the locked contract) · `ui-design`, each with its review gate |
| Plan | Shape | `stories` · `test-cases`, each with its review gate |
| Build | Build | `spec` · `tasks` · `implement` · `checks` · `engineer-review` |
| Release | Run | **planned, not built** — release notes · version · deploy record · gate |
| Operate | Run | **planned, not built** — defects · feedback · retrospective · improvements |

`yad next <epic>` prints all six with the current one marked and the two planned ones greyed, so the
lifecycle does not appear to stop at merge.

An epic sitting on the `ready-for-build` marker is in **Build**, and stays there for the rest of its
life: the individual Build steps run per story per code repo, so the epic-level view names the phase
rather than the step. No line is printed at all for a stub epic, or for a step id this release does not
recognise — showing the wrong phase would be worse than showing none.

The **Foundation** (`EP-foundation`, and `EP-discovery`, its older spelling) is not on this ladder. It is
the **Product level**, which runs once per product before any epic, and it has one phase of its own,
**Foundation**. `yad next` prints `phase: Foundation` for it instead of the six.

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

**Seven things it can now notice**, all warnings in the `shape` section:

| Check | What it means |
|---|---|
| `step:artifact` | A step names a different file from the one the catalogue expects. This matters because the review gate hashes that file, so a wrong name binds the approval to the wrong thing. Different **spellings** of the same artifact are fine and are not reported: `stories`, `stories/` and `stories.md` are one gate. |
| `step:no-artifact` | A step names no file at all. This is the one case that stops `yad gate` outright rather than quietly misfiring, because the field is read, not defaulted. |
| `step:kind` | A step is on the wrong side of the author / review line. An author step is run by a skill and a review step by `yad gate`, so on the wrong side nothing drives it. |
| `step:orphan-gate` | A review gate is in the chain but the step it reviews is not. Nothing then tells anyone to write the artifact being reviewed, and for a folder artifact the gate has nothing to bind an approval to. |
| `step:off-route` | The chain matches no lifecycle profile. See the section above: leaving a step out is fine, a step no route has or two in the wrong order is not. |
| `skip:not-optional` | A step is marked N/A or deferred, but this epic's route does not mark it optional. Nothing breaks today: the step is already done, so a gate sync reports that the rule no longer holds and changes nothing. What is lost is the justification — the gate stops treating the skip as the reason the step passed. A `deferred` status on a required step is reported the same way, and `yad undefer` puts it back. Silent when `profile:disagree` already names the epic, because correcting that clears this too. |
| `step:debt` | A step is still owed as debt (`yad defer --debt`). A reminder, not a fault: it repeats on every run until the step's review passes. `yad undefer <epic> <step>` starts paying it back — after later work has finished, the step re-opens beside that work, which stays done. |

**Other findings**, each with what to do (the level is in bold). They are in the `project` section, except `dials:shape-auto-unread` and `dials:locked-auto`, which are in `shape`:

| Check | What it means | What to do |
|---|---|---|
| `automation` | `.sdlc/automation.json` does not parse or has the wrong shape (**fail**). Every step is held at `advance: human` until it is fixed, and neither `yad dial` nor `yad kill` writes over it. | Fix the JSON, or delete the file to go back to the defaults (kill switch off, every Shape step human). |
| `automation:kill` | The kill switch is on (**warn**), with who, when and why. Every step is held at `advance: human`. | `yad unkill` once the reason is gone. |
| `automation:gate` | `.sdlc/automation.json` sets a review gate to `auto` (**fail**). Nothing honours it — a gate is never automatic. | Remove the line. |
| `automation:build-step` / `automation:unknown` | A Build step listed in `automation.json`, where nothing reads it (a lane's dial is in `build-state`), or an id or value this release does not know (**warn**). | `yad dial <epic> <story> --repo <name> <step>` for a Build step; remove the rest. |
| `automation:legacy-kill` | `_bmad/sdlc/config.yaml` still says `kill_switch: true`, and nothing reads that key since E34 — so the kill switch is **off** (**fail**). | `yad kill --reason "<why>"`, then set that line back to false, or delete `_bmad/sdlc/` (see `module:legacy-bmad`). |
| `module:legacy-bmad` | A `_bmad/sdlc/` folder is left from before E3, when `yad setup` installed the module config there. Nothing reads it now; the config is `.sdlc/config.yaml` (**warn**). A BMAD install's own `_bmad/` is not a finding — only the `sdlc/` folder yadflow wrote. | Clear `automation:legacy-kill` first if it shows (it reads that folder), run `yad check --fix` if `.sdlc/config.yaml` is missing, copy any value you changed in `_bmad/sdlc/config.yaml` into `.sdlc/config.yaml`, then delete `_bmad/sdlc/`. |
| `mode:disagree` | `.sdlc/hub.json` says `mode: solo\|team` but the `solo` flag says the other, or `mode` holds a value other than `solo`/`team` (**warn**, E10). `solo` is the one the gates read this major, so the file reads one way and acts another. Silent on a Product with no `mode`. | `yad mode <what the gates do now>` to make them agree, or `yad mode solo --reason "<why>"` / `yad mode team` to make the gates follow `mode`. |
| `mode:suggest-team` | Solo mode is on, and the count of active people shows more than one person may work on the Product: the smallest possible team (the larger of the platform logins and the names not matched to a login) is 2 or more, or someone with a platform login approved a review in the counting window with more than one person counted (**warn**, E74). Counted only in solo mode. A suggestion only — nothing is switched. When the count is unknown the same id is also a **warn**, saying no switch is suggested and why. | `yad mode team` if more than one person works here. If it is only you (two accounts, two spellings of your name, a robot committing or auto-approving, or your own approval on a local ledger), leave solo mode on. When unknown: the reason in brackets names what could not be read — clone the missing repo, unshallow it, or fix the file, then run `yad doctor` again. |
| `dials:shape-auto-unread` / `dials:locked-auto` | A Shape author step says `auto` in `state.json`, where nothing reads a Shape dial; or a Build author step is `locked` and `auto`, and `locked` no longer holds it at human (**warn**, E34). | `yad dial <step> --to auto` for the Shape step; `yad dial <epic> <story> --repo <name> <step> --to human` if the Build step should wait for a person. |

A step id the catalogue does not carry is left to `phase:unknown`, which is the check for that.

## Lifecycle profiles: the route an epic takes

The step catalogue says what each step is. A **profile** says which steps an epic walks and in what
order. Six exist, and they are written down once — in code, which is what `yad epic new` and
`yad foundation new` seed from:

| Profile | What it is | Used by |
|---|---|---|
| `classic` | The 10-step chain, starting at the epic | Most epics, and every change, defect and hotfix |
| `analysis-first` | The 12-step chain, which puts the analysis before the epic | An idea shaped by the analyst before it becomes an epic |
| `chore` | The upkeep lane: four steps, the epic then the stories | Work somebody has already decided on — a dependency bump, a CI move |
| `spike` | The investigation lane: six steps, the analysis then the upkeep lane | A timeboxed question, where finding the answer is the work |
| `discovery` | The OLD spelling of the Product level, two steps and no Build | A product made before E75, until `yad migrate --apply` converts it |
| `foundation` | The Product level — the Foundation — two steps and no Build | The one `EP-foundation` item in `foundation/`, which frames the whole product (`yad foundation new`) |

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
`yad skip <epic> <step> --reason "<why>"` marks one N/A for one epic — the step and its review gate are
both marked `skipped` with the reason recorded, visible in the chain, and `yad unskip <epic> <step>`
puts them back (`yad skip <epic> <step> --undo` does the same). The engine keeps **no list of its own**: it
asks the route the epic is on, so a shorter route that drops a step does not make that step skippable
for every other epic in the project. `classic` and `analysis-first` both mark the same one step,
`ui-design`. The short lanes mark **none** — they leave the steps they do not need out of the chain
altogether, so there is nothing on them to mark N/A, and `yad skip` says so rather than reporting the
chain as broken.

**On a verified Product, CI owns the ledger.** Once an epic's `state.json` is on the default branch,
`yad skip`, `yad unskip`, `yad defer`, `yad undefer` and `yad unblock` refuse and write nothing.
`ledger-guard` rejects any commit to that file that CI did not make, and CI has no step for these verbs
yet. So a late `yad undefer`, paying a debt back, and clearing a blocker are not available there until it
does. A new epic is different: its ledger rides its first review PR, so a skip or deferral written before
that PR merges still lands. That PR is the epic review on `classic` and the analysis review on
`analysis-first`. A skip or deferral written in that window says it cannot be put back once the PR
merges. The check reads `origin` as last fetched, so run `git fetch origin` first if the PR may have
merged. If `origin` cannot be read, the verb writes and warns that it could not tell. A Build lane skip
is not affected: it writes `build-state`, which CI does not own.

**A whole Build lane can be skipped too (E39).** A lane is one story in one repo. When a story declares a
repo that turns out to need no change, `yad skip <epic> <story> --repo <name> --reason "<why>"` marks that
lane N/A in `build-state/<story>.json` — commit it with `yad checkpoint --push` — and
`yad unskip <epic> <story> --repo <name>` puts it back. It is refused before the stories review has passed
(edit the story's `repos:` then: nothing is approved yet, so that edit revokes nothing), for a repo the
story does not declare, once work has started in the lane or a ship is recorded for it, and for the
story's last lane. **No single Build step can be skipped**, and a lane is never deferred. `yad next` prints
a skipped lane with its reason, `yad foundation status` counts it as finished (as long as another lane
really shipped), `yad checkpoint --retro-ship` refuses it, and `yad doctor` fails a skipped lane that also
has work or a ship, and warns about one with no reason, one for a repo the story does not declare, and a
single Build step marked `skipped` or `deferred` by hand.

So a skip can be declared at three levels: the **profile** marks which steps may be skipped (E35 — in the
engine's routes, not a project file), the **epic** skips one of them (`yad skip <epic> <step>`), and the
**story/repo** skips a whole Build lane.

**When a skip is too late, or an un-skip is.** Neither command names a step. Both look at the steps
that come **after** the skipped pair. "The step after the pair" means the first later step that is not
itself skipped or deferred — the step the skip opens.

| Command | Refused once |
|---|---|
| `yad skip` | the step was authored, its review opened, any later step has started, or the step or its review gate is `blocked` (clear it with `yad unblock` first) |
| `yad unskip` | the step after the pair is finished (`done`), or any step **past** it has started |

"Started" means work happened on the step **in this epic**: it is open (`in_progress`, `in_review`) or
`done`. A later step that is `skipped`, `satisfied` (carried from a parent epic), `deferred` or `blocked`
has had no work done on it here, so it never makes either command too late. A status word this release does
not know counts as started, and a gap in the chain (an entry that is not a step) is refused as a broken
chain.

On `classic` the step after the `ui-design` pair is `stories`, so a skip is refused once stories start,
and an un-skip once stories are finished or their review opens. On a route that marked `architecture` optional, the same
rules would read `ui-design` and its review instead.

**Un-skipping never leaves a false "Build can run".** When the epic is at `ready-for-build` because its
stories review really passed (here, or in the parent epic it inherits from), a step put back after that review runs beside Build, the way `test-cases`
does, and the epic stays in Build. When the epic only reached `ready-for-build` by skipping — a `chore`
epic whose stories pair was skipped by hand — un-skipping moves it back to the restored step.

**Deferring a step: `yad defer`.** A skip says a step does not apply. A deferral says it does, just
not yet: `yad defer <epic> <step> --reason "<why>"` marks the step and its review gate `deferred`, with
the reason, who and when recorded. Put who is waiting for it in the reason. `yad undefer <epic> <step>`
puts it back. Everything else works the way a skip does:

- only a step the epic's route marks optional can be deferred, because the chain carries on past a
  deferred step before anyone has approved its review, and a required review may never be left behind;
- the same refusals apply when you defer;
- the chain walks past a deferred step, `yad gate open` refuses to open a review on one, and the
  artifact's `status:` line is left alone rather than marked approved.

The review is not waived, only postponed: `yad gate status` shows a deferred step as "deferred (still
owed)", the gate check still reports the approvals it is missing, and `yad gate sync` on a review PR
opened before the deferral says the review is still owed rather than "already done".

A step cannot be both: `yad defer` refuses a skipped step and `yad skip` a deferred one, and each names
the command that puts the step back first.

**Picking a deferred step up late: `yad undefer` works at any time** — except on a verified Product once
the epic's ledger is on the default branch (see "On a verified Product, CI owns the ledger" above). Before later work has finished,
it puts the step back in the chain the way `yad unskip` does. After later work has finished — say the
stories were written and approved while the UI waited — it **re-opens** the step beside that work:

| What | After a late `yad undefer` |
|---|---|
| the deferred step | `in_progress` (or `todo`, if an earlier step has not passed) |
| its review gate | `todo` |
| the work already finished after it | unchanged — still done |
| `currentStep` | unchanged — for example still `ready-for-build` |

This needs later work that is **finished**; if it has only started, `yad undefer` is refused as before.
A re-opened step can be deferred again with `yad defer`, so a late undefer can be undone.

The re-opened step then runs beside the chain, like the `test-cases` track. It does not block the
finished work, opening its review does not move `currentStep` back, and passing that review re-opens
nothing after it. `yad next` shows it on its own line, `re-opened lane: …`. yadflow recognises such a step
from the chain itself — an unfinished step with work completed here after it — and never from a flag
in the file. `yad unskip` does not do this: a skip says the step does not apply, so work finished after
it was built without it, and putting it back after that is still refused.

**Debt: `yad defer <epic> <step> --reason "<why>" --debt`.** A **debt** is a deferral the team owes
back — work set aside under pressure. It writes `"debt": true` beside `deferred` on both steps of the
pair. `--debt` on a step that is already deferred adds the flag and keeps the record.

- **Reminders, on every run, until it is paid:** a warning line in `yad next <epic>`, a count on the
  epic's row when `yad next` lists every epic, a `step:debt` finding in `yad doctor`, and "deferred
  (still owed, as debt)" in `yad gate status`.
- **Paying it back** is `yad undefer`, early or late — not on a verified Product once the epic's ledger is
  on the default branch, where a debt cannot be paid back until CI has a step for it. The flag stays on while the step is worked on.
  Deferring the step again keeps the flag, and `yad skip` refuses a step owed as debt.
- **It clears** when the step's review passes, and nothing else removes it.
- **Only a deferral can carry debt.** `yad skip --debt` is refused, because a skip means nothing is owed.
- It is a reminder, never a gate, and it is not the hotfix `reconcile-debt.json`, which is a whole
  change owed to a feature thread and is enforced by CI.

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
  "schemaVersion": 10,
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
- **Set it when you write the epic.** The epic review gate is bound to a hash of `epic.md` without its
  `status:` line, so editing any other frontmatter key — the theme included — after the gate has been approved drops
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

## Where a step stands: the step states

`yad next`, `yad gate status` and `yad status` all report a step by one word. There are eight, and
`epics/<epic>/.sdlc/state.json` holds the same word in each step's `status`.

| State | Meaning | The chain continues past it |
|---|---|---|
| `todo` | Not started | no |
| `in_progress` | Being worked on | no |
| `in_review` | Its review gate is open | no |
| `done` | Completed here | yes |
| `skipped` | You chose not to do it — `yad skip` writes this | yes |
| `deferred` | You will do it, later — `yad defer` writes this | yes |
| `satisfied` | Done elsewhere — a change-epic inheriting its parent's artifact | yes |
| `blocked` | Cannot proceed, and **not by your choice** | no |

The bottom four carry a `record` saying why: `{ "reason": …, "by": …, "date": …, "link": … }`. Only
`reason` is required. A skip with no reason is the thing the whole design refuses — a recorded skip is
not a hole in the audit trail, it IS the audit trail — so `yad doctor` reports a recorded state with
nothing recorded on it.

**A `done` step says how it closed** (E18), in a separate key, `closed`: who wrote it, when, and how.

| How it closed (`via`) | When |
|---|---|
| `merge` | A review gate passed when its PR merged. The record holds the PR, the merge commit, the artifact hash and who merged it. |
| `approved` | A review gate passed on recorded approvals on a Product with no platform, where nothing merges. |
| `review-passed` | An author step closed when its gate passed. |
| `review-opened` | An author step closed when its review opened. |
| `repair` | `yad gate repair` closed a stranded author step. |
| `auto` / `human` | The `yad-run` skill moved a Build lane past a step, on its own or for a person. |

`yad gate status` prints it under each review step, and `yad history show` (E20) under every step,
author steps included, in the same words. A step closed before this release has none, and nothing warns about that. See the state schema's "Closing records" for every field.

A `deferred` step can also carry `"debt": true`, a flag beside the state rather than a ninth state: it
marks the deferral as owed back, and changes nothing about whether the chain continues. See `yad defer
--debt` above.

**`blocked` used to mean something else.** Up to shape 6 it was the word for "waiting on an earlier
step", which is now `todo`. The two are told apart by the record and by nothing else: `blocked` with no
record is the old word and reads as `todo`; `blocked` with a record is a real blocker. `yad migrate`
rewrites the old ones. See [shape 7](migrations/shape-7.md).

`yad skip` and `yad defer` write their states for you. Nothing writes `blocked` for you: set the status
and add a record by hand and every command understands it — `yad next` prints the record instead of
telling you to author the artifact, and no gate is waived by it. A record's `by` is whoever wrote it. On a
verified Product that hand edit is CI's to make: `ledger-guard` rejects it once the epic's ledger is on the
default branch.

**When the wait is over: `yad unblock <epic> <step>`.** On a verified Product it refuses once the epic's
ledger is on the default branch, like `yad skip`. Otherwise it moves the step off `blocked` and removes
its record in the same write. An author step whose earlier steps have all passed goes back to
`in_progress`; anything else goes to `todo`, including a review gate, whose review you then open as
usual. It refuses a step that is not blocked, and says so separately for a `blocked` with no record,
which is the older word for `todo` and has nothing to clear. It changes only `state.json`: a halted
Build lane lives in `build-state/<story>.json`, which `yad-run` owns. A review gate passing does not clear
a blocker on the step after it either: the chain moves there, and `yad next` shows the block. `yad skip`
and `yad defer` refuse a
blocked step for the same reason: setting it aside would lose the record of who it waits on, so clear
the blocker first.

## The risk map: a level per directory

Each code repo can keep one file, `.sdlc/risk-map`, that says how risky each directory is. It holds
**levels only — `high`, `medium`, `low` — and never a name**. It is the team's file: `yad update` never
installs, owns or overwrites it, and it changes only through that repo's PRs.

```
# yad-risk-map v1
src/payments/   high    confirmed  # charge.js calls the card processor
src/catalog/    low     guessed    # read-only product listing
docs/           unset
./              low     confirmed  # the files at the repo root
```

| Rule | Meaning |
|---|---|
| One line per directory | `<dir>/ <level> <guessed\|confirmed>`. Fields are split on spaces or tabs, so a path cannot hold one. |
| Comments | Everything from the first `#` that follows a space or tab. A `#` glued to a word is part of it. |
| Which line decides | The deepest listed directory above a file. |
| `./` | The files **at** the repo root only. There is no catch-all line, so a new directory can never hide under one. |
| `unset` | Listed, not yet classified. Its state column may be left out. |
| `guessed` / `confirmed` | `guessed` was filled in by an AI agent. A person changes it to `confirmed` in a PR; the commit records who. |
| No `contract` level | The contract surface keeps its own lock, `contract-check` and `Contract-Change` trailer. |

**How a map is made.** `yad risk-map draft <repo>` adds an `unset` line for every directory no line
covers — on a new map, each top-level directory (and `./` for the root files).
The `yad-connect-repos` skill then has your AI agent read the code — not the folder names — and fill
each `unset` line with a level, a one-line reason and `guessed` (one exception: `.sdlc/` is `high`
because it holds the map). It never rewrites a `confirmed` line.
With no AI agent, a person fills the lines in.

**How it stays true.** `checks/risk-map-check.sh` runs on every PR (both CI templates) and warns when the
change adds a directory no line covers, leaves a line whose directory is gone, touches a line still
`unset` or `guessed`, or edits or deletes the map itself. It measures the change from where the branch
left its base, so the base's own newer commits are never blamed on it. It never fails the build. `yad risk-map check` and the
`risk-map` section of `yad doctor` say the same about the whole repo.

**What reads the levels: the approver count (E66).** A change that touches a `high` directory asks for
one more approver: `base 1 + high risk 1`. This is the same step, printed the same way, as a Shape step
tagged `auth` or `payments`. `medium` is printed for information and adds nothing. `low` adds nothing.

| Rule | Why |
|---|---|
| The map is read from the **base branch** (its tip), never from the change's own copy. | A change cannot lower its own count by editing or deleting the map. A map the change adds counts from its merge on. |
| A `guessed` level counts exactly as a `confirmed` one. | A level can only ask for one more person. It can never let a review pass on its own. |
| An `unset` line, and a directory no line covers, add nothing. | They are warned about, never counted as `high`. |
| A deleted or moved file counts where it was. | Deleting code in a `high` directory is a `high` change. |
| The body's `Risk level` and the map: the **larger** step wins. | The body can raise the count and never lower it. |
| The count is **reported, not enforced**. | The platform's branch protection holds a Build merge. `yad open-pr`, run from the Product, shows the count capped by the active people (E72); the check scripts cannot cap it. |

Three places print it, and none of them writes it anywhere:

- `checks/risk-map-check.sh`, on every PR, prints a `COUNT [risk-map]:` line after reading the base's map.
  If the base cannot be read (a shallow clone, for example), it says `not counted` and that the count is
  unknown, not zero.
- `bash checks/risk-route.sh <pr-body> [<base>]`, run in the code repo **on the PR's branch**, joins the
  body and the map, and says when the body's level is lower than the map's.
- `yad open-pr` prints the same count once the PR is open, plus the cap for the active people (for
  example `, capped to 1 for 2 active people`). The PR body keeps the level its author gave.

**Who can meet the ask: proven history (E67).** A `high` directory asks for one more approver, and the
same three places name the people who can be that approver: whoever has **committed in one of those
directories in the last 30 days**. Two `high` directories give one list, not one list each: working in
any of them meets the ask.

| Rule | Why |
|---|---|
| The history is the **base branch's**, and this change's own authors are left out. | A change cannot add its own history, and an approval has to come from someone else. |
| Git itself applies the map's **cover rule**, through one query per `high` directory: work in a `low` directory inside a `high` one is not history for the `high` one. | The deepest map line decides, as everywhere else — and nothing has to read a list of file names back out of git, where an odd name could name the wrong person. |
| A person is shown as their git **name**, plus `(@login)` only when their commit address is a platform `noreply` one. A git name holding an `@` is never printed: it is shown as the login when there is one, else as `a name that is an e-mail address` (it looks like an address) or `a name written like a login` (such as `@dave`) — so a printed `@word` is always a real login. | yadflow prints no e-mail addresses. A work address names no login. |
| A robot (`dependabot[bot]`) is never listed. | An approval can never come from one. |
| Nobody with recent work is said plainly, and the count stands. | A new or dormant directory can never make a change unreviewable. |
| A history that could not be read (a **shallow clone**) says "not read", never "nobody". | Reading it as "nobody" would drop the ask instead of raising it. |

"Recent" is git's `--since`, which uses the **committer** date, so a rebased or squashed commit counts
from when it landed. Nothing is stored: the query runs each time, and no name reaches a file.

`yad-engineer-review` reports it in three states, in this order: **met** when a recorded approver's login
is one of the named people (compared without case); **could not confirm** when the history was not read,
or when no approver matches and a named person has no login to compare against (an approval records a
platform login; git history records a name); and **short** only when no approver matches and every named
person does have a login. It never blocks.

The Shape gate (`yad gate status`, `gate sync`, the review-PR body) does not read the map. It reviews
Product files, not a code change, so its count still comes from each step's `risk_tags`. `yad doctor`
prints no count either: a count belongs to one change.

**Who may know this code: a reviewer suggestion (E68).** Once a code-repo PR is open, `yad open-pr`
prints two hints about whom to ask, on separate lines. It is a **suggestion only**: it holds nothing,
waives nothing, and requests no reviewer on the platform. A name it prints is a hint about who may know
the code — never a claim about who owns it or who must approve. Only `yad open-pr` prints it (and so `yad ship`, which runs it); the CI check
and `risk-route.sh` print only E67's ask.

1. **From git history.** The people who have committed in the folders this change touches, in the last
   30 days, on the base branch. "A folder" is the folder each changed file sits in (`./` for a file at the
   repo root), and only the files **directly** in it, never its subfolders. This works with or without a
   risk map.
2. **From CODEOWNERS.** What the CODEOWNERS file on the base branch lists for the changed files — a
   CODEOWNERS file is a platform file that maps paths to people or teams. It is a **hint**: these files go
   stale, and yadflow never checks that anyone listed still works on the repo.

| Rule | Why |
|---|---|
| The history is the base branch's, one `git log` over every touched folder, with this change's own authors and robots left out. | A change cannot add its own history, and a suggestion should be someone else. One log counts a commit that touched two folders once. |
| Names are ranked by commits in the window, then the newest. Five are shown, then `and N more`. | A long list is noise; the first name is who has done the most there lately. |
| At most 200 folders are asked about; a cut is printed. | It keeps the git command short. All folders go into one log, so the cost does not grow with the count. |
| CODEOWNERS is read from the **base branch**, in the platform's own order: GitHub `.github/`, root, `docs/`; GitLab root, `docs/`, `.gitlab/`. | A change cannot rewrite the hint it is shown. |
| The rules are each platform's own, from its docs: GitHub uses gitignore patterns without `!`, `[ ]` or `\`, and the last matching line decides; GitLab adds sections (`[Name]`, `^[Optional]`, default owners), `!` exclusions, and matches a path with no leading `/` at any depth. | GitHub and GitLab read the same line differently (`internal/README.md` is anchored on GitHub, any depth on GitLab). |
| A pattern its platform's docs do not describe is **not matched**. The first three such lines are printed as `not read`, each with the reason, then a count of the rest; and the CODEOWNERS line adds `so this list may be wrong` — or, when nothing matched, says `lists nobody this reader could match … so this may be wrong` — because a skipped line could have been the last match, or the only one. On GitLab, a section's default owners apply only to an entry that writes no owner at all; an entry whose owner words are all unreadable (`docs/ bob`) is read as having no owner, and is reported the same way. | A wrong match would print the wrong person. |
| A team (`@org/team`), a GitLab group or role is marked as one. On GitLab an `@name` can be a person or a group, and the output says so. An e-mail owner prints as `an e-mail address`. On GitHub, a line whose owner word looks like a mistyped address is reported `not read` and the word is shown as `an address-like word`; GitLab drops such a word, as its docs say. A committer's git **name** holding an `@` is shown by their login, or as `a name that is an e-mail address` / `a name written like a login`. | yadflow prints no e-mail addresses. |
| A git name and a CODEOWNERS login are joined **only** when the commit address is a `noreply` one of **the same platform**, the repo's remote is on the public host (`github.com` or `gitlab.com` — a self-managed GitLab or GitHub Enterprise keeps its own accounts), and the login is exactly the same (`also in the 30-day history` — the person may be one of the `and N more` not shown). A GitHub login says nothing about a GitLab account spelled the same. Otherwise the same person can appear twice, and the output says so. | A name and a login are different kinds of fact; joining them without exact evidence could merge two people. |
| Anything unreadable says `not read` with the reason: a shallow clone, a missing base, a CODEOWNERS that is a symlink, a GitHub CODEOWNERS of 3 MB or more (GitHub does not load it). No file at all says `none`. The four git variables that change how every pathspec is read (`GIT_LITERAL_PATHSPECS`, `GIT_GLOB_PATHSPECS`, `GIT_NOGLOB_PATHSPECS`, `GIT_ICASE_PATHSPECS`) are removed before git runs, and the history is read with `--no-show-signature` and `--no-follow` (`log.showSignature=true` would list signature checks as people; `log.follow=true` makes git fail on a one-folder change). | "Not read" is never "nobody"; `GIT_LITERAL_PATHSPECS` would otherwise turn the history into a quiet "nobody". |

Example output:

```
→ may know this code — committed in the 2 folders this change touches in the last 30 days: Ana Silva — 3 commits, Carol (@carol) — 1 commit
→ CODEOWNERS on origin/main (.github/CODEOWNERS) lists for the touched files: @carol (also in the 30-day history), @org/payments (a team) — a hint only: these files go stale, and yad does not check that anyone listed still works here
• a suggestion only — nobody was asked to review, and no name above is an owner or a required approver; the same person can appear in both lists under two names (yad joins them only when a commit address carries the exact @login)
```

**Known limits.** E67's apply here too: git's date-limited walk stops at the first commit older than
the window on a chain, so out-of-order dates can hide people (every name printed is still real); a person
with two commit addresses is two rows; `--since` reads the committer date. A CODEOWNERS owner is printed
as the file writes it, with no check that the account exists. One reading is yadflow's own, taken from
both platforms' examples: a pattern whose last part has no wildcard also covers everything inside a
directory of that name (`apps/`, `**/logs`), while one ending in a wildcard matches files only
(`docs/*` does not reach `docs/build-app/x.md`). A Shape review PR (`yad gate open`) gets no suggestion.

**Is CODEOWNERS stale? (E69).** A CODEOWNERS file names who looks after each part of a repo, and
these files rot: a folder moves, a person leaves. `yad codeowners check [repo]` reads the file **on disk**
(like `yad risk-map check`), in the platform's own order, and warns. `yad doctor` sums up the same facts
in one line per connected repo, in its `codeowners` section. A repo that is not on disk, is not a git
repo, or has no commits yet gets no `codeowners` line: the doctor's repos check already reports it. It is
advisory: a finding never fails, and nothing is written. (An unknown repo name, or `--write`, does fail.)

| What it finds | Kind | Printed by |
|---|---|---|
| A line that matches no file: `line N (…) matches no file in this repo`, or `excludes no file` for a GitLab `!` line. The pattern is shown in brackets, unless it holds an `@` — then only the line number is shown. Files not committed yet count, like the risk map. | fact | command; the doctor gives a count and the line numbers |
| A second CODEOWNERS the platform never reads, because it reads another location first: `docs/CODEOWNERS is never read — GitHub reads .github/CODEOWNERS first` | fact | command; the doctor says `… is never read (… is read first)` |
| A GitHub file of 3 MB or more, which GitHub does not load, so it lists no owner for any file. GitLab documents no size limit. | fact | command and doctor |
| A line yad cannot read: `line N not read — why`, with the same reasons as E68's `not read` | fact | command; the doctor gives a count and the line numbers |
| `no commit on the checked-out branch in the last 90 days carries a github.com noreply address for @a, @b — a hint only: they may commit under another address or work in other repos, so this does not mean they have left` | **hint** | command only |

A **submodule** is another repo kept inside this one. Its files are not in this repo's file list, and the
platform only ever sees the submodule's own path. So a line for the submodule's folder (`vendor/lib/`) is
never called dead, but a line for files inside it (`vendor/lib/*.js`) is.

**The hint is a guess, so it is fenced in.** A `noreply` address is the private address GitHub or GitLab
gives each account; it is the only exact link between a commit and a login. So the hint checks only a
person's `@login` — never a team, group, role or e-mail address (they are counted as `not checked`) — and
only when the `origin` remote (the server the repo pushes to) is on `github.com` or `gitlab.com`. On
GitLab an `@name` can also be a group, and the output says so. The history is the whole checked-out
branch, read by the same reader as E67 and E68, with robot accounts left out. These cases say `not known`
with the reason, never that someone is inactive: a self-managed server; a **shallow clone** (a copy that
holds only the newest commits); a repo with no commits; a history git cannot read. The doctor never prints
the hint: it warns only on facts.

| Situation | What is printed |
|---|---|
| No CODEOWNERS file | `none` — a note, not a warning. (A repo with no review rules at all is E70's warning.) |
| The first location is a **symlink** (a file that only points at another file) or a folder, or cannot be read | `not known` with the reason — never `none`, never fine |
| A file named `codeowners` in another case | Not read: git stores names exactly as written, so the platform looks for `CODEOWNERS`. yad matches the exact name even on a disk that ignores case. |
| The path is a folder inside a repo, not its top folder | `not known`: the platform reads CODEOWNERS from the top folder |
| git cannot list the repo's files (for example, a broken **index** — git's list of tracked files) | `not known` — in `yad doctor` too, a warning rather than a quiet skip |
| A **bare** repo (a git repo with no files on disk) | skipped by the command; the doctor leaves it to the repos check |
| yad cannot tell GitHub from GitLab (no `platform` in `repos.json`, and the remote names neither) | `not known` — pass `--platform` |

**Why there is no `--write`.** The roadmap title named one. It was dropped (2026-09-22): both platforms
can **enforce** CODEOWNERS (GitHub's "Require review from Code Owners" branch rule, and GitLab's code owner
approval on a protected branch). So any name yadflow wrote into the file — even inside a comment, since
GitLab reads owners written in a comment — would become an owner the platform enforces. That turns a hint
into an authority. `yad codeowners write`, or `--write` anywhere on the line, is refused with that reason.
Edit the file yourself and commit it through a PR.

**Known limits.** The hint reads the **author** address, so a person whose noreply address appears only as
the committer is not counted. Merge commits are left out (the reader's `--no-merges`), so a person whose
only recent commits are merges is named. E67's limits apply: git's date-limited walk stops at the first
commit older than the window, so out-of-order dates can hide recent work; `--since` reads the committer
date. "Matches no file" uses the same pattern reading as E68, including its one reading of our own (a
pattern whose last part has no wildcard also covers a folder of that name). Finding a dead line is quick for
plain paths, but a wildcard line may be tested against every file: on a repo with hundreds of thousands of
files, hundreds of dead wildcard lines can take several seconds, in `yad doctor` too.

## The Product index: `.sdlc/index.json`

`.sdlc/index.json` is the Product's front door (E19). It holds one short summary for every work item, so
an app, a CI job, an agent or a person can read one file instead of opening every folder under `epics/`.

**It is derived, never the source of truth.** Each work item's own `.sdlc/state.json`, `epic.md` and
`.sdlc/change.json` stay the truth. The index is rebuilt from them and can always be rebuilt again. Do not edit it by hand.

**What one entry holds:**

| Field | Where it comes from |
|---|---|
| `id`, `dir` | the work item's id and folder (`foundation/` for `EP-foundation`) |
| `title` | the `title:` key in `epic.md` (E111), read as one line (line breaks become spaces), unquoted, with the other control characters and the bidi controls dropped. An item without one falls back to the `title` in its `.sdlc/change.json` (only change items have one). With neither it is `null`, and a screen shows the id instead. The Foundation's title is always `Foundation`. A `change.json` that cannot be read or does not parse leaves the title `null`, and `yad doctor` fails that file. The full rules for writing the key are in `state-schema.md` (the `epic.md` frontmatter table) |
| `kind`, `profile`, `currentStep`, `createdAt` | `state.json`, as written — a date is copied, never parsed |
| `type`, `theme`, `parent`, `thread`, `repos` | `epic.md` frontmatter. The Foundation has no `epic.md`, so its `type` is null |
| `steps` | how many steps are in each of the eight step states, read the way the gates read them (`blocked` with no record counts as `todo`). An `unknown` count appears only when a step holds a state this release does not know |
| `lastClosed` | the last closed step in the chain's order, with its `date` and `by` |

A work item whose files cannot be read is **still listed**, as `{ "id", "dir", "unreadable": true, "why" }`.
It is never dropped, and it never stops the rest of the file. A folder under `epics/` that holds a `.sdlc/`
but is not read as a work item is listed under `unlisted`: a name that is not a work-item id, a symlink,
or an `epics/EP-foundation` beside the real `foundation/`.

**Who writes it — the default branch only.** A file that every branch rewrote would conflict at every
merge, the same problem the Build ledgers were sharded to avoid. So:

| Product | When the index is rebuilt |
|---|---|
| local ledger | after any yad command that writes a work item's state on the default branch — `yad gate sync`, `yad gate open`, `yad gate repair`, `yad epic new`, `yad foundation new`, `yad skip`/`defer` (and their `--undo`), `yad unblock`, `yad migrate --apply` — and whenever you run `yad index` there |
| verified ledger | by CI, in the same commit that records a merged review (`yad gate ci --merged`). A local write could not be committed, and the ledger guard rejects it |

The index is committed only when every file it reads is exactly what that commit holds. If the checkout
has other changes under `epics/` or `foundation/` — an edit, an untracked file, a work item `.gitignore`
excludes, or a folder that holds only an ignored file such as `.DS_Store` — the index stays out of the
commit and yad names the files. Line endings do not count: a CRLF checkout (Windows `core.autocrlf`)
builds the same index as an LF one.

**If two people rebuild it at once.** On a local Product, two gate writes on the default branch each
rewrite the index, so a `git pull --rebase` can stop on `.sdlc/index.json`. Keep either side, finish the
rebase, then run `yad index` — it rebuilds the file from the work items, so which side you kept does not
matter. On a verified Product, a push that CI retries after a rebase can carry an index built just before
someone else's merge landed; `yad doctor` then says it is behind, and the next merged review rebuilds it.

**Knowing whether it is current.** The index records `inputs`, a hash of the exact bytes it was built from.
`yad doctor` rebuilds that hash and says when the index is behind. It can fall behind in ordinary use: a
skill that still writes `state.json` by hand (E17b) does not rebuild it — nor does `yad-change`, which
writes `epic.md` and `change.json` by hand — and nor does any change made on a branch until it merges.
Upgrading yadflow can do it too: when a release changes what the index holds (E111 added `title`), every
index built by the older release reads as behind. Run `yad index` on the default branch. On a verified
Product only CI writes the index, so it — and a new work item merged by PR — waits for the next merged
review.

## Work-item history: `yad history`

`yad history` (E20) answers "what has this Product done?" It reads each work item's own files every time
it runs — with the same builder as `.sdlc/index.json` — so it is correct on any branch, even when the
saved index is behind. It never writes a file.

| Command | What it prints |
|---|---|
| `yad history` or `yad history list` | Every work item, open and shape-done, **newest first** by its created date. A value that is not a real calendar date (such as `someday` or `2026-02-31`) sorts last; items with the same date sort by id. Each row shows the title (or the id, when the item has no title), the type, the theme, the current step, `shape done` when it is, and the date of the last closed step. The header counts the items it could not read too |
| `yad history show <id>` | One work item: its type, theme, thread, parent, profile, created date, current step and repos, then **every step in chain order** with its state and its closing record (who closed it, when, how, and the PR or commit). Under each review step, the **approvals** recorded for it, judged by the same rules as the gate (see *Reading an approval* below). A deferred step owed as debt, and a step inherited from another epic, say so. The thread is the one `yad thread` finds by walking `parent:` links, with a note when that disagrees with the `thread:` line in `epic.md` |
| `yad history search <text>` | The work items where the text appears, ignoring upper and lower case, in the id, title, theme, type or repos, or in a step's closing record: who closed it or merged it (anywhere in the name), its **PR as a whole number** (`12`, `#12`, `PR 12` and `PR #12` all find PR 12, never PR 112), or its **commit from the start** (at least 4 characters, so `abc1` finds `abc12345…`). Approvals are not searched. Each match names the field and the step. Case is folded simply: an accent typed as one character or two matches either way, but `ß` does not match `SS` |

**Shape done, not finished.** An item's `state.json` holds its **Shape** steps only — the epic,
architecture, UI design, stories and test cases, and their reviews. **Build** (the code, the checks and
the code review) is tracked in other files. So `yad history` says **shape done** when every Shape step is
closed for good (`done`, `skipped` or `satisfied`); an item marked shape done may have shipped nothing
yet. `yad next <id>` shows where its Build stands.

**Filters** for `list` and `search`:

| Flag | Keeps |
|---|---|
| `--type <t>` | items of that work-item type: `feature`, `change`, `defect`, `hotfix` or `chore`, in any case (`Chore` is `chore`) |
| `--theme <x>` | items with that theme, compared the way `yad doctor` groups themes — `Checkout Revamp` and `checkout-revamp` are one theme |
| `--thread <EP-…>` | items in that feature thread |
| `--open` | items whose Shape is not done: at least one Shape step not closed for good, or no steps yet. A **deferred** step is still owed, so it keeps an item open |
| `--done` | items whose Shape is done |

`--thread` finds the thread's members by their `parent:` links, as `yad thread` does — not by the
`thread:` line in `epic.md`, which is only a cache — and keeps the thread's first epic even before its
`epic.md` is written. A thread whose named epic has no folder is refused. When the walk breaks further
up (a missing parent, a cycle), it lists what it found and says where the walk stopped. `EP-foundation`
is in no thread and is refused.

**What is refused.** Anything that cannot give an honest answer is refused before a file is read, with
exit code 1: an unknown type, a thread id that is not an id, `--open` with `--done`, a flag `yad history`
does not take, filters given to `show`, and extra words after `list` (use `search`). A flag is any word
that starts with `--`, or a one-letter flag such as `-m`, whether or not `yad` knows it — `--since`,
`--repo` and a mistyped `--opne` are all refused, because a flag quietly ignored would look like a filter
that was applied, and under `search` it would silently become part of the text. So a search text cannot
start with `--`; one that starts with a single `-` (such as `-dash`) is text.

**An item that cannot be read is never hidden.** `list` and `search` name it under every answer, whatever
the filters, with the reason, because a filter cannot know what an unreadable item holds; `show` of it
says why and fails. A folder under `epics/` that holds a `.sdlc/` but is not read as a work item is named
too. Each of these ends with what to do: fix or restore the files, and `yad doctor` checks them. In
`show`:

- an `approvals.json` that cannot be read is said, and no approvals are shown for it — never an empty list
  standing in for a file that was not read. The command still exits 0, because the steps were shown;
- steps that cannot be read (a `state.json` that changed between the summary and the steps) are said, and
  the command exits 1;
- Product settings (`.sdlc/product.json`, or the older `hub.json`) that cannot be read are said, and no
  approval is judged as counted or not, because solo mode and the engagement rule are unknown;
- an entry in the steps list that is not a step is shown as one row, `(not a step object)`, so the count
  matches the index.

**Reading an approval** in `show`:

| Words | What they mean |
|---|---|
| `stale (revoked)` | The approval's fingerprint — a hash of the content it approved — is not one the current content gives. The gate does not count it. |
| `names nobody (not counted)` | The record has no approver name. The gate counts people, so it does not count this. |
| `not engagement-verified (not counted)` | The Product requires a verified engagement signal on each approval (`review.requireEngagement`), and this one has none. |
| `inherited from EP-…` | Not an approval by a person: the item took over that epic's approved review (E42). |

A closing record's `via` word says how the step was closed — `merge`, `review-opened`, `repair` and the
rest; see *Closing records* above for each one.

**What is printed is made safe.** Every value read from a file — a title, a theme, a reason, an approver's
name, a step id — is printed on one line with control characters and bidi controls (characters that
reverse how text is shown) removed, because it reaches other people's terminals. Ordinary spaces are
kept, so a theme spelled with two spaces still looks different. A closing record's fields are printed only
when they are text, and a PR only when it is a whole number.

**`--json`.** Every answer is in the [one envelope](#--json-on-every-command-e1) (`jsonVersion`,
`version`, `command`, `ok`, `warnings`); **every other key is always present**, as `null`, `false` or `[]`
when there is nothing, so a script never has to ask whether a key exists. A refusal is the envelope with
`"ok": false`, `error`, `code` and `hint`, and exit code 1. This holds for a flag given with no value
(`--type` alone), which the argument reader refuses before the command runs.

| Command | Keys |
|---|---|
| `list` | `items`, `unreadable`, `unlisted`, `threadBroken` |
| `search` | the same, plus `query`, `summaryOnly` (items whose steps could not be read, so only their summary was searched), and on each item `matches: [{ field, value, step }]` |
| `show` | `item`, `thread: { root, broken }`, `steps`, `stepsWhy`, `approvalsWhy`, `hubWhy`; with `"ok": false` and an `error` when the steps cannot be read |

Each item has the shape of an item in `.sdlc/index.json`, plus `"shapeDone"`. In `show`, each approval
carries `"stale"`, `"counted"` and `"notCounted"` — the reason it does not count: `"not-an-approval"`,
`"stale"`, `"unnamed"` or `"unengaged"` — so a script need not re-derive the rules. **`counted` is per
record, not a count of people:** two approvals from one person are both `counted`, and the gate counts
that person once. A record counts as naming someone when its approver is any text that is not blank —
the gate's own test — even text with no visible characters (it is printed as "a name with no visible
characters"). For an **approved** record, `counted` is `null` where no count applies: in solo mode; when the Product settings cannot be
read; when the fingerprint cannot be taken; and on a step `gatePredicate` (the check that passes or holds
a gate) waives before it reads an approval — one that claims to be inherited, or skipped where the item's
route lets that step be skipped. A skip on a step the route requires is not honoured, and its approvals are
judged. A record that is not an approval is `counted: false`, except on a waived step, where every record is `null`. On a waived step `stale` is `null` too, because that check never judges it — although
`yad gate status` still prints a stale count there. In solo mode `stale` is still told.

## File shape: `schemaVersion`

Every JSON **object** `yad` writes under a `.sdlc/` directory starts with a `"schemaVersion"` — **10**
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

`.sdlc/index.json` carries the key like any other object, but `yad migrate` never lists it: it is derived,
so rebuilding it (`yad index`) is its migration.

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

**Every other command warns first when the project is ahead.** If `.sdlc/cli-version.json` or the product
config says a newer file shape than this yadflow knows, each command prints one warning on stderr before
it runs — stdout and `--json` are unchanged — telling you to upgrade before relying on what it says.
`yad doctor` and `yad migrate` report it in their own words, and `yad hook` never prints it. This is what
a 3.x yadflow could not do for shape 8 (docs/migrations/shape-8.md).

When something is off, run `yad doctor` first — it checks the environment (git, gh/glab auth, node
version), the project state (`.sdlc/*.json` parse and point at real repos), and every epic ledger,
with a fix-it hint per finding. Failures carry stable, greppable codes, also printed by any failing
`yad` command:

### The `index` section — is the Product index current? (E19)

One line about [`.sdlc/index.json`](#the-product-index-sdlcindexjson). It warns and never fails, because
nothing is lost while a derived file is behind. Nothing is said on a Product with no work items and no
index. On any branch other than the default one, a difference is expected — the index is written only on
the default branch — so the line says so and stays `ok`; only an unreadable file still warns there.

| What it says | What to do on a local Product | What to do on a verified Product |
|---|---|---|
| `.sdlc/index.json is current` | nothing | nothing |
| `… has not been built yet` | run `yad index` on the default branch, then commit it | nothing: CI builds it when it records the next merged review |
| `… is behind: it is not what this yadflow builds from the work items on disk` | the same | the same |
| `… cannot be read — <why>` | the same | the same |

### The `protection` section — does the platform require an approval? (E70)

yad never holds a merge itself. The platform does, through **branch protection** — the rules a
platform puts on a branch, such as "a pull request needs one approval before it can merge". On GitHub
these rules come in two forms: **classic branch protection** and the newer **rulesets**. The
`protection` section of `yad doctor` reads what the platform holds on the Product hub's branch and on
each connected repo's branch. It prints one line for each, and says where the answer came from.

**Which branch.** The branch yad's files name: `default_branch` in `.sdlc/product.json` (`hub.json` on an
older Product) for the Product, and in `.sdlc/repos.json` for a code repo. That is the branch the gates merge into. When the platform's own
default branch is a different one, the line says so. When yad's files name no branch, the platform's
default is read, and the line says that too.

**What counts as an approval rule** — a required approval count above 0:

| Platform | Read from | Who may read it |
|---|---|---|
| GitHub | a ruleset's `pull_request` rule — every active rule on the branch, from the repo or its organisation (`GET repos/{owner}/{repo}/rules/branches/{branch}`) | anyone who can see the repo. A host whose API has no rulesets, such as an older GitHub Enterprise Server, answers 404, and the line says so |
| GitHub | classic branch protection's required reviews (`GET …/branches/{branch}/protection`) | **repo admins only** |
| GitLab | a project approval rule that applies to the branch (`GET projects/{id}/approval_rules`) | GitLab **Premium and Ultimate** only |

Some things are printed as facts beside the answer, and are not approval rules: whether the branch is
protected at all (for example, limits on who may push to it); that a code owner must approve a change to a file
CODEOWNERS lists; and, on GitHub, that a ruleset names a reviewer who must approve a change to some files.
Whether the branch is protected comes from the branch's own `protected` flag (`GET
repos/{owner}/{repo}/branches/{branch}` on GitHub, `GET projects/{id}/repository/branches/{branch}` on
GitLab — GitLab's flag also covers protection set for a whole group). On GitHub, "not protected" is never
taken from that flag alone: it is confirmed against the active rules on the branch, and if the two answers
disagree, or the rules gave no answer, the line says the protection is not known. The branch must exist: a branch
that yad's files name but the platform does not have is "not known", never "unprotected". A line states
only what the platform answered: who may merge into a protected branch, or push to it directly, is not
read, so no line says who can merge, or that the platform holds a merge. A fact that could not be read
is said as not known (for example "whether a code owner must approve some files is not known"). On
GitLab Free an approval is optional and never blocks a merge.

**"Not known" is never "fine", and never "unprotected".** A call that fails is not an answer. GitHub
answers 404 on classic protection to anyone who is not an admin — even for a branch it reports as
protected. So yad says "no rules" only when every call it needed succeeded. Otherwise the line says
**not known**, and why:

| Reason | What the line says |
|---|---|
| No platform set, and the remote names neither | `no platform (GitHub or GitLab) is set, so there is no platform to ask` |
| A platform yad does not read | `yad does not know the platform "bitbucket" (it reads GitHub and GitLab)` |
| `gh`/`glab` missing | `gh is not installed, so yad cannot ask GitHub` |
| Not logged in for that host | `gh is not logged in for github.com (or github.com did not answer)` |
| No remote URL | `no git remote URL yad can read, so it cannot tell which repo to ask about` |
| Offline | `yad could not reach github.com to read the repo acme/app (offline, or the host did not answer)` |
| Not an admin (GitHub classic protection) | `only a repo admin can read classic branch protection, and GitHub answered 404 (your login is not an admin)`. The reason adds `, or the branch is protected by rulesets alone` only while a ruleset could be there — an empty rules list, or a host with no rulesets API, leaves it out |
| A GitHub host with no rulesets API | `GitHub answered 404 for the rules on the branch, which a host without the rulesets API does` |
| GitLab approval rules refused | `GitLab refused to show the approval rules (HTTP 403): they need GitLab Premium or Ultimate, or your login may not read them` |
| A branch yad's files name that GitHub does not have, and that GitHub does not call the repo's default | `GitHub answered 404 for the branch mian, so this repo does not have it` — the repo was read with the same login moments before, and one permission covers both |
| A GitHub repo with no commits yet — the branch GitHub itself names as the repo's default, whether yad's files name it too or not | `GitHub answered 404 for the branch main, so this repo has no commits on it yet` |
| A branch GitLab says it does not have (the answer's body is `404 Branch Not Found`) | `GitLab answered 404 for the branch mian, so this project does not have it` — or, for the branch GitLab itself names as the project's default, `…so this project has no commits on it yet`. The hint does not offer access, because the answer ruled it out |
| A GitLab repository that could not be read (the body is `404 Repository Not Found`) | `GitLab answered 404 for the branch main because this project's repository could not be read (it is turned off for the project, or your access is too low to read it)`. GitLab checks the repository before it looks for the branch, so nothing is said about the branch. The hint names one action per cause: if you own the project and its repository is turned off, turn it on; otherwise ask a Maintainer or Owner for access to the repository, or to turn it on |
| A branch GitLab answered 404 for, with any other body | `GitLab answered 404 for the branch mian (it does not exist, or your login may not see it)` — reading a project and reading its repository are two GitLab settings, and GitLab answers 404 (not 403) for a repository your login may not read. yad names the cause only when the body is one of the two exact messages above. A reworded message, or one in another language on a self-hosted server, keeps this sentence word for word |
| A GitLab rule whose branch list yad cannot read | `GitLab listed an approval rule whose branch list holds a name yad could not read` |
| A repo or project answered 404 | `GitHub answered 404 for the repo acme/app (it does not exist, or your login may not see it)`. The hint names an action for each cause: check `git_url`, or ask for access |
| No default branch in yad's files, and none from the platform | GitHub: `no default branch is set in yad's files, and GitHub named none`. GitLab: `no default branch is set in yad's files, and GitLab named none (GitLab names it only to a login that can read the project's repository)`. GitLab leaves the default out of its answer for a login that cannot read the code, so on GitLab the hint names an action for each cause: set `default_branch` in yad's files, or get the repository turned on or your access raised |
| Reads turned off | `platform reads are turned off (YAD_PLATFORM_READ=0)` |

In `yad doctor --json`, each not-known answer carries `kind`, the reason as one word (`no-branch`, `empty`, `no-repository`, `no-default`, …). When a 404 proved why, it also carries `cause`: `branch` (the branch is not there) or `repository` (the project's repository could not be read). A 404 that left both open has no `cause`. On GitLab, a `no-default` answer also carries `defaultMayBeHidden: true`, because GitLab shows the default only to a login that can read the repository.

Three real lines from team Products, each with its hint:

```text
  ! Product hub (GitHub acme/app, branch `main`): This repo has no approval rules and no branch protection. Anyone with write access can merge anything. yad will record what happens, but it cannot stop anything here.
  → only GitHub can require an approval before a merge, in GitHub's branch protection or a ruleset for `main`; yad only reports what is set
  ✓ Product hub: a pull request into `main` on GitHub acme/app needs at least 2 approvals (from: a repo ruleset (id 7)); whether a code owner must approve some files is not known — yad reports this and enforces nothing
  → ask someone who can see GitHub's settings for `main` about what yad could not read
  ! Product hub: `main` is protected on GitLab acme/app, but whether a merge needs an approval is not known — GitLab refused to show the approval rules (HTTP 403): they need GitLab Premium or Ultimate, or your login may not read them; whether a code owner must approve some files is not known
  → on GitLab Free an approval never blocks a merge; on Premium or Ultimate, a Maintainer can see the approval rules for `main` in the project's merge request settings
```

| Line | Level (team) | Level (solo) |
|---|---|---|
| A pull request (GitLab: merge request) into a protected branch needs N approvals | ok | **warn** — you cannot approve your own pull request, so the merge is blocked unless you may bypass the rule (who may bypass is not read); on GitLab the merge may be blocked, by a project setting yad does not read |
| No approval rule **and** no branch protection, both proven, and no rule covering only some files — Part 3's banner, word for word | **warn** | ok, worded for solo mode |
| Not protected, and only some changes need an approval (a code owner or a named reviewer) | **warn** | ok |
| Protected, but no rule requires an approval — "on every change" when a rule covering only some files is true, or could not be read | **warn** | ok (with its hint, when something could not be read) |
| Protected, and whether a merge needs an approval could not be read | **warn** | ok |
| Not protected, and whether a merge needs an approval could not be read | **warn** | ok |
| Not protected, and the approval rules the platform has miss this branch — they reach protected branches only, or they name other branches (one rule reads in the singular) | **warn** | ok |
| Whether the branch is protected could not be read, and neither could the approval | **warn** | ok |
| A count was read, but whether the branch is protected could not be | **warn** | **warn** |
| No rule requires an approval, and whether the branch is protected could not be read | **warn** | ok |
| A merge request needs N approvals, but the branch is not protected, so a direct push skips them (GitLab) | **warn** | **warn** |
| Not known at all, with why | **warn** | ok |

"At least N" means part of the answer could not be read — for example classic protection, while a ruleset
asks for N, or a list that filled a whole page — or that several GitLab rules each ask for approvals and
their approvers may overlap. A count must be a whole number the platform gave; anything else (missing,
`2.5`, `true`, `"2"`) is "could not read", never 0 and never 1.

**It is advisory.** A line is a warning at most, never a failure: the platform holds a merge, and yad only
reports what is set. How to set up branch protection is not documented here. A line in this section
that has a fix-it hint prints it whatever its level — `yad doctor` otherwise shows a hint only for a line
that is not `ok`. That matters most in solo mode, where a line that could not be read is `ok`. A line that
was read in full, and has nothing to fix, has no hint.

**How it reads.** With your own `gh` or `glab` login, from the repo's own host — nothing is written,
and nothing is sent anywhere else. `gh auth status --hostname <host>` (or `glab`) is asked once per host.
Then, per repo, up to four read-only calls on GitHub (the repo, the branch, its rulesets, and classic
protection when GitHub's own flag says the branch is protected) and four on GitLab (the project, the
branch, its protected branches for the code-owner fact, and its approval rules). Each call has a 10-second limit. `YAD_PLATFORM_READ=0` turns the reads off, for example offline; every line then
says not known.

**Limits.**

- Only the first 100 entries of each list are read. When a full page leaves the answer open, the line says
  not known, or "at least N" when it found a count.
- GitHub rulesets in "evaluate" or "disabled" mode are not active, so they are not counted.
- Who may bypass a rule (for example an admin) is not read.
- Who may push directly to a protected branch is not read (GitLab's `push_access_levels`). On GitLab a
  direct push by someone allowed to push skips the merge request, and with it the approval rule.
- On GitLab, a line does not mention the project's approval rules that reach other branches only, except
  on an unprotected branch where nothing else requires an approval; it says what does and does not hold a
  merge into this branch.
- On GitLab, whether a code owner must approve is read from the project's own protected-branch list, which
  leaves out protection set for a whole group — and a group's setting takes precedence over the project's.
  So only an entry for the branch that says yes is proof; an entry that says no proves nothing, and only a
  branch that is not protected proves that no code owner is needed. Anything else is "not known".
- GitLab's tier (Free, Premium, Ultimate) is never guessed. Only two answers say anything about it: a list
  of approval rules that came back settles it (that endpoint answers on Premium and Ultimate only), and a
  refusal (401, 403 or 404) leaves it open, which is the one case a hint mentions Free. An answer that
  settles nothing — offline, a server error, a body yad could not read — names no tier, and its line points
  at what could not be read.
- A source named the same way is named once: a hundred rules from one ruleset read as one source. The
  count beside it does not change — two GitLab rules that share a name are still two rules, so the line
  still says "at least".
- In CI, `gh` logs in with the job's token, which usually cannot read classic branch protection: the line
  then says not known (HTTP 403 or 404), never "no rules".
- GitHub's own `protected` flag is the starting point, but yad never takes "not protected" from it alone.
  It confirms with the active rules on the branch. If the flag says "not protected" while GitHub also lists
  active rules, the two answers disagree, and the line says the protection is not known — beside whatever
  it did read about the approval. The same when the rules gave no answer: a call that failed, or a 404,
  which on that endpoint is a host without the rulesets API.
- On a GitHub host that has no rulesets API (an older GitHub Enterprise Server), every read goes through
  that 404, so "not protected" is never proven there: a branch GitHub's own flag calls protected still
  prints as protected, and any other branch prints as not known. Part 3's banner, which needs a branch
  proven unprotected, is therefore never printed on such a host.
- A GitLab report rule (such as Coverage-Check or License-Check) asks for an approval only when its report
  fails, so it is not counted as an approval rule. A GitLab approval rule that does not say which branches
  it covers, or that lists a branch yad cannot read, makes the count not known — or "at least N" when
  another rule applies. A listed branch that yad CAN read, and that matches, still settles it.
- A GitLab server served under a sub-path (`https://host/gitlab/group/project`) is not supported: the
  sub-path is read as part of the project's path, and GitLab answers 404.

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
| `YAD-STATE-004` | an epic step cannot be skipped, deferred, put back, or unblocked in its current state | the step must be one the epic's own [lifecycle route](#lifecycle-profiles-the-route-an-epic-takes) marks optional — `ui-design` on `classic` and `analysis-first` — and needs a `--reason`; it can be skipped only up to authoring it (before its review opens / before the step after it starts — `stories`, on `classic`); `yad unskip` works until a step past that one starts (the stories review, on `classic`). `yad defer` and `yad undefer` follow exactly the same rules, and neither will change a step the other one set aside. A step that is `blocked` must be cleared with `yad unblock` before it can be skipped or deferred, and `yad unblock` refuses a step that is not blocked. A chain on **no** route has nothing optional: fix `step:off-route` first |
| `YAD-STATE-005` | an authoring step is stranded behind its completed review gate | a pre-3.11 `gate sync` could advance a review step while leaving its author step `in_progress`, silently blocking every later step (and the parallel `test-cases` track). Run `yad gate repair <epic>` |
| `YAD-STATE-006` | a Build ledger (`build-log`/`trust-log`) is locked by another yad process writing it | every read-modify-write on these ledgers (`--retro-ship`, `yad review reconcile`, `yad tidy up`) takes an exclusive lock, so two runs can never interleave and lose an entry. Wait for the other command and re-run; a lock left by a killed process is reclaimed automatically after 30s, or delete the `.lock` directory the message names |
| `YAD-CFG-001` | `hub.json` names an unknown platform | expected `github`, `gitlab`, or `null` — fix it or re-run `yad setup` |
| `YAD-CFG-002` | `design.json` names an unknown design tool | expected one of `config.yaml` `design.tools` (e.g. `figma`, `pencil`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-003` | `testing.json` names an unknown testing tool | expected one of `config.yaml` `testing.tools` (e.g. `playwright`, `cypress`, `pytest`, `maestro`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-004` | `learning.json` names an unknown learning tool | expected one of `config.yaml` `learning.tools` (e.g. `deeptutor`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-005` | `hub.json` sets a platform but is missing `git_url` (needed to scope auth + open PRs) | add `git_url` to `.sdlc/hub.json`, or re-run `yad setup` — it backfills it from the origin remote |
| `YAD-CLI-001` | a `--json` run needed an answer only a prompt could give (E1) | a `--json` run never asks a question. Pass the answer as a flag (`yad --help` lists them), set `SDLC_NONINTERACTIVE=1` to take the defaults, or run without `--json` |

Filing a bug? The fastest path is **`yad report`** — it files the issue for you in the yadflow repo
with **auto-scrubbed** diagnostics (versions, tool present+authenticated booleans, the Product platform
enum, the error code/hint, a path-scrubbed message, and the failing command + flag *names* only). It
never posts absolute paths, hostnames, git URLs, repo names, logins/emails, epic IDs, branch
names, or flag values; it shows you the exact payload and asks before posting to the public repo, and
searches for duplicates first. After an unexpected failure the CLI also **offers** to run it for you —
set `YAD_NO_REPORT=1` to opt out. Prefer a hand-written issue? Attach `yad doctor --json` (names,
paths, and check results only — review and redact before posting).
