# Test-cases schema

The test cases authored at front state 9 are one Markdown file under `epics/EP-<slug>/`, named
`test-cases.md` (one per epic — mirrors `ui-design.md`, not a per-story folder). The optional automation
linkage is a sibling `test-links.json`.

## Frontmatter

| Field | Values | Meaning |
|-------|--------|---------|
| `id` | `EP-<slug>` | The epic ID — the artifact is epic-level. |
| `epic` | `EP-<slug>` | Parent epic ID — the unbroken link back to the epic. |
| `artifact` | `test-cases` | Marks the artifact kind (mirrors `ui-design`). |
| `status` | `draft` \| `in_review` \| `approved` | Lifecycle within the test-cases gate. |
| `owner` | name | Inherited from `epic.md` `owner` (the single source — not retyped). |
| `repos` | subset of the epic's `repos` | Which repos the automation targets. |
| `code-context` | `{ repos: [<name@sha>], loaded: <date> }` | Optional. Which connected-repo code-maps anchored the tests (Step 2b). The `@sha` (a repo's `syncedHead`) is recommended so freshness is recorded but may be omitted; the SKILL template shows the empty placeholder `{ repos: [], loaded: <date or none> }`. `none` / `[]` when no repos are connected. |
| `testing` | `none` \| `{ tool, direction, suite, tests }` | The connected testing tool and what it produced (Step 3b). `none` when the step ran artifacts-only. |

## Body

```markdown
## Test strategy & risk
<!-- risk assessment (category, probability, impact, score), entry/exit criteria, NFR thresholds -->

## Test cases
<!-- one row/subsection per case: id, story covered, priority (P0–P3), level, preconditions, steps, expected -->

## Coverage & traceability
<!-- story -> case map; every story's acceptance criteria must be covered -->

## Automation (<tool>)
<!-- omit when testing: none. one row per automation test, linking to it in the repo. mirrors test-links.json -->
```

## `test-links.json` (sibling, when a tool was used)

Written by `yad-test-cases` Step 4b. Absent when the step ran artifacts-only (`testing: none`).

```json
{
  "tool": "playwright",
  "suite": "tests/playwright.config.ts",
  "generatedAt": "<YYYY-MM-DD>",
  "direction": "generated | linked",
  "tests": [
    { "case": "TC-01", "story": "EP-<slug>-S01", "repo": "backend", "level": "e2e",
      "path": "tests/inquiry.spec.ts", "url": "<repo url to the test>" }
  ],
  "source": "playwright-mcp"
}
```

## Rules

- **Cover every story.** The "Coverage & traceability" section must map each story's acceptance criteria
  to at least one case — an unmapped criterion is a gap the reviewer should catch.
- **Priorities are risk-based.** P0 = critical (run on every commit) … P3 = low (on-demand); depth
  scales with impact (Murat's principle).
- **Prefer the lowest useful level.** unit > integration > E2E when a case can be verified lower.
- **`repos` is a subset of `epic.repos`.** Automation cannot target a repo the epic does not declare.
- **Single-file, not a folder.** `test-cases.md` resolves through the gate's default content-hash path
  (the file's bytes), so the review gate, revoke-on-change, and review-PR machinery work unchanged.
- **Automation is additive.** When no testing tool is connected, the step still produces a complete
  `test-cases.md`; `testing: none` and no `test-links.json`.

## Review routing (the test-cases gate)

The test-cases gate uses the **base rule** (owner + 1 reviewer) — it is not escalated. The natural
reviewer is the test architect / QA owner, but the gate predicate requires only owner + 1.
