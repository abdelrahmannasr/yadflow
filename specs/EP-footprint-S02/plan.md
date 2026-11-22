# Plan — EP-footprint-S02 (engine)

## Approach

1. `cli/skill-yad-cli.mjs`: the block's words and markers; `skillRunsYad(skill, text)` (the one rule);
   `withYadCliBlock(text, want)` (insert after the `# ` title, rewrite in place with `applyMarkedBlock`, or
   take out; refuse untrusted markers or a missing title; keep CRLF); `syncSkillYadCli(dir, { check })`,
   which writes through `writeFileAtomic`.
2. `scripts/skill-yad-cli.mjs`: the CLI around `syncSkillYadCli`, with `--check`, like
   `scripts/brain-skills.mjs`.
3. Run the script over `skills/`: 40 skills get the block; `yad-learn` and `yad-connect-docs` do not.
4. The drift test over the real skills, in `cli/test-detect.mjs` next to the E87 test.
5. README Quickstart line and the Part 9 row in `docs/design-rules.md`.

## Tests

- Unit tests (T01), on a temp skills folder: the rule (inline code, code block lines, frontmatter and
  generated regions skipped, npx not counted), the placement (frontmatter, fences, a missing blank line),
  CRLF kept, a block rewritten, removed, and refused markers left alone; `--check` writes nothing.
- Drift test (T02): every real skill that runs `yad` holds the block word for word right after its title;
  no other skill holds it; `scripts/skill-yad-cli.mjs --check` exits 0; yad-guide still names
  `npx -y yadflow@4` for `new`, `join` and `member add`; no `description:` line changed.
- By hand: the block's own `command -v yad` with a `PATH` that has no `yad` prints nothing and exits 1.

## Parallel work

S01 changes the `description:` lines of the same skills at the same time. This story never edits one, and
its block sits after the `# ` title, so a merge of the two keeps both. When S01 merges first: merge
`origin/main` into the branch, keep S01's lines, run the script again, test.
