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
   - pushes the `vX.Y.Z` git tag and cuts a GitHub release with the notes.

Auth is the `id-token: write` permission in the workflow plus the npm trusted-publisher entry — there is
no long-lived secret to rotate. CI (`.github/workflows/ci.yml`) runs the Node 18/20/22 test matrix and a
tarball-leak smoke on every PR.

> **Note — no commit back to `main`.** The pipeline deliberately omits `@semantic-release/git`, so it
> never pushes a `chore(release)` commit to `main`. That keeps it compatible with branch protection
> (the required-review rule on `main` would otherwise reject the bot's push) and needs no PAT. The
> consequence: `package.json`'s `version` field on `main` is **not** auto-bumped — git **tags** are the
> source of truth, and the CLI reads its version from the `package.json` that semantic-release writes
> into the published tarball. If you ever want the version/CHANGELOG committed back, add
> `@semantic-release/git` plus a release PAT (or a branch-protection bypass) — the hardened path from
> `abdelrahmannasr/wa-cloud-sdk`.

Because `main` is protected with a required review, **merging each release PR needs an approval or an
admin merge** (`gh pr merge --squash --admin`). The release workflow itself no longer touches `main`, so
it is not blocked.

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
  PR, or admin-merge: `gh pr merge <n> --squash --admin`. The release workflow itself does not push to
  `main`, so it is never blocked by this.
- **No release was cut:** the merged commits were all non-releasing types (`chore:`, `ci:`, `test:`,
  `refactor:`). That's expected — only `feat`/`fix`/`perf`/`docs`/breaking trigger a version.
- **A `2FA` prompt blocks automated publish:** it shouldn't — OIDC trusted publishing satisfies the
  publish requirement without an OTP. Only the one-time manual bootstrap (step A) prompts.
