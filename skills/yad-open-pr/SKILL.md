---
name: yad-open-pr
description: 'Build helper of the gated SDLC. Open a code-repo task PR/MR from the committed platform template — detect GitHub/GitLab, push the current task branch, and create the PR/MR with the template body prefilled (Summary / Story-task / Impact & Risk) and the title defaulting to the commit subject. Assigns the PR/MR to the logged-in gh/glab login and requests no reviewers (ask them on the PR itself); prints a reviewer suggestion from recent history and CODEOWNERS, a hint and never a request. High risk / contract surface raises the approver count (risk-route.sh prints it). Drives the `yad open-pr` CLI; never merges. Use when the user says "open the PR", "open the MR", or "raise the merge request".'
---

# SDLC — Open Task PR/MR (Build helper)

**Goal:** Open the PR/MR for the current task branch from the repo's committed PR/MR template
(installed by `yad-pr-template`, Step D), with the body prefilled and the assignee set.
This is the standalone open-PR step; it **never merges** — the engineer review (`yad-engineer-review`,
Step E) owns the merge. Distinct from `yad gate open`, which opens a Shape artifact-review PR on
the Product.

## Conventions

- Run **inside the code repo** under `{project-root}/demo-repos/<repo>/` (or pass `--repo <name>` to
  resolve it from `.sdlc/repos.json`). The branch must be the task branch, not the default branch.
- **Platform** is detected from the `origin` remote (or the registry / `--platform`).
- **Title** — defaults to the last commit subject (one atomic task = one branch = one PR/MR), so it
  follows the same Conventional-Commits style and passes the `pr-title` gate. Override with `--title`.
- **Body** — the committed template (`.github/pull_request_template.md` /
  `.gitlab/merge_request_templates/Default.md`) with the Summary (from the commit), the story/task id and
  its `specs/` path, `Risk level:`, `Contract surface touched:`, and `Domains` (the repo name when
  `--repo` is passed) prefilled; the rest is left for the author. This satisfies the `pr-template`
  gate.
- **Stage-aware on the Product** — `open-pr` mirrors the `--head` split the Product gates apply:
  - a **`review/EP-*/<artifact>`** branch is a Shape artifact-review PR → it **delegates to
    `yad gate open`** (artifact-review title `review: <artifact> (EP-<slug>)`, the Product artifact-review
    body, and the gate ledger bookkeeping all in one place). Any `--title`/`-m` is ignored here.
  - any **other Product branch** is a tooling/CI change → it uses the bundled **code-task** template
    (`## Summary` / `Risk level:` / `## Checklist`) instead of the Product's artifact-review
    `pull_request_template.md`, so the Product `pr-template` gate passes.
  In a code repo nothing changes — it reads the repo's own committed code-task template.
- **Base branch** — **resolved, never assumed.** In order: `--base` → the repo's `default_branch` in
  `.sdlc/repos.json` → (for a PR against the Product itself) `hub.json`'s `default_branch` → what the
  platform reports (`gh repo view --json defaultBranchRef` / `glab api projects/:id`) → local
  `origin/HEAD` → `main`. The same **configuration-outranks-the-remote** order `yad repo sync` and the
  contract-check gate already use (they stop at `origin/HEAD`; only this chain also asks the platform).
  The CLI prints which rung answered.
  **If the resolved base is not the platform's default branch it warns and still opens** — that is a
  legitimate stacked-PR / release-branch move, but it costs the AI first pass: CodeRabbit decides
  auto-review eligibility from the base at PR-**open** time, and retargeting afterwards does not undo
  the skip. Hardcoding `main` here is the same bug the check gates already refuse to make (see
  `../yad-checks/references/check-gates.md`).
- **Assignee** — the person opening it: `@me` on GitHub (`gh` resolves it on the repo's own host), and
  on GitLab the login `glab` reports (no assignee is passed when that lookup fails). **No reviewers are
  requested** (E62): yadflow keeps no list of people. The CLI prints `no
  reviewers were requested — ask them on the PR itself`. For a `high` directory the CLI names the people
  who have worked there lately (E67, Step 3). For every change it also prints a reviewer **suggestion**
  (E68, Step 3a): who has committed in the touched folders lately, and what CODEOWNERS lists — a hint
  only, never a request.
- **Routing** — the merge needs 1 approval from someone other than the author (the base). `high` risk
  adds 1, a touched contract surface adds 2, and a change touching a `high` directory on the base
  branch's risk map adds 1 (E66) — the larger, never the sum. That risk step is advisory: branch
  protection holds the merge, never this count. The CLI prints the count once the PR is open — capped by
  the active people (E72) when run from the Product — for example `this PR asks for 3 approvers = base 1
  + contract risk 2, capped to 1 for 2 active people — base enforced, risk step advisory; …` — and prints the count of people on its
  own line (`active people: not counted — no cap applies; …` when it cannot count them).
  `bash checks/risk-route.sh <body>` prints the same count from the PR body, without the cap: a code
  repo's CI has no Product to count people from.

## Inputs

- `repo`           — target a registered repo by name (optional; else the current dir).
- `risk`           — `low|medium|high` (default `low`); prefilled into the body.
- `contractChange` — flag; marks the contract surface touched and raises the approver count.
- `base`           — override the PR/MR base (optional; defaults to the repo's own default branch —
  see **Base branch** above). Only pass it deliberately: a non-default base loses the AI first pass.
- `platform` / `title` — optional overrides.

## On Activation

### Step 1 — Confirm the branch and template
Confirm you are on the task branch (not the default branch) and that the PR/MR template is committed
(if not, run `yad-pr-template` first). The branch's commits should already carry the `Task:` trailer.

### Step 2 — Open the PR/MR
Run from the repo root:
```
yad open-pr [--repo <name>] [--risk <level>] [--contract-change] [--title "<subject>"]
```
The CLI pushes the branch (sets upstream, the user's own auth), fills the template, and creates the
PR/MR with the assignee set and no reviewers requested. It prints the base it resolved and where that
came from.

The non-default-base warning is **advisory — it does not block, and the PR/MR is already open by the
time you read it.** If the base was intended (a stacked PR, a release branch), carry on. If it was
not, do **not** just retarget the open PR — that leaves the AI first pass skipped. Close it, fix the
cause (the repo's `default_branch`, or drop the wrong `--base`), and re-run `yad open-pr` so the PR
is *created* against the right base.

### Step 3 — Route the review (if the count is raised)
Once the PR is open, the CLI prints how many approvers it asks for — the same count the engineer review
(`yad-engineer-review`) uses. It joins the body's level (`--risk`, `--contract-change`) with the code
repo's risk map on `origin/<base>`: a change touching a `high` directory adds 1 even when the body says
`low`, and the CLI warns that the two disagree. It also names who has **committed in those directories
in the last 30 days** (E67) — the people who can meet that ask — or says plainly that nobody has, or
that the history could not be read. It only prints; the body keeps the author's level. If
the level in the body is wrong, fix the body on the PR. When the map cannot be read (no `origin/<base>`
fetched, a newer map), it says so and counts the body alone. `bash checks/risk-route.sh "<pr body>"`
also lists the touched domains as a hint for whom to ask; request those reviewers on the PR/MR yourself.

### Step 3a — Relay the reviewer suggestion (E68)
The CLI then prints two hints about whom to ask, on separate lines: the people who have **committed in
the folders this change touches in the last 30 days** (base branch; the change's own authors and robots
left out; ranked by commits, five shown), and what **CODEOWNERS on the base branch** lists for the changed
files. Relay both as they are. It is a **suggestion only**:

- Never request those people as reviewers on the PR/MR yourself, and never call them owners or required
  approvers. A name is a hint about who **may** know the code. The author decides whom to ask.
- CODEOWNERS is a hint: these files go stale. A `CODEOWNERS line N not read — …` line is a line yadflow
  could not match safely; mention it, do not guess what it meant.
- The same person can appear in both lists under two names (a git name, a platform login). Do not join
  them unless the output says `also in the history above`.
- `not read` (a shallow clone, a missing base) is never "nobody". Say it as the CLI says it.

### Step 3b — Post the review trailer (optional, recommended)
Make the reviewer's job easy: generate the 60-sec briefing and post it to the new PR/MR so it greets
every reviewer in the UI (idempotent; safe to re-run after a push):
```bash
yad review trailer --repo <name> --pr <n> --body "<companion-generated briefing>"
```
The full fun-review flow (cards + grounded chat + engagement) is driven by the
[Review Companion](../yad-review-companion/SKILL.md) during `yad-engineer-review`. Non-blocking by
design — companion comments carry `<!-- yad:noblock -->`.

### Step 4 — Stop (no merge)
Report the PR/MR URL and that no reviewers were requested. The PR now runs the check gates (Step C);
the human engineer review and merge happen in `yad-engineer-review` (Step E).

## Hard rules

- **One task = one branch = one PR/MR.** Never open a PR from the default branch.
- **The base is the repo's default branch** unless you deliberately chose otherwise with `--base`.
  Never hardcode `main`, and never ignore the non-default-base warning silently.
- **Title follows the commit subject** — Conventional-Commits style, so the `pr-title` gate passes.
- **High risk raises the approver count** — the same count as the gate; never a separate rule.
- **Opening a PR never merges.** The human owns the merge in Step E.

## Reference
- The PR/MR template + the Impact & Risk block + routing: `../yad-pr-template/references/risk-routing.md`.
- The gates the PR must pass: `../yad-checks/references/check-gates.md` (incl. `pr-title`, `pr-template`).
- Commit first: `../yad-commit/SKILL.md`; commit + open in one step: `../yad-ship/SKILL.md`.
- The engineer review + merge that follow: `../yad-engineer-review/SKILL.md`.
