# Foundation schema — the sections and the ledger

The Foundation is the Product level (E75). It lives in `{project-root}/foundation/`, with its fixed id
`EP-foundation`:

```
foundation/
  purpose.md  market.md  scope.md  mvp.md  roadmap.md  stack.md  repos.md  risks.md
  .sdlc/state.json  approvals.json  comments.json  product-prs.json  hub-prs.json
  reviews/
```

## The ledger (`foundation/.sdlc/state.json`)

Written by `yad foundation new`, never by hand. What it holds, for reference:

```text
epicId       EP-foundation
kind         foundation       the marker every reader keys off (not a work-item type — there is none)
profile      foundation       the route: two steps, no Build
currentStep  foundation → foundation-review → foundation-done
steps        foundation (author, artifact foundation/) · foundation-review (review+approve, artifact foundation/)
```

- `artifact: "foundation/"` is a **virtual** base: the gate fingerprints the Foundation sections together
  (`foundationHash` in `cli/epic-state.mjs`). An edit to any section revokes prior approvals.
- The six **required** sections must all exist before the Foundation is reviewable. The two
  **optional** ones (`market.md`, `risks.md`) count once they exist.
- On approval the gate sets `currentStep: "foundation-done"`. The Foundation has no Build, so it never
  becomes `ready-for-build`.
- The review branch is `review/EP-foundation/foundation`, which both gate-sync workflows already match.
- On a **verified** ledger, `foundation/.sdlc/` and `foundation/reviews/` are CI-owned exactly like an
  epic's. The committed `checks/ledger-guard.sh` must be from E75 or later to guard them — `yad doctor`
  warns when it is not, and `yad update` refreshes it.

## Section templates

Every section carries the same frontmatter block:

```markdown
---
id: EP-foundation
artifact: <section>
status: draft
owner:
---
```

### `purpose.md`

```markdown
## Why this exists
## Who it is for
## What success looks like
<!-- measurable where possible -->
```

### `market.md` *(optional)*

```markdown
## Who else does this
| Competitor | What they do | Where they fall short |
|---|---|---|
## Why us
```

### `scope.md`

```markdown
## What it is
## What it is NOT
<!-- explicit non-goals — the list a reviewer checks each feature epic against -->
```

### `mvp.md`

```markdown
## The smallest thing worth shipping
## What is deliberately left out of it, and why
```

### `roadmap.md` (the spine of the review)

```markdown
## Summary
<!-- the product thesis in 2–3 lines -->

## Phase 1 — MVP
| Feature | Proposed epic id | Status |
|---------|------------------|--------|
| Registration | EP-registration | planned |

## Phase 2 — <name>
| Feature | Proposed epic id | Status |
|---------|------------------|--------|

## Later / parked
<!-- explicitly deferred, with why -->
```

Per-feature `status:` (set by hand): `planned` → `epic-started` (a feature epic has been seeded with
`yad-epic`) → `shipped`. The proposed ids are suggestions — `yad-epic` still assigns the id, and never
picks the reserved `EP-foundation` or `EP-discovery`.

### `stack.md`

```markdown
## Languages and frameworks
## Hosting and runtime
## Data stores
<!-- brownfield: what the connected repos actually use, from their code-maps -->
```

### `repos.md`

```markdown
## Layout
<!-- monorepo or separate repos, and why -->
| Repo | What it does |
|------|--------------|
```

### `risks.md` *(optional)*

```markdown
| Risk | Why it could kill this | What we do about it |
|------|------------------------|---------------------|
```
