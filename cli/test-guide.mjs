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

const { buildGuide, stepFacts, playbook, tok, agentRun } = await import('./guide.mjs');
const COMMAND_CLASS_MODULE = await import('./agent-rules.mjs');
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
  assert.equal(classify(['commit']), 'local-write');
  assert.equal(classify(['commit'], ['manual']), 'human-only', 'the door past the ledger hook is the person\'s');
  assert.equal(classify(['member', 'remove']), 'local-write', 'your own member file');
  assert.equal(classify(['member', 'remove'], ['reason']), 'on-request', 'someone else\'s');
  for (const w of [['commit'], ['ship'], ['assign'], ['unassign']]) assert.equal(classify(w, ['force']), 'on-request', `${w[0]} --force`);
  // A run's verdict is the person's judgement; the skills record it once given (yad-spec, yad-implement,
  // yad-engineer-review), so the agent may run it, never decide it.
  assert.equal(classify(['build', 'trust'], ['uid']), 'on-request');
  // Setting a Product up chooses its mode (a run with no answers takes solo): the person's, until E159.
  for (const c of ['setup', 'new', 'init']) for (const f of [[], ['solo'], ['team']]) assert.equal(classify([c], f), 'on-request', `${c} ${f.join(' ')}`);
  assert.equal(classify(['join']), 'open-pr', 'a joined Product\'s mode is already set');
  for (const w of [['skill', 'bind'], ['skill', 'unbind'], ['toolbox', 'add'], ['toolbox', 'remove']]) assert.equal(classify(w), 'on-request', w.join(' '));
  for (const w of [['commit'], ['ship']]) assert.equal(classify(w, ['ai']), 'on-request', `${w[0]} --ai`);
  for (const w of [['check'], ['update'], ['checkpoint'], ['gate', 'repair'], ['tidy', 'up'], ['repo', 'refresh']]) assert.equal(classify(w, ['allow-branch']), 'on-request', `${w.join(' ')} --allow-branch`);
  // The person asking for a command does not cover its push: still asked every time.
  assert.equal(askFor(classify(['update'], ['overwrite-local', 'push'])), 'each-time');
  assert.equal(askFor(classify(['checkpoint'], ['retro-ship', 'push'])), 'each-time');
  assert.equal(askFor(classify(['check'], ['fix', 'overwrite-local', 'push'])), 'each-time');
  for (const c of ['check', 'update']) assert.equal(classify([c], ['overwrite-local']), 'on-request', `${c} --overwrite-local`);
  assert.equal(classify(['build', 'ship'], ['merge-commit', 'approver']), 'on-request', 'a merge no platform confirmed');
  assert.equal(classify(['checkpoint'], ['retro-ship']), 'on-request');
  assert.equal(classify(['review', 'reconcile']), 'local-write');
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

test('a command named alone runs its default action, and is classed as that action', () => {
  const { DEFAULT_ACTION } = COMMAND_CLASS_MODULE;
  const src = fs.readFileSync(YAD, 'utf8');
  const actions = src.slice(src.indexOf('const ACTIONS = {'), src.indexOf('};', src.indexOf('const ACTIONS = {')));
  const defaults = Object.fromEntries([...actions.matchAll(/^\s+'?([a-z-]+)'?: \{ known: \[[^\]]*\], default: '([a-z-]+)' \}/gm)].map((m) => [m[1], m[2]]));
  assert.equal(Object.keys(defaults).length, (actions.match(/default:/g) || []).length, 'every default in ACTIONS was read');
  assert.deepEqual(DEFAULT_ACTION, defaults, 'DEFAULT_ACTION in cli/agent-rules.mjs follows ACTIONS in bin/yad.mjs');
  for (const [cmd, action] of Object.entries(defaults)) assert.equal(classify([cmd]), classify([cmd, action]), cmd);
  assert.equal(classify(['member']), 'read');
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
    assert.ok(g.step.skills.recommended.some((r) => r.skill === 'bmad-prd' && r.bind.startsWith('yad skill bind epic') && r.decidedBy === 'human'));
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
    assert.equal(g.step.skip.command, 'yad skip EP-pay ui-design --reason "<why>"');
    assert.equal(g.step.skip.decidedBy, 'human');
    // A verified Product with no origin to read: offered, with the same caution `yad skip` prints.
    assert.match(g.step.skip.note, /origin could not be read/);
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

test('a Build step yad-run halted waits for the person, with the reason the build-state records', async () => {
  const T = await product();
  try {
    const st = readState(T, 'EP-pay');
    for (const s of st.steps) s.status = 'done';
    st.currentStep = 'ready-for-build';
    put(statePath(T, 'EP-pay'), st);
    put(path.join(T, 'epics/EP-pay/.sdlc/build-state/EP-pay-S01.json'), { story: 'EP-pay-S01', repos: {
      api: { currentStep: 'implement', steps: [{ id: 'spec', status: 'done' }, { id: 'tasks', status: 'done' }, { id: 'implement', status: 'blocked', record: { reason: 'contract touch' } }, { id: 'checks', status: 'todo' }] },
      web: { currentStep: 'spec', steps: [{ id: 'spec', status: 'in_progress' }] },
    } });
    const g = buildGuide(T, { epic: 'EP-pay' });
    const halts = g.person.filter((x) => x.act === 'unblock');
    assert.equal(halts.length, 1);
    assert.equal(halts[0].steps[0], 'Resolve the halt on EP-pay-S01 in api (implement): contract touch, then tell the agent to move it on.');
    assert.ok(RULES.some((r) => r.id === 'build-halts'));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('a flag that needs the person to have asked is kept under a push', () => {
  const { reaches } = COMMAND_CLASS_MODULE;
  assert.deepEqual(reaches(['update'], ['push', 'overwrite-local']).sort(), ['default-push', 'local-write', 'on-request']);
  const p = playbook({ epicId: 'EP-pay', kind: 'unknown-kind' }, {});
  assert.equal(p.agent[0].onRequest, undefined);
  const both = agentRun('yad update --push --overwrite-local', 'x');
  assert.deepEqual([both.class, both.ask, both.onRequest], ['default-push', 'each-time', true]);
  assert.equal(agentRun('yad update --push', 'x').onRequest, undefined);
  assert.deepEqual(reaches(['gate', 'ci'], ['merged']), ['ci-only'], 'never raised, as in classify');
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
    const said = spawnSync(process.execPath, [YAD, 'guide', 'EP-pay', '--dir', T], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    const text = `${said.stdout}${said.stderr}`;
    assert.match(text, /optional, but it cannot be skipped here: on this verified Product/);
    assert.doesNotMatch(text, /null/);
    // A blocked step there is not the agent's to clear either.
    const st = readState(T, 'EP-pay');
    st.steps.find((s) => s.id === 'ui-design').status = 'blocked';
    st.steps.find((s) => s.id === 'ui-design').record = { reason: 'legal', by: 'alice', date: '2026-10-27' };
    put(statePath(T, 'EP-pay'), st);
    assert.deepEqual(buildGuide(T, { epic: 'EP-pay' }).agent, []);
  } finally { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(R, { recursive: true, force: true }); }
});

test('the review branch is named as yad gate open names it', () => {
  for (const [art, branch] of [['stories/EP-pay-S01.md', 'review/EP-pay/stories-S01'], ['stories/', 'review/EP-pay/stories'], ['epic.md', 'review/EP-pay/epic']]) {
    const p = playbook({ epicId: 'EP-pay', kind: 'review-open', step: 'x-review', status: 'todo', artifact: art }, { platform: 'github' });
    assert.ok(p.agent[0].why.includes(`\`${branch}\``), `${art}: ${p.agent[0].why}`);
  }
});

test('on a verified Product whose epic is not on origin as fetched, the skip is offered with yad skip\'s fetch caution', async () => {
  const T = await product();
  const R = tmp();
  try {
    git(R, ['init', '-q', '--bare', '-b', 'main']);
    git(T, ['remote', 'add', 'origin', R]);
    git(T, ['push', '-q', '-u', 'origin', 'main']);
    moveTo(T, 'EP-pay', 'ui-design');
    const g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.step.skip.command, 'yad skip EP-pay ui-design --reason "<why>"');
    assert.match(g.step.skip.note, /origin as last fetched: run `git fetch origin` first/);
    const said = spawnSync(process.execPath, [YAD, 'guide', 'EP-pay', '--dir', T], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.match(`${said.stdout}${said.stderr}`, /can be skipped — the person decides: yad skip EP-pay ui-design --reason "<why>" \(checked against origin as last fetched/);
    // An unblock there carries the same caution; with no origin at all, the unreadable one.
    const st = readState(T, 'EP-pay');
    Object.assign(st.steps.find((s) => s.id === 'ui-design'), { status: 'blocked', record: { reason: 'legal', by: 'alice', date: '2026-10-27' } });
    put(statePath(T, 'EP-pay'), st);
    assert.match(buildGuide(T, { epic: 'EP-pay' }).agent[0].why, /origin as last fetched/);
    git(T, ['remote', 'remove', 'origin']);
    assert.match(buildGuide(T, { epic: 'EP-pay' }).agent[0].why, /origin could not be read/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(R, { recursive: true, force: true }); }
});

test('a ledger word goes into a command only as a plain path or id', () => {
  assert.equal(tok('payment_service', '<repo>'), 'payment_service');
  assert.equal(tok('stories/', '<a>'), 'stories/');
  assert.equal(tok('foundation/', '<a>'), 'foundation/');
  for (const bad of ['a b', 'x;y', '../up', '-rf', '', null, '$(id)']) assert.equal(tok(bad, '<a>'), '<a>', String(bad));
  const g = buildGuide(null, { productElsewhere: '../my product' });
  assert.equal(g.agent[0].run, "yad guide --dir '../my product' --json");
  assert.equal(buildGuide(null, { productElsewhere: "../it's!" }).agent[0].run, "yad guide --dir '../it'\\''s!' --json");
});

test('a blocked step re-opened behind finished work: the person resolves it, the agent clears it on request (not where CI owns the ledger)', () => {
  const a = { epicId: 'EP-pay', kind: 'review-open', step: 'stories-review', status: 'in_review', artifact: 'stories/',
    reopened: [{ step: 'ui-design', kind: 'blocked', status: 'blocked', record: { reason: 'waiting on design' } }] };
  const p = playbook(a, { platform: null });
  assert.ok(p.agent.some((x) => x.run === 'yad unblock EP-pay ui-design' && x.ask === 'only-when-asked'));
  assert.ok(p.person.some((x) => x.act === 'unblock' && /ui-design was re-opened behind finished work, and is blocked/.test(x.why) && /waiting on design/.test(x.steps[0])));
  const v = playbook(a, { platform: 'github', verified: true, ciOwns: true });
  assert.ok(!v.agent.some((x) => (x.run ?? '').startsWith('yad unblock')));
  assert.ok(v.person.some((x) => x.act === 'unblock' && x.steps.some((st) => /yad unblock` refuses/.test(st))));
});

test('an install behind yadflow: the update first, once — then on review, then merged and pulled', async () => {
  const { installState } = await import('./guide.mjs');
  const { VERSION } = await import('./manifest.mjs');
  const T = await product();
  const R = tmp();
  try {
    const stamp = path.join(T, '.sdlc/cli-version.json');
    put(stamp, { version: '4.0.0' });
    assert.equal(installState(T, '4.7.0').behind, true);
    assert.equal(installState(T, '4.0.0').behind, false);
    assert.equal(installState(T, '3.9.9').behind, false, 'an older yadflow here is not upkeep');
    // Pre-releases compare label by label: an older build is never told to update.
    put(stamp, { version: '4.8.0-next.3' });
    assert.equal(installState(T, '4.8.0-next.1').behind, false);
    assert.equal(installState(T, '4.8.0-next.4').behind, true);
    put(stamp, { version: '4.8.0-next.9' });
    assert.equal(installState(T, '4.8.0-next.10').behind, true);
    put(stamp, { version: '4.8.0-next.10' });
    assert.equal(installState(T, '4.8.0-next.9').behind, false);
    // No origin: how to publish is the person's call.
    put(stamp, { version: '4.0.0' });
    git(T, ['add', '-A']);
    git(T, ['commit', '-q', '-m', 'chore: stamp']);
    let g = buildGuide(T, { epic: 'EP-pay' });
    assert.equal(g.situation.install.behind, true);
    assert.deepEqual(g.upkeep.agent, []);
    assert.deepEqual(g.upkeep.person[0].commands, ['yad update']);
    // With origin and a platform: the agent runs the update as a PR/MR, without asking.
    git(R, ['init', '-q', '--bare', '-b', 'main']);
    git(T, ['remote', 'add', 'origin', R]);
    git(T, ['push', '-q', '-u', 'origin', 'main']);
    g = buildGuide(T, { epic: 'EP-pay' });
    assert.deepEqual(g.upkeep.agent.map((a) => [a.run, a.class, a.ask]), [['yad update --open-pr', 'open-pr', 'never']]);
    assert.ok(RULES.some((r) => r.id === 'update'));
    // On review (the update branch exists): nothing to run again; the person merges, the agent then fetches.
    git(T, ['branch', `chore/yad-update-v${VERSION}`]);
    g = buildGuide(T, { epic: 'EP-pay' });
    assert.deepEqual(g.upkeep.agent.map((a) => [a.run, a.class]), [['git fetch origin', 'read']]);
    assert.equal(g.upkeep.person[0].act, 'approve-merge');
    assert.deepEqual(g.situation.install.repos, [{ repo: 'product', version: '4.0.0', merged: false, blocked: 'open' }]);
    // Merged on origin, not pulled here: the agent pulls.
    git(T, ['checkout', '-q', '-b', 'tmp']);
    put(stamp, { version: VERSION });
    git(T, ['commit', '-q', '-am', 'chore(yad-update): sync']);
    git(T, ['push', '-q', 'origin', 'tmp:main']);
    git(T, ['checkout', '-q', 'main']);
    git(T, ['fetch', '-q', 'origin']);
    g = buildGuide(T, { epic: 'EP-pay' });
    assert.deepEqual(g.upkeep.agent.map((a) => a.run), ['git -C . pull --ff-only']);
    // On another branch, the pull would fail: switching is the person's call, never a loop.
    git(T, ['checkout', '-q', '-b', 'review/x']);
    g = buildGuide(T, { epic: 'EP-pay' });
    assert.deepEqual(g.upkeep.agent, []);
    assert.match(g.upkeep.person[0].steps[0], /the update merged on origin, but this clone is on 'review\/x' — switch it to 'main' and pull/);
    git(T, ['checkout', '-q', 'main']);
    git(T, ['pull', '-q', '--ff-only']);
    assert.equal(buildGuide(T, { epic: 'EP-pay' }).upkeep, null);
  } finally { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(R, { recursive: true, force: true }); }
});

test('--open-pr is all or nothing: one repo that cannot take it, and nothing is written anywhere', async () => {
  const { reconcile } = await import('./reconcile.mjs');
  const P = tmp();
  const T = path.join(P, 'product');
  const A = path.join(P, 'app');
  const RT = tmp();
  const RA = tmp();
  try {
    fs.mkdirSync(T); fs.mkdirSync(A);
    for (const [d, r] of [[T, RT], [A, RA]]) {
      git(r, ['init', '-q', '--bare', '-b', 'main']);
      git(d, ['init', '-q', '-b', 'main']);
      git(d, ['config', 'user.name', 'Alice Smith']);
      git(d, ['config', 'user.email', 'alice@work.com']);
      git(d, ['config', 'commit.gpgsign', 'false']);
      git(d, ['commit', '-q', '--allow-empty', '-m', 'chore: start']);
      git(d, ['remote', 'add', 'origin', r]);
      git(d, ['push', '-q', '-u', 'origin', 'main']);
    }
    put(path.join(T, '.sdlc/product.json'), { platform: 'github', git_url: 'git@github.com:acme/product.git', default_branch: 'main' });
    put(path.join(T, '.sdlc/repos.json'), { repos: [{ name: 'app', path: '../app', platform: 'github', default_branch: 'main' }] });
    git(T, ['add', '-A']);
    git(T, ['commit', '-q', '-m', 'chore: settings']);
    git(T, ['push', '-q']);
    git(A, ['checkout', '-q', '-b', 'feat/x']);
    const r = await reconcile(T, { fix: true, scope: 'all', openPr: true, creator: () => { throw new Error('no PR may open'); } });
    assert.equal(r.applied, 0);
    assert.deepEqual(r.commits.map((c) => [c.label, c.reason]), [['app', 'branch']]);
    assert.equal(git(T, ['status', '--porcelain']), '', 'nothing written in the Product');
    assert.equal(git(A, ['status', '--porcelain']), '', 'nothing written in the repo on a feature branch');
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    // A code repo the update has not reached keeps the upkeep alive, even with the Product current.
    const { VERSION } = await import('./manifest.mjs');
    put(path.join(T, '.sdlc/cli-version.json'), { version: VERSION });
    put(path.join(A, '.sdlc/managed.json'), { version: '4.0.0', files: {} });
    const g = buildGuide(T);
    assert.equal(g.situation.install.behind, true);
    assert.deepEqual(g.situation.install.repos.map((x) => [x.repo, x.blocked]), [['app', 'branch']]);
    assert.ok(!g.upkeep.agent.some((a) => (a.run ?? '').includes('--open-pr')), 'never a run that would be refused');
    assert.match(g.upkeep.person[0].steps[0], /^app: on 'feat\/x', not the default branch 'main'/);
  } finally { for (const d of [P, RT, RA]) fs.rmSync(d, { recursive: true, force: true }); process.exitCode = 0; }
});

test('--open-pr reaches every cloned repo: one on a feature branch stops it even with nothing of its own to update', async () => {
  const { reconcile } = await import('./reconcile.mjs');
  const { VERSION } = await import('./manifest.mjs');
  const P = tmp();
  const T = path.join(P, 'product');
  const A = path.join(P, 'app');
  const RT = tmp();
  const RA = tmp();
  try {
    fs.mkdirSync(T); fs.mkdirSync(A);
    for (const [d, r] of [[T, RT], [A, RA]]) {
      git(r, ['init', '-q', '--bare', '-b', 'main']);
      git(d, ['init', '-q', '-b', 'main']);
      git(d, ['config', 'user.name', 'Alice Smith']);
      git(d, ['config', 'user.email', 'alice@work.com']);
      git(d, ['config', 'commit.gpgsign', 'false']);
      git(d, ['commit', '-q', '--allow-empty', '-m', 'chore: start']);
      git(d, ['remote', 'add', 'origin', r]);
      git(d, ['push', '-q', '-u', 'origin', 'main']);
    }
    put(path.join(T, '.sdlc/product.json'), { platform: 'github', git_url: 'git@github.com:acme/product.git', default_branch: 'main' });
    put(path.join(T, '.sdlc/repos.json'), { repos: [{ name: 'app', path: '../app', platform: 'github', default_branch: 'main' }] });
    git(T, ['add', '-A']); git(T, ['commit', '-q', '-m', 'chore: settings']); git(T, ['push', '-q']);
    // The app's own work, on its feature branch; its managed ledger already current.
    git(A, ['checkout', '-q', '-b', 'feat/x']);
    put(path.join(A, '.sdlc/managed.json'), { version: VERSION, files: {} });
    git(A, ['add', '-A']); git(A, ['commit', '-q', '-m', 'feat: my work']);
    const r = await reconcile(T, { fix: true, scope: 'all', openPr: true, creator: () => { throw new Error('no PR may open'); } });
    assert.equal(r.applied, 0);
    assert.deepEqual(r.commits.map((c) => [c.label, c.reason]), [['app', 'branch']]);
    assert.equal(git(A, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feat/x', 'never moved off its branch');
    assert.equal(git(A, ['status', '--porcelain']), '');
    assert.equal(git(T, ['status', '--porcelain']), '');
    process.exitCode = 0;
    // The guide agrees: with the Product behind and the app on its branch, no run it would refuse.
    put(path.join(T, '.sdlc/cli-version.json'), { version: '4.0.0' });
    const g = buildGuide(T);
    assert.ok(!g.upkeep.agent.some((x) => (x.run ?? '').includes('--open-pr')));
    assert.ok(g.upkeep.person[0].steps.some((x) => /^app: on 'feat\/x'/.test(x)));
    // And the other way: the Product current but on an epic branch, the app behind.
    put(path.join(T, '.sdlc/cli-version.json'), { version: VERSION });
    git(A, ['checkout', '-q', 'main']);
    fs.rmSync(path.join(A, '.sdlc'), { recursive: true, force: true });
    git(T, ['add', '-A']); git(T, ['commit', '-q', '-m', 'chore: stamp']); git(T, ['push', '-q']);
    git(T, ['checkout', '-q', '-b', 'epic/pay']);
    const g2 = buildGuide(T);
    assert.deepEqual(g2.situation.install.repos.map((x) => x.repo), ['app'], 'an app with no ledger was never reached');
    assert.ok(!g2.upkeep.agent.some((x) => (x.run ?? '').includes('--open-pr')));
    assert.ok(g2.upkeep.person[0].steps.some((x) => /^the Product: on 'epic\/pay'/.test(x)));
  } finally { for (const d of [P, RT, RA]) fs.rmSync(d, { recursive: true, force: true }); process.exitCode = 0; }
});

test('a push that fails keeps the update in the working tree, unstaged, deletions included, and drops the branch', async () => {
  const { openUpdatePr } = await import('./update-commit.mjs');
  const T = tmp();
  try {
    git(T, ['init', '-q', '-b', 'main']);
    git(T, ['config', 'user.name', 'Alice Smith']);
    git(T, ['config', 'user.email', 'alice@work.com']);
    git(T, ['config', 'commit.gpgsign', 'false']);
    put(path.join(T, 'old.sh'), 'old\n');
    put(path.join(T, 'a.txt'), 'v1\n');
    git(T, ['add', '-A']); git(T, ['commit', '-q', '-m', 'chore: start']);
    git(T, ['remote', 'add', 'origin', path.join(T, 'no-such-remote')]);
    fs.rmSync(path.join(T, 'old.sh'));
    put(path.join(T, 'a.txt'), 'v2\n');
    const r = openUpdatePr({ root: T, paths: ['old.sh', 'a.txt'], items: [] }, { productRoot: T, defaultBranch: 'main', platform: 'github', creator: () => ({ ok: true }), version: '4.7.0', checked: true });
    assert.deepEqual([r.pushed, r.error], [false, true]);
    assert.equal(git(T, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
    assert.equal(git(T, ['branch', '--list', 'chore/yad-update-v4.7.0']), '', 'the branch is dropped, so a later run retries');
    assert.equal(fs.readFileSync(path.join(T, 'a.txt'), 'utf8'), 'v2\n');
    assert.ok(!fs.existsSync(path.join(T, 'old.sh')));
    assert.equal(git(T, ['diff', '--cached', '--name-only']), '', 'nothing staged');
    assert.deepEqual(git(T, ['diff', '--name-status']).split('\n').sort(), ['D\told.sh', 'M\ta.txt'], 'the update, unstaged');
  } finally { fs.rmSync(T, { recursive: true, force: true }); process.exitCode = 0; }
});

test('yad update --open-pr: the update on its own branch, pushed, a PR/MR opened, and the repo back on its default branch', async () => {
  const { openUpdatePr, updateBranchName, buildUpdatePrBody } = await import('./update-commit.mjs');
  const T = tmp();
  const R = tmp();
  try {
    git(R, ['init', '-q', '--bare', '-b', 'main']);
    git(T, ['init', '-q', '-b', 'main']);
    git(T, ['config', 'user.name', 'Alice Smith']);
    git(T, ['config', 'user.email', 'alice@work.com']);
    git(T, ['config', 'commit.gpgsign', 'false']);
    put(path.join(T, '.sdlc/cli-version.json'), { version: '4.0.0' });
    put(path.join(T, 'notes.txt'), 'mine\n');
    git(T, ['add', '.sdlc/cli-version.json']);
    git(T, ['commit', '-q', '-m', 'chore: start']);
    git(T, ['remote', 'add', 'origin', R]);
    git(T, ['push', '-q', '-u', 'origin', 'main']);
    put(path.join(T, '.sdlc/cli-version.json'), { version: '4.7.0' });
    const calls = [];
    const creator = (platform, opts) => { calls.push([platform, opts]); return { ok: true, url: 'https://github.com/acme/p/pull/9' }; };
    const r = openUpdatePr({ root: T, paths: ['.sdlc/cli-version.json'], items: ['product/.sdlc/cli-version.json'] }, { productRoot: T, defaultBranch: 'main', platform: 'github', creator, version: '4.7.0' });
    assert.equal(r.branch, updateBranchName('4.7.0'));
    assert.equal(r.branch, 'chore/yad-update-v4.7.0');
    assert.deepEqual([r.committed, r.pushed, r.pr, r.error], [true, true, 'https://github.com/acme/p/pull/9', false]);
    assert.equal(git(T, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main', 'back on the default branch');
    assert.match(fs.readFileSync(path.join(T, '.sdlc/cli-version.json'), 'utf8'), /4\.0\.0/, 'the default branch has the update only once the PR/MR merges');
    assert.equal(fs.readFileSync(path.join(T, 'notes.txt'), 'utf8'), 'mine\n', 'unrelated work is left alone');
    assert.match(git(R, ['log', '-1', '--format=%s', 'chore/yad-update-v4.7.0']), /^chore\(yad-update\): sync SDLC install to yadflow v4\.7\.0$/);
    assert.equal(calls.length, 1);
    const [platform, opts] = calls[0];
    assert.equal(platform, 'github');
    assert.deepEqual([opts.base, opts.head], ['main', 'chore/yad-update-v4.7.0']);
    assert.equal(opts.body, buildUpdatePrBody({ version: '4.7.0', items: ['product/.sdlc/cli-version.json'] }));
    for (const h of ['## Summary', '## Impact & Risk', 'Risk level: low', '## Checklist']) assert.ok(opts.body.includes(h), h);
    assert.ok(opts.body.indexOf('## Files') > opts.body.indexOf('## Checklist'), 'the file list comes last');
    // Run again with the branch still here: skipped, never a second branch.
    put(path.join(T, '.sdlc/cli-version.json'), { version: '4.7.0' });
    const again = openUpdatePr({ root: T, paths: ['.sdlc/cli-version.json'], items: [] }, { productRoot: T, defaultBranch: 'main', platform: 'github', creator, version: '4.7.0' });
    assert.deepEqual([again.skipped, again.reason, again.error], [true, 'open', false]);
    assert.equal(calls.length, 1);
    const { updatePrBlocker } = await import('./update-commit.mjs');
    const msg = updatePrBlocker(T, { defaultBranch: 'main', version: '4.7.0' }).message;
    assert.doesNotMatch(msg, /delete (its|the) PR|merge or delete/, 'never advise deleting an open PR/MR');
    assert.match(msg, /closed without merging, delete the branch/, 'a closed one: only its branch');
    // On origin from another clone, not here: still on review.
    git(T, ['branch', '-q', '-D', 'chore/yad-update-v4.7.0']);
    assert.equal(updatePrBlocker(T, { defaultBranch: 'main', version: '4.7.0' }).kind, 'open');
    // Local commits not on origin would ride the PR/MR: refused.
    git(T, ['checkout', '-q', '--', '.sdlc/cli-version.json']);
    git(T, ['commit', '-q', '--allow-empty', '-m', 'chore: local only']);
    assert.equal(updatePrBlocker(T, { defaultBranch: 'main', version: '4.9.0' }).kind, 'ahead');
    // Not on the default branch: skipped.
    git(T, ['checkout', '-q', '-b', 'feat/x']);
    const off = openUpdatePr({ root: T, paths: ['.sdlc/cli-version.json'], items: [] }, { productRoot: T, defaultBranch: 'main', platform: 'github', creator, version: '4.8.0' });
    assert.equal(off.skipped, true);
  } finally { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(R, { recursive: true, force: true }); }
});

test('yad update refuses --push and --open-pr together; --open-pr is the agent\'s without asking', async () => {
  assert.equal(classify(['update'], ['open-pr']), 'open-pr');
  assert.equal(askFor(classify(['update'], ['open-pr'])), 'never');
  assert.equal(classify(['check'], ['fix', 'open-pr']), 'open-pr');
  const T = await product();
  try {
    const r = spawnSync(process.execPath, [YAD, 'update', '--push', '--open-pr', '--json', '--dir', T], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /two different ways/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
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
