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

Two branches take part:

- **`main`** — where PRs merge. Merging to `main` **never publishes**.
- **`release`** — the only branch semantic-release publishes from (`.releaserc.json` →
  `"branches": ["release"]`). A person moves it with a fast-forward: `git push origin main:release`.

`.github/workflows/release.yml` runs **only** on `release`. Nothing about a merge to `main` starts it.

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

### E. Protect the `release` branch — **not yet done**

E105 makes `release` the only branch that can publish, so pushing it is the act of shipping. Right now
nothing enforces that a human does it: `release` has **no branch protection and no ruleset**, so anyone
with write access can push or force-push it. Before E106 wires the workflow to `release`, add a ruleset
(Settings → Rules → Rulesets) targeting `release` with: **restrict who can push** (the release PAT owner
and repo admins), **block force pushes**, and **block deletions**. Deleting `release` also breaks the
clean skip on `main` — see Troubleshooting.

Until that is in place, "a release is a human decision" is a convention this doc states, not a rule the
platform enforces.

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
