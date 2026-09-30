# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/abdelrahmannasr/yadflow/security/advisories/new)
— do **not** open a public issue for anything exploitable.

You can expect an acknowledgement within **7 days** and a fix or mitigation plan within **30 days**
for confirmed issues. Credit is given in the advisory and the changelog unless you ask otherwise.

## Supported versions

Security fixes land on the **latest major only**, released as patches via semantic-release. There
are no fix releases for an older major.

| Version | Supported |
|---------|-----------|
| 4.x (latest major) | ✅ fixes released as patches |
| 3.x and older | ❌ upgrade to 4.x (see below) |

**To upgrade**, run these in the Product: `npm install -g yadflow` (the latest release), then
`yad migrate` (a preview of the state files the new release would rewrite — it writes nothing), then
`yad migrate --apply` (it rewrites them and keeps a `<file>.yad-orig` copy of each), then `yad update`
(it re-syncs the skills, gate scripts and CI files), then `yad doctor` to confirm. Coming from 3.x, read
[upgrading to 4.0](docs/migrations/upgrading-to-4.md) first.

## What the supply chain looks like

- **Zero production dependencies.** The `yad` CLI runs on Node built-ins only; `npm audit
  --omit=dev` is enforced in CI to keep it that way.
- **Tokenless publishing.** Releases go to npm via Trusted Publishing (OIDC) with build
  provenance — there is no long-lived `NPM_TOKEN` to leak. Verify any installed version with
  `npm audit signatures`.
- **No stored credentials.** All platform access (GitHub/GitLab) from your machine runs as the local
  user through `gh`/`glab`; yadflow never stores or asks for tokens. `.sdlc/*.json` config holds names,
  paths, and URLs only. Some CI features need a token, and then **you** create it as a CI secret
  (a CI variable on GitLab) — yadflow never sees it:

  | Secret | Used by | When you need it |
  |--------|---------|------------------|
  | `SDLC_GATE_TOKEN` | the Product's `yad-gate-sync` workflow (verified ledger mode) | when the Product's default branch is protected, so CI can push the ledger commit; on GitLab also for the scheduled sweep |
  | `YAD_PRODUCT_TOKEN` | the `product-checkout` step in a code repo's checks | when the code repo's CI should check the Product out (where `.sdlc/product-link.json` says) to run the Product-aware gates |
  | `GITLAB_TOKEN` or `SDLC_API_TOKEN` | the `verified-commits` gate on GitLab | GitLab only: its signature API cannot be read with the built-in job token |

- **Secret-scanned code packs.** Repomix packs of connected repos use its default Secretlint
  scanning; packs stay inside your repo (`.sdlc/code-context/`) and are never uploaded by yadflow.
- **CI action pins.** A **pin** is the exact version of a GitHub Action a workflow runs. What is true
  today:
  - This repo's own `ci.yml`, `release.yml` and `scorecard.yml` pin every action to a full commit
    SHA. Dependabot watches `.github/workflows/` and proposes updates.
  - This repo's copies of the shipped workflows (`yad-docs.yml`, `yad-gate-sync.yml`,
    `yad-verified-commits.yml`) pin actions to a major-version tag (for example `actions/checkout@v7`),
    not to a SHA.
  - The workflow templates yadflow writes into **your** repos (`skills/*/templates/github/*.yml`) also
    pin to major-version tags (`@v4`, `@v7`), not to SHAs. Dependabot in this repo does not watch them.
    If your policy needs SHA pins, pin them in your copy — `yad update` then reports that file as
    `modified` and leaves it alone.
  - Workflows declare least-privilege `permissions:` blocks. The one exception is the shipped
    `yad-product-checks.yml`, which has none and so gets your repository's default token permissions.

## Scope notes for researchers

The interesting attack surface is the **gate integrity** story:

- the check gates (`skills/yad-checks/templates/checks/*.sh`);
- the review-gate ledger sync (`cli/gate.mjs`) and the local gate verbs for a Product with no
  platform — `yad gate approve` / `comment` / `advance` (`cli/gate-local.mjs`);
- the **ledger guard**, which keeps anyone but CI from writing the gate ledger in verified mode: the CI
  check (`skills/yad-checks/templates/checks/ledger-guard.sh`), the agent hooks
  (`skills/yad-checks/templates/hooks/ledger-guard.mjs` and `ledger-guard-cursor.mjs`), and the git
  pre-commit half plus the hook entry point (`cli/hook.mjs`);
- the contract-lock hashing (`cli/epic-state.mjs`).

A way to advance a gate without the required human approvals, to write the CI-owned ledger past the
ledger guard, to widen the locked contract surface from a code repo without `Contract-Change`, or to
slip an unlinked change past `spec-link` is a vulnerability — we want to hear about it.
