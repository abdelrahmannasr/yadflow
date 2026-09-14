// `yad skip <epic> <step> --reason "<why>"` / `yad unskip <epic> <step>` (E35, E36) and
// `yad defer <epic> <step> --reason "<why>"` / `yad undefer <epic> <step>` (E37) — set an OPTIONAL Shape
// step aside for one epic, or put it back. A skip says the step does not apply; a deferral says it does,
// later. `yad skip … --undo` and `yad defer … --undo` are the same as the undo verbs.
// Which steps qualify is a fact about the epic's ROUTE, read from the lifecycle profile it is on (E35,
// `optionalStepsFor`), not a list this engine keeps: on `classic` and `analysis-first` that is
// `ui-design` and its gate. E40's short lanes mark NOTHING optional — they drop the steps they do not
// need from the chain instead — so both verbs are refused outright on one, and `notOptional` says which
// of the two reasons applies rather than reporting every empty answer as a broken chain.
// The too-late checks name no step (E36): a route that marks another step optional gets the same verbs
// with the same guards, measured against whatever steps follow the pair on that route.
// Putting a step back asks no route at all: restoring a step to the chain can never let a gate pass, and
// `yad unskip` is the remedy `yad doctor`'s `skip:not-optional` recommends on an epic whose route forbids
// the skip. Either way the step stays VISIBLE and auditable — marked with a recorded reason (and
// actor/date), short-circuited at the gate. All state logic is the pure `skipStep` / `unskipStep` /
// `deferStep` / `undeferStep` in epic-state.mjs; this is the thin file-load/save + attribution wrapper.
import { ok, info, hand, fail, run } from './lib.mjs';
import { epicRoot, loadLedger, skipStep, unskipStep, deferStep, undeferStep, writeState } from './epic-state.mjs';
import { loadProduct } from './gate.mjs';
import { resolveCommitterLogin } from './platform.mjs';

// Best-effort auditable actor for a record's `by` — who WROTE the record: the roster login for the
// local git identity, else the raw git user.name, else null. A malformed/absent Product degrades to the
// raw name — attribution is a nicety on the audit trail, never a gate, so it must not block the verb.
function recordActor(root) {
  let roster = [];
  try { roster = loadProduct(root)?.hub?.roster || []; } catch { /* no Product / malformed — attribute by raw git name */ }
  return resolveCommitterLogin(root, roster)
    || (run('git', ['config', 'user.name'], { cwd: root }).stdout || '').trim()
    || null;
}

// What differs between the two verbs, as a person reads it.
const VERBS = {
  skip: {
    set: skipStep, restore: unskipStep, undo: 'unskip', done: 'marked N/A', undone: 'un-skipped',
    gate: 'its review gate is short-circuited',
    reasonNote: '--reason is not used when un-skipping: the skip record is removed with the skip',
  },
  defer: {
    set: deferStep, restore: undeferStep, undo: 'undefer', done: 'deferred', undone: 'un-deferred',
    gate: 'the chain continues past it; its review is still owed',
    reasonNote: '--reason is not used when un-deferring: the record is removed with the deferral',
  },
};

async function runSetAside(root, verb, { epic, step, reason, undo = false, today } = {}) {
  const V = VERBS[verb];
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir} — seed the epic first with yad-epic`); process.exitCode = 1; return; }
  if (!step) {
    fail(undo ? `usage: yad ${V.undo} <epic> <step>` : `usage: yad ${verb} <epic> <step> --reason "<why>"   (undo it with: yad ${V.undo} <epic> <step>)`);
    process.exitCode = 1;
    return;
  }

  // Guard violations throw a YadError (YAD-STATE-004) with a hint — the top-level catch in bin/yad.mjs
  // renders those. Here we only handle the happy path + the two plain-arg checks above.
  if (undo) {
    V.restore(ledger.state, step);
    // Putting a step back deletes its record, so a reason given here would be recorded nowhere. Say so
    // rather than accept it in silence.
    if (reason != null && reason !== true) info(V.reasonNote);
    writeState(ledger.files.state, ledger.state);
    ok(`${step} ${V.undone} — back in the chain`);
    hand(`currentStep is now ${ledger.state.currentStep}`);
    return;
  }

  const by = recordActor(root);
  V.set(ledger.state, step, { reason, by, at: today });
  writeState(ledger.files.state, ledger.state);
  ok(`${step} ${V.done}${by ? ` by ${by}` : ''}${today ? ` on ${today}` : ''}`);
  info(`reason: ${String(reason).trim()}`);
  hand(`${V.gate}; currentStep is now ${ledger.state.currentStep}  (reverse with \`yad ${V.undo} ${epic} ${step}\`)`);
}

export const runSkip = (root, opts) => runSetAside(root, 'skip', opts);
export const runDefer = (root, opts) => runSetAside(root, 'defer', opts);
