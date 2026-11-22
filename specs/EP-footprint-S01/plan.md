# Plan — EP-footprint-S01 (engine)

## Approach

1. Rewrite the descriptions in five groups (Shape, Build, connectors, reports and docs, other). Each
   new line: one sentence on what the skill does, then "Use when the user says …" with every old
   trigger phrase. Only the `description:` line changes, plus at most one sentence at the end of the
   intro paragraph when the body lacks a dropped detail.
2. After each group, a script checks the trigger phrases, the lengths and the YAML quoting, and the
   full `npm test` and `npm run lint` run, with the generator checks (`scripts/agent-guide.mjs`,
   `scripts/skill-fallbacks.mjs`, `scripts/brain-skills.mjs`).
3. Last, tighten the test in `cli/test-agents-file.mjs` (≤300 each, ≤10,000 in total, fail on a missing
   or multi-line description) and fix the "41 skills" count, in two tasks of ≤3 files.

## Branches

The task branches are stacked: each starts from the one before, so they merge in order. The spec files
land in T01's branch, because every commit's `Task:` trailer must resolve to `specs/EP-footprint-S01/link.md`.

## Testing

- `npm test` and `npm run lint` pass on each task branch.
- By hand: one description made 301 characters long makes the new test fail and name the skill.
