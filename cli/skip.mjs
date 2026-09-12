// `yad skip <epic> <step> --reason "<why>"` (and `--undo`) — mark an OPTIONAL Shape step N/A for one
// epic. Which steps those are is a fact about the epic's ROUTE, read from the lifecycle profile it is
// on (E35, `optionalStepsFor`), not a list this engine keeps: on every route today that is `ui-design`
// and its gate, because an epic with no user-facing surface (backend/API, data, infra) does not need
// a UI-design artifact. E40's shorter lanes will mark different steps, and this needs no edit for it.
// `--undo` asks no route at all: restoring a step to the chain can never let a gate pass, and it is
// the remedy `yad doctor`'s `skip:not-optional` recommends on an epic whose route forbids the skip.
// The skip stays VISIBLE and auditable — the step is pre-marked `done` with a recorded reason (and
// actor/date), short-circuited at the gate — and is reversible until the stories review opens. All
// state logic is the pure `skipStep`/`unskipStep` in epic-state.mjs; this is the thin file-load/save
// + attribution wrapper.
import { ok, info, hand, fail, run } from './lib.mjs';
import { epicRoot, loadLedger, skipStep, unskipStep, writeState } from './epic-state.mjs';
import { loadProduct } from './gate.mjs';
import { resolveCommitterLogin } from './platform.mjs';

// Best-effort auditable actor for `skippedBy`: the roster login for the local git identity, else the
// raw git user.name, else null. A malformed/absent Product degrades to the raw name — attribution is a
// nicety on the audit trail, never a gate, so it must not block the skip.
function skipActor(root) {
  let roster = [];
  try { roster = loadProduct(root)?.hub?.roster || []; } catch { /* no Product / malformed — attribute by raw git name */ }
  return resolveCommitterLogin(root, roster)
    || (run('git', ['config', 'user.name'], { cwd: root }).stdout || '').trim()
    || null;
}

export async function runSkip(root, { epic, step, reason, undo = false, today } = {}) {
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir} — seed the epic first with yad-epic`); process.exitCode = 1; return; }
  if (!step) { fail('usage: yad skip <epic> <step> --reason "<why>"   (or: yad skip <epic> <step> --undo)'); process.exitCode = 1; return; }

  // Guard violations throw a YadError (YAD-STATE-004) with a hint — the top-level catch in bin/yad.mjs
  // renders those. Here we only handle the happy path + the two plain-arg checks above.
  if (undo) {
    unskipStep(ledger.state, step);
    writeState(ledger.files.state, ledger.state);
    ok(`${step} un-skipped — back in the chain`);
    hand(`currentStep is now ${ledger.state.currentStep}`);
    return;
  }

  const by = skipActor(root);
  skipStep(ledger.state, step, { reason, by, at: today });
  writeState(ledger.files.state, ledger.state);
  ok(`${step} marked N/A${by ? ` by ${by}` : ''}${today ? ` on ${today}` : ''}`);
  info(`reason: ${String(reason).trim()}`);
  hand(`its review gate is short-circuited; currentStep is now ${ledger.state.currentStep}  (reverse with \`yad skip ${epic} ${step} --undo\`)`);
}
