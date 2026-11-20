# Spec — EP-review-followups-S03: the contract gate refuses a lock that is not valid JSON

Story: `EP-review-followups-S03` (epic `EP-review-followups`), engine repo. Issue: Product #247.
This epic is on the chore route, so it defines no contract surface; this story touches none.

## Problem

Engine PR #629 made `checks/contract-check.sh` follow a pointer lock (`contract-lock.json`) over every hop.
Its text check, `lock_ok`, reads a lock only when it is one `{…}` object, holds no backslash, and names
`hash`, `ref` and `inheritedFrom` at most once each. A lock of that shape can still be invalid JSON: a missing
comma, an unclosed string, a trailing comma, a bare word for a value, a brace too many, a newline inside a
string. The gate reads the hash out of such a lock and passes, while `yad doctor` (`resolveContractLock`,
which reads with `JSON.parse`) refuses it. CI and doctor disagree.

## Requirements

- R1. `lock_ok` refuses every lock that `JSON.parse` refuses, in bash and awk only. The answer never
  depends on whether `node` is installed. A grammar check, `lock_json`, runs after the backslash check:
  - every byte below 0x20 other than tab, LF and CR is refused anywhere in the file;
  - awk walks the tokens of the raw file (not a newline-folded copy): strings (one holding tab, LF or CR
    is refused), numbers by JSON's number grammar, `true`, `false`, `null`, and objects and arrays at any
    depth. A lock may carry nested members, as `JSON.parse` allows. The outer value is an object, and only
    JSON space follows it;
  - portable awk only (mawk, BWK awk, gawk): no interval, no character class, no gawk-only function.
- R2. Where a refused lock is reported, a lock that is no JSON at all (no backslash in it, and no JSON
  value by `lock_json`) gets its own message: it names the file and says it is not valid JSON. This holds at
  each of the three places: a lock one hop on, the story epic's own lock, and the Contract-Change pin check.
  `[]` or `null` is JSON, so it keeps the "no usable hash" message, as does every other refusal.
- R3. Every valid lock keeps its answer, including every row of the shared table that runs one set of
  chains through the gate and through `resolveContractLock`.
- R4. New table rows, each with the same answer in bash and in JS: a missing comma (one hop on, and at the
  start), an unclosed string, a trailing comma, an unquoted date, an unquoted `inheritedFrom`, a closing
  brace too many, a newline inside a string, and one valid lock over many lines with CRLF and nested,
  `null`, `true` and number members. The existing "cut-off lock" row keeps its answer; its message is now
  the not-valid-JSON one.
- R5. The two copies (`checks/contract-check.sh` and `skills/yad-checks/templates/checks/contract-check.sh`)
  stay byte-identical, pinned by a test. Review: the test compares bytes (`Buffer.equals`) and covers every
  `checks/*.sh` that has a copy in `skills/yad-checks/templates/checks/` or
  `skills/yad-pr-template/templates/checks/`; one with a copy in neither must be named in the test's
  `NO_TEMPLATE` list (empty today).
- R6 (review). A lock larger than 64 KiB is not read: `lock_big` refuses it before any other read, and each
  of the three report places says so first ("is larger than 64 KiB, so it is not read (a contract lock is
  a few hundred bytes)"). The awk walk goes one line at a time, one character at a time; on a long line
  BWK awk's `substr` still makes it grow faster than the size, so the cap is what bounds the cost (about
  half a second for the worst lock under it).
  - Trade-off: `yad doctor` reads files up to its own, much larger cap, so a valid lock between 64 KiB and
    that cap passes doctor and fails the gate. This is one of two accepted differences (see R7 for the
    other), both on the safe side (the gate refuses what doctor reads, never the reverse). The table marks
    those rows `gateRefuses`: JS gives its own answer, and the gate refuses with its own message.
- R7 (review). The gate reads `hash`, `ref` and `inheritedFrom` only at the top level of the lock, as
  `resolveContractLock` does: `lock_json` prints the top-level values, and the same keys in a nested member
  are read as absent. `hash` and `ref` are read only as strings. A truthy `inheritedFrom` that is no string
  is read as JavaScript turns it into text (`true`, a number that is not 0, `[object Object]`). An array
  there (second review) is read as `[array]`: it makes the lock a pointer, as in JS, and is used only when
  there is no string `ref` and no contract.md of the epic's own. Then the ref built from it leaves
  `epics/` and the gate refuses. JS agrees for `[]`; for an array naming an epic, JS joins it into that
  name and follows it. That is the second accepted difference (a `gateRefuses` row).
  - Why not refuse a nested key instead: an epic with its own contract.md and a lock with a `ref` nested in
    another member is sound in JS (the walk ends there). Refusing would fail that lock in the gate alone.
    Reading the nested key as absent gives the same answer as JS in all three new rows.

## Out of scope

Changing `resolveContractLock`, `lockReadsTwoWays` or anything in `cli/epic-state.mjs`: JSON.parse already
refuses these locks. Left as known differences on odd valid JSON, where both sides still refuse: a `hash`
written as a one-item array (JS passes its hash test, then fails on the compare; the gate finds no hash), an
`inheritedFrom` written as a number such as `1.50` (both say the ref leaves `epics/`, and the ref in the
message reads `1.50` in the gate, `1.5` in JS).

## Clarifications

### Session 2026-11-20
- Q: Light spec — one `spec.md` holding the spec, the plan and the tasks? → A: yes (chore route, no contract surface)
- Q: A flat tokenizer, or nested values too? → A: nested too. `JSON.parse` takes a lock with a nested member,
  and so does today's gate, so a flat-only check would turn a valid lock away.
- Q: Use `node` when it is there? → A: no. One awk check, so the answer is the same on every runner.

## Plan

In the template `contract-check.sh`: add `lock_json` (the `tr` control-byte check and the awk token walk);
`lock_ok` runs the backslash check (by `tr -cd`, so no NUL byte reaches a bash variable), then `lock_json`,
then the per-key counts; add `lock_not_json` and a not-valid-JSON branch before each of the three "no usable
/ readable hash" messages. Copy the template over `checks/contract-check.sh`. In `cli/test-checks.mjs`: the
new rows in the `#233` table, a not-valid-JSON case in the Contract-Change lock test, and a byte-for-byte
test for the two copies.

Review (T02): add `lock_big`; `lock_json` walks line by line and prints the top-level reads; `lock_reads`
(size, backslash, `lock_json`, key counts) replaces `lock_ok`, and `lock_str` / `lock_hash` read its lines;
a size branch goes before each not-valid-JSON branch. In the tests: the nested-key and size rows (with
`gateRefuses` in the table loop), a size case in the Contract-Change lock test, and the byte test widened
to every gate copy.

## Tasks

<!-- yad:tasks -->
## T01 — Refuse a contract lock that is not valid JSON, in both gate copies
**Files:**
- checks/contract-check.sh
- skills/yad-checks/templates/checks/contract-check.sh
- cli/test-checks.mjs

## T02 — cap the lock size, refuse nested lock keys, pin every gate copy (review fixes)
**Files:**
- checks/contract-check.sh
- skills/yad-checks/templates/checks/contract-check.sh
- cli/test-checks.mjs

## T03 — polish from the second review
**Files:**
- checks/contract-check.sh
- skills/yad-checks/templates/checks/contract-check.sh
- cli/test-checks.mjs
<!-- /yad:tasks -->
