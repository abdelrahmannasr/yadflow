# Upgrading from 3.x to 4.0

**Who this page is for:** anyone whose project was set up with yadflow 3.x. The last 3.x release on
`latest` (the version a plain `npm install` gives you) is **3.18.1**. A 3.18.1 project is on **file
shape 1**.

**What a "shape" is:** the layout of the files yadflow writes into your project. Every one of them
carries a `"schemaVersion"` number saying which layout it uses. A file with no number counts as 1.
yadflow 4.0 writes **shape 10**.

**What this page does:** it gives the order to run things in, one line for each shape page, and every
other breaking change since 3.18.1 with the page that explains it. For a hands-on walk-through — the
order to work in, and how to sort the warnings `yad doctor` prints afterwards — see the
[step-by-step upgrade guide](upgrade-guide-3x-to-4x.md). A **breaking change** is a change
that can stop something that worked on 3.x — a script, a CI setting, a habit — from working the same
way on 4.0.

---

## The short version

Run these in your Product (the git repo that holds your epics, their reviews and the project
settings; its old name: `hub`):

```bash
npm install -g yadflow   # the latest release
yad migrate              # preview — writes nothing
yad migrate --apply      # rewrites, backing up every file it touches as <file>.yad-orig
yad update               # refreshes the files yadflow installed in each repo
yad doctor               # says what is left
```

Then commit the results.

- **One `yad migrate --apply` takes a 3.18.1 project from shape 1 to shape 10 in one run.** You do not
  run one migration per shape.
- **Run the preview first.** It prints one line per file and does not touch your project.
- **Upgrade everyone on the project together.** From shape 7 on, a value changes in place, and a 3.x
  engine cannot read a migrated project correctly (see [shape 7](shape-7.md)). Shapes 9 and 10 add their
  own reasons (see below).

### If your Product uses a verified ledger

**What a verified ledger is:** a Product where CI is the only writer of the review records (the files
under each epic's `.sdlc/`), with a platform-Verified signature. `.sdlc/product.json` (`.sdlc/hub.json`
on 3.x) says `"ledger": "verified"` — or, on 3.x, `"bridge_enabled": true` with a `platform`.

On such a Product, `yad migrate` does not touch the files CI owns (`state.json`, `approvals.json`,
`comments.json` and the review PR list). So there are three things to do, not one:

1. Run `yad migrate --apply`, and commit the result. It stamps every file CI does not own — the
   Product settings and `.sdlc/cli-version.json` among them.
2. Run `yad update`, and commit the result. That makes the gate workflow (the CI job that records
   reviews) run 4.0. Read [shape 9](shape-9.md), "What to do", for how the workflow picks its version and
   what to do with an old `gate_sync_version` pin.
3. Wait. CI brings each epic's `state.json` up to date the next time it writes it. There is nothing to
   run for that.

If the project has an `epics/EP-discovery/` folder, CI also moves it to `foundation/` on a later merged
review, once the checks committed in your repo are from 4.0. [Shape 8](shape-8.md) says when it waits.

---

## Every shape, in one line each

| Page | What changes for you |
|---|---|
| [Shape 2](shape-2.md) | The Product settings gain `"ledger": "verified" \| "local"`, which says who writes the review records. `bridge_enabled` is kept beside it. |
| [Shape 3](shape-3.md) | `.sdlc/hub.json` gains a second name, `.sdlc/product.json`, and 4.0 reads the new name first. Both are written until 5.0. |
| [Shape 4](shape-4.md) | Each step's two dials get their real names: `assistance` → `driver`, `automation` → `advance`. Both names are written. |
| [Shape 5](shape-5.md) | Every work item gets a `type` (`feature`, `change`, `defect`, `hotfix`, `chore`), written beside `kind`. |
| [Shape 6](shape-6.md) | Each epic records its **profile** — the route it walks through the lifecycle (`classic`, `analysis-first`, `discovery`). |
| [Shape 7](shape-7.md) | A step's `status` gets seven fixed words, with a record of why. **Values change in place: a 3.x engine cannot read the result.** |
| [Shape 8](shape-8.md) | The product level moves from `epics/EP-discovery/` to `foundation/` and is called the **Foundation**. |
| [Shape 9](shape-9.md) | An approval's fingerprint (the hash that says what was approved) leaves out the frontmatter `status:` line. An older yadflow reads new approvals on such a file as stale. |
| [Shape 10](shape-10.md) | A deferred step can come back after later work has finished, and `yad defer --debt` marks a deferral as owed. |

---

## Every other breaking change since 3.18.1

These are not file shapes, so `yad migrate` does not handle them. Each one says what to check.

| Change | What it means for you | Where it is explained |
|---|---|---|
| **Every `--json` answer is one envelope (E1)** | A command run with `--json` prints one object with the same top-level keys every time: `jsonVersion`, `version`, `command`, `ok` and `warnings` (always present), and on a refusal `error`, `code` and `hint`. `yad history --json` says `jsonVersion` where it said `schemaVersion`. A script that read the old per-command formats must be updated. | [docs/CLI.md](../CLI.md), "`--json` on every command (E1)" |
| **`--json` names: `hub` → `product`, and `jsonVersion` is 2 (E124)** | For example, `yad doctor`'s check id `hub` → `product`, and `yad open-pr` now answers `baseSource: "product"`. The audit commits now start `chore(product): …`, so a script that searches the git log should match both the old and the new subject. | [hub-to-product.md](hub-to-product.md), sections 9 and 10; [docs/CLI.md](../CLI.md), "What moved in `jsonVersion` 2" |
| **`hub` → Product (E122, E123, E124)** | 4.0 reads `.sdlc/product.json` first. Two copies that say different things make every command refuse (`YAD-STATE-008`) until `yad migrate --apply` settles them. `yad update` renames the installed CI files, jobs and skill (`yad-hub-checks.yml` → `yad-product-checks.yml`, `yad-hub-bridge` → `yad-product-bridge`). Your own CI files that name an old name must be changed by hand. | [hub-to-product.md](hub-to-product.md) |
| **The reviewer roster is removed (E62)** | `yad roster` is gone, and `yad setup` no longer asks for reviewers or repo owners. One approver holds a team gate; the owner/reviewer/domain-owner rule no longer does. Approvals name the platform login. Review and task PRs no longer request reviewers. `yad usage --json` members carry no `role` or `rostered`. The ROUTE line printed by `risk-route.sh` and `product-route.sh` changed. `yad doctor` names a leftover roster as unused (`people:roster-unused`) and never deletes it. | [docs/CLI.md](../CLI.md), "The PR-driven review gate" |
| **The author allowlist is gone (E62)** | The `verified-commits` check now checks signatures only. Once the refreshed check is in a repo, **a Verified commit from an email nobody listed passes CI**. If you relied on the list to keep people out, use your platform's access settings instead. `yad doctor` warns about an older check that still enforces the list (`people:allowlist-gate-stale`) and about a list nothing reads (`people:verified-authors-unused`). | [docs/CLI.md](../CLI.md), the `yad doctor` row |
| **yadflow is no longer a BMAD module (E3)** | BMAD is an agent framework that 3.x was packaged for. `yad setup` and `yad update` now install the module config to `.sdlc/config.yaml`, not `_bmad/sdlc/`, and the skills no longer call BMAD personas. Nothing reads `_bmad/sdlc/` any more. `yad doctor` warns `module:legacy-bmad`: copy any value you changed into `.sdlc/config.yaml`, then delete `_bmad/sdlc/`. A BMAD install's own `_bmad/` is not yadflow's and is left alone. | [docs/CLI.md](../CLI.md), the `module:legacy-bmad` row of the doctor codes |
| **The kill switch moved, and automation is no longer earned (E34)** | The **kill switch** holds every step at a person. It now lives in `.sdlc/automation.json`, set with `yad kill --reason "<why>"` and cleared with `yad unkill`. **`kill_switch: true` in `_bmad/sdlc/config.yaml` is no longer read**, so a switch you set there is now **off**. `yad doctor` **fails** on it (`automation:legacy-kill`): run `yad kill` first, then remove the old line or the folder. The team now sets each step's advance dial with `yad dial`; the run record is shown as advice, never as a lock. A Shape step's dial lives in `.sdlc/automation.json` and is recorded, not acted on yet. A review gate is always a person. | [docs/CLI.md](../CLI.md), the `yad dial` row and the `automation:legacy-kill` row |
| **`yad undefer` works late, and a deferral can be debt (E41)** | This is shape 10. An older yadflow misreads a chain with a step re-opened behind finished work, so upgrade everyone before using `yad undefer` late or `yad defer --debt`. | [Shape 10](shape-10.md) |
| **The agent hooks are Node scripts, not shell scripts (E113)** | The hooks that guard the review records and snapshot drafts were `hooks/*.sh`. They are now `hooks/ledger-guard.mjs`, `hooks/ledger-guard-cursor.mjs` and `hooks/yad-capture.mjs`, run with `node`, so they work on Windows without WSL. `yad update` (and `yad check --fix`) rewrites each hook entry that still names an old script and installs the new ones. It deletes an old `hooks/*.sh` only when yad's record of its files (`.sdlc/managed.json`) proves yad wrote it unedited and no settings file — as committed — still runs it. So run `yad update`, commit, and run it again; the second run removes the old scripts. An edited copy is yours and is left in place. | [docs/CLI.md](../CLI.md), "Managed files: what `yad` owns, and what you edited" |
| **A failed docs build exits 1** | `yad docs build`, `yad docs deploy` and `yad docs sync --refresh` now exit 1 when a site's `npm install` or build fails, or when a site named with `--epic` / `--overview` was never generated. `yad docs build` also exits 1 when `npm` is not on the PATH. A script that ignored build failures will now stop. | [docs/CLI.md](../CLI.md), the `--json` table row for `yad docs` |
| **An approval's fingerprint leaves out the `status:` line (shape 9)** | A 3.x yadflow reads every new approval on a file with a `status:` line as stale. On a local ledger a mixed team can get stuck. | [Shape 9](shape-9.md) |

---

## If something goes wrong

- `yad migrate --apply` copies every file it rewrites to `<file>.yad-orig` first. To undo it by hand, move
  those back. Each shape page shows the command.
- **Do not go back to a 3.x release without restoring those backups first.** An older `yad migrate`
  refuses a file from a newer shape, and an older `yad doctor` fails on it. Other commands still run, but
  they read only the fields they know — and from shape 7 on, they misread values that changed in place.
- For a bug report, attach `yad doctor --json` and the output of the `yad migrate` preview. Neither
  contains the contents of your artifacts.
