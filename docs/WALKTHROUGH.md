# Using the workflow end to end (all the steps, in order)

The full path from nothing to shipped code, by hand. Each numbered step names the skill to invoke; the
detailed sections below expand every phase. Invoke a skill by name in your agent/IDE (e.g. *"run
`yad-epic`"*); state lives in files you can also edit directly.

For the big-picture concepts see the [README](../README.md); for command reference see
[`CLI.md`](CLI.md); for the skill catalog see [`SKILLS.md`](SKILLS.md); for the plain-language team
version see [`TEAM-GUIDE.md`](../TEAM-GUIDE.md).

## The two dials (per step)

- **assistance:** `none` | `review` | `heavy` — how much AI helps.
- **automation:** `human_approve` | `machine_advance` — who advances the step.

Defaults: every step starts `human_approve`. The four **front** authoring steps (epic, architecture,
UI, stories) and their reviews are **locked** — they may not be set to `machine_advance` in this
version. A front state advances only on a **human act** — recording an approval and `advance`, or
merging the approved, fully-resolved review PR — never on a machine.

As of **Phase 4a** the `automation` dial is no longer inert: the orchestrator `yad-run` reads it and,
for the safe **back** steps, advances on its own when a step is set to `machine_advance` (and has
*earned* it — see "Run the back half on the dial" below). The engineer review and all five front
states stay `human_approve` forever.

## 0 — One-time setup

> **Shortcut:** `npx yadflow setup` runs the guided wizard interactively — module install, hub
> detect + roster, connect a design/testing/learning tool (each optional), connect repos, wire each
> repo. Run `… check --fix` any time afterwards to reconcile. The manual steps below are the
> long-hand equivalent and still work.

1. **Install the module:** `bash skills/sdlc/install.sh` (re-run after any BMAD update).
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
5. **Connect each code repo to the hub** (so the front phases see what's already built):
   `yad-connect-repos action: connect repo:<repo> path:<path-or-git_url> domain_owner:<who>`. It
   registers the repo in `.sdlc/repos.json` and caches a Repomix pack + a lightweight **code-map**
   (existing endpoints/events/data-models/modules, secret-scanned). Clones/fetches as the **local user**
   (SSH or credential helper; GitHub or GitLab; no stored tokens). Re-run for any new repo. Freshness is a
   **human decision**: `yad repo list` shows fresh/stale, `yad repo refresh [name]` re-packs a moved repo
   (skills flag staleness and point here — they never silently re-pack). Greenfield → skip it.
6. **(Optional) Connect tools** so the matching steps do real work (each degrades gracefully and is
   recorded if absent): `yad-connect-design action: connect` (Figma-first → `design.json`, lets
   `yad-ui` materialize screens), `yad-connect-testing action: connect` (Playwright-first →
   `testing.json`, lets `yad-test-cases` implement automation), `yad-connect-learning action: connect`
   (DeepTutor-first → `learning.json`, powers the cross-cutting learning layer).
7. **(Optional) Put the hub on a platform** so the front-half review runs through real PRs:
   `yad-connect-repos action: detect-hub`, then `yad roster add <login>` once per reviewer (login →
   SDLC name + per-repo roles — the `add` walk asks for each connected repo's role; `yad roster grant`
   sets one directly), and `yad-pr-template repo:hub action: wire` /
   `yad-checks repo:hub action: wire`. With no hub platform the front gate runs file-only.
8. **Conventions:** commits and PR/MR titles follow Conventional Commits (lowercase after the type), the
   human author owns each commit with an optional per-commit `Co-Authored-By` AI trailer — see
   [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## A — Front half (human-authored, once per epic)

Each author step writes its artifact, sets itself `done`, moves `currentStep` to its review, and
**stops at the gate**. Run every gate with **`yad-review-gate`** — or, when the hub is on a platform,
drive it deterministically with the **`yad gate`** CLI (`open → sync → … → merge`): the review rides
the per-step PR/MR and the step **auto-advances on merge** once approvals are satisfied and all comment
threads are resolved. Details: **"Run the full front half by hand"** below.

0. *(optional, once per project)* `yad-discovery` → the discovery set (`market-research.md`,
   `competitor-analysis.md`, `current-state.md`, `feasibility.md`, `requirements.md`, `roadmap.md`)
   under the reserved `EP-discovery` → review (base rule) → `currentStep: discovery-done`. The whole
   set is required to review; its `roadmap.md` then frames each epic below (read once it is approved).
6. `yad-epic` → `epic.md` (assigns `EP-<slug>`, seeds state) → review (base rule).
7. `yad-architecture` → `architecture.md` + locked `contract.md` → review (**escalated**: contract).
8. `yad-ui` → `ui-design.md` + `DESIGN.md` → review (base rule).
9. `yad-stories` → repo-tagged `stories/EP-<slug>-S0N.md` → review (**per-repo**).
   → `state.json` reaches `currentStep: ready-for-build` — **the build half can start now.**
10. `yad-test-cases` → `test-cases.md` (+ automation tests when a testing tool is connected) → review (base rule).
    **Parallel, non-blocking:** opens when the stories gate passes and runs alongside the build half; its
    review never moves `currentStep` off `ready-for-build`.

## B — Build half (per story, per repo)

From a `ready-for-build` story, for **each** repo the story is tagged with. Details: **"Run the full
build half by hand"** below.

10. `yad-spec story:<id> repo:<repo>` → writes `specs/<story-id>/` (spec/plan/tasks + `link.md`).
11. `yad-implement story:<id> repo:<repo> task:<T0N>` → one atomic task = one branch = one commit
    (repeat per task). Commit by convention with **`yad commit --type <t> -m <subject> [--ai <tool>]`**
    (Task/Contract-Change/Co-Authored-By trailers, atomic-file guard).
12. `yad-checks repo:<repo> action: run` → spec-link, contract-check, build/test/lint, verified-commits
    (platform-Verified signature + roster-allowlisted author), and commit-message must pass. (The
    `pr-title` / `pr-template` gates need the PR title + body, so they run in CI once the PR exists —
    step 13.)
13. Open the PR/MR from the wired template with **`yad open-pr --repo <repo> [--risk <level>]`** (or do
    12+13 in one step with **`yad ship --type <t> -m <subject> --repo <repo>`**). The PR's CI now also
    runs the `pr-title` and `pr-template` gates; `yad-pr-template repo:<repo> action: route` prints the
    required reviewers from the Impact & Risk block.
14. `yad-engineer-review` → `ai-review` (advisory) → `approve` (the human engineer gate) → `ship` (merge,
    record in `build-log.json`, update story status to `in-build`/`shipped`).
    - **Multi-repo:** repeat 10–14 in each repo, all from the **one** locked contract.
    - **Existing code:** `yad-backfill` first, to produce a human-verified spec for a built feature.

## C — Automation (optional, earned over time)

15. After a back step accumulates trust evidence, earn it:
    `yad-run action: set-dial step:<step> to: machine_advance` (refused if evidence is short or for a
    front state / the engineer review).
16. Drive a story's back half on the dials: `yad-run story:<id> repo:<repo>` — it auto-advances
    earned steps and stops for a human otherwise, always halting at the engineer review.
17. **Kill switch any time:** `yad-run action: kill` (everything → manual) / `action: unkill`.
    Details: **"Run the back half on the dial"** below.

## Any time

- **`yad-status [EP-<slug>]`** — read-only: the front chain, each build step's dial + status, the
  trust record, and (across epics) the fleet roll-up. Start here to see what's blocking.

---

## Run the full front half by hand

Optionally preceded once per project by the **front-zero** — **`yad-discovery` → review →
`discovery-done`** — which frames the whole product (market, competitor, feasibility, requirements,
roadmap) under the reserved `EP-discovery`; its approved `roadmap.md` then feeds each epic. The front
half itself walks **epic → review → architecture+contract → review → UI design → review → stories
→ review → `ready-for-build`**, then **test cases → review** runs as a **parallel, non-blocking track**
alongside the build half. It is all files under `epics/EP-<slug>/`. The skills below guide you, but you
can also edit the files directly — that's the point.

Each authoring step is the same shape: an author skill produces an artifact, sets its step `done`,
moves `currentStep` to the matching review, and **stops at the gate**. Then **`yad-review-gate`**
(one gate, reused for all five reviews) takes `open → comment → approve → advance`. When the hub is on a
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
   `.sdlc/state.json` (all `human_approve`, front steps locked) + empty `.sdlc/approvals.json`.
2. **`yad-architecture`** (state 3) → `architecture.md` + the locked `contract.md`; writes the
   contract-surface SHA-256 to `.sdlc/contract-lock.json`.
3. **`yad-ui`** (state 5) → `ui-design.md` + `DESIGN.md` (drives Impeccable
   `document|extract|craft` slash-commands when installed; otherwise authors directly).
4. **`yad-stories`** (state 7) → one file per story `stories/EP-<slug>-S0N.md`, each tagged
   with the `repos` it implements.

### The one gate (every review)

Every review is the same loop — author writes, reviewers comment (which never advances), approvals
accumulate, and the step moves forward only when the rule is met. **File-only** ends in an explicit
`advance`; **PR-driven** (hub on a platform) ends when the approved, fully-resolved review PR is
**merged**:

<!-- Source: docs/diagrams/review-loop.mmd — edit the .mmd and run `npm run diagrams` to regenerate -->
![Review gate loop — author, open, comment, approve, advance](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/diagrams/review-loop.svg)

**File-only** — invoke **`yad-review-gate`** with `open` (present the artifact; reviewers comment in
`reviews/<artifact>--<date>--comments.md`), `approve` (name + role → `.sdlc/approvals.json`), and
`advance` (moves **only if** the rule is satisfied, else it names the missing approval).

**PR-driven** — when the hub is on a platform, the **`yad gate`** CLI runs the same gate over a PR/MR:
- `yad gate open <epic> <artifact>` — raise the review PR/MR; mark the step `in_review`.
- `yad gate sync <epic> [artifact]` — pull approvals + comment threads into the **same** ledger (your
  own `gh`/`glab`, no stored tokens) and **auto-advance on merge** once the rule is met and every thread
  is resolved. Approvals are **revoked when the reviewed artifact changes** (re-hash), so reviewers get
  a fresh pass. Unresolved comments hold the step `in_review`.
- `yad gate comments <epic>` fetches the open threads to address; `yad gate status <epic>` shows
  approvals (counting only the non-stale ones). The file ledger stays the source of truth; with no
  platform / no CLI it degrades to file-only.

**The gate rule, by review:**
- **Base** (epic, UI): `owner + 1 reviewer`.
- **Escalated** (architecture+contract — `risk_tags: ["contract"]`): base **plus a domain owner for
  every repo in `epic.repos`**. The contract-surface hash must still match `.sdlc/contract-lock.json`
  (a changed surface invalidates approvals).
- **Per-repo** (stories): base **plus a domain owner (the repo's engineer) for every repo that appears
  in any story's `repos`**.

### Check status anytime

Invoke **`yad-status`** (read-only) to see the full 10-step chain, every step's dials/status, the
contract lock, story repo tags, and which approvals the active gate still needs.

## Worked example (already in this repo)

`epics/EP-istifta-inquiries/` shows the **whole front half** walked end to end:
- `epic.md` authored + approved (epic gate, base rule) — 2026-06-04.
- `architecture.md` + `contract.md` authored; contract surface hash-locked in
  `.sdlc/contract-lock.json`. Architecture gate **escalated** (contract): owner *alice* + reviewer
  *bob* + domain owners *carol* (backend) and *dave* (mobile).
- `ui-design.md` + `DESIGN.md` authored (Impeccable not installed → graceful fallback). UI gate base
  rule (alice + bob).
- Five repo-tagged stories `stories/EP-istifta-inquiries-S01..S05.md`. Stories gate **per-repo**: base
  rule + a domain owner for each touched repo (carol/backend, dave/mobile).
- `state.json` now reads `currentStep: ready-for-build`, every front step `done` — the Phase 3
  handoff point.

Inspect it:
```bash
cat epics/EP-istifta-inquiries/.sdlc/state.json
cat epics/EP-istifta-inquiries/.sdlc/approvals.json
cat epics/EP-istifta-inquiries/.sdlc/contract-lock.json
ls  epics/EP-istifta-inquiries/reviews/
ls  epics/EP-istifta-inquiries/stories/
# re-verify the contract surface still matches its lock:
awk '/CONTRACT-SURFACE:BEGIN/{f=1;next} /CONTRACT-SURFACE:END/{f=0} f' \
  epics/EP-istifta-inquiries/contract.md | shasum -a 256
```

## Run the full build half by hand (Phase 3)

From a `ready-for-build` story, the **build half** turns one atomic task into shipped code through
gates that protect production. Per-repo specs live in each code repo; the contract stays singular in
the product repo. Code repos are **separate git repos** under `demo-repos/<repo>/` (gitignored;
`demo-repos/README.md` explains regeneration). **Nothing auto-advances** — every gate is human-owned.

> **Lost in the build half?** `yad next <epic>` reads each story's `build-state` and tells you the
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
   / **pr-template** (profile-aware `code`|`hub`, so they also run on the product hub). They fail closed
   on a bad base ref.
4. **PR/MR template + risk routing** — `yad-pr-template` drops the platform-matched template with an
   Impact & Risk block; `high` risk (or a contract/auth/payments surface) routes the review to domain
   owners (`risk-route.sh`), the same escalation as the gate.
5. **AI review → engineer review → merge** — `yad-engineer-review`: CodeRabbit is an advisory first pass
   (never the authority); a human engineer approves (owner + 1 reviewer, escalating to domain owners); on
   merge the ship is recorded in `.sdlc/build-log.json` and the story state becomes `in-build` →
   `shipped`. The epic → story → task → PR → mergeCommit chain is traceable both ways.

**Multi-repo:** a story tagged `repos: [backend, mobile]` runs the above in each repo independently from
the **one** locked contract; the contract-check blocks a surface bypass in either repo.

**Backfill existing code:** `yad-backfill` packs one feature with **Repomix** (`npx repomix`, secret-scan
by default), drafts an *unverified* spec ("describe what exists, do not invent"), a human approves it,
and `backfill-check.sh` blocks a change to that feature until its spec is approved — gated per touched
feature, never the whole repo.

The build half is walked end to end on the worked epic: story **S01** shipped (`status: shipped`,
three tasks in `build-log.json`), **S03** built across backend + mobile, and a `health` feature
backfilled. The code repos are regenerable from `demo-repos/README.md`.

## Run the back half on the dial (Phase 4 — automation, earned)

Phase 4 is **automation, earned with evidence and reversible in one move**. Phase 4a made the
`automation` dial real and earned the safest step (the check-gate advance); Phase 4b added the
`implement → check` hand-off and the `spec`/`tasks` trust hooks. The engine is `yad-run`; the
evidence lives in two new files per epic under `.sdlc/`: `build-state/<story-id>.json` (the back steps
with their dials, per repo) and `trust-log.json` (every run's verdict). See
`docs/phase-4-build-plan.md` and `docs/phase-4b-build-plan.md`.

- **Drive a story's back half:** `yad-run {story} {repo}` walks `spec → tasks → implement → checks`,
  reading each step's dial. On `machine_advance` it advances on its own; on `human_approve` it stops
  for a human; on any FAIL, scope overrun, or contract-surface touch it **halts and pulls in a human**.
  It always stops at the engineer review (`yad-engineer-review`), which is never automated.
- **Read the trust log:** `yad-status {epic}` shows each back step's dial, status, and trust record —
  runs, % `approved-unchanged`, and whether that clears the threshold (`automation.trust_threshold` in
  `config.yaml`, default ≥5 runs and ≥80% unchanged). The engineer review records each run's verdict
  (a diff merged as-authored is `approved-unchanged`; one edited first is `approved-with-edits`; a
  failed one is `rejected`).
- **Earn automation for a step:** once a step's trust record clears the threshold,
  `yad-run action: set-dial step: checks to: machine_advance` flips it. The setter **refuses** if the
  evidence is short, or for any front state / the engineer review. Reverting
  (`to: human_approve`) is always allowed — automation is reversible in one move.
- **Kill switch:** `yad-run action: kill` forces every step back to `human_approve` system-wide
  instantly (no code change, no per-step edits); `yad-run action: unkill` restores earned automation.

**Earned so far:** `checks` (Step B, Phase 4a) and `implement` (Step D, Phase 4b — the
`implement → check` hand-off; the scope/contract halts and the engineer review still gate the merge).
`tasks` (Step C) and `spec` have their dials + trust hooks but stay `human_approve` until their own
runs clear the threshold — there is no historical signal to seed them from, so they are earned only on
genuine runs (never fabricated). See `docs/phase-4b-build-plan.md`.

## What's intentionally NOT built yet

**Phase 4b Step C** (the remaining automation): `tasks` generation advance — gated until real
`tasks`/`spec` trust evidence accrues. The hook that records that evidence is built; the dial flips
only once the threshold is genuinely met. The scope guard and contract-surface halt always override
the dial, and **front states and the engineer review stay `human_approve`, permanently.**

**Phase 5 (conditional):** the optional service layer (watch repos, run earned-automation steps
unattended, read-only dashboards), built only when the CLI genuinely can't keep up, with git remaining
the source of truth. It is **trigger-gated** — `docs/phase-5-build-plan.md` is the build plan: its
three parts (read-index, unattended runner, dashboard) each ship only when *their* bottleneck is
measured, with the hard rules they inherit and the instrumentation (already shipped in `yad-status`)
that makes the decision data-driven. See also `docs/claude-code-build-plan.md` §8.
