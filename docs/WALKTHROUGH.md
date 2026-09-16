# Using the workflow end to end (all the steps, in order)

The full path from nothing to shipped code, by hand. Each numbered step names the skill to invoke; the
detailed sections below expand every phase. Invoke a skill by name in your agent/IDE (e.g. *"run
`yad-epic`"*); state lives in files you can also edit directly.

For the big-picture concepts see the [README](../README.md); for command reference see
[`CLI.md`](CLI.md); for the skill catalog see [`SKILLS.md`](SKILLS.md); for the plain-language team
version see [`TEAM-GUIDE.md`](../TEAM-GUIDE.md).

## The two dials (per step)

- **driver:** `human` | `pair` | `agent` — who does the work.
- **advance:** `human` | `auto` — who moves the step forward.

Each dial is written under two names while the shape-4 rename settles, and the OLDER one is still
the one the engine reads: `driver` beside `assistance` (`human`/`pair`/`agent` = `none`/`review`/`heavy`),
and `advance` beside `automation` (`human`/`auto` = `human_approve`/`machine_advance`). Run `yad migrate`
to add the new names to an existing project — see `migrations/shape-4.md`.

Defaults: every step starts `advance: human`. The four **front** authoring steps (epic, architecture,
UI, stories) and their reviews are **locked** — they may not be set to `advance: auto` in this
version. A Shape step advances only on a **human act** — recording an approval and `advance`, or
merging the approved, fully-resolved review PR — never on a machine.

As of **Phase 4a** the `advance` dial is no longer inert: the orchestrator `yad-run` reads it and,
for the **Build** steps, advances on its own when a step is set to `advance: auto` — the team sets it with
`yad dial`; see "Run Build on the dial" below. The engineer review and every Shape review gate stay
`advance: human` forever. A Shape author step's dial can be set too, but nothing drives a Shape step on its
own yet, so that choice is recorded, not acted on.

## 0 — One-time setup

> **Shortcut:** `npx yadflow setup` runs the guided wizard interactively — module install, Product
> detection, connect a design/testing/learning tool (each optional), connect repos, wire each
> repo. Run `… check --fix` any time afterwards to reconcile. The manual steps below are the
> long-hand equivalent and still work.

1. **Install the module:** `npx yadflow setup` (re-sync later with `… check --fix`).
2. **Have your code repo(s).** They are **separate git repos** (one `.git` each). For the demo they
   live under `demo-repos/<repo>/` — regenerate from `demo-repos/README.md`.
3. **Optional tools** (the workflow degrades gracefully and records it if any are absent): **Spec Kit**
   (`/speckit.*`), **Impeccable** (`/impeccable …`), **Repomix** (`npx repomix`, used by
   `yad-connect-repos` and `yad-backfill`), **CodeRabbit** (advisory AI review), **DeepTutor**
   (`deeptutor`, the learning layer's tutor — degrades to harness-native, used by `yad-connect-learning`
   and `yad-learn`).
4. **Wire each code repo once:** `yad-checks repo:<repo> action: wire` (installs the CI gates —
   *merges* with any existing CI, never clobbers), `yad-pr-template repo:<repo> action: wire` (PR/MR
   template + risk routing).
5. **Connect each code repo to the Product** (so the Shape phases see what's already built):
   `yad-connect-repos action: connect repo:<repo> path:<path-or-git_url>`. It
   registers the repo in `.sdlc/repos.json` and caches a Repomix pack + a lightweight **code-map**
   (existing endpoints/events/data-models/modules, secret-scanned). Clones/fetches as the **local user**
   (SSH or credential helper; GitHub or GitLab; no stored tokens). Re-run for any new repo. Freshness is a
   **human decision**: `yad repo list` shows fresh/stale, `yad repo refresh [name]` re-packs a moved repo
   (skills flag staleness and point here — they never silently re-pack). Greenfield → skip it. Once the
   AI has regenerated the code-map, `yad repo refresh [name] --push` publishes the refreshed code-maps +
   registry to the Product's default branch as one `chore(hub): sync code-context … [skip ci]` audit commit.
6. **(Optional) Connect tools** so the matching steps do real work (each degrades gracefully and is
   recorded if absent): `yad-connect-design action: connect` (Figma-first → `design.json`, lets
   `yad-ui` materialize screens), `yad-connect-testing action: connect` (Playwright-first →
   `testing.json`, lets `yad-test-cases` implement automation), `yad-connect-learning action: connect`
   (DeepTutor-first → `learning.json`, powers the cross-cutting learning layer).
7. **(Optional) Put the Product on a platform** so the Shape review runs through real PRs:
   `yad-connect-repos action: detect-hub`, then `yad-pr-template repo:hub action: wire` /
   `yad-checks repo:hub action: wire`. There are no reviewers to register: anyone with access to the
   Product repo can approve, and each approval is recorded under their platform login. With no Product
   platform the Shape gate runs local.
8. **Conventions:** commits and PR/MR titles follow Conventional Commits (lowercase after the type), the
   human author owns each commit with an optional per-commit `Co-Authored-By` AI trailer — see
   [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## A — Shape (human-authored, once per epic)

Each author step writes its artifact, sets itself `done`, moves `currentStep` to its review, and
**stops at the gate**. Run every gate with **`yad-review-gate`** — or, when the Product is on a platform,
drive it deterministically with the **`yad gate`** CLI (`open → sync → … → merge`): the review rides
the per-step PR/MR and the step **auto-advances on merge** once approvals are satisfied and all comment
threads are resolved. Details: **"Run all of Shape by hand"** below.

0. *(optional, once per product)* `yad foundation new` then `yad-discovery` → the **Foundation** in
   `foundation/` (`purpose.md`, `scope.md`, `mvp.md`, `roadmap.md`, `stack.md`, `repos.md`, plus
   optional `market.md` and `risks.md`) under the fixed id `EP-foundation` → review (1 approver) →
   `currentStep: foundation-done`. The six required sections must exist to review, and the gate warns
   when a section still holds only its template headings (greenfield: the skill asks for each section
   in turn); its `roadmap.md`
   then frames each epic below (read once it is approved; `yad foundation status` shows which features are started, read from the
   epic ledgers — the roadmap's Status column is not edited by hand).
6. `yad-epic` → `epic.md` (assigns `EP-<slug>`, seeds state) → review (1 approver).
7. `yad-architecture` → `architecture.md` + locked `contract.md` → review (1 approver; the `contract` tag makes the reported count 3).
8. `yad-ui` → `ui-design.md` + `DESIGN.md` → review (1 approver).
9. `yad-stories` → repo-tagged `stories/EP-<slug>-S0N.md` → review (1 approver; the PR is labelled with each touched repo).
   → `state.json` reaches `currentStep: ready-for-build` — **Build can start now.**
10. `yad-test-cases` → `test-cases.md` (+ automation tests when a testing tool is connected) → review (1 approver).
    **Parallel, non-blocking:** opens when the stories gate passes and runs alongside Build; its
    review never moves `currentStep` off `ready-for-build`.

## B — Build (per story, per repo)

From a `ready-for-build` story, for **each** repo the story is tagged with. Details: **"Run the full
Build by hand"** below.

10. `yad-spec story:<id> repo:<repo>` → writes `specs/<story-id>/` (spec/plan/tasks + `link.md`).
11. `yad-implement story:<id> repo:<repo> task:<T0N>` → one atomic task = one branch = one commit
    (repeat per task). Commit by convention with **`yad commit --type <t> -m <subject> [--ai <tool>]`**
    (Task/Contract-Change/Co-Authored-By trailers, atomic-file guard).
12. `yad-checks repo:<repo> action: run` → spec-link, contract-check, build/test/lint, verified-commits
    (a platform-Verified signature on every commit), and commit-message must pass. (The
    `pr-title` / `pr-template` gates need the PR title + body, so they run in CI once the PR exists —
    step 13.)
13. Open the PR/MR from the wired template with **`yad open-pr --repo <repo> [--risk <level>]`** (or do
    12+13 in one step with **`yad ship --type <t> -m <subject> --repo <repo>`**). The PR is based on the
    repo's **own default branch**, resolved the same way the gates resolve their trunk (the registry's
    `default_branch`, else the platform's own default, else `origin/HEAD`, else `main`) — `--base`
    overrides it, and a base that is not the platform default warns **without blocking — the PR still
    opens**; if that was not what you wanted, close it and re-run against the right base, because
    CodeRabbit decides eligibility at open time and retargeting does not bring it back. The PR's CI now also
    runs the `pr-title` and `pr-template` gates; `yad-pr-template repo:<repo> action: route` prints the
    required reviewers from the Impact & Risk block.
14. `yad-engineer-review` → `ai-review` (advisory) → `approve` (the human engineer gate) → `ship` (merge,
    record in `build-log.json`, update story status to `in-build`/`shipped`). The machine-written
    ledgers (`build-log.json`, `trust-log.json`, `build-state/`) are committed by **`yad checkpoint --push`**
    — a `chore(hub)` audit-trail commit Build runs for you, so no one hand-commits this state.
    The `trust-log`/`build-log` entries are written as per-entry **shard files** (so parallel stories of one
    epic never conflict on them); once the story ships, **`yad tidy up [<epic>] [--push]`** folds its
    finished shards back into the single ledger file (the manual "pack it up", like `git gc`).
    - **Multi-repo:** repeat 10–14 in each repo, all from the **one** locked contract.
    - **Existing code:** `yad-backfill` first, to produce a human-verified spec for a built feature.

## C — Automation (optional, switched on by the team)

15. Set a Build step to run on its own: `yad dial <epic> <story> --repo <repo> <step> --to auto`. It prints
    the step's run record in that repo as advice (runs, % approved unchanged) and never refuses on it. The
    engineer review is a gate, so it is refused. `--to human` puts a step back.
16. Drive a story's Build on the dials: `yad-run story:<id> repo:<repo>` — it advances past a step set to
    auto after a clean run and stops for a human otherwise, always halting at the engineer review. Each iteration
    it runs `yad checkpoint --push` to commit the new `trust-log/` shard + `build-state/` it just wrote (a
    `chore(hub)` commit, default branch only) — so the shared run record stays current with no human commit.
17. **Kill switch any time:** `yad kill --reason "<why>"` (everything → manual, recorded in
    `.sdlc/automation.json`) / `yad unkill`.
    Details: **"Run Build on the dial"** below.

## Any time

- **`yad-status [EP-<slug>]`** — read-only: the Shape chain, each build step's dial + status, the
  run record, the kill switch, and (across epics) the fleet roll-up. Start here to see what's blocking.
- **`yad doctor`** — health check. Its `shape` section says whether this project's state files match
  the shape this release expects, one line for the project and one per epic, and names the command to
  run if they do not.
- **`yad epic new <slug>`** — start an epic by writing its step chain from a lifecycle profile
  (`--profile classic|analysis-first|chore|spike`, `--type feature|chore`), plus its empty ledgers.
  `chore` and `spike` are the short lanes: the epic and its stories, with the analyst's brief in front
  for a spike. Neither has an architecture gate, so neither may move the contract surface. It writes
  no `epic.md`, no branch and no commit, and refuses an epic that already has a chain.
- **`yad skill list`** — which skill runs which lifecycle step, and whether that answer is your
  project's choice or the engine's default. `yad skill bind <step> <skill>` records your own in
  `.sdlc/skills.json`; pass several and they run as a chain, in order, each costing another model run.
  `yad skill unbind <step>` goes back to the default.
- **`yad migrate`** — read-only preview of the state files this release would rewrite, and why. Run it
  after upgrading to a release whose notes mention a file-shape change; `--apply` makes the change,
  keeping a `<file>.yad-orig` copy of everything it touches. Running it twice is safe.
- **`yad usage`** — read-only team-member adoption & behavior report for an EM/team-lead:
  per-member *authored / commented / approved / shipped* with factual workflow-hygiene flags, derived
  from git + the ledgers and written to a path you choose (`--out`, `--since/--until` or `--all`,
  `--member`, `--format html|json|md`). Emits no emails or comment bodies.

---

## Run all of Shape by hand

Optionally preceded once per product by the **Foundation** — **`yad foundation new` → `yad-discovery`
→ review → `foundation-done`** — which frames the whole product (purpose, scope, MVP, roadmap, stack,
repos) in `foundation/`; its approved `roadmap.md` then feeds each epic. Shape itself walks **epic → review → architecture+contract → review → UI design → review → stories
→ review → `ready-for-build`**, then **test cases → review** runs as a **parallel, non-blocking track**
alongside Build. It is all files under `epics/EP-<slug>/`. The skills below guide you, but you
can also edit the files directly — that's the point.

Each authoring step is the same shape: an author skill produces an artifact, sets its step `done`,
moves `currentStep` to the matching review, and **stops at the gate**. Then **`yad-review-gate`**
(one gate, reused for all five reviews) takes `open → comment → approve → advance`. When the Product is on a
platform, the **`yad gate`** CLI runs that gate over a real PR/MR — `open` raises the review PR, `sync`
pulls approvals + comment threads into the ledger, and the step **auto-advances when the approved,
fully-resolved PR is merged** (the merge is the human approval act).

**Code-aware (when repos are connected).** If you ran `yad-connect-repos` in setup, each author step
first loads the connected repos' **code-maps** (from `.sdlc/code-context/<repo>/`) so it considers what
already exists: the epic references existing behaviour, **the architecture cross-checks the contract
surface against existing endpoints/events/entities before hash-locking it**, the UI reuses existing
components, and stories anchor to real modules. Each artifact stamps what it read in its `code-context:`
frontmatter; a repo that has moved since connect triggers a staleness warning — the step **flags it and
stops**, pointing you at `yad repo refresh <repo>` (refreshing is a human decision, never an automatic
side-effect). With no repos connected the steps proceed exactly as before (greenfield-safe).

### Author steps

1. **`yad-epic`** (state 1) → `epic.md`; assigns the stable `EP-<slug>` ID; seeds
   `.sdlc/state.json` (all `advance: human`, Shape steps locked) + empty `.sdlc/approvals.json`.
   Or lay the track first with **`yad epic new <slug>`**, which writes that same chain from a
   lifecycle profile and leaves `epic.md` to the skill.
2. **`yad-architecture`** (state 3) → `architecture.md` + the locked `contract.md`; writes the
   contract-surface SHA-256 to `.sdlc/contract-lock.json`.
3. **`yad-ui`** (state 5) → `ui-design.md` + `DESIGN.md` (drives Impeccable
   `document|extract|craft` slash-commands when installed; otherwise authors directly).
4. **`yad-stories`** (state 7) → one file per story `stories/EP-<slug>-S0N.md`, each tagged
   with the `repos` it implements.

### The one gate (every review)

Every review is the same loop — author writes, reviewers comment (which never advances), approvals
accumulate, and the step moves forward only when the rule is met. **local** ends in an explicit
`advance`; **PR-driven** (Product on a platform) ends when the approved, fully-resolved review PR is
**merged**:

<!-- Source: docs/diagrams/review-loop.mmd — edit the .mmd and run `npm run diagrams` to regenerate -->
![Review gate loop — author, open, comment, approve, advance](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/diagrams/review-loop.svg)

**local** — invoke **`yad-review-gate`** with `open` (present the artifact; reviewers comment in
`reviews/<artifact>--<date>--comments.md`), `approve` (name + role → `.sdlc/approvals.json`), and
`advance` (moves **only if** the rule is satisfied, else it names the missing approval).

**PR-driven** — when the Product is on a platform, the **`yad gate`** CLI runs the same gate over a PR/MR:
- `yad gate open <epic> <artifact>` — raise the review PR/MR; mark the step `in_review`. The
  `review/<epic>/<artifact>` branch must already be pushed (or use `yad open-pr` from it, which pushes first).
- `yad gate sync <epic> [artifact]` — pull approvals + comment threads into the **same** ledger (your
  own `gh`/`glab`, no stored tokens) and **auto-advance on merge** once the rule is met and every thread
  is resolved. Approvals are **revoked when the reviewed artifact changes** (re-hash), so reviewers get
  a fresh pass. A change to the frontmatter `status:` line alone is not an edit. Unresolved comments hold the step `in_review`.
- `yad gate comments <epic>` fetches the open threads to address; `yad gate status <epic>` shows
  approvals (counting only the non-stale ones). The file ledger stays the source of truth; with no
  platform / no CLI it degrades to local.

**The gate rule, by review.** There are no roles: a gate counts **distinct people who approved**. The
engine computes a **count** — `base + risk step` distinct approvers, base 1, plus 2 for a `contract` tag
or 1 for `auth`/`payments` — and `yad gate sync`, `yad gate status` and the generated review-PR body print
that arithmetic. **Only the base holds the gate** until the capacity cap ships, because an uncapped count
would make a two-person team's architecture gate unpassable; the rest is reported as a shortfall.
- **Epic, UI, stories, test cases:** 1 approver; the count asks for 1.
- **Architecture+contract** (`risk_tags: ["contract"]`): 1 approver holds it; the count asks for **3
  distinct approvers** (base 1 + contract 2) and reports the shortfall without blocking. The
  contract-surface hash must still match `.sdlc/contract-lock.json` (a changed surface invalidates
  approvals).
- Review PRs request no reviewers — ask the people who know the touched repos on the PR itself.

### Check status anytime

Invoke **`yad-status`** (read-only) to see the full 10-step chain, every step's dials/status, the
contract lock, story repo tags, and which approvals the active gate still needs.

## Worked example (already in this repo)

`epics/EP-checkout/` shows the **whole Shape** walked end to end:
- `epic.md` authored + approved (epic gate) — 2026-06-04.
- `architecture.md` + `contract.md` authored; contract surface hash-locked in
  `.sdlc/contract-lock.json`. Architecture gate (contract, payments): approved by *alice*, *bob*, *carol*
  and *dave* — 4 people, so even the full count of 3 is met. (These approvals were recorded before E62
  and still carry the roles the roster gave them; nothing reads those fields now.)
- `ui-design.md` + `DESIGN.md` authored (Impeccable not installed → graceful fallback). UI gate approved
  by alice + bob.
- Five repo-tagged stories `stories/EP-checkout-S01..S05.md`. Stories gate approved by alice, bob,
  carol and dave; the review PR is labelled with each touched repo (backend, mobile).
- `state.json` now reads `currentStep: ready-for-build`, every Shape step `done` — the Phase 3
  handoff point.

Inspect it:
```bash
cat epics/EP-checkout/.sdlc/state.json
cat epics/EP-checkout/.sdlc/approvals.json
cat epics/EP-checkout/.sdlc/contract-lock.json
ls  epics/EP-checkout/reviews/
ls  epics/EP-checkout/stories/
# re-verify the contract surface still matches its lock:
awk '/CONTRACT-SURFACE:BEGIN/{f=1;next} /CONTRACT-SURFACE:END/{f=0} f' \
  epics/EP-checkout/contract.md | tr -d '\r' | shasum -a 256
```

## Run the full Build by hand (Phase 3)

From a `ready-for-build` story, the **Build** turns one atomic task into shipped code through
gates that protect production. Per-repo specs live in each code repo; the contract stays singular in
the product repo. Code repos are **separate git repos** under `demo-repos/<repo>/` (gitignored;
`demo-repos/README.md` explains regeneration). **Nothing auto-advances** — every gate is human-owned.

> **Lost in Build?** `yad next <epic>` reads each story's `build-state` and tells you the
> next sub-step per repo (`spec → tasks → implement → checks → engineer-review`) plus the remaining chain and
> the automation dial — so you never have to remember which step comes after `yad-spec`.

1. **Spec** — `yad-spec` runs the heavy Spec Kit ceremony **once per story per repo**
   (`specify`→`clarify`→`plan`→`analyze`→`checklist`→`tasks`), writing `specs/<story-id>/` and a
   `link.md` back to the story (drives `/speckit.*` when installed, else degrades). It **quotes** the
   locked contract; it never widens it.
2. **Implement** — `yad-implement` (the `dev` step): one atomic task = one branch
   (`feat/<story>-<task>-…`) = one PR. The diff stays inside the files the task declared. Commit with
   **`yad commit`** — it builds the conventional subject, derives the `Task:` trailer from the branch
   (add `--contract-change` only if the locked surface is touched), appends an optional `--ai` co-author,
   and refuses a non-atomic stage. Open the PR with **`yad open-pr --repo <repo>`** (template prefilled),
   or do both in one step with **`yad ship`** (commit then open-pr).
3. **Check gates** — `yad-checks` wires the CI gates (GitHub + GitLab) that must pass before merge:
   **spec-link** (links a real story/spec), **contract-check** (a contract-surface change without
   `Contract-Change` + a re-locked contract FAILS, routing back to the architecture gate),
   **build/test/lint**, **verified-commits**, and the **pattern gates** **commit-message** / **pr-title**
   / **pr-template** (profile-aware `code`|`hub`, so they also run on the Product). They fail closed
   on a bad base ref.
4. **PR/MR template + risk routing** — `yad-pr-template` drops the platform-matched template with an
   Impact & Risk block; `high` risk (or a contract/auth/payments surface) raises the approval count
   (`risk-route.sh` prints it and the touched domains to ask), the same arithmetic as the gate.
5. **AI review → engineer review → merge** — `yad-engineer-review`: CodeRabbit is an advisory first pass
   (never the authority); a human engineer approves (one approver holds the merge; risk raises the reported count); on
   merge the ship is recorded in the build ledger — as a shard under `.sdlc/build-log/`, which readers
   union with the folded `.sdlc/build-log.json` and `yad tidy up` later folds in — and the story state
   becomes `in-build` → `shipped`. The epic → story → task → PR → mergeCommit chain is traceable both ways.

**Multi-repo:** a story tagged `repos: [backend, mobile]` runs the above in each repo independently from
the **one** locked contract; the contract-check blocks a surface bypass in either repo.

**Backfill existing code:** `yad-backfill` packs one feature with **Repomix** (`npx repomix`, secret-scan
by default), drafts an *unverified* spec ("describe what exists, do not invent"), a human approves it,
and `backfill-check.sh` blocks a change to that feature until its spec is approved — gated per touched
feature, never the whole repo.

Build is walked end to end on the worked epic: story **S01** shipped (`status: shipped`,
three tasks in `build-log.json`), **S03** built across backend + mobile, and a `health` feature
backfilled. The code repos are regenerable from `demo-repos/README.md`.

## Run Build on the dial (Phase 4 — automation, switched on by the team)

Phase 4 is **automation you switch on, and switch off in one move**. Phase 4a made the `automation` dial
real; Phase 4b added the `implement → check` hand-off and the `spec`/`tasks` trust hooks. **Since E34
nothing is earned:** the team sets each dial with `yad dial`. The engine is `yad-run`; the record lives in
two files per epic under `.sdlc/`: `build-state/<story-id>.json` (the Build steps with their dials, per
repo) and `trust-log.json` (every run's verdict). `docs/phase-4-build-plan.md` and
`docs/phase-4b-build-plan.md` record how it was built.

- **Drive a story's Build:** `yad-run {story} {repo}` walks `spec → tasks → implement → checks`,
  reading each step's dial. On `advance: auto` it advances on its own; on `advance: human` it stops
  for a human; on any FAIL, scope overrun, or contract-surface touch it **halts and pulls in a human**.
  It always stops at the engineer review (`yad-engineer-review`), which is never automated.
- **Read the run record:** `yad dial {epic} {story} --repo {repo} {step}` shows a Build step's dial and its
  run record in that repo — runs and % `approved-unchanged` — as advice; `yad-status {epic}` shows it for
  every step. The engineer review records each run's verdict (a diff merged as-authored is
  `approved-unchanged`; one edited first is `approved-with-edits`; a failed one is `rejected`).
- **Switch a step to auto:** `yad dial {epic} {story} --repo {repo} checks --to auto`. There is no
  threshold: the team decides, reading the record. A gate is refused, and `--to human` is always accepted.
- **A Shape author step:** `yad dial architecture --to auto` records the choice for the whole project in
  `.sdlc/automation.json`. Nothing drives a Shape step on its own yet — that arrives when the engine runs
  agents — so it is recorded, not acted on. Its review gate is always a person.
- **Kill switch:** `yad kill --reason "<why>"` holds every step at `advance: human` instantly, recorded
  with who and when in `.sdlc/automation.json`; `yad unkill` lets each step follow its own dial again.
  `yad doctor` warns while it is on.

## What's intentionally NOT built yet

**Shape automation that acts:** a Shape author step's dial can be set to auto (`yad dial <step>`), but
nothing drives a Shape step on its own until the engine runs agents (E26). The scope guard and
contract-surface halt always override the dial, and **every review gate — the engineer review and each
Shape review — stays `advance: human`, permanently.**

**Phase 5 (conditional):** the optional service layer (watch repos, run steps set to auto
unattended, read-only dashboards), built only when the CLI genuinely can't keep up, with git remaining
the source of truth. It is **trigger-gated** — `docs/phase-5-build-plan.md` is the build plan: its
three parts (read-index, unattended runner, dashboard) each ship only when *their* bottleneck is
measured, with the hard rules they inherit and the instrumentation (already shipped in `yad-status`)
that makes the decision data-driven. See also `docs/claude-code-build-plan.md` §8.
