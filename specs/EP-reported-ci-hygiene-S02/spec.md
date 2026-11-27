# Spec — EP-reported-ci-hygiene-S02: record the two advisories bundled inside npm as known and ignored

Story: `EP-reported-ci-hygiene-S02` (epic `EP-reported-ci-hygiene`), engine repo. Item: engine code-scanning
alert 19 (OpenSSF Scorecard, "Vulnerabilities" check, score 8). This epic is on the chore route, so it
defines no contract surface; this story touches none.

## Problem

Scorecard's Vulnerabilities check scans `package-lock.json` with OSV-Scanner and reports two advisories:

| Advisory | Package | Version in the lockfile | Fixed in | Severity |
|---|---|---|---|---|
| GHSA-3g3m-2fjr-6pw4 | glob | 13.0.6 | 14.0.2 | medium |
| GHSA-g3hv-75wg-m249 | minimatch | 10.2.5 | 11.0.1 | medium |

Both sit at `node_modules/npm/node_modules/…`. npm 11.21.2 bundles them: a bundled package ships inside
its parent and cannot be changed from outside it, so the `overrides: { minimatch: ^11.0.8 }` already in
`package.json` fixes the top-level copy (11.0.9) but not this one. npm is pulled in only by
`@semantic-release/npm` (`npm: ^11.6.2`), a dev-only dependency the release job uses. yadflow's published
package has no runtime dependencies, so no user installs either package. No npm release bundles a fixed
version yet: 11.21.3 and 12.2.3 still bundle glob `^13.0.6` and minimatch `^10.2.5` (checked 2026-11-26).

## Requirements

- R1. A new `osv-scanner.toml` at the engine root, next to `package-lock.json`, holds one
  `[[IgnoredVulns]]` entry for each advisory, with its `id`, `ignoreUntil = 2027-02-27` and a `reason`.
- R2. Each `reason` says, in plain words: the package is bundled inside npm, which only
  `@semantic-release/npm` pulls in, for the release job; it is not in the published yadflow package; no npm
  release bundles a fixed version yet.
- R3. A comment at the top of the file says what the file is for and when to look at it again: on the
  `ignoreUntil` date, or as soon as an npm release bundles glob ≥ 14.0.2 and minimatch ≥ 11.0.1.
- R4. The file is not in the published npm package. `package.json` `files` is an allow-list (`bin/`,
  `cli/`, `skills/`, `README.md`, `LICENSE`, `CHANGELOG.md`), so a root file is left out without a change.
- R5. After merge, the next Scorecard run on `main` shows alert 19 as fixed.

## Non-goals

- Upgrading or removing `semantic-release`, or changing the release job.
- Ignoring any other advisory, or ignoring by package (`[[PackageOverrides]]`), which would hide future
  advisories in the same package.

## Clarifications

### Session 2026-11-27

- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (the person, 2026-11-27). The story qualifies: chore route, no contract, no high-risk file (the engine has no risk map).
- Q: How long should the ignore last? → A: three months, `ignoreUntil = 2027-02-27` (the person, 2026-11-27). Ignoring a known advisory is a security trade-off, so the date is the person's.
- Q: Does the Scorecard version this repo runs read `osv-scanner.toml`? → A: the Scorecard check docs say so: "To ignore, create an `osv-scanner.toml` file next to the dependency manifest (e.g. package-lock.json) and specify the ID to ignore and reason" (https://github.com/ossf/scorecard/blob/main/docs/checks.md). `.github/workflows/scorecard.yml` runs `ossf/scorecard-action` v2.6.0, which bundles Scorecard v5.7.0. The docs name no version for the feature, so R5, the next Scorecard run, is the proof.

## Plan

Write the one file. Check its syntax with a TOML parser, and with OSV-Scanner if it is on this machine.
After merge, read alert 19's state from the code-scanning API once the Scorecard workflow has run on `main`.

## Tasks

<!-- yad:tasks -->
## T01 — osv-scanner.toml ignores the two bundled advisories, with reasons and an expiry
**Files:**
- `osv-scanner.toml`

**Done when:** R1–R4 hold, the file parses as TOML, and the full test suite passes.
<!-- /yad:tasks -->
