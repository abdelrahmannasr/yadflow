# Spec — EP-story-retire-S04: retire an approved story that will not be built

Story: `EP-story-retire-S04` (epic `EP-story-retire`), engine repo. Issue: engine #621 (retire only).
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Once the stories review passes, every story it approved is owed Build work. A story that turns out not to
be needed has no way out: the lane skip (E39, `yad skip <epic> <story> --repo`) refuses the story's last
lane, and editing the story file after approval makes the stories approval stale (`storiesHash`). So the
epic can never seal (`sealedEpic`, `epic-open.sh`), `featureStatus` never says `shipped`, and `yad next` and
`yad status` keep listing the story as owed.

## Requirements

- R1. A pure `retireStory(buildState, {...})` in `cli/epic-state.mjs`, modelled on `skipLane`, returns the
  new build-state: `retired: {reason, by, date}` at the top, and each declared lane that is not already
  skipped set to `{status: 'skipped', record: {reason: 'retired: <why>', by, date}}`. A lane already skipped
  keeps its record; a stray lane (a repo the story does not declare) is left as it is. It refuses, with
  YAD-STATE-004: a stories review not `done`/`satisfied`; a build-state that is not a lane map; a story
  `in-build` or `shipped`; a ship recorded for the story; work started in any lane (`laneStarted`); the last
  story not retired when no story has shipped; no reason. A repeat is checked before the reason and changes
  nothing.
- R2. One predicate: `retiredRecord(buildState)` (the top-level `retired` key, when it is an object; a
  record with no reason still counts) and `storyRetired(epicDir, story)` (the same, read from the file; a
  file that does not parse is not a retirement). The `retired: ` words in a lane reason never count.
- R3. Readers treat a retired story as owed nothing:
  - `featureStatus` (`buildShipped`): a retired story needs no lane for each declared repo; its lanes on disk
    are still read, so work in one keeps the feature in Build. At least one lane must really have shipped.
  - `buildNextActions` adds `retired` to a story's entry only when it is retired (frozen output elsewhere).
  - `yad next` prints a retired story's lanes as `— retired: <reason>`, and the Build summary line adds
    `(N story retired)`. `yad status` says `<story> is retired — <reason>` for a task branch of one, and
    counts the epic finished once the rest shipped.
  - `sealedEpic` (`cli/thread.mjs`) and `epic_sealed` (`checks/epic-open.sh` and its template, byte-identical)
    leave retired stories out and need at least one shipped story. The shell finds the record by its key and
    an object after it, at the top level of the file yad writes (`^  "retired": {`).
  - `shippedStories` (`cli/tidy.mjs`) never folds a retired story, even one whose status says shipped.
  - `yad map` marks a retired story (`retired: true`, state `planned`, label "Retired — will not be built"),
    and leaves retired stories out of the epic's counts and finished states.
- R4. Every `yad build` write (`start`, `step`, `trust`, `ship`, `merged`, `done`, and `open-pr --via auto`'s
  check, through `storyContext`) refuses a retired story with "`<story>` is retired (<reason>), so it owes no
  Build work", never the lane's "`yad unskip`" hint. `yad unskip` on a retired story's lane is refused
  (`unskipLane`), and so is `yad checkpoint --retro-ship` for a retired story, before its lane refusal
  (whose fix is `yad unskip`). `yad build done` on another story says "every story is shipped or retired" when it seals.
- R5. `yad doctor` (`laneChecks`): `story:<epic>:<story>:retired-contradiction` fails a retired story with a
  ship or started work, in place of the lane's own `contradiction` row; `…:retired-no-record` warns about a
  retired record with no reason.
- R6. `yad story retire <story> --reason "<why>" [--json]` (`cli/story-retire.mjs`, routed through
  `runStory`) reads the story file, the ledger, the build-state (strictly: a file that does not parse is
  refused, never overwritten) and the ships, and writes only the build-state. It prints that
  `yad checkpoint --push` commits the change. It does not call `ciOwnsLedger`: build-state is not the ledger.
  `--json`: `epic`, `story`, `retired`, `changed`, `record`, `lanes`, `file`.
- R7. The command is class `on-request` (`cli/agent-rules.mjs`, and named in the on-request rule); the
  generated `skills/yad-guide/SKILL.md`, both `YAD_COMMANDS` lists, `bin/yad.mjs` (actions, routing, the
  write guard, help) and `docs/CLI.md` are updated, and the `yad-run` skill says not to drive a retired story.

## Out of scope

- Putting a retired story back (no `unretire`), and moving a story to another epic.
- The engine's own `AGENTS.md`, which `yad update` rewrites from the rules.
- The three entries `checks/yad-activity.mjs` already lacks against its template (`backfill promote`,
  `docs brand`, `repo pack`): `yad update` refreshes that installed copy.

## Clarifications

### Session 2026-11-21
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Where is the story read from? → A: its file, `stories/<story>.md`, as the seal and `yad tidy` read it.
- Q: "The last story" — counted how? → A: the other stories whose build-state is not retired. When there are
  none, and no other story's frontmatter says `shipped`, the retirement is refused.
- Q: A repeat with no reason? → A: no change, and it says so with the first record — the check comes before
  the reason, as a lane skip's does.
- Q: The shell match? → A: no jq in the gates, so a line match on the shape `writeJSON` writes (two-space
  indent). A file written another way reads as not retired: the side where the story is still owed.

## Plan

`cli/epic-state.mjs` gets the pure rule and the predicate; each reader asks the predicate. The command is a
thin read-then-write wrapper, like `runLaneSkip`. Tests go with the code they test, in the task's files.

## Tasks

<!-- yad:tasks -->
## T01 — retireStory and the one retired predicate; featureStatus and yad next's data read it
**Files:**
- cli/epic-state.mjs
- cli/test.mjs

## T02 — yad next says a retired story is retired
**Files:**
- cli/next.mjs
- cli/test.mjs

## T03 — yad status says a retired story is retired, and counts the epic finished
**Files:**
- cli/status.mjs
- cli/test-standup.mjs

## T04 — sealedEpic leaves retired stories out and needs one shipped story
**Files:**
- cli/thread.mjs
- cli/test-threads.mjs

## T05 — yad tidy never folds a retired story, and checkpoint --retro-ship refuses one
**Files:**
- cli/tidy.mjs
- cli/checkpoint.mjs
- cli/test.mjs

## T06 — yad map marks a retired story and leaves it out of the epic's counts
**Files:**
- cli/map.mjs
- cli/test-map.mjs

## T07 — epic-open.sh epic_sealed leaves retired stories out, as sealedEpic does
**Files:**
- checks/epic-open.sh
- skills/yad-checks/templates/checks/epic-open.sh
- cli/test-checks.mjs

## T08 — yad doctor fails a retired story with a ship or started work, and warns on no reason
**Files:**
- cli/doctor.mjs
- cli/test.mjs

## T09 — yad build refuses a retired story, and done says the seal counts it
**Files:**
- cli/build.mjs
- cli/test-build.mjs

## T10 — Class story retire as on-request, in the rules, the activity hook and the guide skill
**Files:**
- cli/agent-rules.mjs
- skills/yad-checks/templates/hooks/yad-activity.mjs
- skills/yad-guide/SKILL.md

## T11 — Add the yad story retire command
**Files:**
- cli/story-retire.mjs
- cli/story-frames.mjs
- cli/test.mjs

## T12 — Route yad story retire, guard its write, and list it in --help
**Files:**
- bin/yad.mjs
- cli/test.mjs

## T13 — Document yad story retire, tell yad-run not to drive one, and name it in the engine's hook
**Files:**
- docs/CLI.md
- skills/yad-run/SKILL.md
- checks/yad-activity.mjs

## T14 — epic-open fails a change that names a retired story, and its seal message counts retired stories
**Files:**
- checks/epic-open.sh
- skills/yad-checks/templates/checks/epic-open.sh
- cli/test-checks.mjs

## T15 — The last-story check never counts a retired story as shipped; doctor warns when every story is retired
**Files:**
- cli/story-retire.mjs
- cli/doctor.mjs
- cli/test.mjs

## T16 — Print a skipped lane's reason as plain text, and fix the retired-story docs
**Files:**
- cli/next.mjs
- skills/yad-run/SKILL.md
- docs/GATES.md
<!-- /yad:tasks -->
