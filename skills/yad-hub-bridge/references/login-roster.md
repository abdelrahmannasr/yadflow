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
    "pr": <n>, "engagement": "verified|none" }
  ```
  `pr` is present when the PR/MR number is known. There is no `role`, no `domain` and no `unverified`
  flag.
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
1. **With the roster still on disk** — the roster's `name` → `login` pairs make the match exact. This is
   the ONLY thing the roster is read for; it decides nothing about the gate. A name equal to another
   entry's login is still exact (the older record under a name was written from that entry). The one
   exception is a name the roster gives to TWO logins: a record under it could be either person, so it is
   treated like a record no name can place (step 2), and `yad doctor` warns `people:roster-ambiguous`. A
   record an older release marked `unverified` already names a login and is never translated.
2. **Without a roster** — a record is continued only when nothing else could be it: the same submission
   time (GitHub), or — on an open step only — exactly one unmatched approval against exactly one
   unmatched older approver of that PR (GitLab, which has no submission time). People are never matched
   by list order, and the result is the same whatever order the platform lists reviews in.
3. The continued record keeps the fingerprint and dates it carried, unless the platform shows a newer
   review (a later submission time, or a different PR/MR). When one person's older records
   disagree, the **stale** one is kept — stale meaning outside the fingerprints the gate accepts for the
   artifact (`acceptedHashes`), not merely different from today's hash.
4. **Still ambiguous:** on a closed step nothing is added (its record is history, and a second entry would
   count one person twice); on an open step the approval is recorded against a stale fingerprint from
   those older records, so it must be given again on a new review. If none of those older records is
   stale, there is nothing stale to bind to, and the approval is recorded against the current content.

Comment rounds use the same name → login pairs, so the first sync does not open a new round for
unchanged threads. Without the roster (or for a name two logins share) that sync may open one new round. **Keep the roster until every review with older approvals is closed**; delete it after.

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
| `people:roster-unused` | a non-empty `roster` in `.sdlc/hub.json` — still read for its name → login pairs only (see "Older records"), so keep it until older reviews close |
| `people:roster-ambiguous` | a roster name given to more than one login (only checked when the roster is non-empty) |
| `people:domain-owners-unused` | a repo in `.sdlc/repos.json` that lists `domain_owner` / `domain_owners` |
| `people:verified-authors-unused` | a `verified_authors` list in `.sdlc/hub.json`, or a `.sdlc/verified-authors` file in the Product or a connected repo |

`yad roster` is removed (typing it prints a notice and exits 1), and `yad setup` collects no reviewers,
roles, repo owners or commit emails. The verified-commits gate checks platform-Verified signatures only.
