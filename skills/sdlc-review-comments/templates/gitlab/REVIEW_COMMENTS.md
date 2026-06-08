# Review comments — canned replies

Copy a block below into an MR review comment. Keep the `**<name> (<role>)**` header — it matches the
SDLC review ledger (`reviews/<artifact>--<date>--comments.md`) so feedback stays attributable.
`<role>` is one of `owner | reviewer | domain-owner`.

## Blocking (a gate or rule says stop — must be fixed before merge)

**<name> (<role>)**
- spec-link: this range has no `Task: <story>-<task>` trailer — the spec-link gate will fail. Add the
  trailer and make sure `specs/<story>/link.md` exists.

**<name> (<role>)**
- contract-check: this diff changes the contract surface without `Contract-Change: yes` + a re-locked
  contract. Route back to the architecture gate and re-lock before merge.

**<name> (<role>)**
- build-test-lint: lint/build/test is red, or the test doesn't exercise the new behavior. The gate must
  pass with a test that actually exercises the acceptance criterion.

**<name> (<role>)**
- file-boundary: this touches files the task's `Files:` list didn't declare. Re-scope the task (re-run
  `sdlc-spec`) instead of widening the diff.

## Routing / escalation

**<name> (<role>)**
- routing: risk is `high` / a contract|auth|payments surface is touched — needs a domain-owner approval
  per touched repo (same escalation as `sdlc-review-gate`). Run `bash checks/risk-route.sh <body>`.

## Non-blocking

**<name> (<role>)**
- Suggestion (non-blocking): …

**<name> (<role>)**
- Nit: …

**<name> (<role>)**
- Question: … (not blocking — just want to understand).

## Approval

**<name> (<role>)**
- Approving as `<role>`. Recorded in `approvals.json` (ship: `build-log.json`).

---
> Tip (GitLab): paste the blocks you use most into your personal/group **Comment templates**
> (Preferences → Comment templates) so they are one click away in any MR.
