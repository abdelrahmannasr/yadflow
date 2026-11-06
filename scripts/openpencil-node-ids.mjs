#!/usr/bin/env node
/* global console, process */
// Does the ID yad stores on an OpenPencil frame survive save, reopen and edits? (E164 PR 2)
//
// The #354 `design-frames` key and `design-links.json` name each screen by an ID. OpenPencil's own node
// IDs cannot be that ID: its CLI numbers nodes in the order it loads them (`0:4`, `0:5`…) each time it
// opens the file, so after a frame is deleted or added, another frame can take an old ID. Checked by hand
// on 0.16.0 (2026-11-06): after one delete and one insert, the old `0:6` ('Login') pointed to 'Home'.
// So yad-ui stores yad's own ID on each frame — shared plugin data, namespace `yad`, key `nodeId` — and
// every read finds the frame by it, with the same call the skills give the agent
// (`figma.root.findAll((n) => n.getSharedPluginData('yad', 'nodeId') === id)`). This script checks that
// this still holds for a pinned version, a frame inside another frame included.
//
//   node scripts/openpencil-node-ids.mjs              the version pinned in cli/toolbox.mjs
//   node scripts/openpencil-node-ids.mjs 0.17.0       another version, before moving the pin
//
// It downloads @open-pencil/cli from npm (network needed) into a new temporary folder, with its install
// scripts off. The package is someone else's code, and its program does run here, on a scratch design
// file: it gets only a small set of environment variables (no tokens from the environment), and the temporary folder is removed
// at the end, also on Ctrl-C. On a pass, set `vetted.handCheck.version` in cli/toolbox.mjs to the version
// checked; the unit suite fails while the CLI pin and that version differ. Only the CLI pin is watched:
// the IDs live in the file, which the CLI writes; the MCP server forwards to the desktop app.
// Exit 0: the stored IDs held. 1: one was lost or moved. 2: it could not run.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOLBOX } from '../cli/toolbox.mjs';

const PKG = '@open-pencil/cli';
const TIMEOUT = 180_000;
const pinned = TOOLBOX.find((t) => t.id === 'openpencil')?.vetted?.packages?.find((p) => p.name === PKG)?.version;
const version = process.argv[2] ?? pinned;
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: node scripts/openpencil-node-ids.mjs [<version, such as 0.16.0>]');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-openpencil-'));
const pkgDir = path.join(tmp, 'pkg');
const workDir = path.join(tmp, 'work');
const cleanUp = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* left behind; said below */ } };
const fail = (code, msg) => {
  console.error(msg);
  cleanUp();
  if (fs.existsSync(tmp)) console.error(`could not remove ${tmp} — delete it by hand`);
  process.exit(code);
};
process.on('SIGINT', () => fail(2, 'stopped'));

// npm through node itself where it can be found: no shell, so a temporary folder with a space in its
// path (a Windows user name) stays one argument.
function npmCommand() {
  const dir = path.dirname(process.execPath);
  for (const cli of [path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), process.env.npm_execpath]) {
    if (cli && path.basename(cli) === 'npm-cli.js' && fs.existsSync(cli)) return [process.execPath, [cli]];
  }
  return process.platform === 'win32' ? null : ['npm', []];
}
// What the package's program gets from this process's environment: enough to run, no tokens. (It can still
// read the files your user can, such as ~/.npmrc — it is a program you chose to run.)
const SAFE_ENV = Object.fromEntries(['PATH', 'Path', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'LANG']
  .filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));

try {
  fs.mkdirSync(pkgDir);
  fs.mkdirSync(workDir);
  const npmCmd = npmCommand();
  if (!npmCmd) fail(2, 'npm was not found next to node — run this with a Node.js that ships npm');
  const npm = spawnSync(npmCmd[0], [...npmCmd[1], 'install', '--prefix', pkgDir, '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', `${PKG}@${version}`],
    { encoding: 'utf8', timeout: TIMEOUT });
  if (npm.signal === 'SIGINT') fail(2, 'stopped');
  if (npm.status !== 0) fail(2, `npm could not install ${PKG}@${version}: ${npm.error?.message ?? ''}\n${npm.stderr || npm.stdout || ''}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'node_modules', ...PKG.split('/'), 'package.json'), 'utf8'));
  const binRel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.openpencil;
  if (!binRel) fail(2, `${PKG}@${version} names no openpencil program`);
  const bin = path.join(pkgDir, 'node_modules', ...PKG.split('/'), binRel);

  // Every call runs in the work folder, with the code on stdin (no shell quoting on any system).
  const op = (args, code) => {
    const r = spawnSync(process.execPath, [bin, ...args], { cwd: workDir, input: code, encoding: 'utf8', timeout: TIMEOUT, env: SAFE_ENV });
    if (r.signal === 'SIGINT') fail(2, 'stopped');
    if (r.status !== 0) fail(2, `openpencil ${args.join(' ')} failed: ${r.error?.message ?? ''}\n${r.stderr || r.stdout || ''}`);
    return r.stdout;
  };
  const file = 'screens.fig';
  fs.writeFileSync(path.join(workDir, 'seed.html'), '<div>seed</div>\n');
  op(['import', 'seed.html', '-o', file]);
  const write = (code) => op(['eval', file, '--stdin', '--write', '--quiet'], code);
  // Every node carrying a yad ID, found the way the skills tell the agent to. A read returns one JSON
  // string, so nothing else on stdout can be mistaken for it.
  const read = () => {
    const out = op(['eval', file, '--stdin', '--json'], `return JSON.stringify(figma.root.findAll((n) => n.getSharedPluginData('yad', 'nodeId') !== '').map((n) => ({ id: n.id, name: n.name, yad: n.getSharedPluginData('yad', 'nodeId') })))`);
    return JSON.parse(JSON.parse(out.trim()));
  };
  // The code OpenPencil runs is fixed text: nothing is pasted into it, so nothing can change what it does.
  const TAG = `const tag = (name, id, parent) => { const f = figma.createFrame(); f.name = name; f.setSharedPluginData('yad', 'nodeId', id); if (parent) parent.appendChild(f); return f; };`;
  write(`${TAG}
tag('Login', 'login'); tag('Home', 'home'); tag('Cart', 'cart');
const box = figma.createFrame(); box.name = 'Flow';
tag('Step', 'step', box);`);
  const first = read();
  // The edits a design goes through: a frame deleted, one added at the top, one renamed.
  write(`${TAG}
figma.currentPage.children.find((n) => n.name === 'div').remove();
figma.currentPage.children.find((n) => n.name === 'Home').name = 'Home v2';
figma.currentPage.insertChild(0, tag('Splash', 'splash'));`);
  const second = read();
  const third = read();

  const problems = [];
  const expect = { login: 'Login', home: 'Home v2', cart: 'Cart', step: 'Step', splash: 'Splash' };
  for (const id of ['login', 'home', 'cart', 'step']) if (!first.some((n) => n.yad === id)) problems.push(`the stored ID '${id}' was lost on the first save`);
  for (const [id, name] of Object.entries(expect)) {
    const hits = second.filter((n) => n.yad === id);
    if (hits.length !== 1) problems.push(`the stored ID '${id}' is on ${hits.length} frames after the edits (expected 1)`);
    else if (hits[0].name !== name) problems.push(`the stored ID '${id}' now names '${hits[0].name}', not '${name}'`);
  }
  if (JSON.stringify(second) !== JSON.stringify(third)) problems.push('a second reopen with no edit gave different frames');

  // For information: whether OpenPencil's own IDs moved (they did on 0.16.0). Never a failure.
  const before = new Map(first.map((n) => [n.yad, n.id]));
  const moved = second.filter((n) => before.has(n.yad) && before.get(n.yad) !== n.id).map((n) => `${n.yad}: ${before.get(n.yad)} → ${n.id}`);
  console.log(`${PKG}@${version}: OpenPencil's own node IDs ${moved.length ? `moved on reopen (${moved.join(', ')})` : 'did not move this time'} — yad never records them.`);
  if (problems.length) fail(1, `FAIL: yad's stored frame IDs did not hold:\n  - ${problems.join('\n  - ')}`);
  console.log(`PASS: every frame ID yad stored held through save, reopen, a delete, an insert and a rename, a frame inside another included. Set vetted.handCheck.version to ${version} in cli/toolbox.mjs if it is not already.`);
  cleanUp();
} catch (e) {
  fail(2, `the check could not run: ${e?.message ?? e}`);
}
