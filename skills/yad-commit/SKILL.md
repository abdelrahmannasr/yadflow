---
name: yad-commit
description: 'Build-half helper of the gated SDLC. Commit ONE staged atomic change by the conventions — a Conventional-Commits subject, the fixed trailer order (Task → Contract-Change, plus an OPTIONAL Co-Authored-By), and an atomic-file guard (≤3 files). By default the commit carries NO AI footer: the human git author owns it, and a Co-Authored-By trailer is added ONLY when --ai <id> is explicitly passed (claude|copilot|cursor|coderabbit; default none = human-only). The flag is the sole switch — never add the footer on the AI''s own initiative. Drives the zero-dependency `yad commit` CLI; never auto-advances. Use when the user says "commit this", "commit by convention", or "make an atomic commit".'
---

# SDLC — Commit by Convention (build-half helper)

**Goal:** Turn ONE staged atomic change into a single commit that satisfies the project conventions
(`CONTRIBUTING.md` / `config.yaml` `build`): a Conventional-Commits subject, the fixed trailer order
`Task → Contract-Change → Co-Authored-By` (the footer **off by default** — added only via an explicit
`--ai`), and the atomic-file guard. This is the standalone commit step — the same engine `yad-implement`
and `yad-ship` use. It **never auto-advances**; it just commits.

## Conventions

- Run **inside the repo holding the staged change** — a code repo under
  `{project-root}/demo-repos/<repo>/`, or the product hub itself. Use absolute paths.
- **Stage first.** Only the staged (`git add`) atomic change is committed. The guard refuses more than
  `ATOMIC_FILE_LIMIT` (3) staged files unless `--force` — split the change instead.
- **Subject** — `<type>: <lowercase imperative description, no trailing period>`; types are
  `feat|fix|docs|refactor|test|perf|build|ci|chore|revert`; proper nouns/acronyms keep their case.
- **Task trailer** — required on a code repo (anchors the `spec-link` + `commit-message` gates). Given
  with `--task`, else derived from the branch (`feat/<story>-<task>-…`). Hub commits are not
  task-scoped, so the trailer is optional there.
- **Contract-Change trailer** — `--contract-change` only when the diff touches the locked contract
  surface; it routes the change back to the architecture gate.
- **AI co-author footer — OFF by default.** No `Co-Authored-By` trailer is written unless `--ai <id>`
  explicitly names a tool. `--ai none` (the default) produces a clean human-only commit. The flag is the
  **only** switch that adds the footer — never add it on the AI's own initiative just because a tool
  helped author the diff. The human is always the author.

## Inputs

- `type`    — Conventional-Commits type (required).
- `message` — the subject text (required), `-m "<subject>"`.
- `ai`      — co-author footer: `claude|copilot|cursor|coderabbit|none` (default `none` = **no footer**;
  the `Co-Authored-By` trailer appears only when this flag names a tool).
- `task`    — Task trailer (optional; derived from the branch when omitted).
- `contractChange` — flag; mark the contract surface touched.

## On Activation

### Step 1 — Confirm the atomic stage
Confirm the change is staged and stays within the file boundary (≤3 files where possible). If more is
staged, split it into separate commits rather than passing `--force`.

### Step 2 — Commit by convention
Run the CLI from the repo root:
```
yad commit --type <type> -m "<subject>" [--ai <id>] [--task <id>] [--contract-change] [--dry-run]
```
Use `--dry-run` first to preview the exact message (subject + trailer block) without committing. The
CLI validates the type, rejects a trailing period, and emits the trailers in the fixed order.

### Step 3 — Stop (no auto-advance)
Report what was committed (files + Task). If `--contract-change` was set, note that it routes back to
the architecture gate. To also open the PR/MR in the same step, use `yad-ship`.

## Hard rules

- **One staged atomic change = one commit.** Never bundle; never exceed the file boundary silently.
- **No AI footer by default.** A `Co-Authored-By` trailer is written ONLY when `--ai <id>` is explicitly
  passed; the default is a clean human-only commit. Never add it on your own initiative.
- **The human author owns the commit.** The AI is at most a `Co-Authored-By` footer, never the author.
- **Trailer order is fixed:** `Task → Contract-Change → Co-Authored-By` (the footer only when `--ai` is given).
- **Never widen the contract here.** A contract touch is flagged (`--contract-change`), not hidden.

## Reference
- Branch/commit conventions + the file-boundary rule: `../yad-implement/references/implement-conventions.md`.
- The full convention text: `CONTRIBUTING.md`; the config: `skills/sdlc/config.yaml` `build`.
- The gate that enforces the subject pattern: `../yad-checks/references/check-gates.md` (`commit-message`).
- Open the PR/MR after committing: `../yad-open-pr/SKILL.md`; both at once: `../yad-ship/SKILL.md`.
