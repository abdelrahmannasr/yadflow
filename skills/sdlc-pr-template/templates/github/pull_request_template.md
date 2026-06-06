<!-- SDLC PR template (Phase 3 build plan §D). One atomic task per PR. -->

## Summary
<!-- What this PR does, in one or two sentences. -->

## Story / task
<!-- The commits MUST carry a `Task: <story>-<task>` trailer (the spec-link gate checks this). -->
- Story / task: `EP-<slug>-S0N-T0N`
- Spec: `specs/EP-<slug>-S0N/` (link.md points back to the product repo)

## Impact & Risk
<!-- Fill every field. risk-route.sh + the engineer review read this block. -->
- **Domains / repos touched:** <backend | mobile | …>
- **Contract surface touched:** no <!-- yes => needs Contract-Change + a re-locked contract (contract-check) -->
- **Risk level:** low <!-- low | medium | high — high (or a contract/auth/payments surface) routes to domain owners -->
- **Rollback plan:** <how to revert if this misbehaves>

> **Routing:** `low`/`medium` → base rule (owner + 1 reviewer). `high` (or a touched
> contract/auth/payments surface) → **plus one domain-owner approval per touched domain**, the same
> escalation `sdlc-review-gate` applies. Run `bash checks/risk-route.sh <this-description>` to list them.

## Testing
<!-- How the acceptance criteria were exercised. Tests must exercise behavior, not just pass. -->

## Checklist
- [ ] Commits carry a `Task: <story>-<task>` trailer (spec-link gate)
- [ ] No contract-surface change without `Contract-Change: yes` + a re-locked contract (contract-check gate)
- [ ] Lint, build, and tests pass (build/test/lint gate)
- [ ] Diff stays inside the files the task's spec declared (≤3 where possible)
- [ ] Impact & Risk filled; `high` risk adds the required domain-owner reviewers
