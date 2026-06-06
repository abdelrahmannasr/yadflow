# Contract surface — format, altitude, and hash-lock

The `contract.md` produced at front state 3 is the **single source of truth for the shared cross-repo
surface** of an epic. Phase 3's contract-check (not built yet) fails a PR when a repo drifts from this
surface. To make that check possible, the surface is delimited and hash-locked now.

## What goes in the surface (altitude rule)

Inside the `CONTRACT-SURFACE` block, and nowhere else:

- **API** — the endpoints that cross a repo boundary: method, path, purpose, and the request/response
  shape at the field level. No handler logic, no per-repo framework detail.
- **Events** — event name, payload shape, and which repos produce/consume it.
- **Data model** — only entities/fields that cross a repo boundary (shared identifiers, shared
  enums/status values). A field private to one repo does not belong here.

Charter altitude: describe the *shape of the agreement between repos*, not how any repo implements it.
Implementation detail belongs in stories and (Phase 3) Spec Kit specs, not in the contract.

Anything that is rationale, open questions, or non-binding notes goes **outside** the block (under
`## Notes`) so it can change without re-locking the hash.

## The delimited block

Exactly two marker lines bound the hashed region:

```
<!-- CONTRACT-SURFACE:BEGIN -->
... hashed content ...
<!-- CONTRACT-SURFACE:END -->
```

Only the content **between** the markers is hashed — the marker lines themselves are excluded. This
keeps the hash stable against edits to the surrounding prose, frontmatter, or notes.

## The hash-lock

Stored at `epics/EP-<slug>/.sdlc/contract-lock.json`:

```json
{ "artifact": "contract.md", "hash": "sha256:<hex>", "lockedAt": "<YYYY-MM-DD>" }
```

### Recipe (must round-trip)

```bash
awk '/CONTRACT-SURFACE:BEGIN/{f=1;next} /CONTRACT-SURFACE:END/{f=0} f' \
  epics/EP-<slug>/contract.md | shasum -a 256
```

- `awk` emits every line strictly between the two markers (the `next` after BEGIN skips the BEGIN
  line; setting `f=0` on END stops before printing END).
- `shasum -a 256` (BSD/macOS) or `sha256sum` (GNU/Linux) produce the same hex digest for identical
  bytes. Prefix the digest with `sha256:` when writing the lock file.
- Round-trip property: hashing unchanged content twice yields the same digest; any edit inside the
  block changes it. That is exactly the drift signal the Phase 3 check needs.

## Interaction with the review gate

- The `architecture-review` step carries `risk_tags: ["contract"]`, so `sdlc-review-gate` **escalates**
  it: owner + 1 reviewer **plus** one `domain-owner` approval per repo in the epic's `repos`.
- **Staleness:** if the surface block is edited after approvals are recorded, the recomputed hash will
  not match the lock — approvals are stale and the gate drops back to `comment`. Re-lock (Step 5 of the
  skill) and re-approve.

## Why a hash (vs structured diff)

A hash is the smallest representation that proves "did the agreed surface change?" — which is all the
front half needs. A field-by-field structured diff is a Phase 3 concern (it tells you *what* drifted in
a failing PR); the lock established here is what that future check compares against.
