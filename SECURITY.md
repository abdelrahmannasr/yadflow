# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/abdelrahmannasr/yadflow/security/advisories/new)
— do **not** open a public issue for anything exploitable.

You can expect an acknowledgement within **7 days** and a fix or mitigation plan within **30 days**
for confirmed issues. Credit is given in the advisory and the changelog unless you ask otherwise.

## Supported versions

| Version | Supported |
|---------|-----------|
| latest major (2.x) | ✅ fixes released as patches via semantic-release |
| older majors | ❌ upgrade via `yad update` (pre-2.0 installs migrate in place) |

## What the supply chain looks like

- **Zero production dependencies.** The `yad` CLI runs on Node built-ins only; `npm audit
  --omit=dev` is enforced in CI to keep it that way.
- **Tokenless publishing.** Releases go to npm via Trusted Publishing (OIDC) with build
  provenance — there is no long-lived `NPM_TOKEN` to leak. Verify any installed version with
  `npm audit signatures`.
- **No stored credentials.** All platform access (GitHub/GitLab) runs as the local user through
  `gh`/`glab`; yadflow never stores or asks for tokens. `.sdlc/*.json` config holds names, paths,
  and URLs only.
- **Secret-scanned code packs.** Repomix packs of connected repos use its default Secretlint
  scanning; packs stay inside your repo (`.sdlc/code-context/`) and are never uploaded by yadflow.
- **Pinned CI.** Every GitHub Action, in this repo's workflows and in the workflows yadflow installs
  into yours, is pinned to a commit SHA with its version in a comment (`@<sha> # v7.0.1`). Every
  workflow sets a top-level `permissions:` block that is read-only, and a job that must write asks
  for it itself. A test fails the build if either rule is broken. Dependabot keeps this repo's own
  workflows current; the installed templates are bumped by hand in a yadflow release.

## Scope notes for researchers

The interesting attack surface is the **gate integrity** story: the check gates
(`skills/yad-checks/templates/checks/*.sh`), the review-gate ledger sync (`cli/gate.mjs`), and the
contract-lock hashing (`cli/epic-state.mjs`). A way to advance a gate without the required human
approvals, to widen the locked contract surface from a code repo without `Contract-Change`, or to
slip an unlinked change past `spec-link` is a vulnerability — we want to hear about it.
