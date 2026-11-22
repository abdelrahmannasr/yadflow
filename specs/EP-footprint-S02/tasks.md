# Tasks — EP-footprint-S02 (engine)

The three tasks are stacked: each branch starts from the one before it.

## T01 — the block's source, the script that writes it, and the generator's unit tests

**Files:** `cli/skill-yad-cli.mjs`, `scripts/skill-yad-cli.mjs`, `cli/test-detect.mjs`

**Done when:** the unit tests in `cli/test-detect.mjs` pass on a temp skills folder (R1–R3, R5), and
`npm test` and `npm run lint` pass. The real skills are not changed yet.

## T02 — write the block into every skill that runs yad, and hold it there with the drift test

**Files:** `skills/*/SKILL.md` (each skill `scripts/skill-yad-cli.mjs` changes: 40 of them), `cli/test-detect.mjs`

**Done when:** `node scripts/skill-yad-cli.mjs --check` exits 0, the drift test (R4, R6) passes, the E87,
brain and agent-guide checks still pass, and no `description:` line changed. Passes the 3-file guard with
`yad commit --force`, which the person allowed for this task only.

## T03 — the README Quickstart line and the design decision

**Files:** `README.md`, `docs/design-rules.md`

**Done when:** the Quickstart says "yadflow skills need the `yad` CLI, because the CLI enforces
approvals.", and Part 9 records why the skills keep the CLI dependency (R7).
