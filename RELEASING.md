# Releasing

The `yad` CLI is published to npm as **`yadflow`**. The publish itself is **automated**
with [semantic-release](https://semantic-release.gitbook.io/): there is no manual `npm publish` in the
steady state. **The decision to release is not automated.** Nothing reaches `yadflow@latest` until a
person fast-forwards the `release` branch to `main` (roadmap rule: *a release is a human decision*).
This doc covers the one-time bootstrap and the ongoing flow.

> **Renamed at v1.4.0.** The package was previously published as `@abdelrahmannasr/sdlc-workflow`
> (through v1.3.2); that scoped package is **deprecated** and points here. Same CLI, same repo —
> the GitHub repo was renamed `sdlc-workflow` → `yadflow` (old URLs redirect). The trusted-publisher
> registration is per-package, so `yadflow` needed its own bootstrap (steps A–B below).

## How it works

Three branches take part:

- **`main`** — where PRs merge. Merging to `main` **never publishes**.
- **`release`** — publishes to `yadflow@latest`, what `npx yadflow` and a plain `npm install` give
  people. A person moves it with a fast-forward: `git push origin origin/main:release`.
- **`next`** — publishes to `yadflow@next`, the **pre-release** channel
  (`.releaserc.json` → `{ "name": "next", "prerelease": true }`). Versions land as `4.0.0-next.1` and
  reach only people who ask for them by name. `latest` is untouched.

Both publishing branches run the same release check first.

`.github/workflows/release.yml` runs **only** on those two publishing branches. Nothing about a merge
to `main` starts it.

The workflow has two jobs, and the second cannot start without the first:

**1. `release check`** — `scripts/release-check.sh`. Six steps, each one a way an upgrade could hurt
somebody:

| # | Step | What it protects against |
|---|---|---|
| 1 | tests + coverage | the ordinary bar, at the configured floors |
| 2 | the golden compatibility test | a real frozen v3 project reading differently than it did (rule 6) |
| 3 | `yad migrate --preview` on that project | an upgrade path that cannot even be planned — and it proves the preview writes nothing |
| 4 | a fresh install of the packed tarball, then `yad setup` | a `files` mistake, or a release that cannot create a project |
| 5 | `yad doctor` on the project that install just created | a release whose own health check fails on its own output |
| 6 | the migration guide, if the file shape moved | shipping a shape change with no page explaining it (rule 7) |

It checks out with `persist-credentials: false`: this job only reads, and the token that can bypass
branch protection has no business being in scope while the test suite runs. Run it yourself any time
with `npm run release-check`.

**2. `release`** — only if the check passed. It:

1. installs deps (`npm ci`),
2. runs `npx semantic-release`, which:
   - reads the [Conventional Commits](CONTRIBUTING.md) since the last release to pick the next version
     (`fix:`/`perf:`/`revert:` → patch, `feat:` → minor, `!`/`BREAKING CHANGE:` → major;
     `docs:`/`chore:`/`ci:`/`test:`/`refactor:` → nothing),
   - regenerates `CHANGELOG.md` and ships it **inside the npm tarball**,
   - **publishes to npm via tokenless Trusted Publishing (OIDC) with build provenance** — no `NPM_TOKEN`,
   - commits the regenerated `CHANGELOG.md` + `package.json` + `package-lock.json` back to the branch
     it ran on — now **`release`**, not `main` (`@semantic-release/git` pushes `HEAD:<branch>`),
   - pushes the `vX.Y.Z` git tag and cuts a GitHub release with the notes.

Auth is the `id-token: write` permission in the workflow plus the npm trusted-publisher entry — there is
no long-lived secret to rotate. CI (`.github/workflows/ci.yml`) runs the Node 18/20/22 test matrix and a
tarball-leak smoke on every PR.

> **Note — the commit back, and why `release` then leads `main`.** The pipeline includes
> `@semantic-release/git`, so after publishing it commits the regenerated `CHANGELOG.md`,
> `package.json`, and `package-lock.json` as a `chore(release): X.Y.Z [skip ci]` commit. It pushes that
> to **the branch it ran on** (`HEAD:<branch>` — `@semantic-release/git/lib/git.js`), which since E105
> is `release`, not `main`.
>
> So after a real publish `release` is one commit ahead of `main`, and the next sync is **no longer a
> fast-forward**. That commit has to come back to `main` — see step 4 of *Cutting a release* — or
> `main`'s `package.json` version drifts behind npm and the following release is refused. Nothing
> automates this: it is one manual step per release, on purpose, because the alternative is a robot
> pushing to `main`.
>
> `RELEASE_TOKEN` (step D) exists because the commit-back used to target protected `main`, which the
> default `GITHUB_TOKEN` cannot push to. Now that the target is `release`, that bypass is only needed if
> `release` is protected too — and it **should** be (see step E). The `[skip ci]` marker stops the
> release commit from re-triggering the workflow.

`main` is protected with a required review, so **every PR into `main` needs an approval or an admin
merge** (`gh pr merge --squash --admin`). That is unchanged by E105 and is separate from releasing.

## One-time setup (already done once per package)

npm's trusted-publisher config lives on the package's settings page, so the package must exist first.

### A. Bootstrap with one manual publish

```bash
npm login                                          # handles 2FA OTP if enabled
git checkout feat/sdlc-cli                          # the branch that carries package.json
npm publish --access public --provenance=false      # provenance only works inside CI (OIDC)
```

This creates the package on npm. semantic-release derives the next version from git tags (the repo's
existing `vX.Y.Z` tags carry over the version line — the first `yadflow` release continues from the last
scoped tag, e.g. v1.3.2 → v1.4.0 on a `feat:`), so the first automated release lands cleanly on top.
*(If `--provenance=false` is rejected, use `NPM_CONFIG_PROVENANCE=false npm publish --access public`.)*

### B. Register the trusted publisher

On **npmjs.com → the package page → Settings → Trusted Publisher → GitHub Actions**:

| Field | Value |
|-------|-------|
| Organization or user | `abdelrahmannasr` |
| Repository | `yadflow` |
| Workflow filename | `release.yml` *(filename only, not a path)* |
| Environment | *(leave blank)* |

Save. From here on, CI publishes tokenlessly with provenance.

### C. GitHub repo permissions

Repo → **Settings → Actions → General → Workflow permissions** → **Read and write permissions**, and
check **Allow GitHub Actions to create and approve pull requests**. (Needed for the git tag push and the
GitHub release.) The source repo must also be **public** — npm provenance is rejected for private repos.

### D. Release PAT for the commit-back (`RELEASE_TOKEN`)

`@semantic-release/git` pushes the `chore(release)` commit to the release branch. Once that branch is
protected (step E), the default `GITHUB_TOKEN` cannot push to it. Provision a bypass token:

1. Create a **fine-grained PAT** (GitHub → Settings → Developer settings → Fine-grained tokens), scoped
   to the `yadflow` repo, with **Contents: Read and write**, **Pull requests: Read and write**, and
   **Issues: Read and write** (the last two let `@semantic-release/github` comment on released PRs/issues).
   The token owner must be a user that **bypasses `main`'s branch protection** (a repo admin does).
2. Add it as a repo secret: **Settings → Secrets and variables → Actions → New repository secret**, named
   **`RELEASE_TOKEN`**.
3. Ensure the bypass lists for `main` **and `release`** include that user (Settings → Branches/Rules).

Rotate the PAT before it expires; until `RELEASE_TOKEN` exists the release will fail at the commit-back
step (the workflow falls back to `GITHUB_TOKEN`, which cannot bypass protection).

### E. Protect the publishing branches

Pushing a publishing branch **is** the act of shipping, so both are protected by a ruleset
(Settings → Rules → Rulesets):

| | |
|---|---|
| **Target** | `release` — **done**. `next` should get the same treatment before the first pre-release |
| **Rules** | *Restrict deletions* and *Block force pushes*. Nothing else |
| **Bypass** | none |

Those two rules stop released history being rewritten and stop the branch being deleted, while leaving
the ordinary fast-forward that performs a release untouched.

**Three rules to deliberately NOT enable on these branches:**

- **Require a pull request.** A release is a fast-forward push. This rule would block it outright.
- **Require signed commits.** The `chore(release)` commit is written by `semantic-release-bot` and is
  unsigned; this would fail every release at the commit-back.
- **Require status checks.** The release check runs *on* the push, so it cannot gate that push. The
  gating already happens through the job dependency in `release.yml`.

This repo is user-owned rather than in an organization, so "restrict who can push" is not available and
there is one account with write access anyway. These rules protect against accident, not against a
second person; the real gate on a release is the check job.

## Cutting a release (ongoing)

1. Merge PRs to `main` with Conventional-Commit titles (**squash-merge** keeps the PR title as the
   commit subject, which is what semantic-release reads).
   - `feat: …` → minor, `fix: …`/`perf: …`/`revert: …` → patch, `feat!:` or a `BREAKING CHANGE:`
     footer → major.
   - `docs:`/`chore:`/`ci:`/`test:`/`refactor:` alone → **no release**. Docs that ship in the npm
     tarball reach the registry with the next real release.
2. When a human decides it is time to release, fast-forward `release` to `main`:
   ```bash
   git fetch origin
   git push origin origin/main:release   # fast-forward only; never force
   ```
   This is the release. It starts the workflow: the release check runs first, and semantic-release
   publishes only if every step passes.
3. Watch the run under the repo's **Actions** tab.
4. **After a successful publish, bring the release commit back to `main`.** semantic-release commits
   the regenerated `CHANGELOG.md` + `package.json` + `package-lock.json` to the branch it ran on, so
   `release` is now one commit ahead. Until that commit reaches `main`, `main`'s version is behind npm
   and the next fast-forward (step 2) is refused as a non-fast-forward.

   Push it straight to `main`, with the same account that owns `RELEASE_TOKEN`:

   ```bash
   git fetch origin
   git push origin origin/release:main
   ```

   **Not a pull request.** The `chore(release)` commit is authored by `semantic-release-bot` and is
   unsigned, and `yad-verified-commits` runs on every PR into any branch — so a sync-back PR is red by
   construction and could only be merged with an admin override. Pushing directly is the honest route,
   and it is the same bypass the release job itself already uses.

   If you do open one anyway, **merge it with a merge commit**. A squash or rebase rewrites that commit
   into a new SHA, `release` stops being an ancestor of `main`, and the next release's fast-forward
   breaks — the exact failure this step exists to prevent.

   The `[skip ci]` marker on the commit stops it from starting another release.

Run the same check locally before you decide, so a failure costs you a minute rather than a red
release:

```bash
npm run release-check
```

## The `next` channel — shipping v4 without moving anyone onto it

A major changes the shape of the files in people's projects. Nobody should be carried onto that by an
ordinary `npm install`, and `yad migrate` should be proven on real projects before it is the only thing
standing between a user and their ledger. So v4 goes to `next` first:

```bash
git fetch origin
git push origin origin/main:next     # publishes 4.0.0-next.N to yadflow@next
```

Anyone on 3.x keeps getting 3.x. People who want to try it opt in by name:

```bash
npm install yadflow@next -g
```

**Each pre-release needs the same sync-back as a stable one.** semantic-release commits
`chore(release): 4.0.0-next.N` to `next`, so it is immediately one commit ahead of `main` and the next
`git push origin origin/main:next` is refused. Bring it back the same way as step 4 above:

```bash
git push origin origin/next:main
```

Do **not** force-push `next` instead. That orphans the commit the `v4.0.0-next.N` tag points at,
semantic-release then derives the same version again, and npm rejects the republish. Note that `main`'s
`package.json` will read `4.0.0-next.N` between the first pre-release and promotion; that is correct,
not drift.

When `yad migrate` has been exercised on enough real projects, promote it by fast-forwarding `release`
in the normal way — semantic-release turns the last pre-release into the stable `4.0.0` and moves the
`latest` tag then, and only then.

Meanwhile the update banner does the other half. On a **major** jump it tells a 3.x user to preview the
migration against their own project before upgrading (`cli/update-notice.mjs`). It names
`npx yadflow@<new version> migrate` rather than the installed `yad migrate`, and the distinction
matters: a migration list ships inside the engine that introduces it, so the copy already installed
knows only its own steps and would report "nothing would change" for every project. `npx` runs the new
engine without installing it, and a preview writes nothing either way.

Minor and patch upgrades say nothing about migrating, because everything below a major is additive by
policy — a note on every release is how the one that matters gets ignored.

## Verify

```bash
npx yadflow@latest --version   # the new version
npm view yadflow dist-tags      # latest: <version>
```

The npm package page shows a green **Provenance** badge linking back to the `release.yml` run.

## Troubleshooting

- **Release job fails at the npm step (`EINVALIDNPMTOKEN` / OIDC error):** the trusted publisher isn't
  registered for this package, or the workflow filename/repo in the npm config doesn't match. Re-check
  step B.
- **Publish rejected with `E422 … repository visibility: "private"`:** npm provenance only works for a
  **public** source repo. Make the repo public, or set `publishConfig.provenance: false` to publish
  without an attestation.
- **PR won't merge ("review required"):** `main` is branch-protected with a required review. Approve the
  PR, or admin-merge: `gh pr merge <n> --squash --admin`. This gate is separate from the release job's
  own `chore(release)` commit, which bypasses protection via `RELEASE_TOKEN` (step D).
- **Release fails at the commit-back / `git push` step ("protected branch" / 403):** `RELEASE_TOKEN` is
  missing, expired, or its owner isn't in `main`'s branch-protection bypass list. Re-check step D. The
  job falls back to `GITHUB_TOKEN`, which cannot bypass the required-PR rule.
- **No release was cut after a merge to `main`:** expected — `main` never publishes. Only a
  fast-forward of `release` does (once E106 wires the workflow to it).
- **No release was cut from `release`:** the commits since the last tag were all non-releasing types
  (`docs:`, `chore:`, `ci:`, `test:`, `refactor:`). Only `feat`/`fix`/`perf`/`revert`/breaking trigger
  a version.
- **`git push origin origin/main:release` is rejected as non-fast-forward:** `release` carries a
  `chore(release)` commit from the last publish that `main` does not have. Bring that commit back to
  `main` first (a PR, or an admin push), then sync again. See the commit-back note under *How it works*.
- **Release job on `main` fails with `ERELEASEBRANCHES`:** the `release` branch is missing on origin.
  Recreate it at the last released commit: `git push origin <tag-commit>:refs/heads/release`.
- **A `2FA` prompt blocks automated publish:** it shouldn't — OIDC trusted publishing satisfies the
  publish requirement without an OTP. Only the one-time manual bootstrap (step A) prompts.
