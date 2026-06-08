# Releasing

The `sdlc` CLI is published to npm as **`@abdelrahmannasr/sdlc-workflow`**. Releases are **automated**
with [semantic-release](https://semantic-release.gitbook.io/): there is no manual `npm publish` in the
steady state. This doc covers the one-time bootstrap and the ongoing flow.

## How it works

`.github/workflows/release.yml` runs on every push to `main`:

1. install deps (`npm ci`) and run tests (`npm test`),
2. run `npx semantic-release`, which:
   - reads the [Conventional Commits](CONTRIBUTING.md) since the last release to pick the next version
     (`fix:` → patch, `feat:` → minor, `!`/`BREAKING CHANGE:` → major),
   - updates `CHANGELOG.md`,
   - **publishes to npm via tokenless Trusted Publishing (OIDC) with build provenance** — no `NPM_TOKEN`,
   - commits `chore(release): <version> [skip ci]` back to `main` and cuts a GitHub release.

Auth is the `id-token: write` permission in the workflow plus the npm trusted-publisher entry — there is
no long-lived secret to rotate. CI (`.github/workflows/ci.yml`) runs the Node 18/20/22 test matrix and a
tarball-leak smoke on every PR.

## One-time setup (already done once per package)

npm's trusted-publisher config lives on the package's settings page, so the package must exist first.

### A. Bootstrap with one manual publish

```bash
npm login                                          # handles 2FA OTP if enabled
git checkout feat/sdlc-cli                          # the branch that carries package.json
npm publish --access public --provenance=false      # provenance only works inside CI (OIDC)
```

This creates `@abdelrahmannasr/sdlc-workflow@0.1.0`. semantic-release derives the next version from git
tags (none yet → `1.0.0`), so the first automated release lands cleanly on top. *(If `--provenance=false`
is rejected, use `NPM_CONFIG_PROVENANCE=false npm publish --access public`.)*

### B. Register the trusted publisher

On **npmjs.com → the package page → Settings → Trusted Publisher → GitHub Actions**:

| Field | Value |
|-------|-------|
| Organization or user | `abdelrahmannasr` |
| Repository | `sdlc-workflow` |
| Workflow filename | `release.yml` *(filename only, not a path)* |
| Environment | *(leave blank)* |

Save. From here on, CI publishes tokenlessly with provenance.

### C. GitHub repo permissions

Repo → **Settings → Actions → General → Workflow permissions** → **Read and write permissions**, and
check **Allow GitHub Actions to create and approve pull requests**. (Needed for the `chore(release)`
commit and the GitHub release.)

## Cutting a release (ongoing)

1. Merge a PR to `main` with a Conventional-Commit title (**squash-merge** keeps the PR title as the
   commit subject, which is what semantic-release reads).
   - `feat: …` → minor, `fix: …`/`perf: …` → patch, `feat!:` or a `BREAKING CHANGE:` footer → major.
   - `docs:`/`chore:`/`ci:`/`test:`/`refactor:` alone → **no release**.
2. `release.yml` runs automatically. Watch it under the repo's **Actions** tab.

## Verify

```bash
npx @abdelrahmannasr/sdlc-workflow@latest --version   # the new version
npm view @abdelrahmannasr/sdlc-workflow dist-tags      # latest: <version>
```

The npm package page shows a green **Provenance** badge linking back to the `release.yml` run.

## Troubleshooting

- **Release job fails at the npm step (`EINVALIDNPMTOKEN` / OIDC error):** the trusted publisher isn't
  registered for this package, or the workflow filename/repo in the npm config doesn't match. Re-check
  step B.
- **Release commit can't be pushed to `main`:** workflow permissions aren't read/write (step C), or a
  branch-protection rule blocks the default `GITHUB_TOKEN`. This repo's pipeline is the *lean* variant
  (no signing key / PAT); if you later protect `main` with required signatures or required PRs, adopt the
  hardened pipeline from `abdelrahmannasr/wa-cloud-sdk` (SSH signing + a release PAT).
- **No release was cut:** the merged commits were all non-releasing types (`docs:`, `chore:`, …). That's
  expected — only `feat`/`fix`/`perf`/breaking trigger a version.
- **A `2FA` prompt blocks automated publish:** it shouldn't — OIDC trusted publishing satisfies the
  publish requirement without an OTP. Only the one-time manual bootstrap (step A) prompts.
