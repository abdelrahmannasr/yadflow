// #352: `yad doctor` checks the machine setup local work depends on — the active Node against each repo's
// pinned version, Docker only where a repo asks for it, and more than one glab config file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';

const { nodePins, satisfies, nodeFix, dockerReasons, dockerState, glabConfigs } = await import('./machine.mjs');
const { machineChecks } = await import('./doctor.mjs');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-machine-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const done = (T) => fs.rmSync(T, { recursive: true, force: true });

test('#352: satisfies reads the version forms repos pin, and says "not known" for the rest', () => {
  const yes = [['24.22.1', '24'], ['24.22.1', 'v24.22.1'], ['24.22.1', '>=22'], ['24.22.1', '^24.1.0'], ['24.22.1', '~24.22.0'],
    ['24.22.1', '22 || 24'], ['24.22.1', '>=20 <25'], ['24.22.1', '20 - 24.30'], ['24.22.1', '24.x'], ['24.22.1', '*'], ['22.8.0', '>=22.8'], ['24.22.1', '<=24']];
  const no = [['20.19.5', '24'], ['20.19.5', '>=22'], ['25.0.0', '^24.1.0'], ['24.23.0', '~24.22.0'], ['24.22.1', '<24'], ['24.22.1', '18 || 20'], ['21.0.0', '>=20 <21']];
  for (const [v, s] of yes) assert.equal(satisfies(v, s), true, `${v} ${s}`);
  for (const [v, s] of no) assert.equal(satisfies(v, s), false, `${v} ${s}`);
  for (const s of ['lts/*', 'node', 'lts/iron', 'https://x']) assert.equal(satisfies('24.22.1', s), null, s);
});

test('#352: nodePins reads .nvmrc, .node-version, .tool-versions, engines.node and volta.node', () => {
  const T = tmp();
  try {
    put(path.join(T, '.nvmrc'), '# the team\'s Node\n24\n');
    put(path.join(T, '.node-version'), 'v24.1.0\n');
    put(path.join(T, '.tool-versions'), 'python 3.12.1\nnodejs 24.2.0 # pinned\n');
    put(path.join(T, 'package.json'), { engines: { node: '>=22' }, volta: { node: '24.3.0' } });
    assert.deepEqual(nodePins(T), [
      { source: '.nvmrc', want: '24' }, { source: '.node-version', want: 'v24.1.0' }, { source: '.tool-versions', want: '24.2.0' },
      { source: 'package.json engines.node', want: '>=22' }, { source: 'package.json volta.node', want: '24.3.0' }]);
    fs.rmSync(path.join(T, 'package.json'));
    put(path.join(T, 'package.json'), '{ not json');
    assert.equal(nodePins(T).length, 3, 'a package.json that does not parse pins nothing');
  } finally { done(T); }
});

test('#352: the fix names nvm\'s commands when nvm is here, plain words otherwise', () => {
  assert.match(nodeFix('24', { env: { NVM_DIR: '/x' }, home: '/nowhere' }), /^nvm install 24 && nvm use 24 \(and `nvm alias default 24`/);
  assert.match(nodeFix('>=22', { env: { NVM_DIR: '/x' }, home: '/nowhere' }), /a version that meets >=22/);
  assert.match(nodeFix('24', { env: {}, home: '/nowhere' }), /^install Node 24/);
});

test('#352: Docker is asked about only where a repo names it', () => {
  const T = tmp();
  try {
    assert.deepEqual(dockerReasons(T), []);
    put(path.join(T, 'package.json'), { scripts: { test: 'node --test', 'scan': 'docker run --rm zricethezav/gitleaks', notdocker: 'echo dockerfile' } });
    assert.deepEqual(dockerReasons(T), ['package.json scripts: scan']);
    put(path.join(T, 'compose.yaml'), 'services: {}\n');
    put(path.join(T, '.pre-commit-config.yaml'), 'repos:\n  - repo: local\n    hooks:\n      - id: x\n        language: docker_image\n');
    assert.deepEqual(dockerReasons(T), ['compose.yaml', 'package.json scripts: scan', '.pre-commit-config.yaml (a docker hook)']);
    const runner = (answers) => (cmd, args) => ({ ok: answers[`${cmd} ${args[0]}`] ?? false });
    assert.equal(dockerState({ runner: runner({}) }), 'missing');
    assert.equal(dockerState({ runner: runner({ 'which docker': true }) }), 'stopped');
    assert.equal(dockerState({ runner: runner({ 'which docker': true, 'docker info': true }) }), 'running');
  } finally { done(T); }
});

test('#352: more than one glab config file is found where glab looks', () => {
  const T = tmp();
  try {
    assert.deepEqual(glabConfigs({ env: {}, home: T, platform: 'darwin' }), []);
    put(path.join(T, '.config/glab-cli/config.yml'), 'hosts: {}\n');
    put(path.join(T, 'Library/Application Support/glab-cli/config.yml'), 'hosts: {}\n');
    assert.equal(glabConfigs({ env: {}, home: T, platform: 'darwin' }).length, 2);
    assert.equal(glabConfigs({ env: {}, home: T, platform: 'linux' }).length, 1, 'not the macOS folder on Linux');
  } finally { done(T); }
});

test('#352: yad doctor rows — a Node a repo does not accept, Docker stopped where a repo needs it, two glab configs', () => {
  const T = tmp();
  try {
    const root = path.join(T, 'product');
    put(path.join(root, '.sdlc/product.json'), { platform: null });
    put(path.join(root, '.nvmrc'), '24\n');
    const app = path.join(T, 'app');
    put(path.join(app, 'package.json'), { engines: { node: '>=22' }, scripts: { scan: 'docker compose run gitleaks' } });
    execFileSync('git', ['init', '-q'], { cwd: app });
    put(path.join(root, '.sdlc/repos.json'), { repos: [{ name: 'app', path: '../app' }] });
    const home = path.join(T, 'home');
    put(path.join(home, '.config/glab-cli/config.yml'), 'hosts: {}\n');
    put(path.join(home, 'Library/Application Support/glab-cli/config.yml'), 'hosts: {}\n');
    const runner = (cmd, args) => ({ ok: `${cmd} ${args[0]}` === 'which docker' });
    const rows = (nodeVersion) => { const checks = []; machineChecks(checks, root, { nodeVersion, env: { NVM_DIR: '/x' }, home, platform: 'darwin', runner }); return Object.fromEntries(checks.map((c) => [c.id, c])); };
    const old = rows('20.19.5');
    assert.equal(old['node-version:the Product'].status, 'warn');
    assert.match(old['node-version:the Product'].message, /node 20\.19\.5 does not meet 24, which the Product pins \(\.nvmrc\)/);
    assert.match(old['node-version:the Product'].hint, /nvm install 24 && nvm use 24/);
    assert.equal(old['node-version:app'].status, 'warn');
    assert.equal(old.docker.status, 'warn');
    assert.match(old.docker.message, /Docker is not running, and app \(package\.json scripts: scan\) asks for it/);
    assert.equal(old['glab-config'].status, 'warn');
    assert.match(old['glab-config'].message, /glab has 2 config files: ~\/\.config\/glab-cli\/config\.yml, ~\/Library\/Application Support\/glab-cli\/config\.yml/);
    const now = rows('24.22.1');
    assert.equal(now['node-version'].status, 'ok');
    assert.match(now['node-version'].message, /meets every Node version the repos pin \(2\)/);
    assert.equal(now['node-version:the Product'], undefined);
  } finally { done(T); }
});

test('#352: a repo that names no pin and no Docker adds no rows, and Docker is never run', () => {
  const T = tmp();
  try {
    put(path.join(T, '.sdlc/product.json'), { platform: null });
    let asked = 0;
    const checks = [];
    machineChecks(checks, T, { nodeVersion: '24.22.1', env: {}, home: path.join(T, 'home'), platform: 'linux', runner: () => { asked += 1; return { ok: false }; } });
    assert.deepEqual(checks, []);
    assert.equal(asked, 0, 'docker is not asked about');
  } finally { done(T); }
});
