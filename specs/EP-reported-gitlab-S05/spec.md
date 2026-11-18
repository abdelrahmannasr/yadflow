# Spec — EP-reported-gitlab-S05: follow a parent's pointer lock to the epic that holds contract.md

Story: `EP-reported-gitlab-S05` (epic `EP-reported-gitlab`), engine repo. Issue: engine #598.
This epic is on the chore route, so it defines no contract surface; this story touches none. It changes
how a change-epic binds to its parent's contract lock.

## Problem

`yad epic new --parent X --inherits architecture,contract` binds the carried architecture steps to the
contract surface of X — the hash of the CONTRACT-SURFACE block in X's `contract.md`. When X's own
`contract-lock.json` is a pointer lock (`inheritedFrom` / `ref` naming another epic), X has no
`contract.md`, that hash is null, and the command refuses with "X approved architecture, but
architecture.md is not there to bind to" — naming a file that is there. `yad doctor` follows a pointer
lock one hop only, so a chain of two pointers is checked against the wrong lock.

## Requirements

- R1. When the owner's lock is a pointer and it has no `contract.md`, `yad epic new --parent` follows the
  pointers to the epic that holds `contract.md`, binds the carried architecture steps to that epic's
  surface hash, and writes the child's lock with the hash unchanged and `inheritedFrom` / `ref` naming
  that epic (flattened). The carried steps keep `inheritedFrom` = the epic that approved them.
- R2. The walk (`resolveContractLock` in `cli/epic-state.mjs`) accepts only a `ref` that resolves to
  `epics/<EP-id>/.sdlc/contract-lock.json`, refuses a loop and more than 8 hops, needs every lock's hash
  to equal the next one, and needs the last epic's `contract.md` surface to hash to its lock. Locks are
  read as plain files (a link is refused). An epic with its own `contract.md` ends the walk.
- R3. Each break is refused with a message naming the epic the lock points at and the break. With no
  pointer to follow, the refusal names `contract.md` (its CONTRACT-SURFACE block), not `architecture.md`.
  The existing refusals for a non-pointer owner keep their words.
- R4. `yad doctor` checks a pointer lock with the same walk, over every hop. Its one-hop messages keep
  their words; the new breaks get one message that names the chain.

## Out of scope

`checks/contract-check.sh` (and its template copy) still follows one hop. A child written by this
command points straight at the epic with `contract.md`, so it passes; an older lock with two hops does
not. The carried steps' drift check (`gatePredicate` on an inherited step) is not run by any command on
a carried step, so nothing recomputes the architecture hash from the child's or the owner's folder.

## Clarifications

### Session 2026-11-18
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Refuse, or follow the pointer? → A: follow the pointer (decided by the person)

## Plan

Add `resolveContractLock(root, epicDir, { followOwn })` and `describeLockBreak(walk)` to
`cli/epic-state.mjs`. In `planThreadedSeed`, run the walk once per owner: use its hash when the
architecture step's surface hash is null, and use it for the rule-5 lock check and the child lock. In
`cli/doctor.mjs`, replace the one-hop pointer check with the walk (`followOwn: true`, so an epic with
pointer fields and its own `contract.md` still has its pointer checked, then its live surface). Tests in
`cli/test-threads.mjs` (pass over one and two hops in both inherit orders, each break, the hop limit) and
`cli/test.mjs` (doctor over two hops, a loop, a hash change and a drifted end).

## Tasks

<!-- yad:tasks -->
## T01 — Follow a parent's pointer lock when threading a change
**Files:**
- cli/epic-state.mjs
- cli/test-threads.mjs

## T02 — Check pointer locks over every hop in doctor
**Files:**
- cli/doctor.mjs
- cli/test.mjs

## T03 — Document the pointer walk
**Files:**
- docs/CLI.md
- skills/yad-change/references/triage.md
- skills/yad-epic/references/state-schema.md
<!-- /yad:tasks -->
