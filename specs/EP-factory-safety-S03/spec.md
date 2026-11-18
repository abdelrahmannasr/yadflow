# Spec — EP-factory-safety-S03: `yad repo pack`, and skills that call it

Story: `EP-factory-safety-S03` (epic `EP-factory-safety`), engine repo. Issue: Product #213.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

The `yad-connect-repos` and `yad-backfill` skills tell the agent to run `npx repomix` inside the code
repo. There npm reads a `.npmrc` committed in that repo, which can point it at another registry whose
"repomix" then runs. Since #590 `yad repo refresh` packs safely, but it packs only the whole repo, so
the skills had no yad command for a pack of one feature or one area.

## Requirements

- R1. One helper in `cli/setup.mjs` starts Repomix: from a new empty temporary folder with its own
  `package.json`, with the public npm registry named, with absolute paths; the folder is removed after.
  `packRepo` uses it with the same arguments as before.
- R2. `yad repo pack <name> [--include <globs>] [--logs] [-o <file> | -] [--json]` judges the repo
  first (as refresh does) and packs it through that helper. `-o -` puts the pack alone on stdout (every
  yad line goes to stderr) and is refused with `--json`. No `-o` writes the repo's usual pack;
  `--include` needs `-o`, so a partial pack never replaces it.
- R3. A refused folder (a link, a bare-shaped folder) is never packed; neither git nor npx runs there.
- R4. The guide classes `repo pack` as a local write; the agent guard reads `-o` as a flag with a value;
  the activity hook knows the command.
- R5. The skills, their references and the docs tell the agent to run `yad repo pack`, never `npx
  repomix`.

## Clarifications

### Session 2026-11-18
- Q: A new yad command, or safer `npx` text in the skills? → A: a new `yad repo pack` command (the person chose it)
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)

## Plan

Factor `packRepo`'s npx call into `runRepomix(repoRoot, {include, logs, out, report})`; add the `pack`
action to `cli/repo.mjs` and its parsing to `bin/yad.mjs`; class it in `cli/agent-rules.mjs` and
regenerate the guide skill. Tests use the fake launcher of the `packRepo` test: the folder, the flags,
stdout mode, and a refused repo.

## Tasks

<!-- yad:tasks -->
## T01 — Start Repomix from one safe helper
**Files:**
- cli/setup.mjs
- cli/lib.mjs

## T02 — Add yad repo pack
**Files:**
- cli/repo.mjs
- bin/yad.mjs
- cli/argv-flags.mjs

## T03 — Cover yad repo pack
**Files:**
- cli/test.mjs

## T04 — Read -o as a flag with a value in the agent guard
**Files:**
- cli/agent-guard.mjs
- cli/test-agents-file.mjs

## T05 — Class yad repo pack for agents
**Files:**
- cli/agent-rules.mjs
- cli/agent-guide.mjs
- skills/yad-guide/SKILL.md

## T06 — Log yad repo pack in the activity hook
**Files:**
- skills/yad-checks/templates/hooks/yad-activity.mjs

## T07 — yad-connect-repos packs with yad repo pack
**Files:**
- skills/yad-connect-repos/SKILL.md
- skills/yad-connect-repos/references/code-context.md

## T08 — yad-backfill packs with yad repo pack
**Files:**
- skills/yad-backfill/SKILL.md
- skills/yad-backfill/references/backfill.md
- skills/sdlc/module-help.csv

## T09 — Name yad repo pack in the guides
**Files:**
- docs/CLI.md
- docs/WALKTHROUGH.md
- TEAM-GUIDE.md

## T10 — Name yad repo pack in the config and the explainer
**Files:**
- skills/sdlc/config.yaml
- docs/YADFLOW-EXPLAINED.md
<!-- /yad:tasks -->
