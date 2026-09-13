# Shape 8 — the Foundation

**What a "shape" is:** the layout of the files yadflow writes into your project. Every one of them
carries a `"schemaVersion"` number saying which layout it uses. A file with no number counts as 1.

Shape 8 gives the **Product level** — the part of a project that runs once, before any feature epic — a
proper home. It is now called the **Foundation**. It lives in its own folder, `foundation/`, at the top
of your project, under the fixed id `EP-foundation`.

**Read this one before you upgrade** if your project has an `epics/EP-discovery/` folder. If it does
not, nothing in your project moves, and you can skip to "What to do".

## What the Foundation is

Yadflow has two levels:

| Level | Runs | Holds |
|---|---|---|
| **Product** | Once per product, at the start | the **Foundation** |
| **Feature** | Once per epic | the six phases: Discover, Design, Plan, Build, Release, Operate |

The Foundation says why the product exists, what it is and is not, the smallest thing worth shipping,
and the rough order after that. It has one review gate. It is written by the `yad-discovery` skill, and
the engine seeds its ledger with a new command, `yad foundation new`.

Its sections are one Markdown file each, in `foundation/`:

| File | Section | Required? |
|---|---|---|
| `purpose.md` | Why this exists, who it is for, what success looks like | required |
| `market.md` | Who else does this, and why us | optional |
| `scope.md` | What it is, and explicitly what it is not | required |
| `mvp.md` | The smallest thing worth shipping | required |
| `roadmap.md` | The rough order after the MVP | required |
| `stack.md` | Languages, frameworks, hosting, databases | required |
| `repos.md` | How many repos, what each does | required |
| `risks.md` | What could kill this | optional |

The gate asks for **one approval before feature work begins**. In this release that is **reported, not
enforced**: `yad next` tells you when feature epics are going ahead of an unapproved Foundation, and
nothing is blocked.

## Before: `EP-discovery`

Every release before this one had the same idea under a different name: an optional "epic zero" called
`EP-discovery`, in `epics/EP-discovery/`, with six files (`market-research.md`, `competitor-analysis.md`,
`current-state.md`, `feasibility.md`, `requirements.md`, `roadmap.md`) and a two-step chain
(`discovery` → `discovery-review` → `discovery-done`).

A product has **one** product level. So the old one is not kept beside the new one — it is converted.

## What changes in your files — local ledger

If your project's ledger is **local** (the default), `yad migrate --apply` moves the old product level
into the Foundation's folder:

| Before | After |
|---|---|
| `epics/EP-discovery/<every file>` | `foundation/<the same file>` |
| `epicId: "EP-discovery"` | `epicId: "EP-foundation"` |
| `kind: "discovery"`, `profile: "discovery"` | `kind: "foundation"`, `profile: "foundation"` |
| step ids `discovery`, `discovery-review` | `foundation`, `foundation-review` |
| `currentStep: "discovery-done"` (or either step id) | `foundation-done` (or the new step id) |
| `step` on every record in `approvals.json`, `comments.json`, `product-prs.json`, `hub-prs.json` | the new step id |

**What stays exactly the same:**

- **The six files keep their names and bytes.** They are not rewritten into the eight new sections —
  that is writing, not migrating, and only you can do it.
- **Every approval stays valid.** Each approval is bound to a fingerprint of those six files. The
  fingerprint is computed over the same names and the same bytes after the move, so it is identical.
  This is also why the steps keep `"artifact": "discovery/"`: that is what tells the gate to fingerprint
  the six files. If you later rewrite the Foundation into the eight sections, change the steps'
  artifact to `foundation/` and review it again — a rewrite deserves a new review.
- **A review PR's `branch` is not changed.** It records the branch the review really merged from.

**A whole copy of the old folder is kept** at `epics/EP-discovery.yad-orig/`. That name is not a valid
epic id, so no command ever reads it as an epic, and `*.yad-orig` is ignored by git.

### When `yad migrate` refuses to move it

It leaves every file where it is, says why, and the old spelling keeps working:

| It says | What to do |
|---|---|
| a review of it is still open | merge or close that review PR, then run `yad migrate --apply` again |
| `foundation/.sdlc/` already exists — two product levels | decide which one is real. See "If `yad doctor` says something" below |
| `foundation/` already has a file of the same name | move your file aside, then run it again |
| a backup from an earlier run is in the way | delete or move `epics/EP-discovery.yad-orig/`, then run it again |
| a ledger file does not parse | restore it from git first. This is the one refusal that makes the command exit with an error |

## What changes — verified ledger

**Nothing moves.** In verified mode CI is the only writer of the ledger, and the ledger guard rejects a
commit by a person that moves it. So `yad migrate` reports the product level as `CI owns this ledger`
and leaves it in `epics/EP-discovery/`.

That is safe. This release reads the old spelling everywhere: `yad next`, `yad gate`, `yad doctor` and
CI all treat `EP-discovery` as the product level, and its review still ends at `discovery-done`. A
later release converts it from CI.

**One thing to do on a verified Product: run `yad update`.** The Foundation's ledger folder,
`foundation/.sdlc/`, is protected only by a `checks/ledger-guard.sh` from this release or later —
that script is committed in your repo, and `yad update` is what refreshes it. The same is true for
`checks/pr-title.sh` and `checks/pr-template.sh`, which stop a Foundation section being changed on a
branch that is not a review branch. If you have a Foundation and the old checks, `yad doctor` warns
(`foundation:guard`) until you do.

## Do not run a 3.x yadflow against a migrated project

An older yadflow looks for the product level under `epics/` and does not know `foundation/` exists. On
a converted project it shows no product level at all, and `yad epic new` from that version would let you
seed a second one. Nothing is damaged, but upgrade everyone on the project together.

The other direction is safe: this release reads every older project correctly, `EP-discovery` included.

## What to do

```
yad migrate            # see what would change — writes nothing, and names every file it would move
yad migrate --apply    # make the change; the old folder is kept whole as epics/EP-discovery.yad-orig/
yad update             # refresh the checks committed in your repo (needed on a verified Product)
```

Safe to run twice: once the old folder is gone, there is nothing left to move.

**Starting a Foundation on a project that has no product level:**

```
yad foundation new     # seeds foundation/.sdlc/ — then run the yad-discovery skill to write the sections
```

It refuses if the project already has a Foundation, or still has an `epics/EP-discovery/`.

## If `yad doctor` says something

| It says | What it means | What to do |
|---|---|---|
| `the product level is in its old spelling` (warning) | a local ledger that has not been converted | `yad migrate`, then `yad migrate --apply` |
| `the product level is in its old spelling` (ok) | a verified ledger — it stays there | nothing |
| `two product levels` | both `foundation/` and `epics/EP-discovery/` have a ledger | decide which is real. `yad next` uses `foundation/`. To keep the old one instead, move `foundation/` aside and run `yad migrate --apply` |
| `epics/EP-foundation/ exists` | a folder no command ever reads — that id's folder is `foundation/` | move anything real into `foundation/`, then delete it |
| `the wired checks predate the Foundation` | a verified Product with a Foundation and old checks | `yad update`, then commit the refreshed checks |

## Going back

Before you commit: delete `foundation/`, then rename `epics/EP-discovery.yad-orig/` back to
`epics/EP-discovery/`. Every file is exactly as it was. After you commit, `git revert` the migration
commit.
