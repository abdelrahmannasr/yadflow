# Yadflow Team Guide — how to use the workflow with 1 product hub + 3 code repos

**Yadflow** (*yahd-flow* — from **يد**, Arabic for "hand"): the AI-driven SDLC where a human hand
moves every gate. On npm as `yadflow`.

This is the short, plain-language version of `README.md`, written for a developer team. If you only read
one page before starting, read this one. The full reference is in `README.md`.

---

## 1. The big picture

### Your four repos

You will have **four separate git repos**, each with one job:

```
  yadflow         ──►  the SKILLS SOURCE
  (this repo)          You install the workflow skills from here, and pull updates from here.
                       No real product work happens inside it.

  product-hub     ──►  the THINKING
  (new repo)           All epics, contracts, stories, reviews, and state.
                       Lives under: epics/EP-<slug>/

  code-repo-1     ──►  the CODE
  code-repo-2          Real application code. Each story's spec lives here too,
  code-repo-3          under: specs/<story-id>/  — and every PR links back to its
                       story in the product hub.
```

```mermaid
flowchart LR
    classDef hub fill:#fcf3cf,stroke:#b7950b,color:#000
    classDef code fill:#d6eaf8,stroke:#2471a3,color:#000
    src["yadflow<br/>skills source"]
    phub["product-hub<br/>epics · contracts · stories · state"]:::hub
    r1["code-repo-1"]:::code
    r2["code-repo-2"]:::code
    r3["code-repo-3"]:::code
    src -. install skills .-> phub
    phub -- connect-repos:<br/>cache code-map --> r1
    phub -- connect-repos:<br/>cache code-map --> r2
    phub -- connect-repos:<br/>cache code-map --> r3
    r1 -. specs & PRs link back .-> phub
    r2 -. specs & PRs link back .-> phub
    r3 -. specs & PRs link back .-> phub
```

**The handoff rule:** everything *up to and including the locked contract* lives in the **product hub**.
Everything *from the spec onward* (specs, tasks, code) lives in each **code repo**.

### The whole workflow, end to end

Setup is one-time. The **front half** is human-gated and runs once per epic in the hub; the **build
half** runs once per story per code repo; **automation** is opt-in and earned. `yad-status` reads it
all; `yad-hub-bridge` mirrors front-half reviews to real PR/MRs on the hub.

```mermaid
flowchart TD
    classDef gated fill:#fdebd0,stroke:#ca6f1e,color:#000
    classDef earns fill:#d6eaf8,stroke:#2471a3,color:#000
    classDef locked fill:#eaecee,stroke:#566573,color:#000,stroke-dasharray:5 3
    classDef artifact fill:#fcf3cf,stroke:#b7950b,color:#000
    classDef sentinel fill:#d5f5e3,stroke:#1e8449,color:#000

    subgraph SETUP["0 · One-time setup (team lead, per project)"]
      direction TB
      inst["install skills<br/>+ wire each repo"]
      conn["yad-connect-repos<br/>cache each repo's code-map"]
      inst --> conn
    end

    subgraph FRONT["A · Front half — product hub · human-gated · once per epic"]
      direction TB
      an["yad-analysis<br/>optional → analysis.md"]:::artifact
      ep["yad-epic<br/>epic.md · assigns EP-&lt;slug&gt;"]:::artifact
      ar["yad-architecture<br/>architecture.md + locked contract.md"]:::artifact
      ui["yad-ui<br/>ui-design.md + DESIGN.md"]:::artifact
      st["yad-stories<br/>repo-tagged stories"]:::artifact
      gAn{{"gate · analysis"}}:::gated
      gEp{{"gate · epic<br/>base: owner + reviewer"}}:::gated
      gAr{{"gate · architecture<br/>escalated: + repo owners"}}:::gated
      gUi{{"gate · UI · base"}}:::gated
      gSt{{"gate · stories<br/>per-repo owners"}}:::gated
      rfb(["ready-for-build"]):::sentinel
      an --> gAn --> ep --> gEp --> ar --> gAr --> ui --> gUi --> st --> gSt --> rfb
    end

    subgraph BUILD["B · Build half — per story, per code repo"]
      direction TB
      sp["yad-spec<br/>→ specs/&lt;story&gt;/"]
      im["yad-implement<br/>1 task = 1 branch = 1 commit"]:::earns
      ck["yad-checks<br/>spec-link · contract-check · build/test/lint"]:::earns
      prm["open PR/MR + yad-pr-template route"]
      eng{{"yad-ship · engineer review<br/>human · never automated"}}:::locked
      merged(["merge → build-log.json"]):::sentinel
      sp --> im --> ck --> prm --> eng --> merged
    end

    subgraph AUTO["C · Automation — earned & reversible"]
      direction TB
      run["yad-run<br/>automation dial + trust-log.json"]:::earns
      kill["kill switch → all human_approve"]
      run --- kill
    end

    conn --> an
    rfb --> sp
    run -. drives earned back steps .-> im
    bridge["yad-hub-bridge<br/>review PR/MR ↔ file ledger"]:::gated
    bridge -. syncs approvals .-> gEp
    status["yad-status — read-only view over all of it"]
    status -. observes .-> FRONT
    status -. observes .-> BUILD
```

**Legend.** 🟨 **artifact** = an author step writes a file and stops · 🟧 **gate** = a human review
that must pass (`open → comment → approve → advance`) · 🟦 **earns automation** = a back step that
can later auto-advance once it proves itself · ⬜ dashed **locked** = the engineer review and every
front state, **permanently human**.

---

## 2. The workflow has two halves

- **Front half = decide.** Done once per epic, in the **product hub**. Always human-approved — nothing
  auto-advances. This is where you agree on the epic, the architecture, the locked contract, the UI, and
  the stories.
- **Back half = build.** Done once per story, per code repo, **inside that code repo**. Spec → implement →
  check → ship.

Each step writes a file and then **stops at a gate**. A human moves it forward. That is the whole idea.

---

## 3. One-time setup (the team lead does this once)

**a. Create the product hub repo.** Just an empty git repo. You don't need to scaffold anything — the
first `yad-epic` run creates `epics/EP-<slug>/` and its state files for you.

**b. Make sure your 3 code repos exist.** Each is its own separate git repo (its own `.git`).

**c. Install everything with the CLI.** From the product hub repo, run the guided setup — it installs the
skills into the IDE dirs, detects the hub platform, connects your code repos, and wires each one (CI gates,
PR/MR template, review-comment scaffold):

```bash
cd <product-hub-repo>
npx yadflow setup
```

> Re-run `npx yadflow check --fix` after any workflow update — it reports what is
> missing / drifted / stale and reconciles only what changed (it never re-asks for what you already
> answered).

<details>
<summary>Manual fallback (no CLI)</summary>

```bash
git clone https://github.com/abdelrahmannasr/yadflow.git && cd yadflow
mkdir -p ~/.claude/skills
for s in yad-analysis yad-epic yad-architecture yad-ui yad-stories \
         yad-connect-repos yad-review-gate yad-spec yad-implement yad-checks \
         yad-pr-template yad-review-comments yad-hub-bridge yad-ship yad-backfill \
         yad-run yad-status; do
  rm -rf ~/.claude/skills/$s && cp -R skills/$s ~/.claude/skills/$s
done
```

Re-run this block after you `git pull` updates into `yadflow`.
</details>
>
> **Alternative:** if you'd rather not have each person install, commit the `yad-*` skill folders into
> the product hub repo itself (under `.claude/skills/`). Then anyone who clones the hub gets the skills
> automatically. The user-level install above is the recommended default.

**d. Wire each code repo once.** From inside the hub (or with the repo path), run for each of the 3 repos:

```text
yad-checks          repo:<repo> action: wire   # installs the CI gates (merges with existing CI, never clobbers)
yad-pr-template     repo:<repo> action: wire   # installs the PR/MR template + risk routing
yad-review-comments repo:<repo> action: wire   # installs the PR/MR review-comment scaffold
```

> **Wiring is additive.** `yad-checks` detects any CI you already have and *merges* the gates in
> (GitHub: a separate `yad-checks.yml`; GitLab: an `include:` of `.gitlab/ci/yad-checks.yml`) — it
> never edits a foreign workflow. Re-running any `wire` is a no-op.

**d2. Wire the product hub itself** (so the front-half review can run through real PRs on the hub):

```text
yad-connect-repos action: detect-hub                              # records the hub's platform in .sdlc/hub.json
yad-connect-repos action: roster login:<gh-login> name:<yad-name> role:<owner|reviewer>   # once per reviewer
yad-pr-template     repo:hub action: wire                         # hub's front-half PR/MR body template
yad-review-comments repo:hub action: wire                         # hub's review-comment scaffold
yad-checks          repo:hub action: wire                         # hub-flavored gates (owner-set / contract-locked / approvals-present)
yad-hub-bridge      action: wire                                  # event-driven gate sync (CI runs `yad gate ci` on approve/request-changes/merge)
```

The roster maps each reviewer's GitHub/GitLab **login** to their SDLC **name + role**; domain-owners are
derived from each repo's `domain_owner` in `repos.json` (not retyped). With the hub on a platform, the
front-half gate opens a review PR per artifact and `yad-review-gate action: sync` pulls approvals/
comments back. No platform (or `bridge_enabled: false`)? The gate just runs file-only — skip d2.

With the gate-sync CI wired, you usually don't run `sync` at all: every approval, change request, and
merge on a review PR triggers it in the hub's CI, and the ledger update is committed straight to the
hub's default branch (`git pull` to see it). CI never approves or merges — the merge click stays human.
GitLab caveat: a bare approval is only picked up by the ~15-min scheduled sweep (one-time schedule +
`SDLC_GATE_TOKEN`; recipe in the skill).

**e. Connect your code repos to the hub (so the brain knows what's already built).** From inside the
hub, run once per code repo — and again any time you add a new one:

```text
yad-connect-repos action: connect repo:<repo> path:<path-or-git_url> domain_owner:<who>
```

This registers the repo in `.sdlc/repos.json` and caches an AI-readable picture of it (a Repomix pack +
a lightweight **code-map** of its existing endpoints/events/data-models/modules, secret-scanned). The
front-half steps then read that map so they don't re-design or contradict code that already exists.
It clones/fetches as **you** (your own SSH key or git credential helper — GitHub *or* GitLab, no stored
tokens). Greenfield with no code yet? Skip this — the brain just proceeds. When a repo's code moves,
`yad-connect-repos action: refresh repo:<repo>`; to see freshness, `action: list`.

**f. Optional tools.** The workflow uses these if present and **degrades gracefully** (and records it)
if they're missing: **Spec Kit** (`/speckit.*`), **Impeccable** (`/impeccable …`), **Repomix**
(`npx repomix`, used by `yad-connect-repos` and `yad-backfill`), **CodeRabbit** (advisory AI review).
You can start without any of them.

---

## 4. Onboarding a team member (every developer, copy-paste)

1. Clone the **product hub** and the **code repos** you'll work in.
2. Install the skills once (same block as step 3c above):

```bash
git clone https://github.com/abdelrahmannasr/yadflow.git && cd yadflow
mkdir -p ~/.claude/skills
for s in yad-analysis yad-epic yad-architecture yad-ui yad-stories \
         yad-connect-repos yad-review-gate yad-spec yad-implement yad-checks \
         yad-pr-template yad-review-comments yad-hub-bridge yad-ship yad-backfill \
         yad-run yad-status; do
  rm -rf ~/.claude/skills/$s && cp -R skills/$s ~/.claude/skills/$s
done
```

3. That's it. Open Claude Code **in the product hub** to work on epics; open it **in a code repo** to
   build stories.

To run a skill, just ask your agent by name — e.g. *"run `yad-epic`"*. All state is plain files
you can also read and edit directly.

---

## 5. Running an epic — the front half (in the product hub)

Do these in order. After each author step, the matching review opens and **waits** — you clear it with
`yad-review-gate` (`action: open → comment → approve → advance`).

| # | Run this | It produces | Then approve at |
|---|----------|-------------|-----------------|
| 0 *(optional)* | `yad-analysis` | `analysis.md` — the analyst's discovery brief (assigns the `EP-<slug>` ID, seeds state) | analysis review |
| 1 | `yad-epic` | `epic.md` (reads `analysis.md` when present; otherwise assigns the `EP-<slug>` ID and seeds state itself) | epic review |
| 2 | `yad-architecture` | `architecture.md` + the **locked** `contract.md` | architecture review *(escalated)* |
| 3 | `yad-ui` | `ui-design.md` + `DESIGN.md` | UI review |
| 4 | `yad-stories` | one file per story, `stories/EP-<slug>-S0N.md`, each tagged with the repos it touches | stories review *(per-repo)* |

Step 0 is **optional**: run `yad-analysis` first for a dedicated, gated discovery pass; skip it
and the epic step does that analyst shaping inline. Each author step opens its own branch
(`<step>/EP-<slug>`) at the start. When all front gates pass, the epic state reaches
**`currentStep: ready-for-build`**. Now you can build.

> **The brain is code-aware.** If you connected your code repos in setup (step 3e), each author step
> first loads the connected repos' **code-maps** — so the epic references what exists, the architecture
> **cross-checks the contract against existing endpoints/models before locking it**, the UI reuses
> existing components, and stories anchor to real modules. Each artifact records what it read in its
> `code-context:` frontmatter. If a repo's code has moved since you connected it, the step warns and
> points you at `yad-connect-repos action: refresh`.

**The gate, every time** (`yad-review-gate`) — the same loop for all five reviews. Commenting never
advances; only `advance` moves forward, and only when the rule is met:

```mermaid
flowchart LR
    o["open<br/>show artifact"] --> c["comment<br/>reviewers leave notes"]
    c -->|owner addresses,<br/>edits in place| c
    c --> ap["approve<br/>name + role"]
    ap --> adv{"advance?<br/>rule met?"}
    adv -->|no — tells you<br/>who's missing| o
    adv -->|yes| nxt(["next step"])
```

- `action: open` — show the artifact; reviewers leave comments. *Commenting never advances.* If the hub
  is on a platform (step 3d2), this also opens a review **PR/MR on the hub** for the artifact.
- `action: approve` (name + role) — recorded in `.sdlc/approvals.json`. *Or* reviewers approve/comment on
  the hub PR and you run `action: sync` to pull that platform state into the ledger.
- `action: advance` — moves forward **only if** the rule is met; otherwise it tells you who's still missing.
  (Merging the review PR does **not** advance — `advance` does; the file ledger stays the source of truth.)
- With the hub's gate-sync CI wired (step 3d2), `sync` runs **automatically** on every platform
  approval / change request / merge and commits the ledger to the hub's default branch — the same
  predicate, just triggered by the event instead of a human command.

---

## 6. Building a story — the back half (in a code repo)

From a `ready-for-build` story, do this **inside each code repo the story is tagged with**:

1. **Spec** — `yad-spec story:<id> repo:<repo>` → writes `specs/<story-id>/` (spec/plan/tasks +
   `link.md` back to the story). It *quotes* the locked contract; it never widens it.
2. **Implement** — `yad-implement story:<id> repo:<repo> task:<T0N>` → **one task = one branch = one
   commit**. Repeat per task. The first run installs a `.gitmessage` commit template: the human author
   owns the commit, with a required `Task:` trailer and an optional per-commit `Co-Authored-By:` for the
   AI tool that helped (chosen from `config.yaml` `build.ai_coauthor.allowed`).
3. **Check** — `yad-checks repo:<repo> action: run` → the gates must pass: spec-link,
   contract-check, build/test/lint, and verified-commits (every commit signed with a
   platform-Verified key and authored by a roster-known email — on the hub and every repo).
4. **Open the PR/MR** (the template is already wired) and run
   `yad-pr-template repo:<repo> action: route` to print the required reviewers.
5. **Ship** — `yad-ship` → AI review (advisory) → **engineer approval (a human)** → merge. The ship is
   recorded in `build-log.json` and the story moves to `in-build` → `shipped`.

**Multi-repo story?** A story tagged `repos: [backend, mobile]` just runs steps 1–5 in *each* repo,
independently, all from the **one** locked contract.

**Existing/legacy code?** Run `yad-backfill` first to produce a human-verified spec for the built
feature before changing it.

---

## 7. Who approves what (the gate rules)

From `skills/sdlc/config.yaml` — the base rule is **owner + 1 reviewer**, with escalation on risky
surfaces (`contract`, `auth`, `payments`):

| Review | Who must approve |
|--------|------------------|
| Epic | owner + 1 reviewer |
| UI | owner + 1 reviewer |
| **Architecture + contract** | owner + 1 reviewer **+ a domain owner for every repo in the epic**. The contract surface is hash-locked — changing it invalidates approvals. |
| **Stories** | owner + 1 reviewer **+ the engineer for each touched repo** |
| **Engineer review at ship** | a human engineer — **always, never automated** |

---

## 8. Handy anytime

- **See what's blocking:** `yad-status` (or `yad-status EP-<slug>`) — read-only view of the whole
  chain, every step's status, the contract lock, and which approvals a gate is still waiting on. Start
  here when stuck.
- **Automation is opt-in and earned.** You can ignore `yad-run` entirely at first — every step is
  human-approved by default. Later, safe back-half steps can *earn* auto-advance once they prove
  themselves. The engineer review and all four front steps are **never** automatable.
- **Global "back to manual" switch:** `yad-run action: kill` forces every step to human approval
  instantly; `yad-run action: unkill` restores it.
- **Keep the install in sync with the CLI** (run from the product hub):
  - `npx yadflow check` — report what's missing / drifted / stale (read-only).
  - `npx yadflow check --fix` — reconcile it (re-syncs skills + repo wiring).
  - `npx yadflow update` — apply drift only.
  - `npx yadflow --version` — the installed CLI version.

---

## 9. Naming cheat sheet

IDs are **immutable once assigned** — renaming them breaks every downstream link.

| Thing | Format | Example |
|-------|--------|---------|
| Epic ID | `EP-<slug>` | `EP-istifta-inquiries` |
| Story ID | `EP-<slug>-S0N` | `EP-istifta-inquiries-S01` |
| Task ID | `EP-<slug>-S0N-T0N` | `EP-istifta-inquiries-S01-T03` |
| Branch | `feat/<story-id>-<task-id>-<short-slug>` | `feat/EP-istifta-inquiries-S01-T01-create-inquiry` |
| Commit trailer | `Task: <story-id>-<task-id>` (add `Contract-Change: yes` only if the locked contract surface is touched) | — |

Commits and PR titles follow Conventional Commits (lowercase after the type, e.g. `feat: …`, `fix: …`).

---

## 10. The skills at a glance (what to invoke)

The CLI installs and wires everything; these are the **agents you invoke by name** in your IDE. Full
descriptions are in [`README.md`](README.md) → *Agent skills (all 18)*.

| Skill | When you reach for it |
|-------|------------------------|
| `yad-connect-repos` | Register a code repo with the hub + cache its code-map (setup / new repo). |
| `yad-connect-design` | Connect a design tool (Figma / pencil) so `yad-ui` can materialize the screens (setup). |
| `yad-analysis` | *(Optional)* pressure-test an idea into `analysis.md` before the epic. |
| `yad-epic` | Start a feature: write `epic.md`, assign the `EP-<slug>` ID. |
| `yad-architecture` | Author `architecture.md` + the locked `contract.md`. |
| `yad-ui` | Author `ui-design.md` + `DESIGN.md`; materialize the screens in the connected design tool. |
| `yad-stories` | Break the epic into repo-tagged stories (`EP-<slug>-S0N`). |
| `yad-review-gate` | Review / comment / approve / advance **any** gate. |
| `yad-hub-bridge` | Open the review PR/MR on the hub and sync platform approvals back. |
| `yad-review-comments` | Install the PR/MR review-comment scaffolds. |
| `yad-spec` | Spec a ready story in one repo (Spec Kit ceremony). |
| `yad-implement` | Implement one atomic task as a small branch. |
| `yad-checks` | Wire / run the CI gates (spec-link, contract-check, build/test/lint, verified-commits). |
| `yad-pr-template` | Install the platform PR/MR template + risk routing. |
| `yad-ship` | AI review → engineer review → ship + record. |
| `yad-backfill` | Spec already-built / legacy code so new work doesn't break it. |
| `yad-run` | Drive the back half on the automation dial; kill switch. |
| `yad-status` | Read-only: where an epic is, dials, approvals owed, trust records. |

---

## 11. Want more detail?

- **`README.md`** — the complete reference for every phase, dial, gate, and all 18 skills.
- **`RELEASING.md`** — how the `yad` CLI is published to npm.
- **`epics/EP-istifta-inquiries/`** — a full worked epic (front half + build half) you can copy from.
