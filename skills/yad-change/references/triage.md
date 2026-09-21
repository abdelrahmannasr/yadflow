# Change triage — depth, what the seed writes, the pointer-lock, migration, concurrency

This is the detail behind `yad-change`. The lineage frontmatter + ledger schemas live in
`../../yad-epic/references/state-schema.md` (Phase 6 section); this file is the *how*.

## Depth → re-author vs inherit (the triage table, expanded)

The depth is the single decision that drives everything else. Pick the SHALLOWEST depth that honestly
describes the change — a deeper depth re-authors (and re-reviews) more than necessary.

| depth | when | re-authors | inherits | first runnable step |
|-------|------|-----------|----------|---------------------|
| **defect-fix** | the design was right; the code or its coverage was wrong. No behaviour the spec promised changes. | `stories` (a regression story stating the correct behaviour), `test-cases` (the case that would have caught it) | epic, architecture, contract, ui-design | `stories` |
| **behavioral-no-surface** | observable behaviour changes (validation, an edge case, a non-surface field), but the **cross-repo contract surface** does not | `epic` (a delta), `stories`, `test-cases`; `ui-design` too if the change is visible | architecture, **contract (inherited, NO re-lock)** | `stories` (or `ui-design`) |
| **contract-surface** | the shared API/event/data-model surface itself changes | **architecture + contract (re-author + RE-LOCK)**, `stories`, `test-cases`; `epic`/`ui-design` as needed | only what is genuinely untouched | `architecture` |
| **new-capability** | this is not a change to the feature — it is a new feature | the full chain | lineage/context only | `epic` |

**Heuristics for the surface question** (defect-fix / behavioral-no-surface vs contract-surface): does
the change alter an endpoint's path/method, a request/response field, an event name/payload, or a shared
enum/identifier in the genesis (or current-truth) `contract.md` `CONTRACT-SURFACE` block? If yes →
contract-surface. If it only changes internal behaviour, validation, or a repo-private field → not the
surface.

## What `yad epic new --parent` writes (worked shape)

The engine writes this (E42); it is shown so the author and the reviewers know what to expect, and a
test keeps it equal to what the engine really writes. The child's chain is always the PARENT's chain and
`profile`: 10 steps under a `classic` parent, 4 under a `chore` one (no `architecture`/`ui-design` rows to
inherit and no pointer-lock — see "Short-lane parent" in `../SKILL.md` Step 5).

For a **defect-fix** off a `classic` parent, inheriting epic/architecture/contract/ui-design and re-authoring
stories+test-cases:

```json
{
  "schemaVersion": 10,
  "epicId": "EP-<slug>", "createdAt": "<today>", "type": "<the same value as epic.md kind/type>",
  "profile": "classic",
  "currentStep": "stories",
  "steps": [
    { "id": "epic",                "type": "author",         "artifact": "epic.md",         "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "satisfied", "inherited": true, "inheritedFrom": "EP-<genesis>", "boundHash": "sha256:…", "record": { "reason": "carried by reference from EP-<genesis>", "by": null, "date": "<today>", "link": "EP-<genesis>" }, "risk_tags": [] },
    { "id": "epic-review",         "type": "review+approve", "artifact": "epic.md",         "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "satisfied", "inherited": true, "inheritedFrom": "EP-<genesis>", "boundHash": "sha256:…", "record": { "reason": "carried by reference from EP-<genesis>", "by": null, "date": "<today>", "link": "EP-<genesis>" }, "risk_tags": [] },
    { "id": "architecture",        "type": "author",         "artifact": "architecture.md", "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "satisfied", "inherited": true, "inheritedFrom": "EP-<genesis>", "boundHash": "sha256:…", "record": { "reason": "carried by reference from EP-<genesis>", "by": null, "date": "<today>", "link": "EP-<genesis>" }, "risk_tags": [] },
    { "id": "architecture-review", "type": "review+approve", "artifact": "architecture.md", "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "satisfied", "inherited": true, "inheritedFrom": "EP-<genesis>", "boundHash": "sha256:…", "record": { "reason": "carried by reference from EP-<genesis>", "by": null, "date": "<today>", "link": "EP-<genesis>" }, "risk_tags": ["contract"] },
    { "id": "ui-design",           "type": "author",         "artifact": "ui-design.md",    "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "satisfied", "inherited": true, "inheritedFrom": "EP-<genesis>", "boundHash": "sha256:…", "record": { "reason": "carried by reference from EP-<genesis>", "by": null, "date": "<today>", "link": "EP-<genesis>" }, "risk_tags": [] },
    { "id": "ui-design-review",    "type": "review+approve", "artifact": "ui-design.md",    "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "satisfied", "inherited": true, "inheritedFrom": "EP-<genesis>", "boundHash": "sha256:…", "record": { "reason": "carried by reference from EP-<genesis>", "by": null, "date": "<today>", "link": "EP-<genesis>" }, "risk_tags": [] },
    { "id": "stories",             "type": "author",         "artifact": "stories/",        "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "in_progress", "risk_tags": [] },
    { "id": "stories-review",      "type": "review+approve", "artifact": "stories/",        "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "todo",        "risk_tags": [] },
    { "id": "test-cases",          "type": "author",         "artifact": "test-cases.md",   "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "todo",        "risk_tags": [] },
    { "id": "test-cases-review",   "type": "review+approve", "artifact": "test-cases.md",   "assistance": "review", "driver": "pair", "automation": "human_approve", "advance": "human", "locked": true, "status": "todo",        "risk_tags": [] }
  ]
}
```

`inheritedFrom` is the epic that owns the artifact along the parent's line — the latest one that
re-authored it, which is not always the parent. `boundHash` is the inherited artifact's **current** hash from the owning epic — the same hashes
`cli/epic-state.mjs` computes: `contractSurfaceHash` for `architecture`, `storiesHash` for `stories`,
the file otherwise — every file without its frontmatter `status:` line (`reviewedSha`, shape 9). A
`boundHash` computed over the whole file by an older release is still accepted. The gate predicate treats an `inherited` step as satisfied (never re-reviewed)
as long as `boundHash` matches the current hash of that artifact in the owning epic (`inheritedFrom`) —
which holds unless the owner's copy changes. Compare against the OWNER's copy, never the child's: a
change-epic writes its own `epic.md` (the change brief), which is not the epic it carries.

`approvals.json` provenance record per inherited gate (append-only, NOT an approval that the predicate
counts — it just documents where the sign-off lives):

```json
{ "artifact": "architecture.md", "step": "architecture-review", "status": "inherited",
  "from": "EP-<genesis>", "boundHash": "sha256:…", "date": "<today>" }
```

## The pointer-lock (when `architecture` is inherited)

`yad epic new` writes `.sdlc/contract-lock.json` with the owning epic's hash **verbatim**:

```json
{ "artifact": "contract.md", "hash": "sha256:<parent hash, copied byte-for-byte>", "lockedAt": "<today>",
  "inheritedFrom": "EP-<genesis>", "ref": "../../EP-<genesis>/.sdlc/contract-lock.json" }
```

The engine copies the `hash` field of the owning epic's `.sdlc/contract-lock.json` (it never recomputes
it), and refuses when that lock is missing, malformed, or no longer matches the owner's `contract.md`
surface — a pointer to a stale lock would pass the drift down the thread. `contract-check.sh` reads only `hash`, so a Build story in the change-epic pins this identical
hash via its `link.md` and the gate passes unchanged. There is no `contract.md` in the change-epic, so
the surface physically cannot drift.

**To CHANGE the surface instead:** do not inherit `architecture`. Then `yad-architecture` re-authors
`contract.md` in the change-epic between fresh `CONTRACT-SURFACE` markers, computes a **new** hash, and
writes a real (non-pointer) `contract-lock.json`. `architecture-review` carries `risk_tags: ["contract"]`
→ the contract-risk review (full approver count 3, capped at the active people less one and enforced, E72; only the base 1 when the people cannot be counted). This is the same re-lock-invalidates-approvals behaviour Shape already has, relocated from "edit the locked file" to "author a contract-surface change-epic".

## Genesis migration (one-time, per feature)

A feature epic authored before Phase 6 has no lineage frontmatter. Before a change threads off it, add
to its `epic.md` frontmatter:

```yaml
kind: feature
type: feature
thread: <its own id>
```

Both names, same value: `kind:` is the one every reader still uses, `type:` is the name from shape 5 on.

This is a non-gated, idempotent frontmatter add (no `parent`, since a genesis epic is the thread root).
`workItemType` already defaults an absent type to `feature`, so an un-migrated genesis still behaves as
a root — migration just makes the `thread` cache explicit and lets `yad thread` group it.

## Concurrent changes on one feature (forward-only resolution)

Two change-epics threaded off the same tip that re-author the same artifact are a **fork**. Nothing
detects it today: the current-truth resolver silently picks one owner (the sibling whose epic id sorts last),
and neither `yad doctor` nor `yad reconcile` warns. Look for two siblings in `yad thread` before threading.
Resolution is forward-only — the second to merge **re-parents** onto the first (set `parent` to the new
tip) and re-inherits; no artifact is mutated, no lock conflicts. The contract is the natural
serialization point: only one re-lock can win, and `contract-check`'s pinned-hash fidelity check fails
the loser until it re-specs against the new tip.
