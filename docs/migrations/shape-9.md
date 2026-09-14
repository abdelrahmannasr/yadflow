# Shape 9 — an approval's fingerprint leaves out the status line

**What a "shape" is:** the layout of the files yadflow writes into your project. Every one of them
carries a `"schemaVersion"` number saying which layout it uses. A file with no number counts as 1.

**What a fingerprint is:** an **artifact** is a document a team reviews, such as `epic.md` or a story.
When a reviewer approves one, yadflow records a hash of it — a short code computed from the file's
content — in the approval's `artifactHash` field, in `.sdlc/approvals.json`. If the artifact changes
later, its hash no longer matches, and the approval is **revoked**: it stops counting, so reviewers get
a fresh look at the new content.

Shape 9 changes **what that hash covers**. No field is added, renamed or moved. The only thing written
to your files is the new shape number.

## The problem it fixes

The fingerprint used to cover the whole file. That included the `status:` line in the file's
frontmatter, which is the `---` block at the top. Two parts of yadflow change that line on purpose,
**after** the review:

| Who | When | The change |
|---|---|---|
| the **gate** — the check that decides whether a review has passed | `yad gate ci`, in the run that records the approvals; or `yad sync-status`, run by hand | `status: draft` → `status: approved` |
| **Build** — the phase where stories become code (the `yad-engineer-review` skill) | when a story is being built, or has shipped | `status: approved` → `in-build` or `shipped` |

Each of those writes changed the hash. So right after a clean merge, yadflow reported the approvals it
had just recorded as revoked. This happened on every **epic** (a feature and its documents):

| Where | What it said |
|---|---|
| `yad gate status` | `0 approval(s) from 0 people, 2 stale (revoked)` |
| `yad doctor` | a warning: `all 2 approval(s) are bound to an older …` |
| the **gate sweep** — the scheduled CI job that re-reads merged reviews | `the rule no longer holds (2 stale)` |

Nothing was blocked, because the step had already passed. But the record said the review had not
happened.

## What changes

**A new approval's fingerprint leaves out the frontmatter `status:` line.** Everything else still
counts:

- the body of the file, including a line in the body that starts with `status:`;
- every other frontmatter key, such as `owner:` or `repos:`;
- adding or removing a file in a set. The sets are the stories, the Foundation sections (the product
  documents in `foundation/`) and the old discovery files.

So a status change no longer revokes an approval, and a real edit still does.

Two kinds of approval are not affected at all:

- **architecture** — its fingerprint has always been the locked contract section only;
- **a file with no `status:` line** — its fingerprint is exactly what it was before.

## What does NOT change in your files

- **No field changes.** `yad migrate --apply` writes the new shape number and nothing else.
- **`approvals.json` is not touched.** An old fingerprint was a hash of bytes that no longer exist once
  the status changed, so it cannot be computed again. It does not need to be, because this release can
  still read it.
- **Every approval an older release recorded is read correctly.** That includes the ones it already
  reported as stale after a merge. For each artifact, this release accepts:
  - today's fingerprint;
  - the old whole-file fingerprint of the file as it is now;
  - the old whole-file fingerprint with `status:` set back to `draft`, `in-review`, `approved`,
    `in-build` or `shipped`.

  So an approval recorded before this release, on content nobody has edited since, counts again.

**Two cases stay stale.** An old approval is matched by setting **every** file in a set back to the
**same** status, written the way yadflow writes it: `status: <value>`. It still reads as stale after a
status change when:

- the files in a set had **different** statuses when it was approved — for example one story `draft`
  and another `in-review`; or
- the status line was written differently when it was approved — with spaces after the value, or with
  no space after `status:`. The status change rewrote the line, so its original spelling is gone.

In both cases the step has passed. Re-open the review to record a fresh approval, or leave the warning.

A **change epic** is an epic that reuses an artifact from the epic it changes. Its **inherited step**
records that artifact's fingerprint in a field called `boundHash`. That field is read the same way, so a
status change in the parent is not reported as drift.

## Do not run an older yadflow against a shape-9 project

An older yadflow fingerprints the whole file. It reads **every new approval on a file that has a
`status:` line** as stale:

- `yad gate status` and `yad doctor` report those approvals as revoked.
- On a **local ledger** — a project where people commit the approval files themselves — a mixed team
  can get stuck. Say one teammate records an approval on an open review with this release. Another
  teammate then runs `yad gate sync` with an older release. The older release counts that approval as
  stale, and the gate does not pass for them. The record stays in `approvals.json`; it is just not
  counted.

A release that has the newer-shape warning prints it before most commands (every command except `hook`,
`doctor`, `migrate`, `setup` and `report`). It does this once `.sdlc/cli-version.json` or the product
config says shape 9. A 3.x release has no such warning.

**Upgrade everyone on the project together.**

The other direction is safe: this release reads every older project correctly.

## What to do

**Local ledger:**

```
yad migrate            # see what would change — only the shape number
yad migrate --apply    # make the change
```

Safe to run twice.

**Verified ledger** — a project where CI is the only writer of the approval files:

1. Run `yad migrate --apply`, and commit the result. This stamps `.sdlc/hub.json` and
   `.sdlc/cli-version.json` with shape 9. It leaves each epic's `state.json` alone, because CI owns it.
2. CI brings each epic's `state.json` to shape 9 the next time it writes it. There is nothing to do for
   that.
3. Make sure the gate workflow runs this release. The workflow picks its yadflow version in this order:
   the `YAD_VERSION` variable, then `gate_sync_version` in `.sdlc/hub.json`, then the version in
   `.sdlc/cli-version.json`. **It accepts a pin from those two files only when it is an exact release of
   the workflow's own major version** — the `YAD_MAJOR` line in the workflow file.
   - `yad update` rewrites the workflow and re-stamps `.sdlc/cli-version.json` in the same run, so both
     move to this release's major together. Commit both.
   - A `gate_sync_version` pin from an older major (such as `3.19.0`) is skipped by the new workflow.
     Update it or remove it.
   - If your team edited the workflow file, `yad update` keeps your edit and warns when it still trusts
     the old major. Re-apply the edit on the new file, or run `yad update --overwrite-local`.
   - The `YAD_VERSION` variable overrides both files, for any major.

## If `yad doctor` says something

| It says | What it means | What to do |
|---|---|---|
| `<step> is done, but all N approval(s) are bound to an older <artifact>` | the reviewed content was **edited** after the approval — or it is one of the two cases above | if the edit is real, re-open the review (a fresh pull request or merge request) so the record matches what shipped |
| `… file(s) are newer than this yadflow` (a failure) | you are running an older yadflow on this project | upgrade it |
| a shape check says files are **behind** | `yad migrate --apply` has not been run yet | run it, and commit the result |

## Going back

`git revert` the commit that ran `yad migrate --apply`. Approvals recorded while the project was on shape 9
will read as stale in the older release, for the reason above.
