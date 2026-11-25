// EP-plannotator-review: the Plannotator Inbox. yad shapes the messages; the agent posts them (cli/inbox.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const { inboxReady, INBOX_TOOL } = await import('./inbox.mjs');

// A Product with an optional toolbox file; nothing else is needed to read the choices.
function product(toolbox) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-inbox-'));
  fs.mkdirSync(path.join(p, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(p, '.sdlc/product.json'), '{"schemaVersion":10,"platform":null}\n');
  if (toolbox !== undefined) fs.writeFileSync(path.join(p, '.sdlc/toolbox.json'), typeof toolbox === 'string' ? toolbox : JSON.stringify(toolbox));
  return p;
}
const found = (b) => b === 'plannotator';
const absent = () => false;
const plugin = (enabled) => ({ kind: 'plugin', name: 'plannotator@plannotator', enabled, agents: ['Claude Code'], where: 'Claude Code plugins' });

test('S01 inboxReady: true only when the Product chose Plannotator AND this machine has it (TC-03)', () => {
  assert.equal(INBOX_TOOL, 'plannotator');
  const chosen = product({ schemaVersion: 10, shipped: { plannotator: 'use' } });
  const notChosen = product();
  const skipped = product({ schemaVersion: 10, shipped: { plannotator: 'skip' } });
  try {
    assert.equal(inboxReady(chosen, { items: [], has: found }), true, 'chosen + found');
    assert.equal(inboxReady(chosen, { items: [], has: absent }), false, 'chosen, not found');
    assert.equal(inboxReady(notChosen, { items: [], has: found }), false, 'found, not chosen: a recommended tool is not used by default');
    assert.equal(inboxReady(notChosen, { items: [], has: absent }), false, 'neither');
    assert.equal(inboxReady(skipped, { items: [], has: found }), false, 'removed by the team');
    // Each signal alone counts as found.
    assert.equal(inboxReady(chosen, { items: [plugin(true)], has: absent }), true, 'the plugin');
    assert.equal(inboxReady(chosen, { items: [{ kind: 'mcp', name: 'plannotator-inbox', where: '.mcp.json' }], has: absent }), true, 'the Inbox server');
    // A plugin the settings turn off is not loaded: disabled, not installed.
    assert.equal(inboxReady(chosen, { items: [plugin(false)], has: absent }), false, 'a disabled plugin');
    // KNOWN LIMIT (contract): the program on PATH alone counts as found, even with the plugin turned off.
    assert.equal(inboxReady(chosen, { items: [plugin(false)], has: found }), true, 'a disabled plugin, but the program is on PATH');
  } finally { for (const p of [chosen, notChosen, skipped]) fs.rmSync(p, { recursive: true, force: true }); }
});

test('S01 inboxReady: no Product, or a toolbox file that does not parse, is not ready', () => {
  assert.equal(inboxReady(null, { items: [], has: found }), false);
  assert.equal(inboxReady('', { items: [], has: found }), false);
  const broken = product('{ not json');
  try {
    // A broken file is read leniently: the defaults stand, and a recommended tool is not in use by default.
    assert.equal(inboxReady(broken, { items: [], has: found }), false);
  } finally { fs.rmSync(broken, { recursive: true, force: true }); }
});

test('S01 inboxReady reads only: it writes nothing in the Product', () => {
  const p = product({ schemaVersion: 10, shipped: { plannotator: 'use' } });
  try {
    const list = (dir) => fs.readdirSync(dir, { recursive: true }).sort();
    const before = list(p);
    const text = fs.readFileSync(path.join(p, '.sdlc/toolbox.json'), 'utf8');
    inboxReady(p, { items: [], has: found });
    // And with the real machine scan (no `items`): the scan reads too.
    assert.equal(typeof inboxReady(p), 'boolean');
    assert.deepEqual(list(p), before);
    assert.equal(fs.readFileSync(path.join(p, '.sdlc/toolbox.json'), 'utf8'), text);
  } finally { fs.rmSync(p, { recursive: true, force: true }); }
});

// ---- S02: the messages (TC-06, TC-07, TC-11, TC-12, TC-15) -------------------------------------------------------
const { inboxBlock, handOffMessage, haltMessage, reviewMessage, TEXT, TITLE_MAX, BODY_MAX, HALT_LINES } = await import('./inbox.mjs');
const NOTICE = 'Replying here does not approve or record anything in yadflow. Type the command.';
const FIELDS = ['key', 'kind', 'thread', 'title', 'body', 'links', 'notice'];
const approveMerge = {
  act: 'approve-merge',
  why: 'an approval is a person\'s act: the record of who approved what rests on it',
  steps: ['Open the review pull request #265 for epic.md on GitHub: https://github.com/o/r/pull/265', 'Merge it when the checks pass.'],
  commands: [],
  verify: 'yad gate sync EP-x epic.md',
};

test('S02 inboxBlock: absent for no message, never an empty list', () => {
  assert.equal(inboxBlock([]), undefined);
  assert.equal(inboxBlock(undefined), undefined);
  assert.equal(inboxBlock([null]), undefined);
  const m = handOffMessage({ epic: 'EP-x', step: 'epic-review', entry: approveMerge });
  assert.deepEqual(inboxBlock([m]), { tool: 'plannotator', messages: [m] });
});

test('S02 handOffMessage: the contract fields, the DESIGN words, commands in code blocks, the notice last (TC-07)', () => {
  assert.equal(TEXT.notice, NOTICE, 'the fixed notice, word for word');
  const m = handOffMessage({ epic: 'EP-x', step: 'epic-review', entry: { ...approveMerge, commands: ['yad gate approve EP-x epic.md'] } });
  assert.deepEqual(Object.keys(m), FIELDS);
  assert.equal(m.kind, 'hand-off');
  assert.equal(m.key, 'hand-off:EP-x:epic-review:approve-merge');
  assert.equal(m.thread, 'yad EP-x');
  assert.equal(m.title, 'Review and merge the PR — EP-x');
  assert.equal(m.notice, NOTICE);
  assert.deepEqual(m.links, ['https://github.com/o/r/pull/265']);
  assert.match(m.body, /^Only you can do this: an approval is a person's act: the record of who approved what rests on it\.\n\n1\. Open the review/);
  assert.match(m.body, /\n2\. Merge it when the checks pass\.\n/);
  assert.match(m.body, /\n```\nyad gate approve EP-x epic\.md\n```\n/);
  assert.match(m.body, /I will confirm with `yad gate sync EP-x epic\.md`\./);
  assert.ok(m.body.endsWith(`\n\n*${NOTICE}*`), 'the notice is the last paragraph, in italics');
  assert.equal(m.question, undefined);
  // Every act the guide emits reads as words; any other act still has a title.
  for (const [act, words] of [['choose', 'Choose what to work on'], ['answer', 'Answer the agent\'s questions'], ['unblock', 'Resolve the blocker'], ['install', 'Install a tool'], ['login', 'Log in'], ['stories', 'Your step: stories']]) {
    assert.equal(handOffMessage({ epic: 'EP-x', entry: { act } }).title, `${words} — EP-x`, act);
  }
  // No epic: its own thread, and `-` in the key.
  const none = handOffMessage({ entry: { act: 'choose', why: 'w', steps: ['Pick one.'] } });
  assert.deepEqual([none.thread, none.key, none.title], ['yad', 'hand-off:-:-:choose', 'Choose what to work on']);
  // A command holding backticks cannot close its block early.
  assert.match(handOffMessage({ entry: { act: 'x', commands: ['echo ```x```'] } }).body, /````\necho ```x```\n````/);
});

test('S02 every text field is redacted: steps, commands, why, verify, title and ids (TC-06, TC-12)', () => {
  const tokens = ['ghp_abcdefghij0123456789', 'glpat-abcdefghij012345', 'sk-abcdefghijklmnop0123', '-----BEGIN OPENSSH PRIVATE KEY-----'];
  const m = handOffMessage({
    epic: 'EP-x', step: 'x',
    entry: { act: 'login', why: `use ${tokens[0]}`, steps: [`paste ${tokens[1]}`], commands: [`export T=${tokens[2]}`], verify: `check ${tokens[3]}` },
  });
  const h = haltMessage({ story: 'EP-x-S01', repo: 'engine', step: 'checks', reason: `tests failed\nAuthorization: token ${tokens[0]}\n${tokens[3]}` });
  const r = reviewMessage({ epic: 'EP-x', artifact: 'epic.md', url: `https://github.com/o/r/pull/1?t=${tokens[0]}` });
  const all = JSON.stringify([m, h, r]);
  for (const t of tokens) assert.ok(!all.includes(t), `${t} never reaches a message`);
  assert.match(all, /\[redacted( line)?\]/);
});

test('S02 title and body limits: 120 and 4,000, the notice kept whole, (trimmed) said in words', () => {
  const long = handOffMessage({ epic: `EP-${'a'.repeat(30)}`, entry: { act: 'a long act '.repeat(20), steps: Array.from({ length: 400 }, (_, i) => `step number ${i} says something long enough`) } });
  assert.ok(long.title.length <= TITLE_MAX && long.title.endsWith('…'), long.title);
  assert.ok(long.body.length <= BODY_MAX, `${long.body.length}`);
  assert.ok(long.body.endsWith(`\n\n*${NOTICE}*`), 'the notice survives the cut');
  assert.match(long.body, /\n\(trimmed\)\n\n\*Replying here/);
  const short = handOffMessage({ entry: { act: 'choose', steps: ['Pick one.'] } });
  assert.ok(!short.body.includes('(trimmed)'));
});

test('S02 haltMessage: the DESIGN layout, the fixed question, the last 60 lines, no notice (TC-11, TC-15)', () => {
  const out = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
  const h = haltMessage({ story: 'EP-x-S02', repo: 'engine', step: 'checks', reason: `build/test/lint failed (2 tests)\n${out}` });
  assert.deepEqual(Object.keys(h), ['key', 'kind', 'thread', 'title', 'body', 'links', 'question']);
  assert.equal(h.key, 'halt:EP-x-S02:checks:engine:-');
  assert.equal(h.thread, 'yad EP-x-S02');
  assert.equal(h.title, 'Build halted — EP-x-S02 in engine: checks');
  assert.deepEqual(h.question, { prompt: 'What should happen next?', options: ['fix', 'skip', 'stop'] });
  assert.equal(h.notice, undefined, 'a halt carries the closing line instead of the notice');
  assert.match(h.body, /^Story `EP-x-S02` in `engine`: step `checks` is halted\.\n\nWhy: build\/test\/lint failed \(2 tests\)\n\n\(trimmed\)\n```\nline 41\n/);
  assert.match(h.body, /line 100\n```\n/);
  assert.ok(!/\bline 40\b/.test(h.body), 'only the last 60 lines');
  assert.equal(h.body.split('\n').filter((l) => /^line \d+$/.test(l)).length, HALT_LINES);
  assert.ok(h.body.endsWith(TEXT.haltClosing));
  // A one-line reason: no output block (TC-15).
  const one = haltMessage({ story: 'EP-x-S02', repo: 'engine', step: 'implement', reason: 'scope overrun: cli/x.mjs is not declared' });
  assert.ok(!one.body.includes('```'));
  assert.match(one.body, /Why: scope overrun: cli\/x\.mjs is not declared/);
});

test('S02 reviewMessage: a Shape review or a code PR, the solo wording, the link and the notice', () => {
  const gate = reviewMessage({ epic: 'EP-x', artifact: 'epic.md', url: 'https://github.com/o/r/pull/265', solo: true });
  assert.deepEqual(Object.keys(gate), FIELDS);
  assert.deepEqual([gate.kind, gate.key, gate.thread, gate.title], ['review', 'review:EP-x:epic:gate', 'yad EP-x', 'Review ready — epic.md for EP-x']);
  assert.match(gate.body, /merging it is the decision/);
  assert.deepEqual(gate.links, ['https://github.com/o/r/pull/265']);
  assert.equal(gate.notice, NOTICE);
  const nudge = reviewMessage({ repo: 'engine', pr: 7, url: 'https://github.com/o/e/pull/7' });
  assert.deepEqual([nudge.key, nudge.thread, nudge.title], ['review:engine:7:nudge', 'yad engine', 'Review ready — PR #7 in engine']);
  assert.match(nudge.body, /approve or merge/);
  // A link is only ever an https URL it was handed.
  assert.deepEqual(reviewMessage({ epic: 'EP-x', artifact: 'a.md', url: 'javascript:alert(1)' }).links, []);
});

// ---- EP-inbox-open-pr-keys-S01: a key per halted task and per review branch ---------------------------------

test('EP-inbox-open-pr-keys haltMessage: the key names the task, `-` when there is none (TC-01)', () => {
  const at = (task) => haltMessage({ story: 'EP-x-S02', repo: 'engine', step: 'implement', task, reason: 'r' }).key;
  assert.equal(at('T02'), 'halt:EP-x-S02:implement:engine:T02');
  assert.notEqual(at('T01'), at('T02'), 'two tasks, two keys');
  assert.equal(at(null), 'halt:EP-x-S02:implement:engine:-');
  assert.equal(at(undefined), 'halt:EP-x-S02:implement:engine:-');
});

test('EP-inbox-open-pr-keys reviewMessage: a gate key names the review branch base; two stories, two keys (TC-04)', () => {
  const gate = (o) => reviewMessage({ epic: 'EP-x', url: 'https://github.com/o/r/pull/1', ...o });
  const s1 = gate({ artifact: 'stories/', base: 'stories-S01' });
  const s2 = gate({ artifact: 'stories/', base: 'stories-S02' });
  assert.deepEqual([s1.key, s2.key], ['review:EP-x:stories-S01:gate', 'review:EP-x:stories-S02:gate']);
  // No base: the artifact's own base.
  assert.deepEqual(['epic.md', 'architecture.md', 'stories/', 'test-cases.md'].map((artifact) => gate({ artifact }).key),
    ['review:EP-x:epic:gate', 'review:EP-x:architecture:gate', 'review:EP-x:stories:gate', 'review:EP-x:test-cases:gate']);
});

test('EP-inbox-open-pr-keys: only the key changes; the hand-off and nudge keys are as they were (TC-05)', () => {
  const noKey = ({ key: _key, ...rest }) => rest;
  const reason = `checks failed\n${Array.from({ length: 70 }, (_, i) => `l${i}`).join('\n')}`;
  const h = (task) => haltMessage({ story: 'EP-x-S02', repo: 'engine', step: 'checks', task, reason });
  assert.deepEqual(noKey(h('T03')), noKey(h(null)));
  const r = (base) => reviewMessage({ epic: 'EP-x', artifact: 'stories/', base, url: 'https://github.com/o/r/pull/3', solo: true });
  assert.deepEqual(noKey(r('stories-S01')), noKey(r(null)));
  assert.equal(r('stories-S01').title, 'Review ready — stories/ for EP-x', 'the title still names the artifact');
  assert.equal(reviewMessage({ repo: 'engine', pr: 7 }).key, 'review:engine:7:nudge');
  assert.equal(handOffMessage({ epic: 'EP-x', step: 'epic-review', entry: { act: 'approve-merge' } }).key, 'hand-off:EP-x:epic-review:approve-merge');
});

// ---- S02 code review: the cut, injection, named secrets, characters, links -----------------------------------
test('S02 review: a long halt keeps its question, closing line, closed fence and LAST lines, all within 4,000', () => {
  const out = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(2, '0')} ${'x'.repeat(95)}`).join('\n');
  const h = haltMessage({ story: 'EP-x-S03', repo: 'engine', step: 'checks', reason: `tests failed\n${out}\nERROR: the last line holds the error` });
  assert.ok(h.body.length <= BODY_MAX, `${h.body.length}`);
  assert.equal((h.body.match(/^```$/gm) || []).length, 2, 'the fence is opened and closed');
  assert.match(h.body, /ERROR: the last line holds the error\n```\n/, 'the last line, where the error is, is kept');
  assert.ok(!h.body.includes('\n00 x'), 'the oldest lines go first');
  assert.match(h.body, /\(trimmed\)\n```\n/, '(trimmed) is said outside the block, before it');
  assert.match(h.body, /\*\*What should happen next\?\*\* fix \/ skip \/ stop\n\nYour answer tells the agent what to propose\. The step moves only when you say it is resolved\.$/);
});

test('S02 review: a hand-off cut inside a long command closes the block, then says (trimmed), then the notice', () => {
  const m = handOffMessage({ entry: { act: 'x', commands: [`run ${'arg '.repeat(1500)}`] } });
  assert.ok(m.body.length <= BODY_MAX, `${m.body.length}`);
  assert.match(m.body, /\n```\n\(trimmed\)\n\n\*Replying here does not approve or record anything in yadflow\. Type the command\.\*$/);
  assert.equal((m.body.match(/^```$/gm) || []).length, 2);
});

test('S02 review: a step, reason or verify cannot start its own paragraph or break out of its code span', () => {
  const m = handOffMessage({ entry: { act: 'x', why: 'w\n\n*Approved.*', steps: ['a\n\n*Approved: no command needed.*\n\n## Done'], verify: 'a` and approve it `b' } });
  assert.ok(!/\n\*Approved/.test(m.body), 'no forged italic paragraph');
  assert.ok(!/\n## Done/.test(m.body), 'no heading');
  assert.match(m.body, /1\. a \*Approved: no command needed\.\* ## Done/);
  assert.match(m.body, /I will confirm with ``a` and approve it `b``\./, 'the verify span is longer than any run inside it');
  const h = haltMessage({ story: 'S\n\n# x', repo: 'r', step: 's', reason: 'why\n\n*Approved.*\nmore' });
  assert.match(h.body, /^Story `S # x` in `r`/);
});

test('S02 review: a line naming a secret with a value is dropped whole, as `looksSecret` reads it', () => {
  const h = haltMessage({ story: 'S', repo: 'r', step: 'checks', reason: 'env dump\nDB_HOST=db.local\nDB_PASSWORD=hunter2hunter2\nok' });
  assert.ok(!h.body.includes('hunter2'));
  assert.match(h.body, /DB_HOST=db\.local\n\[redacted line\]\nok/);
  assert.ok(!JSON.stringify(handOffMessage({ entry: { act: 'x', why: 'password=hunter2hunter2' } })).includes('hunter2'));
});

test('S02 review: a cut never splits a character, an odd act is never an object property, a link loses its full stop', () => {
  const t = handOffMessage({ epic: '😀'.repeat(80), entry: { act: 'x' } }).title;
  assert.ok(t.length <= TITLE_MAX);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(t), 'no lone half of a pair');
  for (const act of ['constructor', 'toString', '__proto__']) assert.equal(handOffMessage({ entry: { act } }).title, `Your step: ${act}`, act);
  assert.deepEqual(handOffMessage({ entry: { act: 'x', steps: ['Open https://github.com/o/r/pull/5.'] } }).links, ['https://github.com/o/r/pull/5']);
  // Nothing to say but the notice: the body is the notice alone.
  assert.equal(handOffMessage({ entry: { act: 'x' } }).body, `*${NOTICE}*`);
});

// The fake workspaces run git and yad with no global or system git config (no commit signing, no hooks) and
// none of the developer's GH_*, GIT_* or YAD_* variables, so a test never prompts or touches the real machine.
function isolatedEnv(W, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GH_|GITHUB_|GIT_|YAD_)/.test(k)));
  fs.writeFileSync(path.join(W, 'gitconfig'), '[user]\n\tname = a\n\temail = a@b.c\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n');
  return { ...env, GIT_CONFIG_GLOBAL: path.join(W, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

// EP-plannotator-review-S04: `yad gate open --json` and `yad review nudge --json` carry one `review` message.
const { gateOpen } = await import('./gate.mjs');
const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};
// A Product on GitHub (a local ledger) with one review step ready to open.
function reviewProduct({ solo = false } = {}) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-inbox-gate-'));
  const put = (rel, v) => { fs.mkdirSync(path.dirname(path.join(T, rel)), { recursive: true }); fs.writeFileSync(path.join(T, rel), typeof v === 'string' ? v : JSON.stringify(v)); };
  put('.sdlc/product.json', { schemaVersion: 10, platform: 'github', default_branch: 'main', ...(solo ? { solo: true } : {}) });
  put('.sdlc/repos.json', { repos: [{ name: 'engine', path: 'engine', platform: 'github', default_branch: 'main' }] });
  put('epics/EP-x/epic.md', '---\nid: EP-x\nowner: alice\n---\n');
  put('epics/EP-x/architecture.md', '---\nid: EP-x\nartifact: architecture\nstatus: draft\n---\n# arch\n');
  put('epics/EP-x/.sdlc/state.json', { epicId: 'EP-x', currentStep: 'architecture-review', steps: [
    { id: 'architecture', type: 'author', artifact: 'architecture.md', status: 'done', risk_tags: [] },
    { id: 'architecture-review', type: 'review+approve', artifact: 'architecture.md', status: 'todo', risk_tags: [] },
  ] });
  put('epics/EP-x/.sdlc/approvals.json', '[]');
  put('epics/EP-x/.sdlc/comments.json', '[]');
  return T;
}
const URL7 = 'https://github.com/o/product/pull/7';
const opened = () => ({ ok: true, url: URL7 });
const open = (T, o) => quiet(() => gateOpen(T, { epic: 'EP-x', artifact: 'architecture.md', creator: opened, hasBranch: () => true, runner: () => ({ ok: true, stdout: '[]' }), env: {}, today: '2026-11-24', ...o }));

test('S04 yad gate open --json: one review message when the review PR opened and the Inbox is ready; solo wording when solo (TC-16)', async () => {
  const team = reviewProduct();
  const solo = reviewProduct({ solo: true });
  try {
    const asked = [];
    const r = await open(team, { json: true, cwd: '/some/repo', ready: (root, o) => { asked.push([root, o.detectRoot]); return true; } });
    assert.deepEqual(asked, [[team, '/some/repo']], 'the scan runs from where yad ran');
    assert.equal(r.opened, true);
    assert.equal(r.inbox.tool, 'plannotator');
    assert.equal(r.inbox.messages.length, 1);
    const [m] = r.inbox.messages;
    assert.equal(m.kind, 'review');
    assert.equal(m.key, 'review:EP-x:architecture:gate');
    assert.equal(m.thread, 'yad EP-x');
    assert.equal(m.title, 'Review ready — architecture.md for EP-x');
    assert.deepEqual(m.links, [URL7]);
    assert.equal(m.notice, 'Replying here does not approve or record anything in yadflow. Type the command.');
    assert.match(m.body, /approve or merge/);
    assert.ok(m.body.trimEnd().endsWith(`*${m.notice}*`), 'the notice is the last paragraph');
    const s = await open(solo, { json: true, ready: () => true });
    assert.match(s.inbox.messages[0].body, /In solo mode no approval is counted, so merging it is the decision\./);
  } finally { fs.rmSync(team, { recursive: true, force: true }); fs.rmSync(solo, { recursive: true, force: true }); }
});

test('EP-inbox-open-pr-keys yad gate open --json: the key names the review branch base, so two stories\' reviews have two keys (TC-04)', async () => {
  const T = reviewProduct();
  try {
    fs.mkdirSync(path.join(T, 'epics/EP-x/stories'));
    for (const n of ['S01', 'S02']) fs.writeFileSync(path.join(T, `epics/EP-x/stories/EP-x-${n}.md`), `---\nid: EP-x-${n}\n---\n`);
    const state = path.join(T, 'epics/EP-x/.sdlc/state.json');
    const st = JSON.parse(fs.readFileSync(state, 'utf8'));
    st.steps.push({ id: 'stories', type: 'author', artifact: 'stories/', status: 'done', risk_tags: [] },
      { id: 'stories-review', type: 'review+approve', artifact: 'stories/', status: 'todo', risk_tags: [] });
    fs.writeFileSync(state, JSON.stringify(st));
    const key = async (o) => (await open(T, { json: true, ready: () => true, ...o })).inbox.messages[0];
    const [s1, s2] = [await key({ artifact: 'stories/', head: 'review/EP-x/stories-S01' }), await key({ artifact: 'stories/', head: 'review/EP-x/stories-S02' })];
    assert.deepEqual([s1.key, s2.key], ['review:EP-x:stories-S01:gate', 'review:EP-x:stories-S02:gate']);
    assert.equal(s1.title, 'Review ready — stories/ for EP-x', 'the title still names the artifact');
    assert.equal((await key({})).key, 'review:EP-x:architecture:gate', 'no head: the branch gate open makes');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('S04 yad gate open: no inbox on a failed open, the printed path, or an Inbox not ready; nothing else changes (TC-17)', async () => {
  const dirs = [reviewProduct(), reviewProduct(), reviewProduct(), reviewProduct()];
  try {
    let calls = 0;
    const on = () => { calls += 1; return true; };
    const failed = await open(dirs[0], { json: true, ready: on, creator: () => ({ ok: false, reason: 'refused' }) });
    assert.equal(failed.opened, false);
    assert.ok(!('inbox' in failed));
    const printed = await open(dirs[1], { ready: on });
    assert.ok(!('inbox' in printed));
    assert.equal(calls, 0, 'the machine is scanned only for an opened review under --json');
    // Not ready: the result is exactly the one without the feature.
    const off = await open(dirs[2], { json: true, ready: () => false });
    const plain = await open(dirs[3]);
    assert.equal(JSON.stringify(off), JSON.stringify(plain));
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
});

const { reviewNudge } = await import('./review.mjs');
const nudgeProduct = (o) => {
  const T = reviewProduct(o);
  fs.mkdirSync(path.join(T, 'engine'), { recursive: true });
  return T;
};
const reader7 = () => ({ ok: true, url: URL7, reviews: [{ login: 'bo', state: 'APPROVED' }] });
const nudge = (T, o) => quiet(() => reviewNudge(T, { repo: 'engine', pr: 7, reader: reader7, poster: () => ({ ok: true }), ...o }));

test('S04 yad review nudge --json: one review message for the PR when the Inbox is ready; solo wording when solo (TC-16)', async () => {
  const team = nudgeProduct();
  const solo = nudgeProduct({ solo: true });
  try {
    const asked = [];
    const r = await nudge(team, { json: true, cwd: '/some/repo', ready: (root, o) => { asked.push([root, o.detectRoot]); return true; } });
    assert.deepEqual(asked, [[team, '/some/repo']]);
    assert.equal(r.nudged, 1);
    const [m] = r.inbox.messages;
    assert.equal(r.inbox.messages.length, 1);
    assert.deepEqual([m.kind, m.key, m.thread, m.title], ['review', 'review:engine:7:nudge', 'yad engine', 'Review ready — PR #7 in engine']);
    assert.deepEqual(m.links, [URL7]);
    assert.equal(m.notice, 'Replying here does not approve or record anything in yadflow. Type the command.');
    assert.match(m.body, /approve or merge/);
    const s = await nudge(solo, { json: true, ready: () => true });
    assert.match(s.inbox.messages[0].body, /merging it is the decision/);
    // A PR whose web page the platform did not give: no link, never one made up.
    const bare = await nudge(team, { json: true, ready: () => true, reader: () => ({ ok: true, reviews: [] }) });
    assert.deepEqual(bare.inbox.messages[0].links, []);
  } finally { fs.rmSync(team, { recursive: true, force: true }); fs.rmSync(solo, { recursive: true, force: true }); }
});

test('S04 yad review nudge: no inbox on a failed read, the printed path, or an Inbox not ready; nothing else changes (TC-17)', async () => {
  const T = nudgeProduct();
  const code = process.exitCode;
  try {
    let calls = 0;
    const on = () => { calls += 1; return true; };
    assert.equal(await nudge(T, { json: true, ready: on, reader: () => ({ ok: false, reason: 'gone' }) }), undefined, 'a failed read returns nothing');
    assert.equal(await nudge(T, { json: true, ready: on, pr: undefined }), undefined);
    assert.ok(!('inbox' in await nudge(T, { ready: on })));
    assert.equal(calls, 0, 'the machine is scanned only for a read PR under --json');
    assert.equal(JSON.stringify(await nudge(T, { json: true, ready: () => false })), JSON.stringify(await nudge(T)));
  } finally { process.exitCode = code; fs.rmSync(T, { recursive: true, force: true }); }
});

test('S04 yad review nudge: from inside a code repo, the Product is read for the choice and the solo wording (TC-16)', async () => {
  const T = nudgeProduct({ solo: true });
  try {
    const asked = [];
    const r = await nudge(path.join(T, 'engine'), { product: T, json: true, ready: (root, o) => { asked.push([root, o.detectRoot]); return true; } });
    assert.deepEqual(asked, [[T, path.join(T, 'engine')]], 'the Product decides; the scan is where yad ran');
    assert.match(r.inbox.messages[0].body, /merging it is the decision/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('S04 yad review nudge --json through the CLI, run in a code repo whose own Inbox server is the only one (TC-16)', { skip: process.platform === 'win32' && 'fake programs on PATH are shell scripts' }, () => {
  const { execFileSync, spawnSync } = require('node:child_process');
  const W = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-inbox-nudge-')));
  try {
    const P = path.join(W, 'product');
    const E = path.join(W, 'engine');
    const put = (rel, v) => { fs.mkdirSync(path.dirname(path.join(W, rel)), { recursive: true }); fs.writeFileSync(path.join(W, rel), typeof v === 'string' ? v : JSON.stringify(v)); };
    put('.yad-workspace.json', { version: 1, product: 'product' });
    put('product/.sdlc/product.json', { schemaVersion: 10, platform: 'github', default_branch: 'main' });
    put('product/.sdlc/repos.json', { repos: [{ name: 'engine', path: '../engine', platform: 'github', default_branch: 'main' }] });
    put('product/.sdlc/toolbox.json', { schemaVersion: 10, shipped: { plannotator: 'use' } });
    put('engine/.mcp.json', { mcpServers: { 'plannotator-inbox': { command: 'plannotator', args: ['inbox', 'mcp'] } } });
    put('engine/a.txt', 'a\n');
    const genv = isolatedEnv(W);
    for (const d of [P, E]) {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d, env: genv });
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'chore: seed'], { cwd: d, env: genv });
    }
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/o/engine.git'], { cwd: E, env: genv });
    // A fake gh that answers the PR read; no plannotator program anywhere on PATH.
    put('bin/gh', `#!/bin/sh\ncase "$*" in\n  "pr view 7 --json state,mergedAt,mergedBy,mergeCommit,headRefOid,url") echo '{"state":"OPEN","headRefOid":"abc","url":"https://github.com/o/engine/pull/7"}' ;;\n  "pr view 7 --json latestReviews") echo '{"latestReviews":[]}' ;;\n  *) exit 1 ;;\nesac\n`);
    fs.chmodSync(path.join(W, 'bin/gh'), 0o755);
    // node, git and which only, linked into one folder: a real gh or plannotator on this machine is never found.
    fs.mkdirSync(path.join(W, 'tools'));
    fs.symlinkSync(process.execPath, path.join(W, 'tools/node'));
    for (const t of ['git', 'which']) fs.symlinkSync(execFileSync('/usr/bin/which', [t]).toString().trim(), path.join(W, 'tools', t));
    const home = path.join(W, 'home');
    fs.mkdirSync(home);
    const PATH = [path.join(W, 'bin'), path.join(W, 'tools')].join(path.delimiter);
    const yad = (cwd) => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/yad.mjs', import.meta.url)), 'review', 'nudge', '--repo', 'engine', '--pr', '7', '--json'],
      { cwd, encoding: 'utf8', env: isolatedEnv(W, { PWD: cwd, HOME: home, USERPROFILE: home, PATH, NO_COLOR: '1', YAD_NO_REPORT: '1', YAD_NO_UPDATE_CHECK: '1' }) });
    const r = yad(E);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.inbox?.messages.length, 1, r.stderr);
    assert.deepEqual(j.inbox.messages[0].links, ['https://github.com/o/engine/pull/7']);
    // From the Product, the code repo's own server is not here: no inbox.
    const fromProduct = JSON.parse(yad(P).stdout);
    assert.ok(!('inbox' in fromProduct));
  } finally { fs.rmSync(W, { recursive: true, force: true }); }
});

// EP-inbox-guide-scan: a workspace (Product + the code repo `engine`) where only the code repo sets up the Inbox
// (its own `.mcp.json`), with fake tools on a PATH that can reach nothing of this machine's: linked node, git and
// which, plus a fake gh. Every command runs through the CLI.
function inboxWorkspace({ chosen = true, step = 'architecture-review', status = 'in_review' } = {}) {
  const { execFileSync, spawnSync } = require('node:child_process');
  const W = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-inbox-ws-')));
  const P = path.join(W, 'product');
  const E = path.join(W, 'engine');
  const put = (rel, v) => { fs.mkdirSync(path.dirname(path.join(W, rel)), { recursive: true }); fs.writeFileSync(path.join(W, rel), typeof v === 'string' ? v : JSON.stringify(v)); };
  const genv = isolatedEnv(W);
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', env: genv }).toString().trim();
  put('.yad-workspace.json', { version: 1, product: 'product' });
  put('product/.sdlc/product.json', { schemaVersion: 10, platform: 'github', default_branch: 'main' });
  put('product/.sdlc/repos.json', { repos: [{ name: 'engine', path: '../engine', platform: 'github', default_branch: 'main' }] });
  if (chosen) put('product/.sdlc/toolbox.json', { schemaVersion: 10, shipped: { plannotator: 'use' } });
  put('product/epics/EP-x/epic.md', '---\nid: EP-x\nowner: alice\n---\n# EP-x\n');
  put('product/epics/EP-x/architecture.md', '---\nid: EP-x\nartifact: architecture\nstatus: draft\n---\n# arch\n');
  put('product/epics/EP-x/.sdlc/state.json', { epicId: 'EP-x', currentStep: step, steps: [
    { id: 'architecture', type: 'author', artifact: 'architecture.md', status: 'done', risk_tags: [] },
    { id: 'architecture-review', type: 'review+approve', artifact: 'architecture.md', status, risk_tags: [] },
  ] });
  put('product/epics/EP-x/.sdlc/approvals.json', '[]');
  put('product/epics/EP-x/.sdlc/comments.json', '[]');
  put('engine/.mcp.json', { mcpServers: { 'plannotator-inbox': { command: 'plannotator', args: ['inbox', 'mcp'] } } });
  put('engine/src/a.js', 'a\n');
  for (const d of [P, E]) {
    git(d, 'init', '-q', '-b', 'main');
    git(d, 'add', '-A');
    git(d, 'commit', '-q', '-m', 'chore: seed');
  }
  git(E, 'remote', 'add', 'origin', 'https://github.com/o/engine.git');
  // The Product's origin is a local bare repo holding the review branch, so `gate open` finds it there.
  git(W, 'init', '-q', '--bare', '-b', 'main', path.join(W, 'product.git'));
  git(P, 'remote', 'add', 'origin', path.join(W, 'product.git'));
  git(P, 'push', '-q', 'origin', 'main', 'main:review/EP-x/architecture');
  put('bin/gh', '#!/bin/sh\ncase "$*" in\n  "pr create"*) echo "https://github.com/o/product/pull/9" ;;\n  *) exit 1 ;;\nesac\n');
  fs.chmodSync(path.join(W, 'bin/gh'), 0o755);
  fs.mkdirSync(path.join(W, 'tools'));
  fs.symlinkSync(process.execPath, path.join(W, 'tools/node'));
  for (const t of ['git', 'which']) fs.symlinkSync(execFileSync('/usr/bin/which', [t]).toString().trim(), path.join(W, 'tools', t));
  const home = path.join(W, 'home');
  fs.mkdirSync(home);
  const PATH = [path.join(W, 'bin'), path.join(W, 'tools')].join(path.delimiter);
  const yad = (cwd, ...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/yad.mjs', import.meta.url)), ...args],
    { cwd, encoding: 'utf8', env: isolatedEnv(W, { PWD: cwd, HOME: home, USERPROFILE: home, PATH, NO_COLOR: '1', YAD_NO_REPORT: '1', YAD_NO_UPDATE_CHECK: '1' }) });
  return { W, P, E, yad, done: () => fs.rmSync(W, { recursive: true, force: true }) };
}
const winSkip = { skip: process.platform === 'win32' && 'fake programs on PATH are shell scripts' };

test('EP-inbox-guide-scan yad guide --json from a code repo\'s subfolder finds that repo\'s own Inbox server; from the Product it does not (TC-01, TC-02)', winSkip, () => {
  const ws = inboxWorkspace();
  try {
    const r = ws.yad(path.join(ws.E, 'src'), 'guide', 'EP-x', '--json');
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.ok(j.person.length > 0, 'the step has person hand-offs');
    assert.equal(j.inbox?.messages.length, j.person.length, r.stderr);
    assert.ok(j.inbox.messages.every((m) => m.kind === 'hand-off'));
    assert.ok(!('inbox' in JSON.parse(ws.yad(ws.P, 'guide', 'EP-x', '--json').stdout)), 'the repo\'s server is not where the Product is');
  } finally { ws.done(); }
});

test('EP-inbox-guide-scan yad guide: only the Inbox scan changes — "here" and the printed guide are the same; not chosen gives the same answer every run (TC-03, TC-04)', winSkip, () => {
  let on;
  let off;
  try {
    on = inboxWorkspace();
    off = inboxWorkspace({ chosen: false });
    const at = (ws) => path.join(ws.E, 'src');
    const withInbox = JSON.parse(on.yad(at(on), 'guide', 'EP-x', '--json').stdout);
    const offRun = off.yad(at(off), 'guide', 'EP-x', '--json');
    const without = JSON.parse(offRun.stdout);
    assert.ok('inbox' in withInbox);
    assert.ok(!('inbox' in without));
    delete withInbox.inbox;
    // The two workspaces differ only in their temp folder (and the toolbox choice), so compare with it swapped.
    assert.equal(JSON.stringify(withInbox).replaceAll(on.W, '<W>'), JSON.stringify(without).replaceAll(off.W, '<W>'), 'nothing but inbox differs');
    assert.equal(on.yad(at(on), 'guide', 'EP-x').stdout.replaceAll(on.W, '<W>'), off.yad(at(off), 'guide', 'EP-x').stdout.replaceAll(off.W, '<W>'), 'the printed guide is the same');
    // Not chosen: the same answer twice, and no inbox key at all.
    assert.equal(off.yad(at(off), 'guide', 'EP-x', '--json').stdout, offRun.stdout);
  } finally { on?.done(); off?.done(); }
});

test('EP-inbox-guide-scan yad gate open --json through the CLI: one review message with the PR link; none when not chosen (TC-05, TC-06)', winSkip, () => {
  let on;
  let off;
  try {
    on = inboxWorkspace({ step: 'architecture-review', status: 'todo' });
    off = inboxWorkspace({ chosen: false, step: 'architecture-review', status: 'todo' });
    // Run from the code repo, where its own Inbox server is: the Product is found through the workspace file.
    const r = on.yad(on.E, 'gate', 'open', 'EP-x', 'architecture.md', '--json');
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.opened, true, r.stderr);
    assert.equal(j.inbox?.messages.length, 1, r.stderr);
    const [m] = j.inbox.messages;
    assert.deepEqual([m.kind, m.title, m.links], ['review', 'Review ready — architecture.md for EP-x', ['https://github.com/o/product/pull/9']]);
    assert.equal(m.notice, 'Replying here does not approve or record anything in yadflow. Type the command.');
    const n = JSON.parse(off.yad(off.E, 'gate', 'open', 'EP-x', 'architecture.md', '--json').stdout);
    assert.equal(n.opened, true);
    assert.ok(!('inbox' in n), 'not chosen: no inbox');
  } finally { on?.done(); off?.done(); }
});

test('EP-inbox-guide-scan runGuide: the Inbox scan looks from inboxAt, the guide itself from cwd; inboxAt left out falls back to cwd', async () => {
  const { runGuide } = await import('./guide.mjs');
  const T = product({ schemaVersion: 10, shipped: { plannotator: 'use' } });
  try {
    const asked = [];
    const ready = (root, o) => { asked.push(o.detectRoot); return false; };
    await runGuide(T, { cwd: T, inboxAt: '/top/of/checkout', json: true, ready });
    await runGuide(T, { cwd: T, json: true, ready });
    assert.deepEqual(asked, ['/top/of/checkout', T]);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- EP-inbox-open-pr-keys-S02: yad open-pr on a review branch carries the review message ---------------------

// The workspace with the Product checked out on its review branch, and the Inbox server set up in the Product
// itself: `yad open-pr` takes the review path only when run in the Product, so that is where yad looks.
function reviewBranchWorkspace(o = {}) {
  const { execFileSync } = require('node:child_process');
  const ws = inboxWorkspace({ step: 'architecture-review', status: 'todo', ...o });
  try {
    fs.writeFileSync(path.join(ws.P, '.mcp.json'), JSON.stringify({ mcpServers: { 'plannotator-inbox': { command: 'plannotator', args: ['inbox', 'mcp'] } } }));
    execFileSync('git', ['switch', '-q', '-c', 'review/EP-x/architecture'], { cwd: ws.P, stdio: 'pipe', env: isolatedEnv(ws.W) });
  } catch (e) { ws.done(); throw e; }
  return ws;
}

test('EP-inbox-open-pr-keys yad open-pr --json on a review branch: one review message, the same one yad gate open gives (TC-06, TC-07)', winSkip, () => {
  let a;
  let b;
  try {
    a = reviewBranchWorkspace();
    b = reviewBranchWorkspace();
    const r = a.yad(a.P, 'open-pr', '--platform', 'github', '--json');
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.url, 'https://github.com/o/product/pull/9', r.stderr);
    assert.equal(j.inbox?.messages.length, 1, r.stderr);
    const [m] = j.inbox.messages;
    assert.deepEqual([m.kind, m.key, m.title, m.links], ['review', 'review:EP-x:architecture:gate', 'Review ready — architecture.md for EP-x', ['https://github.com/o/product/pull/9']]);
    assert.equal(m.notice, 'Replying here does not approve or record anything in yadflow. Type the command.');
    // The same review opened with `yad gate open` gives the same message, key and all: an agent posts it once.
    const g = b.yad(b.P, 'gate', 'open', 'EP-x', 'architecture.md', '--json');
    assert.equal(g.status, 0, g.stderr);
    assert.deepEqual(j.inbox, JSON.parse(g.stdout).inbox);
  } finally { a?.done(); b?.done(); }
});

test('EP-inbox-open-pr-keys yad open-pr --json: no inbox when Plannotator is not chosen (the rest the same), or when the PR is not opened (TC-08, TC-09)', winSkip, () => {
  let on;
  let off;
  let fails;
  try {
    on = reviewBranchWorkspace();
    off = reviewBranchWorkspace({ chosen: false });
    const withInbox = JSON.parse(on.yad(on.P, 'open-pr', '--platform', 'github', '--json').stdout);
    const offRun = off.yad(off.P, 'open-pr', '--platform', 'github', '--json');
    assert.equal(offRun.status, 0, offRun.stderr);
    const without = JSON.parse(offRun.stdout);
    assert.ok('inbox' in withInbox);
    assert.ok(!('inbox' in without), 'not chosen: no inbox');
    delete withInbox.inbox;
    assert.equal(JSON.stringify(withInbox).replaceAll(on.W, '<W>'), JSON.stringify(without).replaceAll(off.W, '<W>'), 'nothing but inbox differs');
    // The create fails: no PR, so no message, and the exit code is 1 as before.
    fails = reviewBranchWorkspace();
    fs.writeFileSync(path.join(fails.W, 'bin/gh'), '#!/bin/sh\nexit 1\n');
    const f = fails.yad(fails.P, 'open-pr', '--platform', 'github', '--json');
    assert.equal(f.status, 1, f.stderr);
    const fj = JSON.parse(f.stdout);
    assert.equal(fj.url ?? null, null, 'the failure return: no PR opened');
    assert.ok(!('inbox' in fj), 'no PR opened: no inbox');
  } finally { on?.done(); off?.done(); fails?.done(); }
});

test('EP-inbox-open-pr-keys yad open-pr --json for a code repo\'s task PR carries no inbox (TC-10)', winSkip, () => {
  const { execFileSync } = require('node:child_process');
  const ws = inboxWorkspace();
  try {
    const git = (...a) => execFileSync('git', a, { cwd: ws.E, stdio: 'pipe', env: isolatedEnv(ws.W) });
    git('init', '-q', '--bare', '-b', 'main', path.join(ws.W, 'engine.git'));
    git('remote', 'set-url', 'origin', path.join(ws.W, 'engine.git'));
    git('push', '-q', 'origin', 'main');
    git('switch', '-q', '-c', 'feat/EP-x-S01-T01');
    fs.writeFileSync(path.join(ws.E, 'src/a.js'), 'b\n');
    git('commit', '-q', '-am', 'feat: b');
    const r = ws.yad(ws.E, 'open-pr', '--platform', 'github', '--json');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).url, 'https://github.com/o/product/pull/9', 'the task PR was opened');
    assert.ok(!r.stdout.includes('"inbox"'), 'a task PR carries no inbox');
  } finally { ws.done(); }
});
