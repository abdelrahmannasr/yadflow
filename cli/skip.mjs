// `yad skip <epic> <step> --reason "<why>"` / `yad unskip <epic> <step>` (E35, E36) and
// `yad defer <epic> <step> --reason "<why>"` / `yad undefer <epic> <step>` (E37) — set an OPTIONAL Shape
// step aside for one epic, or put it back. A skip says the step does not apply; a deferral says it does,
// later. `yad skip … --undo` and `yad defer … --undo` are the same as the undo verbs. `yad defer --debt`
// (E41) marks the deferral owed back, and `yad undefer` re-opens a deferral even after later work finished.
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
import fs from 'node:fs';
import path from 'node:path';
import { ok, info, hand, fail, run, readJSONStrict, writeJSON } from './lib.mjs';
import { epicRel, epicRoot, epicStories, loadLedger, skipLane, skipStep, unskipLane, unskipStep, deferStep, undeferStep, unblockStep, writeState, isReopenedStep, stepStatus } from './epic-state.mjs';
import { epicFiles } from './manifest.mjs';
import { readShips } from './ledger.mjs';
import { loadProduct } from './gate.mjs';
import { resolveCommitterLogin } from './platform.mjs';

// Best-effort auditable actor for a record's `by` — who WROTE the record: the roster login for the
// local git identity, else the raw git user.name, else null. A malformed/absent Product degrades to the
// raw name — attribution is a nicety on the audit trail, never a gate, so it must not block the verb.
export function recordActor(root) {
  let roster = [];
  try { roster = loadProduct(root)?.hub?.roster || []; } catch { /* no Product / malformed — attribute by raw git name */ }
  return resolveCommitterLogin(root, roster)
    || (run('git', ['config', 'user.name'], { cwd: root }).stdout || '').trim()
    || null;
}

// What differs between the two verbs, as a person reads it.
const VERBS = {
  skip: {
    set: skipStep, restore: unskipStep, undo: 'unskip', done: 'marked N/A', undone: 'un-skipped', state: 'skipped',
    gate: 'its review gate is short-circuited',
    reasonNote: '--reason is not used when un-skipping: the skip record is removed with the skip',
  },
  defer: {
    set: deferStep, restore: undeferStep, undo: 'undefer', done: 'deferred', undone: 'un-deferred', state: 'deferred',
    gate: 'the chain continues past it; its review is still owed',
    reasonNote: '--reason is not used when un-deferring: the record is removed with the deferral',
  },
};

async function runSetAside(root, verb, { epic, step, reason, debt = false, undo = false, today } = {}) {
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
    // The same for `--debt`: putting a step back is how a debt is PAID, so the flag means nothing here (E41).
    if (debt === true) info('--debt is not used when putting a step back: a debt is set with `yad defer --debt`, and putting the step back starts paying it');
    writeState(ledger.files.state, ledger.state);
    // A deferral put back after later work finished RE-OPENS beside that work (E41), and `currentStep`
    // stays where the chain is — so "back in the chain" and a currentStep line would both mislead.
    if (isReopenedStep(ledger.state, step)) {
      ok(`${step} ${V.undone} — re-opened beside the work already finished after it, which stays done`);
      hand(`currentStep stays ${ledger.state.currentStep}; see the re-opened lane with: yad next ${epic}`);
      return;
    }
    ok(`${step} ${V.undone} — back in the chain`);
    hand(`currentStep is now ${ledger.state.currentStep}`);
    return;
  }

  const by = recordActor(root);
  // A repeat on a step already set aside this way changes nothing but, with `--debt`, the flag — and keeps
  // the ORIGINAL record. Printing this run's actor, date and reason would misstate who set it aside and why.
  const steps = Array.isArray(ledger.state.steps) ? ledger.state.steps : [];
  const before = steps.find((s) => s?.id === step);
  const already = stepStatus(before) === V.state;
  const owedBefore = before?.debt === true;
  V.set(ledger.state, step, { reason, by, at: today, debt: debt === true });
  writeState(ledger.files.state, ledger.state);
  const after = ledger.state.steps.find((s) => s?.id === step);
  const owed = after?.debt === true;
  if (already) {
    const r = after?.record || {};
    ok(`${step} was already ${V.done}${r.by ? ` by ${r.by}` : ''}${r.date ? ` on ${r.date}` : ''}${owed && !owedBefore ? ' — now marked as debt' : ' — nothing changed'}`);
    if (r.reason) info(`reason: ${r.reason}`);
    return;
  }
  ok(`${step} ${V.done}${owed ? ' as debt' : ''}${by ? ` by ${by}` : ''}${today ? ` on ${today}` : ''}`);
  info(`reason: ${String(reason).trim()}`);
  hand(`${V.gate}; currentStep is now ${ledger.state.currentStep}  (reverse with \`yad ${V.undo} ${epic} ${step}\`)`);
}

// `yad skip <epic> <story> --repo <name> --reason "<why>"` / `yad unskip <epic> <story> --repo <name>`
// (E39) — set a whole Build LANE aside: this story needs no change in this repo. The rules are the pure
// `skipLane` / `unskipLane` in epic-state.mjs; this reads the story and the ships, and writes
// `build-state/<story>.json`, which `yad checkpoint --push` commits. There is no lane deferral: a lane that
// is owed later is simply not driven yet.
export async function runLaneSkip(root, { epic, story, repo, reason, undo = false, today } = {}) {
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir} — seed the epic first with yad-epic`); process.exitCode = 1; return; }
  if (!repo || repo === true) {
    fail(`usage: yad ${undo ? 'unskip' : 'skip'} ${epic} ${story} --repo <name>${undo ? '' : ' --reason "<why>"'}`);
    process.exitCode = 1;
    return;
  }
  const file = path.join(epicFiles(epicDir).buildStateDir, `${story}.json`);
  const current = readJSONStrict(file, null);

  // Putting a lane back asks nothing but that it was skipped — not even that the story file still exists,
  // so a story renamed or removed after the skip can still have its skip undone (E39 review).
  if (undo) {
    const { buildState, empty } = unskipLane(current, { story, repo });
    if (empty) fs.rmSync(file);
    else writeJSON(file, buildState);
    if (reason != null && reason !== true) info('--reason is not used when un-skipping: the skip record is removed with the skip');
    ok(`${story} / ${repo} un-skipped — the lane is owed again`);
    hand(`yad-run adds the lane the next time ${story} is driven in ${repo}; commit this with \`yad checkpoint --push\``);
    return;
  }

  const entry = epicStories(epicDir).find((st) => st.id === story);
  if (!entry) { fail(`no story ${story} under ${epicRel(epic)}/stories/`); process.exitCode = 1; return; }
  // An EARNED stories review only: `done` here, or `satisfied` (reviewed in the parent epic) — the rule E36
  // gives for "Build can run". `isPassed` would also accept a hand-typed `skipped` or `deferred` review, and
  // a lane skip over stories nobody approved is what this refusal exists to stop (E39 review).
  const storiesReview = ledger.state.steps.find((st) => st?.id === 'stories-review');
  const shippedRepos = readShips(epicDir).filter((sh) => sh.story === story).map((sh) => sh.repo);
  const by = recordActor(root);
  const { buildState, already } = skipLane(current, {
    story, repo, reason, by, date: today, declared: entry.repos, shippedRepos, storiesPassed: ['done', 'satisfied'].includes(stepStatus(storiesReview)),
  });
  if (already) {
    const r = current.repos[repo].record || {};
    ok(`${story} / ${repo} was already skipped${r.by ? ` by ${r.by}` : ''}${r.date ? ` on ${r.date}` : ''} — nothing changed`);
    if (r.reason) info(`reason: ${r.reason}`);
    return;
  }
  writeJSON(file, buildState);
  ok(`${story} / ${repo} lane skipped — N/A${by ? ` by ${by}` : ''}${today ? ` on ${today}` : ''}`);
  info(`reason: ${String(reason).trim()}`);
  hand(`the feature can ship without it; commit this with \`yad checkpoint --push\`  (reverse with \`yad unskip ${epic} ${story} --repo ${repo}\`)`);
}

export const runSkip = (root, opts) => runSetAside(root, 'skip', opts);
export const runDefer = (root, opts) => runSetAside(root, 'defer', opts);

// `yad unblock <epic> <step>` (E37) — clear a recorded blocker once the wait is over. The state logic is
// the pure `unblockStep`; `build-state/<story>.json` belongs to the skills and is never touched here.
export async function runUnblock(root, { epic, step } = {}) {
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) { fail(`no epic state at ${epicDir} — seed the epic first with yad-epic`); process.exitCode = 1; return; }
  if (!step) { fail('usage: yad unblock <epic> <step>'); process.exitCode = 1; return; }
  // Read the reason BEFORE the write removes it, so the line can say what was cleared.
  const steps = Array.isArray(ledger.state.steps) ? ledger.state.steps : [];
  const was = steps.find((s) => s?.id === step)?.record?.reason || null;
  unblockStep(ledger.state, step);
  writeState(ledger.files.state, ledger.state);
  ok(`${step} unblocked — now ${ledger.state.steps.find((s) => s?.id === step).status}`);
  if (was) info(`cleared: ${was}`);
  hand(`see what to do now: yad next ${epic}`);
}
