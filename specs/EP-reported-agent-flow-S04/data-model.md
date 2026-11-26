# Data model — EP-reported-agent-flow-S04

No contract surface: the epic is on the chore route. Nothing new is stored in `state.json`.

| Thing | Where | Shape | Owner |
|---|---|---|---|
| Request branch | the Product's origin | `skip/<epic>/<step>` or `unskip/<epic>/<step>`; epic matches `isValidEpicId`, step matches `^[a-z0-9]+(-[a-z0-9]+)*$` | the person who opens it |
| Request commit | that branch | one commit on the base tip, tree equal to the base tree (no file changed) | the person |
| Request PR/MR body | the platform | `## Summary`, `## Impact & Risk` with `Risk level: low`, `## Checklist`; the reason between `<!-- yad:reason -->` and `<!-- /yad:reason -->` | the person |
| Skip record | `epics/<epic>/.sdlc/state.json`, the step | as a local skip writes it today: `reason`, `by` (the merger's login), `at` (the merge run's date) | CI (the gate bot) |
| `parseSetAsideBranch(branch)` | `cli/epic-state.mjs` | `{ kind: 'skip'|'unskip', epic, step }` or null | engine |
| `requestFacts(platform, n)` | `cli/platform.mjs` | `{ ok, base, head, body }` or `{ ok: false, reason }` | engine |
| `mergedRequestNumbers(platform, branches)` | `cli/platform.mjs` | `{ ok, numbers: { [branch]: number[] } }` or `{ ok: false, reason }` | engine |
| `yad skip --json` on a request | stdout | `{ epic, step, state, changed: false, request: { kind, branch, commit, url, opened } }` | engine |
