# Login attribution — who a record names

This file used to describe the reviewer roster; E62 removed the roster, and it now describes how records
are attributed without one.

yadflow keeps **no stored list of people**. The platform already knows who reviewed, and repository
access already decides who may approve. So every record names the **platform login** that acted.

## Approvals and comments

When `yad gate sync` (or CI, `yad gate ci`) reads a review PR/MR:

- An approval becomes one `approvals.json` record per person:
  ```json
  { "artifact": "<artifact>", "step": "<step id>", "approver": "<platform login>", "status": "approved",
    "date": "<YYYY-MM-DD>", "source": "bridge", "artifactHash": "<hash>", "approvedAt": "<time>",
    "pr": <n>, "commit": "<sha>", "url": "<review url>", "reviewId": "<id>", "engagement": "verified|none" }
  ```
  `pr` is present when the PR/MR number is known. There is no `role`, no `domain` and no `unverified`
  flag. `commit`, `url` and `reviewId` are the platform's evidence for the review (E64), written only
  when the platform gives them — GitHub gives all three; GitLab gives none of them, because an MR
  approval is not tied to a commit. They are a record of what happened; the gate still decides on the
  login and the fingerprint. `approvedAt` is the time the platform gives: GitHub's submission time, or
  GitLab's `approved_at`. A GitLab instance that does not send `approved_at`, and every GitLab record
  written before E64, hold the date the sync first recorded the approval instead. A date is read as
  "time unknown", never compared with a time.
- A comment becomes a `comments.json` record:
  `{ artifact, step, commenter: <platform login>, round, count, date }` — no `role`.
- The dated side file `reviews/<artifact>--<date>--approved.md` lists
  `- <approver> — approved <date> (<source>)`. An older record's role is printed only if that record
  still has one.

There is no lookup step: the login the platform reports is the name written. The gate counts distinct
`approver` values, so the same person is one approver however many records name them.

**Local ledger (no platform).** The `yad-review-gate` skill writes the same shapes by hand. `approver` /
`commenter` is the reviewer's platform login, or the name they give when there is no platform. A team
gate needs 1 distinct approver (solo mode waives it); nothing checks that it is not the artifact's author, so do not record the
author's own approval.

## Older records

Records written while the roster existed may carry `role` and `domain`, and may name a person by their
roster `name` instead of their login. The gate never counts a role; the records stay on disk.

On the first sync after the upgrade, `yad gate sync` recognises the person such a bridge record names,
so it continues that record instead of treating the approval as new:
0. **An exact submission time comes first (GitHub).** When exactly one older record holds the second a
   review was submitted, that review continues it, whatever name the roster now gives it. It continues the
   records **of that review only** — the ones holding that second — never the whole name: two people an
   older release wrote under one name each keep their own record, and neither reads as the other's newer
   review. A name already continued by a time is not an "orphan" for a later approval to guess at (step 2).
   A match by name is per review too: when some of the name's records hold the approval's own time, it
   continues those. On a closed step, a record under that name that no review continued is kept as
   history. **Known cost (chosen 2026-09-17):** the records cannot tell two people who once shared a name
   from one person whose role records ended up at two different times (older releases moved all of a
   person's records together, so that needs a role dropped on a closed step and a later re-approval, or a
   hand edit). Keeping protects the first, likelier case; in the second, that closed step lists the person
   twice, so `gate status` shows one approver more. Nothing advances on a closed step. The name table
   can be wrong — renaming one of two people who shared a name hands the older records to whoever kept
   it. Older GitLab records hold only a date, so there a rename can still put an older approval on the
   wrong person: **do not rename a shared roster name while reviews with older approvals are open.**
1. **With the roster still on disk** — the roster's `name` → `login` pairs make the match exact. This is
   the ONLY thing the roster is read for; it decides nothing about the gate. A name equal to another
   entry's login is still exact (the older record under a name was written from that entry). The one
   exception is a name the roster gives to TWO logins: a record under it could be either person, so it is
   treated like a record no name can place (step 2), and `yad doctor` warns `people:roster-ambiguous`. A
   record an older release marked `unverified` already names a login and is never translated.
2. **Without a roster** — a record is continued only when nothing else could be it: the same submission
   time (GitHub), or — on an open step only — exactly one unmatched approval against exactly one
   unmatched older approver of that PR (GitLab, whose older records hold only a date — this rule still
   applies when the approval now carries `approved_at`). People are never matched
   by list order, and the result is the same whatever order the platform lists reviews in.
3. The continued record keeps the fingerprint and dates it carried, unless the platform shows a newer
   review (a later submission time — a time on both sides, so a date-only record never reads as older —
   or a different PR/MR). When one person's older records
   disagree, the **stale** one is kept — stale meaning outside the fingerprints the gate accepts for the
   artifact (`acceptedHashes`), not merely different from today's hash.
   A continued record is rewritten under the login and drops `role`, `domain` and `unverified`: they
   count for nothing, and a `role` left on a login-named record would make the next sync read it as an
   older record and look its login up as a roster name — which can be another person's. The dated
   `reviews/<artifact>--<date>--approved.md` keeps the roles as they were.
4. **Still ambiguous:** on a closed step nothing is added (its record is history, and a second entry would
   count one person twice); on an open step the approval is recorded against a stale fingerprint from
   those older records, so it must be given again on a new review. If none of those older records is
   stale, there is nothing stale to bind to, and the approval is recorded against the current content.

Comment rounds use the same name → login pairs, so the first sync does not open a new round for
unchanged threads. Without the roster (or for a name two logins share) that sync may open one new round.

## Recording the login on older records (E64)

The steps above need the roster. So, while it is still on disk, every sync write (`yad gate sync`,
`yad gate ci`) records the login on each older record the roster can place for certain. After that, only
the records it could not place (below) still need the roster.

- **What changes on a record.** `approver` / `commenter` becomes the login, and `role`, `domain` and
  `unverified` are removed, exactly as step 3 rewrites a continued record. An approval keeps the name it
  had in `rosterName`. Everything else — fingerprint, dates, `pr` — stays as it was. The dated
  `reviews/*--approved.md` keeps the roles.
- **One record per person, but only for one review.** An older release wrote one record per role, so one
  approval can be several records. They become one record — keeping the stale fingerprint when they
  disagree — only when they prove they are one review: every one holds the same submission **time** and
  the same `pr`. A date is not proof. Every GitLab record from before E64 holds the day it was synced, so
  two people a renamed roster now gives one name look the same; and a hand-written record holds no time
  at all. Such records are left as they are. On GitLab this means one person's role records usually stay
  as they are, and the roster keeps matching them on the next sync of their review.
- **Also left as they are:** a record marked `unverified` (it names a login already), a record under a
  name two logins share, a name the roster does not hold, and a comment round in which two records would
  then name the same login.
- **The exact time still wins.** An approval stamped onto the wrong login (a renamed shared name) keeps
  `rosterName`, so step 0 still matches it by its submission time and hands it to the right person.
- **When it runs.** `yad gate sync` stamps every step of the epic it writes, closed steps included. On a
  verified Product, `yad gate ci` does it on every merge run — the merge event and the scheduled reconcile
  that re-runs it — for **every** epic, including one with no open review, and commits it with the rest.
  It never writes before a merge; it skips an epic with uncommitted changes under `.sdlc` or `reviews`;
  a run whose sync fails leaves no stamp behind; and a record it cannot read, or an epic whose stamp fails, is left as it
  is and named, in any epic — the merged review's own included — without stopping that merge. `yad gate sync <epic>` writes the stamp even when the epic
  has no review PR on file. A Product with no platform never needs it: nothing there matches logins.
- **When the roster can go.** `yad doctor`'s `people:roster-unused` says so: how many older records still
  wait for a gate write (and in which epics), or that none do. Records it cannot place (a shared name,
  records that disagree about the review) are then matched by submission time or given again on a new
  review.

## Who wrote a record (`by`)

Skip, defer, closing records, kill-switch flips and mode changes carry a `by`. It is:

1. the login `gh api user` (GitHub, asked on the repo's own host) or `glab api user` (GitLab) reports, else
2. git `user.name`, else `null`.

`YAD_PLATFORM_LOGIN=0` turns the platform lookup off (offline work, tests). The lookup is best effort and
never blocks the command. Checkpoint and tidy commit subjects show `@<login>` when the login is known,
else the git name.

## Opening a PR/MR

`yad gate open` (review PRs) and `yad open-pr` (task PRs):

- **Assignee** = the person opening it: `@me` on GitHub (`gh` resolves it), the login `glab api user`
  reports on GitLab (no assignee when that lookup fails).
- **Reviewers: none are requested.** The command prints
  `no reviewers were requested — ask them on the PR itself`. E68 will later suggest reviewers from
  history.
- **Labels (`yad gate open` only):** a `domain:<repo>` label per touched domain is still applied — for
  `stories-review` the union of every story's `repos`, for a step tagged `contract`, `auth` or
  `payments` the epic's `repos`. The labels are a hint for whom to ask; they add no approvals.
  `yad open-pr` adds no labels.

## Legacy data `yad doctor` reports

None of these decides anything any more. `yad doctor` warns so the team can delete them:

| Warning | What is left on disk |
|---|---|
| `people:roster-unused` | a non-empty `roster` in `.sdlc/hub.json` — still read for its name → login pairs only (see "Older records"); the hint counts the older records still waiting for a gate write to record their login, and says when it is safe to delete |
| `people:roster-ambiguous` | a roster name given to more than one login (only checked when the roster is non-empty) |
| `people:domain-owners-unused` | a repo in `.sdlc/repos.json` that lists `domain_owner` / `domain_owners` |
| `people:verified-authors-unused` | a `verified_authors` list in `.sdlc/hub.json`, or a `.sdlc/verified-authors` file in the Product or a connected repo |
| `people:allowlist-gate-stale` | an older `checks/verified-commits.sh` that still enforces the author list (a local-ledger Product's CI files are not refreshed by `yad check --fix`) |

`yad roster` is removed (typing it prints a notice and exits 1), and `yad setup` collects no reviewers,
roles, repo owners or commit emails. The verified-commits gate checks platform-Verified signatures only.
