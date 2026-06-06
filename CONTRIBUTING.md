# Contributing

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
✅ feat(sdlc-run)!: change the dial schema

❌ feat: Add retry to the login flow      # capital "Add" (sentence-case)
❌ fix: Handle null user.                  # capital + trailing period
❌ Feat: add retry                         # capitalized type
```

> Note on the two conventions: the "capitalize the subject line" advice you may have seen is the
> *plain-git* (Tim Pope) style for subjects **without** a type prefix. Once you adopt `feat:`/`fix:`,
> lowercase is the matching norm — don't mix the two.

## How the SDLC workflow follows this

The same rule governs the artifacts the workflow generates, so contributions and machine-assisted work
read identically:

- **Commit subjects** written by `sdlc-implement` follow `<type>: <lowercase description>` plus the
  `Task: <story>-<task>` trailer (see `skills/sdlc-implement/references/implement-conventions.md`).
- **PR/MR titles** produced for a task default to that task's commit subject — one atomic task = one
  branch = one PR/MR (see `skills/sdlc-pr-template/`).
- The machine-readable statement of the convention lives in `skills/sdlc/config.yaml` under
  `build.commit_subject_style` / `build.pr_title_style`.

## Branches, trailers, and gates

Branch names, the `Task:` / `Contract-Change:` commit trailers, the check gates, and the review rules
are described in `README.md` and the per-step skills under `skills/`. Run `bash skills/sdlc/install.sh`
after any BMAD update to re-sync the installed skill copies.
