# Risk map — format, the classification rubric, and the rules for the agent

A code repo's **risk map** is one file, `.sdlc/risk-map`, **in the code repo** (not the Product). It
gives each directory a risk level. It holds **no names** — no people, no roles, no teams, no `@login`.
It is the team's file: `yad update` never installs, owns or overwrites it, and it changes only through
that repo's PRs (E65).

Nothing counts the levels yet. E66 will turn a `high` directory into one more required approval; E67
will ask who has committed to it. Until then the map is kept, checked and reported.

## Format

```
# yad-risk-map v1
src/payments/   high    confirmed  # charge.js calls the card processor
src/catalog/    low     guessed    # read-only product listing
docs/           unset
./              low     confirmed  # the files at the repo root
```

| Rule | Meaning |
|---|---|
| Header | The first line is `# yad-risk-map v1`. |
| One line per directory | `<dir>/ <level> <guessed\|confirmed>`, fields split on spaces or tabs, so a path holds none. |
| Directory | Written from the repo root, ending in `/`. No leading `/` or `#`, no `.` or `..` segment, no space, tab, `*`, `?`, `[` or `\`. A directory whose name holds one of those (`app/[slug]/`) cannot have a line of its own: its parent's line covers it. At the top level (`my docs/`) nothing can, and the check says to rename it. |
| `./` | The files **at** the repo root only — not everything below it. |
| Which line decides | The deepest listed directory above a file. |
| Levels | `high`, `medium`, `low`, or `unset` (listed, not classified; its state may be left out). |
| States | `guessed` (an AI agent filled it in) or `confirmed` (a person checked it). |
| Comment | Everything from the first `#` that follows a space or tab. |
| Names | A word starting `@` (`@alice`, `@org/team`) is a name and is warned about. A word ending in `/` (`@types/`) is a directory. |
| No `contract` | The contract surface keeps its own lock, `contract-check` and `Contract-Change` trailer. |

The rules are code: `cli/riskmap.mjs`, with a bash twin in `checks/risk-map-check.sh`.

## Rubric — read the CODE, not the folder name

Decide from what the code in the directory **does**: the calls it makes, the data it writes, the
libraries it imports. A folder called `utils/` can move money; a folder called `payments/` can hold only
display text. Use the pack and the code-map first, and open the files themselves when they do not say.

| Level | The code in the directory… |
|---|---|
| `high` | moves money or bills anyone; handles login, sessions, tokens, permissions, secrets or keys; deletes stored data or changes its shape (migrations); reads or writes personal data (identity, contact, health, payment details); builds, deploys or releases (CI workflows, deploy scripts, infrastructure); **`.sdlc/`**, which holds this map — a change to it decides how much review every later change needs |
| `medium` | writes to a database, a queue or an outside service in ordinary ways; serves a public API or event others depend on; is a shared library most of the code imports; sets build or dependency configuration |
| `low` | only reads and shows data; styling and UI text; documentation; tests, fixtures and examples; developer tooling that never ships |

- **When unsure between two levels, choose the higher one** and say what you could not tell in the reason.
- **Split a directory when its parts differ.** If `src/` holds `payments/` (`high`) and `catalog/` (`low`),
  write a line for each part, and keep a line for `src/` itself for the files directly in it.
- **`.sdlc/` is the one directory judged by what it holds, not by what its code does** (the user's decision, 2026-09-17). A `yad update` PR touches it too, so those PRs ask for the extra approver as well — accepted, because they rewrite the gate scripts a repo runs.
- **The reason is one line, taken from the code**: a file and what it does (`charge.js calls the card
  processor`). Never a name, a secret, a customer value or an address.

## What the agent may and may not change

| Line | The agent may… | The agent may not… |
|---|---|---|
| `unset` | give it a level, a reason and `guessed` | mark it `confirmed` |
| `guessed` | change its level or reason, keeping `guessed` | mark it `confirmed` |
| `confirmed` | nothing — print a **suggestion** when the code now says otherwise | edit, re-level or delete it |
| any | add a deeper line when a directory's parts differ | delete a line, or add a name |

Only a person turns `guessed` into `confirmed`, in a PR in the code repo. The commit records who.

## Staying true

| Where | What it says |
|---|---|
| `checks/risk-map-check.sh` on every PR (both CI templates) | a file this change adds or edits that no line covers (names the directory to add); a line whose directory holds no file; a touched line still `unset` or `guessed`; a line it cannot read or that names a person; a change that edits the map itself. **Warnings only** — it never fails the build |
| `yad risk-map check [repo]` | the same, for the whole repo |
| `yad doctor`, section `risk-map` | one line per connected repo on disk |
| `yad repo refresh` + this skill | a new directory is drafted `unset` and classified; a `confirmed` line the code now contradicts is printed as a suggestion |
