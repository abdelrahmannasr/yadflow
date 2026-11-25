# Spec — EP-reported-agent-flow-S03: say which `.sdlc/` files a skill step may write, and stamp the lock template

Story: `EP-reported-agent-flow-S03` (epic `EP-reported-agent-flow`), engine repo. Issues: engine #681, engine #680.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

**The rule.** The agent rules live in `cli/agent-rules.mjs`. Two entries say the same thing, and both
forbid every `.sdlc/` write:

- `NEVER` entry `ledger-by-hand` (line 337): "write or edit a file under `.sdlc/`, an approval, or text
  between yad markers by hand; only `yad` commands and the yad-* skills change them".
- `RULES` entry `never-by-hand` (line 356): "Never hand-write `.sdlc/` files, approvals, or text between
  yad markers; only `yad` commands and the yad-* skills change them."

Where the words go:

| Reader | How it gets the words |
|---|---|
| `yad guide --json` | returns `RULES` and `NEVER` live (`cli/guide.mjs` line 468) |
| a Product's `AGENTS.md` | `agentsBlock()` (`cli/agent-rules.mjs` line 387) prints all of `RULES` and all of `NEVER`; `yad setup` and `yad update` write it (`cli/setup.mjs` line 928, the install plan in `cli/reconcile.mjs` line 73) between the `yadflow:begin` / `yadflow:end` markers |
| a code repo's `AGENTS.md` | `pointerBlock()` (line 409) prints `never-by-hand` (line 421), not `ledger-by-hand` |
| `skills/yad-guide/SKILL.md` | the `never` section (lines 116–123) and the `rules` section (lines 127–151), between `<!-- generated: … -->` markers |

**The generator.** `scripts/agent-guide.mjs` calls `syncGuideSkill` (`cli/agent-guide.mjs` line 66) on ONE
file: `skills/yad-guide/SKILL.md`. It rewrites the four marked sections (`human-only`, `classes`, `never`,
`rules`). With `--check` it changes nothing and exits 1 when a section is stale or its markers are
missing. The test at `cli/test-agents-file.mjs` line 1346 runs `syncGuideSkill(…, { check: true })` and
the script with `--check`. It also checks that every `NEVER` text is in the skill, and that each
generated line has an even number of backticks. No other committed file is written by the generator.
The engine repo's own `AGENTS.md` holds the code-repo pointer block (line 11 is `never-by-hand`). It is
an install output written by `yad update` (last at v4.13.0, commit `68f9115f`), not by the generator, and
no test compares it with the code.

**The skills that tell the agent to write an epic `.sdlc/` file:**

| Skill step | File |
|---|---|
| `skills/yad-architecture/SKILL.md` Step 5, line 184 | `epics/EP-<slug>/.sdlc/contract-lock.json` |
| `skills/yad-ui/SKILL.md` Step 4b, line 240 | `.sdlc/design-links.json` |
| `skills/yad-test-cases/SKILL.md` Step 4b, line 193 | `.sdlc/test-links.json` |
| `skills/yad-change/SKILL.md` Step 6, line 277 | `.sdlc/change.json` |
| `skills/yad-change/SKILL.md` Step 7, line 290 | append to `.sdlc/reconcile-debt.json` |
| `skills/yad-reconcile/SKILL.md` Step 2, line 98 | points the person at paying the debt: set a `reconcile-debt.json` entry to `status: paid` (a person's fix, not an agent step) |

So a skill step tells the agent to do what the rule says it never does.

**Other skill writes found while checking** (not in the story's list; see Clarifications):

- Product-root `.sdlc/` files: `yad-connect-design` (`.sdlc/design.json`, line 122), `yad-connect-testing`
  (`.sdlc/testing.json`), `yad-connect-learning` (`.sdlc/learning.json`, line 114), `yad-brand`
  (`.sdlc/brand.json`, line 61), `yad-connect-repos` (`.sdlc/product.json` and `.sdlc/hub.json`,
  lines 261–266; `.sdlc/code-context/<repo>/code-map.md`, line 146).
- Review records under `reviews/`: `skills/yad-review-gate/SKILL.md` line 202 tells the agent to write
  `reviews/<artifact-base>--<YYYY-MM-DD>--approved.md` after every `yad gate approve`;
  `skills/yad-pair-review/references/session-state.md` line 25 writes `reviews/<base>--<date>--pair-session.md`
  in local mode.

**The engine's own list.** `PERSON_WRITTEN_SDLC` (`cli/capture.mjs` line 48, not exported) holds
`.sdlc/contract-lock.json`, `.sdlc/change.json`, `.sdlc/design-links.json`, `.sdlc/test-links.json`. It
has no `reconcile-debt.json`. Its only reader is `capturedEpic` (line 57), which decides which epic files
are "artifacts" rather than ledger. `capturedEpic` has four users:

- background capture onto `yad/wip/<name>/<epic>` branches (`cli/capture.mjs` lines 183, 187, 203, 331);
- `yad fold` (`sortChanges`, `cli/fold.mjs` line 107);
- claims (`cli/claims.mjs` lines 92, 122);
- owners (`cli/owners.mjs` line 245).

Today `reconcile-debt.json` is ledger to all four. In `sortChanges`, a ledger file is folded with the
ledger on a local Product, and left for CI on a verified Product (unless the epic is being seeded and the
file is new). An artifact file is folded as `seed` only while seeding; otherwise it is left on disk
(`other`). So adding `reconcile-debt.json` to the list changes what capture snapshots and what
`yad fold` commits.

**The ledger guard.** The `ledger-guard` hook (`cli/hook.mjs` line 41, `LEDGER_FILES`) guards
`state.json`, `approvals.json`, `comments.json`, `product-prs.json`, `hub-prs.json`, plus `reviews/*.md`
and the Product's `.sdlc/index.json` (`protectedLedgerPath`, line 60). The CI gate
(`skills/yad-checks/templates/checks/ledger-guard.sh` lines 331 and 343) lists the same files. None of the
five skill-written files is guarded today, so this story does not touch either guard.

**The template.** The lock template in `skills/yad-architecture/SKILL.md` line 187 and
`skills/yad-architecture/references/contract-format.md` line 41 is
`{ "artifact": "contract.md", "hash": "sha256:<hex>", "lockedAt": "<YYYY-MM-DD>" }`, with no
`schemaVersion`. The engine is on `SCHEMA_VERSION = 10` (`cli/manifest.mjs` line 267). A file with no
`schemaVersion` is read as shape 1 (`shapeOf`, `cli/migrate.mjs` line 630). `contract-lock.json` is on
the migration plan (`projectJsonFiles`, line 768), so `planMigration` gives it `from: 1` and
`action: 'migrate'` (lines 837–841). `yad doctor` then warns for that epic (`shapeCheckFor`,
`cli/doctor.mjs` lines 1322–1330): "`<epic>` is on shapes 1 and 10, the engine is on shape 10 — 1 file(s)
are behind", with the hint "run `yad migrate` to see what would change, then `yad migrate --apply` (each
file is backed up first)". `yad migrate` lists the lock as a file to migrate. A lock written by the
engine (`yad epic new --parent`, through `writeJSON`) carries `schemaVersion` first (`writeShape`,
`cli/lib.mjs` line 382), so only the skill-written lock is reported.

## Requirements

- R1. The `NEVER` entry `ledger-by-hand` reads, word for word. It is one fragment, because it follows
  "Never:" in `AGENTS.md` and the skill: "write or edit the ledger by hand (`state.json`,
  `approvals.json`, `comments.json`, `product-prs.json`, `hub-prs.json`), an approval, or text between yad
  markers (only `yad` commands and the yad-* skills change them), or write any other file under `.sdlc/`
  or `reviews/` except where a yad-* skill step says to: an epic's `contract-lock.json`,
  `design-links.json`, `test-links.json`, `change.json` and `reconcile-debt.json`; the `reviews/` record a
  review skill names; and the Product files a connect or brand skill names" (AC1). The clause "and the
  yad-* skills" stays: skills write text between yad markers, for example the `<!-- yad:tasks -->` block
  `yad-spec` writes. In verified mode the ledger guard still refuses a non-bot commit to `reviews/`; the
  rule does not change that.
- R2. The `RULES` entry `never-by-hand` says the same in a full sentence, so the code-repo pointer block
  and `yad guide --json` do not still forbid what R1 allows: "Never write the ledger by hand
  (`state.json`, `approvals.json`, `comments.json`, `product-prs.json`, `hub-prs.json`), approvals, or
  text between yad markers; only `yad` commands and the yad-* skills change them. Write any other file
  under `.sdlc/` or `reviews/` only where a yad-* skill step says to: an epic's `contract-lock.json`,
  `design-links.json`, `test-links.json`, `change.json` and `reconcile-debt.json`; the `reviews/` record a
  review skill names; and the Product files a connect or brand skill names." (AC1, AC2.)
- R3. The five file names are one exported list in `cli/agent-rules.mjs` (proposed name
  `SKILL_WRITTEN_SDLC`), and both rule texts are built from it, so the names cannot differ between R1 and
  R2.
- R4. `node scripts/agent-guide.mjs` has been run, `skills/yad-guide/SKILL.md` holds the new texts, and
  `node scripts/agent-guide.mjs --check` exits 0. The existing test at `cli/test-agents-file.mjs` line
  1346 passes, including its even-backtick check on every generated line (AC2).
- R5. `yad guide --json` returns the new texts under `rules` and `never`. `agentsBlock()` and
  `pointerBlock()` print them. A test asserts each (AC2).
- R6. `PERSON_WRITTEN_SDLC` is exported from `cli/capture.mjs`. A test holds it equal to
  `SKILL_WRITTEN_SDLC` (each name under `.sdlc/`), less `reconcile-debt.json`. The test names why that
  file differs: it is an append-only list that capture, `yad fold`, claims and owners treat as ledger
  today. On a local Product `yad fold` commits it with the ledger; adding it to the list would make capture
  snapshot it and make `yad fold` leave a later append on disk (AC3; see the open question).
- R7. `capturedEpic` gives the same answer as today for every path in the cases at `cli/test.mjs` line
  29925, and for `epics/EP-x/.sdlc/reconcile-debt.json` (null).
- R8. The lock template in `skills/yad-architecture/SKILL.md` and in
  `skills/yad-architecture/references/contract-format.md` is, in both files:

  ```json
  {
    "schemaVersion": 10,
    "artifact": "contract.md",
    "hash": "sha256:<hex>",
    "lockedAt": "<YYYY-MM-DD>"
  }
  ```

  `schemaVersion` is first and the layout is two-space JSON, the bytes `serialize` (`cli/migrate.mjs`
  line 661) writes, so a lock copied from it is `unchanged` in `yad migrate`, not `stamp` (AC4).
- R9. A test reads the JSON block from both files and fails when its `schemaVersion` is not
  `SCHEMA_VERSION` (AC4).
- R10. A test writes a contract lock from the template (with a real hash) into a fixture epic, runs the
  doctor shape check, and finds no `warn` or `fail` on `shape:<epic>` (AC5). The lock reaches that check:
  `planMigration` lists it (`cli/migrate.mjs` line 768), and doctor passes every row that is not a list
  to `shapeCheckFor` by epic (`cli/doctor.mjs` lines 2698–2704). No migration step in `MIGRATIONS` changes
  a lock's fields, so stamping 10 on today's fields is right. Extra, beyond AC5: the lock's
  `planMigration` row has `action: 'unchanged'`, so `yad migrate` does not offer to reformat it.
- R11. `LEDGER_FILES` in `cli/hook.mjs` and the file list in `ledger-guard.sh` (and its copy under
  `checks/` where wired) do not change. The existing ledger-guard tests pass unchanged (AC6).
- R12. No other skill text changes. The skill steps in the Problem table already match R1.

## Non-goals

- Commands that write these five files, so the agent never writes them by hand: Product issue #276.
- Changing the ledger guard hook or the CI `ledger-guard` gate.
- Bumping `GUIDE_VERSION` (`cli/guide.mjs` line 40). The rules change their words, not their shape.
- Stamping other templates (`change.json`, the pointer-lock in `skills/yad-change/references/triage.md`
  line 86 and `skills/yad-epic/references/state-schema.md` line 1129); see the open questions.

## Clarifications

### Session 2026-11-25

- Q: Light spec? → A: yes (the person, Plannotator Inbox, 2026-11-25).
- Q: Which `.sdlc/` files may a skill step write, beyond the ledger? → A: all three kinds: the five epic files, the `reviews/` record the review skills name, and the Product files the connect and brand skills name; the extra cases are added to Product #276 (the person, Plannotator Inbox, 2026-11-25).
- Q: Open a follow-up issue for `change.json`'s missing `schemaVersion`? → A: yes, in the Product repo, enhancement P2 (the person, Plannotator Inbox, 2026-11-25).
- Q: The skills tell the agent to write some .sdlc/ files, and the agent rule forbids it. Which side changes? → A: reword the rule now, and open a new issue for the commands (the person, Plannotator Inbox, 2026-11-25; the issue is Product #276).
- Q: AC1 names only `ledger-by-hand`, but `never-by-hand` (`RULES`, line 356) says the same and is the one the code-repo `AGENTS.md` prints. Reword both? → A: yes (R2): rewording one leaves the conflict in `yad guide --json`, in every Product's `AGENTS.md` and in every code repo's `AGENTS.md`. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: Should `reconcile-debt.json` join `PERSON_WRITTEN_SDLC`? → A: no (R6). That list only decides what capture, `yad fold`, claims and owners treat as an artifact. Adding the file would start snapshotting it to `yad/wip/…` branches, and `yad fold` would leave a later append on disk instead of committing it with the ledger on a local Product. That is a behaviour change outside this chore. The test names the difference; Product #276 can revisit it with the command that writes the file. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: The five-name list reads as complete, but the connect skills, `yad-brand` and `yad-connect-repos` tell the agent to write Product-root `.sdlc/` files (`design.json`, `testing.json`, `learning.json`, `brand.json`, `product.json`, `hub.json`, `code-context/<repo>/code-map.md`). Does R1 forbid them? → A: keep the approved list, and say the names are an epic's files: "(in an epic: `contract-lock.json`, …; at the Product root, the files the connect and brand skills name)". Not adopted in R1 until the person says yes. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: R1 forbids writing "the review records under `reviews/`", but `yad-review-gate` (SKILL.md line 202) tells the agent to write `reviews/<artifact-base>--<date>--approved.md` after `yad gate approve`, and `yad-pair-review` writes a pair-session record there in local mode. Which side changes? → A: add `reviews/` records to the second half of the rule ("…, and the `reviews/` record a yad-review-gate or yad-pair-review step names") and add the case to Product #276. Not adopted in R1 until the person says yes. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: The engine repo's own `AGENTS.md` (line 11) holds the old `never-by-hand` text, and AC2 says "everywhere it appears". The generator does not write it; it sits between yad markers, so it must not be hand-edited. How does it change? → A: after the release, run `yad update --open-pr` in the engine repo (the update PR rewrites the block), as a separate change. If the person wants it in this story instead, T01 grows to 4 files. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.
- Q: `change.json` (yad-change Step 6) has no template with `schemaVersion` either, so a skill-written one reads as shape 1 and `yad doctor` warns the same way. Fix it here? → A: a follow-up issue; the story names only the contract lock. Settled 2026-11-25 in the Plannotator Inbox: answered by the person, or chosen by the agent and shown to the person, who did not object.

## Plan

Add `SKILL_WRITTEN_SDLC` to `cli/agent-rules.mjs` and build the `ledger-by-hand` and `never-by-hand` texts
from it. Run `node scripts/agent-guide.mjs` to rewrite the `never` and `rules` sections of
`skills/yad-guide/SKILL.md` (the only file the generator writes). Extend `cli/test-agents-file.mjs` to
assert the new texts in `yad guide --json`, `agentsBlock()` and `pointerBlock()`. Then export
`PERSON_WRITTEN_SDLC` and add the equality test with its named exception. Last, change the lock template
in both architecture files and add the template tests (number equals `SCHEMA_VERSION`; doctor and
migrate stay quiet on a lock written from it). Each task leaves `npm test` green: the rule text and its
regenerated skill land in one task, because the `--check` test fails the moment they differ.

## Tasks

<!-- yad:tasks -->
## T01 — reword the two `.sdlc/` rules and regenerate the yad-guide skill
**Files:**
- `cli/agent-rules.mjs`
- `skills/yad-guide/SKILL.md`
- `cli/test-agents-file.mjs`

**Done when:** R1–R5 hold. `skills/yad-guide/SKILL.md` is changed only by `node scripts/agent-guide.mjs` (its `never` and `rules` sections), and `node scripts/agent-guide.mjs --check` exits 0. The generator rewrites this one file only. The engine repo's own `AGENTS.md` still holds the old text after this task; it is a second committed place the words live, and it is not edited by hand (see the open question). Wait for the answers on `reviews/` records and Product-root files before fixing the wording.

## T02 — the engine's list and the rule's list are held equal by a test
**Files:**
- `cli/capture.mjs`
- `cli/test-agents-file.mjs`

**Done when:** R6 and R7 hold. `PERSON_WRITTEN_SDLC` is exported with the same four names, and the new test fails if a name is added to one list and not the other (other than the named `reconcile-debt.json` exception).

## T03 — the contract-lock template carries the engine's `schemaVersion`
**Files:**
- `skills/yad-architecture/SKILL.md`
- `skills/yad-architecture/references/contract-format.md`
- `cli/test.mjs`

**Done when:** R8–R11 hold. The new tests fail when either template's `schemaVersion` differs from `SCHEMA_VERSION`, and a lock written from the template gives no shape warning in `yad doctor` and `action: 'unchanged'` in `planMigration`.
<!-- /yad:tasks -->
