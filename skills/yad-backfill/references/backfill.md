# Backfill — Repomix pack, the "describe what exists" prompt, and the gate

Backfill (build plan §G) brings an existing repo under the gated SDLC **one feature at a time**, by
recording what is already built as a spec a human approves. It never invents behaviour and never blocks
the whole repo.

## Repomix (the one true CLI subprocess)

`npx repomix@latest [flags]` (Phase 0 / RESEARCH-NOTES §3). For a single feature:

```
npx repomix@latest --compress --include "src/<feature>/**" --include-logs --style markdown -o <out>.md
```

- `--compress` — Tree-sitter structural compression (keeps the pack small and signal-dense).
- `--include "<glob,glob>"` — restrict to this feature's files (one feature at a time).
- `--include-logs` — add the relevant git commit history (default 50; `--include-logs-count N`).
- `--style markdown` — human/AI-readable; default output is `repomix-output.xml`.
- **Secretlint runs by default** — if a secret is reported, STOP and redact before any AI sees the code.

If `npx repomix` is unavailable, degrade: hand-assemble the same feature context (the feature's files +
recent git log for those paths) and record `repomix: unavailable` in the spec frontmatter.

## The "describe what exists, do not invent" prompt

> You are documenting an ALREADY-BUILT feature from its packed source + git history. Describe ONLY what
> the code actually does: its endpoints/inputs/outputs, behaviour, and data as built. Do NOT invent
> requirements, do NOT propose changes, do NOT fill gaps with assumptions. Where the behaviour is
> unclear from the code, mark it `<!-- unverified: ... -->` rather than guessing. Output a spec a human
> can confirm against the code.

## The backfill spec

`specs/backfill/<feature>/spec.md`:

```yaml
---
feature: <feature>
repo: <repo>
artifact: backfill-spec
status: draft
verified: false
source: repomix
generated: <YYYY-MM-DD>
---
```

`verified: false` until a human approves (the `yad-review-gate` discipline: owner + 1 reviewer). On
approval, set `verified: true` and record the approver(s) + date. Only a `verified: true` backfill spec
counts as real.

## Boundary detection (auto-propose, human-confirm)

Propose the feature's file set from the project convention (e.g. a module or a `src/<feature>/`
directory — from the constitution). Present it; a human confirms or adjusts where the code does not
follow the convention. Never finalise a boundary silently.

## The gate — `checks/backfill-check.sh`

A change is blocked **only until the features it touches** have approved specs — not the whole repo:

- For each `src/<feature>/` the diff touches, if `specs/backfill/<feature>/spec.md` exists it must be
  `verified: true`; otherwise **FAIL** (run backfill + approve for that feature first).
- A feature with **no** `specs/backfill/<feature>/` is not this gate's concern (it is either
  forward-spec'd via `yad-spec`, or not yet being backfilled).
- Fails closed on an unresolvable base ref, like the other gates.
