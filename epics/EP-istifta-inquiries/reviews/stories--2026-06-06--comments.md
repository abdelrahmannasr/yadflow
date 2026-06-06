# Review comments — stories/ — 2026-06-06

Stories under review (5): S01 [backend], S02 [mobile], S03 [backend, mobile], S04 [mobile],
S05 [backend]. Touched repos (union): backend, mobile → each repo's engineer reviews the stories
touching their repo.

## bob (reviewer)
- Good slicing. S03 is the only cross-repo story; the rest are single-repo and independently buildable.

## carol (domain-owner — backend) — reviewed S01, S03, S05
- S01: status-is-server-owned criterion is exactly right.
- S05: "exactly once, after status set" is the important ordering guarantee — keep it explicit.
- S03 (backend side): assign transition belongs to the queue read model — fine as written.

## dave (domain-owner — mobile) — reviewed S02, S03, S04
- S04: please keep empty/loading/error in the acceptance criteria (done).
- S02: success navigation to My Inquiries matches the UI flow — good.

## Resolution (owner: alice, pm-assisted)
- No structural changes needed; minor wording confirmed with reviewers. All five stories ready.
