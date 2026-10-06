# Yadflow — shared project memory and workflows for teams building with AI

[![npm version](https://img.shields.io/npm/v/yadflow?logo=npm)](https://www.npmjs.com/package/yadflow)
[![CI](https://github.com/abdelrahmannasr/yadflow/actions/workflows/ci.yml/badge.svg)](https://github.com/abdelrahmannasr/yadflow/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/yadflow?logo=node.js)](https://github.com/abdelrahmannasr/yadflow/blob/main/package.json)

Coordinate work, automate repetitive delivery tasks, and keep the decisions behind your software.
Yadflow connects plans, architecture, code and reviews in a versioned project record. Your team and
your AI assistants can use that record across sessions and across repositories, with human approval
where it matters.

*Less coordination work. More shared understanding.*

**[Quickstart](#quickstart)** · **[See it work](#see-it-work)** · **[Documentation](#documentation)**

**What you install.** Yadflow is not another coding assistant. It works with the one you already use.

- **The `yad` command-line tool.** It is written in Node and has no dependencies. It sets up a
  project, tells you the next action, runs reviews, and reads the project history.
- **38 workflow skills.** A skill is a set of instructions that your AI assistant loads for one task,
  such as "write the architecture". The skills run in Claude Code, Codex CLI, Cursor, Gemini CLI,
  GitHub Copilot, Zencoder and opencode.
- **Plain files in git.** Every plan, decision, approval and link lives as a readable file in a
  repository. There is no database and no server.
- **Checks in your code repositories.** These run on GitHub Actions or GitLab CI. One check, for
  example, makes each change name the task it belongs to.

The name: *yad* (**يد**) is Arabic for "hand". The hand is the person who decides.

## See it work

The running example is a small shop. It has a **checkout feature**: customers pay in the mobile app,
and merchants see a queue of pending orders. Two later pieces of work build on it:

1. **A fix.** Tests never proved that the queue leaves out fulfilled orders, so a fix adds that test.
2. **A change.** Merchants want the queue sorted by pickup time.

The checkout feature and the fix are real records in this repository's [`epics/`](epics) folder.
The recording below adds the change. It runs real `yad` commands on a new local project, in team
mode, with made-up people. The one pre-written file is the change's plan, which your AI assistant would
normally write. That step is labelled on screen.

![Terminal recording: yad history lists the checkout feature and its fix. yad thread shows which version of each document applies. yad epic new starts a linked change that keeps the feature's architecture, contract and UI. yad assign and yad next show the owner and the next action. yad gate refuses to move on before anyone approves; a teammate approves, and the review passes. yad history search and yad thread then show the updated record.](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/media/feature-change.gif)

*Recorded from the yadflow source with vhs. To re-record it, see
[`docs/media/feature-change.tape`](docs/media/feature-change.tape).*

## What it helps with

| Benefit | What gives it to you today |
| --- | --- |
| **Reusable project context** | Plans, architecture, the shared contract (the agreed interface between repositories, such as API endpoints), stories and reviews are files in one repository. Skills read them before they write. `yad history` lists and searches past work. |
| **Clear ownership and handoffs** | `yad next` prints the single next action for each piece of work, with its owner. `yad assign` gives a step to one person. `yad claims` shows who is editing which file right now. Owners and claims are advice, not locks. |
| **Less repetitive delivery work** | Skills draft each document and stop for review. `yad ship` makes the commit and opens the pull request with the template filled in, and suggests reviewers. On Claude Code and Cursor, a hook (a small script the assistant runs after each edit) saves every draft for you. Setup wires the checks into each repository. |
| **Traceable decisions** | Each approval is tied to the exact contents of the file. If the file changes, the approval no longer counts. Later changes link to the work they change, and `yad thread` shows the whole chain. |
| **Reviews you control** | Every planning step waits for a person to approve it. Reviews happen in real pull requests (GitHub) or merge requests (GitLab), or locally with no platform. The Review Companion sums up a change and answers questions about it. |

## How it fits together

Three words come up everywhere:

- **Product repository.** One git repository that holds the project record: plans, decisions,
  approvals and history. It usually has no product code in it.
- **Code repository.** A repository where the code lives, such as `backend` or `mobile`. Yadflow adds
  checks to it and links each change back to the plan.
- **Feature thread.** A feature plus every later change and fix that builds on it, linked by a
  `parent` field.

Work moves in two parts. **Shape** plans the work in the Product repository. Its steps are the epic,
the architecture, the UI design, the stories and the test cases. An **epic** is one feature or
change, and a **story** is one piece of it for one or more repositories. Each planning step stops
until a person approves it. **Build** makes each story real in each code repository. The steps
are: spec, implement, checks, ship, and a human code review.

<!-- Source: docs/diagrams/work-and-memory.mmd — edit the .mmd and run `npm run diagrams` to regenerate -->
<img src="https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/diagrams/work-and-memory.svg" width="340" alt="A loop. The project record feeds people and AI assistants, who plan a change. A human review approves it or asks for changes. The approved change is built in the code repositories, then checked and code-reviewed. The merged outcome is recorded, and the next task starts from the updated record.">

*How work and the record feed each other. Not every arrow is automatic: people approve, merge and ask
their assistant for the next step.*

The complete map of every step, check and gate is in the
[full workflow diagram](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/diagrams/sdlc-overview.svg).
It is large, so open it full size.

## Quickstart

**You need:**

- Node.js 18 or newer
- git
- an AI assistant from the list above

The GitHub CLI (`gh`) or GitLab CLI (`glab`) is optional. Without either one, reviews run locally.

**1. Install the command and create a project.** Run this in a terminal, in a folder that is not
inside a git repository:

```bash
npm install -g yadflow@latest   # installs the yad command
yad new acme                    # creates acme/product/ and runs the guided setup
```

Setup asks a few questions: solo or team, one repository or several, GitHub, GitLab or no platform,
and which assistant folders to install the skills into. Then it creates these:

- `acme/product/` — the Product repository, with the skills and the `.sdlc/` settings
- `acme/.yad-workspace.json` — this lets `yad` find the Product from inside any code repository the
  Product lists

It creates nothing online. At the end it prints the commands that put the Product on GitHub or GitLab,
for you to run when you are ready.

![yad new acme — creates acme/product/ and runs the guided setup, then prints the commands that put the Product online](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/media/setup-wizard.gif)

**2. Ask for the next action.** Run this in the terminal:

```bash
cd acme/product
yad next        # prints the single next thing to do; run it any time
```

**3. Start your first feature.** Open `acme/product` in your AI assistant and type this instruction
to it (not into the terminal):

```text
Run the yad-epic skill: customers can check out their cart in the mobile app,
and merchants see a queue of pending orders.
```

**What success looks like:** the assistant writes `epics/EP-<name>/epic.md`, opens its review, and
stops. `yad next` then says the epic review is waiting. How the review passes depends on the platform:

- **With GitHub or GitLab:** a teammate approves the review pull request and it merges. Then run the
  `yad gate sync` command that `yad next` prints, unless your CI does it for you.
- **With no platform:** a teammate runs `yad gate approve EP-<name> epic.md --by <their name>`, then
  anyone runs `yad gate advance EP-<name> epic.md`.

In solo mode no approval is needed. Merging your own pull request (then the same `yad gate sync`,
unless CI runs it), or `yad gate advance` with no platform, is the human decision. After that, `yad next` names the next step.

**Other ways in:**

| You have | Run | Then |
| --- | --- | --- |
| Existing repositories | `yad init`, in the folder that holds them | Run the `yad-backfill` skill first. It records what already exists. |
| One existing repository with all the code | `yad setup --brownfield --monorepo`, inside it | The same: run `yad-backfill` first. |
| A team that already uses Yadflow | `yad join <Product clone URL>` | It clones the Product and every repository it lists and sets up this machine. Last, it records you as a team member (`yad member add`): your accounts and verified emails, on a branch of its own with its own pull request. |

**Small changes.** Not every change needs the full route:

- `yad epic new <id> --profile chore` gives a short route with just the epic and the stories. This
  route cannot change the shared contract.
- Commits of type `chore`, `ci`, `build` or `test` (the start of the commit title, for example
  `chore:` or `chore(deps):`) do not need a task link.
- `yad skip` and `yad defer` pass over optional steps, such as the UI design.

**Already using Yadflow?** Follow [staying up to date](docs/CLI.md#staying-up-to-date). Coming from
3.x, read [upgrading to 4.0](docs/migrations/upgrading-to-4.md) first, then follow the
[step-by-step upgrade guide](docs/migrations/upgrade-guide-3x-to-4x.md).

## How the project record evolves

When shipped work needs to change, you do not edit the old plan. You start a **linked change**. The
`yad-change` skill sorts the change into one of four kinds:

- a defect fix
- a behavior change
- a contract change
- a new capability

The kind decides which documents must be written again. The skill then starts a new epic with
`yad epic new --type change --parent <epic> --inherits <documents>`. Documents it inherits are not
copied. They point back to the parent's approved files.

<!-- Source: docs/diagrams/feature-evolution.mmd — edit the .mmd and run `npm run diagrams` to regenerate -->
<img src="https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/diagrams/feature-evolution.svg" width="720" alt="The checkout feature has two children: a fix that adds a missing queue test, and a change that sorts the queue. The feature's architecture, contract, UI and other stories still apply. The change replaces the epic text and retires one old queue story. The current picture for the next task combines what still applies, the fix's story and tests, and the change's epic text.">

*The checkout thread. The fix is a real record in `epics/`; the change is the one the demo adds.*

`yad thread <epic>` prints the **current truth**: which epic each document comes from today.

- **A document written again** (the epic, architecture, contract or UI design) comes from the epic
  furthest down the thread (the longest chain of parents back to the original feature) that does not
  inherit it and whose route has the step that writes it. A skipped step still counts. When two
  epics are equally far down, the one whose ID sorts last wins. Dates play no part.
- **Stories and test cases add up** across the thread.
- **Retired stories drop out.** A change can retire a parent story with `supersedes`.

Two rules keep this honest:

- **The view includes drafts.** `yad thread` names the epic that will rewrite a document as soon as
  that epic's `epic.md` is written, even as a draft, before the document itself is written or
  reviewed.
- **Only approved work can be inherited.** A new epic can inherit a step only after that step and its
  review are finished.

When every story of an epic has shipped, the epic is **sealed**. New behavior then needs a new linked
epic. A CI check enforces this when it can reach the Product repository.

**Keeping the record fresh.** Nothing refreshes in the background, except the draft-saving hook.
Yadflow gives you explicit checks, and each one says who acts:

| Record | How it is checked | Who refreshes it | Enforced? |
| --- | --- | --- | --- |
| Approvals | Tied to the file's exact contents | A person approves again | Yes. An outdated approval does not count at the gate. |
| Shared contract | A lock file holds its hash | The architecture skill locks it again | Yes. A CI check always requires a contract change to be declared, and checks the lock when it can reach the Product. |
| Code snapshots of each repository | Out of date once the repository moves on | `yad repo refresh`, then the `yad-connect-repos` skill for the code map | No. `yad doctor` and `yad repo list` warn. |
| Product index (`.sdlc/index.json`) | A hash of its inputs | `yad` commands, or CI at merge | No. `yad doctor` warns. |
| Documentation sites | `yad docs sync` (check only by default) | The `yad-docs` skills | No |
| Drafts in progress | — | A hook saves each edit (Claude Code, Cursor). Elsewhere, run `yad capture`. | No |

**What it does not do:**

- It does not record your chats with the assistant.
- It does not guarantee that a person or an AI reads the record correctly.
- It does not track deployments. An approved plan says what was agreed. The build log says what
  shipped.

## Reviews and human control

*AI builds. The hand decides.*

The record is worth trusting because people approve what goes into it.

- **Planning steps.** Each one stops at a review gate. It moves on only when the approvals arrive,
  review comments are resolved, and the pull request merges. With no platform, `yad gate advance`
  checks the same approval rule. The local gate records the name typed with `--by` and cannot check
  who typed it, so a team that needs proof of who approved should review on GitHub or GitLab.
- **Required approvals.** The base count is enforced. Extra approvers for risky areas (the contract,
  auth, payments) are advice.
- **Build steps.** A team can switch a Build step to advance on its own with `yad dial`. `yad kill`
  switches every step back to manual in one command. The engineer code review is always a person.
- **Checks on every change.** Each change must name its task (spec-link). A contract change must be
  declared and locked again (contract-check). Commits must carry a signature that GitHub or GitLab
  marks as verified (verified-commits; it is skipped, with a warning, when there is no platform).
  To make these checks block a merge, see [branch protection](docs/branch-protection.md).
- **Pair review.** The `yad-pair-review` skill walks you through a change one risky part at a time.
  It asks you questions and keeps a private log of how your reviewing improves. It never blocks a
  merge by itself.

## Compatibility and limitations

| Area | Support |
| --- | --- |
| Operating systems | Linux and macOS are fully tested in CI. On Windows, the agent hooks run natively, and the rest of the tool is not yet fully tested. See [platform support](docs/CLI.md#platform-support). |
| Node.js | 18 or newer |
| AI assistants | Claude Code, Codex CLI, Cursor, Gemini CLI, GitHub Copilot, Zencoder, opencode. See [which agent reads which folder](docs/CLI.md#which-ai-agents-are-supported). |
| Hooks | The draft-saving hook runs in Claude Code and Cursor only. The hook that stops an agent editing CI-owned files is added only when CI owns the approval record, and also runs only in those two. The Cursor wiring follows Cursor's published hook format but has not yet been tried in a live Cursor session. Other assistants rely on the CI checks. |
| Git platforms | GitHub and GitLab for review pull requests and CI. With no platform, reviews run locally with `yad gate`. |

## Available now and planned

**Available now:**

- workspace setup
- the Shape and Build steps with review gates
- linked changes and `yad thread`
- `yad history`, `yad next` and `yad usage`
- `yad standup`, a daily status for each team member — what they did since the last working day, what they are on now, and what is waiting — rebuilt live from git, the ledgers and the platform, facts only
- `yad detect`, which lists the skills, agents, MCP servers and plugins installed for each AI agent
- `yad toolbox list`, which shows the external tools yadflow can use, which ones you have, and what happens without each; `yad toolbox add` / `remove` record the tools your team uses, and `yad toolbox check` lists the ones not ready on your machine (`yad setup`, `check`, `update` and `join` print the same list, and never install anything); each skill that uses a tool reads the same answer and says what it does without it
- `yad skill recommend`, which lists hand-picked skills from the recommended skill collections for each step, why each fits, and the command to bind one; it binds nothing, and every pick was checked against its source
- draft saving, claims and owners
- the CI checks
- the Review Companion

**Planned, not built yet** (see the [roadmap](docs/roadmap-idea-1.md)):

- a context brief for each task: E24, E82, E89 and E90
- a cross-repository map with its own staleness tracking: E83
- a release and deployment phase: E32
- a single handoff view, an explicit `superseded` status, one combined freshness report, and a
  browsable example project: E126 to E129

## Documentation

- **Learn:** the [guided tutorial](https://abdelrahmannasr.github.io/yadflow/tutorial/) (setup to
  your first shipped feature) · the [team guide](TEAM-GUIDE.md) · the
  [terminology and workflow report](https://abdelrahmannasr.github.io/yadflow/)
- **Reference:**
  - [every `yad` command](docs/CLI.md#commands)
  - [working together: capture, claims, owners, fold](docs/CLI.md#working-together-capture-claims-owners-and-fold)
  - [troubleshooting and error codes](docs/CLI.md#troubleshooting-yad-doctor--error-codes)
  - [all 38 skills](docs/SKILLS.md)
  - [the by-hand walkthrough](docs/WALKTHROUGH.md)
- **Upgrade:** [staying up to date](docs/CLI.md#staying-up-to-date) ·
  [upgrading to 4.0](docs/migrations/upgrading-to-4.md) ·
  [step-by-step upgrade guide](docs/migrations/upgrade-guide-3x-to-4x.md)
- **Project:**
  - [CONTRIBUTING.md](CONTRIBUTING.md)
  - [SECURITY.md](SECURITY.md)
  - [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
  - [RELEASING.md](RELEASING.md): a person decides every release, and merging to `main` never
    publishes
  - [RESEARCH-NOTES.md](RESEARCH-NOTES.md)
