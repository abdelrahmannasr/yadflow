# Check gates — definitions, scripts, CI wiring, convention map

The gates are the production-safety core of Build (Phase 3 build plan §C). They are
deliberately small, separate, and CI-agnostic: plain bash in `checks/`, invoked by whatever CI the
repo uses. Each reads conventions established by earlier steps — it invents nothing.

## What each gate reads (the convention map)

| Gate | Reads | Source step |
|------|-------|-------------|
| spec-link | the `Task: <story>-<task>` commit trailer; `specs/<story>/link.md` | `yad-implement` (trailer), `yad-spec` (link.md) |
| contract-check | changed files under `specs/<story>/contracts/`; the `Contract-Change: yes` trailer; `link.md`'s pinned `contract-lock`; the product repo's `contract-lock.json` | `yad-architecture` (lock), `yad-spec` (slice + link), `yad-implement` (trailer) |
| build/test/lint | the repo's configured package manager running `lint` / `build` / `test` | the repo |
| lineage-check | the `Task:` trailer → `link.md` (`epic` + `product-repo`); the owning epic's work-item type (`kind:`, then `type:`) and `parent` frontmatter in the Product | `yad-spec` (link.md), `yad-change` (lineage frontmatter) |
| epic-open | the `Task:` trailer → `link.md` → the Product epic's `stories/*.md` `status:` (sealed = all `shipped`) | `yad-engineer-review` (story status), `yad-change` (the change-epic) |
| reconcile-debt | the `Task:` trailer → `link.md` → the Product epic's `thread`; every thread epic's `reconcile-debt.json` | `yad-change` (opens hotfix debt) |
| verified-commits | each commit's platform signature-verification status | the platform (GitHub/GitLab "Verified"); no author allowlist since E62 |
| commit-message | each non-merge commit's subject + trailer block | `yad-commit` / `CONTRIBUTING.md` (`config.yaml build.commit_subject_style`) |
| pr-title | the PR/MR title (from the CI event payload) | `yad-pr-template` (`config.yaml build.pr_title_style`) |
| pr-template | the PR/MR body (from the CI event payload) | `yad-pr-template` (the committed PR/MR template) |

## Resolving `<base>` (every gate that takes one)

The `<base>` argument is **optional**. The order is: the **argument**, else `SDLC_BASE`, else the
**configured** `default_branch` (`.sdlc/hub.json`, or `SDLC_HUB_CONFIG`), else the remote's
**published default branch** (`git symbolic-ref refs/remotes/origin/HEAD`), else `origin/main` —
the same order the CLI resolves (`cli/hubcommit.mjs`, `cli/repo.mjs`), so a gate never diffs a
different range than the `yad` commands run beside it. Each candidate must actually **resolve**
before it is used, so a *dangling* `origin/HEAD` (trunk renamed, the old remote-tracking ref pruned)
falls through instead of failing the gate on a fully-fetched repo. CI always passes the base
explicitly (`origin/<PR base>` / `origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`), so this governs
local runs.

Hardcoding `origin/main` diffed the wrong range on a repo whose trunk is `develop`/`master` — either
failing closed for the wrong reason, or, where a stale `main` still existed, silently diffing a range
that both mis-reports the surface and drags unrelated stories into contract-check's per-story fidelity
pass (issue #161). An auto-resolved base is **printed as a note**, so the range a local run gated is
never implicit. Like the `product-repo` block below, this one is duplicated verbatim across the
scripts (they are standalone by design) and pinned byte-identical by a test — which covers every
base-taking gate, including `yad-backfill`'s `backfill-check.sh` and the installed copies this repo's
own CI runs, plus an assertion that each one actually *assigns* `BASE` from it.

## 1. spec-link (`templates/checks/spec-link.sh`)

- Checks every non-merge commit in `<base>..HEAD` **per commit** (not aggregated across the range),
  so the report names each offending commit and one bad commit never masks the rest.
- Maintenance commits are **exempt**: a Conventional-Commits subject of type `ci`, `chore`, `build`,
  or `test` (optional `(scope)` / breaking `!`) **PASSes** without a link — CI wiring, dependency
  bumps, and test-infra changes legitimately link no story.
- The exemption waives the **requirement** for a link, never the **validity** of one that is claimed.
  A maintenance commit that *does* carry a `Task:` trailer is resolved like any other: a malformed id
  or a missing `specs/<story>/link.md` **FAILS**. Otherwise the trailer is decorative on exempt
  commits and an unlinked `chore:` is indistinguishable from one naming a story that never existed.
- For every other commit, requires a `Task: <story>-<task>` trailer. **FAIL** if absent.
- The trailer must be a well-formed `<story>-T<NN>` id. **FAIL** on a malformed trailer (e.g.
  `EP-demo-S01` with no `-T<NN>`) rather than letting it slip through the suffix-strip.
- Strips the `-T<NN>` suffix from the task to get `<story>` and requires `specs/<story>/link.md` to
  exist. **FAIL** if missing.
- An empty range (no non-merge commits) **PASSes**.
- Portable across bash 3.2 (macOS) and 4+ (no `mapfile`).
- **Fails closed** when `<base>` can't be resolved (so a shallow clone / wrong base never PASSes blind).
  `<base>` is optional — see [Resolving `<base>`](#resolving-base-every-gate-that-takes-one).

## 2. contract-check (`templates/checks/contract-check.sh`)

- **Fails closed** if `<base>` can't be resolved — an undiffable range must never report "no surface
  change" and silently green-light a bypass. `<base>` is optional — see
  [Resolving `<base>`](#resolving-base-every-gate-that-takes-one).
- Computes the changed files in `<base>..HEAD`.
- If **nothing** under `specs/*/contracts/**` changed → **PASS** (normal implementation only *consumes*
  the contract).
- If the surface slice changed:
  - Require a `Contract-Change: yes` trailer. **FAIL** (route back to the architecture gate) if absent.
  - Best-effort fidelity: when the product repo is reachable (via `link.md`'s `product-repo` path),
    require `link.md`'s pinned `contract-lock` hash to match the product repo's current
    `contract-lock.json`. A claimed change that still pins the **old** lock **FAILS** — re-run
    `yad-spec` so the slice matches the re-locked contract.
  - The fidelity check runs for **every story whose slice the diff touches**, and **aggregates**: each
    story reports (matched / stale / deferred), and any stale pin fails the gate. `git diff
    --name-only` is path-sorted, so reading one story off the first changed path validated whichever
    story sorted first and left the rest unpinned — a later story pinning a stale hash passed, and a
    first story with no `link.md` deferred the whole check before the stale one was ever read
    (issue #161). One clean-or-deferred story never masks another's stale pin, the same rule spec-link
    applies per commit.
  - A lock the gate can **read but not parse** (truncated, half-written, or a changed schema — no
    `"hash": "sha256:…"`) **FAILS**. It used to short-circuit the comparison into the "hash matches"
    note, i.e. the gate affirmatively reported a match it never made.
- The changed-file list is read with `core.quotePath=false`. With git's default, a path holding a
  non-ASCII byte comes back quoted and octal-escaped, so a slice like `specs/EP-démo-S01/contracts/…`
  never matched the surface pattern and an undeclared widening passed untouched.
- This enforces the Phase 2 rule: the shared surface is owned upstream and is never widened from inside
  a code repo. The hash recipe is in `../yad-architecture/references/contract-format.md`.

## 3. build/test/lint (`templates/checks/build-test-lint.sh`)

- Reads the standard `package.json#packageManager` field and runs `lint`, `build`, and `test` through
  that manager in order; any non-zero exit fails the gate. `npm` and `pnpm` are supported; another
  manager (yarn, bun) fails closed unless an npm lockfile is present, in which case the repo stays on
  the historical npm path with a warning — a yarn-locally, npm-in-CI repo was green before this
  field was read and must not go red on upgrade. A repo
  without the field retains npm behavior unless it carries `pnpm-lock.yaml` and no npm lockfile
  (`package-lock.json` / `npm-shrinkwrap.json`) — a repo with both keeps the npm path rather than
  silently changing toolchains.
- CI runs `install-deps.sh` first. A declared npm or pnpm manager must use a full, exact semantic
  version with either no build metadata or Corepack's integrity suffix,
  `+<sha1|sha224|sha256|sha384|sha512>.<lowercase hex digest>` at that algorithm's digest length
  (Corepack hashes the download with the named algorithm and compares the lowercase hex string).
  Other build metadata, digest algorithms, digest lengths, uppercase digests, or trailing
  identifiers fail closed. The installer activates the declared version through
  Corepack. Pinned npm is dispatched through Corepack — `corepack npm ci` here and `corepack npm run`
  in the gate, since Corepack activates npm but never shims it — so Node's ambient npm cannot
  override the declaration anywhere; packageManager-absent npm preserves the historical `npm ci` path. pnpm uses
  `pnpm install --frozen-lockfile`. Partial versions, ranges, and tags also fail closed instead of
  floating to a different toolchain.
- The build/test/lint job defaults to Node 22. Set the GitHub repository variable or GitLab
  project/group CI/CD variable `YAD_NODE_VERSION` when the repo requires another supported Node
  release; generated files remain managed instead of accumulating consumer-specific edits. The
  variable is read by the code repo's `yad-checks` workflow only (on GitHub the build/test/lint job;
  in the GitLab fragment it sets the `node:` image of every `yad-*` gate job, which all share one
  anchor) — the Product-side workflows run the `yad` CLI, not the repo's toolchain, and keep their own
  pinned Node. A declared `packageManager` needs
  Corepack, which ships with Node 18 through 24 (Node 25+ dropped it) and, before 18.20.7 / 20.19 /
  22.14, carries registry keys too old to verify anything published since 2025 — so the override
  should stay on a current 20, 22 or 24 line (or install a current Corepack first). The installer
  checks for the binary and wraps `corepack prepare`, so both an absent and a stale Corepack fail
  with that guidance instead of a bare "command not found" or "Cannot find matching keyid".
- Tests must actually exercise behavior (build plan §C) — an empty or trivially-passing suite does not
  satisfy the gate's intent.
- **Test worker cap.** When the CI job sets `YAD_TEST_MAX_WORKERS` (the templates default it to `2`)
  and the repo's `test` script is jest/vitest, the gate forwards `--maxWorkers=<n>` to bound CI
  concurrency (as `-- --maxWorkers=<n>` under npm, which consumes the separator, and bare under pnpm,
  which would forward a literal `--` to the script). For any other runner (`node --test`, mocha, …)
  it is a no-op — the flag is never passed, so the gate cannot break on an unknown option. Override it per repo via the
  `YAD_TEST_MAX_WORKERS` CI variable, or unset it to remove the cap.

### Canonical `package.json` scripts (Node demo)

```json
{
  "scripts": {
    "lint": "find src -name '*.js' -print0 | xargs -0 -n1 node --check",
    "build": "true",
    "test": "node --test"
  }
}
```

`node --check` is a real syntax lint with no extra dependency; `node --test` is Node 20+'s built-in
runner. Real repos substitute their own eslint/tsc/jest — the gate only calls the scripts.

## 4. verified-commits (`templates/checks/verified-commits.sh`)

No unsigned commits reach merge — on the Product and on every connected repo. For each commit in
`<base>..HEAD`, one check:

- **Verified signature** — the platform must mark the commit's signature verified (the GitHub/GitLab
  "Verified" badge: signed with a GPG/SSH key registered to the account owning the author email).
  Read via `gh api repos/{owner}/{repo}/commits/<sha>` (GitHub) or the commits/signature API (GitLab).

**There is no author allowlist** (E62). yadflow keeps no list of people: write access to the repo
decides who can author, and the signature proves which platform account made the commit. `yad check --fix`
and `yad setup` no longer generate `.sdlc/verified-authors`, and no gate reads it or hub.json's
`verified_authors` any more (`SDLC_VERIFIED_AUTHORS` is gone too). When an old `.sdlc/verified-authors`
file is still on disk, the gate prints:

```
note [verified-commits]: .sdlc/verified-authors is no longer read — write access to the repo decides who can author; the signature is still required.
```

`yad doctor` warns `people:verified-authors-unused` for the same leftover data; nothing deletes it.
The old allowlist waivers for the `yad-gate-sync` bot and for merge commits are gone too, because there
is no allowlist left to waive. A bot commit inside the checked range needs a Verified signature like any
other commit.

**Content-free merge exemption** (unchanged). A merge commit (2+ parents) is **signature-waived when it
introduces no content of its own** (its combined diff — `git diff-tree --cc` — is empty, i.e. no
conflict-resolution or evil-merge hunks): every change it carries already lives in an individually
signature-checked parent, so there is nothing to protect. This unblocks **self-hosted GitLab**, which
does not sign UI-created merge commits (the signature API returns 404) — without it every routine merge
would red the branch. A merge that *does* introduce content of its own still requires a verified
signature (fail-closed), so an evil merge pushed direct-to-default cannot smuggle in unverified changes.
This matters for the push-on-default `yad-update-guard` (§9), which — unlike this PR-triggered gate —
sees merge commits.

Degradation is explicit, never silent: no GitHub/GitLab remote SKIPs the signature check (the badge is a
platform concept — this keeps local runs and tests meaningful); an unreachable platform API **fails
closed** with guidance. GitLab CI needs a `GITLAB_TOKEN`/`SDLC_API_TOKEN` variable with `read_api` —
`CI_JOB_TOKEN` cannot read the signature API.

Note the deliberate split with the gate-sync bot: this gate runs on **PRs/MRs only**, so the
`yad-gate-sync` ledger commits (pushed directly to the default branch, unsigned, bot-authored) are
not subject to it. Do **not** replace it with a platform-level "reject unsigned pushes" rule on the
default branch — that would break the event-driven gate sync (and GitLab push rules are Premium-only).

## 5. commit-message (`templates/checks/commit-message.sh`)

The commit *pattern* gate (the presence-only `Task:` check is spec-link's; this checks SHAPE). For each
non-merge commit in `<base>..HEAD`:

- **Subject** must be `<type>: <description>` with `<type>` a known Conventional-Commits type
  (`feat|fix|docs|refactor|test|perf|build|ci|chore|revert` — keep in sync with `cli/manifest.mjs`
  `COMMIT_TYPES`) and **no trailing period** — mirroring `cli/commit.mjs` `buildCommitMessage`.
- **Trailers**, when present, appear in the fixed order `Task → Contract-Change → Co-Authored-By`.
- Merge/squash commits (2+ parents) are skipped — their platform-generated subjects are not authored.
- **Profiles** (`--profile code|hub|product`): the subject rule is identical on both; the gate never requires
  the `Task:` trailer (spec-link owns that on code repos; Product commits are not task-scoped).
- **Fails closed** when `<base>` can't be resolved.
  `<base>` is optional — see [Resolving `<base>`](#resolving-base-every-gate-that-takes-one).

## 6. pr-title (`templates/checks/pr-title.sh`)

The PR/MR title must follow the convention for the repo kind (title passed as the arg, injected by CI
from the event payload):

- `--profile code` (default) → a Conventional-Commits subject `<type>: <description>`, no trailing
  period (`config.yaml build.pr_title_style: same_as_commit_subject` — one task = one PR, the title is
  the squash-merge subject).
- `--profile hub` → splits by the PR/MR **head branch** (passed via `--head`, injected by CI):
  - `review/EP-*` head (or no `--head` — stays strict) → a Shape artifact-review title
    `review: <artifact> (EP-<slug>)`, the shape `yad gate open` creates.
  - any other head → a tooling/code change to the Product itself, so it follows the `code` convention (a
    Conventional-Commits subject). This is what lets a PR that changes the Product's own workflows/checks
    pass — it has no EP artifact to review.
  - **Anti-bypass guard.** The branch name alone is not trusted: a non-review head that actually
    changes Shape artifacts (any path under `epics/**`) **FAILS** — those changes must go through
    a `review/EP-*` PR and the artifact-review workflow. CI passes the PR's changed paths via
    `--changed <file>` (computed from the diff against the base ref); without that list (a direct
    by-hand caller) the guard is inert and the branch split alone applies.

## 7. pr-template (`templates/checks/pr-template.sh`)

The PR/MR body must actually USE the committed template (body passed as a file, injected by CI) — this
catches a free-form description that bypassed it:

- `--profile code` (default) → requires `## Summary`, `## Impact & Risk`, `## Checklist`, and a filled
  `Risk level:` (`low|medium|high`).
- `--profile hub` → splits by the PR/MR **head branch** (passed via `--head`, injected by CI):
  - `review/EP-*` head (or no `--head`) → requires the artifact-review template: `## Artifact under
    review`, `## Impact & Risk (front-half)` (or `(Shape)`), `## Checklist`, and a `Risk tags:` line.
  - any other head → a Product tooling PR, so it requires the `code` task template (`## Summary`,
    `## Impact & Risk`, `## Checklist`, filled `Risk level:`).
  - **Anti-bypass guard** (same as pr-title): a non-review head that changes Shape artifacts
    (`epics/**`, detected from the CI-supplied `--changed <file>` list) **FAILS** — artifact changes
    must go through a `review/EP-*` PR.

**GitLab truncates the description this gate reads.** `$CI_MERGE_REQUEST_DESCRIPTION` stops at **2700
characters**, so a long but perfectly valid MR can lose a required section *before the gate sees it* —
the author then reads "does not use the template" while looking at a description that visibly contains
it (#164). GitHub is unaffected (`github.event.pull_request.body` is not truncated). Two mitigations,
both shipped:

- the GitLab MR templates (`yad-pr-template` `templates/gitlab/…` and `templates/hub/gitlab/…`) carry
  the constraint as a comment and keep every required section early, so a truncated body still passes;
- when a required section is missing **and** the body it read is ≥ 2700 characters, the gate prints a
  `NOTE` naming the truncation and the fix — reorder the required sections above the cutoff and push
  the long narrative to the end. Never delete a section: reordering is always allowed.

## 8. Phase 6 — feature-thread gates (`lineage-check.sh`, `epic-open.sh`, `reconcile-debt-check.sh`)

After the contract locks and code ships, a change must not mutate a locked artifact — it becomes a new
epic threaded to its parent (`config.yaml` `change:`). These three gates keep that discipline. All three
resolve the owning epic the same way: `Task:` trailer → `specs/<story>/link.md` (`epic` + `product-repo`)
→ the Product epic. All **fail closed** on an unresolvable base; all are **per commit**; `ci|chore|build|test`
commits **with no `Task:` trailer** are exempt — like spec-link, the exemption waives the requirement
for an owning epic, never the validity of one that is claimed, so a maintenance subject cannot buy a
pass past the sealed-epic / orphan-thread / frozen-thread checks. When the **Product is not reachable** from CI (the usual case for a code-repo
PR), each degrades to a **PASS-with-note** — the Product-side check (`yad doctor` / `yad reconcile`) covers
that path, and spec-link still proves the story link.

**Resolving `product-repo` (shared by all four Product-reading gates, contract-check included).** An
**absolute** value is used as-is; a **relative** value is joined to the `link.md`'s own directory,
`specs/<story>/`, falling back to a repo-root reading when only that resolves (what contract-check
historically did, so `link.md` files written for it keep working). The `link.md` itself is read from
its frontmatter block, falling back to a whole-file scan for a pre-frontmatter one. Every gate applies
the identical rule — when they disagree, a value one gate can resolve becomes an unreachable path for
another, and "unreachable" is a PASS-with-note, so the gate silently stops gating (issue #149). Each
gate now **prints that note**, so a deferred check is never mistaken for a passed one. The block is
duplicated verbatim across the four scripts (they are standalone by design) and a test asserts the
four copies stay byte-identical.

- **lineage-check** — reads the Product epic's work-item type and `parent` frontmatter. The type has
  two names and the gate reads `kind:` first, then `type:` — the same order the CLI uses, asserted by a
  table test in `cli/test-checks.mjs`. A `feature` or `chore` (genesis) epic
  passes. A `change`/`defect`/`hotfix` epic **FAILS** unless it declares a `parent:` that resolves to a
  real `epics/<parent>/` in the Product (no orphan threads). This is the "every code change has an owning
  epic in a thread" enforcement, layered on spec-link.
- **epic-open** — an epic is **sealed** iff it has ≥1 story and **every** `stories/*.md` `status:` is
  `shipped`. A commit whose owning epic is sealed **FAILS**: new behaviour cannot mutate a shipped epic;
  it must land in a new threaded change-epic. This is what stops the Shape artifacts from going stale.
- **reconcile-debt** — resolves the epic's `thread` (its `thread:` frontmatter, else the epic id) and
  scans every thread epic's `reconcile-debt.json`. An **open** entry the current epic does not own
  **FAILS** the change (the thread is frozen until the hotfix debt is paid: artifacts updated + a
  regression test added, then `status: paid`). Thread-scoped — only the affected thread freezes.

## 9. yad-update-guard (`templates/github/yad-update-guard.yml`, `templates/gitlab/yad-update-guard.gitlab-ci.yml`)

The **integrity gate for direct pushes to the default branch**. `yad update --push` (`cli/update-commit.mjs`)
commits the applied SDLC drift (skills, gate scripts, CI wiring) and pushes it
**straight to the default branch with no PR/MR** — so the `pull_request`/`merge_request` gate suite never
fires. This workflow is the "skipped from CI **except** verified-commits + the pattern gate" contract: on a
**push** to the default branch it runs **only** `verified-commits` and `commit-message` over the pushed
range (`github.event.before..HEAD` / `$CI_COMMIT_BEFORE_SHA..HEAD`, falling back to `HEAD~1` when the
before-SHA is a zero/unresolvable ref). It is deliberately **not** scoped to `chore(yad-update)` commits:
**any** direct-to-default commit (a hotfix, a force-push) is then signature- + subject-format-checked, a
strictly-good invariant. Normal PR merges sail through — merge commits are platform-Verified and
`commit-message` skips merges. The `yad update --push` commit itself carries **no `[skip ci]`** (unlike the
machine-state `yad checkpoint`/`gate ci` commits) precisely so this guard runs on it.

Wired into **every connected repo and the Product** (`REPO_WIRING`/`PRODUCT_WIRING` in `cli/manifest.mjs`). On
GitHub it is a self-contained workflow (`.github/workflows/yad-update-guard.yml`, marker `# yad-managed:
yad-checks`), gated to the default branch by a job-level `if: github.ref_name ==
github.event.repository.default_branch`. On GitLab it is an includable fragment
(`.gitlab/ci/yad-update-guard.yml`, marker `# yad-managed-include: yad-checks`) whose jobs run on
`$CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`; its `include:` line
(`- local: '.gitlab/ci/yad-update-guard.yml'`) is added to the root `.gitlab-ci.yml` the same additive way
as the other fragments (see *Sync with existing CI* below). **On GitLab the fragment is inert until that
include line exists** — `yad update --push` warns when it pushes to a gitlab repo whose root pipeline
lacks it.

**Prerequisites / caveats.** Direct pushes to the default branch must be permitted for the committer
(adjust branch protection). The commits `yad update --push` creates must be **signed**, or this guard
rejects them — `yad update --push` runs a pre-flight that warns when local commit signing is off. Ordinary
PR merges pass (merge commits are Verified, or content-free and signature-waived), but a **rebase-merge**
recreates the PR commits
without the platform signature, so a rebase-merge team should sign commits or not wire this guard.

## 10. risk-map (`templates/checks/risk-map-check.sh`) — advisory

Reads the code repo's **risk map**, `.sdlc/risk-map`: one line per directory giving it a level (`high`,
`medium`, `low`, or `unset`), marked `guessed` (an AI agent filled it) or `confirmed` (a person checked
it), and **no names** (E65). The format, the rubric and who may change what:
`../yad-connect-repos/references/risk-map.md`. The rules have a twin in `cli/riskmap.mjs`
(`yad risk-map check`, `yad doctor`); a test runs both over the same repos and compares the output.

It **always exits 0** — nothing counts the levels until E66, so a stale map must never block a merge. It
prints `WARN [risk-map] <code> <target>: …` for:

| Code | When |
|---|---|
| `uncovered` | a file this change adds or edits that no line covers — names the directory to add. A directory a line cannot hold (`app/[slug]/`) names its parent instead; a top-level one (`my docs/`) says to rename it |
| `dead` | a line whose directory holds no file (`./`: no file at the root) — on every change, until fixed |
| `unset` / `guessed` | a line this change touches that has no level yet, or whose level is still a guess |
| `unreadable` / `names` / `duplicate` | a line that is not `<dir>/ <level> <state>`, names a person (a word starting `@`, `@org/team` included — a word ending in `/`, like `@types/`, is a directory), or repeats a directory |
| `header` / `version` | no `# yad-risk-map v1` first line (read as v1), or a newer version (nothing is read) |
| `map-edited` | the change edits the map itself, which decides how much review later changes need |

The change is `git diff --name-only -z --diff-filter=ACMRT <base>...HEAD` (T: a file turned into a symlink is an edit) — **three dots**, measured from
where the branch left the base, so commits the base gained since are never blamed on this change (the
blocking gates use two dots; this one only warns about what the change touches). A deleted file is never
asked about. The repo is `git ls-files -z`. Both lists are read NUL-separated, so a path holding `"`, `\`
or a tab arrives as it is, never quoted by git. A base that does not resolve, or shares no history with HEAD (a shallow clone), is a note, not a failure:
the map's own lines are still checked. A repo with no map gets one note and passes — **unless this change deleted
the map**, which warns `map-edited`: a rename away from `.sdlc/risk-map`, and the map replaced by a folder or by a symlink that leads nowhere or to a folder, count as a delete. A symlink to a real file is not — `[ -f ]` follows it, so the check reads the link's target as the map and says `edits`. Deleting some other file under a *folder* named `.sdlc/risk-map/` gets the plain no-map note, not `map-edited`. Outside a git repo it
prints a note and exits 0. **Known limits:** a path holding a newline reads differently here than in
`yad risk-map check` — git's NUL-separated list has to become lines for macOS awk — and such a directory
cannot have a line anyway. A path whose bytes are not valid UTF-8 differs too: this check compares bytes
(`LC_ALL=C`), while the CLI decodes bad bytes as U+FFFD. **The map file is not wired** — it is the
team's, so `yad update` never owns or overwrites it; only the check is.

## CI wiring (both platforms)

The gates run identically under either CI; the config just invokes the scripts with the PR/MR base.

- **GitHub Actions** — `templates/github/yad-checks.yml` → `.github/workflows/yad-checks.yml`. The
  jobs run on `pull_request` with `fetch-depth: 0`, passing `origin/${{ github.base_ref }}` as base
  (verified-commits also gets a read-only `GH_TOKEN` for the Verified-badge lookup). The trigger sets
  `types: [opened, synchronize, reopened, edited]` — the extra `edited` so a title/body correction
  re-runs the pattern gates without a close/reopen (a plain re-run replays the frozen original payload).
  The commit-range jobs carry `if: github.event.action != 'edited'` so a bare body/title edit only
  re-runs `pr-title`/`pr-template`, not the whole suite. The pattern jobs
  read the title/body from the event payload: `pr-title` takes `${{ github.event.pull_request.title }}`
  and `pr-template` writes `${{ github.event.pull_request.body }}` to a temp file. All `--profile code`.
  The Phase 6 thread gates (`lineage-check`, `epic-open`, `reconcile-debt`) and the advisory `risk-map`
  check run as their own jobs with `fetch-depth: 0`, the same `origin/${{ github.base_ref }}` base. The build/test/lint checkout also
  uses `filter: blob:none`; its installer follows `package.json#packageManager`, and `NX_BASE` /
  `NX_HEAD` carry the exact base/head SHAs so Nx affected commands evaluate the PR rather than a
  stale default. `YAD_NODE_VERSION` is read from GitHub repository variables with `22` as the default.
  Dependencies are cached with `actions/cache` (npm's `~/.npm`, pnpm's store, and the Corepack home
  holding the pinned manager, keyed on the lockfiles and package.json) rather than setup-node's
  npm-only `cache:`, which must name the manager before package.json has been read.
- **GitLab CI** — `templates/gitlab/yad-checks.gitlab-ci.yml` → `.gitlab/ci/yad-checks.yml`, pulled in
  by the root `.gitlab-ci.yml`'s `include:`. The jobs run on `merge_request_event` with `GIT_DEPTH: 0`,
  passing `origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`; the pattern jobs read `$CI_MERGE_REQUEST_TITLE`
  and `$CI_MERGE_REQUEST_DESCRIPTION`. The quality job uses the same package-manager-aware installer;
  `NX_BASE=$CI_MERGE_REQUEST_DIFF_BASE_SHA` and `NX_HEAD=$CI_COMMIT_SHA` provide the equivalent Nx
  range. Its `node:${YAD_NODE_VERSION}` image defaults to `22` and a project/group CI/CD variable may
  override it without editing the managed fragment. Those three variables sit on the `.sdlc_mr_only`
  anchor, not the fragment's top-level `variables:` — an included top-level block merges into the host
  pipeline's globals, where `NX_BASE`/`NX_HEAD` could collide with a host's own Nx setup. The retained greenfield standalone template
  (`templates/gitlab/.gitlab-ci.yml`) carries the same Node default, exact Nx range, and dependency
  installer and test-worker-cap semantics. All `--profile code`.

## Sync with existing CI (merge, never clobber)

`wire` is **additive**: it brings the SDLC gates into a repo that may already have CI, without ever
editing a foreign CI file. The principle is "own a separate file; touch the foreign root only to add a
one-line include".

**GitHub.** Every workflow file runs independently, so the gates simply live in their own
`yad-checks.yml`, identified by the first-line marker `# yad-managed: yad-checks`.
- No file at our path → copy the template verbatim.
- Our marked file already there → refresh it (no-op if identical).
- A **foreign** workflow occupies the name → install as `yad-checks.gen.yml` instead and make the
  display `name:` unique. We never merge jobs into, or edit, a foreign workflow.

**GitLab.** Only one root `.gitlab-ci.yml` may exist, so the gates live in an **includable** fragment
`.gitlab/ci/yad-checks.yml` (marker `# yad-managed-include: yad-checks`). Its jobs declare `needs: []`
and **no `stage:`**, so they run in the default stage and a foreign root's `stages:` list can neither
break nor reorder them; job names are `yad-`prefixed to avoid collisions.
- No root `.gitlab-ci.yml` → write a minimal root (`gitlab-ci.include-root.yml`) that only `include:`s
  the fragment.
- Root exists → read its top-level `include:`; add the key if absent, append
  `- local: '.gitlab/ci/yad-checks.yml'` if missing, no-op if already present. **Nothing else** in the
  root is touched.
- Root YAML cannot be parsed safely → **STOP** and print the include snippet for the human to paste.

**package.json.** Only ADD a missing `lint`/`build`/`test` script; an existing one is never overwritten.

**Idempotent.** The two markers plus the include-entry check make a re-run a no-op. This is how a repo
that already had its own pipeline keeps it and still gains the gates.

## Wiring the Product (`repo: hub`)

The Product is itself a repo on a platform (recorded in `.sdlc/hub.json` by
`yad-connect-repos action: detect-hub`). `wire repo: hub` targets `{project-root}` and uses the same
merge-not-clobber logic, with a **Product-flavored gate set** appropriate to a "thinking" repo (it has no
`specs/` or `package.json` build). **What yadflow wires today** (`PRODUCT_WIRING`): `commit-message`,
`pr-title`, `pr-template` and `ledger-guard` in `yad-hub-checks`, `verified-commits` in its own workflow,
and the `yad-update-guard`. The three below are **not shipped** — they are scripts a team writes itself if
it wants them:
- **owner-set** — every `epic.md` (and forward artifact) under `epics/EP-*/` carries an `owner`.
- **contract-locked** — where an epic has a `contract.md`, its surface hash matches
  `.sdlc/contract-lock.json` (reuse the recipe in
  `../yad-architecture/references/contract-format.md`).
- **approvals-present** — an epic at `ready-for-build` has the approvals the gate rule requires recorded
  in `.sdlc/approvals.json`: at least 1 approver (the author is not checked here — the platform's own
  rules stop self-approval on GitHub, and on GitLab when its settings say so; the same predicate
  `yad-review-gate` enforces; the risk step of the full count is reported beside it and gates nothing
  until the capacity cap).

These are advisory checks on the Product's own PRs (the Shape review PRs the verified ledger opens); they keep
the Product's artifacts internally consistent. The Product never runs the code-repo `spec-link`/`build-test-lint`
gates. Author the Product gate scripts under the Product's `checks/` following the same CI-agnostic-bash pattern.

The Product **does** run the verified-commits gate — `yad check --fix` installs `checks/verified-commits.sh`
plus a standalone workflow (`templates/github/yad-verified-commits.yml` →
`.github/workflows/yad-verified-commits.yml`, or the GitLab fragment
`templates/gitlab/yad-verified-commits.gitlab-ci.yml` → `.gitlab/ci/yad-verified-commits.yml` +
its one include line) whenever `.sdlc/hub.json` has a platform with a verified ledger. So the
Shape review PRs are held to the same rule as code-repo PRs: platform-Verified signatures only.

The Product **also** runs the three pattern gates (`commit-message`, `pr-title`, `pr-template`) with
`--profile hub`. The pattern gates split by the PR/MR **head branch** (passed via `--head`): a
`review/EP-*` head is a Shape review PR — Conventional-Commits commit subjects, a
`review: <artifact> (EP-<slug>)` title, and the Product artifact-review template body; **any other head is
a tooling/code change to the Product itself** and follows the `code` convention (a Conventional-Commits
title + the code task template), so a PR that changes the Product's own workflows/checks can pass.
`yad check --fix` installs the same `checks/*.sh` scripts plus a standalone Product workflow
(`templates/github/yad-hub-checks.yml` → `.github/workflows/yad-hub-checks.yml`, or the GitLab fragment
`templates/gitlab/yad-hub-checks.gitlab-ci.yml` → `.gitlab/ci/yad-hub-checks.yml` + its one include
line). Code repos run the same three with `--profile code` inside the main `yad-checks` workflow.

## The agent guardrail (`templates/hooks/ledger-guard.sh` + `yad hook ledger-guard`)

Not a CI gate — a **harness hook**, and the only piece of yadflow that runs *inside* an agent's tool
loop. It exists because of the gap #171 reported: `checks/ledger-guard.sh` is correct and blocking,
but it speaks at CI time. An agent that hand-edits `epics/*/.sdlc/state.json` in verified mode learns
twenty minutes later, from a FAIL with nothing connecting cause to effect, and by then the write must
be reverted before the review PR/MR can go green.

**Contract** — deliberately not Claude-Code-shaped:

| | |
|---|---|
| stdin | a harness tool-call payload as JSON (optional; `--path <p>` works instead) |
| exit 0 | allow |
| exit 2 | deny — the reason is on stderr, for the agent to read |

Two harnesses match that contract, and `yad check --fix` wires both:

| Harness | File | Event | Command |
|---|---|---|---|
| Claude Code | `.claude/settings.json` | `PreToolUse` | `"$CLAUDE_PROJECT_DIR/hooks/ledger-guard.sh"` |
| Cursor | `.cursor/hooks.json` | `preToolUse` | `hooks/ledger-guard-cursor.sh` |

Any other harness that can run a command and read those two exit codes can use `ledger-guard.sh` by
hand.

**Cursor needs a second protocol, and this is the trap.** Its `preToolUse` is a *permission hook*:
Cursor's docs say that for a permission hook, "invalid JSON or a response that doesn't match the
hook's schema blocks the action". `ledger-guard.sh` prints **nothing** when it allows — and empty
stdout is invalid JSON. Wiring it straight into Cursor would therefore have blocked **every** file
write in a verified project: fail-closed on everything, the opposite of this guard's whole design, and
invisible to any test that only checks that a deny denies.

So Cursor gets `hooks/ledger-guard-cursor.sh`, installed only for a project whose targets include
`.cursor`. It calls `yad hook ledger-guard --format cursor` through the shared script and guarantees a
permission answer on stdout, whatever happens:

| | stdout | exit |
|---|---|---|
| allow | `{"permission":"allow"}` | 0 |
| deny | `{"permission":"deny","user_message":"<reason>","agent_message":"<reason>"}` | 0 |

The field names are Cursor's documented permission-hook schema, all snake_case. Getting that wrong is
quiet in the worst way: an off-schema response still blocks, so the write is refused and any test that
checks "a deny denies" passes — while the text naming `yad gate open` is discarded and the agent is
told only "no".

The allow response is a fixed literal with nothing interpolated into it, because a malformed *allow*
is a block. The deny response carries the reason, and if that field were ever rejected as off-schema
the response is invalid — which blocks, which is what a deny wanted anyway. Both failure directions
are safe, in opposite ways, on purpose. A deny exits **0**, not 2, because the JSON is the
authoritative answer and exit 0 is what tells Cursor to read it; exit 2 blocks too but is documented
as the code for "no JSON to read", so it would discard the reason — and naming the command that owns
the transition is the entire point of speaking at edit time. The reason also goes to stderr, where
Cursor logs it.

The wrapper takes **no arguments**, and every fail-open branch of the shared script (no `yad` on
PATH, an install it cannot resolve) is converted into an explicit `allow` answer rather than the
empty stdout that would block. **Exit 2 is converted into a deny**, not an allow: `ledger-guard.sh`
resolves `yad` from the Product's own `node_modules/yadflow` before `PATH`, so a project pinned to a
yadflow older than `--format` answers in the exit protocol — exit 2 with empty stdout — and treating
that as "no verdict" would turn a real refusal into a permitted write.

The two commands are spelled differently on purpose. Claude Code runs the string through a shell, so
its entry uses `$CLAUDE_PROJECT_DIR` and is quoted against a project path containing a space. Cursor
documents that a project hook runs **from the project root** but not whether the command goes through
a shell — so its entry is a relative path with no variable and no quotes, the one spelling that works
either way. Every failure mode here is silent and fails open, which would leave `yad doctor`
truthfully reporting an entry that never refuses anything.

Cursor does not document the field names inside `tool_input`, so `payloadPaths` reads any key *named*
like a path (`file_path`, `target_file`, `filePath`, `paths`) rather than guessing a vendor spelling.
It matches the key and never the value: scanning values for something shaped like a ledger path would
refuse an ordinary edit to a document that merely quotes one, and a false deny is worse than a miss in
a guard that fails open by design.

Cursor's wiring follows Cursor's published protocol and has not yet been exercised against a live
Cursor session.

**Layering.** `hooks/ledger-guard.sh` is only the adapter: it locates `yad` (`$YAD_BIN` → the Product's
`node_modules/yadflow` → `PATH` → `npx --no-install`) and passes the payload to `yad hook
ledger-guard`, which holds the decision. So the wiring never hard-codes an install path, and the
logic is unit-tested (`cli/hook.mjs`, `cli/test.mjs`) instead of living in bash.

**Scope — identical to the CI gate, on purpose**, down to the details that decide the hard cases:

- Guarded: `epics/*/.sdlc/{state,approvals,comments,hub-prs}.json` and `epics/*/reviews/*.md`.
  Exempt: `contract-lock.json` (artifact-side), `change.json`, every artifact.
- **Depth matches the gate's globs.** Its arms are bash `case` patterns, and a bash `*` spans `/`, so
  `epics/EP-a/nested/.sdlc/state.json` is guarded there — and here. Being stricter locally would let
  a path through that CI blocks.
- **The seed carve-out reads the base ref, not the working tree** (#162): the epics whose
  `state.json` the base carries are listed once with `ls-tree`, and an epic absent from that list is
  a creation. Never a `<rev>:<path>` probe — that spec resolves from the repository top level and
  `-C` does not re-anchor it, so a Product in a subdirectory of its repo would miss every time and the
  guard would allow everything, silently.
- **The base is an `origin/` ref** — `origin/<default_branch>`, then the remote's published default,
  then `origin/main`, the gate's own order. Never a bare local branch: `git fetch` does not
  fast-forward one, so a stale trunk would report a merged epic's ledger as absent and wave a real
  mutation through. If none resolves, the answer is *unknown* and unknown allows.
- **Slugs are case-folded**, as the gate folds them. On a case-insensitive filesystem `epics/ep-x/…`
  and `epics/EP-X/…` are the same file, so a byte-exact compare would let a mutation be laundered as
  a creation.
- Verified-only by the same `isVerifiedLedger` predicate the CLI and the wiring read (#186): without the
  bridge the ledger is locally owned, the hand-edit the authoring skills describe is correct, and
  nothing is wired or blocked.

**It fails OPEN, and that asymmetry is the design.** No `yad` on PATH, no Product above the edited path,
an unreadable `hub.json`, an unparseable payload, a `yad` that errors — every one of them ALLOWS,
with a note on stderr. A local guardrail that failed closed would brick an agent's ability to edit
anything the moment an install went sideways. The CI gate fails **closed** and is what actually
protects the ledger; this only shortens the feedback loop. `YAD_HOOK_DISABLE=1` skips one command.

**Known gaps** — both fall through to the CI gate, which is why it stays the authority:

- A `Bash` tool call (`sed -i epics/…`) is not intercepted; matching it would mean parsing shell for
  write intent.
- The hook arms sessions **rooted at the Product**. A harness loads hooks from its own project root, so a
  session opened at the *workspace* (`project/`, with the Product at `project/product/`) never reads the
  Product's `.claude/settings.json` and the guard does not fire there — even though the decision itself
  resolves the Product correctly from any path. In that layout, open the session at the Product, or copy the
  entry into the workspace's own settings (the command's `$CLAUDE_PROJECT_DIR` would then need
  the Product-relative path).

**Wiring** (installed by `yad setup` / `yad check --fix`, verified Products only):

| Path | Owner |
|---|---|
| `<product>/hooks/ledger-guard.sh` | fully managed — drift-checked and recorded in `.sdlc/managed.json` like any gate script |
| `<product>/.claude/settings.json` | **one entry**, merged additively into `hooks.PreToolUse`. See below. |

The settings file is the team's, so the rules around that one entry are deliberately conservative:

- **Ownership is an exact command match** — the current spelling or a documented past one — never a
  substring. A team keeping its own wrapper at `.claude/hooks/ledger-guard.sh` would otherwise have
  their hook silently rewritten to ours, on the `outdated` path that takes no backup. Matching
  exactly means the worst case is a second entry (the guard runs twice, harmlessly).
- **The command is quoted** (`"$CLAUDE_PROJECT_DIR/hooks/ledger-guard.sh"`) because the harness runs
  it through a shell: unquoted, a project path containing a space word-splits and the guard is
  silently off while `check` and `doctor` still call it wired.
- **A file that does not parse is never rewritten** — not even by `--overwrite-local`. For a managed
  file that flag restores a shipped template; here there is none, and everything in the file is the
  team's. It reports `modified` until a human fixes the JSON.
- **A `matcher` the team narrowed is left as they set it** — but `yad doctor` warns when it no longer
  selects any file-editing tool, so an installed-but-dead guard cannot pass for healthy.
- **It is never staged by `yad update --push`.** Every other path in that allowlist is a file yad
  wrote in full; this one would sweep the team's unrelated edits into a `chore` commit pushed
  straight to the default branch.
- **Both halves land together.** The script and the entry ride `yad update` as one: applying the
  entry without the script it points at would fire a missing command on every file edit.

`.claude` and `.cursor` are the only IDE targets wired (`.cursor` through its own wrapper, above): they
are the only ones with a hook protocol yadflow has read. Other targets get the script, and the contract
above is what they would wire by hand.

`yad doctor` reports the guard on a verified Product, and distinguishes the three states that matter — it
reads the same persisted `ideTargets` the wiring reads, so every gap it names is one the command it
names can actually close:

| State | Report | Remedy |
|---|---|---|
| script + entry present, matcher live | `agent ledger guard wired` | — |
| either half absent | `not wired: <what>` | `yad check --fix` |
| present but the matcher no longer selects a file-editing tool | `installed but its matcher no longer selects file edits` | restore the matcher — it is wired and never fires |
| the settings file does not parse | `cannot be wired — … does not parse` | fix the JSON by hand; yad never rewrites one it cannot parse, so nothing else clears it |

## Running by hand (Phase 3 is manual)

From inside the code repo, against the PR/MR base (e.g. `master`). For the gates that take one, the
base argument is optional — omit it and the gate resolves the trunk in the order above (configured
`default_branch`, else `origin/HEAD`, else `origin/main`), printing the base it chose; pass it (or
`export SDLC_BASE=…`) whenever the PR targets something else. `build-test-lint` takes no base at all.

```bash
bash checks/spec-link.sh                 # -> diffs the resolved trunk, and says which one
bash checks/spec-link.sh master
bash checks/contract-check.sh master
bash checks/build-test-lint.sh
bash checks/verified-commits.sh master   # uses your own gh/glab auth for the signature lookup
bash checks/commit-message.sh --profile code master
# pr-title / pr-template validate the actual PR/MR metadata (in CI they come from the event payload).
# By hand, pass the title, and a FILE holding the PR/MR description (the rendered/filled body, not the
# template source):
bash checks/pr-title.sh --profile code "feat: add the order endpoint"
# save the PR/MR description to a file first (e.g. `gh pr view <n> --json body -q .body > /tmp/pr-body.md`)
bash checks/pr-template.sh --profile code /tmp/pr-body.md
```

## Proven behavior (demo: `demo-repos/backend`, story EP-checkout-S01)

- **Good PR** (task branch with a `Task:` trailer, no surface change, passing tests) → all three **PASS**.
- **Bad PR A** (a code change committed with **no** `Task:` trailer) → spec-link **FAILS**.
- **Bad PR B** (edits `specs/.../contracts/orders.md` to widen the surface, with a `Task:` trailer
  but **no** `Contract-Change`) → spec-link passes, contract-check **FAILS** and routes back to the
  architecture gate.
