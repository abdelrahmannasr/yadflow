# Data mapping — artifacts → `src/data/*.ts`

`yad-docs` copies the shell verbatim and **generates** the five data modules under `src/data/`. The
shell renders whatever these export, as long as it satisfies `src/data/types.ts`
(`FlowPath` / `FlowStep` / `AnimatedMessage` / `SystemComponent` / `StakeholderView` / `RoleConfig` /
`DocSectionConfig`). The generation is the AI step; it must be **deterministic** (rules at the bottom).

## Artifact → data-structure table

| Generated file | Exports | Fed by (artifact) | What maps |
|----------------|---------|-------------------|-----------|
| `components.ts` | `COMPONENTS: SystemComponent[]` | `architecture.md` system components + `code-map.md` module/endpoint names | each durable component → `{ id, label, icon, color, position, description }`; canvas `position` laid out deterministically; real module names from the code-map enrich `label`/`description`. |
| `paths.ts` | `FLOW_PATHS: FlowPath[]` | `stories/*.md` (one FlowPath each) + `architecture.md` flows | each story → one `FlowPath` (`id`, `label`, `icon`, `color`, `category`, `steps[]`); each acceptance criterion → a `FlowStep` whose `messages: AnimatedMessage[]` animate the request/response/event/job and whose `sideEffects` record jobs/notifications/pubsub. UI states (from `ui-design.md`) annotate each step. |
| `roles.ts` | `ROLES: RoleConfig[]` | hub roster (`.sdlc/hub.json`) + the yadflow lens set + stories' `repos:` tags | each stakeholder lens → `{ slug, label, shortLabel, icon, color, description, sectionIds, relevantPathIds }` (role derivation below). |
| `docSections.ts` | `DOC_SECTIONS: DocSectionConfig[]` | `epic.md`, `architecture.md`, `contract.md`, `ui-design.md`, `test-cases.md` | the ordered doc-section registry (`{ id, title, icon, iconColor, component }`); each section id is referenced from `roles.ts`. |
| `referenceData.ts` | the reference tables/payloads the doc-section components render | `contract.md` CONTRACT-SURFACE (authoritative) + `architecture.md` + `test-cases.md` | API reference rows, the status machine, the DB schema, feature flags, error codes, the test plan — the structured data behind the doc sections. |

## Section sources (the doc sections + their artifact)

| Doc section(s) | Artifact source |
|----------------|-----------------|
| ExecutiveSummary, PMRoadmap | `epic.md` |
| FlowOverview, system components, Deployment, Security | `architecture.md` |
| **ApiReference, StatusMachine, DbSchema** | `contract.md` **CONTRACT-SURFACE — authoritative, must not drift from `contract-lock.json`** |
| Rider/Driver/role UI states, Screens, the theme | `ui-design.md` + `DESIGN.md` + `design-links.json` |
| TestPlan, FlowPathsChecklist, ErrorCodes | `test-cases.md` + `test-links.json` |

Any absent input degrades its section to empty/omitted (greenfield-safe); never invent content. The
contract is rendered exactly as locked — the docs are a *view* of the locked surface, never a re-author.

## Role derivation (`roles.ts`)

A stakeholder role is generated for each lens that is **both** present in the hub roster **and** relevant
to this epic:

1. Start from the **yadflow lens set**: `analyst`, `pm`, `architect`, `ux`, `dev`, `tester`, `reviewer`,
   `engineer`.
2. Intersect with the **hub roster** roles (`.sdlc/hub.json` `roster[].roles`) — only emit lenses the
   team actually has (an unmapped lens is dropped, never invented).
3. For the `dev`/`engineer` lenses, **fan out per `repos:` tag** present across the epic's stories (e.g.
   a `backend` dev role and a `mobile` dev role), so each repo audience gets its own integration view —
   mirroring the reference site's per-app dev roles.
4. Each role maps to its relevant `sectionIds` (which doc sections it should see) + `relevantPathIds`
   (which FlowPaths/stories touch it). Keep these stable: derive `relevantPathIds` from the stories
   tagged with that role's repo, sorted by story id.

## Determinism rules (load-bearing — the data feeds `artifactHash`)

- **Sort by stable IDs:** stories by `S0N`, repos by name, endpoints by `method + path`, roles by lens
  order above. Never sort by anything time- or order-of-discovery-dependent.
- **Fixed key order** in every emitted object (match the `types.ts` field order).
- **No timestamps inside `src/data/*.ts`.** Build/deploy times live only in `docs-build.json`.
- Colors/icons assigned to paths/components/roles come from the theme + a **fixed** lens→icon/color map
  (Material Symbols names), not randomly — so regenerating an unchanged input yields a byte-identical
  file, and the staleness hash only moves when an *artifact* actually moves.
- IDs are derived from the source IDs (story id → `FlowPath.id`, repo/module name → component `id`), never
  freshly minted, so links stay stable across regenerations.

## The DocSection components are NOT purely data-driven — regenerate their content too

The vendored shell ships the reference app's `src/components/DocSections/*.tsx` **with hardcoded
booking-domain content inline** (e.g. `ApiReferenceSection.tsx` declares a literal `ENDPOINTS`
array). They are NOT yet wired to read everything from `referenceData.ts`. So generation has two
parts, both the AI step:

1. **Data files** — write `src/data/{paths,components,roles,docSections,referenceData}.ts` from the
   artifacts (the table above).
2. **Section content** — for every section a role references, replace the inline constants inside the
   matching `DocSections/<Name>Section.tsx` with this epic's content (or refactor the section to read
   its rows from `referenceData.ts`). A section left with the reference's booking content is a bug —
   the docs would describe the wrong system. The contract surface is the authoritative source for the
   API/StatusMachine/DbSchema sections.

Keep both deterministic (sorted, fixed key order, no timestamps) so the build manifest hash only moves
when an artifact actually moves.
