// E160a: `yad signing check`. The rules each test pins (the case list is in the E160 roadmap row):
//   - this machine: signing on, the format, the email, the key (SSH: the file and ssh-keygen, git 2.34+;
//     GPG: gpg finds the secret key), and a suggestion for the allowed-signers file;
//   - the account: the key listed for SIGNING (an authentication-only key is a gap), and a verified email;
//   - a read that fails is `unknown` with the fix, never `ok`; no login, no CLI or reads off: `unknown`;
//   - `yad doctor` has one line for it, from the git config alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
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
const { signingCheck, signingDoctorLine, sshPublicKey, gpgIds } = await import('./signing.mjs');
const { run } = await import('./lib.mjs');
const { classify, readAllowList } = await import('./agent-rules.mjs');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-signing-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const PUB = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ5vFakeKeyForYadTestsOnly0000000000000000 me@example.com';
const OTHER = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOtherKeyForYadTestsOnly11111111111111111 x@y';

// A repo with its own git config, and a global config that is empty (nothing from this machine leaks in).
function setup({ config = {}, product = null } = {}) {
  const T = tmp();
  const home = path.join(T, 'home');
  fs.mkdirSync(home);
  const global = path.join(T, 'gitconfig');
  fs.writeFileSync(global, '');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', HOME: home, YAD_PLATFORM_READ: '' };
  const dir = path.join(T, 'repo');
  fs.mkdirSync(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  for (const [k, v] of Object.entries(config)) execFileSync('git', ['config', k, v.replace('<home>', home)], { cwd: dir, env });
  if (product) put(path.join(dir, '.sdlc/product.json'), product);
  return { T, dir, home, env };
}
const sshConfig = { 'commit.gpgsign': 'true', 'gpg.format': 'ssh', 'user.email': 'me@example.com', 'user.signingkey': '<home>/.ssh/id_ed25519.pub' };
const GH = { platform: 'github', git_url: 'git@github.com:acme/p.git', default_branch: 'main' };
const GL = { platform: 'gitlab', git_url: 'git@gitlab.com:acme/p.git', default_branch: 'main' };

// The platform CLIs: `auth status` and `api … <path>` answered from a table; everything asked is kept.
function platform({ authed = true, calls = {} } = {}) {
  const asked = [];
  const runner = (cmd, args) => {
    asked.push([cmd, ...args].join(' '));
    if (args[0] === 'auth') return { ok: authed, stdout: '', stderr: '' };
    const p = args[3];
    const hit = Object.entries(calls).find(([re]) => new RegExp(re).test(p));
    if (!hit) return { ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
    const [status, body] = hit[1];
    return status === 200 ? { ok: true, stdout: JSON.stringify(body), stderr: '' } : { ok: false, stdout: '', stderr: `gh: Refused (HTTP ${status})` };
  };
  return { runner, asked };
}
const tools = (...names) => (t) => names.includes(t);
const byId = (r) => Object.fromEntries(r.findings.map((f) => [f.id, f]));
const check = (s, opts) => signingCheck(s.dir, { root: s.dir, env: s.env, home: s.home, gitRun: (c, a, o = {}) => run(c, a, { ...o, env: s.env }), haveTool: tools('gh', 'glab', 'ssh-keygen'), ...opts });

test('E160 case 1: signing off is a gap with the command to turn it on', () => {
  const s = setup({ config: { 'user.email': 'me@example.com' } });
  try {
    const r = check(s, { root: null });
    assert.equal(byId(r).gpgsign.status, 'gap');
    assert.deepEqual(byId(r).gpgsign.fix.commands, ['git config --global commit.gpgsign true']);
    assert.equal(byId(r).gpgsign.fix.actor, 'person');
    assert.ok(r.summary.gaps >= 1);
    assert.match(r.notes[0], /no Product here/);
    assert.ok(!r.findings.some((f) => f.id.startsWith('platform-')), 'case 10: no Product, no account rows');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 case 2: SSH set up, the key listed for signing on GitHub, the email verified → all ok', () => {
  const s = setup({ config: { ...sshConfig, 'gpg.ssh.allowedSignersFile': '<home>/.ssh/allowed_signers' }, product: GH });
  try {
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    const { runner, asked } = platform({ calls: { '^user/ssh_signing_keys': [200, [{ key: OTHER }, { key: PUB.split(' ').slice(0, 2).join(' ') }]], '^user/emails': [200, [{ email: 'me@example.com', verified: true }]] } });
    const r = check(s, { runner });
    for (const f of r.findings) assert.equal(f.status, 'ok', JSON.stringify(f));
    assert.deepEqual(r.summary, { gaps: 0, suggestions: 0, unknown: 0, complete: true, accountChecked: true });
    assert.ok(asked.every((a) => /^gh (auth status|api --hostname github\.com user)/.test(a)), 'only reads');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 case 3: the SSH key file missing, a key:: value, ssh-keygen missing, an old git', () => {
  assert.match(sshPublicKey('/nowhere/id_ed25519').problem, /does not exist/);
  assert.equal(sshPublicKey(`key::${PUB}`).key, PUB.split(' ').slice(0, 2).join(' '));
  const s = setup({ config: sshConfig });
  try {
    assert.equal(byId(check(s, { root: null })).key.status, 'gap', 'the .pub is not there');
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    assert.equal(byId(check(s, { root: null })).key.status, 'ok');
    assert.equal(byId(check(s, { root: null, haveTool: tools() })).key.status, 'gap', 'no ssh-keygen');
    assert.equal(byId(check(s, { root: null }))['allowed-signers'].status, 'suggest');
    const old = check(s, { root: null, gitRun: (c, a, o = {}) => (a[0] === '--version' ? { ok: true, stdout: 'git version 2.30.1' } : run(c, a, { ...o, env: s.env })) });
    assert.equal(byId(old)['git-version'].status, 'gap');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 case 4: a GPG key found and not found; a subkey matches the account', () => {
  assert.deepEqual([...gpgIds('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scESC:\nfpr:::::::::0123456789ABCDEF0123456789ABCDEF01234567:\nssb:u:255:18:1111222233334444:1::::::e:')].sort(),
    ['0123456789ABCDEF0123456789ABCDEF01234567', '1111222233334444', 'AAAABBBBCCCCDDDD']);
  const s = setup({ config: { 'commit.gpgsign': 'true', 'user.email': 'me@example.com', 'user.signingkey': 'AAAABBBBCCCCDDDD' }, product: GH });
  try {
    const gpg = (found) => (c, a, o = {}) => (c === 'gpg' ? (found ? { ok: true, stdout: 'sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scESC:\nssb:u:255:22:5555666677778888:1::::::s:' } : { ok: false, stdout: '' }) : run(c, a, { ...o, env: s.env }));
    const none = check(s, { gitRun: gpg(false), haveTool: tools('gh', 'gpg'), runner: platform().runner });
    assert.equal(byId(none).key.status, 'gap');
    assert.equal(byId(none)['platform-key'].status, 'unknown', 'no local key: nothing to match');
    const { runner } = platform({ calls: { '^user/gpg_keys': [200, [{ key_id: '9999999999999999', subkeys: [{ key_id: '5555666677778888' }] }]], '^user/emails': [200, [{ email: 'me@example.com', verified: true }]] } });
    const r = check(s, { gitRun: gpg(true), haveTool: tools('gh', 'gpg'), runner });
    assert.equal(byId(r).key.status, 'ok');
    assert.equal(byId(r)['platform-key'].status, 'ok', 'matched by the subkey');
    // The account's copy expired or was revoked: a gap, never ok, even when the key here is in force.
    for (const copy of [{ key_id: '9999999999999999', expires_at: '2000-01-01T00:00:00Z', subkeys: [{ key_id: '5555666677778888' }] }, { key_id: '9999999999999999', revoked: true, subkeys: [{ key_id: '5555666677778888' }] }, { key_id: '9999999999999999', subkeys: [{ key_id: '5555666677778888', expires_at: '2000-01-01T00:00:00Z' }] }]) {
      const old = byId(check(s, { gitRun: gpg(true), haveTool: tools('gh', 'gpg'), runner: platform({ calls: { '^user/gpg_keys': [200, [copy]], '^user/emails': [200, [{ email: 'me@example.com', verified: true }]] } }).runner }))['platform-key'];
      assert.equal(old.status, 'gap', JSON.stringify(copy));
      assert.match(old.message, /expired, was revoked or is not valid/);
    }
    assert.equal(byId(check(s, { gitRun: gpg(true), haveTool: tools('gh') })).key.status, 'gap', 'no gpg: a gap, with the SSH way named');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 case 5: a key the account has for logging in only is a gap, on GitHub and GitLab', () => {
  for (const [product, calls, url] of [
    [GH, { '^user/ssh_signing_keys': [200, []], '^user/keys': [200, [{ key: PUB }]], '^user/emails': [200, [{ email: 'me@example.com', verified: true }]] }, 'https://github.com/settings/keys'],
    [GL, { '^user/keys': [200, [{ key: PUB, usage_type: 'auth' }]], '^user$': [200, { email: 'me@example.com' }], '^user/emails': [200, []] }, 'https://gitlab.com/-/user_settings/ssh_keys'],
  ]) {
    const s = setup({ config: sshConfig, product });
    try {
      put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
      const f = byId(check(s, { runner: platform({ calls }).runner }))['platform-key'];
      assert.equal(f.status, 'gap', product.platform);
      assert.match(f.message, /logging in only/);
      assert.equal(f.fix.url, url);
    } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
  }
});

test('E160 case 6: a refused read is unknown with the scope to add, never ok', () => {
  const s = setup({ config: sshConfig, product: GH });
  try {
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    for (const status of [403, 404]) {
      const r = check(s, { runner: platform({ calls: { '^user/ssh_signing_keys': [status], '^user/emails': [status] } }).runner });
      assert.equal(byId(r)['platform-key'].status, 'unknown');
      assert.deepEqual(byId(r)['platform-key'].fix.commands, ['gh auth refresh -h github.com -s read:ssh_signing_key']);
      assert.deepEqual(byId(r)['platform-email'].fix.commands, ['gh auth refresh -h github.com -s user:email']);
      assert.equal(r.summary.complete, false);
    }
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 case 7: not logged in, no gh, or reads off: the account rows are unknown', () => {
  const s = setup({ config: sshConfig, product: GH });
  try {
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    const out = byId(check(s, { runner: platform({ authed: false }).runner }));
    assert.equal(out['platform-key'].status, 'unknown');
    assert.deepEqual(out['platform-key'].fix.commands, ['gh auth login --hostname github.com']);
    assert.equal(byId(check(s, { haveTool: tools('ssh-keygen') }))['platform-email'].status, 'unknown');
    const off = check(s, { env: { ...s.env, YAD_PLATFORM_READ: '0' }, runner: () => { throw new Error('no platform call when reads are off'); } });
    assert.equal(byId(off)['platform-key'].status, 'unknown');
    assert.equal(off.summary.complete, false);
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 case 8: GitLab — a key for signing, GPG keys read through gpg, confirmed emails', () => {
  const s = setup({ config: sshConfig, product: GL });
  try {
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    const { runner } = platform({ calls: { '^user/keys': [200, [{ key: PUB, usage_type: 'auth_and_signing' }]], '^user$': [200, { email: 'other@example.com' }], '^user/emails': [200, [{ email: 'me@example.com', confirmed_at: '2026-01-01' }]] } });
    const r = byId(check(s, { runner }));
    assert.equal(r['platform-key'].status, 'ok');
    assert.equal(r['platform-email'].status, 'ok');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
  const g = setup({ config: { 'commit.gpgsign': 'true', 'user.email': 'me@example.com', 'user.signingkey': 'AAAABBBBCCCCDDDD' }, product: GL });
  try {
    const gitRun = (c, a, o = {}) => {
      if (c !== 'gpg') return run(c, a, { ...o, env: g.env });
      if (a.includes('--import')) return { ok: true, stdout: o.input === 'ARMORED' ? 'pub:-:255:22:AAAABBBBCCCCDDDD:1::::::scESC:' : '' };
      return { ok: true, stdout: 'sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scESC:' };
    };
    const { runner } = platform({ calls: { '^user/gpg_keys': [200, [{ key: 'ARMORED' }]], '^user$': [200, { email: 'me@example.com' }], '^user/emails': [200, []] } });
    assert.equal(byId(check(g, { gitRun, haveTool: tools('glab', 'gpg'), runner }))['platform-key'].status, 'ok');
    const expiredCopy = (c, a, o = {}) => (c === 'gpg' && a.includes('--import') ? { ok: true, stdout: 'pub:e:255:22:AAAABBBBCCCCDDDD:1::::::scESC:' } : gitRun(c, a, o));
    const gone = byId(check(g, { gitRun: expiredCopy, haveTool: tools('glab', 'gpg'), runner }))['platform-key'];
    assert.equal(gone.status, 'gap', 'GitLab\'s copy expired');
    assert.match(gone.message, /expired, was revoked or is not valid/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E160 case 9: an email not verified, or not on the account, is a gap', () => {
  const s = setup({ config: sshConfig, product: GH });
  try {
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    const keys = { '^user/ssh_signing_keys': [200, [{ key: PUB }]] };
    const unverified = byId(check(s, { runner: platform({ calls: { ...keys, '^user/emails': [200, [{ email: 'Me@Example.com', verified: false }]] } }).runner }))['platform-email'];
    assert.equal(unverified.status, 'gap');
    assert.match(unverified.message, /not verified/);
    const absent = byId(check(s, { runner: platform({ calls: { ...keys, '^user/emails': [200, [{ email: 'else@example.com', verified: true }]] } }).runner }))['platform-email'];
    assert.equal(absent.status, 'gap');
    assert.equal(absent.fix.url, 'https://github.com/settings/emails');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 case 10: a Product with no platform: only this machine, with a note', () => {
  const s = setup({ config: sshConfig, product: { platform: null } });
  try {
    const r = check(s, { runner: () => { throw new Error('no platform call'); } });
    assert.ok(!r.findings.some((f) => f.id.startsWith('platform-')));
    assert.match(r.notes[0], /names no platform/);
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 case 11: the doctor line reads the git config only', () => {
  const off = setup();
  const on = setup({ config: sshConfig });
  try {
    const gitOnly = (env) => (c, a, o = {}) => { assert.equal(c, 'git', 'only git is asked'); return run(c, a, { ...o, env }); };
    assert.equal(signingDoctorLine(off.dir, { gitRun: gitOnly(off.env) }).status, 'warn');
    const line = signingDoctorLine(on.dir, { gitRun: gitOnly(on.env) });
    assert.deepEqual([line.status, line.message], ['ok', 'commits made here are signed (SSH)']);
  } finally { for (const s of [off, on]) fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 case 12: `signing check` is a read the agent runs without asking, and the CLI answers --json', () => {
  assert.equal(classify(['signing', 'check']), 'read');
  assert.equal(classify(['signing']), 'read', 'its default action');
  assert.ok(readAllowList().includes('Bash(yad signing check:*)'));
  const s = setup({ config: { 'user.email': 'me@example.com' } });
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/yad.mjs'), 'signing', 'check', '--json'], { cwd: s.dir, env: { ...s.env, NO_COLOR: '1', YAD_PLATFORM_READ: '0' }, encoding: 'utf8' });
    const out = JSON.parse(r.stdout);
    assert.equal(r.status, 1, 'a gap exits 1');
    assert.equal(out.command, 'signing check');
    assert.equal(out.summary.gaps >= 1, true);
    assert.match(spawnSync(process.execPath, [path.join(ROOT, 'bin/yad.mjs'), 'signing', 'nope'], { cwd: s.dir, env: s.env, encoding: 'utf8' }).stdout, /unknown signing action/);
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

// ---- review 1: no false ok ------------------------------------------------------------------------------

test('E160 review 1: with no account read, the check is never complete', () => {
  const s = setup({ config: { ...sshConfig, 'gpg.ssh.allowedSignersFile': '<home>/a' } });
  try {
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    const r = check(s, { root: null });
    assert.equal(r.summary.gaps, 0);
    assert.deepEqual([r.summary.complete, r.summary.accountChecked], [false, false]);
    // Not logged in: unknown, and not complete either.
    const p = setup({ config: sshConfig, product: GH });
    try {
      put(path.join(p.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
      assert.equal(check(p, { runner: platform({ authed: false }).runner }).summary.complete, false);
    } finally { fs.rmSync(p.T, { recursive: true, force: true }); }
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 review 1: a GitHub no-reply address counts only when it is this account\'s', () => {
  const s = setup({ config: { ...sshConfig, 'user.email': '999+someoneelse@users.noreply.github.com' }, product: GH });
  try {
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    const calls = { '^user/ssh_signing_keys': [200, [{ key: PUB }]], '^user$': [200, { login: 'me', id: 42 }] };
    const other = byId(check(s, { runner: platform({ calls }).runner }))['platform-email'];
    assert.equal(other.status, 'gap');
    assert.match(other.fix.steps[0], /42\+me@users\.noreply\.github\.com/);
    execFileSync('git', ['config', 'user.email', '42+me@users.noreply.github.com'], { cwd: s.dir, env: s.env });
    assert.equal(byId(check(s, { runner: platform({ calls }).runner }))['platform-email'].status, 'ok');
    // A login but no id: `42+me@` may be this account's (unknown); `me@` still matches.
    assert.equal(byId(check(s, { runner: platform({ calls: { '^user/ssh_signing_keys': [200, [{ key: PUB }]], '^user$': [200, { login: 'me' }] } }).runner }))['platform-email'].status, 'unknown');
    execFileSync('git', ['config', 'user.email', 'me@users.noreply.github.com'], { cwd: s.dir, env: s.env });
    assert.equal(byId(check(s, { runner: platform({ calls: { '^user/ssh_signing_keys': [200, [{ key: PUB }]], '^user$': [200, { login: 'me' }] } }).runner }))['platform-email'].status, 'ok');
    execFileSync('git', ['config', 'user.email', '42+me@users.noreply.github.com'], { cwd: s.dir, env: s.env });
    // An answer with no login: unknown, never a gap or an ok.
    assert.equal(byId(check(s, { runner: platform({ calls: { '^user/ssh_signing_keys': [200, [{ key: PUB }]], '^user$': [200, {}] } }).runner }))['platform-email'].status, 'unknown');
    // The account could not be read: unknown, never ok.
    assert.equal(byId(check(s, { runner: platform({ calls: { '^user/ssh_signing_keys': [200, [{ key: PUB }]] } }).runner }))['platform-email'].status, 'unknown');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 review 1: a GPG key is looked up by the exact email; several keys, or one that cannot sign, is a gap', () => {
  const s = setup({ config: { 'commit.gpgsign': 'true', 'user.email': 'me@example.com' }, product: GH });
  try {
    let asked = null;
    const gpg = (out) => (c, a, o = {}) => { if (c !== 'gpg') return run(c, a, { ...o, env: s.env }); asked = a.at(-1); return { ok: true, stdout: out }; };
    const two = 'sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scESC:\nsec:u:255:22:1111222233334444:1::::::scESC:';
    const r = byId(check(s, { gitRun: gpg(two), haveTool: tools('gh', 'gpg'), runner: platform().runner }));
    assert.equal(asked, '<me@example.com>', 'the exact address, never a part of one');
    assert.equal(r.key.status, 'gap');
    assert.match(r.key.message, /2 secret keys/);
    for (const [line, why] of [['sec:e:255:22:AAAABBBBCCCCDDDD:1::::::scESC:', 'expired'], ['sec:r:255:22:AAAABBBBCCCCDDDD:1::::::scESC:', 'revoked'], ['sec:u:255:22:AAAABBBBCCCCDDDD:1::::::eE:', 'no sign capability']]) {
      const k = byId(check(s, { gitRun: gpg(line), haveTool: tools('gh', 'gpg'), runner: platform().runner })).key;
      assert.equal(k.status, 'gap', why);
      assert.match(k.message, /cannot sign now/, why);
    }
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 review 2: only a key that can sign here counts: a certify-only primary with a signing subkey, a stub', () => {
  const certifyOnly = 'sec:u:255:22:AAAABBBBCCCCDDDD:1::::::cSC:::+:\nfpr:::::::::0123456789ABCDEF0123456789ABCDEFAAAABBBB:\nssb:u:255:22:5555666677778888:1::::::s:::+:\nfpr:::::::::FEDCBA9876543210FEDCBA987654321055556666:';
  assert.deepEqual([...gpgIds(certifyOnly, { signing: true })].sort(), ['5555666677778888', 'FEDCBA9876543210FEDCBA987654321055556666'], 'the subkey signs, the primary only certifies');
  assert.equal(gpgIds(certifyOnly, { signing: true }).keys, 1);
  assert.equal(gpgIds('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::#:', { signing: true }).size, 0, 'a stub: its secret is not here');
  assert.equal(gpgIds('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:\nsec:r:255:22:1111222233334444:1::::::scSC:', { signing: true }).keys, 1, 'a revoked key is not one git may pick');
  assert.equal(gpgIds('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:\nsec:u:255:22:1111222233334444:1::::::eE:', { signing: true }).keys, 1, 'an encrypt-only key is not one git may pick');
  // Without `signing`, every id is listed, dead keys too; with `live`, only keys still in force.
  const expired = 'pub:e:255:22:AAAABBBBCCCCDDDD:1::::::scSC:\nfpr:::::::::0123456789ABCDEF0123456789ABCDEFAAAABBBB:\nsub:e:255:22:5555666677778888:1::::::s:';
  assert.deepEqual([...gpgIds(expired)].sort(), ['0123456789ABCDEF0123456789ABCDEFAAAABBBB', '5555666677778888', 'AAAABBBBCCCCDDDD']);
  assert.deepEqual([...gpgIds(expired, { live: true })], []);
  assert.deepEqual([...gpgIds('pub:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:\nsub:e:255:22:5555666677778888:1::::::s:', { live: true })], ['AAAABBBBCCCCDDDD'], 'only the expired subkey drops');
  assert.equal(gpgIds('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSCD:', { signing: true }).size, 0, 'a disabled key (D in field 12)');
});

test('E160 review 3: an offline primary, a stub or a smartcard through the whole check; a valid key beside a revoked one', () => {
  const s = setup({ config: { 'commit.gpgsign': 'true', 'user.email': 'me@example.com' }, product: GH });
  try {
    const gpg = (out) => (c, a, o = {}) => (c === 'gpg' ? { ok: true, stdout: out } : run(c, a, { ...o, env: s.env }));
    const key = (out) => byId(check(s, { gitRun: gpg(out), haveTool: tools('gh', 'gpg'), runner: platform().runner })).key;
    // The usual offline-primary setup: the primary is a stub, the signing subkey is here.
    const offline = 'sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::#:\nssb:u:255:22:5555666677778888:1::::::s:::+:';
    assert.equal(gpgIds(offline, { signing: true }).size, 1);
    assert.equal(key(offline).status, 'ok');
    const stub = key('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::#:');
    assert.equal(stub.status, 'gap');
    assert.match(stub.message, /cannot sign now .*not on this machine/);
    assert.equal(key('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:\nsec:r:255:22:1111222233334444:1::::::scSC:').status, 'ok', 'a revoked key beside it is not "several keys"');
    assert.equal(gpgIds('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:\nsec:r:255:22:1111222233334444:1::::::scSC:', { signing: true }).keys, 1);
    // A disabled, revoked or expired primary takes its signing subkey with it.
    for (const head of ['sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSCD:::+:', 'sec:r:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::+:', 'sec:e:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::+:']) {
      assert.equal(key(`${head}\nssb:u:255:22:5555666677778888:1::::::s:::+:`).status, 'gap', head);
    }
    // A subkey listed before any primary belongs to no key.
    assert.equal(gpgIds('ssb:u:255:22:5555666677778888:1::::::s:::+:\nsec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::+:', { signing: true }).keys, 1);
    assert.deepEqual([...gpgIds('ssb:u:255:22:5555666677778888:1::::::s:::+:', { signing: true })], []);
    const card = key('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::D2760001240100000006:');
    assert.equal(card.status, 'ok');
    assert.match(card.message, /on a smartcard, so the card must be inserted/);
    // The card is named only when the part gpg signs with (the newest signing subkey) is on it.
    assert.match(key('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::+:\nssb:u:255:22:5555666677778888:1::::::s:::D2760001240100000006:').message, /smartcard/);
    assert.doesNotMatch(key('sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::D2760001240100000006:\nssb:u:255:22:5555666677778888:1::::::s:::+:').message, /smartcard/);
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 review 1: the older ssh- form, a relative key path, and a key command', () => {
  assert.equal(sshPublicKey(PUB).key, PUB.split(' ').slice(0, 2).join(' '));
  const s = setup({ config: { ...sshConfig, 'user.signingkey': 'keys/id.pub' } });
  try {
    put(path.join(s.dir, 'keys/id.pub'), `${PUB}\n`);
    assert.equal(byId(check(s, { root: null })).key.status, 'ok', 'read from the repo folder, not where yad started');
    execFileSync('git', ['config', '--unset', 'user.signingkey'], { cwd: s.dir, env: s.env });
    execFileSync('git', ['config', 'gpg.ssh.defaultKeyCommand', 'ssh-add -L'], { cwd: s.dir, env: s.env });
    assert.equal(byId(check(s, { root: null })).key.status, 'unknown');
    assert.equal(signingDoctorLine(s.dir, { gitRun: (c, a, o = {}) => run(c, a, { ...o, env: s.env }) }).status, 'ok');
    // The key:: form through the whole check.
    execFileSync('git', ['config', 'user.signingkey', `key::${PUB}`], { cwd: s.dir, env: s.env });
    assert.equal(byId(check(s, { root: null })).key.status, 'ok');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 review 1: the doctor line names X.509 and an unknown format; odd answers and full pages are not ok', () => {
  const x = setup({ config: { 'commit.gpgsign': 'true', 'gpg.format': 'x509' } });
  const bad = setup({ config: { 'commit.gpgsign': 'true', 'gpg.format': 'pgp2' } });
  try {
    const g = (s) => (c, a, o = {}) => run(c, a, { ...o, env: s.env });
    assert.match(signingDoctorLine(x.dir, { gitRun: g(x) }).message, /X\.509/);
    assert.equal(signingDoctorLine(bad.dir, { gitRun: g(bad) }).status, 'warn');
  } finally { for (const s of [x, bad]) fs.rmSync(s.T, { recursive: true, force: true }); }
  const s = setup({ config: sshConfig, product: GH });
  try {
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    const odd = byId(check(s, { runner: platform({ calls: { '^user/ssh_signing_keys': [200, [{ key: PUB }]], '^user/emails': [200, { not: 'a list' }] } }).runner }));
    assert.equal(odd['platform-email'].status, 'gap', 'an answer that is not a list holds no verified email');
    const full = Array.from({ length: 100 }, () => ({ key: OTHER }));
    assert.equal(byId(check(s, { runner: platform({ calls: { '^user/ssh_signing_keys': [200, full], '^user/emails': [200, []] } }).runner }))['platform-key'].status, 'unknown');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 review 1: GitLab — a refused read asks for a read_user token; an unconfirmed email is a gap', () => {
  const s = setup({ config: sshConfig, product: GL });
  try {
    put(path.join(s.home, '.ssh/id_ed25519.pub'), `${PUB}\n`);
    const refused = byId(check(s, { runner: platform({ calls: { '^user/keys': [401], '^user$': [403] } }).runner }));
    assert.equal(refused['platform-key'].status, 'unknown');
    assert.match(refused['platform-key'].fix.steps[0], /read_user/);
    assert.equal(refused['platform-email'].status, 'unknown');
    const pending = byId(check(s, { runner: platform({ calls: { '^user/keys': [200, [{ key: PUB, usage_type: 'signing' }]], '^user$': [200, { email: 'other@example.com' }], '^user/emails': [200, [{ email: 'me@example.com', confirmed_at: null }]] } }).runner }))['platform-email'];
    assert.equal(pending.status, 'gap');
    assert.match(pending.message, /not verified/);
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 review 6: the part gpg signs with must be on the account and in force', () => {
  const s = setup({ config: { 'commit.gpgsign': 'true', 'user.email': 'me@example.com', 'user.signingkey': 'AAAABBBBCCCCDDDD' }, product: GH });
  try {
    // The primary can sign here, and so can a subkey: gpg signs with the subkey.
    const local = 'sec:u:255:22:AAAABBBBCCCCDDDD:1::::::scSC:::+:\nssb:u:255:22:5555666677778888:1::::::s:::+:';
    const gitRun = (c, a, o = {}) => (c === 'gpg' ? { ok: true, stdout: local } : run(c, a, { ...o, env: s.env }));
    const row = (copy) => byId(check(s, { gitRun, haveTool: tools('gh', 'gpg'), runner: platform({ calls: { '^user/gpg_keys': [200, [copy]], '^user/emails': [200, [{ email: 'me@example.com', verified: true }]] } }).runner }))['platform-key'];
    const later = new Date(Date.now() + 864e5 * 365).toISOString();
    assert.equal(row({ key_id: 'AAAABBBBCCCCDDDD', expires_at: null, subkeys: [{ key_id: '5555666677778888', expires_at: later }] }).status, 'ok', 'never expires, or expires later');
    const subExpired = row({ key_id: 'AAAABBBBCCCCDDDD', subkeys: [{ key_id: '5555666677778888', expires_at: '2000-01-01T00:00:00Z' }] });
    assert.equal(subExpired.status, 'gap', 'the primary is in force, but gpg signs with the expired subkey');
    assert.match(subExpired.message, /expired/);
    assert.equal(row({ key_id: 'AAAABBBBCCCCDDDD', subkeys: [{ key_id: '5555666677778888', revoked: true }] }).status, 'gap', 'a revoked subkey');
    const missing = row({ key_id: 'AAAABBBBCCCCDDDD', subkeys: [] });
    assert.equal(missing.status, 'gap', 'the subkey was added after the upload');
    assert.match(missing.message, /not the part gpg signs with/);
    // Only the newest signing subkey counts: an older one expired on the account does not matter.
    const two = 'sec:u:255:22:AAAABBBBCCCCDDDD:100::::::scSC:::+:\nssb:u:255:22:1111222233334444:200::::::s:::+:\nssb:u:255:22:5555666677778888:300::::::s:::+:';
    const twoRun = (c, a, o = {}) => (c === 'gpg' ? { ok: true, stdout: two } : run(c, a, { ...o, env: s.env }));
    const rowTwo = (copy) => byId(check(s, { gitRun: twoRun, haveTool: tools('gh', 'gpg'), runner: platform({ calls: { '^user/gpg_keys': [200, [copy]], '^user/emails': [200, [{ email: 'me@example.com', verified: true }]] } }).runner }))['platform-key'];
    assert.equal(rowTwo({ key_id: 'AAAABBBBCCCCDDDD', subkeys: [{ key_id: '1111222233334444', expires_at: '2000-01-01T00:00:00Z' }, { key_id: '5555666677778888' }] }).status, 'ok');
    assert.equal(rowTwo({ key_id: 'AAAABBBBCCCCDDDD', subkeys: [{ key_id: '1111222233334444' }, { key_id: '5555666677778888', expires_at: '2000-01-01T00:00:00Z' }] }).status, 'gap');
    assert.equal(row({ key_id: 'AAAABBBBCCCCDDDD', expires_at: 'soon', subkeys: [{ key_id: '5555666677778888' }] }).status, 'unknown', 'a date yad cannot read');
    // `<id>!` pins the part gpg signs with: only that part counts.
    execFileSync('git', ['config', 'user.signingkey', 'AAAABBBBCCCCDDDD!'], { cwd: s.dir, env: s.env });
    assert.equal(row({ key_id: 'AAAABBBBCCCCDDDD', subkeys: [{ key_id: '5555666677778888', expires_at: '2000-01-01T00:00:00Z' }] }).status, 'ok', 'pinned to the primary');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 review 7: a pinned part that cannot sign is a gap; one subkey wins a tie; the hint reads every id', () => {
  const s = setup({ config: { 'commit.gpgsign': 'true', 'user.email': 'me@example.com' }, product: GH });
  const cfg = (v) => execFileSync('git', ['config', 'user.signingkey', v], { cwd: s.dir, env: s.env });
  try {
    const on = (out) => (c, a, o = {}) => (c === 'gpg' ? { ok: true, stdout: out } : run(c, a, { ...o, env: s.env }));
    const emails = { '^user/emails': [200, [{ email: 'me@example.com', verified: true }]] };
    const rows = (out, copy = { key_id: 'AAAABBBBCCCCDDDD', subkeys: [{ key_id: '5555666677778888' }] }) => byId(check(s, { gitRun: on(out), haveTool: tools('gh', 'gpg'), runner: platform({ calls: { '^user/gpg_keys': [200, [copy]], ...emails } }).runner }));
    // The pinned subkey expired here; the primary still signs, but gpg never falls back to it.
    const expiredSub = 'sec:u:255:22:AAAABBBBCCCCDDDD:100::::::scSC:::+:\nssb:e:255:22:5555666677778888:200::::::s:::+:';
    cfg('5555666677778888!');
    let r = rows(expiredSub);
    assert.equal(r.key.status, 'gap');
    assert.match(r.key.message, /gpg signs with that part only/);
    assert.equal(r['platform-key'].status, 'unknown', 'no key to match');
    cfg('77778888!'); // an 8-digit short id, pinned
    assert.equal(rows(expiredSub).key.status, 'gap', 'a short id with "!"');
    // A pinned primary that only certifies.
    cfg('AAAABBBBCCCCDDDD!');
    assert.equal(rows('sec:u:255:22:AAAABBBBCCCCDDDD:100::::::cSC:::+:\nssb:u:255:22:5555666677778888:200::::::s:::+:').key.status, 'gap');
    // A "!" on something that is not a key id: unknown, never ok.
    cfg('me@example.com!');
    assert.equal(rows('sec:u:255:22:AAAABBBBCCCCDDDD:100::::::scSC:::+:').key.status, 'unknown');
    // Two signing subkeys made in the same second: gpg takes the first listed.
    cfg('AAAABBBBCCCCDDDD');
    const tie = 'sec:u:255:22:AAAABBBBCCCCDDDD:100::::::cSC:::+:\nssb:u:255:22:1111222233334444:200::::::s:::+:\nssb:u:255:22:5555666677778888:200::::::s:::+:';
    assert.equal(rows(tie, { key_id: 'AAAABBBBCCCCDDDD', subkeys: [{ key_id: '1111222233334444' }, { key_id: '5555666677778888', revoked: true }] })['platform-key'].status, 'ok');
    // A certify-only primary with a new subkey never uploaded: the account has the key, not that part.
    const fresh = 'sec:u:255:22:AAAABBBBCCCCDDDD:100::::::cSC:::+:\nssb:u:255:22:5555666677778888:300::::::s:::+:';
    const notPart = rows(fresh, { key_id: 'AAAABBBBCCCCDDDD', subkeys: [{ key_id: '1111222233334444' }] })['platform-key'];
    assert.equal(notPart.status, 'gap');
    assert.match(notPart.message, /not the part gpg signs with/);
    // GitHub: a dead primary takes a live subkey with it; a copy unclear here and dead there is unknown.
    assert.equal(rows(fresh, { key_id: 'AAAABBBBCCCCDDDD', revoked: true, subkeys: [{ key_id: '5555666677778888' }] })['platform-key'].status, 'gap');
    assert.equal(byId(check(s, { gitRun: on(fresh), haveTool: tools('gh', 'gpg'), runner: platform({ calls: { '^user/gpg_keys': [200, [{ key_id: 'AAAABBBBCCCCDDDD', expires_at: 'soon', subkeys: [{ key_id: '5555666677778888' }] }, { key_id: 'AAAABBBBCCCCDDDD', revoked: true, subkeys: [{ key_id: '5555666677778888' }] }]], ...emails } }).runner }))['platform-key'].status, 'unknown');
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});

test('E160 review 8: a pin by short id, fingerprint or 0x picks that part; another key with the same email is not "the part"', () => {
  const s = setup({ config: { 'commit.gpgsign': 'true', 'user.email': 'me@example.com' }, product: GH });
  const cfg = (v) => execFileSync('git', ['config', 'user.signingkey', v], { cwd: s.dir, env: s.env });
  try {
    const on = (out) => (c, a, o = {}) => (c === 'gpg' ? { ok: true, stdout: out } : run(c, a, { ...o, env: s.env }));
    const emails = { '^user/emails': [200, [{ email: 'me@example.com', verified: true }]] };
    const rows = (out, copy) => byId(check(s, { gitRun: on(out), haveTool: tools('gh', 'gpg'), runner: platform({ calls: { '^user/gpg_keys': [200, [copy]], ...emails } }).runner }));
    // Two signing subkeys; the account has only the OLDER one. Unpinned, gpg signs with the newer: a gap.
    const key = 'sec:u:255:22:AAAABBBBCCCCDDDD:100::::::cSC:::+:\nssb:u:255:22:1111222233334444:200::::::s:::+:\nfpr:::::::::0123456789ABCDEF012345671111222233334444:\nssb:u:255:22:5555666677778888:300::::::s:::+:';
    const older = { key_id: 'AAAABBBBCCCCDDDD', subkeys: [{ key_id: '1111222233334444' }] };
    cfg('AAAABBBBCCCCDDDD');
    assert.equal(rows(key, older)['platform-key'].status, 'gap');
    // Pinned to the older one, by short id, long id with 0x, or fingerprint: ok.
    for (const pin of ['33334444!', '0x1111222233334444!', '0123456789ABCDEF012345671111222233334444!']) {
      cfg(pin);
      const r = rows(key, older);
      assert.equal(r.key.status, 'ok', pin);
      assert.equal(r['platform-key'].status, 'ok', pin);
    }
    // A fingerprint pin on a part listed with no fingerprint line (older gpg): the long id still matches.
    cfg('0123456789ABCDEF012345675555666677778888!');
    assert.equal(rows(key, older).key.status, 'ok');
    // A short id that two keys share (gpg lists both). Only A's matching part signs: gpg signs with it.
    cfg('33334444!');
    const shared = 'sec:u:255:22:AAAABBBBCCCCDDDD:100::::::cSC:::+:\nssb:u:255:22:1111222233334444:200::::::s:::+:\nsec:u:255:22:9999000011112222:100::::::cSC:::+:\nssb:u:255:22:7777888833334444:200::::::e:::+:\nssb:u:255:22:6666777788889999:300::::::s:::+:';
    const one = rows(shared, older);
    assert.equal(one.key.status, 'ok', 'the pin settles which key');
    assert.equal(one['platform-key'].status, 'ok', 'judged on the pinned part of A only');
    // Both keys have a matching part that signs: gpg may pick either.
    const both = rows(shared.replace('7777888833334444:200::::::e:', '7777888833334444:200::::::s:'), older).key;
    assert.equal(both.status, 'gap');
    assert.match(both.message, /2 secret keys/);
    // A pin to a key gpg does not have: "no secret key".
    cfg('ABABABABABABABAB!');
    assert.match(rows('', older).key.message, /no secret key/);
    // Real gpg exits 2 when it has no such key.
    const missing = byId(check(s, { gitRun: (c, a, o = {}) => (c === 'gpg' ? { ok: false, stdout: '' } : run(c, a, { ...o, env: s.env })), haveTool: tools('gh', 'gpg'), runner: platform().runner })).key;
    assert.match(missing.message, /no secret key/);
    assert.match(missing.fix.steps[0], /typo/);
    // By email: key A signs; an old expired key B has the same email. The account has only B: "does not list".
    execFileSync('git', ['config', '--unset', 'user.signingkey'], { cwd: s.dir, env: s.env });
    const twoKeys = 'sec:u:255:22:AAAABBBBCCCCDDDD:100::::::scSC:::+:\nsec:e:255:22:9999000011112222:50::::::scSC:::+:';
    const r = rows(twoKeys, { key_id: '9999000011112222' })['platform-key'];
    assert.equal(r.status, 'gap');
    assert.match(r.message, /does not list your GPG key/);
  } finally { fs.rmSync(s.T, { recursive: true, force: true }); }
});
