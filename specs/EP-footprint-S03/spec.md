# Spec — EP-footprint-S03: recommend a TDD skill and a debugging skill for the Build steps

Story: `EP-footprint-S03` (epic `EP-footprint`), engine repo. Issue: Product #242.
This epic is on the chore route, so it defines no contract surface; this story touches none. The `--json`
change adds fields only.

## Problem

The recommendation catalogue (`RECOMMENDATIONS` in `cli/recommend.mjs`) names a test-first skill for
`implement` (`mattpocock-skills:tdd`) but no debugging skill for `checks`, where a failing gate is fixed.
`yad guide --json` lists `step.skills.recommended` without saying whether each skill is installed, so an
agent may offer a skill the person does not have. And `yad-implement` has no rule for writing the test
first when no TDD skill is bound.

A finding while drafting: in Build, `yad guide` reports one step, `ready-for-build`, and fills
`step.skills.recommended` from `recommendationsFor('ready-for-build')`, which is always empty. So today
the guide never shows the `implement` or `checks` recommendations at all.

## Requirements

- R1. `RECOMMENDATIONS` gets one `checks` row: `mattpocock-skills:diagnosing-bugs`, pool
  `mattpocock-skills`, licence MIT, file
  `https://github.com/mattpocock/skills/blob/v1.2.3/skills/engineering/diagnosing-bugs/SKILL.md`. It was
  read at tag v1.2.3 on 2026-11-21 (its `name` is `diagnosing-bugs`; it does not set
  `disable-model-invocation`; the LICENSE at that tag is MIT). Its `vetted` record is the pool's record
  with its own date: `{ ...MATT, on: '2026-11-21' }` — the shared 2026-10-03 date is not re-used.
- R2. `CATALOGUE.version` moves from 1 to 2, and the test that holds each version to one digest records
  the new digest. `CATALOGUE.checked` moves to 2026-11-21: the E52 test holds that no record is newer
  than the day the list was last checked.
- R3. The `implement` row `mattpocock-skills:tdd` stays as it is.
- R4. Each row of `step.skills.recommended` in `yad guide --json` gains `installed`: `true` or `false` from
  `installedSkillNames` (`cli/skill.mjs`) and the same `names.has(r.skill)` test `recommendRows` uses, or
  `null` when detection could not look, as `yad skill recommend` does. Detection runs only when the step has at least one
  recommendation. `buildGuide` takes a `home` option (default `os.homedir()`) so tests are hermetic.
- R5. In Build, `step.skills.recommended` lists the recommendations for each step an open lane is on
  (not shipped, not skipped), once per step, in lane order; each row also carries `step`. Every other step's rows carry `step` too (the step they were read for).
- R6. `skills/yad-implement/SKILL.md` step 4 gets a tests-first fallback: when no TDD skill is bound to
  `implement`, write or update a test for the task's acceptance criterion first, run it and see it fail,
  then write the code.
- R7. The hand-written loop in `skills/yad-guide/SKILL.md` (step 3, "The skill or tool you will use")
  tells the agent to offer only recommended skills with `installed: true`.
- R8. `docs/CLI.md` describes the new `installed` (and `step`) fields of `step.skills.recommended`, in the
  `yad guide` row and the `yad guide --json` example.

## Out of scope

- A Superpowers `systematic-debugging` row. Its source (github.com/obra/superpowers,
  `skills/systematic-debugging/SKILL.md`, release v7.0.2) and licence (MIT) check out, but Superpowers is
  not a vetted toolbox pool: `recommendationProblems` refuses a row from any pool outside the toolbox's
  three, and adding one is a new toolbox tool with its own E88 record.
- Re-vetting the other catalogue rows, or moving the mattpocock pool to a newer tag.
- Any skill's frontmatter `description:` and the top of a skill body (S01 and S02).

## Clarifications

### Session 2026-11-21
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface, no risk map on origin/main, no auth/payments tag)
- Q: Where do the Build recommendations show? → A: in `step.skills.recommended`, from the current step of each open Build lane, each step once, with a `step` field on each row; `docs/CLI.md` says so.
- Q: Superpowers `systematic-debugging`? → A: leave it out; the reason goes in Out of scope (not a vetted toolbox pool).
- Q: `installed` when detection cannot read the folders? → A: `null`, as `yad skill recommend` does.
- Q: May the agent go on through tasks, implement and checks? → A: yes, recorded `--via auto` and `--ran-by machine`; it stops before any PR.
- Q: Where does "offer only skills with `installed: true`" go? → A: the hand-written loop in `skills/yad-guide/SKILL.md`, step 3.

## Plan

`cli/recommend.mjs` gets the row and the version; `cli/guide.mjs`'s `stepBlock` builds the rows through one
helper that adds `installed` (and `step`), asking `installedSkillNames` only when there are rows. Tests go
with the code they test. The skill text changes are body-only, below the descriptions S01 and S02 edit.
Tasks are stacked: T01 carries the spec commit, T02 and T03 branch from it, so spec-link finds the spec.

## Tasks

<!-- yad:tasks -->
## T01 — Recommend mattpocock-skills:diagnosing-bugs for checks, and move the catalogue version
**Files:**
- cli/recommend.mjs
- cli/test.mjs

## T02 — Mark each recommended skill in yad guide installed or not, and show the Build steps' picks
**Files:**
- cli/guide.mjs
- cli/test-guide.mjs
- docs/CLI.md

## T03 — Write the failing test first when no TDD skill is bound; offer only installed recommendations
**Files:**
- skills/yad-implement/SKILL.md
- skills/yad-guide/SKILL.md
<!-- /yad:tasks -->
