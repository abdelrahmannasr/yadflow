# Spec — EP-defect-route-S01: a short lane for a defect or hotfix off a stub

Story: `EP-defect-route-S01` (epic `EP-defect-route`), engine repo. Issue: engine #578.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

A stub is the anchor `yad-stub` mints for a feature that was built before yadflow tracked it. It is
always on the `classic` route. `yad epic new --parent` gives a child its parent's route and refuses any
other `--profile` ("takes its parent's route"), so a one-line defect off a stub must pass every Shape gate
of `classic`. The only way round it today is to seed the fix as a parentless chore, which loses the
thread to the code it fixes.

## Requirements

- R1. `yad epic new <slug> --type defect --parent <stub> --profile chore` (also `--type hotfix`) seeds the
  child on the `chore` route: `epic`, `epic-review`, `stories`, `stories-review`, then ready for Build.
  `--inherits epic` carries the stub's epic and its review by reference (`boundHash: null`, as for any
  stub base) and `stories` is the first step; no `--inherits` leaves `epic` the first step. No
  contract lock is written.
- R2. It is granted only when the parent is an un-promoted stub (`backfillAnchorKind` is `stub`; a
  light-promoted anchor is not) and the type is `defect` or `hotfix`. On this lane `--inherits` naming
  `architecture`, `contract` or `ui-design` is refused with a message saying the lane has no such step
  and that the child carries only the epic, or nothing. A lone `architecture` or `contract` gets this
  message too, not the "inherited together" one.
- R3. Every other case keeps today's answer: a parent that is not a stub, a `change` off a stub, or
  another `--profile` off a stub is refused with "takes its parent's route". A `change` off a stub that
  asks for `chore` is told that only a defect or hotfix off a stub takes the chore lane.
- R4. The seeded child passes `yad doctor`'s epic, type, catalogue, profile, skip and step-state checks,
  and its lineage resolves to the stub's thread.
- R5. The `yad-change` skill offers the short lane for a defect-fix (type `defect` or `hotfix`) off a stub,
  runs it only on the person's yes, and records `"route": "chore"` in `change.json` beside
  `"parentStub": true`, `parent` and the `defect` block's `escape_stage` and `root_cause`. Its triage
  reference, the `change.json` schema in `yad-epic`'s state-schema, the `yad-stub` skill, `docs/CLI.md`
  and `docs/SKILLS.md` say the short lane exists.

## Out of scope

A new named `defect` route in the lifecycle definition (the chore lane is reused). The short lane off a
parent that is not a stub, or off a light-promoted (`documented`) anchor. A CLI command that writes
`change.json` (the `yad-change` skill writes it today, as a person-written `.sdlc/` file). The `--issue`
path of `yad epic new`, which makes a stub parent on its own and passes no `--profile`.
`docs/YADFLOW-EXPLAINED.md`, which names `yad-stub` in one line and no route.

## Clarifications

### Session 2026-11-19
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: A new `defect` route, or the existing chore lane? → A: reuse the existing chore lane: the defect or hotfix child of a stub opts in with `--profile chore`. Nothing new is invented beyond that (the person's decision on #578).
- Q: Does a light-promoted anchor (`backfill-done`) count as a stub here? → A: no. The story names a stub; a light-promoted anchor keeps its route.
- Q: Is the regression test a `test-cases` step on this lane? → A: no. The chore lane has no `test-cases` step; the test is written with the code in Build.

## Plan

`planThreadedSeed` takes the asked-for profile. When the parent is a stub, the type is `defect` or
`hotfix` and the ask is `chore`, it seeds the `chore` chain instead of the parent's, after refusing any
base but `epic`; the "architecture and contract together" check moves after that decision so the lane's
own message wins. Every other case leaves the plan on the parent's route, and `seedThreaded`'s existing
"takes its parent's route" refusal stays, with a hint naming the lane when the parent is a stub. Tests
seed both types off a stub with and without `--inherits epic`, run the doctor checks and the lineage on
the result, and list the refusals. Then the skills and the docs say the lane exists.

## Tasks

<!-- yad:tasks -->
## T01 — Let a defect or hotfix off a stub take the chore lane on --profile chore
**Files:**
- cli/epic-state.mjs
- cli/epic.mjs
- cli/test-threads.mjs

## T02 — Offer the short lane in yad-change and record its route in change.json
**Files:**
- skills/yad-change/SKILL.md
- skills/yad-change/references/triage.md
- skills/yad-epic/references/state-schema.md

## T03 — Say the short lane off a stub exists in yad-stub and the docs
**Files:**
- skills/yad-stub/SKILL.md
- docs/CLI.md
- docs/SKILLS.md
<!-- /yad:tasks -->
