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
needs 1 distinct approver who is not the artifact's author.

## Older records

Records written while the roster existed may carry `role` and `domain`, and may name a person by their
roster `name` instead of their login. They are left on disk and never read.

On the first sync after the upgrade, such a bridge record is matched to the **same review** by PR number
and, where the platform gives one (GitHub), submission time. It is replaced by one login-named record
that keeps its `artifactHash` and dates, so an approval of old content still reads as stale. Where two
such reviews cannot be told apart (GitLab has no submission time), a fingerprint that is not today's is
preferred: at worst a real approval reads as stale and is given again.

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
