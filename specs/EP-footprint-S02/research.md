# Research — EP-footprint-S02

## Decisions

- **Copy the generated-block pattern.** Three blocks are already written into skills from one source:
  the E87 "When a tool is missing" section (`cli/toolbox.mjs`, `scripts/skill-fallbacks.mjs`), the E179
  brain block (`cli/brain-skills.mjs`, `scripts/brain-skills.mjs`) and yad-guide's lists
  (`cli/agent-rules.mjs`, `scripts/agent-guide.mjs`). This one uses the marker form of the last two
  (`<!-- generated: … -->` … `<!-- end: … -->`), and `cli/marked-block.mjs` to rewrite it in place, so its end
  is never inferred from a heading (the lesson of E87).
- **A new module, not toolbox.mjs.** The block is not about a toolbox tool. A new file under `cli/` is
  shipped by the `cli/` entry in `package.json` `files`, and its tests go in the existing
  `cli/test-detect.mjs`, so `package.json` does not change.
- **Which skills: decided from their text.** A list kept by hand would miss a new skill. The rule reads the
  skill's own words only: the frontmatter, the generated blocks and the E87 section are skipped (the E87
  section already says what to do when `yad` cannot answer). Two skills get no block: `yad-learn` (its only
  `yad` commands are in its E87 section) and `yad-connect-docs` (it only says yad-docs runs
  `yad docs deploy`; listed in `YAD_CLI_MENTIONS_ONLY` with that reason).
- **Where: right after the `# ` title.** It is the first thing the agent reads, and it is away from the
  frontmatter, where S01 changes the `description:` lines at the same time.
- **The stop is before the first `yad …` command.** yad-guide runs `npx -y yadflow@4 new|join|member add`
  on a machine that has no `yad` yet; a stop before the whole skill would break that.
- **Why the CLI stays required.** A skill that worked without the CLI could only ask the agent to wait; it
  could not check that a person approved. Recorded in `docs/design-rules.md` Part 9.

## Unknowns

None. The story is unambiguous.
