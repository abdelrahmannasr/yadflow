# Spec — EP-foundation-first-epic-S02: the guide proposes the first setup epic

Story: `EP-foundation-first-epic-S02` (epic `EP-foundation-first-epic`), engine repo. Issue: engine #694.
Contract: the locked `contract.md` of the epic. This story implements the API rows `yad guide` and
`yad next`, and the data-model rows `firstEpic` and `FirstEpicProposal`. It reads the `seed` key that S01
(#700) writes.

## Problem

When the Foundation's review passes, `yad guide` and `yad next` say only "pick a roadmap item and run
yad-epic". Nothing names the setup work a new project needs first (repos, tooling, CI, a deployed path), or
the work of bringing an existing codebase in. The person has to know to ask.

## Requirements

- **R1.** A pure function `firstEpicProposal(root, productConfig)` (`cli/first-epic.mjs`) returns
  `{ proposals: [FirstEpicProposal…], optional: true }`, or `null`. It is `null` when the Product level
  (the Foundation, or the old `discovery` spelling) has not passed (its action is not `*-done`), or when
  every seed kind already has an epic (any epic whose ledger has that `seed`, in any state).
- **R2.** Order: the kind that matches `profile.codebase` first (`pack` for `brownfield`; `bootstrap`
  otherwise, so a Product with no answer reads as greenfield, the setup default), with `matches: true`;
  then the other kind, `matches: false`. A kind with an epic is left out.
- **R3.** `proposedEpic` is `EP-<seed>`, or `EP-<seed>-2`, `-3`, … when a folder of that id exists.
  `command` is exactly `yad epic new <slug> --seed <seed> --profile classic` for that id's slug. `why` is
  one sentence, at most 200 characters, worded for whether the kind matches.
- **R4.** `yad guide --json` has a top-level `firstEpic` (the same object) when either: the guide is for
  the Product level and its action is `*-done`; or no epic is open (the "nothing open" branch) and a
  Foundation exists. Otherwise the key is absent, never `null`.
- **R5.** When `firstEpic` is present, the guide's agent list is: the brownfield backfill hint first (as
  today, when brownfield), then one optional `run` step per proposal (its `why` starts "only once the person
  says yes"), then the `yad-epic` skill for the roadmap path. The person step is one `choose`: "Say whether
  to start the <kinds> epic, or a roadmap item." With no `firstEpic`, both places are exactly as today.
- **R6.** `yad next --json` adds the same `firstEpic` object, by the same rule: for `yad next EP-foundation`
  when its action is `*-done`; and for `yad next` with no epic when no feature epic is open (as
  `yad status` counts open epics). The `actions` array is unchanged.
- **R7.** `yad next` text prints the lines of `ui-design.md` §1 in the same places:
  `→ propose the <seed> epic: <command>`, its `why` dim beneath, `→ or the <seed> epic: <command>` for a
  second one, then `optional — or pick a roadmap item and invoke the <epic skill> skill (…)`. For the
  Foundation's view they replace its "seed the next feature" line; for the general view they replace "start
  your first epic", or follow the list of finished epics.
- **R8.** Nothing here writes a file, and no new agent rule is added: the commands are optional steps the
  agent runs only on the person's yes.
- **R9.** `docs/CLI.md`: the `yad guide` and `yad next` rows name `firstEpic`.

## Non-goals

- Seeding the epic (S01 does that, on the person's yes). `yad repo features` (S03), `foundation status`
  (S04), the skill outlines (S05).
- Recording a "no". Declining is just picking a roadmap item; the proposal shows again while the kind has no
  epic.

## Clarifications

- **Q1. Open feature epics in the general view.** The general views go to open epics, as today, and carry no
  proposal while one is open (the architecture's "already-started Products"). The Foundation's own view
  always shows the proposal while a kind is free.
- **Q2. The guide's printed form.** `yad guide` (text) prints its agent list as it does for every step, so
  each command shows with its `why`. The `ui-design.md` §1 lines are `yad next`'s.
- **Q3. Why `status.mjs` is imported late in `cli/next.mjs`.** `status.mjs` imports `next.mjs`, so a static
  import would be a cycle.

## Tasks

<!-- yad:tasks -->
## T01 — the first-epic proposal in `yad guide` and `yad next`
**Files:**
- `cli/first-epic.mjs`
- `cli/guide.mjs`
- `cli/next.mjs`
- `cli/test-guide.mjs`
- `docs/CLI.md`

**Done when:** R1–R9 hold. The tests in `cli/test-guide.mjs` cover both kinds' order, a used kind, both used
(the key absent), a taken id, a Foundation not passed, an open feature epic, and `yad next` JSON and text.
They fail when the "nothing open" proposal is removed, or when used kinds are not filtered.
<!-- /yad:tasks -->
