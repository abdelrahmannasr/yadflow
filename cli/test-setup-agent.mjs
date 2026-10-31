// E159: setup, new, init and join driven by an AI agent. The rules each test pins (the case list is in the
// E159 roadmap row):
//   - every setup question has a flag; under --json a missing answer is refused BEFORE anything is written,
//     with the unanswered questions listed (`questions`);
//   - a bad flag value is refused before anything is written;
//   - SDLC_NONINTERACTIVE still takes every default;
//   - `member add` under --json never starts a login: the person's step says how;
//   - `yad guide --json` lists the same questions for the command the folder calls for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YAD = path.join(ROOT, 'bin/yad.mjs');
// A space in the folder name: a home folder like `C:\Users\Jane Doe` must work.
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad e159-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };
const read = (file) => fs.readFileSync(file, 'utf8');

// Every spawned yad and git reads an empty global git config and a HOME of its own (the global-skills check
// reads `~/.claude/skills`). No SDLC_NONINTERACTIVE: these are the agent's runs.
function env(T, extra = {}) {
  const home = path.join(T, '.home');
  fs.mkdirSync(home, { recursive: true });
  const cfg = path.join(home, 'gitconfig');
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, '[user]\n\tname = Dev\n\temail = dev@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n');
  const e = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1', YAD_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1', YAD_CAPTURE: '0', YAD_PLATFORM_LOGIN: '0', YAD_PLATFORM_READ: '0' };
  delete e.SDLC_NONINTERACTIVE;
  delete e.NODE_TEST_CONTEXT;
  Object.assign(e, extra);
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete e[k];
  return e;
}
const yad = (T, cwd, args, extra = {}) => {
  const r = spawnSync(process.execPath, [YAD, ...args], { cwd, env: env(T, extra), encoding: 'utf8', timeout: 120_000 });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON: said below */ }
  return { code: r.status, json, out: r.stdout, err: r.stderr };
};
const gitRepo = (T, dir) => { fs.mkdirSync(dir, { recursive: true }); execFileSync('git', ['init', '-q'], { cwd: dir, env: env(T) }); };
// Every file under a folder (no .git, no .home), so "nothing written" is checked byte for byte.
const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.home') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { out[`${path.relative(dir, p)}/`] = ''; walk(p); } else out[path.relative(dir, p)] = read(p);
    }
  };
  walk(dir);
  return out;
};
const ids = (r) => (r.json?.questions || []).map((q) => q.id);

test('E159 cases 3 and 5: setup --json with no answers is refused before anything is written, and lists each question with its flag', () => {
  const T = tmp();
  try {
    const P = path.join(T, 'p');
    fs.mkdirSync(P);
    const r = yad(T, P, ['setup', '--json']);
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.code, 'YAD-CLI-001');
    assert.deepEqual(ids(r), ['mode', 'codebase', 'layout', 'tools', 'git-init', 'ide-targets', 'platform', 'default-branch', 'repos']);
    // The default branch is asked with the platform, but needed only when the answer is github or gitlab.
    assert.equal(r.json.questions.find((q) => q.id === 'default-branch').optional, true);
    for (const q of r.json.questions) {
      assert.ok(q.text && q.flag && Object.hasOwn(q, 'default') && Array.isArray(q.choices), JSON.stringify(q));
      assert.ok(!Object.hasOwn(q, 'given'), 'only the unanswered are listed, without the bookkeeping');
    }
    assert.deepEqual(fs.readdirSync(P), [], 'nothing written, not even .git');
    // Case 5: answering each question with its flag (the default) runs it: every flag listed is one yad reads.
    const answers = ['--solo', '--greenfield', '--monorepo', '--no-tools', '--git-init', '--ide-targets', '.claude', '--platform', 'none', '--connect', 'none'];
    const done = yad(T, P, ['setup', '--json', ...answers]);
    assert.equal(done.code, 0, done.out + done.err);
    assert.equal(done.json.ok, true);
    assert.equal(JSON.parse(read(path.join(P, '.sdlc/product.json'))).platform, null);
    assert.ok(fs.existsSync(path.join(P, '.git')));
    // Only some answered: the rest are listed, and still nothing is written.
    const Q = path.join(T, 'q');
    fs.mkdirSync(Q);
    const some = yad(T, Q, ['setup', '--json', '--solo', '--greenfield', '--monorepo', '--no-git-init']);
    assert.deepEqual(ids(some), ['tools', 'ide-targets', 'platform', 'default-branch', 'repos']);
    // --platform github makes the branch a question that must be answered.
    const gh = yad(T, Q, ['setup', '--json', '--solo', '--greenfield', '--monorepo', '--no-git-init', '--no-tools', '--ide-targets', '.claude', '--platform', 'github', '--connect', 'none']);
    assert.deepEqual(ids(gh), ['default-branch']);
    assert.equal(gh.json.questions[0].optional, undefined);
    assert.deepEqual(fs.readdirSync(Q), []);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 cases 2 and 4: every answer as a flag runs with no prompt; SDLC_NONINTERACTIVE still takes the defaults', () => {
  const T = tmp();
  try {
    const P = path.join(T, 'p');
    gitRepo(T, P);
    const r = yad(T, P, ['setup', '--json', '--team', '3', '--brownfield', '--separate', '--no-tools', '--ide-targets', '.claude', '--platform', 'github', '--default-branch', 'trunk', '--connect', 'none']);
    assert.equal(r.code, 0, r.out + r.err);
    const product = JSON.parse(read(path.join(P, '.sdlc/product.json')));
    assert.equal(product.platform, 'github');
    assert.equal(product.default_branch, 'trunk');
    assert.deepEqual(product.profile, { codebase: 'brownfield', repo_layout: 'separate', team_size: 3 });
    const D = path.join(T, 'd');
    fs.mkdirSync(D);
    const defaults = yad(T, D, ['setup', '--json'], { SDLC_NONINTERACTIVE: '1' });
    assert.equal(defaults.code, 0, defaults.out + defaults.err);
    assert.equal(defaults.json.ok, true);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 case 6: a bad flag value is refused before anything is written', () => {
  const T = tmp();
  try {
    const all = ['--solo', '--greenfield', '--monorepo', '--no-tools', '--no-git-init', '--ide-targets', '.claude', '--platform', 'none', '--connect', 'none'];
    // A plain folder beside the Products, with a .coderabbit.yaml: no CodeRabbit question would be asked about it.
    put(path.join(T, 'plain/.coderabbit.yaml'), 'reviews: {}\n');
    const swap = (flag, value) => { const a = [...all]; const i = a.indexOf(flag); a[i + 1] = value; return a; };
    for (const [args, said] of [
      [swap('--platform', 'bitbucket'), /--platform bitbucket: expected github, gitlab or none/],
      [[...all, '--platform', 'github', '--default-branch', 'a..b'], /not a plain branch name/],
      [[...all.filter((a) => a !== '--no-tools'), '--design', 'paint'], /--design paint: expected one of/],
      [[...all, '--design', 'none'], /--no-tools and a tool flag/],
      [[...all, '--tools'], /--tools and --no-tools/],
      [[...all, '--team', '2'], /--solo and --team/],
      [[...all, '--add-repo', 'api'], /expected <name>=<path>/],
      [[...all, '--add-repo', 'api=../../../outside'], /outside the workspace/],
      [[...all, '--add-repo', 'api=../.git/x'], /\.git folder/],
      [[...all, '--add-repo', 'api=../api,bitbucket'], /platform bitbucket/],
      // Review 2: a folder that is not a git repo (registerRepo would skip it, and a monorepo would connect the next).
      [[...all, '--add-repo', 'api=../plain'], /\.\.\/plain is not a git repository/],
      [[...all, '--coderabbit', 'ghost'], /no connected repo named ghost/],
      // Review 1: the AI tools and the team size are checked before any write too.
      [swap('--ide-targets', '.vscode'), /--ide-targets: unsupported IDE target/],
      [[...all.filter((a) => a !== '--solo'), '--team', 'abc'], /--team abc: expected how many people/],
      [[...all.filter((a) => a !== '--solo'), '--team', '0'], /--team 0: expected how many people/],
    ]) {
      const P = fs.mkdtempSync(path.join(T, 'p-'));
      const before = fs.readdirSync(path.join(T, 'plain'));
      const r = yad(T, P, ['setup', '--json', ...args]);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(r.json.error, said, args.join(' '));
      assert.deepEqual(fs.readdirSync(P), [], `nothing written: ${args.join(' ')}`);
      assert.deepEqual(fs.readdirSync(path.join(T, 'plain')), before);
    }
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 case 7: a re-run asks whether to change the earlier settings; --no-reconfigure keeps them as they are', () => {
  const T = tmp();
  try {
    const P = path.join(T, 'p');
    gitRepo(T, P);
    const first = ['--solo', '--greenfield', '--monorepo', '--no-tools', '--ide-targets', '.claude', '--platform', 'github', '--default-branch', 'main', '--connect', 'none'];
    assert.equal(yad(T, P, ['setup', '--json', ...first]).code, 0);
    const before = read(path.join(P, '.sdlc/product.json'));
    const again = ['--no-tools', '--ide-targets', '.claude', '--connect', 'none'];
    const files = snapshot(P);
    const asked = yad(T, P, ['setup', '--json', ...again]);
    assert.deepEqual(ids(asked), ['reconfigure'], 'the profile is carried; the earlier settings are the question');
    assert.deepEqual(snapshot(P), files, 'a refused re-run changes nothing, byte for byte');
    const kept = yad(T, P, ['setup', '--json', ...again, '--no-reconfigure']);
    assert.equal(kept.code, 0, kept.out + kept.err);
    assert.equal(read(path.join(P, '.sdlc/product.json')), before);
    // --reconfigure asks the platform again, and the branch with it (needed only for github or gitlab).
    assert.deepEqual(ids(yad(T, P, ['setup', '--json', ...again, '--reconfigure'])), ['platform', 'default-branch']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 cases 8, 9, 10: init --connect picks the repos found; --add-repo registers others; --coderabbit wires exactly those', () => {
  const T = tmp();
  try {
    const W = path.join(T, 'ws');
    for (const n of ['a', 'b']) gitRepo(T, path.join(W, n));
    const base = ['--solo', '--greenfield', '--no-tools', '--ide-targets', '.claude', '--platform', 'none'];
    const missing = yad(T, W, ['init', '--json', ...base]);
    assert.deepEqual(ids(missing), ['repos', 'coderabbit']);
    assert.ok(missing.json.questions[0].choices.includes('a,b'), JSON.stringify(missing.json.questions[0]));
    assert.ok(!fs.existsSync(path.join(W, 'product')), 'the Product folder is not made');
    assert.match(yad(T, W, ['init', '--json', ...base, '--connect', 'ghost', '--coderabbit', 'none']).json.error, /no repo named ghost was found/);
    // Review 1: --add-repo alone does not answer the repos found: refused, and nothing is made.
    // (A repo in a sub-folder of the workspace: init offers only the ones directly beside the Product.)
    gitRepo(T, path.join(W, 'nested/x'));
    const addOnly = yad(T, W, ['init', '--json', ...base, '--add-repo', 'x=../nested/x', '--coderabbit', 'none']);
    assert.deepEqual(ids(addOnly), ['repos']);
    assert.ok(!fs.existsSync(path.join(W, 'product')), 'the Product folder is not made');
    const r = yad(T, W, ['init', '--json', ...base, '--connect', 'a', '--coderabbit', 'none']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.deepEqual(JSON.parse(read(path.join(W, 'product/.sdlc/repos.json'))).repos.map((x) => x.name), ['a']);
    // A re-run asks only about the repo not registered yet.
    const rerun = yad(T, W, ['init', '--json', '--no-tools', '--ide-targets', '.claude', '--no-reconfigure', '--coderabbit', 'none']);
    assert.deepEqual(rerun.json.questions.map((q) => [q.id, q.choices.at(-1)]), [['repos', 'b']]);
    // --connect all and none, in fresh workspaces.
    for (const [connect, want] of [['all', ['a', 'b']], ['none', []]]) {
      const X = path.join(T, `ws-${connect}`);
      for (const n of ['a', 'b']) gitRepo(T, path.join(X, n));
      const c = yad(T, X, ['init', '--json', ...base, '--connect', connect, '--coderabbit', 'none']);
      assert.equal(c.code, 0, c.out + c.err);
      const reg = path.join(X, 'product/.sdlc/repos.json');
      assert.deepEqual(fs.existsSync(reg) ? JSON.parse(read(reg)).repos.map((x) => x.name) : [], want, connect);
    }
    // A monorepo connects one repo: CodeRabbit is asked about that one only.
    const M = path.join(T, 'ws-mono');
    for (const n of ['a', 'b']) gitRepo(T, path.join(M, n));
    const mono = yad(T, M, ['init', '--json', ...base, '--monorepo', '--connect', 'all']);
    assert.deepEqual(mono.json.questions.map((q) => [q.id, q.choices.at(-1)]), [['coderabbit', 'a']]);
    // setup --add-repo: two repos, one with its platform and branch; CodeRabbit in one of them only.
    const V = path.join(T, 'ws2');
    const P = path.join(V, 'product');
    gitRepo(T, P);
    for (const n of ['api', 'web']) gitRepo(T, path.join(V, n));
    const s = yad(T, P, ['setup', '--json', '--solo', '--greenfield', '--separate', '--no-tools', '--ide-targets', '.claude', '--platform', 'none',
      '--add-repo', 'api=../api,gitlab,trunk', '--add-repo', 'web=../web', '--coderabbit', 'web']);
    assert.equal(s.code, 0, s.out + s.err);
    const repos = JSON.parse(read(path.join(P, '.sdlc/repos.json'))).repos;
    assert.deepEqual(repos.map((x) => [x.name, x.path, x.platform, x.default_branch]), [['api', '../api', 'gitlab', 'trunk'], ['web', '../web', 'github', 'main']]);
    assert.ok(fs.existsSync(path.join(V, 'web/.coderabbit.yaml')));
    assert.ok(!fs.existsSync(path.join(V, 'api/.coderabbit.yaml')));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 case 11: a tool named by flag turns the tools step on; the others are then asked; its URL comes by flag', () => {
  const T = tmp();
  try {
    const base = ['--solo', '--greenfield', '--monorepo', '--no-git-init', '--ide-targets', '.claude', '--platform', 'none', '--connect', 'none'];
    const P = path.join(T, 'p');
    fs.mkdirSync(P);
    assert.deepEqual(ids(yad(T, P, ['setup', '--json', ...base, '--design', 'figma'])), ['testing', 'learning']);
    const r = yad(T, P, ['setup', '--json', ...base, '--design', 'figma', '--design-url', 'https://figma.example/f/1', '--testing', 'none', '--learning', 'none']);
    assert.equal(r.code, 0, r.out + r.err);
    const design = JSON.parse(read(path.join(P, '.sdlc/design.json')));
    assert.deepEqual([design.tool, design.project_url], ['figma', 'https://figma.example/f/1']);
    assert.equal(JSON.parse(read(path.join(P, '.sdlc/testing.json'))).tool, 'none');
    // A tool name in capitals reads as setup reads a typed answer.
    const U = path.join(T, 'u');
    fs.mkdirSync(U);
    const upper = yad(T, U, ['setup', '--json', ...base, '--design', 'Figma', '--testing', 'NONE', '--learning', 'none']);
    assert.equal(upper.code, 0, upper.out + upper.err);
    assert.equal(JSON.parse(read(path.join(U, '.sdlc/design.json'))).tool, 'figma');
    // --no-tools records all three as none, and asks none of them.
    const N = path.join(T, 'n');
    fs.mkdirSync(N);
    assert.equal(yad(T, N, ['setup', '--json', ...base, '--no-tools']).code, 0);
    for (const f of ['design', 'testing', 'learning']) assert.equal(JSON.parse(read(path.join(N, `.sdlc/${f}.json`))).tool, 'none', f);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 case 12: new never asks about git init and makes nothing until answered; join asks only the AI tools, before it clones', () => {
  const T = tmp();
  try {
    const W = path.join(T, 'here');
    fs.mkdirSync(W);
    const r = yad(T, W, ['new', 'acme', '--json']);
    assert.equal(r.code, 1);
    assert.ok(!ids(r).includes('git-init'), ids(r).join(','));
    assert.deepEqual(fs.readdirSync(W), [], 'no workspace folder made');
    const done = yad(T, W, ['new', 'acme', '--json', '--solo', '--monorepo', '--no-tools', '--ide-targets', '.claude', '--platform', 'none', '--connect', 'none']);
    assert.equal(done.code, 0, done.out + done.err);
    assert.ok(fs.existsSync(path.join(W, 'acme/product/.sdlc/product.json')));
    const J = path.join(T, 'join');
    fs.mkdirSync(J);
    const join = yad(T, J, ['join', path.join(T, 'nowhere.git'), '--json']);
    assert.equal(join.code, 1);
    assert.deepEqual(ids(join), ['ide-targets']);
    assert.deepEqual(fs.readdirSync(J), [], 'nothing cloned');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 case 13: member add --json never starts a login: the person\'s step names the exact command', { skip: process.platform === 'win32' && 'a shell-script gh' }, () => {
  const T = tmp();
  try {
    const P = path.join(T, 'p');
    gitRepo(T, P);
    put(path.join(P, '.sdlc/product.json'), { platform: 'github', git_url: 'git@github.com:acme/p.git', default_branch: 'main' });
    // A gh that knows no account (first on PATH, so a real one on the machine is never asked), and platform
    // lookups on: nobody is logged in.
    const bin = path.join(T, 'bin');
    put(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const r = yad(T, P, ['member', 'add', '--json'], { PATH: `${bin}${path.delimiter}${process.env.PATH}`, YAD_PLATFORM_LOGIN: undefined });
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.json.ok, false);
    assert.match(r.json.error, /not logged in to GitHub on github\.com/);
    assert.deepEqual(r.json.person.commands, ['gh auth login --hostname github.com --scopes user:email']);
    assert.equal(r.json.person.verify, 'yad member add --json');
    assert.match(r.json.hint, /the person runs/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 case 14: yad guide --json lists the questions the folder\'s command would ask', () => {
  const T = tmp();
  try {
    const E = path.join(T, 'empty');
    fs.mkdirSync(E);
    const g = yad(T, E, ['guide', '--json']);
    assert.equal(g.json.situation.stage, 'no-product');
    assert.equal(g.json.agent[0].run, 'npx -y yadflow@4 new <name> --json');
    const refused = yad(T, E, ['new', 'acme', '--json']);
    assert.deepEqual(g.json.questions.map((q) => q.id), ids(refused));
    const W = path.join(T, 'ws');
    for (const n of ['a', 'b']) gitRepo(T, path.join(W, n));
    const gi = yad(T, W, ['guide', '--json']);
    assert.equal(gi.json.agent[0].run, 'npx -y yadflow@4 init --json');
    // Init's profile defaults (brownfield, separate) are the guide's too; with them answered, the rest match.
    const left = yad(T, W, ['init', '--json']);
    assert.deepEqual(gi.json.questions.map((q) => q.id), ids(left));
    assert.ok(gi.json.questions.find((q) => q.id === 'repos').choices.includes('a,b'));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 case 15: under --json the old skills in the person\'s home folder are left alone, and said', () => {
  const T = tmp();
  try {
    const old = path.join(T, '.home/.claude/skills/sdlc-author-epic');
    put(path.join(old, 'SKILL.md'), '---\nname: sdlc-author-epic\n---\n');
    const P = path.join(T, 'p');
    fs.mkdirSync(P);
    const r = yad(T, P, ['setup', '--json', '--solo', '--greenfield', '--monorepo', '--no-tools', '--no-git-init', '--ide-targets', '.claude', '--platform', 'none', '--connect', 'none']);
    assert.equal(r.code, 0, r.out + r.err);
    assert.ok(fs.existsSync(path.join(old, 'SKILL.md')), 'left as it is');
    assert.ok((r.json.notes || []).some((n) => /global ~\/\.claude\/skills/.test(n)), JSON.stringify(r.json.notes));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E159 case 13 (join): join --json never starts a login; its member step is the person\'s', { skip: process.platform === 'win32' && 'a shell-script gh' }, () => {
  const T = tmp();
  try {
    // A Product on GitHub, as a bare repo to clone.
    const src = path.join(T, 'src');
    gitRepo(T, src);
    put(path.join(src, '.sdlc/product.json'), { platform: 'github', git_url: 'git@github.com:acme/p.git', default_branch: 'main' });
    execFileSync('git', ['add', '-A'], { cwd: src, env: env(T) });
    execFileSync('git', ['commit', '-q', '-m', 'chore: product'], { cwd: src, env: env(T) });
    const bare = path.join(T, 'acme.git');
    execFileSync('git', ['clone', '-q', '--bare', src, bare], { env: env(T) });
    const bin = path.join(T, 'bin');
    put(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const J = path.join(T, 'join');
    fs.mkdirSync(J);
    assert.match(yad(T, J, ['join', bare, '--json', '--ide-targets', '.vscode']).json.error, /--ide-targets: unsupported/);
    assert.deepEqual(fs.readdirSync(J), [], 'a bad value is refused before the clone');
    const r = yad(T, J, ['join', bare, '--json', '--ide-targets', '.claude'], { PATH: `${bin}${path.delimiter}${process.env.PATH}`, YAD_PLATFORM_LOGIN: undefined });
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(r.json.member.written, false);
    assert.deepEqual(r.json.member.person.commands, ['gh auth login --hostname github.com --scopes user:email']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
