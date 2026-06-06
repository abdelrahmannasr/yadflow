# Spec Kit handoff — command list, output map, and degradation rules

Step A (`sdlc-spec`) runs the **heavy Spec Kit ceremony once per story per repo** and writes the
result into the story's code repo. This reference pins the exact commands, the files they produce, and
how to hand-author the same files faithfully when Spec Kit is not installed — so Step B
(`sdlc-implement`, not built yet) can read them unchanged.

## The ceremony (run once, in order)

Driven as harness slash-commands (RESEARCH-NOTES §2, Deviation 3), from **inside** the code repo:

| # | Command | Purpose | Writes |
|---|---------|---------|--------|
| 1 | `/speckit.specify`   | Turn the story into a spec | `specs/<feature-id>/spec.md` (+ `research.md`, `data-model.md`, `contracts/`) |
| 2 | `/speckit.clarify`   | Resolve ambiguities; tighten the spec | updates `spec.md` |
| 3 | `/speckit.plan`      | Technical approach for this repo | `specs/<feature-id>/plan.md` |
| 4 | `/speckit.analyze`   | Cross-check spec ↔ plan consistency | updates `spec.md`/`plan.md` |
| 5 | `/speckit.checklist` | Quality checklist for the spec | checklist section under `specs/<feature-id>/` (in the degraded path, folded into `spec.md`) |
| 6 | `/speckit.tasks`     | Atomic task list | `specs/<feature-id>/tasks.md` |

**Excluded from Step A:** `/speckit.constitution` (project-level, one-time bootstrap) and
`/speckit.implement` (that is Step B — the per-task build loop). Stop at `tasks`.

**Feature-id is pinned** to the story ID (`EP-<slug>-S0N`), never Spec Kit's numbered auto-slug. If a
Spec Kit version forces its own folder name, keep the run but make `link.md` (below) the crosswalk
between the Spec-Kit slug and the permanent story ID.

## Output map (what must exist after Step A)

```
demo-repos/<repo>/specs/<story-id>/
  spec.md         # the feature spec — what to build & why, traced to acceptance criteria
  research.md     # decisions/unknowns resolved during clarify
  data-model.md   # entities/fields THIS repo implements (quoting the shared ones from the contract)
  contracts/      # the API/event surface this repo implements (quoted from the locked contract)
  plan.md         # technical approach for this repo
  tasks.md        # numbered atomic tasks (T01…), each scoped to the files it may touch
  link.md         # back-pointer to the story in the product repo (Step A adds this; not a Spec Kit file)
```

## Degradation rules (when Spec Kit is not installed)

Author each file by hand so it is **indistinguishable in shape** from a real Spec Kit run. The content
comes from the story's acceptance criteria and the **locked contract surface** — never invented.

- **`spec.md`** — restate the story as a spec: context, the user/system need, in-scope behavior,
  out-of-scope, and acceptance criteria copied verbatim from the story. Reference (do not redefine) the
  contract endpoints/entities the story touches.
- **`research.md`** — list the decisions and any unknowns; if the story is unambiguous, say so. Note
  where the contract already settles a question (e.g. status is server-owned).
- **`data-model.md`** — the entities/fields **this repo** implements. Shared entities (e.g. `Inquiry`,
  `InquiryStatus`) are **quoted from the contract** and marked as contract-owned; repo-private fields
  are marked as local.
- **`contracts/`** — the slice of the API/event surface this repo implements, **quoted from the locked
  `contract.md`** (e.g. `POST /inquiries` request/response). Add a one-line note that this is a quote of
  the locked surface, not a new definition.
- **`plan.md`** — the technical approach for this repo at story altitude (components, sequence,
  test approach). No new cross-repo surface.
- **`tasks.md`** — numbered atomic tasks. Each task: an ID (`T01`, `T02`, …), a one-line goal, and an
  explicit **Files** list naming the files it may touch (≤3 where possible). This is what Step B reads
  to enforce "the diff stays inside the files the task declared."

## link.md template

```markdown
---
story: EP-<slug>-S0N
epic: EP-<slug>
repo: <repo>
feature-id: EP-<slug>-S0N
product-repo: <absolute or relative path to the product repo>
contract-lock: sha256:<hex copied from epics/EP-<slug>/.sdlc/contract-lock.json>
speckit: installed | not-installed
generated: <YYYY-MM-DD>
---

# Spec link — EP-<slug>-S0N (<repo>)

This spec implements story **EP-<slug>-S0N** of epic **EP-<slug>** for the **<repo>** repo.

- Story: `<product-repo>/epics/EP-<slug>/stories/EP-<slug>-S0N.md`
- Contract (locked, singular): `<product-repo>/epics/EP-<slug>/contract.md`
- Contract surface hash at spec time: `sha256:<hex>` (copied from the lock, not recomputed here)

The contract surface above is **referenced, not re-defined**. Any change to the shared surface must go
back to the architecture gate in the product repo — it is never widened from this code repo.
```

## Do not re-invent the contract

The spec **quotes** the locked surface; it never extends it. To confirm the surface the spec relies on
matches the lock, run from the **product** repo:

```bash
awk '/CONTRACT-SURFACE:BEGIN/{f=1;next} /CONTRACT-SURFACE:END/{f=0} f' \
  epics/EP-<slug>/contract.md | shasum -a 256
# compare against epics/EP-<slug>/.sdlc/contract-lock.json
```

If the story needs surface that is not in the locked block, STOP and route back to the architecture
gate. Step A never re-locks or widens the contract.
