# Spec — EP-reported-agent-flow-S01: one worktree per story with `yad worktree add --story`

Story: `EP-reported-agent-flow-S01` (epic `EP-reported-agent-flow`), engine repo. Issue: engine #657.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

A yad worktree is a second working folder of a git repo, made by `yad worktree add`. Today every part of
it is keyed by the epic alone, so two agents building two stories of one epic get the same folder.

- `worktreePath(main, epic)` (`cli/worktree.mjs` line 41) names the folder `<repo>--<epic>`. It has no
  story.
- `runWorktreeAdd` (line 260) looks for an existing worktree by epic and repo only (line 268:
  `w.epic === epic && (w.repo ?? null) === t.repo`). When it finds one, `planAdd` (line 48, line 56)
  returns `skip: true`, so a second `add` for the same epic reuses the first folder.
- The record (`yad-worktree.json`, written at line 306) holds `{ epic, repo, base, created, by, links }`.
  `worktreeAt` (`cli/worktree-record.mjs` lines 44–55) and `yadWorktrees` (`cli/worktree.mjs` lines
  117–134) read it and check only `epic` (and `repo`). There is no `story` field.
- `pickTargets` (line 238) takes an epic id only (`isValidEpicId`, line 239). With no flag it targets the
  Product alone (line 248); `--all` adds the code repos the epic's `repos:` names (lines 249–250).
- `runWorktreeList` (line 397) builds each row as `{ epic, repo, path, branch, changes, unpushed, locked,
  missing }` (line 406) and prints `<epic>  <repo>  <path>  (…)` (line 416).
- `runWorktreeRemove` (line 422) finds one worktree per target by epic and repo (line 433) and returns
  `{ epic, removed: [{ repo, path }], skipped? }` (line 466).
- The CLI does not read `--story` for any command: it is not in `VALUE_FLAGS` (`cli/argv-flags.mjs`
  line 4). The `worktree` case in `bin/yad.mjs` (lines 1428–1443) passes only `epic`, `repo`, `all`,
  `dryRun`, `today` and `cwd`. Its help (lines 110–122) and usage line (line 1431) show no story.
- Readers that find the epic from a worktree:
  - `epicWorktreeOf(checkout, epic, repo)` (`cli/build.mjs` lines 406–410) builds the path
    `<checkout>--<epic>` itself. `pinSpecKit` (line 412) calls it with `storyEpic(story)` (line 417), so
    the Spec Kit pin goes to the epic's worktree, never to a story's.
  - `codeWorktreeOf` (`cli/find-product.mjs` lines 154–162) reads the repo and `rec.epic` from the
    record, not from the folder name. `findProduct` (lines 104–109) then sends Product commands to
    `epicProductWorktree(ws.product, wt.epic)` (lines 185–190), which builds `<product>--<epic>`.
    `registryEntryFor` (line 297), used by `yad run checks` (`cli/run-checks.mjs` line 380), goes through
    `codeWorktreeOf` too. Because these read the record's `epic`, a story worktree whose record says
    `epic: EP-x` already maps to EP-x here.
- `cli/test.mjs` pins how many plain `fs` reads, writes and deletes `cli/worktree.mjs` and
  `cli/worktree-record.mjs` hold (the lists near lines 29413, 29583 and 29653). A new direct read or
  write there fails that test.
- `docs/CLI.md` says "one worktree per epic" (section at line 1071, command rows at lines 166–168).

## Requirements

- R1. `yad worktree add EP-x --story EP-x-S02` makes one worktree per target code repo, in a folder
  named `<repo>--EP-x-S02` beside the repo's checkout, detached at `origin/<default>`, with the same
  fetch, `node_modules` link, hooks link and rollback rules as an epic worktree today. Assumption: "on
  its own branch" in the story means its own HEAD, detached, where the step skills make their usual
  `feat/<story>-…` branch, as in an epic worktree (git refuses one branch in two worktrees). See the
  open question.
- R2. The record of a story worktree holds `story: "EP-x-S02"` and `epic: "EP-x"` (the epic, never the
  story id). The record of an epic worktree is written exactly as today, with no `story` key.
- R3. With `--story` and no `--repo`, the targets are the registered code repos that the story file's
  `repos:` names (`epics/EP-x/stories/EP-x-S02.md`). `--repo <name>` narrows it to that one repo. No
  Product worktree is made for a story. Both are assumptions: see the open questions.
- R4. `--story` is refused, making nothing, with a message that names the cause, when:
  - the value does not match the story id pattern (`^EP-[a-z0-9-]+-S\d+$`, as `STORY_RE` in
    `cli/build.mjs`);
  - the story's epic (the id without its `-S<n>` end, as `storyEpic`) is not the epic given;
  - the epic has no story file with that id (see the open question on this);
  - the value is missing (`--story` with no id).
- R5. Two `add` calls for two stories of one epic give two folders. A second `add` for the same story
  and repo reuses its folder (`skip: true`, "already there"), as an epic's does today. An epic `add`
  never reuses a story's worktree, and a story `add` never reuses the epic's: the lookup at line 268
  matches the story too (`null` for an epic worktree).
- R6. `yad worktree add EP-x` without `--story` behaves exactly as today: the same targets, the folder
  `<repo>--EP-x` (or `<product>--EP-x`), the same record, the same output. The Product worktree is
  unchanged.
- R7. `worktreeAt` and `yadWorktrees` accept a record with no `story`, or `story: null`, as today. A
  record with a `story` that does not match the pattern, or whose epic is not the record's `epic`, is not
  a yad worktree (returns `null` / is skipped).
- R8. `yad worktree list` shows the story id on the line of each story worktree. Each `--json` row gains
  `story` (the id, or `null` for an epic worktree). No existing field changes.
- R9. `yad worktree remove EP-x --story EP-x-S02` removes only that story's worktrees (in every code repo
  that has one, or in the one `--repo` names), with today's refusal rules. `yad worktree remove EP-x`
  without `--story` removes only the epic's own worktrees, never a story's (see the open question on
  this). The `--json` output gains a top-level `story` (the id, or `null`) and a `story` on each
  `removed` row. No existing field changes.
- R10. `yad worktree add … --json` gains a top-level `story` (the id, or `null`). No existing field
  changes. This goes past the story, which names the `list` and `remove` outputs; it is an addition that
  keeps the three outputs alike.
- R11. From inside `<repo>--EP-x-S02`:
  - `registryEntryFor` / `codeWorktreeOf` give that repo, so `yad run checks` runs there as the repo;
  - `findProduct` gives the Product of EP-x: the epic's Product worktree `<product>--EP-x` when yad made
    one, else the main Product, exactly as from an epic worktree today;
  - `yad build step EP-x-S02 --repo <repo> spec in_progress` pins Spec Kit's `.specify/feature.json` in
    `<repo>--EP-x-S02` when that worktree exists, else in `<repo>--EP-x` when that exists (as today),
    else in the main checkout (as today). The reported `file` names the folder used.
- R12. `yad worktree list` refuses `--story`, as it refuses `--repo` and `--all` today. `--story` with
  `--all` is refused (`--all` names the epic's targets; `--story` the story's). Assumption: see the
  open question.
- R13. `yad help` shows `--story <story>` on the `add` and `remove` lines and says what it makes. The
  usage line in `bin/yad.mjs` shows it too.
- R14. `docs/CLI.md` says how to get one worktree per story: the "Parallel agents" section (line 1071)
  and the `worktree add`, `list` and `remove` rows (lines 166–168), including the `story` `--json` field.

## Non-goals

- A story id in place of the epic (`yad worktree add EP-x-S02`): the option not chosen for #657.
- A Product worktree per story.
- `yad worktree list --story`: `list [<epic>]` already shows an epic's story worktrees.
- Moving existing epic worktrees, or rewriting their records.
- Changing the agent guide classes in `cli/agent-rules.mjs`: `worktree add` and `remove` stay
  `local-write` with or without `--story`.
- Rewording the skills (`skills/yad-run/SKILL.md`, `skills/yad-implement/SKILL.md`) and
  `docs/YADFLOW-EXPLAINED.md`, which say "one worktree per epic". They stay true; a follow-up may add the
  story form.
- Separating Build records of two story agents: both still reach the same Product (the epic's Product
  worktree, or the main one), as R11 keeps.

## Clarifications

### Session 2026-11-25

- Q: Light spec? → A: yes (the person, Plannotator Inbox, 2026-11-25).
- Q: How does an agent get one worktree per story? → A: a new flag, yad worktree add EP-x --story EP-x-S02 makes <repo>--EP-x-S02 (the person, Plannotator Inbox, 2026-11-25).
- Q: Does `--story` also make a Product worktree (`<product>--EP-x-S02`), or only code repo worktrees? → A: (this spec assumes code repos only, R3; the story says "a worktree per code repo" and "the Product worktree exactly as today"). Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Must the story file exist on the Product for `--story` to work, or is a well-formed id of the epic enough? → A: (this spec assumes the file must exist, R4, because its `repos:` gives the targets). Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Does `yad worktree remove EP-x` (and `--all`) without `--story` also remove the epic's story worktrees? → A: (this spec assumes no: only the epic's own, R9, so "without `--story` exactly as today"). Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Does "on its own branch" mean `add --story` creates and checks out a branch (and which name), or a detached HEAD where the step skills make their branch, as an epic worktree does? → A: (this spec assumes detached, R1). Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Which repos does `--story` target with no `--repo`: the story's `repos:`, or the epic's `repos:`? → A: (this spec assumes the story's, R3). Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Is `--story` with `--all` refused, or read as "every repo the story names"? → A: (this spec assumes refused, R12). Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.

## Plan

Give the record and the pure planners an optional story first: `worktreePath(main, epic, story)` names
the folder after the story when there is one, `worktreeAt` and `yadWorktrees` check the new field, and
`planAdd` carries it. Then teach `pickTargets`, `runWorktreeAdd`, `runWorktreeList` and
`runWorktreeRemove` to take `story`, match it, write it into the record and the `--json` output; test
them by calling the functions. Then wire the `--story` flag, the refusals and the help in `bin/yad.mjs`
and `cli/argv-flags.mjs`, with CLI tests. Then make the Spec Kit pin look in the story's worktree first,
and prove that `findProduct`, `registryEntryFor` and `yad run checks` find EP-x from a story worktree.
Last, the docs. The story id pattern is defined in `cli/worktree-record.mjs` (it cannot import
`cli/build.mjs`, which imports it), with the same regular expression as `STORY_RE`.

## Tasks

<!-- yad:tasks -->
## T01 — the worktree record and the pure planners carry an optional story
**Files:**
- `cli/worktree-record.mjs`
- `cli/worktree.mjs`
- `cli/test-worktree.mjs`

**Done when:** R2 and R7 hold for `worktreeAt` and `yadWorktrees`; `worktreePath(main, epic)` gives the same path as today and `worktreePath(main, epic, story)` gives `<repo>--<story>`; `planAdd` takes a story and refuses or skips with the story's path; the existing planner tests pass unchanged and new pure tests cover a good, a missing, a malformed and a foreign-epic `story`.

## T02 — add, list and remove take a story, match it, and report it
**Files:**
- `cli/worktree.mjs`
- `cli/test-worktree.mjs`

**Done when:** R1–R6 and R8–R10 hold when `runWorktreeAdd`, `runWorktreeList` and `runWorktreeRemove` are called with and without `story`: two stories give two folders, a re-run reuses its folder, an epic `add` does not reuse a story's and the reverse, `remove` with a story removes only that story's, and every existing worktree test still passes. No new plain `fs` read, write or delete is added, so the counts in `cli/test.mjs` stay.

## T03 — the `--story` flag, its refusals and its help on the CLI
**Files:**
- `cli/argv-flags.mjs`
- `bin/yad.mjs`
- `cli/test-worktree.mjs`

**Done when:** R4, R12 and R13 hold through `yad worktree …`: `--story` is read as a value flag and passed to add and remove, a bad id, a story of another epic, a missing story file, an empty `--story`, `--story` on `list` and `--story` with `--all` are refused with their cause, the usage line and `yad help` show the flag, and a CLI test runs `add`, `list --json` and `remove --json` for two stories of one epic.

## T04 — from a story worktree, the Spec Kit pin, the Product lookup and the checks find the epic
**Files:**
- `cli/build.mjs`
- `cli/test-worktree.mjs`

**Done when:** R11 holds: `pinSpecKit` pins in `<repo>--<story>` when it exists and falls back as today (the existing "#115" pin test passes unchanged); `cli/find-product.mjs` needs no change, as it reads the record's `epic`, and tests from inside `<repo>--EP-x-S02` show `findProduct` going to `<product>--EP-x` when it exists and to the main Product when not, `registryEntryFor` giving the repo, and `yad run checks` running there as the repo.

## T05 — docs say how to get one worktree per story
**Files:**
- `docs/CLI.md`

**Done when:** R14 holds: the "Parallel agents" section shows `yad worktree add <epic> --story <story>` and the `<repo>--<story>/` folder, and the `worktree add`, `list` and `remove` rows name `--story`, its refusals and the `story` `--json` field.
<!-- /yad:tasks -->
