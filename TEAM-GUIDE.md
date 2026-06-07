# Team Guide — how to use this workflow with 1 product hub + 3 code repos

This is the short, plain-language version of `README.md`, written for a developer team. If you only read
one page before starting, read this one. The full reference is in `README.md`.

---

## 1. The big picture: your four repos

You will have **four separate git repos**, each with one job:

```
  sdlc-workflow   ──►  the SKILLS SOURCE
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

**The handoff rule:** everything *up to and including the locked contract* lives in the **product hub**.
Everything *from the spec onward* (specs, tasks, code) lives in each **code repo**.

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
first `sdlc-author-epic` run creates `epics/EP-<slug>/` and its state files for you.

**b. Make sure your 3 code repos exist.** Each is its own separate git repo (its own `.git`).

**c. Install the skills at the user level** so they work in *every* repo on your machine (the hub and all
code repos):

```bash
git clone <sdlc-workflow-url> && cd sdlc-workflow
mkdir -p ~/.claude/skills
for s in sdlc-author-epic sdlc-author-architecture sdlc-author-ui sdlc-author-stories \
         sdlc-review-gate sdlc-spec sdlc-implement sdlc-checks sdlc-pr-template \
         sdlc-ship sdlc-backfill sdlc-run sdlc-status; do
  rm -rf ~/.claude/skills/$s && cp -R skills/$s ~/.claude/skills/$s
done
```

> Re-run this block after you `git pull` updates into `sdlc-workflow`.
>
> **Alternative:** if you'd rather not have each person install, commit the `sdlc-*` skill folders into
> the product hub repo itself (under `.claude/skills/`). Then anyone who clones the hub gets the skills
> automatically. The user-level install above is the recommended default.

**d. Wire each code repo once.** From inside the hub (or with the repo path), run for each of the 3 repos:

```text
sdlc-checks       repo:<repo> action: wire     # installs the CI gates
sdlc-pr-template  repo:<repo> action: wire     # installs the PR/MR template + risk routing
```

**e. Optional tools.** The workflow uses these if present and **degrades gracefully** (and records it)
if they're missing: **Spec Kit** (`/speckit.*`), **Impeccable** (`/impeccable …`), **Repomix**
(`npx repomix`), **CodeRabbit** (advisory AI review). You can start without any of them.

---

## 4. Onboarding a team member (every developer, copy-paste)

1. Clone the **product hub** and the **code repos** you'll work in.
2. Install the skills once (same block as step 3c above):

```bash
git clone <sdlc-workflow-url> && cd sdlc-workflow
mkdir -p ~/.claude/skills
for s in sdlc-author-epic sdlc-author-architecture sdlc-author-ui sdlc-author-stories \
         sdlc-review-gate sdlc-spec sdlc-implement sdlc-checks sdlc-pr-template \
         sdlc-ship sdlc-backfill sdlc-run sdlc-status; do
  rm -rf ~/.claude/skills/$s && cp -R skills/$s ~/.claude/skills/$s
done
```

3. That's it. Open Claude Code **in the product hub** to work on epics; open it **in a code repo** to
   build stories.

To run a skill, just ask your agent by name — e.g. *"run `sdlc-author-epic`"*. All state is plain files
you can also read and edit directly.

---

## 5. Running an epic — the front half (in the product hub)

Do these in order. After each author step, the matching review opens and **waits** — you clear it with
`sdlc-review-gate` (`action: open → comment → approve → advance`).

| # | Run this | It produces | Then approve at |
|---|----------|-------------|-----------------|
| 1 | `sdlc-author-epic` | `epic.md` (assigns the `EP-<slug>` ID, seeds state) | epic review |
| 2 | `sdlc-author-architecture` | `architecture.md` + the **locked** `contract.md` | architecture review *(escalated)* |
| 3 | `sdlc-author-ui` | `ui-design.md` + `DESIGN.md` | UI review |
| 4 | `sdlc-author-stories` | one file per story, `stories/EP-<slug>-S0N.md`, each tagged with the repos it touches | stories review *(per-repo)* |

When all four gates pass, the epic state reaches **`currentStep: ready-for-build`**. Now you can build.

**The gate, every time** (`sdlc-review-gate`):
- `action: open` — show the artifact; reviewers leave comments. *Commenting never advances.*
- `action: approve` (name + role) — recorded in `.sdlc/approvals.json`.
- `action: advance` — moves forward **only if** the rule is met; otherwise it tells you who's still missing.

---

## 6. Building a story — the back half (in a code repo)

From a `ready-for-build` story, do this **inside each code repo the story is tagged with**:

1. **Spec** — `sdlc-spec story:<id> repo:<repo>` → writes `specs/<story-id>/` (spec/plan/tasks +
   `link.md` back to the story). It *quotes* the locked contract; it never widens it.
2. **Implement** — `sdlc-implement story:<id> repo:<repo> task:<T0N>` → **one task = one branch = one
   commit**. Repeat per task.
3. **Check** — `sdlc-checks repo:<repo> action: run` → the three gates must pass: spec-link,
   contract-check, build/test/lint.
4. **Open the PR/MR** (the template is already wired) and run
   `sdlc-pr-template repo:<repo> action: route` to print the required reviewers.
5. **Ship** — `sdlc-ship` → AI review (advisory) → **engineer approval (a human)** → merge. The ship is
   recorded in `build-log.json` and the story moves to `in-build` → `shipped`.

**Multi-repo story?** A story tagged `repos: [backend, mobile]` just runs steps 1–5 in *each* repo,
independently, all from the **one** locked contract.

**Existing/legacy code?** Run `sdlc-backfill` first to produce a human-verified spec for the built
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

- **See what's blocking:** `sdlc-status` (or `sdlc-status EP-<slug>`) — read-only view of the whole
  chain, every step's status, the contract lock, and which approvals a gate is still waiting on. Start
  here when stuck.
- **Automation is opt-in and earned.** You can ignore `sdlc-run` entirely at first — every step is
  human-approved by default. Later, safe back-half steps can *earn* auto-advance once they prove
  themselves. The engineer review and all four front steps are **never** automatable.
- **Global "back to manual" switch:** `sdlc-run action: kill` forces every step to human approval
  instantly; `sdlc-run action: unkill` restores it.

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

## 10. Want more detail?

- **`README.md`** — the complete reference for every phase, dial, and gate.
- **`epics/EP-istifta-inquiries/`** — a full worked epic (front half + build half) you can copy from.
