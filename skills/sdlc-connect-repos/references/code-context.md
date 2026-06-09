# Code context — Repomix pack, the code-map prompt, and live on-demand

How `sdlc-connect-repos` turns a connected code repo into an AI-readable picture the front/"brain"
phases can read. Three layers, same Repomix machinery as `sdlc-backfill` (this is the repo-wide
variant; backfill is the one-feature-at-a-time variant).

## Layer 1 — the cached pack (full context)

Run from the product hub, targeting the connected repo (flags from `config.yaml`
`code_context.pack_flags`):

```
npx repomix@latest --compress --include-logs --style markdown \
  -o {project-root}/.sdlc/code-context/<repo>/pack.md
```

- `--compress` — Tree-sitter structural compression (keeps the pack small and signal-dense).
- `--include-logs` — recent git history (default 50; `--include-logs-count N` to change).
- `--style markdown` — human/AI-readable; the default output is `repomix-output.xml`.
- **Secretlint runs by default** — if a secret is reported, **STOP and redact** before any AI reads the
  pack. Never let a secret reach the model or the cache.

Pack the whole repo, or the source boundary defined in the project's constitution. If `npx repomix` is
unavailable, degrade: hand-assemble the same context (the repo's source tree + recent git log) and
record `source: repomix-unavailable` in the registry entry.

## Layer 2 — the code-map (lightweight index, the default the brain reads)

Feed the pack to the AI with the **"describe what exists, do not invent"** instruction (the same
discipline as backfill) and write `{project-root}/.sdlc/code-context/<repo>/code-map.md`:

> You are indexing an ALREADY-BUILT repo from its packed source + git history. Describe ONLY what the
> code actually provides. Do NOT invent capabilities, do NOT propose changes, do NOT fill gaps with
> assumptions. Where something is unclear from the code, mark it `<!-- unverified: ... -->` rather than
> guessing. Produce a SHORT index a brain phase can scan, not a full spec.

Index these sections (omit a section if the repo has none):

```markdown
---
repo: <repo>
artifact: code-map
syncedHead: <sha>
generated: <YYYY-MM-DD>
source: repomix
---

## Stack & conventions
<!-- language(s), framework(s), notable conventions a new feature must follow -->

## Entry points
<!-- how the app starts / is invoked; top-level modules -->

## Public endpoints / APIs
<!-- method + path (or RPC/handler) + one-line purpose — the surface a new contract must not collide with -->

## Events
<!-- event names + producer/consumer, if any -->

## Data models / entities
<!-- the entities + key fields already persisted -->

## Module layout
<!-- the main directories/modules and what each owns -->
```

The code-map is deliberately small so every front phase can load it cheaply. The full `pack.md` is read
only when a phase needs depth (the architecture phase, primarily).

## Layer 3 — live on-demand (a specific area, not a stale repo)

When a front phase needs an area not captured in the code-map, it may re-pack that **slice** live,
scoped to the area, without writing the cache:

```bash
npx repomix@latest --compress --include "<area globs>" --style markdown -o -
```

This is for a one-off look at a specific area. **Staleness is a human decision, not an automatic
side-effect:** when a repo is stale (HEAD ≠ `syncedHead`), the phase **flags it and stops** —
"`<repo>` is stale; run `sdlc repo refresh <repo>` to re-pack the cache + `syncedHead`" — rather than
silently re-packing the whole repo. A phase never refreshes the registry on its own; the human runs
`sdlc repo refresh` (or `sdlc check --fix`).

## Why this stays DRY with backfill

`sdlc-backfill` already documents the exact Repomix command, the Secretlint discipline, the
`repomix: unavailable` degrade, and the "describe what exists, do not invent" prompt
(`../sdlc-backfill/references/backfill.md`). This skill reuses all of it; the only differences are
**scope** (repo-wide index vs one feature) and **output** (a lightweight code-map for the brain vs a
human-approved feature spec). Backfill produces a *verified* spec that gates changes; connect produces a
*context* artifact that informs design — they are complementary.
