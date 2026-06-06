---
name: sdlc-checks
description: 'Build-half Step C of the gated SDLC — the production-safety check gates. Wire and run three CI gates on a code repo: spec-link (every change links a real story/spec via its Task trailer), contract-check (a diff that changes the contract surface without a Contract-Change + an updated, re-locked contract FAILS and routes back to the architecture gate), and build/test/lint. The gates are CI-agnostic bash, invoked by GitHub Actions and GitLab CI. Use when the user says "wire the check gates", "run the gates", or "set up CI checks" for a repo.'
---

# SDLC — Check Gates (build-half Step C)

**Goal:** Install and run the three **check gates** that protect production for a code repo. They run
in CI on every PR/MR and must pass before merge (build plan §C). Each is a small, separate check:

1. **spec-link** — the change links a real story/spec: its commits carry a `Task: <story>-<task>`
   trailer (the convention `sdlc-implement` writes) whose `<story>` resolves to `specs/<story>/link.md`.
   No unlinked code reaches merge.
2. **contract-check** — if the diff changes the **contract surface** (the repo's quoted slice under
   `specs/<story>/contracts/`) without a `Contract-Change: yes` trailer **and** an updated, re-locked
   contract upstream, it **FAILS and routes back to the architecture gate**. The shared surface is
   never widened from inside a code repo (Phase 2 contract representation: delimited block + SHA-256 lock).
3. **build/test/lint** — standard quality stage; tests must actually exercise new behavior, not just pass.

The gates are **CI-agnostic bash** in `checks/`; thin pipeline configs invoke them on GitHub Actions
and GitLab CI. This step is **by hand** in Phase 3 — run the gates with the skill or let CI run them;
**nothing auto-advances**. The gates are blocking in CI, but the human still owns the merge (Step E).

## Conventions

- `{project-root}` resolves from the project working directory — the **product** repo (holds the
  canonical templates under this skill).
- Code repos are separate git repos under `{project-root}/demo-repos/<repo>/`
  (`config.yaml` `build.code_repos_root`).
- Canonical gate sources live in this skill's `templates/` (the source of truth that gets installed
  into each code repo):
  - `templates/checks/{spec-link,contract-check,build-test-lint}.sh`
  - `templates/github/sdlc-checks.yml` → installs to `.github/workflows/sdlc-checks.yml`
  - `templates/gitlab/.gitlab-ci.yml` → installs to repo root `.gitlab-ci.yml`
- The gates depend on the conventions from earlier steps: the `Task:`/`Contract-Change:` commit
  trailers (`sdlc-implement`), the `specs/<story>/link.md` + `contracts/` slice (`sdlc-spec`), and the
  locked `contract.md` (`sdlc-author-architecture`).

## Inputs

- `repo`  — the code repo to wire/run gates for (one of an epic's repos).
- `action` — `wire` (install the gates into the repo) | `run` (run the three gates now). Default `run`.
- `base`  — for `run`: the base ref to diff against (the PR/MR target; default the repo's default branch).

## On Activation

### Step 1 — Resolve the code repo
Map `repo` → `{project-root}/demo-repos/<repo>/`; confirm it is its own git repo. Operate inside it
with absolute paths.

### Step 2 — `wire` (install the gates)
Copy from this skill's `templates/`:
- `templates/checks/*.sh` → `<repo>/checks/` (and `chmod +x`).
- Detect the platform and drop **only the matching** CI config: GitHub → `templates/github/sdlc-checks.yml`
  to `<repo>/.github/workflows/sdlc-checks.yml`; GitLab → `templates/gitlab/.gitlab-ci.yml` to
  `<repo>/.gitlab-ci.yml`. (Drop both only if the repo genuinely uses both.)
- Ensure `<repo>/package.json` defines `lint`, `build`, `test` scripts (see `references/check-gates.md`
  for the canonical scripts). Do not overwrite existing, working scripts — merge.
Commit the wiring on the repo's default branch (it is shared infrastructure, not a task diff).

### Step 3 — `run` (run the gates now)
From inside the repo, run each gate against `base` and report PASS/FAIL per gate:
```
bash checks/spec-link.sh "<base>"
bash checks/contract-check.sh "<base>"
bash checks/build-test-lint.sh
```
A non-zero exit is a FAIL. Summarize which gates passed and, for any failure, the exact remediation
(spec-link: add the `Task:` trailer / spec; contract-check: route back to the architecture gate and
re-lock the contract; build/test/lint: fix the failing lint/test).

### Step 4 — Stop (no auto-advance)
Report the gate results. Passing gates do **not** merge anything — the AI review (Step D/E) and the
human engineer review (Step E) still own the merge. Do not edit the epic's `.sdlc/` state.

## Hard rules (build plan §C, Cross-cutting)

- **The gates are blocking in CI, advisory to no one.** A FAIL stops the merge; a PASS does not grant it.
- **Contract surface is never widened from a code repo.** contract-check routes surface changes back
  to the architecture gate; only an updated, re-locked contract + `Contract-Change: yes` may pass.
- **Tests must exercise behavior.** build/test/lint is not satisfied by empty or trivial tests.
- **Nothing auto-advances.** Phase 3 runs the gates by hand or in CI; the human owns the merge.

## Reference
- Gate definitions, the canonical scripts, CI wiring, and the convention map: `references/check-gates.md`.
- Commit-trailer conventions the gates read: `../sdlc-implement/references/implement-conventions.md`.
- Contract surface + hash recipe: `../sdlc-author-architecture/references/contract-format.md`.
