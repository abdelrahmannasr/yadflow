// `yad guide` and the agent rules (E157). The rules each test pins:
//   - every command `bin/yad.mjs` knows has a class in the rules, so a new command cannot arrive without one;
//   - an approval, a gate reopen and a gate comment are the person's; a push to the default branch is asked
//     every time; a dial, the mode and the kill switch only when asked;
//   - the brief comes from the lifecycle default: what the step is for, mandatory or skippable (by the
//     epic's route), who does it (the epic's recorded driver first), and a gate is always a person's;
//   - a review gate hands the approval to the person, with a platform or without one, and names the command
//     that confirms it; the agent never picks an epic for the person;
//   - with no Product, the answer is how to start one, and the rules ride every answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The #280 guard (cli/test.mjs): printed lines go to stderr while the runner owns stdout.
if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';
process.env.YAD_PLATFORM_LOGIN = '0';
process.env.YAD_PLATFORM_READ = '0';
process.env.YAD_CAPTURE = '0';
for (const k of Object.keys(process.env)) if (/^GIT_(AUTHOR|COMMITTER)_/.test(k)) delete process.env[k];

const { buildGuide, stepFacts, playbook, tok } = await import('./guide.mjs');
const { COMMAND_CLASS, CLASSES, ASK, RULES, HUMAN_ONLY_ACTS, NEVER, classify, askFor } = await import('./agent-rules.mjs');
const { DEFAULT_LIFECYCLE } = await import('./lifecycle.mjs');
const { runEpicNew } = await import('./epic.mjs');
const { gateOpen } = await import('./gate.mjs');

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const YAD = path.join(ROOT, 'bin', 'yad.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yad-guide-'));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };
const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

async function product({ platform = 'github', solo = false, epics = ['pay'], verified = true } = {}) {
  const T = tmp();
  git(T, ['init', '-q', '-b', 'main']);
  git(T, ['config', 'user.name', 'Alice Smith']);
  git(T, ['config', 'user.email', 'alice@work.com']);
  git(T, ['config', 'commit.gpgsign', 'false']);
  git(T, ['commit', '-q', '--allow-empty', '-m', 'chore: start']);
  put(path.join(T, '.sdlc/product.json'), { platform, git_url: 'git@github.com:acme/product.git', default_branch: 'main', ...(solo ? { solo: true } : {}), ...(platform && verified ? { ledger: 'verified' } : {}) });
  for (const slug of epics) await runEpicNew(T, { slug, today: '2026-10-20' });
  return T;
}
const statePath = (T, id) => path.join(T, 'epics', id, '.sdlc', 'state.json');
const readState = (T, id) => JSON.parse(fs.readFileSync(statePath(T, id), 'utf8'));
// Walk the chain to one step: every step before it done, it in `status`.
function moveTo(T, id, stepId, status = 'in_progress') {
  const st = readState(T, id);
  const at = st.steps.findIndex((s) => s.id === stepId);
  assert.ok(at >= 0, `${stepId} is on the chain`);
  st.steps.forEach((s, i) => { if (i < at) s.status = 'done'; if (i === at) s.status = status; });
  st.currentStep = stepId;
  put(statePath(T, id), st);
}

// ---- the rules ----------------------------------------------------------------------------------------

test('every command bin/yad.mjs knows has a class, and every class is one the rules define', () => {
  const src = fs.readFileSync(YAD, 'utf8');
  const sw = src.slice(src.indexOf('switch (cmd) {'));
  const cmds = [...new Set([...sw.matchAll(/^\s{4}case '([a-z-]+)':/gm)].map((m) => m[1]))];
  assert.ok(cmds.length > 50, `found ${cmds.length} commands`);
  const actions = src.slice(src.indexOf('const ACTIONS = {'), src.indexOf('};', src.indexOf('const ACTIONS = {')));
  const known = Object.fromEntries([...actions.matchAll(/^\s+'?([a-z-]+)'?: \{ known: \[([^\]]*)\]/gm)].map((m) => [m[1], [...m[2].matchAll(/'([a-z-]+)'/g)].map((x) => x[1])]));
  const missing = [];
  for (const cmd of cmds) {
    if (known[cmd]) { for (const action of known[cmd]) if (!classify([cmd, action])) missing.push(`${cmd} ${action}`); }
    else if (!classify([cmd])) missing.push(cmd);
  }
  assert.deepEqual(missing, [], 'add these to COMMAND_CLASS in cli/agent-rules.mjs');
  for (const [k, v] of Object.entries(COMMAND_CLASS)) {
    assert.ok(CLASSES.includes(v.class), `${k}: ${v.class}`);
    for (const f of Object.values(v.flags || {})) assert.ok(CLASSES.includes(f), `${k}: ${f}`);
  }
  assert.deepEqual(Object.keys(ASK), CLASSES);
});

test('the classes the person decided: approvals are theirs, a default-branch push is asked every time, dials only on request', () => {
  for (const a of ['approve', 'advance', 'reopen', 'comment']) assert.equal(classify(['gate', a]), 'human-only', `gate ${a}`);
  assert.equal(askFor('human-only'), 'person-runs');
  for (const [w, f] of [[['update'], ['push']], [['gate', 'repair'], ['push']], [['checkpoint'], ['push']], [['tidy', 'up'], ['push']], [['repo', 'refresh'], ['push']]]) {
    assert.equal(classify(w, f), 'default-push', w.join(' '));
    assert.equal(classify(w), 'local-write', `${w.join(' ')} without --push`);
  }
  assert.equal(askFor('default-push'), 'each-time');
  assert.equal(classify(['dial']), 'read');
  assert.equal(classify(['dial', 'open-pr'], ['to']), 'on-request');
  for (const c of ['kill', 'unkill']) assert.equal(classify([c]), 'on-request');
  assert.equal(classify(['mode']), 'read', 'yad mode alone reads it');
  for (const m of ['solo', 'team']) assert.equal(classify(['mode', m]), 'on-request');
  // A skip, a deferral or clearing a blocker is a decision about the work: the person's.
  for (const c of ['skip', 'unskip', 'defer', 'undefer', 'unblock']) assert.equal(classify([c]), 'on-request', c);
  assert.equal(classify(['check'], ['fix', 'push']), 'default-push', 'check --fix --push is update --push');
  assert.equal(askFor('on-request'), 'only-when-asked');
  for (const w of [['gate', 'open'], ['gate', 'sync'], ['member', 'add']]) assert.equal(askFor(classify(w)), 'never', w.join(' '));
  // A task PR/MR follows `yad dial open-pr` (#356): asked first unless the dial is `auto`.
  for (const w of [['open-pr'], ['ship']]) assert.equal(classify(w), 'task-pr', w.join(' '));
  assert.equal(askFor('task-pr'), 'per-dial');
  assert.equal(classify(['docs', 'deploy']), 'local-write', 'it builds here; CI publishes on a push');
  assert.equal(classify(['report']), 'public-post');
  assert.equal(askFor('public-post'), 'each-time');
  assert.equal(classify(['check']), 'read');
  assert.equal(classify(['check'], ['fix']), 'local-write');
  assert.equal(classify(['gate', 'ci'], ['merged']), 'ci-only');
  assert.equal(classify(['roster']), 'removed');
  assert.equal(classify(['frobnicate']), null);
  assert.equal(askFor(null), 'each-time', 'an unknown command is asked about');
  // The acts that are not commands, and what is never done.
  assert.deepEqual(HUMAN_ONLY_ACTS.map((a) => a.id), ['approve-merge', 'login', 'secrets', 'signing-key', 'platform-settings']);
  assert.ok(NEVER.some((n) => n.id === 'force-push'));
  assert.ok(RULES.some((r) => r.id === 'report'));
});

test('every command that pushes with --push says so: its --push is asked every time', () => {
  // Each `case` of bin/yad.mjs's dispatch that hands `o.push` on must class --push as default-push.
  const src = fs.readFileSync(YAD, 'utf8');
  const sw = src.slice(src.indexOf('switch (cmd) {'));
  const blocks = sw.split(/\n(?=\s{4}case ')/);
  const pushers = [];
  // `o.push` read directly, or `push` taken out of `o` by destructuring.
  const readsPush = (b) => /\bo\.push\b/.test(b) || /\{[^}]*\bpush\b[^}]*\}\s*=\s*o\b/.test(b);
  // `gate ci` is CI's own, and pushes there by design.
  const ok = (cls) => cls === 'default-push' || cls === 'human-only' || cls === 'ci-only';
  for (const b of blocks) {
    if (!readsPush(b)) continue;
    const cmds = [...b.matchAll(/^\s{4}case '([a-z-]+)':/gm)].map((m) => m[1]);
    for (const cmd of cmds) {
      // The actions whose own line hands `push` on (`action === 'repair'`), else the command as a whole.
      const lines = b.split('\n').filter((l) => /\bpush\b/.test(l));
      const actions = [...new Set(lines.flatMap((l) => [...l.matchAll(/action === '([a-z-]+)'/g)].map((m) => m[1])))];
      pushers.push(...(actions.length ? actions.map((x) => [cmd, x]) : [[cmd]]));
    }
  }
  assert.ok(pushers.length >= 6, pushers.map((w) => w.join(' ')).join(', '));
  for (const words of pushers) {
    // A command whose action is a variable (`yad repo <action>`): one of its actions must class --push.
    const keys = words.length === 1 && !COMMAND_CLASS[words[0]] ? Object.keys(COMMAND_CLASS).filter((k) => k.startsWith(`${words[0]} `)) : null;
    if (keys) assert.ok(keys.some((k) => ok(classify(k.split(' '), ['push']))), `${words[0]}: no action classes --push`);
    else assert.ok(ok(classify(words, ['push'])), `${words.join(' ')} --push is ${classify(words, ['push'])}: it must be default-push`);
  }
});

// ---- the brief ----------------------------------------------------------------------------------------

test('the lifecycle facts: an author step, its gate, a lane step, and a sentinel', () => {
  const epic = stepFacts('epic');
  assert.equal(epic.description, DEFAULT_LIFECYCLE.steps.find((s) => s.id === 'epic').description);
  assert.equal(epic.driver, 'pair');
  assert.equal(epic.part, 'Shape');
  const gate = stepFacts('epic-review');
  assert.equal(gate.gate, true);
  assert.equal(gate.reviews, 'epic');
  assert.equal(gate.driver, 'human');
  assert.equal(gate.advance, 'human');
  assert.match(gate.description, /A person reviews the epic/);
  assert.equal(stepFacts('implement').driver, 'agent');
  assert.equal(stepFacts('engineer-review').driver, 'human');
  assert.equal(stepFacts('ready-for-build'), null);
  assert.equal(stepFacts('nope-review'), null);
});

test('an author step: its brief, mandatory, the epic\'s recorded driver, the bound skill, recommendations, and the agent\'s check', async () => {
  const T = await product();
  try {
    const g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.situation.stage, 'in-epic');
    assert.equal(g.situation.ledger, 'verified');
    assert.equal(g.step.id, 'epic');
    assert.equal(g.step.actionKind, 'author');
    assert.equal(g.step.brief, stepFacts('epic').description);
    assert.equal(g.step.mandatory, true);
    assert.equal(g.step.skip, null);
    assert.equal(g.step.driver, 'pair');
    assert.deepEqual(g.step.skills.bound, ['yad-epic']);
    assert.ok(g.step.skills.recommended.some((r) => r.skill === 'bmad-prd' && r.bind.startsWith('yad skill bind epic')));
    assert.deepEqual(g.agent.map((a) => a.skill ?? a.run), ['yad next EP-pay --check epic', 'yad-epic']);
    assert.equal(g.agent[0].class, 'read');
    assert.equal(g.person[0].act, 'answer');
    assert.equal(g.person[0].verify, null);
    assert.doesNotMatch(g.then, /verify/, 'no verify command to name');
    assert.deepEqual(g.rules, RULES);
    // An epic that records another driver is told as it records it.
    const st = readState(T, 'EP-pay');
    st.steps.find((s) => s.id === 'epic').driver = 'human';
    put(statePath(T, 'EP-pay'), st);
    assert.equal(buildGuide(T, { epic: 'EP-pay' }).step.driver, 'human');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('an optional step on the epic\'s route can be skipped, and the skip is the person\'s decision', async () => {
  const T = await product();
  try {
    moveTo(T, 'EP-pay', 'ui-design');
    const g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.step.id, 'ui-design');
    assert.equal(g.step.mandatory, false);
    assert.deepEqual(g.step.skip, { command: 'yad skip EP-pay ui-design --reason "<why>"', decidedBy: 'human' });
    // At its review the step is already written: `yad skip` would refuse, so no skip is offered.
    moveTo(T, 'EP-pay', 'ui-design-review', 'todo');
    const atGate = buildGuide(T, { epic: 'EP-pay' }).step;
    assert.equal(atGate.id, 'ui-design-review');
    assert.equal(atGate.skip, null);
    moveTo(T, 'EP-pay', 'architecture');
    assert.equal(buildGuide(T, { epic: 'EP-pay' }).step.mandatory, true);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a review gate on a verified Product: the agent opens it once, and the person approves and merges', async () => {
  const T = await product();
  try {
    moveTo(T, 'EP-pay', 'epic-review', 'todo');
    // On a verified Product the PR/MR is recorded only at the merge, so the review stays `review-open`
    // while it is open: the person's hand-off is given with it.
    const g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.situation.ledger, 'verified');
    assert.equal(g.step.actionKind, 'review-open');
    assert.equal(g.step.name, 'Epic review');
    assert.equal(g.step.driver, 'human');
    assert.equal(g.step.advance, 'human');
    assert.deepEqual(g.agent.map((a) => [a.run, a.class, a.ask]), [['yad gate open EP-pay epic.md', 'open-pr', 'never']]);
    assert.match(g.agent[0].why, /do not open another/);
    assert.equal(g.person[0].act, 'approve-merge');
    assert.match(g.person[0].steps[0], /^Once the agent has opened it, open the review pull request for epic\.md on GitHub/);
    assert.ok(g.person[0].steps.some((x) => /CI writes the approval into the ledger at the merge/.test(x)));
    assert.equal(g.person[0].verify, 'yad gate sync EP-pay epic.md');
    assert.match(g.then, /never go on from their word alone/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a review gate with a platform and a local ledger: once the PR/MR is recorded, the person approves and merges', async () => {
  const T = await product({ verified: false });
  try {
    moveTo(T, 'EP-pay', 'epic-review', 'in_review');
    put(path.join(T, 'epics/EP-pay/.sdlc/product-prs.json'), [{ artifact: 'epic.md', number: 7, url: 'https://github.com/acme/product/pull/7' }]);
    const g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.situation.ledger, 'local');
    assert.equal(g.step.actionKind, 'review-sync');
    assert.deepEqual(g.agent.map((a) => [a.run, a.class]), [['yad gate sync EP-pay epic.md', 'open-pr']]);
    assert.match(g.person[0].steps[0], /^Open the review pull request #7 for epic\.md on GitHub/);
    assert.deepEqual(g.person[0].commands, []);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a review gate with no platform: the agent marks it open, then the person approves and advances as themselves', async () => {
  const T = await product({ platform: null });
  try {
    moveTo(T, 'EP-pay', 'epic-review', 'todo');
    put(path.join(T, 'epics/EP-pay/epic.md'), '---\nid: EP-pay\nstatus: draft\n---\n# Pay\n');
    let g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.situation.platform, null);
    assert.deepEqual(g.agent.map((a) => a.run), ['yad gate open EP-pay epic.md']);
    assert.deepEqual(g.person[0].commands, ['yad gate approve EP-pay epic.md --by "<your name>"', 'yad gate advance EP-pay epic.md']);
    // The real `yad gate open`, with no platform, marks the review open here; the agent has nothing left to run.
    await gateOpen(T, { epic: 'EP-pay', artifact: 'epic.md', today: '2026-10-27' });
    g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.step.status, 'in_review');
    assert.deepEqual(g.agent, []);
    assert.deepEqual(g.person[0].commands, ['yad gate approve EP-pay epic.md --by "<your name>"', 'yad gate advance EP-pay epic.md']);
    for (const cmd of g.person[0].commands) assert.equal(classify(cmd.split(' ').slice(1, 3)), 'human-only');
    assert.equal(g.person[0].verify, 'yad guide EP-pay --json');
    // Solo: nothing to approve, only the advance.
    const settings = path.join(T, '.sdlc/product.json');
    put(settings, { ...JSON.parse(fs.readFileSync(settings, 'utf8')), solo: true });
    assert.deepEqual(buildGuide(T, { epic: 'EP-pay' }).person[0].commands, ['yad gate advance EP-pay epic.md']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a word from the ledger that is not a plain path never reaches a command line', async () => {
  const T = await product({ platform: null });
  try {
    moveTo(T, 'EP-pay', 'epic-review', 'todo');
    const st = readState(T, 'EP-pay');
    st.steps.find((s) => s.id === 'epic-review').artifact = 'epic.md; rm -rf ~';
    put(statePath(T, 'EP-pay'), st);
    const g = buildGuide(T, { epic: 'EP-pay' });
    const lines = [...g.agent.map((a) => a.run ?? ''), ...g.person.flatMap((p) => p.commands)];
    assert.ok(lines.length > 0);
    for (const l of lines) assert.doesNotMatch(l, /rm -rf/, l);
    assert.ok(lines.some((l) => l.includes('<artifact>')));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a blocked step: the agent clears it only when the person asks; on a verified Product it cannot', () => {
  const p = playbook({ epicId: 'EP-pay', kind: 'blocked', step: 'architecture', record: { reason: 'waiting on\u001b[31m legal' } }, {});
  assert.equal(p.agent[0].run, 'yad unblock EP-pay architecture');
  assert.equal(p.agent[0].ask, 'only-when-asked');
  const v = playbook({ epicId: 'EP-pay', kind: 'blocked', step: 'architecture', record: null }, { verified: true, platform: 'github', ciOwns: true });
  assert.deepEqual(v.agent, []);
  assert.match(v.person[0].steps[1], /yad unblock` refuses/);
  assert.equal(p.person[0].steps[0], 'Resolve the blocker: waiting on [31m legal, then tell the agent to clear it.', 'a control character from the ledger is cleaned');
});

test('the agent never picks an epic: several open epics are listed, one is chosen by name, an unknown name is said', async () => {
  const T = await product({ epics: ['pay', 'ship'] });
  try {
    const g = buildGuide(T);
    assert.equal(g.situation.stage, 'choose-epic');
    assert.deepEqual(g.epics.map((e) => e.epic).sort(), ['EP-pay', 'EP-ship']);
    assert.equal(g.step, null);
    assert.equal(g.person[0].act, 'choose');
    assert.equal(buildGuide(T, { epic: 'EP-ship' }).step.epic, 'EP-ship');
    const bad = buildGuide(T, { epic: 'EP-none' });
    assert.equal(bad.ok, false, 'a refusal, so an agent that checks ok does not read success');
    assert.equal(bad.situation.stage, 'unknown-epic');
    assert.match(bad.error, /no epic EP-none/);
    assert.deepEqual(bad.epics.map((e) => e.epic).sort(), ['EP-pay', 'EP-ship']);
    assert.equal(bad.step, null);
    const cli = spawnSync(process.execPath, [YAD, 'guide', 'EP-none', '--json', '--dir', T], { encoding: 'utf8' });
    assert.equal(cli.status, 1);
    const out = JSON.parse(cli.stdout);
    assert.equal(out.ok, false);
    assert.match(out.error, /no epic EP-none/);
    assert.ok('code' in out && 'hint' in out);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
  // One open epic is the one.
  const one = await product();
  try { assert.equal(buildGuide(one).step.epic, 'EP-pay'); } finally { fs.rmSync(one, { recursive: true, force: true }); }
});

test('a Product with no epic yet: the first epic, and the Foundation offered as optional', async () => {
  const T = await product({ epics: [] });
  try {
    const g = buildGuide(T);
    assert.equal(g.situation.stage, 'ready');
    assert.deepEqual(g.agent.map((a) => a.skill ?? a.run), ['yad foundation new', 'yad-epic']);
    assert.equal(g.agent[0].optional, true);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('Build: the step is the Build loop, with its brief', async () => {
  const T = await product();
  try {
    const st = readState(T, 'EP-pay');
    for (const s of st.steps) s.status = 'done';
    st.currentStep = 'ready-for-build';
    put(statePath(T, 'EP-pay'), st);
    const g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.step.actionKind, 'build');
    assert.equal(g.step.name, 'Build');
    assert.equal(g.step.brief, DEFAULT_LIFECYCLE.phases.find((p) => p.id === 'build').description);
    assert.equal(g.agent[0].skill, 'yad-run');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a ledger that does not load: the answer is yad doctor, never another epic', async () => {
  const T = await product();
  try {
    put(statePath(T, 'EP-pay'), '{ not json');
    const g = buildGuide(T);
    assert.equal(g.situation.stage, 'broken');
    assert.deepEqual(g.problems.map((p) => p.epic), ['EP-pay']);
    assert.deepEqual(g.agent.map((a) => a.run), ['yad doctor']);
    assert.ok(!g.agent.some((a) => a.skill === 'yad-epic'));
    const named = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(named.situation.stage, 'broken');
    put(statePath(T, 'EP-pay'), 'null');
    assert.equal(buildGuide(T, { epic: 'EP-pay' }).situation.stage, 'broken');
    put(statePath(T, 'EP-pay'), { epicId: 'EP-pay', steps: 'nope' });
    assert.equal(buildGuide(T, { epic: 'EP-pay' }).situation.stage, 'broken');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('the Foundation is the Product level: neither mandatory nor skippable', async () => {
  const T = await product({ epics: [] });
  try {
    const { runFoundationNew } = await import('./epic.mjs');
    await runFoundationNew(T, { today: '2026-10-27' });
    const g = buildGuide(T);
    assert.equal(g.step.id, 'foundation');
    assert.equal(g.step.mandatory, null);
    assert.equal(g.step.skip, null);
    assert.equal(g.step.brief, stepFacts('foundation').description);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a Product one folder away is named, so the agent never starts a second one', () => {
  const g = buildGuide(null, { productElsewhere: '../product' });
  assert.equal(g.situation.stage, 'product-elsewhere');
  assert.equal(g.situation.product, '../product');
  assert.deepEqual(g.agent.map((a) => a.run), ['yad guide --dir ../product --json']);
  assert.ok(!JSON.stringify(g).includes('yadflow@4 new'));
});

test('the test-cases track beside Build is given to the agent too', () => {
  const p = playbook({ epicId: 'EP-pay', kind: 'build', step: 'ready-for-build', parallel: { step: 'test-cases', skill: 'yad-test-cases', artifact: 'test-cases.md' } }, {});
  assert.deepEqual(p.agent.map((a) => [a.skill, a.class, a.ask]), [['yad-run', 'task-pr', 'per-dial'], ['yad-test-cases', 'local-write', 'never']]);
});

test('a review re-opened behind finished work: the agent opens it once, and the person approves it too (no platform)', async () => {
  const T = await product({ platform: null });
  try {
    const st = readState(T, 'EP-pay');
    const idx = (id) => st.steps.findIndex((s) => s.id === id);
    st.steps.forEach((s, i) => { if (i < idx('stories-review')) s.status = 'done'; });
    st.steps[idx('ui-design-review')].status = 'todo';
    st.steps[idx('stories-review')].status = 'in_review';
    st.currentStep = 'stories-review';
    put(statePath(T, 'EP-pay'), st);
    let g = buildGuide(T, { epic: 'EP-pay' });
    assert.deepEqual(g.agent.map((a) => a.run), ['yad gate open EP-pay ui-design.md']);
    const approves = (gg) => gg.person.flatMap((p) => p.commands).filter((c) => c.startsWith('yad gate approve'));
    assert.deepEqual(approves(g), ['yad gate approve EP-pay stories/ --by "<your name>"', 'yad gate approve EP-pay ui-design.md --by "<your name>"']);
    // Once marked open, nothing is left for the agent; the person still approves and advances it.
    st.steps[idx('ui-design-review')].status = 'in_review';
    put(statePath(T, 'EP-pay'), st);
    g = buildGuide(T, { epic: 'EP-pay' });
    assert.deepEqual(g.agent, []);
    assert.ok(g.person.flatMap((p) => p.commands).includes('yad gate advance EP-pay ui-design.md'));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('on a verified Product whose ledger CI owns, a skip is said to be refused, not offered', async () => {
  const T = await product();
  const R = tmp();
  try {
    git(R, ['init', '-q', '--bare', '-b', 'main']);
    git(T, ['remote', 'add', 'origin', R]);
    git(T, ['add', '-A']);
    git(T, ['commit', '-q', '-m', 'docs(ep-pay): seed']);
    git(T, ['push', '-q', '-u', 'origin', 'main']);
    moveTo(T, 'EP-pay', 'ui-design');
    const g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.step.mandatory, false);
    assert.equal(g.step.skip.command, null);
    assert.match(g.step.skip.note, /only CI writes it/);
    // A blocked step there is not the agent's to clear either.
    const st = readState(T, 'EP-pay');
    st.steps.find((s) => s.id === 'ui-design').status = 'blocked';
    st.steps.find((s) => s.id === 'ui-design').record = { reason: 'legal', by: 'alice', date: '2026-10-27' };
    put(statePath(T, 'EP-pay'), st);
    assert.deepEqual(buildGuide(T, { epic: 'EP-pay' }).agent, []);
  } finally { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(R, { recursive: true, force: true }); }
});

test('a ledger word goes into a command only as a plain path or id', () => {
  assert.equal(tok('payment_service', '<repo>'), 'payment_service');
  assert.equal(tok('stories/', '<a>'), 'stories/');
  assert.equal(tok('foundation/', '<a>'), 'foundation/');
  for (const bad of ['a b', 'x;y', '../up', '-rf', '', null, '$(id)']) assert.equal(tok(bad, '<a>'), '<a>', String(bad));
  const g = buildGuide(null, { productElsewhere: '../my product' });
  assert.equal(g.agent[0].run, 'yad guide --dir "../my product" --json');
});

// ---- the command ----------------------------------------------------------------------------------------

test('yad guide --json: with no Product it says how to start one, and carries the rules; a bad id is refused', () => {
  const T = tmp();
  try {
    const r = spawnSync(process.execPath, [YAD, 'guide', '--json'], { cwd: T, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.command, 'guide');
    assert.equal(out.ok, true);
    assert.equal(out.situation.stage, 'no-product');
    assert.deepEqual(out.rules, RULES);
    assert.ok(out.person[0].commands.includes('npx -y yadflow@4 new <name>'));
    assert.equal(out.stage, undefined, 'the stage is in situation only');
    const bad = spawnSync(process.execPath, [YAD, 'guide', 'not-an-epic', '--json'], { cwd: T, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(JSON.parse(bad.stdout).error, /invalid epic id/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('yad guide prints the brief a person would read', async () => {
  const T = await product();
  try {
    moveTo(T, 'EP-pay', 'ui-design');
    const r = spawnSync(process.execPath, [YAD, 'guide', 'EP-pay', '--dir', T], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(r.status, 0, r.stderr);
    const said = `${r.stdout}${r.stderr}`;
    assert.ok(said.includes(stepFacts('ui-design').description), said);
    assert.match(said, /can be skipped — the person decides: yad skip EP-pay ui-design/);
    assert.match(said, /who: the agent drafts, the person decides/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
