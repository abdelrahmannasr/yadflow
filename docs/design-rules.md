# Design rules — Idea 1: The Agnostic, Configurable Engine

> **What this is:** the design record of the yadflow engine: the vocabulary, the change-safety
> rules, the people model, git discipline, context and the toolbox, the lifecycle spine, the skill
> orchestrator's design, the rules that never bend, and the closed decisions. Code comments and skills
> cite its parts by number, so the part numbers are kept.
>
> **Where the task list went (2026-11-16):** this file was `docs/roadmap-idea-1.md`. Its task tables —
> Part 6 (the waves) and the task table of Part 7 — moved to the maintainer's private issue tracker,
> which is now the source of truth for what is planned and what shipped. A row ID such as `E108` named
> in the code or the docs is that tracker's issue title. The old file, tables included, stays in git
> history: `git show 980bc42a:docs/roadmap-idea-1.md`.
>
> This is the outcome of a product brainstorming session. Everything here is a decision we made
> together, or a rule that follows from one.

---

## What this document is

When this plan was written, yadflow was a fixed pipeline built on top of BMAD (E3 has
since removed BMAD from the engine). This plan turns it into a
real engine: one that any team can shape to their own lifecycle, that drives AI
agents from the command line, and that a paid desktop app can later sit on top of.

It also sets the rule we follow for **every** change from now on: we never break a
project that already exists.

---

## The vision

> **Yad is the control room for engineers who build software with AI agents.**
>
> Every project gets a clear, visible lifecycle. New projects are guided from idea
> to product. Existing projects get order without being disturbed. One person or
> one team can run many projects at the same time, switch between them in one
> click, and never lose the thread.
>
> The engine is free and open. The control room is what you pay for.

**Business shape:** the engine (yadflow) stays free and MIT. The desktop app is
paid. The buyer is both solo engineers and teams, and a solo engineer must be able
to become a team without redoing anything.

---

# Part 1 — The vocabulary

Getting the words right comes before everything else. We must not build the engine
using words we are about to retire.

## The three parts

The old "front half / back half" retires. There are three parts, not two, because
there are three different rhythms.

| Part | Phases | Where | Rhythm | Question it answers |
|---|---|---|---|---|
| **Shape** | Discover · Design · Plan | The product | Once per epic | *What are we making, and why?* |
| **Build** | Build | Each code repo | Loops per story, per repo | *Make it.* |
| **Run** | Release · Operate | The product | Once per release, then forever | *It is live. Now what?* |

Run feeds back into Shape. That loop is what makes it a lifecycle instead of a line.

## The two levels

| Level | Runs | Contains |
|---|---|---|
| **Product** | Once, at the start | **Foundation** |
| **Feature** | Once per epic | The six phases above |

## Foundation (product level)

Runs once per product. Changeable later, versioned, gated.

| Step | Produces |
|---|---|
| Purpose | Why this exists, who for, what success looks like |
| Market | Who else does this, why us *(optional)* |
| Scope | What it is — **and explicitly what it is not** |
| MVP | The smallest thing worth shipping |
| Roadmap | The rough order after the MVP |
| Stack | Languages, frameworks, hosting, databases |
| Repos | How many, what each does, monorepo or separate |
| Risks | What could kill this *(optional)* |
| ▸ gate | One approval before feature work begins |

Greenfield authors it. Brownfield has it **drafted by the scanner** from real
evidence, then corrected. Its decisions are injected into every later step's
context automatically.

**Foundation already half-exists.** The code has a product-level "epic zero"
(`EP-discovery`, `epic-state.mjs:136`) with `roadmap.md`, the `yad-discovery`
skill and its own two-step chain. Foundation **absorbs** it: `roadmap.md` moves
into `foundation/`, `yad-discovery` becomes the Foundation authoring skill, and
`EP-discovery` is migrated, not kept beside it. Two product levels would be a bug.

**Shipped in E75** (file shape 8). `foundation/` is a top-level folder holding the sections AND the
ledger, under the fixed id `EP-foundation`. The sections are one file each; Market and Risks are
optional, as above. The gate's approval "before feature work begins" is **reported, not enforced** in
this release. `yad foundation new` seeds it; `yad-discovery` keeps its name and authors it. On a local
ledger `yad migrate` converts `EP-discovery` into it; on a verified ledger the gate bot converts it at the
next merged review its workflow handles, once the product level's own review has passed. The E75 row below records the decisions.

## The six phases

| # | Phase | Part | Steps |
|---|---|---|---|
| 1 | Discover | Shape | discovery · analysis · feasibility · epic · ▸gate |
| 2 | Design | Shape | architecture + contract · ▸gate · ui-design · ▸gate |
| 3 | Plan | Shape | stories · ▸gate · test-cases · ▸gate |
| 4 | Build | Build | spec · tasks · implement · checks · ▸gate |
| 5 | Release | Run | release notes · version · deploy record · ▸gate |
| 6 | Operate | Run | defects · feedback · retrospective · improvements |

Phases 5 and 6 do not exist yet. They are planned, not built.

## The work-item ladder

```
Product  →  Epic  →  Story  →  Task
```

No Initiative level. Grouping is a free `theme` tag on the Epic, which maps to a
Jira Initiative later if anyone needs it.

Plus a **type**, which fixes the old problem of calling everything an epic:

| Type | Meaning |
|---|---|
| `feature` | New value |
| `change` | Change to something already shipped |
| `defect` | Something is broken |
| `hotfix` | Broken and urgent |
| `chore` | Upkeep, no user-visible change |

## The two dials

Every step declares who does the work and who moves it forward.

| Dial | Values | Meaning |
|---|---|---|
| `driver` | `human` · `pair` · `agent` | Who does the work |
| `advance` | `human` · `auto` | Who moves it forward |

| driver | advance | Meaning |
|---|---|---|
| `human` | `human` | Fully manual, no AI |
| `pair` | `human` | Person and agent together, person approves |
| `agent` | `human` | The normal AI mode |
| `agent` | `auto` | Fully automatic |

Replaces the old `assistance` (`none`/`review`/`heavy`) and `automation`
(`human_approve`/`machine_advance`).

**One rule that never bends: a review gate can never be `auto`.**

## The two switches

Separate from the dials, every product has two independent switches.

```
mode:    solo | team          who must approve
ledger:  local | verified     who writes the record
```

| `ledger` | Who writes the ledger (`state.json`, `approvals.json`, …) | What guards it |
|---|---|---|
| **`local`** | Your machine. Works offline, no CI needed | Nothing. Honour system — and the engine says so |
| **`verified`** | **CI only**, with a platform-Verified signature. A local `gate open` is advisory and writes nothing | `ledger-guard` rejects any non-bot commit |

Any combination is valid. Solo + verified is a one-person team with a real audit
trail. Team + local is a team on the honour system — allowed, and the engine warns.

`verified` replaces the old name **"bridge mode"** (578 references). The old mode
named a mechanism; the new one names what you get, and it is the word the customer
sees on GitHub next to their own commits. The `bridge_enabled` field in `hub.json`
becomes `"ledger": "verified"` — a file-shape change, so it ships in v4 via
`yad migrate`.

## Step states

| State | Meaning | Must record |
|---|---|---|
| `todo` | Not started | — |
| `in-progress` | Being worked on | — |
| `done` | Completed here | The artifact |
| `skipped` | Consciously chose not to | Reason + person + date |
| `deferred` | Will do it, later | Reason + who waits |
| `satisfied` | Done elsewhere | Link + person + date |
| `blocked` | Cannot proceed, not our choice | Who or what we wait for |

Shipped in E38 as `STEP_STATES` (`cli/epic-state.mjs`), with two differences from this table, both
recorded there: the files spell the second one `in_progress`, and they carry an eighth word,
`in_review` — `in_progress` on a step that is a review gate. `blocked` used to be the spelling of
`todo`, and the two are told apart by whether a `record` is present, never by a shape number.

Plus a flag: `debt: true` — skipped under emergency, owed back, reminded until paid.

Every non-`done` state carries a `record` object on the step — `{ reason, by, date,
link? }` — because today `state.json` holds only `status` and has nowhere to put the
reason. That object is what makes the skip an audit trail instead of a hole.

**A recorded skip is not a hole in the audit trail. It IS the audit trail.**

## Other renames

| Old | New |
|---|---|
| front half / back half | Shape · Build · Run |
| front state | Shape step |
| hub | Product |
| bridge mode / file-only | `ledger: verified` / `ledger: local` |
| roster | *(deleted entirely)* |
| owner / reviewer / domain-owner | *(deleted entirely)* |

---

# Part 2 — The change-safety rules

Permanent policy. Applies to every change from now on.

1. **Every file states its shape.** `"schemaVersion": 1` on everything the engine
   writes. A file with no version counts as 1.
2. **Read old, write new.** The engine always reads old shapes and raises the
   version when it next writes.
3. **Add before you remove.** A release may add. It may never remove or rename in
   the same release. Removal takes three stages: add → `doctor` warns → remove in
   the next major.
4. **One real upgrade command.** `yad migrate` — preview, back up using the
   existing `.yad-orig` style, rewrite, report. Safe to run twice.
5. **Today's lifecycle is frozen as `classic`.** Existing projects keep behaving
   exactly as they do now, forever.
6. **A golden test that never changes.** A real v3 project, frozen. If it breaks,
   the change is wrong. No exceptions.
7. **File-shape changes wait for v4**, shipped together with the migration guide.
8. **No automatic releases while the engine is changing.** Today every push to
   `main` publishes to npm — even a docs commit (`docs → patch` in
   `.releaserc.json`). On 2026-09-03 two documentation merges published 3.17.1 and
   3.17.2 within an hour, with no human deciding either. Under that setup, the first
   Wave 2 PR to merge would ship a half-migrated engine to every `npx yad` user.
   So: releases move to a `release` branch that only a human fast-forwards, after a
   release check that runs the golden test, `yad migrate --preview`, `yad doctor`
   and a fresh `yad setup`. v4 ships on a `next` pre-release channel until
   `yad migrate` is proven; v3 users see nothing until then.

---

# Part 3 — The people model

We removed the roster completely. This is the replacement.

## The principle

> **Stop storing who people are. Compute it at the moment you need it.**

A stored list goes stale. A query never does.

- A roster is a **claim**. The platform record is **evidence**. For a governance
  product, evidence wins.
- **Repository access is the roster.** The platform already answers "who is
  allowed", and its answer is never out of date.
- CODEOWNERS is a **hint**, never an authority — in practice these files rot.

## What the gate actually needs

1. Did a human approve?
2. Was it someone other than the author?
3. Were there enough of them?

Nothing there needs a list in advance.

## Escalation, in three tiers

| Tier | Rule |
|---|---|
| **1 — by count** | `needed = base + risk_step`, capped at `active − 1`, floor of 1 in team mode |
| **2 — by proven history** | *"A payments change needs an approval from someone who has committed to `payments/**` in the last 30 days."* A live git query, nothing stored |
| **3 — asked at the moment** | Recorded as what happened on this change, not stored as a rule |

Risk steps: normal `+0` · high `+1` · contract surface `+2`.

Since E66, a Build PR also takes the high step when it touches a directory the code repo's
`.sdlc/risk-map` marks `high`, read from the base branch. A Shape step keeps its `risk_tags`.

Since E65, tier 2's paths are the directories a code repo's `.sdlc/risk-map` marks `high`.
`payments/**` above is an example of such a directory, not a tag. E66 and E67 read that map on the Build half, both
reported: E66 adds the `high` step to tier 1's count, E67 answers tier 2 by naming the people who have
worked in those directories lately. Since E72 tier 1's count is capped by the live count of people
(E71) and the cap is printed and recorded; only the base holds a gate. E73 warns when a gate may not
pass; E108 (parked) would enforce the capped count beside `yad gate lower --reason`, once the count is accurate.
The Build count stays reported — branch protection holds a Build merge.

**The cap is what stops deadlock.** The engine can never ask for more approvals
than there are people to give them — and it always says when it capped.

## Counting people

Three windows, because there are three different jobs.

| Purpose | Window | Shape |
|---|---|---|
| Expertise (tier 2) | 30 days | Fixed. Tight |
| Capacity (the cap) | Last 20 merged PRs, bounded 30–180 days | Adaptive to project pace |
| Gone / stale warning | 120 days | Fixed. Long |

"Active" = committed or approved within the window. When counting capacity, err
towards **more** people: undercounting weakens gates quietly, overcounting jams
them loudly, and we have an exit for jams.

## Never go quiet

```
⚠  This repo has no approval rules and no branch protection.
   Anyone with write access can merge anything.
   yad will record what happens, but it cannot stop anything here.
```

We stop keeping lists. We never stop telling the truth about what is protected.

Since E70, `yad doctor` prints these three sentences, on one line, in its `protection` section — only when both halves are
proven from what the platform answered. A read that fails says "not known", never "unprotected".

---

# Part 4 — Git discipline

**Humans write content. Only the engine writes git.**

| Layer | What it does |
|---|---|
| **Continuous capture** | Every change auto-saves to a private `yad/wip/<name>` branch and pushes often. Nothing is ever lost. Nobody types a git command |
| **Step-boundary commit** | At a step boundary it folds into ONE clean commit: `docs(EP-checkout): author architecture`. That is the atomic commit the record keeps |

Not one commit per keystroke — that would destroy the readable history that is our
whole product.

## Avoiding collisions

| Layer | Covers | How |
|---|---|---|
| **1 — data shape** | ~90% | One small file per writer, as the ledger already does. Two people writing at once touch different files |
| **2 — advisory claims** | Most of the rest | *"architecture.md — claimed by alice, 10:04."* **Advice, not a lock.** With no server a real lock is impossible |
| **3 — merge on the way in** | The remainder | Pull and replay. Only prose can conflict, and then a human sees it |

Stronger than a lock: **assign a step to one person.** Since E47 that is `yad assign <epic> <step>` — still advice, but decided in advance, shown by `yad next` and warned about at edit time.

## Enforcement

| Layer | Strength |
|---|---|
| Local git hook | Weak — bypassable, fails open. Since E48, a `pre-commit` hook that refuses a hand commit to the CI-owned ledger and names the command to use |
| Platform branch protection | **Strong — this is the real enforcement** |
| `ledger-guard` in CI | Strong — already built |

**The escape hatch is mandatory:** `yad commit --manual --reason "..."`, recorded
as an override. A lock with no door makes people panic and uninstall. Built in E49: the reason is a
`Ledger-Override:` trailer on the commit, and the CI check still fails the commit and quotes it.

## Who writes what

"Only the engine writes git" and "only the bot writes the ledger" sound like they
collide. They do not, because there are two kinds of file:

| Kind | Examples | Who writes it |
|---|---|---|
| **Artifacts** | `epic.md`, `architecture.md`, `stories/*.md` | The engine on your laptop — always, in both ledger modes. This is what the WIP branch and the fold commit are for |
| **Ledger** | `state.json`, `approvals.json`, `comments.json` | **Follows `ledger`.** `local`: your machine. `verified`: CI only, with a Verified signature — exactly what `gate.mjs:807` does today |

So the WIP capture (E43) and the step-boundary fold (E44) are scoped to
**artifacts**. In `verified` mode the ledger update rides the PR and CI records
it. This is not a new design; the plan just never said it.

## Three things the capture must handle

| Case | Rule |
|---|---|
| **CI on WIP branches** | `yad/wip/*` is excluded from CI triggers, and `yad setup` writes the exclusion. Otherwise every save burns CI minutes — the exact thing this plan promises to save |
| **Solo with no remote** | A local-only repo commits locally, says so, and never fails |
| **Windows** | First-class from Wave 3 onward. Background capture, file claims and spawning agent CLIs all behave differently there, and a paid desktop app must run on it. Until then, WSL only, stated plainly in the README. **E113 (2026-09-27):** the agent hooks run natively, and the CLI code they reach is fixed for Windows, proved by a Windows CI job; the rest of the CLI, the full suite and the e2e harness are not tested there yet |

---

# Part 5 — Context and the toolbox

## Context in three levels

**No single mega-pack of all repos.** The customer pays for every token.

| Level | What | Size | Used by |
|---|---|---|---|
| **1 — the map** | Every repo's purpose, modules, endpoints, events, models | A few KB, always included | Everything |
| **2 — the pack** | Full Repomix, only for repos this step touches | Large, on demand | Architecture, spec |
| **3 — the files** | The specific files the task declared | Small, on demand | Implement |

> **Read wide once, to build the map. Read narrow every time after.**

A full sweep is justified for the brownfield scanner and for drafting Foundation —
done once, keeping a small summary. Not for every step of every day.

The map is built by `yad repo refresh` (which already exists) and tracks its own
staleness by commit sha. `yad doctor` warns when it is behind.

## The toolbox

External tools are **declared, detected and offered** — never hard dependencies.

> **No external tool is ever mandatory. Every one declares a fallback.
> yadflow degrades, it never breaks.**

Checked 2026-09-03. All actively maintained, all licences safe for commercial use.

### Core — offered at setup

| Tool | Licence | Install | Without it |
|---|---|---|---|
| **repomix** | MIT | npm `repomix` / Claude plugin | Context put together by hand; the code map |
| **spec-kit** | MIT | Python / `uv` | yad writes the spec files by hand |
| **impeccable** | Apache-2.0 | Claude plugin | Markdown-only UI design |

### Recommended — in the catalogue, never pushed

These are the pools the engine draws from when it builds skills and agents for a
step. They are raw material, not requirements — see Part 7.

| Tool | Licence | Install | Note |
|---|---|---|---|
| **BMAD-METHOD** | MIT | npm `bmad-method` / Claude plugin | Leaves the engine as a dependency, returns as a choice |
| **ECC** | MIT | own `install.sh` / Claude plugin | **Not** npm `ecc` — see below |
| **mattpocock/skills** | MIT | Claude plugin | Only 4 contributors — fine optional, risky as a default |
| **DeepTutor** | Apache-2.0 | Python | Belongs with the learning ledger, not the build lifecycle |

### Two findings from the check

- **`npm ecc` is the wrong package.** It is an unrelated elliptic-curve crypto
  library at v0.0.2 (`siddMahen/ecc.js`), not `affaan-m/ECC` v2.2.0. **Every install command in
  the manifest must be verified against the real repo, never guessed from a name.**
- **Five of seven ship a `.claude-plugin`.** Most are plugin-marketplace installs,
  not package-manager installs. The manifest needs an `installType`:
  `plugin` | `npm` | `python` | `script`.

Built in E84 as `cli/toolbox.mjs`, read by `yad toolbox list`. It also lists the design, testing and
learning connectors, and every install command in it was re-checked against the tool's own repository
on 2026-10-01. E86 added the team's choices: `.sdlc/toolbox.json` in the Product, written by
`yad toolbox add` / `remove`, and read by `yad toolbox check`. E87 made every skill that uses a tool say, in a **When a tool is missing** section
quoted from the toolbox, when it uses the tool and what it does without it — asking `yad toolbox list --json`
rather than guessing, and following the team's `skip`.
E52 named the pools' skills: `yad skill recommend` lists, for each step, a few hand-picked skills from
these pools with the reason each fits, each vetted the E88 way, in a list with its own version
(`cli/recommend.mjs`). It binds nothing; the suggested chain runs the pool skill before yadflow's own.

## The lifecycle spine

**Decided with the user, 2026-10-03 and 2026-10-13. E134 is built (the default ships as `cli/lifecycle/defaults/1.json`); rows E135–E144 below are not.**

Today the lifecycle is fixed in code: the phases, the steps and the routes live in `cli/epic-state.mjs`
(`PHASES`, `PRODUCT_PHASES`, `STEPS`, `LIFECYCLE_PROFILES`, and the Build order `BUILD_STEP_ORDER`).
`skills/sdlc/config.yaml` repeats them, and a test holds the phases, their steps and the route ids equal.
A team can choose a route for each epic (`classic`, `analysis-first`, `chore`, `spike`), skip or defer the
optional `ui-design` pair, and choose skills (`yad skill bind`). It cannot add, remove or change a step or
a phase.

The spine moves the lifecycle into **one versioned JSON definition**. yadflow ships the default. A team
may add, remove and change steps and phases, and a plugin may bring steps of its own. Every part of the
engine reads the definition instead of a list in code.

### The decisions

| # | Decision |
|---|---|
| 1 | **Steps are one flat list**, and each step names its phase. A phase says whether it runs **once** or in a **loop** (`runs`, and `over` for a loop: Build loops over `story` × `repo`). |
| 2 | **Mandatory or optional:** a step's `optional` is its default on every route, and a route may override it for itself. The route wins. It is always one field, `optional`; there is never a `required` field that could disagree with it. |
| 3 | **A gate is a property of a step:** `gate: { riskTags }` makes the engine add the review step `<id>-review`; `gate: null` means no gate. A gate is never automatic (Part 8, rule 1). A `kind: "review"` step is a gate on its own (`engineer-review`). |
| 4 | **Skills:** each step names one skill or a chain (`skills`), and a route may bind its own (`bindings`). Bindings move here from `.sdlc/skills.json`, which is still read for one major and then removed. |
| 5 | **The team file is the full definition:** `.sdlc/lifecycle.json` in the Product, recording which default it was copied from (`extends: "yadflow-default@<n>"`). No team file means the shipped default. yadflow ships every past default, so **`yad lifecycle upgrade`** can compare three versions: the old default, the team's file and the new default. It takes each upstream change the team did not touch, and lists every real conflict for a person to decide. |
| 6 | **Change built-in steps, never break them:** some steps carry an engine **behaviour** (below). A team may rename, re-skill, move or make optional such a step, but cannot remove one while a route still needs what it does. |
| 7 | **Shape steps without a gate** are in scope (the Build steps before `engineer-review` have none already): one finishes when its artifact is committed (`yad fold`) or with `yad step done`. |
| 8 | **Teams may add steps inside the Build loop.** The loop's order is a route (`lane`), not a list in code. |
| 9 | **Plugins** ship a lifecycle fragment — steps, skills and where they come from — that a team adds with one command. |
| 10 | **Changing one epic's chain** (E54) stays a separate, later row under `yad skip`'s ledger rules. |

A change to the lifecycle affects **new epics only**: an epic's `state.json` copies its chain when it is
created, and what an epic's own file says wins over the definition (rule 3 of the change-safety rules:
the file wins).

### The schema, version 1

| Level | Fields |
|---|---|
| File | `schemaVersion` (the project's shape stamp), `extends`, `phases`, `steps`, `routes`, `plugins` |
| Phase | `id`, `name`, `description?`, `part` (Shape, Build, Run; none for Foundation), `level` (product, feature), `runs` (once, loop), `over` (for a loop; free words such as `story`, `repo`, later `release`), `built` |
| Step | `id`, `name`, `description?`, `phase`, `kind` (author, review), `artifact` (`{ type: file \| folder \| set, path, … }` or null; a `set` adds `files` and `optional`; `in: product \| repo` is reserved), `optional`, `gate` (`{ riskTags, skills? }`; must be null on a `review` step), `skills`, `behaviours`, `extraPaths`, `inputs`, `retired`, `replaces`, `provider` |
| Route | `id` (never renamed), `name`, `description?`, `steps` (author steps and standalone review steps, or `{ id, optional }`; the engine adds each gate's `<id>-review` itself), `bindings`, `retired`, `provider`. A route has no `level` field: it is worked out from its steps' phases. The `lane` route is the one whose steps sit in the Build loop phase. |

**Behaviours** are the engine's own, never invented by a team: `work-item-source` (epic), `locks-contract`
(architecture), `ends-shape` (stories), `parallel-with-build` (test-cases), `product-level` (foundation, and the retired discovery),
`spec-source`, `code-change`, `ci-gates`, `merge-gate` (Build). The engine keeps the list of them (the
behaviour registry). A Shape or Foundation behaviour fixes its step's artifact name, because the CI
checks read those files by name, and its step must keep its gate, except `parallel-with-build`, whose
step may drop it.
A Build behaviour's step writes code in a repo, so it has no artifact name to fix; `merge-gate` must stay a
`review` step. Each behaviour also has a rule about routes: for example, every feature route through Shape
has exactly one `ends-shape` step (the `lane` route, which runs in Build, has none).

**The validator's rules** (the hand-written check every file passes before it is used):

- A step id is lower-case letters, digits and dashes (`^[a-z][a-z0-9-]*$`). It does not end in `-review`
  (that suffix belongs to gates), does not look like a story (`-S01`), and is not a marker word the engine
  uses for an epic's state, such as `ready-for-build`.
- No two steps share an artifact name. A review branch is found by its artifact's name, so two steps with
  the same name would silently share one gate.
- An artifact name fixed by a behaviour cannot change.
- A behaviour's gate rule holds: a Shape or Foundation behaviour's step keeps its gate (except
  `parallel-with-build`), and `merge-gate` stays a `review` step.
- A behaviour's route rule holds: for example, every feature route through Shape has exactly one
  `ends-shape` step, and a product route has exactly one `product-level` step.
- **Unknown values do not break an older yadflow:** an unknown key is kept, and a step with an unknown
  behaviour, kind or artifact type cannot be used for new epics, while the rest of the file still loads.

The default, written out for the Shape part (`jsonc` is JSON that allows `//` comments):

```jsonc
{
  "schemaVersion": 10,
  "extends": "yadflow-default@1",
  "phases": [
    { "id": "discover", "name": "Discover", "part": "Shape", "level": "feature", "runs": "once", "built": true },
    { "id": "design",   "name": "Design",   "part": "Shape", "level": "feature", "runs": "once", "built": true },
    { "id": "plan",     "name": "Plan",     "part": "Shape", "level": "feature", "runs": "once", "built": true }
  ],
  "steps": [
    { "id": "epic", "name": "Epic", "phase": "discover", "kind": "author",
      "artifact": { "type": "file", "path": "epic.md" }, "optional": false,
      "gate": { "riskTags": [] }, "skills": ["yad-epic"], "behaviours": ["work-item-source"], "inputs": ["analysis"],
      "provider": { "id": "yadflow", "version": 1, "origin": "epic" } },
    { "id": "architecture", "name": "Architecture", "phase": "design", "kind": "author",
      "artifact": { "type": "file", "path": "architecture.md" }, "optional": false,
      "gate": { "riskTags": ["contract"] }, "skills": ["yad-architecture"], "behaviours": ["locks-contract"], "inputs": ["epic"],
      "provider": { "id": "yadflow", "version": 1, "origin": "architecture" } }
    // … analysis, ui-design, stories (ends-shape), test-cases (parallel-with-build), the Build steps,
    //   and the Foundation, in the same form
  ],
  "routes": [
    { "id": "classic", "name": "the 10-step chain",
      "steps": ["epic", "architecture", { "id": "ui-design", "optional": true }, "stories", "test-cases"] },
    { "id": "chore", "name": "the upkeep lane", "steps": ["epic", "stories"] },
    { "id": "lane", "name": "the Build lane",
      "steps": ["spec", "tasks", "implement", "checks", "engineer-review"] }
    // … analysis-first, spike, foundation, and discovery (retired: true), in the same form
  ]
}
```

The schema was reviewed by a second model (2026-10-13). Its changes were taken: one version key
(`schemaVersion`), the gate's tags on the gate (`gate.riskTags`), a standalone `review` kind for
`engineer-review`, the Build order as a route, no `level` on a route, one word for "still read, never
seeded" (`retired`), `replaces` for a renamed step, `bindings` for a route's skills, no field until
something reads it (`template`, `brief` and `gate.persona` wait for E143), and the unknown-value rule
above. **One was not:** it advised keeping `optional` on routes only, and the user kept a step default
that a route may override (decision 2), so a step can be optional everywhere with one change.

### The upgrade merge (E141)

Each yadflow step is matched by `provider.origin` (the step's original id), so a team's rename is not a
removal; a step with no origin is matched by its `id`. For each field: the team changed nothing → take the
new default; the default changed nothing → keep the team's; both made the same change → nothing to do;
anything else is a conflict. `behaviours` and `riskTags` merge as sets, item by item. A route's step list is
merged as edits (remove, insert after, move after). The merged file must pass the validator. Any conflict
writes nothing, exits 1, and prints `path | old default | team | new default`; `--take <path>=team|default`
settles it. (The plan's working names were `ours` and `theirs`; `team` and `default` were chosen because
they say whose change it is.)

### What stays in code on purpose

- The route list as it stood at file shape 6 (the format that first recorded each epic's route), and
  every migration: they describe the past, so they read the first shipped default, never a team's file.
- The marker words an epic's state can hold instead of a step (`SENTINELS` in the code:
  `ready-for-build`, `backfill-pending`…).
- The `-review` suffix, and rule 1 (a gate is never automatic).
- What each behaviour does, and the artifact names behaviours fix.
- Threading inheritance (what a change-epic carries from its parent).
- The golden fixture: a frozen v3 project that every release must still read the same way.

## The workspace

Two ways in, one way to join — identical for greenfield and brownfield.

```
yad new <name>      # greenfield: create the workspace and product repo
yad init            # brownfield: connect repos that already exist
yad join <url>      # anyone else: clone everything
```

```
my-product/
  .yad-workspace.json     <- ties them together
  product/                <- goals, epics, decisions
  backend/
  frontend/
  dashboard/
```

Partial clone failures never fail the whole join. The engine detects when a member
is missing a repo the registry has, and offers to fetch it.

Built in E79: `new` and `init` are front doors over `yad setup`, `new` creates no remote (it prints the
`gh`/`glab` line), and `join` clones then does per-machine steps only. Built in E80: all three write
`.yad-workspace.json` (just the Product folder's name, per machine), and Product commands find the
Product from inside any repo it registers.

## MCP

Three places, none dropped:

| Where | What |
|---|---|
| yad **speaks** MCP | Agents talk to the engine in normal language |
| yad **reads** your MCP servers | Detect and use what you already have |
| Tools connect **over** MCP | Design tools already do this |

MCP ships **after** the JSON contract, so we never maintain two shapes of the same
answers.

---

# Part 6 — The waves

Moved to the private issue tracker (see the note at the top). It held the task rows E1–E186, their
sizes and what each one needs, the estimate, the v4.0 cut line, and where the risk sat.

---

# Part 7 — The skill orchestrator (companion package)

A **separate package**, built after Wave 2. Yadflow uses it; it does not need
yadflow.

## The problem it solves

People now install skill collections holding dozens of skills each. Install three
and the agent is choosing between several hundred descriptions, which makes
selection worse, not better.

The value is **not** "we pick a better skill than the model can."

> **Narrow several hundred candidates down to three good ones, with the reasons
> shown, so the model chooses well and cheaply.**

## Why a separate package

| Factor | Answer |
|---|---|
| **More users** | Its audience is every Claude Code / Codex / Cursor user, not only teams who want a governed lifecycle. It is useful in 30 seconds with no process change. Yadflow has 0 stars and 0 dependents; this is the cheapest way to fix that |
| **Accuracy** | Accuracy comes from **how rich the input is**, not from where the code lives. Yadflow's context builder (E24) produces a full brief — goal, inputs, output shape, done-rule, constraints, budget — so a separate package is just as accurate |

## The boundary

| Side | Owns | Knows nothing about |
|---|---|---|
| **Orchestrator** | Finding skills · reading metadata · deduplicating · ranking · cost estimates · a shortlist **with reasons** | SDLC, phases, gates, epics |
| **Yadflow** | Steps, phases, gates, Foundation, repo map · **building the brief** · what to do with the shortlist | How skills are ranked |

**The orchestrator recommends only. It never runs anything.** Running belongs to the
session runner (E25).

## Positioning: lead with cost, not quality

| Claim | Verdict |
|---|---|
| "We pick the best skill" | Unprovable, invites argument |
| "This took 8,000 tokens instead of 60,000" | **Measurable. Nobody argues with a number** |

Cost lines up with everything else here — the three-level context, the precise
prompt builder, local checks that save CI minutes.

## Where the evidence comes from

**The audit trail is the training data.** Nothing extra to instrument.

Quality is measured as **rework distance** — how much the human changed it — never
by asking anyone to rate anything.

| Outcome | Meaning |
|---|---|
| Approved, no edits | Excellent |
| Approved, small edits | Good |
| Approved after heavy rewriting | Poor — cost more than it saved |
| Rejected at the gate | Bad fit |
| **Regenerated without review** | The strongest negative signal of all |

Each run records **shape only** — step kind, skill, version, cost, outcome, rework
lines, brief size. No content, no names, no repo, no code.

## Three stages of evidence

| Stage | Source | Available |
|---|---|---|
| **1 — Static fit** | Does the skill's output match the step? Does it need a missing tool? How big is it? | **Day one, zero data.** This alone cuts 300 candidates to about 10 — which was the whole point |
| **2 — Our benchmark** | We run fixed briefs against popular skills on our machines, at our cost, and ship the results | Shipped with the package. A download, never an upload |
| **3 — Their history** | The user's own runs, on their stack, judged by their reviewers | Grows over time, **overrides both** |

> **Ours is the starting point. Theirs is the truth.**

## Three tiers of user — and the funnel

Outside yadflow the ranker still learns, because **a commit is a gate**:
commit-or-discard, edit distance before committing, and regeneration are all
visible in plain git.

| Tier | Evidence | Quality |
|---|---|---|
| No git | Static fit + benchmark | Useful, never improves |
| **Git, no yadflow** | + commit-derived rework | Improves on its own. Noisy |
| **Yadflow** | + gate-verified rework | Clean — a named human approved it |

> **Yadflow makes the ranker better by giving it a truer signal, not by withholding
> features.** An honest funnel: the free tool is genuinely good, the paid path is
> genuinely better, and the reason is true.

## Keeping the benchmark honest

- Ships as a **separately versioned data file** — refreshes without a package release
- **Re-runs when a skill publishes a new version**, not on a blind schedule (cheaper
  and more accurate — an unchanged skill needs no re-measuring)
- **Always states its own age** and flags skills that have moved since
- **The method and briefs are published** so anyone can re-run and check them
- Running it is a real recurring cost, paid by us in tokens. Tier it: popular skills
  often, the long tail rarely

## Four traps

| Trap | Guard |
|---|---|
| Small numbers lie | No recommendation below a minimum run count. *"Not enough data yet"* is a valid, trust-building answer |
| Confounding — a skill drew the hard steps | Only compare within the same step kind |
| Our benchmark will favour our own skills | Publish the method. A benchmark nobody can check is marketing |
| Rework may be the brief's fault, not the skill's | Record brief size too, so a bad brief shows up across every skill |

## Risks

| Risk | Response |
|---|---|
| Skill descriptions are marketing copy | Rank on measured evidence, not only on descriptions |
| No ground truth for "best" | Which is why cost is the headline |
| Built on someone else's moving surface | Keep the adapter thin; assume it breaks yearly |
| Two products, one small team | Sequence them. Never run both roadmaps at once |
| A harness vendor builds it in | **Cross-harness neutrality is the moat.** Claude Code will never rank Codex's skills |

The orchestrator's task rows (E89–E103) moved to the private issue tracker with the rest of the
task list.

---

# Part 8 — Rules that never bend

Everything in this plan is negotiable except these.

1. **A review gate can never be `auto`.** A human clears every gate. This is what
   the product *is*.
2. **A review gate cannot be skipped on its own.** Skipping a step skips its gate
   with it; you cannot keep the step and drop the approval.
3. **An unattended agent may write artifacts and code. It may never pass a gate.**
4. **A generated skill must be approved by a human before it is bound.** We sell
   governance; we cannot let an AI write its own instructions unwatched.
5. **You may skip authoring a contract. You may never skip having one.**
6. **The engine never goes quiet about what is unprotected.**
7. **There is always an escape hatch, and it is always recorded.**
8. **One privacy promise, across every product we ship: nothing ever leaves your
   machine.** No telemetry, no opt-in sharing, no exceptions. A sentence you can
   say in four seconds and never have to qualify is worth more than better data.
9. **The ledger is written by one trusted identity only.** In `verified` mode that
   is the CI bot with a platform-Verified signature. If that ever changes, it
   changes by design, not by accident.
10. **A release is a human decision.** Nothing reaches `yadflow@latest` unless a
    person fast-forwards `release` after the release check passes. A robot may
    build, test and tag; it may not decide that users get a new version.

---

# Part 9 — Closed decisions

Every question that was open when this plan was written, and how it was closed.
There are no open questions left.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Which engine features stay free? | **All of them.** The app is the only paid thing | MIT cannot hide features. A crippled free tier makes people distrust a governance tool. The multi-project view is not withheld — it simply does not belong in a per-project CLI |
| 2 | Does MIT stay on the engine? | **Yes, permanently.** Say so in the README | The engine is not the moat; the control room, the benchmark data and the cross-harness orchestrator are — and all three are work, not secrets. Companies that tightened an open licence lost trust and got forked within weeks |
| 3 | How does a serverless app check who paid? | **A signed offline licence file.** See below | Matches the privacy promise: not even a licence check leaves the machine |
| 4 | Price and plan shape | **Per person, per month, one plan.** No per-project pricing. The number is set after the first ten real conversations with users | Charging per project punishes the exact behaviour we sell. There is no willingness-to-pay data yet, and a guessed number is worse than a delayed one. Price it as a professional tool, not a consumer app |
| 5 | How do we get the first users? | **Orchestrator-first funnel.** Ship E29, then the free orchestrator, which mentions yadflow once and quietly. Talk to every early user personally | A tiny tool useful in 30 seconds reaches a hundred times more people than a governed lifecycle does. The one engaged contributor is worth more than a thousand stars |
| 6 | Do we ever measure adoption? | **Never.** Public signals only — npm, GitHub issues, stars | Closed by rule 8. A floor is enough to know whether we are growing |
| 7 | Chain or panel for multi-skill steps? | **Chain only.** One skill per step by default; extras opt-in with a cost warning. Panel deferred, maybe forever | Chain has a clear winner (the last output). Panel needs a picking step — a human reading three architectures, or an AI judge nobody should trust in a governance tool |
| 8 | The engine/app boundary | **`--json` (E1) and MCP (E2). Nothing else.** No private API | If the app uses the same door as everyone else, the door stays honest and we feel every gap ourselves. Anyone may build a competing app on the engine — that is what MIT means |

## The licence check, in detail

**Signed offline file. No hardware lock. Read-only on expiry, never locked.**

| Layer | How | Why it works |
|---|---|---|
| **The name on the file** | The file carries the buyer's name and email, signed with our key. The app shows it always: *"Licensed to Alice Chen · 5 seats · until 2027-09"* | Sharing the file means sharing your name. This is the Sublime Text model, and it deters better than any hardware lock with zero false positives and zero support tickets |
| **Seats, shown not enforced** | The file says `seats: 5`. The ledger already records every approver. `yad doctor` warns *on their own machine* when the ledger shows more distinct people than the licence covers | Companies fix this themselves because their own compliance team sees it. A warning inside their own audit trail beats a lock, and nothing leaves the machine |
| **Short renewals** | A 12-month file. A copied file expires like any other | The natural limit |
| **Read-only on expiry** | The app keeps working for reading; editing asks you to renew | A pirate with an expired copy sees a helpful tool that asks nicely — some convert. A locked app converts nobody. Locking anyone out of their own audit trail would end our reputation in one post |

**What we deliberately do not do, and why:**

| Not this | Because |
|---|---|
| MAC address or any hardware fingerprint | A MAC belongs to a network card, not a machine — laptops have several, macOS and Windows randomise it, VMs fake it, and it is changed with one command. It fails only the honest, and it would require a device identifier to leave the machine at purchase, breaking rule 8 at the exact moment the customer decides whether to trust us |
| Online activation or phone-home | Needs a server. Breaks the offline promise and rule 8 |
| Locking the app | See above |

Piracy of professional B2B tools is small and is not stopped by DRM. Companies pay
for the invoice, the compliance record and the support contact — none of which come
with a copied file. The goal is not to make copying impossible; it is to make paying
the obvious, respectable choice and copying slightly embarrassing.

---

# Appendix — What got smaller

Four decisions in this session **removed** work rather than adding it:

| Decision | Effect |
|---|---|
| Remove earned automation | Deletes trust thresholds, earn checks, nudge reporting |
| `required` moves to the profile | Deletes `SKIPPABLE_STEPS`. Shipped as `optional` on the profile row (E35), not a new field |
| Read CODEOWNERS, do not duplicate | Deletes `repos.json` `domain_owners` and its drift check |
| **Remove the roster entirely** | Deletes `roster.mjs`, the setup section, the sync logic, and the allowlist half of `verified-commits.sh` |

And two decisions removed the need for new work: the `driver`/`advance` dials
already covered the "who contributes" model, and Foundation reuses one artifact
for both greenfield and brownfield.

**The engine gets simpler and more capable at the same time.** That is the sign
this plan is going the right way.
