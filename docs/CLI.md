# The `yad` CLI — install, update, reconcile, drive the gates

The full command reference for the `yad` CLI. For an introduction see the
[README](../README.md); for a step-by-step walkthrough see [`WALKTHROUGH.md`](WALKTHROUGH.md) or the
[plain-language team guide](../TEAM-GUIDE.md).

The module ships a zero-dependency CLI, published to npm as
[`yadflow`](https://www.npmjs.com/package/yadflow). Run it with `npx` from your **Product** repo —
no clone needed.

> **Platform support.** Linux and macOS are first-class — the test suite, the bash check gates, and
> the end-to-end harness all run on both in CI. **On Windows the agent hooks run natively, without
> WSL** (E113): they are Node scripts, and CI runs them and the Windows-facing CLI tests on Windows.
> Claude Code needs **Git Bash** (part of Git for Windows) to run hooks there. Set
> `git config core.autocrlf input` in the Product clone — approvals are bound to exact bytes, and a CRLF
> checkout reads them as stale (`yad doctor` warns). The bash check gates run on your CI runner, not your
> machine. The rest of the CLI, the full suite and the end-to-end harness are not yet tested on Windows.
> Requires **Node.js ≥ 18**. The details, per agent and per tool: [Platform support](#platform-support).

## Commands

The commands, by what they are for:

| Group | Commands |
| --- | --- |
| Start a workspace | `new`, `init`, `join`, `setup` |
| Drive the lifecycle | `next`, `epic new`, `foundation`, `gate`, `skip` / `defer` / `unblock`, `mode`, `dial`, `kill`, `skill` |
| Drafts and owners | `capture`, `claims`, `fold`, `assign` / `unassign` / `owners` |
| Build | `commit`, `open-pr`, `ship`, `review`, `checkpoint`, `tidy up` |
| Code repos | `repo` (`list`, `clone`, `refresh`, `sync`), `risk-map`, `codeowners` |
| Feature threads | `thread`, `reconcile` |
| Read the record | `history`, `index`, `usage`, `docs` |
| Keep healthy | `doctor`, `check`, `update`, `migrate`, `report`, `sync-status` |

**Where a command runs (E80).** A **workspace** is the folder that holds the Product and the code repos
side by side. It carries `.yad-workspace.json` — `{ "version": 1, "product": "product" }`, the Product
folder's name and nothing else (the repo list stays in the Product's `repos.json`). It is per machine:
`yad new`, `init` and `join` write it, and `yad check --fix` writes it for a Product whose registered
repos live beside it (`yad check` and `yad doctor`'s `workspace-file` line say when it is missing).

- **A Product command** (`next`, `gate`, `epic`, `doctor`, `check`, `update`, …) run anywhere inside
  the Product, or inside any repo the Product **registers** in `repos.json` (any folder in it; a link
  to it counts), works on the Product and says so on stderr — `Product: ../product (from
  .yad-workspace.json)` — never on `--json` stdout. Anywhere else in the workspace — the workspace folder
  itself, a repo the Product does not register — there is no Product: a workspace can be a shared folder
  such as `~/Projects`, holding other teams' repos, and those must never reach this Product. yad names
  where the Product is instead (`the Product is product: cd there`), and `yad setup` refuses to make the
  workspace folder a second Product. The same rule holds for a git repo nested inside the Product's own
  folder (`vendor/lib`): it reaches the Product only if the Product registers it.
- **`risk-map` and `codeowners`** run inside a registered repo's own checkout work on that repo; run from
  the Product (as before), or from a worktree or repo nested inside a registered one, on every registered
  repo.
- **A code-repo command** (`commit`, `open-pr`, `ship`, `review`) works on the repo you are in.
  `open-pr`, `review` and `ship`'s PR step also read the Product beside it: run in a registered repo
  without `--repo`, they take that repo's recorded name, platform and default branch. `open-pr` and
  `review` do so from any folder inside the repo, and work at its top; `commit` and `ship` run from the
  repo's top, as before. A worktree or a repo nested inside a registered repo is another checkout: the
  command works there, as it did before E80.
- **`--dir` always wins.**
- **A command that writes the Product** (`update`, `check --fix`, `epic new`, `foundation new`,
  `skill bind`/`unbind`, `dial … --to`, `kill`/`unkill`, `docs sync --wire`) refuses a
  folder that is not a Product, rather than writing its files into a code repo.
- A workspace file **inside a git work tree** (a repo could commit one pointing at a folder of its own),
  in your home or temp folder, or of another `version` is not used: yad stops there and says why, rather
  than going on up to whatever Product lies above. It is never written there either.

| Command | What it does |
|---------|--------------|
| `yad new <name>` | Greenfield front door (E79): makes `<name>/product/`, runs `git init` on branch `main`, then runs `setup` inside it (every setup flag passes through; greenfield unless `--brownfield`). Refuses a name with a separator or a leading `.`/`-`, a folder that is not empty, and a folder inside a git repo. **Creates no remote** — it prints the `gh repo create` / `glab repo create` lines (after the first commit) for you to run. |
| `yad init` | Brownfield front door (E79), run in the folder that already holds your repos: makes `product/` there (or uses the one child with `.sdlc/product.json` or the older `.sdlc/hub.json`; `--path <folder>` names it — an existing folder that holds files and is not a Product is refused, so your code never becomes the Product), then runs `setup` inside it with one yes/no per repo found beside it (yes also **wires** it: its CI gates and PR template are written into it, as `setup` does for every repo it connects) — the platform read from its `origin`, the default branch from `origin/HEAD` else the branch it is on. Refused inside a git repo (for one repo holding all the code: `yad setup --brownfield --monorepo` in it). |
| `yad join <url> [folder]` | Teammate front door (E79): clones the Product into `[folder]/product/` (default folder: the URL's last name, so `new acme` → `acme.git` → `acme/`), then every repo its `repos.json` lists, at its Product-relative `path`. Each entry is judged first: a path outside the workspace (by its text), a path with a link among the folders on its way (a link the Product commits — `evil -> ../../..`, `g -> .git` — would make the clone land somewhere its path does not say), a path through a `.git` folder (any case, and Windows' `GIT~1`: a clone there would plant a git config or hooks that run commands — `setup` refuses these paths too), a path through a file, a missing `git_url`, a URL starting with `-`, a folder in the way are reported and skipped; a failed clone never stops the rest, and exits 0 (a failed **Product** clone exits 1). Then only per-machine steps: the skill copies the Product's git **ignores** (`--ide-targets` picks the folders; ignore the folder itself, e.g. `.claude/` — a folder-only pattern such as `/.claude/skills/yad-*/` cannot match a folder that does not exist yet, so those copies are left as shared; a copy already there and older than this yadflow is left as it is) and the git pre-commit hook. It writes no file the team shares in your checkout — a shared skill folder that is missing or old is `yad update`'s change. It then shows the toolbox check, read from the cloned Product: the tools the team uses that this machine lacks, with how to get each; nothing is installed (E85). **Last, it runs `yad member add` (E131)**: your member file, on its own branch with its own PR/MR — the one shared change `join` makes. Any problem there is a warning and the command to run later; it never fails `join`. Re-run it to fetch what is still missing; a repo a teammate registers **after** you joined is cloned by `yad repo clone` (E81), which needs no URL. A registered repo's `git_url` must be a network address (E81 review 3; `YAD_ALLOW_LOCAL_REMOTES=1` allows an absolute path to a folder that exists outside the workspace); the Product's own URL, which you type, may be anything git clones. `--dir` is never the Product for these three: for `init` it is the workspace; for `new` and `join` it is the folder the workspace is made in. |
| `npx yadflow setup` | Guided first-run wizard — a short **profile interview** (solo/team, greenfield/brownfield, monorepo/separate) then the branched steps below. Pre-answer for CI/scripts with `--solo`/`--team <n>`, `--greenfield`/`--brownfield`, `--monorepo`/`--separate`, `--tools`. |
| `yad epic new <slug>` | **Start an epic — the engine writes its lifecycle.** Seeds `epics/EP-<slug>/.sdlc/state.json` with the step chain of a [lifecycle profile](#lifecycle-profiles-the-route-an-epic-takes), plus an empty `approvals.json`, an empty `comments.json` and the `reviews/` directory. `--type feature\|chore` (default `feature`). **A `change`, `defect` or `hotfix` needs `--parent EP-<slug>`** (E42) and takes the parent's route — a `--profile` naming any other route is refused. `--inherits epic,architecture,contract,ui-design` carries those steps by reference: each is written `satisfied`, with `inherited: true`, `inheritedFrom` (the epic along the parent's line that owns the artifact) and `boundHash` (that artifact's hash), and `approvals.json` gets one `inherited` provenance record per carried gate. `analysis` rides with `epic`. Carrying `architecture` and `contract` (always together) writes a **pointer-lock** — `contract-lock.json` holding the owner's hash verbatim, with `inheritedFrom` and `ref` — instead of a second contract: you may skip authoring a contract, never having one. `stories` and `test-cases` are never inherited. It refuses to carry anything the owner did not write **and** approve: a skipped step (skip it on the new epic instead), a deferred one (author it here, so the owed work follows the thread), an unfinished one, a missing artifact, and an approved architecture with no lock or with a surface that no longer matches its lock. Off a brownfield anchor the bases carry `boundHash: null` and no lock is written. `parent:` and `inherits:` in an existing `epic.md` win over no flag, and a flag that contradicts them is refused. The `yad-change` skill decides what is inherited, then runs this. `--profile classic\|analysis-first\|chore\|spike` (default `classic`) — `chore` and `spike` are the [short lanes](#the-short-lanes), and neither carries an architecture gate, so neither may move the contract surface. Both Product-level ids (`EP-foundation`, `EP-discovery`) and both product routes are refused: the Product level has a fixed id and no `epic.md`, so `yad foundation new` seeds it. `--stub` mints a brownfield **anchor** instead: the same `classic` chain with every step `todo`, the marker `kind: "stub"` and `currentStep: "backfill-pending"`, so a defect can thread off a feature that shipped before the Product existed (`yad-backfill promote` wakes it). A stub is always a `feature` and always `classic`; `--type` and `--profile` are refused with it. `--json` for a script — its `next` key names the skill to run now, with a `nextSkills` array beside it when the step is bound to a chain (the same rule `yad next --json` follows: the array appears only when there is more than one). It writes **no `epic.md`, no branch and no commit**: the epic document is prose you author with the skill the chain names next. **Refuses an epic that already has a `state.json`** — nothing here overwrites a ledger, and there is no flag for it. Every skill that starts an epic runs this rather than writing a chain of its own — `yad-change` included, since E42. |
| `yad foundation new` | **Start the Foundation — the Product level (E75).** Seeds `foundation/.sdlc/state.json` with the two-step `foundation` route (`foundation` → `foundation-review`), under the fixed id `EP-foundation`, plus an empty `approvals.json`, an empty `comments.json` and `foundation/reviews/`. Run once per product, before any epic; then the `yad-discovery` skill writes the sections — `purpose.md`, `scope.md`, `mvp.md`, `roadmap.md`, `stack.md`, `repos.md`, and the optional `market.md` and `risks.md` — and `yad gate open EP-foundation foundation/` opens its review. It writes **no section, no branch and no commit**. A section that still holds nothing but its template makes `yad gate open` and `yad gate sync` warn "Foundation not written yet", and `yad doctor` reports it as `foundation:unwritten` once the review has opened or passed (E76) — a warning, never a refusal. **Refuses a second Foundation**, and **refuses a product still on the old `epics/EP-discovery/`** — a product has one product level, and `yad migrate --apply` converts the old one on a local ledger ([shape 8](migrations/shape-8.md)). `--json` for a script: `next` names the skill to run, and `sections` lists the required and optional files. |
| `yad foundation status [--json]` | **Which roadmap features are started — read, never written.** Reads the feature tables in the Foundation's `roadmap.md` (any table whose header has a `Proposed epic id` column, under its phase heading) and reports each feature from its epic's ledger: `planned` (no ledger — no `state.json` — for that id yet), `in-shape` (seeded, still in Shape), `in-build` (Shape done, not shipped yet) or `shipped` (every story in the epic's `stories/` has a Build state, every repo each story declares has a lane, and every lane is shipped — or the epic is a brownfield anchor). A table inside a code fence is an example and is not read; a heading ends a table. A row whose id is not a valid feature id, or whose ledger does not load, is named as a problem. It also lists feature epics no row proposes (folders with a ledger only; the type comes from `epic.md`, or from the ledger when there is none), since `yad-epic` may give an epic a different id. When both product levels exist it reads `foundation/` and warns. The roadmap's `Status` column is **no longer kept by hand** — editing that table after the Foundation is approved makes its approvals read as stale — so a written status is shown only where it disagrees with the ledgers (`epic-started`, the old word for a seeded epic, agrees with `in-shape` and `in-build`). Reads the old `epics/EP-discovery/` spelling too. Refuses when there is no Foundation or no `roadmap.md`. `--json`: `{ ok, epic, roadmap, approved, features: [{ phase, feature, epicId, status, written, disagrees?, problem? }], unlisted, warnings? }`. |
| `yad next [<epic>]` | **Where am I / what next.** With no epic: project-wide orientation — the one next action (run setup, start an epic, or the single active epic's step). With an epic: that epic's exact next action (a skill to invoke or a `yad` command to run). Once the epic is `ready-for-build`, it reads each story's `build-state` and prints the next **build sub-step per repo** (`spec → tasks → implement → checks → engineer-review`) plus the remaining chain and the automation dial — so Build is guided too, not just hinted at. `yad next <epic> --check <step>` exits non-zero when a step is run out of order (the precondition guard); `yad next --all` lists every epic's next action. **`--json`** emits the same answer as a machine-readable action object instead of prose — for an agent or a CI job that would otherwise have to regex the coloured output. Exit codes are unchanged. In solo mode the project view (no epic) first suggests `yad mode team` when more than one person may work on the Product (E74, see [When solo mode may be wrong](#the-pr-driven-review-gate)). |
| `yad skill list [--profile <p> \| --epic <id>]` / `yad skill bind <step> <skill>… [--profile <p>]` / `yad skill unbind <step> [--profile <p>]` | **Choose which skill runs which step — for every epic, or for one route.** The engine ships a default for every step; a project that wants its own records it in `.sdlc/skills.json`, and `yad next` names that one from then on. With `--profile <p>` the line applies only to epics on that route (`classic`, `spike`, `chore`…) and wins over the project-wide line on them. `list` shows every step a skill runs — Shape review gates are excluded, since `yad gate` drives those — what runs each one, and where that answer came from: `profile` (you bound it for this route), `project` (you bound it for every epic), `engine` (the default) or `ignored` (your file has a line for that step and the line names no skill, so the next layer still runs). `--profile` shows one route's view; `--epic <id>` shows the view of that epic's route. Each row says whether each skill is **installed here** (`installed`, from `yad detect`); a skill that is not found is marked `?`. `--json` for a script; it adds `profile`, `epic` (with `--epic`), `installedChecked` and `profiles` (every route's own lines). `bind` takes one skill or several — several run as a **chain**, in the order given, each seeing what the one before it produced, and the last output is the artifact; every extra skill is another model run, so the command says so. A **Shape review gate** is refused (nothing would ever invoke the binding); `engineer-review` is a Build step in its own right and **is** bindable. A step this release does not know is recorded with a warning, because your file wins. With `--profile`, a step the route never walks (`architecture` on `spike`) is refused, and a route this release does not know is recorded with a warning. `bind` warns when a skill is not installed here and writes it anyway — a teammate may have it. `unbind` drops the line and the step goes back to the next layer: the project-wide line, then the engine's default. See [choosing the skill for a step](#choosing-the-skill-for-a-step). `list` also names the **recommended** skills for each step still on the engine's default, and its `--json` adds `recommended` (on every row; empty for a step the route shown never walks) and `catalogue` (`version`, `checked`, `age`). |
| `yad skill recommend [<step>] [--profile <p> \| --epic <id>]` | **Hand-picked skills worth binding to each step (E52) — it binds nothing.** Reads the recommendation catalogue: a short list, shipped inside yadflow, of named skills from the three recommended pools (BMAD-METHOD, ECC, mattpocock/skills), at most three per step. For each one: its pool and licence, one sentence on why it fits, whether this step **already runs it** (a `✓`), whether it is **installed here** (`yad detect`; `?` when not), and the exact `yad skill bind` command — the pool skill **first** and yadflow's own skill **last**, so yadflow's skill still writes the artifact the gate checks. It prints the catalogue's own **version and age** first. With a step, that step only; a review gate and a step this release does not run are refused. `--profile` / `--epic` work as for `list`: only the steps that route walks are shown (a step it never walks is refused), and the printed commands carry `--profile`. `--json`: `catalogue` (`version`, `checked`, `age` in days), `step`, `profile`, `epic` (with `--epic`), `installedChecked`, and `recommendations` (`step`, `skill`, `pool`, `reason`, `caveat`, `file`, `licence`, `bound`, `ownSkillDropped`, `installed`, `bind`, `command`, `vetted`). See [recommended skills](#recommended-skills-the-catalogue). |
| `yad detect` | **See what is installed for the agents that work here.** Lists the skills, agents (subagents), MCP servers and plugins found in this folder and in your home folder, and which agents read each place — Claude Code, Codex CLI, Cursor, Gemini CLI, GitHub Copilot, Zencoder, opencode. Read-only: it writes nothing and uses no network. An MCP server is named, never described — its command, arguments and settings can hold a token. `--json` lists every item with its version and content hash (a sha256 of its `SKILL.md` or agent file, with Windows line ends counted as plain ones). See [what is installed](#what-is-installed). |
| `yad toolbox list` | **See the external tools yadflow can use, and which you have.** Lists every tool in the toolbox in three groups — **core** (offered at setup: Repomix, Spec Kit, Impeccable), **recommended** (pools of skills you may choose: BMAD-METHOD, ECC, mattpocock/skills) and **connectors** (the design, testing and learning tools a Product connects: Figma, Pencil, Playwright, Cypress, pytest, Maestro, DeepTutor). For each: what it is for, whether it is found here, whether this Product uses it, and what yadflow does without it. Read-only; it installs nothing. `--json` adds each tool's licence, source, checked date, install commands and where it was found. `yad toolbox` alone is `list`. See [the toolbox](#the-toolbox). |
| `yad toolbox add <id>` / `yad toolbox remove <id>` / `yad toolbox check` | **Choose the tools this Product uses (E86).** `add` marks a tool as used here and prints how to install it; `remove` stops using it. The choice is saved in the Product's `.sdlc/toolbox.json` — commit it so the team shares it. `add <id> --custom --role "<text>" --fallback "<text>" --detect <kind>:<name>[,…]` adds a tool of your own (`--install "<type>: <command>"` and `--source <https URL>` are optional). Neither installs anything. `check` lists the tools this Product uses that are not ready here, each with how to get it and its fallback; it never fails, because no tool is required. See [choosing the team's tools](#choosing-the-teams-tools). |
| `yad dial <step> [--to auto\|human]` / `yad dial <epic> <story> --repo <name> <step> [--to auto\|human]` / `yad kill --reason <text>` / `yad unkill [--reason <text>]` | **Set a step's advance dial, and the kill switch (E34).** Automation is no longer earned: the team sets the dial, and the engine shows the step's run record beside it as **advice, never a refusal**. With one word, `yad dial` sets a **Shape author step** for the whole project, in `.sdlc/automation.json`; that choice is **recorded, not acted on** — nothing drives a Shape step on its own until the engine runs agents. With an epic, a story and `--repo`, it sets a **Build lane step** (`spec`, `tasks`, `implement`, `checks`) in `build-state/<story>.json`, writing both dial names, and prints that step's run record in that repo (runs, % `approved-unchanged`); the `yad-run` skill then moves past the step on its own after a clean run. No `--to` only reads, and a gate asked that way answers `human` — it is always a person. The Foundation steps are Product-level and refused. A review gate — the engineer review and every Shape review — is refused, and so is a lane step `yad-run` has not written yet, an undeclared repo and a skipped lane. `yad kill --reason` holds **every** step at `advance: human`, recorded with who, when and why in `.sdlc/automation.json`; `yad unkill` lets each step follow its own dial again, keeping the record it replaces as `kill.previous`. An `automation.json` that will not parse is read as the kill switch ON, and neither command writes over it. `--json` on all three. `yad next` says when a dial is held by the kill switch, and that a Shape `auto` is only recorded. The old `kill_switch` line in `_bmad/sdlc/config.yaml` is no longer read — `yad doctor` fails on one left `true`. |
| `yad mode` / `yad mode solo --reason <text>` / `yad mode team [--reason <text>]` | **Who must approve (E10).** Solo mode waives the approval requirement on every review gate — the merge and the resolved threads still decide — and team mode counts approvals. With no word it reads the mode the gates act on and the last change; in solo mode it also counts the active people and suggests `yad mode team` when more than one person may work on the Product (E74 — a suggestion only, see [When solo mode may be wrong](#the-pr-driven-review-gate)). `yad mode solo` needs `--reason`, because every open gate stops counting approvals, CI's included on a verified Product; `yad mode team` takes one optionally. The change is recorded as `mode_set` (`from`, `to`, `by`, `date`, `reason`) in `.sdlc/product.json` / `hub.json`, and `mode: solo\|team` is written beside the `solo` flag — `solo` is still the one the gates read this major. **Nothing looks back:** a gate that already passed keeps its record, and the command names each open review, which follows the new mode from its next sync. A gate that passes in solo mode records `waived: "solo"` on its closing record, and `yad gate status` prints it. On a verified Product the open reviews live on the platform, so it says that every open review PR/MR follows the new mode from its next CI run, and `--json` carries `openReviewsKnown: false`. The Product config that is read (`product.json`, or `hub.json` when it is absent) is never written over when it will not parse. `--json` for both. |
| `npx yadflow check` | Read-only report: what is **missing** / **outdated** (drifted) / **modified** (a managed file *you* edited — see [managed files](#managed-files-what-yad-owns-and-what-you-edited)) / **stale** (code-context) / **legacy** (an old installed name: pre-2.0 `sdlc-*`, or 4.0's `hub` → `product` renames) / **removed** (a skill dropped in a later release that still lingers in the install) vs the bundled manifest. |
| `npx yadflow check --fix` | Reconcile: fill what is missing **and** update what changed — touches nothing already correct, and never overwrites a managed file reported as `modified`. `yad check`, `check --fix` and `update` all end with a **Toolbox** section: the tools this Product uses that are not ready here, with how to get each — offered, never installed ([the toolbox](#the-toolbox), E85). |
| `npx yadflow update` | Apply drift only (alias for `check --fix --scope=changed`). Also migrates an old install in place: `sdlc-*` skill copies and marker-owned `sdlc-*.yml` CI files are replaced by their `yad-*` names, and 4.0's `hub` → `product` names likewise (E123: the `yad-hub-bridge` skill becomes `yad-product-bridge`, the Product's `yad-hub-checks.yml` workflow becomes `yad-product-checks.yml`, and on GitLab the include line naming it in the root `.gitlab-ci.yml` is rewritten to the new path). A same-named file *you* authored is never touched; an old CI file yad installed is removed only when the provenance record shows it is unedited — one installed before that record existed is removed after a `<file>.yad-orig` copy, and one you edited is kept (`modified`) until `--overwrite-local` — without its new name beside it, so nothing runs twice. Files of your own that name an old CI name are listed with file and line, never edited (see `renamed-ref:` under `yad doctor`), **and** purges any skill removed in a later release that a prior install left behind. A gate script or CI file a newer release **adds** to a repo's wiring is installed on every repo that is already wired (reported as `new`); a wired file you deleted on purpose stays deleted (the provenance record proves yad wrote it — on a repo wired before that record existed, 3.16.0, the first update re-adds such a file once; delete it again and it is recorded and stays gone), and a repo with none of its wiring is left for `yad check --fix`. A managed file you edited is reported and **left alone**; `--overwrite-local` replaces it after saving a `<file>.yad-orig` backup. It also writes and refreshes each connected code repo's `.sdlc/product-link.json` (E120) — the Product's `git_url` (with any user name or password taken out) and `default_branch` (left empty when the Product names none), and the `path` where CI checks the Product out, which is kept once set. A record that is right on disk reads `ok` — like every wired file, so a fresh `yad setup` reports no drift — but one not committed as it stands (never committed, or changed since) is still staged and committed by `--push`; one the repo's `.gitignore` covers is not, and `yad doctor` names it. |
| `npx yadflow update --push` | Everything `update` does, **then commits each repo's applied changes and pushes them straight to the default branch** of the Product and every connected repo — one `chore(yad-update): sync SDLC install to yadflow vX.Y.Z` commit per repo, so a version upgrade "just lands" instead of leaving dirty trees to hand-commit across N repos. Stages an **explicit per-repo allowlist** (never `git add -A`); commits **only on each repo's default branch** (a repo on a feature branch is **skipped with a warning**, never disrupted; `--allow-branch` overrides). No PR/MR — so the `pull_request`/`merge_request` gate suite never fires; the push-on-default-branch **`yad-update-guard`** workflow/fragment runs **only** `verified-commits` + `commit-message` over it (deliberately **no** `[skip ci]`). Prints an announce banner first — **announce the team & pause merges until it completes**. Also spelled `check --fix --push`. |
| `npx yadflow doctor [--json]` | Environment + state health: tools on PATH and platform auth, config files parse and point at real repos, every epic ledger loads, **each epic's `contract-lock.json` still matches its surface**, and **no completed review gate is left holding no approval (fail) or only stale ones (warn)** — solo mode waives the first, since approval is waived there by design. It also **warns** when people data an older release wrote is still on disk and no longer decides anything — a `roster` (`people:roster-unused`; its name → login pairs let a gate write record the login on older approval and comment records, and the hint counts the records still waiting — and in which epics — or says it is safe to delete; `people:roster-ambiguous` names a roster name given to two logins; `people:allowlist-gate-stale` names an older `checks/verified-commits.sh` that still enforces the author list), repo `domain_owner(s)` (`people:domain-owners-unused`) or an author allowlist (`people:verified-authors-unused`); it never deletes them. In solo mode it counts the active people and warns `mode:suggest-team` when more than one person may work on the Product, or when the people could not be counted (E74). Exit 1 on any failure; `--json` for CI and bug reports. |
| `npx yadflow migrate [--apply] [--keep <product or hub>] [--json]` | **Move this project's state files onto the shape this yadflow expects.** Prints a table of what *would* change and writes nothing until `--apply`, which copies every file it rewrites to `<file>.yad-orig` first. Safe to run twice — the second run reports there is nothing to do. A file newer than this engine, or one that does not parse, is reported and never touched (exit 1). In `verified` mode the CI-owned gate ledger is skipped and named: CI stamps it on its next sync. **`--keep product` or `--keep hub`** (E122): a file that has two names until v5 — `.sdlc/product.json` and the older `.sdlc/hub.json`, or an epic's `product-prs.json` and `hub-prs.json` — can hold two different contents; every other command then refuses (`YAD-STATE-008`). The preview shows what differs, and `--apply` asks which copy to keep. With no terminal, or under `--json` (where a command never asks), `--keep` gives the answer, and `--apply` refuses without it. The copy kept is written over the other one byte for byte, after the other one is saved beside itself as `<file>.yad-orig`. Upgrading from 3.x? See [Upgrading to 4.0](migrations/upgrading-to-4.md). See [file shape](#file-shape-schemaversion). |
| `yad sync-status [epic] [--dry-run]` | **Bring each artifact's `status:` line in line with the ledger.** Reads `.sdlc/state.json` and rewrites only the `status:` line in the frontmatter (the `---` block at the top) of each artifact: `draft`, then `in-review` (the review is open, or the author step is done), then `approved` (the review gate passed). It only moves a status forward, and it leaves a Build word (`in-build`, `shipped`, `ready-for-build`, and the like) alone. A gate that was skipped or deferred says nothing about the file, so its artifact is left as it is. With no epic it sweeps every epic and the Foundation; `--dry-run` prints what would change and writes nothing. `yad gate ci --merged` runs the same step at merge on a verified Product. |
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
| `yad gate review <epic> [artifact]` | **The grounding bundle for the review companion** (the `yad-review-companion` skill). Prints one JSON object — always JSON, with or without `--json` — holding what a reviewer's AI needs to explain the artifact: the artifact's path, the review step with its risk tags and approval rule, the contract (for an architecture review), the PR/MR, the active-people count and each connected repo's code-map. The skill writes the 60-second briefing and the swipe cards from it. Reads only; the CLI never calls a model. |
| `yad gate walkthrough <epic> [artifact]` | **The same bundle plus ordered stops** for a guided, teaching review (the `yad-pair-review` skill). The stops come from the artifact's diff against the default branch, tagged by risk, highest risk first. When there is no diff, `stops` is empty and the skill walks the artifact section by section. Always JSON; reads only. |
| `yad gate trailer <epic> [artifact] --body <text> [--pr <n>]` | **Post the companion's 60-second briefing into the review PR/MR description.** The text goes between fixed marker lines, so running it again replaces the block instead of adding a second one. `--pr` names the PR/MR when the ledger has none recorded (on a verified ledger the PR is recorded only at merge). Needs a platform; a platform write only, never a ledger write. |
| `yad gate ci [--branch <head>] [--pr <n>] [--merged] [--no-push]` | The CI entry the Product workflow calls **at merge** (and from its scheduled reconcile — nothing fires pre-merge, where the platform PR/MR holds the review state): derive the epic/artifact from the `review/EP-*` branch, run the same sync, and commit **only the ledger** to the Product default branch. On a merge run it also records the platform login on older roster-era approval and comment records in **every** epic, including one with no open review (E64), skipping an epic with uncommitted changes under `.sdlc` or `reviews`. **One exception, once:** on a verified Product it also moves an old-spelling product level (`epics/EP-discovery/` → `foundation/`, shape 8) after its jobs, under the commit subject `chore(gate): move the product level to foundation/ (shape 8)` — only on the default branch, only once the product level's own review has passed, never from a checkout with uncommitted changes under either folder, and not while the checks committed in the repo predate the Foundation (docs/migrations/shape-8.md). A later merge of a `review/EP-discovery/*` branch finds the moved ledger in `foundation/`. **`--merged`** is the merge phase: it advances the step and flips the artifact's `status:` on the default branch. Without it, a run whose step does not advance is read-only and pushes nothing (the pre-merge form). **`--no-push`** still makes the ledger commit on the default branch but does not push it, so you can look at it before it lands. This is also the manual recovery for a stuck gate on a verified Product: run `yad gate ci --branch <review-branch> --pr <n> --merged` on the default branch. The wired jobs always name a branch: they discover merged reviews through the platform API and call `--branch <ref> --pr <n> --merged` per review. With no `--branch` it falls back to a local sweep of the review PRs *already recorded in the ledger* whose step is not yet `done` — it does no platform discovery of its own, so a review the ledger never saw is only reachable by naming it. **Idempotent down to the bytes:** the ledgers are written in a canonical order, so re-syncing an already-`done` step (what the 15-minute sweep does for a week after every merge) produces a byte-identical file and commits nothing. Before the #163 fix the re-sync re-appended each step's approvals at the tail, so a sweep over N merged reviews rotated `approvals.json` and committed the reorder on every pass — an unbounded commit loop (#163). |
| `yad commit --type <t> -m <subject>` | Commit by the SDLC convention — Conventional subject, `Task`/`Contract-Change`/`Ledger-Override`/`Co-Authored-By` trailers, atomic-file guard. `--manual --reason "<why>"` (E49) is the door past a verified Product's local ledger hook: the commit goes through, the reason is recorded as a `Ledger-Override:` trailer, and the `ledger-guard` check on the pull request still fails it and quotes the reason. Refused when nothing staged is a file that hook refuses. |
| `yad open-pr [--repo <name>] [--title <text>]` | Open a **task** PR/MR from the platform template (Build). `--title` sets the PR/MR title; without it the title is `-m`, else the last commit's subject (a `review/EP-*` branch on the Product ignores it — `yad gate open` sets `review: …`). **The base is resolved, never assumed:** `--base` → the repo's `default_branch` in `.sdlc/repos.json` → (for a Product PR) `.sdlc/product.json`'s `default_branch` (or the older `.sdlc/hub.json`'s, when there is no `product.json`) → the platform's own default (`gh repo view --json defaultBranchRef` / `glab api projects/:id`) → local `origin/HEAD` → `main` — the same configuration-outranks-the-remote order `yad repo sync` and the contract-check gate use. It prints which rung answered, and **warns (never blocks) when the base is not the platform default**: CodeRabbit decides auto-review eligibility from the base at PR-**open** time, so a mis-based PR gets no AI first pass and retargeting afterwards does not undo it (#168). **Stage-aware on the Product:** a `review/EP-*` branch opens the Shape artifact-review PR (delegates to `yad gate open`), first warning when that step's files have changes no `yad fold` has committed (E44); any other Product branch uses the code-task template (so Product tooling PRs pass the `pr-template` gate). **Once a code-repo PR is open it prints how many approvers it asks for** (E66): the larger of the body's level (`--risk`, `--contract-change`) and the risk map on `origin/<base>` — see [The risk map](#the-risk-map-a-level-per-directory). Printed only; the body keeps the author's level. On a code-repo PR it then prints a **reviewer suggestion** (E68): who has committed in the touched folders in the last 30 days, and what CODEOWNERS lists — a hint, never a request (see "Who may know this code" at the end of [The risk map](#the-risk-map-a-level-per-directory)). |
| `yad ship --type <t> -m <subject> [--title <text>]` | Commit **and** open the task PR/MR in one step (`yad commit` then `yad open-pr`) — stage-aware, same as `open-pr`. `--title` sets the PR/MR title; without it the title is the full commit subject (`<type>: …`), which the `pr-title` gate expects. |
| `yad review trailer --repo <r> --pr <n> --body <text>` | **The Build side of the review companion** — the same briefing as `yad gate trailer`, posted into a **code** PR/MR description between the same marker lines (safe to re-run after a push). `--repo` names a repo from `.sdlc/repos.json`; without it the repo you are in is used. |
| `yad review context --repo <r> --pr <n>` | Print the grounding bundle for a code PR/MR (always JSON): the repo, its platform, the resolved base branch, the diff command, and the paths of its code-map, pack and contract. The companion skill builds its cards and chat from it. `yad review chat` and `yad review cards` are other names for the same command. |
| `yad review walkthrough --repo <r> --pr <n>` | The same bundle plus ordered, risk-tagged stops from the code diff (`<base>...HEAD`), highest risk first — the code-PR side of the `yad-pair-review` skill. Always JSON; reads only. |
| `yad review nudge --repo <r> --pr <n>` | Post one friendly `@`-mention on each **bare** approval of a code PR/MR (an approval with no sign that the reviewer engaged), inviting them to run the companion. A plain platform comment carrying a no-block marker, so it never holds the PR. Call it once per PR. |
| `yad review reconcile --epic <id> --repo <r> --pr <n>` | **The Build bridge.** Reads the code PR/MR's approvals, each with its engagement signal (`verified` or `none`), and writes them as `engineer_review` onto the matching ship record in the epic's `build-log` (matched by exact PR number). When no ship record matches yet, it writes nothing and prints the block to attach at ship time. |
| `yad checkpoint [--push]` | Commit the **machine-written Build state on the Product** — `trust-log.json`, `build-log.json`, `build-state/<story>.json` — **plus any story `status:` flip** (`approved → in-build/shipped`) that now has a `build-log` ship, as one `chore(product): sync Build state — <epic>/<story> by @<login>` audit-trail commit (no `Task` trailer, no AI footer). The Build analogue of `yad gate ci`: it stages **only** those ledgers + ship-backed story flips by an explicit allowlist (never a Shape gate file, so `ledger-guard` never trips) and commits **only on the default branch** (so the commit never enters a PR range where its `[skip ci]` would strand checks). Carrying the story flip is what keeps the story artifact from drifting from `build-log.json` — so no operator ever falls back to a raw `git push origin main` (#112). A **no-op** when nothing changed; `--push` lands it on `origin/<default>`; `--allow-branch` overrides the default-branch guard. The SDLC Build (`yad-run`, `yad-engineer-review`) calls it so teammates never have to hand-commit machine audit state. |
| `yad checkpoint --retro-ship <epic>/<story> --repo <r>` | Reconcile a **pre-tracking** story — merged and shipped **before** the Build ledger existed, so it has no `build-log` ship and plain `checkpoint` can't carry its `status: shipped` flip (#142). Records **one** retroactive ship shard marked `retroactive: true` (`--task <t>` overrides the default `retro` sentinel; `--merge-commit <sha>` records the SHA — never invented; `shippedAt` is the backfill date), then runs the normal checkpoint so the story's already-made flip rides the **same** `chore(product)` commit. **One repo per run:** a story that shipped in several repos is recorded by re-running once per `--repo` (the flip rides the first commit; each later run lands only its own shard) — the guard is per **(story, repo)**, so recording one repo never locks out the rest (#166), and after each run it names the story's declared repos that still have no evidence. Because a ship is permanent audit evidence, `--repo` must be one the story's `repos:` frontmatter declares (or, when it declares none, one the Product's `.sdlc/repos.json` connects) — a typo'd or invented repo is **refused**, not recorded — and a name that would share a build-log **shard filename** with an already-recorded repo (`api.v2` vs `api_v2`, both sanitized to `api_v2`) is refused too, so a retro ship can never overwrite another repo's record. **Refuses** when the story already has a ship **in that repo** (then it isn't pre-tracking there — use the normal flow); does **not** author the story frontmatter and **refuses unless you have already set a Build `status:`** — `in-build` or `shipped` — (so a ship is never committed while the artifact still says `approved` — evidence and flip stay atomic); `--push`/`--allow-branch`/`--dry-run` behave as for `checkpoint`. **Where the record lands:** like every ship, it is written as a **shard** under `.sdlc/build-log/` — the folded `.sdlc/build-log.json` is *not* appended to (that is what would make concurrent shippers conflict). Readers **union** the folded file with every shard, so the ship is fully visible immediately; `yad tidy up` folds it into `build-log.json` once the story is `shipped` (a backfill against an `in-build` story stays a loose shard until then). An empty `build-log.json` right after a backfill is the design, not a lost write (#167). This is the supported alternative to a raw `git push origin main` for a legacy shipped story. |
| `yad capture [--no-push]` | **Background capture of Shape artifacts (E43).** Commits every changed file under `epics/` and `foundation/` — except the ledger (any `.sdlc/` folder and `reviews/`; `contract-lock.json`, `change.json`, `design-links.json`, `test-links.json` and the step owner files `.sdlc/owners/<step>.json` are included) — onto a private branch per epic, `yad/wip/<git user.name, made branch-safe>/<epic>` (a name with no Latin letters falls back to the git email's local part, then to a short fingerprint). A Product in a subfolder of its repository works the same. Built with git plumbing in a throwaway index, so the checkout, the staged changes and the current branch are never touched, and no git hook runs. A capture with nothing new commits nothing. Each commit is `wip(<epic>): capture` with `Yad-Epic`, `Yad-Base` (the HEAD it was built on) and `Yad-Branch` lines, unsigned on purpose; the ref moves by compare-and-swap, so two captures at once cannot lose each other's. A branch whose edits were undone is captured back to what is on disk, but only while HEAD is still the one it was captured from. Then it pushes every `yad/wip/<you>/*` branch — a plain push, never forced, so a branch someone pushed from a second machine is refused rather than overwritten, and named as stuck until one copy is deleted (`git branch -D` here, then `yad capture` continues origin's); with no local branch, a capture continues origin's, and a capture by hand fetches your capture branches first (`--no-verify`, no prompts); `--no-push` skips that. No remote: local only, said, never a failure. **`--hook`** is the harness's post-edit form (wired by `yad check --fix` in both ledger modes: Claude Code `PostToolUse`, Cursor `afterFileEdit`): it always exits 0, prints nothing to stdout — except, with `--format claude`, one PostToolUse JSON note when an edit changed a file someone else has a claim on (see `yad claims`) or a file of a step someone else owns (see `yad assign`) — one note carries both — and starts the push, and a fetch of everyone's capture branches, in the background at most once every 5 minutes. Off with `"capture": false` in the Product config or `YAD_CAPTURE=0`. `--json`: `name`, `captured` (`epic`, `branch`, `commit`, `files`, `changed`), `unchanged`, `errors`, `pushed`, `off`, `claims`, `owners` (`epic`, `step`, `owner`, `name`, `date`, `paths`). |
| `yad claims [<epic>] [--no-fetch]` | **Who else is editing which artifact (E46) — advice, not a lock.** Read from the capture branches, with nothing recorded by hand: a claim is a file of the epic that differs between a `yad/wip/<name>/<epic>` branch's last save and its `Yad-Base` (the person's own edits, never what a pull brought in; when that commit is not in this clone, the commit the branch's first save was built on is used — over-reporting, the safe side — and the claim says `basis: first-capture`). A claim ends 4 hours after the branch's last save, or at once when the file on the default branch matches it. Fetches `+refs/heads/yad/wip/*` first (`--prune`, 30 s, no prompts), then the default branch on its own, so a wrongly guessed default name cannot stop the capture branches; `--no-fetch` reads what is here; with no remote it reads only your own. The capture hook warns when an edit changes a file someone else has a claim on — as PostToolUse JSON the agent reads under Claude Code (`--format claude`, which the Claude Code entry passes to `hooks/yad-capture.mjs`), on stderr elsewhere — at most once an hour per person and file; its background push also fetches everyone's capture branches. `--json`: `fetched` (`done`, `failed`, `local`, `skipped`), `expireHours`, `defaultBranch`, `claims` (`path`, `epic`, `name`, `person`, `lastSavedAt`, `mine`, `basis`). |
| `yad fold <epic> <step>` | **The step-boundary commit (E44).** Commits ONE authoring step's files as `docs(<epic>): author <step>` with `Yad-Epic`, `Yad-Step` and `Yad-Folded` (the capture branch's tip, or `none`) lines. The files: the ones the step's review covers, plus what its skill writes beside them (`DESIGN.md` + `.sdlc/design-links.json` for `ui-design`, `.sdlc/test-links.json` for `test-cases`); the epic's other changed artifacts are named and left on disk, and so is any step owner file (`.sdlc/owners/*.json`, E47), even with a brand-new epic's seed — an assignment is not authoring. `ledger: local`: the epic's changed ledger files go in the same commit. `ledger: verified`: ledger changes are left for CI, except a brand-new epic's (no `.sdlc/state.json` in HEAD) new ledger files — its seed, which `ledger-guard` allows; refused on the default branch and on a detached HEAD, and it warns when commit signing is off. While the epic is brand new, its new person-written `.sdlc/` files (`change.json`, a pointer `contract-lock.json`) ride the fold too, in both modes. Runs one quiet capture first, then a normal `git commit --only` — signed when git signs, commit hooks run, anything else you staged stays staged. The capture branch is left alone. Steps: `foundation` (epic `EP-foundation`), `discovery`, `analysis`, `epic`, `architecture`, `ui-design`, `stories`, `test-cases`. Refused when the step's files have no changes. `--json`: `epic`, `step`, `commit`, `subject`, `branch`, `folded`, `files`, `seed`, `ledger`, `leftForCi`, `leftOnDisk`. |
| `yad assign <epic> <step> [--to <name>] [--force]` | **Assign one authoring step to one person (E47) — advice, not a lock.** Writes `<epic>/.sdlc/owners/<step>.json` (`foundation/` for the Product level): `step`, `owner` (the git name made branch-safe, the same way capture branch names are), `name` (as given), `assignedBy` (your git name), `date`, and `replaced` when it replaced someone. Not a ledger file: `ledger-guard` never guards it, so it is written in both ledger modes; nothing is committed, and `yad fold` never takes it — commit it on its own; on a verified Product in a PR of its own — the Product's `pr-title` and `pr-template` checks do not count `*/.sdlc/owners/*.json` as a Shape artifact, so a PR of owner files alone passes on a non-review branch (a review/EP-* branch would advance the step at merge). The product-checks workflows list the PR's changes with `git -c core.quotePath=false diff --no-renames --name-only`, so moving an artifact into `owners/` still lists the artifact it removed. Changed bytes in those two copied checks and the two product-checks workflows: every wired Product reads `outdated` until `yad update`. Capture takes it, but `yad claims` never counts it as a claim. With no `--to`, the step is yours. `--to` takes the person's git name; when a capture branch here was saved under exactly that name, its branch name is used (so a name with no Latin letters resolves), and it warns when no capture branch carries the name. Only the steps `yad fold` takes (authoring steps with an artifact); a review step is refused, and so is a step not on the epic's chain, or one whose work is closed. Refused while another person owns the step, naming them; `--force` replaces them. A file that cannot be read is refused, never rewritten, unless `--force`. Live while the step is not passed or its review is not passed yet; re-opening the step makes it live again. `--json`: `epic`, `step`, `owner`, `name`, `changed`, `replaced`, `path`. |
| `yad unassign <epic> <step> [--force]` | **Remove a step's assignment (E47).** Deletes the owner file (and the empty `owners/` folder). Your own freely; someone else's, or a file that cannot be read, needs `--force`. Nothing assigned is a no-op. `--json`: `epic`, `step`, `changed`, `removed`, `path`. |
| `yad member add [--no-push]` | **Record who you are on the team (E131).** Finds every GitHub and GitLab account you are logged in to (`gh auth status`; for GitLab, the Product's host and every host a registered repo lives on). If you are not logged in on the Product's own platform and yad can ask, it starts `gh auth login` / `glab auth login`. It asks each account, with that account's own token, for its **verified** emails. An email is added when it is verified on the account **and** it is the git `user.email` of the Product or of a registered repo on this machine. Another account is added only when it shares one of those verified emails. Writes `.sdlc/members/<platform>-<login>.json` — named by your account on the Product's platform — holding your accounts (platform, host, login, numeric id), your emails **stored as `sha256:` hashes**, your git names and the day you joined. Every run re-proves **every** email in your file: an email it already holds is kept only while your account still verifies it (from any machine — the address comes from the platform), and the file records the day as `proved`. It is written as **one commit per email, each authored by that email**, on the branch `yad/member/<login>` built from the default branch with a private index (your checkout, index and branch are never touched; signed when git signs), then pushed and opened as a PR/MR with the code task template. `--no-push` stops after the commits. Your Product account in another member file is refused; an email another file lists is left out of yours with a warning (refused only when it leaves you none); another of your accounts that a second file also claims is warned about, not refused. A file on the default branch under your login but another account id (a renamed and reused login) is refused: it is someone else's. Running it again rebuilds the branch and updates the open PR/MR. Refused with `YAD_PLATFORM_LOGIN=0`. `--json`: `login`, `path`, `changed`, `branch`, `pushed`, `url`. |
| `yad member list [--json]` | **The team list (E131).** Every member file with its status, worked out on each read: **active** (a commit or an approval within the TTL — `members.ttlDays` in the Product settings, default 90), **idle** (nothing within the TTL, and the platform says the account still has access to the Product's repo), **left** (the platform clearly says no access — off the team list until they commit or approve again), **unknown** (the access could not be checked: offline, a 403, an SSO org). The platform is asked only after the TTL, once a day, and the answer is kept in git's common folder. A file that cannot be used, and an account or email two files share, are listed as warnings. `--json`: `ttlDays`, `members` (`path`, `login`, `accounts`, `names`, `emails` — a count, `joined`, `status`, `lastActive`), `team`, `errors`, `duplicates`. |
| `yad member remove [<login>] [--reason <why>]` | **Delete a member file (E131).** Your own needs no reason; anyone else's needs `--reason`. It deletes the file and prints the commit to make, with the reason in it. The Product's `member-check` lets a PR that deletes member files through; it does not check the reason (that is a convention, kept in the commit). |
| `yad owners [<epic>]` | **List step assignments (E47).** Every owner file of every epic and the Foundation, or of one epic: the step, the person (`(you)` when it is you), since when, who assigned it, and — when it is not live — why (the step is passed, or not on the chain). A file that cannot be read, or one named for a step that cannot be assigned, is listed as a warning, never dropped; `yad doctor` warns `owners:ignored` for those and for a file whose step is not on the epic's chain. An epic that does not exist is refused. `yad next` prints `owner: <name>` under a live step and under its review; the capture hook warns anyone else who edits the step's files, at most once an hour per step. `--json`: `owners` (`epic`, `step`, `path`, `owner`, `name`, `assignedBy`, `date`, `live`, `stepState`, `onChain`, `mine`; or `error`). |
| `yad tidy up [<epic>] [--push]` | Fold a **shipped story's** finished `trust-log`/`build-log` **shards** back into the single folded ledger file, as one `chore(product)` commit — the manual "pack it up" companion to the shard-then-fold storage (like `git gc` for its loose objects). Concurrent Build writers each write their own shard file (so parallel stories of one epic never conflict), and readers union the folded file + loose shards; `tidy up` is the on-demand compaction. A fold reads shards, merges them, then deletes them, so it holds the ledger's exclusive lock for that whole span — a ship written or stamped mid-fold can never be folded away without its change, or deleted without being folded (`YAD-STATE-006` if another writer holds it). Default branch only; `--push` lands it on `origin/<default>`; a **no-op** when nothing is foldable. |
| `yad index [--json]` | **Rebuild the Product index, `.sdlc/index.json` (E19)** — one summary per work item, so a reader opens one file instead of walking `epics/*`. The index is **derived**: it is rebuilt from each item's own `.sdlc/state.json`, `epic.md` and `.sdlc/change.json`, and never edited by hand. It is written **on the default branch only**, with no override, and the command never commits it: commit it with the change it describes. On a **verified** Product it writes nothing, because CI rebuilds the index in the commit that records a merge. `--json` prints the index built live from the files, on any branch, and writes nothing. See [the Product index](#the-product-index-sdlcindexjson). |
| `yad history [list\|show\|search]` | **What the Product has done (E20)**, read live from each work item's own files, on any branch, writing nothing. `list` shows every work item, open and shape-done (its Shape steps closed; Build is not counted), newest first, with `--type`, `--theme`, `--thread`, `--open` or `--done` to narrow it. `show <id>` prints one item's steps with their closing records and the approvals recorded for each review step. `search <text>` finds text in ids, titles, themes, types and repos, and in who closed or merged a step, its PR and its commit. `--json` on all three. See [Work-item history](#work-item-history-yad-history). |
| `yad repo list` / `yad repo refresh [name]` | List connected repos as **fresh / stale**, or **not cloned** on this machine (E81 — `yad repo clone` fetches it), and re-pack a stale one — staleness is now an explicit human decision, never an automatic skill side-effect. Both judge each entry before git runs, as `yad repo clone` does: a refused entry is named with its reason and git never runs in it. A registered folder inside a checkout with no `.git` of its own (`apps/web` in a monorepo) is present, unless a link inside a repo's tree is on its way or a folder on its way holds an entry named `HEAD` (of any kind, a link to nowhere too): git can take such a folder for a bare repo and read its `config`, whose settings can run a command. `refresh` also skips a checkout reached through a link inside a repo's tree, and one whose `contextPack` or `codeMap` is not a path under `.sdlc/code-context/` in the Product (the pack is written there, and `--push` commits the code-map); `--push` never stages a code-map outside it. An entry that is not an object is named and skipped. `list --json` gives each repo a `state`: `fresh`, `stale`, `no-pack`, `unreadable`, `missing` (not cloned here) or `refused` (with a `reason`), plus a top-level `missing` count. A `.sdlc/repos.json` that does not parse is named and **exits 1** — it is never read as "no repos", and `refresh` never writes an empty list over it. |
| `yad repo clone [name]` | **Clone every registered repo that is missing on this machine** (E81), at its recorded `path` — `yad join`'s clone step, for the repo a teammate registered after you joined. Each entry is judged first, exactly as `join` judges it: a path outside the workspace, through a `.git` folder or through a link is refused; so is a missing `git_url`, one starting with `-`, one that is not a **network address** (`https://`, `http://`, `ssh://`, `git://`, `user@host:path`, or an ssh alias `host:path`, the host in letters, digits, `.`, `_` and `-`, each starting with a letter or digit, and a user or password in those plus `~` and `+` (and `%` for `https://` only) — ssh can put them in a shell command; a control character anywhere — or a line separator or bidi control — typed or `%`-encoded (`%0d`, `%1b`, `%c2%9b`), is refused too — git writes the decoded user and path to your credential helper, where a carriage return can make it hand a saved token to another host (CVE-2024-52006, unguarded before git 2.48.1); an IPv6 host goes in an `ssh://[…]/` URL, as `user@[::1]:path` is refused — a plain path, `file://` or any `<helper>::` URL could name a folder the Product itself commits, shaped as a repo whose config runs a command), and a folder in the way that is not a git repo. The clone also runs with git's file transport off — set by `GIT_ALLOW_PROTOCOL`, which git obeys over any `protocol.*.allow` setting you have — because git reads `name.example:x` as a local folder when one by that name exists. A team whose remotes really live on a disk sets `YAD_ALLOW_LOCAL_REMOTES=1`: then an absolute local path (or `file://` URL, without `%`) naming a folder that EXISTS outside the workspace is cloned too; git is handed that folder as resolved on disk, and only that clone gets the file transport. The same rule holds in `yad join`. **It never runs git in a repo that is already there** and never writes the registry. A repo it could not clone is named and the rest continue; the command then **exits 1** (unlike `join`, cloning is its only job). Works from inside any registered repo (E80). `--json`: `{ cloned, present, failed }`, each a list of `{ name, path, reason? }`. |
| `yad repo refresh [name] --push` | After the re-pack (and the AI regenerating the code-map), commit the tracked code-maps + `.sdlc/repos.json` as an audit-trail `chore(product): sync code-context … [skip ci]` commit and push it straight to the Product's **default branch** (`--allow-branch` to override). The code-context analogue of `yad checkpoint`. |
| `yad risk-map check [repo] [--json]` | Check a code repo's **risk map** (`.sdlc/risk-map`: a risk level per directory, no names — see [The risk map](#the-risk-map-a-level-per-directory)). Warns about a directory no line covers, a line whose directory is gone, a line still `unset` or `guessed`, and a line it cannot read. `repo` is a name from `.sdlc/repos.json` or a path; with none, every connected repo — or the current directory, but only when there is no `repos.json` at all (an empty or unreadable registry is refused, so a map is never written into the Product). **Advisory:** it never sets a failing exit code for a warning. The PR check `checks/risk-map-check.sh` says the same about one change. |
| `yad risk-map draft [repo] [--dry-run]` | Add an `unset` line for every directory the map does not cover, creating the file when there is none. **Never changes a line that is already there.** A directory whose name a line cannot hold (a space, `#`, `*`, `?`, `[` or `\`) is covered by its parent's line instead, or — at the top level — named as not added. Refuses a map written for a newer version. The levels themselves come from the `yad-connect-repos` skill, which has your AI agent read the code. |
| `yad codeowners check [repo] [--json] [--platform github\|gitlab]` | Warn where a code repo's **CODEOWNERS** file looks stale — see **Is CODEOWNERS stale? (E69)** under [The risk map](#the-risk-map-a-level-per-directory). Facts: a line that matches no file, a second CODEOWNERS file the platform never reads, a GitHub file of 3 MB or more, a line yad cannot read. Plus one hint: the `@logins` with no commit in the last 90 days that carries their `noreply` address. `repo` works as in `yad risk-map check`. **Advisory:** it never sets a failing exit code for a warning, and it **never writes the file** — there is no `--write`. |
| `yad repo sync [name]` | Switch every connected repo to its **default branch** and fast-forward it from origin (one or all). Dirty repos are skipped, never overwritten; fast-forward only. **Each entry is judged before git runs (E81):** a repo not cloned here is skipped (run `yad repo clone`); a path outside the workspace or through `.git`, a folder with no `.git` (a committed folder shaped like a bare repo would have git read its `config`), and a checkout reached through a link **inside a repo's tree** (a link the Product commits) are skipped with the reason — a link of your own directly in the workspace folder is followed. A registered folder inside another checkout (a monorepo's `apps/web`) is skipped — switching its branch would switch the whole checkout; sync that checkout instead. A recorded `default_branch` must be a valid `refs/heads/<name>` and must not start with `-` or `+` (it is handed to `git fetch`, where `--upload-pack=<command>` runs a command and `+` forces the update); any other name skips the repo. An empty or `null` one falls back to `origin/HEAD`, else `main`. |
| `yad thread [<epic>]` | **Feature threads.** No arg: list every thread. With an epic: show its thread (genesis → changes → defects), the **resolved current-truth** map (which epic owns each artifact now), and any open hotfix debt. `--json` for tooling, where each node carries its work-item `type`, its grouping `theme` and the lifecycle `phase` its current step is in. Read-only. |
| `yad reconcile [check\|refresh\|wire]` | Sweep threads for **drift / orphans / open hotfix debt** and report which thread drifted and why (mirrors `yad docs sync`; advisory — the CI gates block at merge). |
| `yad docs [list\|build\|deploy\|sync] [--epic <id>\|--overview]` | **The generated documentation sites** (the per-epic `docs-site/` and the overview `docs/sdlc-site/`). `list` shows each site and whether it is stale. `build` runs `npm install` (or `npm ci` when there is a lockfile) and `npm run build` in each site; `deploy` does the same, then points at the Pages CI workflow that publishes on push. `sync` checks which sites are stale (`--check`, the default), rebuilds the stale ones (`--refresh`), or installs the Pages CI workflow (`--wire`). **A failed build exits 1.** Every site is tried, even after one fails, and the command exits 1 at the end if any failed: a failed `npm install` or `npm run build`, or a site named with `--epic`/`--overview` that was never generated. npm missing from PATH fails `build`, but is only a warning for `deploy` and `sync --refresh`, because the CI workflow builds on push. `list` and the `sync` check only read, so they never fail on a site; a site that was never generated reads as stale there. `--json`: `build`/`deploy` answer `built` (how many sites built) and `sites: [{ site, built, error }]` — `error` says why a site was not built, or is null; `sync` (check or `--refresh`) answers `stale`, `built` and `sites: [{ site, stale, built, error }]`, where `built` is null when no build was tried; `sync --wire` answers `wired`, the workflow file it wrote. `list` answers `target` and `sites` as a list of names — the same key holds names there and rows elsewhere, so read `command` first. A failed build is a refusal whose `error` names the site; a second failure is in `warnings`. Before 4.0 a failed build exited 0. |
| `yad hook ledger-guard` | **Harness-invoked, never typed.** The local half of the `ledger-guard` rule: in verified mode the gate ledger is CI-owned, so an agent that hand-edits `epics/*/.sdlc/state.json` is refused **at the moment of the edit** and told the command that owns the transition (`yad gate open`) — instead of discovering it twenty minutes later in a failed pipeline (#171). Reads a tool-call payload as JSON on **stdin** (or `--path <p>`). Two answer protocols: by default **exit 0 allows, exit 2 denies** with the reason on stderr, which is Claude Code's `PreToolUse` contract; with `--format cursor` the verdict is JSON on **stdout** instead (`{"permission":"allow"}`, or `{"permission":"deny","user_message":…,"agent_message":…}`, both exiting 0), because Cursor's `preToolUse` is a permission hook that treats an empty or off-schema answer as a refusal — the exit protocol there would block every file write. The `.cursor` wiring runs `node hooks/ledger-guard-cursor.mjs`, which speaks it; never wire `hooks/ledger-guard.mjs` into Cursor directly. Same scope as the CI gate, including the new-epic seed exemption (#162); a **no-op** with a local ledger. **Fails open** — no `yad`, no Product, an unreadable config all allow, because the CI gate is the one that fails closed. `YAD_HOOK_DISABLE=1` skips it. Wired by `setup` / `check --fix`; `yad doctor` reports whether it is armed. **`--staged` (E48)** is the git half: it judges the files a commit is about to record instead of a payload (it never reads stdin), and exits 2 with a message naming every refused file, the `git restore --staged` line, the owning command and the way through (`YAD_HOOK_DISABLE=1 git commit …`, which the pull request's check still judges). It allows a merge commit and a commit authored by `yad-gate-sync`, as the CI check does. It is what the `.git/hooks/pre-commit` that `check --fix` installs in each clone runs — see [Branch protection](branch-protection.md#the-local-git-hook-e48). |
| `npx yadflow --version` | Print the installed CLI version. |

Flags: `--dir <path>` targets a project other than the cwd; `--force` re-copies unchanged files (or
bypasses the commit atomic guard) — it never reaches a `modified` managed file; `--overwrite-local`
replaces those (see below). Commit flags: `--type`, `-m/--message`, `--task` (a
`<story>-T<NN>` id, the story an `EP-<slug>-S<n>` with a lowercase slug — an explicit value is
validated against the spec-link gate and `yad commit` fails locally if it is malformed), `--ai
<claude\|copilot\|cursor\|coderabbit\|none>`, `--contract-change`, `--manual --reason <why>` (always
together; the reason is one line, and one that starts with `-` is written `--reason=-…`; `yad ship`
refuses both), `--dry-run`. `open-pr` flags:
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
  "jsonVersion": 2,            // the number of THIS format — see "What moves the number" below
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
{ "jsonVersion": 2, "version": "4.0.0", "command": "unskip", "ok": false,
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

<!-- hub-keep:start moved-names -->
**What moved in `jsonVersion` 2 (E124, a breaking change).** `hub` became Product (E30, E122, E123),
and the last `--json` names that still said `hub` were renamed with it. If a script matched one of
these values, match the new one:

| Command | Key | Before | Now |
|---|---|---|---|
| `yad doctor` | `checks[].id` | `hub`, `hub-git-url`, `ci-tags:hub` | `product`, `product-git-url`, `ci-tags:product` |
| `yad open-pr` | `baseSource` | `hub` (the base came from the Product's `default_branch`) | `product` |
| `yad open-pr` | `stage` | `hub-shape`, `hub-tooling` | `product-shape`, `product-tooling` |
| `yad check`, `yad update` | `items[].scope` | `hub` (an item in the Product itself) | `product` |
| `yad update` | `commits[].label` | `hub` (the commit in the Product itself) | `product` |
| `yad history show` | a top-level key (renamed) | `hubWhy` | `productConfigWhy` (why the Product's settings could not be read) |

One key was **added** beside them, so it does not move the number: `product` (`true` or `false`) on each
`items[]` entry and `commits[]` entry of `yad check` / `yad update`, and on each `ci-tags:*` check of
`yad doctor`. It says whether the item, commit or check is the Product's own. Read it rather than
comparing `scope`, `label` or the id with `product`: a connected code repo may itself be named `product`,
and then those say the same thing for both.

Printed text moved with it, which the number does not track: `yad doctor`'s `hub: github` line reads
`product: github`, `yad open-pr` prints `(from product)`, and the audit commits that `yad checkpoint`,
`yad tidy up` and `yad repo refresh --push` write start `chore(product):` (older commits keep
`chore(hub):`). The list of every hand change, with a before and after, is in
[docs/migrations/hub-to-product.md](migrations/hub-to-product.md).
<!-- hub-keep:end -->

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
never pass. Enforcing the capped count, with a way out for a gate that cannot be met, is roadmap row
E108, which is parked. Until then the count is advice only.

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
`checks/product-route.sh` print it without the cap, because they cannot count people. `yad gate sync` and `yad gate
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
deadlock them. Opt in (`yad setup --solo`, recorded as `solo: true` in `.sdlc/product.json`) and the gate
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

**Merge-time sync (verified ledger).** A **verified** ledger is one CI owns: people never commit the
gate files by hand. On such a Product, `yad check --fix` installs `.github/workflows/yad-gate-sync.yml`
(or, on GitLab, the `.gitlab/ci/yad-gate-sync.yml` fragment plus a pipeline schedule you create once).
It runs `yad gate ci --merged` in the Product's own CI at **two moments only**:

| When | What runs |
|---|---|
| A review PR/MR is **merged** | `yad gate ci --branch <head> --pr <n> --merged` on the default branch: it re-reads the approvals from the platform, advances the step and flips the artifact's `status:`, then commits only the ledger there |
| Every **15 minutes** (the schedule) | The same advance for any recently merged review that is not yet `done` — the safety net for a merge run that failed |

Nothing runs while the review is open: an approval or a change request writes nothing. The platform
PR/MR holds the review state until the merge. So no manual `yad gate sync` is needed; on a verified
ledger it is **advisory** (it reads, never writes), and the way to recover a stuck gate by hand is
`yad gate ci --branch <review-branch> --pr <n> --merged` on the default branch. With a **local**
ledger, `yad gate sync` is the command that pulls the PR state in and advances the step. CI never
approves and never merges; the human keeps the merge click. GitLab note: a squash or fast-forward merge
can drop the review branch's name from the merge commit, so the scheduled sweep is what picks it up —
details in `skills/yad-product-bridge/references/bridge.md`.
Concurrency caveat: the wired jobs serialize runs repo-wide — a `concurrency` group on GitHub, the
equivalent `resource_group` on GitLab — and every run re-reads the full platform state, so two merges
close together lose nothing. Outside that group — a manual `yad gate ci` racing CI — two
simultaneous runs serialize their *commits* via the rebase retry but each works from the state it
read at start, so the rarer of two simultaneous advancements can be lost; the next merge or scheduled
sweep re-syncs and converges.

## What `setup` walks you through (a guided, branching interview)

Setup opens with a short **profile interview** — *solo or team (how many)? greenfield or brownfield?
monorepo or separate repos?* — and the answers (recorded in `.sdlc/product.json` as `solo` + `profile`)
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
3. **Product platform** — detect GitHub/GitLab from the remote → `.sdlc/product.json`. No people are
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
8. **Toolbox** — list the external tools this Product uses (the core tools, the connectors chosen in
   step 4, and the team's `.sdlc/toolbox.json`) that are not ready on this machine, each with its install
   command and what yadflow does without it ([the toolbox](#the-toolbox)). It **offers and never
   installs**: no program is run, no file is written, and a missing tool never fails setup (E85).
9. **Done** — stamp `.sdlc/cli-version.json` and print a **profile-tailored next step** (brownfield →
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

## Which AI agents are supported

An **agent skill** is a folder holding a `SKILL.md` file — instructions the agent loads when the task
matches. `SKILL.md` is now a format several agents read, and `.agents/skills/` is the directory
several of them agreed to look in. So one install can serve more than one agent.

`yad setup` asks which directories to install into. Pick by the agent you use:

| Directory | Agents that read it |
| --- | --- |
| `.claude/` | Claude Code. Cursor also reads it for compatibility. |
| `.agents/` | Codex CLI, Gemini CLI, Cursor, GitHub Copilot |
| `.cursor/` | Cursor — its own directory. Not needed if you install `.agents/`. |
| `.gemini/` | Gemini CLI — its own directory. Not needed if you install `.agents/`. |
| `.zencoder/` | Zencoder |
| `.opencode/` | opencode — installed as flat `commands/<skill>.md` files, not folders |

A fresh setup offers **`.claude,.agents`**, which together cover every agent in the table. A project that already
has an INSTALL in one of them — a `skills/` folder, or an armed hook entry — is offered that one
instead; a `.cursor/` holding only Cursor rules is not an install, and is offered the default. Checked against each agent's
own documentation on 2026-09-16; `yad doctor` prints the same table's verdict for your project.

## Managed files: what `yad` owns, and what you edited

`setup` / `check --fix` / `update` write a fixed set of **managed files** into the Product and every
connected repo — the `checks/*.sh` gate scripts, the CI workflow/fragment, the PR/MR template, and the
agent hook scripts on the Product:

| Hook script | What it does | When it is installed |
|---|---|---|
| `hooks/ledger-guard.mjs` | the agent guardrail: refuses an agent's edit to the CI-owned ledger | a verified Product |
| `hooks/ledger-guard-cursor.mjs` | the same guard, answering in the JSON form Cursor reads | a verified Product that installs into `.cursor/` |
| `hooks/yad-capture.mjs` | the post-edit capture: runs `yad capture --hook` after an agent edits a file (E43) | both ledger modes, unless the Product config says `"capture": false` |

They are yad's to rewrite, which is how a version upgrade lands new gate logic everywhere at once.

One more file is installed but never committed: on a verified Product, `.git/hooks/pre-commit` in **this
clone** (E48), which runs `hooks/ledger-guard.mjs --staged` so a person's hand commit to the CI-owned
ledger is refused on their machine. Git does not copy hooks, so each clone gets its own from `check --fix`,
and `yad doctor` warns while it is missing. yad knows its copy by a marker line: a `pre-commit` without it,
or a `core.hooksPath` a tool such as husky set, is never written — `check` and `doctor` print the one line
to add instead. An out-of-date copy of yad's is saved beside itself (`.yad-orig`) before it is rewritten.
With a local ledger, `check --fix` removes the copy yad wrote, and only an unedited one.

Two wired files are deliberately **not** managed in that sense: `.claude/settings.json` and
`.cursor/hooks.json` (the file Cursor reads its hooks from) belong to your team. yad owns only its own
entries inside them:

| File | yad's entries |
|---|---|
| `.claude/settings.json` | a `PreToolUse` entry that runs `hooks/ledger-guard.mjs` (verified Product only), and a `PostToolUse` entry that runs `hooks/yad-capture.mjs --format claude` |
| `.cursor/hooks.json` | a `preToolUse` entry that runs `hooks/ledger-guard-cursor.mjs` (verified Product only), and an `afterFileEdit` entry that runs `hooks/yad-capture.mjs`; yad also adds `"version": 1` when the file has no `version` key |

Each entry is merged additively and claimed only by an **exact** command match (the
current spelling or a documented past one), so re-running never duplicates it, nothing else in the
file is touched, and a hook of your own that merely names a similar path is never hijacked. A
`settings.json` that does not parse is reported `modified` and **never** rewritten — not even by
`--overwrite-local`, which has no shipped template to restore here; fix the JSON and re-run. It is
also never staged by `--push`: every other path in that allowlist is a file yad wrote in full.
(The same holds for `.cursor/hooks.json`.)

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

## Working together: capture, claims, owners and fold

These four commands are how a team shares draft work without stepping on each other. Capture runs
by itself; the rest are commands you (or a skill) run. Claims and owners are **advice, not locks**.

### Background capture

`yad capture` saves your work in progress without touching your checkout (E43). It takes every changed
file under `epics/` and `foundation/` — except the ledger (any `.sdlc/` folder and `reviews/`; the four
files a person or a skill writes there, `contract-lock.json`, `change.json`, `design-links.json` and
`test-links.json`, are included) — and commits it onto
a private branch per epic, `yad/wip/<your git name>/<epic>`. It uses git's low-level commands in a
throwaway index, so your branch, your staged changes and your files stay exactly as they were, and no
git hook runs.

| What | How |
| --- | --- |
| When | After every agent edit, by a hook yad wires in both ledger modes: Claude Code `PostToolUse` in `.claude/settings.json`, Cursor `afterFileEdit` in `.cursor/hooks.json`. Any other agent or editor: run `yad capture` yourself. Each capture takes every changed artifact, so your own editor's edits ride along |
| Push | A capture commits at once, locally. The hook pushes your capture branches (and fetches everyone else's, for claims) in the background at most once every 5 minutes, with no password prompt and a short timeout, so an edit never waits on the network. `yad capture` by hand pushes straight away. With no remote, or offline, the captures stay local and nothing fails |
| CI | yadflow's own push workflow skips `yad/wip/**`. `yad doctor` names any of **your** workflows a push to `yad/wip/*` would start (no branch filter, `branches: ["**"]`, or a `branches-ignore` that does not name it), so you can add `branches-ignore: ["yad/wip/**"]` |
| Off | `"capture": false` in the Product config (`yad check --fix` then removes the hook), or `YAD_CAPTURE=0` for one shell |

The capture commits are unsigned on purpose — a signing prompt inside a hook would hang the agent — and
each carries `Yad-Epic`, `Yad-Base` and `Yad-Branch` lines. They are drafts: the commit your history
keeps is the fold, below. The push is never forced: if you capture the same epic on two machines, the second push is refused rather than overwriting the first, and a `yad capture` you run by hand says so and names the branch (delete one copy with `git branch -D` to continue the other) — the hook's background push cannot report it. **To remove a capture branch for good** — say a secret was captured — delete it on origin first, then on every machine that has it run `git branch -D yad/wip/<you>/<epic>` **and** `git branch -dr origin/yad/wip/<you>/<epic>` (the second deletes that machine's saved copy of origin's branch; it says so if there is none): a machine that still holds either one rebuilds the branch and pushes it back. On a fresh clone, a capture continues the branch already on origin. Two people with the same git name share branches. The people count that caps review gates
(E71) does not count capture commits.

### Who else is editing a file (claims)

`yad claims` lists who else is editing which artifact right now (E46). It is **advice, not a lock**:
nothing stops anyone, because with no server a real lock is impossible. There is nothing to record by
hand — a claim is read from the capture branches: someone's `yad/wip/<name>/<epic>` branch holds a
saved change to that file that is not on the default branch yet.

| What | How |
| --- | --- |
| A claim | A file of the epic that differs between the capture branch's last save and the commit that save was built on — the person's own edits, never what a pull brought in |
| Ends | 4 hours after that branch's last save, or at once when the file on the default branch matches the saved one (the work was merged) |
| `yad claims [<epic>]` | Fetches everyone's capture branches first (short timeout, no prompts), then lists each claim: file, person, last save. `--no-fetch` reads what is already here; `--json` too |
| At edit time | When an edit changes a file someone else has a claim on, the capture hook says so. Under Claude Code the agent reads it (and you see it); under Cursor it is a line on stderr. It never blocks, never waits on the network, and names the same person and file at most once an hour |
| Fresh enough | The hook's background push (at most every 5 minutes) also fetches everyone's capture branches in the background |

**Limits.** Someone with capture off, or offline, is invisible. A claim can be up to about 5 minutes
late. Two people with the same git name share capture branches, so they never see each other. Times
are the saver's own clock, shown in UTC.

### Who owns a step (assign)

`yad assign` gives one authoring step to one person (E47) — for example "Bob writes the
architecture". It is stronger advice than a claim, because it is decided in advance, but it is still
**advice, not a lock**: it never blocks an edit, never holds a review gate and never stops a fold.

| What | How |
| --- | --- |
| `yad assign <epic> <step> [--to <name>]` | Assigns the step to you, or to the person whose **git name** you give (the name they commit with). Only authoring steps that write an artifact (`epic`, `architecture`, `stories`, …); review steps are not assigned, because the platform and the gate count decide who approves. If someone else already owns the step it is refused and names them; `--force` replaces them |
| `yad unassign <epic> <step>` | Removes the assignment. Your own freely; someone else's needs `--force` |
| `yad owners [<epic>]` | Lists every assignment, whether it is live, and any owner file that cannot be read. `--json` too |
| Where it is kept | One small file per step: `epics/<epic>/.sdlc/owners/<step>.json` (`foundation/.sdlc/owners/` for the Foundation). It is not a ledger file, so you can write it in both ledger modes. `yad assign` does not commit it, and `yad fold` never takes it (an assignment is not authoring): commit it on its own — on a `verified` Product, in a PR of its own (the Product checks let a PR that changes only owner files through, since E47; run `yad update` so your copies of the checks and of the product-checks workflow have that rule; `yad doctor` warns `owners:rename-blind` if a hand-edited workflow was kept) — so the team sees it when they pull. It is captured to your `yad/wip/…` branch like any artifact, but it is not counted as a claim |
| Live | While the step's work is open: the step is not finished, or its review has not passed yet. After that the file stays as a record; re-opening the step makes it live again. There is no time limit |
| Shown | `yad next` prints `owner: <name>` under the step (and under its review) while it is live |
| At edit time | When your edit changes a file of a step someone else owns, the capture hook says so — to the agent under Claude Code, on stderr under Cursor — at most once an hour per step. One note carries both this and any claim warning |

**Limits.** The name is the git name, made branch-safe the way capture branch names are — so it matches
the capture hook without asking GitHub or GitLab. Two people with the same git name look like one owner.
A git name with no Latin letters is branch-safe only through the person's email, so someone else can
assign it only once that person has a capture branch here (`--to` finds it by the git name the branch was
saved under). With capture off, there is no edit-time warning.

### Who is on the team (members)

A **member file** says that some git emails and some platform accounts belong to one person (E131). It
does one job — identity. It gives no access, holds no role, and asks nobody to review. Write access to the
repo is still the only thing that decides who can work.

| What | How |
| --- | --- |
| Where it is kept | `.sdlc/members/<platform>-<login>.json` in the Product, one file per person, named by their account on the Product's own platform |
| How it is written | `yad member add` (and `yad join`, which runs it last). It proves each email with the platform: only an email your account on the Product's platform has **verified** is added (your own noreply address counts). In the file, emails are `sha256:` hashes with no salt (an added secret), so anyone who already knows an address can check it; and the proof commits are authored by each address in plain text, as your own commits are |
| How it reaches the team | On its own branch, `yad/member/<login>`, with its own PR/MR. One commit per email, each authored by that email |
| What CI checks | On a verified Product, `checks/member-check.mjs`: a PR may add or change only its author's own file, holding exactly one account on the Product's platform and host — the author's, with the author's numeric account id (a login renamed away and registered again by someone else cannot take over the old file); on GitHub, **each email in the changed file** — not only the new ones — must be the author of a commit in the PR that GitHub gives to that same account; anyone may delete a file; no account on the Product's platform may be in two files, and on GitHub no email either (on GitLab an email is never proven, so a shared one is left to the CLI, which pairs it with nobody — refusing it would let anyone block a person by listing their known address); `.sdlc/members` must be a real folder of plain files, with no other spelling of it. On GitLab the check reads the MR's author from the API and **fails** when no `GITLAB_TOKEN` / `SDLC_API_TOKEN` is set |
| What it changes | The active-people count (the number E72's cap reads) joins a commit to the approvals of the same person, so one person stops counting as two. **Only where the check has judged the file:** a verified **GitHub** Product whose `checks/member-check.mjs` and product-checks workflow, **as origin's default branch holds them**, are exactly the copies this yadflow ships (`yad update` installs both), and only a member file changed on that branch **after** either of those two files last changed, and the same here as there — anything else was never judged by the gate as shipped. So every `yad update` that changes the gate or its workflow resets the trust, and each member runs `yad member add` again; a file only committed here, or edited, is never trusted (`yad doctor` names the files left out: `members:untrusted`). Because the shipped copy is this yadflow's, a teammate on another yadflow version reads the gate as not live and sees a higher count until both match. `member-check` must be a required check (docs/branch-protection.md). Anywhere else — GitLab (its API cannot show CI which account wrote a commit), a local ledger, no platform, or an outdated or edited check — the file feeds the team list and `yad usage` only. A member file never removes anyone from the count: a person who never joined still counts |
| Status | `yad member list`: active, idle, left or unknown — worked out on every read, never stored. See the command table |

**When two files name one account.** Your account on the Product's platform is proven by CI, so it is
always yours: another file that lists it is refused by the check, and ignored if it is on disk anyway.
Your other accounts are not proven by CI. If two files list the same other account, neither is matched
until one file drops it — and it never stops either person's own file from being read. `yad member list`
and `yad doctor` name the clash.

**Limits.** On a Product with a local ledger, or with no platform, no CI runs, so a member file there is
the person's own statement and nothing checks it — which is why the count does not use it there. Like every Product check, `member-check` runs from
the pull request's own copy of the file, so branch protection on the default branch is the backstop.
No link is ever followed: a `.sdlc/members` folder or a member file that is a link is refused. yad cannot know about an account a person never
added. A git name typed two ways (`bo` and `Bo Chen`) still counts as two people unless both commits
carry an email the member file holds.

### Folding a step into one commit

`yad fold <epic> <step>` ends an authoring step (E44). It makes the one commit the record keeps,
`docs(<epic>): author <step>` — for example `docs(EP-checkout): author architecture`. The authoring
skills run it at the end of their step; you can run it yourself too.

| What | How |
| --- | --- |
| Files | Only that step's files: the ones its review covers (architecture is `architecture.md`, `contract.md` and `.sdlc/contract-lock.json`; stories is everything under `stories/`), plus what the step's skill writes beside them (`DESIGN.md` and `.sdlc/design-links.json` for the UI step, `.sdlc/test-links.json` for test cases). Other changed files of the epic are named and left on disk, so a half-written draft of another step never lands in this commit |
| The ledger | Follows `ledger` mode. `local`: the epic's changed ledger files go in the same commit — one step, one commit. `verified`: CI writes the ledger at merge, so the fold leaves those files for CI — except while the epic is brand new (no `.sdlc/state.json` in HEAD yet): then its new ledger files are its seed, which is the case `ledger-guard` allows and the only way a seed reaches the default branch. Once the epic is seeded, even a NEW ledger file (a `reviews/*.md` written by hand) is left for CI, because the guard would reject it |
| The seed | While the epic is brand new, the first fold also takes the new person-written `.sdlc/` files beside the ledger — a change-epic's `change.json` and its pointer `contract-lock.json` — in both modes |
| The commit | A normal `git commit`, so it is signed if your git signs (with `ledger: verified` it warns when signing is off: the review PR's signature check would fail), and your commit hooks run. Only the step's files are committed; anything else you staged stays staged. It ends with `Yad-Epic`, `Yad-Step` and `Yad-Folded` lines — the last is the tip of your capture branch, the drafts this commit folds (`none` with capture off) |
| Where | With `ledger: verified`, never on the default branch — artifacts reach it only through the review PR. With `ledger: local`, anywhere |
| The drafts | Your `yad/wip/<you>/<epic>` branch is left as it is: the draft history stays for the later rework measurement (E95), and nothing has to be deleted on other machines. The next capture has nothing new to save |

A step with no changed files has nothing to fold, and says so. `yad open-pr` on a review branch warns
when that step's files have changes no fold has committed — they are not in the review.

## The local ledger guard, per agent

In **verified mode** — where CI owns the gate ledger — yadflow installs a local guardrail that stops
an agent hand-editing the gate files, at the moment of the edit rather than twenty minutes later in a
failed pipeline. It needs a hook that can run *before* a write and refuse it. Two agents have one:

| Agent | Wired into | Event |
| --- | --- | --- |
| Claude Code | `.claude/settings.json` | `PreToolUse` |
| Cursor | `.cursor/hooks.json` | `preToolUse` |

Cursor answers this kind of hook in JSON rather than by exit code, and treats an empty answer as a
refusal — so a `.cursor` project also gets a small adapter script, `hooks/ledger-guard-cursor.mjs`,
which always replies properly. Without it the guard would have blocked every file write instead of
just the gate files.

The guard fails open: if it cannot decide, it allows the write, and the CI gate stays the authority.
It is installed only on a Product whose ledger CI owns (`ledger: verified`).

Every other directory gets the script (`hooks/ledger-guard.mjs`) and no wiring — they have no such
hook, so those agents are guarded by CI alone. `yad doctor` says so by name rather than staying
silent. The Cursor wiring follows Cursor's published hook protocol and has not yet been exercised
against a live Cursor session.

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
| `toolbox` | `.sdlc/toolbox.json` (E86) does not parse or has the wrong shape (**fail**), or has lines that do nothing — a tool this yadflow does not ship, a choice other than `use` or `skip`, a custom tool that is incomplete, malformed, listed twice or uses a shipped tool's id (**warn**, `YAD-CFG-007`). `yad toolbox list` ignores those lines and shows the defaults; `add` and `remove` refuse a file that does not parse. **ok** names how many choices and custom tools the file holds. A missing tool is never reported here — that is `yad toolbox check`. | Fix the JSON or the line, or `yad toolbox remove <id>` (it clears whatever the file holds under that id) and add the tool again. An entry with no id, or an empty one, is fixed by hand. |
| `owners:ignored` | A step owner file (`.sdlc/owners/<step>.json`, E47) cannot be read, is named for a step that cannot be assigned, or names a step that is not on the epic's chain (**warn**). It is ignored everywhere else: no owner is shown and the edit-time warning is off. | For a step on the chain, `yad assign <epic> <step> --force` replaces it and `yad unassign <epic> <step> --force` removes it; for any other, delete it (`git rm <path>`). `yad owners` lists them. |
| `owners:rename-blind` | The wired `pr-title` / `pr-template` checks let a PR of step owner files alone through (E47), but a Product-checks workflow (`.github/workflows/yad-product-checks.yml` or `.gitlab/ci/yad-product-checks.yml`, or the same file under its pre-E123 name `yad-hub-checks.yml`) lists a PR's changes without `--no-renames` (**warn**). Then moving an artifact into `.sdlc/owners/` on a non-review branch passes both checks. It happens when `yad update` kept a workflow the team edited by hand. Each `git … diff … --name-only` (or `--raw`) command is checked on its own, read as bash reads it (a `#` line is prose; a line ending in `\` goes on to the next; `&&`, `\|\|`, `;` and `\|` separate commands). Only the shipped file names (new and old) are read: a Product that runs the checks from another workflow file, or from a GitLab `include:`, is not checked, so a clean doctor is not proof there. | Add `--no-renames` and `-c core.quotePath=false` to that workflow's `git diff --name-only` lines, as the shipped one has. |
| `renamed:<old path>` | Something yad installed is still under a name 4.0 changed (E123): the `yad-hub-bridge` skill folder (or `.opencode/commands/yad-hub-bridge.md`), or the Product's `.github/workflows/yad-hub-checks.yml` / `.gitlab/ci/yad-hub-checks.yml` (**warn**). Pre-2.0 `sdlc-*` names are reported the same way. Silent when nothing old is left. | `yad update` — it installs the new name and removes the old one. An old CI file you edited is kept, and goes on running under its old name — the new name is not installed beside it, so nothing runs twice: `yad update --overwrite-local` replaces it with the new one (your copy is saved as `<file>.yad-orig`), then copy your edits into the new file. |
| `renamed-ref:<file>` | A file of your own names one of the CI names 4.0 changed, each hit by line (**warn**): `--profile hub` passed to a check, with `=` or spaces, bare or quoted, in a CI file only (the checks still accept it until v5, but a check you edit after 4.0 without the line that would turn `hub` into `product` would skip the Product's rules — so the line is named whatever the check looks like; a value passed through a variable is not seen); `yad-hub-checks` (the workflow file, its GitHub `name:` — a `workflow_run:` trigger, both status-badge forms — and the GitLab include path), the GitLab jobs `yad-hub-commit-message`, `yad-hub-pr-title`, `yad-hub-pr-template`, `yad-hub-ledger-guard`, `yad-hub-verified-commits` (in `needs:`, `dependencies:`, `extends:`, `!reference`), and `.yad_hub_mr_only`. Read: the root `.gitlab-ci.yml`; every `.gitlab/ci/*.yml` and `.github/workflows/*.yml` (or `.yaml`) whose **first line** does not start `# yad-managed`; `README.md`; `CODEOWNERS` in the root, `.github/`, `.gitlab/` and `docs/`. `yad check` and `yad update` print the same list. | Change each to its `yad-product-…` name, or `--profile hub` to `--profile product`, by hand. Before the profile change, each Product check must handle `product`: a check that refuses it fails every Product PR, and one that takes it without turning it into the old value skips the Product's rules. The hint names every such check with its step: out of date, or installed before the provenance record (3.16) → run `yad update`, which replaces it (the second kind saved as `<file>.yad-orig`); edited → fix it, or `yad update --overwrite-local`; `.sdlc/managed.json` or the Product settings do not read → restore that file from git first; the settings (or an epic's PR record) under their two names say different things → `yad migrate`, then `yad migrate --apply` to keep one copy, first — every command but `yad doctor`, `yad migrate` and `yad report` refuses until then; on a Product not in verified mode, where yad manages no checks → fix it by hand. `profile:<gate>` gives the same step for its one check — yad never edits these files. The one exception is the include line in the root `.gitlab-ci.yml`, which `yad update` rewrites when it replaces the old fragment — or, when you edited that fragment, `yad update --overwrite-local` does. Leave that line until then: the new fragment is not installed before it, so an include you change by hand would name a file that is not there. The hint says which case you are in. |
| `profile:<gate>` | `checks/commit-message.sh`, `checks/pr-title.sh` or `checks/pr-template.sh` on the Product does not handle `--profile product`, while a Product workflow on disk passes it — yad's own, or one of the team's own CI files (**warn**, E123; the team's files since E124). A copy from before 4.0 accepts only `code` or hub, the old name, so every Product PR fails that check; one that lists `product` but has no line turning it into `hub` accepts it and then skips the Product's rules, so it passes what it should stop. `yad update` keeps an edited copy, and says the same when it does (only when a workflow passing `product` is there, or is installed by that run). | Depends on the check's state in the provenance record (E124), and the hint says which: yad's own older copy → `yad update` replaces it; installed before the record (3.16) → `yad update` replaces it and saves yours as `<file>.yad-orig`; edited → add `product` to the gate's `case "$PROFILE" in` list and `[ "$PROFILE" = product ] && PROFILE=hub` after it, or replace it with the shipped copy, which branches on `product` itself: `yad update --overwrite-local`; `.sdlc/managed.json` or the Product settings do not read → restore that file from git, then `yad update`; the two names of a file say different things → `yad migrate`, then `yad migrate --apply`, then `yad doctor` again; a Product not in verified mode, where yad manages no checks → fix it by hand. |
| `checks:rename-blind` | An installed `checks/contract-check.sh` or `checks/backfill-check.sh`, in the Product or a connected repo on disk, lists a diff's changes without `--no-renames` (**warn**, E114). Such a copy names a renamed file by its new path only, so `git mv` of a contract slice out of `specs/<story>/contracts/` passes contract-check with no `Contract-Change` trailer, and moving a file out of `src/<feature>/` passes backfill-check while that feature's spec is not approved. Each `git … diff … --name-only` command is checked on its own, read as bash reads it: a `#` line is prose, a line ending in `\` goes on to the next, and `&&`, `\|\|`, `;` and `\|` separate commands — so a fixed command never hides a blind one beside it. Only the two shipped file names are read, so a gate copied under another name is not checked. | `yad check --fix` refreshes a wired contract-check nobody changed by hand. Otherwise copy the shipped template over it — backfill-check is never wired, so every copy of it is placed by hand — or build each list as the template does: `git diff --no-renames --name-only -z … \| tr '\0' '\n'`, with `export LC_ALL=C` at the top. `--no-renames` alone still lets git quote an odd path past the gate. |
| `checks:symlink-blind` | An installed `checks/contract-check.sh`, in the Product or a connected repo on disk, does not refuse a symlink or submodule under `specs/` (**warn**, E115). Such a copy reads paths only: a link at `specs`, `specs/<story>` or `specs/<story>/contracts` hides the contract slice from every rule, and every later edit to the link's target passes. The current gate reads the tree at HEAD (`git ls-tree -r -z --full-tree HEAD`) first; the warning fires when no command in the file runs `git ls-tree` on `HEAD` (a `#` line is prose; a line ending in `\` goes on). | `yad check --fix` refreshes a wired contract-check nobody changed by hand. Otherwise copy `skills/yad-checks/templates/checks/contract-check.sh` over it. |
| `checks:backfill-blind` | An installed `checks/backfill-check.sh`, in the Product or a connected repo on disk, is older than E116 (**warn**). Such a copy reads the backfill spec from the PR itself, so a PR can set `verified: true` on its own change or delete the spec to skip the gate; and it reads paths only, so a symlink or submodule at `src`, `src/<feature>` or inside the feature hides every later edit to its target. The warning fires when no command in the file runs `git ls-tree` on `HEAD`, or none runs `git cat-file`, or a `git diff … --raw` list is split with `tr` (the first E116 cut, where one file name with a newline hid every feature after it). A `#` line is prose; a line ending in `\` goes on. | Copy `skills/yad-backfill/templates/checks/backfill-check.sh` over it. backfill-check is never wired, so `yad check --fix` does not refresh it. |
| `checks:product-path-blind` | An installed Product-reading gate — `checks/contract-check.sh`, `checks/lineage-check.sh`, `checks/epic-open.sh` or `checks/reconcile-debt-check.sh`, in the Product or a connected repo on disk — reads the Product from wherever the PR's `link.md` points (**warn**, E117). A PR could point `product-repo` at a path that does not exist (a deferral, so a pass) or at a Product it commits itself (a hand-made lock). The current gates read `product-repo` from `link.md` as it stands on the base, and read a Product this repo tracks (a monorepo) from the base commit; the warning fires when no command in the file runs `git show` or none runs `git checkout-index` (a `#` line is prose; a line ending in `\` goes on). | `yad check --fix` refreshes a wired gate nobody changed by hand. Otherwise copy the shipped one over it from `skills/yad-checks/templates/checks/`. |
| `checks:product-record-blind` | An installed Product-reading gate (`checks/contract-check.sh`, `checks/lineage-check.sh`, `checks/epic-open.sh`, `checks/reconcile-debt-check.sh`, in the Product or a connected repo) never reads `.sdlc/product-link.json`, or a connected repo's checks workflow (`.github/workflows/yad-checks.yml` or `.gitlab/ci/yad-checks.yml`, changed by hand) does not run `checks/product-checkout.sh` (**warn**, E120). Such a gate still takes where the Product lives from `link.md`; such a workflow never checks the Product out. The message names each kind separately. The gate check fires when no command in the file runs `git` naming `product-link.json`; the workflow check when no line outside a `#` comment names the script (a `#` line is prose; a line ending in `\` goes on). | `yad check --fix` refreshes wired files nobody changed by hand. Otherwise copy the shipped gate or workflow over it from `skills/yad-checks/templates/`. |
| `repos:product-link-missing` | A wired code repo (it carries yadflow's gates) has no `.sdlc/product-link.json` **on its default branch** — `origin/<default_branch>` when fetched, else `HEAD` (**warn**, E120). A record on disk that nobody committed counts as missing, and so does one whose `git_url`, `path` or `default_branch` on disk differs from the default branch's copy: the gates read it from the default branch. A repo whose `.gitignore` covers the record is named separately, with the fix (un-ignore it, or `git add -f`), since `--push` cannot commit an ignored file. When the record on disk is this clone's committed one and `origin/<default_branch>`'s differs, git decides which side is ahead: with **no** commit to the record in `origin/<branch>..HEAD`, the clone is only behind — on the default branch it is told to pull (`git pull origin <branch>`), and anywhere else nothing is said while the default branch holds a readable record (CI's copy is the newer one; one deleted or broken there is reported); **with** such a commit it is "committed but not pushed" (push it, or a PR — `yad check --fix --push` has nothing left to commit) when on the default branch and origin has nothing new, "diverged" (pull, settle the record, push) when origin has moved on too, "on a detached HEAD" (check out the default branch first), or "committed on branch X" (a PR into the default branch — the `--allow-branch` path). Where the fix is `yad check --fix --push`, the hint lists what each repo needs beyond it: a clone on another branch or a detached HEAD is named with a `git checkout <branch> && git pull origin <branch>` first (`--push` commits only on the default branch), or a PR from the branch it is on; a copy that is not JSON on disk (or will not be, once an off-branch clone pulls a broken one) needs `--overwrite-local`, since a plain `--fix` leaves it alone — and that flag applies to the whole run: it also replaces files changed by hand in the Product and in every connected repo, after saving each. A copy on the default branch that is not JSON is "no readable" record. Its gates fall back to `link.md` for where the Product lives, and `checks/product-checkout.sh` has nothing to clone from. A repo with no gates, and a code repo inside the Product's own git repo (a monorepo), are not asked for one. | `yad check --fix --push` from the Product writes it into each connected repo and commits it to the default branch. |
| `git-hook` | Verified mode only: this clone's `.git/hooks/pre-commit` ledger guard (E48). **ok** when yad's copy is there; **warn** when it is missing or out of date, when the clone has a `pre-commit` of its own, or when git's `core.hooksPath` is set (then yad writes nothing). | `yad check --fix` for a missing or old copy. For a hook of your own or a `core.hooksPath` folder, add the one line the hint prints. See [Branch protection](branch-protection.md#the-local-git-hook-e48). |
| `automation:kill` | The kill switch is on (**warn**), with who, when and why. Every step is held at `advance: human`. | `yad unkill` once the reason is gone. |
| `automation:gate` | `.sdlc/automation.json` sets a review gate to `auto` (**fail**). Nothing honours it — a gate is never automatic. | Remove the line. |
| `automation:build-step` / `automation:unknown` | A Build step listed in `automation.json`, where nothing reads it (a lane's dial is in `build-state`), or an id or value this release does not know (**warn**). | `yad dial <epic> <story> --repo <name> <step>` for a Build step; remove the rest. |
| `automation:legacy-kill` | `_bmad/sdlc/config.yaml` still says `kill_switch: true`, and nothing reads that key since E34 — so the kill switch is **off** (**fail**). | `yad kill --reason "<why>"`, then set that line back to false, or delete `_bmad/sdlc/` (see `module:legacy-bmad`). |
| `module:legacy-bmad` | A `_bmad/sdlc/` folder is left from before E3, when `yad setup` installed the module config there. Nothing reads it now; the config is `.sdlc/config.yaml` (**warn**). A BMAD install's own `_bmad/` is not a finding — only the `sdlc/` folder yadflow wrote. | Clear `automation:legacy-kill` first if it shows (it reads that folder), run `yad check --fix` if `.sdlc/config.yaml` is missing, copy any value you changed in `_bmad/sdlc/config.yaml` into `.sdlc/config.yaml`, then delete `_bmad/sdlc/`. |
| `mode:disagree` | `.sdlc/product.json` says `mode: solo\|team` but the `solo` flag says the other, or `mode` holds a value other than `solo`/`team` (**warn**, E10). `solo` is the one the gates read this major, so the file reads one way and acts another. Silent on a Product with no `mode`. | `yad mode <what the gates do now>` to make them agree, or `yad mode solo --reason "<why>"` / `yad mode team` to make the gates follow `mode`. |
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

`classic`, `analysis-first` and `discovery` are routes the tool already used, written by hand into five
skill files before the engine held them. `chore` and `spike` are the short lanes E40 added, and
`foundation` is the Product level E75 added.

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
| `profile:unknown` | the recorded value is not one of the six |
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

**A line can apply to one route only.** A route (also called a profile) is the chain of steps an epic
follows — `classic`, `analysis-first`, `chore`, `spike`, and the Product's `foundation`. Each epic
records its route in its `state.json`. Put a line under `profiles.<route>.steps` and it applies only to
epics on that route:

```jsonc
{
  "steps": { "epic": "our-epic-skill" },
  "profiles": {
    "spike": { "steps": { "epic": "our-spike-skill" } },
    "chore": { "steps": { "implement": "our-small-change-skill" } }
  }
}
```

**The most specific line wins:** the epic's route first, then the project-wide `steps`, then the
engine's default. In this file a spike epic runs `our-spike-skill`, every other epic runs
`our-epic-skill`, and a chore epic's Build lanes run `our-small-change-skill` for `implement`.
`yad next`, `yad epic new`, `yad skill list --epic <id>` and the `yad-run` skill all read the route the
epic **records** in its `state.json`, exactly as written:

- An epic that records **no** route (an older or hand-written one) uses the project-wide line. Its route
  is never guessed from its steps: a short chain like `[epic, epic-review]` fits `chore`, and guessing
  would hand a chore-only skill to an ordinary classic epic.
- An epic that records a route this release does not know (from a newer yadflow) still gets the lines
  bound for that route.
- Before any epic exists — `yad setup`, and `yad next` on an empty Product suggesting the first epic —
  there is no route yet, so those lines name the project-wide skill. The Foundation hint uses the
  `foundation` route, because `yad foundation new` always seeds that route.

```bash
yad skill bind epic our-spike-skill --profile spike
yad skill list --profile spike                   # what a spike epic runs, and from which layer
yad skill list --epic EP-checkout                # the same, for that epic's route
yad skill unbind epic --profile spike            # back to the project-wide line, then the default
```

A route's line must name a step the route walks. Build steps (`spec`, `tasks`, `implement`, `checks`,
`engineer-review`) are on every feature route; the Product routes (`foundation`, `discovery`) have no
Build steps. `bind` refuses a line no epic would ever reach — `architecture` on `spike`, say — for the
same reason it refuses a review gate.

**Is the skill installed?** `yad skill list` and `yad skill bind` ask `yad detect` (the command that
lists what is installed) whether each skill is in this folder or your home folder. A plugin's skill
counts under the name an agent calls it by, `<plugin>:<skill>`. A skill that is not found is a
**warning, never a refusal**: the file is the team's and is committed, and a teammate may have a skill
this machine lacks. "Found" means a skill by that name is installed; which copy an agent loads when
there are several is the agent's own rule.

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
| `skills:profiles` (fail) | `profiles` is not a JSON object, or a route's entry has no `steps` object |
| `skills:profile-unusable` (warn, `YAD-CFG-006`) | a route's value is not a skill name |
| `skills:unknown-profile` | the route is one this release does not have |
| `skills:profile-unknown-step` / `skills:profile-review-step` | the same two checks as above, for a route's line |
| `skills:off-route` | the route never walks that step (`architecture` on `spike`), so no epic reaches it |
| `skills:bound` (ok) | the summary: how many steps are bound, how many to more than one skill, and how many for one route only |

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

### Recommended skills: the catalogue

The three recommended pools in the [toolbox](#the-toolbox) — BMAD-METHOD, ECC and mattpocock/skills —
hold dozens of skills each. Install all three and your agent chooses between hundreds of descriptions.
**The recommendation catalogue** narrows that down: for each step, a few named skills a person read and
judged a good fit, each with a one-sentence reason (E52).

```bash
yad skill recommend                  # every step's picks, with the bind command for each
yad skill recommend architecture     # one step
yad skill recommend --profile spike  # the commands carry --profile spike
```

| Rule | What it means |
|---|---|
| **It recommends; it never binds** | Nothing changes until you run the printed `yad skill bind` command. `yad skill list` shows the picks only for steps still on the engine's default. |
| **The pool skill first, yadflow's skill last** | yadflow's own skill writes the artifact where the review gate looks, locks the contract and updates the ledger. A pool skill does not know how to. So each suggestion is a chain: the pool skill shapes the thinking, then yadflow's skill writes the result. Each extra skill is another model run. |
| **Its own version** | The catalogue has its own `version` and `checked` date, separate from yadflow's version, and every command that shows it prints its age. It ships inside yadflow — no download, no cache file — so a new list arrives with a yadflow release. |
| **Every entry is vetted** | Each entry has the same record as a toolbox tool: the licence read from the pool's `LICENSE` file, the official source, the release tag, and the exact `SKILL.md` at that tag, so the name was read from the real repository. The release check refuses to publish while any record is older than 180 days. |
| **Some picks carry a note** | A `note:` line says what to know before binding one: an install profile it needs (some ECC skills are only in its `developer` profile), or a file it writes of its own. |
| **Replacing yadflow's skill is flagged** | If a step runs a pick and yadflow's own skill does **not** run last (the pick alone, as in `yad skill bind epic bmad-prd`, or after it), the row says so: the last skill's output is the artifact, so yadflow's skill does not file it where the review gate looks. A pick bound under its plugin name (`ecc:contract-first`) counts as the same skill. |
| **Install the pool first** | A pick marked `?` is not installed here. `yad toolbox list` shows each pool's install commands. |

## The toolbox

yadflow can use some tools it does not ship. **None is required: every one has a fallback**, so a
missing tool makes yadflow do less, never stop. The toolbox is the one list of them. It ships inside
yadflow and moves with each release. A Product records which of them its team uses, and adds its own,
with `yad toolbox add` / `remove` ([below](#choosing-the-teams-tools)).

```bash
yad toolbox          # the same as: yad toolbox list
yad toolbox --json   # every field, plus what was found here
```

| Group | Tools | What it means |
|---|---|---|
| core | Repomix, Spec Kit, Impeccable | in use by default; offered by `setup`, `check`, `update` and `join` (E85) |
| recommended | BMAD-METHOD, ECC, mattpocock/skills | pools of skills and agents you may bind to a step; never pushed |
| connector | Figma, Pencil, Playwright, Cypress, pytest, Maestro, DeepTutor | the tools a Product connects with `yad-connect-design`, `yad-connect-testing` and `yad-connect-learning` |

Each entry records:

| Field | Meaning |
|---|---|
| `role` | what yadflow uses it for |
| `licence`, `source`, `checked` | its licence, its own repository or docs, and the day its facts were checked there |
| `install` | the documented install commands, each typed `plugin`, `npm`, `python` or `script`. A tool set up inside a desktop app has none, and `manual` links the vendor's steps |
| `detect` | what shows it is here: skill names or prefixes, a plugin, an MCP server name, a program on PATH, or `npx` for a tool fetched on demand |
| `versions` | a known-good range, or `null` when no bound has been tested yet (all of them, for now). A range uses full versions (`>=3.0.0 <4.0.0`, `^3.2.0`, `~1.4.0`); a partial one such as `~1` is refused, and `<4.0.0` also keeps out 4.0.0's own pre-releases |
| `fallback` | what yadflow does without it |
| `records` | the exact line a skill writes when it did not use the tool (`speckit: not-installed`); see [what a skill does when its tool is missing](#what-a-skill-does-when-its-tool-is-missing) |

**How a tool is found.** The toolbox reads the same answer as `yad detect`, and looks for a program by
reading the `PATH` folders. It starts no program, installs nothing and uses no network. Repomix counts
as `available` whenever `npx` is there, because yadflow runs it through `npx repomix@1.18.1` — the vetted
version, never `@latest` (see "Every tool is vetted" below). An MCP
server is matched by its name only, because its settings are never read: a server another package
registered under the same name (common for `playwright`) is counted as found. A tool found only
through a Claude Code plugin your settings turn off shows as **installed, but its plugin is turned
off**, with its fallback: the agent does not load it. A program is looked for in the absolute folders
of `PATH` only; an empty or relative entry means "wherever yad ran", which is not an install. On
Windows, absolute means a drive and a root (`C:\tools`) or a share (`\\server\share`); `\tools` and
`D:tools` are not, and an entry in double quotes is read without them.

**A version outside the range warns; it does not switch the tool off.** The tool is still used, and the
list says which range is known to work.

**Every install command was checked against the tool's own repository or docs**, never guessed from a
package name: npm `ecc`, for example, is an unrelated crypto library, and ECC's package is
`ecc-universal`. Where no official command exists — Cypress and pytest have no official MCP server
that runs local tests — the entry says so and links the vendor's docs instead.

### Choosing the team's tools

A Product records which toolbox tools its team uses in **`.sdlc/toolbox.json`**. Commit it, so everyone
shares one answer. Nothing in this section installs a tool or starts a program: `add` prints the install
command, and you run it.

```bash
yad toolbox add bmad-method      # use a shipped tool here; prints how to install it
yad toolbox remove spec-kit      # stop using one (yad-spec then writes the spec files by hand)
yad toolbox add doclint --custom --role "lints the docs" --fallback "the docs are not linted" \
  --detect bin:doclint --install "npm: npm install -g doclint"     # a tool of your own
yad toolbox check                # the tools this Product uses that are not ready on this machine
```

**In use by default:** the three core tools, and the connector the Product already connected — the
`tool` that `design.json`, `testing.json` or `learning.json` names. Every other tool is listed but not
in use. `add` and `remove` write only a difference from that default, so the file stays short:

```json
{
  "schemaVersion": 10,
  "shipped": { "bmad-method": "use", "spec-kit": "skip" },
  "custom": [
    { "id": "doclint", "role": "lints the docs", "fallback": "the docs are not linted",
      "detect": { "bins": ["doclint"] }, "install": [{ "type": "npm", "command": "npm install -g doclint" }] }
  ]
}
```

| Part | Meaning |
|---|---|
| `shipped` | a shipped tool's id → `use` (used here, though not by default) or `skip` (not used here, though it would be by default) |
| `custom` | the team's own tools. Each needs an `id` (lower-case words joined by `-`, not a shipped tool's id), a `role`, a `fallback` and a `detect`; `name`, `install` and an https `source` are optional |
| `detect` | what shows the tool is here, as in a shipped entry: `skills`, `skillPrefixes`, `plugins`, `mcp`, `bins`. On the command line: `--detect skill:<name>,prefix:<start>,plugin:<name>,mcp:<server>,bin:<program>` |

- **Where it runs.** `add` and `remove` write the Product's file. Run them from the Product, from inside
  a code repo it registers, or with `--dir <the Product>` (the Product folder itself, as for every
  Product command); anywhere else they refuse. `list` and `check` look for tools at the top of what you
  run them in, or of what `--dir` names — your git checkout (a worktree counts as its own), a registered
  repo in a monorepo, or the Product, whichever is deepest (a code repo's own skills count), and read the choices from the
  Product that folder belongs to. With no Product, they show the defaults and say why none was found.
- **A program is a name.** `bins` holds program names looked up on `PATH`, never paths: a `/` or `\`
  is refused, so the shared file cannot make a teammate's `check` look at a file it chose.
- **`remove` does not disconnect.** Removing a connected tool such as Figma marks it unused in the
  toolbox; `design.json` still connects it, and `yad-connect-design` changes that.
- **A broken file is never written over.** If `toolbox.json` does not parse, `add` and `remove` refuse
  and leave it as it is; `list` and `check` warn and show the defaults. A line that does nothing — a tool
  this release does not ship, a choice other than `use` or `skip`, a custom tool that is incomplete,
  malformed, listed twice or uses a shipped tool's id — is ignored, and `yad doctor` names it (`toolbox`,
  warn, `YAD-CFG-007`). `yad toolbox remove <id>` clears whatever the file holds under that id, and
  `add <id>` clears a custom entry that wrongly uses a shipped tool's id; an entry with no id, or an
  empty one, is fixed by hand. Both offer an undo only when the tool's use really changed.
- **`check` never fails.** It names each tool this Product uses that is missing, turned off in your
  Claude Code settings, or outside its known-good versions, with the install command and what yadflow
  does without it, and exits 0. `yad doctor` does not report missing tools.
- **Setup, check, update and join offer the same check (E85).** `yad setup` has a Toolbox step after the
  optional-tools step, so a connector chosen there counts. `yad check` and `yad update` end with a
  Toolbox section, and `yad join` with one read from the Product it just cloned — a new teammate is the
  one most likely to miss a tool. Each prints what `yad toolbox check` prints — `check` and `update` look
  for tools in the same place as `yad toolbox check` (the top of what you run them in, or of what `--dir`
  names), so from a code repo its
  own skills count, and read the choices from that repo's Product — then says that
  nothing is installed for you. Join leaves out the advice to `yad toolbox remove` a tool: it writes the
  team's file, and one machine lacking a tool is no reason to change what the whole team uses. None of them runs a program, writes a file for it, or changes its exit code. Their
  `--json` answer gains `toolbox: { used, findings, problems }` — the tool ids in use, the same
  `findings` as `yad toolbox check --json`, and any line of `toolbox.json` that does nothing. If the
  check itself cannot run, the command still finishes, warns, and answers `error: "could not check"`.

### What a skill does when its tool is missing

Every skill that uses a toolbox tool has a section named **When a tool is missing** (E87). It lists
each tool the skill uses, when to use it, and what the skill does instead — the fallback — in the
toolbox's own words. The skills are `yad-spec` (Spec Kit), `yad-ui` (Impeccable, Figma, Pencil),
`yad-connect-repos` and `yad-backfill` (Repomix), `yad-test-cases` and `yad-connect-testing` (the
testing connectors), `yad-connect-design`, and `yad-learn` and `yad-connect-learning` (DeepTutor).

- **The skill asks yad, not its own guess.** It runs `yad toolbox list --json` and reads its tool's
  entry, run where the tool runs (`--dir <the code repo>` for work inside one, so tools installed
  there are found). A core tool is used when the entry says `used: true` and its state is `installed` or
  `available`. So one rule decides for every skill, and a plugin turned off in Claude Code counts as
  not ready (`disabled`), like a missing one. If yad cannot answer (it is not installed there, or the command fails), the skill uses its
  own check, as before. yad does not see every way a tool can be set up (an older Spec Kit with only its
  `.specify/` folder, say), so when yad says `missing` and the skill's own check finds the tool, the
  skill uses it — but never when the team chose not to.
- **No Product, no team choice.** The choices come from the Product. If yad finds none (a code repo
  beside the Product with no workspace file), the answer's `product` is null, a skipped tool shows as
  used, and the skill says so.
- **A team's choice is followed.** After `yad toolbox remove spec-kit`, `yad-spec` writes the spec files
  by hand even on a machine where Spec Kit is installed. The commands do not read the choice yet:
  `yad setup` and `yad repo refresh` still pack with Repomix after `yad toolbox remove repomix`.
- **A connector follows its Product file.** Figma, Playwright, DeepTutor and the rest are used when
  `design.json`, `testing.json` or `learning.json` connects them, as before, so a skill whose tools are
  all connectors does not ask `yad toolbox list` at all. `yad toolbox remove figma`
  does not change that; `yad-connect-design` does.
- **The skill records it.** Where a skill writes a line when the tool was not used, the line is the
  entry's `records`: `speckit: not-installed`, `impeccable: not-installed`, and
  `source: repomix-unavailable` (written by `yad-backfill` in a spec's frontmatter and by `yad-connect-repos`
  in `repos.json`; `yad setup` writes `source: repomix` whether or not it packed, and `yad repo refresh`
  never changes `source`). It means the
  tool was not used, whatever the reason. The skill also tells you which tools it used and why.
- **The toolbox owns the words.** To change a fallback, change `cli/toolbox.mjs` and run
  `node scripts/skill-fallbacks.mjs`, which rewrites every section and takes it out of a skill no tool
  names any more. The section ends with the line `<!-- end: When a tool is missing -->`, and the script
  replaces only the lines from the heading down to that marker, so nothing else in the skill is touched.
  It refuses a section without the marker (one written by hand), a second copy, a marker with no
  heading, or a code fence that never closes, and says what to delete or close before running it
  again. As a last check it refuses any write after which the file would hold a second line that looks
  like the heading or the marker (for example one quoted in a code block). A test fails when a section and the toolbox
  disagree, or when a skill has the section but no tool names it.

Not covered: CodeRabbit (the AI reviewer `yad-engineer-review` wires) and `gh` / `glab` (the GitHub
and GitLab programs several skills call) are not in the toolbox, so no skill declares a fallback for
them yet.

### Every tool is vetted

Before a tool goes into the toolbox, yadflow checks two things and writes down the proof:

- **The licence.** Read from the tool's own `LICENSE` file. A closed tool (Figma, Pencil, Cypress Cloud)
  has no licence file, so the proof is the vendor's own terms page.
- **The source.** The tool comes from its owner's official repository or docs, and each package an
  install command names (an npm or PyPI package) points back to that source.

Each tool's record — `vetted` in `yad toolbox list --json` — holds the day this was done
(`vetted.on`), where the licence was read (`licenceFrom`), the source, the release on that day, and the
packages with their versions. `yad toolbox list` prints `licence MIT, vetted 2026-10-02` under each tool.

Vetting is redone before it goes stale. A test fails while any tool lacks a complete record, and the
release check (step 8) refuses to publish while any record is older than **180 days**. It does not check
maintenance, known vulnerabilities or which versions work: those are not part of a vetting record.

A tool your team adds with `yad toolbox add --custom` is yours to vet; its `vetted` is `null`.

**Repomix runs at the vetted version.** yadflow runs `npx repomix@1.18.1` — in `yad setup`,
`yad repo refresh` and the skills that pack code — never `@latest`, and the global-install line
`yad toolbox list` prints is pinned the same way (`npm install -g repomix@1.18.1`). A new Repomix release reaches you
only after it is vetted and a yadflow release moves the version.

## What is installed

`yad detect` answers one question: which skills, agents, MCP servers and plugins could an agent use
here? (An **MCP server** is a program an agent talks to for extra tools. A **plugin** is a bundle that
installs several of these at once.) It looks in two places, and says which one each item came from:

| Scope | Where | Who has it |
|---|---|---|
| `project` | inside this folder — `.claude/`, `.agents/`, `.cursor/`, `.gemini/`, `.codex/`, `.zencoder/`, `.opencode/`, `.mcp.json` | everyone who clones the folder |
| `user` | your home folder — `~/.claude/`, `~/.agents/`, `~/.cursor/`, `~/.gemini/`, `~/.codex/`, `~/.claude.json` (including the servers it keeps for this folder alone) | you only |

```bash
yad detect           # grouped by place, a few names each
yad detect --json    # every item: kind, name, scope, where, agents, version, hash, plugin
```

What it reads, per agent (checked against each agent's own documentation on 2026-09-30):

| Agent | Skills | Agents | MCP servers |
|---|---|---|---|
| Claude Code | `.claude/skills/`, `~/.claude/skills/`, installed plugins | `.claude/agents/`, `~/.claude/agents/`, plugins | `.mcp.json`, `~/.claude.json` (yours, and this folder's), plugins |
| Codex CLI | `.agents/skills/`, `~/.agents/skills/` | `.codex/agents/*.toml`, `~/.codex/agents/*.toml` | `[mcp_servers.<name>]` in `.codex/config.toml`, `~/.codex/config.toml` |
| Cursor | `.agents/`, `.cursor/`, `.claude/`, `.codex/` `skills/`, in the folder and in `~` | `.cursor/agents/`, `~/.cursor/agents/` | `.cursor/mcp.json`, `~/.cursor/mcp.json` |
| Gemini CLI | `.gemini/skills/`, `.agents/skills/`, in the folder and in `~` | `.gemini/agents/`, `~/.gemini/agents/` | `mcpServers` in `.gemini/settings.json`, `~/.gemini/settings.json` |
| GitHub Copilot, Zencoder, opencode | the project folders yad installs into | — | — |

Four rules it keeps:

- **It only reads.** No file is written, no folder is made, no program is run and no network is used.
  It is worked out fresh every time; nothing is saved.
- **An MCP server is named, never described.** Its entry holds a command, arguments, a URL, headers and
  environment variables, and those often carry a token. Only the name is read out. Your home folder is
  shown as `~`, never as its full path. In the terminal, a name holds no character that could move the
  cursor, recolour the screen, reorder the line or hide itself: each is printed as `?`. `--json` hands
  names to a program unchanged, apart from JSON's own escaping.
- **A file it cannot read is reported, not guessed.** A JSON file it reads — an MCP list, the plugin
  list, a plugin's own files, a settings file that turns plugins on or off — that does not parse, or is
  too big to read, is listed under `problems` (by place and reason only), and everything else is still
  listed. So is a `mcpServers` that is not an object, and a plugin whose `plugin.json` names an MCP
  file outside the plugin, one that is not there, or the plugin folder itself (the path it gave is
  never shown). Gemini CLI's
  `settings.json` may hold `//` and `/* */` comments, because Gemini CLI allows them; the other JSON
  files are read strictly, as their agents read them.
- **Codex's `config.toml` is read for keys only.** Every value is skipped whole — a multi-line list, a
  `"""` string, an inline table — so text inside a value is never taken for a server name. A reader of
  keys cannot tell a broken file from a good one: a `config.toml` Codex would refuse may still list the
  keys it holds, and is not reported as a problem.

The same skill name in several places is listed once per place, with a count at the end. Which copy
an agent actually loads is that agent's own rule; `yad detect` does not decide it. A Claude Code plugin
shows `(disabled)` when your settings turn it off — the folder's `.claude/settings.local.json` first,
then its `.claude/settings.json`, then `~/.claude/settings.json`, as Claude Code decides it. A plugin
installed for another folder is left out. A plugin's `scope` is `project` only for Claude Code's
`project` scope, which lives in the folder's own settings; its `local` scope is yours alone, so it
shows as `user`.

The newer-version check that other `yad` commands run at the end is skipped for `yad detect`, so the
command makes no network call and writes no cache file.

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

`yad next`, `yad gate status` and the `yad-status` skill all report a step by one word. There are eight, and
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
| `show` | `item`, `thread: { root, broken }`, `steps`, `stepsWhy`, `approvalsWhy`, `productConfigWhy`; with `"ok": false` and an `error` when the steps cannot be read |

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
- **Four files never carry it.** `approvals.json`, `comments.json`, `product-prs.json` (and its older
  name `hub-prs.json`) and `reconcile-debt.json` are JSON lists, and a list cannot hold a key. They count as shape 1 too.
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

**Upgrading to any new release.** Run these in order, from the Product. On a minor or patch release
`yad migrate` usually has nothing to do; on a major it rewrites the state files the new release
expects. Coming from 3.x, read [Upgrading to 4.0](migrations/upgrading-to-4.md) first.

1. `npm install -g yadflow@latest` — the latest stable CLI.
2. `yad migrate` — preview what would change in your state files. It writes nothing.
3. `yad migrate --apply` — make the change (each rewritten file is saved first as `<file>.yad-orig`).
4. `yad update` — re-sync the installed `yad-*` skills, gate scripts and CI files.
5. `yad doctor` — check that everything is healthy.

The full guide, with what changed in 4.0 and why, is [Upgrading to 4.0](migrations/upgrading-to-4.md). For a
hands-on walk-through, including how to sort the warnings `yad doctor` prints after the upgrade, see the
[step-by-step upgrade guide](migrations/upgrade-guide-3x-to-4x.md).

Major versions are also published to a separate channel first. `npm install yadflow` always gives you
the stable line; `npm install yadflow@next` opts you into the next major while it is being proven.

## Platform support

Linux and macOS are first-class (CI runs the test suite, bash gates, and the
end-to-end harness on both). **On Windows, the agent hooks run natively, without WSL** (E113), and the
CLI code they reach has been fixed for Windows — CI runs the hook scripts and those CLI tests on Windows.
The rest of the CLI is not yet tested there. Requires **Node.js ≥ 18**.

| On Windows | What to know |
| --- | --- |
| Agent hooks | Each hook is a Node script (`hooks/*.mjs`) that the agent runs as `node <script>`, so nothing needs bash or an execute bit. `node` must be on the PATH your agent runs with — if it is not, the hooks silently do not run |
| Claude Code | Runs hook commands in **Git Bash** (part of Git for Windows). Without Git Bash it falls back to PowerShell, and the hooks do not run there. `yad doctor` warns when it cannot find Git Bash |
| Cursor | Runs hook commands through PowerShell. The entry is `node hooks/<script>.mjs`, which PowerShell runs as it is |
| Line endings | Set `git config core.autocrlf input` in the Product clone. With `true` (the Git for Windows default) git checks files out with CRLF line endings. yad's own managed files still compare equal, but an approval is bound to an artifact's exact bytes, so reviews approved elsewhere read as stale. `yad doctor` warns about this on Windows |
| Check gates | Still bash scripts (`checks/*.sh`). They run on your CI runner, not on your machine |
| Not yet tested on Windows | The full test suite and the end-to-end harness run on Linux and macOS only. A machine with no Git Bash is not covered for Claude Code |

### Upgrading from a release before E113

The hooks used to be bash scripts (`hooks/*.sh`). `yad check
--fix` (or `yad update`) rewrites each hook entry to the Node command and deletes the old script — but
only a copy yad's own record (`.sdlc/managed.json`) proves it wrote and nobody changed. A script you
edited, or one your own hook entry still runs, is kept. The old script is also kept until the rewritten
settings file is **committed**: yad never commits that file for you, and a teammate who pulls must not get
an entry that runs a deleted script. So the order is: `yad check --fix`, commit `.claude/settings.json` and
`.cursor/hooks.json`, then `yad check --fix` again to remove the old scripts. Everyone on the team should
upgrade together: an older yadflow does not know the new entries, and its `check --fix` puts the old
script and entry back beside them.

## Troubleshooting (`yad doctor` + error codes)

### The `shape` section — is this project on the right file shape?

`yad doctor` reports what shape your state files are in, against the shape this release writes, one
line for the project and one per epic:

```text
  shape
  ✓ this project is on shape 10, the engine is on shape 10
  ✓ EP-checkout is on shape 10, the engine is on shape 10
```

| What it says | What it means | What to do |
|---|---|---|
| on the same shape | nothing to do | nothing |
| *N file(s) do not record it yet* | those files predate the stamp. They count as shape 1, so they are **correct**, just silent | optional: `yad migrate --apply` writes it in |
| *N file(s) are **behind*** (warn) | this release expects a newer shape | `yad migrate` to preview, then `yad migrate --apply` |
| *N file(s) are **newer** than this yadflow* (fail) | they were written by a newer release | upgrade the CLI. **Never** migrate — that would move them backward and lose what the newer version wrote |
| *N are **CI-owned** and behind* (warn) | in verified mode CI is the only writer of those files, so `yad migrate` will not touch them | nothing. The next `yad gate` command, or CI's next gate sync, moves them and the warning clears |
| *N step(s) belong to no phase* (warn) | a step id this release does not recognise — so no skill runs it and `yad next` cannot guide it | check the spelling, or upgrade if the step comes from a newer release |
| *N epic(s) record a lifecycle profile nobody defined* (warn) | `profile` in `state.json` is not one of the six routes | set it to the route the chain walks, or delete the key and let it be derived |
| *N epic(s) record a route their chain is not on* (warn) | the recorded name and the steps disagree, and the steps are cleanly on another route | the chain is what every gate walks. Correct `profile` in `.sdlc/state.json` |

The reading comes from the same code `yad migrate` previews with, so the two can never disagree. In
`--json`, each shape check carries a `shape` object with the engine's version and a per-file list, so
CI can act on the detail rather than parsing the sentence.

**Two names for one file (E122).** `hub` became Product, so the Product's settings file is
`.sdlc/product.json` and each epic's PR record is `product-prs.json`. Until v5, yad writes the old names
too (`.sdlc/hub.json`, `hub-prs.json`), with the same bytes, because check gates an older yadflow put in
your repos open `.sdlc/hub.json` by that path.

| | what happens |
|---|---|
| which name is read | the new one; the old one only when the new one does not exist |
| both exist and agree | normal. `yad doctor` prints one line (`mirror:legacy-names`, ok) saying v5 deletes the old name |
| both exist and **differ** | no copy is picked. Every command but `yad doctor`, `yad migrate` and `yad report` refuses with `YAD-STATE-008` (the two editor hooks never refuse: `yad hook` guards as below, and `yad capture --hook` never fails by design); `yad doctor` fails it (`mirror:.sdlc/product.json`, or the epic's own check); the check gates print `FAIL [product-settings]` and fail (`risk-map`, which is advisory, prints a note and reads neither). The editor hook still guards a ledger edit when either copy says `verified` |
| to end a difference | `yad migrate` lists which keys differ. `yad migrate --apply` asks which copy to keep; `--keep product` or `--keep hub` answers it (needed without a terminal, and under `--json`, where the refusal is `YAD-CLI-001`). The copy not kept is backed up as `<file>.yad-orig`. This works on any shape, even when nothing else needs migrating |
| editing the settings by hand | edit `.sdlc/product.json`, then run `yad migrate --apply --keep product`. A Product that has only `.sdlc/hub.json` has not been migrated yet: edit that file — never create a `product.json` beside it by hand, or `--keep product` would copy that one file over every other setting |
| the gates' environment variable | `SDLC_PRODUCT_CONFIG` names the settings file for a gate; the older `SDLC_HUB_CONFIG` still works. The gate reads `SDLC_PRODUCT_CONFIG`, then `SDLC_HUB_CONFIG`, then `.sdlc/product.json`, then `.sdlc/hub.json`. Both variables set, naming files that differ: the gate fails |

`yad migrate` does not rename what is installed in your repos — `yad update` does that (the
`yad-hub-checks` workflow → `yad-product-checks`, the `yad-hub-bridge` skill → `yad-product-bridge`, the
GitLab `yad-hub-*` jobs → `yad-product-*`; see `renamed:` and `renamed-ref:` above). Nor does it touch your
own CI settings and scripts that name `.sdlc/hub.json` or `SDLC_HUB_CONFIG`: they keep working until v5;
change them by hand.

**Every other command warns first when the project is ahead.** If `.sdlc/cli-version.json` or the product
config says a newer file shape than this yadflow knows, each command prints one warning on stderr before
it runs — stdout and `--json` are unchanged — telling you to upgrade before relying on what it says.
`yad doctor` and `yad migrate` report it in their own words, and `yad hook` never prints it. This is what
a 3.x yadflow could not do for shape 8 (docs/migrations/shape-8.md).

When something is off, run `yad doctor` first — it checks the environment (git, gh/glab auth, node
version), the project state (`.sdlc/*.json` parse and point at real repos), and every epic ledger,
with a fix-it hint per finding. Failures carry stable, greppable codes, also printed by any failing
`yad` command — the table is at the end of this section, under [Error codes](#error-codes).

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
platform puts on a branch, such as "a pull request needs one approval before it can merge". How to set
it up for yad, on GitHub and GitLab, is [Branch protection](branch-protection.md); when any line in this
section warns, `yad doctor` ends the section with a link to that page (E48). On GitHub
these rules come in two forms: **classic branch protection** and the newer **rulesets**. The
`protection` section of `yad doctor` reads what the platform holds on the Product's branch and on
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
  ! Product (GitHub acme/app, branch `main`): This repo has no approval rules and no branch protection. Anyone with write access can merge anything. yad will record what happens, but it cannot stop anything here.
  → only GitHub can require an approval before a merge, in GitHub's branch protection or a ruleset for `main`; yad only reports what is set
  ✓ Product: a pull request into `main` on GitHub acme/app needs at least 2 approvals (from: a repo ruleset (id 7)); whether a code owner must approve some files is not known — yad reports this and enforces nothing
  → ask someone who can see GitHub's settings for `main` about what yad could not read
  ! Product: `main` is protected on GitLab acme/app, but whether a merge needs an approval is not known — GitLab refused to show the approval rules (HTTP 403): they need GitLab Premium or Ultimate, or your login may not read them; whether a code owner must approve some files is not known
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

### Error codes

| Code | Meaning | Fix |
|------|---------|-----|
| `YAD-ENV-001` | git is not installed or not on PATH | install git — every yad command needs it |
| `YAD-ENV-002` | platform CLI (gh/glab) missing or not authenticated | install it and authenticate — `gh auth login` (GitHub) or `glab auth login` (GitLab); the gate degrades to local without it |
| `YAD-ENV-003` | Node.js older than the supported range | install Node >= 18 |
| `YAD-STATE-001` | a ledger/config JSON file exists but does not parse | fix the file or restore from git — never delete a ledger blindly |
| `YAD-STATE-002` | a ledger/config file parses but has the wrong shape | fix the file or restore from git (the message names the field) |
| `YAD-STATE-003` | a registered repo path is missing or not a git repo | fix the path in `.sdlc/repos.json` or re-connect the repo. A repo *outside* the project root (a sibling, `../backend`) that is simply absent from this checkout is a **warn**, not this failure — for both, the hint names `yad repo clone` when that command would clone it (E81), and says why when it would not. A path that is there but refused — outside the workspace, through `.git`, or a folder with no `.git` — is reported with that reason, and doctor runs no git in it (in this check or in its risk-map, CODEOWNERS, protection and product-link checks) |
| `YAD-STATE-004` | an epic step cannot be skipped, deferred, put back, or unblocked in its current state | the step must be one the epic's own [lifecycle route](#lifecycle-profiles-the-route-an-epic-takes) marks optional — `ui-design` on `classic` and `analysis-first` — and needs a `--reason`; it can be skipped only up to authoring it (before its review opens / before the step after it starts — `stories`, on `classic`); `yad unskip` works until a step past that one starts (the stories review, on `classic`). `yad defer` and `yad undefer` follow exactly the same rules, and neither will change a step the other one set aside. A step that is `blocked` must be cleared with `yad unblock` before it can be skipped or deferred, and `yad unblock` refuses a step that is not blocked. A chain on **no** route has nothing optional: fix `step:off-route` first |
| `YAD-STATE-005` | an authoring step is stranded behind its completed review gate | a pre-3.11 `gate sync` could advance a review step while leaving its author step `in_progress`, silently blocking every later step (and the parallel `test-cases` track). Run `yad gate repair <epic>` |
| `YAD-STATE-006` | a Build ledger (`build-log`/`trust-log`) is locked by another yad process writing it | every read-modify-write on these ledgers (`--retro-ship`, `yad review reconcile`, `yad tidy up`) takes an exclusive lock, so two runs can never interleave and lose an entry. Wait for the other command and re-run; a lock left by a killed process is reclaimed automatically after 30s, or delete the `.lock` directory the message names |
| `YAD-STATE-007` | an epic cannot be seeded — the profile, the type or the existing ledger refuses it | `yad epic new` was given a lifecycle profile it cannot seed. The message lists the ones it can: `classic`, `analysis-first`, `chore` or `spike`. The Product level (`foundation`) is seeded only by `yad foundation new` |
| `YAD-STATE-008` | a file kept under two names says different things under each: `.sdlc/product.json` and `.sdlc/hub.json`, or an epic's `product-prs.json` and `hub-prs.json` (E122) | until v5 yad writes both names with the same bytes; `product.json` is the one read, and `hub.json` is kept for check gates an older yadflow installed. When they differ no copy is picked for you, so every command but `yad doctor`, `yad migrate` and `yad report` refuses, and the gates FAIL. Run `yad migrate` to see which keys differ, then `yad migrate --apply` to choose the copy to keep (`--keep product` or `--keep hub` without a terminal or under `--json`); the other copy is backed up as `<file>.yad-orig`. Editing the settings by hand? Edit `.sdlc/product.json`, then run `yad migrate --apply --keep product` (on a Product that has only `.sdlc/hub.json`, edit that; nothing else is needed) |
| `YAD-CFG-001` | the Product settings (`product.json`, or `hub.json` on a Product that has only that name) name an unknown platform | expected `github`, `gitlab`, or `null` — fix it or re-run `yad setup` |
| `YAD-CFG-002` | `design.json` names an unknown design tool | expected one of `config.yaml` `design.tools` (e.g. `figma`, `pencil`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-003` | `testing.json` names an unknown testing tool | expected one of `config.yaml` `testing.tools` (e.g. `playwright`, `cypress`, `pytest`, `maestro`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-004` | `learning.json` names an unknown learning tool | expected one of `config.yaml` `learning.tools` (e.g. `deeptutor`), or `none` — fix it or re-run `yad setup` |
| `YAD-CFG-005` | the Product settings (`product.json`, or `hub.json` on a Product that has only that name) set a platform but are missing `git_url` (needed to scope auth + open PRs) | add `git_url` to `.sdlc/product.json` (`.sdlc/hub.json` on a Product that has only that name; when both exist, then run `yad migrate --apply --keep product`), or re-run `yad setup` — it backfills it from the origin remote |
| `YAD-CFG-006` | `.sdlc/skills.json` binds a step to something that is not a skill name | each value must be a skill name (a string) or a non-empty list of them. `yad doctor` warns and names the steps; the engine ignores those lines and runs its default skill. Fix the line, or `yad skill unbind <step>` |
| `YAD-CFG-007` | `.sdlc/toolbox.json` has a line that does nothing: a tool this yadflow does not ship, a choice other than `use` or `skip`, or a custom tool that is incomplete (no role, fallback or `detect`), malformed (a bad id, `install` or `source`, a path in `bins`), listed twice, or uses a shipped tool's id (E86) | `yad doctor` warns and names each line; `yad toolbox list` ignores those lines and shows the default. Fix the line by hand, or `yad toolbox remove <id>` — it clears whatever the file holds under that id — and add the tool again. An entry with no id, or an empty one, is out of `remove`'s reach: fix it by hand |
| `YAD-CLI-001` | a `--json` run needed an answer only a prompt could give (E1) | a `--json` run never asks a question. Pass the answer as a flag (`yad --help` lists them), set `SDLC_NONINTERACTIVE=1` to take the defaults, or run without `--json` |

Filing a bug? The fastest path is **`yad report`** — it files the issue for you in the yadflow repo
with **auto-scrubbed** diagnostics (versions, tool present+authenticated booleans, the Product platform
enum, the error code/hint, a path-scrubbed message, and the failing command + flag *names* only). It
never posts absolute paths, hostnames, git URLs, repo names, logins/emails, epic IDs, branch
names, or flag values; it shows you the exact payload and asks before posting to the public repo, and
searches for duplicates first. After an unexpected failure the CLI also **offers** to run it for you —
set `YAD_NO_REPORT=1` to opt out. Prefer a hand-written issue? Attach `yad doctor --json` (names,
paths, and check results only — review and redact before posting).
