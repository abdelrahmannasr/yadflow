<!-- Yadflow's own PR template — the same Impact & Risk discipline yad-pr-template installs
     into your code repos, dogfooded on the framework itself (adapted: this repo uses
     Conventional Commits, not story/task IDs). -->

## Summary
<!-- What this PR does, in one or two sentences. -->

## Impact & Risk
<!-- Fill every field — the engineer review reads this block. -->
- **Areas touched:** <cli | skills | checks | ci | docs | …>
- **Check-gate behavior touched:** no <!-- yes => the safety story changed; explain in Testing -->
- **Risk level:** low <!-- low | medium | high -->
- **Rollback plan:** <how to revert if this misbehaves>

## Testing
<!-- How the change was exercised. Tests must exercise behavior, not just pass. -->

## Checklist
- [ ] Commits follow [Conventional Commits](CONTRIBUTING.md) (they drive semantic-release)
- [ ] `npm test` and `npm run test:e2e` pass locally
- [ ] New behavior is covered by tests (coverage gate: ≥70% lines/branches)
- [ ] Docs updated where behavior changed (README / skill SKILL.md / TEAM-GUIDE)
