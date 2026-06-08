# Review comment conventions

The scaffold (`REVIEW_COMMENTS.md`) groups canned comments into **blocking** (a gate would fail / must
be fixed before merge) and **non-blocking** (suggestions, nits, questions). Every comment starts with an
attributable header:

```
**<name> (<role>)**
```

`<role>` is one of `owner | reviewer | domain-owner` — the same roles `sdlc-review-gate` records. This
header matches the `## <name> (<role>)` headings the gate writes into
`reviews/<artifact>--<date>--comments.md`, so a comment copied from the PR thread (or synced by
`sdlc-hub-bridge`) needs no reformatting to land in the ledger.

## Blocking comments (a gate or rule says stop)

These map to the code-repo check gates (`sdlc-checks`) and the file-boundary / contract rules:

- **spec-link** — "This commit has no `Task: <story>-<task>` trailer; the spec-link gate will fail. Add
  the trailer (and ensure `specs/<story>/link.md` exists)."
- **contract-check** — "This diff changes the contract surface without `Contract-Change: yes` + a
  re-locked contract. Route back to the architecture gate and re-lock before this can merge."
- **build-test-lint** — "Lint/build/test is red (or the test doesn't exercise the new behavior). The
  build-test-lint gate must pass with a test that actually exercises the acceptance criterion."
- **file-boundary** — "This diff touches files the task's `Files:` list didn't declare. Re-scope the
  task (re-run `sdlc-spec`) rather than widening the diff silently."

## Escalation / routing comment

- **routing** — "Risk is `high` / a contract|auth|payments surface is touched — this needs a
  domain-owner approval per touched repo (the same escalation `sdlc-review-gate` applies). Run
  `bash checks/risk-route.sh <body>` (code repo) or `bash checks/hub-route.sh <body>` (hub)."

## Non-blocking comments

- **suggestion** — "Suggestion (non-blocking): …"
- **nit** — "Nit: …"
- **question** — "Question: … (not blocking — just want to understand)."

## Approval note

- **approve** — "Approving as `<role>`. Recorded in `approvals.json` (code-repo ship: `build-log.json`).
  On the hub, your approval here is pulled in by `sdlc-review-gate action: sync`."

## Hub front-artifact review

The hub scaffold adds a **Front-artifact review** section whose headers mirror the gate's comment file
exactly, so reviewing an `epic.md` / `architecture.md` / `ui-design.md` / `stories/` PR produces comments
that drop straight into `reviews/<artifact>--<date>--comments.md`:

```
**<name> (<role>)**
- <comment about scope / contract surface / acceptance signals / story split>
```
