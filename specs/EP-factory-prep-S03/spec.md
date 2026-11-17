# Spec — EP-factory-prep-S03: a task PR's title, Summary and rollback plan describe the whole change

Story: `EP-factory-prep-S03` (epic `EP-factory-prep`), engine repo. Issue: engine #585.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

`yad open-pr` takes the title and the Summary from the last commit only (`git log -1`). On a branch of
several commits, the reviewer sees one commit's subject, often a small fix-up (a lint fix), as the
whole pull request. Engine pull requests are squash-merged, so that title also becomes the release note.
The template's rollback plan is left as its placeholder, and the fallback body has no rollback line.

## Requirements

- R1. On a branch of several commits (counted from the base, merges left out), the Summary has one
  bullet per commit subject, oldest first, without the type prefix; the last commit's body is left out.
- R2. With no `--title`, such a branch's title is the strongest Conventional type among its commits
  (`feat`, then `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`; `!` when any
  commit has it), then the story's title (a `title:` or `# ` heading in its story file in the Product),
  else the text of the first commit of that type. No scope; no trailing dot. It passes `checks/pr-title.sh`.
- R3. The rollback plan's placeholder is filled with `revert the commit that merged this pull request` (a merge or a squash) on GitHub
  and GitLab; a plan the team already wrote, and a trailing comment, stay. The fallback body gets the line.
- R4. A branch of one commit keeps today's title and Summary, even under a merge of the base (the commit's subject, never the merge's). `--title` still wins.
- R5. The commit list is read only when the base was just fetched; otherwise the one-commit title and Summary are used, and the warning says so.

## Clarifications

### Session 2026-11-17
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface, no high-risk file; the engine has no risk map)
- Q: Story files today have no title line (they open with `## Story`) — where does the text come from? → A: the first commit of the strongest type, which names the change itself rather than a later fix-up.

## Plan

In `cli/openpr.mjs`: `commitsSummary`, `branchTitle` and `storyTitleFor` beside `templateBody`; read
`git log --reverse --no-merges --format=%s <base>..HEAD` when the base is known; fill the rollback
placeholder in `templateBody` and add it to `codeTaskTemplate`. Then say so in `docs/CLI.md` and the
`yad-open-pr` skill.

## Tasks

<!-- yad:tasks -->
## T01 — Describe every commit of a branch, and fill the rollback plan
**Files:**
- cli/openpr.mjs
- cli/test.mjs

## T02 — Explain the several-commit title, Summary and rollback plan
**Files:**
- docs/CLI.md
- skills/yad-open-pr/SKILL.md
<!-- /yad:tasks -->
