---
name: sdlc-checks
description: 'Build-half Step C of the gated SDLC — the production-safety check gates. Wire and run the CI gates on a code repo: spec-link (every change links a real story/spec via its Task trailer), contract-check (a diff that changes the contract surface without a Contract-Change + an updated, re-locked contract FAILS and routes back to the architecture gate), build/test/lint, and verified-commits (no unverified commits from unverified users — platform-Verified signature + roster-allowlisted author, on the hub and every repo). The gates are CI-agnostic bash, invoked by GitHub Actions and GitLab CI. Use when the user says "wire the check gates", "run the gates", "require signed commits", or "set up CI checks" for a repo.'
---

# SDLC — Check Gates (build-half Step C)

**Goal:** Install and run the **check gates** that protect production for a code repo. They run
in CI on every PR/MR and must pass before merge (build plan §C). Each is a small, separate check:

1. **spec-link** — the change links a real story/spec: its commits carry a `Task: <story>-<task>`
   trailer (the convention `sdlc-implement` writes) whose `<story>` resolves to `specs/<story>/link.md`.
   No unlinked code reaches merge.
2. **contract-check** — if the diff changes the **contract surface** (the repo's quoted slice under
   `specs/<story>/contracts/`) without a `Contract-Change: yes` trailer **and** an updated, re-locked
   contract upstream, it **FAILS and routes back to the architecture gate**. The shared surface is
   never widened from inside a code repo (Phase 2 contract representation: delimited block + SHA-256 lock).
3. **build/test/lint** — standard quality stage; tests must actually exercise new behavior, not just pass.
4. **verified-commits** — no unverified commits from unverified users: every commit in the range must
   carry a signature the platform marks **Verified** AND be authored by a known identity
   (`.sdlc/verified-authors`, generated from the hub roster's `email` fields). Enforced on the
   **product hub and every connected repo**; runs on PRs/MRs only, so the gate-sync bot's direct
   ledger pushes are unaffected (never replace it with a default-branch push rule — see
   `references/check-gates.md` §4).

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
  - `templates/checks/{spec-link,contract-check,build-test-lint,verified-commits}.sh`
  - `templates/github/sdlc-verified-commits.yml` + `templates/gitlab/sdlc-verified-commits.gitlab-ci.yml`
    → the standalone hub-side verified-commits CI (installed by `sdlc check --fix` with the hub wiring)
  - `templates/github/sdlc-checks.yml` → installs to `.github/workflows/sdlc-checks.yml` (marked `# sdlc-managed: sdlc-checks`)
  - `templates/gitlab/sdlc-checks.gitlab-ci.yml` → includable fragment, installs to `.gitlab/ci/sdlc-checks.yml`
  - `templates/gitlab/gitlab-ci.include-root.yml` → minimal root written only when no root `.gitlab-ci.yml` exists
  - `templates/gitlab/.gitlab-ci.yml` → legacy standalone root (greenfield single-file option)
- The gates depend on the conventions from earlier steps: the `Task:`/`Contract-Change:` commit
  trailers (`sdlc-implement`), the `specs/<story>/link.md` + `contracts/` slice (`sdlc-spec`), and the
  locked `contract.md` (`sdlc-author-architecture`).

## Inputs

- `repo`  — the code repo to wire/run gates for (one of an epic's repos), or `hub` to wire the product hub itself.
- `action` — `wire` (install the gates into the repo) | `run` (run the three gates now). Default `run`.
- `base`  — for `run`: the base ref to diff against (the PR/MR target; default the repo's default branch).

## On Activation

### Step 1 — Resolve the code repo
Map `repo` → `{project-root}/demo-repos/<repo>/` (or the registry `path` in `.sdlc/repos.json`); confirm
it is its own git repo. Operate inside it with absolute paths. For `repo: hub`, the target is
`{project-root}` itself and the platform comes from `.sdlc/hub.json` — see "Wiring the hub" in
`references/check-gates.md`.

### Step 2 — `wire` (install the gates, syncing with any existing CI)
Copy from this skill's `templates/`:
- `templates/checks/*.sh` → `<repo>/checks/` (and `chmod +x`).
- Detect the platform and **merge — never clobber — the matching** CI config. Inspect what is already
  there first; the principle is **additive: never edit a foreign CI file**.

  **GitHub** (detect by any `.github/workflows/*.y*ml`): our gates live in their own
  `.github/workflows/sdlc-checks.yml`, which GitHub runs independently of every other workflow, so
  "merge" reduces to "do not collide on the path".
  - No file at our path → copy `templates/github/sdlc-checks.yml` verbatim.
  - A file at our path whose **first line is `# sdlc-managed: sdlc-checks`** → it is ours; refresh it
    (no-op if unchanged). 
  - A **foreign** file occupies that path/name → write to a non-colliding filename
    (`sdlc-checks.gen.yml`) and ensure its `name:` does not clash. Never merge jobs into a foreign
    workflow; never edit one.

  **GitLab** (detect by a root `.gitlab-ci.yml` and/or `.gitlab/ci/*.yml`): install the includable
  fragment `templates/gitlab/sdlc-checks.gitlab-ci.yml` → `<repo>/.gitlab/ci/sdlc-checks.yml` (its jobs
  carry `needs: []` and no `stage:`, so a foreign root `stages:` cannot break or reorder them).
  - No root `.gitlab-ci.yml` → write `templates/gitlab/gitlab-ci.include-root.yml` to
    `<repo>/.gitlab-ci.yml` (a minimal root that only `include:`s our fragment).
  - Root exists → read its top-level `include:`. Add the `include:` key if absent; append
    `- local: '.gitlab/ci/sdlc-checks.yml'` if the key exists but the entry is missing; **no-op** if it
    is already listed. Touch nothing else in the root.
  - If the existing YAML cannot be parsed safely → **STOP** and print the exact include snippet for the
    human to paste (graceful degradation — never guess-edit a pipeline you cannot parse).
  - The legacy standalone `templates/gitlab/.gitlab-ci.yml` is retained only for a clean greenfield repo
    that prefers a single self-contained file; the include path above is the default.

- Ensure `<repo>/package.json` defines `lint`, `build`, `test` scripts (see `references/check-gates.md`
  for the canonical scripts). **Only ADD a missing script; never overwrite an existing one.**

Re-running `wire` is **idempotent** — markers (`# sdlc-managed: sdlc-checks`,
`# sdlc-managed-include: sdlc-checks`) and the include-entry check make a second run a no-op.
Commit the wiring on the repo's default branch (it is shared infrastructure, not a task diff).

**The hub is wired the same way.** `repo: hub` wires the hub repo itself (platform from `.sdlc/hub.json`)
with a hub-flavored gate set — see "Wiring the hub" in `references/check-gates.md`.

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

### Step 4 — Report; the advance decision belongs to the dial (Phase 4)
Report the gate results. Passing gates do **not** merge anything — the AI review (Step D/E) and the
human engineer review (Step E) still own the merge. This skill never edits the epic's `.sdlc/` state.

- **Run standalone** (the Phase 3 default): **stop** here. A clean pass does not advance anything; a
  human takes the next step.
- **Run by the orchestrator** (`sdlc-run`, Phase 4): this skill still just reports PASS/FAIL — the
  *advance decision* is the orchestrator's, read from the `checks` step's `automation` dial. On a clean
  pass with `checks` earned to `machine_advance`, `sdlc-run` advances to `engineer-review` on its own;
  on any FAIL it halts and pulls in a human (build plan §B). **What the gates check is unchanged** —
  only who decides to proceed after a clean pass.

## Hard rules (build plan §C, Cross-cutting)

- **The gates are blocking in CI, advisory to no one.** A FAIL stops the merge; a PASS does not grant it.
- **Contract surface is never widened from a code repo.** contract-check routes surface changes back
  to the architecture gate; only an updated, re-locked contract + `Contract-Change: yes` may pass.
- **Tests must exercise behavior.** build/test/lint is not satisfied by empty or trivial tests.
- **The gate never advances itself.** A FAIL always halts. A clean PASS advances only when the
  orchestrator's `checks` dial is `machine_advance` (earned) — and only as far as the engineer review,
  which is always human. Standalone, the gate still stops and the human owns the merge.

## Reference
- Gate definitions, the canonical scripts, CI wiring, and the convention map: `references/check-gates.md`.
- Commit-trailer conventions the gates read: `../sdlc-implement/references/implement-conventions.md`.
- Contract surface + hash recipe: `../sdlc-author-architecture/references/contract-format.md`.
