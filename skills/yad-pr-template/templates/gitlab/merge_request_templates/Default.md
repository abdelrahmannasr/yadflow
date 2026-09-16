<!-- SDLC MR template (Phase 3 build plan §D). One atomic task per MR. -->
<!-- GITLAB 2700-CHARACTER LIMIT: the yad-pr-template gate reads $CI_MERGE_REQUEST_DESCRIPTION, which
     GitLab truncates at 2700 characters — a heading past the cutoff reads as missing even though you
     can see it here. Keep Summary, Impact & Risk (with its filled risk-level line) and Checklist
     within the first 2700 characters; put long narrative below them. Reorder, never delete. -->

## Summary
<!-- What this MR does, in one or two sentences. -->

## Story / task
<!-- The commits MUST carry a `Task: <story>-<task>` trailer (the spec-link gate checks this). -->
- Story / task: `EP-<slug>-S0N-T0N`
- Spec: `specs/EP-<slug>-S0N/` (link.md points back to the product repo)

## Impact & Risk
<!-- Fill every field. risk-route.sh + the engineer review read this block. -->
- **Domains / repos touched:** <backend | mobile | …>
- **Contract surface touched:** no <!-- yes => needs Contract-Change + a re-locked contract (contract-check) -->
- **Risk level:** low <!-- low | medium | high — high (or a contract/auth/payments surface) raises the advisory approver count -->
- **Rollback plan:** <how to revert if this misbehaves>

> **Routing:** the merge needs **1 approval from someone other than the author**. `high` risk adds 1
> and a touched contract surface adds 2 to the count (the larger, never the sum); that step is advisory
> until the capacity cap. Run `bash checks/risk-route.sh <this-description>` to print the count.

## Testing
<!-- How the acceptance criteria were exercised. Tests must exercise behavior, not just pass. -->

## Checklist
- [ ] Commits carry a `Task: <story>-<task>` trailer (spec-link gate)
- [ ] No contract-surface change without `Contract-Change: yes` + a re-locked contract (contract-check gate)
- [ ] Lint, build, and tests pass (build/test/lint gate)
- [ ] Diff stays inside the files the task's spec declared (≤3 where possible)
- [ ] Impact & Risk filled; for `high` risk, ask reviewers who know the touched domains

/assign me
