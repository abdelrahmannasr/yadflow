---
name: yad-status
description: 'Read-only view of an SDLC epic: prints the current step, each step''s dials (driver/advance, under either spelling) and status, and which approvals are still required at the active gate. For stories in Build it also prints each Build step''s automation dial, status, and run record (runs / % approved-unchanged, as advice), plus the kill switch and the Shape author dials from .sdlc/automation.json — so the team can see WHY a step is automated and reverse it. Also prints the cross-cutting personal skills-log roll-up from the LOCAL-ONLY learning ledger (gitignored, never committed/pushed — the local learner''s own learning, by stage). Across multiple epics, prints a fleet roll-up (scale of read). Use when the user says "yad status", "where is epic EP-...", "what is blocking the gate", "show the trust record", "team skills", or "fleet status".'
---

# SDLC — Status (read-only)

**Goal:** Make the file-driven state legible at a glance. This skill **never writes** — it only
reads `.sdlc/` and `reviews/` and reports.

## Conventions
- `{project-root}` resolves from the project working directory.
- Operate on one epic: `{project-root}/epics/EP-<slug>/`. The Product level is the exception:
  `EP-foundation` lives at `{project-root}/foundation/` (its `.sdlc/` and `reviews/` are there).

## On Activation

### Step 1 — Resolve the epic
If no `EP-<slug>` was given, list the epics under `{project-root}/epics/` and ask which one (or
report all if the user asked for an overview).

### Step 2 — Read state
Read `.sdlc/state.json`, `.sdlc/approvals.json`, `epic.md` frontmatter (for `repos`), and — if present
— `.sdlc/contract-lock.json`. For Build (Phase 4), also read — if present — every
`.sdlc/build-state/<story-id>.json`, and the trust ledger read as the **union** of the folded
`.sdlc/trust-log.json` `runs` PLUS every loose `.sdlc/trust-log/` shard (concatenate — every shard is a
distinct run; never dedup by story/repo/step — but DO skip a shard whose full identity
`(story,repo,step,uid)` already appears in the folded `runs`, i.e. a half-applied `yad tidy up`). All are committed by `yad checkpoint` (so a fresh clone
or another machine sees current evidence; `yad tidy up` folds finished shards into `trust-log.json`).
Also read the `automation` block of
`.sdlc/config.yaml` (`back_steps`), and `.sdlc/automation.json` if present — the kill switch and the
Shape author steps set to auto (absent = the switch off, every Shape step human). The effective dial of any
step is `yad dial … --json`, which applies the kill switch and gates for you. For the
cross-cutting learning layer, also read — if present — the **local-only** `.sdlc/learning-records.json`
(the per-epic learning ledger, gitignored) and the project-wide `{project-root}/.sdlc/learning-records.json`.
Do not modify any of them.

### Step 3 — Report
Print, in this order:

1. **Header:** render the type noun from the `epic.md` frontmatter work-item type. Two names carry it,
   `kind:` and `type:`; read `kind:` first, then `type:`. **Change request** (`change`),
   **Defect** (`defect`), **Hotfix** (`hotfix`), **Chore** (`chore`), or **Epic** (`feature`, and the default when neither is
   present) — followed by `epicId`, then `status` from `epic.md` frontmatter, `currentStep`, and `repos`
   (the touched domains). Example: `Defect EP-checkout-queue-filter — draft @ stories`. A bug is a defect
   (type `defect`) — there is no separate noun. This is presentation only; the artifact is still an epic.
2. **Steps table** — for every Shape step in `steps[]` order, however many there are: `id`, `type`,
   `status`, the two dials (`driver`/`assistance` and `advance`/`automation` — read whichever the step carries, the OLD name wins), `locked`, and `risk_tags`. Mark the
   `currentStep` with `→`. **The chain length is a fact about the epic's ROUTE, never a constant** —
   read `profile` from `state.json`: `classic` is 10 steps, `analysis-first` 12, and the short lanes
   `chore` 4 and `spike` 6 (E40). On `classic` the gating chain is `[analysis → analysis-review →]
   epic → epic-review → architecture → architecture-review → ui-design → ui-design-review → stories →
   stories-review` → **`ready-for-build`** (the bracketed `analysis` prefix is not on `classic`: it is
   what makes `analysis-first`, the route `yad-analysis` seeds). A short lane runs `epic → epic-review → stories → stories-review` →
   **`ready-for-build`**, with `analysis` in front on `spike`, and has no architecture, UI-design or
   test-case rows at all — render what `steps[]` holds and never a step it lacks.
   `test-cases → test-cases-review` is a **parallel, non-blocking track**: it opens when `stories-review`
   passes and runs alongside Build, so when `currentStep` is `ready-for-build` the `test-cases`
   step may still be `in_progress`/`in_review` — show its status, and note "parallel" so it is clear it
   does not gate the build. Always render exactly the steps present in `steps[]`.
   - **Skipped (N/A) steps:** a step the epic's route marks optional — `ui-design`, on the routes that
     ship — may be marked N/A with `yad skip`. **Both** the author step **and** its `-review` gate stay
     in `steps[]`, each with `status: "skipped"` and a `record` (`{ reason, by, date }`). A file from
     before shape 7 spells the same thing `status: "done"` with `skipped: true` and a `skipReason`
     beside it; read either. Render **each** as `<id> — SKIPPED (N/A: <reason>)` (with who and when if
     present) instead of the plain status, so the deliberate skip and its reason are visible and the
     gate does not appear to vanish. The chain then reads `… architecture-review → ui-design (N/A) → ui-design-review (N/A) →
     stories → …`; the review gate never needs approvals.
   - **Deferred steps:** `yad defer` sets an optional step aside to come back to later. Both the author
     step and its `-review` gate carry `status: "deferred"` and a `record`. Render each as
     `<id> — DEFERRED (later: <reason>)`, with who and when if present. A deferred step is still owed:
     never render it as done or as N/A.
   - **Debt:** a step carrying `"debt": true` (written by `yad defer … --debt`) is owed back and must be
     reminded until paid. Add `· DEBT` to its line, and list every debt in a short **Owed** block under
     the chain with the command that pays it: `yad undefer <epic> <id>` while it is still `deferred` (on a verified Product,
     say that verb is refused once the ledger is on the default branch), or
     "being paid back — clears when `<id>-review` passes" once it is back in progress. The flag is
     removed only when that review passes. `yad doctor` reports the same list as `step:debt`.
   - **Closed steps:** a `done` step may carry `closed` (E18) — `{ by, date, via, pr?, … }`. Add
     `(closed <date>, via <via>, PR #<pr>)` to its line when it is there, and nothing when it is not: a
     step closed before this release has none, and that is not a fault.
   - **Re-opened steps:** an unfinished step with a later step `done` (not its own `-review` gate) was
     put back after the chain built past it — a late `yad undefer`. Render it as
     `<id> — RE-OPENED (beside finished work)`: it does not block the finished steps after it, and
     `currentStep` stays where it is. `yad next <epic>` prints it as a `re-opened lane`.
   - **Blocked steps:** a step with `status: "blocked"` **and** a `record` is waiting on someone outside
     the workflow. Render it as `<id> — BLOCKED (<reason>)`, with who recorded it and when, and say it is
     cleared with `yad unblock <epic> <id>` once the wait is over — on a verified Product that verb refuses
     once the ledger is on the default branch, so say so. A `blocked` with no record is the older
     word for `todo`: render it as not started.
3. **Active gate** — for the `currentStep` (if it is a `review+approve` step), compute and show:
   - the count in force — **distinct approvers** recorded, against the **base** (1, enforced) and the
     **full count** from the step's risk tags (advisory),
   - approvals **recorded so far** (from `approvals.json`, one line per approver), and
   - approvals **still required** to pass the gate (`1 approval(s)`, or none).
   Do not advance — just state whether the gate would pass right now.

   Apply the same predicate `yad-review-gate` uses (restated here so this skill is
   self-contained). From the `approved` records in `approvals.json` for the current step:
   - `approvers` = the distinct, non-empty `approver` values of the approvals that are not stale (below).
     A record that names nobody counts as nobody. When `requireEngagement` is on in the Product config,
     only approvals with `engagement: verified` count. There are no roles; a `role` or `domain` an older
     record carries is legacy data, and it counts for nothing.
   - **Pass (team mode):** `|approvers| >= 1` — the base — plus, with a platform, resolved review threads and a merged
     review PR/MR. Solo mode waives approvals entirely.
   - **The full count, reported on every step that is not inherited, skipped or deferred:** `needed = base 1 + risk step` — plus `2` when the
     step's `risk_tags` carry `contract`, or `1` when they carry `auth`/`payments` (the highest tag,
     never the sum). The engine **caps** that ask at `active − 1` (floor 1) and prints it (E72) — for
     example a contract gate asks 3, and with 2 active people the capped ask is 1. The risk step is
     ADVISORY, capped or not — it never decides whether the gate would pass, because the count
     of people can read high (a git name and a platform login are two people until proven one). When the
     people could not be counted, no cap is shown. `yad gate status` prints the sum and the shortfall
     (`; count: 3 approvers = base 1 + contract risk 2 — capped to 1: 2 active people, less one seat
     for the author — base enforced, risk step advisory — 1 short`, or without the `capped to …` part
     when the cap lowered nothing) — read it from there rather than recomputing it, and say "short N"
     rather than "blocked" when it is short. A closed team gate whose ask was lowered says
     `count capped from 3 to 1 (2 active people)`. In solo mode it prints no shortfall.
   - **A gate that may not be met (E73):** under an open team gate, `yad gate status` can print a line
     starting `! may not be met:` — the base may have nobody but the author to give it, the full count
     would jam if enforced, or people known only by a git name may make the team smaller than the capped
     ask. Relay it as stated, as a warning and never as "blocked": it holds nothing.
   - **How many people there are to ask (E71), printed once per epic and not per step:** `active people:
     4 in the last 90 days — caps each gate's count at 3 approvers (one seat is left for the author);
     reported, only the base is enforced`, with the window's basis on the line under it. It is
     the count the cap (E72) uses, so never report a step as blocked by it. A source that could not be
     read prints `active people: NOT COUNTED — <which source> — no cap can be shown, and only the base
     holds each gate`: report that wording as it stands and NEVER as a number or as "no people" — an
     unreadable input is not a small team.
   - Touched domains (`epic.repos` for a step with a risk tag; the union of every story's `repos` for
     `stories-review`) only label the review. They add no approvals.
   - An approval is **stale** (it no longer counts) when the `artifactHash` it recorded no longer
     matches the artifact's current fingerprint — the content changed after that person approved. For
     `architecture-review` the fingerprint is the contract surface in `contract.md`. An approval with no
     `artifactHash` is never stale. `yad gate status` prints the stale count. For `architecture-review`,
     also flag when the contract-surface hash no longer matches `.sdlc/contract-lock.json`.
4. **Contract lock** — if `.sdlc/contract-lock.json` exists, show the locked hash and `lockedAt`
   (and, when at/after `architecture-review`, whether the current surface still matches it).
5. **Stories** — if `stories/` has files, list each story `id` and its `repos` tags.
6. **Files** — list the review records present under `reviews/` for the current artifact.
7. **Build (per story, per repo)** — if any `.sdlc/build-state/<story-id>.json` exists, then for
   each such story and each of its repos print the Build chain
   `spec → tasks → implement → checks → engineer-review`, marking each step's `status`, its
   `advance` dial (or `automation`, whichever the step carries), and `locked`. Mark that repo's `currentStep` with `→`. A repo whose lane is `status: skipped` (a whole lane set aside with `yad skip <epic> <story> --repo <repo>`, E39) prints `skipped (N/A)` and its `record.reason` instead of the chain. This shows, at a glance,
   which Build steps are automated and where a run is waiting. (For the single *next* build sub-step to
   take per story/repo — rather than this full status view — point the user at `yad next <epic>`, which
   reads the same `build-state` files.)
8. **Automation & run record** — print the **kill switch** from `.sdlc/automation.json` (when on, who
   turned it on, when and why, and that every step is held at `advance: human`), and the Shape author
   steps the project set to `auto` — noting that a Shape `auto` is recorded only: nothing drives a Shape
   step on its own yet. Then, for each Build step that has entries in the trust ledger — the **union** of
   the folded `.sdlc/trust-log.json` `runs` plus every loose `.sdlc/trust-log/` shard — print its **run
   record**: number of runs and the fraction with `verdict == "approved-unchanged"`. It is **advice**:
   there is no threshold and nothing is "earned" (E34). Do not recommend flipping a dial; the team sets
   dials with `yad dial`. A review gate is never auto.

9. **My skills (the learning layer — local-only).** If `.sdlc/learning-records.json` exists for the epic
   (or the project-wide ledger does), print the **personal skills-log** roll-up from it — read-only. These
   records are **local-only (gitignored, never committed or pushed)**, so this reflects only the local
   learner's own learning, not the team's. Show:
   - **By member:** each `member` present in the local ledger with the concepts they have `learned` and
     those `in-progress` (count + names).
   - **By stage:** how many learning requests landed at each SDLC `stage` (e.g. `architecture-review: 3`),
     so heavy-learning stages stand out.
   - **Tool:** whether tutoring ran on `deeptutor` (grounded in the kb) or `harness-native`, per the
     records' `tool` field.
   This section is purely informational — learning is opt-in and never gates a step (it is produced by
   `yad-learn`). If no learning ledger exists, omit the section silently (greenfield/learning not used).

10. **Fleet roll-up (overview only).** When the user asked for an overview, or more than one epic exists
    under `{project-root}/epics/`, print a one-line-per-epic roll-up across the fleet: each epic's
    `currentStep` (Shape gate) and, for stories in Build, a count of Build steps **waiting
    at a human gate**, plus a **local skills-log** count (records
    in the local-only `learning-records.json`: learned / in-progress). Close with fleet totals (epics at
    each Shape gate; total concepts learned locally across the fleet).
    This is the
    *scale-of-read* signal the Phase 5 trigger watches — when this roll-up stops fitting in one glance,
    that is the measured bottleneck. Still strictly read-only; it only scans the per-epic files.

### Hard rule
This skill is strictly read-only. If the user wants to comment, approve, or advance, point them to
`yad-review-gate`.
