// `yad detect` (E50): what is installed for the agents that work in a folder. Runs on Linux, macOS and
// Windows — the Windows CI job runs this file too — so every path here is built with path.join.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The #280 guard, as in cli/test.mjs: under `node --test` this file's stdout carries the runner's own
// messages, and a printed `info()` line landing between them can lose every result after it.
if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}

process.env.YAD_NO_UPDATE_CHECK = '1';

const { detectInstalled, skillMeta, tomlAgentName, tomlTableNames } = await import('./detect.mjs');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const YAD = path.join(ROOT, 'bin', 'yad.mjs');
// A value that must never reach the output: it stands for a token in an MCP server's settings.
const SECRET = 'SECRET-TOKEN-e50';

const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const skill = (dir, name, front = '') => put(path.join(dir, name, 'SKILL.md'), `---\n${front}description: a skill\n---\nbody\n`);
const sha = (file) => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yad-detect-'));
const find = (items, kind, name, where) => items.filter((i) => i.kind === kind && i.name === name && (where === undefined || i.where === where));

// Every file under a folder with its size and modification time — to prove a run wrote nothing.
function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      const st = fs.lstatSync(full);
      out.push(`${path.relative(dir, full)}|${e.isDirectory() ? 'd' : st.size}|${st.mtimeMs}`);
      if (e.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out;
}

// A project and a home folder holding one of everything the detector reads.
function fixture() {
  const T = tmp();
  const proj = path.join(T, 'proj');
  const home = path.join(T, 'home');
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  // Project skills in every place yad installs into, plus Cursor's `.codex/skills`.
  skill(path.join(proj, '.claude/skills'), 'alpha', 'name: alpha\nversion: 1.2.0\n');
  skill(path.join(proj, '.agents/skills'), 'beta', 'metadata:\n  author: x\n  version: "2.0"\n');
  skill(path.join(proj, '.cursor/skills'), 'gamma');
  skill(path.join(proj, '.gemini/skills'), 'delta');
  skill(path.join(proj, '.zencoder/skills'), 'epsilon');
  skill(path.join(proj, '.codex/skills'), 'zeta');
  put(path.join(proj, '.opencode/commands/eta.md'), '---\nname: eta\n---\nbody\n');
  put(path.join(proj, '.opencode/commands/notes.txt'), 'not a skill');
  // Not skills: a folder with no SKILL.md, and a plain file sitting in a skills folder.
  fs.mkdirSync(path.join(proj, '.claude/skills/empty'), { recursive: true });
  put(path.join(proj, '.claude/skills/README.md'), 'hello');
  // Frontmatter with a BOM and Windows line ends, and a quoted name.
  put(path.join(proj, '.claude/skills/crlf/SKILL.md'), '﻿---\r\nname: \'crlf-skill\'\r\nversion: 3\r\n---\r\nbody\r\n');
  // A SKILL.md too big to read: left out, not read into memory.
  put(path.join(proj, '.claude/skills/huge/SKILL.md'), `---\nname: huge\n---\n${'x'.repeat(1024 * 1024 + 1)}`);

  // Home skills.
  skill(path.join(home, '.claude/skills'), 'alpha', 'name: alpha\n');
  skill(path.join(home, '.agents/skills'), 'theta');
  skill(path.join(home, '.cursor/skills'), 'iota');
  skill(path.join(home, '.gemini/skills'), 'kappa');
  skill(path.join(home, '.codex/skills'), 'lambda');

  // Agents.
  put(path.join(proj, '.claude/agents/reviewer.md'), '---\nname: reviewer\nversion: 0.1\n---\nprompt\n');
  put(path.join(home, '.claude/agents/helper.md'), 'no frontmatter at all\n');
  put(path.join(proj, '.cursor/agents/c-agent.md'), '---\nname: c-agent\n---\n');
  put(path.join(home, '.gemini/agents/g-agent.md'), '---\nname: g-agent\n---\n');
  put(path.join(proj, '.codex/agents/x.toml'), '# a Codex agent\nname = "codex-reviewer"\ndescription = "d"\n');
  put(path.join(home, '.codex/agents/late.toml'), '[extra]\nname = "not-the-agent-name"\n');
  put(path.join(home, '.codex/agents/skip.md'), '---\nname: wrong-extension\n---\n');

  // MCP servers, each with a secret in its settings.
  const server = { command: 'npx', args: ['--token', SECRET], env: { API_KEY: SECRET }, headers: { Authorization: `Bearer ${SECRET}` } };
  put(path.join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { 'proj-server': server } }));
  put(path.join(proj, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { 'cursor-server': server } }));
  put(path.join(home, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { 'cursor-home': server } }));
  put(path.join(proj, '.gemini/settings.json'), JSON.stringify({ theme: 'dark', mcpServers: { 'gem-server': server } }));
  put(path.join(home, '.gemini/settings.json'), JSON.stringify({ theme: 'dark' }));
  put(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { 'user-server': server },
    projects: { [path.resolve(proj)]: { mcpServers: { 'local-server': server } }, '/somewhere/else': { mcpServers: { 'other-project': server } } },
  }));
  put(path.join(home, '.codex/config.toml'), [
    'model = "x"',
    `[mcp_servers.docs]\ncommand = "npx"\nargs = ["${SECRET}"]`,
    `[mcp_servers.docs.env]\nKEY = "${SECRET}"`,
    '[mcp_servers."quoted.name"]\nurl = "https://example.invalid"',
    '[plugins."tool@market"]\nenabled = true',
  ].join('\n'));
  put(path.join(proj, '.codex/config.toml'), `[mcp_servers]\nproj-codex = { command = "x", env = { K = "${SECRET}" } }\n`);

  // Claude Code plugins: one for everyone, one for THIS folder, one for another folder.
  const plug = (name) => path.join(home, '.claude/plugins/cache/m', name);
  skill(path.join(plug('p1'), 'skills'), 'p1-skill', 'name: p1-skill\n');
  put(path.join(plug('p1'), 'agents/p1-agent.md'), '---\nname: p1-agent\n---\n');
  put(path.join(plug('p1'), '.mcp.json'), JSON.stringify({ mcpServers: { 'p1-mcp': server } }));
  put(path.join(plug('p2'), '.claude-plugin/plugin.json'), JSON.stringify({ name: 'p2', mcpServers: { 'p2-mcp': server } }));
  put(path.join(plug('p3'), '.claude-plugin/plugin.json'), JSON.stringify({ name: 'p3', mcpServers: './servers.json' }));
  put(path.join(plug('p3'), 'servers.json'), JSON.stringify({ 'p3-mcp': server }));
  put(path.join(plug('p4'), '.claude-plugin/plugin.json'), JSON.stringify({ name: 'p4', mcpServers: '../p1/.mcp.json' }));
  put(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'p1@m': [{ scope: 'user', installPath: plug('p1'), version: '1.0.0', gitCommitSha: 'abc123' }],
      'p2@m': [{ scope: 'local', projectPath: proj, installPath: plug('p2'), version: '2.0.0' }],
      'p3@m': [{ scope: 'project', projectPath: path.join(T, 'elsewhere'), installPath: plug('p3'), version: '3.0.0' }],
      'p4@m': [{ scope: 'user', installPath: plug('p4') }],
      'gone@m': [{ scope: 'user', installPath: path.join(T, 'missing') }],
    },
  }));
  put(path.join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'p1@m': true, 'p4@m': false } }));
  return { T, proj, home };
}

test('E50: every place is read, and each item says where it came from and which agents read it', () => {
  const { T, proj, home } = fixture();
  try {
    const { items, problems } = detectInstalled(proj, { home });
    assert.deepEqual(problems, []);

    const alpha = find(items, 'skill', 'alpha');
    assert.deepEqual(alpha.map((i) => [i.scope, i.where, i.version]), [['project', '.claude/skills/alpha', '1.2.0'], ['user', '~/.claude/skills/alpha', null]]);
    assert.deepEqual(alpha[0].agents, ['Claude Code', 'Cursor']);
    assert.equal(alpha[0].hash, sha(path.join(proj, '.claude/skills/alpha/SKILL.md')));
    assert.equal(find(items, 'skill', 'beta')[0].version, '2.0', 'metadata.version, unquoted');
    assert.deepEqual(find(items, 'skill', 'beta')[0].agents, ['Codex CLI', 'Gemini CLI', 'Cursor', 'GitHub Copilot']);
    assert.deepEqual(find(items, 'skill', 'zeta')[0].agents, ['Cursor'], 'Codex does not read .codex/skills; Cursor does');
    assert.deepEqual(find(items, 'skill', 'epsilon')[0].agents, ['Zencoder']);
    assert.equal(find(items, 'skill', 'eta')[0].where, '.opencode/commands/eta.md');
    assert.deepEqual(find(items, 'skill', 'crlf-skill').map((i) => i.version), ['3'], 'BOM + CRLF + quotes');
    assert.equal(find(items, 'skill', 'empty').length + find(items, 'skill', 'README').length + find(items, 'skill', 'huge').length, 0);
    assert.deepEqual(find(items, 'skill', 'theta')[0].agents, ['Codex CLI', 'Gemini CLI', 'Cursor']);
    assert.equal(find(items, 'skill', 'lambda')[0].where, '~/.codex/skills/lambda');

    assert.equal(find(items, 'agent', 'reviewer')[0].version, '0.1');
    assert.equal(find(items, 'agent', 'helper')[0].where, '~/.claude/agents/helper.md', 'no frontmatter: the file name');
    assert.deepEqual(find(items, 'agent', 'codex-reviewer')[0].agents, ['Codex CLI']);
    assert.equal(find(items, 'agent', 'late').length, 1, 'a name inside a table is not the agent name');
    assert.equal(find(items, 'agent', 'wrong-extension').length, 0);
    assert.deepEqual(find(items, 'agent', 'g-agent')[0].agents, ['Gemini CLI']);

    const mcp = items.filter((i) => i.kind === 'mcp').map((i) => `${i.name}@${i.where}@${i.scope}`).sort();
    assert.deepEqual(mcp, [
      'cursor-home@~/.cursor/mcp.json@user', 'cursor-server@.cursor/mcp.json@project', 'docs@~/.codex/config.toml@user',
      'gem-server@.gemini/settings.json@project', 'local-server@~/.claude.json (this folder)@project',
      'p1-mcp@p1@m: .mcp.json@user', 'p2-mcp@p2@m: .claude-plugin/plugin.json@project', 'proj-codex@.codex/config.toml@project',
      'proj-server@.mcp.json@project', 'quoted.name@~/.codex/config.toml@user', 'user-server@~/.claude.json@user',
    ]);

    const plugins = items.filter((i) => i.kind === 'plugin').map((i) => [i.name, i.scope, i.version, i.enabled]);
    assert.deepEqual(plugins, [
      ['tool@market', 'user', null, undefined],
      ['gone@m', 'user', null, null], ['p1@m', 'user', '1.0.0', true], ['p2@m', 'project', '2.0.0', null], ['p4@m', 'user', null, false],
    ], 'another folder\'s plugin (p3) is left out; enabled only when the settings say');
    assert.equal(find(items, 'plugin', 'p1@m')[0].commit, 'abc123');
    const p1skill = find(items, 'skill', 'p1-skill')[0];
    assert.deepEqual([p1skill.plugin, p1skill.version, p1skill.where], ['p1@m', '1.0.0', 'p1@m: skills/p1-skill']);
    assert.equal(find(items, 'agent', 'p1-agent')[0].plugin, 'p1@m');
    assert.equal(find(items, 'mcp', 'p1-mcp').length, 1, 'p4 points outside itself and adds nothing');

    // The same keys on every item.
    for (const it of items) for (const k of ['kind', 'name', 'scope', 'where', 'agents', 'version', 'hash', 'plugin']) assert.ok(Object.hasOwn(it, k), `${it.kind} ${it.name} has ${k}`);
    // No secret, and no absolute home path, anywhere in the answer.
    const text = JSON.stringify({ items, problems });
    assert.ok(!text.includes(SECRET), 'an MCP server is named, never described');
    assert.ok(!text.includes(home), 'the home folder is shown as ~');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: detection writes nothing — not in the project, not in the home folder', () => {
  const { T, proj, home } = fixture();
  try {
    const before = snapshot(T);
    detectInstalled(proj, { home });
    assert.deepEqual(snapshot(T), before);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: a file that is there but unreadable is a problem, named by place and never by content', () => {
  const T = tmp();
  const proj = path.join(T, 'p');
  const home = path.join(T, 'h');
  try {
    put(path.join(proj, '.mcp.json'), `{ "mcpServers": { "x": { "env": "${SECRET}" }`);
    put(path.join(proj, '.cursor/mcp.json'), JSON.stringify({ mcpServers: ['not', 'an', 'object'] }));
    put(path.join(home, '.claude.json'), '[1, 2]');
    put(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: [] }));
    put(path.join(home, '.gemini/settings.json'), 'null');
    const { items, problems } = detectInstalled(proj, { home });
    assert.deepEqual(items, []);
    assert.deepEqual(problems.map((p) => p.where).sort(), ['.cursor/mcp.json', '.mcp.json', '~/.claude.json', '~/.claude/plugins/installed_plugins.json', '~/.gemini/settings.json']);
    assert.ok(!JSON.stringify(problems).includes(SECRET));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: nothing installed anywhere is an empty answer, not an error', () => {
  const T = tmp();
  try {
    assert.deepEqual(detectInstalled(T, { home: path.join(T, 'no-home') }), { items: [], problems: [] });
    assert.deepEqual(detectInstalled(T, { home: null }), { items: [], problems: [] });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: run in the home folder itself, nothing is listed twice', () => {
  const T = tmp();
  try {
    skill(path.join(T, '.claude/skills'), 'once');
    put(path.join(T, '.claude.json'), JSON.stringify({ mcpServers: { s: {} } }));
    const { items } = detectInstalled(T, { home: T });
    // `~/.claude.json` has no project twin, so it is still read.
    assert.deepEqual(items.map((i) => `${i.kind}:${i.name}:${i.scope}`), ['skill:once:project', 'mcp:s:user']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: a skill installed as a link (as skill managers do) is found through the link', { skip: process.platform === 'win32' && 'links need admin rights on Windows' }, () => {
  const T = tmp();
  try {
    skill(path.join(T, 'store'), 'linked', 'name: linked\n');
    fs.mkdirSync(path.join(T, 'home/.claude/skills'), { recursive: true });
    fs.symlinkSync(path.join(T, 'store/linked'), path.join(T, 'home/.claude/skills/linked'));
    const { items } = detectInstalled(path.join(T, 'proj-none'), { home: path.join(T, 'home') });
    assert.deepEqual(items.map((i) => i.where), ['~/.claude/skills/linked']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: the frontmatter, TOML name and TOML table readers', () => {
  assert.deepEqual(skillMeta('no frontmatter'), {});
  assert.deepEqual(skillMeta('---\nname: a\nmetadata:\n  version: 1\nversion: 2\n---\n'), { name: 'a', version: '2' }, 'top-level version wins');
  assert.deepEqual(skillMeta('---\nmetadata:\n  version: 1\nother:\n  version: 9\n---\n'), { version: '1' }, 'only metadata.version');
  assert.deepEqual(skillMeta('---\nname:\n---\n'), {}, 'an empty value is missing');
  assert.equal(tomlAgentName("name = 'single' # c"), 'single');
  assert.equal(tomlAgentName('name = unquoted'), null);
  const toml = [
    '# [mcp_servers.commented]',
    'mcp_servers.dotted.command = "x"',
    '[mcp_servers.bare_one]',
    '[ mcp_servers . "spaced" ]',
    "[mcp_servers.'lit']",
    '[mcp_servers.bare_one.env]',
    '[mcp_servers]',
    'inline = { command = "y" }',
    'also.command = "z"',
    '[other]',
    'mcp_servers = "not a table here"',
    '[mcp_serversx.nope]',
  ].join('\n');
  assert.deepEqual(tomlTableNames(toml, 'mcp_servers'), ['also', 'bare_one', 'dotted', 'inline', 'lit', 'spaced']);
  assert.deepEqual(tomlTableNames('', 'plugins'), []);
});

// The command as a person runs it: HOME (and USERPROFILE, which Windows reads) point at a fixture.
function yad(args, { cwd, home }) {
  return spawnSync(process.execPath, [YAD, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1', YAD_NO_UPDATE_CHECK: '1' },
  });
}

test('E50: `yad detect --json` answers in the E1 envelope, from a folder that is not a Product', () => {
  const { T, proj, home } = fixture();
  try {
    const r = yad(['detect', '--json'], { cwd: proj, home });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.command, 'detect');
    assert.equal(out.ok, true);
    assert.equal(typeof out.jsonVersion, 'number');
    assert.equal(out.counts.skill, out.items.filter((i) => i.kind === 'skill').length);
    assert.ok(out.counts.mcp > 0 && out.counts.plugin > 0 && out.counts.agent > 0);
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: `yad detect` prints each place once, caps long lists, and refuses extra words', () => {
  const { T, proj, home } = fixture();
  try {
    for (let i = 0; i < 12; i++) skill(path.join(proj, '.claude/skills'), `many-${String(i).padStart(2, '0')}`);
    const r = yad(['detect'], { cwd: proj, home });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\.claude\/skills \[project\] — 14 — read by Claude Code, Cursor/);
    assert.match(r.stdout, /… and 6 more/);
    assert.match(r.stdout, /1 skill name\(s\) are installed in more than one place \(alpha\)/);
    assert.match(r.stdout, /p4@m(?: \S+)? \(disabled\)/);
    assert.ok(!r.stdout.includes(SECRET));

    skill(path.join(proj, '.claude/skills'), 'esc', 'name: "evil\u001b[2Jname"\n');
    const esc = yad(['detect'], { cwd: proj, home });
    assert.ok(!esc.stdout.includes('\u001b'), 'no control character reaches the terminal');

    const bad = yad(['detect', 'skills'], { cwd: proj, home });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /yad detect takes no words/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
