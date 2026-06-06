# Check gates — definitions, scripts, CI wiring, convention map

The three gates are the production-safety core of the build half (Phase 3 build plan §C). They are
deliberately small, separate, and CI-agnostic: plain bash in `checks/`, invoked by whatever CI the
repo uses. Each reads conventions established by earlier steps — it invents nothing.

## What each gate reads (the convention map)

| Gate | Reads | Source step |
|------|-------|-------------|
| spec-link | the `Task: <story>-<task>` commit trailer; `specs/<story>/link.md` | `sdlc-implement` (trailer), `sdlc-spec` (link.md) |
| contract-check | changed files under `specs/<story>/contracts/`; the `Contract-Change: yes` trailer; `link.md`'s pinned `contract-lock`; the product repo's `contract-lock.json` | `sdlc-author-architecture` (lock), `sdlc-spec` (slice + link), `sdlc-implement` (trailer) |
| build/test/lint | the repo's `npm run lint` / `npm run build` / `npm test` | the repo |

## 1. spec-link (`templates/checks/spec-link.sh`)

- Collects the `Task:` trailers across `<base>..HEAD`.
- **FAIL** if there is no `Task:` trailer (the change does not link a story/spec).
- For each `Task: <story>-<task>`, strips the `-T<NN>` suffix to get `<story>` and requires
  `specs/<story>/link.md` to exist. **FAIL** if missing.
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
    `sdlc-spec` so the slice matches the re-locked contract.
- This enforces the Phase 2 rule: the shared surface is owned upstream and is never widened from inside
  a code repo. The hash recipe is in `../sdlc-author-architecture/references/contract-format.md`.

## 3. build/test/lint (`templates/checks/build-test-lint.sh`)

- Runs `npm run lint`, `npm run build`, `npm test` in order; any non-zero exit fails the gate.
- Tests must actually exercise behavior (build plan §C) — an empty or trivially-passing suite does not
  satisfy the gate's intent.

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

## CI wiring (both platforms)

The gates run identically under either CI; the config just invokes the scripts with the PR/MR base.

- **GitHub Actions** — `templates/github/sdlc-checks.yml` → `.github/workflows/sdlc-checks.yml`. Three
  jobs run on `pull_request` with `fetch-depth: 0`, passing `origin/${{ github.base_ref }}` as base.
- **GitLab CI** — `templates/gitlab/.gitlab-ci.yml` → repo-root `.gitlab-ci.yml`. Three stages run on
  `merge_request_event` with `GIT_DEPTH: 0`, passing `origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`.

## Running by hand (Phase 3 is manual)

From inside the code repo, against the PR/MR base (e.g. `master`):

```bash
bash checks/spec-link.sh master
bash checks/contract-check.sh master
bash checks/build-test-lint.sh
```

## Proven behavior (demo: `demo-repos/backend`, story EP-istifta-inquiries-S01)

- **Good PR** (task branch with a `Task:` trailer, no surface change, passing tests) → all three **PASS**.
- **Bad PR A** (a code change committed with **no** `Task:` trailer) → spec-link **FAILS**.
- **Bad PR B** (edits `specs/.../contracts/inquiries.md` to widen the surface, with a `Task:` trailer
  but **no** `Contract-Change`) → spec-link passes, contract-check **FAILS** and routes back to the
  architecture gate.
