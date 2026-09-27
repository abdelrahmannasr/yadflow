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

`verified: false` until a human approves (the `yad-review-gate` discipline: at least 1 approver who is not the author). On
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
- Only a frontmatter that closes counts: a spec that opens `---` and never closes it is unapproved,
  whatever its body says. A repeated `verified:` key is read as YAML reads it: the last one wins — and any spelling YAML
  may take for the key (`"verified":`, `verified :`, another case) counts as a later line. The last one
  must be exactly `verified: true`, the key in lowercase.
- A **moved** file counts at both ends (E114). The changed list is `git diff --no-renames --raw
  -z`, each path paired with its header NUL by NUL (so a newline in one name cannot shift the rest), so `git mv src/<feature>/x.js lib/x.js` still touches `<feature>`; without `--no-renames` git
  named the move by its new path only and the feature was never checked. `-z` and `LC_ALL=C` keep an
  odd file name (a `"`, a tab, bytes that are not UTF-8) from hiding a path.
- **The spec is read from the base** (E116), never from the PR: which features are being backfilled,
  and whether each spec says `verified: true`. Read from the PR, a PR could approve itself (set
  `verified: true` in the same PR) or delete the spec and read as "not being backfilled". So an approval
  must merge before the change it allows. A spec the PR adds counts once merged. Names are compared as
  macOS and Windows compare them: ASCII case, plus the 13 characters a Mac folds into ASCII alone
  (U+00DF ß and U+1E9E ẞ as `ss`, U+017F ſ as `s`, U+212A Kelvin sign as `k`, the ligatures U+FB00–U+FB06
  as their letters, U+037E and U+1FEF as `;` and `` ` ``). Other non-ASCII case (`CAFÉ`/`café`) and
  NFC/NFD twins are not folded — a stated limit, as in contract-check: `specs/backfill/Billing/spec.md` is
  `billing`'s spec.
- **No link where a backfilled feature lives** (E116). The gate reads paths, so a symlink or submodule
  at `src`, at `src/<feature>` or inside `src/<feature>/` let the code live where no path under `src/`
  names it, and every later edit to the link's target passed. The tree at HEAD is read on every PR,
  before the "no src/<feature> changes" PASS, and such a link is refused by name — only for a feature
  the base is backfilling (a code repo may hold real links elsewhere in `src/`). So is a second spelling
  of that folder at the same time (`Src/billing/` or `src/Billing/` beside `src/billing/`), which is one
  folder on macOS and Windows but two on Linux CI; a lone `Src/` clashes with nothing and is read as
  `src/`. **Not a dead end:** a PR that only deletes a link, or every file of one spelling while
  another spelling stays, is not a change to the feature, so it passes. (Deleting both spellings deletes
  the feature, and is a change to it.) A link where the spec lives on the base (`specs/backfill/<feature>` or its
  `spec.md`) makes that feature unapproved; one at `specs` or `specs/backfill` fails every feature change
  until a PR puts the real folder back, and meanwhile every folder under `src/` is checked for links —
  so that PR must also remove any link under `src/` (it can come back after); the message says so.
  **A repo that keeps `specs` as a symlink** is refused this way on every feature change until it holds
  real files. A path that IS `src/<feature>` (a link, a submodule, or a file
  where the folder goes) counts as that feature; a top-level `src/*.js` file still does not.
- This script is never wired by `yad check`; each copy is placed by hand. `yad doctor` warns
  `checks:rename-blind` when a copy at `checks/backfill-check.sh` (in the Product or a connected repo)
  is an older one that lists a rename by one path, and `checks:backfill-blind` when it is older than
  E116 (it reads the approval from the PR, and does not read the tree for links).
