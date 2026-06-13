# Testing context — MCP detection, generate vs link, and the degrade path

How a connected testing tool turns into the actual automation tests the test-cases step materializes.
The testing tool is reached through its **MCP** (a harness MCP server), the same shape as the design
tool — detect it, use it when present, degrade cleanly when absent. This is the testing-side analogue of
`yad-connect-design`'s design-context.

## Provider detection

`connect`/`refresh` records `provider` (the concrete MCP) and `source` (the MCP id, or `unavailable`).
Detection is best-effort against the user's own authenticated MCP session:

| `tool` | MCP / provider | Capability |
|--------|----------------|------------|
| `playwright` | a Playwright MCP | **generate** — author + run E2E/API specs against the app |
| `cypress` | the Cypress MCP | **generate** — author + run Cypress specs |
| `pytest` | a pytest MCP | **generate** — author + run service-layer tests |
| any | a read-only runner MCP | **link** — reference an existing suite and read results back |
| other | the adapter's named MCP | per that adapter |

**Honest capability note:** not every testing-tool MCP can *write* tests. A read-only runner MCP
supports **link + read-back** only; *generate* needs a write-capable provider. `yad-test-cases` picks
the direction the connected provider actually supports and records which one it used
(`direction: generated | linked`). It never claims to have generated tests a read-only MCP cannot
produce.

## Generate (write automation tests into the repo)

When the connected provider is write-capable, the `test architect` lens (Murat, `bmad-tea` +
`bmad-testarch-automate`) produces the epic's automation tests in the connected code repo(s), covering
the cases `test-cases.md` enumerates and the acceptance criteria the stories define:

- **Playwright** — the lens authors `*.spec.ts` E2E/API specs (reusing the repo's existing fixtures and
  the code-maps from `yad-test-cases` Step 2b), one spec per high-priority (P0/P1) case, and runs them
  via the MCP to confirm they execute.
- **Cypress / pytest** — the lens authors the equivalent specs in that framework's layout.

Reuse what already exists: load the connected code repos' code-maps (`yad-test-cases` Step 2b) so
generated tests target real endpoints/components, not invented ones, and prefer the lowest useful test
level (unit > integration > E2E) per Murat's principles.

## Link (reference an existing suite)

When a suite already exists (or the provider is read-only), point `yad-test-cases` at it and **read the
suite back** so `test-cases.md` reflects the real tests: list each test as a case, capture its
path/name + URL, and map it to the story it covers.

## Write back the linkage (done by `yad-test-cases`, per epic)

Either direction ends by writing `epics/EP-<slug>/.sdlc/test-links.json` — the machine-readable
case→test map — and a `## Automation (<tool>)` section in `test-cases.md` linking each case to its test.
The tests themselves live in the code repo; the hub keeps the *links* and the Markdown spec beside the
other epic artifacts.

## Degrade path (no MCP / no tool)

If `testing.json` is absent, `tool: "none"`, or `source: "unavailable"`, `yad-test-cases` runs
**artifacts-only**: it authors `test-cases.md` exactly as before and records `testing: none` in the
frontmatter with a one-line note (mirroring the `design: none` degrade). No error — the testing tool is
purely additive.

## Staleness / refresh

A re-generated or hand-edited suite is like a moved code repo: `yad-test-cases` **flags** a divergence
and lets a human decide (re-run the step, or `yad-connect-testing` action: refresh). It never silently
overwrites a hand-written suite — refreshing the automation is a human decision, the same discipline as
`code_context.refresh: human`.
