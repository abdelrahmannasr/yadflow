---
name: yad-connect-repos
description: 'Connects code repos to the Product so the front/"brain" phases are code-aware. Registers N code repos (GitHub or GitLab, local-user auth, no stored tokens) into the project-wide .sdlc/repos.json, then caches an AI-readable picture of each — a compressed Repomix pack and a lightweight code-map (existing endpoints/events/data-models/modules), secret-scanned. Run at one-time setup or any time a new repo is added. Reusable, idempotent, refreshable; staleness is tracked by HEAD sha. `yad repo refresh --push` publishes the refreshed code-maps + registry to the Product default branch as a chore(product): sync code-context [skip ci] audit commit. Also drafts each code repo''s risk map (.sdlc/risk-map — a level per directory, no names), classified by reading the code and marked guessed for a person to confirm. Use when the user says "connect a repo", "connect the code repos", "refresh the code context", "list connected repos", or "push the code-map refresh".'
---

# SDLC — Connect Code Repos (make the brain code-aware)

**Goal:** Give the front/"brain" phases (`yad-epic` → `-architecture` → `-ui` → `-stories`)
full context about what **already exists** in the code, so the AI does not author a contract, UI, or
stories that contradict or duplicate what is built. This skill **connects** code repos to the Product and caches an AI-readable picture of each. It is the product → code half of the 2-way link (the
code → product half is the existing `link.md` back-pointer each spec carries).

This is **setup/maintenance**, not a gated Shape step — it never touches `.sdlc/state.json` or any
epic's approvals. It writes the project-wide registry, the per-repo context cache, and — in the code
repo itself — a draft of that repo's risk map (Step 3b), which the team commits there through a PR.

## When a tool is missing

<!-- Written from yadflow's cli/toolbox.mjs (E87). Change the words there: a test holds this section to it. -->

No tool below is required. When one is missing, this skill still finishes, using the fallback written
beside it.

For the tool without "a connector" beside it, decide from yad's answer, not from a guess: run
`yad toolbox list --json` and read, in its `tools` list, the entry with the tool's `id`. Run it where
the tool will run: for work inside a code repo, add `--dir <that repo>`, so the tools installed there
are found.

- **The team's choices.** They come from the Product. If the answer's `product` is null, yad found no
  Product, so a tool the team chose not to use still shows `used: true`. Tell the person that.
- **When yad cannot see the tool.** yad does not read every way a tool can be set up (an older install
  may be missed). If the entry says `missing` but the check in the steps below finds the tool, use
  it — but never when the entry says `used: false`.
- **When yad cannot answer** (yad is not installed here, or the command fails), use the check in the
  steps below.

Tell the person which tools you used and which fallbacks, and why.

- **Repomix** (`repomix`). Use it when its entry has `used: true` and `status.state` is `installed` or `available`. Otherwise — not found, its plugin turned off in Claude Code, or the team chose not to use it (`yad toolbox remove repomix`) — use the fallback.
  - Fallback — no Repomix pack. yad-connect-repos and yad-backfill put the same context together by hand, from the source tree and the recent git log, and the Shape steps read the code map.
  - Record `source: repomix-unavailable`. It means the tool was not used, whatever the reason.

## Conventions

- `{project-root}` resolves from the project working directory (the **Product**).
- The **product repo is where the Shape phase toolchain runs** (`config.yaml` `code_context`): Repomix (and
  Impeccable, later) are installed/run **here** and target the connected code repos **by path**. The
  code repos themselves need no install for this. (The Build CI gates are the exception — they
  live inside each code repo; see `yad-checks`.)
- **Repomix is a true CLI subprocess** (Phase 0 / RESEARCH-NOTES §3): `npx repomix@latest [flags]` —
  NOT a slash-command. It secret-scans by default (Secretlint).
- Registry: `{project-root}/.sdlc/repos.json` (project-wide, shared across all epics — NOT per-epic).
- Per-repo cache: `{project-root}/.sdlc/code-context/<repo>/` holds `pack.md` + `code-map.md`.

## Inputs

- `action` — `connect` | `refresh` | `list` | `disconnect` | `detect-product` (default `connect`; `detect-hub`, the old name, still works).
- `repo` — the repo's short name (the key used in stories' `repos:` tag, e.g. `backend`).
- `path` — local path to the code repo (relative to `{project-root}` or absolute). For local repos.
  It must resolve inside the **workspace** — the project root's parent — so the standard layout, where
  the code repos sit **beside** the Product rather than under it, registers as `../backend`:

  ```text
  project/          <- the workspace (containment boundary)
    product/        <- the Product repo; `yad setup` runs here
    backend/        <- ../backend
    frontend/       <- ../frontend
  ```

  A nested path (`demo-repos/api`, the demo layout) also works. A path that escapes the workspace
  (`../../elsewhere`, or an absolute path outside it) is rejected and skipped — the registry path is
  later used as a working directory (repomix) and written into (`.coderabbit.yaml`, CI wiring).
  It is stored **exactly as typed**; every consumer re-resolves it against the project root.

  The workspace is the trust boundary, so **put the Product one level below it** (`project/product`), not
  directly in `$HOME` — with the Product at `~/product` the workspace becomes `~` and every home-dir
  sibling turns into a registrable repo. The workspace directory itself (`..`) is never registrable.
- `git_url` — optional remote (SSH or HTTPS; GitHub or GitLab). Used when the repo is not yet on disk.
  `yad join` and `yad repo clone` clone only a network address (`https://`, `http://`, `ssh://`,
  `git://`, `user@host:path`, or an ssh alias `host:path`); a local path is refused unless
  `YAD_ALLOW_LOCAL_REMOTES=1` is set, and then only a folder that exists outside the workspace.

yadflow keeps **no list of people** (E62): no roster, no roles, no repo owners, no commit emails. Do not
ask for them and do not write them.

## On Activation

### Step 1 — Resolve the repo and its auth (GitHub + GitLab, local user)
Determine where the code is:
- If `path` is given and is a git repo (`.git` present) → use it in place.
- A teammate joining an existing Product gets every registered repo cloned at its recorded `path` by
  `yad join <url>` (E79) — no need to clone them one by one here.
- A repo that is **already registered** but missing on this machine (a teammate registered it after you
  joined) → run **`yad repo clone [<name>]`** (E81). It clones at the recorded `path`, with the same
  checks as `join`, and never touches a repo that is already there. `yad repo list` and `yad doctor`
  name such a repo as not cloned. Clone by hand only a repo that is **not registered yet**.
- Else if `git_url` is given (a repo not registered yet) → **clone it as the local user** into a working location
  (`{code_repos_root}/<repo>/` by `config.yaml` `build.code_repos_root`, or a path the user names):
  ```
  git clone <git_url> <dest>
  ```
  Authentication is **the local user's own** — SSH keys or the git credential helper already on this
  device. This works identically for **GitHub and GitLab** (and self-hosted instances); the skill
  **stores no tokens**. If `gh`/`glab` are installed and authenticated they may be used, but plain
  `git` over the user's credentials is the baseline. If the clone/fetch fails on auth, STOP and tell
  the user to authenticate (`gh auth login` / `glab auth login` / add an SSH key) — never embed a token.
- Detect the platform from the URL host: `github.com` → `github`, `gitlab.com`/self-hosted GitLab →
  `gitlab`; record it as `platform`. A local-only repo with no remote records `platform: null`.

### Step 2 — Pack the repo (Repomix, the full cached context layer)
From the code repo, run (flags from `config.yaml` `code_context.pack_flags`):
```
npx repomix@latest --compress --include-logs --style markdown -o {project-root}/.sdlc/code-context/<repo>/pack.md
```
`--compress` (Tree-sitter structural compression) keeps it small and signal-dense; `--include-logs`
adds recent git history; Secretlint secret-scans by default. **If a secret is reported, STOP and have
it redacted before any AI reads the pack.** Pack the whole repo, or the source boundary from the
project's constitution if one is defined. (If Repomix is not used — see **When a tool is missing** — degrade: hand-assemble the
same context — the repo's source tree + recent git log — and record `source: repomix-unavailable`.)

### Step 3 — Build the code-map (the lightweight index layer)
Feed the pack to the AI with the **"describe what exists, do not invent"** instruction
(`references/code-context.md`) and write `{project-root}/.sdlc/code-context/<repo>/code-map.md`: a small
index of **stack/conventions, entry points, public endpoints/APIs, events, data models/entities, and
module layout**. Mark anything unclear `<!-- unverified: ... -->`; never fill gaps with invented
behaviour. This is the cheap artifact every Shape phase loads by default (the full pack is read only
when a phase needs depth).

### Step 3b — Draft the risk map (a level per directory, from the code)
Each code repo keeps `.sdlc/risk-map` **in the code repo**: one line per directory saying `high`, `medium`
or `low`, and **no names** (E65). Format, rubric and edit rules: `references/risk-map.md`.

1. Run `yad risk-map draft <path>` with the repo's **path**, not its name: on a first `connect` the repo is
   not in `repos.json` until Step 4, and a name it does not know is refused. It adds an `unset` line for
   every directory no line covers and never changes a line that is already there.
2. For every `unset` line, **read the code in that directory** — the pack, the code-map, and the files
   themselves when those do not say — and decide the level by the rubric. Judge by what the code does,
   never by the folder's name — with one exception, `.sdlc/`, which is `high` because it holds the risk
   map (see the rubric). Write the level, `guessed`, and a one-line reason from the code
   (`src/payments/  high  guessed  # charge.js calls the card processor`). When unsure between two levels,
   choose the higher one. When a directory's parts differ, add a deeper line for each part.
3. A `guessed` line may be re-levelled if the code says otherwise — except `.sdlc/`, which is raised to
   `high` if it is not (the rubric's one exception). **Never edit, re-level or delete a `confirmed` line**:
   when the code now contradicts one, report it as a suggestion for a person. Never mark anything
   `confirmed` — only a person does that. Write no name, secret or customer value.
4. Run `yad risk-map check <path>` and report what is left.
5. Tell the person to review every `guessed` line, change the right ones to `confirmed`, and commit
   `.sdlc/risk-map` **in the code repo, on a new branch, through a PR** — never straight to its default branch. Its `risk-map` check warns on that PR that the map
   was edited — expected, and advisory.

With no AI agent available, stop after step 1 and tell the person the `unset` lines are theirs to fill.

### Step 4 — Record the repo in the registry
Upsert the repo into `{project-root}/.sdlc/repos.json` (create the file if absent). Record the current
HEAD sha as `syncedHead` (this drives staleness):
```json
{
  "repos": [
    {
      "name": "<repo>",
      "path": "<path rel. to project-root>",
      "git_url": "<url or null>",
      "platform": "github|gitlab|null",
      "default_branch": "<branch>",
      "connectedAt": "<YYYY-MM-DD>",
      "lastSyncedAt": "<YYYY-MM-DD>",
      "syncedHead": "<git HEAD sha at pack time>",
      "contextPack": ".sdlc/code-context/<repo>/pack.md",
      "codeMap": ".sdlc/code-context/<repo>/code-map.md",
      "source": "repomix"
    }
  ]
}
```
`connect` is **idempotent** — re-running it for an existing repo refreshes its entry in place. Adding a
new repo later is the same `connect` action. Write no `domain_owner`/`domain_owners`; an entry an older
release wrote with them is left as it is (nothing reads them, and `yad doctor` warns
`people:domain-owners-unused`).

### Step 5 — Report
Report the connected repo, its `platform`, the pack + code-map paths, the secret-scan result, and that
the Shape phases will now load this repo's code-map. Nothing auto-advances; this is setup.

## Other actions

- **`refresh`** — re-run Steps 2–4 (including Step 3b) for an already-connected repo (after its code moves). A new directory gets an `unset` line and a guess; a `confirmed` line is only ever suggested against. Updates
  `syncedHead` + `lastSyncedAt`. Same machinery as `connect`. Once the AI has regenerated the
  `code-map.md` (Step 3), publish it to the Product with **`yad repo refresh <repo> --push`**: it
  commits the tracked code-maps + `.sdlc/repos.json` (never the gitignored `pack.md`) as one
  audit-trail commit `chore(product): sync code-context — <repos> by @<login> [skip ci]` and pushes it
  straight to the Product's **default branch** (add `--allow-branch` to commit on a non-default branch).
  This is the code-context analogue of `yad checkpoint` — human-owned machine state, no Task trailer,
  no Co-Authored-By.
- **`list`** — print every registry entry with a **fresh/stale** flag: compare each repo's current HEAD
  (`git -C <path> rev-parse HEAD`) to its `syncedHead`; differ ⇒ **stale** (suggest `refresh`).
- **`disconnect`** — remove the repo from the registry and delete its cache dir. Leaves the **code repo
  itself untouched**.

## Product detection (the Shape review bridge)

The Product is itself a git repo on a platform. This action records that so the Shape review/comment/
approval cycle can run through a real PR/MR on the Product (`yad-review-gate` + `yad-product-bridge`). It
writes only `{project-root}/.sdlc/product.json` and its older name `.sdlc/hub.json` (`config.yaml` `product.config` (older projects: `hub.config`)) — never an epic's state/approvals.

- **`detect-product`** — detect the Product's own platform and upsert the Product settings: read
  `.sdlc/product.json` (`.sdlc/hub.json` on an older Product that has only that name), then write
  `.sdlc/product.json` and copy it byte for byte to `.sdlc/hub.json` (`cp .sdlc/product.json .sdlc/hub.json`;
  both until v5 — two that differ by even a space are refused, YAD-STATE-008 — E122). Run
  `git remote get-url origin` **on the Product** and read the host with the SAME logic Step 1 uses for code
  repos: `github.com` → `github`, GitLab host → `gitlab`, no remote → `platform: null`. Record
  `git_url`, `default_branch`, `detectedAt`, and **all three of** `ledger`, `bridge_enabled` and
  `bridge`:

  | a platform was detected | no platform (`platform: null`) |
  |---|---|
  | `"ledger": "verified"`, `bridge_enabled: true`, `bridge: true` | `"ledger": "local"`, `bridge_enabled: false`, `bridge: false` |

  Write no `roster`. Leave any other key already in the file as it is — including a `roster` or
  `verified_authors` an older release wrote. Neither decides anything (the roster's name → login pairs
  only help the first sync recognise older approvals); `yad doctor` warns
  `people:roster-unused` / `people:verified-authors-unused`, and nothing deletes them.

  **`ledger` is the one that decides.** `isVerifiedLedger` (`cli/manifest.mjs`) reads it first and
  falls back to the booleans only when it is absent — so on a project that has already run
  `yad migrate`, writing `bridge_enabled: true` while leaving `"ledger": "local"` in place turns
  verified mode ON in the file and OFF in the engine. Nothing would be wired, no guard would arm,
  and the report would say it worked. Write all three, and keep them saying the same thing.

  The booleans are still written because a check gate committed in the repo may predate
  `yad update`; see `docs/migrations/shape-2.md`.

  A platform and a verified ledger travel together: verified mode is a platform AND the switch
  (`isVerifiedLedger`, `cli/manifest.mjs`), and `yad setup` derives both from one value, so marking a
  platform-less Product verified creates a state no CLI path can produce and the gates read
  differently (#186).
  Auth is the local user's own `gh`/`glab`/git; **store no tokens**. Idempotent — safe to re-run.

There is **no roster action** (removed in E62). `yad roster` is gone too: typing it prints a notice and
exits 1. A team gate needs 1 approval from someone other than the author, and each approval records the
platform login that gave it. The platform, not a stored list, decides who can approve.

If the Product has no remote (`platform: null`) or the verified ledger is disabled, the Shape gate runs
local with no error — the verified ledger is purely additive.

## The Product-link record (E120)
Each connected code repo also carries `.sdlc/product-link.json` — the Product's `git_url`, the `path`
where CI checks the Product out (`.yad/product` by default) and its `default_branch`. It is not written
here: `yad setup`, `yad check --fix` and `yad update` write it (from the Product's own settings, with
any user name or password taken out of `git_url`) into every connected repo, and `--push` commits it
to each repo's default branch — a record on disk that is not committed as it stands is committed by the
next `--push`, though `yad check` reads it as `ok`. The Product-reading gates read it from
the base; `checks/product-checkout.sh` uses it with the `YAD_PRODUCT_TOKEN` secret. After connecting a
repo, run `yad check --fix --push`; `yad doctor` warns `repos:product-link-missing` until it is on
the repo's default branch.

## Live on-demand (the third context layer)
The cached pack + map are the default. When a Shape phase needs an **area** not in the map, it may
re-run Repomix **live**, scoped to that area:
```bash
npx repomix@latest --compress --include "<area globs>" --style markdown -o -
```
Same CLI, invoked ad hoc — no registry write. A **stale repo** (HEAD ≠ `syncedHead`) is different: the
phase **flags it and stops**, pointing the human at `yad repo refresh <repo>` (or `yad check --fix`) —
it does not silently re-pack. Refreshing the cache is a human decision. Documented in
`references/code-context.md`.

## Hard rules

- **Local-user auth only; store no tokens.** Clone/fetch as the user running the command; never embed
  credentials in the registry. Works for GitHub and GitLab alike.
- **Secret-scan before any AI sees the code.** Secretlint runs by default; a hit STOPS the pack.
- **Describe what exists; never invent.** The code-map records built behaviour, not a design.
- **Setup, not a gate.** Never touch `.sdlc/state.json`, approvals, or the contract lock from here.
- **Idempotent + refreshable.** `connect`/`refresh` are safe to re-run; staleness is HEAD-sha based.
- **The risk map holds no names, and the agent never confirms.** It fills `unset`, may re-level `guessed`,
  and only suggests against `confirmed`.

## Reference
- Registry schema + freshness rule: `references/repos-registry.md`.
- The risk map — format, rubric, what the agent may change: `references/risk-map.md`.
- Product config (the review bridge): `references/product-config.md`.
- Repomix command, secret-scan, degrade path, the code-map prompt, and live on-demand:
  `references/code-context.md`.
- The repomix discipline this reuses (one-feature-at-a-time variant): `../yad-backfill/references/backfill.md`.
- Repos convention: `../yad-stories/references/story-schema.md`.
