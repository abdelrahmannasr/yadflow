// `yad skip <epic> <step> --reason "<why>"` (and `--undo`) — mark an OPTIONAL front step N/A for one
// epic. Today only `ui-design` is skippable: an epic with no user-facing surface (backend/API, data,
// infra) does not need a UI-design artifact + review gate. The skip stays VISIBLE and auditable — the
// step is pre-marked `done` with a recorded reason (and actor/date), short-circuited at the gate — and
// is reversible with `--undo` until the stories review opens. All state logic is the pure
// `skipStep`/`unskipStep` in epic-state.mjs; this is the thin file-load/save + attribution wrapper.
import { ok, info, hand, fail, run, writeJSON } from './lib.mjs';
import { epicRoot, loadLedger, skipStep, unskipStep } from './epic-state.mjs';
import { loadHub } from './gate.mjs';
import { resolveCommitterLogin } from './platform.mjs';

// Best-effort auditable actor for `skippedBy`: the roster login for the local git identity, else the
// raw git user.name, else null. A malformed/absent hub degrades to the raw name — attribution is a
// nicety on the audit trail, never a gate, so it must not block the skip.
function skipActor(root) {
  let roster = [];
  try { roster = loadHub(root)?.hub?.roster || []; } catch { /* no hub / malformed — attribute by raw git name */ }
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
    writeJSON(ledger.files.state, ledger.state);
    ok(`${step} un-skipped — back in the chain`);
    hand(`currentStep is now ${ledger.state.currentStep}`);
    return;
  }

  const by = skipActor(root);
  skipStep(ledger.state, step, { reason, by, at: today });
  writeJSON(ledger.files.state, ledger.state);
  ok(`${step} marked N/A${by ? ` by ${by}` : ''}${today ? ` on ${today}` : ''}`);
  info(`reason: ${String(reason).trim()}`);
  hand(`its review gate is short-circuited; currentStep is now ${ledger.state.currentStep}  (reverse with \`yad skip ${epic} ${step} --undo\`)`);
}
