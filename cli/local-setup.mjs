// E185 — `yad local-setup`: the script a team member's agent follows on that person's machine.
//
//   .sdlc/local-setup.json (committed, the Product)   the source of truth:
//     { localSetupVersion, catalogueVersion, yadflow: [steps], team: [steps] }
//     `yadflow[]` is rewritten by every `yad setup`, `yad update` and `yad check --fix` (cli/local-setup-steps.mjs).
//     `team[]` is the team's (`yad local-setup add`): an update never touches it.
//   LOCAL-SETUP.md (committed, the Product root)      the same steps as text, between yad's markers, so an agent
//     can follow them even with a yad too old to know this command. The team writes freely outside the markers.
//
// yad RUNS NO STEP. It shows each step and runs only the built-in checks (cli/local-setup-steps.mjs). The agent
// runs a step's commands only after the person said yes to it (the `local-setup` rule, cli/agent-rules.mjs).

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { c, emitJSON, forTerminal, info, log, warn, writeJSON, isPlainObject } from './lib.mjs';
import { markedBlockAction } from './plan.mjs';
import { productConfigPath, SCHEMA_VERSION } from './manifest.mjs';
import {
  LOCAL_SETUP_CATALOGUE_VERSION, LOCAL_SETUP_VERSION, LOCAL_SETUP_FILE, LOCAL_SETUP_DOC, STEP_ID, WHEN, BUILTIN_CHECKS,
  yadflowSteps, stepHash, runBuiltinCheck, localSetupPath,
} from './local-setup-steps.mjs';
import { detectInstalled } from './detect.mjs';

export const LOCAL_SETUP_MARKERS = Object.freeze({
  begin: '<!-- yadflow:local-setup:begin — written by yad from .sdlc/local-setup.json; edit outside these lines, `yad update` rewrites them -->',
  beginKey: '<!-- yadflow:local-setup:begin',
  end: '<!-- yadflow:local-setup:end -->',
});

// ---- reading and checking the file ------------------------------------------------------------------

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isTextList = (v) => Array.isArray(v) && v.length > 0 && v.every(isText);

// What is wrong with one step, as words (empty when it is sound). Used for both lists: a yadflow step in a
// committed file was written by yad, but the file is the team's to edit, so it is read with the same care.
export function stepProblems(s, source) {
  const p = [];
  if (!isPlainObject(s)) return ['it is not an object'];
  if (typeof s.id !== 'string' || !STEP_ID.test(s.id)) p.push('its id should be lowercase letters, digits and dashes');
  for (const k of ['title', 'purpose', 'impact']) if (!isText(s[k])) p.push(`it has no ${k}`);
  if (!isTextList(s.commands)) p.push('it has no commands');
  if (!WHEN.includes(s.when)) p.push('its `when` should be "required" or "optional"');
  if (s.check != null) {
    if (!isPlainObject(s.check)) p.push('its check should be an object');
    else if (source === 'yadflow' && !BUILTIN_CHECKS.includes(s.check.builtin)) p.push('its check is not one yad knows');
    else if (source === 'team' && !isText(s.check.run)) p.push('its check should be `{ "run": "<command>" }`');
  }
  return p;
}

// The two lists, each step checked. `problems` names every step left out and why; the file still answers.
export function readSteps(doc) {
  const problems = [];
  const steps = [];
  const seen = new Set();
  for (const source of ['yadflow', 'team']) {
    const list = doc?.[source];
    if (list === undefined) continue;
    if (!Array.isArray(list)) { problems.push(`${LOCAL_SETUP_FILE}: \`${source}\` should be a list — ignored`); continue; }
    for (const [i, s] of list.entries()) {
      const label = isPlainObject(s) && typeof s.id === 'string' ? `\`${forTerminal(s.id)}\`` : `number ${i + 1}`;
      const p = stepProblems(s, source);
      if (p.length) { problems.push(`${LOCAL_SETUP_FILE}: ${source} step ${label} is ignored — ${p.join('; ')}`); continue; }
      if (seen.has(s.id)) { problems.push(`${LOCAL_SETUP_FILE}: step ${label} is listed twice — the first one is used`); continue; }
      seen.add(s.id);
      steps.push({ ...s, source, vetted: source === 'yadflow' && s.vetted !== false, hash: stepHash(s) });
    }
  }
  return { steps, problems };
}

// The file as git has it at HEAD, else as it is on disk (a setup not committed yet). `{ doc, committed, error }`.
export function readCommittedLocalSetup(root) {
  const r = spawnSync('git', ['show', `HEAD:${LOCAL_SETUP_FILE}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  let text = r.status === 0 ? r.stdout : null;
  const committed = text !== null;
  if (text === null) {
    try { text = fs.readFileSync(localSetupPath(root), 'utf8'); } catch { return { doc: null, committed: false, error: null }; }
  }
  try {
    const doc = JSON.parse(text);
    if (!isPlainObject(doc)) return { doc: null, committed, error: 'is not a JSON object' };
    return { doc, committed, error: null };
  } catch { return { doc: null, committed, error: 'does not parse' }; }
}

// ---- writing it (setup, update, check --fix) --------------------------------------------------------

// yad's part of the file merged into what is there: `yadflow[]` and the two version numbers replaced, every
// other key (the team's list first of all) kept as it is. The shape `reconcile` asks of a shared JSON file.
export function mergeLocalSetup(current, root) {
  if (!isPlainObject(current)) return { unreadable: 'it is not a JSON object' };
  if (current.team !== undefined && !Array.isArray(current.team)) return { unreadable: '`team` is not a list' };
  // The shape stamp first, as writeJSON writes it: a copy yad builds from nothing then equals the one on disk, so
  // `--open-pr` can tell the file is yad's alone (reconcile's shared-file rows).
  const settings = {
    schemaVersion: current.schemaVersion ?? SCHEMA_VERSION,
    ...current,
    localSetupVersion: LOCAL_SETUP_VERSION,
    catalogueVersion: LOCAL_SETUP_CATALOGUE_VERSION,
    yadflow: yadflowSteps(root),
    team: current.team ?? [],
  };
  return { settings, changed: JSON.stringify(settings) !== JSON.stringify(current) };
}

const said = new Set();
function localSetupJsonAction(root) {
  const dest = localSetupPath(root);
  const base = { scope: 'product', item: LOCAL_SETUP_FILE, root, paths: [], shared: LOCAL_SETUP_FILE, mergeShared: (o) => mergeLocalSetup(o, root) };
  let raw = null;
  try { raw = fs.readFileSync(dest, 'utf8'); } catch { /* missing */ }
  let parsed = null;
  if (raw !== null) { try { parsed = JSON.parse(raw); } catch { parsed = undefined; } }
  const merged = raw === null ? mergeLocalSetup({}, root) : parsed === undefined ? { unreadable: 'it does not parse' } : mergeLocalSetup(parsed, root);
  // Never rebuilt from nothing: that would delete every step the team wrote (memory: read strictly before a write).
  if (merged.unreadable) {
    if (!said.has(dest)) { said.add(dest); warn(`${LOCAL_SETUP_FILE}: ${merged.unreadable} — the local setup script was left as it is; fix it (or restore it from git), then re-run \`yad check --fix\``); }
    return { ...base, status: 'modified', writesNothing: true, apply: () => {} };
  }
  return {
    ...base,
    status: raw === null ? 'new' : merged.changed ? 'outdated' : 'ok',
    // Re-read at apply time: setup and reconcile build every action before applying any.
    apply: () => {
      let now = {};
      if (fs.existsSync(dest)) {
        try { now = JSON.parse(fs.readFileSync(dest, 'utf8')); } catch { warn(`${LOCAL_SETUP_FILE} does not parse — left untouched`); return; }
      }
      const next = mergeLocalSetup(now, root);
      if (next.unreadable) { warn(`${LOCAL_SETUP_FILE}: ${next.unreadable} — left untouched`); return; }
      if (!next.changed && Object.keys(now).length) return;
      writeJSON(dest, next.settings);
    },
  };
}

// One line of the Markdown view from a file's words: on one line, with nothing that could close a comment or
// open one, so a step cannot end yad's block early or hide text in it.
const md = (s) => forTerminal(String(s ?? '')).replace(/\s+/g, ' ').trim().replace(/<!--|-->/g, '').replace(/`/g, "'");
const CHECK_WORDS = {
  'cli-version': (k) => `\`yad --version\` is ${md(k.min)} or later`,
  'platform-login': () => 'the platform CLI is signed in to the Product\'s host',
  'ledger-hook': () => '`yad doctor` shows the pre-commit hook as installed',
  'commit-signing': () => '`yad signing check` finds nothing to set up',
  tool: (k) => `\`yad toolbox check\` finds ${md(k.tool)}`,
};
const checkWords = (s) => (s.check?.builtin ? (CHECK_WORDS[s.check.builtin]?.(s.check) ?? 'yad checks it')
  : s.check?.run ? `this command succeeds (ask the person before running it): \`${md(s.check.run)}\`` : null);

function stepLines(s) {
  const lines = [`### ${md(s.title)}`, '', `- **Id:** \`${md(s.id)}\` · **${s.when}**${s.source === 'team' ? ` · added by your team${s.addedBy ? ` (${md(s.addedBy)})` : ''}, not vetted by yadflow` : s.vetted === false ? ' · a tool your team added, not vetted by yadflow' : ''}${s.person ? ' · **the person does this step, not the agent**' : ''}`];
  lines.push(`- **Why:** ${md(s.purpose)}`, `- **What it changes for you:** ${md(s.impact)}`, '- **Run:**', '', '  ```sh', ...s.commands.map((cmd) => `  ${md(cmd)}`), '  ```', '');
  const done = checkWords(s);
  if (done) lines.push(`- **Already done when:** ${done}`);
  if (s.verify) lines.push(`- **Confirm with:** \`${md(s.verify)}\``);
  lines.push('');
  return lines;
}

// The block yad writes into LOCAL-SETUP.md, from the file's steps.
export function localSetupDocLines(doc) {
  const { steps } = readSteps(doc);
  const ours = steps.filter((s) => s.source === 'yadflow');
  const theirs = steps.filter((s) => s.source === 'team');
  return [
    '# Local setup',
    '',
    'This is the script that gets a team member\'s machine ready for this project, and keeps it ready after each update.',
    'Each step says why it is needed and what it changes for you, so you decide whether to do it.',
    '',
    '**For the agent:** run `yad local-setup --json` to see which steps this machine still needs.',
    'For each one, tell the person its "Why" and "What it changes for you", and run its commands only after they say yes.',
    'A step marked "the person does this step" is theirs: give them the command and wait.',
    'If `yad local-setup` is not a command your yad knows, do the "Install the yadflow CLI" step first.',
    '',
    '## Steps from yadflow',
    '',
    ...(ours.length ? ours.flatMap(stepLines) : ['None.', '']),
    '## Steps from your team',
    '',
    ...(theirs.length ? theirs.flatMap(stepLines) : ['None yet.', '']),
  ].map((l) => l.replace(/\s+$/, ''));
}

// The two actions setup, update and check --fix apply: the JSON, then its Markdown view built from what the
// JSON will hold. Both are shared files (`paths` empty, `shared` named), like AGENTS.md: `--open-pr` carries them.
export function localSetupActions(root) {
  // A Product's script: a folder with no Product config gets none (its steps would describe nothing).
  if (!fs.existsSync(productConfigPath(root))) return [];
  const json = localSetupJsonAction(root);
  let doc = null;
  if (!json.writesNothing) {
    let now = {};
    try { now = JSON.parse(fs.readFileSync(localSetupPath(root), 'utf8')); } catch { /* new */ }
    doc = mergeLocalSetup(isPlainObject(now) ? now : {}, root).settings;
  }
  const actions = [json];
  if (doc) actions.push(markedBlockAction(root, LOCAL_SETUP_DOC, localSetupDocLines(doc), { markers: LOCAL_SETUP_MARKERS, what: 'the local setup steps' }));
  // A file with no block is `missing`; this one is yad's to add on every Product, so it is `new` for an update.
  return actions.map((a) => (a.status === 'missing' ? { ...a, status: 'new' } : a));
}

// ---- this machine -----------------------------------------------------------------------------------

// Every step with its state here: `ok` (its check passed), `pending` (its check failed), or `ask` (a team step:
// its check is a command yad does not run, so the agent asks the person).
export function localSetupState(root, { items = null } = {}) {
  const read = readCommittedLocalSetup(root);
  if (!read.doc) return { exists: false, committed: read.committed, error: read.error, steps: [], problems: [] };
  const { steps, problems } = readSteps(read.doc);
  let found = items;
  const out = steps.map((s) => {
    if (s.source !== 'yadflow' || !s.check?.builtin) return { ...s, state: 'ask', why: s.check?.run ? 'yad does not run a team\'s check' : 'it has no check' };
    if (s.check.builtin === 'tool' && !found) found = detectInstalled(root).items;
    const r = runBuiltinCheck(s.check, root, { items: found });
    return { ...s, state: r.ok ? 'ok' : 'pending', why: r.why };
  });
  return { exists: true, committed: read.committed, error: null, steps: out, problems };
}

const MARK = { ok: () => c.green('✓'), pending: () => c.yellow('•'), ask: () => c.cyan('?') };

// `yad local-setup [list] [--json]`. Reads only: runs the built-in checks, never a step.
export function runLocalSetupList(root, { json = false } = {}) {
  const st = localSetupState(root);
  const where = { product: root, file: LOCAL_SETUP_FILE };
  if (!st.exists) {
    const why = st.error ? `${LOCAL_SETUP_FILE} ${st.error}` : `this Product has no ${LOCAL_SETUP_FILE} yet`;
    const hint = st.error ? 'fix the file, or restore it from git' : 'run `yad update` (it writes the script), then commit it through review';
    if (json) return emitJSON({ ok: true, ...where, exists: false, committed: false, steps: [], pending: 0, problems: st.error ? [why] : [], hint });
    info(why);
    info(hint);
    return undefined;
  }
  const pending = st.steps.filter((s) => s.state !== 'ok');
  if (json) {
    return emitJSON({
      ok: true, ...where, exists: true, committed: st.committed,
      steps: st.steps.map(({ id, source, title, purpose, impact, when, commands, check, verify, person = false, vetted, addedBy = null, hash, state, why }) => ({ id, source, title, purpose, impact, when, commands, check: check ?? null, verify: verify ?? null, person, vetted, addedBy, hash, state, why })),
      pending: pending.length, problems: st.problems,
    });
  }
  for (const p of st.problems) warn(p);
  log(c.bold(`\nyad local-setup — ${st.steps.length} step(s), ${pending.length} not done here`));
  if (!st.committed) warn(`${LOCAL_SETUP_FILE} is not committed yet — this is the copy on disk`);
  for (const s of st.steps) {
    log(`  ${MARK[s.state]()} ${c.bold(forTerminal(s.title))} ${c.dim(`(${s.id}, ${s.when}${s.source === 'team' ? ', from your team' : ''})`)}`);
    if (s.state === 'ok') continue;
    log(`      ${c.dim(`why: ${forTerminal(s.purpose)}`)}`);
    log(`      ${c.dim(`changes for you: ${forTerminal(s.impact)}`)}`);
    for (const cmd of s.commands) log(`      ${c.dim(`run: ${forTerminal(cmd)}`)}`);
    if (s.state === 'ask' && s.check?.run) log(`      ${c.dim(`already done if this succeeds: ${forTerminal(s.check.run)}`)}`);
  }
  info(`the steps, with what each changes, are in ${LOCAL_SETUP_DOC}; \`yad local-setup --json\` gives them to an agent`);
  return undefined;
}

// The few lines setup, update and join print about this machine: how many steps are not done here.
export function localSetupSection(root) {
  let st;
  try { st = localSetupState(root); } catch (e) { warn(`local setup: could not read the steps (${forTerminal(e?.message ?? String(e))})`); return { pending: [] }; }
  if (!st.exists) return { pending: [] };
  const pending = st.steps.filter((s) => s.state !== 'ok');
  log(c.bold('\nLocal setup (this machine)'));
  if (!pending.length) log(`  ${c.green('✓')} all ${st.steps.length} step(s) are done here`);
  else {
    log(`  ${c.yellow('•')} ${pending.length} of ${st.steps.length} step(s) are not done here: ${pending.map((s) => s.id).join(', ')}`);
    info(`see them with \`yad local-setup\` — each says why it is needed and what it changes for you (${LOCAL_SETUP_DOC})`);
  }
  return { pending: pending.map((s) => s.id) };
}
