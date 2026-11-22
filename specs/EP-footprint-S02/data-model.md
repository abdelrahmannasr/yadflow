# Data model — EP-footprint-S02

No data is stored. This story adds no file shape, no state field and no contract entity (the epic is on the
chore route and has no contract).

## Local (engine only)

| Name | Where | What |
|---|---|---|
| `YAD_CLI_BEGIN`, `YAD_CLI_KEY`, `YAD_CLI_END` | `cli/skill-yad-cli.mjs` | the block's marker lines |
| `YAD_CLI_LINES` | `cli/skill-yad-cli.mjs` | the block's words, between the markers |
| `YAD_CLI_MENTIONS_ONLY` | `cli/skill-yad-cli.mjs` | skill → why it names a `yad` command it does not run |
| `syncSkillYadCli(dir, { check })` result | `cli/skill-yad-cli.mjs` | `{ stale: [skill], wrote: [skill], refused: [{ skill, reason }] }`, the shape of `syncSkillFallbacks` |
