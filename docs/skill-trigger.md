# Skill trigger check

An AI agent sees the description of every installed skill in each session, and it picks a skill from that
text alone. The body of a skill (its steps and rules) loads only once the skill is picked. So a
description decides **when** a skill is used, not how well it works. A description that is too short can
leave a skill unused: the agent does not pick it when it should.

The unit test in `cli/test-agents-file.mjs` holds each `yad-*` description to 300 characters, and all of
them to 10,000 (Product #240). That test checks length only. This check asks a model.

## What it does

`test/skill-trigger/run.mjs` reads the `yad-*` descriptions at two git refs, by default `v4.13.0` (the
long descriptions) and `HEAD`. For each request in `test/skill-trigger/cases.json` it gives the model
only the description list and the request, and asks which one skill it would load first, or `none`.

- **The cases.** There are 102 requests in a person's own words, not copied from either version's text.
  Each skill has 2, 8 test skills that are easy to mix up (commit vs ship, docs vs docs-sync, review
  gate vs review companion), and 10 are plain coding requests where no yadflow skill should be picked. A
  case may list `also`: another answer that is right too, for a request two skills really share.
- **Isolation.** The model runs through the logged-in `claude` CLI in an empty folder, with no tools, no
  skills or slash commands, no MCP servers and no user settings. A first probe call stops the run if the
  model can see any `yad-*` skill of its own: your installed skills would bias the answers.
- **The result.** The run writes `report.md` and `results.json` to its work folder:
  - the right answers for each version;
  - the regressions (right with the old text, wrong with the new);
  - the gains;
  - a table per skill;
  - every wrong answer.
- **Failing.** It exits 1 when the new text gets more than 2 cases fewer right, or when a skill that the
  old text got right is never picked with the new one.

## Run it

```bash
npm run test:trigger:selftest                                   # no model, no credit (CI runs this)
YAD_TRIGGER=1 npm run test:trigger                              # v4.13.0 vs HEAD, with Sonnet
YAD_TRIGGER=1 node test/skill-trigger/run.mjs --old v4.14.0 --new HEAD --model sonnet --work <dir>
YAD_TRIGGER=1 node test/skill-trigger/run.mjs --limit 3         # a cheap smoke run
```

The real run asks about 2 × 102 short questions. That spends credit on your Claude account and takes about
10 to 20 minutes, so it never runs in CI or in `npm test`. Answers are cached in `<work>/answers.jsonl`:
the same `--work` folder resumes a stopped run instead of paying again.

Run it when you change skill descriptions, with `--old` set to the last release.

## Result for 4.14.0 (2026-11-22, Sonnet)

The descriptions went from 31,438 to 9,239 characters (counted as read, after YAML unquoting).

| | v4.13.0 | 4.14.0 |
|---|---|---|
| Right answers | 97/102 (95%) | 100/102 (98%) |

- **1 regression.** "Run the safety checks on this branch before it goes to review." The answer was
  `yad-checks` with the old text, and `yad-scan` (the security and tech-debt review) with the new. Both
  skills check a branch before review, so the request itself is close to both.
- **4 gains.** With the old text, the model sent four requests to `yad-guide`, whose description said
  to load it "before ANY yadflow work": an analysis brief, a backfill, a new epic and a gate question. With
  the new text, it picked the right skill for each.
- **1 wrong answer with both.** "Add a dark mode toggle to the settings page" should load no skill, and
  both versions picked `yad-guide`.

Each answer comes from one call, so a rerun can differ by a case or two. A change smaller than the
2-case slack is not a signal.
