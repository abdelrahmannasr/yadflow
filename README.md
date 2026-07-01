# Yadflow — keep AI-generated code from shipping ungoverned

[![npm version](https://img.shields.io/npm/v/yadflow?logo=npm)](https://www.npmjs.com/package/yadflow)
[![CI](https://github.com/abdelrahmannasr/yadflow/actions/workflows/ci.yml/badge.svg)](https://github.com/abdelrahmannasr/yadflow/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/yadflow?logo=node.js)](https://github.com/abdelrahmannasr/yadflow/blob/main/package.json)
[![report](https://img.shields.io/badge/docs-Yadflow%20report-2471a3)](https://abdelrahmannasr.github.io/yadflow/)

**A gated software-development lifecycle where AI builds and a human approves every step.**
*AI builds. The hand decides.* (*yad* — **يد**, Arabic for "hand".) On npm and GitHub as `yadflow`.

## The problem

AI writes code faster than any team can review it. Left ungoverned, that speed turns into risk:
unreviewed AI-generated changes merge straight into the codebase, architectural decisions get made
by autocomplete, and the trail of *why* a change was made disappears. The faster the team ships with
AI, the harder it gets to keep control of quality, architecture, and accountability.

## What Yadflow is

Yadflow puts a **human gate on every step** of the lifecycle. Each step does its work, writes its
output to a plain file, and **waits** — it never advances until a human approves it (or, later, until
a step has *earned* the right to auto-advance). Reviews ride real PR/MRs; all state lives in files you
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

## How it works (in five points)

- **Front half = decide.** Once per epic, in the product hub: epic, architecture + a locked contract,
  UI, stories, test cases. Always human-gated — nothing auto-advances.
- **Build half = build.** Once per story per code repo: spec → implement → checks → ship.
- **Every step stops at a gate.** A human moves it forward (file-only, or by merging a review PR/MR).
- **Automation is opt-in and earned.** A safe back-half step can earn auto-advance after it proves
  itself — and a one-command kill switch reverts everything to manual. The engineer review and all
  front states are never automatable.
- **Everything is files.** State, approvals, the contract lock, the build log — all plain files under
  `epics/EP-<slug>/`. No database. The audit trail *is* the repo.

## Review, made a pairing — and a lesson

Reviewing AI-generated code is where governance lives or dies, so Yadflow makes the honest review the
*easiest* path — and, optionally, a **teaching** one. The **Review Companion** turns a PR/MR into a
60-second trailer, swipe-through cards, and a grounded chat. On top of it, **Pair Review**
(`yad pair-review`) runs a guided, two-way walkthrough: the AI walks the engineer through the change
**one risk-ordered stop at a time**, explains each change in depth, then **asks them about it**; the
engineer answers and asks back, until **both are satisfied**. The session doubles as a lesson — it
demonstrates a transferable review method, scores the engineer against it, and records their review-skill
growth in a **private, local-only** learning log (`yad status` rolls it up). It's **soft and additive**:
it never blocks a merge, it rides the same `engagement: verified` signal, and any genuine concern it
surfaces blocks like a normal review comment.

## Who it's for

Tech leads and engineering managers who want their team to move fast with AI **without** giving up
review, architectural control, or an audit trail — the governance layer around AI-assisted
development, not another code generator.

## Documentation

- **[Guided tutorial](https://abdelrahmannasr.github.io/yadflow/tutorial/)** — learn by doing, setup → first shipped feature.
- **[Terminology & workflow report](https://abdelrahmannasr.github.io/yadflow/)** — every term, artifact, gate, and skill on one illustrated page.
- **[TEAM-GUIDE.md](TEAM-GUIDE.md)** — the short, plain-language version for a developer team.
- **[docs/CLI.md](docs/CLI.md)** — the full `yad` command reference, the PR-driven gate, and `yad doctor` codes.
- **[docs/SKILLS.md](docs/SKILLS.md)** — the catalogue of all 37 agent skills.
- **[docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)** — the by-hand, end-to-end path through every phase.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** · **[RESEARCH-NOTES.md](RESEARCH-NOTES.md)** · **[RELEASING.md](RELEASING.md)**

---

**Platform support.** Linux and macOS are first-class (CI runs the test suite, bash gates, and the
end-to-end harness on both). On **Windows use [WSL](https://learn.microsoft.com/windows/wsl/)** — native
PowerShell is not yet supported. Requires **Node.js ≥ 18**.

**Releases** are automated via [semantic-release](https://semantic-release.gitbook.io/) on merge to
`main` (Conventional Commits → npm, with provenance). See [RELEASING.md](RELEASING.md).
