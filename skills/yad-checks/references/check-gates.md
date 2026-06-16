# Check gates — definitions, scripts, CI wiring, convention map

The gates are the production-safety core of the build half (Phase 3 build plan §C). They are
deliberately small, separate, and CI-agnostic: plain bash in `checks/`, invoked by whatever CI the
repo uses. Each reads conventions established by earlier steps — it invents nothing.

## What each gate reads (the convention map)

| Gate | Reads | Source step |
|------|-------|-------------|
| spec-link | the `Task: <story>-<task>` commit trailer; `specs/<story>/link.md` | `yad-implement` (trailer), `yad-spec` (link.md) |
| contract-check | changed files under `specs/<story>/contracts/`; the `Contract-Change: yes` trailer; `link.md`'s pinned `contract-lock`; the product repo's `contract-lock.json` | `yad-architecture` (lock), `yad-spec` (slice + link), `yad-implement` (trailer) |
| build/test/lint | the repo's `npm run lint` / `npm run build` / `npm test` | the repo |
| verified-commits | each commit's platform signature-verification status; the author email vs `.sdlc/verified-authors` | hub roster `email` fields (`yad check --fix` generates the allowlist) |
| commit-message | each non-merge commit's subject + trailer block | `yad-commit` / `CONTRIBUTING.md` (`config.yaml build.commit_subject_style`) |
| pr-title | the PR/MR title (from the CI event payload) | `yad-pr-template` (`config.yaml build.pr_title_style`) |
| pr-template | the PR/MR body (from the CI event payload) | `yad-pr-template` (the committed PR/MR template) |

## 1. spec-link (`templates/checks/spec-link.sh`)

- Checks every non-merge commit in `<base>..HEAD` **per commit** (not aggregated across the range),
  so the report names each offending commit and one bad commit never masks the rest.
- Maintenance commits are **exempt**: a Conventional-Commits subject of type `ci`, `chore`, `build`,
  or `test` (optional `(scope)` / breaking `!`) **PASSes** without a link — CI wiring, dependency
  bumps, and test-infra changes legitimately link no story.
- For every other commit, requires a `Task: <story>-<task>` trailer. **FAIL** if absent.
- Strips the `-T<NN>` suffix from the task to get `<story>` and requires `specs/<story>/link.md` to
  exist. **FAIL** if missing.
- An empty range (no non-merge commits) **PASSes**.
- Portable across bash 3.2 (macOS) and 4+ (no `mapfile`).
- **Fails closed** when `<base>` can't be resolved (so a shallow clone / wrong base never PASSes blind).

## 2. contract-check (`templates/checks/contract-check.sh`)

- **Fails closed** if `<base>` can't be resolved — an undiffable range must never report "no surface
  change" and silently green-light a bypass.
- Computes the changed files in `<base>..HEAD`.
- If **nothing** under `specs/*/contracts/**` changed → **PASS** (normal implementation only *consumes*
  the contract).
- If the surface slice changed:
  - Require a `Contract-Change: yes` trailer. **FAIL** (route back to the architecture gate) if absent.
  - Best-effort fidelity: when the product repo is reachable (via `link.md`'s `product-repo` path),
    require `link.md`'s pinned `contract-lock` hash to match the product repo's current
    `contract-lock.json`. A claimed change that still pins the **old** lock **FAILS** — re-run
    `yad-spec` so the slice matches the re-locked contract.
- This enforces the Phase 2 rule: the shared surface is owned upstream and is never widened from inside
  a code repo. The hash recipe is in `../yad-architecture/references/contract-format.md`.

## 3. build/test/lint (`templates/checks/build-test-lint.sh`)

- Runs `npm run lint`, `npm run build`, `npm test` in order; any non-zero exit fails the gate.
- Tests must actually exercise behavior (build plan §C) — an empty or trivially-passing suite does not
  satisfy the gate's intent.
- **Test worker cap.** When the CI job sets `YAD_TEST_MAX_WORKERS` (the templates default it to `2`)
  and the repo's `test` script is jest/vitest, the gate forwards `--maxWorkers=<n>` to bound CI
  concurrency. For any other runner (`node --test`, mocha, …) it is a no-op — the flag is never
  passed, so the gate cannot break on an unknown option. Override it per repo via the
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

No unverified commits from unverified users reach merge — on the product hub and on every connected
repo. For each commit in `<base>..HEAD`, two independent checks:

- **Verified signature** — the platform must mark the commit's signature verified (the GitHub/GitLab
  "Verified" badge: signed with a GPG/SSH key registered to the account owning the author email).
  Read via `gh api repos/{owner}/{repo}/commits/<sha>` (GitHub) or the commits/signature API (GitLab).
- **Known author** — the commit's **author email** must appear in `.sdlc/verified-authors`, generated
  by `yad check --fix` from the hub roster's `email`/`emails` fields plus hub.json's
  `verified_authors` list (edit hub.json, never the generated file). Only the author is checked:
  platform-generated merge/squash commits set the platform as committer, and their integrity is
  covered by the signature check.

Degradation is explicit, never silent: a missing allowlist SKIPs the author check with a warning
(configure roster emails, re-wire); no GitHub/GitLab remote SKIPs the signature check (the badge is a
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
- **Profiles** (`--profile code|hub`): the subject rule is identical on both; the gate never requires
  the `Task:` trailer (spec-link owns that on code repos; hub commits are not task-scoped).
- **Fails closed** when `<base>` can't be resolved.

## 6. pr-title (`templates/checks/pr-title.sh`)

The PR/MR title must follow the convention for the repo kind (title passed as the arg, injected by CI
from the event payload):

- `--profile code` (default) → a Conventional-Commits subject `<type>: <description>`, no trailing
  period (`config.yaml build.pr_title_style: same_as_commit_subject` — one task = one PR, the title is
  the squash-merge subject).
- `--profile hub` → a front-half artifact-review title `review: <artifact> (EP-<slug>)`, the shape
  `yad gate open` creates.

## 7. pr-template (`templates/checks/pr-template.sh`)

The PR/MR body must actually USE the committed template (body passed as a file, injected by CI) — this
catches a free-form description that bypassed it:

- `--profile code` (default) → requires `## Summary`, `## Impact & Risk`, `## Checklist`, and a filled
  `Risk level:` (`low|medium|high`).
- `--profile hub` → requires `## Artifact under review`, `## Impact & Risk (front-half)`, `## Checklist`,
  and a `Risk tags:` line.

## CI wiring (both platforms)

The gates run identically under either CI; the config just invokes the scripts with the PR/MR base.

- **GitHub Actions** — `templates/github/yad-checks.yml` → `.github/workflows/yad-checks.yml`. The
  jobs run on `pull_request` with `fetch-depth: 0`, passing `origin/${{ github.base_ref }}` as base
  (verified-commits also gets a read-only `GH_TOKEN` for the Verified-badge lookup). The pattern jobs
  read the title/body from the event payload: `pr-title` takes `${{ github.event.pull_request.title }}`
  and `pr-template` writes `${{ github.event.pull_request.body }}` to a temp file. All `--profile code`.
- **GitLab CI** — `templates/gitlab/yad-checks.gitlab-ci.yml` → `.gitlab/ci/yad-checks.yml`, pulled in
  by the root `.gitlab-ci.yml`'s `include:`. The jobs run on `merge_request_event` with `GIT_DEPTH: 0`,
  passing `origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`; the pattern jobs read `$CI_MERGE_REQUEST_TITLE`
  and `$CI_MERGE_REQUEST_DESCRIPTION`. All `--profile code`.

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

## Wiring the hub (`repo: hub`)

The product hub is itself a repo on a platform (recorded in `.sdlc/hub.json` by
`yad-connect-repos action: detect-hub`). `wire repo: hub` targets `{project-root}` and uses the same
merge-not-clobber logic, with a **hub-flavored gate set** appropriate to a "thinking" repo (it has no
`specs/` or `package.json` build):
- **owner-set** — every `epic.md` (and forward artifact) under `epics/EP-*/` carries an `owner`.
- **contract-locked** — where an epic has a `contract.md`, its surface hash matches
  `.sdlc/contract-lock.json` (reuse the recipe in
  `../yad-architecture/references/contract-format.md`).
- **approvals-present** — an epic at `ready-for-build` has the approvals its gate rule requires recorded
  in `.sdlc/approvals.json` (the same predicate `yad-review-gate` enforces).

These are advisory checks on the hub's own PRs (the front-half review PRs the bridge opens); they keep
the hub's artifacts internally consistent. The hub never runs the code-repo `spec-link`/`build-test-lint`
gates. Author the hub gate scripts under the hub's `checks/` following the same CI-agnostic-bash pattern.

The hub **does** run the verified-commits gate — `yad check --fix` installs `checks/verified-commits.sh`
plus a standalone workflow (`templates/github/yad-verified-commits.yml` →
`.github/workflows/yad-verified-commits.yml`, or the GitLab fragment
`templates/gitlab/yad-verified-commits.gitlab-ci.yml` → `.gitlab/ci/yad-verified-commits.yml` +
its one include line) whenever `.sdlc/hub.json` has a platform with the bridge enabled. So the
front-half review PRs are held to the same rule as code-repo PRs: signed, known authors only.

The hub **also** runs the three pattern gates (`commit-message`, `pr-title`, `pr-template`) with
`--profile hub`, so the front-half review PRs follow the hub conventions — Conventional-Commits commit
subjects, a `review: <artifact> (EP-<slug>)` title, and a body that uses the hub artifact-review
template. `yad check --fix` installs the same `checks/*.sh` scripts plus a standalone hub workflow
(`templates/github/yad-hub-checks.yml` → `.github/workflows/yad-hub-checks.yml`, or the GitLab fragment
`templates/gitlab/yad-hub-checks.gitlab-ci.yml` → `.gitlab/ci/yad-hub-checks.yml` + its one include
line). Code repos run the same three with `--profile code` inside the main `yad-checks` workflow.

## Running by hand (Phase 3 is manual)

From inside the code repo, against the PR/MR base (e.g. `master`):

```bash
bash checks/spec-link.sh master
bash checks/contract-check.sh master
bash checks/build-test-lint.sh
bash checks/verified-commits.sh master   # uses your own gh/glab auth for the signature lookup
bash checks/commit-message.sh --profile code master
# pr-title / pr-template validate the actual PR/MR metadata (in CI they come from the event payload).
# By hand, pass the title, and a FILE holding the PR/MR description (the rendered/filled body, not the
# template source):
bash checks/pr-title.sh --profile code "feat: add the inquiry endpoint"
# save the PR/MR description to a file first (e.g. `gh pr view <n> --json body -q .body > /tmp/pr-body.md`)
bash checks/pr-template.sh --profile code /tmp/pr-body.md
```

## Proven behavior (demo: `demo-repos/backend`, story EP-istifta-inquiries-S01)

- **Good PR** (task branch with a `Task:` trailer, no surface change, passing tests) → all three **PASS**.
- **Bad PR A** (a code change committed with **no** `Task:` trailer) → spec-link **FAILS**.
- **Bad PR B** (edits `specs/.../contracts/inquiries.md` to widen the surface, with a `Task:` trailer
  but **no** `Contract-Change`) → spec-link passes, contract-check **FAILS** and routes back to the
  architecture gate.
