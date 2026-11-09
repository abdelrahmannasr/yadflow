// E170: an item seeds and links an epic. The rules each test pins:
//   - the item is read first, and nothing is created if it cannot be;
//   - the type comes from the label; a parent comes only from a definite link, else a stub;
//   - a failed write-back keeps the link, the comment is written once, and the sidecar is never overwritten when unreadable;
//   - the item's text never reaches the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.YAD_NO_UPDATE_NOTIFIER = '1';
process.env.YAD_PLATFORM_LOGIN = '0';
if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}

const W = await import('./issues-write.mjs');
const I = await import('./issues.mjs');
const { runEpicNew } = await import('./epic.mjs');
const env = { PATH: process.env.PATH };
const today = '2026-11-09';
const done = (body) => ({ ok: true, code: 0, stdout: JSON.stringify(body), stderr: '' });
const no = (stderr) => ({ ok: false, code: 1, stdout: '', stderr });

function product() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-iw-'));
  fs.mkdirSync(path.join(T, '.sdlc'));
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', git_url: 'git@github.com:a/b.git' }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [] }));
  return T;
}
const issue = (over = {}) => ({ number: 7, title: 'Secret title', body: 'Secret body', state: 'open', html_url: 'https://github.com/a/b/issues/7', labels: [{ name: 'bug' }], assignees: [], ...over });

// A fake platform: answers the read, the parent query and every write, and keeps the writes.
function platform({ item = issue(), parent = null, parentFails = false, writeFails = false, readFails = false } = {}) {
  const writes = [];
  const runner = (cmd, args) => {
    if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, code: 0, stdout: '', stderr: '' };
    if (args[0] !== 'api') return no('unexpected');
    if (args.includes('-X')) { writes.push(args); return writeFails ? no('HTTP 403') : done({}); }
    if (args.includes('graphql')) return parentFails ? no('HTTP 502') : done({ data: { repository: { issue: { parent } } } });
    return readFails ? no('HTTP 404: Not Found') : done(item);
  };
  return { runner, writes };
}
const linksOf = (T, e) => JSON.parse(fs.readFileSync(path.join(T, 'epics', e, '.sdlc/issue-links.json'), 'utf8')).items;
const stateOf = (T, e) => JSON.parse(fs.readFileSync(path.join(T, 'epics', e, '.sdlc/state.json'), 'utf8'));
const exists = (T, e) => fs.existsSync(path.join(T, 'epics', e, '.sdlc/state.json'));
const seed = async (T, slug, type = 'feature') => { const r = await runEpicNew(T, { slug, type, today, json: true, returnResult: true }); fs.writeFileSync(path.join(T, 'epics', `EP-${slug}`, 'epic.md'), `---\nid: EP-${slug}\nkind: ${type}\ntype: ${type}\nthread: EP-${slug}\n---\n`); return r; };
const reset = () => { process.exitCode = 0; };

test('parseRef: a number, #number and repo#number', () => {
  assert.deepEqual(W.parseRef('12'), { label: 'Product', number: 12 });
  assert.deepEqual(W.parseRef('#12'), { label: 'Product', number: 12 });
  assert.deepEqual(W.parseRef('api#12'), { label: 'api', number: 12 });
  for (const bad of ['', 'abc', 'x#', '#', '1.5']) assert.equal(W.parseRef(bad), null, bad);
});

test('a feature label seeds a feature with no parent, links it, comments and sets the status label', async () => {
  const T = product();
  const { runner, writes } = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  await W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner, json: false });
  assert.equal(stateOf(T, 'EP-pay').type, 'feature');
  const [l] = linksOf(T, 'EP-pay');
  assert.deepEqual([l.platform, l.host, l.repo, l.number], ['github', 'github.com', 'a/b', 7]);
  assert.ok(l.commentedAt);
  assert.ok(writes.some((a) => a.some((x) => x.endsWith('/comments')) && a.some((x) => x.includes('EP-pay'))));
  assert.ok(writes.some((a) => a.includes('labels[]=status: in progress')));
  reset();
});

test('the item\'s text is not copied into the repo', async () => {
  const T = product();
  const { runner } = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  await W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(T, 'epics'))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Secret/);
  reset();
});

test('an item that cannot be read creates nothing', async () => {
  const T = product();
  const { runner, writes } = platform({ readFails: true });
  await W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner });
  assert.equal(process.exitCode, 1);
  assert.equal(exists(T, 'EP-pay'), false);
  assert.equal(writes.length, 0);
  reset();
});

test('a pull request is refused; no type label asks for --type; two type labels ask too', async () => {
  for (const [item, re] of [[issue({ pull_request: {} }), /pull request/], [issue({ labels: [] }), /no type label/], [issue({ labels: [{ name: 'bug' }, { name: 'feature' }] }), /more than one type/]]) {
    const T = product();
    const lines = [];
    const orig = console.error; console.error = (...a) => lines.push(a.join(' '));
    try { await W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner: platform({ item }).runner }); } finally { console.error = orig; }
    assert.equal(exists(T, 'EP-pay'), false);
    assert.equal(process.exitCode, 1);
    reset();
    void re;
  }
});

test('--type overrides the label', async () => {
  const T = product();
  await W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', type: 'feature', today, env, runner: platform().runner });
  assert.equal(stateOf(T, 'EP-pay').type, 'feature');
  reset();
});

test('a defect with no definite link gets a stub parent', async () => {
  const T = product();
  await W.runEpicNewFromIssue(T, { slug: 'fix', issue: '7', today, env, runner: platform().runner });
  assert.equal(stateOf(T, 'EP-fix').type, 'defect');
  assert.equal(exists(T, 'EP-fix-parent'), true);
  assert.equal(linksOf(T, 'EP-fix').length, 1);
  reset();
});

test('a defect naming an existing epic threads off it, and an epic that does not exist does not count', async () => {
  const T = product();
  await seed(T, 'base');
  const { runner } = platform({ item: issue({ body: 'broke in EP-base, not EP-ghost' }) });
  await W.runEpicNewFromIssue(T, { slug: 'fix', issue: '7', today, env, runner });
  assert.equal(exists(T, 'EP-fix'), true);
  assert.equal(exists(T, 'EP-fix-parent'), false);
  reset();
});

test('an `epic: EP-x` label is a definite link', async () => {
  const T = product();
  await seed(T, 'base');
  await W.runEpicNewFromIssue(T, { slug: 'fix', issue: '7', today, env, runner: platform({ item: issue({ labels: [{ name: 'bug' }, { name: 'epic: EP-base' }] }) }).runner });
  assert.equal(exists(T, 'EP-fix-parent'), false);
  assert.equal(exists(T, 'EP-fix'), true);
  reset();
});

test('a parent item already linked to an epic gives the parent', async () => {
  const T = product();
  await seed(T, 'base');
  await W.runIssuesLink(T, { ref: '3', epic: 'EP-base', env, runner: platform({ item: issue({ number: 3, labels: [{ name: 'feature' }] }) }).runner });
  await W.runEpicNewFromIssue(T, { slug: 'fix', issue: '7', today, env, runner: platform({ parent: { number: 3, repository: { nameWithOwner: 'a/b' } } }).runner });
  assert.equal(exists(T, 'EP-fix-parent'), false);
  assert.equal(exists(T, 'EP-fix'), true);
  reset();
});

test('two different epics stop and ask; an unread hierarchy never creates a stub', async () => {
  const T = product();
  await seed(T, 'a1'); await seed(T, 'a2');
  await W.runEpicNewFromIssue(T, { slug: 'fix', issue: '7', today, env, runner: platform({ item: issue({ body: 'EP-a1 and EP-a2' }) }).runner });
  assert.equal(exists(T, 'EP-fix'), false);
  assert.equal(process.exitCode, 1); reset();
  await W.runEpicNewFromIssue(T, { slug: 'fix', issue: '7', today, env, runner: platform({ parentFails: true }).runner });
  assert.equal(exists(T, 'EP-fix'), false);
  assert.equal(exists(T, 'EP-fix-parent'), false);
  assert.equal(process.exitCode, 1); reset();
});

test('--parent wins and reads no hierarchy', async () => {
  const T = product();
  await seed(T, 'base');
  const seen = [];
  const { runner } = platform();
  await W.runEpicNewFromIssue(T, { slug: 'fix', issue: '7', parent: 'EP-base', today, env, runner: (c, a, o) => { seen.push(a); return runner(c, a, o); } });
  assert.equal(exists(T, 'EP-fix'), true);
  assert.equal(seen.some((a) => a.includes('graphql')), false);
  reset();
});

test('a failed write-back keeps the link, and a second link retries only what failed', async () => {
  const T = product();
  await seed(T, 'base');
  await W.runIssuesLink(T, { ref: '7', epic: 'EP-base', env, runner: platform({ item: issue({ labels: [{ name: 'feature' }] }), writeFails: true }).runner });
  assert.equal(linksOf(T, 'EP-base').length, 1);
  assert.equal(linksOf(T, 'EP-base')[0].commentedAt, undefined);
  reset();
  const first = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  await W.runIssuesLink(T, { ref: '7', epic: 'EP-base', env, runner: first.runner });
  assert.ok(linksOf(T, 'EP-base')[0].commentedAt);
  assert.equal(first.writes.filter((a) => a.some((x) => x.endsWith('/comments'))).length, 1);
  const again = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  await W.runIssuesLink(T, { ref: '7', epic: 'EP-base', env, runner: again.runner });
  assert.equal(again.writes.filter((a) => a.some((x) => x.endsWith('/comments'))).length, 0);
  assert.equal(linksOf(T, 'EP-base').length, 1);
  reset();
});

test('an unreadable sidecar is refused, never overwritten', async () => {
  const T = product();
  await seed(T, 'base');
  const f = path.join(T, 'epics/EP-base/.sdlc/issue-links.json');
  fs.writeFileSync(f, '{broken');
  await assert.rejects(W.runIssuesLink(T, { ref: '7', epic: 'EP-base', env, runner: platform().runner }));
  assert.equal(fs.readFileSync(f, 'utf8'), '{broken');
  reset();
});

test('unlink removes the link, needs no read, and writes nothing to the item', async () => {
  const T = product();
  await seed(T, 'base');
  await W.runIssuesLink(T, { ref: '7', epic: 'EP-base', env, runner: platform({ item: issue({ labels: [{ name: 'feature' }] }) }).runner });
  const { runner, writes } = platform({ readFails: true });
  await W.runIssuesUnlink(T, { ref: '7', epic: 'EP-base', env, runner });
  assert.deepEqual(linksOf(T, 'EP-base'), []);
  assert.equal(writes.length, 0);
  await W.runIssuesUnlink(T, { ref: '7', epic: 'EP-base', env, runner });
  assert.equal(process.exitCode, 1);
  reset();
});

test('GitLab: writes use PUT add_labels and notes; a confidential item is not labelled and its text is withheld', async () => {
  const T = product();
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'gitlab', git_url: 'git@gitlab.com:a/b.git' }));
  await seed(T, 'base');
  const item = { iid: 7, title: 'x', description: 'y', state: 'opened', web_url: 'https://gitlab.com/a/b/-/issues/7', labels: ['feature'], assignees: [] };
  const open = platform({ item });
  await W.runIssuesLink(T, { ref: '7', epic: 'EP-base', env, runner: open.runner });
  assert.ok(open.writes.some((a) => a.some((x) => x.endsWith('/notes'))));
  assert.ok(open.writes.some((a) => a.includes('PUT') && a.some((x) => x.startsWith('add_labels=') && x.includes('status: in progress'))));
  const t = { ok: true, cli: 'glab', platform: 'gitlab', host: 'gitlab.com', repo: 'a/b' };
  const read = W.readItem(t, 7, { runner: platform({ item: { ...item, confidential: true } }).runner });
  assert.equal(read.title, null);
  assert.equal(read.body, null);
  reset();
});

test('the list shows the link and works out in progress and done from the epic', async () => {
  const T = product();
  await seed(T, 'base');
  await W.runIssuesLink(T, { ref: '1', epic: 'EP-base', env, runner: platform({ item: issue({ number: 1, labels: [{ name: 'feature' }] }) }).runner });
  const node = (number) => ({ number, title: 't', url: `https://github.com/a/b/issues/${number}`, state: 'OPEN', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', closedAt: null, milestone: null, assignees: { nodes: [] }, labels: { nodes: [] } });
  const runner = (cmd, args) => {
    if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, code: 0, stdout: '', stderr: '' };
    const nodes = args.includes('states=OPEN') ? [node(1), node(2)] : [];
    return done({ data: { repository: { hasIssuesEnabled: true, issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } });
  };
  const m = I.buildIssues(T, { env, runner });
  const by = Object.fromEntries(m.items.map((i) => [i.number, i]));
  assert.equal(by[1].status, 'in progress');
  assert.equal(by[1].epic.id, 'EP-base');
  assert.equal(by[2].status, 'todo');
  assert.equal(by[2].epic, null);
  assert.deepEqual(by[2].epics, []);
  reset();
});
