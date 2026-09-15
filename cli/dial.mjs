// `yad dial` / `yad kill` / `yad unkill` — the advance dial, set freely, and the kill switch (E34).
//
// Automation used to be earned: the `yad-run` skill refused `advance: auto` until a step's trust log
// cleared a threshold, and `yad-status` nudged about steps that had cleared it and stayed manual. E34
// deletes both. The team sets the dial; this command shows the run record beside it as ADVICE and never
// refuses on it. The rules live in epic-state.mjs (`planShapeDial`, `planLaneDial`, `planKill`,
// `effectiveAdvance`); this reads the files, prints the advice and writes the result.
//
// What it never does: set a gate to `auto` (rule 1), write over an `automation.json` it cannot read, or
// write a lane step that `yad-run` has not put on the lane yet.
//
// READING IS A CONTRACT. The `yad-run` skill asks `yad dial … --json` for the dial of every step it walks,
// the merge gate included, and uses `advance`. So a read never refuses a gate — it answers `human`, `why:
// gate` — and never fails because the run record beside the dial cannot be read.
import path from 'node:path';

import { c, fail, hand, info, log, ok, readJSONStrict, warn, writeJSON } from './lib.mjs';
import {
  effectiveAdvance, epicRel, epicRoot, epicStories, isGateStep, killSwitchOn, loadAutomation, loadLedger, planKill,
  planLaneDial, planShapeDial, serializeAutomation, stepDef,
} from './epic-state.mjs';
import { epicFiles, PROJECT_FILES } from './manifest.mjs';
import { readTrustRuns } from './ledger.mjs';
import { recordActor } from './skip.mjs';

const makeBail = (json) => (message, hint) => {
  if (json) log(JSON.stringify({ ok: false, error: message, hint: hint || null }, null, 2));
  else { fail(message); if (hint) hand(hint); }
  process.exitCode = 1;
};

const killLine = (kill) => {
  const who = [kill?.by ? `by ${kill.by}` : '', kill?.date ? `on ${kill.date}` : ''].filter(Boolean).join(' ');
  return `the kill switch is ON${who ? ` (${who})` : ''}${kill?.reason ? `: ${kill.reason}` : ''}`;
};

// A broken `automation.json` holds every step at human; say that it is the FILE, not somebody's switch.
const heldLine = (automation) => (automation.error
  ? `${PROJECT_FILES.automationConfig} ${automation.error} — every step is held at advance: human until it is fixed (yad doctor)`
  : killLine(automation.kill));
// Only when there is one, so a healthy project's JSON keeps exactly the keys it had.
const errorKey = (automation) => (automation.error ? { automationError: automation.error } : {});

// `yad dial <step> [--to auto|human]` for a Shape author step, or
// `yad dial <epic> <story> --repo <name> <step> [--to auto|human]` for a Build lane step. No `--to` reads.
export async function runDial(root, { epic = null, story = null, repo = null, step, to = null, json = false } = {}) {
  const bail = makeBail(json);
  if (!step) return bail('usage: yad dial <step> [--to auto|human]   |   yad dial <epic> <story> --repo <name> <step> [--to auto|human]');
  const automation = loadAutomation(root);
  return epic
    ? dialLane(root, { epic, story, repo, step, to, json, bail, automation })
    : dialShape(root, { step, to, json, bail, automation });
}

// The answer for a gate asked with no `--to`: always a person. Not a refusal (see the header).
function gateAnswer({ json, automation, scope, fields, label }) {
  if (json) {
    return log(JSON.stringify({
      ok: true, scope, ...fields, set: 'human', advance: 'human', why: 'gate', changed: false,
      kill: automation.kill, trust: null, ...errorKey(automation),
    }, null, 2));
  }
  ok(`${label} — advance: human (a review gate: always a person)`);
}

function dialShape(root, { step, to, json, bail, automation }) {
  if (!to && stepDef(step)?.kind === 'review' && stepDef(step)?.phase !== 'build') {
    return gateAnswer({ json, automation, scope: 'shape', fields: { step }, label: c.bold(step) });
  }
  // Nothing is written over a file that cannot be read — it may hold a kill switch somebody set. This is
  // the only path that writes `automation.json`, so it is the only one that refuses on it.
  if (to && automation.error) {
    return bail(`${PROJECT_FILES.automationConfig} ${automation.error} — nothing is written over it, and every step is held at advance: human until it is fixed`,
      'fix the JSON, or delete the file to go back to the defaults (kill switch off, every Shape step human)');
  }
  const plan = planShapeDial(automation, { step, to: to || 'human' });
  if (!plan.ok) return bail(plan.message, plan.hint);
  const after = to ? plan.automation : automation;
  if (to && plan.changed) writeJSON(path.join(root, PROJECT_FILES.automationConfig), serializeAutomation(plan.automation));
  const eff = effectiveAdvance({ id: step }, { ...after, error: automation.error });
  if (json) {
    return log(JSON.stringify({
      ok: true, scope: 'shape', step, set: eff.set, advance: eff.advance, why: eff.why,
      changed: !!to && plan.changed, kill: automation.kill, trust: null, ...errorKey(automation),
    }, null, 2));
  }
  const label = c.bold(step);
  if (!to) ok(`${label} — advance: ${eff.set}${eff.why === 'kill' ? ' (held at human)' : ''}`);
  else if (plan.changed) ok(`${label} set to advance: ${to} for this project`);
  else ok(`${label} was already advance: ${to} — nothing changed`);
  if (eff.set === 'auto') {
    info('no run record exists for a Shape step — the yad-run skill records Build steps only');
    info(`recorded, not acted on yet: nothing drives a Shape step on its own until the engine runs agents (E26), so ${step} still waits for its author. Its review gate is always a person`);
  }
  if (killSwitchOn(automation)) warn(heldLine(automation));
  if (to && plan.changed) hand(`commit ${PROJECT_FILES.automationConfig}  (reverse with \`yad dial ${step} --to ${to === 'auto' ? 'human' : 'auto'}\`)`);
}

function dialLane(root, { epic, story, repo, step, to, json, bail, automation }) {
  if (!story || !repo) return bail(`usage: yad dial ${epic} <story> --repo <name> ${step} [--to auto|human]`);
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) return bail(`no epic state at ${epicRel(epic)} — seed the epic first`);
  const entry = epicStories(epicDir).find((st) => st.id === story);
  if (!entry) return bail(`no story ${story} under ${epicRel(epic)}/stories/`);
  const label = `${c.cyan(story)} / ${c.bold(repo)} ${c.bold(step)}`;
  if (!to && stepDef(step)?.phase === 'build' && isGateStep({ id: step })) {
    return gateAnswer({ json, automation, scope: 'lane', fields: { epic, story, repo, step }, label });
  }
  const file = path.join(epicFiles(epicDir).buildStateDir, `${story}.json`);
  // Strict: a read-modify-write against a file that will not parse would delete what is in it.
  const current = readJSONStrict(file, null);
  const plan = planLaneDial(current, { story, repo, step, to: to || 'human', declared: entry.repos });
  if (!plan.ok) return bail(plan.message, plan.hint);

  // The advice, read BEFORE anything is written: every recorded run of this step in this repo. A record
  // that cannot be read is reported and set aside — advice never blocks the dial it sits beside.
  let trust = null;
  let trustError = null;
  try {
    const runs = readTrustRuns(epicDir).filter((e) => e && e.step === step && e.repo === repo);
    trust = { runs: runs.length, approvedUnchanged: runs.filter((e) => e.verdict === 'approved-unchanged').length };
  } catch (e) {
    trustError = e.message;
  }

  const state = to ? plan.buildState : current;
  if (to && plan.changed) writeJSON(file, plan.buildState);
  const row = state.repos[repo].steps.find((x) => x && x.id === step);
  const eff = effectiveAdvance(row, automation);

  if (json) {
    return log(JSON.stringify({
      ok: true, scope: 'lane', epic, story, repo, step, set: eff.set, advance: eff.advance, why: eff.why,
      changed: !!to && plan.changed, kill: automation.kill, trust, ...errorKey(automation),
      ...(trustError ? { trustError } : {}),
    }, null, 2));
  }
  if (!to) ok(`${label} — advance: ${eff.set}${eff.why === 'kill' ? ' (held at human)' : ''}`);
  else if (plan.changed && plan.before === to) ok(`${label} was already advance: ${to} — the new dial name was added beside the old one`);
  else if (plan.changed) ok(`${label} set to advance: ${to}`);
  else ok(`${label} was already advance: ${to} — nothing changed`);
  if (trustError) warn(`the run record cannot be read (${trustError}) — the dial is not affected; run \`yad doctor\``);
  else {
    info(trust.runs
      ? `run record for ${step} in ${repo}: ${trust.runs} run(s), ${Math.round((trust.approvedUnchanged / trust.runs) * 100)}% approved unchanged`
      : `nothing has run ${step} in ${repo} yet — no evidence either way`);
    info(c.dim('advice, not a rule: the team decides (E34)'));
  }
  if (eff.set === 'auto') {
    info(`the yad-run skill moves past ${step} on its own after a clean run. A failed check, a scope overrun or a contract touch still stops it, and the merge is always a person`);
  }
  if (killSwitchOn(automation)) warn(heldLine(automation));
  if (to && plan.changed) hand(`commit it with \`yad checkpoint --push\`  (reverse with \`yad dial ${epic} ${story} --repo ${repo} ${step} --to ${to === 'auto' ? 'human' : 'auto'}\`)`);
}

// `yad kill --reason "<why>"` / `yad unkill [--reason "<why>"]`.
export async function runKill(root, { on, reason = null, json = false, today = null } = {}) {
  const bail = makeBail(json);
  const automation = loadAutomation(root);
  if (automation.error) {
    return bail(`${PROJECT_FILES.automationConfig} ${automation.error} — nothing is written over it`,
      'fix the JSON, or delete the file (kill switch off, every Shape step human), then run this again');
  }
  const plan = planKill(automation, { on, reason, by: recordActor(root), date: today });
  if (!plan.ok) return bail(plan.message, plan.hint);
  if (!plan.already) writeJSON(path.join(root, PROJECT_FILES.automationConfig), serializeAutomation(plan.automation));
  const kill = plan.automation.kill;
  if (json) return log(JSON.stringify({ ok: true, kill, changed: !plan.already }, null, 2));
  if (plan.already) {
    ok(`the kill switch was already ${on ? 'on' : 'off'} — nothing changed`);
    if (on) info(killLine(kill));
    return;
  }
  if (on) {
    ok('kill switch ON — every step is held at advance: human');
    info(`reason: ${kill.reason}`);
  } else {
    ok('kill switch off — each step follows its own dial again');
    if (kill.reason) info(`reason: ${kill.reason}`);
  }
  hand(`commit ${PROJECT_FILES.automationConfig} so every machine and CI run sees it  (reverse with \`yad ${on ? 'unkill' : 'kill --reason "<why>"'}\`)`);
}
