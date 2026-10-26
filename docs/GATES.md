# CI gates: rules, exemptions and failures

A **gate** is a check that runs in CI (the automatic checks GitHub or GitLab runs on every pull request
or merge request). Each gate is a small script that `yad` installs into the repo's `checks/` folder.
When a gate fails, the CI job turns red, and with [branch protection](branch-protection.md) the change
cannot merge.

This page lists every gate in one place: what it checks, which changes it lets through on purpose
(its **exemptions**), what it reads, and every failure message with what to change. For how the gates
are built and why each rule exists, see the skill's own reference,
[`check-gates.md`](../skills/yad-checks/references/check-gates.md).

## Contents

- [Words used on this page](#words-used-on-this-page)
- [How to read a gate's output](#how-to-read-a-gates-output)
- [Which gates run where](#which-gates-run-where)
- [Run the gates on your machine](#run-the-gates-on-your-machine)
- [Messages many gates share](#messages-many-gates-share)
- Gates on code repos: [spec-link](#spec-link) · [contract-check](#contract-check) ·
  [build/test/lint](#buildtestlint) · [lineage-check](#lineage-check) · [epic-open](#epic-open) ·
  [reconcile-debt](#reconcile-debt) · [risk-map](#risk-map-advice-only) · [backfill](#backfill)
- Gates on every repo: [commit-message](#commit-message) · [pr-title](#pr-title) ·
  [pr-template](#pr-template) · [verified-commits](#verified-commits)
- Gates on the Product: [ledger-guard](#ledger-guard) · [member-check](#member-check)
- Helper steps: [product-checkout](#product-checkout) · [install-deps](#install-deps)
- [Commit trailers the gates read](#commit-trailers-the-gates-read)

## Words used on this page

| Word | Meaning |
|---|---|
| **Product** | The repo that holds the planning documents (epics, stories, the contract) and their review records. Code lives in separate **code repos**, unless the team keeps both in one repo. |
| **epic**, **story**, **task** | An epic is one feature or change, such as `EP-checkout`. It is split into stories (`EP-checkout-S01`), and each story into tasks (`EP-checkout-S01-T02`). |
| **Shape review PR** | A pull request in the Product that reviews one planning document. Merging it is what approves the document. |
| **thread** | A feature and the changes made to it later. A change epic names the epic it changes with `parent:`. |
| **contract** | The shared interface between repos: APIs, events, schemas. It is written and **locked** in the Product. The **lock** is a file holding a hash (a fingerprint) of the contract text. |
| **slice** | The part of the contract one story builds against, copied into the code repo under `specs/<story>/contracts/`. |
| **trailer** | A `Key: value` line at the end of a commit message, such as `Task: EP-checkout-S01-T02`. |
| **base** | The branch the change will merge into, such as `origin/main`. CI passes it to each gate. |
| **merge base** | The last commit the branch and the base have in common. |
| **shallow clone** | A checkout without the full history. Gates that compare with the base need the full history. |
| **rebase**, **force-push** | Rebase rewrites a branch's commits, for example to reword a message. A rewritten branch must be force-pushed (`git push --force-with-lease`), because the old commits are replaced. |
| **symlink**, **submodule** | A symlink is a file that points at another path. A submodule is another git repo placed inside this one. The gates refuse both where they read files, because the content would live somewhere the gate does not check. |
| **fork** | A copy of the repo under another account. A pull request from a fork never gets the repo's secrets. |
| **Conventional Commits** | The subject format `type(scope): description`, such as `fix(api): handle empty cart`. |
| **lockfile** | The file that pins the exact version of each package (`package-lock.json`, `pnpm-lock.yaml`). |
| **CI/CD variable**, **secret** | A value stored in the repo's settings and handed to CI jobs. On GitLab, **masked** means it is hidden in job logs; a token needs the **`read_api` scope** (permission) to read GitLab's API. |

## How to read a gate's output

Every line starts with a word that says what kind of line it is:

| Start of line | Meaning |
|---|---|
| `PASS [gate]:` | This part passed. |
| `FAIL [gate]:` | This part failed. The job fails at the end. The text after the dash says what to change. |
| `WARNING` / `WARN [gate]:` | Something you should fix soon, but the job does not fail for it. On GitHub some warnings also show as a yellow note on the pull request. |
| `note [gate]:` | Information only, for example "the Product could not be reached, so this part was skipped". |
| `NOTE [pr-template]:` | Why the description could not be read in full on GitLab. See [pr-template](#pr-template). |
| `hint [ledger-guard]:` | A likely cause and its fix. |
| `->` or an indented line | More detail for the line above it. |

Most failures are written as `FAIL [gate]: <what is wrong> — <what to change>`. When the fix is plain
from the problem (a missing line), the message names only the problem; the tables below give the fix.
Most gates check every commit in the pull request, so one run can print several `FAIL` lines.

**A commit already pushed must be rewritten to fix a commit-level failure.** The gates read every
commit in the pull request, not only the last one. A new commit that fixes the problem does not help
when the problem is in an older commit (a missing trailer, a bad subject, a missing signature). Reword
or rewrite the older commit (`git commit --amend` for the last one, `git rebase -i <base>` for older
ones), then force-push.

One exception: contract-check accepts the `Contract-Change: yes` trailer on **any** commit in the pull
request, so a new commit carrying it does count.

## Which gates run where

The **base** is the branch the change will merge into, such as `origin/main`. CI passes it to each gate.

| Gate | Script | GitHub job | GitLab job | Runs on | Can fail the job? |
|---|---|---|---|---|---|
| [spec-link](#spec-link) | `spec-link.sh` | `spec-link` (`yad-checks.yml`) | `yad-spec-link` | code repos | yes |
| [contract-check](#contract-check) | `contract-check.sh` | `contract-check` | `yad-contract-check` | code repos | yes |
| [build/test/lint](#buildtestlint) | `build-test-lint.sh` | `build-test-lint` | `yad-build-test-lint` | code repos | yes |
| [lineage-check](#lineage-check) | `lineage-check.sh` | `lineage-check` | `yad-lineage-check` | code repos | yes |
| [epic-open](#epic-open) | `epic-open.sh` | `epic-open` | `yad-epic-open` | code repos | yes |
| [reconcile-debt](#reconcile-debt) | `reconcile-debt-check.sh` | `reconcile-debt` | `yad-reconcile-debt` | code repos | yes |
| [risk-map](#risk-map-advice-only) | `risk-map-check.sh` | `risk-map` | `yad-risk-map` | code repos | no — advice only |
| [backfill](#backfill) | `backfill-check.sh` | not wired by `yad`; added by hand | not wired by `yad` | code repos with backfilled features | yes |
| [commit-message](#commit-message) | `commit-message.sh` | `commit-message` (code: `yad-checks.yml`, Product: `yad-product-checks.yml`) | `yad-commit-message` / `yad-product-commit-message` | every repo | yes |
| [pr-title](#pr-title) | `pr-title.sh` | `pr-title` | `yad-pr-title` / `yad-product-pr-title` | every repo | yes |
| [pr-template](#pr-template) | `pr-template.sh` | `pr-template` | `yad-pr-template` / `yad-product-pr-template` | every repo | yes |
| [verified-commits](#verified-commits) | `verified-commits.sh` | `verified-commits` (code: `yad-checks.yml`, Product: `yad-verified-commits.yml`) | `yad-verified-commits` / `yad-product-verified-commits` | every repo | yes |
| [ledger-guard](#ledger-guard) | `ledger-guard.sh` | `ledger-guard` (`yad-product-checks.yml`) | `yad-product-ledger-guard` | the Product | yes |
| [member-check](#member-check) | `member-check.mjs` | `member-check` | `yad-product-member-check` | the Product | yes |

Two more scripts run as steps inside the jobs above:

- [product-checkout](#product-checkout) (`product-checkout.sh`) runs first in contract-check, lineage-check, epic-open and
  reconcile-debt. It checks the Product out so those gates can read it.
- [install-deps](#install-deps) (`install-deps.sh`) runs first in build/test/lint. It installs the repo's packages.

**On a direct push to the default branch** (no pull request), the `yad-update-guard` workflow (GitHub)
or the `yad-update-guard-verified-commits` and `yad-update-guard-commit-message` jobs (GitLab) run only
two gates over the pushed commits: [verified-commits](#verified-commits) and
[commit-message](#commit-message). This covers `yad update --push`, which pushes without a pull request.

**When the PR text is edited** (title or description only), GitHub runs only `pr-title` and
`pr-template` again. Every other job skips that run, because no commit changed. On GitLab, editing a
merge request's text does not start a pipeline.

## Run the gates on your machine

`yad run checks` runs this repo's installed gates on your machine, before you push, so a failure shows
up without waiting for CI. Run it inside the repo whose change you want to check:

```sh
yad run checks --body pr-description.md
```

- It runs this repo's own `checks/` scripts, as CI does, against the branch the pull request will
  target (`origin/<default branch>`, fetched first).
- Two steps are replaced: [product-checkout](#product-checkout) by writing the Product's **default
  branch** from your Product clone to where CI would check it out — only while contract-check,
  lineage-check, epic-open and reconcile-debt run, then removed — and
  [verified-commits](#verified-commits) by git's own signature check. Your unmerged Product edits are
  not seen, as CI does not see them. A run removes only what it wrote: a folder already there (yours,
  another run's, or one a killed run left) is read as it is and kept — remove it to read the default
  branch. Two runs at once in one repo can disturb each other (the Product copy, `node_modules`); a Product copy
  that disappears while the gates read it is reported.
- Every gate runs, including the package install and build/test/lint (`--no-build` skips those two),
  then a summary. The exit code is 1 when a gate fails or the run is refused, and 130 when it is
  stopped with Ctrl-C.
- Give the pull request text with `--title "<title>"` and `--body <file>`. A branch of one commit uses
  its subject as the title. Without them, pr-title and pr-template are skipped — a skipped gate is not a
  pass. On GitLab it warns when the description is 2700 characters or longer — GitLab cuts the text CI
  gets there (see [pr-template](#pr-template)).
- What is judged only in CI, and the output says so: the platform's **Verified** badge, and
  `member-check` when a member file changes (it needs the pull request's author). The build gates use
  this machine's Node and tools, and CI on GitHub tests the merge of the branch into the base: rebase
  onto the base for the same answer. Uncommitted changes are built and tested but not pushed: commit
  them first. On Windows the gates need Git Bash on the `PATH`.

See [`docs/CLI.md`](CLI.md#commands) for every flag.

## Messages many gates share

The gates are separate scripts, so some code, and its messages, is copied into many of them.

### The base cannot be found

| Message | What to change |
|---|---|
| `FAIL [<gate>]: base ref '<base>' not found — check the code out with full history (GitHub: actions/checkout with fetch-depth: 0; GitLab: GIT_DEPTH: "0"), and give a base that names a fetched branch (the first argument, or SDLC_BASE).` | The CI checkout must fetch the whole history, and the base must be a branch the job fetched. The `yad` workflows already set both. If you wrote your own job, copy the `fetch-depth: 0` (GitHub) or `GIT_DEPTH: "0"` (GitLab) line from them. |
| `FAIL [contract-check\|backfill]: '<base>' and HEAD share no history — a shallow clone has no merge base: …` | The same fix: fetch the whole history, or pass the branch this change targets as the base. |
| `FAIL [contract-check\|backfill]: git could not build the merge of this branch into <base> (git merge-tree exit N) — …` | git is missing something it needs, so the clone is damaged or incomplete: check the code out again, fresh and with full history (GitHub: `actions/checkout` with `fetch-depth: 0`; GitLab: `GIT_DEPTH: "0"`), then run the job again. |
| `FAIL [member-check]: cannot resolve the base ref <base> — …` | The same fix. |

Gates that print it: spec-link, contract-check, backfill, lineage-check, epic-open, reconcile-debt,
commit-message, verified-commits, ledger-guard, product-checkout and member-check.

When you run a gate by hand with no base, it picks one in this order: the first argument, then
`SDLC_BASE`, then `default_branch` from the Product settings, then the remote's default branch, then
`origin/main`. It prints a note saying which one it used.

### The two Product settings files disagree

The Product's settings are kept under two names until v5: `.sdlc/product.json` and the older
`.sdlc/hub.json`. `yad` writes both with the same content.

| Message | What to change |
|---|---|
| `FAIL [product-settings]: SDLC_PRODUCT_CONFIG (…) and SDLC_HUB_CONFIG (…) name files that say different things. Set only SDLC_PRODUCT_CONFIG.` | Remove `SDLC_HUB_CONFIG` from the job's environment. |
| `FAIL [product-settings]: .sdlc/product.json and .sdlc/hub.json say different things … In the Product, run yad migrate --apply --keep product (or --keep hub) …` | In the Product, run `yad migrate --apply --keep product` (or `--keep hub`) to choose the copy to keep, then commit both files. |

Gates that print them: spec-link, contract-check, backfill, lineage-check, epic-open, reconcile-debt,
commit-message, verified-commits, ledger-guard and product-checkout. risk-map prints a note instead.
member-check reads the first settings file it finds.

### Where the Product is read from

Four gates read the Product: contract-check, lineage-check, epic-open and reconcile-debt. They find it
in this order:

1. `path` in `.sdlc/product-link.json`, **as the base has it**. `yad check --fix` and `yad update`
   write this file into each code repo. CI checks the Product out there (see
   [product-checkout](#product-checkout)). One exception: when that path reaches no folder here and
   the value from step 2 does, step 2 is used.
2. `product-repo` in the story's `specs/<story>/link.md`, **as the base has it**. When the base has no
   value for this story (a new story, or a `link.md` without one), another story's `link.md` on the base
   is used: a story of the same epic first, and the first one whose value reaches a folder. If none
   reaches a folder, the first one with a value is used.
3. Only when the base names no Product at all (the repo's **first spec**): the story's own
   `product-repo` from this pull request.
4. Only when the value chosen above reaches nothing: a Product kept inside this repo (a monorepo) that
   holds the story's epic, read from the base commit.

Once the base names a Product, the pull request under check does not decide where it is read from. A
change to `product-link.json` or to `product-repo` counts only after it merges, so make that change in
its own pull request. The failure messages below name the file that was read, and say which case
applies: "in this pull request" on a first spec, or "merge that change on its own first" otherwise.
When the record was read, a message starts with `path '<path>' in .sdlc/product-link.json` instead of
`product-repo`. When the value read reaches nothing and the gate falls back to a Product this repo
keeps, the message starts with what was read, then `reaches nothing, so the Product this repo keeps`.

**When the Product cannot be reached at all** (CI did not check it out), lineage-check, epic-open and
reconcile-debt print `PASS [gate]: … deferred`, and contract-check skips the lock comparison with a
note. Two exceptions: epic-open fails when nothing names the Product at all, and contract-check fails
a changed slice on the repo's [first spec](#contract-check).

| Message (after `FAIL [<gate>]: …`) | What to change |
|---|---|
| `product-repo resolves to '<path>', a folder the gate cannot enter … Point <the file and field that was read> at a folder the job can read …` | Fix the path, or the folder's permissions. |
| `product-repo resolves to '<path>', inside this repo's own git folder … Point <the file and field> at the Product checkout (<example path>) …` | The path points into `.git/`. Point it at the Product checkout: `.yad/product` in the record (from the repo root), or `../../.yad/product` in a `link.md` (from the story's folder). |
| `<what>, and <base> keeps more than one Product holding <epic> (<list>) — the gate cannot tell which is meant. Set <the file and field> to one of them …` | Set the value to one of the listed folders. |
| `product-repo reaches the Product through '<path>', a symlink, submodule or file this repo tracks … Point <the file and field> at the Product itself …` | Point it at the real Product folder, not at a link. |
| `product-repo resolves to '<path>', which holds files this repo tracks, but <base> does not track '.sdlc/product.json' … Untrack those files (git rm -r --cached '<path>'), or point <the file and field> at the Product …` | A pull request cannot add its own Product. Untrack the folder, or point at the real Product. |
| `product-repo resolves to '<path>', a Product this repo keeps, and <base> has no '<path>/epics' folder … Merge that Product's epics into <base> first, or point <the file and field> at the Product checkout …` | Merge the Product's epics into the base first, or fix the value. |
| `'<path>/epics/<file>' on <base> is a symlink or a submodule … Replace it with the files themselves.` | Replace the link inside the kept Product with real files, in its own pull request. |
| `product-repo resolves to '<path>', a Product this repo keeps, and '<path>/epics' could not be read from <base> — run the job again; if it repeats, check the code out with full history and no partial-clone filter …` | As it says. |

### Waiving a commit already on a shared branch

A commit that is already on a shared branch cannot be reworded without rewriting that branch. If its
`Task:` trailer is wrong, every later pull request whose range still holds it fails again. A release
pull request to the default branch walks the whole release, so it fails on every release until that
commit reaches the base. List such a commit in `.sdlc/gate-exempt`, and spec-link, lineage-check,
epic-open and reconcile-debt pass it:

```
# one full SHA per line; text after # is a comment
4f2a9c1e5d3b7a6f8e0c2d4b6a8f0e1c3d5b7a9f  # fix(cart): Task: EP-cart-S03-retry-T02, already on develop
```

- The list is read **from the base**, never from the pull request under check, so a pull request
  cannot waive its own commits. Add the entry in its own pull request to the branch the failing pull
  request targets. It counts once it merges.
- An entry must be a full lowercase hex SHA: 40 characters, or 64 in a SHA-256 repository
  (`git rev-parse <commit>` prints it). A
  branch or tag name would move, so it is refused. A short SHA is refused too: git looks a short one
  up as a tag or branch name first, so a tag named like it would stand in for another commit.
- `SDLC_GATE_EXEMPT` names another path in the repo. It is set in the pipeline config, and a pull
  request can change that config where its own pipeline runs (GitHub `pull_request` workflows, for
  example). That does not let it waive its own commits: the variable can only name a file on the base,
  and every entry there must be a full SHA. A pull request that edits the pipeline could remove the
  gates altogether, so required checks and branch protection are what guard the pipeline itself.
- A listed commit skips **every** check of all four gates, not only the trailer check. In epic-open
  and reconcile-debt that includes the sealed-epic, orphan-thread and frozen-thread checks, which a
  `chore:` subject can never skip. Read the commit before you list it.
- Use it only for history you cannot rewrite. A new commit with a wrong trailer is reworded, not listed.

| Message | What to change |
|---|---|
| `PASS [<gate>]: <sha> '<subject>' — SHA exemption (.sdlc/gate-exempt on <base>)` | Nothing. The commit is listed. |
| `note [<gate>]: .sdlc/gate-exempt changes in this PR — the list is read from <base>, not from this PR; the new one counts once it merges.` | Merge the list change on its own first, then run the pipeline again. |
| `note [<gate>]: .sdlc/gate-exempt entry '<entry>' is not a lowercase hex SHA — it exempts nothing.` | Write the commit's SHA, not a branch, tag or `HEAD`. |
| `note [<gate>]: .sdlc/gate-exempt entry '<entry>' is not a full SHA (40 characters, or 64 in a SHA-256 repo) — it exempts nothing (a short one could be taken over by a tag or branch of that name).` | Write the whole SHA: `git rev-parse <short>`. |
| `note [<gate>]: .sdlc/gate-exempt entry '<entry>' is not the full SHA of a commit here — it exempts nothing.` | Check the SHA: it must be a commit's, not an annotated tag's or a tree's (`git rev-parse <tag>^{commit}` prints the commit's); it must be this repository's length (40, or 64 in a SHA-256 repository); and CI must fetch full history. |

## spec-link

**What it checks:** every commit names the task it implements, with a `Task:` trailer, and that task's
story has a spec in this repo (`specs/<story>/link.md`).

A **trailer** is a `Key: value` line at the end of a commit message. A task id looks like
`EP-checkout-S01-T02`: epic `EP-checkout`, story `S01`, task `T02`. `yad commit --task <id>` writes
the trailer. With no `--task`, `yad commit` reads the id from a branch named like
`feat/EP-checkout-S01-T02-add-queue`.

**Exemptions:**

- A commit whose type is `ci`, `chore`, `build` or `test` (with an optional scope and `!`) needs no
  trailer. If such a commit does have one, the trailer is still checked.
- Merge commits are skipped.
- A commit listed in `.sdlc/gate-exempt` on the base. See
  [Waiving a commit already on a shared branch](#waiving-a-commit-already-on-a-shared-branch).

**Reads:** each commit's `Task:` trailer; whether `specs/<story>/link.md` exists.

| Message (after `FAIL [spec-link]: <sha> …`) | What to change |
|---|---|
| `'<subject>' has no 'Task:' trailer — add one naming the task it implements, as 'Task: EP-<slug>-S<n>-T<NN>'. …` | Reword the commit to add the trailer (`git commit --amend`, or `git rebase -i <base>` for an older commit) and force-push. Next time use `yad commit --task <id>`. For maintenance work, use a `ci`, `chore`, `build` or `test` type. |
| `'<subject>' has a malformed Task trailer '<value>' (expected <story>-T<NN>).` | The value must end in `-T` and a number, such as `EP-checkout-S01-T02`. |
| `<task> — '<story>' is not a story ID (expected EP-<slug>-S<n>, the slug in lowercase letters, digits and dashes).` | Fix the id: lowercase slug, then `-S` and a number. |
| `<task> references specs/<story>/ but link.md is missing — run the yad-spec skill for <story> in this repo …` | Run the `yad-spec` skill for that story, which writes `link.md`, or fix the story id in the trailer. |

## contract-check

**What it checks:** a change to the **contract surface** must be declared. The contract surface is
everything under `specs/<story>/contracts/` — the part of the shared contract (APIs, events, schemas)
that this repo builds against. The contract is owned and locked in the Product, and a code repo must
not change it on its own.

A change to the surface passes when either of these is true:

- **The change is declared.** Some commit in the pull request has the trailer `Contract-Change: yes`
  (`yad commit --contract-change` writes it), **and** each changed story's `link.md` pins the
  Product's current contract lock. That means the contract was changed and locked again upstream
  first (the `yad-architecture` skill), and the slice was then written again from it (the `yad-spec`
  skill).
- **The change is only a quote** (no trailer needed). Each changed slice file is Markdown and holds
  exactly one `<!-- CONTRACT-QUOTE:BEGIN -->` … `<!-- CONTRACT-QUOTE:END -->` block. The lines inside
  are one unbroken run of the locked contract's surface lines, in order. The `yad-spec` skill writes
  slices this way. Outside the block, only blank lines are allowed, plus the title
  `# Contract slice — <story ID>` as the first line; notes go in `spec.md` or `plan.md`.

The gate reads what merging the branch into the base would change, the same as GitHub's own merge
check. Contract files that changed on the base after the branch split off do not count as this
branch's change.

**Exemptions:**

- A pull request that changes nothing under `specs/*/contracts/` passes.
- Removing files is always allowed in these cases: a slice under a folder that is not a story id; a
  whole slice removed together with its `link.md`; a slice of an epic that has no contract lock (the
  short lanes); a slice of an epic the Product does not have.
- When the Product cannot be reached, the lock comparison is skipped with a note — except on the
  repo's **first spec** (no `link.md` on the base names a Product): then a changed slice fails.

**Reads:** the changed paths; the `Contract-Change` trailer in any commit of the pull request;
`link.md` (`product-repo`, `contract-lock`); in the Product, `epics/<epic>/.sdlc/contract-lock.json`
and `epics/<epic>/contract.md`. It needs git 2.38 or newer for the exact merge; older git falls back
to the merge base and fails in the cases it cannot judge.

| Message (after `FAIL [contract-check]: …`) | What to change |
|---|---|
| `this branch does not merge cleanly into <base> … Merge <base> into the branch, resolve the conflicts, then push again.` | As it says. |
| `'<base>' and HEAD have N merge bases, and this git (older than 2.38) …` | Merge the base into the branch, or use git 2.38 or newer on the runner. |
| `<base> removed or moved a file this branch changes, and this git (older than 2.38) …` | Merge the base into the branch, then push again. |
| `git could not list what '<base>' removed …` / `git could not list what this branch changes since it split off …` / `git could not read the tree at HEAD …` | git is missing something it needs, so the clone is damaged or incomplete. Check the code out again, fresh and with full history (GitHub: `actions/checkout` with `fetch-depth: 0`; GitLab: `GIT_DEPTH: "0"`), then run again. The two `could not list` messages show only on git older than 2.38; git 2.38 or newer on the runner builds the merge instead and never runs that step. |
| `specs/ holds a symlink, a submodule or a second spelling …` | Replace each link with real files, and keep one spelling of each folder (`specs`, not `Specs`). |
| `contract surface changed without a 'Contract-Change: yes' trailer.` (with the reasons it is not a quote above it) | If you only copied the contract, run `yad-spec` again so the slice is a `CONTRACT-QUOTE` block. If the contract really changes, change and lock it upstream first, re-run `yad-spec`, and commit with `Contract-Change: yes` (`yad commit --contract-change`). Each reason line also says its own fix; the rows below list them. |
| Reason: `specs/<x>/contracts is not under a story ID, so it quotes no lock — …` | Move the slice under `specs/EP-<slug>-S<n>/contracts/` or delete it, and commit that with `Contract-Change: yes` (`yad commit --contract-change`): moving or removing slice files changes the surface, so it needs the trailer. |
| Reason: `git could not list the slice's deletions` / `… changes` / `git listed no changed slice file …` | Check the code out again, fresh and with full history, then run again; or, if the surface really changes, declare it with the trailer. |
| Reason: `cannot check <story>'s slice against its lock, because no Product is reached from <link.md> — …` | Let CI check the Product out: run `yad check --fix --push` from the Product (it writes `.sdlc/product-link.json`) and set the `YAD_PRODUCT_TOKEN` secret. Or, if the surface really changes, declare it — except on the repo's first spec, where CI must reach the Product either way. |
| Reason: `cannot check <story>'s slice against its lock, because the Product has no <epic> …` | If the epic is new, merge its Shape review pull requests into the Product's default branch first. If the story id in the slice's folder name is wrong, rename the folder or delete the slice, and commit that with `Contract-Change: yes` (`yad commit --contract-change`): moving or removing slice files changes the surface, so it needs the trailer. |
| Reason: `cannot check <story>'s slice against its lock, because the Product holds no <lock> — …` | Lock the epic's contract upstream first (`yad-architecture`, Step 5), then re-run `yad-spec`. An epic on a short lane (chore/spike) locks none: delete the slice, and commit that with `Contract-Change: yes` (`yad commit --contract-change`): moving or removing slice files changes the surface, so it needs the trailer. |
| Reason: `<lock> has no readable "hash": "sha256:…" value — …` | Lock the contract again upstream (`yad-architecture`, Step 5). |
| Reason: `<epic>'s pointer lock names '<ref>', which is not another epic's lock …` / `… and there is no lock there — …` | Fix `ref` (a path to the owner epic's `.sdlc/contract-lock.json`) or `inheritedFrom` (the owner epic's ID) in that epic's `contract-lock.json` in the Product (the `yad-change` skill writes them). |
| Reason: `<contract.md> is not there, so there is nothing to quote from — …` | Write that epic's `contract.md` in the Product and lock it (`yad-architecture`, Step 5). |
| Reason: `no sha256sum or shasum on this machine …` | Use a runner image with coreutils (`sha256sum`) or perl (`shasum`). |
| Reason: `<file>: holds a zero byte …` / `a CONTRACT-QUOTE block quotes nothing …` / `could not be read …` | Re-run `yad-spec`, which writes the slice again (or remove the zero byte). |
| `specs/<folder>/contracts is not under a story ID …` | Move the slice under `specs/EP-<slug>-S<n>/contracts/`, or delete it. |
| `<story>'s contract slice changes, but <link.md> is not there …` | Re-run `yad-spec` for the story; it writes the slice and `link.md` together. |
| `<lock> has no readable "hash": "sha256:…" value —` | Lock the contract again upstream (`yad-architecture`, Step 5). |
| `Contract-Change claimed, but <link.md> still pins <hash>…` | Re-run `yad-spec` so `link.md` pins the current lock. |
| `Contract-Change claimed, but <epic> has no contract lock at all.` | Lock the contract upstream first; the lines below the message name the cases. |
| `<story>'s slice belongs to <epic>, which does not exist in the Product … an orphan slice. Check the story id in the slice's folder name; …` | Fix the folder's story id, or merge the epic's Shape review PRs into the Product first. A pull request that only deletes the slice passes. |
| `<link.md> is this repo's first spec — no link.md on <base> names a Product …` | Run `yad check --fix --push` from the Product, with the `YAD_PRODUCT_TOKEN` secret set, so CI can check the Product out. Or fix `product-repo`. |
| `<link.md> — ` and a [Where the Product is read from](#where-the-product-is-read-from) message | See that table. |
| `a changed slice pins a stale or absent contract lock … (see above)` | A summary line. Fix the lines above it. |

**Why a slice is not a quote.** These lines are printed under the "without a Contract-Change trailer"
failure. Each one says why that story's slice could not pass as a quote:

| Reason | What to change |
|---|---|
| `has no CONTRACT-QUOTE block` | Re-run `yad-spec`, which writes the block. |
| `every CONTRACT-QUOTE block must be closed, BEGIN before END` / `holds more than one CONTRACT-QUOTE block` / `a CONTRACT-QUOTE block quotes nothing` | One closed, non-empty block per file. To quote two parts, use two files. |
| `this line sits outside the CONTRACT-QUOTE block: …` | Move notes to `spec.md` or `plan.md`. |
| `this line is not in the locked surface: …` / `not one unbroken run of the locked surface` | Copy whole lines, in order, from the locked surface. If the line is new, the contract is changing: add the trailer and lock upstream. |
| `this removes slice file(s) — a deletion changes the surface.` | A deletion needs the trailer. |
| `only a Markdown slice can pass as a quote` | Any other file under `contracts/` needs the trailer. |
| `not rebased onto <base> (or holds merge commits)` | Rebase the branch onto the base, then force-push. |
| `the branch's own commits touch it, but it is not in what lands (added and removed again?)` | That needs the trailer. |
| `specs/<folder>/contracts is not under a story ID — it quotes no lock.` | Move the slice under its story's folder, or delete it. |
| `<link.md> is not there, so the slice is tied to no lock` | Re-run `yad-spec`. |
| `<lock> has no readable "hash": … value.` | Lock the contract again upstream (`yad-architecture`, Step 5). |
| A [Where the Product is read from](#where-the-product-is-read-from) message | See that table. |
| `<link.md> names no contract-lock` / `pins …, not the current lock` | Re-run `yad-spec`. |
| `cannot check <story>'s slice against its lock — the Product's lock is not reachable` | Let CI check the Product out (see [product-checkout](#product-checkout)), or add the trailer. |
| `the Product's contract.md no longer matches its lock` | Lock the contract again upstream (`yad-architecture`, Step 5). |
| `<epic>'s pointer lock names '<ref>', which is not another epic's lock` / `and there is no lock there` / `its owner now locks another surface` | Fix the pointer lock in the Product (`ref` / `inheritedFrom` in `contract-lock.json`); the `yad-change` skill writes it. |
| `<contract.md> is not there — nothing to quote from.` | Write and lock the contract in the Product (`yad-architecture`). |
| `no sha256sum or shasum on this machine` | Run the job on a machine image that has `sha256sum` (coreutils) or `shasum` (perl). |
| `a slice file name holding a newline is not read` / `holds a zero byte` / `could not be read` | Rename the file, or write it again with `yad-spec`. |
| `git could not list the slice's changes` / `… deletions` / `git listed no changed slice file` | Fetch the whole history and run again, or add the trailer. |

## build/test/lint

**What it checks:** the repo's own `lint`, `build` and `test` scripts from `package.json` all pass, in
that order. The package manager is the one `package.json` names in `packageManager`, else the one the
lockfile shows (npm or pnpm).

**Exemptions:** none. `YAD_TEST_MAX_WORKERS` is passed on as `--maxWorkers` only to jest or vitest.

**Reads:** `package.json` (`scripts`, `packageManager`), the lockfile.

| Message | What to change |
|---|---|
| `FAIL [build/test/lint]: '<command> run <step>' failed — the output above says why. Run it on your machine, fix what it reports, and push again.` | As it says. The later steps do not run after a failure. |
| `FAIL [build/test/lint]: package.json has no "<step>" script, or an empty one — add one; the gate runs lint, build and test, in that order.` | Add the script to `package.json`. An empty script fails too: npm would run it as a pass. |
| `FAIL [package-manager]: …` | See [the package manager checks](#install-deps); the same checks run here. |

## lineage-check

**What it checks:** every code change belongs to an epic that sits in a **feature thread**. A thread is
a feature and the changes made to it later. An epic of any type other than `feature` or `chore` (so
`change`, `defect` or `hotfix`) must name its predecessor with `parent:`, and that parent must exist in
the Product. An epic with no type counts as `feature`.

**Exemptions:**

- `ci`, `chore`, `build` and `test` commits with no `Task:` trailer.
- Merge commits.
- A commit listed in `.sdlc/gate-exempt` on the base. See
  [Waiving a commit already on a shared branch](#waiving-a-commit-already-on-a-shared-branch).
- A commit with no usable `Task:` trailer (spec-link reports it) or no `link.md` (spec-link fails it):
  a note.
- The Product cannot be reached: passes with a note.
- An epic of type `feature` or `chore` (the start of a thread) needs no parent.

**Reads:** the `Task:` trailer; `link.md` (`epic`, `product-repo`); in the Product,
`epics/<epic>/epic.md` (`kind`, else `type`, and `parent`).

| Message (after `FAIL [lineage-check]: <sha> <task> …`) | What to change |
|---|---|
| `'<story>' is not a story ID …` | Fix the id in the trailer. |
| `<link.md> has no 'epic:' … Set epic: <epic> in it: a story's epic is the prefix of its id.` | Add `epic:` to `link.md`. |
| `<link.md> says epic: <x>, but <story> is a story of <epic>. … Fix epic: in <link.md>.` | Set `epic:` to the story id's prefix. |
| [Where the Product is read from](#where-the-product-is-read-from) messages | See that table. |
| `-> epic <epic> does not exist in the product repo (orphan story link). Check the story id in the Task trailer; …` | Fix the story id, or merge the epic's Shape review PRs into the Product's default branch first. |
| `-> <epic> is type:<type> but declares no 'parent:' … Add parent: <the epic it changes> to epics/<epic>/epic.md in the Product, through its review PR …` | Add `parent:` in the Product. The `yad-change` skill writes it; `yad thread` lists the threads. |
| `-> <epic> threads to '<parent>', but epics/<parent>/ does not exist in the Product (orphan thread). Fix parent: …` | Point `parent:` at an epic the Product has, or merge the parent epic first. |

## epic-open

**What it checks:** no commit adds work to a **sealed** epic. An epic is sealed when it has at least
one story and every story's `status:` is `shipped`. New work on shipped behaviour goes into a new
change epic that threads to it.

**Exemptions:**

- `ci`, `chore`, `build` and `test` commits with no `Task:` trailer.
- Merge commits.
- A commit listed in `.sdlc/gate-exempt` on the base. See
  [Waiving a commit already on a shared branch](#waiving-a-commit-already-on-a-shared-branch).
- No usable `Task:` trailer, or no `link.md`: a note (spec-link reports it).
- The Product cannot be reached: passes with a note.

**Reads:** the `Task:` trailer; `link.md` (`epic`, `product-repo`); in the Product,
`epics/<epic>/stories/*.md` (`status`).

| Message (after `FAIL [epic-open]: <sha> <task> …`) | What to change |
|---|---|
| `'<story>' is not a story ID …` | Fix the id in the trailer. |
| `<link.md> has no valid epic: value (EP-<slug>). Set epic: <epic> in it: …` | Set `epic:` to the story id's prefix. |
| `<link.md> says epic: <x>, but <story> is a story of <epic>. … Fix epic: in <link.md>.` | The same. |
| `<link.md> names no product-repo, and no .sdlc/product-link.json on <base> names the Product. …` | Set `product-repo` in `link.md` (the `yad-spec` skill writes it), or run `yad check --fix --push` from the Product to write the record into this repo. |
| [Where the Product is read from](#where-the-product-is-read-from) messages | See that table. |
| `-> epic <epic> does not exist in the product repo (orphan story link). …` | Fix the story id, or merge the epic's Shape review PRs into the Product first. |
| `targets SEALED epic <epic> (all stories shipped).` | Open a change epic with the `yad-change` skill (type `change`, `defect` or `hotfix`, `parent: <epic>`), and implement against its stories. |

## reconcile-debt

**What it checks:** a hotfix (an urgent fix that skipped the planning steps) leaves **reconcile debt**:
work still owed. The planning documents must be updated and a regression test (a test that would have
caught the bug) added. While a thread has open debt that belongs to
another epic, no other change may ship on that thread.

**Exemptions:**

- `ci`, `chore`, `build` and `test` commits with no `Task:` trailer.
- Merge commits.
- A commit listed in `.sdlc/gate-exempt` on the base. See
  [Waiving a commit already on a shared branch](#waiving-a-commit-already-on-a-shared-branch).
- No usable `Task:` trailer, or no `link.md`: skipped without a note (spec-link reports it).
- The Product cannot be reached: passes with a note.
- An epic's own debt never blocks it.

**Reads:** the `Task:` trailer; `link.md` (`epic`, `product-repo`); in the Product, every
`epics/*/epic.md` (`parent`, to find the thread) and `epics/*/.sdlc/reconcile-debt.json` (`status`).

| Message (after `FAIL [reconcile-debt]: <sha> <task> …`) | What to change |
|---|---|
| `'<story>' is not a story ID …` | Fix the id in the trailer. |
| `<link.md> says epic: <x>, but <story> is a story of <epic>. … Fix epic: in <link.md>.` | Set `epic:` to the story id's prefix. |
| [Where the Product is read from](#where-the-product-is-read-from) messages | See that table. |
| `-> epic <epic> does not exist in the product repo (orphan story link). …` | Fix the story id, or merge the epic's Shape review PRs into the Product first. |
| `thread <thread> carries OPEN hotfix debt:` (then each epic with its ledger, `<epic> — epics/<epic>/.sdlc/reconcile-debt.json`, and how to pay it) | Do the owed work first: update the planning documents and add the regression test, then set that entry's `status` to `paid` in `epics/<epic>/.sdlc/reconcile-debt.json` in the Product. `yad reconcile check`, run in the Product, lists every open entry. |

## risk-map (advice only)

**What it checks:** reads the repo's `.sdlc/risk-map` (a risk level per folder, no names) and prints how
many approvers this change should have. It never fails the job. Anything it cannot read becomes a note.

## backfill

**What it checks:** a change to `src/<feature>/` waits until that feature's backfill spec is approved
(`verified: true`) **on the base**. A backfill spec describes code that existed before `yad` (the
`yad-backfill` skill writes it). `yad` does not add this gate to CI; a team adds it by hand from
`skills/yad-backfill/templates/checks/backfill-check.sh`.

**Exemptions:**

- A feature with no `specs/backfill/<feature>/spec.md` on the base: a note.
- Files directly in `src/`, not in a feature folder (unless the name is a backfilled feature's, or a link).
- Deleting a symlink, a submodule, or one spelling of a folder that has a second spelling.

**Reads:** the changed paths under `src/`; `specs/backfill/<feature>/spec.md` (`verified`) on the base.

| Message (after `FAIL [backfill]: …`) | What to change |
|---|---|
| The base-and-history messages | See [the base cannot be found](#the-base-cannot-be-found). |
| `does not merge cleanly into <base> …` / `N merge bases …` / `<base> removed or moved a file …` | Merge the base into the branch, then push again. |
| `git could not list …` / `git could not read the tree …` | git is missing something it needs, so the clone is damaged or incomplete. Check the code out again, fresh and with full history (GitHub: `actions/checkout` with `fetch-depth: 0`; GitLab: `GIT_DEPTH: "0"`), then run again. `could not list what '<base>' removed …` and `could not list what this branch changes since it split off …` show only on git older than 2.38; git 2.38 or newer on the runner builds the merge instead and never runs that step. |
| `src/ holds a symlink, a submodule or a second spelling where a feature being backfilled lives …` | Put real files in place of each link, and keep one spelling. |
| `cannot tell whether <feature> is being backfilled — on the base, … is a symlink or submodule` / `<feature> is being backfilled, but on the base <spec> is a symlink or submodule …` | Put the real `specs/backfill/` folder or spec back, in its own pull request first. |
| `<feature> is being backfilled but its spec is not yet human-approved (verified: true) on the base.` | Approve the spec with the `yad-backfill` skill and merge that first. |

## commit-message

**What it checks:** every commit subject follows Conventional Commits: `<type>(<scope>)?!?:
<description>`. The scope is optional and uses lowercase letters, digits, `.`, `_` or `-`. The type is one of `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`,
`chore` or `revert`, and no full stop at the end. Trailers, when present, come in this order: `Task`,
then `Contract-Change`, then `Co-Authored-By`.

**Exemptions:**

- Merge commits.
- The `Task:` trailer is not required here (spec-link checks it on code repos).
- `Ledger-Override` is not part of the order check.

**Reads:** each commit's subject and trailers. `--profile code` or `--profile product` (the subject rule
is the same).

| Message (after `FAIL [commit-message]: …`) | What to change |
|---|---|
| `<sha> subject '<subject>' is not '<type>(<scope>)?!?: <description>' (type one of: …).` | Reword the commit (`git commit --amend`, or `git rebase -i <base>`) and force-push. |
| `<sha> subject '<subject>' must not end with a period.` | Remove the full stop the same way. |
| `<sha> trailers out of order — expected Task -> Contract-Change -> Co-Authored-By.` | Reorder the trailers the same way. |
| `-> Reword each commit listed above: git commit --amend for the last one, or git rebase -i <base> (mark it 'reword') for an older one; then force-push the branch (git push --force-with-lease).` | Printed once after any of the three above: it is the fix for all of them. |
| `unknown --profile '<x>' …` | A wiring problem: use `code` or `product`. |

## pr-title

**What it checks:** the pull request title.

- **Code repos** (`--profile code`): a Conventional Commits subject, like a commit, with no full stop.
  With a squash merge (all commits merged as one) the title becomes the commit subject.
- **The Product** (`--profile product`): a pull request from a `review/EP-*` branch is a Shape review,
  so its title must be `review: <artifact> (EP-<slug>)`, which `yad gate open` writes. Any other branch
  is a change to the Product's own tooling, so it uses the code rule.

**Exemptions:** a Product pull request that changes only step owner files
(`epics/<epic>/.sdlc/owners/*.json` or `foundation/.sdlc/owners/*.json`) may come from any branch.

**Reads:** the title; on the Product, the branch name and the changed paths.

| Message (after `FAIL [pr-title]: …`) | What to change |
|---|---|
| `'<title>' is not '<type>(<scope>)?!?: <description>' …` / `must not end with a period.` | Edit the title. The check runs again when the title changes. |
| `'<title>' is not a Product review title 'review: <artifact> (EP-<slug>)'.` | Edit the title to that shape. |
| `head '<branch>' changes Shape artifacts (epics/** or foundation/**) but is not a review/EP-* branch …` | Move the `epics/` or `foundation/` changes to a `review/<epic>/<artifact>` branch (`review/EP-foundation/foundation` for the Foundation) and run `yad open-pr` from it: it pushes the branch and opens the review pull request. Or drop those changes from this one. The message says both. `<artifact>` is the artifact's name without `.md`, as the message's example shows. `architecture` also carries `contract.md` and `.sdlc/contract-lock.json`, and all stories are one artifact (a branch like `review/EP-<slug>/stories-S01` opens the stories review). Each review's approvals count only for the stories at its own head, so when several per-story reviews merge, the gate passes once one approved review's head holds exactly the stories on the default branch. A last review of `stories/` as it stands does that: reset the branch `review/<epic>/stories` to the default branch (`git switch -C`), add a commit (an empty one is enough: `git commit --allow-empty`), push it with `--force-with-lease`, then run `yad gate open <epic> stories/`. The gate prints these commands (#366). Use one review branch per artifact: that is how `yad gate open` works, though no gate checks it. Ledger files under `.sdlc/` count as Shape changes too; only step owner files (`.sdlc/owners/`) may come from any branch. On a verified Product, [ledger-guard](#ledger-guard) also refuses hand edits to the gate-state files (such as `state.json` and `approvals.json`; its section has the full list) on a review branch, except a new epic's first ledger. Rewrite each of your own commits that ledger-guard lists so those files match `<base>` (`git rebase -i <base>`), then force-push: ledger-guard checks each commit, so a later commit that undoes them does not pass. |
| `empty title …` / `unknown --profile …` | A wiring problem in the CI job. |

## pr-template

**What it checks:** the pull request description uses the template `yad` installed.

- **Code repos, and Product tooling PRs:** sections `## Summary`, `## Impact & Risk` and `## Checklist`,
  and a `Risk level:` of `low`, `medium` or `high`.
- **Product review PRs** (`review/EP-*` branch): sections `## Artifact under review`,
  `## Impact & Risk (front-half)` (or `(Shape)`) and `## Checklist`, and a `Risk tags:` line.

**Exemptions:** lines inside `<!-- yad:trailer -->` … `<!-- /yad:trailer -->` and lines marked
`<!-- yad:noblock -->` are ignored. Owner-file-only Product PRs, as in pr-title.

**GitLab cuts long descriptions.** GitLab gives CI only the first 2700 characters of a description. In
GitLab CI, when the description was cut, the gate reads the whole text from GitLab's API, with the
`GITLAB_TOKEN` (or `SDLC_API_TOKEN`) CI/CD variable, else the job's own token. If that fails, it checks
the cut text and prints a `NOTE` saying why, and what to change when a token change would help.

**Reads:** the description; on the Product, the branch name and the changed paths.

| Message (after `FAIL [pr-template]: …`) | What to change |
|---|---|
| `missing section '<heading>' — the PR/MR body does not use the template.` | Add the section; the template has it. On GitLab, if a `NOTE` follows, move the required sections above the long text. |
| `'Risk level:' missing or not set to low\|medium\|high.` | Fill in the line. |
| `missing 'Risk tags:' line (Shape Impact & Risk).` | Add the line to the review description. |
| `head '<branch>' changes Shape artifacts …` | As in pr-title. |
| `no temp folder to write to (TMPDIR=…)` / `body file not found …` / `unknown --profile …` | A runner or wiring problem in the CI job. |

## verified-commits

**What it checks:** every commit has a signature that GitHub or GitLab marks **Verified**. Who may
author commits is decided by write access to the repo, not by a list.

**Exemptions:**

- No GitHub or GitLab remote, or `SDLC_PLATFORM=none`: a warning, and signatures are not checked.
- A merge commit with no content of its own: a warning, and its signature is not required (self-hosted
  GitLab does not sign merge commits made in its web page).

**Reads:** each commit's verification status, from the platform's API. On GitHub it uses `gh` with
`GH_TOKEN`; on GitLab, the `GITLAB_TOKEN` (or `SDLC_API_TOKEN`) CI/CD variable with the `read_api` scope.

| Message (after `FAIL [verified-commits]: <sha> …`) | What to change |
|---|---|
| `signature missing/unverified — sign commits with a GPG or SSH key added to your <platform> account (…). On a pull request branch, re-sign the commits already made: git rebase --exec 'git commit --amend --no-edit -S' <base>, and force-push. On the default branch, do not force-push: revert the commit, then land the change again through a pull request of signed commits.` | As it says. On GitLab the message adds: if the commits are signed, set the `GITLAB_TOKEN` variable, because GitLab answers "no signature" and "no access" the same way. |
| `— the job could not ask GitHub for the commit's signature (gh api failed). The job needs GH_TOKEN …` | Set `GH_TOKEN: ${{ github.token }}` on the job, as the `yad` workflows do, then run it again. On your own machine, install `gh` and run `gh auth login`. |
| `unknown platform '<x>' (SDLC_PLATFORM must be github\|gitlab\|none).` | Fix `SDLC_PLATFORM`. |

## ledger-guard

**What it checks:** on a Product whose gate records are kept by CI (the verified ledger), only the
verified `yad-gate-sync` bot may change those records. The records are
`epics/*/.sdlc/{state,approvals,comments,product-prs,hub-prs}.json`, `epics/*/reviews/*.md`, the same
files under `foundation/`, and `.sdlc/index.json`.

**Exemptions:**

- A Product with a local ledger (no platform, or `ledger: local`): nothing is checked.
- A **new** epic's first records (its "seed"), while that epic has no `state.json` on the base.
- `epics/*/.sdlc/contract-lock.json` (written by the architecture step, not by CI).
- No GitHub or GitLab remote: a warning, and any commit by `yad-gate-sync` is trusted without a
  signature check.

A `Ledger-Override:` trailer (written by `yad commit --manual --reason`) is quoted for the reviewer, but
never changes the result.

**Reads:** every commit's changed paths, author and signature; the Product settings (`ledger`,
`platform`).

| Message | What to change |
|---|---|
| `FAIL [ledger-guard]: N commit(s) change CI-owned gate files without a verified gate-bot signature. … rewrite your own commits listed above (git rebase -i <base>) so each leaves those files as <base> has them, and force-push.` | Every commit is checked, so a new commit that undoes the change does not help. Rewrite the listed commits. CI writes the records itself when the review merges (`yad gate status <epic>` shows the state). If they are seed commits from a review PR that already merged, rebase onto the base instead (the hint line says so). |
| `FAIL [ledger-guard]: unknown platform '<x>' …` | Fix `SDLC_PLATFORM`. |

## member-check

**What it checks:** a pull request may add or change only its own author's member file,
`.sdlc/members/<platform>-<login>.json` (written by `yad member add`). On GitHub, each email in the file
must be proven by a commit in the pull request that GitHub links to that person.

**Exemptions:**

- No member file changed.
- Deleting a member file (`yad member remove <login> --reason` does it).
- On GitLab, emails are not proven (its API cannot show which account wrote a commit); only the
  owner rule applies.

**Reads:** the changed paths; the member files; the Product's `platform` and `git_url`; the pull
request's author (GitHub: `PR_AUTHOR` and `PR_AUTHOR_ID` from the event; GitLab: the merge request API
with `GITLAB_TOKEN` or `SDLC_API_TOKEN`).

| Message (after `FAIL [member-check]: …`) | What to change |
|---|---|
| `a PR may add or change only its author's own member file …` | Undo this pull request's change to that file (see below): each person changes only their own file, which `yad member add` writes. To remove someone else, use `yad member remove <login> --reason "<why>"` in a pull request of its own. |
| `only <platform>-<login>.json files belong in .sdlc/members/` | Move the file to `.sdlc/members/<platform>-<login>.json`, or remove it. |
| `<file>: not a member file (no "accounts" list)` / `does not hold <author>'s own <platform> account …` / `the account id in the file … is not the author's` / `must hold exactly one <platform> account …` | Write the file again with `yad member add`, run by its own person. It opens its own pull request; in any other pull request, undo the change to the file (see below). |
| `belonged to account id …, not <author>'s (<id>), and a reused login does not take over a member file …` | Remove the old file first with `yad member remove <login> --reason`, in its own pull request. |
| `holds an email no commit in this PR proves …` (GitHub only) | Verify the email on your account, then run `yad member add`: it makes one commit with each email, which GitHub then gives to you. |
| `the account <x> is in <a> and <b>` | One account belongs to one member. The message names the file that is not named `<platform>-<login>.json`, and how to take it out (see below). (`yad member remove` cannot: it removes the well-named file.) |
| `one email is in <a> and <b>` (GitHub only) | One email belongs to one member. If one of the files is not named `<platform>-<login>.json`, the message names it and how to take it out (see below). Otherwise remove the email from the file it does not belong in: that file's own person runs `yad member add` again, which keeps only the emails their account has verified. Or remove a stale file with `yad member remove <login> --reason`. |
| `"<path>" is another spelling of .sdlc/ …` / `… of .sdlc/members/ …` | Move the file into the real folder (`git mv`), or delete it. |
| `… is not a folder at HEAD (a link?) …` | Replace the link with a real folder that holds the files themselves. |
| `… is not a plain file (a link?) …` | If the base held a plain file there, undo this pull request's change to it (see below) — never delete it, which would remove that person. A link this pull request adds: replace it with the file itself, or drop it. A link the base already held: replace it, or `git rm` it; the gate never read it, so nothing is lost. |
| `<a> and <b> are one file on macOS and Windows` | The message names one file to keep for all the names of that file, and how to take each other one out (see below). It keeps, in order: a plain file over a link (a link is refused in the same run), then a copy the base holds, then the lower-case name `yad member add` writes. If this pull request adds that lower-case name beside the base's copy, and it is your own file, the message also says how to keep it and remove the base's copy instead. |
| `member files changed, but the Product names no platform …` | Set `platform` (`github` or `gitlab`) in the settings file the message names. With no `.sdlc/product.json`, run `yad setup` in the Product. |
| `no API token (GITLAB_TOKEN or SDLC_API_TOKEN) …` | Add a `GITLAB_TOKEN` masked CI/CD variable with the `read_api` scope, whose user can see the project. |
| `could not read the MR (HTTP N): …` | The message says what to change, by the answer: 401 renew or replace the token; 403 give it the `read_api` scope; 404 use a token of a project member with Reporter access or more. Any other answer is a GitLab problem, not the token's: run the job again later. |
| `could not read the MR: <error> …` | Check that `CI_API_V4_URL` is reachable from the runner and answers as GitLab's API, then run the job again. |
| `cannot tell who opened this PR/MR (<x> is a bot) …` | A bot cannot change member files: open the pull request as the person. |
| `cannot tell who opened this PR/MR — …` / `cannot tell the numeric id of who opened this PR (PR_AUTHOR_ID) …` | On GitHub, the job must pass `PR_AUTHOR` and `PR_AUTHOR_ID` from the `pull_request` event, as `yad-product-checks.yml` does. On GitLab, run the job in a merge request pipeline, as `yad-product-checks.gitlab-ci.yml` does; if the API named no author, run the job again. |
| The base messages | See [the base cannot be found](#the-base-cannot-be-found). |
| `git could not list the changed files` | Check the code out with full history (GitHub: `actions/checkout` with `fetch-depth: 0`; GitLab: `GIT_DEPTH: "0"`), and give a base this branch shares history with, then run again. |
| `usage: node checks/member-check.mjs <base-ref> …` | A wiring problem: the job must pass the base ref (the branch the pull request targets), as `yad-product-checks.yml` (GitHub) and `yad-product-checks.gitlab-ci.yml` (GitLab) do. |

**Taking a member file out** (the rule the account clash, the email duplicate and the twin messages use): a file this pull request brings in, and the base does not hold, is dropped from the pull request — `git rm` it on this branch, so the pull request no longer adds it. A file the base holds — even one this pull request only edits — is deleted with `git rm`; any pull request may delete a member file. A path with a space or another unusual character is printed in single quotes, so the command can be pasted as it is.

**Undoing a change to a member file** (the owner, link and `yad member add` rows use it): a file the base holds is restored to the base's copy (`git checkout <base>...HEAD -- <file>`), never deleted — deleting a teammate's file would remove them, and a deletion always passes. A file only this pull request adds is dropped (`git rm` it on this branch).

In both rules, "the base" is the commit this branch split off from, which is what the gate compares against. `<base>...HEAD` names that commit, so a restore still works after the base branch has moved on.

## product-checkout

**What it does:** clones the Product into the folder `.sdlc/product-link.json` names (by default
`.yad/product`), so the four Product-reading gates can read it. It reads the record from the base.

**Exemptions (it exits without failing):**

- No `.sdlc/product-link.json` on the base: a note.
- No `YAD_PRODUCT_TOKEN` secret (GitHub) or CI/CD variable (GitLab). On a pull request from a fork this
  is a note, because a fork never gets secrets. On any other pull request it is a `WARNING`, and the
  Product-reading gates skip their Product checks.
- The record has no `git_url`, or the folder already exists: a note. So is a `git_url` written with a JSON
  escape (`\/`), a quote or a backslash, which this check cannot read: write it without escapes and merge
  that first (`yad check --fix` keeps it when it decodes to the Product's own url).
- Problems reading the token's expiry date are notes or warnings. A warning also appears 30 days before
  the token expires.

**Reads:** `.sdlc/product-link.json` on the base (`git_url`, `path`, `default_branch`);
`YAD_PRODUCT_TOKEN`.

| Message (after `FAIL [product-checkout]: …`) | What to change |
|---|---|
| `<record> on <base> says path '<path>' — it must be a folder inside this repo. Change path in <record> to one, such as .yad/product, and merge that change first …` | Change `path` in `.sdlc/product-link.json` to a folder inside the repo, such as `.yad/product`, in its own pull request, and merge it first. The record is read from the base, so changing it in the failing pull request does not help. `yad check --fix --push` does not help either: it keeps a `path` that is set. |
| `<record> on <base> names no path — run yad check --fix --push from the Product …` | Run `yad check --fix --push` from the Product, on a machine that has this repo cloned and on its default branch. It writes `path` `.yad/product` to the record there. Or set `path` yourself, in its own pull request. |
| `<record> on <base> names a path this check cannot read (it is written with a JSON escape, a quote or a backslash) …` | Change `path` to a plain folder such as `.yad/product`, in its own pull request, and merge it first. `yad check --fix` keeps it as it is. |
| `'<path>' is a symlink … Point path in <record> at a real folder.` | As it says. |
| `'<path>' holds files this repo tracks — the Product cannot be checked out there. Untrack them only if they do not belong in this repo …, or change path …` | If those files do not belong in the repo, untrack them in this pull request (`git rm -r --cached -- '<path>'`, add the folder to `.gitignore`, then commit). This deletes them from the repo for everyone once it merges. Otherwise change `path` to an untracked folder such as `.yad/product` in its own pull request, and merge it first: the record is read from the base. |
| `<record> on <base> has an http:// git_url … Set the Product's git_url to the https url …` / `… a git_url git cannot clone over https: '<url>' — set the Product's git_url to an https:// or git@host:org/repo form …` | Set the Product's `git_url` to an `https://` or `git@host:org/repo` form, then run `yad check --fix --push` from the Product, on a machine that has this repo cloned and on its default branch. It rewrites the record there. |
| `could not clone the Product from <url> (<branch>) into '<path>'.` | The next line says why. A rejected token (HTTP 401) has expired or been revoked: renew `YAD_PRODUCT_TOKEN`. Otherwise check that the token can read that repo, and that `git_url` and `default_branch` are right. |

`yad doctor` also checks, by name only, that `YAD_PRODUCT_TOKEN` is set where CI can read it.

## install-deps

**What it does:** installs the repo's packages with the package manager `package.json` names, before
build/test/lint runs.

| Message | What to change |
|---|---|
| `FAIL [install-deps]: npm requires package-lock.json or npm-shrinkwrap.json.` | Commit the npm lockfile. |
| `FAIL [install-deps]: pnpm requires pnpm-lock.yaml.` | Commit the pnpm lockfile. |
| `FAIL [install-deps]: pnpm CI requires an exact package.json#packageManager value (for example pnpm@9.15.0).` | Set `packageManager` to an exact version. |

**The package manager checks.** These lines start with `FAIL [package-manager]:` and can appear in both
install-deps and build/test/lint, which share `package-manager.sh`. **Corepack** is the tool that comes
with Node and installs the exact npm or pnpm version `packageManager` names.

| Message (after `FAIL [package-manager]: …`) | What to change |
|---|---|
| `package.json#packageManager is set but corepack is not on PATH (Node 25+ no longer bundles it) — …` | Set the `YAD_NODE_VERSION` CI variable to a 20, 22 or 24 line, or run `npm install -g corepack` in the job. |
| `corepack could not activate <spec>. A Corepack older than 0.31 cannot verify packages signed after the 2025 npm registry key rotation — …` | Use a newer Node line (`YAD_NODE_VERSION` 20, 22 or 24) or `npm install -g corepack`. Otherwise check that the version exists and the registry can be reached. |
| `packageManager "<x>" must name an exact semantic version …` | Use a value like `pnpm@9.15.0`. |
| `packageManager holds a line break — …` | Remove the line break, so the value is one line like `pnpm@9.15.0`. |
| `packageManager holds an invisible or control character — …` | Remove it. The value must be plain text like `pnpm@9.15.0`. Such a character is hard to spot in an editor: a tab, the ESC code that starts a terminal colour, a zero-width space, or a mark that flips the direction of the text. Retyping the value by hand removes it. |
| `package.json is not valid JSON at line <L>, column <C> (<parser message>) — …` | Fix `package.json` at that line and column. The parser message (what Node's JSON reader reports) says what it found there. When the parser does not give a place, the message has no line and column. The parser message then quotes the text near the error, or says the file ends too early. |
| `package.json could not be read (<error code>) — …` | Give the CI user read access to `package.json`. `EACCES` means the file's permissions keep that user out. |
| `package.json is missing.` / `package.json must be a JSON object.` / `packageManager must be a string.` | Fix `package.json`. |
| `unsupported packageManager '<x>' (supported: npm, pnpm).` | Use npm or pnpm. With an npm lockfile present, yarn and bun fall back to npm with a warning. |

## Commit trailers the gates read

| Trailer | Written by | Read by | Meaning |
|---|---|---|---|
| `Task: EP-<slug>-S<n>-T<NN>` | `yad commit --task <id>` (or the branch name) | spec-link, lineage-check, epic-open, reconcile-debt, commit-message (order only) | The task this commit implements. Not needed on `ci`, `chore`, `build` and `test` commits. |
| `Contract-Change: yes` | `yad commit --contract-change` | contract-check, commit-message (order only) | This change moves the contract surface, which was locked again upstream first. |
| `Ledger-Override: <why>` | `yad commit --manual --reason "<why>"` | ledger-guard (quoted only) | Why a person committed past the local ledger hook. It never makes the gate pass. |
| `Co-Authored-By: …` | git, or your tools | commit-message (order only) | Another author. |
