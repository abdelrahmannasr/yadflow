# Research — EP-footprint-S01

## Decisions

- **Measure as the test does.** The value is the single-quoted YAML scalar after `description:`, with the
  quotes stripped and `''` read as `'`. Baseline on `28240fdd`: 42 skills, 31,438 characters, longest
  `yad-product-bridge` (1,019).
- **Budget.** 10,000 characters over 42 skills is about 238 each. Aim for about 230 or less; 300 is the
  ceiling for one.
- **Trigger phrases.** A trigger phrase is each double-quoted phrase after "Use when". A script compares
  the old and new lines and fails when a phrase is missing word for word. Unquoted "or after …" clauses
  are kept in shorter words.
- **Commit type.** The descriptions reach users only through a release, so the rewrite commits are
  `fix:` (semantic-release cuts a patch). The last docs-only commit is `docs:`.
- **Spec Kit.** The Spec Kit skills are on this machine, but the engine repo was never set up for it
  (no `.specify/`), so its commands cannot run here. The files are written by hand in its layout, and
  `link.md` records `speckit: not-installed`.

## Unknowns

None. The story is unambiguous, and the epic has no contract.
