# `hub` → Product — the changes only you can make

**What the Product is:** the git repo that holds your epics, their reviews and the settings for the
whole project. Before 4.0 yadflow called it the **hub**. In 4.0 every name that said `hub` says
**Product** instead.

yadflow renames everything it owns by itself:

| Command | What it renames |
|---|---|
| `yad migrate` | The settings file: `.sdlc/hub.json` → `.sdlc/product.json`, and each epic's `hub-prs.json` → `product-prs.json`. The old names are still written beside the new ones, with the same bytes, until v5 deletes them. |
| `yad update` | The files it installed in your repos: the `yad-hub-checks.yml` workflow → `yad-product-checks.yml`, the `yad-hub-bridge` skill → `yad-product-bridge`, the GitLab `yad-hub-*` jobs → `yad-product-*`, and the `- local:` include line for that workflow in your root `.gitlab-ci.yml`. |

This page lists the rest: the places **you** wrote an old name, in files yadflow does not own and never
edits. Each one keeps working until v5 unless this page says otherwise.

## The order to run things in

1. `yad migrate`, then `yad migrate --apply` — renames the settings files.
2. `yad update` — renames the files yadflow installed in each repo.
3. `yad doctor` — lists what is left. Its `renamed-ref:<file>` lines name each line of your own files
   that still names an old CI name.
4. Make the hand changes below, then run `yad doctor` again.

## 1. Your CI settings: the environment variable

**What it is:** `SDLC_HUB_CONFIG` is an environment variable (a named value your CI passes to every job)
that tells the check gates where the settings file is. Most projects never set it.

| Before | After |
|---|---|
| `SDLC_HUB_CONFIG: .sdlc/hub.json` | `SDLC_PRODUCT_CONFIG: .sdlc/product.json` |

The old name still works until v5. If both are set and name files that say different things, every gate
fails and names both, so change it in one step.

## 2. Your own scripts that read the settings

**What they are:** any script of your team's own that opens the settings file or a review record by its
path.

| Before | After |
|---|---|
| `jq .platform .sdlc/hub.json` | `jq .platform .sdlc/product.json` |
| `cat epics/EP-x/.sdlc/hub-prs.json` | `cat epics/EP-x/.sdlc/product-prs.json` |

The old files are still written until v5, so an old script keeps reading correct values until then. In
v5 the old files are deleted and the script stops working.

## 3. GitLab: the include line in your root `.gitlab-ci.yml`

**What it is:** the line in your own root `.gitlab-ci.yml` that pulls in the Product's check jobs.

| Before | After |
|---|---|
| `- local: '.gitlab/ci/yad-hub-checks.yml'` | `- local: '.gitlab/ci/yad-product-checks.yml'` |

`yad update` rewrites this line for you when it renames the file, but only a line that names that exact
path. If you wrote the path another way, change it by hand **after** `yad update` has installed the new
file. Changing it before would name a file that
is not there yet, and the pipeline would fail. `yad doctor`'s `renamed-ref:` line tells you which case
you are in.

## 4. GitLab: your own jobs that name ours

**What they are:** jobs your team wrote that point at one of yadflow's jobs by its name.

| Before | After |
|---|---|
| `needs: [yad-hub-commit-message]` | `needs: [yad-product-commit-message]` |
| `dependencies: [yad-hub-pr-title]` | `dependencies: [yad-product-pr-title]` |
| `extends: .yad_hub_mr_only` | `extends: .yad_product_mr_only` |
| `!reference [yad-hub-ledger-guard, script]` | `!reference [yad-product-ledger-guard, script]` |

The five renamed jobs are `yad-hub-commit-message`, `yad-hub-pr-title`, `yad-hub-pr-template`,
`yad-hub-ledger-guard` and `yad-hub-verified-commits`. **These break at once** when `yad update` renames
the jobs: a `needs:` that names a job that no longer exists stops the pipeline. Change them in the same
merge request as the update.

## 5. GitHub: workflows that start after ours

**What it is:** a `workflow_run:` trigger starts one of your workflows when another one finishes. It
names that other workflow by its `name:`, not its file.

| Before | After |
|---|---|
| `workflows: [yad-hub-checks]` | `workflows: [yad-product-checks]` |

**This stops at once** when `yad update` renames the workflow: GitHub finds no workflow with the old
name, and yours never starts. Nothing fails, so nothing tells you.

The check names you mark as required in branch protection (`commit-message`, `pr-title`, …) did not
change, so branch protection needs nothing.

## 6. Status badges

**What they are:** the small pass/fail images in a README. GitHub has two link forms.

| Before | After |
|---|---|
| `…/actions/workflows/yad-hub-checks.yml/badge.svg` | `…/actions/workflows/yad-product-checks.yml/badge.svg` |
| `…/workflows/yad-hub-checks/badge.svg` | `…/workflows/yad-product-checks/badge.svg` |

An old badge link no longer shows the checks' result.

## 7. `CODEOWNERS`

**What it is:** the file that names who must review changes to each path. A platform reads it from the
repo root, `.github/`, `.gitlab/` or `docs/`.

| Before | After |
|---|---|
| `.github/workflows/yad-hub-checks.yml @ops` | `.github/workflows/yad-product-checks.yml @ops` |
| `.gitlab/ci/yad-hub-checks.yml @ops` | `.gitlab/ci/yad-product-checks.yml @ops` |

A stale line does no harm, but it no longer protects the file it meant to.

## 8. The `--profile` value in your own workflows

**What it is:** the value a workflow passes to the `commit-message`, `pr-title` and `pr-template` checks
to say it is running on the Product.

| Before | After |
|---|---|
| `bash checks/pr-title.sh --profile hub …` | `bash checks/pr-title.sh --profile product …` |

The workflows yadflow installs pass `product` since 4.0. The checks still accept `hub`, but change yours:
a check edited after 4.0 may no longer turn `hub` into `product`, and would then skip the Product's rules.
`yad doctor` names each line of your CI files that passes `--profile hub` literally (`renamed-ref:<file>`); a
value passed through a variable is not seen, so search for those yourself.

**First** make sure the checks handle `product`:

| Your `checks/*.sh` | What happens once your workflow passes `product` | Do this first |
|---|---|---|
| not edited, from before 4.0 | it refuses `product`: every Product PR fails | run `yad update`, which replaces it |
| installed before yad kept a record of its files (3.16), edited or not | the same | run `yad update`: it replaces it and saves your copy as `<file>.yad-orig` |
| edited, and it accepts only `code\|hub` | it refuses `product`: every Product PR fails | fix it, or replace it with `yad update --overwrite-local` |
| edited, lists `product` but does not turn it into the old value | it takes `product` and skips the Product's rules | the same |
| on a Product that is not in verified mode (yad does not manage its checks) | either of the above | fix it by hand: no `yad update` replaces it |

`yad doctor` tells you which case each check is in, and names every check in the way (in the `renamed-ref:` hint,
and in `profile:<gate>`).

## 9. Tools that read `--json`

**What it is:** `--json` makes a command print one machine-readable object. Its format has its own
number, `jsonVersion`, which moved from 1 to 2 because these values were renamed:

| Command | Key | Before | After |
|---|---|---|---|
| `yad doctor` | `checks[].id` | `hub`, `hub-git-url`, `ci-tags:hub` | `product`, `product-git-url`, `ci-tags:product` |
| `yad open-pr` | `baseSource` | `hub` | `product` |
| `yad open-pr` | `stage` | `hub-shape`, `hub-tooling` | `product-shape`, `product-tooling` |
| `yad check`, `yad update` | `items[].scope` | `hub` | `product` |
| `yad update` | `commits[].label` | `hub` | `product` |
| `yad history show` | a key | `hubWhy` | `productConfigWhy` |

A tool that checks `jsonVersion` before it reads will see the 2 and can stop instead of misreading.

If one of your code repos is itself named `product`, its entries share the value `product` with the Product's
own. Each `items[]` and `commits[]` entry, and each `ci-tags:*` check, carries a `product` key (`true` or
`false`) that tells them apart — read that key rather than the name. When you ask a skill to work on that
repo, give its path (for example `repo: repos/product`), not its name.

## 10. Tools that read the printed text or the git log

Printed text is not a contract, but if a script of yours matches it:

| Before | After |
|---|---|
| `yad doctor`: `hub: github` | `product: github` |
| `yad doctor`: `Product hub: …` (branch protection) | `Product: …` |
| `yad open-pr`: `base main (from hub)` | `base main (from product)` |
| the audit commits of `yad checkpoint`, `yad tidy up`, `yad repo refresh --push`: `chore(hub): …` | `chore(product): …` |

Commits made before 4.0 keep `chore(hub):` for ever. A script that searches the log for these commits
should match both.

## 11. Words you type to a skill

Two values you may type to a skill were renamed. The old ones still work.

| Before | After |
|---|---|
| `yad-connect-repos action: detect-hub` | `yad-connect-repos action: detect-product` |
| `yad-checks repo: hub action: wire`, `yad-pr-template repo: hub action: wire` | `repo: product` |

`.sdlc/docs.json` written by `yad-connect-docs` before 4.0 says `"scope": "hub"`. That still means the
Product. The skill writes `"scope": "product"` the next time it writes the file; you do not need to
change it.

## What is not renamed

- `yad migrate --keep hub` keeps its name: `hub` there names the old file, `hub.json`.
- The old files `.sdlc/hub.json` and `hub-prs.json`, and `SDLC_HUB_CONFIG`, stay until v5 for the
  check gates an older yadflow installed in your repos.
