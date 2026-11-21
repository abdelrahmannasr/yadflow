# Spec — EP-footprint-S02: skills say they need the yad CLI, and stop with a clear message when it is missing

Story: `EP-footprint-S02` (epic `EP-footprint`), engine repo. Issue: Product #244.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Almost every yadflow skill runs `yad` commands. On a machine without the yadflow CLI, the agent only finds
out part way through a step, from a raw "command not found" error. The person is not told how to install
the CLI, or why the skills need it.

## User story

As a person who loads a yadflow skill on a machine without the `yad` CLI, I want the skill to stop at once
and tell me how to install it, and why it is needed, so that I do not get a raw "command not found" error
part way through a step.

## Requirements

- R1. One source in `cli/` (`cli/skill-yad-cli.mjs`) holds the block's words, between two markers:
  `<!-- generated: yad-cli — from cli/skill-yad-cli.mjs by scripts/skill-yad-cli.mjs; do not edit by hand -->`
  and `<!-- end: yad-cli -->`. The block says: run `command -v yad` before the first `yad …` command; when it
  prints nothing, stop there and tell the person to run `npm install -g yadflow@latest`, or to use
  `npx -y yadflow@4 …`; and why: the CLI is what enforces the approvals.
- R2. One rule (`skillRunsYad`) decides which skills run `yad`: a `` `yad <command>` `` in inline code, or a
  line that is a `yad <command>`, in the skill's own words. The frontmatter, every block yad generates
  (`<!-- generated: … -->` to `<!-- end: … -->`, this one included) and the "When a tool is missing" section
  (E87, which already says what to do when `yad` cannot answer) are not read. A short list
  (`YAD_CLI_MENTIONS_ONLY`) names skills that only say another skill runs a command, each with its reason.
- R3. `scripts/skill-yad-cli.mjs` writes the block into each skill that runs `yad`, right after its first
  `# ` title line (past the frontmatter and any code fence), and takes it out of every other skill.
  `--check` changes nothing and exits 1 when a block is missing, stale or refused. A file keeps its own
  line ending. Markers it cannot trust (two of either, an end before a begin) and a skill with no `# ` title
  are refused, never guessed.
- R4. A test in `cli/test-detect.mjs`, next to the E87 drift test, fails when a skill's copy differs from
  the source, when a skill that runs `yad` has no block, when a skill that runs no `yad` has one, or when
  the block is not right after the title.
- R5. The block never touches a skill's frontmatter, so S01's `description:` limits still pass.
- R6. `skills/yad-guide/SKILL.md` keeps `npx -y yadflow@4 new|join|member add` working before the CLI is
  installed: the block stops before the first `yad …` command, and says a command written as
  `npx -y yadflow@4 …` runs without the install.
- R7. `README.md` says, in the Quickstart: "yadflow skills need the `yad` CLI, because the CLI enforces
  approvals." `docs/design-rules.md` records the decision in Part 9.

## Out of scope

- Changing any skill's `description:` line (story S01 does that).
- Making a skill work without the CLI.
- The skills copied into a Product: `yad update` brings them in line after a release.

## Acceptance criteria (from the story, word for word)

- [ ] Each skill that runs a `yad` command starts with a short block, between markers: check that `yad` is on the `PATH` (`command -v yad`); when it is not, stop and tell the person to run `npm install -g yadflow@latest` (or to use `npx -y yadflow@4 …`), and say why: the CLI is what enforces the approvals.
- [ ] The block comes from one source in `cli/` and is written into each skill by a script, the same way as the "When a tool is missing" block. A test fails when a skill's copy differs from the source, or when a skill that runs `yad` has no block.
- [ ] Skills that never run `yad` get no block.
- [ ] `README.md` says, in the Quickstart: "yadflow skills need the `yad` CLI, because the CLI enforces approvals."
- [ ] `docs/design-rules.md` records the decision: the skills keep the CLI dependency, because a skill that worked without it could only ask the agent to wait, not enforce an approval.
- [ ] The S01 length limits still pass (the block is in the body, not the description).

## Clarifications

### Session 2026-11-21

- Q: Human-only decisions (security, secrets, contract changes, changes that cannot be undone)? → A: none. The story changes skill text, a generator and docs only.
- Q: Light spec? → A: the story qualifies (chore route, no contract, no risk map in the engine), but no person was there to confirm it, so this is the full spec, the skill's default.
- Q: The story says it starts after S01 merges. → A: removed by the person: S01 runs at the same time and changes only the `description:` lines (and maybe one sentence at the end of the intro). This story never edits a `description:` line, and puts its block right after the `# ` title, away from the frontmatter.
- Q: May the regenerated-skills task (T02) pass the 3-file guard? → A: yes, for T02 only: the person allowed `yad commit --force` for it.
- Q: Where does the drift test over the real skills go? → A: in T02, with the skills it reads, so each task branch passes `npm test` on its own. T01 adds the unit tests of the generator.

## Checklist

- [x] Every requirement traces to an acceptance criterion.
- [x] No contract surface; no `contracts/` folder (chore route).
- [x] Every task declares its files; only T02 passes 3 files, with the person's allowance.
- [x] Nothing is decided that only a person may decide.
