# Spec — EP-factory-prep-S04: every command checks a registered repo folder before acting there

Story: `EP-factory-prep-S04` (epic `EP-factory-prep`), engine repo. Issue: Product #2 (E125), part (a).
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

The Product registers code repos by path in `.sdlc/repos.json`, and anyone who can commit to the Product
can change it. E81 added `judgeRepo`: a registered folder shaped like a bare repo (`HEAD`, `config`,
`objects/`, `refs/`), whose `config` could make git run a command (`core.fsmonitor`), or a link, is
refused before `yad repo` and `yad doctor` run git there. Most other commands still resolve the path and
run git in it, or write files into it, without that check.

## Requirements

- R1. One shared judgement of the registered repos (`judgedRepos` beside `judgeRepo`): a refused or linked
  entry is skipped, with its reason shown; a real checkout is used as today.
- R2. A repo that is not cloned on this machine keeps today's behaviour (for example `check --fix` still
  writes its CI files), unless a folder on its way holds a `HEAD` entry (git there would read that folder).
- R3. The check covers: `open-pr --repo` and `review --repo` (one shared resolver), `risk-map` and
  `codeowners`, `setup`/`init` wiring and CodeRabbit (names printed through `forTerminal`), `check`,
  `check --fix` and `update` (reconcile), `docs`, `usage --repos` (an absolute path is skipped), doctor's
  file checks, `yad map` and its live view, and the repos `yad update` commits in.
- R4. `packRepo` refuses a code-context pack path outside `.sdlc/code-context/` (`codeContextPathOk`).

## Clarifications

### Session 2026-11-17
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface; the engine has no risk map)
- Q: A registered repo not cloned here — skip it? → A: no; the risk is a folder that exists. It keeps today's behaviour.

## Plan

`judgedRepos`, `notRunnableWhy` and `codeRepoFor` in `cli/workspace.mjs`; each caller uses them. Tests in
`cli/test.mjs` put a logging `git` on PATH and prove git never runs in, and nothing is written to, a
bare-shaped folder (`e125Workspace` fixture); each fails when its fix is reverted.

## Tasks

<!-- yad:tasks -->
## T01 — Add one judged list of the registered repos
**Files:**
- cli/workspace.mjs
- cli/test.mjs

## T02 — Judge the repo open-pr and review work in
**Files:**
- cli/openpr.mjs
- cli/review.mjs
- cli/test.mjs

## T03 — Skip refused repos in risk-map and codeowners
**Files:**
- cli/riskmap-command.mjs
- cli/test.mjs

## T04 — Judge repos before setup wires them, and guard the pack path
**Files:**
- cli/setup.mjs
- cli/test.mjs

## T05 — Judge the registered repos once in check and update
**Files:**
- cli/reconcile.mjs
- cli/test.mjs

## T06 — Run git only in judged repos for docs and usage
**Files:**
- cli/docs.mjs
- cli/usage.mjs
- cli/test.mjs

## T07 — Read files only in judged checkouts in doctor
**Files:**
- cli/doctor.mjs
- cli/test.mjs

## T08 — Run git only in judged repos for the map and its live view
**Files:**
- cli/map.mjs
- cli/map-view.mjs
- cli/test.mjs

## T09 — Judge the repos yad update commits in
**Files:**
- cli/update-commit.mjs
- cli/test.mjs
<!-- /yad:tasks -->
