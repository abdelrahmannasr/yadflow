# Shape 7 — the step-state model

**What a "shape" is:** the layout of the files yadflow writes into your project. Every one of them
carries a `"schemaVersion"` number saying which layout it uses. A file with no number counts as 1.

Shape 7 gives a step's `status` — the field that says where a step stands — a proper vocabulary. Seven
words, each meaning one thing, with a place to record **why** whenever the word is not simply "done".

**Read this one before you upgrade.** Every shape before it only ADDED keys, so an older yadflow could
still read a migrated project. This one changes a value in place, which an older yadflow cannot follow.
There is a section on that below.

## The seven states

| State | Meaning | Must record |
|---|---|---|
| `todo` | Not started | — |
| `in_progress` | Being worked on | — |
| `done` | Completed here | the artifact |
| `skipped` | We consciously chose not to | reason + who + when |
| `deferred` | We will do it, later | reason + who waits |
| `satisfied` | Done elsewhere | link + who + when |
| `blocked` | Cannot proceed, and not by our choice | who or what we are waiting for |

An eighth word, `in_review`, sits beside them: it is `in_progress` on a step that is a review gate, and
it has always been there. Nothing about it changes.

The four states at the bottom carry a **record** — a small object saying why:

```json
{ "reason": "backend-only epic, no user-facing surface", "by": "@al", "date": "2026-07-08" }
```

`reason` is required. `by` and `date` are best-effort — yadflow fills them in from your git identity
when it can, and leaves them `null` when it cannot, because attribution is a nicety on the audit trail
and must never be the thing that blocks a skip. A `satisfied` record also carries a `link` naming where
the work actually happened.

**A recorded skip is not a hole in the audit trail. It IS the audit trail.** That is the whole reason
the record exists.

## `blocked` changes meaning, and this is the important part

Every yadflow up to shape 6 wrote `blocked` to mean **"waiting on an earlier step"** — the ordinary
state of every step in a chain that has not reached it yet. From shape 7 that word means something
else: **"cannot proceed, and not by our choice"** — waiting on a vendor, a legal sign-off, another
team. The old meaning moves to `todo`.

How the two are told apart, in your files and in ours:

> **`blocked` with no record is the old word, and reads as `todo`.**
> **`blocked` with a record is a real blocker, and the record says on whom.**

No release before this one ever wrote a record, so this is exact rather than a guess — and it needs no
version number to work out. That matters for projects in verified mode, whose `state.json` this command
does not rewrite (see below): the old word keeps reading correctly there for as long as it sits.

## What changes in your files

Only `epics/<epic>/.sdlc/state.json`. Three rewrites, each one a translation of something the file
already said:

| Before | After |
|---|---|
| `"status": "blocked"` (with no record) | `"status": "todo"` |
| `"status": "done"` + `"skipped": true` | `"status": "skipped"` + a `record` built from `skipReason` / `skippedBy` / `skippedAt` |
| `"status": "done"` + `"inherited": true` | `"status": "satisfied"` + a `record` naming the parent epic |

A skipped step, before and after:

```json
{ "id": "ui-design", "type": "author", "artifact": "ui-design.md",
  "skipped": true, "skipReason": "backend only", "skippedBy": "@al", "skippedAt": "2026-07-08",
  "status": "skipped",
  "record": { "reason": "backend only", "by": "@al", "date": "2026-07-08" } }
```

**Every old field is kept.** `skipped`, `skipReason`, `skippedBy`, `skippedAt`, `inherited`,
`inheritedFrom` and `boundHash` all stay exactly where they were. Nothing is deleted, and nothing is
invented: the record is assembled from what the skip already recorded, and a step whose skip had no
reason gets a record with no reason rather than a sentence yadflow made up. `yad doctor` reports that.

`boundHash` stays a field of its own and is deliberately **not** folded into the record. It is the
evidence the gate compares against a live hash, not provenance a person reads.

## What does NOT change

- **`build-state/<story>.json` is left alone.** It holds the same words, but the `yad-run` and
  `yad-implement` skills write it, not the engine, so a rewrite would be undone by their next write.
  One thing to know about it: those skills mark a **halted** Build lane `blocked` — a failed check, a
  scope overrun, a contract touch — which is the new meaning, not the old one. From this release they
  write a `record` naming the halt cause beside it. A lane halted by an older `yad-run` has no record,
  so it reads as "not started" until the next run rewrites the file. Nothing advances past it either
  way, so no work is lost; only the word is, and only until then. Run `yad update` to refresh the
  skills in your project.
- **No step moves, no gate re-opens, no approval changes.** This is a rename of the words a step uses
  to describe itself. Which steps have passed, and which approvals justified them, are untouched.
- **`epic.md`, `approvals.json`, `comments.json` and every other ledger.** Not involved.

## Do not run a 3.x yadflow against a migrated project

This is the first shape that changes a value in place instead of adding a key beside an old one. A
value cannot be added beside itself, so an older yadflow reading a shape-7 file will see words it does
not know:

- it reads `todo` as an unknown status, so `yad skip` refuses skips it should allow;
- it reads `skipped` and `satisfied` as "not done", so an epic whose UI step you skipped — or a
  change-epic carrying inherited steps — reads as **stuck**, with `yad next` pointing at a step that
  finished long ago.

Nothing is damaged and nothing is lost; the file is simply being read by a tool that predates its
vocabulary. Upgrade everyone on the project, or hold the upgrade until you can.

The other direction is safe and stays safe for the whole of v4: this release reads every pre-shape-7
project correctly, old words and old flags included.

## What to do

```
yad migrate            # see what would change — writes nothing
yad migrate --apply    # make the change; every file is copied to <name>.yad-orig first
```

Safe to run twice. A step already on a shape-7 word is left exactly as it is, and so is any record you
wrote yourself — an upgrade never rewrites your own sentence about your own step.

**If your project is in verified mode, `state.json` is skipped — and that is expected.** In verified
mode CI is the only thing allowed to write the gate ledger, so `yad migrate` reports those files as
`CI writes it` and does not touch them. They move to shape 7 the next time the gate writes them (any
`yad gate` command, or the CI gate sync on your next review), and `yad doctor`'s "CI-owned and behind"
warning clears on its own. Nothing is broken in between — the old words keep reading correctly.

## What you can do that you could not before

Not much, yet, and that is deliberate. Shape 7 is the vocabulary; the commands that use it come next:

- `yad skip` already writes `skipped` with a real record, as it has since it shipped.
- `yad defer`, a general `yad skip` for any optional step, and the "skipped under emergency, owed back"
  debt flag are separate pieces of work and are not in this release.
- Nothing writes `deferred` or `blocked` yet. If you want to mark a step blocked today, set the status
  and add a record by hand — every reader understands it, `yad next` will name what you are waiting on
  instead of telling you to author the artifact, and no gate is waived by it.

## If `yad doctor` says something

| It says | What it means | What to do |
|---|---|---|
| `N step(s) carry a status this release does not know` | a word from a newer yadflow, or a typo | nothing is rewritten — your file wins. But an unnamed state stops the chain there, so either upgrade to the release that wrote it, or correct the value |
| `N step(s) hold a recorded state with nothing recorded` | a `skipped` / `deferred` / `satisfied` / `blocked` with no `record` | add the `record`, or move the step to the state that actually describes it. A `blocked` with no record is the one that also changes meaning: every reader falls back to treating it as `todo` |

## Going back

Every file `yad migrate --apply` rewrites is copied to `<name>.yad-orig` first. To undo, copy those
back over the originals. They are ignored by git, so they never end up in a commit.
