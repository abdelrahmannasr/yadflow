# Implement conventions — branch, commit, file boundary, contract change

Step B (`sdlc-implement`) turns ONE atomic task into ONE branch and ONE commit in the code repo. These
conventions are what the later steps (check gates §C, PR template §D, review §E) rely on to trace a
diff back to its task, story, and contract.

## Branch naming

```
feat/<story-id>-<task-id>-<short-slug>
```

- `<story-id>` — the permanent story ID, e.g. `EP-istifta-inquiries-S01`.
- `<task-id>` — the atomic task ID from `tasks.md`, e.g. `T01`.
- `<short-slug>` — 2–4 hyphenated words naming the change, e.g. `create-inquiry`.

Example: `feat/EP-istifta-inquiries-S01-T01-create-inquiry`. Branched off the code repo's default
branch. One task = one branch; never reuse a branch for a different task, never fork a second branch
for the same task.

## Commit message

```
<type>: <subject ending with what changed>

<body — what and why, 1–3 lines>

Task: <story-id>-<task-id>
[Contract-Change: yes]
```

- The **`<type>` is lowercase** (`feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`,
  `chore`, `revert`) and the **`<subject>` starts lowercase**, is **imperative**, and has **no trailing
  period** — Conventional Commits (see `CONTRIBUTING.md` and `config.yaml` `build.commit_subject_style`).
  Proper nouns/acronyms keep their case (`fix: refresh OAuth token`). e.g. `feat: add POST /inquiries
  create path`, not `feat: Add POST /inquiries create path.`
- The **final trailer is the task ID** (`Task: EP-istifta-inquiries-S01-T01`) — this is the anchor the
  spec-link check (§C) and the PR (§D) read to connect the diff to its spec and story.
- `Contract-Change: yes` appears **only** when the diff alters the locked contract surface (see below).
  Omit it for normal implementation.

## File-boundary rule (hard stop)

Each task in `tasks.md` declares a `Files:` list (≤3 where possible). The implementation diff must stay
**inside that list**. If the task genuinely needs a file not listed:

1. **Stop.** Do not widen the diff silently.
2. Report the extra file(s) needed.
3. Treat it as a **spec bug**: the task's declared files were wrong. Correct the task (re-run
   `sdlc-spec` / re-scope) so the boundary is right, then implement.

A diff that quietly spreads beyond the declared files is the single easiest way to smuggle unreviewed
scope past the gates — hence the hard stop.

## Contract-change rule

The **locked contract surface** is the cross-repo agreement in `epics/<epic>/contract.md` (the
`CONTRACT-SURFACE` block, hash-locked at `.sdlc/contract-lock.json`). Distinguish:

- **Consuming the contract** (normal) — implementing an endpoint/event/entity to the shape the contract
  already agreed (e.g. building `POST /inquiries` to its agreed request/response). **Not** a contract
  change; no trailer.
- **Changing the contract** (exceptional) — altering the agreed shape itself (new field crossing repos,
  changed status enum, new shared endpoint). This is **not** an implementation decision. Stop, go back
  to the **architecture gate**, amend and re-lock `contract.md` (which re-escalates that review per the
  contract `risk_tags`), and only then implement — recording `Contract-Change: yes` so the §C
  contract-check finds the matching, already-updated contract.

This keeps the contract singular and owned upstream: a code repo can never widen the shared surface
from inside an implementation branch.

## Why one task at a time

Small diffs scoped to declared files are reviewable, revertable, and traceable. The heavy spec ceremony
(specify→tasks) ran once for the whole story in Step A; Step B is the **light loop** — repeat per task,
each its own branch and PR, each passing the gates independently.
