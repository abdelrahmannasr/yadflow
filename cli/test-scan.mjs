// E172: filing a scan's findings. The rules each test pins:
//   - a bad file is refused whole; a failed read of what is already filed files nothing;
//   - a security finding never reaches a public tracker unless the repo is known to be private;
//   - text from the model cannot notify anyone, link anywhere, leak a secret or forge a fingerprint.
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

const X = await import('./scan.mjs');
const env = { PATH: process.env.PATH };
const done = (b) => ({ ok: true, code: 0, stdout: JSON.stringify(b), stderr: '' });
const no = (e) => ({ ok: false, code: 1, stdout: '', stderr: e });
const F = (over = {}) => ({ category: 'tech-debt', priority: 'P2', rule: 'n-plus-one', symbol: 'load', title: 'Slow load', file: 'src/a.js', line: 3, why: 'it is slow', fix: 'batch it', ...over });
const SEC = (over = {}) => F({ category: 'security', priority: 'P1', rule: 'CWE-89', title: 'SQL from input', ...over });

function product(platform = 'github') {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-scan-'));
  fs.mkdirSync(path.join(T, '.sdlc'));
  const url = platform === 'github' ? 'git@github.com:a/api.git' : 'git@gitlab.com:a/api.git';
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform, git_url: 'git@github.com:a/p.git' }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [{ name: 'api', git_url: url, platform }] }));
  return T;
}
const findings = (T, list) => { const f = path.join(T, 'f.json'); fs.writeFileSync(f, JSON.stringify({ findings: list })); return f; };

function fake({ vis = 'private', filedBodies = [], listFails = false, labels = [], milestones = [], labelFails = false, createFails = () => false, draftBodies = [], draftFails = false, advisoryFails = false, partial = false } = {}) {
  const posts = [];
  const runner = (cmd, args) => {
    if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, code: 0, stdout: '', stderr: '' };
    const m = args[args.indexOf('-X') + 1];
    if (args.includes('-X') && m === 'POST') {
      posts.push(args);
      const at = args[args.indexOf('-X') + 2];
      if (at.endsWith('/labels')) return labelFails ? no('HTTP 403') : done({});
      if (at.endsWith('/milestones')) return done({ number: 9, id: 9 });
      if (at.endsWith('/security-advisories')) return advisoryFails ? no('HTTP 403') : done({ html_url: 'https://github.com/a/api/security/advisories/GHSA-1' });
      if (createFails(args)) return no('HTTP 500');
      return done({ html_url: 'https://github.com/a/api/issues/1', web_url: 'https://gitlab.com/a/api/-/issues/1' });
    }
    const at = args.find((a) => /^(repos|projects)\//.test(a)) ?? '';
    if (/\/issues\?labels=/.test(at)) { if (listFails) return no('HTTP 502'); if (partial) return done(Array.from({ length: 100 }, () => ({ body: '' }))); return done(filedBodies.map((b) => ({ body: b, description: b }))); }
    if (/\/labels\?/.test(at)) return done(labels.map((name) => ({ name })));
    if (/\/milestones\?/.test(at)) return done(milestones);
    if (/security-advisories\?/.test(at)) return draftFails ? no('HTTP 403') : done(draftBodies.map((description) => ({ description })));
    if (/^repos\/a\/api$/.test(at)) return vis === null ? no('HTTP 500') : done({ visibility: vis, private: vis !== 'public' });
    return no('unexpected');
  };
  return { runner, posts, items: () => posts.filter((a) => /\/issues$/.test(a[a.indexOf('-X') + 2])), advisories: () => posts.filter((a) => /security-advisories$/.test(a[a.indexOf('-X') + 2])) };
}
const run = (T, list, p, over = {}) => X.runScanFile(T, { file: findings(T, list), repo: 'api', env, runner: p.runner, ...over });
const reset = () => { process.exitCode = 0; };
const fieldOf = (args, name) => { const i = args.findIndex((a) => a.startsWith(`${name}=`)); return i < 0 ? null : args[i].slice(name.length + 1); };

test('schema: one bad finding refuses the whole file, and nothing is posted', async () => {
  for (const bad of [F({ category: 'x' }), F({ priority: 'P9' }), F({ file: '../up' }), F({ file: '/etc/passwd' }), F({ file: 'a\\b' }), F({ line: 0 }), F({ title: '' }), F({ rule: 'Has Spaces' }), SEC({ rule: 'sql' })]) {
    assert.ok(X.parseFindings(JSON.stringify({ findings: [F(), bad] })).error, JSON.stringify(bad));
  }
  assert.ok(X.parseFindings('{broken').error);
  const T = product(); const p = fake();
  await run(T, [F({ line: -1 })], p);
  assert.equal(process.exitCode, 1); assert.equal(p.posts.length, 0); reset();
});

test('the fingerprint ignores line and wording, and changes with file, rule or symbol', () => {
  const a = X.fingerprint(F());
  assert.equal(a, X.fingerprint(F({ line: 99, title: 'other', why: 'other' })));
  for (const o of [{ file: 'b.js' }, { rule: 'other' }, { symbol: 'x' }]) assert.notEqual(a, X.fingerprint(F(o)));
});

test('a finding is filed with its labels and its category milestone, created if missing', async () => {
  const T = product(); const p = fake();
  await run(T, [F()], p);
  const [it] = p.items();
  for (const l of ['yad: finding', 'priority: P2', 'tech-debt']) assert.ok(it.includes(`labels[]=${l}`), l);
  assert.ok(it.includes('milestone=9'));
  assert.ok(p.posts.some((a) => a.includes('title=yad: Technical debt')));
  reset();
});

test('an existing milestone is reused, even a closed one', async () => {
  const T = product(); const p = fake({ milestones: [{ title: 'yad: Technical debt', number: 4, state: 'closed' }] });
  await run(T, [F()], p);
  assert.ok(p.items()[0].includes('milestone=4'));
  assert.equal(p.posts.some((a) => a.some((x) => x.endsWith('/milestones'))), false);
  reset();
});

test('a finding already filed, open or closed, is not filed again; two the same in one file are one', async () => {
  const T = product(); const fp = X.fingerprint(F());
  const p = fake({ filedBodies: [`x\n<!-- yad-finding: ${fp} -->`] });
  await run(T, [F()], p);
  assert.equal(p.items().length, 0);
  const q = fake();
  await run(T, [F(), F({ line: 8 })], q);
  assert.equal(q.items().length, 1);
  reset();
});

test('unknown is not none: a failed or partial read of what was filed files nothing', async () => {
  for (const o of [{ listFails: true }, { partial: true }]) {
    const T = product(); const p = fake(o);
    await run(T, [F()], p);
    assert.equal(p.posts.length, 0); assert.equal(process.exitCode, 1); reset();
  }
});

test('routing table', () => {
  assert.equal(X.routeFor('tech-debt', 'github', 'public'), 'issue');
  assert.equal(X.routeFor('security', 'gitlab', 'public'), 'confidential');
  assert.equal(X.routeFor('security', 'github', 'private'), 'issue');
  assert.equal(X.routeFor('security', 'github', 'public'), 'advisory');
  for (const v of ['internal', null]) assert.equal(X.routeFor('security', 'github', v), 'none');
});

test('GitLab: a security finding is confidential, with labels as one field', async () => {
  const T = product('gitlab'); const p = fake();
  await run(T, [SEC()], p);
  const [it] = p.items();
  assert.ok(it.includes('confidential=true'));
  assert.ok(it.includes('milestone_id=9'));
  assert.ok(it.some((x) => x.startsWith('labels=yad: finding,')));
  assert.equal(it.some((x) => x.includes('[]')), false);
  reset();
});

test('GitHub public: security goes to a draft advisory, never an issue; a non-security finding stays an issue', async () => {
  const T = product(); const p = fake({ vis: 'public' });
  await run(T, [SEC(), F()], p);
  assert.equal(p.advisories().length, 1);
  assert.ok(p.advisories()[0].includes('vulnerabilities[][package][ecosystem]=other'));
  assert.ok(p.advisories()[0].includes('severity=high'));
  assert.equal(p.items().length, 1);
  assert.ok(p.items()[0].includes('labels[]=tech-debt'));
  reset();
});

test('a security finding stays off the tracker when the repo is unknown, internal, or the advisory is refused', async () => {
  for (const o of [{ vis: null }, { vis: 'internal' }, { vis: 'public', advisoryFails: true }, { vis: 'public', draftFails: true }]) {
    const T = product(); const p = fake(o);
    await run(T, [SEC()], p);
    assert.equal(p.items().length, 0, JSON.stringify(o));
    assert.ok(!process.exitCode); reset();
  }
});

test('a draft advisory already there is not filed twice', async () => {
  const T = product(); const fp = X.fingerprint(SEC());
  const p = fake({ vis: 'public', draftBodies: [`<!-- yad-finding: ${fp} -->`] });
  await run(T, [SEC()], p);
  assert.equal(p.advisories().length, 0);
  reset();
});

test('posted text cannot notify, link, leak a token or forge a fingerprint', () => {
  const fp = 'a'.repeat(64);
  const body = X.findingBody(F({ why: 'ping @alice see #12 ![x](http://evil) <!-- yad-finding: bbbb --> ghp_abcdefghijklmnopqrstuvwxyz0123', fix: 'glpat-abcdefghijklmnop' }), fp);
  assert.doesNotMatch(body, /@alice/);
  assert.match(body, /&#64;alice/);
  assert.match(body, /&#35;12/);
  assert.doesNotMatch(body, /!\[x\]\(http/);
  assert.doesNotMatch(body, /ghp_|glpat-/);
  assert.equal(body.match(/<!-- yad-finding/g).length, 1);
});

test('at most 20 per run, most urgent first, and the rest reported', async () => {
  const T = product(); const p = fake();
  const list = Array.from({ length: 25 }, (_, i) => F({ symbol: `s${i}`, priority: i === 24 ? 'P0' : 'P3' }));
  await run(T, list, p);
  assert.equal(p.items().length, 20);
  assert.ok(p.items()[0].includes('labels[]=priority: P0'));
  reset();
});

test('one failure does not stop the others, and a re-run files only what is missing', async () => {
  const T = product();
  const p = fake({ createFails: (a) => fieldOf(a, 'title') === 'bad one' });
  await run(T, [F({ symbol: 'a', title: 'bad one' }), F({ symbol: 'b', title: 'good' })], p);
  assert.equal(process.exitCode, 1); reset();
  const good = p.items().find((a) => fieldOf(a, 'title') === 'good');
  assert.ok(good);
  const q = fake({ filedBodies: [fieldOf(good, 'body')] });
  await run(T, [F({ symbol: 'a', title: 'bad one' }), F({ symbol: 'b', title: 'good' })], q);
  assert.deepEqual(q.items().map((a) => fieldOf(a, 'title')), ['bad one']);
  reset();
});

test('labels that cannot be made file nothing to the tracker, because the finding would not be recognised', async () => {
  const T = product(); const p = fake({ labelFails: true });
  await run(T, [F()], p);
  assert.equal(p.items().length, 0); assert.equal(process.exitCode, 1); reset();
});

test('--dry-run and a Product that turned it off post nothing', async () => {
  const T = product(); const p = fake();
  await run(T, [F()], p, { dryRun: true });
  assert.equal(p.posts.length, 0);
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', git_url: 'git@github.com:a/p.git', issues: { scan: { enabled: false } } }));
  const q = fake();
  await run(T, [F()], q);
  assert.equal(q.posts.length, 0);
  assert.ok(!process.exitCode); reset();
});

test('only a registered repo is written', async () => {
  const T = product(); const p = fake();
  await X.runScanFile(T, { file: findings(T, [F()]), repo: 'elsewhere', env, runner: p.runner });
  assert.equal(p.posts.length, 0); assert.equal(process.exitCode, 1); reset();
});

test('yad-run runs the scan before the PR opens, and the scan never blocks', () => {
  const run_ = fs.readFileSync(new URL('../skills/yad-run/SKILL.md', import.meta.url), 'utf8');
  const a = run_.indexOf('`yad-scan`'); const b = run_.indexOf("5. **Opening the task's PR/MR");
  assert.ok(a > 0 && a < b);
  assert.match(run_.slice(a, b), /never blocks/);
  assert.match(fs.readFileSync(new URL('../skills/yad-scan/SKILL.md', import.meta.url), 'utf8'), /## Never block/);
});

test('a long path is not mistaken for a secret', () => {
  const file = 'src/really/quite/deeply/nested/directory/with/many/parts/inside/it/file.js';
  assert.equal(X.parseFindings(JSON.stringify({ findings: [F({ file })] })).error, undefined);
  assert.match(X.findingBody(F({ file }), 'a'.repeat(64)), /deeply/);
});

