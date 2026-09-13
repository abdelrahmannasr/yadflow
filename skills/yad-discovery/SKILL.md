---
name: yad-discovery
description: 'The Foundation step of the gated SDLC — the Product level, run once per product before any feature epic. With the field-expert lenses (analyst + pm), frame the product and write the Foundation sections into foundation/ — purpose, market (optional), scope (what it is AND what it is not), MVP, roadmap, stack, repos, risks (optional). Greenfield AND brownfield (brownfield reads the connected code). The engine seeds the ledger with `yad foundation new`; this skill authors the sections, then hands off to the team review gate and never auto-advances. Its roadmap.md is the menu of features each yad-epic reads. Use when the user says "start the project", "write the Foundation", "do discovery", "market research / feasibility / roadmap", or "what should we build first".'
---

# SDLC — Foundation (the Product level)

**Goal:** Produce a human-authored, AI-assisted **Foundation** for the whole product under
`{project-root}/foundation/`, then hand off to `yad-review-gate`. The Foundation says why the product
exists, what it is and is not, the smallest thing worth shipping, and the rough order after that. Its
`roadmap.md` is the menu of features; each feature is later taken into the normal `yad-epic` flow,
which reads it for project context.

**What the Foundation is.** The roadmap (`docs/roadmap-idea-1.md`, Part 1) has two levels. The
**Product** level runs once per product and holds the Foundation. The **Feature** level runs once per
epic and walks the six phases. The Foundation has its own gate: one approval before feature work
begins. That approval is **reported, not enforced** in this release — `yad next` says when feature
epics are going ahead of an unapproved Foundation, and nothing is blocked.

This is a **Shape step**: human-authored with AI assist and **never auto-advances**. It is
**optional** — a team that already knows what to build can start at `yad-epic`. It supports **both
greenfield and brownfield**.

The skill keeps its old name, `yad-discovery`. Before E75 it wrote a different set of files under the
reserved `EP-discovery` epic; that older spelling is still read (see Step 1).

## Conventions

- `{project-root}` resolves from the project working directory.
- The Foundation lives in `{project-root}/foundation/`: its sections directly inside it, its ledger in
  `foundation/.sdlc/`, and its review summaries in `foundation/reviews/`. Its fixed id is
  `EP-foundation` — every `yad` command takes that id.
- Speak in the configured `communication_language`; write documents in `document_output_language`.

## On Activation

### Step 1 — Entry guard (one Foundation per product)
- If `{project-root}/foundation/.sdlc/state.json` already exists, **STOP** and point the user at
  `yad next EP-foundation`. The Foundation is already seeded; edit its sections in place.
- If `{project-root}/epics/EP-discovery/.sdlc/state.json` exists, this product already has its Product
  level **in the old spelling**. A product has ONE Foundation, so do not seed a second. **STOP** and tell
  the user:
  - on a **local** ledger, `yad migrate` (preview) then `yad migrate --apply` converts it into
    `foundation/`, keeping its files and approvals;
  - on a **verified** ledger CI owns that ledger and it cannot be moved by hand — keep working in
    `epics/EP-discovery/`, and review it with `yad gate open EP-discovery discovery/`.

Detect the project mode from `{project-root}/.sdlc/hub.json` `profile.codebase`
(`greenfield` | `brownfield`, set by `yad setup`). If absent, ask the user; default `greenfield`.

### Step 2 — Shape with the field-expert lenses (assist: analyst + pm)
Adopt the **analyst** lens (`bmad-agent-analyst`, Mary) and the **pm** lens (`bmad-agent-pm`) to frame
the product as a domain expert would. Drive the existing research skills as the assist:
- `bmad-market-research` — market size, segments, demand, trends, positioning.
- `bmad-domain-research` — the problem domain, regulations, and constraints of the field.
- `bmad-product-brief` — personas, value proposition, success metrics.

Pressure-test: who is this for and why does it exist, what does success look like, who else does this
and why us, **what it is and explicitly what it is not**, what the smallest valuable slice is, what
sequences after it, what it is built with, and what could kill it.

### Step 2b — Brownfield: read what already exists
Read the registry `{project-root}/.sdlc/repos.json` (`config.yaml` `code_context`). For **every
connected repo**, load the lightweight code-map `{project-root}/.sdlc/code-context/<repo>/code-map.md`
and base `stack.md` and `repos.md` on **what already exists** — languages, frameworks, modules,
endpoints, data — so the Foundation describes the real system rather than re-proposing it.

- **Greenfield-safe:** if `repos.json` is absent or empty, `stack.md` and `repos.md` record the
  intended choices and why.
- **Staleness:** if a repo's current HEAD (`git -C <path> rev-parse HEAD`) ≠ its registry `syncedHead`,
  warn and suggest `yad repo refresh <repo>` (a human decision — flag, never auto-refresh).
- **Backfill pointer:** for an existing codebase, point the user at `yad-backfill` to capture specs for
  already-built features; the Foundation frames the *product*, backfill captures the *features*.

### Step 3 — Open the authoring branch
Open the Foundation authoring branch `foundation/EP-foundation` per the shared procedure
(`../yad-epic/references/state-schema.md` → "Authoring branches"): git-safe (skip with a note if
`{project-root}` is not a git work tree), check out the branch if it exists, else create it from the
Product's default branch. Author and commit the Foundation on it. Distinct from the verified ledger's
`review/EP-foundation/foundation` branch.

### Step 4 — Seed the ledger with the engine
Run:

```
yad foundation new
```

That writes `foundation/.sdlc/state.json` with the Foundation's two-step chain (`foundation` →
`foundation-review`), an empty `approvals.json` and `comments.json`, and the `foundation/reviews/`
folder. The engine owns that file: do not write or edit it by hand. The command refuses a second
Foundation and a product still on the old spelling (Step 1 already stopped for both).

### Step 5 — Write the Foundation sections
Write these files directly in `{project-root}/foundation/`, one per section, using the templates in
`references/foundation-schema.md`. The gate binds to the **whole set**: editing any section revokes
approvals.

| File | Section | Required? |
|---|---|---|
| `purpose.md` | Why this exists, who it is for, what success looks like | required |
| `market.md` | Who else does this, and why us | optional |
| `scope.md` | What it is — **and explicitly what it is not** | required |
| `mvp.md` | The smallest thing worth shipping | required |
| `roadmap.md` | The rough order after the MVP — the menu of feature epics | required |
| `stack.md` | Languages, frameworks, hosting, databases | required |
| `repos.md` | How many repos, what each does, monorepo or separate | required |
| `risks.md` | What could kill this | optional |

**All six required sections must exist to review.** Until they do, the Foundation has no fingerprint to
bind an approval to, and `yad gate open` warns. An optional section counts once it exists — adding or
removing one after an approval revokes it, like any other edit.

Leave `owner` for the user to set in each frontmatter. Fill the bodies with the user.

### Step 6 — Stop at the gate (do NOT advance)
Report the path to the Foundation, and that the next action is **review** via `yad-review-gate`:

```
yad gate open EP-foundation foundation/
```

**Never mark `foundation-review` approved here** — only real reviewers do that through the gate. When
the gate passes, the ledger moves to the `foundation-done` sentinel (not `ready-for-build` — the
Foundation has no Build). From then on `foundation/roadmap.md` and `foundation/scope.md` are the inputs
each `yad-epic` reads (its "Step 2c"). When the Product has a platform, the gate opens a review PR on the
Product (via `yad-hub-bridge`) and `yad-review-gate action: sync` pulls platform approvals and comments
into the ledger; otherwise the review is recorded locally.

## Reference
- Foundation section templates: `references/foundation-schema.md`.
- The older spelling of the Product level (`EP-discovery`, its six files, and how it converts):
  `references/discovery-schema.md`.
- State schema, chain shapes, and the authoring-branch procedure:
  `../yad-epic/references/state-schema.md`.
- The epic step that consumes `roadmap.md`: `../yad-epic/SKILL.md` (Step 2c).
- Capturing already-built features in a brownfield codebase: `../yad-backfill/SKILL.md`.
- Connecting code repos + the code-context the brain reads: `../yad-connect-repos/SKILL.md`.
