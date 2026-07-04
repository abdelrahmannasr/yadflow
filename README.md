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
> **Claude Code** (plus `.agents`, Zencoder, and OpenCode), and **BMAD is the default packaging,
> not a limitation.**

## The problem

AI writes code faster than any team can review it. Left ungoverned, that speed turns into risk:
unreviewed AI-generated changes merge straight into the codebase, architectural decisions get made
by autocomplete, and the trail of *why* a change was made disappears. The faster the team ships with
AI, the harder it gets to keep control of quality, architecture, and accountability.

## What Yadflow is

Yadflow puts a **human gate on every step** of the lifecycle. Each step does its work, writes its
output to a plain file, and **waits** — it never advances until a human clears its gate (by approving,
or in solo mode by merging your own PR), or, later, once a step has *earned* the right to auto-advance.
Reviews ride real PR/MRs; all state lives in files you
can read, diff, and edit — no database, nothing hidden. The result is a paper trail for every decision
and a hard wall between "AI proposed" and "we shipped it."

It installs as a custom [BMAD](https://github.com/bmad-code-org/BMAD-METHOD) module and works across
one product hub + many code repos, solo or team.

## How the workflow looks

<!-- Source: docs/diagrams/sdlc-overview.mmd — edit the .mmd and run `npm run diagrams` to regenerate -->
![Yadflow SDLC overview — setup, human-gated front half, per-story build half, earned automation](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/diagrams/sdlc-overview.svg)

**Legend:** 🟨 **artifact** (a step writes a file and stops) · 🟧 **gate** (a human review that must
pass) · 🟦 **earns automation** (a back step that can later auto-advance once it proves itself) ·
⬜ **locked** (the engineer review and every front state — permanently human).

## Quickstart

From your **product hub** repo (an empty git repo is fine):

```bash
npx yadflow setup        # 1. guided wizard: install skills, connect repos, wire CI gates
```

Then, in your AI IDE, drive the lifecycle by invoking skills by name:

```text
run yad-epic             # 2. author + gate the "thinking": epic → architecture → UI → stories
run yad-spec   …         # 3. build half: spec → implement → checks → ship (per story, per repo)
```

Every step stops at a gate until a human approves. New here? **Walk it lesson-by-lesson in the
[guided tutorial](https://abdelrahmannasr.github.io/yadflow/tutorial/)**, or read the
[team guide](TEAM-GUIDE.md).

## What `npx yadflow setup` installs

![npx yadflow setup — the guided wizard installs the yad-* skills, wires the CI gates, and stamps the .sdlc config](https://raw.githubusercontent.com/abdelrahmannasr/yadflow/main/docs/media/setup-wizard.gif)

The wizard is idempotent and profile-driven (solo/team, greenfield/brownfield, monorepo/separate).
In one pass it produces:

- **The `yad` CLI** — zero-dependency Node (`setup`, `gate`, `commit`, `open-pr`, `ship`, `repo`,
  `thread`, `reconcile`, `usage`, `doctor`), run via `npx` or a global install.
- **38 workflow skills** installed into your AI assistant — **Claude Code** (`.claude/`) first-class,
  plus `.agents`, Zencoder, and OpenCode.
- **`.sdlc/` config** — the product hub, connected repos, reviewer roster, and tool connections
  (design, testing, learning), all as plain JSON you can read and diff.
- **CI gates**, wired into every connected repo and the hub as **GitHub Actions or GitLab CI** —
  spec-link, contract-check, verified-commits, build/test/lint, the feature-thread gates, and the
  push-on-main **`yad-update-guard`** (which re-checks any direct-to-default commit — e.g. from
  `yad update --push` — with just `verified-commits` + `commit-message`), shipped as CI-agnostic bash
  under `checks/`.
- **PR/MR templates** and an opt-in CodeRabbit config.

Your first `yad-epic` seeds the `epics/EP-<slug>/` ledger — state, approvals, and the contract lock —
so the audit trail starts the moment you begin real work.

## Your first five minutes

<!-- IMAGE: docs/media/artifact-waiting.png — "A generated epic waits at its gate — nothing advances until a human approves." -->

```text
setup → AI drafts an artifact → ⛔ gate waits → you approve → next step → ⛔ gate waits → …
```

1. **`npx yadflow setup`** — the wizard installs skills, connects your repo, and wires the gates.
2. **Run `yad-epic`** in your assistant — it drafts the epic, then **stops** and writes it to a file.
3. **A gate waits.** Nothing advances until you review it.
4. **You approve** — file-only, or by merging the review PR/MR.
5. **The workflow continues** to the next step, which stops again.

Every step is the same contract: *AI proposes → a human decides → the trail is recorded.*

## How it works (in five points)

- **Front half = decide.** Once per epic, in the product hub: epic, architecture + a locked contract,
  UI, stories, test cases. Always human-gated — nothing auto-advances.
- **Build half = build.** Once per story per code repo: spec → implement → checks → ship.
- **Every step stops at a gate.** A human moves it forward (file-only, or by merging a review PR/MR).
  <!-- IMAGE: docs/media/pr-gate.png — "The review gate rides a real PR/MR: approve to advance, comment to block." -->
- **Automation is opt-in and earned.** A safe back-half step can earn auto-advance after it proves
  itself — and a one-command kill switch reverts everything to manual. The engineer review and all
  front states are never automatable.
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
| **Review**    | You eyeball the diff     | Human-gated PR/MR, contract lock, earned automation  |
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

---

**Platform support.** Linux and macOS are first-class (CI runs the test suite, bash gates, and the
end-to-end harness on both). On **Windows use [WSL](https://learn.microsoft.com/windows/wsl/)** — native
PowerShell is not yet supported. Requires **Node.js ≥ 18**.

**Releases** are automated via [semantic-release](https://semantic-release.gitbook.io/) on merge to
`main` (Conventional Commits → npm, with provenance). See [RELEASING.md](RELEASING.md).
