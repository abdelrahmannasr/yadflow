// E173: the agent acts on an item when an engineer asks. The rules each test pins:
//   - a new item goes to the Product repo unless a registered repo is named;
//   - what the platform answers is what is reported: a dropped label, assignee or state is said;
//   - a security item never lands where it would be public;
//   - text that looks like a token is redacted.
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

const A = await import('./issues-act.mjs');
const env = { PATH: process.env.PATH };
const done = (b) => ({ ok: true, code: 0, stdout: JSON.stringify(b), stderr: '' });
const no = (e) => ({ ok: false, code: 1, stdout: '', stderr: e });
const reset = () => { process.exitCode = 0; };

function product(platform = 'github') {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-act-'));
  fs.mkdirSync(path.join(T, '.sdlc'));
  const host = platform === 'github' ? 'github.com' : 'gitlab.com';
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform, git_url: `git@${host}:a/p.git` }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'api', git_url: `git@${host}:a/api.git`, platform }] }));
  return T;
}

// A fake platform. `state` is the item as the platform holds it; writes change it unless told to drop.
function fake(platform = 'github', { item = {}, vis = 'private', users = { ann: 7 }, drop = {}, fail = false } = {}) {
  const gh = platform === 'github';
  const state = { number: 5, title: 'Old', body: '', state: 'open', labels: [], assignees: [], ...item };
  const calls = [];
  const view = () => (gh
    ? { number: state.number, title: state.title, body: state.body, state: state.state, html_url: `https://github.com/a/p/issues/${state.number}`, labels: state.labels.map((name) => ({ name })), assignees: state.assignees.map((login) => ({ login })) }
    : { iid: state.number, title: state.title, description: state.body, state: state.state === 'open' ? 'opened' : 'closed', web_url: `https://gitlab.com/a/p/-/issues/${state.number}`, labels: state.labels, assignees: state.assignees.map((username) => ({ username })), confidential: !!state.confidential });
  const field = (args, name) => { const i = args.findIndex((a) => a.startsWith(`${name}=`)); return i < 0 ? null : args[i].slice(name.length + 1); };
  const many = (args, name) => args.filter((a) => a.startsWith(`${name}[]=`)).map((a) => a.slice(name.length + 3));
  const runner = (cmd, args) => {
    if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, code: 0, stdout: '', stderr: '' };
    calls.push(args);
    const xi = args.indexOf('-X');
    const method = xi < 0 ? 'GET' : args[xi + 1];
    const at = xi < 0 ? args.find((a) => /^(repos|projects|users)/.test(a)) : args[xi + 2];
    if (fail && method !== 'GET') return no('HTTP 500');
    if (method === 'GET') {
      if (/^users\?username=/.test(at)) { const u = decodeURIComponent(at.split('=')[1]); return done(users[u] ? [{ id: users[u], username: u }] : []); }
      if (/^repos\/a\/(p|api)$/.test(at)) return done({ visibility: vis, private: vis === 'private' });
      return done(view());
    }
    if (method === 'POST' && /\/issues$/.test(at)) {
      const labels = gh ? many(args, 'labels') : (field(args, 'labels') || '').split(',').filter(Boolean);
      const who = gh ? many(args, 'assignees') : (field(args, 'assignee_id') ? Object.keys(users).filter((u) => String(users[u]) === field(args, 'assignee_id')) : []);
      Object.assign(state, { number: 9, title: field(args, 'title'), body: field(args, gh ? 'body' : 'description'), labels: drop.labels ? [] : labels, assignees: drop.assignee ? [] : who, confidential: drop.confidential ? false : args.includes('confidential=true') });
      return done(view());
    }
    if (/\/labels$/.test(at) && method === 'POST') { if (!drop.labels) state.labels.push(...many(args, 'labels')); return done({}); }
    if (/\/labels\//.test(at) && method === 'DELETE') { const l = decodeURIComponent(at.split('/labels/')[1]); state.labels = state.labels.filter((x) => x !== l); return done({}); }
    if (/\/assignees$/.test(at) && method === 'DELETE') { state.assignees = []; return done({}); }
    if (/\/(comments|notes)$/.test(at)) return done({});
    if (['PATCH', 'PUT'].includes(method)) {
      if (field(args, 'state') === 'closed' || field(args, 'state_event') === 'close') state.state = 'closed';
      if (field(args, 'state') === 'open' || field(args, 'state_event') === 'reopen') state.state = 'open';
      if (field(args, 'title') !== null) state.title = field(args, 'title');
      if (many(args, 'assignees').length && !drop.assignee) state.assignees = many(args, 'assignees');
      if (field(args, 'assignee_id') !== null && !drop.assignee) { const id = field(args, 'assignee_id'); state.assignees = id === '0' ? [] : Object.keys(users).filter((u) => String(users[u]) === id); }
      if (field(args, 'add_labels') !== null && !drop.labels) state.labels.push(...field(args, 'add_labels').split(','));
      if (args.includes('confidential=true')) state.confidential = !drop.confidential;
      if (field(args, 'remove_labels') !== null) { const r = field(args, 'remove_labels').split(','); state.labels = state.labels.filter((l) => !r.includes(l)); }
      return done(view());
    }
    return no('unexpected');
  };
  return { runner, calls, state, writes: () => calls.filter((a) => a.includes('-X')) };
}
const at = (args) => args[args.indexOf('-X') + 2];

test('new: goes to the Product repo by default, with the chosen labels and assignee', async () => {
  const T = product(); const p = fake();
  const r = await A.runIssuesNew(T, { title: 'Export to CSV', type: 'feature', priority: 'P2', assignee: 'ann', json: true, env, runner: p.runner });
  assert.equal(r.ok, true);
  assert.equal(at(p.writes()[0]), 'repos/a/p/issues');
  assert.deepEqual(p.state.labels, ['feature', 'priority: P2']);
  assert.deepEqual(p.state.assignees, ['ann']);
  assert.equal(r.ref, '#9');
  assert.match(r.url, /issues\/9$/);
});

test('new: --repo must be a registered repo, and then goes there', async () => {
  const T = product(); const p = fake();
  await A.runIssuesNew(T, { title: 'x', repo: 'api', json: true, env, runner: p.runner });
  assert.equal(at(p.writes()[0]), 'repos/a/api/issues');
  const q = fake();
  await A.runIssuesNew(T, { title: 'x', repo: 'nowhere', env, runner: q.runner });
  assert.equal(q.writes().length, 0); assert.equal(process.exitCode, 1); reset();
});

test('new: what the platform dropped is reported and fails the command', async () => {
  for (const drop of [{ labels: true }, { assignee: true }]) {
    const T = product(); const p = fake('github', { drop });
    const r = await A.runIssuesNew(T, { title: 'x', type: 'bug', assignee: 'ann', json: true, env, runner: p.runner });
    assert.equal(r.ok, false); assert.ok(r.dropped.length); reset();
  }
});

test('new: a security item is refused on a GitHub repo not known to be private, and confidential on GitLab', async () => {
  for (const vis of ['public', 'internal', null]) {
    const T = product(); const p = fake('github', { vis });
    await A.runIssuesNew(T, { title: 'SQL injection', type: 'security', env, runner: p.runner });
    assert.equal(p.writes().length, 0, String(vis)); assert.equal(process.exitCode, 1); reset();
  }
  const T = product(); const p = fake('github', { vis: 'private' });
  await A.runIssuesNew(T, { title: 'SQL injection', type: 'security', env, runner: p.runner });
  assert.equal(p.writes().length, 1);
  const G = product('gitlab'); const g = fake('gitlab');
  await A.runIssuesNew(G, { title: 'SQL injection', type: 'security', env, runner: g.runner });
  assert.ok(g.writes()[0].includes('confidential=true'));
  const h = fake('gitlab', { drop: { confidential: true } });
  const r = await A.runIssuesNew(G, { title: 'SQL injection', type: 'security', json: true, env, runner: h.runner });
  assert.match(r.dropped.join(), /NOT made confidential/); reset();
});

test('new: refuses a bad title, type, priority, both bodies, and an unknown GitLab user', async () => {
  const T = product();
  for (const o of [{ title: '' }, { title: 'x', type: 'idea' }, { title: 'x', priority: 'P9' }, { title: 'x', body: 'a', bodyFile: '/x' }, { title: 'x'.repeat(300) }]) {
    const p = fake();
    await A.runIssuesNew(T, { ...o, env, runner: p.runner });
    assert.equal(p.writes().length, 0, JSON.stringify(o).slice(0, 60)); assert.equal(process.exitCode, 1); reset();
  }
  const G = product('gitlab'); const g = fake('gitlab');
  await A.runIssuesNew(G, { title: 'x', assignee: 'ghost', env, runner: g.runner });
  assert.equal(g.writes().length, 0); assert.equal(process.exitCode, 1); reset();
});

test('new: a token in the text is redacted, and the body comes from a file with its lines', async () => {
  const T = product(); const p = fake();
  const f = path.join(T, 'body.md'); fs.writeFileSync(f, 'line one\nkey ghp_abcdefghijklmnopqrstuvwxyz0123\n');
  await A.runIssuesNew(T, { title: 'leak ghp_abcdefghijklmnopqrstuvwxyz0123', bodyFile: f, env, runner: p.runner });
  assert.doesNotMatch(p.state.title + p.state.body, /ghp_/);
  assert.match(p.state.body, /line one\nkey \[redacted\]/);
});

test('GitLab new: one assignee by user id, labels as one field, no bracketed field', async () => {
  const G = product('gitlab'); const g = fake('gitlab');
  await A.runIssuesNew(G, { title: 'x', type: 'bug', priority: 'P1', assignee: 'ann', env, runner: g.runner });
  const w = g.writes()[0];
  assert.ok(w.includes('assignee_id=7'));
  assert.ok(w.includes('labels=bug,priority: P1'));
  assert.equal(w.some((x) => x.includes('[]')), false);
});

test('assign: replaces, clears with --none, and reports when the platform did not take it', async () => {
  const T = product();
  const p = fake('github', { item: { assignees: ['bob'] } });
  await A.runIssuesAssign(T, { ref: '5', assignee: 'ann', env, runner: p.runner });
  assert.deepEqual(p.state.assignees, ['ann']);
  await A.runIssuesAssign(T, { ref: '5', none: true, env, runner: p.runner });
  assert.deepEqual(p.state.assignees, []);
  const q = fake('github', { drop: { assignee: true } });
  const r = await A.runIssuesAssign(T, { ref: '5', assignee: 'ann', json: true, env, runner: q.runner });
  assert.equal(r.ok, false); reset();
  const G = product('gitlab'); const g = fake('gitlab', { item: { assignees: ['ann'] } });
  await A.runIssuesAssign(G, { ref: '5', none: true, env, runner: g.runner });
  assert.ok(g.writes()[0].includes('assignee_id=0'));
});

test('label: replaces the priority and type, keeping other labels', async () => {
  const T = product(); const p = fake('github', { item: { labels: ['priority: P3', 'bug', 'ui'] } });
  const r = await A.runIssuesLabel(T, { ref: '5', priority: 'P1', type: 'feature', json: true, env, runner: p.runner });
  assert.equal(r.ok, true);
  assert.deepEqual(p.state.labels.sort(), ['feature', 'priority: P1', 'ui']);
  const q = fake('github', { item: { labels: ['priority: P1'] } });
  const s = await A.runIssuesLabel(T, { ref: '5', priority: 'P1', json: true, env, runner: q.runner });
  assert.equal(q.writes().length, 0); assert.match(s.notes.join(), /already/);
});

test('label: refuses a security label on a public GitHub repo, and a confidential item', async () => {
  const T = product(); const p = fake('github', { vis: 'public' });
  await A.runIssuesLabel(T, { ref: '5', type: 'security', env, runner: p.runner });
  assert.equal(p.writes().length, 0); reset();
  const G = product('gitlab'); const g = fake('gitlab', { item: { confidential: true } });
  await A.runIssuesLabel(G, { ref: '5', priority: 'P1', env, runner: g.runner });
  assert.equal(g.writes().length, 0); reset();
});

test('edit, comment, close and reopen', async () => {
  const T = product(); const p = fake();
  await A.runIssuesEdit(T, { ref: '5', title: 'New title', env, runner: p.runner });
  assert.equal(p.state.title, 'New title');
  await A.runIssuesComment(T, { ref: '5', body: 'thanks', env, runner: p.runner });
  assert.ok(p.writes().some((w) => /\/comments$/.test(at(w))));
  await A.runIssuesClose(T, { ref: '5', env, runner: p.runner });
  assert.equal(p.state.state, 'closed');
  await A.runIssuesReopen(T, { ref: '5', env, runner: p.runner });
  assert.equal(p.state.state, 'open');
  const G = product('gitlab'); const g = fake('gitlab');
  await A.runIssuesEdit(G, { ref: '5', body: 'new body', env, runner: g.runner });
  assert.ok(g.writes()[0].includes('description=new body'));
  await A.runIssuesComment(G, { ref: '5', body: 'x', env, runner: g.runner });
  assert.ok(/\/notes$/.test(at(g.writes()[1])));
});

test('a refused write changes nothing and says so; an empty comment is refused', async () => {
  const T = product(); const p = fake('github', { fail: true });
  await A.runIssuesClose(T, { ref: '5', env, runner: p.runner });
  assert.equal(process.exitCode, 1); reset();
  const q = fake();
  await A.runIssuesComment(T, { ref: '5', body: '  ', env, runner: q.runner });
  assert.equal(q.writes().length, 0); assert.equal(process.exitCode, 1); reset();
});

test('--json keys are always present', async () => {
  const T = product(); const p = fake();
  const r = await A.runIssuesClose(T, { ref: '5', json: true, env, runner: p.runner });
  for (const k of ['ok', 'ref', 'url', 'changed', 'dropped', 'notes']) assert.ok(Object.hasOwn(r, k), k);
});

test('each action takes only its own flags', () => {
  assert.deepEqual(A.actForeignFlags(['issues', 'close', '5', '--priority', 'P1'], 'close'), ['--priority']);
  assert.deepEqual(A.actForeignFlags(['issues', 'new', '--title', 'x', '--repo', 'api', '--json'], 'new'), []);
});

test('the agent is told to act only when asked and to report what it chose', async () => {
  const R = await import('./agent-rules.mjs');
  for (const a of A.ACT_ACTIONS) assert.equal(R.COMMAND_CLASS[`issues ${a}`].class, 'on-request', a);
  const skill = fs.readFileSync(new URL('../skills/yad-issues/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /yad issues new/);
  assert.match(skill, /say what you chose/i);
});

test('E173 review: the real yad command reaches every action', async () => {
  const { execFileSync } = await import('node:child_process');
  const T = product();
  const bin = new URL('../bin/yad.mjs', import.meta.url).pathname;
  const runYad = (args) => { try { return execFileSync(process.execPath, [bin, ...args, '--dir', T, '--json'], { env: { ...process.env, YAD_PLATFORM_READ: '0', NO_COLOR: '1' }, encoding: 'utf8' }); } catch (e) { return String(e.stdout); } };
  for (const args of [['issues', 'new', '--title', 'x', '--priority', 'P1'], ['issues', 'assign', '12', 'ann'], ['issues', 'assign', '12', '--me'], ['issues', 'close', '12'], ['issues', 'label', '12', '--priority', 'P1'], ['issues', 'comment', '12', '--body', 'hi']]) {
    const out = runYad(args);
    assert.doesNotMatch(out, /does not take|takes no more words|takes </, args.join(' '));
    assert.match(out, /turned off/, args.join(' '));
  }
  assert.match(runYad(['issues', 'close', '12', '--priority', 'P1']), /does not take --priority/);
});

test('E173 review: GitLab makes an item confidential before a security label, and refuses if it cannot', async () => {
  const G = product('gitlab');
  const g = fake('gitlab');
  await A.runIssuesLabel(G, { ref: '5', type: 'security', env, runner: g.runner });
  const order = g.writes().map((w) => (w.includes('confidential=true') ? 'conf' : 'label'));
  assert.deepEqual(order.slice(0, 2), ['conf', 'label']);
  assert.ok(g.state.labels.includes('security'));
  const h = fake('gitlab', { drop: { confidential: true } });
  await A.runIssuesLabel(G, { ref: '5', type: 'security', env, runner: h.runner });
  assert.equal(h.state.labels.includes('security'), false);
  assert.equal(process.exitCode, 1); reset();
});

test('E173 review: a commit hash and a long name are kept; a real token is redacted and said', async () => {
  const T = product(); const p = fake();
  const sha = '3f2a9c1d4e5b6a7f8091a2b3c4d5e6f708192a3b';
  const r = await A.runIssuesNew(T, { title: `Regressed in ${sha}`, body: 'key ghp_abcdefghijklmnopqrstuvwxyz0123', json: true, env, runner: p.runner });
  assert.match(p.state.title, new RegExp(sha));
  assert.match(r.notes.join(), /redacted/);
});

test('E173 review: assign says who it replaced; priority and type are read in any case', async () => {
  const T = product(); const p = fake('github', { item: { assignees: ['alice'] } });
  const r = await A.runIssuesAssign(T, { ref: '5', assignee: 'bob', json: true, env, runner: p.runner });
  assert.match(r.changed.join(), /replacing alice/);
  const q = fake();
  await A.runIssuesNew(T, { title: 'x', priority: 'p1', type: 'Feature', env, runner: q.runner });
  assert.deepEqual(q.state.labels, ['feature', 'priority: P1']);
});

