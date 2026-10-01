# Upgrading yadflow from 3.x to 4.x — a step-by-step guide

**Who this is for:** people who run yadflow on a project, and AI agents (such as Claude Code) that help
them. The steps are the same for both. Section 9 has extra rules written for AI agents.

**What it covers:**

1. The words you need to know
2. Before you start
3. The upgrade, step by step
4. The extra steps for a verified ledger
5. Changes that `yad migrate` does not handle
6. How to read the output of `yad doctor`
7. A worked example from a real upgrade
8. How to undo the upgrade
9. Rules for AI agents
10. A final checklist

This guide was written for an upgrade from **3.13.1 to 4.1.0** (October 2026). The same steps work from
any 3.x release to any 4.x release.

**How it relates to [Upgrading to 4.0](upgrading-to-4.md):** that page is the reference — every shape
and every breaking change, with the page that explains each one. This page is the hands-on companion:
the order to work in, and how to sort what `yad doctor` says afterwards.

---

## 1. The words you need to know

| Word | What it means |
|---|---|
| **yadflow / `yad`** | yadflow is the npm package. `yad` is the command it installs. |
| **Product** | The git repo that holds your epics, their reviews and the project settings. **Its old name: `hub`.** You run almost every command from here. |
| **Code repo** | A repo with your application code (for example `backend`, `pwa`, `admin`). It is connected to the Product. |
| **Shape** | The layout of the files yadflow writes. Each file says its shape in a `"schemaVersion"` number. A file with no number counts as shape 1. 3.x writes shape 1. 4.x writes shape 10. |
| **Migrate** | Rewriting your files from the old shape to the new one. `yad migrate --apply` does this. **One run goes from shape 1 to shape 10.** You do not run it once per shape. |
| **Ledger** | The review records for each epic: `state.json`, `approvals.json`, `comments.json`, inside each epic's `.sdlc/` folder. |
| **Verified ledger** | A Product where **only CI is allowed to write the ledger**. You can tell: `.sdlc/product.json` says `"ledger": "verified"` (on 3.x, `.sdlc/hub.json` says `"bridge_enabled": true`). |
| **Local ledger** | A Product where people write the ledger from their own machines. |
| **Gate** | A review step. An epic cannot move on until the review is approved. |
| **Checks** | Shell scripts in `checks/` that CI runs on every PR (for example `contract-check.sh`, `verified-commits.sh`). |
| **`yad doctor`** | A read-only health check. It prints `ok`, `warn` or `fail` for each item, with a hint. It never changes anything. |
| **Warning code** | The short ID of each kind of doctor item, for example `shape:EP-login` or `module:legacy-bmad`. |
| **`.yad-orig` file** | A backup that `yad migrate --apply` saves before it changes a file. |

---

## 2. Before you start

Go through this list first. Each item avoids a known problem.

- [ ] **Upgrade the whole team at the same time.** A 3.x `yad` cannot read a 4.x project correctly. It
      reads some values wrongly, and it sees new approvals as out of date.
- [ ] **Check your Node version.** Run `node --version`. yadflow 4.x needs Node 18 or newer.
- [ ] **Start from a clean working tree** in the Product and in every code repo. (The working tree is
      the set of files you have checked out.) Commit or stash any open changes. This makes the
      upgrade's changes easy to review.
- [ ] **Pull the latest default branch** in the Product and every code repo.
- [ ] **Find out which ledger you have.** Open `.sdlc/hub.json` (or `.sdlc/product.json`). If you see
      `"bridge_enabled": true` or `"ledger": "verified"`, you have a verified ledger. Section 4 is for you.
- [ ] **Write down any CI files you wrote yourself** that use `hub`, the old name (for example a workflow that
      calls `yad-hub-checks.yml`). You will need to rename those by hand.
- [ ] **Check for an old kill switch.** If `_bmad/sdlc/config.yaml` says `kill_switch: true`, note it.
      **4.x does not read that line, so the switch will be off after the upgrade** (see section 5).

---

## 3. The upgrade, step by step

Run every command **from inside the Product folder**, unless a step says otherwise.

| # | Command | What it does | What to look for |
|---|---|---|---|
| 1 | `yad --version` | Shows the version you have now. | A 3.x number. |
| 2 | `npx yadflow@latest migrate` | **A preview. It writes nothing.** It prints one line for each file that would change. It uses `npx` on purpose: the migration code ships inside the new version, so your old `yad` would say "nothing to do". | Read the list. Nothing is changed yet. |
| 3 | `npm install -g yadflow@latest` | Installs the new `yad` for all your projects. | — |
| 4 | `yad --version` | Confirms the install. | A 4.x number. If you still see 3.x, see the note below this table. |
| 5 | `yad migrate --apply` | Rewrites your files to shape 10. It saves each changed file as `<file>.yad-orig` first. | One line per file changed. |
| 6 | `yad update` | Refreshes everything yadflow installed: the `yad-*` skills, the check scripts, the CI files and the agent hooks. It also renames the old names (`hub` → `product`, for example `yad-hub-bridge` → `yad-product-bridge`). | — |
| 7 | `yad check --fix` | Installs anything missing (for example `.sdlc/config.yaml`, the git pre-commit guard) and refreshes check scripts that nobody edited by hand. | — |
| 8 | Commit | Commit everything, including `.claude/settings.json` and `.cursor/hooks.json`. Do **not** commit the `.yad-orig` files. | — |
| 9 | `yad update` again, then commit | The old shell hooks (`hooks/*.sh`) are deleted only **after** the new hook settings are committed, so that a teammate who pulls never gets a setting that runs a deleted script. This second run removes them. | The old `hooks/*.sh` files are gone. |
| 10 | `yad check --fix --push` | Writes `.sdlc/product-link.json` (the record of where the Product lives) into each code repo, and **commits and pushes it to each repo's default branch**. Skip this step if your team does not push straight to the default branch. In that case, commit the file through a PR in each repo. | — |
| 11 | `yad repo refresh <name>` | For each code repo that doctor calls "stale". This rebuilds the cached summary of its code. | — |
| 12 | `yad doctor` | The health check. | Go to section 6 to sort the result. |

**If step 4 still shows 3.x:** you probably have more than one Node install (for example through `nvm`, a
tool that manages several Node versions). Run `which yad` to see which copy runs. Install again with the
same Node that `which node` shows.

---

## 4. The extra steps for a verified ledger

On a verified ledger, **CI is the only writer of the ledger files**. So `yad migrate --apply` does not
touch `state.json`, `approvals.json`, `comments.json` or the review PR list. This is correct, not a bug.

1. Run `yad migrate --apply` and commit the result. It updates every file that CI does **not** own,
   for example the Product settings and `.sdlc/cli-version.json`.
2. Run `yad update` and commit the result. This makes the CI workflow that records reviews run 4.x. If
   your settings pin an old version with `gate_sync_version`, remove or update that pin.
3. **Wait.** CI updates each epic's `state.json` the next time it records a review for that epic. There
   is nothing to run for this.
4. Expect `yad doctor` to show one `shape:<epic>` warning for each epic, with the hint "nothing to run —
   in verified mode CI owns these files". **This is normal.** A finished epic that never gets another
   review keeps its warning. yadflow still reads its files correctly.
5. Changes to the Product go through a PR, as usual on a verified ledger.

---

## 5. Changes that `yad migrate` does not handle

These are not file-shape changes, so you must check them yourself. `yad doctor` points out most of them.
[Upgrading to 4.0](upgrading-to-4.md#every-other-breaking-change-since-3181) explains each one in full.

| Change | What it means for you | What to do |
|---|---|---|
| **`hub` → Product** | 4.x reads `.sdlc/product.json` first. If `hub.json` and `product.json` both exist and disagree, **every command refuses** (`YAD-STATE-008`). | Run `yad migrate --apply` to bring the two files back in line. Rename the old name (`hub` → Product) in any CI file **you wrote yourself**. `yad update` renames only the files it installed. |
| **The kill switch moved** | The kill switch stops every step from moving forward on its own. It now lives in `.sdlc/automation.json`. **`kill_switch: true` in `_bmad/sdlc/config.yaml` is no longer read, so the switch is now off.** Doctor **fails** with `automation:legacy-kill`. | Run `yad kill --reason "<why>"`, then delete the old line. |
| **The BMAD folder is no longer used** | BMAD is the agent framework that 3.x was packaged for. 4.x reads `.sdlc/config.yaml`, not `_bmad/sdlc/`. | Copy any value you changed into `.sdlc/config.yaml`, then delete `_bmad/sdlc/`. Fix the kill switch first if you have one. |
| **The reviewer roster is removed** | `yad roster` is gone. One approval from anyone with access (not the author) passes a team gate. Reviewers are no longer added to PRs automatically. | Request reviewers on the PR yourself. **Do not delete the `roster` key until doctor says it is safe** (see section 6). |
| **The author allowlist is removed** | The `verified-commits` check now looks only at signatures. ⚠️ **A signed commit from anyone with write access now passes CI.** | If you used the list to keep people out, use your GitHub or GitLab access settings instead. |
| **`--json` output changed** | Every command prints one shared JSON format (`jsonVersion`, `version`, `command`, `ok`, `warnings`). Some names changed (`hub` → `product`). | Update any script that reads `yad … --json`. |
| **Hooks are Node scripts now** | The agent hooks were `hooks/*.sh`. They are now `.mjs` files run with `node`, so they also work on Windows. | Handled by steps 6–9 in section 3. A hook you edited by hand is left in place. |
| **A failed docs build now stops** | `yad docs build` and `yad docs deploy` exit with code 1 when the build fails. | Any script that ignored those failures will now stop. |
| **Approvals are fingerprinted differently** | The fingerprint of an approval (the hash of what was approved) no longer includes the `status:` line. A 3.x `yad` sees new approvals as out of date. | Another reason to upgrade the whole team together. |
| **New commands: `yad undefer` and `yad defer --debt`** | An older `yad` misreads an epic where these were used. | Use them only after everyone has upgraded. |

---

## 6. How to read the output of `yad doctor`

### 6.1 What the summary line means

| Summary | Meaning |
|---|---|
| `healthy` | Nothing failed. |
| `healthy with N warning(s)` | Nothing failed, but N items are worth a look. **Many of them may need no action.** |
| Anything with `fail` | Something is broken. Fix every `fail` before anything else. |

### 6.2 Step 1 — Group the warnings by code

A long list is hard to read. This command runs `yad doctor` in JSON form, groups the warnings by code,
and prints the count and the hint for each group:

```bash
yad doctor --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const g={};for(const c of j.checks.filter(c=>c.status==="warn"||c.status==="fail")){(g[c.status+"  "+c.id]??=[]).push(c)};for(const[id,l] of Object.entries(g))console.log(l.length+"x  "+id+"\n     "+l[0].message+"\n     hint: "+(l[0].hint||"-"))})'
```

Codes that end in an epic name (for example `shape:EP-login`, `shape:EP-search`) are the same warning for
different epics. Treat them as one group.

### 6.3 Step 2 — Put every group into one of five buckets

| Bucket | What it means | What you do |
|---|---|---|
| **A. Fix now** | Anything with `fail`, or a warning that says a safety check is off. | Fix it before anything else. |
| **B. One command fixes it** | Old copies of files that yadflow installed. | Run the command the hint names (`yad update`, `yad check --fix`, `yad migrate --apply`). |
| **C. Nothing to do** | CI or the next review will fix it on its own. | Nothing. It clears over time. |
| **D. Keep for now** | Old data that still has a job for a while. | Leave it. Check again later. |
| **E. Safe to clean up** | Old settings that nothing reads any more. | Delete when convenient. |
| **F. Look into it** | Something about one epic or one file. | Read the hint and check the file. |

### 6.4 Step 3 — Look up each code

This table lists the codes that most often appear after a 3.x → 4.x upgrade.

| Code | Bucket | What it means | What to do |
|---|---|---|---|
| `automation:legacy-kill` (**fail**) | A | Your old kill switch is no longer read, so it is **off**. | `yad kill --reason "<why>"`, then remove the old line. |
| `checks:backfill-blind` | A | An old `backfill-check.sh` that a PR can get around. `yad check --fix` does **not** update this file. | Copy `skills/yad-backfill/templates/checks/backfill-check.sh` over it by hand. |
| `people:allowlist-gate-stale` | B | An old `verified-commits.sh` that still checks the author list. | `yad check --fix` |
| `checks:rename-blind`, `checks:symlink-blind`, `checks:product-path-blind`, `checks:product-record-blind` | B | Old copies of the check scripts, with known gaps that let a PR pass when it should not. | `yad check --fix`. A copy you edited by hand is not touched: compare it with the template in `skills/yad-checks/templates/checks/`. |
| `cli-version` | B | Your project is marked with an old version. | `yad update` |
| `renamed:…yad-hub-bridge` | B | A skill under its old name (`hub` → `product`). | `yad update` |
| `hooks`, `git-hook`, `capture` | B | The agent hooks or the git pre-commit guard are missing or old. | `yad check --fix`, commit, then `yad check --fix` again. |
| `repos:product-link-missing` | B | A code repo has no record of where the Product is. | `yad check --fix --push`, or commit the file through a PR. |
| `repo:<name>` "stale" | B | The cached summary of a code repo is out of date. | `yad repo refresh <name>` |
| `shape` (project) | B | The migration has not run. | `yad migrate`, then `yad migrate --apply` |
| `shape:<epic>` with "nothing to run — in verified mode CI owns these files" | C | One CI-owned file per epic is still in the old shape. | Nothing. CI updates it on the next review of that epic. |
| `shape:<epic>` **without** that hint | B | The migration has not run on this epic. | `yad migrate --apply` |
| `index` "not been built yet" | C | The search index (`.sdlc/index.json`) does not exist yet. | Nothing. CI builds it on the next merged review. |
| `people:roster-unused` with "keep it for now" | D | Old records still name people by their roster name. The roster is the only link from those names to logins. | **Do not delete the roster.** CI replaces the names with logins epic by epic, on each new review. Delete the `roster` key only when the hint says "no older record needs it any more". Then run `yad migrate --apply --keep product`. |
| `people:roster-unused` with "no older record needs it" | E | The roster is no longer needed. | Delete the `roster` key, then `yad migrate --apply --keep product`. |
| `people:domain-owners-unused` | E | `domain_owner(s)` keys in `.sdlc/repos.json` that nothing reads. | Delete those keys. |
| `people:verified-authors-unused` | E | The old author list, in the settings and in `.sdlc/verified-authors` files. | Delete `verified_authors` from `.sdlc/product.json`, run `yad migrate --apply --keep product`, then delete each `.sdlc/verified-authors` file. **Read the allowlist warning in section 5 first.** |
| `module:legacy-bmad` | E | The old `_bmad/sdlc/` folder. | Copy any value you changed into `.sdlc/config.yaml`, then delete the folder. |
| `epic:<epic>:<step>:stale` | F | A step is done, but its files changed **after** they were approved. | Run `git log -- <path to that epic's artifact>` to see what changed. If the change is real, open a new review PR so the current version gets approved. |
| `mode:suggest-team` "could not be counted" | F | yadflow could not count the people on the project. The reason is in brackets (for example a `build-log.json` with no `ships` list). | Check the named file or repo. This only affects a suggestion, never a gate. |
| `mode:suggest-team` (with a count) | F | You are in solo mode, but more than one person seems to work here. | `yad mode team` if that is true. Otherwise leave it. |
| `learning` "CLI is not confirmed" | F | A learning tool is recorded, but its program is not confirmed. | Run the `yad-connect-learning` skill in your AI agent, or ignore it if you do not use the tool. |
| `codeowners:<repo>`, `protection:<repo>` | F | yadflow cannot tell whether a repo is on GitHub or GitLab, so it cannot check it. | Set `platform` with `yad repo connect` (code repo) or `yad setup` (Product). |

If a code is not in this table, read its hint. The full list of codes is in
[docs/CLI.md](../CLI.md#troubleshooting-yad-doctor--error-codes).

### 6.5 Step 4 — Fix, then run doctor again

Work through the buckets in the order **A → B → E → F**. Run `yad doctor` after each fix. The count
should go down. Buckets C and D clear on their own over time.

---

## 7. A worked example from a real upgrade

**The project:** a Product with a verified ledger, three code repos and about 30 epics, upgraded from
3.13.1 to 4.1.0.

**Doctor said:** `healthy with 39 warning(s)`.

**After grouping (section 6.2) and sorting (section 6.3):**

| Bucket | Warnings | Codes | Action taken |
|---|---|---|---|
| C. Nothing to do | 32 | 31 × `shape:<epic>` ("CI owns these files"), 1 × `index` | None. CI clears them on each epic's next review. |
| D. Keep for now | 1 | `people:roster-unused` — 41 old records in 20 epics still used roster names | Roster kept. Delete later, when the hint says so. |
| E. Safe to clean up | 3 | `people:domain-owners-unused`, `people:verified-authors-unused`, `module:legacy-bmad` | Delete the old keys and files, through a PR. |
| F. Look into it | 3 | 1 × `epic:<epic>:stories-review:stale`, 1 × `mode:suggest-team` (a `build-log.json` with no `ships` list), 1 × `learning` | Check what changed after approval; check the build log; connect or ignore the learning tool. |

**What we learned:**

- **39 warnings looked alarming, but 32 needed nothing.** Grouping by code turned 39 lines into 10
  decisions.
- **On a verified ledger, `shape:<epic>` warnings are expected after a migration.** The hint says so.
  Running `yad migrate --apply` again does not clear them, and must not, because CI owns those files.
- **"Unused" does not always mean "delete now".** The roster was unused for approvals, but it was still
  the only link from old names to logins.
- **No bucket A or B items were left**, which showed that steps 5–10 in section 3 had all worked.

---

## 8. How to undo the upgrade

- `yad migrate --apply` saved every file it changed as `<file>.yad-orig`. To undo, move each backup
  back over its file, then reinstall the old version: `npm install -g yadflow@<old version>`.
- ⚠️ **Do not go back to 3.x without restoring the backups first.** An old `yad migrate` refuses
  new-shape files, and an old `yad doctor` fails on them. Other commands still run, but they read the
  new values wrongly.
- Once `yad doctor` shows no bucket A or B items and the team has worked on 4.x for a while, you can
  delete the `.yad-orig` files.
- For a bug report, attach the output of `yad doctor --json` and of the `yad migrate` preview. Neither
  one contains the content of your epics. You can also run `yad report`, which removes private data
  before it files an issue.

---

## 9. Rules for AI agents

If you are an AI agent helping with this upgrade, follow these rules.

1. **Preview before you write.** Run `npx yadflow@latest migrate` (no `--apply`) and show the user the
   output before you run `yad migrate --apply`.
2. **Never hand-edit the ledger on a verified Product.** `state.json`, `approvals.json` and
   `comments.json` under any epic's `.sdlc/` belong to CI. Do not "fix" a `shape:<epic>` warning whose
   hint says CI owns the file.
3. **Group doctor's output before you answer.** Use the command in section 6.2. Report counts per
   bucket, not 39 separate lines.
4. **Follow the hint text, not just the code.** The same code can need different actions. For example,
   `people:roster-unused` says "keep it for now" or "delete it", depending on the hint.
5. **Do not delete the `roster` key** while its hint says "keep it for now".
6. **Before you delete the author allowlist, warn the user** that a signed commit from anyone with write
   access will then pass CI.
7. **Ask before you push.** `yad check --fix --push` commits and pushes to the default branch of every
   code repo. Get the user's approval first.
8. **Check every `fail` first**, especially `automation:legacy-kill`. A kill switch that the user thinks
   is on may actually be off.
9. **Never commit `.yad-orig` files.**
10. **Check which `yad` runs.** With several Node versions installed, run `which yad` and
    `yad --version` before you trust a result.
11. **Do not put private data in bug reports.** Use `yad report`, which sends only a safe, fixed list of
    facts. Never paste epic names, repo names, logins or paths into a public issue.

---

## 10. Final checklist

- [ ] Every person on the team runs `yad --version` and sees 4.x.
- [ ] `yad doctor` shows no `fail`.
- [ ] No bucket A or B warnings are left.
- [ ] Your own CI files no longer use `hub`, the old name.
- [ ] The kill switch, if you used one, is set again with `yad kill`.
- [ ] The old `hooks/*.sh` scripts are gone (or you knowingly kept an edited one).
- [ ] Each code repo has `.sdlc/product-link.json` on its default branch.
- [ ] Bucket E clean-up is done, or planned.
- [ ] A reminder is set to run `yad doctor` again after the next few reviews, to see buckets C and D go
      down — and to delete the `roster` key when its hint says so.
