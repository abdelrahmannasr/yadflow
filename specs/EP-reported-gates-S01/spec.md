# Spec — EP-reported-gates-S01: read each commit once, and look up each story's Product once

Story: `EP-reported-gates-S01` (epic `EP-reported-gates`), engine repo. Issue: engine #685.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`lineage-check`, `epic-open` and `reconcile-debt-check` walk the commit range one commit at a time. For
each commit they start three `git log -1` processes (short hash, subject, `Task` trailers), each with its
own `awk`/`grep`/`sed` pipeline, and then call `product_for "$story"`. `product_for` reads the story's
`link.md`, resolves where the Product lives, and runs several `git cat-file`/`git show`/`ls-tree` probes
against `BASE`. Its answer depends only on the story (and `BASE`, fixed for a run), so it repeats work
for every commit of a story already seen. The report measured about 1.3–1.6 s per commit per gate: 788
commits across 66 stories needed about 20 minutes per gate, past the 10-minute job limit.

## Requirements

- R1. Each of the three gates reads the whole range with ONE `git log --no-merges` call that prints, per
  commit, the full hash, short hash, subject and `Task` trailer values, with separators `git log` emits
  (`%x1e` between records, `%x1f` between fields, `separator=%x1d` inside the trailer field). The loop
  reads those records instead of calling `git log -1` per commit.
- R2. The commit order, and therefore the order of the printed lines, is exactly the order
  `git rev-list --no-merges "$RANGE"` gives today (`git log` walks the same order by default).
- R3. The `task` value is the first non-empty `Task` trailer value, as the `awk '!f && length($0)'` filter
  takes it today. A subject holding any character, including the separators' look-alikes in plain text,
  is read whole.
- R4. Each gate runs `product_for` at most once per story in a run. Every later commit of that story
  restores the same values `product_for` set the first time (`prod`, `prod_note`, `prod_fail`,
  `product_rel`, and any other variable the code after the call reads), so the lines printed for that
  commit are the same as today, the `prod_note` and `prod_fail` lines included.
- R5. The cache works on bash 3.2 (the macOS system bash): no associative arrays. It is a plain string or
  a file under the gate's own temporary folder (`yad_tmp`), keyed by story id, with values that cannot
  break the key (a story id matches `story_ok`).
- R6. In `reconcile-debt-check`, the Product lookup for a story already judged in the run comes from the
  cache (R4), so it is not repeated before the `seen_keys` check. The `seen_keys` (thread, epic) rule
  itself does not change, and no line printed today is dropped.
- R7. For the same range and the same Product, every gate prints the same lines in the same order and
  exits with the same code as before.
- R8. The shared blocks stay byte-identical across the gates that share them, and `checks/<gate>` stays
  byte-identical to `skills/yad-checks/templates/checks/<gate>` for each gate changed.

## Non-goals

- The same per-commit pattern in `spec-link.sh` and `commit-message.sh`.
- One shared pass for all gates, or a shared library: the gates stay standalone.
- Any change to what a gate decides.

## Clarifications

### Session 2026-11-25

- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (the person, Plannotator Inbox, 2026-11-25). The story qualifies: chore route, no contract, no high-risk file (the engine has no risk map).
- Q: Keep the gates standalone (shared blocks duplicated, not sourced)? → A: yes, the current design rule (epic Out of scope).

## Plan

Add, in each of the three gates, a small "read the range" block that runs the one `git log` call and a
loop that splits records and fields with `IFS` and `read -d`. Wrap `product_for` with a cache: on a miss,
call it and save the variables it set, keyed by story; on a hit, restore them. Change the three gates one
task at a time, each with its shipped copy and its tests. A test per gate runs the old and the new script
over the same fixture range (several commits sharing a story, a subject with odd characters, a commit
with two `Task` trailers, a `prod_note` case) and compares output and exit code. Measure each gate on a
range of at least 200 commits before and after, and put the numbers in the PR description.

## Tasks

<!-- yad:tasks -->
## T01 — lineage-check reads the range once and caches the Product per story
**Files:**
- `checks/lineage-check.sh`
- `skills/yad-checks/templates/checks/lineage-check.sh`
- `cli/test-checks.mjs`

**Done when:** R1–R5, R7 and R8 hold for `lineage-check`, and the new test compares old and new output on the fixture range.

## T02 — epic-open reads the range once and caches the Product per story
**Files:**
- `checks/epic-open.sh`
- `skills/yad-checks/templates/checks/epic-open.sh`
- `cli/test-checks.mjs`

**Done when:** R1–R5, R7 and R8 hold for `epic-open`, and the new test compares old and new output on the fixture range.

## T03 — reconcile-debt-check reads the range once and caches the Product per story
**Files:**
- `checks/reconcile-debt-check.sh`
- `skills/yad-checks/templates/checks/reconcile-debt-check.sh`
- `cli/test-threads.mjs`

**Done when:** R1–R8 hold for `reconcile-debt-check`, and the new test compares old and new output on a fixture range with two epics in one thread.
<!-- /yad:tasks -->
