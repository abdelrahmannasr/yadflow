# Discovery schema — artifacts + the front-zero state shape

The project discovery phase ("epic zero") lives under `{project-root}/epics/EP-discovery/`. It reuses
the per-epic ledger files (`.sdlc/state.json`, `approvals.json`, `comments.json`, `reviews/`,
`hub-prs.json`) unchanged — `EP-discovery` is a valid epic id, so the existing gate, PR/MR bridge, CI
sync, and `yad next` all operate on it. What is special is the `kind: "discovery"` marker on the state
object and the 2-step chain.

## State (`.sdlc/state.json`)

```json
{
  "epicId": "EP-discovery",
  "kind": "discovery",
  "createdAt": "<YYYY-MM-DD>",
  "currentStep": "discovery-review",
  "steps": [
    { "id": "discovery",        "type": "author",         "artifact": "discovery/", "assistance": "review", "automation": "human_approve", "locked": true, "status": "done",      "risk_tags": [] },
    { "id": "discovery-review", "type": "review+approve", "artifact": "discovery/", "assistance": "review", "automation": "human_approve", "locked": true, "status": "in_review", "risk_tags": [] }
  ]
}
```

- `artifact: "discovery/"` is a **virtual** base: `artifactHash` fingerprints the whole discovery file
  set (`discoveryHash` in `cli/epic-state.mjs`), so an edit to any discovery file revokes prior
  approvals — exactly like `stories/` fingerprints the stories directory.
- The **full set is required to review**: if any of the six files is missing, `discoveryHash` returns
  `null` — the discovery is **incomplete and non-reviewable** (no hash to bind an approval to), and
  `yad gate open` / `yad gate sync` warn with the missing filenames. Write all six (in greenfield,
  `current-state.md` is a short clean-slate note) before handing off to the gate.
- On approval the gate sets `currentStep: "discovery-done"` (a terminal sentinel — discovery has **no**
  build half, so it never becomes `ready-for-build`).
- The discovery files (relative to the epic dir) the gate commits on the review branch and re-hashes at
  merge are: `market-research.md`, `competitor-analysis.md`, `current-state.md`, `feasibility.md`,
  `requirements.md`, `roadmap.md` (the `DISCOVERY_FILES` list).

## Artifact templates

### `requirements.md`

```markdown
---
id: EP-discovery
artifact: requirements
status: draft
owner:
---

## Functional requirements
<!-- candidate features — each becomes (or seeds) a feature epic later -->

| Ref | Requirement | Description | Priority | MVP? |
|-----|-------------|-------------|----------|------|
| F-01 | Registration | A new user can create an account | must | yes |
| F-02 | Login | A returning user can authenticate | must | yes |

## Non-functional requirements
<!-- cross-cutting qualities the whole product must hold -->

| Ref | Category | Requirement | Target / acceptance |
|-----|----------|-------------|---------------------|
| N-01 | Performance | p95 page load | < 2s on 4G |
| N-02 | Security | auth + data-at-rest | OWASP ASVS L1; encrypted at rest |
| N-03 | Accessibility | WCAG conformance | AA |
```

### `roadmap.md` (the spine of the review)

```markdown
---
id: EP-discovery
artifact: roadmap
status: draft
owner:
---

## Summary
<!-- the product thesis in 2–3 lines; links to market-research, competitor-analysis,
     current-state, feasibility, requirements -->

## Phase 1 — MVP
<!-- the smallest valuable slice; the features here are built first -->

| Feature | Proposed epic id | Requirements | Status |
|---------|------------------|--------------|--------|
| Registration | EP-registration | F-01 | planned |
| Login | EP-login | F-02 | planned |

## Phase 2 — <name>
| Feature | Proposed epic id | Requirements | Status |
|---------|------------------|--------------|--------|
| … | EP-… | F-… | planned |

## Later / parked
<!-- explicitly deferred, with why -->
```

Per-feature `status:` lifecycle (set by hand): `planned` → `epic-started` (a feature epic has been
seeded with `yad-epic`) → `shipped`. The proposed `EP-<slug>` ids are suggestions for the eventual
`yad-epic` runs — `yad-epic` still assigns the id (and skips the reserved `EP-discovery`).

The other four artifacts (`market-research.md`, `competitor-analysis.md`, `current-state.md`,
`feasibility.md`) are free-form Markdown with a `--- id / artifact / status / owner ---` frontmatter
block matching the two above. `competitor-analysis.md` is required in BOTH greenfield and brownfield;
`current-state.md` is the substantive code-aware study in brownfield and a short clean-slate note in
greenfield.
