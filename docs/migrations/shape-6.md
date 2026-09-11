# Shape 6 — the lifecycle profile

**What a "shape" is:** the layout of the files yadflow writes into your project. Every one of them
carries a `"schemaVersion"` number saying which layout it uses. A file with no number counts as 1.

Shape 6 writes down something your project has always had and never said out loud: **which route each
epic takes through the lifecycle**. Nothing about how your project behaves changes, and no epic's steps
move.

## What a profile is

An epic walks a chain of steps — write the epic, review it, design the architecture, review that, and
so on. yadflow has always had more than one such chain. Until now the only way to know which one an
epic was on was to look at its steps and work it out.

A **profile** is that chain, with a name:

| Profile | The chain | Who starts it |
|---|---|---|
| `classic` | the 10-step chain: `epic` first | the `yad-epic`, `yad-stub` and `yad-change` skills |
| `analysis-first` | the 12-step chain: `analysis` before `epic` | the `yad-analysis` skill |
| `discovery` | the product front-zero: two steps, no Build | the `yad-discovery` skill |

These are not new. All three already existed and were seeded by hand; `yad-analysis` has called them
"the 12-step chain" and "the 10-step chain" in its own text for releases. Shape 6 records, per epic,
which one that epic is on.

## What changed

Each epic's `epics/<epic>/.sdlc/state.json` gains one key:

```json
{
  "schemaVersion": 6,
  "epicId": "EP-checkout",
  "createdAt": "2026-03-04",
  "type": "feature",
  "profile": "classic",
  "currentStep": "stories",
  "steps": [ … ]
}
```

That is the whole file change. The steps, the statuses, the approvals and the gates are untouched.

## The value is read off your own chain, never guessed

The migration looks at the steps each epic already carries and works out which route they are on. It
does not default to `classic`.

That matters, because the epics most likely to be defaulted wrongly are exactly the ones with a problem
worth seeing. If an epic's chain fits **no** route — it holds a step no route has, or two steps in the
wrong order — the migration writes **no `profile` key at all** and leaves the epic alone. `yad doctor`
keeps reporting that chain as off-route, which is what you want. Had the migration stamped `classic` on
it, the file would have started agreeing with itself and the warning would have gone quiet, so an
upgrade you ran to be safe would have hidden the one thing it was meant to show you.

An epic that simply **left a step out** is fine and still matches. An epic with no screens drops
`ui-design` and is still on the `classic` route.

## The new command

Shape 6 is what makes it possible for the engine, rather than a skill, to start an epic:

```
yad epic new <slug>                                 # the classic 10-step chain
yad epic new <slug> --profile analysis-first        # the 12-step chain
yad epic new <slug> --type chore                    # upkeep, no user-visible change
yad epic new <slug> --json                          # the same answer for a script
```

It writes the epic's step chain, an empty approvals ledger, an empty comments ledger and the `reviews/`
directory. It writes **no `epic.md`, no branch and no commit** — the epic document is prose you author
with the skill, and that has not moved. It refuses an epic that already has a `state.json`: nothing
here overwrites a ledger.

Two things it deliberately will not seed, each with a skill that does it properly:

- **A `change`, `defect` or `hotfix`.** Those thread off an epic that already exists, so their chain
  inherits that epic's approved steps instead of re-running them, and their approvals ledger carries a
  provenance record for each inherited gate. Use the `yad-change` skill.
- **The `discovery` front-zero.** There is one per product, its id is fixed, and it has no `epic.md`
  and so no work-item type. Use the `yad-discovery` skill.

The skills that seed a chain today keep doing so, and they now write the same `profile` key. Rewriting
them to call the command is a separate piece of work; until then both paths produce the same file.

## What to do

```
yad migrate            # see what would change — writes nothing
yad migrate --apply    # make the change; every file is copied to <name>.yad-orig first
```

Safe to run twice. An epic whose `state.json` already records a profile is left exactly as it is,
whatever it says — your file wins, because a project may hold a route from a newer yadflow than the one
you are running.

## Three things worth knowing

**Your `state.json` is not rewritten by anything else.** The chain stays exactly as it is. If you have
hand-edited a chain over the years, the migration names the route it is on and changes nothing about
it.

**If your project is in verified mode, `state.json` is skipped — and that is expected.** In verified
mode CI is the only thing allowed to write the gate ledger, so `yad migrate` reports those files as
`CI writes it` and does not touch them. `state.json` gains its profile the next time the gate writes it
(any `yad gate` command, or the CI gate sync on your next review), and the shape number it records
moves at the same time — so `yad doctor`'s "CI-owned and behind" warning clears on its own. Nothing is
broken in between: the route is worked out from the chain either way.

**Nothing reads the recorded profile to make a decision yet.** The chain is still the truth: `yad next`
and every gate walk the steps, not the label. The recorded name is what lets a future release seed,
render and reason about a route without re-deriving it each time — and it is why `yad doctor` now
checks that the label and the chain agree.

## If `yad doctor` says something

| It says | What it means | What to do |
|---|---|---|
| `N epic(s) record a lifecycle profile nobody defined` | `profile` holds a value that is not one of the three | set it to the route the chain walks, or delete the key and let it be derived again |
| `N epic(s) record a route their chain is not on` | the label says one route, the steps are cleanly on another | the chain is the truth — it is what `yad next` and the gates actually walk. Correct `profile` in `.sdlc/state.json` |
| `N epic(s) walk a chain that matches no lifecycle profile` | the chain holds a step no route has, or two in the wrong order | this one predates shape 6 and is unchanged. Put the steps back in a route's order, and remove any step no route has — a Build step (`spec`, `tasks`, `implement`, `checks`, `engineer-review`) belongs in no epic chain |

## Going back

Every file `yad migrate --apply` rewrites is copied to `<name>.yad-orig` first. To undo, copy those
back over the originals. They are ignored by git, so they never end up in a commit.
