# Contributing

Conventions for commits, branches, PR/MR titles, and the stable IDs that tie an epic to its stories,
tasks, and shipped code. These are what the gates and checks rely on — a diff that follows them is
traceable back to its task, story, and contract; one that doesn't will fail a gate.

New to the workflow? Start with [`TEAM-GUIDE.md`](TEAM-GUIDE.md); the full reference is
[`README.md`](README.md). Publishing the `yad` CLI to npm is documented in
[`RELEASING.md`](RELEASING.md).

---

## Stable IDs (immutable once assigned)

IDs are assigned once and **never renamed** — every downstream link (branch, commit trailer, spec,
PR, build log) is keyed on them, so renaming one breaks the chain.

| Thing | Format | Example |
|-------|--------|---------|
| Epic | `EP-<slug>` (lowercase words + hyphens) | `EP-istifta-inquiries` |
| Story | `EP-<slug>-S0N` (zero-padded) | `EP-istifta-inquiries-S01` |
| Task | `EP-<slug>-S0N-T0N` (zero-padded) | `EP-istifta-inquiries-S01-T03` |

---

## Commit & PR/MR title convention

This repo uses **[Conventional Commits](https://www.conventionalcommits.org/)** for both **commit
subjects** and **PR/MR titles**. (PRs are squash-merged, so the PR/MR title *becomes* the commit
subject — they follow one rule.)

```
<type>(<optional scope>): <description>
```

- **`<type>` is lowercase**, one of: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`,
  `ci`, `chore`, `revert`.
- **`<description>` starts lowercase**, is written in the **imperative mood**, and has **no trailing
  period**. (This matches the default `@commitlint/config-conventional`, which rejects a sentence-case
  / capitalized subject.)
- **Proper nouns, acronyms, and identifiers keep their natural case** — only the *first word* is
  forced lowercase.
- Use `!` after the type/scope (or a `BREAKING CHANGE:` footer) for a breaking change.

```
✅ feat: add retry to the login flow
✅ fix: handle null user in session guard
✅ docs: merge Phase 5 plan               # "merge" lowercase; "Phase 5" is a proper noun
✅ fix: refresh OAuth token before expiry # acronym keeps its case
✅ feat(yad-run)!: change the dial schema

❌ feat: Add retry to the login flow      # capital "Add" (sentence-case)
❌ fix: Handle null user.                  # capital + trailing period
❌ Feat: add retry                         # capitalized type
```

> Note on the two conventions: the "capitalize the subject line" advice you may have seen is the
> *plain-git* (Tim Pope) style for subjects **without** a type prefix. Once you adopt `feat:`/`fix:`,
> lowercase is the matching norm — don't mix the two.

### Trailers (implementation commits)

Implementation commits carry a **`Task:` trailer** — the anchor the spec-link gate and the PR read to
connect the diff to its spec and story — in a single contiguous trailer block:

```
<type>: <subject>

<body — what and why, 1–3 lines>

Task: <story-id>-<task-id>
[Contract-Change: yes]
[Co-Authored-By: <AI name> <email>]
```

- `Task: <story-id>-<task-id>` (e.g. `Task: EP-istifta-inquiries-S01-T01`) is **required** — the
  spec-link check finds it with git's order-independent trailer parser, so it need not be the last line,
  but all trailers must sit together in the last paragraph (no blank lines between them).
- **Trailer order:** `Task:` → `Contract-Change:` (if any) → `Co-Authored-By:` (if any), last.
- **`yad commit`** builds this for you: `yad commit --type <t> -m "<subject>" [--ai <tool>]
  [--contract-change]` derives the `Task:` trailer from the branch, emits the trailers in this exact
  order, and guards against a non-atomic stage. `--dry-run` prints the message without committing.
- `Contract-Change: yes` appears **only** when the diff alters the locked contract surface (see below).
  Omit it for normal work.

### Commit ownership & AI co-authors

The **human git author owns every commit**; an assisting AI tool is recorded **per commit** as a
`Co-Authored-By` trailer — never as the author. Pick the tool from the allowed list in
`skills/sdlc/config.yaml` (`build.ai_coauthor.allowed`):

```
Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: GitHub Copilot <copilot@users.noreply.github.com>
Co-Authored-By: Cursor <noreply@cursor.com>
Co-Authored-By: CodeRabbit <noreply@coderabbit.ai>
```

For a fully human-authored commit, choose `id: none` — omit the trailer (it is optional;
`ai_coauthor.required` is `false`). `yad-implement` installs a `.gitmessage` template
(`git config commit.template .gitmessage`) that pre-scaffolds these as commented lines to uncomment.

### How the SDLC workflow follows this

The same rule governs the artifacts the workflow generates, so contributions and machine-assisted work
read identically:

- **Commit subjects** written by `yad-implement` follow `<type>: <lowercase description>` plus the
  `Task: <story>-<task>` trailer (see `skills/yad-implement/references/implement-conventions.md`).
- **PR/MR titles** produced for a task default to that task's commit subject — one atomic task = one
  branch = one PR/MR (see `skills/yad-pr-template/`).
- The machine-readable statement of the convention lives in `skills/sdlc/config.yaml` under
  `build.commit_subject_style` / `build.pr_title_style`.

---

## Branches

One atomic task = one branch = one PR/MR. Branch off the code repo's default branch:

```
feat/<story-id>-<task-id>-<short-slug>
```

`<short-slug>` is 2–4 hyphenated words naming the change. Example:
`feat/EP-istifta-inquiries-S01-T01-create-inquiry`. Never reuse a branch for a different task, and never
fork a second branch for the same task.

When you open the PR/MR, fill the template's **Story / task** and **Impact & Risk** blocks
(`yad-pr-template` installs it). `high` risk (or a touched contract / auth / payments surface) routes
the review to domain owners — the same escalation `yad-review-gate` applies. Run
`bash checks/risk-route.sh <description>` to list them.

---

## The two hard rules behind the trailers

**File boundary.** Each task in `tasks.md` declares a `Files:` list (≤3 where possible). The diff must
stay inside it. If a task genuinely needs another file, **stop** — treat it as a spec bug, correct the
task's declared files (re-run `yad-spec` / re-scope), then implement. A diff that quietly spreads beyond
its declared files is the easiest way to smuggle unreviewed scope past the gates.

**Contract change.** *Consuming* the locked contract (building an endpoint/event/entity to its already
agreed shape) is normal — no trailer. *Changing* the agreed shape itself is not an implementation
decision: stop, go back to the **architecture gate**, amend and re-lock `contract.md`, then implement
with `Contract-Change: yes`. This keeps the contract singular and owned upstream — a code repo can never
widen the shared surface from inside an implementation branch.

Full detail: `skills/yad-implement/references/implement-conventions.md`.

---

## Before you push

- Run the check gates: `yad-checks repo:<repo> action: run` (spec-link, contract-check, build/test/lint
  must pass).
- Make atomic commits — one logical change per commit.
- Open the PR/MR with the wired template; let the engineer review (a human) be the merge gate.
- Run `bash skills/sdlc/install.sh` after any BMAD update to re-sync the installed skill copies.
