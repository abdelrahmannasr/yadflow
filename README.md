# Yadflow — keep AI-generated code from shipping ungoverned

[![npm version](https://img.shields.io/npm/v/yadflow?logo=npm)](https://www.npmjs.com/package/yadflow)
[![CI](https://github.com/abdelrahmannasr/yadflow/actions/workflows/ci.yml/badge.svg)](https://github.com/abdelrahmannasr/yadflow/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/yadflow?logo=node.js)](https://github.com/abdelrahmannasr/yadflow/blob/main/package.json)
[![report](https://img.shields.io/badge/docs-Yadflow%20report-2471a3)](https://abdelrahmannasr.github.io/yadflow/)

**A governance layer for AI-assisted software engineering — a gated development lifecycle where
AI builds and a human clears every gate.**
*AI builds. The hand decides.* (*yad* — **يد**, Arabic for "hand".) On npm and GitHub as `yadflow`.

> **Not another coding assistant — the governance layer around the one you already use.**
> Yadflow doesn't write your code; it governs how AI-written code ships. Keep Cursor, GitHub Copilot,
> Claude Code, Continue — or hand-written commits. The zero-dependency `yad` CLI and the CI gates
> review the work **no matter who or what produced it.** The workflow skills run today in
> **Claude Code, Codex CLI, Cursor, Gemini CLI, GitHub Copilot, Zencoder and opencode** — see
> [which agent reads which directory](#which-ai-agents-are-supported).

## The problem

AI writes code faster than any team can review it. Left ungoverned, that speed turns into risk:
unreviewed AI-generated changes merge straight into the codebase, architectural decisions get made
by autocomplete, and the trail of *why* a change was made disappears. The faster the team ships with
AI, the harder it gets to keep control of quality, architecture, and accountability.

## What Yadflow is

Yadflow puts a **human gate on every step** of the lifecycle. Each step does its work, writes its
output to a plain file, and **waits** — it never advances until a human clears its gate (by approving,
or in solo mode, switched with `yad mode`, by merging your own PR) — or, for a Build step the team set to `auto`, on its own after a clean run.
Reviews ride real PR/MRs; all state lives in files you
can read, diff, and edit — no database, nothing hidden. The result is a paper trail for every decision
and a hard wall between "AI proposed" and "we shipped it."

It installs with one command (`npx yadflow setup`) and works across one Product + many code repos,
solo or team.

## How the workflow looks

<!-- Source: docs/diagrams/sdlc-overview.mmd — edit the .mmd and run `npm run diagrams` to regenerate -->
![Yadflow SDLC overview — setup, human-gated Shape, per-story Build, automation you switch on](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/diagrams/sdlc-overview.svg)

**Legend:** 🟨 **artifact** (a step writes a file and stops) · 🟧 **gate** (a human review that must
pass) · 🟦 **can run on auto** (a Build step the team may set to advance on its own, with `yad dial`) ·
⬜ **locked** (the engineer review — always a person).

## Quickstart

From your **Product** repo (an empty git repo is fine):

```bash
npx yadflow setup        # 1. guided wizard: install skills, connect repos, wire CI gates
```

Then, in your AI IDE, drive the lifecycle by invoking skills by name:

```text
run yad-epic             # 2. author + gate the "thinking": epic → architecture → UI → stories
run yad-spec   …         # 3. Build: spec → implement → checks → ship (per story, per repo)
```

Every step stops at a gate until a human approves. New here? **Walk it lesson-by-lesson in the
[guided tutorial](https://abdelrahmannasr.github.io/yadflow/tutorial/)**, or read the
[team guide](TEAM-GUIDE.md).

Running `yad` tells you when a new release is out — upgrade with `npm install yadflow -g`, then
`yad update` to re-sync this project's skills. See [staying up to date](docs/CLI.md#staying-up-to-date).
An update rewrites the files yad manages (gate scripts, CI, PR/MR templates) — but not one **you**
edited: yad records the sha of every file it writes, so an edit to one is reported as `modified` and
left alone. A file it has no record of (an install predating that record) is still replaced, but only
after saving a `.yad-orig` backup
([managed files](docs/CLI.md#managed-files-what-yad-owns-and-what-you-edited)).

## What `npx yadflow setup` installs

![npx yadflow setup — the guided wizard installs the yad-* skills, wires the CI gates, and stamps the .sdlc config](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/media/setup-wizard.gif)

The wizard is idempotent and profile-driven (solo/team, greenfield/brownfield, monorepo/separate).
In one pass it produces:

- **The `yad` CLI** — zero-dependency Node (`setup`, `gate`, `commit`, `open-pr`, `ship`, `repo`,
  `thread`, `reconcile`, `usage`, `doctor`), run via `npx` or a global install.
- **38 workflow skills** installed into your AI assistant — Claude Code, Codex CLI, Cursor,
  Gemini CLI, GitHub Copilot, Zencoder and opencode. See
  [which agent reads which directory](#which-ai-agents-are-supported).
- **`.sdlc/` config** — the Product, connected repos, and tool connections
  (design, testing, learning), all as plain JSON you can read and diff.
- **CI gates**, wired into every connected repo and the Product as **GitHub Actions or GitLab CI** —
  spec-link, contract-check, verified-commits, build/test/lint, the feature-thread gates, the advisory
  risk-map check (warns when a code repo's `.sdlc/risk-map` — a risk level per directory, no names — is
  stale, says how many approvers a PR asks for — one more when it touches a `high` directory — and names
  who has worked in that directory in the last 30 days), and the push-on-main **`yad-update-guard`** (which re-checks any direct-to-default commit — e.g. from
  `yad update --push` — with just `verified-commits` + `commit-message`), shipped as CI-agnostic bash
  under `checks/`.
- **An agent guardrail** on a verified Product — `hooks/ledger-guard.sh`, a harness hook that refuses an
  agent the CI-owned gate-ledger write at the moment it tries it and names the command that owns the
  transition, instead of letting it surface as a CI failure twenty minutes later. Harness-agnostic
  (stdin payload, exit 0 allows / 2 denies) and fails open — the CI gate stays the authority.
- **Background capture** on every Product, in both ledger modes (E43) — `hooks/yad-capture.sh`, a
  harness hook that runs `yad capture` after each agent edit. It snapshots every changed Shape artifact
  onto your private `yad/wip/<you>/<epic>` branches, so a draft is never lost and nobody types a git
  command. See [Background capture](#background-capture) below.
- **PR/MR templates** and an opt-in CodeRabbit config.

Your first `yad-epic` seeds the `epics/EP-<slug>/` ledger — state, approvals, and the contract lock —
so the audit trail starts the moment you begin real work. `yad epic new <slug>` does the same seeding
from the CLI when you would rather lay the track before the writing starts.

Before any epic, you can also frame the whole product once: `yad foundation new` seeds the
**Foundation** — the Product level, in `foundation/` — and the `yad-discovery` skill writes its
sections (purpose, scope, MVP, roadmap, stack, repos). It is optional, and each epic reads its approved
roadmap.

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

### Background capture

`yad capture` saves your work in progress without touching your checkout (E43). It takes every changed
file under `epics/` and `foundation/` — except the ledger (any `.sdlc/` folder and `reviews/`; the two
files a person writes there, `contract-lock.json` and `change.json`, are included) — and commits it onto
a private branch per epic, `yad/wip/<your git name>/<epic>`. It uses git's low-level commands in a
throwaway index, so your branch, your staged changes and your files stay exactly as they were, and no
git hook runs.

| What | How |
| --- | --- |
| When | After every agent edit, by a hook yad wires in both ledger modes: Claude Code `PostToolUse` in `.claude/settings.json`, Cursor `afterFileEdit` in `.cursor/hooks.json`. Any other agent or editor: run `yad capture` yourself. Each capture takes every changed artifact, so your own editor's edits ride along |
| Push | A capture commits at once, locally. The hook pushes your capture branches in the background at most once every 5 minutes, with no password prompt and a short timeout, so an edit never waits on the network. `yad capture` by hand pushes straight away. With no remote, or offline, the captures stay local and nothing fails |
| CI | yadflow's own push workflow skips `yad/wip/**`. `yad doctor` names any of **your** workflows a push to `yad/wip/*` would start (no branch filter, `branches: ["**"]`, or a `branches-ignore` that does not name it), so you can add `branches-ignore: ["yad/wip/**"]` |
| Off | `"capture": false` in the Product config (`yad check --fix` then removes the hook), or `YAD_CAPTURE=0` for one shell |

The capture commits are unsigned on purpose — a signing prompt inside a hook would hang the agent — and
each carries `Yad-Epic`, `Yad-Base` and `Yad-Branch` lines, which the later fold into one clean commit
(E44) reads. The push is never forced: if you capture the same epic on two machines, the second push is refused rather than overwriting the first, and a `yad capture` you run by hand says so and names the branch (delete one copy with `git branch -D` to continue the other) — the hook's background push cannot report it. **To remove a capture branch for good** — say a secret was captured — delete it on origin first, then on every machine that has it run `git branch -D yad/wip/<you>/<epic>` **and** `git branch -dr origin/yad/wip/<you>/<epic>` (the second deletes that machine's saved copy of origin's branch; it says so if there is none): a machine that still holds either one rebuilds the branch and pushes it back. On a fresh clone, a capture continues the branch already on origin. Two people with the same git name share branches. The people count that caps review gates
(E71) does not count capture commits.

### The local ledger guard, per agent

In **verified mode** — where CI owns the gate ledger — yadflow installs a local guardrail that stops
an agent hand-editing the gate files, at the moment of the edit rather than twenty minutes later in a
failed pipeline. It needs a hook that can run *before* a write and refuse it. Two agents have one:

| Agent | Wired into | Event |
| --- | --- | --- |
| Claude Code | `.claude/settings.json` | `PreToolUse` |
| Cursor | `.cursor/hooks.json` | `preToolUse` |

Cursor answers this kind of hook in JSON rather than by exit code, and treats an empty answer as a
refusal — so a `.cursor` project also gets a small adapter script, `hooks/ledger-guard-cursor.sh`,
which always replies properly. Without it the guard would have blocked every file write instead of
just the gate files.

Every other directory gets the script (`hooks/ledger-guard.sh`) and no wiring — they have no such
hook, so those agents are guarded by CI alone. `yad doctor` says so by name rather than staying
silent. The Cursor wiring follows Cursor's published hook protocol and has not yet been exercised
against a live Cursor session.

## Your first five minutes

<!-- IMAGE: docs/media/artifact-waiting.png — "A generated epic waits at its gate — nothing advances until a human approves." -->

```text
setup → AI drafts an artifact → ⛔ gate waits → you approve → next step → ⛔ gate waits → …
```

1. **`npx yadflow setup`** — the wizard installs skills, connects your repo, and wires the gates.
2. **Run `yad-epic`** in your assistant — it drafts the epic, then **stops** and writes it to a file.
3. **A gate waits.** Nothing advances until you review it.
4. **You approve** — local, or by merging the review PR/MR.
5. **The workflow continues** to the next step, which stops again.

Every step is the same contract: *AI proposes → a human decides → the trail is recorded.*

## How it works (in five points)

- **Shape = decide.** Once per epic, in the Product: epic, architecture + a locked contract,
  UI, stories, test cases. Always human-gated — nothing auto-advances.
- **Build = make it real.** Once per story per code repo: spec → implement → checks → ship.
- **Every step stops at a gate.** A human moves it forward (local, or by merging a review PR/MR).
  <!-- IMAGE: docs/media/pr-gate.png — "The review gate rides a real PR/MR: approve to advance, comment to block." -->
- **Automation is opt-in.** The team switches a Build step to auto with `yad dial`, which shows that
  step's run record as advice — and `yad kill` holds everything at manual in one command. A review
  gate — the engineer review and every Shape review — is never automatic.
- **Everything is files.** State, approvals, the contract lock, the build log — all plain files under
  `epics/EP-<slug>/`. No database. The audit trail *is* the repo.

## Why not just use Cursor?

Because Yadflow lives in a different layer. Cursor, Claude Code, Copilot, Continue, Roo, and Cline
*generate* code. Yadflow *governs* what happens to it — review, architectural control, and an audit
trail — so you get AI speed without losing control of quality or accountability. They're
complementary: bring your favorite, and Yadflow wraps the engineering process around it.

|               | Your AI assistant        | **Yadflow**                                          |
|---------------|--------------------------|------------------------------------------------------|
| **Layer**     | Writes the code          | Governs how it ships                                 |
| **Output**    | Diffs, completions       | Gated artifacts + a file-based audit trail           |
| **Answers**   | "Write this for me"      | "Should this merge — and who approved it?"           |
| **Review**    | You eyeball the diff     | Human-gated PR/MR, contract lock, switchable automation |
| **Fit**       | Bring your own           | Wraps around all of them                             |

## Review, made a pairing — and a lesson

Reviewing AI-generated code is where governance lives or dies, so Yadflow makes the honest review the
*easiest* path. The **Review Companion** turns any PR/MR into a 60-second trailer, swipe-through cards,
and a grounded chat. **Pair Review** (`yad pair-review`) goes further: the AI walks you through the
change one risk-ordered stop at a time, explains each, then asks you about it — until both sides are
satisfied.

It doubles as a lesson: it teaches a transferable review method, scores you against it, and records
your review-skill growth in a **private, local-only** learning log (`yad status` rolls it up). It's
**soft and additive** — it never blocks a merge on its own, yet any genuine concern it surfaces blocks
like a normal review comment.

## Who it's for

Tech leads and engineering managers who want their team to move fast with AI-assisted development
**without** giving up review, architectural control, or an audit trail — the governance layer around
AI-assisted software engineering, not another code generator.

And because the audit trail *is* the repo, **`yad usage`** turns it into a per-member adoption &
behavior report (HTML/JSON/MD): who authored, reviewed, approved, and shipped, with factual
workflow-hygiene flags — derived read-only, so an EM can see how the team actually uses the flow.

## Documentation

- **[Guided tutorial](https://abdelrahmannasr.github.io/yadflow/tutorial/)** — learn by doing, setup → first shipped feature.
- **[Terminology & workflow report](https://abdelrahmannasr.github.io/yadflow/)** — every term, artifact, gate, and skill on one illustrated page.
- **[TEAM-GUIDE.md](TEAM-GUIDE.md)** — the short, plain-language version for a developer team.
- **[docs/CLI.md](docs/CLI.md)** — the full `yad` command reference, the PR-driven gate, and `yad doctor` codes.
- **[docs/SKILLS.md](docs/SKILLS.md)** — the catalogue of all 38 agent skills.
- **[docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)** — the by-hand, end-to-end path through every phase.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** · **[RESEARCH-NOTES.md](RESEARCH-NOTES.md)** · **[RELEASING.md](RELEASING.md)**
- **[SECURITY.md](SECURITY.md)** — how to report a vulnerability, which versions get fixes, and the supply-chain stance. **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — the community standards for taking part.

---

**Platform support.** Linux and macOS are first-class (CI runs the test suite, bash gates, and the
end-to-end harness on both). On **Windows use [WSL](https://learn.microsoft.com/windows/wsl/)** — native
PowerShell is not yet supported. Requires **Node.js ≥ 18**.

**Releases** are a human decision. Merging to `main` never publishes; a person fast-forwards the
`release` branch, and [semantic-release](https://semantic-release.gitbook.io/) publishes from there
(Conventional Commits → npm, with provenance). See [RELEASING.md](RELEASING.md).
