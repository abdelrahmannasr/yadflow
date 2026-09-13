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
| E17b | Rewrite the skills that hand-write `state.json` to call the engine instead. **13 write sites in 9 skills**, not 29 — 29 is how many files mention the file, most of them to say they never touch it. Done: 3 seeds and 6 author-step advances. Left: the `yad-change` threaded seed (E42), the `yad-discovery` front-zero (E75), `yad-backfill promote`, and `yad-review-gate`'s local advance, which has no engine verb because `gate sync`/`ci` both need a platform | M | E17 |
| E6 | Skill binding leaves the code, allows multiple skills per step. **The catalogue keeps its `skill` column as the shipped default**; `.sdlc/skills.json` overrides it per step, written by `yad skill bind` / read by `yad next` (Shape, Build lanes and both orientation lines), `yad epic new`, `yad setup` and the `yad-run` orchestrator. Several skills are a chain (decision 7) with a cost warning. No file shape moved — the binding file is new, not a changed one. Left to E51: a per-profile layer between the project's file and the catalogue, once E50 can detect installed skills | M | E4 |
| E7 | Gate rules per step — **people-free by design**: base + risk step only, never a name or a role. The capacity cap arrives in E72. **Shipped as `gateRuleFor(step)`**: `needed = base + risk step`, read from the risk tags the EPIC records (rule 3 — the file wins, the same discipline as `optionalStepsFor`), counted in distinct PEOPLE, base 1. Two inferences this row left open, now closed in code: `auth`/`payments` ARE the high tier (+1) while `contract` keeps its own larger step (+2), and several tags take the **maximum** step and never the sum — a gate is one decision about the riskiest thing it touches. The tier NAME comes from the winning tag, not from the number, so moving a tag's step later cannot make an `auth` gate print "contract risk". **It is REPORTED, NOT ENFORCED, and that is the decision this row turned on.** Part 3's tier-1 rule is ONE formula — `base + risk_step`, *capped at `active − 1`, floor 1* — and the cap needs the live active count (E71), which E72 then wires in. Enforcing the uncapped half alone deadlocks a small team, and the case is concrete, not theoretical: on a single-repo `architecture-review` the roster rule is satisfied by TWO people when one of them holds reviewer **and** domain-owner, while base 1 + contract 2 asks for three. With no cap (E72) and no `yad gate lower --reason` (E73), that gate would be unpassable — and rule 7 says an escape hatch always exists, which outranks shipping teeth early. So the count is computed, returned (`gateRule` / `have` / `short`) and printed wherever a gate reports itself — and NOT written to disk, so this task changes no file shape and no audit record — while the roster-era role rule is still the only thing that decides `passed`. E72 turns it on with one `missing.push` reading `short`. **A first pass had it ANDed with the role rule**; a review round found the two-person deadlock and the claim "changes no outcome today" that went with it — the same arithmetic this row used to reject a base of 2, one person smaller. **What stays name-based on purpose:** `isEscalated`'s `stories-review` clause (a step name inside a rule) — it triggers the role rule only, and E62 retires both together. **What the count sees that the role rule cannot:** one person holding two roles is two roles and one approver. That shortfall is now visible (and pinned by tests) a whole wave before anything blocks on it. **Rule 6 surfaces:** three of them print one shared sum from `gateRuleSum` — `gate sync` (`2 approved; count (advisory): 3 approvers = base 1 + contract risk 2 — 1 short`), `gate status` (the same sum and shortfall after the distinct-people count) and the generated review-PR body (`**Approver count (advisory, not yet enforced):**` plus the sum). The `--json` bundle carries the rule as an OBJECT (`step.gateRule`), not the sentence. An inherited or skipped step reports no count at all rather than one nobody must meet; solo mode still prints it, so a reader who later switches to team mode can see what each gate will then ask for. **Golden:** pass/fail, `rule`, `missing` and `staleDropped` are byte-identical on the frozen v3 project; its `gates` section gains `gateRule`/`have`/`short`. `have: null` is how the predicate says "nothing was counted here" on an inherited or skipped step, which is not the same fact as zero approvals — the frozen project exercises the inherited half; the skipped half is pinned by a unit test | M | E4 |
| E75 | The Product level — Foundation as a phase with its own gate. **Absorbs `EP-discovery` and `roadmap.md`** | M | E22 |
| E76 | Foundation authoring for greenfield | M | E75 |

### 2c — Escaping steps honestly

| ID | Task | Size | Needs |
|---|---|---|---|
| E35 | `required` moves into the profile; delete `SKIPPABLE_STEPS`. **Done as `optional` on the profile row, not a new `required` field** — E5 already put the mark there, and a second polarity nobody reads would fail the "no unread profile-row field" test. What E35 removed is the engine-wide UNION: `optionalStepsFor(state)` asks the epic's own route (the RECORDED one, even when the chain disagrees — rule 3), an epic with no route at all has nothing optional, and `yad doctor` reports `skip:not-optional`. **E40 prerequisite:** it adds routes SHORTER than `classic`, and `matchLifecycleProfile` breaks ties on the shortest fit — so a pre-shape-6 epic that legitimately dropped a step would match a new short lane on its next `yad migrate`. Stamping `profile` has to reach those epics before the short lanes ship | S | E5 |
| E38 | The full step-state model, incl. `satisfied` and `blocked`. **The decision this row turned on, before any of the rest of it: `blocked` already meant something else.** Every release up to shape 6 wrote `blocked` for "waiting on an earlier step", which is the roadmap's `todo` — one string, two meanings. Keying the two apart on `schemaVersion` was rejected: `yad migrate` never rewrites `state.json` on a VERIFIED project (CI is its only writer, the row is reported `ci-owned`), so such a project sits at shape 6 until its next gate write, and several readers (`doctor`, `artifact-status`) load the file raw with no shape number in hand. **THE RECORD IS THE DISAMBIGUATOR** — `blocked` + no `record` is `todo`, `blocked` + a `record` is a real blocker — which is exact by construction, because no release has ever written a record. That makes the roadmap's "must record" column load-bearing instead of decorative. **Shipped as `STEP_STATES`** — eight rows: the roadmap's seven plus `in_review`, which is `in_progress` on a review gate and which `markInReview` / `advanceState` / `artifact-status` all key on (the table's `in-progress` hyphen is prose; no file and no line of code has ever held the hyphen). **The converse, for E37/E41:** clearing a blocker must move `status` OFF `blocked`; deleting only the record turns the step silently back into a `todo`. **Two questions, not one**, and running them together was the bug the table exists to stop: `passed` (may the chain continue) and `authored` (was the artifact written HERE) are both spelled `status === 'done'` today, which is exactly why a skipped step had to be pre-marked `done` to get past the first and carry a flag to be excluded from the second. Shipped as `isPassed` / `isAuthored` over one `stepStatus`, and ~31 readers now ask one of them. **The legacy encodings are a FLAG BESIDE `done`, not a flag alone** — a first cut read the flag by itself, and a review round found that a hand-typed `skipped: true` would then unblock every step behind it. So `stepStatus` requires the pairing, and `claimsSkipped`/`claimsInherited` answer the separate question of what the file CLAIMS — which is what `gatePredicate`'s route guard and `yad doctor` need to see before they can refuse it. The gate labels `rule: 'inherited'` / `rule: 'skipped'` are frozen golden bytes and did NOT move. **Shape 7**, the first shape that changes a value in place rather than adding a key beside an old one: `blocked`→`todo`, a skip to `status: skipped`, an inherited step to `status: satisfied`, each with a record assembled from what the file already held and nothing invented. Every legacy field is KEPT (rule 3), and `boundHash` stays its own field — drift evidence, not provenance. Rule 3 is held by the READER for this whole major; the direction that genuinely breaks is a 3.x CLI reading a MIGRATED project, which `docs/migrations/shape-7.md` says in as many words rather than leaving to be found. **`build-state/<story>.json` is deliberately not migrated**, and it is the one place the record-as-disambiguator argument is not free: the `yad-run` / `yad-implement` SKILLS write that file, so a rewrite would be undone by their next write — but they are also the one EXISTING writer of `blocked` in the new sense, marking a lane halted on a failed check, a scope overrun or a contract touch. A review round caught three skill instructions doing exactly that under comments here claiming nothing did. They now write a `record` with the halt cause; a lane halted by an older `yad-run` reads as `todo` until the next run rewrites the file, and nothing advances past it either way, so the cost is the word and not the work. **`yad next` gained a `blocked` branch**: naming a skill for a step waiting on a vendor is the one thing the new state exists to stop, so it prints the record instead. **Which reader wants which question** is a table in the header comment, because a review round found it had mis-assigned three of six — `closeAuthorStep` wants `passed` (stamping `done` over a skipped author step destroys the skip's provenance), `stateInvariants` wants `=== 'done'` on the GATE side (`isPassed` there would read a future `deferred` gate above a `todo` author as a violation, and `repairState` would then stamp that author `done` — claiming an artifact nobody wrote), and the three step-over scans want `=== 'skipped'` rather than the claim, so a hand-edited flag is not walked past. **A live blocker survives a gate write:** `markInReview` will not write `in_review` over a `blocked` step (that is the path where the gate did NOT pass, so it would drop the record naming who we wait on and change nothing about the wait), while `advanceState` drops the record WITH the state when the gate does pass — a skip's record is the opposite case and has to survive, because it is the reason that step passed. A verb that CLEARS a blocker is E37's. **Nothing writes `deferred` or `blocked` yet** (E36/E37 do), so per the invisible-rules rule the suite constructs a chain carrying every row of the table and pins each reader by hand | S | E4 |
| E36 | General `yad skip` / `yad unskip` with recorded reason | S | E35 |
| E37 | `yad defer` | S | E36 |
| E39 | Skip at three levels: profile · epic · story/repo | M | E36 |
| E42 | Contract inheritance — reference a lock instead of authoring one | S | E5 |
| E40 | Short profiles — a chore lane and a spike lane. **`chore` is 4 steps** (`epic` + `stories`) and **`spike` is 6** (the analyst's brief in front of the chore lane) — `spike` is `chore` plus `analysis`, because the one thing that separates a timeboxed question from decided upkeep is whether the answer is known. Both drop `architecture`, `ui-design` and `test-cases`, each **absent rather than `optional`**: a skip record for a step the route never had is noise, not an audit trail. Neither drops `epic` (no `epic.md` means no work-item type, no `parent:` lineage and no `yad thread` rollup) or `stories` (it tags the repos, and `stories-review` is the step `advanceState` turns into `ready-for-build` — a lane ending anywhere else claims a Build with nothing in it). **Type and route stay independent**: `--type chore --profile classic` is the right call for large upkeep that does move the contract. **The E35 prerequisite is discharged in code, not by timing**: `stampProfile` matches against `SHAPE_6_ROUTE_IDS`, frozen at the three routes that existed when shape 6 landed. The exposure is real but narrow — any chain built only from `epic`/`epic-review`/`stories`/`stories-review` reads as `chore` now and read as `classic` before — and no chain yadflow has ever seeded is in it, since every shipped seed carries `architecture`. The freeze makes that a property of the code rather than of today's data. **The invariant this broke, found in review:** until now every feature route marked exactly ONE step optional, so "this epic has no optional steps" could only mean "its chain fits no route" — one `notOptional` branch served both. The short lanes mark none, so a healthy `chore` epic was being told its chain matched nothing and sent to a `yad doctor` check that cannot fire. Three branches now, and the four comments that asserted the old equivalence are corrected. The same shape of bug in two more readers: `preconditionsMet` called an off-route step "unknown" when the catalogue knows it perfectly well, and `yad next`'s phase line printed a phase the route never enters exactly as one already passed. The phase mark is taken from the RECORDED route only — matching would grey out two phases on every truncated legacy chain, then flip back on the next gate write. The review-PR checklist had the same fault: it asked every reviewer to confirm a contract re-lock, which a short lane can never do, so that item is replaced on those routes rather than left to be ticked unread. **The contract gap, CLOSED here after review:** dropping the architecture gate drops the contract lock, and `contract-check.sh` treats an unreachable product lock as a deferred note rather than a failure. On a short lane that is not an edge case but the STEADY state, because the lock can never appear — so `Contract-Change: yes` on a short-lane diff is never hard-failed. An UNFLAGGED surface change still FAILs, but only while a real contract-derived spec slice exists to be changed, which a short lane also has no way to produce. The guard is prose in `yad-stories`, `yad-spec` and `yad-implement`, which all now stop and escalate rather than naming an architecture gate the lane does not have. That IS a gate now: `contract-check.sh` FAILs a claimed `Contract-Change` when the epic's ledger directory resolves and holds no lock. Guarded on the epic's `.sdlc/` directory rather than on the product path, because `resolve_product` returns a string without checking the disk — so "this epic is real and has no lock" stays separate from "nothing is checked out here", which still defers exactly as before. `yad-change` threading off a short-lane parent is handled: it seeds the PARENT's chain and route, writes no pointer-lock, and records `parentShortLane`, generalising the stub-parent rule rather than forging an `inherited: true` on a review that never happened | M | E5 |
| E41 | Debt tracking and payback reminders | M | E38 |

### 2d — Freedom over automation

| ID | Task | Size | Needs |
|---|---|---|---|
| E34 | `advance` as a free switch + advice screen + kill switch. **Deletes earned automation** | M | E4 |
| E18 | Closing records, written when work finishes | S | E4 |

## Wave 3 — Cleanup, history, git discipline

| ID | Task | Size | Needs |
|---|---|---|---|
| E3 | Remove BMAD from the engine. **Add no personas** | S | E6 |
| E10 | `yad mode solo` / `yad mode team`, with `solo-waived` records | S | E13 |
| E11 | Support many AI agents, not just Claude Code | M | E6 |
| E62 | **Remove the roster completely** — 399 references, 20 files | L | E13 |
| E64 | Approvals record platform evidence, not a config role | M | E62 |
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
