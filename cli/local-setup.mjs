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
import { c, emitJSON, forTerminal, info, log, ok, refuse, warn, writeJSON, isPlainObject } from './lib.mjs';
import { markedBlockAction } from './plan.mjs';
import { productConfigPath, SCHEMA_VERSION, VERSION } from './manifest.mjs';
import {
  LOCAL_SETUP_CATALOGUE_VERSION, LOCAL_SETUP_VERSION, LOCAL_SETUP_FILE, LOCAL_SETUP_DOC, STEP_ID, WHEN, BUILTIN_CHECKS,
  yadflowSteps, cliMinimum, fileCliMin, stepHash, runBuiltinCheck, localSetupPath,
} from './local-setup-steps.mjs';
import { detectInstalled } from './detect.mjs';
import { readLocalSetupRecord, answerFor, writeLocalSetupAnswers } from './local-setup-record.mjs';

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
// A comment marker anywhere in a step could become one of yad's marker lines in LOCAL-SETUP.md, and no amount of
// removing text makes that safe (taking out one `<!--` can join the letters around it into another). So a step
// holding one is refused, and every command is shown exactly as written.
// `--!>` too: browsers end a comment there as well.
const MARKER = /<!--|--!?>/;
// One plain line: nothing `forTerminal` would change — no control character, and none of the invisible or
// direction-changing ones (U+202E and its kind), which would let LOCAL-SETUP.md show a reviewer one command while
// the agent runs another.
// Also every format and separator character (zero-width spaces, soft hyphens, tag characters): `exa\u200bmple.com`
// reads as `example.com`.
// And every space but the plain one: a no-break space looks like a space and is not one to the shell.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|(?! )\p{Zs}/u;
const oneLine = (v) => isText(v) && forTerminal(v) === v && !HIDDEN.test(v);

export function stepProblems(s, source) {
  const p = [];
  if (!isPlainObject(s)) return ['it is not an object'];
  if (typeof s.id !== 'string' || !STEP_ID.test(s.id)) p.push('its id should be lowercase letters, digits and dashes');
  for (const k of ['title', 'purpose', 'impact']) if (!isText(s[k])) p.push(`it has no ${k}`);
  if (!isTextList(s.commands)) p.push('it has no commands');
  else if (!s.commands.every(oneLine)) p.push('each command should be one line');
  if (!WHEN.includes(s.when)) p.push('its `when` should be "required" or "optional"');
  if (s.verify != null && !oneLine(s.verify)) p.push('its verify should be one line');
  if (s.check != null) {
    if (!isPlainObject(s.check)) p.push('its check should be an object');
    else if (source === 'yadflow' && !BUILTIN_CHECKS.includes(s.check.builtin)) p.push('its check is not one yad knows');
    // A team's check is a command and nothing else: a `builtin` beside it would hide the command in the view.
    else if (source === 'team' && (!oneLine(s.check.run) || Object.keys(s.check).length !== 1)) p.push('its check should be `{ "run": "<one command>" }`');
  }
  const words = [s.title, s.purpose, s.impact, s.verify, s.addedBy, ...(Array.isArray(s.commands) ? s.commands : []), s.check?.run];
  if (words.some((w) => typeof w === 'string' && MARKER.test(w))) p.push('it holds `<!--`, `-->` or `--!>`, which LOCAL-SETUP.md cannot show safely');
  return p;
}

// A file's text as JSON, a byte-order mark (some Windows editors add one) read past.
export const parseJSON = (text) => JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// The two lists, each step checked. `problems` names every step left out and why; the file still answers.
//
// VETTED IS NEVER READ FROM THE FILE. Anyone who can merge to the Product can write a step under `yadflow`. A
// yadflow step counts as yadflow's own (`known`, and `vetted` unless it is a team's tool) only when its id and hash
// are what this yadflow writes for this Product (`ours`: id → { hash, vetted }). Any other one is shown as not
// vetted, and `yad update` rewrites it.
export function readSteps(doc, { ours = null } = {}) {
  // A file another catalogue wrote: its yadflow steps that differ are that release's, not a forgery.
  const otherRelease = doc?.catalogueVersion !== LOCAL_SETUP_CATALOGUE_VERSION;
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
      const hash = stepHash(s);
      const mine = source === 'yadflow' ? ours?.get(s.id) : null;
      const known = !!mine && mine.hash === hash;
      steps.push({ ...s, source, known: source === 'yadflow' ? known : false, otherRelease: source === 'yadflow' && !known && otherRelease, vetted: known && mine.vetted !== false, hash });
    }
  }
  return { steps, problems };
}

// The file as git has it at HEAD, else as it is on disk (a setup not committed yet). `{ doc, committed, error }`.
export function readCommittedLocalSetup(root) {
  const r = spawnSync('git', ['show', `HEAD:./${LOCAL_SETUP_FILE}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  let text = r.status === 0 ? r.stdout : null;
  const committed = text !== null;
  if (text === null) {
    try { text = fs.readFileSync(localSetupPath(root), 'utf8'); } catch { return { doc: null, committed: false, error: null }; }
  }
  try {
    const doc = parseJSON(text);
    if (!isPlainObject(doc)) return { doc: null, committed, error: 'is not a JSON object' };
    return { doc, committed, error: null };
  } catch { return { doc: null, committed, error: 'does not parse' }; }
}

// ---- writing it (setup, update, check --fix) --------------------------------------------------------

// yad's part of the file merged into what is there: `yadflow[]` and the two version numbers replaced, every
// other key (the team's list first of all) kept as it is. The shape `reconcile` asks of a shared JSON file.
// What this yadflow writes for this Product, given the file there now: id → { hash, vetted } (readSteps).
//
// Built with the file's OWN CLI version: a member whose yad is newer (or older) than the one that wrote the file
// still sees yad's own CLI step as yad's. Only a plain release number is taken from the file (PLAIN_VERSION).
export const oursFor = (doc, root) => new Map(yadflowSteps(root, { cliMin: fileCliMin(doc) ?? VERSION }).map((s) => [s.id, { hash: stepHash(s), vetted: s.vetted }]));

// yad's own steps that its own reader would refuse — a team's toolbox tool whose words hold a marker or a
// two-line install command — are left out when yad writes them, and said once.
const droppedSaid = new Set();
function soundSteps(steps) {
  return steps.filter((s) => {
    const p = stepProblems(s, 'yadflow');
    if (!p.length) return true;
    const key = `${s.id}\0${p.join()}`;
    if (!droppedSaid.has(key)) { droppedSaid.add(key); warn(`local setup: the step for \`${forTerminal(s.id)}\` is left out — ${p.join('; ')} (fix the tool in .sdlc/toolbox.json)`); }
    return false;
  });
}

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
    yadflow: soundSteps(yadflowSteps(root, { cliMin: cliMinimum(fileCliMin(current)) })),
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
  if (raw !== null) { try { parsed = parseJSON(raw); } catch { parsed = undefined; } }
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
        try { now = parseJSON(fs.readFileSync(dest, 'utf8')); } catch { warn(`${LOCAL_SETUP_FILE} does not parse — left untouched`); return; }
      }
      const next = mergeLocalSetup(now, root);
      if (next.unreadable) { warn(`${LOCAL_SETUP_FILE}: ${next.unreadable} — left untouched`); return; }
      if (!next.changed && Object.keys(now).length) return;
      writeJSON(dest, next.settings);
    },
  };
}

// The view's words. Every step that reaches here passed stepProblems: it holds no comment marker, and its commands
// are single lines. Prose is put on one line; code is shown exactly as written, in a span or fence longer than any
// run of backticks inside it, so an agent that copies from LOCAL-SETUP.md runs what the JSON says.
const md = (s) => forTerminal(String(s ?? '')).replace(/\s+/g, ' ').trim();
const longestTicks = (s) => Math.max(0, ...[...String(s).matchAll(/`+/g)].map((m) => m[0].length));
const code = (s) => {
  const t = String(s);
  const fence = '`'.repeat(longestTicks(t) + 1);
  const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${t}${pad}${fence}`;
};
const CHECK_WORDS = {
  'cli-version': (k) => `${code('yad --version')} is ${md(k.min)} or later`,
  'platform-login': () => 'the platform CLI is signed in to the Product\'s host',
  'ledger-hook': () => `${code('yad doctor')} shows the pre-commit hook as installed`,
  'commit-signing': () => `${code('yad signing check')} finds nothing to set up`,
  tool: (k) => `${code('yad toolbox check')} finds ${md(k.tool)}`,
};
const checkWords = (s) => (s.source === 'team'
  ? (s.check?.run ? `this command succeeds (ask the person before running it): ${code(s.check.run)}` : null)
  : s.check?.builtin ? (CHECK_WORDS[s.check.builtin]?.(s.check) ?? 'yad checks it') : null);

function stepLines(s) {
  const who = s.source === 'team' ? ` · added by your team${s.addedBy ? ` (${md(s.addedBy)})` : ''}, not vetted by yadflow`
    : !s.known ? ` · **not what this yadflow writes — not vetted${s.otherRelease ? ' (possibly from another yadflow version)' : ''}; \`yad update\` rewrites it**`
      : !s.vetted ? ' · a tool your team added, not vetted by yadflow' : '';
  const fence = '`'.repeat(Math.max(3, ...s.commands.map((cmd) => longestTicks(cmd) + 1)));
  const lines = [`### ${md(s.title)}`, '', `- **Id:** ${code(s.id)} · **${s.when}**${who}${s.person ? ' · **the person does this step, not the agent**' : ''}`];
  lines.push(`- **Why:** ${md(s.purpose)}`, `- **What it changes for you:** ${md(s.impact)}`, '- **Run:**', '', `  ${fence}sh`, ...s.commands.map((cmd) => `  ${cmd}`), `  ${fence}`, '');
  const done = checkWords(s);
  if (done) lines.push(`- **Already done when:** ${done}`);
  if (s.verify) lines.push(`- **Confirm with:** ${code(s.verify)}`);
  lines.push('');
  return lines;
}

// The block yad writes into LOCAL-SETUP.md, from a file yad has just merged (so its yadflow steps are yad's own).
export function localSetupDocLines(doc) {
  const ours = new Map((doc?.yadflow ?? []).filter(isPlainObject).map((s) => [s.id, { hash: stepHash(s), vetted: s.vetted }]));
  const { steps } = readSteps(doc, { ours });
  const mine = steps.filter((s) => s.source === 'yadflow');
  const theirs = steps.filter((s) => s.source === 'team');
  return [
    '# Local setup',
    '',
    'This is the script that gets a team member\'s machine ready for this project, and keeps it ready after each update.',
    'Each step says why it is needed and what it changes for you, so you decide whether to do it.',
    '',
    `**For the agent:** run ${code('yad local-setup list --json')} to see which steps this machine still needs.`,
    'For each one, tell the person its "Why" and "What it changes for you", and run its commands only after they say yes.',
    'A step marked "the person does this step" is theirs: give them the command and wait.',
    `If ${code('yad local-setup')} is not a command your yad knows, do the "Install the yadflow CLI" step first.`,
    '',
    '## Steps from yadflow',
    '',
    ...(mine.length ? mine.flatMap(stepLines) : ['None.', '']),
    '## Steps from your team',
    '',
    ...(theirs.length ? theirs.flatMap(stepLines) : ['None yet.', '']),
  ].map((l) => l.replace(/\s+$/, ''));
}

// The team's list as committed, or undefined when HEAD has no readable file.
// `{ team }` as committed: `[]` when HEAD has no file (an update PR then commits yad's own, with no team step), or
// `{ broken: true }` when HEAD's file cannot be read (an update PR never carries the JSON then: reconcile).
function committedTeam(root) {
  const r = spawnSync('git', ['show', `HEAD:./${LOCAL_SETUP_FILE}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) return { team: [] };
  try {
    const d = parseJSON(r.stdout);
    return isPlainObject(d) && (d.team === undefined || Array.isArray(d.team)) ? { team: d.team ?? [] } : { broken: true };
  } catch { return { broken: true }; }
}

// The two actions setup, update and check --fix apply: the JSON, then its Markdown view built from what the
// JSON will hold. Both are shared files (`paths` empty, `shared` named), like AGENTS.md: `--open-pr` carries them.
export function localSetupActions(root) {
  // A Product's script: a folder with no Product config gets none (its steps would describe nothing).
  if (!fs.existsSync(productConfigPath(root))) return [];
  const json = localSetupJsonAction(root);
  let doc = null;
  let now = {};
  if (!json.writesNothing) {
    try { now = parseJSON(fs.readFileSync(localSetupPath(root), 'utf8')); } catch { /* new */ }
    doc = mergeLocalSetup(isPlainObject(now) ? now : {}, root).settings;
  }
  const actions = [json];
  if (doc) {
    const view = markedBlockAction(root, LOCAL_SETUP_DOC, localSetupDocLines(doc), { markers: LOCAL_SETUP_MARKERS, what: 'the local setup steps' });
    // The view shows the team steps on disk. While those differ from the committed ones (a person's own edit, not
    // committed), the view is theirs too: `--open-pr` must not carry it, or the PR's LOCAL-SETUP.md would list a
    // step its JSON lacks. It goes with the person's own commit of the JSON, which the JSON row asks for.
    // The JSON rides only when its team list is the committed one, so the view does too.
    const head = committedTeam(root);
    const ownEdit = !!head.broken || JSON.stringify(head.team) !== JSON.stringify(isPlainObject(now) ? (now.team ?? []) : []);
    actions.push(ownEdit ? { ...view, shared: undefined, mergeShared: undefined } : view);
  }
  // A file with no block is `missing`; this one is yad's to add on every Product, so it is `new` for an update.
  return actions.map((a) => (a.status === 'missing' ? { ...a, status: 'new' } : a));
}

// ---- this machine -----------------------------------------------------------------------------------

// Every step with its state here, from yad's own checks and this machine's record (cli/local-setup-record.mjs):
//   skipped  the person said no to the step as it is now (the record), whatever a check says
//   ok       yad's own check passed            pending  it failed
//   done     the person did a step yad cannot check (a team step, one with no check, one yad did not write)
//   ask      such a step, not answered for as it is now: yad runs no team command, so the agent asks the person
// `recorded`: the record has an answer for the step as it is now. `changed`: it has one for an older form only.
// `seen`: nothing is left to ask about it.
// `noProgram` (yad guide, doctor): never start gh or glab, nor reach the network. The checks run are local (git
// config, files, \`which\`); `platform-login` (gh or glab, which may reach the network) is judged by the record,
// like a step with no check.
export const NO_PROGRAM_CHECKS = Object.freeze(['cli-version', 'ledger-hook', 'commit-signing', 'tool']);
export function localSetupState(root, { items = null, noProgram = false } = {}) {
  const read = readCommittedLocalSetup(root);
  const record = readLocalSetupRecord(root);
  const base = { committed: read.committed, record: { path: record.path, error: record.error } };
  if (!read.doc) return { ...base, exists: read.error !== null, error: read.error, steps: [], problems: [] };
  const { steps, problems } = readSteps(read.doc, { ours: oursFor(read.doc, root) });
  // The file says which catalogue wrote it, and whoever writes the file can say anything: the reason is only a
  // possibility, and never softens "not vetted".
  const unknown = steps.filter((s) => s.source === 'yadflow' && !s.known);
  if (unknown.length) problems.push(`${LOCAL_SETUP_FILE}: ${unknown.length} yadflow step(s) are not what this yadflow writes (${unknown.map((s) => s.id).join(', ')}) — not vetted${unknown.some((s) => s.otherRelease) ? '; the file says another yadflow version wrote it' : ''}; \`yad update\` rewrites them`);
  let found = items;
  const out = steps.map((s) => {
    const answer = answerFor(record.entries, s);
    const changed = !answer && Object.hasOwn(record.entries, s.id);
    const mark = (state, why, more = {}) => ({ ...s, state, why, recorded: !!answer, changed: changed && state !== 'ok', seen: ['ok', 'done', 'skipped'].includes(state), ...more });
    if (answer?.state === 'skipped') return mark('skipped', `you said no${answer.reason ? `: ${answer.reason}` : ''}`, { reason: answer.reason ?? null, at: answer.at ?? null });
    const checked = s.source === 'yadflow' && s.known && s.check?.builtin && (!noProgram || NO_PROGRAM_CHECKS.includes(s.check.builtin));
    if (!checked) {
      if (answer?.state === 'done') return mark('done', 'you did it on this machine', { at: answer.at ?? null });
      // A step yad did not write: its check is the file's too, so it never decides what the agent is told.
      const why = s.source === 'yadflow' && !s.known ? 'it is not what this yadflow writes, so the person decides'
        : s.check?.run ? 'yad does not run a team\'s check'
          : s.check?.builtin ? 'not checked here — `yad local-setup` checks it' : 'it has no check';
      return mark('ask', why);
    }
    if (s.check.builtin === 'tool' && !found) found = detectInstalled(root).items;
    const r = runBuiltinCheck(s.check, root, { items: found });
    return mark(r.ok ? 'ok' : 'pending', r.why);
  });
  return { ...base, exists: true, error: null, steps: out, problems };
}

const MARK = { ok: () => c.green('✓'), done: () => c.green('✓'), skipped: () => c.dim('–'), pending: () => c.yellow('•'), ask: () => c.cyan('?') };
const counts = (steps) => ({ pending: steps.filter((s) => s.state === 'pending').length, ask: steps.filter((s) => s.state === 'ask').length, skipped: steps.filter((s) => s.state === 'skipped').length });

// `yad local-setup [list] [--json]`. Reads only: runs yad's own checks, never a step.
export function runLocalSetupList(root, { json = false } = {}) {
  const st = localSetupState(root);
  const where = { product: root, file: LOCAL_SETUP_FILE };
  if (!st.steps.length && (st.error || !st.exists)) {
    const why = st.error ? `${LOCAL_SETUP_FILE} ${st.error}` : `this Product has no ${LOCAL_SETUP_FILE} yet`;
    const hint = st.error ? 'fix the file, or restore it from git' : 'run `yad update` (it writes the script), then commit it through review';
    if (json) return emitJSON({ ok: true, ...where, exists: st.exists, committed: st.committed, error: st.error, steps: [], pending: 0, ask: 0, skipped: 0, record: st.record, problems: st.error ? [why] : [], hint });
    (st.error ? warn : info)(why);
    info(hint);
    return undefined;
  }
  const n = counts(st.steps);
  if (json) {
    return emitJSON({
      ok: true, ...where, exists: true, committed: st.committed, error: null,
      steps: st.steps.map(({ id, source, title, purpose, impact, when, commands, check, verify, person = false, known, otherRelease = false, vetted, addedBy = null, hash, state, why, recorded, changed, seen, reason = null, at = null }) => ({ id, source, title, purpose, impact, when, commands, check: check ?? null, verify: verify ?? null, person, known, otherRelease, vetted, addedBy, hash, state, why, recorded, changed, seen, reason, at })),
      ...n, record: st.record, problems: st.problems,
    });
  }
  for (const p of st.problems) warn(p);
  if (st.record.error) warn(recordWarning(st.record));
  log(c.bold(`\nyad local-setup — ${st.steps.length} step(s): ${n.pending} not done here, ${n.ask} to check with you${n.skipped ? `, ${n.skipped} you said no to` : ''}`));
  if (!st.committed) warn(`${LOCAL_SETUP_FILE} is not committed yet — this is the copy on disk`);
  for (const s of st.steps) {
    log(`  ${MARK[s.state]()} ${c.bold(forTerminal(s.title))} ${c.dim(`(${s.id}, ${s.when}${s.source === 'team' ? ', from your team' : !s.known ? `, not vetted${s.otherRelease ? ' — possibly from another yadflow version' : ''}` : ''})`)}`);
    if (s.state === 'ok' || s.state === 'done') continue;
    if (s.state === 'skipped') { log(`      ${c.dim(`you said no${s.reason ? `: ${forTerminal(s.reason)}` : ''} — \`yad local-setup done ${s.id}\` once you do it`)}`); continue; }
    if (s.changed) log(`      ${c.yellow('changed since this machine last answered for it')}`);
    log(`      ${c.dim(`why: ${forTerminal(s.purpose)}`)}`);
    log(`      ${c.dim(`changes for you: ${forTerminal(s.impact)}`)}`);
    for (const cmd of s.commands) log(`      ${c.dim(`run: ${forTerminal(cmd)}`)}`);
    if (s.state === 'ask' && s.check?.run) log(`      ${c.dim(`already done if this succeeds: ${forTerminal(s.check.run)}`)}`);
  }
  info(`the steps, with what each changes, are in ${LOCAL_SETUP_DOC}; \`yad local-setup list --json\` gives them to an agent`);
  if (n.pending || n.ask) info('after each step: `yad local-setup done <id>`; to say no: `yad local-setup skip <id> --reason "<why>"`');
  return undefined;
}

// What `yad guide` and `yad doctor` say about this machine: the steps not yet answered for (`pending` and `ask`),
// or null when there are none. Cheap: no gh or glab, no network (NO_PROGRAM_CHECKS). Never
// throws: a script or record that cannot be read is an `error`, for the caller to show.
export function localSetupWaiting(root) {
  let st;
  try { st = localSetupState(root, { noProgram: true }); } catch (e) { return { pending: [], ask: [], changed: [], error: `could not read the steps (${e?.message ?? String(e)})`, recordError: null }; }
  if (st.error) return { pending: [], ask: [], changed: [], error: `${LOCAL_SETUP_FILE} ${st.error}`, recordError: null };
  const ids = (state) => st.steps.filter((s) => s.state === state).map((s) => s.id);
  const w = { pending: ids('pending'), ask: ids('ask'), changed: st.steps.filter((s) => s.changed).map((s) => s.id), error: null, recordError: st.record.error };
  return w.pending.length || w.ask.length || w.recordError ? w : null;
}

// ---- answering for this machine: `yad local-setup done` and `skip` ------------------------------------

export const DONE_USAGE = 'usage: yad local-setup done <id>… [--json]   |   yad local-setup skip <id> --reason "<why>" [--json]';
const REASON_MAX = 500;

// The steps named, from the committed script, or a refusal (returned) — shared by `done` and `skip`. Read without
// starting gh or glab: `skip` needs no check at all, and `done` runs only the named steps' own checks.
function stepsNamed(root, ids, verb, json) {
  if (!ids.length) return { refused: refuse(`yad local-setup ${verb} needs a step id`, `${DONE_USAGE} — \`yad local-setup list\` shows the ids`, { json }) };
  const st = localSetupState(root, { noProgram: true });
  if (st.error) return { refused: refuse(`${LOCAL_SETUP_FILE} ${st.error}`, 'fix it, or restore it from git', { json }) };
  if (!st.steps.length) return { refused: refuse(`this Product has no local setup steps (${LOCAL_SETUP_FILE})`, 'run `yad update` (it writes the script), then commit it through review', { json }) };
  if (!st.record.path) return { refused: refuse(`${root} is not in a git clone, so this machine's answers have nowhere to go`, 'run it from your clone of the Product', { json }) };
  if (st.record.error) return { refused: refuse(recordWarning(st.record), 'delete the file, then run this again', { json }) };
  const byId = new Map(st.steps.map((x) => [x.id, x]));
  const unknown = [...new Set(ids)].filter((id) => !byId.has(id));
  if (unknown.length) return { refused: refuse(`not a step in ${LOCAL_SETUP_FILE}: ${unknown.map((id) => forTerminal(id)).join(', ')}`, '`yad local-setup list` shows the ids', { json }) };
  return { steps: [...new Set(ids)].map((id) => byId.get(id)), st };
}

// `yad local-setup done <id>…`: the person did these steps on this machine. A step yad can check must pass its
// check first (the check, not the word, says it is done); every id passes or nothing is written.
export function runLocalSetupDone(root, { ids = [], json = false, now } = {}) {
  const got = stepsNamed(root, ids, 'done', json);
  if (got.refused !== undefined || !got.steps) return got.refused;
  // Every named step yad can check is checked now, whatever the record says: a no given earlier never lets `done`
  // stand in for a check that fails.
  const failing = got.steps.filter((x) => x.source === 'yadflow' && x.known && x.check?.builtin)
    .map((x) => ({ x, r: runBuiltinCheck(x.check, root) })).filter(({ r }) => !r.ok).map(({ x, r }) => ({ ...x, why: r.why }));
  if (failing.length) {
    return refuse(`not done on this machine yet: ${failing.map((x) => `${x.id} (${forTerminal(x.why)})`).join('; ')} — nothing was recorded`,
      'finish the step, run its verify command, then run this again', { json, failing: failing.map((x) => ({ id: x.id, why: x.why })) });
  }
  const file = writeLocalSetupAnswers(root, got.steps.map((x) => ({ id: x.id, hash: x.hash, state: 'done' })), { now });
  const done = got.steps.map((x) => x.id);
  if (json) return emitJSON({ ok: true, product: root, done, record: file });
  ok(`recorded on this machine: ${done.join(', ')} done`);
  return { done, record: file };
}

// `yad local-setup skip <id> --reason "<why>"`: the person said no. It holds until the step changes.
export function runLocalSetupSkip(root, { ids = [], reason, json = false, now } = {}) {
  if (ids.length > 1) return refuse('yad local-setup skip takes one step id: the reason is the person\'s, for that step', DONE_USAGE, { json });
  const why = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim() : '';
  if (!why) return refuse('yad local-setup skip needs --reason "<why>": the person\'s own words, so the team can see why later', DONE_USAGE, { json });
  if (why.length > REASON_MAX || forTerminal(why) !== why) return refuse(`the reason must be one plain line of at most ${REASON_MAX} characters`, DONE_USAGE, { json });
  const got = stepsNamed(root, ids, 'skip', json);
  if (got.refused !== undefined || !got.steps) return got.refused;
  const [x] = got.steps;
  const file = writeLocalSetupAnswers(root, [{ id: x.id, hash: x.hash, state: 'skipped', reason: why }], { now });
  const required = x.when === 'required';
  if (json) return emitJSON({ ok: true, product: root, skipped: x.id, reason: why, required, record: file });
  ok(`recorded on this machine: ${x.id} skipped — it is asked again only when the step changes`);
  if (required) warn(`${x.id} is marked required: ${forTerminal(x.purpose)}`);
  info(`changed your mind? do the step, then \`yad local-setup done ${x.id}\``);
  return { skipped: x.id, reason: why, required, record: file };
}

// The warning for a record that cannot be read: it is read as empty, so every answer would be asked again.
const recordWarning = (r) => `local setup: this machine's record (${forTerminal(r.path)}) ${r.error} — read as empty, so every step is asked again; delete it, it only remembers your answers`;

// The few lines setup, update, check and join print about this machine. Never fails the command it is part of.
// Returns the part of that command's --json answer it adds: `{ pending, ask, unvetted, skipped, changed, error }`
// (step ids, and why the committed script could not be read, or null).
const EMPTY = Object.freeze({ pending: [], ask: [], unvetted: [], skipped: [], changed: [] });
export function localSetupSection(root) {
  let st;
  try { st = localSetupState(root); } catch (e) { warn(`local setup: could not read the steps (${forTerminal(e?.message ?? String(e))})`); return { ...EMPTY, error: 'could not read' }; }
  if (st.error) { warn(`local setup: ${st.committed ? 'the committed ' : ''}${LOCAL_SETUP_FILE} ${st.error} — fix it (or restore it from git); \`yad local-setup\` says more`); return { ...EMPTY, error: st.error }; }
  if (!st.steps.length) return { ...EMPTY, error: null };
  if (st.record.error) warn(recordWarning(st.record));
  const pending = st.steps.filter((s) => s.state === 'pending');
  const ask = st.steps.filter((s) => s.state === 'ask');
  const skipped = st.steps.filter((s) => s.state === 'skipped');
  const changed = st.steps.filter((s) => s.changed);
  // The `ask` steps under `yadflow` that yad did not write: printed apart, and `unvetted` in --json.
  const strange = ask.filter((s) => s.source === 'yadflow' && !s.known);
  log(c.bold('\nLocal setup (this machine)'));
  if (!pending.length && !ask.length) log(skipped.length === st.steps.length ? `  ${c.dim('–')} you said no to every step` : `  ${c.green('✓')} all ${st.steps.length - skipped.length} step(s) you said yes to are done here`);
  else {
    if (pending.length) log(`  ${c.yellow('•')} ${pending.length} step(s) are not done here: ${pending.map((s) => s.id).join(', ')}`);
    const theirs = ask.filter((s) => s.source !== 'yadflow');
    const unchecked = ask.filter((s) => s.source === 'yadflow' && s.known);
    if (theirs.length) log(`  ${c.cyan('?')} ${theirs.length} step(s) from your team, to check with you: ${theirs.map((s) => s.id).join(', ')}`);
    if (unchecked.length) log(`  ${c.cyan('?')} ${unchecked.length} step(s) yad cannot check, to check with you: ${unchecked.map((s) => s.id).join(', ')}`);
    if (strange.length) log(`  ${c.yellow('!')} ${strange.length} yadflow step(s) that are not what this yadflow writes — not vetted, to check with you: ${strange.map((s) => s.id).join(', ')}`);
    if (changed.length) info(`${changed.length} of them changed since this machine last answered: ${changed.map((s) => s.id).join(', ')}`);
    info(`see them with \`yad local-setup\` — each says why it is needed and what it changes for you (${LOCAL_SETUP_DOC})`);
  }
  if (skipped.length) info(c.dim(`${skipped.length} step(s) you said no to: ${skipped.map((s) => s.id).join(', ')}`));
  return { pending: pending.map((s) => s.id), ask: ask.map((s) => s.id), unvetted: strange.map((s) => s.id), skipped: skipped.map((s) => s.id), changed: changed.map((s) => s.id), error: null };
}
