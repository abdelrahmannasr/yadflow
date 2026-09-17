# Roadmap — Idea 1: The Agnostic, Configurable Engine

> **Status:** agreed plan, not yet built. Written 2026-09-03, reviewed against the
> code the same day (14 findings folded in).
> This is the outcome of a product brainstorming session. Everything here is a
> decision we made together, or a task that follows from one.

---

## What this document is

Yadflow today is a fixed pipeline built on top of BMAD. This plan turns it into a
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

Stronger than a lock: **assign a step to one person.**

## Enforcement

| Layer | Strength |
|---|---|
| Local git hook | Weak — bypassable, fails open. A friendly warning |
| Platform branch protection | **Strong — this is the real enforcement** |
| `ledger-guard` in CI | Strong — already built |

**The escape hatch is mandatory:** `yad commit --manual --reason "..."`, recorded
as an override. A lock with no door makes people panic and uninstall.

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
| **Windows** | First-class from Wave 3 onward. Background capture, file claims and spawning agent CLIs all behave differently there, and a paid desktop app must run on it. Until then, WSL only, stated plainly in the README |

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
| **repomix** | MIT | npm `repomix` / Claude plugin | Code map only |
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

Sizes are relative: **S** < **M** < **L**. See *The estimate* below for what they cost.

## Wave 0 — Ships alone

| ID | Task | Size | Needs |
|---|---|---|---|
| E29 | Replace the istifta example with `EP-checkout` (~730 places) | M | — |

## Wave 1 — The safety floor

| ID | Task | Size | Needs |
|---|---|---|---|
| **E105** | **Turn off auto-release** — `.releaserc.json` branches → `["release"]`; drop the `docs → patch` rule; `main` no longer publishes. **Before any other Wave 1 work** | S | — |
| **E15** | **Freeze a real project as the golden compatibility test — before anything else is touched** | S | E105 |
| E13 | `schemaVersion` on every file — **19 file kinds** in `manifest.mjs`: state, approvals, comments, hub-prs, contract-lock, build-log, trust-log, change, reconcile-debt, hub, repos, design, testing, learning, docs, managed, cli-version, plus two shard folders | M | E15 |
| E14 | `yad migrate` — preview, back up, rewrite, report, re-runnable | M | E13 |
| E16 | `yad doctor` reports shape drift and points at migrate | S | E13 |
| E106 | Release check — `scripts/release-check.sh` + a workflow on the `release` branch: tests, coverage, the golden test, `yad migrate --preview` on the golden project, `yad doctor` on a clean v3 install, a fresh `npx yad setup`, and a CHANGELOG migration note when a shape changed. Semantic-release runs only after it passes | M | E15 + E14 + E16 |
| E107 | `next` pre-release channel — `{ "name": "next", "prerelease": true }` so v4 publishes as `yadflow@next` while `latest` stays 3.x; `update-notice.mjs` warns v3 users to run `yad migrate --preview` before upgrading | S | E106 |

E105 comes first because nothing else in this plan is safe to merge until the
robot is off. E15 comes next on purpose: the golden test freezes *today's* behaviour. Stamp the
files first and you have frozen already-changed files.

## Wave 2 — The engine owns the lifecycle

### 2a — Vocabulary first

| ID | Task | Size | Needs |
|---|---|---|---|
| E21 | The work-item ladder and `type` | M | E13 |
| E31 | `theme` tag on the Epic | S | E21 |
| E22 | The six phases | S | E21 |
| E56 | Rename to Shape · Build · Run; `front state` → Shape step (~688 places) | M | E13 |
| E28 | Rename the dials to `driver` / `advance` | S | E13 |
| E30 | `hub` → `Product` | M | E13 |
| E104 | Rename bridge → `ledger: verified` / `local` (578 references); `bridge_enabled` → `ledger` via migrate | M | E13 |

### 2b — Structure

| ID | Task | Size | Needs |
|---|---|---|---|
| E4 | The step catalogue, validated in code not prose | M | E22 |
| E5 | Profiles; today's chain ships as `classic` | M | E4 |
| **E17** | **The engine seeds the lifecycle** — new `yad epic new <slug> --type --profile` writes `state.json` from the profile | L | E5 |
| E17b | Rewrite the skills that hand-write `state.json` to call the engine instead. **13 write sites in 9 skills**, not 29 — 29 is how many files mention the file, most of them to say they never touch it. Done: 3 seeds and 6 author-step advances, plus the `yad-discovery` product seed (E75 gave it `yad foundation new`). The `yad-change` threaded seed followed in E42. Left: `yad-backfill promote`, and `yad-review-gate`'s local advance, which has no engine verb because `gate sync`/`ci` both need a platform | M | E17 |
| E6 | Skill binding leaves the code, allows multiple skills per step. **The catalogue keeps its `skill` column as the shipped default**; `.sdlc/skills.json` overrides it per step, written by `yad skill bind` / read by `yad next` (Shape, Build lanes and both orientation lines), `yad epic new`, `yad setup` and the `yad-run` orchestrator. Several skills are a chain (decision 7) with a cost warning. No file shape moved — the binding file is new, not a changed one. Left to E51: a per-profile layer between the project's file and the catalogue, once E50 can detect installed skills | M | E4 |
| E7 | Gate rules per step — **people-free by design**: base + risk step only, never a name or a role. The capacity cap arrives in E72. **Shipped as `gateRuleFor(step)`**: `needed = base + risk step`, read from the risk tags the EPIC records (rule 3 — the file wins, the same discipline as `optionalStepsFor`), counted in distinct PEOPLE, base 1. Two inferences this row left open, now closed in code: `auth`/`payments` ARE the high tier (+1) while `contract` keeps its own larger step (+2), and several tags take the **maximum** step and never the sum — a gate is one decision about the riskiest thing it touches. The tier NAME comes from the winning tag, not from the number, so moving a tag's step later cannot make an `auth` gate print "contract risk". **It is REPORTED, NOT ENFORCED, and that is the decision this row turned on.** Part 3's tier-1 rule is ONE formula — `base + risk_step`, *capped at `active − 1`, floor 1* — and the cap needs the live active count (E71), which E72 then wires in. Enforcing the uncapped half alone deadlocks a small team, and the case is concrete, not theoretical: on a single-repo `architecture-review` the roster rule is satisfied by TWO people when one of them holds reviewer **and** domain-owner, while base 1 + contract 2 asks for three. With no cap (E72) and no `yad gate lower --reason` (E73), that gate would be unpassable — and rule 7 says an escape hatch always exists, which outranks shipping teeth early. So the count is computed, returned (`gateRule` / `have` / `short`) and printed wherever a gate reports itself — and NOT written to disk, so this task changes no file shape and no audit record — while the roster-era role rule is still the only thing that decides `passed`. E72 turns it on with one `missing.push` reading `short`. **A first pass had it ANDed with the role rule**; a review round found the two-person deadlock and the claim "changes no outcome today" that went with it — the same arithmetic this row used to reject a base of 2, one person smaller. **What stays name-based on purpose:** `isEscalated`'s `stories-review` clause (a step name inside a rule) — it triggers the role rule only, and E62 retires both together. **What the count sees that the role rule cannot:** one person holding two roles is two roles and one approver. That shortfall is now visible (and pinned by tests) a whole wave before anything blocks on it. **Rule 6 surfaces:** three of them print one shared sum from `gateRuleSum` — `gate sync` (`2 approved; count (advisory): 3 approvers = base 1 + contract risk 2 — 1 short`), `gate status` (the same sum and shortfall after the distinct-people count) and the generated review-PR body (`**Approver count (advisory, not yet enforced):**` plus the sum). The `--json` bundle carries the rule as an OBJECT (`step.gateRule`), not the sentence. An inherited or skipped step reports no count at all rather than one nobody must meet; solo mode still prints it, so a reader who later switches to team mode can see what each gate will then ask for. **Golden:** pass/fail, `rule`, `missing` and `staleDropped` are byte-identical on the frozen v3 project; its `gates` section gains `gateRule`/`have`/`short`. `have: null` is how the predicate says "nothing was counted here" on an inherited or skipped step, which is not the same fact as zero approvals — the frozen project exercises the inherited half; the skipped half is pinned by a unit test | M | E4 |
| E75 | The Product level — Foundation as a phase with its own gate. **Absorbs `EP-discovery` and `roadmap.md`**. **Shipped as file shape 8, and sized L in practice, not M** — the folder decision below touches every walker and every guard. **Three decisions were the user's, and are closed:** (1) `foundation/` is a TOP-LEVEL folder holding the sections, the `.sdlc/` ledger and `reviews/` — not a subfolder of `epics/EP-discovery/`; (2) `yad migrate` CONVERTS an existing `EP-discovery`, where it can; (3) the "one approval before feature work begins" is REPORTED, NOT ENFORCED — `yad next` names feature epics going ahead of an unapproved Foundation and blocks nothing, the same stance E7 took, because every project older than this release began its epics without one (rule 5). **The id is `EP-foundation`, and keeping the `EP-` prefix is load-bearing**: `parseReviewBranch` and both gate-sync workflows committed in users' repos match `review/EP-*`, so a prefix-less id would silently never sync on any project wired before this release. **`epicRoot` is the one chokepoint** that knows the id's folder is `foundation/`, pinned by a test; `epicIds(root)` is the one enumerator, keyed on `foundation/.sdlc/` rather than `foundation/` so an unrelated folder of that name is never read as a ledger, and every `epics/` walker now uses it — `gate ci`'s sweep and its git staging, `migrate`, eight `doctor` sections, `sync-status`, `usage`. **The model:** `foundation`/`foundation-review` catalogue rows on the product level; the old `discovery` rows stay (rule 3) and move into the same phase; a separate `PRODUCT_PHASES` ladder with one phase, Foundation, so the six feature phases are untouched and the Foundation is never printed on them; the `foundation` route and `foundation-done` sentinel; one `isProductLevel` predicate for both spellings; eight sections, Market and Risks optional, `foundationHash` null until the six required ones exist; a `discovery` skill binding carries to `foundation` until the step gets its own. **The guard gap was the price of the top-level folder, and it is closed, not hidden:** `ledger-guard.sh`, the agent hook and the two PR gates now cover `foundation/`, but they are committed in users' repos and refreshed by `yad update`, not by `yad migrate` — so `yad doctor` warns `foundation:guard` on a verified Product with a Foundation and stale checks, and a test pins that the frozen 3.18.1 guard does NOT protect the folder, which keeps the warning true. **The converter** is a project-level step beside the per-file list, because a `MIGRATIONS` row rewrites one object at one path and cannot move a directory: copy to `foundation/`, fingerprint-check, relabel `state.json` (id, kind, profile, step ids, `currentStep`) and the `step` on every approval, comment and review-PR record (the gate drops an approval whose `step` does not match), then remove the original, keeping a whole backup at `epics/EP-discovery.yad-orig/` — a name `isValidEpicId` rejects. **The step keeps `artifact: "discovery/"`**, so the fingerprint is computed over the same six names and bytes and no approval goes stale; `artifactAgrees` is what stops `yad doctor` calling that a wrong artifact. It refuses and moves nothing on a verified ledger (CI owns it, and the guard rejects a human move — **so a person cannot convert a verified project, and the gate bot does**: `convertProductLevel` in `yad gate ci` makes the same move after its jobs, on the default branch only, with no `.yad-orig` copy because git history is the backup — but ONLY once the product level's review has PASSED (Path B records no review PR before its merge, so the open-review refusal cannot see an open one, and moving under it stranded that merge; a merge of `review/EP-discovery/*` after a move is also routed to `foundation/`), never from a checkout with uncommitted changes under either folder, and never while the committed checks predate the Foundation; every reader still reads the old spelling until it lands), an open review, two product levels, a file collision, a backup in the way, or an unreadable ledger. **`yad foundation new`** seeds it (a product-level predicate, not a loosened `seedableProfiles`) and refuses beside the old spelling; `yad-discovery` runs it and authors the sections, and keeps its name — renaming a skill folder needs an install migration of its own. `yad doctor` also fails two product levels and a stray `epics/EP-foundation/`. **Not here:** the authoring content of each section (E76), the scanner (E77), injecting Foundation decisions into steps (E78), and enforcing the gate (the capacity cap work of E72 is the model for turning a report into a rule). **The follow-up after the merge closed the six risks E75 shipped with:** (1) a verified Product is converted by the gate bot, as above; (2) `yad foundation new` refuses on a verified Product whose committed checks predate the Foundation, and `yad doctor` says what stops CI moving an old spelling — one list, `staleFoundationGuards`, serves all three; (3) a 3.x yadflow cannot be changed, so the fix is FORWARD: every command except `hook`/`doctor`/`migrate`/`setup`/`report` warns on stderr when `.sdlc/cli-version.json` or the product config is on a newer shape, and the shape-8 guide records what 3.18.1 really does on a converted project (checked, not assumed: it has no `yad epic new`; its `yad-discovery` skill is what would write a second product level); (4) the overview site's data caught up with the skill manifest (seven skills it never named; role paths still numbered for four paths; two `module-help.csv` rows with the wrong column count) and its build manifest was rewritten — it goes stale again on every release, because its freshness key is the CLI version; (5) `yad doctor` names a folder under `epics/` that is not a valid id instead of every walker skipping it in silence; (6) `yad migrate --json`'s preview named fewer files than the apply wrote (the product config's mirror partner) — it UNDER-reported, and a test had pinned the short list | M | E22 |
| E76 | Foundation authoring for greenfield. **The scope is the sentence E75 left for it: "the authoring content of each section".** E75 shipped the folder, the ledger, the gate and a template per section (headings and a one-line comment). This row fills the sections in, and adds the one engine check the templates made necessary. **Content, in `skills/yad-discovery/references/foundation-schema.md`:** for each of the eight sections, the questions to **Ask** (one at a time, the user's answer written down, not a guess), what **a good answer** holds, what **the reviewer checks** it against (Phase 1 of the roadmap must match `mvp.md`; nothing may contradict a non-goal in `scope.md`), and a short example on one made-up product. **A real greenfield path in `yad-discovery`** (Step 2a): the order purpose → scope → MVP → roadmap → stack → repos, then the optional market and risks, because each section is the input to the next; `stack.md` records the decision, the alternatives rejected and why, and `repos.md` the intended repos, which need not exist yet. Brownfield (Step 2b) is unchanged, and drafting it from evidence is E77. **The engine check: a Foundation can be complete and empty.** `foundationHash` asks only whether the required files EXIST, so six files holding nothing but their template headings had a fingerprint and could be approved. `isUnwrittenSection` / `unwrittenSections` (`cli/epic-state.mjs`) read a section as unwritten when it holds only what the templates are made of — frontmatter, `#`/`##` headings (the level the templates use — a `###` sub-heading is an answer), HTML comments, blank lines, `---` dividers, and an empty table (header row, `|---|` rule, rows of empty cells). One real line makes it written; the heuristic errs toward "written" on purpose, because it only ever warns. A test parses the shipped templates and asserts every one reads as unwritten (the invisible-rules rule), so a template that gains a line the reader counts as content fails the suite; the roadmap template's example row moved into a comment for exactly that reason. **It warns, never refuses**, the stance E75 took on the Foundation's own gate: `yad gate open` and `yad gate sync` print "Foundation not written yet" (beside the existing "Foundation incomplete"), and `yad doctor` reports `foundation:unwritten` only once the review has OPENED or PASSED — while the Foundation is being authored an empty section is work not done yet, not a finding. Optional sections are asked once they exist: an empty `risks.md` is part of what reviewers approve. Not asked: the old `discovery` spelling, and a Foundation converted from it (its review keeps `artifact: "discovery/"` and six files that were never these templates). **Not here:** no new verb, no section files written by `yad foundation new` (E75's parity with `yad epic new` stands — prose is the skill's), no `yad next` section progress, no renamed skill. No file shape moves. **Known limit, recorded and not decided:** `yad-epic` Step 2c tells people to bump a roadmap row `planned → epic-started` by hand, but the table is inside the fingerprint (only the frontmatter `status:` line is left out, shape 9), so that edit on an approved Foundation makes `yad doctor` report its approvals stale. Fixing it means either changing what the fingerprint covers — an approvals-behaviour change, which needed a migration guide last time — or deriving a feature's status from the epic ledgers instead of a hand edit. **Decided by the user after the review: the second.** A feature's status is to be derived from the epic ledgers (whether its epic exists and how far it has got), and the skills stop teaching the hand edit — approvals keep behaving as they do today, so no shape moves and no guide is needed. **Shipped in the follow-up as `yad foundation status`** (read-only, `--json`): it reads every table in `roadmap.md` whose header has a `Proposed epic id` column (in any position, so the old spelling's `Requirements` column is stepped over; a line holding only a comment does not end a table, so the template's commented example row never ends one) and reports each feature from its epic's ledger through `nextAction`, the reader `yad next` prints — `planned` (no ledger), `in-shape`, `in-build` (Shape done, not every Build lane shipped), `shipped` (every lane shipped, or a brownfield anchor). A written status is shown only where it disagrees (`epic-started` agrees with `in-shape`/`in-build`); feature epics no row proposes are named, change/defect/hotfix epics are not; a reserved or malformed id is a problem, not a feature. `yad next` at `foundation-done` points at it, `yad-epic` Step 2c stops teaching the edit and prefers the proposed id, and the template keeps the column (rule 3 — existing Foundations have it) with a comment saying it is not updated by hand. No fingerprint change, no write to `roadmap.md`, no `yad next --json` key, no shape. **The follow-up's review found one real hole, fixed before merge:** a story's build-state file appears only when that story starts Build, so an epic whose started stories had all shipped read `shipped` while other stories had not begun. `shipped` now also needs every story in `stories/` to have a build-state and every repo it declares to have a lane (`epicStories`, passed into `featureStatus`). Also fixed: a table inside a code fence is an example, not a feature; a heading ends a table even with a `|` in it; `\|` stays inside its cell; the phase is the nearest `#`/`##` heading; the unlisted list reads only folders with a ledger and takes the type from the ledger when `epic.md` is missing (a fresh `--type chore` was listed as a feature); two product levels read `foundation/` and warn. Kept as designed: an epic whose Build has all shipped reads `shipped` even with a re-opened Shape step — the step is `yad next`'s lane to report, not this view's. **The review round found two holes, both fixed in the same row.** (1) A `foundation-review` step with no `artifact` crashed `yad doctor` (`artifactBase` throws on `undefined`, and `validateState` does not require the field) before `catalogueChecks` could report exactly that fault; the check now skips a step whose artifact is not a string. (2) A table rule was allowed to have no `|`, so a bare `---` divider matched it and the line above — a sentence or a filled table row — was read as a header row, turning real content "unwritten", the error direction the heuristic exists to avoid; a rule and a header now need a `|`, and a divider is ignored on its own. A test also reads every worked example in the schema and requires it to read as written. The skill's greenfield loop drafts text with the user and writes the files only in Step 5, after the authoring branch and the ledger exist | M | E75 |

**Shape 9 — a fix, not a row: an approval's fingerprint leaves out the frontmatter `status:` line.**
Found while closing E75's risks. The gate's merge run records approvals and then flips each artifact's
`status:` to `approved`; Build flips a story to `in-build` / `shipped`. The fingerprint hashed the whole
file, so each of those planned writes revoked the approvals it was reporting on: `yad gate status` said
"stale (revoked)", `yad doctor` warned, the sweep said the rule no longer held — on every epic, before
E75 too. `yad next` never read fingerprints, and no gate was blocked (the step had already passed).
**The fix:** `reviewedSha` fingerprints each file without that line (the contract surface was already
fingerprinted by what was reviewed only). **Read old, write new (rule 2):** `acceptedHashes` also accepts
the whole-file hash and the whole-file hash with `status:` set back to `draft` / `in-review` / `approved`
uniformly across a set, which repairs without a write the approvals older releases already reported
stale; an old approval on a set whose files had MIXED statuses when approved still reads stale, and the
guide says so. **The shape decision was the user's, and is closed:** it is a breaking shape even though
no field moves, because an older yadflow reads every new approval as stale — on a local ledger with mixed
versions that holds an open gate — and only a newer shape number makes it warn. `docs/migrations/shape-9.md`.

### 2c — Escaping steps honestly

| ID | Task | Size | Needs |
|---|---|---|---|
| E35 | `required` moves into the profile; delete `SKIPPABLE_STEPS`. **Done as `optional` on the profile row, not a new `required` field** — E5 already put the mark there, and a second polarity nobody reads would fail the "no unread profile-row field" test. What E35 removed is the engine-wide UNION: `optionalStepsFor(state)` asks the epic's own route (the RECORDED one, even when the chain disagrees — rule 3), an epic with no route at all has nothing optional, and `yad doctor` reports `skip:not-optional`. **E40 prerequisite:** it adds routes SHORTER than `classic`, and `matchLifecycleProfile` breaks ties on the shortest fit — so a pre-shape-6 epic that legitimately dropped a step would match a new short lane on its next `yad migrate`. Stamping `profile` has to reach those epics before the short lanes ship | S | E5 |
| E38 | The full step-state model, incl. `satisfied` and `blocked`. **The decision this row turned on, before any of the rest of it: `blocked` already meant something else.** Every release up to shape 6 wrote `blocked` for "waiting on an earlier step", which is the roadmap's `todo` — one string, two meanings. Keying the two apart on `schemaVersion` was rejected: `yad migrate` never rewrites `state.json` on a VERIFIED project (CI is its only writer, the row is reported `ci-owned`), so such a project sits at shape 6 until its next gate write, and several readers (`doctor`, `artifact-status`) load the file raw with no shape number in hand. **THE RECORD IS THE DISAMBIGUATOR** — `blocked` + no `record` is `todo`, `blocked` + a `record` is a real blocker — which is exact by construction, because no release has ever written a record. That makes the roadmap's "must record" column load-bearing instead of decorative. **Shipped as `STEP_STATES`** — eight rows: the roadmap's seven plus `in_review`, which is `in_progress` on a review gate and which `markInReview` / `advanceState` / `artifact-status` all key on (the table's `in-progress` hyphen is prose; no file and no line of code has ever held the hyphen). **The converse, for E37/E41:** clearing a blocker must move `status` OFF `blocked`; deleting only the record turns the step silently back into a `todo`. **Two questions, not one**, and running them together was the bug the table exists to stop: `passed` (may the chain continue) and `authored` (was the artifact written HERE) are both spelled `status === 'done'` today, which is exactly why a skipped step had to be pre-marked `done` to get past the first and carry a flag to be excluded from the second. Shipped as `isPassed` / `isAuthored` over one `stepStatus`, and ~31 readers now ask one of them. **The legacy encodings are a FLAG BESIDE `done`, not a flag alone** — a first cut read the flag by itself, and a review round found that a hand-typed `skipped: true` would then unblock every step behind it. So `stepStatus` requires the pairing, and `claimsSkipped`/`claimsInherited` answer the separate question of what the file CLAIMS — which is what `gatePredicate`'s route guard and `yad doctor` need to see before they can refuse it. The gate labels `rule: 'inherited'` / `rule: 'skipped'` are frozen golden bytes and did NOT move. **Shape 7**, the first shape that changes a value in place rather than adding a key beside an old one: `blocked`→`todo`, a skip to `status: skipped`, an inherited step to `status: satisfied`, each with a record assembled from what the file already held and nothing invented. Every legacy field is KEPT (rule 3), and `boundHash` stays its own field — drift evidence, not provenance. Rule 3 is held by the READER for this whole major; the direction that genuinely breaks is a 3.x CLI reading a MIGRATED project, which `docs/migrations/shape-7.md` says in as many words rather than leaving to be found. **`build-state/<story>.json` is deliberately not migrated**, and it is the one place the record-as-disambiguator argument is not free: the `yad-run` / `yad-implement` SKILLS write that file, so a rewrite would be undone by their next write — but they are also the one EXISTING writer of `blocked` in the new sense, marking a lane halted on a failed check, a scope overrun or a contract touch. A review round caught three skill instructions doing exactly that under comments here claiming nothing did. They now write a `record` with the halt cause; a lane halted by an older `yad-run` reads as `todo` until the next run rewrites the file, and nothing advances past it either way, so the cost is the word and not the work. **`yad next` gained a `blocked` branch**: naming a skill for a step waiting on a vendor is the one thing the new state exists to stop, so it prints the record instead. **Which reader wants which question** is a table in the header comment, because a review round found it had mis-assigned three of six — `closeAuthorStep` wants `passed` (stamping `done` over a skipped author step destroys the skip's provenance), `stateInvariants` wants `=== 'done'` on the GATE side (`isPassed` there would read a future `deferred` gate above a `todo` author as a violation, and `repairState` would then stamp that author `done` — claiming an artifact nobody wrote), and the three step-over scans want `=== 'skipped'` rather than the claim, so a hand-edited flag is not walked past. **A live blocker survives a gate write:** `markInReview` will not write `in_review` over a `blocked` step (that is the path where the gate did NOT pass, so it would drop the record naming who we wait on and change nothing about the wait), while `advanceState` drops the record WITH the state when the gate does pass — a skip's record is the opposite case and has to survive, because it is the reason that step passed. A verb that CLEARS a blocker is E37's. **When E38 shipped, nothing wrote `deferred` or `blocked`** (see the E37 row: `yad defer` now writes `deferred` and `yad unblock` clears `blocked`; nothing in the CLI writes `blocked`), so per the invisible-rules rule the suite constructs a chain carrying every row of the table and pins each reader by hand | S | E4 |
| E36 | General `yad skip` / `yad unskip` with recorded reason. **"General" means no step named in the verb, NOT "any step skippable".** Which steps may be skipped stays the epic's route (E35), and the route guard stays: a skip makes a gate pass with no approvals, rule 2 forbids dropping a gate on its own, and a review round on E38 already rejected a hand-typed skip unblocking a chain. Widening WHERE a skip may be declared (profile · epic · story/repo) is E39's, not this row's. What was ui-design-specific after E35 was the guards: `skipStep` refused once the literal `stories` had started and `unskipStep` once the literal `stories-review` had opened — right only because `ui-design` was the one optional step and `stories` follows it. **Both now read the chain instead**: a skip is too late once work has started on any later step, an un-skip once work has started past *the step after the pair* (the first later step that is not itself skipped — the step the skip opened, which may itself be under way but not finished: a second review round found a `done` `stories` whose review was then `blocked` passed a check that looked only past it, leaving stories written without the UI standing as complete). **"Started" means work done in this chain** — `in_progress`, `in_review` or `done`. A first cut counted every non-`todo` state, and review found it refused an un-skip because a later step was inherited (`satisfied`) or `blocked` on a third party, and would have refused one behind any E37 `deferred` step; none of those is work built on the skip. An unknown status word counts as started (fail closed), and a non-step entry after the pair is refused as a malformed chain — the first cut's walk stopped at a hole, and `skipStep` then read it as permission. On a route marking `architecture` optional the literal was not just untidy but wrong — un-skipping architecture with a ui-design review already open passed the `stories-review` check and pointed `currentStep` back behind that review. No shipped route marks a second step optional, so the tests pass routes in (the invisible-rules rule). **An un-skip keeps `ready-for-build` only when the epic earned it** — its `stories-review` is `done` (or `satisfied`, reviewed in the parent epic) and sits before the restored step, so the step runs beside Build as `test-cases` does (`markInReview`'s rule, `advanceState`'s gate). The first cut kept the sentinel for ANY pair at the end of the chain, and on a `chore` lane `stories` IS that pair: un-skipping a hand-typed stories skip — the exact remedy `yad doctor` recommends — left "Build can run" over unapproved stories. **`yad unskip <epic> <step>`** is the verb; `yad skip … --undo` stays (rule 3, add before you remove), and `yad doctor`'s `skip:not-optional` remedy names the new one. The record is unchanged: a skip already wrote `{ reason, by, date }` under shape 7, so no file shape moves. On a verified Product the verbs refuse once the epic's ledger is on the default branch (closed in E34's review) | S | E35 |
| E37 | `yad defer`. **A deferral is a skip that is still owed, so it takes a skip's permission.** A `deferred` step lets the chain continue (`STEP_STATES`), so deferring a step the route requires would carry the chain past its review gate with no approvals on it — rule 2 — however the reason is worded. `yad defer` / `yad undefer` therefore run the SAME core as `yad skip` / `yad unskip` (`setAsideStep` / `restoreStep`): same route guard, same refusals, same windows, same `currentStep` handling. What differs is the words, the undo command and the stamp — `status: deferred` plus a `record`, and no legacy fields, because the word was born in shape 7. The two are **not interchangeable**: each refuses a step set aside the other way and names the command that puts it back first, because converting in place would lose a record. **Four readers were checked**, each by asking what a deferred step would do to it. (1) The three step-over walks now walk past `isSetAside`: `advanceState` would have written `in_progress` over a deferral the moment the gate in front of it passed, losing the record. (2) `gatePredicate` is deliberately NOT given a `deferred` short-circuit, on E38's reasoning: a skip's gate will never be asked again and a deferral's will, so the predicate keeps answering "not passed, and this is missing" — the honest report of what is owed. A first cut added `rule: 'deferred'`; the E38 test pinning that decision caught it. Nothing needed the branch (`gate sync` checks `isPassed` before it acts on the predicate), and the frozen gate labels stay two. (3) `desiredStatus` returned `approved` for any passed review, so CI would have stamped `status: approved` on a deferred draft. It now leaves a skipped or deferred review's artifact alone, which closes the same hole for a skip taken over a half-written draft. (4) `yad gate open` refused nothing, so a review PR could open on a step the chain had walked past; it now refuses a set-aside step. A PR opened BEFORE the deferral is the one way a deferred step still has one: `yad gate sync` reaches its already-passed branch, which said "already done … the rule no longer holds" — a pass that never happened. It now says the review is still owed, and keeps any approvals the PR has (a sync of a step that reads as passed only ever adds to its record). `yad doctor`'s `skip:not-optional` covers a deferred step too, and `yad next --check` names the state that finished a step instead of always saying "already done". **The un-defer window is a limit of the machinery, not of the meaning.** For a skip it is the meaning: stories finished without a UI were built on its absence. A deferral promised to come back, so finished stories are expected. What stops the late resume is that the chain cannot carry it — `preconditionsMet` would name the resumed step as the blocker of finished work, and `advanceState` would re-open that work when the resumed review passed. That re-open is the machinery E41's payback needs, so it ships once, in E41. **Two known limits, both shared with a skip and left as they were.** A `deferred` status typed by hand onto a required step is walked past, exactly as a hand-typed `skipped` always was — the file wins, and `yad doctor`'s `skip:not-optional` reports it; a route check inside `advanceState` would be a wider change than this row. And a change threaded off a parent whose `ui-design` is set aside still names that parent the owner of the artifact (`resolveCurrentArtifacts` never reads the step's state), so `yad-change` could seed an inherited UI nobody wrote; for a deferral the owed work would drop out of the thread. That belongs with inheritance (E42) or payback (E41). **A record's `by` is who wrote it**, on every state; who is waiting for a deferral goes in the reason. No new field, no file shape change. **Clearing a blocker**, which the E38 row gave this row, ships as `yad unblock <epic> <step>`: status and record go in ONE write (deleting only the record would make the step a silent `todo`), to `in_progress` for an author step whose earlier steps have passed and `todo` otherwise — a review gate included, since opening a review is `yad gate open`'s job. A `blocked` with no record is refused separately, because it is the older word for `todo` and has nothing to clear. `state.json` only: `build-state/<story>.json` is the `yad-run` skill's, and a CLI write there would be undone by its next run. **`yad next` stopped printing `by` as "waiting on"**: `by` is who wrote the record, and the one existing writer of a real blocker (`yad-run`) puts the login the run ran as there, so the line named the wrong party. No `yad block` verb — marking a step blocked stays a hand edit or a skill's write until someone asks for one. **`yad skip` and `yad defer` now refuse a blocked step.** Before, setting one aside replaced the blocker's record with the verb's own, and putting it back deleted it, so the blocker vanished without anyone clearing it — a hole `yad skip` had since E35, found by the E37 review. A blocked review gate had also been refused for the wrong reason ("its review has already opened"). **A gate passing no longer opens a blocked next step**, found by the E37 final review: `advanceState` wrote `in_progress` over a blocker on the step after the gate and kept its record, so `yad next` said to author the step and `yad unblock` refused a step that read as in progress. It now moves `currentStep` there and leaves the status, as `markInReview` already did; E38's "a live blocker survives a gate write" had only covered the gate step itself. **Clearing leaves no record in the file**: the git history of `state.json` is the trace, as it is for `yad unskip` and `yad undefer`. On a verified Product `yad unblock` refuses once the epic's ledger is on the default branch (closed in E34's review; a CI step for it is left for later) | S | E36 |
| E39 | Skip at three levels: profile · epic · story/repo. **Three decisions were the user's, and are closed.** (1) **The profile level is E35 and nothing more**: a route marks a step `optional` in the engine's code, and a project file to mark more steps optional is NOT added here — a project-level place for route settings belongs with E51/E54, and inventing it first would collide with theirs. (2) **The epic level is `yad skip` / `yad defer` (E36/E37)**, unchanged. (3) **The story/repo level is a whole Build LANE — one story in one repo — and never a single Build step**: asked which of `spec`, `tasks`, `implement` and `checks` a lane may skip, the answer was none (`engineer-review` was never a candidate — rule 2). What legitimately "does not apply" is a repo a story declared that turned out to need no change — and since #242, `featureStatus` never reads that feature `shipped` while the declared repo has no lane. **`yad skip <epic> <story> --repo <name> --reason` / `yad unskip <epic> <story> --repo <name>`** — a story id where the step goes (no Shape step id ends in `-S<n>`) routes to the lane; `yad defer` on a lane is refused, since a lane owed later is simply not driven yet. **Where it is written was decided by elimination:** not the story's `repos:` frontmatter, which is under `storiesHash` (editing it after approval revokes the stories review — the trap #242 closed for the roadmap column); not `state.json`, which CI alone writes on a verified Product and which has no review PR left to carry the write at `ready-for-build`; so `build-state/<story>.json`, as `repos.<repo> = { status: 'skipped', record }` — machine state `yad checkpoint --push` commits on the default branch, `ledger-guard` does not guard, and `yad-run` updates in place, so the skip survives its next run. **Refusals** (`skipLane`, pure, YAD-STATE-004): before `stories-review` has passed (the answer then is to edit `repos:`, which revokes nothing); a repo the story does not declare (`declaredRepos`, now the ONE parse of that list, shared with `epicStories` and `yad checkpoint --retro-ship`); a ship already recorded for story×repo; work started in the lane (any step past `todo`, a halt included); and the story's last unskipped lane (a story needing no change anywhere is its stories review's question). A repeat keeps the original record. **Putting a lane back asks only that it was skipped** — restoring owed work lets nothing pass, the reason `yad unskip` on a Shape step asks no route — and a file left holding only what the skip wrote is removed. **Readers:** `buildNextForRepo` answers `status: 'skipped'` with a `record` key ONLY on a skipped lane, so the frozen golden lanes are byte-identical; `nextAction`'s Build line and `yad next`'s roll-up stop counting a skipped lane as open (the frozen "every lane is shipped" wording is kept when none is skipped); `buildShipped` counts a skipped lane as finished but needs at least one lane really shipped; `yad checkpoint --retro-ship` refuses a skipped lane and leaves it out of "still unrecorded". **`yad doctor`** (`laneChecks`): `fail` a skipped lane that also has work or a ship; `warn` one with no record, one for a repo the story does not declare, and a single Build step `skipped`/`deferred` by hand — `buildNextForRepo` walks past a passed step, so that would read as done work nobody did. **The skills are writers too:** `yad-run` is told to add a missing repo's entry to an existing file, never to drive a skipped lane, and never to write a Build step as `skipped`/`deferred`; `yad-status` prints a skipped lane. **No file shape moves:** a shape-10 yadflow reads the entry as a lane with no steps — "not started yet" — which drives nothing. **The review round found one real bug and seven smaller holes, all fixed in the same row.** (1) A lane skipped BEFORE Build began creates the build-state file on its own, so `yad next` said "every lane is shipped or skipped" at the first step and dropped the `yad-run` hint: with every recorded lane skipped and none shipped, `nextAction` now says Build can run, and the roll-up and the single-epic view both print the `yad-run` line. (2) `skipped` written beside real steps — a hand edit, or an older `yad-run` filling what looked like a half-seeded lane — was honoured and could read `shipped`; `buildNextForRepo` now honours the word only when `laneStarted` is false (E38: a claim is not walked past on its own). (3) An unknown status word counted as not started, because `stepStatus` answers `null` for one; `laneStarted` is now the one predicate for `skipLane`, `buildNextForRepo` and doctor's contradiction, and counts it as started (E36's fail-closed rule), while a step with no status at all is still a seeded step nobody began. (4) A hand-typed `skipped`/`deferred` stories review passed `isPassed`; a lane skip now needs `done` or `satisfied`. (5) `--retro-ship` read build-state leniently, so a corrupt file hid a skip; it now reads strictly and refuses. (6) `yad unskip` needed the story file; it no longer does. (7) `yad-engineer-review` could record a ship over a skipped lane; the skill now checks first, and `yad-run`'s `run-loop.md` pseudocode — the steps the loop actually follows — gained the skipped-lane stop that only `SKILL.md` had. Also: a build-state (or its `repos`) that is not an object is refused rather than overwritten, duplicate `repos:` entries fold to one, `--repo` on a Shape skip and `--debt` on a lane warn instead of being silently ignored, and replacing a seeded-but-unstarted lane is documented as dropping its per-step dials. Left as it is: `yad unskip` of the last lane in a file that also has a `note` leaves `{ story, note, repos: {} }`, which reads honestly as no lanes recorded | M | E36 |
| E42 | Contract inheritance — reference a lock instead of authoring one. **Shipped as `yad epic new <slug> --type change\|defect\|hotfix --parent <epic> --inherits <bases>`**, the engine verb for the last feature seed a skill still wrote by hand (`yad-change`, left over from E17b). Rule 5 is the reason for it: a change that does not move the surface skips AUTHORING a contract but still HAS one — a pointer-lock holding the owner's hash verbatim. **What stays in the skill** is the depth triage that decides which bases are inherited, a judgement made with a person; the engine takes its outcome and refuses every outcome the ledger cannot honestly record, writing nothing. **Decisions.** (1) The route is the parent's, verbatim; a `--profile` naming another is refused. (2) The owner of each base is found along the PARENT's line only (`ownersAlong`), not across the whole thread — a sibling change off the same genesis is not something the child builds on, and the pointer names the lock that really holds the surface, not a middle pointer. (3) `epic`, `architecture` + `contract` (always together — one step writes both) and `ui-design` are inheritable, and `analysis` rides with `epic`. `stories` and `test-cases` never are: the thread's set is the union of every contributor, and `stories-review` is what hands an epic to Build. (4) **The limit E37 and E41 left open is closed in the verb, not in `resolveCurrentArtifacts`.** That map names the epic that DECIDED about a base, which a pinned test keeps right for a skip. The verb carries a base only when the owner's step and its review are both `done` and the artifact is on disk: a skipped step is refused (skip it on the child), a deferred one is refused (author it on the child, so the owed work follows the thread), an unfinished one is refused, and so is a ledger that claims `inherited` while its `epic.md` does not list the base. (5) A carried architecture needs a usable lock whose surface still matches; otherwise refused. (6) A brownfield anchor parent carries `boundHash: null` and no lock, as the skill already did. (7) `parent:` and `inherits:` in `epic.md` win over no flag, and a contradicting flag is refused — the same rule as `--type`; a `thread:` that disagrees with the parent's line is refused too. **No shape change:** every field it writes already existed, and a test keeps `triage.md`'s worked example equal to the engine's seed. | S | E5 |
| E40 | Short profiles — a chore lane and a spike lane. **`chore` is 4 steps** (`epic` + `stories`) and **`spike` is 6** (the analyst's brief in front of the chore lane) — `spike` is `chore` plus `analysis`, because the one thing that separates a timeboxed question from decided upkeep is whether the answer is known. Both drop `architecture`, `ui-design` and `test-cases`, each **absent rather than `optional`**: a skip record for a step the route never had is noise, not an audit trail. Neither drops `epic` (no `epic.md` means no work-item type, no `parent:` lineage and no `yad thread` rollup) or `stories` (it tags the repos, and `stories-review` is the step `advanceState` turns into `ready-for-build` — a lane ending anywhere else claims a Build with nothing in it). **Type and route stay independent**: `--type chore --profile classic` is the right call for large upkeep that does move the contract. **The E35 prerequisite is discharged in code, not by timing**: `stampProfile` matches against `SHAPE_6_ROUTE_IDS`, frozen at the three routes that existed when shape 6 landed. The exposure is real but narrow — any chain built only from `epic`/`epic-review`/`stories`/`stories-review` reads as `chore` now and read as `classic` before — and no chain yadflow has ever seeded is in it, since every shipped seed carries `architecture`. The freeze makes that a property of the code rather than of today's data. **The invariant this broke, found in review:** until now every feature route marked exactly ONE step optional, so "this epic has no optional steps" could only mean "its chain fits no route" — one `notOptional` branch served both. The short lanes mark none, so a healthy `chore` epic was being told its chain matched nothing and sent to a `yad doctor` check that cannot fire. Three branches now, and the four comments that asserted the old equivalence are corrected. The same shape of bug in two more readers: `preconditionsMet` called an off-route step "unknown" when the catalogue knows it perfectly well, and `yad next`'s phase line printed a phase the route never enters exactly as one already passed. The phase mark is taken from the RECORDED route only — matching would grey out two phases on every truncated legacy chain, then flip back on the next gate write. The review-PR checklist had the same fault: it asked every reviewer to confirm a contract re-lock, which a short lane can never do, so that item is replaced on those routes rather than left to be ticked unread. **The contract gap, CLOSED here after review:** dropping the architecture gate drops the contract lock, and `contract-check.sh` treats an unreachable product lock as a deferred note rather than a failure. On a short lane that is not an edge case but the STEADY state, because the lock can never appear — so `Contract-Change: yes` on a short-lane diff is never hard-failed. An UNFLAGGED surface change still FAILs, but only while a real contract-derived spec slice exists to be changed, which a short lane also has no way to produce. The guard is prose in `yad-stories`, `yad-spec` and `yad-implement`, which all now stop and escalate rather than naming an architecture gate the lane does not have. That IS a gate now: `contract-check.sh` FAILs a claimed `Contract-Change` when the epic's ledger directory resolves and holds no lock. Guarded on the epic's `.sdlc/` directory rather than on the product path, because `resolve_product` returns a string without checking the disk — so "this epic is real and has no lock" stays separate from "nothing is checked out here", which still defers exactly as before. `yad-change` threading off a short-lane parent is handled: it seeds the PARENT's chain and route, writes no pointer-lock, and records `parentShortLane`, generalising the stub-parent rule rather than forging an `inherited: true` on a review that never happened | M | E5 |
| E41 | Debt tracking and payback reminders. **Also carries the re-open E37 left out:** putting a step back after the chain has built past it. `preconditionsMet` must not name it the blocker of finished work, `advanceState` must not re-open the finished step after it, and `yad next` must show it as a second open lane. Resuming a deferral late and paying back debt both need exactly that, so it ships once, here. **The decision this row turned on: what `debt: true` sits on.** Part 1 says "skipped under emergency, owed back", but E36/E37 pinned that a skip means the step does NOT apply, and shipped `deferred` as the state for work still owed. A debt on a skip would be a step that does not apply and is owed back. So **debt is a flag on a DEFERRED pair**, written by `yad defer … --debt`, and `yad skip --debt` is refused with the command to use instead. The flag changes no column of `STEP_STATES` — a debt is exactly as passed and as unauthored as any deferral — and only decides what reminds. Same route permission as any deferral: "emergency" does not reach a required step (rule 2). **Payback is `yad undefer`, with no closing window.** For a skip the window is the meaning (stories finished without a UI were built on its absence) and `yad unskip` keeps it. For a deferral it was only the machinery, so once the chain has built past the pair `yad undefer` RE-OPENS it: author `in_progress` (or `todo` if an earlier step has not passed), gate `todo`, and neither the finished work nor `currentStep` moves. `debt` stays on through that and through the review opening; `advanceState` removes it when the review PASSES, which is the only thing that clears it. **A re-opened step is read off the chain, never off a flag** (`behindFinishedWork`): an unfinished step with a step COMPLETED HERE after it. A `reopened: true` honoured by `preconditionsMet` would be one hand-typed word that unblocks a chain, the hole E38 closed for `skipped: true`. Two narrowings make the structural reading exact rather than generous: only `done` counts — a skipped, deferred or inherited step after an unfinished `architecture` is not work built here, and counting it (`isPassed`) would unblock `stories` — and a step's OWN gate does not count, because a `done` gate over its unwritten author is #131's damage, which `stateInvariants` reports. **One consequence was accepted, not missed:** on a damaged chain where more than the gate is finished — `architecture: todo`, `architecture-review: done`, `ui-design: done`, `stories: todo` — `architecture` now reads as a re-opened lane, so `stories` reads ready where it used to be blocked. A chain that has visibly moved on reads as moved on; `stateInvariants` still reports the stranded author (YAD-STATE-005), `yad gate repair` still closes it, and nothing became hand-typable that was not before (writing `done` on the blocker always unblocked it). **Four readers changed.** `preconditionsMet` skips a re-opened step when it is behind finished work that lies before the asked step (its own gate still waits on it). `advanceState` returns early for a gate that passed behind the chain (`currentStep` past it, or `ready-for-build`), and in the forward case now opens only a `todo` next step — it used to write `in_progress` over a `done` one, a bug `restoreStep`'s earned-Build case could already reach. `markInReview` moves `currentStep` only forward. `nextAction` adds `reopened` (a lane per re-opened step that can be worked now, shaped like an action) and `debt` (`owedSteps`), each ONLY when non-empty, so the frozen golden JSON is unchanged. **Reminders:** a `warn` line per debt in `yad next <epic>`, a count on the epic's row in the roll-up, a `step:debt` finding in `yad doctor` (a reminder, never a fault or a gate), and `yad gate status` prints "deferred (still owed, as debt)". **Step debt is not `reconcile-debt.json`**: that is a hotfix's whole change owed to a thread and enforced by a CI gate; this is one step of one epic, reminded and never enforced. **The review round found four holes, all fixed in the same row.** (1) A debt put back early could then be SKIPPED, and a skipped gate reads as passed, so no review would ever clear the flag: `yad skip` now refuses a step owed as debt, and deferring it again keeps the flag (a plain re-defer does not drop a debt — only a passing review does). (2) A passing gate on a change-epic parked `currentStep` on an inherited `satisfied` step and `yad next` said to author it — older than E41 (it used to write `in_progress` over the step), but this row had just changed that walk, so it now steps over every PASSED step, not only set-aside ones. (3) A late `yad undefer` could not be undone, because `yad defer` refused once later work had started: deferring is now allowed on a step re-opened behind finished work (skipping stays refused — that work was built without it). (4) The late branch fired when later work had only STARTED, or held an unknown status, leaving a step that was neither a lane nor current: it now needs `behindFinishedWork`, and refuses otherwise, as before. **Left open, for E42:** E37's limit — a change threaded off a parent whose `ui-design` is set aside still names that parent the owner (`resolveCurrentArtifacts` never reads step state), so the owed work does not follow into the thread. E41 does not change that; a debt stays in the PARENT's `state.json` and keeps reminding there until paid. **Shape 10.** One optional key on a step, nothing to convert (a no-op row). It is breaking because an older yadflow reading a re-opened chain names the step the blocker of the stories review and re-opens `stories` when its review passes; the number is what makes it warn instead (`docs/migrations/shape-10.md`). On a verified Product a late undefer, and so paying a debt back, is refused once the epic's ledger is on the default branch; CI has no step for it yet (closed in E34's review) | M | E38 |

### 2d — Freedom over automation

| ID | Task | Size | Needs |
|---|---|---|---|
| E34 | `advance` as a free switch + advice screen + kill switch. **Deletes earned automation.** **Four decisions were the user's (2026-09-15).** (1) The kill switch moves to a new project file, `.sdlc/automation.json` — a new file, so no shape change (E6's `skills.json` precedent). It could not stay in `config.yaml`: that file is installed and hash-managed by `yad update`, so a switch flipped there marked it modified and every later update skipped it. (2) `advance: auto` is free for Build steps AND Shape author steps; a review gate never (rule 1). (3) Engine commands, not skill prose: `yad dial` and `yad kill --reason` / `yad unkill`, recorded with who, when and why (rule 7). (4) The trust log stays, as the advice screen: `yad dial` prints a step's run record and never refuses on it. **Deleted:** the trust threshold, the earn check in `set-dial`, the "earned but manual" nudge and its fleet count, and `trust_threshold` / `locked_steps` / `kill_switch` in `config.yaml`. The engine never read any of them, and the module config ships with the skills in one `yad update`, so this is a skill-side removal rather than a file shape. **Decisions closed on the way.** `locked: true` sits on every seeded Shape step, author steps included, and three readers — the dial stamper, `yad doctor`'s `dials:review-auto` and `yad migrate` — read it as "a gate", which pinned every Shape author step to human. One rule, `isGateStep`, now answers for all three: `type: review+approve`, then the catalogue's `kind`, then `locked` only on an id the catalogue does not know. No file changes. A Shape author step's dial is project-wide in `automation.json`, not in `state.json`, because `state.json` is CI's alone on a verified Product; a Build step's dial stays on its lane in `build-state`, where `yad-run` reads it, and `yad dial` refuses a lane step `yad-run` has not written yet. **A Shape `auto` is recorded, not acted on**: nothing drives a Shape step on its own until E26 — the E7 pattern, and every surface that prints it says so. An `automation.json` that will not parse reads as the kill switch ON and is never written over. `yad doctor` fails on a `kill_switch: true` left in `_bmad/sdlc/config.yaml`, because nothing reads it now and that team's switch would otherwise be silently off. **Closed in review:** a gate asked with no `--to` answers `human` (`why: gate`) instead of refusing, because `yad-run` asks about every step it walks, the merge gate included; a lane dial never refuses on a broken `automation.json`, which only a Shape dial writes; the run record is read before the write and never blocks the dial; an unknown step id is held at human; the Foundation steps are Product-level and refused; `yad unkill` keeps the record it replaces as `kill.previous`; and `yad doctor` warns about an `auto` nothing reads (a Shape author step in `state.json`) and one `locked` no longer holds (a locked Build author step). **Also closed in review, though it was E36/E37's:** `yad skip` / `unskip` / `defer` / `undefer` / `unblock` wrote `state.json` on the user's machine even on a verified Product, where CI is its only writer — a change `ledger-guard` rejects, so it could never land. They now refuse once the epic's ledger is on the default branch, asking the question the `ledger-guard` hook asks (`seededSlugs`), so the hook and the verb never disagree. A new epic's ledger still writes: its seed rides the first review PR (#162) — the epic review on `classic`, where `yad-epic` skips `ui-design` right after seeding, and the analysis review on `analysis-first`, where `yad-analysis` now offers the skip. A skip or deferral written in that window says it cannot be put back once the PR merges, and the `yad next` and `yad doctor` hints for a blocker or a debt say the verb is refused there. `hub.json` is read leniently, as the hook reads it, so a broken config never stops the verbs on a local ledger. A base that cannot be read writes with a warning, as the hook allows it. A lane skip writes `build-state` and is untouched. A CI-side step for a skip is left for later. | M | E4 |
| E18 | Closing records, written when work finishes. **The row was a bare title, so four decisions were the user's (2026-09-15).** (1) A closing record is written **per finished step**, not per finished epic: `done` was the one step state that recorded nothing, while the step-states table above says it must record the artifact. (2) It lives in a **new `closed` key**, not `record`: `record` means why a step is not done, and `blocked` is read by whether it has one. (3) **Shape and Build steps both** get one. A Shape step's record is written by the one closer (`advanceState`, `markInReview`, `repairState`), so on a verified Product CI writes it and rule 9 needs no new path; a Build lane step's by the `yad-run` skill, which carries the trust-log run id, so an `advance: auto` step (E34) points at the run that moved it. (4) **Steps closed before this release are left alone**: nothing back-fills them and `yad doctor` does not warn. The record is `{ by, date, via, pr?, commit?, hash?, mergedBy?, run? }`. `by` is who wrote the record, as on every record; the merger is `mergedBy`, read from the platform (GitHub's PR read now asks for `mergedBy` and `mergeCommit`). `via` is `merge`, `approved` (a gate the `yad-review-gate` skill passes by hand on a Product with no platform, where nothing merges), `review-passed`, `review-opened`, `repair`, `auto` or `human`. The first close wins; the pure closers take the facts as an optional argument, so a caller that knows nothing invents nothing. `yad gate status` prints a review step's record; an author step's has no reader until `yad history` (E20). `gate open` adds the PR number once the PR exists, because the first close wins. **No shape change**: an older release ignores the key and nothing reads `done` differently because it is there — the E34 `advance`-beside-`automation` case, not E41's, which bumped because older releases misread a re-opened chain. Not here: `yad history` reading it (E20), and a record for a whole epic when its last lane ships | S | E4 |

## Wave 3 — Cleanup, history, git discipline

| ID | Task | Size | Needs |
|---|---|---|---|
| E3 | Remove BMAD from the engine. **Add no personas.** **The row was a bare title, so four decisions were the user's (2026-09-15).** (1) **The module config installs to `.sdlc/config.yaml`**, not `_bmad/sdlc/`, and rides `yad update` as `new`, because the skills now read it there. `module-help.csv` is not installed at all: only BMAD's help menu read the installed copy, and its source stays in `skills/sdlc/` for `yad-docs-overview`. The BMAD-only keys leave `config.yaml` (`module_name`, `module_title`, `methodology`, `project_name`, `output_folder` — nothing read them); the two language keys stay, since ten skills read them. (2) **An existing `_bmad/sdlc/` is left, never deleted.** `automation:legacy-kill` (E34) reads a `kill_switch` line in that folder, and a delete that ran before the doctor would hide a switch that is off. `yad doctor` warns `module:legacy-bmad` instead, and says to clear `legacy-kill` first. A BMAD install's own `_bmad/` without our `sdlc/` folder is not a finding. (3) **Persona names and BMAD skill calls are deleted** from the skills (Mary, John, Winston, Sally, Amelia, Murat; `bmad-agent-*`, `bmad-tea`, `bmad-testarch-*`, the three research skills). The role word stays — "the analyst" — and no new name replaces it. BMAD comes back as an optional pool through the toolbox (E50/E51), never as text inside a skill. (4) **`skills/sdlc/install.sh` is deleted**; `yad setup` and `yad check --fix` are the one installer. **No shape change**: no ledger file moves, and the golden project has no `_bmad/`. Not here: this repo's own BMAD install for its maintainers (`_bmad/`, `.claude/skills/bmad-*`), which is a development tool, not the engine | S | E6 |
| E10 | `yad mode solo` / `yad mode team`, with `solo-waived` records. **The row was a bare title, so four decisions were the user's (2026-09-15).** (1) **`mode` is added beside `solo`, and `solo` still decides.** `yad mode` and `yad setup` write `mode: "solo"\|"team"` next to the `solo` flag through one function (`modeFields`), and every reader — the gate, `yad next`, `yad doctor`, CI in the user's repo — keeps reading `solo` for this major (the staged-rename pattern). `yad doctor` warns `mode:disagree` when a hand edit leaves the two apart. Switching to team also turns off the older `review_gate.solo`, which would otherwise keep the gates waived under a file that says `team`. (2) **A solo-waived record is `waived: "solo"` on the closing record (E18)** of a review step that passed while solo was on. `yad gate sync` / `yad gate ci` write it, and so does the `yad-review-gate` skill's hand advance; `yad gate status` prints it. It is never on the author step: the approvals were waived, the authoring was not. (3) **`yad mode solo` needs `--reason`**, because every open gate stops counting approvals, CI's included on a verified Product; `yad mode team` takes one optionally, as `yad kill` / `yad unkill` do. The last change is `mode_set` `{ from, to, by, date, reason }` in the Product config. `yad setup` records one only when a re-run changes an existing Product's mode, with the reason `yad setup`. (4) **Nothing looks back.** A passed gate keeps its record; the command names each open review, which follows the new mode from its next sync. Setting the mode a Product already has writes nothing, or only adds the missing `mode` name. **No shape change**: two optional keys that an older release ignores. Not here: `profile.team_size` is left as it is — counting people is E71, and suggesting a switch is E74. Solo mode applies to the Shape review gates only, as before: the Build lane's `engineer-review` (the `yad-engineer-review` skill) never read `solo`, and E10 does not change that | S | E13 |
| E11 | Support many AI agents, not just Claude Code. **The row was a bare title, so four decisions were the user's (2026-09-16).** **The finding that set the scope:** `SKILL.md` became a cross-agent format and `.agents/skills/` the directory Codex CLI, Gemini CLI, Cursor and GitHub Copilot agreed to read — so the install side was ALREADY multi-agent and every surface still said "Claude Code". Checked against each agent's own documentation on 2026-09-16, never from memory: a guessed skills path installs in silence and is never read. (1) **Scope: name the agents and wire the second hook.** `IDE_AGENTS` maps each directory to the agents that read it, and the `yad setup` menu, `yad doctor` and the docs all read that one table, so the list a user is shown cannot drift from the list that installs. `.cursor` and `.gemini` join as native folder-copy targets — redundant beside `.agents`, offered for a single-agent project. (2) **A fresh `yad setup` defaults to `.claude,.agents`**, which together cover every agent named; the skills are written twice, which is the honest cost. **The recovery fallback stays `.claude` alone and deliberately differs** — a project whose stamp is unreadable is restored to the minimum, not enrolled in a newer default that writes forty skill folders nobody asked for, on a path they did not choose to walk. A directory already present still beats both. (3) **Directory names only.** No `--agent cursor` alias, so the stamped value keeps meaning exactly what it always meant and no rename is staged. (4) **Cursor's `.cursor/hooks.json` is written with the same discipline as `.claude/settings.json`**: additive merge of one owned entry, a file that does not parse is never rewritten, a narrowed matcher is the team's, and neither file enters the `--push` staging allowlist. **The real gap was the ledger guard**, wired for one harness: `HOOK_ADAPTERS` makes it per-harness (file, event key, entry shape, tool matcher, command) and adds Cursor, whose `preToolUse` exit 2 is the deny `cli/hook.mjs` already described. Cursor's `afterFileEdit` is NOT used — it fires once the write has landed, so it could report but never refuse, and reporting is what the CI gate already does. **THE ONE THAT NEARLY SHIPPED, found by asking what Cursor does on a successful ALLOW:** its `preToolUse` is a PERMISSION hook, and its docs say invalid JSON or an off-schema response BLOCKS — empty stdout is invalid JSON, and the exit protocol prints nothing when it allows. Wiring the shared script straight into Cursor would have blocked EVERY file write in a verified project: fail-CLOSED on everything, the opposite of the design, and invisible to any test that only checks that a deny denies. So `yad hook ledger-guard --format cursor` answers `{"permission":"allow"}` / `{"permission":"deny","user_message":…,"agent_message":…}` on stdout (Cursor's schema is snake_case, and an off-schema response still BLOCKS — so a wrong field name refuses the write, passes every "a deny denies" test, and silently discards the text naming `yad gate open`, which is the only reason to speak at edit time), and `hooks/ledger-guard-cursor.sh` — installed ONLY for a project whose targets include `.cursor`, and taking no arguments, since the command string may never be split by a shell — converts every fail-open branch of the shared script into an explicit allow rather than the empty stdout that would block. The allow answer is a fixed literal because a malformed ALLOW is a block; the deny answer carries the reason, and an off-schema rejection there is still a block, which is what a deny wanted — both failure directions are safe, in opposite ways, on purpose. A deny exits 0, because the JSON is the authoritative answer and exit 0 is what tells Cursor to read it. **Two more silent-failure modes were closed rather than shipped, and both would have left `yad doctor` truthfully reporting an entry that never refuses anything:** Cursor's command is a RELATIVE, unquoted, variable-free path, because their docs say a project hook runs from the project root but not whether the string goes through a shell — an unexpanded `$CURSOR_PROJECT_DIR` or a literal quote is a command not found, which fails open; and Cursor does not document its `tool_input` field names, so `payloadPaths` matches any key NAMED like a path rather than guessing a vendor spelling — matching the KEY and never the value, since scanning values would refuse an ordinary edit to a document that merely quotes a ledger path, and a false deny is worse than a miss in a guard that fails open by design. `baseDirFor` reads every harness's project-root variable: reading only Claude's meant that under any other harness a relative payload path was anchored at the git toplevel, which in the documented multi-repo layout is a code repo, so the walk-up found no `hub.json` and allowed an edit it should have refused. `yad doctor` now NAMES the targets that can carry no guard, on the healthy line too — a project whose only target is `.agents` read "guard wired" while nothing local guarded anything. **No shape change, and forward-only:** adding values to `ideTargets` bumps nothing, but an OLDER yadflow reading a stamp naming `.cursor` or `.gemini` filters them as invalid and `needsRepair` rewrites the stamp without them — the skills stay installed, the targets are simply forgotten until the newer CLI runs again. **The guard script's bytes changed**, so every verified project sees `hooks/ledger-guard.sh` as `outdated` on its next `yad check` and refreshes it with `yad update`. **The review of the branch found five defects, all fixed before merge, and three are worth keeping:** (a) the deny field name was camelCase where Cursor's schema is snake_case — the block still happened, so nothing failed, and only the message was lost; (b) `hookMatcherFires` tested the matcher as a regex, but Cursor documents `*` as match-all and `new RegExp('*')` THROWS, so a correctly configured project was warned that its guard was dead; (c) adding `.cursor` to the supported list made `detectedIdeTargetStateFor` enrol every project that merely keeps Cursor RULES in `.cursor/` — no stamp, so the fallback ran, and the next `yad check --fix` would have written 38 skill folders and a hooks.json for a team that never asked. Detection now requires the INSTALL CONTAINER (`<ide>/skills/`, or `.opencode/commands/`), not the bare directory, which is the question it was always trying to answer. **A second review of the fixes found three more:** `yad doctor` checked only the shared script, so a project that lost `hooks/ledger-guard-cursor.sh` — the file Cursor's entry actually names — got a green line while `yad check` called it `new`; and the shipped `ledger-guard.sh` header plus `docs/CLI.md` still told a reader that Cursor is wired to the shared script directly, which is the fail-closed bug itself, written down as instructions. **A third, deep review of the whole branch found fifteen more, and the pattern in nearly all of them is the one this row exists to fix — a guard that reports healthy while doing nothing.** The ones worth remembering: a wired script that lost its EXECUTE BIT read as `ok` because status compared bytes only and `chmod` lives inside `apply()`, so the harness ran a command that could not start and every edit was permitted (fixed in `fileAction`, for every exec-wired script, not just this one); the wrapper resolved its own directory with a bare `cd`, and since the Cursor entry is a RELATIVE path an exported `CDPATH` — an ordinary thing in a login profile — silently pointed it at another tree; it recognised the verdict by PREFIX, so `yad`'s own stdout failure banner in front of the JSON turned a deny into an allow; `--format=cursor` (the equals form) fell through the parser to the positionals, selecting the exit protocol, which under Cursor BLOCKS every write; `mergeHookSettings` rebuilt — i.e. deleted — a `hooks.preToolUse` that was not a list, in a co-owned file on the no-backup path; requiring an install container DROPPED `.claude` from a project whose skills live in `.agents/` but whose `.claude/settings.json` was armed, and `needsRepair` wrote the loss into the stamp; `baseDirFor` never read the payload's own `cwd` and preferred the git toplevel to the process cwd, so a Product in a subdirectory of its repo allowed the edit; the guard never read `tool_name`, so a widened matcher made it refuse READS of `state.json`, which `yad status` and the review gate do routinely; and `yad doctor` said `ok — agent ledger guard wired` for a project where every target was one no harness can hook. Two process findings came with them: the release check's own fresh install silently doubled to two directories and stopped exercising the single-target shape every existing project upgrades from, and five doc surfaces — including `skills/yad-checks/SKILL.md`, which is INSTALLED INTO USER PROJECTS — still told a reader to wire Cursor to the shared script, which is the fail-closed bug written down as instructions. **`--ide-targets` came out of running an upgrade rather than reading the diff:** `ask` returns its default non-interactively and `ideTargets` was reachable only programmatically, so a scripted `yad setup` had no way to decline a default that had just become two directories. **The other install targets were NOT examined for a hook protocol** — the scope closed at Cursor — so "no adapter" means "not wired", never "checked and found wanting". **The four the audit left open are closed too.** (1) Dropping a target now UNWIRES it: `orphanHookActions` takes our entry out of that harness's settings file (leaving the team's, and leaving a `version` we cannot prove we wrote) and removes a wrapper no remaining target needs — otherwise the entry kept firing while every check here, being keyed on the current targets, had stopped looking at it. (2) `yad doctor` now names a hand-wired command that would refuse EVERY write on a permission-hook harness, reported BEFORE the `not wired` branch whose remedy is wrong there (`check --fix` would add ours beside theirs and leave the blocking one in place); it is the one place a command we did not write is judged, it only reports, and it fires only on a command naming our own scripts. (3) `uri`/`url` keys are read when — and only when — the value is a `file://` URL, decoded; an http URL stays ignored, because claiming one would be a false deny. (4) The hook's hot path no longer loads the whole CLI: every command module moved behind one dynamic import in `bin/commands.mjs`, and `yad hook ledger-guard` short-circuits above it, measured at **37ms per call against ~80ms** — paid on every file-editing tool call an agent makes. **Not here:** detecting which agents are actually installed (E50), per-profile skill defaults (E51), agents talking to the engine over MCP (E2), Windows behaviour (Wave 3's own row), and exercising the Cursor wiring against a live Cursor session — it follows Cursor's published protocol and is stated as unverified in the README and `check-gates.md` rather than claimed | M | E6 |
| E62 | **Remove the roster completely** — 399 references, 20 files. **The row was a bare title, so five decisions were the user's (2026-09-16).** **The finding that set the scope:** the roster was not one feature but six jobs — it decided whether a team gate passes (1 owner + `defaultReviewers` reviewers + a domain owner per touched repo, every one a ROLE read from the roster), named who wrote a record (`by`), requested PR reviewers, fed the author allowlist of `verified-commits.sh`, seeded `yad usage`, and carried per-repo owners through `repos.json` `domain_owners`. The first job is the one that could not simply be deleted: with no roster nobody holds `owner`, so every team gate would fail forever, and E7's count may not hold a gate until E72 caps it. (1) **Until E72, a team gate needs ONE approval from someone other than the author.** That is E7's `base`, enforced; the risk step stays advisory and is still printed as the shortfall. It is the only number that cannot lock a small team out without a cap. It is weaker than the role rule on a contract gate, and that is acceptable ONLY because nothing between E62 and E72 is released: publishing happens from `release` and `next` alone, and the user will not release before Waves 3 and 3.5 are done — so no user ever runs the in-between rule. Do not push `next` mid-wave. The golden's pass/fail stays the same on all nine gates (each has at least two approvers); only the `rule` label moves, and the snapshot is updated in the same PR. `defaultReviewers` retires with the role rule, and so does `isEscalated`'s `stories-review` clause; `touchedDomains` stays for PR labels. `requireEngagement` stays — it is not about people. (2) **Data already on disk is left alone and `yad doctor` warns it is unused** — the `roster` key, `repos.json` `domain_owners`, `verified_authors` and a generated `.sdlc/verified-authors` (`people:roster-unused`, `people:domain-owners-unused`, `people:verified-authors-unused`). The `role`/`domain` fields on old approvals are left too, but not warned about: they are history on every existing epic, and a warning per record would be noise that changes the golden `epics` section. Nothing writes any of it; nothing deletes it. **One read survives, decided by the user after review (2026-09-16):** the roster's name → login pairs (`legacyLogins`) are read to recognise the person an older approval or comment names, and for nothing else — see finding (a). No shape change and no migration; a later major may delete them. `yad migrate`'s shape-3 step that rewrites the roster key keeps working, so a v3 project can still upgrade through it. (3) **The author allowlist half of `verified-commits.sh` is deleted**, as the appendix says; the platform signature check stays. Write access to the repo is the allowlist. `yad check --fix` stops generating `.sdlc/verified-authors`. The risk, stated: in a user's repo, once the refreshed script lands, a Verified commit from an email nobody listed now passes CI. (4) **A record's `by` is the platform login** — asked of `gh`/`glab` once per command, recorded as the handle checkpoints already use — **else git `user.name`** when there is no platform, no network or no login. (5) **The smaller jobs, decided with the row:** `yad roster` is removed and prints where the people model went, exiting non-zero; `yad setup` asks for no people (it had no scripted roster flag to keep — the roster section was interactive only, and `--name`/`--email`/`--roles` belonged to `yad roster`); PRs request no reviewers (E68 suggests them from history); `yad usage` builds its people from activity alone and loses `dormant`, `off-roster` and `reviewer-not-reviewing`, all of which needed a stored list. **What the work found, beyond the decisions.** (a) **An upgrade hole, and a first fix that was wrong twice.** An older approval names the person as the roster did (`alice`) while the platform reports the login (`al`), so the first sync after an upgrade treated every such approval as new and bound it to TODAY's content — the #156 hole again. The first fix matched older records by PR and submission time and, on GitLab (no submission time), by list order, preferring "a fingerprint that is not today's". Two reviews broke it. By order, two people's fingerprints swapped, and alice's approval of old text passed a gate once carol withdrew; on a closed step a person's history was deleted or counted twice. And "not today's" was the wrong test of stale: every approval a released yadflow wrote carries a pre-shape-9 fingerprint form the gate still accepts, so a live record read as stale and a stale approval passed. **Now:** (1) the roster's name → login pairs make the match exact (decision 2's one read); (2) without a roster, a record is continued only when nothing else could be it — the same submission time on GitHub, or one unmatched approval against one unmatched older approver of the PR on GitLab; (3) stale means outside `acceptedHashes`, and when one person's records disagree the stale one is kept; (4) still ambiguous, a closed step adds nothing and an open step binds the approval to a stale fingerprint from those records, so it must be given again on a new review. Comment rounds use the same pairs, so the first sync opens no extra round. **A third review broke that version too, in narrower ways, now fixed:** an older record marked `unverified` already names a login, and translating it through a roster name it collided with passed a gate on an outsider's old approval; the GitLab one-to-one guess on a CLOSED step handed one person's history to another, so a closed step now continues a record only on an exact submission time; and approvals were matched one at a time, so the result depended on the platform's list order and a re-sync was not byte-identical — all approvals are now judged against the same older set, and two that would continue one record continue neither. **The two limits the PR first listed, addressed after it opened.** (i) *A roster name two logins share* is no longer matched by name: a record under it is keyed apart from every login, so it is continued only as a record no name can place (an exact submission time, or an open step's one-to-one); otherwise an open step must be re-approved and a closed step keeps it as history. `yad doctor` warns `people:roster-ambiguous`. A name equal to ANOTHER entry's login needed nothing — it was already exact, because an older record under a name was written from that entry and an unlisted login was written `unverified` — so the warning no longer claims it. (ii) *`yad gate open` replaced the review pointer without stamping the old PR on approvals that predate PR provenance* (only `gateCi` did), so the next sync stamped the NEW number, and a re-approval on a GitLab re-opened review stayed stale for good. It now stamps before replacing, as `gateCi` does. **Still not fixable here, handed to E64:** a project whose roster was DELETED before its first post-upgrade sync can only match older records that nothing else could be (fail-closed: re-approve on a new review), and a pointer an OLDER release already moved without stamping stays stale until the review is opened again. The permanent fix is E64's: record the platform login on every approval while the roster still exists, so no later sync needs the roster at all. **A second review round and an upgrade simulation run with the OLDER release (2026-09-16) found more, all fixed:** records under a shared name held two people in one group, so continuing one deleted or restamped the other — the key now carries the submission time, and only the logins the roster gives that name can continue it; `yad gate open` read the PR number from the FIRST number in the URL (`acme/2048/pull/9` → #2048, pre-existing) and, for a URL with no number, skipped the stamp; `people:roster-ambiguous` advised renaming an entry, which hands the older records to whoever keeps the name — a rename then passed a gate on old content in the simulation, so on GitHub an exact submission time now beats the name table, and the hint says to leave the roster alone (GitLab has no submission time, so a rename there can still misattribute; the docs say not to); comment rounds follow the same shared-name rule; `yad usage` reads older records through the same name table, because a roster name can be another person's login and the two landed on one row; and `yad doctor` warns `people:allowlist-gate-stale` for an older `verified-commits.sh` that still enforces the author list — a local-ledger Product's CI files are not refreshed by `yad check --fix`. **Correction to decision 2:** a record the first sync CONTINUES is rewritten under the login and drops `role`/`domain`/`unverified` — keeping `role` on a login-named record would make the next sync read it as an older record and look the login up as a roster name, possibly another person's; the dated `reviews/*--approved.md` keeps the roles. Records nothing continues are left exactly as they were. Each case is a test, and each fix was mutation-checked. (b) **Setup's solo/team default came from the roster's size.** With no mode recorded, an existing Product now defaults to TEAM (the recorded `team_size` decides when there is one): solo waives every approval, and a scripted re-run of an old Product must not fall into it. (c) **`yad usage` would have split people** whose git name differs from their login; a GitHub/GitLab noreply commit address carries the login, so those commits join that login's approvals (case-insensitively — logins are), and the report says others may appear twice. `no-review-participation` is raised only on a row known by login: a bare git-name row cannot see its person's approvals, so "never reviews" would be false. (d) **`isEscalated` lost its `stories-review` clause**, but `touchedDomains` asks for the stories' repos first and on its own, so the stories review PR is still labelled with every touched repo. (e) **`risk-route.sh` and `hub-route.sh`** printed the role rule too and now print the gate's own sum; `hub-route.sh` had no tests and gained them. (f) **The approval-count wording moved:** `rule` is `count`; the surfaces say `count: … — base enforced, risk step advisory — N short`, and the review-PR body `Approvals needed: 1 (enforced) · full count …`. (g) **Smaller review findings, fixed:** an approval record naming nobody counted as one person and could pass a team gate alone — it now counts as nobody, in the predicate and in `gate status`; `gh api user` asked github.com even for a GitHub Enterprise Product, so the login lookup passes the repo's host, and GitHub assignees go back to `@me`, which `gh` resolves on the right host; a GitLab login may start with `_`; `yad doctor` says nothing about an empty `roster` value. (h) **The "not the author" half is the platform's, not the engine's:** GitHub never allows self-approval, GitLab only when the project's approval settings say so, and on a local ledger nothing checks it — the docs now say so instead of claiming it is guaranteed. **Golden:** pass/fail, `missing` and `staleDropped` are unchanged on all nine frozen gates; six `rule` labels moved from `base`/`escalated`/`per-repo` to `count`. **Left on purpose:** this repo's own `.sdlc/hub.json` still carries a roster and `repos.json` names owners, so `yad doctor` warns on it (decision 2); the bytes of the wired `verified-commits.sh` and `risk-route.sh`, the CI files that run verified-commits and the code-repo PR/MR templates changed, so every wired project reads them `outdated` until `yad update`; `createPr` keeps its `reviewers` parameter for E68. **Not here:** the capacity cap and enforcing the risk step (E71/E72), recording platform evidence on approvals beyond the login (E64), reviewer suggestions and CODEOWNERS (E68) | L | E13 |
| E64 | Approvals record platform evidence, not a config role. **The row was a near-bare title, so four decisions were the user's (2026-09-16).** **Two findings set the scope.** (a) GitLab's approvals API returns `approved_at` for each approver, and `readPrGitLab` threw it away — E62's matcher, `login-roster.md` and the E62 row all assumed GitLab has no submission time. Read when present, GitLab gets the same exact-time match GitHub has; an old self-hosted GitLab that does not send it keeps today's behaviour. (b) `yad migrate` cannot stamp the ledger: `approvals.json` and `comments.json` are top-level lists, which `planMigration` never rewrites, and on a verified Product they are CI's alone. So the stamp rides the gate write, beside `stampLegacyPr`. (1) **The stamp rewrites an older record under its login and drops `role`/`domain`/`unverified`** — exactly what E62 does to a record it continues, for the reason E62's correction gives. One record per person per step; where one person's older records disagree, the stale one (outside `acceptedHashes`) is kept. The dated `reviews/*--approved.md` keeps the roles. A name two logins share, a name with no login and an `unverified` record are left alone and still fail closed. Comment records get the same. (2) **It runs on every gate write, over every step of the epic, closed ones included** — `yad gate sync` on the writer path and `yad gate ci` — **and the CI sweep also visits an epic that still holds older records when it has no open review**, because the sweep's job list skips passed steps and would never reach an all-closed epic. `yad doctor`'s `people:roster-unused` counts the older records still under roster names: while any remain it says how they get stamped; at zero it says the roster is safe to delete. (3) **A synced approval records, as audit only: a real `approvedAt` time on both platforms, and on GitHub the review's `commit`, `url` and node `id`.** A GitLab record carries no commit — the MR head is not the approval's commit. The gate still decides on the login and the fingerprint; no numeric user id and no push-access claim are stored (Part 3: compute claims about people, do not store them). (4) **Hand-written (local-ledger) approvals are unchanged**; the docs say plainly they carry no evidence and, with no `artifactHash`, are never revoked when the artifact changes — a gap that predates E64 and gets its own row. **No shape change:** E62 already writes records this way, and an older release ignores optional keys rather than misreading them (the shape-10 test; E18's `closed` key is the precedent). **Build trap:** every GitLab bridge record on disk holds a date-only `approvedAt`, and `"2026-09-15T10:00:00Z" > "2026-09-15"` as text — so a date-only value must read as "time unknown", or the first sync re-binds every same-day GitLab approval to today's content (#156). **Handed over from E62:** while an older roster still exists, record the platform login on every older approval and comment record (the roster's name → login pairs, `legacyLogins`), so no later sync depends on the roster being kept — today a roster deleted before the first post-upgrade sync can only fail closed. **What the build found.** (a) *A stamp without the platform could lock in a wrong name.* E62 lets an exact GitHub submission time beat the name table (a renamed shared name); a record stamped onto a login stopped being "older" and lost that. A stamped approval therefore keeps its old name in `rosterName`, and the exact-time rule matches it as it matched a role-bearing record. The evidence keys are recorded as `commit`, `url` and `reviewId`. (b) *The wired sweep never runs a bare `yad gate ci`*: it calls `--branch … --merged` per recently merged review, and a run that advances nothing did not commit. So decision 2's "sweep" is every `--merged` run, and the stamp is a reason to commit in its own right, like the shape-8 move; a verified Product with no merged review in the window is stamped on its next merge. (c) *A GitLab record written before E64 holds a date*, so the no-roster one-to-one rule must still apply when the approval now carries `approved_at`, and such a record takes the platform's time once without taking today's fingerprint. (d) A Product with no platform never needs the stamp (nothing matches logins), and doctor says the roster can go. **An adversarial review and an upgrade simulation built with v3.18.1 and pre-E64 main (2026-09-17) found more, all fixed:** the stamp merged two people a renamed roster gives one name when GitLab had synced them the same day (both records held the same date), and a gate passed on one's approval of old content — records are now merged only when every one holds the same submission TIME and `pr`, so on GitLab a person's role records usually stay for the roster to match on their review's next sync; one malformed record in any epic threw inside the `gate ci` stamp and `yad doctor`, stopping every merge; the `gate ci` stamp ran before the jobs, so a job that threw left other epics stamped but uncommitted — it now runs after them, skips epics the run synced or failed, and treats an uncommitted `reviews/` file as dirty so it is never committed; `yad gate sync` discarded the stamp on an epic with no review PR on file, so doctor's advice repeated for ever; `yad usage` lost the login on a stamped record. Each case is a test, and each guard was mutation-checked. **A second review of those fixes found one more, fixed:** an older record whose `artifact` is empty or names a folder, in the merged review's OWN epic, threw inside `gateSync` and stopped that merge — an empty artifact is now unreadable, a group whose live fingerprints cannot be computed is left as it is, and a stamp failure is named while the sync goes on; the stamp also moved after the `pr` backfill, so one review's role records merge on the first write, and a stamped comment keeps `rosterName`. **Two holes the simulation found in E62's matcher, not caused by E64, handed to the next `fix(gate)` PR (the user chose a separate PR, 2026-09-17):** on GitHub, when two people once shared a roster name and BOTH approved content that later changed, (i) with the roster kept after one entry was renamed, one person's exact time claims the other's name group and `repOf` hands back the first stale record, so a later time reads as a newer review and both approvals re-bind to today's content; (ii) with the roster deleted, one person claims the name group by exact time and the other claims the same group again through the orphan path (orphans are not filtered by `replaced`, and `claims` counts only orphan picks). Both passed the gate on changed content in the simulation; the fix is to claim records per review, not per name group. **Fixed in that follow-up PR (`fix/e62-matcher-per-review`, 2026-09-17):** an exact submission time now continues only the older records holding that time, whether or not the name also matches, and a name group continued by time is no longer an orphan; both GitHub cases fail closed in either platform order, in tests and in the simulation. A review of that change found the delete was still per name group — on a closed step, x's review deleted y's history under the shared name (pre-existing) — so records are now claimed per review everywhere: a match by name continues the records holding the approval's own time when there are any, and a closed step keeps a record no review continued. Still a limit, as documented: on GitLab, a renamed shared name with the roster kept can put an older approval on the wrong person, because pre-E64 GitLab records hold only a date. Also seen, smaller: on a closed GitLab step where one person holds a stale and a live record written on different days, keeping the roster merges them to the stale one while deleting it keeps both, so `gate status` wording depends on when the roster goes | M | E62 |
| E65 | Risk-tag → path map. No names in it | S | E62 |
| E66 | Escalate by count | S | E65 |
| E67 | Escalate by proven history — a live git query at gate time, nothing stored | S | E65 |
| E71 | Count active people live, three windows, capacity scaled to pace | M | E62 |
| E72 | Base + risk step, capped by capacity. Show and record every cap | S | E66 + E71 |
| E73 | Unmeetable-gate detection and `yad gate lower --reason` | S | E72 |
| E74 | Suggest solo↔team switching when the active count changes | S | E71 + E10 |
| E68 | Suggest reviewers from history; read CODEOWNERS as a hint only | S | E62 |
| E69 | Warn when CODEOWNERS is stale; `yad codeowners --write` | S | E68 |
| E70 | Warn loudly when a repo has no approval rules at all | S | E62 |
| E19 | `.sdlc/index.json` — the one-file front door | M | E13 |
| E20 | `yad history` — list, show, search, all with `--json` | M | E19 |
| E45 | Shard the remaining ledgers | M | E13 |
| E43 | Background capture to `yad/wip/<name>` — artifacts only; WIP branches excluded from CI; no-remote path | M | — |
| E44 | Step-boundary fold into one clean commit — artifacts only; the ledger follows `ledger` mode | M | E43 |
| E46 | File claims — record, show, expire | S | E43 |
| E47 | Step ownership — assign a step to one person | S | E21 |
| E48 | Extend the write guard; document branch protection | M | — |
| E49 | `yad commit --manual --reason` override | S | E48 |
| E79 | `yad new` · `yad init` · `yad join` | M | — |
| E80 | `.yad-workspace.json`; commands work from any repo inside | S | E79 |
| E81 | Detect and fetch missing repos | S | E79 |
| **E1** | **`--json` on all ~22 commands, one stable format** | L | E4 |

## Wave 3.5 — The engine drives the agents

| ID | Task | Size | Needs |
|---|---|---|---|
| E50 | Detect installed skills, agents and MCP servers | M | — |
| E84 | Toolbox manifest — role, installType, version range, fallback | M | — |
| E85 | Toolbox check in setup and update. Offer, never auto-install | M | E84 + E50 |
| E86 | `yad toolbox add / remove / list / check` | S | E84 |
| E87 | Every skill declares its fallback when its tool is missing | M | E84 |
| E88 | Vet every default tool before it becomes a default | S | — |
| E51 | Bind skills to steps, stored in the profile | M | E5 + E50 |
| E52 | Curated recommendation catalogue, versioned separately | M | E51 |
| E54 | `yad step … add / remove / order / test` | S | E51 |
| E55 | Record skill name, version and hash on every run | S | E51 |
| E23 | Agent adapters — one per tool, with copy-paste fallback. **Each adapter owns its harness's skill file format** (Claude `SKILL.md` ≠ Codex `AGENTS.md` ≠ Cursor rules), or E53 is Claude-only | L | E6 |
| E24 | Context builder — the exact minimal prompt for a step | M | E4 |
| E82 | Three-level context: map · pack · files | M | E24 |
| E83 | Cross-repo map with staleness tracking | M | E82 |
| E78 | Inject Foundation decisions into every step's context | S | E76 + E24 |
| **E25** | **Session runner** — start, watch, collect, close, report | L | E23 + E24 |
| E53 | Generate a skill from a step definition, human-approved before binding | L | E51 + E25 |
| E26 | `yad run <step>` and the next-command loop — a **new command**; `yad-run` is a skill only today, and its logic moves into the engine | M | E25 |
| E27 | Use the session runner inside setup and update | M | E26 |

## Wave 4 — The doors to the app

| ID | Task | Size | Needs |
|---|---|---|---|
| E2 | MCP — agents talk to the engine directly | L | E1 |
| E8 | Local checks with signed receipts | L | E1 |
| E9 | Tiny remote verify job | M | E8 |
| E12 | Brownfield scanner — suggest a profile from evidence | M | E5 |
| E77 | Foundation drafted by the scanner, then confirmed | M | E75 + E12 |

## Wave 5 — The missing third

| ID | Task | Size | Needs |
|---|---|---|---|
| E32 | Release phase | L | E22 |
| E33 | Operate phase | L | E32 |

## The estimate — Claude Code implementing, a human reviewing

Claude Code changes the ratio **per kind of task**, not uniformly:

| Kind of task | Speed-up | Why |
|---|---|---|
| Wide mechanical sweeps — E29, E56, E62, E104, E13 | 8–10× | Hundreds of places, test-guarded, no design |
| New commands with clear specs — migrate, skip, defer, history, join | 4–5× | The spec is in this doc; the tests are the spec |
| Design-heavy engine work — E4, E5, E17, E1 | 2–3× | Typing is fast; deciding is not |
| Integration with real external tools — E23, E25, E8, E50 | 1.5–2× | Each adapter is tested against a real agent CLI by a human watching |

| Scope | Tasks | Working days |
|---|---|---|
| **Full plan** | 102 | **~170 optimistic · ~250 realistic** (about a year) |
| **v4.0 cut line** | ~39 | **~60 optimistic · ~90 realistic** (three to four months) |

Assumes one person reviewing and deciding 2–3 hours a day. The bottleneck is not
typing. It is: reviewing ~100 pull requests, clearing the open decisions (each one
blocks a task), a human watching each agent adapter run once, and rework rounds.

## The v4.0 cut line

Not the whole plan — the smallest set that is honestly sellable and that lets the
app start being designed the day it lands.

> **v4.0 = Wave 0 + Wave 1 + Wave 2 + E62 + E64 + E1**

That is: the vocabulary settled, the engine owning the lifecycle, the roster gone,
approvals recorded as evidence, and every command speaking JSON. Everything else is
v4.x or v5.

## Where the risk sits

| Item | Risk |
|---|---|
| **E17** | Everything visual depends on it. The builder cannot exist until the engine, not a skill, owns the lifecycle |
| **E1** | Large, dull, touches every command. Easy to under-estimate |
| **E25** | Every AI tool behaves differently. The fallback path is what saves us |
| **E62** | 399 references across 20 files, plus 126 tests. Deletion, but wide |
| **E17b** | The skills stop hand-writing `state.json`. Easy to forget, and if forgotten the engine and the skills fight over one file |

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

## Tasks — after Wave 2

E50, E51 and E55 are the manual version of this. They ship first and gather the
evidence; the ranker is built on that data, never before it.

| ID | Task | Size | Needs |
|---|---|---|---|
| E89 | Define the brief format — the contract between engine and orchestrator | S | E24 |
| E90 | Yadflow emits a brief per step | S | E89 + E24 |
| E91 | Per-run record: step kind, skill, version, cost, outcome, rework lines, brief size | M | E55 + E44 |
| E95 | Rework measurement — diff the agent commit against the approved version | S | E44 |
| E96 | Cost capture — read agent-reported usage, or measure the prompt we built | S | E25 |
| E99 | Local evidence store and roll-up per step kind, with a minimum-count guard | S | E91 |
| E92 | *(new package)* Skill index — find, read, deduplicate across harnesses | M | — |
| E97 | *(new package)* Static fit scoring — works with zero evidence | M | E92 |
| E100 | *(new package)* Git-only evidence — commit vs discard, edit distance, regeneration. **Needs a harness hook** to record which skill ran, one per harness like E23 | L | E92 |
| E101 | *(new package)* Evidence tiering — use the best signal available, and say which | S | E100 + E99 |
| E98 | *(new package)* Benchmark harness — fixed briefs, popular skills, published results | M | E92 |
| E102 | *(new package)* Benchmark distribution — versioned file, refreshes without a release | S | E98 |
| E103 | *(new package)* Version-triggered benchmark re-runs | S | E98 |
| E93 | *(new package)* Ranker — shortlist with reasons and a cost estimate | L | E92 + E91 |
| E94 | *(new package)* CLI and library surface | M | E93 |

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
