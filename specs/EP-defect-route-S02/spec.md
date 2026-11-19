# Spec — EP-defect-route-S02: `yad backfill promote`

Story: `EP-defect-route-S02` (epic `EP-defect-route`), engine repo. Issue: Product #1 (roadmap E17b).
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

A stub is the anchor `yad epic new --stub` mints for a feature that shipped before yadflow tracked it.
It is marked in two files: `stub: backfill-pending` and `verified: false` in `epic.md`, and
`kind: "stub"` with the `backfill-pending` sentinel in `state.json`. Once the feature's backfill spec is
approved, the `yad-backfill` skill's `promote` step makes the stub a real anchor, and today it does that
by telling the agent to edit both files by hand. That makes `yad-backfill` the last skill that tells an
agent to edit `state.json`, and a promote cut short leaves the two files disagreeing (the S01 review
found such a half-promoted anchor: `kind: stub` beside `backfill-done`).

## Requirements

- R1. `yad backfill promote <epic> --repo <name> --feature <feature> [--full] [--json]` reads
  `specs/backfill/<feature>/spec.md` in the checkout of the repo named `<name>` in `.sdlc/repos.json`.
  It refuses unless the epic is a stub and that spec's frontmatter says `verified: true`, read as
  `checks/backfill-check.sh` reads it: only a frontmatter block that opens on line 1 and closes; the last
  line that could set the key (any case, quoted or not, a space before the colon) wins; it must be
  exactly `verified: true` (value `true`, `True` or `TRUE`, nothing after it). The refusal names every
  condition that is missing (`--json`: `missing` holds `stub` and/or `verified-spec`), and writes nothing.
- R2. On success it writes `epic.md` (`verified: true`, no `stub:` line, and
  `backfill: { repo: <name>, spec: specs/backfill/<feature>/spec.md, promoted: <date> }`; the rest of the
  file kept) and `state.json` (no `kind: "stub"`, `type` kept; `currentStep: "backfill-done"`) together.
  `--full` instead sets `currentStep: "epic"` and opens the `epic` step (`in_progress`) when nobody has
  started it. If either write fails, both files are put back to their old bytes.
- R3. A promote cut short (some of the three stub markers left) is finished, not refused:
  - with a ledger marker left (`kind: stub` or the sentinel), when the ledger is on `backfill-pending` or
    already on the step the flavour writes (`backfill-done` for light, `epic` for full). On
    `backfill-done` with `--full`, or `epic` without it, it refuses and names the flag that finishes it.
    On any other step it refuses, names the step, and says to restore the two files from git (no step can
    run past a ledger marker, so no gate progress is lost);
  - with only `epic.md`'s `stub:` line left, the ledger was promoted and may have moved on, so `epic.md`
    alone is finished and the ledger is not written. The flavour must match the ledger (`--full` unless
    it is on `backfill-done`); otherwise it refuses and names the flag.
- R4. On a verified ledger it refuses and writes nothing, as `yad gate approve` does, and says what to do
  instead: leave the stub as an anchor (defects and changes still thread off it); CI has no promote yet.
  A platform with a local ledger is not refused.
- R5. The rules class it `local-write`; the generated `yad-guide` section and the activity hook's command
  list carry it. `yad help` and `docs/CLI.md` list it.
- R6. The `yad-backfill` skill's `promote` step runs the command, and no `yad-*` skill tells the agent to
  edit `state.json`. The `yad-review-gate` banner that named `yad-backfill` as the remaining hand writer
  says no skill writes a chain by hand any more. `state-schema.md` and `yad-stub` name the command.
- R7. After a promote the doctor's epic checks are clean, the lineage resolves, and a defect off the
  promoted anchor no longer gets the S01 chore lane.

## Out of scope

A CI path that promotes on a verified ledger (the gate bot has no promote verb; that stays a gap). Reading
the spec from the base branch, as the gate does. Setting `title:` on a stub that has none (prose; the skill
says to set it after the promote). Checking that `--repo` is in the stub's `repos:` list. The
`yad-backfill promote` wording in `yad next` and `nextAction` messages, which name the skill action and
stay true. `checks/yad-activity.mjs`, this repo's own installed copy of the hook, which is already behind
its template and is refreshed by `yad update`.

## Clarifications

### Session 2026-11-19
- Q: A platform PR verb, or a local write? → A: a local-only verb, `yad backfill promote EP-x [--full] [--json]`: a local write, no PR and no platform action (the person's decision on #1).
- Q: How does the command find the spec? Nothing in a stub records its repo or feature. → A: two more flags, `--repo <name>` and `--feature <feature>`, which the decided signature did not have; the spec is never guessed from the slug or from "the only spec in the repo". **Needs the person's yes.**
- Q: The story names a `backfill:` block "with the spec and the date". → A: it also carries `repo:`, since a spec path alone is ambiguous when a stub lists several repos. **Needs the person's yes.**
- Q: "Exact `verified: true`" — only lower-case `true`? → A: the gate's reading (`true`, `True`, `TRUE`), so what the gate passes this passes, and nothing else.
- Q: The working tree or the base branch? → A: the repo's checkout on this machine. The gate reads the base, so an approval not merged yet passes here and still fails the gate; the skill and the docs say so.
- Q: A half-promoted epic — refuse, or finish? → A: finish it when the ledger is on the sentinel or on the step the flavour writes; a refusal there would leave only a hand edit of `.sdlc/`, which the rules forbid. When only `epic.md`'s marker is left, finish `epic.md` alone and keep the ledger, whose gate progress is real. Refuse anything else.
- Q: Which signals make "a stub"? → A: one helper, `stubSignals` (ledger `kind`, sentinel, `epic.md` marker), with `isWholeStub` (all three: a normal promote, and S01's chore lane) and `hasStubSignal` (any: a promote to finish). S01's inline check now calls it.
- Q: Verified ledger: refuse on any platform, as `gate approve` does? → A: no — only on a verified ledger. A platform with a local ledger lets the clone write its ledger, as `yad epic new` does.

## Plan

A new `cli/backfill.mjs` holds the command: the spec parse (`specApproved`), the two rewrites
(`promotedEpicMd`, `promotedState`) and `runBackfillPromote`, which checks, keeps the old bytes, writes
the ledger through `writeState` and `epic.md` through `writeFileAtomic`, and puts both back when either
throws. The writes take an `io` seam so a test can make one fail. `cli/epic-state.mjs` gets the stub
signal helper, used by `planThreadedSeed` too. Then the rules, the generated guide and the hook list
learn the command; `bin/yad.mjs` routes it (`--full` flag, `--feature` value flag); the skills run it;
the docs list it.

## Tests

- T01 (cli/test.mjs, after "yad epic new --stub: refuses the two things a stub can never be"):
  "yad backfill promote: a light promote writes epic.md and state.json together, and the stub is an anchor",
  "yad backfill promote --full: wakes the epic step instead",
  "yad backfill promote: the spec must say exactly `verified: true`, read as the backfill gate reads it",
  "yad backfill promote: refuses an epic that is not a stub, naming every condition that is missing",
  "yad backfill promote: a promote cut short is finished when the flavour matches, and refused when it does not",
  "yad backfill promote: refuses on a verified ledger, as `yad gate approve` does",
  "yad backfill promote: when either write fails, both files are left as they were",
  "yad backfill promote --json: one answer naming what was written". The S01 tests in cli/test-threads.mjs
  hold the shared stub-signal helper.
- T02: the existing "the hook knows every yad command, and only yad's" (cli/test-brain-activity.mjs) and
  "the yad-guide skill is shipped, and its generated sections agree with the rules" (cli/test-agents-file.mjs).
  `skills/yad-guide/SKILL.md` is written by `node scripts/agent-guide.mjs`, never by hand.
- T03 (cli/test.mjs, after "CLI: `--stub` reaches the command through the arg parser"):
  "CLI: `yad backfill promote` reaches the command, with --repo, --feature and --full". The existing
  "every command bin/yad.mjs knows has a class" (cli/test-guide.mjs) holds it to T02's class.
- T04 (cli/test-threads.mjs): `yad-backfill` joins `ENGINE_SEEDED` and `CHANGED` ("the skills E17b changed
  instruct no ledger write at all"); "the skills that still write a chain by hand are named, with the
  reason" becomes "no skill writes a chain by hand any more, and the banner says where each former writer went".
- T05, T06: documentation; no test.

Commit order: T01, T02, T03, T04, T05, T06. T02 lands before T03, so the class exists when `bin/yad.mjs`
names the command (the class test reads `bin/yad.mjs`).

## Tasks

<!-- yad:tasks -->
## T01 — Add `yad backfill promote` and one stub-signal helper
**Files:**
- cli/backfill.mjs
- cli/epic-state.mjs
- cli/test.mjs

## T02 — Class it a local write, in the guide and the activity hook
**Files:**
- cli/agent-rules.mjs
- skills/yad-guide/SKILL.md
- skills/yad-checks/templates/hooks/yad-activity.mjs

## T03 — Route `yad backfill promote` in the CLI
**Files:**
- bin/yad.mjs
- cli/argv-flags.mjs
- cli/test.mjs

## T04 — The yad-backfill skill runs the command; no skill hand-writes the ledger
**Files:**
- skills/yad-backfill/SKILL.md
- skills/yad-review-gate/SKILL.md
- cli/test-threads.mjs

## T05 — Name the command in the state schema, yad-stub and docs/CLI.md
**Files:**
- skills/yad-epic/references/state-schema.md
- skills/yad-stub/SKILL.md
- docs/CLI.md

## T06 — List the command in the other docs
**Files:**
- docs/YADFLOW-EXPLAINED.md
- docs/SKILLS.md
<!-- /yad:tasks -->
