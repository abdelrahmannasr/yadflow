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
`commenter` is the reviewer's platform login, or the name they give when there is no platform. The gate
needs 1 distinct approver; nothing checks that it is not the artifact's author, so do not record the
author's own approval.

## Older records

Records written while the roster existed may carry `role` and `domain`, and may name a person by their
roster `name` instead of their login. The gate never counts a role; the records stay on disk.

On the first sync after the upgrade, `yad gate sync` recognises the person such a bridge record names,
so it continues that record instead of treating the approval as new:
1. **With the roster still on disk** — the roster's `name` → `login` pairs make the match exact. This is
   the ONLY thing the roster is read for; it decides nothing about the gate. Two exceptions: a name the
   roster gives to two logins is not used, and a name that is another entry's login cannot be told apart
   — `yad doctor` warns `people:roster-ambiguous` for both. A record an older release marked
   `unverified` already names a login and is never translated.
2. **Without a roster** — a record is continued only when nothing else could be it: the same submission
   time (GitHub), or — on an open step only — exactly one unmatched approval against exactly one
   unmatched older approver of that PR (GitLab, which has no submission time). People are never matched
   by list order, and the result is the same whatever order the platform lists reviews in.
3. The continued record keeps the fingerprint and dates it carried. When one person's older records
   disagree, the **stale** one is kept — stale meaning outside the fingerprints the gate accepts for the
   artifact (`acceptedHashes`), not merely different from today's hash.
4. **Still ambiguous:** on a closed step nothing is added (its record is history, and a second entry would
   count one person twice); on an open step the approval is recorded against a stale fingerprint from
   those older records, so it must be given again on a new review.

Comment rounds use the same name → login pairs, so the first sync does not open a new round for
unchanged threads. **Keep the roster until every review with older approvals is closed**; delete it after.

## Who wrote a record (`by`)

Skip, defer, closing records and mode changes carry a `by`. It is:

1. the login `gh api user` (GitHub) or `glab api user` (GitLab) reports, else
2. git `user.name`, else `null`.

`YAD_PLATFORM_LOGIN=0` turns the platform lookup off (offline work, tests). The lookup is best effort and
never blocks the command. Checkpoint and tidy commit subjects show `@<login>` when the login is known,
else the git name.

## Opening a PR/MR

`yad gate open` (review PRs) and `yad open-pr` (task PRs):

- **Assignee** = the login `gh`/`glab` reports as logged in. On GitHub it falls back to `@me`.
- **Reviewers: none are requested.** The command prints
  `no reviewers were requested — ask them on the PR itself`. E68 will later suggest reviewers from
  history.
- **Labels:** a `domain:<repo>` label per touched domain is still applied — for `stories-review` the
  union of every story's `repos`, for a step with a risk tag the epic's `repos`. The labels are a hint
  for whom to ask; they add no approvals.

## Legacy data `yad doctor` reports

Nothing reads these any more. `yad doctor` warns so the team can delete them:

| Warning | What is left on disk |
|---|---|
| `people:roster-unused` | a non-empty `roster` in `.sdlc/hub.json` |
| `people:domain-owners-unused` | a repo in `.sdlc/repos.json` that lists `domain_owner` / `domain_owners` |
| `people:verified-authors-unused` | a `verified_authors` list in `.sdlc/hub.json`, or a `.sdlc/verified-authors` file in the Product or a connected repo |

`yad roster` is removed (typing it prints a notice and exits 1), and `yad setup` collects no reviewers,
roles, repo owners or commit emails. The verified-commits gate checks platform-Verified signatures only.
