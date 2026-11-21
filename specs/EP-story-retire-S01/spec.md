# Spec — EP-story-retire-S01: a gate reopen or repair with --push checks the branch before it writes

Story: `EP-story-retire-S01` (epic `EP-story-retire`), engine repo. Issue: engine #632.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad gate reopen <epic> <step> --reason … --push` (`gateReopen`, `cli/gate.mjs`) writes `state.json`,
`approvals.json`, the product-PR records (`product-prs.json` and its legacy mirror) and lowers the story and
artifact `status:` lines (`lowerStatuses`) BEFORE it runs `preflightGuardReadiness`, `branchToCommitOn` and
`guardDefaultBranch`. On a branch that is not the default one the guard refuses, but the files are already
changed and left uncommitted. A re-run on the default branch then refuses too: the step already reads as
reopened ("has not been approved yet"). `yad gate repair <epic> --push` (`gateRepair`) has the same order: it
writes `state.json` before the guard, so a re-run finds nothing to repair and the fix is never committed.

`yad repo refresh --push` (`runRepo` in `cli/repo.mjs`) has the same order too: it re-packs each repo and
rewrites `.sdlc/repos.json` before `publishCodeContext` (`cli/repo-publish.mjs`) runs the guard, so a refused
branch is left with a changed registry.

## Requirements

- R1. With `--push`, `gateReopen` runs `preflightGuardReadiness`, `productGit`, `resolveDefaultBranch`,
  `branchToCommitOn` and `guardDefaultBranch` before its first write (after the dry-run and the
  verified-without-`--push` refusals, which write nothing). A refused branch writes nothing and answers
  `written: []`, `committed: false`, `pushed: false`, exit code 1. No "reopened" line is printed.
- R2. With `--push`, `gateRepair` does the same before it writes `state.json`. A refused branch answers
  `written: false`.
- R3. Without `--push` both commands behave as before. `--dry-run` still checks no branch.
- R4. With `--push`, `yad repo refresh` checks the branch (and that it runs in a git repo that is the Product)
  before it packs or writes the registry. A refused branch answers `{ refreshed: 0, repos: [], published: null }`.
  `publishCodeContext` takes the checked branch as `target`, so the guard runs once (its `--allow-branch`
  warning is printed once). Called alone, it checks the branch itself, as before.
- R5. Tests: on a feature branch, `gate reopen --push` (on a local and on a verified Product), `gate repair
  --push` and `repo refresh --push` are refused and `git status --porcelain` is empty; then on the default
  branch the same command commits and pushes. Each fails on the old code.
- R6. `docs/CLI.md` (the `gate repair`, `gate reopen` and `repo refresh --push` rows) and the bridge reference
  say the branch is checked before anything is written.

## Out of scope

- `yad checkpoint --push` (`runCheckpoint`, `cli/checkpoint.mjs`): checked, already guards before its first
  write. The `--retro-ship` shard is written after the guard.
- `yad tidy up` (`runTidy`, `cli/tidy.mjs`): checked, already guards before it folds any shard.
- `publishCodeContext` on its own: checked, its guard comes before its first write (`ensurePackIgnored`).
- The other refusals after the write (a failed `git add`, a failed commit, a failed push): they leave the
  write on disk, as before, and say how to finish it.

## Clarifications

### Session 2026-11-21
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Check the branch on a `--dry-run --push`? → A: no. A dry run returns before the check, as before: it
  writes nothing, and the check can fetch and sets the exit code.
- Q: Does `yad repo refresh --push` count as writing before its guard? → A: yes. The packs and
  `.sdlc/repos.json` were written before `publishCodeContext` ran the guard, so it is fixed the same way.

## Plan

`cli/gate.mjs`: a private `branchForPush(root, { allowBranch, cmd })` holds the five calls and answers
`{ git, branch, defaultBranch }`, or null when the guard refuses. `gateRepair` and `gateReopen` call it before
their first write when `push` is set, and the commit step after the write uses its answer.

`cli/repo-publish.mjs`: `publishTarget(root, { allowBranch })` holds the git-repo and Product checks and the
guard, and answers `{ git, branch }` or null. `publishCodeContext` takes it as `target` (or calls it).
`cli/repo.mjs`: the `refresh` action calls it before the pack loop when `push` is set.

`cli/test.mjs`: the old "gate repair --push refuses off the default branch" test, which asserted the repair
stayed on disk, is rewritten to the new behaviour; new tests beside the reopen and publish tests.

## Tasks

<!-- yad:tasks -->
## T01 — Check the branch before gate reopen and gate repair write, with --push
**Files:**
- cli/gate.mjs
- cli/test.mjs

## T02 — Check the branch before yad repo refresh --push packs and writes the registry
**Files:**
- cli/repo.mjs
- cli/repo-publish.mjs
- cli/test.mjs

## T03 — Say in the docs that a refused --push writes nothing
**Files:**
- docs/CLI.md
- skills/yad-product-bridge/references/bridge.md
<!-- /yad:tasks -->
