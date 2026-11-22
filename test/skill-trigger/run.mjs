#!/usr/bin/env node
/* global console */
// Skill trigger check (opt-in, docs/skill-trigger.md): does an agent still pick the right yad-* skill
// from its description? An agent sees every installed skill's description in each session and picks
// one from that text alone, so a description that is too short can leave a skill unused. This run gives
// a model only the description list and one request from cases.json, asks which skill it would load
// first, and does it for two refs (by default v4.13.0, before the descriptions were cut for Product
// #240, and HEAD), then compares.
//
//   YAD_TRIGGER=1 node test/skill-trigger/run.mjs [--old <ref>] [--new <ref>] [--model <m>] [--work <dir>] [--limit <n>]
//   node test/skill-trigger/run.mjs selftest        no model, no credit: checks the cases and the scoring
//
// The real run spends credit on the logged-in `claude` CLI (about 2 × the number of cases short calls),
// so it never runs in CI or in `npm test`. Answers are cached in <work>/answers.jsonl: a run started again
// with the same --work resumes instead of paying again. It exits 1 when the new descriptions do worse:
// more than SLACK cases fewer right, or a skill that some old answer got right and no new answer does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SLACK = 2;
const PARALLEL = 4;

// --- descriptions at a ref -----------------------------------------------------------------------------

// One frontmatter `description:` value as YAML would read it: plain, single-quoted ('' is a quote),
// double-quoted, or a block (`>` folds lines, `|` keeps them). null when there is none.
export function readDescription(text) {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front) return null;
  const lines = front[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return null;
  const v = lines[i].replace(/^description:[ \t]*/, '');
  if (/^[|>]/.test(v)) {
    const body = [];
    for (let j = i + 1; j < lines.length && (/^\s/.test(lines[j]) || lines[j] === ''); j++) body.push(lines[j].trim());
    return (v[0] === '>' ? body.join(' ') : body.join('\n')).replace(/\s+$/, '') || null;
  }
  if (v.startsWith('\'')) return v.endsWith('\'') && v.length > 1 ? v.slice(1, -1).replace(/''/g, '\'') : null;
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { return null; } }
  return v.trim() || null;
}

// { name: description } for every skills/yad-*/SKILL.md at a git ref of this checkout.
export function descriptionsAt(ref, root = ROOT) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const names = git('ls-tree', '--name-only', `${ref}:skills`).split('\n').filter((n) => n.startsWith('yad-'));
  const out = {};
  for (const n of names.sort()) {
    let text;
    try { text = git('show', `${ref}:skills/${n}/SKILL.md`); } catch { continue; }
    const d = readDescription(text);
    if (d) out[n] = d;
  }
  return out;
}

// --- the question ----------------------------------------------------------------------------------------

export const SYSTEM = 'You are an AI coding agent deciding which installed skill to load for a request. Answer with one skill name or none, and nothing else.';

export function promptFor(descriptions, request) {
  const list = Object.keys(descriptions).sort().map((n) => `- ${n}: ${descriptions[n]}`).join('\n');
  return `These skills are installed:\n${list}\n\nA person says: «${request}»\n\n` +
    'Which one skill would you load first to handle this? Reply with only its exact name, or `none` if no skill fits.';
}

// The skill name in a model's reply: the first yad-* name it gives, or none.
export function parseAnswer(reply, names) {
  const t = String(reply ?? '').toLowerCase();
  const found = t.match(/yad-[a-z0-9-]+/g) || [];
  for (const f of found) { const n = f.replace(/[-.]+$/, ''); if (names.includes(n)) return n; }
  if (/\bnone\b/.test(t)) return 'none';
  return found[0] ? `unknown:${found[0]}` : 'none';
}

// --- scoring ----------------------------------------------------------------------------------------------

const right = (c, got) => got === c.expect || (c.also || []).includes(got);

// answers: { old: [name per case], new: [...] }. Returns the totals, the per-skill table, the regressions,
// the gains, the confusions, and whether the new descriptions failed the check.
export function score(cases, answers) {
  const tally = { old: 0, new: 0 };
  const perSkill = {};
  const regressions = [];
  const gains = [];
  const confusions = { old: [], new: [] };
  cases.forEach((c, i) => {
    const ok = {};
    for (const side of ['old', 'new']) {
      ok[side] = right(c, answers[side][i]);
      if (ok[side]) tally[side]++;
      else confusions[side].push({ request: c.request, expect: c.expect, got: answers[side][i] });
      const s = (perSkill[c.expect] ||= { cases: 0, old: 0, new: 0 });
      if (side === 'old') s.cases++;
      if (ok[side]) s[side]++;
    }
    if (ok.old && !ok.new) regressions.push({ request: c.request, expect: c.expect, got: answers.new[i] });
    if (!ok.old && ok.new) gains.push({ request: c.request, expect: c.expect, got: answers.old[i] });
  });
  const lostSkills = Object.entries(perSkill).filter(([, s]) => s.old > 0 && s.new === 0).map(([n]) => n);
  const failed = tally.new < tally.old - SLACK || lostSkills.length > 0;
  return { total: cases.length, tally, perSkill, regressions, gains, confusions, lostSkills, failed };
}

export function report(r, meta) {
  const pct = (n) => `${Math.round((100 * n) / r.total)}%`;
  const L = [];
  L.push('# Skill trigger check', '');
  L.push(`Model: ${meta.model}. Old: \`${meta.old}\` (${meta.oldChars} characters of descriptions). New: \`${meta.new}\` (${meta.newChars}).`, '');
  L.push('| | Old | New |', '|---|---|---|');
  L.push(`| Right answers | ${r.tally.old}/${r.total} (${pct(r.tally.old)}) | ${r.tally.new}/${r.total} (${pct(r.tally.new)}) |`, '');
  L.push(`**Result: ${r.failed ? 'FAIL' : 'pass'}.** ${r.regressions.length} regression(s), ${r.gains.length} gain(s).` +
    (r.lostSkills.length ? ` Skills no new answer picks: ${r.lostSkills.join(', ')}.` : ''), '');
  const row = (x) => `| ${x.request} | \`${x.expect}\` | \`${x.got}\` |`;
  if (r.regressions.length) L.push('## Regressions (right with old, wrong with new)', '', '| Request | Expected | New picked |', '|---|---|---|', ...r.regressions.map(row), '');
  if (r.gains.length) L.push('## Gains (wrong with old, right with new)', '', '| Request | Expected | Old picked |', '|---|---|---|', ...r.gains.map(row), '');
  L.push('## Per skill', '', '| Skill | Cases | Old right | New right |', '|---|---|---|---|');
  for (const [n, s] of Object.entries(r.perSkill).sort()) L.push(`| \`${n}\` | ${s.cases} | ${s.old} | ${s.new} |`);
  L.push('', '## Every wrong answer with new', '', '| Request | Expected | Picked |', '|---|---|---|', ...r.confusions.new.map(row), '');
  return L.join('\n');
}

// --- the model ---------------------------------------------------------------------------------------------

// One question to the logged-in claude CLI, isolated: an empty folder, no tools, no skills or slash
// commands, no MCP servers, no user settings (as test/agent-acceptance/run.sh runs it).
function ask(prompt, { model, cwd }) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--model', model, '--output-format', 'json', '--no-session-persistence',
      '--tools', '', '--disable-slash-commands', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--setting-sources', 'project,local', '--system-prompt', SYSTEM], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`));
      try { const j = JSON.parse(out); if (j.is_error) return reject(new Error(String(j.result).slice(0, 300))); resolve(String(j.result ?? '')); }
      catch { reject(new Error(`unreadable claude output: ${out.slice(0, 300)}`)); }
    });
    p.stdin.end(prompt);
  });
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

// --- modes ---------------------------------------------------------------------------------------------------

function loadCases() { return JSON.parse(fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8')).cases; }

function caseProblems(cases, names) {
  const p = [];
  const count = {};
  for (const c of cases) {
    for (const n of [c.expect, ...(c.also || [])]) if (n !== 'none' && !names.includes(n)) p.push(`"${c.request}": ${n} is not a skill`);
    count[c.expect] = (count[c.expect] || 0) + 1;
  }
  for (const n of names) if ((count[n] || 0) < 2) p.push(`${n}: ${count[n] || 0} case(s), at least 2 wanted`);
  if ((count.none || 0) < 5) p.push(`only ${count.none || 0} none case(s), at least 5 wanted`);
  return p;
}

function selftest() {
  const fail = [];
  const check = (cond, msg) => { if (!cond) fail.push(msg); };
  // The reader: every shape YAML allows on one key.
  check(readDescription("---\nname: x\ndescription: 'It''s short.'\n---\n") === "It's short.", 'single-quoted');
  check(readDescription('---\ndescription: "a \\"b\\""\n---\n') === 'a "b"', 'double-quoted');
  check(readDescription('---\ndescription: >\n  one\n  two\nname: x\n---\n') === 'one two', 'folded block');
  check(readDescription('---\ndescription: plain words\n---\n') === 'plain words', 'plain');
  check(readDescription('no frontmatter') === null, 'no frontmatter');
  // Both refs read in full, and the cases fit the skills that exist now.
  const now = descriptionsAt('HEAD');
  const names = Object.keys(now);
  check(names.length >= 40, `only ${names.length} descriptions read at HEAD`);
  let before = null;
  try { before = descriptionsAt('v4.13.0'); } catch { console.log('note: tag v4.13.0 not in this clone; skipped reading it'); }
  if (before) check(Object.keys(before).length >= 40, `only ${Object.keys(before).length} descriptions read at v4.13.0`);
  const cases = loadCases();
  for (const p of caseProblems(cases, names)) fail.push(`cases.json: ${p}`);
  // The parser.
  check(parseAnswer('yad-ship', names) === 'yad-ship', 'bare name');
  check(parseAnswer('I would load `yad-commit`.', names) === 'yad-commit', 'name in a sentence');
  check(parseAnswer('None', names) === 'none', 'none');
  check(parseAnswer('yad-nope', names) === 'unknown:yad-nope', 'unknown name');
  // The scoring: all right passes; a planted regression on one skill fails, and is named.
  const exact = cases.map((c) => c.expect);
  check(!score(cases, { old: exact, new: exact }).failed, 'all right must pass');
  const planted = exact.map((e) => (e === 'yad-ship' ? 'yad-commit' : e));
  const r = score(cases, { old: exact, new: planted });
  check(r.failed && r.lostSkills.includes('yad-ship'), 'a skill no new answer picks must fail');
  check(r.regressions.length === exact.filter((e) => e === 'yad-ship').length, 'regressions counted');
  const oneOff = exact.slice(); oneOff[0] = 'none';
  check(!score(cases, { old: exact, new: oneOff }).failed, 'one miss within the slack passes');
  check(right({ expect: 'yad-guide', also: ['yad-status'] }, 'yad-status'), 'an also answer counts as right');
  check(report(r, { model: 'm', old: 'a', new: 'b', oldChars: 1, newChars: 1 }).includes('Regressions'), 'report lists regressions');
  if (fail.length) { for (const f of fail) console.error(`FAIL: ${f}`); process.exit(1); }
  console.log(`skill-trigger selftest: ok (${cases.length} cases, ${names.length} skills)`);
}

async function real(argv) {
  if (process.env.YAD_TRIGGER !== '1') {
    console.error('The skill trigger check asks the logged-in claude CLI about 2 × (number of cases) questions, which spends credit. Set YAD_TRIGGER=1 to run it.');
    process.exit(2);
  }
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const oldRef = opt('--old', 'v4.13.0');
  const newRef = opt('--new', 'HEAD');
  const model = opt('--model', 'sonnet');
  const work = path.resolve(opt('--work', fs.mkdtempSync(path.join(os.tmpdir(), 'yad-trigger-'))));
  fs.mkdirSync(work, { recursive: true });
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-trigger-empty-'));
  console.log(`work folder (kept): ${work}`);

  const desc = { old: descriptionsAt(oldRef), new: descriptionsAt(newRef) };
  const limit = Number(opt('--limit', 0));
  const cases = limit > 0 ? loadCases().slice(0, limit) : loadCases();
  const names = [...new Set([...Object.keys(desc.old), ...Object.keys(desc.new)])];
  for (const side of ['old', 'new']) {
    const missing = cases.map((c) => c.expect).filter((e) => e !== 'none' && !desc[side][e]);
    if (missing.length) console.log(`note: ${side} (${side === 'old' ? oldRef : newRef}) has no ${[...new Set(missing)].join(', ')}`);
  }

  // The probe: the model must see no yad-* skill of its own, or the person's installed skills would answer.
  const probe = await ask('List the names of every skill, slash command or tool you can see in this session, or say none.', { model, cwd });
  if (/yad-[a-z]/.test(probe)) { console.error(`stopped: the model can see yad-* skills of its own, so the answers would be biased:\n${probe}`); process.exit(1); }

  const cacheFile = path.join(work, 'answers.jsonl');
  const cache = new Map();
  if (fs.existsSync(cacheFile)) for (const l of fs.readFileSync(cacheFile, 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(l); cache.set(`${j.side}\x1f${j.request}`, j); }
  const jobs = [];
  for (const side of ['old', 'new']) cases.forEach((c, i) => jobs.push({ side, i, c }));
  let done = 0;
  const answers = { old: [], new: [] };
  await pool(jobs, PARALLEL, async ({ side, i, c }) => {
    const key = `${side}\x1f${c.request}`;
    let hit = cache.get(key);
    if (!hit) {
      let reply;
      try { reply = await ask(promptFor(desc[side], c.request), { model, cwd }); }
      catch { reply = await ask(promptFor(desc[side], c.request), { model, cwd }); }
      hit = { side, request: c.request, reply, got: parseAnswer(reply, names) };
      fs.appendFileSync(cacheFile, `${JSON.stringify(hit)}\n`);
    }
    answers[side][i] = hit.got;
    if (++done % 20 === 0) console.log(`${done}/${jobs.length} answered`);
  });

  const r = score(cases, answers);
  const chars = (d) => Object.values(d).reduce((n, v) => n + v.length, 0);
  const md = report(r, { model, old: oldRef, new: newRef, oldChars: chars(desc.old), newChars: chars(desc.new) });
  fs.writeFileSync(path.join(work, 'report.md'), md);
  fs.writeFileSync(path.join(work, 'results.json'), `${JSON.stringify({ model, oldRef, newRef, ...r }, null, 2)}\n`);
  console.log(md.split('\n').slice(0, 8).join('\n'));
  console.log(`\nreport: ${path.join(work, 'report.md')}`);
  process.exit(r.failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'selftest') selftest();
  else await real(process.argv.slice(2));
}
