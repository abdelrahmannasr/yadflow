// `yad issues` (E169): the team's GitHub issues and GitLab issues/tasks/incidents. The rules each test pins:
//   - paging is real, a page that fails later is "incomplete", and a repo that fails first is "not read";
//   - priority and type come from labels the team can rename; status comes from facts, never a label;
//   - a title is hostile: it is escaped in every output and never reaches the page's script;
//   - a GitLab confidential item keeps its number and loses its title.
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

const I = await import('./issues.mjs');
const env = { PATH: process.env.PATH };
const NOW = Date.parse('2026-11-09T09:00:00Z');
const ok = (body) => ({ ok: true, code: 0, stdout: JSON.stringify(body), stderr: '' });
const no = (stderr) => ({ ok: false, code: 1, stdout: '', stderr });
const auth = (cmd, args) => (cmd === 'which' || cmd === 'where' || args[0] === 'auth' ? { ok: true, code: 0, stdout: '', stderr: '' } : null);
const ghNode = (number, over = {}) => ({ number, title: `t${number}`, url: `https://github.com/a/b/issues/${number}`, state: 'OPEN', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', closedAt: null, milestone: null, assignees: { nodes: [] }, labels: { nodes: [] }, ...over });
const ghPage = (nodes, next = null) => ok({ data: { repository: { hasIssuesEnabled: true, issues: { pageInfo: { hasNextPage: !!next, endCursor: next }, nodes } } } });
const glNode = (iid, over = {}) => ({ iid, title: `t${iid}`, web_url: `https://gitlab.com/a/b/-/issues/${iid}`, state: 'opened', issue_type: 'issue', labels: [], assignees: [], created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', closed_at: null, due_date: null, confidential: false, ...over });
const stateOf = (args) => args.find((a) => a.startsWith('states='))?.slice(7);

function product(cfg = {}, repos = []) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-issues-'));
  fs.mkdirSync(path.join(T, '.sdlc'));
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', git_url: 'git@github.com:a/b.git', ...cfg }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos }));
  return T;
}
const ghTarget = { ok: true, cli: 'gh', platform: 'github', host: 'github.com', repo: 'a/b' };
const glTarget = { ok: true, cli: 'glab', platform: 'gitlab', host: 'gitlab.com', repo: 'a/b' };
const since = NOW - 30 * 86_400_000;

test('GitHub: follows the cursor through every page, open and closed', () => {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push(args);
    if (stateOf(args) === 'CLOSED') return ghPage([ghNode(9, { state: 'CLOSED', closedAt: '2026-11-03T00:00:00Z' })]);
    return args.some((a) => a === 'cursor=c1') ? ghPage([ghNode(2)]) : ghPage([ghNode(1)], 'c1');
  };
  const r = I.listTrackerItems(ghTarget, { closedSinceMs: since, runner });
  assert.deepEqual(r.items.map((i) => [i.number, i.state]), [[1, 'open'], [2, 'open'], [9, 'closed']]);
  assert.equal(r.partial, false);
  assert.equal(calls.length, 3);
});

test('GitHub: an item closed before the window was only updated in it, and is left out', () => {
  const runner = (c, args) => (stateOf(args) === 'CLOSED' ? ghPage([ghNode(9, { state: 'CLOSED', closedAt: '2026-01-01T00:00:00Z' })]) : ghPage([]));
  assert.deepEqual(I.listTrackerItems(ghTarget, { closedSinceMs: since, runner }).items, []);
});

test('a first page that fails is not read; a later page that fails is incomplete, never empty', () => {
  const dead = () => no('gh: Forbidden (HTTP 403)');
  const r = I.listTrackerItems(ghTarget, { closedSinceMs: since, runner: dead });
  assert.equal(r.ok, false);
  assert.match(r.why, /403/);
  const later = (c, args) => (args.some((a) => a === 'cursor=c1') ? no('gh: Bad gateway (HTTP 502)') : stateOf(args) === 'OPEN' ? ghPage([ghNode(1)], 'c1') : ghPage([]));
  const p = I.listTrackerItems(ghTarget, { closedSinceMs: since, runner: later });
  assert.equal(p.ok, true);
  assert.equal(p.partial, true);
  assert.match(p.why, /502/);
  assert.equal(p.items.length, 1);
});

test('the closed list failing leaves the open items and says so', () => {
  const runner = (c, args) => (stateOf(args) === 'CLOSED' ? no('gh: x (HTTP 500)') : ghPage([ghNode(1)]));
  const r = I.listTrackerItems(ghTarget, { closedSinceMs: since, runner });
  assert.equal(r.items.length, 1);
  assert.equal(r.partial, true);
  assert.match(r.why, /closed items were not read/);
});

test('GitHub with issues turned off is said, and is no error', () => {
  const r = I.listTrackerItems(ghTarget, { closedSinceMs: since, runner: () => ok({ data: { repository: { hasIssuesEnabled: false, issues: null } } }) });
  assert.equal(r.off, true);
  assert.deepEqual(r.items, []);
});

test('GitLab: pages until a short page, keeps the kind and the due date, asks the named host', () => {
  const seen = [];
  const full = Array.from({ length: 100 }, (_, n) => glNode(n + 1));
  const runner = (c, args) => {
    seen.push(args);
    const at = args[3];
    if (at.includes('state=closed')) return ok([]);
    return at.endsWith('page=1') ? ok(full) : ok([glNode(101, { issue_type: 'task', due_date: '2026-12-01' })]);
  };
  const r = I.listTrackerItems({ ...glTarget, host: 'git.acme.dev' }, { closedSinceMs: since, runner });
  assert.equal(r.items.length, 101);
  assert.equal(r.items[100].kind, 'task');
  assert.equal(r.items[100].due, '2026-12-01');
  assert.ok(seen.every((a) => a[1] === '--hostname' && a[2] === 'git.acme.dev'));
});

test('GitLab: a confidential item loses its title and labels', () => {
  const runner = (c, args) => (args[3].includes('state=closed') ? ok([]) : ok([glNode(5, { confidential: true, title: 'ACME CORP outage', labels: ['customer: acme'] })]));
  const [i] = I.listTrackerItems(glTarget, { closedSinceMs: since, runner }).items;
  assert.doesNotMatch(i.title, /ACME/);
  assert.deepEqual(i.labels, []);
  assert.equal(i.number, 5);
});

test('the limit is stated: reading stops and the list is incomplete', () => {
  const page = Array.from({ length: 100 }, (_, n) => glNode(n + 1));
  const r = I.listTrackerItems(glTarget, { closedSinceMs: since, runner: (c, args) => (args[3].includes('state=closed') ? ok([]) : ok(page)) });
  assert.equal(r.items.length, I.MAX_ITEMS);
  assert.equal(r.partial, true);
});

test('status comes from facts: every row of the table', () => {
  assert.deepEqual(I.itemStatus('open', null), { status: 'todo', flags: [] });
  for (const s of ['planned', 'in-shape', 'in-build']) assert.deepEqual(I.itemStatus('open', s), { status: 'in progress', flags: [] });
  assert.deepEqual(I.itemStatus('open', 'shipped'), { status: 'done', flags: ['epic shipped, item still open'] });
  assert.deepEqual(I.itemStatus('closed', null), { status: 'done', flags: [] });
  assert.deepEqual(I.itemStatus('closed', 'in-build'), { status: 'done', flags: ['closed, epic still running'] });
  assert.deepEqual(I.itemStatus('closed', 'shipped'), { status: 'done', flags: [] });
});

const single = (nodes, repoLevel) => (cmd, args) => auth(cmd, args) || (args.includes('remote') ? no('') : stateOf(args) === 'CLOSED' ? ghPage([]) : (repoLevel?.(args) ?? ghPage(nodes)));
const label = (...names) => ({ labels: { nodes: names.map((name) => ({ name })) } });

test('labels decide priority and type, case-insensitive; a stale status label changes nothing', () => {
  const T = product();
  const m = I.buildIssues(T, { now: NOW, env, runner: single([ghNode(1, label('Priority: P1', 'BUG', 'status: done')), ghNode(2, label('P0', 'type: feature')), ghNode(3)]) });
  const by = Object.fromEntries(m.items.map((i) => [i.number, i]));
  assert.deepEqual([by[1].priority, by[1].type, by[1].status], ['P1', 'bug', 'todo']);
  assert.deepEqual([by[2].priority, by[2].type], ['P0', 'feature']);
  assert.deepEqual([by[3].priority, by[3].type], [null, null]);
  assert.deepEqual(m.items.map((i) => i.number), [2, 1, 3]);
});

test('settings rename a value; a bad setting is reported and ignored', () => {
  const T = product({ issues: { priority: { P1: ['urgent'], P9: ['x'] }, type: { bug: 'nope' } } });
  const m = I.buildIssues(T, { now: NOW, env, runner: single([ghNode(1, label('urgent')), ghNode(2, label('priority: P1', 'bug'))]) });
  const by = Object.fromEntries(m.items.map((i) => [i.number, i]));
  assert.equal(by[1].priority, 'P1');
  assert.equal(by[2].priority, null);
  assert.equal(by[2].type, 'bug');
  assert.equal(m.notes.length, 2);
});

test('two priority labels: the most urgent wins and the item is flagged', () => {
  const m = I.buildIssues(product(), { now: NOW, env, runner: single([ghNode(1, label('P3', 'P1'))]) });
  assert.equal(m.items[0].priority, 'P1');
  assert.deepEqual(m.items[0].flags, ['more than one priority label']);
});

test('a repo that cannot be read is listed, the others are kept, and a monorepo is asked once', () => {
  const T = product({}, [{ name: 'same', git_url: 'git@github.com:a/b.git' }, { name: 'gone', git_url: 'git@github.com:a/gone.git' }, { name: 'nourl', git_url: null }]);
  let asked = 0;
  const runner = (cmd, args) => {
    const a = auth(cmd, args);
    if (a) return a;
    if (args.includes('name=gone')) return no('gh: Not Found (HTTP 404)');
    if (args.includes('name=b')) asked++;
    return stateOf(args) === 'CLOSED' ? ghPage([]) : ghPage([ghNode(1)]);
  };
  const m = I.buildIssues(T, { now: NOW, env, runner });
  assert.equal(m.items.length, 1);
  assert.equal(asked, 2);
  assert.equal(m.notRead.length, 2);
  assert.match(m.notRead[0], /^gone: not read/);
  assert.match(m.notRead[1], /^nourl: not read/);
});

const it = (over) => ({ ref: '#1', repo: 'Product', platform: 'github', host: 'github.com', number: 1, title: 't', url: 'https://x.test/1', state: 'open', kind: 'issue', priority: null, type: null, labels: [], assignees: [], created: '2026-11-01', updated: '2026-11-02', closed: null, due: null, confidential: false, status: 'todo', epic: null, flags: [], ...over });

test('filters: priority, type, status, assignee by login or member, none, dates only when set', () => {
  const items = [
    it({ ref: 'a', priority: 'P0', type: 'bug', assignees: [{ login: 'sam-gh', member: 'sam' }], due: '2026-12-01' }),
    it({ ref: 'b', priority: 'P1', type: 'feature', status: 'done', created: '2026-10-01' }),
    it({ ref: 'c', type: 'enhancement', assignees: [{ login: 'lee', member: null }] }),
  ];
  const refs = (f) => I.applyFilters(items, f).map((i) => i.ref);
  assert.deepEqual(refs({ priority: 'p0,none' }), ['a', 'c']);
  assert.deepEqual(refs({ type: 'feature' }), ['b']);
  assert.deepEqual(refs({ status: 'done' }), ['b']);
  assert.deepEqual(refs({ assignee: 'SAM' }), ['a']);
  assert.deepEqual(refs({ assignee: 'sam-gh' }), ['a']);
  assert.deepEqual(refs({ assignee: 'none' }), ['b']);
  assert.deepEqual(refs({ since: '2026-11-01' }), ['a', 'c']);
  assert.deepEqual(refs({ date: 'due', until: '2026-12-31' }), ['a']);
  assert.deepEqual(refs({ mine: new Map([['github\0github.com', 'LEE']]) }), ['c']);
});

test('sorts: an item with no value comes last', () => {
  const items = [it({ ref: 'n' }), it({ ref: 'd', due: '2026-12-01', type: 'feature' }), it({ ref: 'b', type: 'bug', priority: 'P2', status: 'done' })];
  assert.deepEqual(I.applyFilters([...items], { sort: 'due' }).map((i) => i.ref)[0], 'd');
  assert.deepEqual(I.applyFilters([...items], { sort: 'type' }).map((i) => i.ref), ['b', 'd', 'n']);
  assert.deepEqual(I.applyFilters([...items], { sort: 'status' }).map((i) => i.ref).at(-1), 'b');
});

const HOSTILE = '</script><script>alert(1)</script> <img src=x onerror=alert(2)> [x](javascript:alert(3)) `c` | y';
const model = (over = {}) => ({ items: [it({ title: HOSTILE, assignees: [{ login: '"><b>', member: null }], flags: ['<i>'], url: 'https://x.test/1"onclick="a' })], summary: I.summarize([]), notRead: ['<u>repo</u>: not read'], notes: [], closedSince: '2026-10-10', ...over });

test('HTML: a hostile title, login, note and URL stay text; no item text reaches the script', () => {
  const html = I.renderHtml(model());
  assert.doesNotMatch(html, /<img|<script>alert|<b>|<u>|<i>/);
  assert.ok(html.includes('&lt;/script&gt;'));
  assert.equal(html.toLowerCase().split('<script').length - 1, 1, 'one script tag, in any case and with any attributes');
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.doesNotMatch(script, /alert|innerHTML|insertAdjacent|document\.write|eval\(/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /Check this report before sharing/);
});

test('HTML: a URL that is not http(s) never reaches a link, from either platform', () => {
  for (const [target, node] of [[ghTarget, ghNode(1, { url: 'javascript:alert(1)' })], [glTarget, glNode(1, { web_url: 'javascript:alert(1)' })]]) {
    const runner = (c, args) => (String(args.at(-1)).includes('CLOSED') || args.some((a) => a === 'states=CLOSED' || String(a).includes('state=closed')) ? (target === ghTarget ? ghPage([]) : ok([])) : (target === ghTarget ? ghPage([node]) : ok([node])));
    const [i] = I.listTrackerItems(target, { closedSinceMs: since, runner }).items;
    assert.equal(i.url, null);
    assert.doesNotMatch(I.renderHtml(model({ items: [it({ url: i.url })] })), /href=/);
  }
});

test('Markdown: a hostile title cannot make a link, an image, a tag or a new column', () => {
  const md = I.renderMarkdown(model());
  const row = md.split('\n').find((l) => l.includes('onerror'));
  assert.ok(row.includes('\\[x\\]\\(javascript\\:alert\\(3\\)\\)'));
  assert.ok(row.includes('\\<img'));
  assert.ok(row.includes('y |'));
  assert.equal(row.split(/(?<!\\)\|/).length, 11, 'nine columns (#514 added Labels), nothing more');
});

test('terminal: control characters in a title never reach the output', () => {
  const runner = (c, args) => (stateOf(args) === 'CLOSED' ? ghPage([]) : ghPage([ghNode(1, { title: 'a\u001b[31mb\u202ec\nd' })]));
  const [i] = I.listTrackerItems(ghTarget, { closedSinceMs: since, runner }).items;
  assert.ok(!['\u001b', '\u202e', '\n'].some((ch) => i.title.includes(ch)));
});

test('--me filters by the login on each host, and refuses when no login is known', async () => {
  const T = product();
  const runner = single([ghNode(1, { assignees: { nodes: [{ login: 'Me' }] } }), ghNode(2)]);
  const r = await I.runIssuesList(T, { me: true, json: true, now: NOW, env, runner, loginOf: () => 'me' });
  assert.deepEqual(r.items.map((i) => i.number), [1]);
  process.exitCode = 0;
  const none = await I.runIssuesList(T, { me: true, json: true, now: NOW, env, runner, loginOf: () => null });
  assert.equal(none, undefined);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test('refuses an unknown value, format, date or closed window before asking anything', async () => {
  const T = product();
  const runner = () => { throw new Error('asked the platform'); };
  for (const o of [{ priority: 'P9' }, { type: 'epic' }, { status: 'blocked' }, { sort: 'x' }, { date: 'x' }, { format: 'pdf' }, { since: 'soon' }, { closedSince: 'x' }, { assignee: 'a', me: true }]) {
    assert.equal(await I.runIssuesList(T, { ...o, json: true, now: NOW, env, runner }), undefined, JSON.stringify(o));
  }
  process.exitCode = 0;
});

test('--json keeps every key on an item, null when unknown, and names the untrusted fields', async () => {
  const r = await I.runIssuesList(product(), { json: true, now: NOW, env, runner: single([ghNode(1)]) });
  for (const k of ['priority', 'type', 'due', 'epic', 'closed']) assert.equal(r.items[0][k], null, k);
  assert.deepEqual(r.untrustedFields, ['title', 'labels']);
});

test('--format html writes the file; --out chooses the format', async () => {
  const T = product();
  const out = path.join(T, 'x/report.html');
  const r = await I.runIssuesList(T, { out, json: true, now: NOW, env, runner: single([ghNode(1)]) });
  assert.equal(r.out, out);
  assert.match(fs.readFileSync(out, 'utf8'), /^<!doctype html>/);
});

test('labels: creates only what no accepted spelling covers, on each host in its colour form', async () => {
  const T = product();
  const posted = [];
  const runner = (cmd, args) => {
    const a = auth(cmd, args);
    if (a) return a;
    if (args.includes('POST')) { posted.push(args); return ok({}); }
    if (args.includes('remote')) return no('');
    return ok([{ name: 'P0' }, { name: 'priority: p1' }, { name: 'priority: P2' }, { name: 'type: bug' }]);
  };
  const r = await I.runIssuesLabels(T, { json: true, env, runner });
  assert.deepEqual(r.repos[0].created.sort(), ['enhancement', 'feature', 'priority: P3', 'security', 'status: done', 'status: in progress', 'status: todo', 'suggestion', 'tech-debt'].sort());
  assert.ok(posted.every((a) => a.includes('--hostname') && a.some((x) => /^color=[0-9a-f]{6}$/.test(x))));
  posted.length = 0;
  const d = await I.runIssuesLabels(T, { dryRun: true, json: true, env, runner });
  assert.equal(posted.length, 0);
  assert.equal(d.repos[0].missing.length, 9);
});

test('labels: a repo that cannot be read creates nothing and fails the command', async () => {
  const T = product();
  const runner = (cmd, args) => auth(cmd, args) || (args.includes('POST') ? assert.fail('created') : no('gh: Forbidden (HTTP 403)'));
  process.exitCode = 0;
  const r = await I.runIssuesLabels(T, { json: true, env, runner });
  assert.equal(r.repos[0].read, false);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test('the review lines: a bad registry is not read, and labels fails on it', async () => {
  const T = product();
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), '{not json');
  const m = I.buildIssues(T, { now: NOW, env, runner: single([]) });
  assert.equal(m.notRead.length, 1);
  process.exitCode = 0;
  const runner = (cmd, args) => auth(cmd, args) || (args.includes('remote') ? no('') : ok([]));
  const r = await I.runIssuesLabels(T, { dryRun: true, json: true, env, runner });
  assert.equal(r.notRead.length, 1);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test('--me says which host it could not place, and never hides that silently', async () => {
  const T = product({}, [{ name: 'other', git_url: 'git@ghe.acme.dev:a/c.git', platform: 'github' }]);
  const runner = (cmd, args) => auth(cmd, args) || (args.includes('remote') ? no('') : stateOf(args) === 'CLOSED' ? ghPage([]) : ghPage([ghNode(1, { assignees: { nodes: [{ login: 'me' }] } })]));
  const r = await I.runIssuesList(T, { me: true, json: true, now: NOW, env, runner, loginOf: (root, p, { host }) => (host === 'github.com' ? 'me' : null) });
  assert.deepEqual(r.items.map((i) => i.ref), ['#1']);
  assert.match(r.notes.join(), /ghe\.acme\.dev/);
});

test('refuses a list for --sort or --date, an impossible date, and an unknown --repo', async () => {
  const T = product();
  const runner = single([ghNode(1)]);
  for (const o of [{ sort: 'priority,due' }, { date: 'created,due' }, { since: '2026-13-45' }, { until: '2026-02-31' }, { closedSince: '2026-02-31' }, { repo: 'typo' }]) {
    assert.equal(await I.runIssuesList(T, { ...o, json: true, now: NOW, env, runner }), undefined, JSON.stringify(o));
  }
  process.exitCode = 0;
  assert.equal((await I.runIssuesList(T, { repo: 'product', json: true, now: NOW, env, runner })).items.length, 1);
});

test('Markdown: automatic links are broken, and a URL cannot end its link or cell', () => {
  const e = I.mdEscape('see https://evil.example www.evil.example a@evil.example');
  assert.doesNotMatch(e, /https:\/\/|www\.|a@/);
  const md = I.renderMarkdown(model({ items: [it({ url: 'https://x.test/1(a)|b' })] }));
  assert.ok(md.includes('https://x.test/1%28a%29%7Cb)'));
});

test('the closed window starts at the top of the day it names', () => {
  const asked = [];
  const runner = (c, args) => { asked.push(...args); return ghPage([]); };
  I.listTrackerItems(ghTarget, { closedSinceMs: Date.parse('2026-10-10T15:00:00Z'), runner });
  assert.ok(asked.includes('since=2026-10-10T00:00:00.000Z'));
});

test('a GitLab login is asked of the host named; a call with no host is unchanged', async () => {
  const { platformLogin } = await import('./platform.mjs');
  const seen = [];
  const runner = (c, args) => { seen.push(args); return ok({ username: 'a' }); };
  assert.equal(platformLogin('/x', 'gitlab', { runner, env, host: 'git.acme.dev' }), 'a');
  platformLogin('/x', 'gitlab', { runner, env });
  assert.deepEqual(seen, [['api', '--hostname', 'git.acme.dev', 'user'], ['api', 'user']]);
});

test('an unreadable registry: --repo is not refused, and the report says why', async () => {
  const T = product();
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), '{not json');
  const r = await I.runIssuesList(T, { repo: 'api', json: true, now: NOW, env, runner: single([]) });
  assert.equal(r.registryUnread, true);
  assert.equal(r.notRead.length, 1);
  assert.deepEqual(r.items, []);
});

test('Markdown: www. after a word-joining character is still broken', () => {
  assert.doesNotMatch(I.mdEscape('_www.evil.com'), /www\./);
  assert.ok(I.mdEscape('awww.good').includes('awww.good'));
});

// ---- #514: any label — filter on it and show it ----------------------------------------------------

test('#514: --label needs every value, a comma list inside one value needs any, whole names in any case', () => {
  const items = [
    it({ ref: 'a', labels: ['Frontend', 'urgent'] }),
    it({ ref: 'b', labels: ['frontend'] }),
    it({ ref: 'c', labels: ['backend', 'urgent'] }),
    it({ ref: 'd', labels: ['frontend-old'] }),
  ];
  const refs = (label) => I.applyFilters(items, { label }).map((i) => i.ref).sort();
  assert.deepEqual(refs(['frontend']), ['a', 'b'], 'any case; not a part of a longer name');
  assert.deepEqual(refs(['frontend', 'URGENT']), ['a'], 'two values: both');
  assert.deepEqual(refs([' frontend , backend ']), ['a', 'b', 'c'], 'a comma list: either, spaces trimmed');
  assert.deepEqual(refs(['frontend,backend', 'urgent']), ['a', 'c']);
  assert.deepEqual(refs([]), ['a', 'b', 'c', 'd'], 'no --label: no filter');
  assert.deepEqual(refs(['nothing']), []);
});

test('#514: yad issues --label reads labels from GitHub and GitLab alike; an empty value is refused', async () => {
  const T = product();
  try {
    const gh = await I.runIssuesList(T, { label: ['ui'], json: true, now: NOW, env, runner: single([ghNode(1, label('UI')), ghNode(2, label('api'))]) });
    assert.deepEqual(gh.items.map((i) => i.number), [1]);
    const gl = I.listTrackerItems(glTarget, { closedSinceMs: since, runner: (c, args) => (args.some((a) => String(a).includes('state=closed')) ? ok([]) : ok([glNode(3, { labels: ['UI'] }), glNode(4, { labels: ['api'] })])) }).items;
    assert.deepEqual(I.applyFilters(gl.map((g) => it({ ref: `#${g.number}`, labels: g.labels })), { label: ['ui'] }).map((i) => i.ref), ['#3']);
    for (const bad of [[''], [' , ']]) {
      assert.equal(await I.runIssuesList(T, { label: bad, json: true, now: NOW, env, runner: () => { throw new Error('asked the platform'); } }), undefined, JSON.stringify(bad));
    }
    process.exitCode = 0;
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('#514: text, Markdown and HTML show the other labels — never the priority, type, status or epic ones', async () => {
  const rules = I.labelRules({ issues: { priority: { P1: ['urgent!'] } } });
  const m = model({ items: [it({ title: 'x', labels: ['bug', 'priority: P0', 'urgent!', 'status: done', 'epic: EP-a', 'frontend', 'needs design'] })] });
  const md = I.renderMarkdown(m, rules);
  const row = md.split('\n').find((l) => l.includes('| x |'));
  assert.ok(row.includes('| frontend, needs design |'), row);
  const html = I.renderHtml(m, rules);
  assert.match(html, /<span class="lbl">frontend<\/span> <span class="lbl">needs design<\/span>/);
  assert.match(html, /data-l="frontend\nneeds design"/);
  assert.match(html, /<select id="f-l"><option value="">All<\/option><option value="frontend">frontend<\/option><option value="needs design">needs design<\/option><\/select>/);
  for (const own of ['bug', 'priority: P0', 'urgent!', 'status: done', 'epic: EP-a']) assert.ok(!html.includes(`class="lbl">${own}<`), own);
  // The terminal line.
  const T = product({ issues: { priority: { P1: ['urgent!'] } } });
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await I.runIssuesList(T, { now: NOW, env, runner: single([ghNode(1, label('urgent!', 'frontend'))]) }); } finally { console.log = orig; fs.rmSync(T, { recursive: true, force: true }); }
  const line = lines.find((l) => l.includes('t1'));
  assert.match(line, /\{frontend\}/);
  assert.doesNotMatch(line, /urgent!/, 'a renamed priority label is the priority, not another label');
});

test('#514: a hostile label stays text in the HTML column, the filter attribute and the drop-down, and in Markdown', () => {
  const bad = '"><img src=x onerror=alert(1)>|[x](javascript:y)';
  const m = model({ items: [it({ title: 'x', labels: [bad] })] });
  const html = I.renderHtml(m);
  assert.doesNotMatch(html, /<img/);
  const shown = '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;|[x](javascript:y)';
  assert.ok(html.includes(`<span class="lbl">${shown}</span>`), 'the cell shows it as text');
  assert.ok(html.includes(`data-l="${shown}"`), 'the filter attribute holds it escaped');
  assert.ok(html.includes(`<option value="${shown}">${shown}</option>`), 'the drop-down too');
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.doesNotMatch(script, /alert|innerHTML/);
  const row = I.renderMarkdown(m).split('\n').find((l) => l.includes('| x |'));
  assert.equal(row.split(/(?<!\\)\|/).length, 11, 'the label makes no new column');
  assert.doesNotMatch(row, /\]\(javascript/);
});
