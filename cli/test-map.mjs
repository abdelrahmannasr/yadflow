// E181 — `yad map`: the progress map's model, its people, the page and the command. Every name is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers';

if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';

const { mapModel, gatherMap, digestOf, initials, personLetter, hueOf, storyTitle, portFor } = await import('./map.mjs');
const { runMap, mapSnapshot, startMapServer, buildMap } = await import('./map-view.mjs');
const { classify, readAllowList } = await import('./agent-rules.mjs');
const { endJSON } = await import('./lib.mjs');
const { REPORTS_ENV, readCatalog } = await import('./reports-dir.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAD = path.join(HERE, '..', 'bin', 'yad.mjs');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-map-')));
const put = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof d === 'string' ? d : JSON.stringify(d, null, 2)); };
const done = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
const NOW = Date.parse('2026-11-14T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 864e5).toISOString();
const PEOPLE = { kit: ['Kit Ansel', 'kit@example.com'], bo: ['Bo Lindqvist', 'bo@example.com'], mae: ['Mae Torvik', 'mae@example.com'] };
function git(cwd, args, who = PEOPLE.kit, date = daysAgo(1)) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: who[0], GIT_AUTHOR_EMAIL: who[1], GIT_COMMITTER_NAME: who[0], GIT_COMMITTER_EMAIL: who[1], GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
async function captured(fn) {
  const out = []; const orig = console.log;
  console.log = (s) => out.push(String(s));
  let ret;
  try { ret = await fn(); } finally { console.log = orig; endJSON(); }
  return { json: out.length ? JSON.parse(out.join('\n')) : null, ret };
}

// ---- the pure model ------------------------------------------------------------------------------

const baseInputs = (over = {}) => ({
  product: { name: 'Orchard', branch: 'main', sha: 'a'.repeat(40) },
  staleDays: 60, groups: [], members: [],
  epics: [
    { id: 'EP-login', title: 'Log in', currentStep: 'ready-for-build', steps: [{ id: 'epic', status: 'done' }], owner: 'Kit Ansel', repos: [], onMain: true, stepOwners: {}, approvals: [{ step: 'epic-review', approver: 'bo' }] },
    { id: 'EP-later', title: 'Later', currentStep: 'epic', steps: [{ id: 'epic', status: 'todo' }], owner: null, repos: [], onMain: true, stepOwners: {}, approvals: [] },
    { id: 'EP-solo', title: 'Solo', currentStep: 'ready-for-build', steps: [{ id: 'epic', status: 'done' }], owner: 'Mae Torvik', repos: [], onMain: true, stepOwners: {}, approvals: [] },
  ],
  stories: [
    { id: 'EP-login-S01', epic: 'EP-login', title: 'Sign in', status: 'shipped', owner: 'Kit Ansel', repos: ['api'], build: {} },
    { id: 'EP-login-S02', epic: 'EP-login', title: 'Remember me', status: 'approved', owner: 'Bo Lindqvist', repos: ['api'], build: {} },
    { id: 'EP-solo-S01', epic: 'EP-solo', title: 'One', status: 'shipped', owner: 'Mae Torvik', repos: ['api'], build: {} },
  ],
  tasks: [
    { story: 'EP-login-S01', epic: 'EP-login', task: 'T01', repo: 'api', branch: 'feat/EP-login-S01-T01', pr: 'https://git.example.org/orchard/api/pull/4', builder: 'Kit Ansel', reviewers: ['bo'], reach: { found: true, prod: true, integ: true } },
    { story: 'EP-solo-S01', epic: 'EP-solo', task: 'T01', repo: 'api', branch: 'feat/EP-solo-S01-T01', pr: null, builder: 'Mae Torvik', reviewers: ['Mae Torvik'], reach: { found: true, prod: false, integ: true } },
  ],
  repos: [{ name: 'api', available: true, integrationBranch: 'dev', productionBranch: 'main', productionGuessed: true, waitingCommits: 3, productionAhead: 0, production: { date: daysAgo(10), author: 'Kit Ansel' }, integration: { date: daysAgo(1), author: 'Bo Lindqvist' } },
    { name: 'web', available: false, integrationBranch: 'dev' }],
  branches: [
    { repo: 'api', name: 'feat/EP-login-S01-T01', sha: 'b'.repeat(40), date: daysAgo(20), author: 'Kit Ansel', inProd: true, inInteg: true, ahead: 0 },
    { repo: 'api', name: 'feat/EP-login-S02-remember', sha: 'c'.repeat(40), date: daysAgo(2), author: 'Bo Lindqvist', inProd: false, inInteg: false, ahead: 2 },
    { repo: 'api', name: 'yad/wip/bo-lindqvist/EP-login', sha: 'd'.repeat(40), date: daysAgo(90), author: 'Bo Lindqvist', inProd: false, inInteg: false, ahead: 1 },
    { repo: 'api', name: 'chore/kit-cleanup', sha: 'e'.repeat(40), date: daysAgo(3), author: 'Kit Ansel', inProd: false, inInteg: true, ahead: 0 },
  ],
  waits: [{ epic: 'EP-login', step: 'stories-review', kind: 'gate', owner: 'Kit Ansel' }],
  ...over,
});

test('the roll-up: tasks, branches, stories and epics get the prototype\'s states', () => {
  const m = mapModel(baseInputs(), { now: NOW });
  const st = (list, id) => list.find((x) => x.id === id);
  assert.equal(st(m.tasks, 'EP-login-S01-T01-api').state, 'live');
  assert.equal(st(m.tasks, 'EP-solo-S01-T01-api').state, 'merged');
  assert.equal(st(m.stories, 'EP-login-S01').state, 'live');
  assert.equal(st(m.stories, 'EP-login-S02').state, 'active', 'an open branch names it');
  assert.equal(st(m.epics, 'EP-login').state, 'active');
  assert.equal(st(m.epics, 'EP-later').state, 'planned');
  assert.equal(st(m.epics, 'EP-solo').state, 'merged');
  const b = (name) => m.branches.find((x) => x.name === name);
  assert.equal(b('feat/EP-login-S02-remember').state, 'active');
  assert.equal(b('feat/EP-login-S02-remember').story, 'EP-login-S02');
  assert.equal(b('yad/wip/bo-lindqvist/EP-login').state, 'idle');
  assert.equal(b('chore/kit-cleanup').state, 'merged');
  assert.equal(b('chore/kit-cleanup').group, 'other', 'a branch with no epic falls into the one default group');
  assert.equal(m.repos[0].productionGuessed, true);
  assert.equal(m.summary.stories.shipped, 2);
  assert.equal(m.tasks[0].pr, 'https://git.example.org/orchard/api/pull/4');
  assert.equal(JSON.stringify(m).includes('subject'), false, 'no commit subject is carried');
});

test('a task in a repo not on this machine is shipped but unchecked; one not registered says so', () => {
  const i = baseInputs();
  i.tasks.push({ story: 'EP-login-S01', epic: 'EP-login', task: 'T02', repo: 'web', builder: null, reviewers: [], reach: null },
    { story: 'EP-login-S01', epic: 'EP-login', task: 'T03', repo: 'ghost', builder: null, reviewers: [], reach: null },
    { story: 'EP-login-S01', epic: 'EP-login', task: 'T04', repo: 'api', builder: null, reviewers: [], reach: { found: true, prod: false, integ: false, via: { branch: 'feat/EP-login-S01-hotfix', date: daysAgo(4) } } });
  const m = mapModel(i, { now: NOW });
  const t = (id) => m.tasks.find((x) => x.task === id);
  assert.equal(t('T02').verified, false);
  assert.match(t('T02').note, /not on this machine/);
  assert.match(t('T03').note, /not a registered repo/);
  assert.equal(t('T04').state, 'live');
  assert.match(t('T04').note, /through its own branch “feat\/EP-login-S01-hotfix”/);
  assert.equal(m.stories.find((s) => s.id === 'EP-login-S01').state, 'merged', 'not every task is in Production');
});

test('people: roles, never counts; one badge per person through the member files; a name on two members is said', () => {
  const member = (login, names) => ({ primary: { platform: 'github', host: 'github.com', login }, accounts: [{ platform: 'github', host: 'github.com', login }], names, emails: [], matchLogins: [login] });
  const m = mapModel(baseInputs({ members: [member('kit', ['Kit Ansel']), member('bo', ['Bo Lindqvist']), member('mae', ['Mae Torvik'])] }), { now: NOW });
  const names = m.people.map((p) => p.name);
  assert.deepEqual(names, ['Bo Lindqvist', 'Kit Ansel', 'Mae Torvik'], 'sorted by name, one each');
  const bo = m.people.find((p) => p.name === 'Bo Lindqvist');
  assert.deepEqual(bo.roles, ['approver', 'builder', 'owner', 'reviewer']);
  assert.equal(bo.initials, 'BL');
  assert.equal(Object.keys(bo).some((k) => /count|score|rank/i.test(k)), false);
  assert.equal(m.waiting[0].person, 'm:kit');
  assert.deepEqual(m.notes.onePerson, ['EP-solo'], 'every part of EP-solo is Mae\'s');
  // Without member files, a login and a git name stay two people — never a guess.
  const loose = mapModel(baseInputs(), { now: NOW });
  assert.ok(loose.people.some((p) => p.name === 'bo') && loose.people.some((p) => p.name === 'Bo Lindqvist'));
  // A name two member files hold is matched to neither, and says so.
  const twice = mapModel(baseInputs({ members: [member('kit', ['Kit Ansel']), member('kit2', ['Kit Ansel'])] }), { now: NOW });
  assert.deepEqual(twice.people.find((p) => p.name === 'Kit Ansel').ambiguous, ['kit', 'kit2']);
  // An email is never shown.
  const at = mapModel(baseInputs({ stories: [{ id: 'EP-login-S09', epic: 'EP-login', status: 'draft', owner: 'kit@example.com', repos: [] }] }), { now: NOW });
  assert.equal(JSON.stringify(at).includes('example.com'), false, 'not in the name, nor in the key');
});

test('--anonymous: Person A…, and no name, capture branch, PR link or host survives', () => {
  const m = mapModel(baseInputs(), { now: NOW, anonymous: true });
  const text = JSON.stringify(m).toLowerCase();
  for (const word of ['kit', 'ansel', 'lindqvist', 'mae', 'torvik', 'git.example.org']) assert.equal(text.includes(word), false, word);
  assert.ok(m.people.every((p) => /^Person [A-Z]+$/.test(p.name)));
  assert.ok(m.branches.some((b) => b.name === 'yad/wip/someone/EP-login'));
  assert.ok(m.branches.some((b) => b.name === 'chore/someone-cleanup'));
  assert.equal(m.anonymous, true);
  assert.equal(personLetter(0), 'Person A');
  assert.equal(personLetter(25), 'Person Z');
  assert.equal(personLetter(26), 'Person AA');
});

test('what moved: a later map lights each item whose state changed, and each new one', () => {
  const first = mapModel(baseInputs(), { now: NOW });
  const digest = digestOf(first);
  const i = baseInputs();
  i.tasks[1].reach = { found: true, prod: true, integ: true };
  i.stories.push({ id: 'EP-later-S01', epic: 'EP-later', status: 'draft', owner: null, repos: [] });
  const second = mapModel(i, { now: NOW + 864e5, previous: digest });
  const ids = second.moved.map((x) => x.id);
  assert.ok(ids.includes('task:EP-solo-S01-T01-api'));
  assert.ok(ids.includes('story:EP-solo-S01'));
  assert.deepEqual(second.moved.find((x) => x.id === 'story:EP-later-S01'), { id: 'story:EP-later-S01', from: null, to: 'planned' });
  assert.equal(second.since, digest.at);
  assert.deepEqual(mapModel(baseInputs(), { now: NOW, previous: digest }).moved, [], 'nothing moved, nothing lit');
});

test('small helpers: initials, hues and story titles', () => {
  assert.equal(initials('Kit Ansel'), 'KA');
  assert.equal(initials('bo.lindqvist'), 'BL');
  assert.equal(initials('mae'), 'MA');
  assert.equal(initials(''), '?');
  assert.equal(hueOf('m:kit'), hueOf('m:kit'));
  assert.ok(hueOf('x') >= 0 && hueOf('x') < 8);
  assert.equal(storyTitle('---\nid: x\n---\n# EP-x-S01\n\n## Story\nAs a buyer, I want it.\n'), 'As a buyer, I want it.');
});

// ---- gathering from git --------------------------------------------------------------------------

// A Product with one epic and a code repo with dev and main (Production), pushed to a bare origin.
function workspace({ production = undefined } = {}) {
  const ws = tmp();
  const bare = path.join(ws, 'origin-api.git');
  fs.mkdirSync(bare);
  git(bare, ['init', '-q', '--bare', '-b', 'dev']);
  const api = path.join(ws, 'api');
  fs.mkdirSync(api);
  git(api, ['init', '-q', '-b', 'dev']);
  git(api, ['remote', 'add', 'origin', bare]);
  put(path.join(api, 'a.txt'), 'a');
  git(api, ['add', '-A']); git(api, ['commit', '-q', '-m', 'start'], PEOPLE.kit, daysAgo(30));
  git(api, ['branch', 'main']);
  git(api, ['checkout', '-q', '-b', 'feat/EP-login-S01-T01']);
  put(path.join(api, 'b.txt'), 'b');
  git(api, ['add', '-A']); git(api, ['commit', '-q', '-m', 'sign in'], PEOPLE.bo, daysAgo(5));
  git(api, ['checkout', '-q', 'dev']);
  git(api, ['merge', '-q', '--no-ff', 'feat/EP-login-S01-T01', '-m', "Merge branch 'feat/EP-login-S01-T01' into 'dev'"], PEOPLE.mae, daysAgo(4));
  const merge = git(api, ['rev-parse', 'HEAD']);
  git(api, ['checkout', '-q', '-b', 'feat/EP-login-S02-open']);
  put(path.join(api, 'c.txt'), 'c');
  git(api, ['add', '-A']); git(api, ['commit', '-q', '-m', 'wip'], PEOPLE.mae, daysAgo(1));
  git(api, ['checkout', '-q', 'dev']);
  git(api, ['push', '-q', 'origin', '--all']);
  git(api, ['fetch', '-q', 'origin']);
  const root = path.join(ws, 'product');
  put(path.join(root, '.sdlc', 'product.json'), { name: 'Orchard', ...(production !== undefined ? { map: { production } } : {}) });
  put(path.join(root, '.sdlc', 'repos.json'), { repos: [{ name: 'api', path: '../api', default_branch: 'dev' }, { name: 'web', path: '../web', default_branch: 'dev' }] });
  const steps = [{ id: 'epic', type: 'author', artifact: 'epic.md', status: 'done' }, { id: 'epic-review', type: 'review+approve', artifact: 'epic.md', status: 'done' }];
  put(path.join(root, 'epics', 'EP-login', '.sdlc', 'state.json'), { epicId: 'EP-login', currentStep: 'ready-for-build', createdAt: '2026-10-01', steps });
  put(path.join(root, 'epics', 'EP-login', 'epic.md'), '---\nid: EP-login\nowner: Kit Ansel\n---\n# People log in </script><img src=x>\n');
  put(path.join(root, 'epics', 'EP-login', 'stories', 'EP-login-S01.md'), '---\nid: EP-login-S01\nepic: EP-login\nstatus: shipped\nowner: Bo Lindqvist\nrepos: [api]\n---\n\n## Story\nAs a person, I want to sign in.\n');
  put(path.join(root, 'epics', 'EP-login', 'stories', 'EP-login-S02.md'), '---\nid: EP-login-S02\nepic: EP-login\nstatus: approved\nowner: Mae Torvik\nrepos: [api]\n---\n\n## Story\nAs a person, I want to stay signed in.\n');
  put(path.join(root, 'epics', 'EP-login', '.sdlc', 'build-log.json'), { epic: 'EP-login', ships: [{ story: 'EP-login-S01', task: 'T01', repo: 'api', branch: 'feat/EP-login-S01-T01', pr: 'https://git.example.org/orchard/api/pull/1', mergeCommit: merge, shippedAt: '2026-11-10', engineer_review: [{ approver: 'kit' }] }] });
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '-A']); git(root, ['commit', '-q', '-m', 'record']);
  return { ws, root, api };
}

test('gathering: read-only git finds Production, where each ship reached, and who built it', () => {
  const { ws, root, api } = workspace();
  try {
    const before = git(api, ['for-each-ref', '--format=%(refname) %(objectname)']);
    const { inputs, problems } = gatherMap(root, { now: NOW });
    assert.deepEqual(problems, []);
    const repo = inputs.repos.find((r) => r.name === 'api');
    assert.equal(repo.productionBranch, 'main');
    assert.equal(repo.productionGuessed, true, 'no map.production: guessed, and said');
    assert.equal(inputs.repos.find((r) => r.name === 'web').available, false);
    const t = inputs.tasks[0];
    assert.deepEqual({ found: t.reach.found, prod: t.reach.prod, integ: t.reach.integ }, { found: true, prod: false, integ: true });
    assert.equal(t.builder, 'Bo Lindqvist', 'the merged branch\'s author, not the person who merged it');
    assert.equal(repo.waitingCommits, 2, 'the feature commit and its merge');
    const m = mapModel(inputs, { now: NOW });
    assert.equal(m.stories.find((s) => s.id === 'EP-login-S02').state, 'active');
    assert.equal(git(api, ['for-each-ref', '--format=%(refname) %(objectname)']), before, 'nothing in the repo changed');
  } finally { done(ws); }
});

test('map.production picks the branch; a name origin lacks is said, and nothing is guessed', () => {
  const a = workspace({ production: { api: 'main' } });
  const b = workspace({ production: { api: 'release' } });
  try {
    const ra = gatherMap(a.root, { now: NOW }).inputs.repos.find((r) => r.name === 'api');
    assert.deepEqual([ra.productionBranch, ra.productionGuessed], ['main', false]);
    const gb = gatherMap(b.root, { now: NOW });
    assert.equal(gb.inputs.repos.find((r) => r.name === 'api').productionBranch, null);
    assert.match(gb.problems[0], /map\.production names "release", which origin does not have/);
  } finally { done(a.ws, b.ws); }
});

// ---- the page and the command --------------------------------------------------------------------

test('the file: everything inline, hashed by the CSP, and no name can close its script', () => {
  const { ws, root } = workspace();
  try {
    const html = mapSnapshot(buildMap(root, { now: NOW, env: { [REPORTS_ENV]: path.join(ws, 'r') } }).model);
    assert.equal(html.includes('<script src='), false, 'the served script tags are gone');
    assert.equal(html.includes('</script><img'), false, 'a title is data, never markup');
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
    assert.match(csp, /default-src 'none'/);
    const hashes = new Set([...csp.matchAll(/'sha256-([^']+)'/g)].map((x) => x[1]));
    for (const block of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1])) assert.ok(hashes.has(createHash('sha256').update(block, 'utf8').digest('base64')));
    assert.ok(html.includes('id="yad-map-data"'));
  } finally { done(ws); }
});

test('the server: the key, the Host and GET only; map.json is the model', async () => {
  const { ws, root } = workspace();
  const s = await startMapServer(root, { env: { [REPORTS_ENV]: path.join(ws, 'r') } });
  const ask = (p, { method = 'GET', host = `127.0.0.1:${s.port}` } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, path: p, method, headers: { Host: host } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, csp: res.headers['content-security-policy'] })); });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal((await ask('/map.json')).status, 403, 'no key');
    assert.equal((await ask(`/map.json?t=${'0'.repeat(48)}`)).status, 403, 'a wrong key');
    assert.equal((await ask(`/map.json?t=${s.token}`, { host: 'evil.example:80' })).status, 403, 'a rebinding Host');
    assert.equal((await ask(`/map.json?t=${s.token}`, { method: 'POST' })).status, 405);
    assert.equal((await ask(`/../package.json?t=${s.token}`)).status, 404);
    const r = await ask(`/map.json?t=${s.token}`);
    assert.equal(r.status, 200);
    assert.match(r.csp, /default-src 'none'/);
    assert.equal(JSON.parse(r.body).product.name, 'Orchard');
    const page = await ask(`/?t=${s.token}`);
    assert.ok(page.body.includes(`app.js?t=${s.token}`));
  } finally { await s.close(); done(ws); }
});

test('the live stream says it is live, and a change in the ledger sends "rebuilt"', async () => {
  const { ws, root } = workspace();
  const s = await startMapServer(root, { live: true, debounce: 50, env: { [REPORTS_ENV]: path.join(ws, 'r') } });
  try {
    const events = await new Promise((resolve, reject) => {
      const seen = [];
      const req = http.request({ host: '127.0.0.1', port: s.port, path: `/events?t=${s.token}`, headers: { Host: `127.0.0.1:${s.port}` } }, (res) => {
        res.on('data', (c) => {
          seen.push(String(c));
          const all = seen.join('');
          if (all.includes('event: status') && !all.includes('touched')) { seen.push('touched'); setTimeout(() => put(path.join(root, 'epics', 'EP-login', 'epic.md'), '# changed\n'), 100); }
          if (all.includes('event: rebuilt')) { req.destroy(); resolve(all); }
        });
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
      req.end();
      setTimeout(() => { req.destroy(); resolve(seen.join('')); }, 5000).unref();
    });
    assert.match(events, /event: status\ndata: \{"live":true,"watching":\d+\}/);
    assert.match(events, /event: rebuilt/);
  } finally { await s.close(); done(ws); }
});

test('yad map --html saves into the reports folder with a digest; the next map says what moved; --anonymous keeps no digest', async () => {
  const { ws, root } = workspace();
  const env = { [REPORTS_ENV]: path.join(ws, 'reports') };
  try {
    const a = await captured(() => runMap(root, { html: true, json: true, env, now: NOW }));
    assert.match(path.basename(a.json.file), /--progress-map--all-epics--1-of-2-stories-shipped\.html$/);
    assert.ok(fs.existsSync(`${a.json.file}.digest.json`));
    assert.equal(a.json.moved, 0);
    put(path.join(root, 'epics', 'EP-login', 'stories', 'EP-login-S02.md'), '---\nid: EP-login-S02\nepic: EP-login\nstatus: shipped\nowner: Mae Torvik\nrepos: [api]\n---\n');
    const b = await captured(() => runMap(root, { html: true, json: true, env, now: NOW + 60000 }));
    assert.ok(b.json.moved >= 1, 'the story changed state since the first map');
    const anon = await captured(() => runMap(root, { html: true, anonymous: true, json: true, env, now: NOW + 120000 }));
    assert.match(anon.json.file, /-anonymous\.html$/);
    assert.equal(fs.existsSync(`${anon.json.file}.digest.json`), false);
    const text = fs.readFileSync(anon.json.file, 'utf8');
    for (const word of ['Kit Ansel', 'Lindqvist', 'Torvik', 'git.example.org']) assert.equal(text.includes(word), false, word);
    assert.deepEqual(readCatalog(env[REPORTS_ENV]).entries.map((e) => e.anonymous), [false, false, true]);
    // A file named by the person: written there, no catalog entry, no digest.
    const own = path.join(ws, 'mine.html');
    await captured(() => runMap(root, { html: true, args: [own], json: true, env, now: NOW }));
    assert.ok(fs.existsSync(own));
    assert.equal(fs.existsSync(`${own}.digest.json`), false);
    // --html and --live together is refused.
    assert.equal((await captured(() => runMap(root, { html: true, live: true, json: true, env }))).json.ok, false);
    process.exitCode = 0;
  } finally { done(ws); }
});

test('the CLI: unknown flags are refused, and agents may run it but are never pre-approved', () => {
  const { ws, root } = workspace();
  try {
    const r = spawnSync(process.execPath, [YAD, 'map', '--frob', '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /yad map does not take --frob/);
    const j = spawnSync(process.execPath, [YAD, 'map', '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1', [REPORTS_ENV]: path.join(ws, 'r') } });
    assert.equal(j.status, 0, j.stderr);
    assert.equal(JSON.parse(j.stdout).command, 'map');
    assert.equal(classify(['map']), 'local-write', 'it runs a server until Ctrl-C, as brain view does');
    assert.equal(classify(['map'], ['html']), 'local-write');
    assert.equal(readAllowList().includes('Bash(yad map:*)'), false);
  } finally { done(ws); }
});

// ---- review 1 ------------------------------------------------------------------------------------

test('review 1: --anonymous masks names joined by dots, underscores or nothing, and says nothing moved', () => {
  const i = baseInputs();
  i.branches.push(
    { repo: 'api', name: 'kit.ansel/EP-login-S01-try', sha: 'f'.repeat(40), date: daysAgo(2), author: 'Kit Ansel', inProd: false, inInteg: false, ahead: 1 },
    { repo: 'api', name: 'feat/EP-login-bo_lindqvist', sha: 'f'.repeat(40), date: daysAgo(2), author: 'Bo Lindqvist', inProd: false, inInteg: false, ahead: 1 },
    { repo: 'api', name: 'fix/kitansel-typo', sha: 'f'.repeat(40), date: daysAgo(2), author: 'Kit Ansel', inProd: false, inInteg: false, ahead: 1 });
  const digest = digestOf(mapModel(baseInputs(), { now: NOW }));
  const m = mapModel(i, { now: NOW, anonymous: true, previous: digest });
  const text = JSON.stringify(m).toLowerCase();
  for (const word of ['kit', 'ansel', 'lindqvist', 'kitansel']) assert.equal(text.includes(word), false, word);
  assert.ok(m.branches.some((b) => b.name === 'someone/EP-login-S01-try'));
  assert.ok(m.branches.some((b) => b.name === 'feat/EP-login-someone_someone'));
  assert.deepEqual(m.moved, []);
  assert.equal(m.since, null);
});

test('review 1: the person a gate waits on, and who released last, are on the people list', () => {
  const i = baseInputs({ waits: [{ epic: 'EP-later', step: 'epic-review', kind: 'gate', owner: 'Ida Quell' }] });
  const m = mapModel(i, { now: NOW });
  const ida = m.people.find((p) => p.name === 'Ida Quell');
  assert.deepEqual(ida.roles, ['owner'], 'the person a gate waits on owns that step');
  assert.equal(m.waiting[0].person, ida.key);
  assert.ok(m.people.some((p) => p.key === m.repos[0].integration.by), 'every "by" can be looked up');
  const anon = mapModel(i, { now: NOW, anonymous: true });
  assert.ok(anon.waiting[0].person, 'anonymous keeps the link to the badge');
  assert.ok(anon.people.some((p) => p.key === anon.repos[0].production.by));
});

test('review 1: a bad group pattern is left out, an epic id matches only whole, and a task-named port counts for that task only', () => {
  const i = baseInputs({ groups: [{ id: 'broken', label: 'Broken', pattern: '([' }, { id: 'chores', label: 'Chores', pattern: '^chore/' }, { id: 'rest', label: 'Rest' }] });
  i.epics.push({ id: 'EP-log', title: 'Logs', currentStep: 'epic', steps: [], owner: null, repos: [], onMain: true, stepOwners: {}, approvals: [] });
  const m = mapModel(i, { now: NOW });
  assert.equal(m.groups.some((g) => g.id === 'broken'), false);
  assert.equal(m.branches.find((b) => b.name === 'chore/kit-cleanup').group, 'chores');
  assert.equal(m.branches.find((b) => b.name === 'feat/EP-login-S02-remember').epic, 'EP-login', 'EP-log is not a match for EP-login');
  // A direct-to-Production branch named for T01 makes T01 live, not T02.
  const j = baseInputs();
  j.tasks.push({ story: 'EP-login-S01', epic: 'EP-login', task: 'T02', repo: 'api', builder: null, reviewers: [], reach: { found: true, prod: false, integ: true, via: null } });
  const mm = mapModel(j, { now: NOW });
  assert.equal(mm.tasks.find((t) => t.task === 'T02').state, 'merged');
});

test('review 1: gathering says when a group pattern is invalid, and reads a story-named port for every task of it', () => {
  const { ws, root, api } = workspace({ production: { api: 'main' } });
  try {
    // A second task of S01, only on dev; then the story rebuilt on its own branch, merged straight into main.
    git(api, ['checkout', '-q', '-b', 'feat/EP-login-S01-T02', 'dev']);
    put(path.join(api, 't2.txt'), 't2');
    git(api, ['add', '-A']); git(api, ['commit', '-q', '-m', 't2'], PEOPLE.bo, daysAgo(3));
    git(api, ['checkout', '-q', 'dev']);
    git(api, ['merge', '-q', '--no-ff', 'feat/EP-login-S01-T02', '-m', "Merge branch 'feat/EP-login-S01-T02' into 'dev'"], PEOPLE.mae, daysAgo(3));
    const t2 = git(api, ['rev-parse', 'HEAD']);
    git(api, ['checkout', '-q', '-b', 'feat/EP-login-S01-T02-production', 'main']);
    put(path.join(api, 't2p.txt'), 'p');
    git(api, ['add', '-A']); git(api, ['commit', '-q', '-m', 'port'], PEOPLE.bo, daysAgo(2));
    git(api, ['checkout', '-q', 'main']);
    git(api, ['merge', '-q', '--no-ff', 'feat/EP-login-S01-T02-production', '-m', "Merge branch 'feat/EP-login-S01-T02-production' into 'main'"], PEOPLE.mae, daysAgo(2));
    git(api, ['checkout', '-q', 'dev']);
    git(api, ['push', '-q', 'origin', '--all']); git(api, ['fetch', '-q', 'origin']);
    const logf = path.join(root, 'epics', 'EP-login', '.sdlc', 'build-log.json');
    const log = JSON.parse(fs.readFileSync(logf, 'utf8'));
    log.ships.push({ story: 'EP-login-S01', task: 'T02', repo: 'api', branch: 'feat/EP-login-S01-T02', mergeCommit: t2, shippedAt: '2026-11-11', engineer_review: [] });
    put(logf, log);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.sdlc', 'product.json'), 'utf8'));
    cfg.map.groups = [{ id: 'broken', pattern: '([' }];
    put(path.join(root, '.sdlc', 'product.json'), cfg);
    const g = gatherMap(root, { now: NOW });
    assert.match(g.problems.join('\n'), /the pattern of "broken" is not a valid pattern/);
    const t = (id) => g.inputs.tasks.find((x) => x.task === id);
    assert.equal(t('T02').reach.via?.branch, 'feat/EP-login-S01-T02-production', 'its own port');
    assert.equal(t('T01').reach.via, null, 'a port named for T02 is not T01\'s');
  } finally { done(ws); }
});

// ---- review 2 ------------------------------------------------------------------------------------

test('review 2: a port names a task by any separator and by its number; a story-only port is every task\'s', () => {
  const d = (branch) => [{ date: '2026-11-01T00:00:00Z', branch }];
  const is = (branch, task) => !!portFor(d(branch), 'EP-login-S01', task);
  for (const b of ['feat/EP-login-S01-T01', 'fix/EP-login-S01-T01-redo', 'EP-login-S01_T01', 'EP-login-S01.T1', 'EP-login-S01/T01']) assert.equal(is(b, 'T01'), true, b);
  for (const b of ['feat/EP-login-S01-T02', 'EP-login-S01_T02', 'EP-login-S01.T02', 'EP-login-S01/T2', 'EP-login-S010', 'EP-login-S01-T010']) assert.equal(is(b, 'T01'), false, b);
  for (const b of ['feat/EP-login-S01-hotfix', 'EP-login-S01', 'EP-login-S01-production']) { assert.equal(is(b, 'T01'), true, b); assert.equal(is(b, 'T02'), true, b); }
  assert.equal(is('EP-login-S01-T1', 'T1'), true);
  assert.equal(portFor([], 'EP-login-S01', 'T01'), null);
});

test('review 2: gathering reads a story-only port for every task of that story', () => {
  const { ws, root, api } = workspace({ production: { api: 'main' } });
  try {
    git(api, ['checkout', '-q', '-b', 'feat/EP-login-S01-production', 'main']);
    put(path.join(api, 'p.txt'), 'p');
    git(api, ['add', '-A']); git(api, ['commit', '-q', '-m', 'port'], PEOPLE.bo, daysAgo(2));
    git(api, ['checkout', '-q', 'main']);
    git(api, ['merge', '-q', '--no-ff', 'feat/EP-login-S01-production', '-m', "Merge branch 'feat/EP-login-S01-production' into 'main'"], PEOPLE.mae, daysAgo(2));
    git(api, ['checkout', '-q', 'dev']);
    git(api, ['push', '-q', 'origin', '--all']); git(api, ['fetch', '-q', 'origin']);
    const m = mapModel(gatherMap(root, { now: NOW }).inputs, { now: NOW });
    const t = m.tasks.find((x) => x.task === 'T01');
    assert.equal(t.state, 'live');
    assert.equal(t.via, 'feat/EP-login-S01-production');
  } finally { done(ws); }
});

test('review 2: where a recursive watch is not offered, each folder is watched; with nothing to watch, yad says so', async () => {
  const { ws, root } = workspace();
  const watch = fs.watch;
  let recursiveAsked = 0, plain = 0;
  fs.watch = (p, opts, cb) => { if (opts && opts.recursive) { recursiveAsked++; const e = new Error('no recursive watch'); e.code = 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM'; throw e; } plain++; return watch(p, opts, cb); };
  const s = await startMapServer(root, { live: true, debounce: 50, env: { [REPORTS_ENV]: path.join(ws, 'r') } });
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: s.port, path: `/events?t=${s.token}`, headers: { Host: `127.0.0.1:${s.port}` } }, (res) => {
        res.on('data', (c) => { if (String(c).includes('event: status')) { req.destroy(); resolve(String(c)); } });
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
      req.end();
    });
    assert.ok(recursiveAsked >= 1);
    assert.ok(plain > 2, 'each folder of the record is watched on its own');
    assert.match(status, /"live":true/);
  } finally { fs.watch = watch; await s.close(); }
  // A folder with nothing to watch: the server still starts, and says the page will not change by itself.
  const bare = path.join(ws, 'bare');
  put(path.join(bare, 'x.txt'), 'x');
  const out = [];
  const log = console.log;
  console.log = (x) => out.push(String(x));
  try {
    const srv = await runMap(bare, { live: true, wait: false, env: { [REPORTS_ENV]: path.join(ws, 'r') } });
    await srv.close();
  } finally { console.log = log; done(ws); }
  assert.match(out.join('\n'), /nothing here can be watched/);
  process.exitCode = 0;
});
