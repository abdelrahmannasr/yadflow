# AI-Assisted SDLC Workflow — Plan

A team workflow that takes a feature from idea to shipped code, with AI helping at every step and engineers in control of the important decisions. Built on top of existing open-source tools, so we build only what is missing.

---

## 1. The goal

Give our team one shared, disciplined way of building features. Every engineer follows the same steps, so the output quality is consistent — like a pure function: same process in, same quality out.

This is **for experienced engineers**, not a no-code tool. It does not replace engineers. It keeps them in charge of the high-level decisions (system design, patterns, stack, UI, ideas) and uses AI to do the heavy lifting and the mechanical work.

Priorities, in order:
1. Code quality and production safety
2. Low review load on a small team
3. Speed of shipping
4. Consistency across projects

---

## 2. The core idea: a state machine

The workflow is a set of **states** (steps). Each state does its work, then waits at a **gate** for a human to approve before moving to the next state.

- The states never change.
- What changes is the **trigger** — who moves the work forward.
- This is what lets us start fully manual and automate gradually, without rebuilding anything.

### Two dials per state

Each state carries two separate settings:

- **Assistance dial** — how much AI helps with the work (none / review / heavy).
- **Automation dial** — who advances the state (a human approves / the machine advances).

Keeping these separate is important. It lets us say "heavy AI help, but a human must approve" — which is exactly the setting for the early design states.

### Automation order: end-first

We automate from the **safe end** toward the **valuable end**:

- The back states (tasks, implement, checks) can move toward "machine advances" first — a mistake there is one revert, caught by gates.
- The front states (epic, architecture, UI design) stay **human-authored with AI assist** the longest, and never auto-advance. This protects the decisions that are the whole point of the system.

---

## 3. The tools we build on (do not rebuild)

| Tool | Role | How we use it |
|------|------|----------------|
| BMAD-METHOD | The workflow engine | Our base. We build our module on top of it using its "BMAD Builder". |
| Spec Kit | Specs, plans, tasks | We run its commands and read its output files. |
| Repomix | Reads existing code | We call it to pack old code so AI can write specs for it. |
| Impeccable | UI design | We use its `document` → `extract` → `craft` commands for design. |

Rule for all tools: **talk to them through their commands and files, never through their internal code.** This keeps every tool swappable and keeps us tool-agnostic.

### What BMAD already gives us (so we don't build it)

- The step engine (workflow runner)
- Quality gates between steps
- A project rules file (`project-context.md`) — works like a constitution
- AI roles (PM, architect, developer, UX)
- Works with any AI model (Claude, GPT, Gemini, GLM, etc.)

---

## 4. What we build — our module

We build a custom BMAD module. It lives in our own repo, stays private, and survives BMAD updates. It contains six pieces. Three are our real value; three are plumbing.

**Our value:**

1. **Two dials** — per-step settings for AI assistance and who advances.
2. **Team review gate** — real engineers comment and approve (owner + 1 reviewer by default, escalate by risk). This turns BMAD from a solo tool into a team tool.
3. **Multi-repo contract** — one locked shared contract (API shape, events, data model) that backend, mobile, and dashboard all obey.

**Plumbing:**

4. **Backfill step** — uses Repomix to read existing code, then AI writes specs for old features so new work does not break them. A human confirms. Gated on touched features only (a change is blocked only until the features it actually touches have specs).
5. **UI design step** — uses Impeccable. For existing projects: `document` reads current UI into a design file, `extract` saves reusable pieces, `craft` makes new designs that match. For new projects: `craft` first, then `extract` to seed the design language.
6. **The glue** — connects BMAD, Spec Kit, Repomix, and Impeccable by passing files between them.

---

## 5. Approval gates

- Default: **owner + 1 reviewer** approves a gate.
- **Escalate by risk**: anything touching the shared contract, auth, or payments needs the relevant domain owners.
- Each gate has an **owner who can advance it**; others are commenters. This avoids the "everyone must approve everything" deadlock.

Contract rule: a task may use the contract but may not silently change it. A change to the shared contract must go back up to the design gate. Any code diff that touches the contract surface fails the check gate unless the contract was updated first.

---

## 6. The full workflow (states)

Front states are human-authored with AI assist; they never auto-advance.

The BMAD agents (from its "BMM" module) that assist each step:

- `analyst` (Mary) — research, brainstorming, raw idea shaping
- `pm` (John) — product requirements, epics, story breakdown
- `architect` (Winston) — technical stack, API design, architecture
- `ux-designer` — UI/UX, wireframes, user journeys
- `sm` / Scrum Master (Bob) — preparing detailed stories for development

The steps:

1. **Epic** — feature owner + technical product owner write a descriptive epic over several iterations.
   - BMAD assist: `analyst` (Mary) to shape the raw idea, then `pm` (John) to write the epic itself.
   - → approve
2. **Team review of epic** — real engineers read, challenge, comment; owner addresses; iterate until approved by reviewers.
   - BMAD assist: `pm` (John) helps the owner address comments and rewrite. (Humans do the reviewing.)
   - → approve
3. **System architecture** — produces the architecture and the **locked shared contract**.
   - BMAD assist: `architect` (Winston).
   - → **review of architecture + contract** (engineers comment, owner addresses with Winston's help, iterate) → approve. Escalates by risk: because this touches the shared contract, it needs the relevant domain owners.
4. **UI design** — frontend engineer + owner design over iterations.
   - BMAD assist: `ux-designer` for UX thinking, working together with Impeccable + Claude Design for the visual design.
   - → **review of UI design** (engineers comment, owner addresses with ux-designer's help, iterate) → approve
5. **Split into user stories** — using the epic, architecture, contract, and UI outputs; each story knows which repos it touches.
   - BMAD assist: `pm` (John) breaks the epic into stories, then `sm` / Scrum Master (Bob) prepares each story in detail for development.
   - → **review of user stories** (each domain engineer reviews the stories that touch their repo, owner addresses with Bob's help, iterate) → approve

Every review step uses the same reusable team-review gate: author → engineers comment → owner addresses and iterates → reviewers approve → advance. Default approval is owner + 1 reviewer, escalating to domain owners for contract/auth/payment changes.

Note: BMAD already creates epics and stories *after* architecture, which matches our ordering — so we are aligned with the tool, not working against it.

Then the build pipeline begins (this part can automate first):

6. **Spec Kit, per story, per repo** — `specify` → `clarify` → `plan` → `tasks` → `analyze` → `checklist`. The heavy specification runs once per story; only `tasks` and below run per atomic task.
   - BMAD assist: `sm` / Scrum Master (Bob) sets up the sprint and story context.
7. **Implement** — small diff, one atomic task = one PR.
   - BMAD assist: `dev` (the Developer agent) writes the code.
8. **Check gates** — build, tests, lint, plus contract check and spec-link check.
   - BMAD assist: `tea` / Test Architect sets up and runs tests.
9. **AI review** — automated first-pass review (e.g. CodeRabbit). A second set of eyes, not the authority.
10. **Engineer review** — a human reads the diff against the spec. Owns the merge.
11. **Ship.**

---

## 7. Where every file lives

One simple rule: **shared thinking lives in the product repo; building lives in each code repo; a link connects them.**

### Product repo (the shared "brain" — all repos see it)

```
product-repo/
  epic.md
  reviews/            comments + approvals
  architecture.md
  ui-design.md        from Impeccable
  contract.md         the locked shared contract
  stories/            one file per story
  (per-step: dial settings + approval records)
```

### Each code repo (its own building work)

```
backend-repo/   /specs/ (spec, plan, tasks) + code + PR  ->  links up to its story
mobile-repo/    /specs/ (spec, plan, tasks) + code + PR  ->  links up to its story
dashboard-repo/ /specs/ (spec, plan, tasks) + code + PR  ->  links up to its story
```

The handover point is exactly where Spec Kit begins: everything before it is shared thinking in the product repo; everything from Spec Kit onward lives inside the specific repo, with a link back to the story.

Because all state (dial settings, approvals, current step) is saved as files, the system can later run automatically by reading those files — nothing is hidden.

---

## 8. The three project types

The same workflow runs for all three; only the one-time setup differs.

- **New project, full AI** — no setup needed; specs written from the start.
- **Existing project, already using AI** — add the spec-link check and mark the "do not touch" zones.
- **Existing project, no AI yet** — start AI on safe tasks only (tests, docs, refactors); run the backfill step before new features touch old code.

---

## 9. Build order (smallest useful version first)

1. **Start with the team review gate** on one existing project, dials set to "human approves everything." This gives the team a shared, disciplined workflow immediately, using BMAD's engine underneath.
2. Add the **UI design step** (Impeccable) and the **backfill step** (Repomix).
3. Add the **multi-repo contract** when a feature first spans more than one repo.
4. Add the **two dials** and begin **end-first automation** only after months of evidence the AI is trustworthy on our codebase.

Add each tool only when it removes a real, measured bottleneck — not before.

---

## 10. Honest cautions

- BMAD is young (v6, parts in alpha) — it has rough edges. Prefer the stable version where possible and test the builder carefully.
- Never let the front states auto-advance — that would quietly turn engineers from authors into rubber stamps, defeating the purpose.
- Keep the shared contract at the right altitude: shared scope, contract, and goal only. Per-repo detail (files, tasks, do-not-touch) stays in each repo.
- If we ever sell this, read each tool's license first (BMAD and Impeccable are open-source with their own rules).
