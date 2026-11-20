# Spec — EP-engine-reports-S03: check the files of yad's own commits before a worktree pushes them

Story: `EP-engine-reports-S03` (epic `EP-engine-reports`), engine repo. Issue: Product #231.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

A linked Product worktree sits on a detached HEAD. The default-branch commands (`yad checkpoint --push`,
`tidy up`, `gate repair`, `gate reopen`, `gate ci`, `repo refresh --push`, `yad index`) treat that HEAD as
the default branch when every commit it holds that `origin/<default>` lacks is one of yad's own. Today
`onlyYadCommitsAhead` judges that by the commit subject alone. A yad commit the person amended with an
edit of their own keeps yad's subject, so the edit is pushed straight to the default branch, unreviewed.

## Requirements

- R1. The check also reads the files the commits ahead change (`git diff --name-only origin/<d>...HEAD`)
  and accepts only the files yad writes there: `.sdlc/**`, `epics/*/.sdlc/**`, `foundation/.sdlc/**`
  (the ledgers, the index, the registry, the code-context), `epics/*/reviews/**` and `foundation/reviews/**`
  (the gate's review summaries), an artifact `.md` in an epic or `foundation/` whose diff changes only `status:` lines, and a
  `.gitignore` whose diff only adds the managed pack-ignore block.
- R2. A worktree refused for such a file says which file (through `forTerminal`) and how to move it to its
  own branch and take it out of yad's commit.
- R3. Every caller gets the check from one place: `branchToCommitOn` and `gate ci` both use
  `onlyYadCommitsAhead`; the refusal text is printed by `guardDefaultBranch`, `gate ci` and `yad index`.
- R4. A plain yad checkpoint commit still pushes, and a commit made without `--push` is still pushed by
  the next run.
- R5 (review). Every commit ahead is judged on its own: the allowlist applies to every file any commit
  touches, a status-flip `.md` or `.gitignore` must pass in each commit's own patch, a merge commit is
  refused, and a symlink or submodule entry is refused. The root `.sdlc/` allowlist is only the index, the
  registry and the code-context.
- R6 (review). One `-U0` patch reader, used by the worktree check, checkpoint's staged story check and repo
  refresh's `.gitignore` check, counts a line as a header only outside a hunk (the hunk's own line counts
  bound it), so a removed `---` or an added `++x` is a change. A `status:` line counts only at column 0
  inside the frontmatter. Every git read uses `--no-ext-diff --no-textconv` (and the log reads
  `--ignore-submodules=none`); the hint quotes each name as one shell word with a `:(literal)` pathspec.

## Out of scope

The one-time foundation move commit of `gate ci` (shape 8), which renames whole files: it is committed and
pushed in the same run; one left unpushed (`--no-push`, a failed push) is refused by the next worktree run. The main checkout, where a detached HEAD is refused as before. The index refresh
after a local write (`product-index.mjs`), which already only skips.

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Judge each commit's files, or the net change from where HEAD left the default branch? → A: each commit (review): the push carries every commit into the default branch's history, so a file added in one commit and taken out in the next must be refused too. A merge commit in the range is refused.
- Q: Which root `.sdlc/` files may ride? → A: only those the guarded commands write there: `.sdlc/index.json` (`yad index`, the gate's index refresh), `.sdlc/repos.json` and `.sdlc/code-context/**` (`yad repo refresh`). Not the settings (`product.json`) or the team's other files.
- Q: The hint, when the file is in an earlier commit? → A: keep every commit on a branch, reset to `origin/<d>`, restore yad's own files (listed, as `:(literal)` pathspecs) from the branch uncommitted, and re-run the yad command, which commits them again; no hand commit of a ledger file.
- Q: Which `.md` files may carry a status flip? → A: any artifact in an epic folder or `foundation/`: `gate ci` flips the status of each artifact it advances, and checkpoint flips a story's.

## Plan

The pack-ignore block moves to `manifest.mjs` (a module with no imports) so `productcommit.mjs` can read it
without an import cycle; `setup.mjs` re-exports it. `notYadsOwnAhead` in `productcommit.mjs` returns why
the commits ahead are not yad's own (a subject, a file, or unknown); `onlyYadCommitsAhead` is true when it
returns nothing. The status-only diff test moves there too and checkpoint's staged-story check uses it.
`explainForeignFile` prints the file and the fix; `guardDefaultBranch`, `gate ci` and `yad index` call it
in a Product worktree. Tests amend a yad commit with a file and check every refusal, follow the hint to a
push, and list the files that may ride a yad commit and the edits of them that may not.

## Tasks

<!-- yad:tasks -->
## T01 — Move the managed pack-ignore block to manifest.mjs
**Files:**
- cli/manifest.mjs
- cli/setup.mjs

## T02 — Check the files the commits ahead change, not only their subjects
**Files:**
- cli/productcommit.mjs
- cli/checkpoint.mjs
- cli/test-worktree.mjs

## T03 — Name the file in the gate ci and yad index refusals
**Files:**
- cli/gate.mjs
- cli/index-command.mjs
- cli/test-worktree.mjs

## T04 — Say in the docs which files may ride a yad commit from a worktree
**Files:**
- docs/CLI.md

## T05 — Judge every commit ahead, narrow the root allowlist, refuse links and merges, and fix the hint
**Files:**
- cli/productcommit.mjs
- cli/test-worktree.mjs
- docs/CLI.md

## T06 — Read checkpoint's and repo refresh's status and ignore diffs with the shared patch reader
**Files:**
- cli/checkpoint.mjs
- cli/repo-publish.mjs
<!-- /yad:tasks -->
