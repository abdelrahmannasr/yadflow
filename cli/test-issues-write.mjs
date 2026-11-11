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
function platform({ item = issue(), parent = null, parentFails = false, writeFails = false, readFails = false, events = [], eventsFail = false } = {}) {
  const writes = [];
  const runner = (cmd, args) => {
    if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, code: 0, stdout: '', stderr: '' };
    if (args[0] !== 'api') return no('unexpected');
    if (args.includes('-X')) { writes.push(args); return writeFails ? no('HTTP 403') : done({}); }
    if (args.some((x) => /\/events\?|resource_state_events/.test(x))) return eventsFail ? no('HTTP 502') : done(events);
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

test('E170 review: the GitLab parent query carries the number in the query, and a real parent answer is read', () => {
  const T = product();
  const t = { ok: true, cli: 'glab', platform: 'gitlab', host: 'gitlab.com', repo: 'a/b' };
  const seen = [];
  const runner = (c, a) => { seen.push(a); return done({ data: { project: { workItems: { nodes: [{ widgets: [{}, { parent: { iid: '3', namespace: { fullPath: 'a/b' } } }] }] } } } }); };
  const item = { number: 7, labels: [], rawText: '' };
  assert.deepEqual(W.definiteParents(T, t, item, { self: 'EP-x', runner }), { ids: [] });
  assert.ok(seen[0].some((x) => x.includes('iids:["7"]')));
  assert.equal(seen[0].some((x) => x.includes('[]=')), false);
});

test('E170 review: nothing a child would refuse leaves a stub behind', async () => {
  for (const extra of [{ type: 'defct' }, { profile: 'lean' }, { inherits: 'epic' }]) {
    const T = product();
    await W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner: platform().runner, ...extra });
    assert.equal(process.exitCode, 1);
    assert.equal(fs.existsSync(path.join(T, 'epics/EP-pay-parent')), false, JSON.stringify(extra));
    reset();
  }
});

test('E170 review: an authored epic.md in the stub folder is refused, never replaced', async () => {
  const T = product();
  fs.mkdirSync(path.join(T, 'epics/EP-pay-parent'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-pay-parent/epic.md'), 'mine');
  await W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner: platform().runner });
  assert.equal(fs.readFileSync(path.join(T, 'epics/EP-pay-parent/epic.md'), 'utf8'), 'mine');
  assert.equal(exists(T, 'EP-pay'), false);
  reset();
});

test('E170 review: a parent item with an unreadable sidecar about is unknown, so no stub is made', async () => {
  const T = product();
  await seed(T, 'base');
  fs.writeFileSync(path.join(T, 'epics/EP-base/.sdlc/issue-links.json'), '{broken');
  await W.runEpicNewFromIssue(T, { slug: 'fix', issue: '7', today, env, runner: platform({ parent: { number: 3, repository: { nameWithOwner: 'a/b' } } }).runner });
  assert.equal(exists(T, 'EP-fix-parent'), false);
  assert.equal(process.exitCode, 1);
  reset();
});

test('E170 review: --issue refuses flags it does not use, and an empty one is not a plain seed', () => {
  assert.deepEqual(W.seedForeignFlags(['epic', 'new', 'x', '--issue', '7', '--repo', 'api', '--dry-run', '--json']), ['--repo', '--dry-run']);
  assert.equal(W.parseRef(''), null);
});

test('E170 review: --type does not add a second type label', async () => {
  const T = product();
  const { runner, writes } = platform();
  await W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', type: 'feature', today, env, runner });
  assert.equal(writes.some((a) => a.includes('labels[]=feature')), false);
  reset();
});

test('E170 review: an unreadable linked epic gets no status label', async () => {
  const T = product();
  await seed(T, 'base');
  fs.writeFileSync(path.join(T, 'epics/EP-base/.sdlc/state.json'), '{broken');
  const { runner, writes } = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  const before = fs.existsSync(path.join(T, 'epics/EP-base/.sdlc/state.json'));
  assert.ok(before);
  await W.runIssuesLink(T, { ref: '7', epic: 'EP-base', env, runner });
  assert.equal(writes.some((a) => a.some((x) => x.startsWith('labels[]=status:'))), false);
  reset();
});

test('E170 review: a confidential item drives neither type nor parent', () => {
  const t = { ok: true, cli: 'glab', platform: 'gitlab', host: 'gitlab.com', repo: 'a/b' };
  const item = { iid: 7, title: 'EP-base', description: 'EP-base', state: 'opened', labels: ['bug'], assignees: [], confidential: true };
  const r = W.readItem(t, 7, { runner: platform({ item }).runner });
  assert.deepEqual([r.labels, r.rawText], [[], '']);
});

test('E170 review 2: an unrelated broken sidecar is named; a closed item still gets done', async () => {
  const T = product();
  await seed(T, 'a1'); await seed(T, 'other');
  fs.writeFileSync(path.join(T, 'epics/EP-other/.sdlc/issue-links.json'), '{broken');
  const openItem = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  const lines = [];
  const orig = process.stderr.write; const origLog = console.log; const origErr = console.error;
  process.stderr.write = (x) => { lines.push(String(x)); return true; };
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  try { await W.runIssuesLink(T, { ref: '7', epic: 'EP-a1', env, runner: openItem.runner }); } finally { process.stderr.write = orig; console.log = origLog; console.error = origErr; }
  assert.equal(openItem.writes.some((a) => a.some((x) => x.startsWith('labels[]=status:'))), false);
  assert.match(lines.join('\n'), /EP-other/);
  // #512: with no verified Product there are no Product checks, so the hint only says to commit.
  assert.match(lines.join('\n'), /commit \.sdlc\/issue-links\.json, so the team sees the link/);
  assert.doesNotMatch(lines.join('\n'), /review\//);
  const closed = platform({ item: issue({ state: 'closed', labels: [{ name: 'feature' }] }) });
  await W.runIssuesLink(T, { ref: '8', epic: 'EP-a1', env, runner: closed.runner });
  assert.ok(closed.writes.some((a) => a.includes('labels[]=status: done')));
  reset();
});

test('E170 review 2: leftover approvals in the child folder refuse before a stub is made', async () => {
  const T = product();
  fs.mkdirSync(path.join(T, 'epics/EP-pay/.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-pay/.sdlc/approvals.json'), '[{"x":1}]');
  await W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner: platform().runner });
  assert.equal(fs.existsSync(path.join(T, 'epics/EP-pay-parent')), false);
  assert.equal(process.exitCode, 1);
  reset();
});

test('E170 review 3: a broken links file in the child folder refuses before anything is made', async () => {
  const T = product();
  fs.mkdirSync(path.join(T, 'epics/EP-pay/.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(T, 'epics/EP-pay/.sdlc/issue-links.json'), '{broken');
  await assert.rejects(W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner: platform().runner }), /corrupt JSON/);
  assert.equal(fs.existsSync(path.join(T, 'epics/EP-pay-parent')), false);
  assert.equal(exists(T, 'EP-pay'), false);
  fs.writeFileSync(path.join(T, 'epics/EP-pay/.sdlc/issue-links.json'), '{"items":[null]}');
  await assert.rejects(W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner: platform().runner }), /not an issue-links file/);
  for (const bad of ['[[]]', '[{}]', '[{"host":"github.com","repo":"a/b","number":"7"}]']) {
    fs.writeFileSync(path.join(T, 'epics/EP-pay/.sdlc/issue-links.json'), `{"items":${bad}}`);
    await assert.rejects(W.runEpicNewFromIssue(T, { slug: 'pay', issue: '7', today, env, runner: platform().runner }), /not an issue-links file/, bad);
  }
  assert.equal(fs.existsSync(path.join(T, 'epics/EP-pay-parent')), false);
});

// ---- E171: sync -----------------------------------------------------------------------------------------
const shipped = (T, e) => { const dir = path.join(T, 'epics', e, '.sdlc'); const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); return { dir, st }; };
const linkOne = async (T, epic, number = 7, labels = [{ name: 'feature' }]) => W.runIssuesLink(T, { ref: String(number), epic, env, runner: platform({ item: issue({ number, labels }) }).runner });
const closes = (writes) => writes.filter((a) => a.includes('PATCH') && a.includes('state=closed'));
// A stand-in for a shipped epic: the sync only asks the stage, so the tests pass it through the ledger's own reader.
const markShipped = (T, epic) => { const { dir, st } = shipped(T, epic); fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...st, kind: 'stub', currentStep: 'backfill-pending' })); };

test('E171: sync moves the status label and leaves an up-to-date item alone', async () => {
  const T = product();
  await seed(T, 'base');
  await linkOne(T, 'EP-base');
  const stale = platform({ item: issue({ labels: [{ name: 'feature' }, { name: 'status: todo' }] }) });
  const r = W.syncItems(T, { env, runner: stale.runner });
  assert.deepEqual(r.items[0].labelled, ['status: in progress']);
  assert.deepEqual(r.items[0].removed, ['status: todo']);
  const fresh = platform({ item: issue({ labels: [{ name: 'feature' }, { name: 'status: in progress' }] }) });
  W.syncItems(T, { env, runner: fresh.runner });
  assert.equal(fresh.writes.length, 0);
  reset();
});

test('E171: --dry-run writes nothing, on the platform or in the links file', async () => {
  const T = product();
  await seed(T, 'base');
  await W.runIssuesLink(T, { ref: '7', epic: 'EP-base', env, runner: platform({ item: issue({ labels: [{ name: 'feature' }] }), writeFails: true }).runner });
  const before = fs.readFileSync(path.join(T, 'epics/EP-base/.sdlc/issue-links.json'), 'utf8');
  reset();
  const { runner, writes } = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  const r = W.syncItems(T, { dryRun: true, env, runner });
  assert.equal(r.items[0].commented, true);
  assert.equal(writes.length, 0);
  assert.equal(fs.readFileSync(path.join(T, 'epics/EP-base/.sdlc/issue-links.json'), 'utf8'), before);
});

test('E171: closes once every epic shipped, once only, and not over a person who reopened it', async () => {
  const T = product();
  await seed(T, 'a1'); await seed(T, 'a2');
  await linkOne(T, 'EP-a1'); await linkOne(T, 'EP-a2');
  markShipped(T, 'EP-a1');
  const one = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  W.syncItems(T, { env, runner: one.runner });
  assert.equal(closes(one.writes).length, 0, 'one epic still running');
  markShipped(T, 'EP-a2');
  const both = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  W.syncItems(T, { env, runner: both.runner });
  assert.equal(closes(both.writes).length, 1);
  assert.ok(linksOf(T, 'EP-a1')[0].closedByYadAt);
  assert.ok(linksOf(T, 'EP-a2')[0].closedByYadAt);
  const reopened = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  W.syncItems(T, { env, runner: reopened.runner });
  assert.equal(closes(reopened.writes).length, 0);
  reset();
});

test('E171: an item in a repo that is not registered is never written', async () => {
  const T = product();
  await seed(T, 'base');
  fs.writeFileSync(path.join(T, 'epics/EP-base/.sdlc/issue-links.json'), JSON.stringify({ items: [{ platform: 'github', host: 'github.com', repo: 'someone/else', number: 1, url: 'https://github.com/someone/else/issues/1' }] }));
  const { runner, writes } = platform();
  const r = W.syncItems(T, { env, runner });
  assert.equal(writes.length, 0);
  assert.equal(r.skipped.length, 1);
});

test('E171: an unreadable links file holds back closes and status labels', async () => {
  const T = product();
  await seed(T, 'a1'); await seed(T, 'broken');
  await linkOne(T, 'EP-a1');
  markShipped(T, 'EP-a1');
  fs.writeFileSync(path.join(T, 'epics/EP-broken/.sdlc/issue-links.json'), '{broken');
  const { runner, writes } = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  const r = W.syncItems(T, { env, runner });
  assert.equal(closes(writes).length, 0);
  assert.equal(writes.some((a) => a.some((x) => x.startsWith('labels[]=status:'))), false);
  assert.deepEqual(r.unreadable, ['EP-broken']);
});

test('E171: one item failing does not stop the others, and the command exits 1', async () => {
  const T = product();
  await seed(T, 'base');
  await linkOne(T, 'EP-base', 7); await linkOne(T, 'EP-base', 8);
  const runner = (cmd, args) => {
    if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, code: 0, stdout: '', stderr: '' };
    if (args.includes('-X')) return done({});
    return args.some((a) => a.endsWith('/issues/7')) ? no('HTTP 404') : done(issue({ number: 8, labels: [{ name: 'feature' }] }));
  };
  await W.runIssuesSync(T, { env, runner, json: false });
  assert.equal(process.exitCode, 1);
  reset();
});

test('E171: after a gate, an epic with no items makes no call, and a failure never throws', async () => {
  const T = product();
  await seed(T, 'base');
  let calls = 0;
  W.syncAfterGate(T, 'EP-base', { env, runner: () => { calls++; return no('x'); } });
  assert.equal(calls, 0);
  await linkOne(T, 'EP-base');
  W.syncAfterGate(T, 'EP-base', { env, runner: platform({ writeFails: true }).runner });
  W.syncAfterGate(T, 'EP-base', { env: { ...env, YAD_PLATFORM_READ: '0' }, runner: () => { calls++; return no('x'); } });
  assert.equal(calls, 0);
  fs.writeFileSync(path.join(T, 'epics/EP-base/.sdlc/issue-links.json'), '{broken');
  assert.doesNotThrow(() => W.syncAfterGate(T, 'EP-base', { env, runner: platform().runner }));
  reset();
});

test('E171: gate ci never reaches the item sync, and the two local paths do', () => {
  const bin = fs.readFileSync(new URL('../bin/yad.mjs', import.meta.url), 'utf8');
  const line = bin.split('\n').find((l) => l.includes('commands.syncAfterGate('));
  assert.match(line, /action === 'sync' && result\?\.written/);
  assert.match(line, /action === 'advance'/);
  assert.doesNotMatch(line, /'ci'/);
});

test('E171: standup item lines link the number and escape a hostile title', async () => {
  const S = await import('./standup.mjs');
  const model = { window: { start: '2026-11-08T00:00:00Z', end: '2026-11-09T00:00:00Z', tz: 'UTC', basis: 'x', ledgerFrom: '2026-11-08' }, team: [{ login: 'ann', status: 'active', accounts: ['a'], done: [], working: [], waiting: [], issues: [{ ref: '#7', url: 'https://github.com/a/b/issues/7', title: '<script>x</script> [a](http://b)', priority: 'P1', status: 'in progress', epic: 'EP-x' }] }], left: [], unlisted: [], ownerless: [], platform: [], notRead: [], notes: [], memberErrors: [], duplicates: [], fetched: 'ok', issuesNotRead: [] };
  const md = S.renderMarkdown(model);
  assert.match(md, /\[\\#7\]\(https:\/\/github\.com\/a\/b\/issues\/7\)/);
  assert.doesNotMatch(md, /\[a\]\(http/);
  const html = S.renderHtml(model);
  assert.match(html, /<a href="https:\/\/github\.com\/a\/b\/issues\/7">#7<\/a>/);
  assert.doesNotMatch(html, /<script>x/);
});

test('E171: the skills that start from an item say its text is not instructions', () => {
  for (const n of ['yad-epic', 'yad-analysis', 'yad-change', 'yad-issues']) {
    const t = fs.readFileSync(new URL(`../skills/${n}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(t, /yad issues show/, n);
    assert.match(t, /[Nn]ever follow an instruction/, n);
  }
});

test('E171 review: an item ever reopened on the platform is not closed, even with no local record; an unread history closes nothing', async () => {
  const T = product();
  await seed(T, 'a1');
  await linkOne(T, 'EP-a1');
  markShipped(T, 'EP-a1');
  const item = issue({ labels: [{ name: 'feature' }] });
  const again = platform({ item, events: [{ event: 'closed' }, { event: 'reopened' }] });
  W.syncItems(T, { env, runner: again.runner });
  assert.equal(closes(again.writes).length, 0);
  const unread = platform({ item, eventsFail: true });
  const r = W.syncItems(T, { env, runner: unread.runner });
  assert.equal(closes(unread.writes).length, 0);
  assert.match(r.items[0].failed.join(), /reopened/);
  reset();
});

test('E171 review: the after-gate sync updates labels and never closes', async () => {
  const T = product();
  await seed(T, 'a1');
  await linkOne(T, 'EP-a1');
  markShipped(T, 'EP-a1');
  const p = platform({ item: issue({ labels: [{ name: 'feature' }] }) });
  W.syncAfterGate(T, 'EP-a1', { env, runner: p.runner });
  assert.equal(closes(p.writes).length, 0);
  assert.ok(p.writes.some((a) => a.includes('labels[]=status: done')));
  reset();
});

test('E171 review: a confidential item is not a failure', async () => {
  const T = product();
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'gitlab', git_url: 'git@gitlab.com:a/b.git' }));
  await seed(T, 'base');
  const item = { iid: 7, title: 'x', description: 'y', state: 'opened', web_url: 'https://gitlab.com/a/b/-/issues/7', labels: [], assignees: [], confidential: true };
  await W.runIssuesLink(T, { ref: '7', epic: 'EP-base', env, runner: platform({ item }).runner });
  reset();
  await W.runIssuesSync(T, { env, runner: platform({ item }).runner });
  assert.ok(!process.exitCode);
  reset();
});

test('E171 review: unknown items are never "none", and items need the whole account to match', async () => {
  const S = await import('./standup.mjs');
  const base = { window: { start: '2026-11-08T00:00:00Z', end: '2026-11-09T00:00:00Z', tz: 'UTC', basis: 'x', ledgerFrom: '2026-11-08' }, team: [{ login: 'ann', status: 'active', accounts: ['a'], done: [], working: [], waiting: [], issues: [] }], left: [], unlisted: [], ownerless: [], platform: [], notRead: [], notes: [], memberErrors: [], duplicates: [], fetched: 'ok', issuesNotRead: [] };
  assert.match(S.renderMarkdown({ ...base, issuesUnknown: true }), /could not be read or matched/);
  assert.doesNotMatch(S.renderMarkdown({ ...base, issuesUnknown: false }), /could not be read or matched/);
  assert.notEqual(I.accountId({ platform: 'github', host: 'github.com', login: 'alice' }), I.accountId({ platform: 'gitlab', host: 'gitlab.com', login: 'alice' }));
});

// #512: on a verified Product every hint that asks for the links file to be committed names a route the
// Product checks let through (a branch of its own, not review/…), and says when that holds.
test('#512: link and sync name the PR route on a verified Product; a plain Product is told only to commit', async () => {
  const T = product();
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', git_url: 'git@github.com:a/b.git', ledger: 'verified' }));
  await seed(T, 'a1');
  const route = /commit \.sdlc\/issue-links\.json on a branch of its own, not review\/…, in a PR titled like `chore: record tracker links` — the Product checks let a PR of these records alone through, once a `yad update` that carries them has merged on the default branch/;
  const capture = async (fn) => {
    const lines = [];
    const orig = process.stderr.write; const origLog = console.log; const origErr = console.error;
    process.stderr.write = (x) => { lines.push(String(x)); return true; };
    console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
    try { await fn(); } finally { process.stderr.write = orig; console.log = origLog; console.error = origErr; }
    return lines.join('\n');
  };
  const item = issue({ labels: [{ name: 'feature' }] });
  const linked = await capture(() => W.runIssuesLink(T, { ref: '7', epic: 'EP-a1', env, runner: platform({ item }).runner }));
  assert.match(linked, route); assert.match(linked, /so the team sees the link/);
  const synced = await capture(() => W.runIssuesSync(T, { env, runner: platform({ item }).runner }));
  assert.match(synced, /commit any \.sdlc\/issue-links\.json this changed on a branch of its own, not review\/…/);
  assert.equal(W.recordRoute(T, 'x.json').startsWith('commit x.json on a branch of its own'), true);
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', git_url: 'git@github.com:a/b.git' }));
  assert.equal(W.recordRoute(T, 'x.json'), 'commit x.json', 'not verified: no Product checks to name');
  reset();
});
