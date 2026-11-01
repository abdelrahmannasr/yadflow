// E161: which Node line yadflow runs on. Below 18 it does not run (YAD-ENV-003); 18 and 20 are end of life —
// yadflow 4 still runs on them, with a warning (YAD-ENV-004), and yadflow 5 needs 22; 22 and later are ok.
// Also: the CI files yad installs in people's repos name no end-of-life Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { nodeSupport, nodeEndOfLife, cpMerge } = await import('./lib.mjs');
const { envChecks } = await import('./doctor.mjs');
const { CODES } = await import('./errors.mjs');

test('E161: nodeSupport reads the major version into three bands', () => {
  for (const v of ['16.20.2', '17.0.0', 'v16.1.0', 'not-a-version']) assert.equal(nodeSupport(v), 'unsupported', v);
  for (const v of ['18.20.4', '20.19.5', 'v20.0.0', '21.7.3']) assert.equal(nodeSupport(v), 'end-of-life', v);
  for (const v of ['22.0.0', '22.22.2', '24.22.1', '25.1.0']) assert.equal(nodeSupport(v), 'ok', v);
  assert.match(nodeEndOfLife('20.19.5'), /^Node 20\.19\.5 is end of life and gets no security fixes\. yadflow 4 still runs on it; yadflow 5 will need Node 22 or newer\./);
});

test('E161: yad doctor\'s node row — fail below 18, warn on 18 to 21 (YAD-ENV-004), ok from 22', () => {
  const row = (nodeVersion) => { const checks = []; envChecks(checks, { nodeVersion }); return checks.find((x) => x.id === 'node'); };
  assert.equal(row('16.0.0').status, 'fail');
  assert.match(row('16.0.0').message, /YAD-ENV-003/);
  const old = row('20.19.5');
  assert.equal(old.status, 'warn');
  assert.match(old.message, /end of life.*YAD-ENV-004/);
  assert.match(old.hint, /22 or newer/);
  assert.equal(row('24.22.1').status, 'ok');
  assert.ok(CODES['YAD-ENV-004'], 'the code is in the catalogue');
});

test('E161: the CLI warns once on an end-of-life Node, on stderr only, and never under `hook`', () => {
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-node-')));
  try {
    const yad = (args, version) => spawnSync(process.execPath, [path.join(ROOT, 'bin/yad.mjs'), ...args], {
      cwd: T, encoding: 'utf8', input: '{}',
      env: { ...process.env, NO_COLOR: '1', YAD_PLATFORM_READ: '0', ...(version ? { YAD_TEST_NODE_VERSION: version } : {}) },
    });
    const old = yad(['detect', '--json'], '20.19.5');
    assert.equal((old.stderr.match(/is end of life/g) || []).length, 1, old.stderr);
    assert.doesNotMatch(old.stdout, /end of life/, 'stdout stays clean JSON');
    JSON.parse(old.stdout);
    assert.doesNotMatch(yad(['detect', '--json'], '24.22.1').stderr, /end of life/);
    assert.doesNotMatch(yad(['detect', '--json']).stderr, /end of life/, 'this Node (22 or later) gets no warning');
    assert.doesNotMatch(yad(['hook', 'agent-guard'], '20.19.5').stderr, /end of life/, 'a hook\'s stderr reaches the model');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E161: no CI file yad installs or generates names an end-of-life Node', () => {
  const files = [
    ...['skills/yad-checks/templates', 'skills/yad-product-bridge/templates', 'skills/yad-pr-template/templates'].flatMap((d) => fs.readdirSync(path.join(ROOT, d), { recursive: true }).map((f) => path.join(d, f))),
    'cli/docs.mjs',
  ].filter((f) => fs.statSync(path.join(ROOT, f)).isFile());
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(text, /node-version:\s*["']?(1[0-9]|20)["']?\s*$/m, f);
    assert.doesNotMatch(text, /image:\s*node:(1[0-9]|20)\b/, f);
    assert.doesNotMatch(text, /YAD_NODE_VERSION[^\n]*["'](1[0-9]|20)["']/, f);
  }
});

test('E161: cpMerge joins folders and never replaces a file (Node 24\'s cpSync refuses an existing folder)', () => {
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-cp-')));
  try {
    fs.mkdirSync(path.join(T, 'a/sub'), { recursive: true });
    fs.writeFileSync(path.join(T, 'a/f.txt'), 'x');
    fs.writeFileSync(path.join(T, 'a/sub/g.txt'), 'y');
    fs.mkdirSync(path.join(T, 'b/sub'), { recursive: true });
    fs.writeFileSync(path.join(T, 'b/keep.txt'), 'mine');
    cpMerge(path.join(T, 'a'), path.join(T, 'b'));
    assert.equal(fs.readFileSync(path.join(T, 'b/sub/g.txt'), 'utf8'), 'y');
    assert.equal(fs.readFileSync(path.join(T, 'b/keep.txt'), 'utf8'), 'mine', 'the folder\'s own files are kept');
    assert.throws(() => cpMerge(path.join(T, 'a'), path.join(T, 'b')), /EEXIST/, 'a file already there is never replaced');
    assert.equal(fs.readFileSync(path.join(T, 'b/f.txt'), 'utf8'), 'x');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
