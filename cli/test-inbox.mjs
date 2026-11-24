// EP-plannotator-review: the Plannotator Inbox. yad shapes the messages; the agent posts them (cli/inbox.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  assert.equal(h.key, 'halt:EP-x-S02:checks:engine');
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
  assert.deepEqual([gate.kind, gate.key, gate.thread, gate.title], ['review', 'review:EP-x:epic.md:gate', 'yad EP-x', 'Review ready — epic.md for EP-x']);
  assert.match(gate.body, /merging it is the decision/);
  assert.deepEqual(gate.links, ['https://github.com/o/r/pull/265']);
  assert.equal(gate.notice, NOTICE);
  const nudge = reviewMessage({ repo: 'engine', pr: 7, url: 'https://github.com/o/e/pull/7' });
  assert.deepEqual([nudge.key, nudge.thread, nudge.title], ['review:engine:7:nudge', 'yad engine', 'Review ready — PR #7 in engine']);
  assert.match(nudge.body, /approve or merge/);
  // A link is only ever an https URL it was handed.
  assert.deepEqual(reviewMessage({ epic: 'EP-x', artifact: 'a.md', url: 'javascript:alert(1)' }).links, []);
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
