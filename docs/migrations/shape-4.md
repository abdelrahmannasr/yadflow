# Shape 4 — the two dials get their real names

**What a "shape" is:** the layout of the files yadflow writes into your project. Every one of them
carries a `"schemaVersion"` number saying which layout it uses. A file with no number counts as 1.

Shape 4 renames the two settings every step carries. Nothing about how your project behaves changes.

## What changed

Each step in `epics/<epic>/.sdlc/state.json` — and in each
`epics/<epic>/.sdlc/build-state/<story>.json` — declares two things: **who does the work**, and **who
moves it forward**. Those two settings are called the *dials*. They now have names that say what they
mean:

| Old | New | Meaning |
|---|---|---|
| `assistance: none` | `driver: human` | a person does it, no AI |
| `assistance: review` | `driver: pair` | a person and an agent together |
| `assistance: heavy` | `driver: agent` | an agent does it |
| `automation: human_approve` | `advance: human` | a person moves it to the next step |
| `automation: machine_advance` | `advance: auto` | it moves on by itself |

**Both names are written, and the OLD one is still the one being read.** That is deliberate. Renaming
a setting across a whole ecosystem takes three releases, not one:

| | |
|---|---|
| **this major** | the new name appears beside the old one. The old name still counts, so everything that already reads it keeps working |
| **next major** | the new name becomes the one that counts, and `yad doctor` warns about the old one |
| **the one after** | the old name is removed |

Skipping to the end would break things quietly. Twenty-nine skills hand-write `state.json` from
instructions that say `assistance` and `automation`, and an older copy of the CLI reads only those
names. Move the setting out from under them and a step silently loses its dial, with nothing to say
why.

## What to do

```
yad migrate            # see what would change — writes nothing
yad migrate --apply    # make the change; every file is copied to <name>.yad-orig first
```

Safe to run twice. A step that already has the new name is left exactly as it is.

## Three things worth knowing

**A review step is never given `advance: auto`.** A review gate can never move itself forward — that
is the one rule in yadflow that never bends. If a step is a review (`type: "review+approve"`, or
`locked: true`) and somehow carried `machine_advance`, the migration writes `advance: human` instead
and leaves the old value where it is, so `yad doctor` reports the mismatch rather than hiding it.
This is the first release where that rule is enforced by code rather than by instructions.

**`trust-log.json` is not migrated, on purpose.** Its `automation` field records what the dial *was*
when a run happened. That is history, not a setting. Rewriting it would falsify the evidence the trust
ledger exists to hold.

**If your project is in verified mode, `state.json` is skipped — and that is expected.** In verified
mode CI is the only thing allowed to write the gate ledger, so `yad migrate` reports those files as
`CI writes it` and does not touch them. Your `build-state` files migrate immediately; `state.json`
gains the new names the next time the gate writes it (any `yad gate` command, or the CI gate sync on
your next review). You do not need to do anything, and nothing is broken in between — the old names
are still the ones being read.

## If `yad doctor` says something

| It says | What it means | What to do |
|---|---|---|
| `N step(s) carry two different dial values` | one spelling says one thing and the other says something else — somebody edited one of them | set both to the value you meant. `yad migrate` skips a step that already has the new name, so it cannot decide this for you |
| `a review step is set to advance on its own` | a review gate is marked `advance: auto` | set it back to `advance: human` / `automation: human_approve`. `yad migrate` never writes this value, so something else did |

## Going back

Every file `yad migrate --apply` rewrites is copied to `<name>.yad-orig` first. To undo, copy those
back over the originals. They are ignored by git, so they never end up in a commit.
