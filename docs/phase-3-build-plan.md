# Phase 3 — Build Plan

Builds on Phase 0 (research), Phase 1 (module + gate), Phase 2 (full front half: epic → review → architecture+contract → review → UI → review → stories → review → `ready-for-build`).

Phase 3 is the **build half**: turning approved, repo-tagged stories into shipped code, with all the gates that protect production. This is the largest and riskiest phase — it touches real code, real PRs, and real CI. Same rules throughout: tools via their real interface (Spec Kit + Impeccable are slash-commands, confirm Repomix), all state in files, smallest-useful-first, and **nothing in this phase auto-advances** — automation is a later phase.

---

## Goal of Phase 3

From a story marked `ready-for-build`, run the per-repo build pipeline by hand, end to end, on **one repo, one story**, until a PR/MR is shipped through all gates. Prove the whole chain works on a single slice before widening to multi-repo.

End state: a story produces a spec/plan/tasks in its repo, an engineer (with `dev` agent help) implements one atomic task as one small PR/MR, and that PR/MR passes the check gates (build, test, lint, spec-link, contract-check), the AI review, and the human review — then ships.

---

## Build order (prove the risky piece first)

### Step A — Spec Kit handoff, on ONE repo, ONE story (do this first, alone)
This is the riskiest integration. Get it working before anything else.
- Take one `ready-for-build` story that touches one repo.
- In that repo, invoke Spec Kit **as harness slash-commands** (Phase 0 deviation — not subprocess). Confirm and record the exact command names and where each writes output.
- Run the heavy specification **once per story**: specify → clarify → plan → analyze → checklist. Then `tasks` produces the atomic task list.
- Write outputs to the repo under the story's spec folder (`specs/EP-<slug>-S01/` or Spec Kit's real default — match the tool, don't fight it).
- Create `link.md` (or frontmatter) pointing back to the story in the product repo.
- Stop here and verify the files are correct before building Step B.

### Step B — `yad-implement` (the `dev` step)
- Agent: `dev` implements ONE atomic task as a small diff (≤3 files where possible).
- One atomic task = one branch = one PR/MR, named per the conventions (`feat/EP-<slug>-S01-T03-...`).
- The diff must stay inside the files the task's spec declared; flag and stop if it grows beyond them.
- Commit message follows the convention, ending with the task ID; add `Contract-Change: yes` in the body if the contract surface is touched.

### Step C — The check gates (the production-safety core)
Build these as the CI checks that must pass before merge. Each is a separate, simple check:
- **spec-link check** — the PR/MR links a real story/spec; fail if missing.
- **contract-check** — if the diff touches the contract surface and `contract.md` was not updated first (no matching `Contract-Change` + updated contract), fail and route back to the architecture/design gate. Use the contract representation chosen in Phase 2.
- **build / test / lint** — standard; tests must actually exercise the new behavior, not just pass.
- Confirm where these run (the team's GitLab CI per `RESEARCH-NOTES.md`) and wire them as pipeline stages.

### Step D — PR/MR templates committed into the repo
- Detect the repo's platform and drop only the matching template: `.github/pull_request_template.md` (GitHub) or `.gitlab/merge_request_templates/Default.md` (GitLab).
- Templates include the Impact & Risk block; `risk level: high` routes the review to domain owners (reuse the escalation logic from the gate).

### Step E — AI review + engineer review, then ship
- **AI review**: wire the automated first-pass reviewer (e.g. CodeRabbit) on the PR/MR. It is a second set of eyes, never the authority.
- **Engineer review**: a human reads the diff against the spec and owns the merge. This is a human gate, same `human_approve` discipline as the front states.
- **Ship**: on merge, update the story state and record it. The PR links up to the story so the whole chain (epic → story → task → PR) is traceable.

### Step F — Widen to multi-repo (only after A–E work on one repo)
- Take a story tagged for more than one repo (`repos: [backend, mobile]`).
- Run Steps A–E in each repo independently, each producing its own spec/plan/tasks and its own PR/MR.
- All repos derive from the **one locked `contract.md`** in the product repo. None may extend the contract surface without going back up to the architecture gate (the contract-check enforces this per repo).
- Prove that a contract-surface change in one repo without a contract update is blocked by that repo's contract-check.

---

## Backfill (build after A–F, for existing-code projects)

### Step G — `yad-backfill`
- For an existing repo with no specs, generate specs for already-built features so new work does not break them.
- Confirm Repomix's interface first (CLI vs slash-command per Phase 0) and use it accordingly.
- Pack one feature's files at a time (compress + git logs, secret-scan), feed to AI with a "describe what exists, do not invent" prompt, write a **draft** spec marked unverified.
- Require human approval before the spec counts as real (reuse `yad-review-gate`).
- Boundary detection: use the project's convention (e.g. NestJS module = feature) from the constitution where the code follows it; require a human to confirm the boundary where it does not. Auto-propose, human-confirm.
- Gating: a new change is blocked only until the features **it touches** have approved specs — not the whole repo.

---

## Cross-cutting requirements

- **Heavy spec once per story, light loop per task.** specify/clarify/plan/analyze/checklist run once per story; only tasks → implement → gates run per atomic task. Do not run the full ceremony on every small PR.
- **Per-repo specs, shared contract.** Spec/plan/tasks live in each code repo; the contract stays singular in the product repo. Each PR links up to its story.
- **Nothing auto-advances.** Every gate in this phase is `human_approve` (AI review is advisory, not an advance). Automation is the next phase.
- **Tools via real interface.** Spec Kit + Impeccable as slash-commands; Repomix confirmed before use. No forking tool internals.
- **Reuse the gate.** Backfill approval and engineer review reuse `yad-review-gate` where they are human approvals.

---

## Explicitly NOT in Phase 3

- No end-first automation (no `machine_advance` anywhere) — that is Phase 4.
- No service/daemon — still CLI + harness, git as source of truth.
- No dashboards or analytics.

---

## Definition of done for Phase 3

- Spec Kit runs as slash-commands on one repo/story; outputs and `link.md` verified. Command names recorded in `RESEARCH-NOTES.md`.
- `yad-implement` produces one small PR/MR per atomic task, correctly named and linked.
- The check gates run in CI: spec-link, contract-check, build/test/lint — and a deliberately bad PR (no spec link; and a contract-surface change with no contract update) is shown to FAIL.
- PR/MR template committed into the demo repo, platform-correct, with the Impact & Risk block; a `high` risk PR is shown routing to domain owners.
- AI review wired; engineer review gate works; a story ships end to end and updates state.
- Multi-repo proven: one story builds in two repos from one contract, and a contract bypass in one repo is blocked.
- `yad-backfill` produces a human-approved draft spec for one existing feature, gated on touched features.
- `README.md` updated so the team can run the full build half by hand.

---

## Then Phase 4 (preview, do not build yet)

End-first automation: move the safe back steps toward `machine_advance` one at a time (tasks → implement → checks first), keeping front states human-authored. Then, much later, the optional service layer (watch repos, run unattended, dashboards) — built only when the CLI genuinely can't keep up, with git remaining the source of truth.
