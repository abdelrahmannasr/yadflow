# Learning context — CLI detection, knowledge-base build, capability map, degrade path

How `yad-connect-learning` reaches DeepTutor, grounds it in the project, and how `yad-learn` consumes the
connection. DeepTutor is a **CLI subprocess** (Apache-2.0, `pip install -U deeptutor`) — it ships **no
MCP server**, so this adapter detects a **binary on PATH**, the same shape as Repomix's `npx` in
`yad-connect-repos`/`yad-backfill`, not the MCP shape of the design/testing tools.

## CLI detection

Best-effort, never fatal:

```
deeptutor --version        # success => provider: "deeptutor-cli", capture the version
deeptutor config show      # fallback probe if --version is unavailable
```

- Binary found → `source: "deeptutor-cli"`.
- Binary absent → `source: "harness-native"` (no error). Report that `yad-learn` will tutor via the
  harness model reading the project artifacts.

DeepTutor's own setup (`deeptutor init`, LLM provider keys under `data/user/settings/`) is the **user's**
responsibility and lives outside this repo. The skill never runs `deeptutor init` and never writes keys.

## Knowledge-base build (grounding)

When `ground: true` and the CLI is present, build/refresh a project knowledge base so tutoring quotes
what is actually being built:

```
deeptutor kb create <kb>             # idempotent — reuse if it already exists
deeptutor kb add <kb> --doc <path>   # once per source path below
deeptutor kb list                    # verify
```

Ingest only **committed, secret-scanned** sources (never raw repos):

- Per epic under `epics/EP-<slug>/`: `epic.md`, `architecture.md`, `contract.md`, `ui-design.md`, and the
  `stories/*.md` files.
- Per connected repo: `.sdlc/code-context/<repo>/code-map.md` (already secret-scanned by
  `yad-connect-repos`). Do **not** add `pack.md` or the raw repo.

Record `kb` and `kb_sources` in the registry. If there are no artifacts yet (greenfield), skip and record
`kb: null` — `yad-learn` falls back to passing context inline.

## Mode → capability map (consumed by `yad-learn`)

`config.yaml` `learning.capabilities` maps a `yad-learn` mode to a DeepTutor capability:

| `yad-learn` mode | DeepTutor capability | use |
|------------------|----------------------|-----|
| `explain` (default) | `chat` | a focused, grounded explanation of the concept |
| `deep` | `deep_research` | a deeper, multi-source dive |
| `quiz` | `deep_question` | generate questions to confirm comprehension (records a signal) |

`yad-learn` invokes:

```
deeptutor run <capability> "<concept> — in the context of <scoped artifact/stage>" \
  --kb <kb> --format json
```

`--format json` streams **NDJSON** — one event per line with a `type` (`content` | `tool_call` |
`tool_result` | `done`) and a `session_id`. `yad-learn` concatenates `content` events into the tutorial
and captures `session_id` from the `done` event for the learning record.

## Degrade path (harness-native)

When `source: "harness-native"` (no CLI, or `tool: "none"`), `yad-learn` does **not** fail. It tutors
using the **harness model itself**: it reads the scoped epic's `epic.md` / `architecture.md` /
`contract.md` / code-maps and explains the concept grounded in them. The local-only learning record is
written identically (with `"tool": "harness-native"`), so the learning layer always works and always
records — DeepTutor only adds knowledge-base grounding, deep research, and quizzes.

## Freshness

Like the code-context cache, the knowledge base can drift from the artifacts. `refresh` rebuilds it from
the current committed artifacts and moves `lastSyncedAt`. Rebuilding is a human decision (run `connect`/
`refresh`); `yad-learn` never silently rebuilds the kb mid-tutorial — at most it notes the kb may be
stale and proceeds.
