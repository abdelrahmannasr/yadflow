# Story schema

Each story authored at Shape step 7 is one Markdown file under `epics/EP-<slug>/stories/`, named
`EP-<slug>-S0N.md` (zero-padded, never renamed).

## Frontmatter

| Field | Values | Meaning |
|-------|--------|---------|
| `id` | `EP-<slug>-S0N` | Stable story ID. Engine-assigned, zero-padded, never renamed. |
| `epic` | `EP-<slug>` | Parent epic ID — the unbroken link back to the epic. |
| `owner` | name | Inherited from `epic.md` `owner` (the single source — not retyped per story). Carries the responsible owner through to Build. |
| `status` | `draft` \| `in-review` \| `approved`, then `in-build` \| `shipped` | Story lifecycle: the first three within the stories gate (`yad sync-status` moves them), the last two in Build (`yad build ship` sets `in-build`, `yad build done` sets `shipped`). |
| `repos` | subset of the epic's `repos` | Which repos must implement this story. **Labels the stories review PR with the touched repos now and (Phase 3) decides where specs are scaffolded.** |
| `code-context` | `{ repos: [<name@sha>], loaded: <date> }` | Optional. Which connected-repo code-maps anchored "Notes for build" (Shape step 7 Step 2b). The `@sha` (a repo's `syncedHead`) is recommended so freshness is recorded but may be omitted; the SKILL templates show the empty placeholder `{ repos: [], loaded: <date or none> }`. `none` / `[]` when no repos are connected. |
| `design-frames` | `[<nodeId>, …]` or `[]` | The design-tool frames (Pencil, Figma) of the screens this story builds: each one a `nodeId` from the epic's `.sdlc/design-links.json`, copied exactly. `[]` = the story has no screens; no field = not recorded (also the case for every story of an epic with no `design-links.json`). IDs only: the name, platform and link are read from `design-links.json` by `yad story frames <story>`, which the spec and implement steps run (issue #354). Write it on one line, the IDs without quotes, with no `# comment` after it. Part of the reviewed story: changing it after the stories review passed needs that review again. `yad doctor` warns (`stories:design-frames`) on an ID it cannot find. |

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

## Review (the stories gate)

The stories gate is an ordinary count gate. It passes with at least 1 distinct approver (who should not
be the author) and, with a platform, resolved threads and a merged review PR. It is **not** routed per repo: no repo needs its own
sign-off, and no role is checked. The union of every story's `repos` still names the touched repos, and
the review PR carries a `domain:<repo>` label for each. The review PR requests no reviewers; the team
asks them on the PR itself.
