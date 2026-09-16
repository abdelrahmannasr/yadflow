// Every command module, behind ONE dynamic import (E11 review).
//
// `yad hook ledger-guard` runs on EVERY file-editing tool call an agent makes, inside its tool
// loop. It needs `cli/hook.mjs` and nothing else, but a static import list in `bin/yad.mjs` is
// hoisted and evaluated before any code runs — so the hook was loading all 29 modules of the CLI,
// measured at ~30ms against ~14ms for what it actually uses, on every single edit.
//
// Re-exporting through one module keeps that mechanical: `bin/yad.mjs` awaits this once, after it
// has already handled `hook`, and every command reads off the result. Nothing here is lazy in
// itself — importing this file still loads everything, which is exactly right for a command that
// is about to do real work.

export { runSetup } from '../cli/setup.mjs';
export { reconcile } from '../cli/reconcile.mjs';
export { gateOpen, gateSync, gateComments, gateStatus, gateCi, gateReview, gateTrailer, gateWalkthrough, gateRepair } from '../cli/gate.mjs';
export { isValidEpicId, seedableProfiles } from '../cli/epic-state.mjs';
export { runEpicNew, runFoundationNew, runFoundationStatus } from '../cli/epic.mjs';
export { runSkillBind, runSkillList, runSkillUnbind } from '../cli/skill.mjs';
export { runCommit } from '../cli/commit.mjs';
export { runOpenPr } from '../cli/openpr.mjs';
export { reviewTrailer, reviewContext, reviewNudge, reviewReconcile, reviewWalkthrough } from '../cli/review.mjs';
export { runShip } from '../cli/ship.mjs';
export { runCheckpoint } from '../cli/checkpoint.mjs';
export { runTidy } from '../cli/tidy.mjs';
export { runRepo } from '../cli/repo.mjs';
export { runDocs } from '../cli/docs.mjs';
export { runDoctor } from '../cli/doctor.mjs';
export { runMigrate, warnIfProjectAhead } from '../cli/migrate.mjs';
export { runNext } from '../cli/next.mjs';
export { runSkip, runDefer, runUnblock, runLaneSkip } from '../cli/skip.mjs';
export { runDial, runKill } from '../cli/dial.mjs';
export { runMode } from '../cli/mode.mjs';
export { syncStatuses } from '../cli/artifact-status.mjs';
export { runThread, runReconcile } from '../cli/thread.mjs';
export { runReport } from '../cli/report.mjs';
export { runUsage } from '../cli/usage.mjs';
export { maybeNotifyUpdate } from '../cli/update-notice.mjs';
