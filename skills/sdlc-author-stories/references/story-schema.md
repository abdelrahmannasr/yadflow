# Story schema

Each story authored at front state 7 is one Markdown file under `epics/EP-<slug>/stories/`, named
`EP-<slug>-S0N.md` (zero-padded, never renamed).

## Frontmatter

| Field | Values | Meaning |
|-------|--------|---------|
| `id` | `EP-<slug>-S0N` | Stable story ID. Engine-assigned, zero-padded, never renamed. |
| `epic` | `EP-<slug>` | Parent epic ID — the unbroken link back to the epic. |
| `status` | `draft` \| `in_review` \| `approved` | Story lifecycle within the stories gate. |
| `repos` | subset of the epic's `repos` | Which repos must implement this story. **Drives per-repo review routing now and (Phase 3) where specs are scaffolded.** |

## Body

```markdown
## Story
As a <role>, I want <capability>, so that <outcome>.

## Acceptance criteria
- [ ] <testable criterion>
- [ ] <testable criterion>

## Notes for build
<!-- contract surface touched, architecture components involved, UI screens -->
```

## Rules

- **IDs are permanent.** Continue numbering from the highest existing `S0N`; never renumber. Renaming
  breaks every downstream link (build plan §6b).
- **`repos` must be a subset of `epic.repos`.** A story cannot touch a repo the epic does not declare.
- **Acceptance criteria are testable.** They are what the Phase 3 build (Spec Kit `specify`→`tasks`)
  and the check gates verify against.
- **Stay within the contract surface.** "Notes for build" should reference the contract elements a
  story touches; a story may not invent cross-repo surface that `contract.md` does not define.

## Per-repo review routing (the stories gate)

`sdlc-review-gate` treats each repo's engineer as the `domain-owner` for the stories touching that repo.
The gate passes only when, in addition to the base rule (owner + 1 reviewer), **every repo appearing in
any story's `repos`** has at least one `domain-owner` approval scoped to that repo (`domain` = repo
name). The gate's `approved.md` lists which repos still lack sign-off.
