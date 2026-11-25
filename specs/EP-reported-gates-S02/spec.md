# Spec — EP-reported-gates-S02: pass the story gates on a promotion merge request

Story: `EP-reported-gates-S02` (epic `EP-reported-gates`), engine repo. Issue: engine #684.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Every gate checks `BASE..HEAD`, and the CI templates set `BASE` to the merge request's target branch.
On a promotion merge request (a long-lived branch such as `develop` merged into `main`), that range holds
every commit merged into `develop` since the last promotion. Each was checked when it merged into
`develop`. The story gates read today's state (an epic sealed since, a thread that now carries debt), so
they can fail commits that passed then. No gate knows what a promotion merge request is.

## Requirements

- R1. The GitLab gate jobs get the merge request's source branch through the environment
  (`CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, already set by GitLab), and the GitHub workflow passes
  `github.head_ref` as an environment variable `YAD_SOURCE_BRANCH` on the gate steps. No gate call gains
  an argument (the base branch's older script runs with this template's call, #426).
- R2. `lineage-check`, `epic-open`, `reconcile-debt-check`, `spec-link` and `commit-message` read
  `YAD_PROMOTE_FROM` (branch names separated by commas or spaces) and the source branch (from
  `YAD_SOURCE_BRANCH`, else `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`). When both are set and the source
  branch equals one listed name exactly, the gate prints
  `PASS [<gate>]: promotion from <branch> (YAD_PROMOTE_FROM); its commits were checked when they merged into <branch>`
  and exits 0 before it walks the range.
- R3. The match is a whole-name comparison done in the shell with no expansion of the name: no glob, no
  `eval`, no unquoted use. A name is printed with control characters replaced by `?`.
- R4. With `YAD_PROMOTE_FROM` unset or empty, with no source branch (a run outside a merge request, or
  `yad run checks` on a laptop), or with a source branch not in the list, each gate behaves exactly as
  today.
- R5. `verified-commits` and `contract-check` do not read the variable and run in full.
- R6. `docs/GATES.md` and `docs/CLI.md` name the variable: what it does, which gates it passes, which it
  keeps, and where to set it (a project or group CI/CD variable on GitLab, a repository variable on
  GitHub, never in yad's managed fragment). `yad ci check` does not change: yad never reads CI variables.
- R7. `checks/<gate>` stays byte-identical to `skills/yad-checks/templates/checks/<gate>` for each gate
  changed.

## Non-goals

- Finding promotion merge requests without the variable.
- Checking only the commits not already on the source branch (the option not chosen).
- Any change to `verified-commits`, `contract-check` or `yad ci check`.

## Clarifications

### Session 2026-11-25

- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (the person, Plannotator Inbox, 2026-11-25). The story qualifies: chore route, no contract, no high-risk file (the engine has no risk map).
- Q: What should the per-commit gates do on a promotion merge request? → A: the story gates pass with a note; `verified-commits` and `contract-check` still run (the person, Plannotator Inbox, 2026-11-25). This weakens five checks on purpose for the named branches only.
- Q: Should `yad ci check` report the variable? → A: no; the gate's job-log line is the report, and `yad ci check` is unchanged (the person, Plannotator Inbox, 2026-11-25).

## Plan

Build after EP-reported-gates-S01 has merged: both change the same three gate scripts. Add one small
"promotion" block, the same text in each of the five gates, right after `BASE` is checked and before the
range is read. Add the environment variable to the gate jobs in both templates. Tests set the variables
around a fixture range that would FAIL a gate, and check the PASS line; and check that an unset, empty or
non-matching value leaves today's result.

## Tasks

<!-- yad:tasks -->
## T01 — the templates pass the source branch to the gates
**Files:**
- `skills/yad-checks/templates/gitlab/yad-checks.gitlab-ci.yml`
- `skills/yad-checks/templates/github/yad-checks.yml`
- `cli/test.mjs`

**Done when:** R1 holds; the template tests check the variable on every story-gate job and on no other.

## T02 — lineage-check passes a promotion merge request
**Files:**
- `checks/lineage-check.sh`
- `skills/yad-checks/templates/checks/lineage-check.sh`
- `cli/test-checks.mjs`

**Done when:** R2–R4 and R7 hold for `lineage-check`.

## T03 — epic-open passes a promotion merge request
**Files:**
- `checks/epic-open.sh`
- `skills/yad-checks/templates/checks/epic-open.sh`
- `cli/test-checks.mjs`

**Done when:** R2–R4 and R7 hold for `epic-open`.

## T04 — reconcile-debt-check passes a promotion merge request
**Files:**
- `checks/reconcile-debt-check.sh`
- `skills/yad-checks/templates/checks/reconcile-debt-check.sh`
- `cli/test-threads.mjs`

**Done when:** R2–R4 and R7 hold for `reconcile-debt-check`.

## T05 — spec-link passes a promotion merge request
**Files:**
- `checks/spec-link.sh`
- `skills/yad-checks/templates/checks/spec-link.sh`
- `cli/test-checks.mjs`

**Done when:** R2–R4 and R7 hold for `spec-link`.

## T06 — commit-message passes a promotion merge request
**Files:**
- `checks/commit-message.sh`
- `skills/yad-checks/templates/checks/commit-message.sh`
- `cli/test-checks.mjs`

**Done when:** R2–R4 and R7 hold for `commit-message`.

## T07 — the docs name the variable
**Files:**
- `docs/GATES.md`
- `docs/CLI.md`

**Done when:** R6 holds.
<!-- /yad:tasks -->
