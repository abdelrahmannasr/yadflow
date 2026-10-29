---
name: yad-engineer-review
description: 'Build Step E of the gated SDLC — AI review, engineer review, then merge. Wire an advisory AI first-pass (CodeRabbit) on the PR/MR; record the human engineer review with the same advance-human discipline as the Shape gates (1 distinct approver, who should not be the author; high risk / contract raise the full count, advisory, not enforced — the Step D routing); and on merge, record the ship in the epic build-log and update the story state so the epic → story → task → PR chain is traceable. Never auto-advances — the human owns the merge. Use when the user says "record the engineer review", "merge this task", or "wire the AI review". (To commit + open the PR/MR, use yad-ship.)'
---

# SDLC — Engineer Review & Merge (Build Step E)

**Goal:** Take a task PR/MR that has passed the **check gates** (Step C) through two sets of eyes and
out to production: an **AI first-pass** (advisory) and a **human engineer review** (the authority),
then **ship** — merge, record the ship, and update the story state. This is the last Build step
(build plan §E). It is a **human gate**, the same `advance: human` discipline as the Shape steps:
**nothing auto-advances**; the engineer owns the merge.

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo (the source of
  truth: it holds the story and the build ledger).
- Code repos are separate git repos under `{project-root}/demo-repos/<repo>/` (or the registry `path` in
  `.sdlc/repos.json`).
- The build ledger uses **shard-then-fold** storage: each ship is its own shard file
  `{project-root}/epics/<epic>/.sdlc/build-log/<story>-<task>-<repo>.json`, so concurrent shippers never
  conflict; readers UNION the folded `build-log.json` with every loose shard, and `yad tidy up` folds
  finished shards back into `build-log.json`. It — like the trust log and build-state — is committed by
  `yad checkpoint` (see Step 3), not by hand.
- The engineer-review rule reuses `yad-review-gate`'s count: `needed = base 1 + risk step` distinct
  approvers. The risk step comes from the PR's Impact & Risk block — `high` risk +1, a touched contract
  surface +2 — and from the code repo's risk map on the **base branch**: a change touching a `high`
  directory +1 (E66). The largest step wins, never the sum. The count is reported, not enforced: branch protection holds the merge (at least 1
  distinct approver, who should not be the author), and the risk step is advisory. `yad open-pr` shows
  the count capped by the active people (E72); the check scripts cannot cap it. This is what `yad-pr-template`'s `risk-route.sh`
  prints. The real merge protection is the platform's branch protection.
- AI review wiring: `templates/.coderabbit.yaml` → `<repo>/.coderabbit.yaml`.

## Inputs

- `epic` / `story` / `task` / `repo` — the PR under review (the task branch `feat/<story>-<task>-…`).
- `action` — `ai-review` | `approve` | `ship` (default `ai-review`).
- For `approve`: the reviewer's platform login. No role and no domain.

## On Activation

### Step 1 — `ai-review` (advisory first pass)
Ensure the AI reviewer is wired: copy `templates/.coderabbit.yaml` to `<repo>/.coderabbit.yaml` (commit
on the default branch if missing). CodeRabbit reviews each PR automatically and posts comments — it is
a **second set of eyes, never the authority**: it cannot approve or merge. Where CodeRabbit can't run
(no remote), run an equivalent AI first-pass by hand and capture its notes. Record that the AI review
ran; surface its findings to the engineer. Do **not** treat AI approval as a gate.

Also run the **Review Companion** so the human review is easy and fun: post the 60-sec trailer
(`yad review trailer --repo <r> --pr <n> --body "<text>"`) and deal the swipe cards / open the grounded
chat from the bundle (`yad review context --repo <r> --pr <n>` → [yad-review-companion](../yad-review-companion/SKILL.md)).
Companion comments carry `<!-- yad:noblock -->` (history-only, never block); genuine concerns are posted
unflagged and block normally.

For a **deep, teaching** review instead of a skim, offer the **Pair Review** walkthrough
([yad-pair-review](../yad-pair-review/SKILL.md)): `yad review walkthrough --repo <r> --pr <n>` deals an
ordered, risk-tagged stop-list, and the AI walks the engineer through the change one stop at a time —
asking questions, answering theirs, until both are satisfied — then records the engineer's review-skill
growth in the local-only learning log. Still soft: it rides the same `engagement: verified` signal and
never gates. When a pair session backs the approve, you may set `companion.pair: true` on the ship record.

### Step 2 — `approve` (the engineer review — the human gate)
A human engineer reads the diff **against the spec** (`specs/<story>/`) and the acceptance criteria,
and records an approval. Determine the count with `bash checks/risk-route.sh <pr-body-file> origin/<base>`,
run **in the code repo with the PR's branch checked out** — it reads the body's Impact & Risk block and
the base branch's `.sdlc/risk-map`, and the larger step wins. On the base branch the change is empty and
the map adds nothing, so check out the PR branch first. If the repo has no `checks/risk-route.sh`, it is
not wired yet: run `yad update` for it (that installs `checks/risk-route.sh` and
`checks/risk-map-check.sh` together). Until then, count from the body alone and say that the map was not
counted. It prints e.g.
`ROUTE: 3 approvers = base 1 + contract risk 2 (contract surface touched)`, says branch protection holds the
merge, not this count (the risk step is advisory and not capped there), and lists the touched domains as a hint for whom to ask. With no risk it
prints `ROUTE: 1 approver = base 1 (no risk step).` When the map raises a body that says `low`, it
names the `high` directories and says the two disagree — tell the engineer, and ask the author to fix the
body if the body is wrong. Record each approval; re-evaluate whether the base
is met, and report any shortfall against the full count without blocking on it.

**Proven history (E67).** When the change touches a `high` directory, `risk-route.sh` also prints the
people who have **committed there in the last 30 days**, read from the base branch and with this
change's own authors left out:

```
       This change touches src/payments/, so it asks for an approval from someone who has
       committed there in the last 30 days (its own authors left out):
  - Alice (@alice)
  - @carol
```

A person whose git name holds an `@` is printed as their bare login (`- @carol`), or, when there is no
login, as `a name that is an e-mail address` or `a name written like a login` — both have NO login. No
address is ever printed, and a printed `@word` is always a real login, never a git name. A bare `@login`
counts exactly like a `(@login)` below.

Report it as an ask, never as a block, and use exactly these three answers:

Work down these rows in order and stop at the first that fits — a mixed list, where one person has a
login and another does not, fits more than one:

| In order | What you see | What to report |
|---|---|---|
| 1 | A recorded approver's login is one of the printed logins — a `(@login)` after a name, or a bare `@login` — ignoring upper and lower case | **met** |
| 2 | The printer says `not read` (a shallow clone, or git could not read the history) | **could not confirm** |
| 3 | No approver matches, and at least one named person has no login (neither `(@login)` nor a bare `@login`) | **could not confirm** — name everyone printed, and say the names could not be compared |
| 4 | No approver matches, and every named person has a login (`(@login)` or a bare `@login`) | **short** — name who could meet it |

Rows 2 and 3 matter: an approval records a platform login, while git history records a name, and a login
only comes from a `noreply` address. Different spellings of a name prove nothing either way, so say the
ask could not be confirmed rather than inventing a shortfall. Logins are compared without case, because
a platform login is case-insensitive and the printer shows it as the address wrote it.

With nobody printed at all — `nobody else has committed there in the last 30 days` — there is nobody to
ask for, and the count stands on its own. That line, and `not read`, are printed higher up in the
`Risk map (…)` section, not inside the `ROUTE` paragraph above.

**One list, not one per directory.** When a change touches two `high` directories, the people are printed
as one list: someone who has worked in ANY of them meets the ask. Nothing says which person worked where.

Record `engagement: verified` when the engineer reviewed through the companion (else `none` for a bare
approve); `yad review reconcile --epic <id> --repo <r> --pr <n>` stamps it onto the ship record from the
platform (mutating the ship's shard where it lives, or its folded entry if already tidied). Soft by default (both count; a bare approve draws `yad review nudge`); only gates when
`review.requireEngagement: true` in the Product settings. The signal is gameable by design and sits **beside** the CI gates,
never above them.
Recording an approval does **not** ship — shipping is a separate, explicit step. Shape discipline:
the gate talks only through files; refuse to treat AI review as a human approval.

### Step 3 — `ship` (merge + record + update state)
Ship **iff ALL hold**: the check gates pass (Step C), the AI review has run (advisory), and the
engineer-review rule is satisfied (Step 2). Then:
- **Merge** the task branch into the repo's default branch. The person merges it, never you, even when
  your login could (E158): give them the PR/MR link, wait, then confirm by reading
  (`yad build merged … --ship`).
- **Check the lane is not skipped (E39)** — read `build-state/<story>.json`. If this repo's lane is
  `status: skipped`, it was set aside as needing no change: stop and tell the person. Only when they say
  the lane is owed after all, run `yad unskip <epic> <story> --repo <repo>` before recording a ship
  (E158), so the two records never say opposite things (`yad doctor` fails that as `lane:…:contradiction`; `yad checkpoint --retro-ship` refuses it).
- **See whether it merged — ask, do not wait (#355).** The merge is a person's, but you do not need them
  to tell you it happened: run `yad build merged <story> --task <task> --repo <repo> --ship`. It asks the
  platform about the task's PR/MR (found by its branch; `--pr <n>` names it) and answers one `state`
  (`--json`): `merged` — the ship is recorded (through `yad build ship`), go on; `shipped` — it already was;
  `open` — stop and report "waiting for PR/MR #<n> to merge", and run it again when you resume; `closed`
  — closed without a merge: stop and report it; `none` — no PR/MR carries the task yet: open one with
  `yad open-pr`. It asks once and returns; it never waits. It refuses where the platform cannot be read
  (no platform, the repo not cloned here, `gh`/`glab` not logged in), when two PRs/MRs that are not
  closed carry the task, or when a merged PR's merge commit is not on the default branch or names
  another task, or its ship file cannot be written — stop and report what it says.
- **A follow-up to a shipped task (#350)** — open it from `fix/<story>-<task>-followup-<words>`, its commits
  keeping the task's `Task:` line. Ask about it with `yad build merged <story> --task <task> --repo <repo>
  --follow-up --ship`: the same states, and once merged its merge is added to the task's ship
  (`followUps`), never a second ship. Shape: `references/ship-and-record.md`.
- **Catch up on merges (#365)** — `yad build sync [<epic>]` records every ship the code repos already show
  (what `yad reconcile check` finds merged with no ship), through `yad build ship`, then `yad build done`
  for each story now fully shipped; it lists what it cannot record. Then ask the person before
  `yad checkpoint --push`: it pushes to the default branch, which is asked about every time (E158).
- **Record the ship** — `yad build ship <story> --task <task> --repo <repo> --pr <n>` (what `--ship` runs),
  once the PR/MR has merged. A grouped PR (#350) — several small tasks of one story — ships each task it
  carries from the same `--pr`; a task that is not the branch's is found with `--pr`, as its commits carry it. It reads the merge commit, the branch, the checks that passed, the approvers (with the
  engagement signal), the body's `Risk level:` and the merge date from the platform, refuses a PR that is
  not merged or that comes from another task's branch, and writes the ship to its own shard
  `epics/<epic>/.sdlc/build-log/<story>-<task>-<repo>.json` (shape: `references/ship-and-record.md`). A
  repo whose platform cannot be read records it by hand: `--merge-commit <sha> --approver <login>`, only with
  the merge commit and approvers the person gave you, never guessed (E158). A
  task merged with no PR/MR: `--merge-commit <sha>` and no `--pr` (the commit must be on the default
  branch and name the task in its `Task:` trailer or subject; the platform is asked whether a PR merged it,
  and a PR that did is named instead). It moves the story to `in-build`. Never write the shard by hand.
- **Update the story state** — when **every** task in each repo's `specs/<story>/tasks.md` (a light spec: the marked tasks block of its
  `spec.md`, #348) has a ship,
  run `yad build done <story>`: it checks that, closes the `engineer-review` step in each lane, and sets
  the story `status: shipped`, so `yad next`, the epic seal and `yad tidy` all read it shipped. It needs
  every repo the story declares cloned here, its `tasks.md` (or light `spec.md` and `link.md`) merged on the default branch, and a lane in
  each repo whose earlier steps are done (a story that never ran through `yad-run`: `yad build start`,
  then `yad build step … done` for each step; one shipped before the Build ledger existed:
  `yad checkpoint --retro-ship`). It refuses, writing nothing, and says what is missing. The chain
  **epic → story → task → PR → mergeCommit** is now traceable end to end.
- **Finalize the trust verdict (Phase 4).** If this story ran through `yad-run`, the engineer **confirms or
  overrides** the provisional trust verdict the orchestrator recorded for the `implement` run:
  `yad build trust <story> --repo <repo> implement --uid <uid> --verdict <v>`, where `<uid>` is the run of
  this task on the `implement` step in `build-state/<story>.json`: `closed.run` when `closed.task` is this
  task, else the `run` of the entry in its `runs` list whose `task` is this task. It updates that run where it lives
  (its shard, or its entry in the folded `trust-log.json` after `yad tidy up`). The human has the last
  word on the trust signal: a diff merged as authored is `approved-unchanged`; one the engineer edited
  before merge is `approved-with-edits`; a rejected one is `rejected`. This is the run record `yad dial`
  shows the team beside a step's dial (it never weakens the merge gate — the engineer still owns the merge).
- **Commit the machine-written ledgers.** Ask the person, then run `yad checkpoint --push` from `{project-root}`
  (a push to the default branch is asked about every time, E158) to commit
  the Build ledgers just written (the `build-log/` shard, and the `trust-log/` shard /
  `build-state/<story>.json` if the story ran through `yad-run`) as one `chore(product): …` audit-trail
  commit — default branch only, staging the shard dirs (`yad tidy up` folds finished shards later),
  never a Shape gate file. It is the Build analogue of the Shape `yad gate` sync. The
  same commit also **carries the story `status:` flip** the commands wrote (`approved → in-build/shipped`,
  #112) — because that story now has a build-log ship, checkpoint stages `stories/<story>.md` alongside
  the ledgers, so the artifact never drifts from build-log and you never fall back to a raw git-to-main
  push. (The code-repo `tasks.md` is committed in its own repo as usual.)

### Step 4 — Stop
Report what shipped and the story's state. Do not advance anything else; the Shape `state.json`
stays as it was (`ready-for-build`). Build is recorded in `build-log.json` + the story status.

## Hard rules (build plan §E, Cross-cutting)

- **AI review is advisory, never the authority.** Only a human engineer approval counts toward the gate.
- **High risk raises the count** — the same count as `yad-review-gate` / `risk-route.sh`, and a `high`
  directory on the base branch's risk map raises it too; that directory also asks for an approver who has
  worked there in the last 30 days (E67), reported in the same three states as everything else here:
  met, short, or could not confirm. The count is advisory — branch protection holds the
  merge; `yad open-pr` shows the count capped by the active people. There are no domain owners to route to.
- **The ship record's `risk` is the body's level**, as the author wrote it — not the level the map raised
  it to. The count is worked out live each time and never stored (the user's decision, 2026-09-18).
- **Ship only after gates + engineer review.** No gate skipped; the human owns the merge.
- **Nothing auto-advances.** Step E records human decisions in files; it never machine-advances.

## Reference
- The build ledger + story-state rules: `references/ship-and-record.md`.
- The count reused: `../yad-review-gate/SKILL.md`; the routing helper: `../yad-pr-template/`.
- The gates that must pass first: `../yad-checks/references/check-gates.md`.
