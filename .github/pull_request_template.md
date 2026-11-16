<!-- Yadflow's own PR template: yad's code-repo template (yad-pr-template), merged by hand with this
     repo's own fields. Keep the Domains field in Impact & Risk under its exact name: risk-route.sh and `yad open-pr` read it.
     One atomic task per PR (or a few small tasks of one story). -->

## Summary
<!-- What this PR does, in one or two sentences. -->

## Story / task
<!-- The spec-link gate fails any commit with no `Task: <story>-<task>` trailer, except ci/chore/build/test commits.
     With no story yet: write "none" — spec-link then fails, but it does not block the merge. -->
- Story / task: `EP-<slug>-S0N-T0N`
- Spec: `specs/EP-<slug>-S0N/` (link.md points back to the Product)

## Impact & Risk
<!-- Fill every field. risk-route.sh + the engineer review read this block. -->
- **Domains / repos touched:** <cli | skills | checks | ci | docs | …>
- **Check-gate behavior touched:** no <!-- yes => the safety story changed; explain in Testing -->
- **Contract surface touched:** no <!-- yes => needs Contract-Change + a re-locked contract (contract-check) -->
- **Risk level:** low <!-- low | medium | high — high (or a touched contract surface) raises the advisory approver count -->
- **Rollback plan:** <how to revert if this misbehaves>

> **Routing:** the merge needs **1 approval, which should not be the author’s own**. `high` risk adds 1
> and a touched contract surface adds 2 to the count (the larger, never the sum); that step is advisory
> (`yad open-pr` shows it capped by the active people). A change to a directory the base branch's `.sdlc/risk-map` marks `high` adds 1
> too, even when this says `low`. Run `bash checks/risk-route.sh <this-description>` on this branch to
> print the count.

## Testing
<!-- How the change was exercised. Tests must exercise behavior, not just pass. -->
- **Preview:** none

## Checklist
- [ ] Commits follow [Conventional Commits](CONTRIBUTING.md) (they drive semantic-release)
- [ ] Every commit except ci/chore/build/test carries a `Task: <story>-<task>` trailer (spec-link gate)
- [ ] No contract-surface change without `Contract-Change: yes` + a re-locked contract (contract-check gate)
- [ ] `npm test` and `npm run test:e2e` pass locally
- [ ] New behavior is covered by tests (coverage gate: ≥70% lines/branches)
- [ ] Docs updated where behavior changed (README / skill SKILL.md / TEAM-GUIDE)
- [ ] Impact & Risk filled; for `high` risk, ask reviewers who know the touched domains
