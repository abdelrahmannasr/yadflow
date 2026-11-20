# Spec — EP-engine-reports-S01: read a frontmatter value without its trailing comment

Story: `EP-engine-reports-S01` (epic `EP-engine-reports`), engine repo. Issue: engine #618.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Frontmatter is the `key: value` block between the two `---` lines at the top of `epic.md` and of a story
file. `parseFrontmatter` in `cli/epic-state.mjs` reads it. It keeps the whole rest of the line as the
value and tests that whole value against `[ … ]` to find a list. So `domain: [a, b]  # note` is not a
list: it becomes one string, `[a, b]  # note`, which then reads as one junk label. A scalar is hit the
same way: `owner: x # who` reads as `x # who`. The gate (`cli/gate.mjs`) has its own copy of the same
reader, `yad doctor` reads a workflow's branch list with a third, the progress map (`cli/map.mjs`) has a
fourth, and the bash check gates read scalars with `fm_val`, which keeps the comment too.

## Requirements

- R1. `parseFrontmatter` cuts a `#` comment before it reads the value. A comment is a `#` that has a space
  or a tab before it and is outside single or double quotes. The space after the colon counts, so
  `key: # note` is empty, as in YAML. `domain: [a, b]  # note` gives `['a', 'b']`; `owner: x # who`
  gives `x`.
- R2. A `#` inside quotes (`"a # b"`, `'a # b'`), or with no space before it (`theme: a#b`, `key:#x`, a
  URL's `#frag`), is kept as part of the value. A quote opens only at the start of the value or after a
  space, a tab, `[` or `,`, so the apostrophe in `O'Brien # x` opens nothing. Inside double quotes a
  backslash escapes the next character; inside single quotes `''` is one quote.
- R3. A line that is only a comment still sets nothing.
- R4. The other frontmatter readers give the same answer: the gate reads through `readFrontmatter`
  (its own copy is removed), and `yad doctor`'s list reader (`yamlList`) and the map's `frontmatterText`
  use the same helper, `stripFrontmatterComment`. One table test runs the same lines through every
  reader, the bash ones included, and holds them equal.
- R5. The bash check gates use the same rule. `fm_val` in `contract-check.sh`, `lineage-check.sh`,
  `epic-open.sh` and `reconcile-debt-check.sh` (the shipped templates and this repo's copies) passes the
  value through a new `fm_strip`, the same rule in POSIX awk. `link_val`'s whole-file fallback uses
  `fm_strip` too, or it would read `key: # note` back as `# note`. These gates read `kind:`, `parent:`,
  `status:` and the `link.md` fields, where a trailing comment is just as wrong.
- R6. The docs and skills that said "the readers keep the whole rest of the line" say what is read now.
  They still tell people to write the machine-read keys bare, because a code repo whose gates
  `yad update` has not refreshed still keeps the comment.
- R7. `theme: #checkout-revamp` (the form `yad next` prints) reads as no theme, as in YAML, and
  `yad doctor` says so under `theme:commented`: when the parsed theme is empty and the raw text after
  `theme:` is a single `#word`, it warns that the whole value is a YAML comment. A real comment
  (`theme: # none yet`) says nothing.
- R8. Every JS reader trims only spaces and tabs from the whole value, as `fm_strip` does, so a value of
  one no-break space reads the same in JS and bash.

## Out of scope

`cli/brand-cmd.mjs`'s `readFrontMatter` (a design system's front matter, which holds colours such as
`#ff0000`; it has its own comment rule) and `cli/detect.mjs`'s `skillMeta` (a skill's `name` and
`version`). `statusValue` in `cli/artifact-status.mjs`, which writes a story's `status:` line. Windows line
endings in `parseFrontmatter` (a CR still ends no line there, as before). `docs/migrations/shape-5.md`,
which describes the upgrade to shape 5 as it was.

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Does the bash `fm_val` need the same rule? → A: yes. It reads `kind:`, `parent:` and similar, where a trailing comment is just as wrong, and the story asks for one rule in JS and bash.
- Q: Is `key: #x` a comment? → A: yes, as in YAML: the space after the colon counts. `key:#x` keeps `#x`.
- Q: A title such as `Fix issue #12`? → A: it reads as `Fix issue`, as in YAML. The docs say to quote a title that holds ` #`.

## Plan

Add `stripFrontmatterComment(raw)` to `cli/epic-state.mjs`, called by `parseFrontmatter` on the text right
after `key:` before it trims the value and tests for a list. The gate drops its copy and calls
`readFrontmatter`. `yamlList` in `cli/doctor.mjs` (now given the untrimmed text after `key:`) and
`frontmatterText` in `cli/map.mjs` call the helper. In the four bash gates, `fm_val` prints the text
after `key:` into `fm_strip`, which trims it as before. The four templates change together (a test pins
their shared block byte for byte), and this repo's copies follow. One table in `cli/test-checks.mjs`
runs every row through `parseFrontmatter`, `readFrontmatter`, the gate's `touchedDomains`, `yamlList`,
`frontmatterText`, and `fm_val` and `link_val` from all eight shell files.

## Tasks

<!-- yad:tasks -->
## T01 — Cut a trailing `# comment` in parseFrontmatter
**Files:**
- cli/epic-state.mjs
- cli/test.mjs
- cli/test-story-frames.mjs

## T02 — Read the gate's, doctor's and the map's frontmatter by the same rule
**Files:**
- cli/gate.mjs
- cli/doctor.mjs
- cli/map.mjs

## T03 — Cut the comment in the shipped check gates' fm_val (contract, lineage, epic-open)
**Files:**
- skills/yad-checks/templates/checks/contract-check.sh
- skills/yad-checks/templates/checks/lineage-check.sh
- skills/yad-checks/templates/checks/epic-open.sh

## T04 — Cut it in the shipped reconcile-debt gate, and refresh this repo's contract and lineage copies
**Files:**
- skills/yad-checks/templates/checks/reconcile-debt-check.sh
- checks/contract-check.sh
- checks/lineage-check.sh

## T05 — Refresh this repo's other gate copies and hold every reader to one table
**Files:**
- checks/epic-open.sh
- checks/reconcile-debt-check.sh
- cli/test-checks.mjs

## T06 — Say what the frontmatter readers cut in the docs and the epic skill
**Files:**
- docs/CLI.md
- skills/yad-epic/SKILL.md
- skills/yad-epic/references/state-schema.md

## T07 — Say it in the stub and change skills and the config notes
**Files:**
- skills/yad-stub/SKILL.md
- skills/yad-change/SKILL.md
- skills/sdlc/config.yaml

## T08 — Correct the code comments that said the comment was kept
**Files:**
- cli/story-frames.mjs
- cli/test-threads.mjs

## T09 — Warn when a theme is wholly a comment, and trim doctor's list value as fm_strip does
**Files:**
- cli/doctor.mjs
- cli/test.mjs

## T10 — Trim only spaces and tabs in the JS readers, and widen the reader table
**Files:**
- cli/epic-state.mjs
- cli/map.mjs
- cli/test-checks.mjs

## T11 — Say that `theme: #tag` is a comment in the epic, change and stub skills
**Files:**
- skills/yad-epic/SKILL.md
- skills/yad-change/SKILL.md
- skills/yad-stub/SKILL.md

## T12 — Say which `#` the stories skill's frames line keeps
**Files:**
- skills/yad-stories/SKILL.md
<!-- /yad:tasks -->
