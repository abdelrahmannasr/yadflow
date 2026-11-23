# Spec — EP-brain-first-S01: after a refresh, the agent is told to build the brain

Story: `EP-brain-first-S01` (epic `EP-brain-first`), engine repo.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad repo refresh` packs a repo's code context again and stamps `.sdlc/repos.json`. The agent then writes
the code-map again. The project brain (`.sdlc/brain/graph.json`, `yad brain build`) hashes both files, so
after every real refresh `yad brain status` says `behind`. Nothing names the build as the next step:

- No rule in `RULES` (`cli/agent-rules.mjs`) mentions the brain or a refresh.
- `refresh` ends with two hand-off lines (write the code-map again; publish with `--push`) and stops.
  Under `--json` those lines go to stderr, and the result has no field that names a next command.

## Requirements

- R1. `RULES` holds a rule with the id `brain-after-refresh`. Its text says:
  - when: after a repo's code context is packed again (`yad repo refresh`, or a `yad check --fix` that
    repacks a stale repo);
  - order: run it last, after the code-map is written again, and after `yad repo refresh --push` when
    that is run (each of them changes a file the brain reads);
  - what: `yad brain build`, with `--repo <name>` when one repo was packed;
  - asking: without asking (the command's class is `local-write`);
  - never stop for it: when Graphify is not installed or the build fails, tell the person, show the hint
    the command printed, and go on.
- R2. The rule reaches a Product through `agentsBlock()` and `yad guide --json` with no other change. It
  is not added to `pointerBlock()`.
- R3. The rules section of `skills/yad-guide/SKILL.md` is written again by `node scripts/agent-guide.mjs`;
  `--check` exits 0.
- R4. `refresh` names the build when at least one repo was packed in this run:
  - without `--push`: a third hand-off line, after the two it prints today;
  - with `--push`: the same line, after the publish.
  The line names `yad brain build --repo <name>` when exactly one repo was packed, else `yad brain build`.
- R5. The `refresh` result has a new field, `next`: a list of command lines. It holds the one command of
  R4 when at least one repo was packed, and is empty otherwise (every early return included). No field the
  result has today changes.
- R6. A refresh that packed nothing prints no such line.
- R7. `docs/CLI.md`: the `yad repo refresh` rows name the line and the `next` field.
- R8. Tests: the rule id is in `RULES`; a refresh that packed a repo prints the line and holds the
  command in `next` (one repo: with `--repo`); a refresh that packed nothing prints no line and holds an
  empty `next`.

## Out of scope

`yad repo refresh` running the build itself. Any output change in `yad check --fix`, `yad repo sync` or
`yad repo clone`. The skills' words (S02). The `brain-first` rule (S03). The pre-approved command list.

## Clarifications

### Session 2026-11-23
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes, for S01 to S04 when each
  qualifies (chore route, no contract surface, no risk map in this repo, so no file rated high)
- Q: Human-only decisions (security, secrets, contract, changes that cannot be undone)? → A: none found.
- Q: Does `yad check --fix`, which also repacks, get the line? → A: no. The rule's words cover it (decided
  in the stories review).
- Q: Is the line printed with `--push` too? → A: yes. The publish stamps `.sdlc/repos.json`, so the brain is
  behind after it as well; the line comes after the publish.
- Q: Which names go on the command line (review 1)? → A: only one `yad brain build --repo` takes: `safeName`
  from `cli/brain.mjs`, and no other repo with the same name in another case. Otherwise the plain command.
- Q: The words of the line with `--push` (review 1)? → A: it does not say the publish went through. The brain is
  kept on this machine, and the registry is written either way.
- Q: The name and shape of the new field? → A: `next`, a list of command lines, empty when nothing was
  packed. A list leaves room for a later command without a new field.

## Plan

`cli/agent-rules.mjs`: one entry in `RULES`, placed after `local-setup` (the other rule about upkeep on
this machine). `node scripts/agent-guide.mjs` writes the guide skill's rules section. `cli/test-guide.mjs`:
an assert that the id is there, beside the ones for `update` and `local-setup`.

`cli/repo.mjs`, `refresh`: collect the names of the repos packed in this run. After the publish (or after
the two hand-off lines), when the list is not empty, build the command (`--repo <name>` for one name) and
`hand()` it. Return it in `next`; every early `return` of `refresh` gets `next: []`. `cli/test.mjs`: the
tests of R8, beside the `refresh` tests there. `docs/CLI.md`: the two `yad repo refresh` rows.

## Tasks

<!-- yad:tasks -->
## T01 — Add the brain-after-refresh rule
**Files:**
- cli/agent-rules.mjs
- skills/yad-guide/SKILL.md
- cli/test-guide.mjs

## T02 — Name yad brain build at the end of a refresh
**Files:**
- cli/repo.mjs
- cli/test.mjs
- docs/CLI.md

## T03 — Name only a repo the brain build takes, and do not imply the publish went through (review fixes)
**Files:**
- cli/repo.mjs
- cli/test.mjs
- docs/CLI.md
<!-- /yad:tasks -->
