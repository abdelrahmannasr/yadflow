# Shape 5 — the work-item type

**What a "shape" is:** the layout of the files yadflow writes into your project. Every one of them
carries a `"schemaVersion"` number saying which layout it uses. A file with no number counts as 1.

Shape 5 gives a name to something your project already records, adds one missing value, and copies
the answer into the file the engine owns. Nothing about how your project behaves changes.

## The ladder

Work in yadflow sits on four rungs. There is no level above the Product, and none between Story and
Task:

```
Product  →  Epic  →  Story  →  Task
```

Grouping several epics under one heading is a free `theme` tag on the epic, not a rung of its own.

## What changed

Every work item also has a **type**, which is what stops everything being called an epic:

| Type | Meaning |
|---|---|
| `feature` | new value |
| `change` | a change to something already shipped |
| `defect` | something is broken |
| `hotfix` | broken and urgent |
| `chore` | upkeep, no user-visible change |

Four of those five already existed, under the name `kind:`, in each epic's `epic.md` header. Shape 5
does three things:

1. **`type:` is written beside `kind:`** in `epic.md`. Same value, newer name.
2. **`chore` is new**, and it may stand alone with no `parent:` — see below.
3. **Each epic's `epics/<epic>/.sdlc/state.json` records its `type`**, copied from that epic's
   `epic.md`. That is the file change, and it is why the shape number moved.

**Both names are written, and the OLD one — `kind:` — is still the one being read.** Renaming
something across a whole ecosystem takes three releases, not one:

| | |
|---|---|
| **this major** | the new name appears beside the old one. The old name still counts, so everything that already reads it keeps working |
| **next major** | the new name becomes the one that counts, and `yad doctor` warns about the old one |
| **the one after** | the old name is removed |

There is a specific reason here, not just habit. `lineage-check.sh` is a check gate that lives
**inside your code repository**, and it reads `kind:`. It is refreshed by `yad update`, which is a
separate command from `yad migrate` with no ordering between them — so a repository that has migrated
but not updated is a real, ordinary state to be in. If the new name won today, that repository's gate
would look for `kind:`, find none, decide every epic is a parent-free `feature`, and stop asking a
defect for the parent it must have. That is a safety gate switched off by an upgrade, which is the one
thing a migration must never do.

## A `chore` may stand alone

`feature` and `chore` are the two types that may have no `parent:`. Everything else — `change`,
`defect`, `hotfix` — describes work **on** something that already exists, so it has to name what.

Upkeep usually has nothing to hang off: a dependency bump, a CI move, a lockfile refresh. Requiring a
parent there would push people to invent one, and an invented parent is worse than none — the thread
views, the defect report and the timeline all follow `parent:`, and they would file the upkeep under a
feature it has nothing to do with.

## What to do

```
yad migrate            # see what would change — writes nothing
yad migrate --apply    # make the change; every file is copied to <name>.yad-orig first
```

Safe to run twice. An epic whose `state.json` already records a type is left exactly as it is.

## Four things worth knowing

**The type is read from your `epic.md`, never guessed.** The migration opens each epic's own
`epic.md` and copies what it says. If it defaulted to `feature` instead, every defect and change-epic
in your project would be recorded as a parent-free genesis, and the lineage gate would stop asking
them for a parent — again, a safety check quietly dropped during an upgrade.

**`epic.md` itself is not rewritten.** It is a markdown file you and the skills author by hand, and
`kind:` in it is still the name that counts, so nothing has to change for your project to keep working.
From here on the skills write `type:` beside `kind:` on everything new they author.

**Two other words in these files look like this one and are left alone.** In `state.json`, the
top-level `kind` is the lifecycle marker `"stub"` or `"discovery"` — a stub legitimately carries
`kind: "stub"` and `type: "feature"` at the same time. And `steps[].type` is `author` or
`review+approve`, which says what kind of **step** it is, not what kind of work.

**If your project is in verified mode, `state.json` is skipped — and that is expected.** In verified
mode CI is the only thing allowed to write the gate ledger, so `yad migrate` reports those files as
`CI writes it` and does not touch them. `state.json` gains its type the next time the gate writes it
(any `yad gate` command, or the CI gate sync on your next review). You do not need to do anything, and
nothing is broken in between — `epic.md` is what the engine reads either way.

## If `yad doctor` says something

| It says | What it means | What to do |
|---|---|---|
| `N epic(s) record a type only the newest yadflow can see` **(fails)** | an epic says `type: defect` (or `change`/`hotfix`) with no `kind:` beside it | add `kind:` with the same value. Until you do, a `lineage-check.sh` that has not been refreshed reads no type and stops requiring that epic's `parent:`. Run `yad update` to refresh the check gates too |
| `N epic(s) carry only the new name` | the same half-made pair, but on a `feature` or `chore` | add `kind:` beside `type:`. Nothing is at stake here — `feature` is what an older reader assumes anyway |
| `N epic(s) name two different types` | `kind:` says one thing and `type:` says another | the old name is the one being read. Set both to the type you meant. `yad migrate` skips an epic that already has the new name, so it cannot decide this for you |
| `N epic ledger(s) disagree with their epic.md` | `state.json` records a type that `epic.md` does not | `epic.md` is where the type is authored and what the engine reads. Correct `type` in `.sdlc/state.json`, or fix `epic.md` if the ledger was right |
| `N epic(s) use a type nobody defined` | a value outside the five | use one of the five. An unrecognised value is treated as a non-genesis type, so the lineage gate will demand a `parent:` for it |

## Going back

Every file `yad migrate --apply` rewrites is copied to `<name>.yad-orig` first. To undo, copy those
back over the originals. They are ignored by git, so they never end up in a commit.
