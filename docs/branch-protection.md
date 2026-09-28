# Branch protection — how to set it up for yad

**Branch protection** is a set of rules that GitHub or GitLab keeps on a branch. The rules can say
"a change reaches this branch only through a reviewed pull request", "these checks must pass first",
and "nobody may force-push or delete it". This page says which rules to turn on for a yad project, and
why.

**yad never holds a merge.** yad records reviews and runs checks. Only the platform can refuse a merge,
and it refuses one only when a rule on the branch says so. With no rules, anyone who can write to the
repo can merge anything, and yad can only record what happened.

`yad doctor` reads what is set today. Its `protection` section has one line for the Product hub and
one per connected code repo. See [the `protection` section in CLI.md](CLI.md#the-protection-section--does-the-platform-require-an-approval-e70)
for what each line means. A line that says **not known** is not "fine" and not "unprotected": yad could
not read the answer, and the line says why.

## Where yad's safety comes from

| Layer | What it does | How strong |
|---|---|---|
| A local git hook (`.git/hooks/pre-commit`) | Refuses a hand commit to the CI-owned ledger on your machine, with a message naming the right command | **Weak.** It lives in one clone, `--no-verify` or `YAD_HOOK_DISABLE=1` skips it, and it allows the commit whenever something is wrong with it |
| The agent hook (`hooks/ledger-guard.mjs`) | Refuses an AI agent's edit to the same files, at the moment of the edit | **Weak**, for the same reasons |
| **Branch protection on the platform** | Refuses a merge that skipped review or failed a check | **Strong. This is the real enforcement** |
| The `ledger-guard` check in CI | Fails a pull request that changes the CI-owned ledger | **Strong**, but only when branch protection makes that check required |

The last row is the reason this page exists. A check that fails but is not **required** is a red cross
that someone can merge past.

## Which branch

Protect the branch yad's files name as `default_branch`:

- the Product hub: `default_branch` in `.sdlc/product.json` (`.sdlc/hub.json` on an older Product);
- each code repo: its `default_branch` in the hub's `.sdlc/repos.json`.

That is the branch every review merges into and every check runs against. If yad's files name none,
yad reads the platform's own default branch, and `yad doctor` says so.

## GitHub

GitHub has two ways to set rules: **rulesets** (Settings → Rules → Rulesets) and the older **classic
branch protection** (Settings → Branches). Either works. A ruleset is easier to read and can be applied
to many repos from an organization. Set these on the default branch:

| Rule (ruleset name) | Set it to | Why |
|---|---|---|
| Require a pull request before merging | on | A change reaches the branch only through a reviewed pull request |
| Required approvals | **1 or more** for a team. **0** in solo mode | A team needs someone other than the author to approve. In solo mode a required approval blocks your own merge, because GitHub does not let an author approve their own pull request |
| Dismiss stale pull request approvals when new commits are pushed | on | Safe with yad: its CI never pushes to a review branch, so only the author's own new commits reset an approval — which is what should happen |
| Require status checks to pass | on, with the checks listed below | Makes yad's checks block a merge instead of only reporting |
| Block force pushes | on | A force-push can rewrite the ledger's history |
| Restrict deletions | on | |
| Require review from Code Owners | your choice | yad treats CODEOWNERS as a hint, never as the rule ([E69](roadmap-idea-1.md)) |

### The status checks to require

GitHub names a check after its job. Run one pull request first, so GitHub has seen the checks, then pick
them from the list it offers.

| Repo | Workflow file | Checks |
|---|---|---|
| Product hub | `.github/workflows/yad-hub-checks.yml` | `commit-message`, `pr-title`, `pr-template`, `ledger-guard` |
| Product hub, when the file is there | `.github/workflows/yad-verified-commits.yml` | `verified-commits` |
| Each code repo | `.github/workflows/yad-checks.yml` | `spec-link`, `contract-check`, `risk-map`, `build-test-lint`, `lineage-check`, `epic-open`, `reconcile-debt`, `commit-message`, `pr-title`, `pr-template`, `verified-commits` |

Some of these jobs skip themselves on a bare title or description edit. GitHub counts a skipped job as
passed, so requiring them does not block that edit.

### The gate bot must be able to push (verified mode)

In `verified` mode (`"ledger": "verified"` in the Product config) CI is the only writer of the gate
ledger. When a review pull request merges, the `yad-gate-sync` workflow records the result and **pushes
that commit straight to the default branch**. A protected default branch refuses that push unless the
token making it may bypass the rules.

**The built-in Actions token cannot bypass.** A ruleset's bypass list takes roles, teams, GitHub Apps
and Dependabot — not GitHub Actions. So give the workflow a token whose owner is on the bypass list:

1. **A GitHub App** that you add to the ruleset's bypass list, or
2. **A fine-grained personal access token** (contents: read and write) of someone on the bypass list.

Store it as the repository secret `SDLC_GATE_TOKEN`, and add one `token:` line to **both**
`actions/checkout` steps in `.github/workflows/yad-gate-sync.yml` (the `mergesync` and `reconcile`
jobs). If the step already has a `with:` block, add the line inside it:

```yaml
      - uses: actions/checkout@v7
        with:
          token: ${{ secrets.SDLC_GATE_TOKEN }}
```

That file is managed by yad. After your edit, `yad check` reports it as `modified`, and `yad update`
keeps your copy rather than overwriting it (`--overwrite-local` would replace it). Re-apply the edit
if you ever replace the file.

Without this, the merge still lands, but the ledger never advances. The scheduled `reconcile` job
retries every 15 minutes and fails the same way until the token is there.

## GitLab

| Setting (where) | Set it to | Why |
|---|---|---|
| Protected branch (Settings → Repository → Protected branches) | protect the default branch | Without it a direct push skips the merge request |
| Allowed to merge | Developers + Maintainers (or Maintainers) | Who may press merge |
| Allowed to push and merge | No one — or, in verified mode, the role the gate token has (see below) | A change arrives through a merge request. Everyone with the role you pick here can also push directly, so pick the narrowest one the token can have |
| Allowed to force push | off | |
| Pipelines must succeed (Settings → Merge requests) | on | Makes yad's checks block a merge |
| Merge request approval rules (Settings → Merge requests) | 1 or more approvals for a team, 0 in solo mode | **Premium and Ultimate only.** On GitLab Free an approval never blocks a merge |
| Remove all approvals when commits are added to the source branch | on | Safe with yad, for the same reason as on GitHub |

The checks run as jobs in the merge request pipeline: on the hub `yad-hub-commit-message`,
`yad-hub-pr-title`, `yad-hub-pr-template`, `yad-hub-ledger-guard` and, when that file is there,
`yad-hub-verified-commits`; in a code repo `yad-spec-link`, `yad-contract-check`, `yad-risk-map`,
`yad-build-test-lint`, `yad-lineage-check`, `yad-epic-open`, `yad-reconcile-debt`,
`yad-commit-message`, `yad-pr-title`, `yad-pr-template` and `yad-verified-commits`. "Pipelines must
succeed" covers them all.

**The gate token (verified mode).** The `yad-gate-sync` job pushes the ledger commit to the default
branch with the project access token stored as the masked CI/CD variable `SDLC_GATE_TOKEN`
(`read_api` + `write_repository`). The token's role must be in "Allowed to push and merge" on the
protected branch, or the push is refused and the ledger never advances.

## Other direct pushes yad can make

Three commands can push straight to the default branch: `yad update --push`, `yad checkpoint --push`
and `yad gate repair --push`. With protection on, they need a person who may bypass the rules. Anyone
else can run them without `--push`, commit on a branch, and open a pull request instead.

## The local git hook (E48)

In verified mode, `yad check --fix` (and `yad setup`, and `yad update`) installs a small
`.git/hooks/pre-commit` in **your clone**. It runs `hooks/ledger-guard.mjs --staged`, which looks at
the files your commit is about to record. If one of them is a file only CI may change — an epic's
`state.json`, `approvals.json`, `comments.json`, `product-prs.json`, `hub-prs.json`, a `reviews/*.md`,
or the Product index `.sdlc/index.json` — the commit is refused, and the message names:

- every refused file, and the `git restore --staged` line that takes them out of the commit;
- the yad command that owns the change (`yad gate open`, `yad gate repair`, or CI at merge);
- the way through: `YAD_HOOK_DISABLE=1 git commit …`. The `ledger-guard` check in CI still refuses
  that commit, so this only helps when you mean to fix it before you push.

It refuses exactly what the CI check refuses, and allows what it allows: a new epic's first ledger (its
seed), artifacts, the contract lock, a merge commit, and a commit authored by the `yad-gate-sync` bot.
The ledger commits yad's own `yad gate ci` and `yad gate repair` make pass it too: those are the
commands the refusal sends you to, and CI's check never judges them (they land on the default branch,
not in a pull request).
With a `local` ledger it is not installed, and `yad check --fix` removes one yad wrote earlier (only
when nobody edited it).

**Git does not copy hooks when you clone.** Each person gets the hook by running `yad check --fix` in
their own clone; `yad doctor` warns when it is missing.

**yad never overwrites a hook that is not its own.** If your clone already has a `pre-commit` hook, or
a tool such as husky sets git's `core.hooksPath`, yad writes nothing and prints one line to add to your
hook instead:

```sh
node 'hooks/ledger-guard.mjs' --staged; [ $? -ne 2 ] || exit 1
```

(With the Product in a subfolder of the repo, the path starts with that folder; `yad doctor` prints the
exact line.)

**Limits.** The hook is a convenience, not a guard: `git commit --no-verify` skips it, and a clone
without it allows everything. `git commit --amend` is judged by what it changes against the commit it
replaces, so amending a commit that already changed the ledger passes. The CI check, made required by
branch protection, is what actually protects the ledger.
