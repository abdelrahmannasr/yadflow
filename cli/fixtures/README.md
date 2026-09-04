# Test fixtures

## `golden-v3/` — a frozen v3 project

This is a real yadflow project, copied verbatim: this repo's own product hub (`.sdlc/`) and its two
`EP-checkout` epics, exactly as they stood before the engine roadmap's Wave 1 began.

**Do not edit anything in this folder.** It is an archive, not a working project. `cli/test-golden.mjs`
hashes every file here and fails if one changes, so an edit shows up as a failing test rather than a
silent drift.

## Why it exists

The roadmap is about to change how the engine reads and writes its files. The rule that keeps that
safe (`docs/roadmap-idea-1.md`, Part 2 rule 6) is: keep one real v3 project frozen, and if a change
alters how the engine sees it, the change is wrong.

`cli/test-golden.mjs` runs three read-only views over this project and compares them to the committed
snapshot in `cli/fixtures/golden-v3.expected.json`:

- `yad next --json` — the one next action for each epic
- `yad doctor --json` — the findings that describe the project (its `epics` and `threads` sections)
- the gate predicate — whether each review gate passes, and under which rule

## When this test fails

It means a change altered the engine's behaviour on a project that did not change. That is the alarm
bell doing its job. Do not refresh the snapshot to make it pass. Work out which change moved it, and
either fix the change or, if the new behaviour is genuinely intended, update the snapshot **in the
same pull request** and say in the description exactly what moved and why.

## What is deliberately not here

The two connected code repos (`demo-repos/backend`, `demo-repos/mobile`) are not copied: they are
gitignored in this repo, and the registry entries pointing at them are part of what makes this a
realistic v3 project. The Repomix context packs (`.sdlc/code-context/*/pack.md`) are gitignored and
regenerable, so only the small `code-map.md` files come along.

## Two shapes on purpose

`EP-checkout` carries a legacy eight-step chain with no `test-cases` step. `EP-checkout-queue-filter`
is a threaded defect on the newer ten-step chain, with inherited steps and a pointer contract-lock.
Freezing both means the golden covers the old shape and the current one at the same time.
