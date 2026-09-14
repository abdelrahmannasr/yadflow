# Shape 10 — a deferred step can come back late

**What a "shape" is:** the layout of the files yadflow writes into your project. Every one of them
carries a `"schemaVersion"` number saying which layout it uses. A file with no number counts as 1.

**What a step is:** one piece of an epic's chain in `.sdlc/state.json`, such as `ui-design` (write the
UI design) or `ui-design-review` (its review gate). **Deferring** a step — `yad defer` — sets an optional
step aside to do later. The chain goes on past it, and its review is still owed.

Shape 10 lets a deferred step come back after later work has finished. **Nothing in your project is rewritten.** The only thing written to your files is the new shape
number.

## What changes

| Before | From shape 10 |
|---|---|
| `yad undefer` was refused once the step after the deferred pair was finished (on `classic`, once `stories` was done). | `yad undefer` works at any time. After later work has finished, the step **re-opens beside that work**, which stays done. |

### A step re-opened beside finished work

Say `ui-design` was deferred, and the team then wrote and approved the stories. `yad undefer EP-x
ui-design` now gives:

| Step | Status after `yad undefer` |
|---|---|
| `ui-design` | `in_progress` — being worked on again |
| `ui-design-review` | `todo` |
| `stories`, `stories-review` | unchanged — still `done` |
| `currentStep` | unchanged — for example still `ready-for-build` |

The re-opened step runs **beside** the chain, the way the `test-cases` track does:

- It does not block the finished work in front of it.
- Opening its review does not move `currentStep` back to it.
- When its review passes, nothing after it is re-opened.
- `yad next` shows it on its own line, `re-opened lane: …`.

yadflow tells a re-opened step from the shape of the chain — an unfinished step with work **completed
here** after it — and never from a flag, so a word typed into `state.json` cannot unblock a chain.

`yad unskip` does **not** change. A skip says a step does not apply, so work finished after it was built
without it, and putting it back after that is still refused.

## Why it needs a new shape

An older yadflow cannot read a chain with a step re-opened behind finished work. It would name that step
the blocker of the stories review, and when the UI review passed it would re-open `stories`. Moving the
number is what makes an older yadflow warn that the project is on a newer shape, instead of doing that.

## What to do

- **Local ledger:** run `yad migrate` to preview, then `yad migrate --apply`. Only the number moves.
- **Verified ledger:** nothing to run. CI owns `state.json`, and its next gate write moves the number.
- Anyone else working on the project should upgrade yadflow too, before using `yad undefer` late.
