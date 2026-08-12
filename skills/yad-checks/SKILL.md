---
name: yad-checks
description: 'Build-half Step C of the gated SDLC — the production-safety check gates. Wire and run the CI gates on a code repo: spec-link (every change links a real story/spec via its Task trailer), contract-check (a diff that changes the contract surface without a Contract-Change + an updated, re-locked contract FAILS and routes back to the architecture gate), build/test/lint, verified-commits (no unverified commits from unverified users — platform-Verified signature + roster-allowlisted author, on the hub and every repo), and the Phase 6 feature-thread gates lineage-check / epic-open / reconcile-debt (a change links a real threaded epic; a sealed epic refuses new behaviour; a thread with open hotfix debt is frozen until paid). The gates are CI-agnostic bash, invoked by GitHub Actions and GitLab CI. Use when the user says "wire the check gates", "run the gates", "require signed commits", or "set up CI checks" for a repo.'
---

# SDLC — Check Gates (build-half Step C)

**Goal:** Install and run the **check gates** that protect production for a code repo. They run
in CI on every PR/MR and must pass before merge (build plan §C). Each is a small, separate check:

1. **spec-link** — the change links a real story/spec: its commits carry a `Task: <story>-<task>`
   trailer (the convention `yad-implement` writes) whose `<story>` resolves to `specs/<story>/link.md`.
   No unlinked code reaches merge.
2. **contract-check** — if the diff changes the **contract surface** (the repo's quoted slice under
   `specs/<story>/contracts/`) without a `Contract-Change: yes` trailer **and** an updated, re-locked
   contract upstream, it **FAILS and routes back to the architecture gate**. The shared surface is
   never widened from inside a code repo (Phase 2 contract representation: delimited block + SHA-256 lock).
   Every story whose slice the diff touches is checked, not just the first — see `references/check-gates.md`.
3. **build/test/lint** — standard quality stage; tests must actually exercise new behavior, not just pass.
   The CI job sets `YAD_TEST_MAX_WORKERS` (default `2`); the gate caps jest/vitest test concurrency at
   that and is a no-op for other runners (see `references/check-gates.md`).
4. **verified-commits** — no unverified commits from unverified users: every commit in the range must
   carry a signature the platform marks **Verified** AND be authored by a known identity
   (`.sdlc/verified-authors`, generated from the hub roster's `email` fields). Enforced on the
   **product hub and every connected repo**; runs on PRs/MRs only, so the gate-sync bot's direct
   ledger pushes are unaffected (never replace it with a default-branch push rule — see
   `references/check-gates.md` §4).
5. **lineage-check** (Phase 6) — the change's owning epic is a valid node in a **feature thread**: a
   `change`/`defect`/`hotfix` epic must thread to a real `parent`. Builds on spec-link's story→epic
   resolution; the every-code-change-has-a-threaded-epic enforcement.
6. **epic-open** (Phase 6, the staleness preventer) — an epic is **sealed** once every story is
   `shipped`; a commit targeting a sealed epic **FAILS**, forcing new behaviour into a new threaded
   change-epic (so the front artifacts can never go stale).
7. **reconcile-debt** (Phase 6) — a hotfix that shipped first opens debt; the **next** change on its
   thread **FAILS** until the debt is paid (artifacts updated + a regression test added).

The Phase 6 gates read the owning epic in the **product hub** via `specs/<story>/link.md`'s
`product-repo` path (like contract-check), and degrade to a PASS-with-note when the hub is not reachable
from CI. See `references/check-gates.md` and `skills/yad-change`.

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
  - `templates/checks/ledger-guard.sh` → **hub-only** gate, active **only in bridge mode** — hub.json
    carries BOTH a `platform` and `bridge_enabled` (or the legacy `bridge`) true, the same predicate
    `isBridge` (`cli/gate.mjs`) applies, so the gate and the CLI can never disagree about who owns the
    ledger (#186). A no-op otherwise, when humans legitimately own it. On review PRs it FAILs any
    commit that touches the
    CI-owned gate ledger (`.sdlc/{state,approvals,comments,hub-prs}.json`, `reviews/*.md`) unless it
    is a **verified gate-bot commit** — bot-authored AND platform-Verified, since author text alone is
    spoofable. `.sdlc/contract-lock.json` is artifact-side and exempt. So is a **new epic's seed**:
    no CI path can create a ledger (`gate ci` only *advances* an existing chain, at merge, on the
    default branch), so an epic whose `.sdlc/state.json` is absent from the base ref may be created by
    a human on its first review PR/MR — **creation, not mutation** (#162). Once the ledger is on the
    default branch the guard is absolute again. Runs in `yad-hub-checks`
    alongside `verified-commits` (which waives the allowlist for the bot but still requires its
    signature). See `yad-hub-bridge`.
  - `templates/hooks/ledger-guard.sh` → **hub-only** agent guardrail, active **only in bridge mode**
    (the same `isBridgeHub` predicate). Not a CI gate: it is a **harness hook** that refuses an agent's
    edit to the CI-owned ledger at the moment it is attempted and names `yad gate open` instead — the
    local half of `checks/ledger-guard.sh` (#171). Installed to `<hub>/hooks/ledger-guard.sh` with the
    `PreToolUse` entry in `.claude/settings.json`. Fails OPEN; see "Step 2b" below.
  - `templates/github/yad-verified-commits.yml` + `templates/gitlab/yad-verified-commits.gitlab-ci.yml`
    → the standalone hub-side verified-commits CI (installed by `yad check --fix` with the hub wiring)
  - `templates/github/yad-checks.yml` → installs to `.github/workflows/yad-checks.yml` (marked `# yad-managed: yad-checks`)
  - `templates/gitlab/yad-checks.gitlab-ci.yml` → includable fragment, installs to `.gitlab/ci/yad-checks.yml`
  - `templates/gitlab/gitlab-ci.include-root.yml` → minimal root written only when no root `.gitlab-ci.yml` exists
  - `templates/gitlab/.gitlab-ci.yml` → legacy standalone root (greenfield single-file option)
- The gates depend on the conventions from earlier steps: the `Task:`/`Contract-Change:` commit
  trailers (`yad-implement`), the `specs/<story>/link.md` + `contracts/` slice (`yad-spec`), and the
  locked `contract.md` (`yad-architecture`).

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
  `.github/workflows/yad-checks.yml`, which GitHub runs independently of every other workflow, so
  "merge" reduces to "do not collide on the path".
  - No file at our path → copy `templates/github/yad-checks.yml` verbatim.
  - A file at our path whose **first line is `# yad-managed: yad-checks`** → it is ours; refresh it
    (no-op if unchanged). 
  - A **foreign** file occupies that path/name → write to a non-colliding filename
    (`yad-checks.gen.yml`) and ensure its `name:` does not clash. Never merge jobs into a foreign
    workflow; never edit one.
  - Also install `templates/github/yad-update-guard.yml` → `.github/workflows/yad-update-guard.yml`
    (marker `# yad-managed: yad-checks`) — the push-on-default integrity gate for direct-to-default
    commits (`yad update --push`); it runs only `verified-commits` + `commit-message`. Same
    own-a-file rules as above.

  **GitLab** (detect by a root `.gitlab-ci.yml` and/or `.gitlab/ci/*.yml`): install the includable
  fragment `templates/gitlab/yad-checks.gitlab-ci.yml` → `<repo>/.gitlab/ci/yad-checks.yml` (its jobs
  carry `needs: []` and no `stage:`, so a foreign root `stages:` cannot break or reorder them).
  - No root `.gitlab-ci.yml` → write `templates/gitlab/gitlab-ci.include-root.yml` to
    `<repo>/.gitlab-ci.yml` (a minimal root that only `include:`s our fragment).
  - Root exists → read its top-level `include:`. Add the `include:` key if absent; append
    `- local: '.gitlab/ci/yad-checks.yml'` if the key exists but the entry is missing; **no-op** if it
    is already listed. Touch nothing else in the root.
  - Also install `templates/gitlab/yad-update-guard.gitlab-ci.yml` → `<repo>/.gitlab/ci/yad-update-guard.yml`
    (marker `# yad-managed-include: yad-checks`) — the push-on-default integrity gate — and append
    `- local: '.gitlab/ci/yad-update-guard.yml'` to the root `include:` the same additive, idempotent way.
  - If the existing YAML cannot be parsed safely → **STOP** and print the exact include snippet for the
    human to paste (graceful degradation — never guess-edit a pipeline you cannot parse).
  - The legacy standalone `templates/gitlab/.gitlab-ci.yml` is retained only for a clean greenfield repo
    that prefers a single self-contained file; the include path above is the default.
  - **Tag-locked runners** (`run_untagged: false`, common on self-hosted): the fragment's jobs run a
    docker image, so set a `YAD_RUNNER_TAGS` CI/CD variable (e.g. `dind_runner`) to route them — the
    `default:` block emits `tags: [$YAD_RUNNER_TAGS]`. When unset, current GitLab (≥15) drops the
    empty-expanded tag so the jobs run untagged (gitlab.com shared runners); older versions may
    strand them `pending`, in which case set the variable to a real tag. The variable lives in
    project settings, so it survives every `yad` sync. Single value only — `tags: [$VAR]` is one tag
    equal to the whole variable, not a comma-split.

- Ensure `<repo>/package.json` defines `lint`, `build`, `test` scripts (see `references/check-gates.md`
  for the canonical scripts). **Only ADD a missing script; never overwrite an existing one.**

Re-running `wire` is **idempotent** — markers (`# yad-managed: yad-checks`,
`# yad-managed-include: yad-checks`) and the include-entry check make a second run a no-op.
Commit the wiring on the repo's default branch (it is shared infrastructure, not a task diff).

**The hub is wired the same way.** `repo: hub` wires the hub repo itself (platform from `.sdlc/hub.json`)
with a hub-flavored gate set — see "Wiring the hub" in `references/check-gates.md`.

**The hub also gets the agent guardrail** (see below): `templates/hooks/ledger-guard.sh` →
`<hub>/hooks/ledger-guard.sh`, plus the `PreToolUse` entry in `.claude/settings.json`. `yad setup`
and `yad check --fix` install both; there is nothing to do by hand.

### Step 2b — the agent guardrail (harness hooks, bridge mode only)
The CI gates speak at CI time. That is too late for one failure the field kept hitting (#171): in
bridge mode the gate ledger is **CI-owned**, so an agent that hand-edits
`epics/*/.sdlc/state.json` only finds out twenty minutes later, from a `ledger-guard` FAIL with
nothing connecting cause to effect — and by then the write has to be reverted before the review
PR/MR can go green.

`hooks/ledger-guard.sh` is the local half of that same rule. It runs as a **harness hook** before a
file-editing tool call and refuses the write up front, naming the command that owns the transition
(`yad gate open`), so the agent corrects itself instead of failing a pipeline.

- **Harness-agnostic by contract.** The script only locates `yad` and hands the tool payload to
  `yad hook ledger-guard`: **stdin** is a JSON tool-call payload, **exit 0** allows, **exit 2**
  denies with the reason on stderr. Claude Code's `PreToolUse` protocol is exactly that, so no
  adapter logic is needed; another harness needs only those two exit codes.
- **Same scope as the CI gate**, deliberately: guarded are `epics/*/.sdlc/{state,approvals,comments,hub-prs}.json`
  and `epics/*/reviews/*.md`; exempt are `contract-lock.json`, `change.json`, and every artifact.
  A **new** epic's ledger is exempt too — creation, not mutation (#162).
- **A no-op without the bridge.** There the ledger is locally owned and the hand-edit the authoring
  skills describe is *correct*, so nothing is wired and nothing is blocked.
- **It fails OPEN** — no `yad`, no hub, an unreadable config, an unparseable payload all ALLOW, with
  a note on stderr. `ledger-guard` in CI fails *closed* and remains the authority. `YAD_HOOK_DISABLE=1`
  skips one command.
- **Known gap:** a `Bash` tool call (`sed -i epics/…`) is not intercepted — matching it would mean
  parsing shell. The CI gate catches it.

`yad doctor` reports the guardrail as `agent ledger guard wired` / `not wired` on a bridge hub.
See `references/check-gates.md` §"The agent guardrail".

### Step 3 — `run` (run the gates now)
From inside the repo, run each gate against `base` and report PASS/FAIL per gate:
```
bash checks/spec-link.sh "<base>"
bash checks/contract-check.sh "<base>"
bash checks/build-test-lint.sh
```
`<base>` is optional for the gates that take one (`build-test-lint` takes none) — omitted, the gate
resolves the trunk (configured `default_branch`, else `origin/HEAD`, else `origin/main`) and prints
the base it chose; pass it (or `SDLC_BASE`) when the PR/MR targets another branch.

A non-zero exit is a FAIL. Summarize which gates passed and, for any failure, the exact remediation
(spec-link: add the `Task:` trailer / spec; contract-check: route back to the architecture gate and
re-lock the contract; build/test/lint: fix the failing lint/test).

### Step 4 — Report; the advance decision belongs to the dial (Phase 4)
Report the gate results. Passing gates do **not** merge anything — the AI review (Step D/E) and the
human engineer review (Step E) still own the merge. This skill never edits the epic's `.sdlc/` state.

- **Run standalone** (the Phase 3 default): **stop** here. A clean pass does not advance anything; a
  human takes the next step.
- **Run by the orchestrator** (`yad-run`, Phase 4): this skill still just reports PASS/FAIL — the
  *advance decision* is the orchestrator's, read from the `checks` step's `automation` dial. On a clean
  pass with `checks` earned to `machine_advance`, `yad-run` advances to `engineer-review` on its own;
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
- Commit-trailer conventions the gates read: `../yad-implement/references/implement-conventions.md`.
- Contract surface + hash recipe: `../yad-architecture/references/contract-format.md`.
