# Spec — EP-reported-ci-hygiene-S01: pass the base branch to the check workflows through `env:`

Story: `EP-reported-ci-hygiene-S01` (epic `EP-reported-ci-hygiene`), engine repo. Issue: engine #703.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

GitHub fills in every `${{ … }}` expression before the shell reads a `run:` script. A value placed there
becomes part of the script text, so a value holding shell characters would run as code. Semgrep's GitHub
Actions rules flag each such line as shell injection. The safe form passes the value through the step's
`env:` and lets the shell read the variable.

A scan of `skills/*/templates/github/*.yml` on `main` (`6a5eedf0`) found these `run:` scripts with an
expression inside:

| Template | Lines | Expression |
|---|---|---|
| `yad-checks/templates/github/yad-checks.yml` | 72, 115, 117, 160, 232, 233, 279, 281, 324, 326, 369, 371, 414, 460 | `${{ github.base_ref }}` |
| `yad-checks/templates/github/yad-product-checks.yml` | 72, 115, 162 | `${{ github.base_ref }}` |
| `yad-checks/templates/github/yad-verified-commits.yml` | 68 | `${{ github.base_ref }}` |
| `yad-checks/templates/github/yad-update-guard.yml` | 41, 51, 53 | `${{ github.event.before }}`, `${{ steps.base.outputs.base }}` |

`yad-pr-text.yml`, `yad-product-pr-text.yml` and `yad-product-bridge/templates/github/yad-gate-sync.yml`
already pass their values through `env:` and need no change. The first step of each job ("Gate scripts
from the base branch (#426)") already uses the safe form: `env: { YAD_BASE: "${{ github.base_ref }}" }`
and `"origin/${YAD_BASE}"`. A step's `env:` applies to that step only, so each later step needs its own.

## Requirements

- R1. No `run:` script in `skills/*/templates/github/*.yml` holds a `${{ … }}` expression.
- R2. Each `run:` line that passed `"origin/${{ github.base_ref }}"` reads `"origin/$YAD_BASE"`, and its
  step sets `YAD_BASE: "${{ github.base_ref }}"` in `env:`.
- R3. Where the step already has an `env:` map, `YAD_BASE` is added as the map's first key. No step gets a
  second `env:` key, and the existing keys and their order stay as they are.
- R4. In `yad-update-guard.yml`, the "Resolve the pushed range base" step reads the pushed-before commit
  from `env: { YAD_BEFORE: "${{ github.event.before }}" }`, and the `verified-commits` and
  `commit-message` steps read the range base from `env: { YAD_RANGE_BASE: "${{ steps.base.outputs.base }}" }`.
- R5. After the shell expands the variables, every step runs the same command with the same arguments as
  before, so each job's result is the same.
- R6. The tests that matched the old lines (`cli/test-checks.mjs`: the `#496` test and the E120
  `product-checkout` test; `cli/test.mjs`: the `#684` story-gate test) match the new form.
- R7. A new test in `cli/test-checks.mjs` reads every `skills/*/templates/github/*.yml` and fails when a
  `run:` script (a one-line `run:` or a `run: |` block) holds `${{`.
- R8. `skills/yad-checks/references/check-gates.md` describes the new form.
- R9. The engine's own `.github/workflows/yad-verified-commits.yml` stays byte-identical to its template, as
  the `pins actions by hash` test in `cli/test.mjs` requires.

## Non-goals

- The GitLab templates: GitLab CI variables are read by the shell, not pasted into the script.
- The engine's own installed copies in `.github/workflows/`, except `yad-verified-commits.yml` (R9). They
  are refreshed by `yad update` once a yadflow release carries the new templates.
- Any change to which scripts a job runs, or to what a gate decides.

## Clarifications

### Session 2026-11-27

- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (the person, 2026-11-27). The story qualifies: chore route, no contract, no high-risk file (the engine has no risk map).
- Q: One PR for the three tasks, or one PR each? → A: one PR, one commit per task (the person, 2026-11-27).
- Q: `yad-update-guard.yml` is not one of the five templates the story names, but it pastes two values into `run:` the same way. In or out? → A: in (R4). It is the same fix and the same finding class, and R7's guard test would fail on it otherwise.
- Q: T01 also needs `cli/test.mjs` (the `#684` test matches the story-gate `env:` line exactly), which makes 4 files. How to keep each task at 3? → A: move the doc (`check-gates.md`) from T01 to T03 (the person, 2026-11-27).
- Q: T02 also needs `.github/workflows/yad-verified-commits.yml`, which a test holds byte-identical to its template, which makes 4 files. How to keep each task at 3? → A: move `yad-update-guard.yml` from T02 to T03 (the person, 2026-11-27).

## Plan

Change the templates one group at a time, each with the tests that read it. T01 covers `yad-checks.yml`,
which holds 14 of the 18 lines, with its tests. T02 covers the product and verified-commits templates, with the engine's own copy of the latter. T03
covers `yad-update-guard.yml` and adds the guard test and the doc, once every template is clean, so the test never fails on `main`. Each task is checked by
the full test suite and by the yad check jobs on this PR, which run the changed `yad-checks.yml` lines.

## Tasks

<!-- yad:tasks -->
## T01 — yad-checks.yml passes the base branch through env
**Files:**
- `skills/yad-checks/templates/github/yad-checks.yml`
- `cli/test-checks.mjs`
- `cli/test.mjs`

**Done when:** R2, R3 and R5 hold for `yad-checks.yml`, and the `#496`, E120 and `#684` tests match the new lines (R6).

## T02 — the product and verified-commits templates pass the base branch through env
**Files:**
- `skills/yad-checks/templates/github/yad-product-checks.yml`
- `skills/yad-checks/templates/github/yad-verified-commits.yml`
- `.github/workflows/yad-verified-commits.yml`

**Done when:** R2, R3 and R5 hold for the two templates, the installed `yad-verified-commits.yml` is its template byte for byte (R9), and the full test suite passes.

## T03 — update-guard passes its values through env, a test keeps `${{ }}` out of every GitHub run script, and the doc says so
**Files:**
- `skills/yad-checks/templates/github/yad-update-guard.yml`
- `cli/test-checks.mjs`
- `skills/yad-checks/references/check-gates.md`

**Done when:** R1, R4, R5, R7 and R8 hold: the new test passes on the clean templates, and fails when a `${{ github.base_ref }}` is put back into a `run:` line.
<!-- /yad:tasks -->
