# Spec — EP-safety-followups-S03: the CI contract gate follows a pointer lock over every hop

Story: `EP-safety-followups-S03` (epic `EP-safety-followups`), engine repo. Issue: Product #233.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

A change-epic that inherits its architecture has no `contract.md`, only a pointer lock — a
`contract-lock.json` holding another epic's hash, with `inheritedFrom` / `ref` naming that epic. Since
engine PR #612, `yad epic new --parent` and `yad doctor` follow a chain of pointer locks with
`resolveContractLock` (cli/epic-state.mjs): up to 8 hops, inside `epics/`, through no link. The CI gate
`checks/contract-check.sh` follows one hop only, so a lock that doctor passes over two hops fails in CI,
and doctor has to warn about it.

## Requirements

- R1. `checks/contract-check.sh` and its template copy (`skills/yad-checks/templates/checks/`, byte
  identical) follow the chain the way `resolveContractLock` does: each `ref` folds by its text to exactly
  `<Product>/epics/<EP-id>/.sdlc/contract-lock.json` with a valid epic id; no epic folder, `.sdlc`
  folder, lock or `contract.md` on the way is a link (or a file where a folder belongs); an epic seen
  twice is a loop; at most 8 hops; each lock's hash equals the one that points at it; the walk stops at
  the first epic with its own `contract.md` or a lock that is not a pointer, whose `contract.md` must
  hash to the lock.
- R2. A broken chain (loop, missing ref, a link, a hash mismatch, too many hops, a ref outside `epics/`)
  fails with a reason naming the hop (`hop N: EP-a → EP-b …`). The existing one-hop reasons keep their
  text, so the fixes they print stay the same. Text read from a lock (a `ref`) has its control
  characters dropped before it is printed.
- R3. `yad doctor`'s multi-hop pointer-lock warning becomes `ok`, naming the epics it passed through.
- R4. One test runs a table of chains (one, two, three and 8 hops; 9 hops; a loop; a dangling ref; a hash
  that changes on the way; a link at the epic folder, the `.sdlc` folder and `contract.md`; a ref that
  leaves `epics/`; a ref to a folder that is no epic id; a drifted last `contract.md`) through both
  `resolveContractLock` and the bash gate, and holds their pass or fail equal.
- R5. `docs/CLI.md`, `docs/GATES.md` and `skills/yad-checks/references/check-gates.md` say the gate
  follows the chain and doctor no longer warns.

## Out of scope

Changing `resolveContractLock` or `yad epic new --parent` (it still writes a flattened, one-hop lock).
The other gates (`lineage-check.sh`, `epic-open.sh`), which read no pointer lock. The gate's JSON reading
(`lock_hash` / `lock_str`), which stays a first-match text read.

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: Is the story's own epic held to the no-link rule too? → A: yes, as `resolveContractLock` checks the first epic too; the gate and doctor must give the same answer.
- Q: An absolute `ref` spelled with the disk's path (`pwd -P`) rather than the shell's? → A: accepted, as the one-hop gate accepted it; only the epics folder's two spellings count.

## Plan

A `lock_walk` function in `contract-check.sh` replaces the one-hop block in `quote_story`. It folds each
`ref` by text (`abs_fold`), checks each part with `-L` before reading it, keeps a seen list and a hop
count, and sets `_qc` to the `contract.md` the existing surface check then hashes. Its reasons reuse the
one-hop wording and add the hop. The template copy is the same file. Doctor drops the multi-hop warning
branch and says `ok` with the path. Tests: a table in `cli/test-checks.mjs` next to the pointer cases; the
doctor tests in `cli/test.mjs` and `cli/test-threads.mjs` expect `ok`.

## Tasks

<!-- yad:tasks -->
## T01 — Follow a pointer lock over every hop in the CI contract gate
**Files:**
- checks/contract-check.sh
- skills/yad-checks/templates/checks/contract-check.sh
- cli/test-checks.mjs

## T02 — Say ok for a sound multi-hop pointer lock in yad doctor
**Files:**
- cli/doctor.mjs
- cli/test.mjs
- cli/test-threads.mjs

## T03 — Say the gate follows the whole chain in the docs
**Files:**
- docs/CLI.md
- docs/GATES.md
- skills/yad-checks/references/check-gates.md
<!-- /yad:tasks -->
