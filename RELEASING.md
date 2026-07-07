# Releasing

The `yad` CLI is published to npm as **`yadflow`**. Releases are **automated**
with [semantic-release](https://semantic-release.gitbook.io/): there is no manual `npm publish` in the
steady state. This doc covers the one-time bootstrap and the ongoing flow.

> **Renamed at v1.4.0.** The package was previously published as `@abdelrahmannasr/sdlc-workflow`
> (through v1.3.2); that scoped package is **deprecated** and points here. Same CLI, same repo —
> the GitHub repo was renamed `sdlc-workflow` → `yadflow` (old URLs redirect). The trusted-publisher
> registration is per-package, so `yadflow` needed its own bootstrap (steps A–B below).

## How it works

`.github/workflows/release.yml` runs on every push to `main`:

1. install deps (`npm ci`) and run tests (`npm test`),
2. run `npx semantic-release`, which:
   - reads the [Conventional Commits](CONTRIBUTING.md) since the last release to pick the next version
     (`docs:`/`fix:` → patch, `feat:` → minor, `!`/`BREAKING CHANGE:` → major),
   - regenerates `CHANGELOG.md` and ships it **inside the npm tarball**,
   - **publishes to npm via tokenless Trusted Publishing (OIDC) with build provenance** — no `NPM_TOKEN`,
   - commits the regenerated `CHANGELOG.md` + `package.json` + `package-lock.json` back to `main`
     (`@semantic-release/git`, authenticated with `RELEASE_TOKEN` — see step D),
   - pushes the `vX.Y.Z` git tag and cuts a GitHub release with the notes.

Auth is the `id-token: write` permission in the workflow plus the npm trusted-publisher entry — there is
no long-lived secret to rotate. CI (`.github/workflows/ci.yml`) runs the Node 18/20/22 test matrix and a
tarball-leak smoke on every PR.

> **Note — commit back to `main` (hardened path).** The pipeline includes `@semantic-release/git`, so
> after publishing it commits the regenerated `CHANGELOG.md`, `package.json`, and `package-lock.json`
> back to `main` as a `chore(release): X.Y.Z [skip ci]` commit. This keeps the in-repo changelog and
> `version` field in lockstep with the git tags and the published npm artifact.
>
> Because `main` is protected with a required-PR rule that the default `GITHUB_TOKEN` **cannot** bypass,
> the release job authenticates with a **`RELEASE_TOKEN`** secret (see step D) — a PAT owned by a user in
> the branch-protection bypass list. The `[skip ci]` marker on the release commit stops it from
> re-triggering the workflow (a PAT push, unlike a `GITHUB_TOKEN` push, would otherwise start a new run).
> If `RELEASE_TOKEN` is unset the job falls back to `GITHUB_TOKEN` and the commit-back push will be
> **rejected**, failing the release — so provision the secret before relying on this path.

Because `main` is protected with a required review, **merging each release PR needs an approval or an
admin merge** (`gh pr merge --squash --admin`). The release job's own `chore(release)` commit is the only
automated write to `main`, and it bypasses protection via `RELEASE_TOKEN`.

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

`@semantic-release/git` pushes the `chore(release)` commit to `main`, which the required-PR rule blocks
for the default `GITHUB_TOKEN`. Provision a bypass token:

1. Create a **fine-grained PAT** (GitHub → Settings → Developer settings → Fine-grained tokens), scoped
   to the `yadflow` repo, with **Contents: Read and write**, **Pull requests: Read and write**, and
   **Issues: Read and write** (the last two let `@semantic-release/github` comment on released PRs/issues).
   The token owner must be a user that **bypasses `main`'s branch protection** (a repo admin does).
2. Add it as a repo secret: **Settings → Secrets and variables → Actions → New repository secret**, named
   **`RELEASE_TOKEN`**.
3. Ensure the bypass list for `main` includes that user (Settings → Branches/Rules).

Rotate the PAT before it expires; until `RELEASE_TOKEN` exists the release will fail at the commit-back
step (the workflow falls back to `GITHUB_TOKEN`, which cannot bypass protection).

## Cutting a release (ongoing)

1. Merge a PR to `main` with a Conventional-Commit title (**squash-merge** keeps the PR title as the
   commit subject, which is what semantic-release reads).
   - `feat: …` → minor, `fix: …`/`perf: …`/`docs: …` → patch, `feat!:` or a `BREAKING CHANGE:` footer → major.
   - `docs:` triggers a patch so README/docs that ship in the npm tarball reach the registry without a manual nudge (custom `releaseRules` in `.releaserc.json`).
   - `chore:`/`ci:`/`test:`/`refactor:` alone → **no release**.
2. `release.yml` runs automatically. Watch it under the repo's **Actions** tab.

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
- **No release was cut:** the merged commits were all non-releasing types (`chore:`, `ci:`, `test:`,
  `refactor:`). That's expected — only `feat`/`fix`/`perf`/`docs`/breaking trigger a version.
- **A `2FA` prompt blocks automated publish:** it shouldn't — OIDC trusted publishing satisfies the
  publish requirement without an OTP. Only the one-time manual bootstrap (step A) prompts.
