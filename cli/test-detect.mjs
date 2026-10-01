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

process.env.YAD_NO_UPDATE_NOTIFIER = '1';

const { detectInstalled, skillMeta, stripJsonComments, tomlAgentName, tomlTableNames } = await import('./detect.mjs');

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
  put(path.join(proj, '.claude/skills/crlf/SKILL.md'), '\uFEFF---\r\nname: \'crlf-skill\'\r\nversion: 3\r\n---\r\nbody\r\n');
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
  // Gemini CLI strips comments from its settings before reading them, so a commented file still counts.
  put(path.join(proj, '.gemini/settings.json'), `// my settings\n{ "theme": "dark", /* servers: */ "mcpServers": ${JSON.stringify({ 'gem-server': server })} }`);
  put(path.join(home, '.gemini/settings.json'), JSON.stringify({ theme: 'dark' }));
  put(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { 'user-server': server },
    projects: { [path.resolve(proj)]: { mcpServers: { 'local-server': server } }, '/somewhere/else': { mcpServers: { 'other-project': server } } },
  }));
  put(path.join(home, '.codex/config.toml'), [
    'model = "x"',
    `[mcp_servers.docs]\ncommand = "npx"\nargs = [\n  "--token",\n  "${SECRET}"\n]\ndescription = """\n${SECRET}=1\n[mcp_servers.fake]\n"""`,
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
  // `mcpServers` as a list of paths and objects; a name that only starts with `..` is still the plugin's.
  put(path.join(plug('p5'), '.claude-plugin/plugin.json'), JSON.stringify({ name: 'p5', mcpServers: ['./a.json', { 'p5-inline': server }, '..x.json'] }));
  put(path.join(plug('p5'), 'a.json'), JSON.stringify({ mcpServers: { 'p5-a': server } }));
  put(path.join(plug('p5'), '..x.json'), JSON.stringify({ 'p5-dots': server }));
  put(path.join(plug('p6'), '.claude-plugin/plugin.json'), '{ not json');
  // A `mcpServers` that is not an object is a problem, not a reason to list the file's other keys.
  put(path.join(plug('p7'), '.mcp.json'), JSON.stringify({ $schema: 's', mcpServers: [] }));
  put(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'p1@m': [{ scope: 'user', installPath: plug('p1'), version: '1.0.0', gitCommitSha: 'abc123' }],
      'p2@m': [{ scope: 'local', projectPath: proj, installPath: plug('p2'), version: '2.0.0' }],
      'p3@m': [{ scope: 'project', projectPath: path.join(T, 'elsewhere'), installPath: plug('p3'), version: '3.0.0' }],
      'p4@m': [{ scope: 'user', installPath: plug('p4') }],
      'p5@m': [{ scope: 'project', projectPath: proj, installPath: plug('p5') }],
      'p6@m': [{ scope: 'user', installPath: plug('p6') }],
      'p7@m': [{ scope: 'user', installPath: plug('p7') }],
      'gone@m': [{ scope: 'user', installPath: path.join(T, 'missing') }],
    },
  }));
  put(path.join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'p1@m': true, 'p4@m': false, 'p2@m': true } }));
  // The folder's own settings win over the home folder's, and settings.local.json over settings.json.
  put(path.join(proj, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'p2@m': true, 'p4@m': true } }));
  put(path.join(proj, '.claude/settings.local.json'), JSON.stringify({ enabledPlugins: { 'p2@m': false } }));
  return { T, proj, home };
}

test('E50: every place is read, and each item says where it came from and which agents read it', () => {
  const { T, proj, home } = fixture();
  try {
    const { items, problems } = detectInstalled(proj, { home });
    assert.deepEqual(problems, [
      { where: '~/.claude/plugins (p4@m: .claude-plugin/plugin.json)', problem: 'names an MCP file outside the plugin' },
      { where: '~/.claude/plugins (p6@m: .claude-plugin/plugin.json)', problem: 'could not be read as a JSON object' },
      { where: '~/.claude/plugins (p7@m: .mcp.json)', problem: '`mcpServers` is not an object' },
    ]);

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
      'gem-server@.gemini/settings.json@project', 'local-server@~/.claude.json (this folder)@user',
      'p1-mcp@p1@m: .mcp.json@user', 'p2-mcp@p2@m: .claude-plugin/plugin.json@user',
      'p5-a@p5@m: a.json@project', 'p5-dots@p5@m: ..x.json@project', 'p5-inline@p5@m: .claude-plugin/plugin.json@project',
      'proj-codex@.codex/config.toml@project',
      'proj-server@.mcp.json@project', 'quoted.name@~/.codex/config.toml@user', 'user-server@~/.claude.json@user',
    ]);

    const plugins = items.filter((i) => i.kind === 'plugin').map((i) => [i.name, i.scope, i.version, i.enabled]);
    assert.deepEqual(plugins, [
      ['tool@market', 'user', null, undefined],
      ['gone@m', 'user', null, null], ['p1@m', 'user', '1.0.0', true], ['p2@m', 'user', '2.0.0', false], ['p4@m', 'user', null, true],
      ['p5@m', 'project', null, null], ['p6@m', 'user', null, null], ['p7@m', 'user', null, null],
    ], 'another folder\'s plugin (p3) is left out; `local` is the user\'s; the folder\'s settings win, local first');
    assert.equal(find(items, 'plugin', 'p1@m')[0].commit, 'abc123');
    const p1skill = find(items, 'skill', 'p1-skill')[0];
    assert.deepEqual([p1skill.plugin, p1skill.version, p1skill.where], ['p1@m', '1.0.0', 'p1@m: skills/p1-skill']);
    assert.equal(find(items, 'agent', 'p1-agent')[0].plugin, 'p1@m');
    assert.equal(find(items, 'mcp', 'p1-mcp').length, 1, 'p4 points outside itself and adds nothing');

    // The same keys on every item.
    for (const it of items) for (const k of ['kind', 'name', 'scope', 'where', 'agents', 'version', 'hash', 'plugin']) assert.ok(Object.hasOwn(it, k), `${it.kind} ${it.name} has ${k}`);
    // No secret, and no absolute home path, anywhere in the answer.
    // Every string of the answer, as it is — JSON.stringify doubles a Windows backslash, so a search of
    // the serialised text could never find a leaked Windows path.
    const strings = [];
    const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk({ items, problems });
    assert.ok(!strings.some((v) => v.includes(SECRET)), 'an MCP server is named, never described');
    assert.ok(!strings.some((v) => v.includes(home) || v.includes(T)), 'the home folder is shown as ~, and no absolute path appears');
    assert.equal(find(items, 'mcp', 'fake').length, 0, 'text inside a multi-line string is not a server');
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
    // `~/.claude.json` is broken on purpose below; the next test covers its `mcpServers` shapes.
    put(path.join(home, '.gemini/settings.json'), 'null');
    // A comment is allowed in Gemini's settings only: in Cursor's file it stops Cursor loading it.
    put(path.join(home, '.cursor/mcp.json'), '// mine\n{ "mcpServers": { "x": {} } }');
    const { items, problems } = detectInstalled(proj, { home });
    assert.deepEqual(items, []);
    assert.deepEqual(problems.map((p) => p.where).sort(), ['.cursor/mcp.json', '.mcp.json', '~/.claude.json', '~/.claude/plugins/installed_plugins.json', '~/.cursor/mcp.json', '~/.gemini/settings.json']);
    assert.ok(!JSON.stringify(problems).includes(SECRET));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: a settings file that cannot be read is a problem, and the answer falls through to the next', () => {
  const T = tmp();
  const proj = path.join(T, 'p');
  const home = path.join(T, 'h');
  try {
    put(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'a@m': [{ scope: 'user' }] } }));
    put(path.join(proj, '.claude/settings.local.json'), '{ broken');
    put(path.join(proj, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'a@m': false } }));
    put(path.join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'a@m': true } }));
    const { items, problems } = detectInstalled(proj, { home });
    assert.equal(find(items, 'plugin', 'a@m')[0].enabled, false);
    assert.deepEqual(problems, [{ where: '.claude/settings.local.json', problem: 'could not be read as a JSON object' }]);
    // Run in the home folder, a file that is both the folder's and the user's is reported once.
    put(path.join(home, '.claude/settings.json'), '{ broken');
    const same = detectInstalled(home, { home });
    assert.equal(same.problems.filter((p) => p.problem.startsWith('could not be read')).length, 1, JSON.stringify(same.problems));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: a `mcpServers` that is not an object is a problem wherever it is read', () => {
  const T = tmp();
  const proj = path.join(T, 'p');
  const home = path.join(T, 'h');
  try {
    fs.mkdirSync(proj, { recursive: true });
    put(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: SECRET, projects: { [path.resolve(proj)]: { mcpServers: [1] } } }));
    const plug = path.join(home, 'plug');
    put(path.join(plug, '.claude-plugin/plugin.json'), JSON.stringify({ mcpServers: [5, { ok: {} }] }));
    put(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'q@m': [{ scope: 'user', installPath: plug }] } }));
    const { items, problems } = detectInstalled(proj, { home });
    assert.deepEqual(items.filter((i) => i.kind === 'mcp').map((i) => i.name), ['ok'], 'the good entry of a list still counts');
    assert.deepEqual(problems, [
      { where: '~/.claude.json', problem: '`mcpServers` is not an object' },
      { where: '~/.claude.json (this folder)', problem: '`mcpServers` is not an object' },
      { where: '~/.claude/plugins (q@m: .claude-plugin/plugin.json)', problem: '`mcpServers` is not an object' },
    ]);
    assert.ok(!JSON.stringify(problems).includes(SECRET));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: a stray value under this folder\'s exact path does not hide its real entry', () => {
  const T = tmp();
  const proj = path.join(T, 'p');
  const home = path.join(T, 'h');
  try {
    fs.mkdirSync(proj, { recursive: true });
    fs.symlinkSync(proj, path.join(T, 'link'), 'junction');
    put(path.join(home, '.claude.json'), JSON.stringify({ projects: { [path.resolve(proj)]: 'x', [path.join(T, 'link')]: { mcpServers: { s: {} } } } }));
    const { items } = detectInstalled(proj, { home });
    assert.deepEqual(items.map((i) => `${i.kind}:${i.name}:${i.where}`), ['mcp:s:~/.claude.json (this folder)']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50: a plugin MCP path that leaves the plugin, or names nothing, is a problem that shows no path', () => {
  const T = tmp();
  const home = path.join(T, 'h');
  try {
    const out = path.join(T, 'outside.json');
    put(out, JSON.stringify({ mcpServers: { leaked: {} } }));
    put(path.join(home, 'a/.claude-plugin/plugin.json'), JSON.stringify({ mcpServers: out }));
    put(path.join(home, 'b/.claude-plugin/plugin.json'), JSON.stringify({ mcpServers: 'missing.json' }));
    // Naming `.mcp.json` itself is naming a file: it must be there, unlike the unnamed default.
    put(path.join(home, 'c/.claude-plugin/plugin.json'), JSON.stringify({ mcpServers: '.mcp.json' }));
    put(path.join(home, 'd/.claude-plugin/plugin.json'), JSON.stringify({ mcpServers: '.' }));
    put(path.join(home, 'e/.claude-plugin/plugin.json'), JSON.stringify({ name: 'e' }));
    put(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: {
      'a@m': [{ scope: 'user', installPath: path.join(home, 'a') }], 'b@m': [{ scope: 'user', installPath: path.join(home, 'b') }],
      'c@m': [{ scope: 'user', installPath: path.join(home, 'c') }], 'd@m': [{ scope: 'user', installPath: path.join(home, 'd') }],
      'e@m': [{ scope: 'user', installPath: path.join(home, 'e') }],
    } }));
    const { items, problems } = detectInstalled(path.join(T, 'none'), { home });
    assert.equal(items.filter((i) => i.kind === 'mcp').length, 0);
    assert.deepEqual(problems, [
      { where: '~/.claude/plugins (a@m: .claude-plugin/plugin.json)', problem: 'names an MCP file outside the plugin' },
      { where: '~/.claude/plugins (b@m: .claude-plugin/plugin.json)', problem: 'names an MCP file that is not there' },
      { where: '~/.claude/plugins (c@m: .claude-plugin/plugin.json)', problem: 'names an MCP file that is not there' },
      { where: '~/.claude/plugins (d@m: .claude-plugin/plugin.json)', problem: 'names the plugin folder, not an MCP file' },
    ], 'e has neither mcpServers nor .mcp.json: nothing to report');
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
  // Text inside a value is never a key — the leak the first reader had.
  assert.deepEqual(tomlTableNames(`[mcp_servers]\ndocs.command = "npx"\ndocs.args = [\n  "--token",\n  "${SECRET}"\n]\n`, 'mcp_servers'), ['docs']);
  assert.deepEqual(tomlTableNames(`[mcp_servers]\ndocs.d = """\n${SECRET}=1\n[mcp_servers.fake]\n"""\nb = 1\n`, 'mcp_servers'), ['b', 'docs']);
  assert.deepEqual(tomlTableNames(`[mcp_servers]\nd.x = '''\n${SECRET} = 2\n'''\n`, 'mcp_servers'), ['d']);
  assert.deepEqual(tomlTableNames('[a]\nx = [\n  ["mcp_servers"],\n]\nafter = 1\n[mcp_servers.y]\n', 'mcp_servers'), ['y'], 'a nested array line is not a header, so `after` stays in [a]');
  assert.deepEqual(tomlTableNames('mcp_servers = { docs = { command = "x" }, "q.x" = {} }\n', 'mcp_servers'), ['docs', 'q.x'], 'a top-level inline table');
  assert.deepEqual(tomlTableNames(String.raw`[mcp_servers."a\"b"]`, 'mcp_servers'), ['a"b'], 'escapes in a quoted key are decoded');
  assert.deepEqual(tomlTableNames(String.raw`[mcp_servers."x\U0001F600A\q"]`, 'mcp_servers'), [`x${String.fromCodePoint(0x1f600)}A\\q`], 'TOML escapes, JSON has no \\U; an unknown one is kept');
  assert.equal(tomlAgentName('name = """multi"""'), null, 'a multi-line string is never read');
  assert.deepEqual(skillMeta('---\nname: foo # a comment\nversion: "1 # kept"\n---\n'), { name: 'foo', version: '1 # kept' });
  assert.deepEqual(skillMeta(`---\nname: "a" # was "b"\nversion: 'x' # 'y'\n---\n`), { name: 'a', version: 'x' }, 'the value ends at its own closing quote');
  assert.deepEqual(skillMeta('---\nname: "\\u0000\\u202e"\nversion: " "\n---\n'), {}, 'a value of only invisible characters is no value');
  assert.deepEqual(skillMeta('---\nname: "\\u200b"\nversion: "\\u061c\\u2060\\ufeff"\n---\n'), {}, 'zero-width and format characters are invisible too');
  assert.deepEqual(skillMeta(String.raw`---
name: 'it''s'
version: "1\"2"
---
`), { name: "it's", version: '1"2' }, "YAML's quote escapes are decoded");
  assert.deepEqual(skillMeta('---\nmetadata:\n  a:\n    version: 9\n  version: 2\n---\n'), { version: '2' }, 'a deeper version is not metadata.version');
  assert.deepEqual(JSON.parse(stripJsonComments(String.raw`{"u":"http://x//y", // c
 "b":/* z */1, "q":"a\"//"}`)), { u: 'http://x//y', b: 1, q: 'a"//' });
});

test('E50: the same SKILL.md hashes the same with LF and CRLF line ends', () => {
  const T = tmp();
  try {
    put(path.join(T, 'a/.claude/skills/s/SKILL.md'), '---\nname: s\n---\nbody\n');
    put(path.join(T, 'b/.claude/skills/s/SKILL.md'), '---\r\nname: s\r\n---\r\nbody\r\n');
    const h = (d) => detectInstalled(path.join(T, d), { home: null }).items[0].hash;
    assert.equal(h('a'), h('b'));
    assert.equal(h('a'), sha(path.join(T, 'a/.claude/skills/s/SKILL.md')), 'a file with no CR hashes as its bytes');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E50/E84: `yad detect` and `yad toolbox` skip the newer-version check — no network, no cache file', () => {
  // A source pin, because a run from this checkout cannot show it: the check already stays quiet when the
  // package folder holds `.git`, so dropping `detect` from the skip list would pass every run here.
  const src = fs.readFileSync(YAD, 'utf8');
  assert.match(src, /if \(!\['hook', 'detect', 'toolbox'\]\.includes\(parseArgs\(process\.argv\.slice\(2\)\)\._\[0\]\)\) \{\s*const \{ maybeNotifyUpdate \}/);
});

// The command as a person runs it: HOME (and USERPROFILE, which Windows reads) point at a fixture.
function yad(args, { cwd, home }) {
  return spawnSync(process.execPath, [YAD, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1' },
  });
}

test('E50: `yad detect --json` answers in the E1 envelope, from a folder that is not a Product', () => {
  const { T, proj, home } = fixture();
  try {
    const before = snapshot(T);
    const r = yad(['detect', '--json'], { cwd: proj, home });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(snapshot(T), before, 'the whole command writes nothing, in the folder or the home folder');
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
    assert.match(r.stdout, /p2@m(?: \S+)? \(disabled\)/, "the folder's settings.local.json turns p2 off");
    assert.ok(!r.stdout.includes(SECRET));

    skill(path.join(proj, '.claude/skills'), 'esc', 'name: "evil\u001b[2Jname"\n');
    const esc = yad(['detect'], { cwd: proj, home });
    assert.ok(!esc.stdout.includes('\u001b'), 'no control character reaches the terminal');
    skill(path.join(proj, '.claude/skills'), 'bidi', `name: "abc${String.fromCharCode(0x202e)}def"\n`);
    const bidi = yad(['detect'], { cwd: proj, home });
    assert.ok(!bidi.stdout.includes(String.fromCharCode(0x202e)), 'no character that reorders the line reaches the terminal');

    // A Product whose two settings files disagree: every Product command refuses it (E122); `yad detect`
    // reads none of them, so it still answers.
    put(path.join(proj, '.sdlc/cli-version.json'), '{"version":"4.0.0"}\n');
    put(path.join(proj, '.sdlc/product.json'), '{"schemaVersion":10,"platform":null}\n');
    put(path.join(proj, '.sdlc/hub.json'), '{"schemaVersion":10,"platform":"github"}\n');
    const drift = yad(['detect', '--json'], { cwd: proj, home });
    assert.equal(drift.status, 0, drift.stdout + drift.stderr);
    assert.equal(JSON.parse(drift.stdout).ok, true);

    const bad = yad(['detect', 'skills'], { cwd: proj, home });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /yad detect takes no words/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---------- E84: the toolbox ----------
// The shipped list of external tools, and what this machine has of them. It builds on `yad detect`, so it
// is tested here, on Linux, macOS and Windows.
const { INSTALL_TYPES, TIERS, TOOLBOX, onPath, parseRange, parseVersion, toolProblems, toolStatus, toolboxLines, versionInRange } = await import('./toolbox.mjs');

test('E84: every shipped toolbox entry is well formed, and every tier has entries', () => {
  for (const t of TOOLBOX) assert.deepEqual(toolProblems(t), [], t.id);
  const ids = TOOLBOX.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const tier of TIERS) assert.ok(TOOLBOX.some((t) => t.tier === tier), tier);
  assert.deepEqual(TOOLBOX.filter((t) => t.tier === 'core').map((t) => t.id), ['repomix', 'spec-kit', 'impeccable'], 'the roadmap\'s three core tools');
  for (const t of TOOLBOX) for (const r of t.install) assert.ok(INSTALL_TYPES.includes(r.type), `${t.id}: ${r.type}`);
  // The roadmap's own finding: npm `ecc` is an unrelated crypto library, never ECC's install command.
  for (const t of TOOLBOX) for (const r of t.install) assert.doesNotMatch(r.command, /\bnpx ecc(@|\s|$)|\bnpm (i|install) (-g )?ecc(\s|$)/, t.id);
});

test('E84: a fallback a skill records is written there word for word, so E87 renames nothing', () => {
  for (const t of TOOLBOX.filter((x) => x.records)) {
    const skills = t.usedBy.filter((u) => fs.existsSync(path.join(ROOT, 'skills', u, 'SKILL.md')));
    assert.ok(skills.length, `${t.id}: names a skill that exists`);
    for (const s of skills) assert.ok(fs.readFileSync(path.join(ROOT, 'skills', s, 'SKILL.md'), 'utf8').includes(t.records), `${s} writes "${t.records}"`);
  }
});

test('E84: the connectors are the adapters skills/sdlc/config.yaml names, with the same fallbacks', () => {
  const yaml = fs.readFileSync(path.join(ROOT, 'skills/sdlc/config.yaml'), 'utf8');
  const named = [];
  for (const section of ['design', 'testing', 'learning']) {
    const block = yaml.slice(yaml.search(new RegExp(`^${section}:`, 'm')));
    const tools = block.match(/^\s+tools:\s*\[([^\]]*)\]/m)[1].split(',').map((x) => x.trim());
    const degrade = block.match(/^\s+degrade:\s*([\w-]+)/m)[1];
    named.push(...tools);
    for (const id of tools) {
      const t = TOOLBOX.find((x) => x.id === id);
      assert.ok(t, `${section}: ${id} is in the toolbox`);
      assert.equal(t.tier, 'connector', id);
      assert.ok(t.fallback.startsWith(degrade), `${id}: the fallback is config.yaml's "${degrade}"`);
    }
  }
  // And the other way: no connector that config.yaml does not name.
  assert.deepEqual(TOOLBOX.filter((t) => t.tier === 'connector').map((t) => t.id).sort(), [...named].sort());
});

test('E84: toolProblems names each way an entry can be wrong', () => {
  const good = TOOLBOX[0];
  const bad = (patch) => toolProblems({ ...good, ...patch });
  assert.deepEqual(toolProblems(good), []);
  assert.ok(bad({ id: 'Has Spaces' }).some((p) => p.startsWith('id ')));
  assert.ok(bad({ tier: 'default' }).some((p) => p.startsWith('tier ')));
  assert.ok(bad({ install: [{ type: 'brew', command: 'brew install x' }] }).some((p) => p.includes("route's type")));
  assert.ok(bad({ install: [], manual: null }).some((p) => p.includes('manual steps')));
  assert.ok(bad({ install: [], manual: 'https://example.invalid/setup' }).every((p) => !p.includes('manual steps')), 'no command, but a manual link, is fine');
  assert.ok(bad({ checked: 'yesterday' }).some((p) => p.startsWith('checked ')));
  assert.ok(bad({ source: 'http://x' }).some((p) => p.startsWith('source ')));
  assert.ok(bad({ detect: {} }).some((p) => p.includes('at least one')));
  assert.ok(bad({ detect: { skills: 'impeccable' } }).some((p) => p.includes('detect.skills')));
  assert.ok(bad({ versions: 'latest' }).some((p) => p.startsWith('versions ')));
  assert.ok(bad({ fallback: '' }).some((p) => p.startsWith('fallback ')));
  assert.ok(bad({ usedBy: [] }).length === 0, 'an empty usedBy list is still a list');
  assert.ok(bad({ usedBy: 'yad-ui' }).some((p) => p.startsWith('usedBy ')));
  for (const [patch, start] of [[{ name: '' }, 'name '], [{ role: '' }, 'role '], [{ licence: '' }, 'licence '], [{ records: '' }, 'records '],
    [{ note: '' }, 'note '], [{ manual: 'ftp://x' }, 'manual '], [{ install: 'npm i x' }, 'install '], [{ detect: { npx: 'yes' } }, 'detect.npx']]) {
    assert.ok(bad(patch).some((p) => p.startsWith(start)), JSON.stringify(patch));
  }
  assert.ok(bad({ install: [{ type: 'npm', command: '' }] }).some((p) => p.includes('has its command')));
  assert.ok(toolProblems(null).length > 5, 'nothing at all is many problems, not a crash');
});

test('E84: versions and ranges', () => {
  assert.deepEqual(parseVersion('v1.2'), { parts: [1, 2, 0], pre: null, full: false });
  assert.deepEqual(parseVersion('3.7.1-beta.2+build'), { parts: [3, 7, 1], pre: 'beta.2', full: true });
  // A range needs all three numbers: each operator reads a partial version differently, and guessing
  // got `~1`, `^0` and `>1.2` wrong. Refused, so toolProblems rejects the entry.
  for (const r of ['~1', '^0', '>1.2', '^3.2', '<=2']) assert.equal(parseRange(r), null, r);
  assert.equal(parseVersion('aa5654b7acb7'), null, 'a git sha is not a version');
  assert.equal(parseVersion(null), null);
  assert.equal(parseRange('latest'), null);
  const cases = [
    ['3.7.1', '>=3.0.0 <4.0.0', true], ['4.0.0', '>=3.0.0 <4.0.0', false], ['2.9.9', '>=3.0.0', false],
    ['4.0.0-beta', '^3.2.0', false], ['3.9.9', '^3.2.0', true], ['3.1.0', '^3.2.0', false],
    ['0.2.5', '^0.2.1', true], ['0.3.0', '^0.2.1', false],
    ['0.0.3', '^0.0.3', true], ['0.0.9', '^0.0.3', false], ['0.0.4-rc.1', '^0.0.3', false],
    // One rule for pre-releases: an upper bound keeps out its own pre-releases, written or derived.
    ['4.0.0-beta', '>=3.0.0 <4.0.0', false], ['4.0.0-beta', '<4.0.0-rc.1', true],
    // Pre-releases in order: alpha < alpha.1 < alpha.beta < beta < beta.2 < beta.11 < rc.1 < release.
    ['1.0.0-alpha', '<1.0.0-alpha.1', true], ['1.0.0-alpha.1', '<1.0.0-alpha.beta', true], ['1.0.0-beta.2', '<1.0.0-beta.11', true],
    ['1.0.0-beta.11', '<1.0.0-rc.1', true], ['1.0.0-rc.1', '>=1.0.0-rc.1 <=1.0.0-rc.1', true], ['1.0.0-1', '<1.0.0-alpha', true],
    ['1.4.9', '~1.4.0', true], ['1.5.0', '~1.4.0', false],
    ['2.0.0', '2.0.0', true], ['2.0.1', '=2.0.0', false], ['1.0.0', '>1.0.0', false], ['1.0.0', '<=1.0.0', true],
    ['3.0.0-rc.1', '>=3.0.0', false],
  ];
  for (const [v, r, want] of cases) assert.equal(versionInRange(v, r), want, `${v} in ${r}`);
  assert.equal(versionInRange('aa5654b7acb7', '>=1.0.0'), null, 'cannot tell');
  assert.equal(versionInRange('1.0.0', null), null, 'no range, nothing to say');
});

test('E84: onPath reads the PATH folders and starts nothing', () => {
  const T = tmp();
  try {
    put(path.join(T, 'a/tool'), '#!/bin/sh\n');
    fs.chmodSync(path.join(T, 'a/tool'), 0o755);
    put(path.join(T, 'a/plain'), 'not runnable');
    fs.chmodSync(path.join(T, 'a/plain'), 0o644);
    fs.mkdirSync(path.join(T, 'a/dir'), { recursive: true });
    // POSIX rules need POSIX folders: on the Windows runner a temp folder is `D:\…`, which those rules
    // rightly call relative (and `:` splits it). The Windows block below covers that runner.
    if (process.platform !== 'win32') {
      const env = { PATH: [path.join(T, 'none'), path.join(T, 'a')].join(':') };
      assert.equal(onPath('tool', { env, platform: 'linux' }), true);
      assert.equal(onPath('missing', { env, platform: 'linux' }), false);
      assert.equal(onPath('dir', { env, platform: 'linux' }), false, 'a folder is not a program');
      // An empty or relative entry is "the current folder": never where a tool is installed.
      const rel = path.relative(process.cwd(), path.join(T, 'a'));
      assert.equal(onPath('tool', { env: { PATH: `${rel}::` }, platform: 'linux' }), false, 'a relative entry is skipped');
      assert.equal(onPath('tool', { env: { PATH: '', Path: path.join(T, 'a') }, platform: 'linux' }), true, 'an empty PATH falls back to Path');
      assert.equal(onPath('plain', { env, platform: 'linux' }), false, 'a file that cannot run is not a program');
    }
    // Windows: a program is its name plus a PATHEXT ending.
    put(path.join(T, 'w/maestro.CMD'), '@echo off');
    // Under Windows' rule only a drive and a root, or a share, is absolute. On the Windows runner the
    // temp folder has a drive; elsewhere `//` + the folder reads as a share AND still names the same
    // folder on macOS and Linux, so the found side is tested on every runner.
    const winDir = process.platform === 'win32' ? path.join(T, 'w') : `/${path.join(T, 'w')}`;
    const winEnv = { Path: winDir, PATHEXT: '.EXE;.CMD' };
    assert.equal(onPath('maestro', { env: winEnv, platform: 'win32' }), true);
    assert.equal(onPath('maestro', { env: { ...winEnv, PATHEXT: '.EXE' }, platform: 'win32' }), false);
    // Windows accepts an entry in quotes. Only a drive and a root, or a share, is absolute there; the
    // folder below stands in for one (on a Mac or Linux runner it is a plain absolute path).
    assert.equal(onPath('maestro', { env: { Path: `"${winDir}"`, PATHEXT: '.CMD' }, platform: 'win32' }), true, 'a quoted entry is read like an unquoted one');
    assert.equal(onPath('maestro', { env: { Path: path.join(T, 'w').replace(/^[A-Za-z]:/, ''), PATHEXT: '.CMD' }, platform: 'win32' }), false, 'a root with no drive is the current drive');
    for (const rel of ['\\w', 'D:w', '.\\w']) assert.equal(onPath('maestro', { env: { Path: rel, PATHEXT: '.CMD' }, platform: 'win32' }), false, rel);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E84: toolStatus — installed, available through npx, missing; versions warn, never disqualify', () => {
  const tool = (detect, versions = null) => ({ ...TOOLBOX[0], detect, versions });
  const none = () => false;
  const item = (kind, name, where, version = null) => ({ kind, name, where, version });
  assert.equal(toolStatus(tool({ skills: ['Impeccable'] }), [item('skill', 'impeccable', '~/.claude/skills/impeccable', '3.7.1')], { has: none }).state, 'installed', 'names compare without case');
  assert.deepEqual(toolStatus(tool({ skillPrefixes: ['speckit-'] }), [item('skill', 'speckit-plan', 'a'), item('skill', 'speckit-tasks', 'b'), item('skill', 'other', 'c')], { has: none }).found, ['a', 'b']);
  assert.equal(toolStatus(tool({ plugins: ['figma'] }), [item('plugin', 'figma@claude-plugins-official', 'p')], { has: none }).state, 'installed', 'a plugin by its name, without the marketplace');
  assert.equal(toolStatus(tool({ plugins: ['figma'] }), [item('plugin', 'figmatic@x', 'p')], { has: none }).state, 'missing', 'not by a prefix');
  assert.equal(toolStatus(tool({ plugins: ['figma@claude-plugins-official'] }), [item('plugin', 'figma@claude-plugins-official', 'p')], { has: none }).state, 'installed', 'or by its full id');
  assert.equal(toolStatus(tool({ plugins: ['figma@claude-plugins-official'] }), [item('plugin', 'figma@other', 'p')], { has: none }).state, 'missing', 'a full id is exact');
  assert.equal(toolStatus(tool({ skillPrefixes: ['SpecKit-'] }), [item('skill', 'speckit-plan', 'a')], { has: none }).state, 'installed', 'a prefix compares without case');
  assert.equal(toolStatus(tool({ skills: ['reviewer'] }), [item('agent', 'reviewer', 'a')], { has: none }).state, 'missing', 'an agent is not a skill');
  assert.equal(toolStatus(tool({ mcp: ['pencil'] }), [item('mcp', 'pencil', '~/.claude.json')], { has: none }).state, 'installed');
  assert.equal(toolStatus(tool({ mcp: ['pencil'] }), [item('skill', 'pencil', 'x')], { has: none }).state, 'missing', 'the kind must match');
  assert.deepEqual(toolStatus(tool({ bins: ['deeptutor'] }), [], { has: (b) => b === 'deeptutor' }), { state: 'installed', found: ['deeptutor on PATH'], version: null, inRange: null });
  assert.deepEqual(toolStatus(tool({ npx: true }), [], { has: (b) => b === 'npx' }), { state: 'available', found: ['npx on PATH'], version: null, inRange: null });
  assert.equal(toolStatus(tool({ npx: true }), [], { has: none }).state, 'missing');
  const old = toolStatus(tool({ skills: ['impeccable'] }, '>=4.0.0'), [item('skill', 'impeccable', 'x', '3.7.1')], { has: none });
  assert.deepEqual([old.state, old.version, old.inRange], ['installed', '3.7.1', false], 'out of range: still installed');
  assert.equal(toolStatus(tool({ skills: ['impeccable'] }, '>=4.0.0'), [item('skill', 'impeccable', 'x', 'aa5654b7acb7')], { has: none }).inRange, null);
});

test('E84: a tool found only through a plugin your settings turn off is `disabled`, not installed', () => {
  const tool = { ...TOOLBOX.find((t) => t.id === 'figma') };
  const CC = ['Claude Code'];
  const plugin = (enabled) => ({ kind: 'plugin', name: 'figma@claude-plugins-official', where: '~/.claude/plugins/installed_plugins.json', agents: CC, version: '2.2.124', plugin: null, enabled });
  const server = { kind: 'mcp', name: 'figma', where: 'figma@claude-plugins-official: .mcp.json', agents: CC, version: null, plugin: 'figma@claude-plugins-official' };
  const off = toolStatus(tool, [plugin(false), server], { has: () => false });
  assert.deepEqual([off.state, off.found.length], ['disabled', 2], 'the plugin AND the server it brings are off');
  assert.equal(toolStatus(tool, [plugin(null), server], { has: () => false }).state, 'installed', 'no setting means on');
  assert.equal(toolStatus(tool, [plugin(true), server], { has: () => false }).state, 'installed');
  // The same server added by hand (no plugin) still counts while the plugin is off.
  const own = { ...server, where: '~/.claude.json', plugin: null };
  assert.deepEqual(toolStatus(tool, [plugin(false), server, own], { has: () => false }).found, ['~/.claude.json']);
  // A Codex plugin of the same name has its own switch: the Claude Code one being off says nothing about it.
  const codex = { kind: 'plugin', name: 'figma@claude-plugins-official', where: '~/.codex/config.toml', agents: ['Codex CLI'], version: null, plugin: null };
  assert.deepEqual(toolStatus(tool, [plugin(false), codex], { has: () => false }).found, ['~/.codex/config.toml']);
  // A tool yadflow runs through npx stays available when its plugin is off.
  const repomix = TOOLBOX.find((t) => t.id === 'repomix');
  const rp = { kind: 'plugin', name: 'repomix-mcp@repomix', where: 'p', agents: CC, version: null, plugin: null, enabled: false };
  const rs = { kind: 'mcp', name: 'repomix', where: 'repomix-mcp@repomix: .mcp.json', agents: CC, version: null, plugin: 'repomix-mcp@repomix' };
  assert.equal(toolStatus(repomix, [rp, rs], { has: (b) => b === 'npx' }).state, 'available');
  assert.equal(toolStatus(repomix, [rp, rs], { has: () => false }).state, 'disabled');
  const text = toolboxLines([{ ...tool, status: off }]).join('\n');
  assert.match(text, /Figma .*: installed, but its plugin is turned off in your Claude Code settings\n\s+without it: markdown-only/);
});

test('E84: the printed list — a warning for a version out of range, the fallback for a missing tool', () => {
  const rows = [
    { ...TOOLBOX.find((t) => t.id === 'impeccable'), versions: '>=4.0.0', status: { state: 'installed', found: ['x'], version: '3.7.1', inRange: false } },
    { ...TOOLBOX.find((t) => t.id === 'spec-kit'), status: { state: 'missing', found: [], version: null, inRange: null } },
    { ...TOOLBOX.find((t) => t.id === 'repomix'), status: { state: 'available', found: ['npx on PATH'], version: null, inRange: null } },
    { ...TOOLBOX.find((t) => t.id === 'figma'), status: { state: 'installed', found: ['x'], version: `1${String.fromCharCode(27)}[2J`, inRange: null } },
  ];
  const text = toolboxLines(rows).join('\n');
  assert.match(text, /Impeccable .*: installed 3\.7\.1\n\s+! version 3\.7\.1 is outside the known-good range >=4\.0\.0 — still used/);
  assert.match(text, /Spec Kit .*: not found\n\s+without it: yad-spec writes the same spec files by hand/);
  assert.match(text, /Repomix .*: available \(npx fetches it when needed\)/);
  assert.ok(!text.includes(String.fromCharCode(27)), 'a version read from a file is cleaned for the terminal');
  assert.ok(text.indexOf('Core —') < text.indexOf('Connectors —'), 'tiers in order');
  assert.ok(!text.includes('Recommended —'), 'a tier with no rows is not printed');
});

test('E84: `yad toolbox list` answers in the E1 envelope, writes nothing, and refuses a word it does not know', () => {
  const T = tmp();
  const proj = path.join(T, 'p');
  const home = path.join(T, 'h');
  try {
    fs.mkdirSync(proj, { recursive: true });
    skill(path.join(home, '.claude/skills'), 'impeccable', 'name: impeccable\nversion: 3.7.1\n');
    put(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { pencil: { env: { TOKEN: SECRET } } } }));
    // A Product whose settings disagree: the toolbox reads none of them, so it still answers.
    put(path.join(proj, '.sdlc/product.json'), '{"schemaVersion":10,"platform":null}\n');
    put(path.join(proj, '.sdlc/hub.json'), '{"schemaVersion":10,"platform":"github"}\n');
    const before = snapshot(T);
    const r = yad(['toolbox', '--json'], { cwd: proj, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(snapshot(T), before, 'nothing written');
    const out = JSON.parse(r.stdout);
    assert.equal(out.command, 'toolbox list', '`yad toolbox` is `toolbox list`');
    assert.equal(out.tools.length, TOOLBOX.length);
    const byId = Object.fromEntries(out.tools.map((t) => [t.id, t.status]));
    assert.deepEqual([byId.impeccable.state, byId.impeccable.version], ['installed', '3.7.1']);
    assert.equal(byId.pencil.state, 'installed');
    assert.ok(!r.stdout.includes(SECRET) && !r.stdout.includes(home));

    const human = yad(['toolbox', 'list'], { cwd: proj, home });
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /Impeccable .*: installed 3\.7\.1/);

    for (const [args, re] of [[['toolbox', 'frob'], /unknown toolbox action: frob/], [['toolbox', 'list', 'extra'], /takes no more words/], [['toolbox', 'check', 'extra'], /takes no more words/]]) {
      const bad = yad(args, { cwd: proj, home });
      assert.equal(bad.status, 1, args.join(' '));
      assert.match(bad.stdout, re);
    }
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---------- E86: the team's choices ----------

const { connectedTools, customProblems, loadChoices, parseDetect, parseInstall, toolUse, toolboxCheck, toolboxRows } = await import('./toolbox.mjs');

// A Product: settings, plus any files given as { 'rel/path': text }.
function product(files = {}) {
  const T = tmp();
  const p = path.join(T, 'p');
  const home = path.join(T, 'h');
  fs.mkdirSync(home, { recursive: true });
  put(path.join(p, '.sdlc/product.json'), '{"schemaVersion":10,"platform":null}\n');
  for (const [rel, text] of Object.entries(files)) put(path.join(p, rel), text);
  return { T, p, home };
}
const toolboxJSON = (p) => JSON.parse(fs.readFileSync(path.join(p, '.sdlc/toolbox.json'), 'utf8'));
const CUSTOM = { id: 'doclint', role: 'lints the docs', fallback: 'the docs are not linted', detect: { bins: ['doclint-e86'] } };

test('E86: in use by default — the core tools, and the connector a Product connected; a choice overrides either', () => {
  const none = { shipped: new Map(), connected: new Map() };
  const byId = (id) => TOOLBOX.find((t) => t.id === id);
  assert.deepEqual(toolUse(byId('spec-kit'), none), { used: true, because: 'core' });
  assert.deepEqual(toolUse(byId('bmad-method'), none), { used: false, because: null });
  assert.deepEqual(toolUse(byId('figma'), none), { used: false, because: null });
  const figma = { shipped: new Map(), connected: new Map([['figma', '.sdlc/design.json']]) };
  assert.deepEqual(toolUse(byId('figma'), figma), { used: true, because: 'connected', connectedIn: '.sdlc/design.json' });
  assert.deepEqual(toolUse(byId('spec-kit'), { ...none, shipped: new Map([['spec-kit', 'skip']]) }), { used: false, because: 'removed' });
  assert.deepEqual(toolUse(byId('figma'), { ...figma, shipped: new Map([['figma', 'skip']]) }), { used: false, because: 'removed' });
  assert.deepEqual(toolUse(byId('ecc'), { ...none, shipped: new Map([['ecc', 'use']]) }), { used: true, because: 'added' });

  // What counts as connected: a connector id the toolbox knows. `none`, an unknown adapter, a core tool
  // and a broken file name nothing — and none of them stops the read.
  const { T, p } = product({
    '.sdlc/design.json': '{"tool":"pencil"}', '.sdlc/testing.json': '{"tool":"none"}', '.sdlc/learning.json': '{broken',
  });
  try {
    assert.deepEqual([...connectedTools(p)], [['pencil', '.sdlc/design.json']]);
    put(path.join(p, '.sdlc/testing.json'), '{"tool":"spec-kit"}');
    put(path.join(p, '.sdlc/learning.json'), '{"tool":"my-own-tutor"}');
    assert.deepEqual([...connectedTools(p)], [['pencil', '.sdlc/design.json']]);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86: a team\'s own entry — what makes it usable, and the two flag readers', () => {
  assert.deepEqual(customProblems(CUSTOM), []);
  assert.deepEqual(customProblems({ ...CUSTOM, install: [{ type: 'npm', command: 'npx doclint' }], source: 'https://example.com', name: 'Doc Lint' }), []);
  const bad = (t, re) => assert.match(customProblems(t).join('\n'), re, JSON.stringify(t));
  bad({ ...CUSTOM, id: 'Doc Lint' }, /id is lower-case/);
  bad({ ...CUSTOM, id: 'spec-kit' }, /not the id of a shipped tool/);
  bad({ ...CUSTOM, role: ' ' }, /role says/);
  bad({ ...CUSTOM, fallback: undefined }, /fallback says/);
  bad({ ...CUSTOM, detect: {} }, /detect names at least one/);
  bad({ ...CUSTOM, detect: { programs: ['x'] } }, /detect names at least one/);
  bad({ ...CUSTOM, detect: { bins: [''] } }, /detect names at least one/);
  bad({ ...CUSTOM, install: [{ type: 'docker', command: 'x' }] }, /install, when set/);
  bad({ ...CUSTOM, source: 'http://example.com' }, /https URL/);
  assert.deepEqual(customProblems('x'), ['an entry is a JSON object']);

  assert.deepEqual(parseDetect('skill:a, prefix:b-,plugin:c,mcp:d,bin:e,bin:f'), { detect: { skills: ['a'], skillPrefixes: ['b-'], plugins: ['c'], mcp: ['d'], bins: ['e', 'f'] } });
  assert.match(parseDetect('program:x').error, /not <kind>:<name>/);
  assert.match(parseDetect('').error, /names nothing/);
  assert.match(parseDetect('__proto__:x').error, /not <kind>:<name>/, 'only the five kinds become keys');
  assert.deepEqual(parseInstall('npm:  npx doclint --yes '), { route: { type: 'npm', command: 'npx doclint --yes' } });
  assert.match(parseInstall('docker: run x').error, /<type>: <command>/);
  assert.match(parseInstall('npx doclint').error, /<type>: <command>/);
});

test('E86: a broken or odd toolbox.json — the list still answers with the defaults, and names each line that does nothing', () => {
  const doc = {
    schemaVersion: 10,
    // `__proto__` from JSON.parse is an own key, not the prototype: it is reported, never applied.
    shipped: JSON.parse('{"ecc":"use","spec-kit":"maybe","future-tool":"use","__proto__":"use"}'),
    custom: [CUSTOM, { ...CUSTOM }, { id: 'half' }, 7],
  };
  const { T, p } = product({ '.sdlc/toolbox.json': JSON.stringify(doc) });
  try {
    const c = loadChoices(p);
    assert.deepEqual([...c.shipped], [['ecc', 'use']]);
    assert.deepEqual(c.custom.map((t) => [t.id, t.tier, t.name]), [['doclint', 'project', 'doclint']]);
    const text = c.problems.join('\n');
    assert.match(text, /`spec-kit` should be "use" or "skip"/);
    assert.match(text, /`future-tool` is not a tool this yadflow ships/);
    assert.match(text, /`__proto__` is not a tool this yadflow ships/);
    assert.match(text, /`doclint` is listed twice/);
    assert.match(text, /`half` is ignored — .*role says/);
    assert.match(text, /number 4 is ignored — an entry is a JSON object/);
    assert.equal(Object.getPrototypeOf(c.shipped), Map.prototype);

    put(path.join(p, '.sdlc/toolbox.json'), '{not json');
    const broken = loadChoices(p);
    assert.match(broken.problems[0], /does not parse \[YAD-STATE-001\] — showing the defaults/);
    put(path.join(p, '.sdlc/toolbox.json'), '{"shipped":["ecc"]}');
    assert.match(loadChoices(p).problems[0], /`shipped` must be a JSON object/);
    put(path.join(p, '.sdlc/toolbox.json'), '{"custom":{"id":"x"}}');
    assert.match(loadChoices(p).problems[0], /`custom` must be a JSON list/);
    assert.deepEqual(loadChoices(null), { problems: [], unreachable: false, shipped: new Map(), custom: [], connected: new Map() });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86: a team\'s own words are cleaned before they reach the terminal', () => {
  const ESC = String.fromCharCode(27);
  const { T, p } = product({ '.sdlc/toolbox.json': JSON.stringify({ custom: [{ ...CUSTOM, name: `Doc${ESC}[2J`, role: `lints${ESC}]0;x`, fallback: `none${ESC}[31m` }] }) });
  try {
    const { rows } = toolboxRows(p, p, { items: [], has: () => false });
    const text = toolboxLines(rows).join('\n');
    assert.match(text, /Added by this project\n\s+– Doc\?\[2J — lints\?\]0;x: not found \[used here\]\n\s+without it: none\?\[31m/);
    assert.ok(!text.includes(ESC));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86: `yad toolbox add / remove` write only the difference from the default, and install nothing', () => {
  const { T, p, home } = product({ '.sdlc/design.json': '{"tool":"figma"}' });
  const file = path.join(p, '.sdlc/toolbox.json');
  try {
    // A shipped tool that is not in use: `use` is written, and the install commands are printed.
    let r = yad(['toolbox', 'add', 'bmad-method'], { cwd: p, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /BMAD-METHOD is used here now/);
    assert.match(r.stdout, /to install it: npm: npx bmad-method install {3}or {3}plugin:/);
    assert.deepEqual(toolboxJSON(p), { schemaVersion: 10, shipped: { 'bmad-method': 'use' } });

    // Already in use: nothing written — not even the same bytes again.
    const before = snapshot(T);
    for (const id of ['bmad-method', 'spec-kit', 'figma']) {
      r = yad(['toolbox', 'add', id, '--json'], { cwd: p, home });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const out = JSON.parse(r.stdout);
      assert.deepEqual([out.command, out.changed, out.used], ['toolbox add', false, true], id);
      assert.match(r.stderr, /is already used here — nothing to change/);
    }
    assert.deepEqual(snapshot(T), before);

    // A core tool and a connected one are skipped by writing `skip`; adding them back deletes the line.
    r = yad(['toolbox', 'remove', 'spec-kit'], { cwd: p, home });
    assert.match(r.stdout, /Spec Kit is not used here now\. Without it: yad-spec writes the same spec files by hand/);
    r = yad(['toolbox', 'remove', 'figma'], { cwd: p, home });
    assert.match(r.stdout, /\.sdlc\/design\.json still connects it — `yad-connect-design` changes the connection/);
    assert.deepEqual(toolboxJSON(p).shipped, { 'bmad-method': 'use', 'spec-kit': 'skip', figma: 'skip' });
    yad(['toolbox', 'add', 'spec-kit'], { cwd: p, home });
    yad(['toolbox', 'add', 'figma'], { cwd: p, home });
    yad(['toolbox', 'remove', 'bmad-method'], { cwd: p, home });
    // The last choice gone: the file stays, holding its stamp, and keeps a key this release does not know.
    const doc = toolboxJSON(p);
    assert.deepEqual(doc, { schemaVersion: 10 });
    fs.writeFileSync(file, JSON.stringify({ ...doc, later: { kept: true } }));
    r = yad(['toolbox', 'remove', 'ecc'], { cwd: p, home });
    assert.match(r.stdout, /ECC .* is already not used here — nothing to change/);
    yad(['toolbox', 'add', 'ecc'], { cwd: p, home });
    assert.deepEqual(toolboxJSON(p), { schemaVersion: 10, later: { kept: true }, shipped: { ecc: 'use' } });

    // A tool of the team's own.
    r = yad(['toolbox', 'add', 'doclint', '--custom', '--role', 'lints the docs', '--fallback', 'the docs are not linted',
      '--detect', 'bin:doclint-e86,mcp:doclint', '--install', 'npm: npm install -g doclint', '--source', 'https://example.com/doclint'], { cwd: p, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(toolboxJSON(p).custom, [{ id: 'doclint', role: 'lints the docs', fallback: 'the docs are not linted',
      detect: { bins: ['doclint-e86'], mcp: ['doclint'] }, install: [{ type: 'npm', command: 'npm install -g doclint' }], source: 'https://example.com/doclint' }]);
    r = yad(['toolbox', 'add', 'doclint'], { cwd: p, home });
    assert.match(r.stdout, /already one of this project's tools — nothing to change/);
    r = yad(['toolbox', 'remove', 'doclint'], { cwd: p, home });
    assert.match(r.stdout, /doclint removed/);
    assert.equal(toolboxJSON(p).custom, undefined);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86: `yad toolbox add / remove` refuse — and never write over a file they cannot read', () => {
  const { T, p, home } = product();
  try {
    const refuses = (args, re, cwd = p) => {
      const r = yad(['toolbox', ...args], { cwd, home });
      assert.equal(r.status, 1, `${args.join(' ')}\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout, re, args.join(' '));
    };
    const before = snapshot(T);
    refuses(['add'], /needs a tool id/);
    refuses(['remove'], /needs a tool id/);
    refuses(['add', 'a', 'b'], /takes one tool id/);
    refuses(['add', 'Not_An_Id'], /is not a tool id/);
    refuses(['add', '__proto__'], /is not a tool id/);
    refuses(['add', 'nope'], /nope is not in the toolbox/);
    refuses(['remove', 'nope'], /nope is not in the toolbox/);
    refuses(['add', 'ecc', '--role', 'x'], /--role describes a tool of your own, and goes with --custom/);
    refuses(['add', 'spec-kit', '--custom', '--role', 'r', '--fallback', 'f', '--detect', 'bin:x'], /spec-kit is a shipped tool/);
    refuses(['add', 'x', '--custom', '--role', 'r', '--fallback', 'f'], /needs --detect/);
    refuses(['add', 'x', '--custom', '--role', 'r', '--fallback', 'f', '--detect', 'exe:x'], /not <kind>:<name>/);
    refuses(['add', 'x', '--custom', '--role', 'r', '--detect', 'bin:x'], /cannot add x: fallback says/);
    refuses(['add', 'x', '--custom', '--role', 'r', '--fallback', 'f', '--detect', 'bin:x', '--install', 'brew install x'], /--install is "<type>: <command>"/);
    refuses(['add', 'x', '--custom', '--role', 'r', '--fallback', 'f', '--detect', 'bin:x', '--source', 'http://x'], /source, when set, is an https URL/);
    // Not a Product: nothing is written into the folder it ran in.
    const elsewhere = path.join(T, 'elsewhere');
    fs.mkdirSync(elsewhere);
    refuses(['add', 'ecc'], /no Product here .* writes the Product's \.sdlc\/toolbox\.json/, elsewhere);
    assert.deepEqual(snapshot(T).filter((l) => !l.startsWith('elsewhere')), before);
    assert.deepEqual(fs.readdirSync(elsewhere), []);

    // A file that does not parse is refused, byte for byte unchanged.
    const file = path.join(p, '.sdlc/toolbox.json');
    fs.writeFileSync(file, '{"shipped":{"ecc":"use"},');
    refuses(['add', 'bmad-method'], /does not parse \[YAD-STATE-001\]/);
    refuses(['remove', 'ecc'], /does not parse/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"shipped":{"ecc":"use"},');
    fs.writeFileSync(file, '[]');
    refuses(['add', 'bmad-method'], /has the wrong shape \[YAD-STATE-002\]/);
    assert.equal(fs.readFileSync(file, 'utf8'), '[]');

    // Settings under two names that disagree: every writer refuses (E122); the list still answers.
    fs.rmSync(file);
    put(path.join(p, '.sdlc/hub.json'), '{"schemaVersion":10,"platform":"github"}\n');
    const drift = yad(['toolbox', 'add', 'ecc'], { cwd: p, home });
    assert.equal(drift.status, 1);
    assert.match(drift.stdout + drift.stderr, /YAD-STATE-008/);
    assert.ok(!fs.existsSync(file));
    assert.equal(yad(['toolbox', 'list'], { cwd: p, home }).status, 0);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86: from inside a code repo — the Product\'s file is written, and the repo\'s own skills are found', () => {
  const { T, p, home } = product({ '.sdlc/repos.json': JSON.stringify({ schemaVersion: 10, repos: [{ name: 'api', path: 'api' }] }) });
  const repo = path.join(p, 'api');
  try {
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    // A skill only this code repo has.
    skill(path.join(repo, '.claude/skills'), 'impeccable', 'name: impeccable\nversion: 3.7.1\n');
    let r = yad(['toolbox', 'add', 'ecc'], { cwd: repo, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /Product: \.\./);
    assert.deepEqual(toolboxJSON(p).shipped, { ecc: 'use' });
    assert.ok(!fs.existsSync(path.join(repo, '.sdlc')), 'nothing written into the code repo');

    r = yad(['toolbox', 'list', '--json'], { cwd: repo, home });
    assert.equal(r.status, 0, r.stderr);
    const byId = Object.fromEntries(JSON.parse(r.stdout).tools.map((t) => [t.id, t]));
    assert.deepEqual([byId.impeccable.status.state, byId.impeccable.used], ['installed', true], 'found in the code repo');
    assert.deepEqual([byId.ecc.used, byId.ecc.because], [true, 'added'], 'the choice read from the Product');
    // From the Product's own folder the code repo's skill is not there.
    r = yad(['toolbox', 'list', '--json'], { cwd: p, home });
    assert.equal(JSON.parse(r.stdout).tools.find((t) => t.id === 'impeccable').status.state, 'missing');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86: `yad toolbox check` names what the project uses and is not here — and exits 0', () => {
  const { T, p, home } = product({
    '.sdlc/design.json': '{"tool":"figma"}',
    '.sdlc/toolbox.json': JSON.stringify({ shipped: { 'bmad-method': 'use', 'spec-kit': 'skip' }, custom: [CUSTOM] }),
  });
  try {
    const before = snapshot(T);
    const r = yad(['toolbox', 'check', '--json'], { cwd: p, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(snapshot(T), before, 'check writes nothing');
    const out = JSON.parse(r.stdout);
    assert.equal(out.command, 'toolbox check');
    assert.equal(out.ok, true);
    assert.ok(out.used.includes('figma') && out.used.includes('bmad-method') && out.used.includes('doclint'));
    assert.ok(!out.used.includes('spec-kit') && !out.used.includes('ecc'));
    const f = Object.fromEntries(out.findings.map((x) => [x.id, x]));
    assert.equal(f.figma.problem, 'missing');
    assert.equal(f['bmad-method'].install[0].command, 'npx bmad-method install');
    assert.equal(f.doclint.fallback, 'the docs are not linted');
    assert.equal(f['spec-kit'], undefined, 'a removed tool is not reported');

    const human = yad(['toolbox', 'check'], { cwd: p, home });
    assert.equal(human.status, 0);
    assert.match(human.stdout, /are not ready here\. None is required\./);
    assert.match(human.stdout, /– Figma: not found\n\s+plugin: claude plugin install figma@claude-plugins-official\n\s+without it: markdown-only/);
    assert.match(human.stdout, /– doclint: not found\n\s+without it: the docs are not linted/);

    // The same answer as a function, for E85: a turned-off plugin and an out-of-range version are named too.
    const tools = [{ ...TOOLBOX.find((t) => t.id === 'impeccable'), versions: '>=4.0.0' }, TOOLBOX.find((t) => t.id === 'repomix')];
    const items = [
      { kind: 'skill', name: 'impeccable', where: 'x', agents: ['Claude Code'], version: '3.7.1', plugin: null },
      { kind: 'plugin', name: 'repomix-mcp@repomix', where: 'y', agents: ['Claude Code'], version: null, plugin: null, enabled: false },
    ];
    const res = toolboxCheck(p, null, { tools, items, has: () => false });
    assert.deepEqual(res.findings.map((x) => [x.id, x.problem]), [['impeccable', 'out-of-range'], ['repomix', 'disabled']]);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86: doctor reports a toolbox.json that does nothing, never a missing tool, and rewrites nothing', async () => {
  const { toolboxFileChecks } = await import('./doctor.mjs');
  const run = (text) => {
    const { T, p } = product(text === null ? {} : { '.sdlc/toolbox.json': text });
    try {
      const checks = [];
      toolboxFileChecks(checks, p);
      if (text !== null) assert.equal(fs.readFileSync(path.join(p, '.sdlc/toolbox.json'), 'utf8'), text);
      return checks.map((c) => [c.status, c.id, c.message]);
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  };
  assert.deepEqual(run(null), []);
  const [[s1, id1, m1]] = run('{oops');
  assert.deepEqual([s1, id1], ['fail', 'toolbox']);
  assert.match(m1, /does not parse \[YAD-STATE-001\]/);
  const [[s2, , m2]] = run(JSON.stringify({ shipped: { nope: 'use', ecc: 'yes' } }));
  assert.equal(s2, 'warn');
  assert.match(m2, /2 line\(s\) do nothing — `nope` is not a tool .*`ecc` should be "use" or "skip".*\[YAD-CFG-007\]/);
  const [[s3, , m3]] = run(JSON.stringify({ shipped: { 'bmad-method': 'use' }, custom: [CUSTOM] }));
  assert.equal(s3, 'ok');
  assert.match(m3, /1 shipped tool choice\(s\), 1 tool\(s\) of this project's own/);
});

// ---------- E86 review 1 ----------

test('E86 review 1: removing a line that did nothing is said as that, not as "nothing to change"', () => {
  const { T, p, home } = product({ '.sdlc/toolbox.json': JSON.stringify({ shipped: { repomix: 'use', figma: 'bogus', ecc: 'yes' } }) });
  try {
    // repomix is core: its `use` repeats the default.
    let r = yad(['toolbox', 'add', 'repomix', '--json'], { cwd: p, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual([JSON.parse(r.stdout).changed, JSON.parse(r.stdout).used], [true, true]);
    assert.match(r.stderr, /Repomix is already used here — removed a line in \.sdlc\/toolbox\.json that did nothing/);
    assert.doesNotMatch(r.stderr, /undo with/, 'the "opposite" command would switch Repomix off, not undo');
    assert.doesNotMatch(r.stderr, /nothing to change/);
    r = yad(['toolbox', 'remove', 'figma'], { cwd: p, home });
    assert.match(r.stdout, /Figma is already not used here — removed a line in \.sdlc\/toolbox\.json that did nothing/);
    assert.doesNotMatch(r.stdout, /undo with/);
    // A bad value on a tool that is not used by default: `add` now really uses it.
    r = yad(['toolbox', 'add', 'ecc'], { cwd: p, home });
    assert.match(r.stdout, /ECC .* is used here now/);
    assert.deepEqual(toolboxJSON(p).shipped, { ecc: 'use' });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86 review 1: an entry the list ignores is never answered as in use, and remove clears every kind of dead line', () => {
  const { T, p, home } = product({
    '.sdlc/toolbox.json': JSON.stringify({ shipped: { 'future-tool': 'use', ecc: 'use' }, custom: [{ id: 'half' }, { id: 'Doc Lint', role: 'r', fallback: 'f', detect: { bins: ['x'] } }, CUSTOM, CUSTOM] }),
  });
  try {
    let r = yad(['toolbox', 'add', 'half', '--json'], { cwd: p, home });
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.deepEqual([out.ok, out.command], [false, 'toolbox add']);
    assert.match(out.error, /half is in \.sdlc\/toolbox\.json but ignored: role says/);
    for (const id of ['half', 'Doc Lint', 'future-tool']) {
      r = yad(['toolbox', 'remove', id], { cwd: p, home });
      assert.equal(r.status, 0, `${id}\n${r.stdout}${r.stderr}`);
    }
    r = yad(['toolbox', 'remove', 'doclint'], { cwd: p, home });
    assert.match(r.stdout, /doclint removed — .*listed 2 times; every copy is gone/);
    assert.deepEqual(toolboxJSON(p), { schemaVersion: 10, shipped: { ecc: 'use' } });
    r = yad(['toolbox', 'remove', 'Doc Lint'], { cwd: p, home });
    assert.match(r.stdout, /is not a tool id/, 'an id the file no longer holds is judged as an id again');
    r = yad(['toolbox', 'remove', 'ecc', '--role', 'x'], { cwd: p, home });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /remove takes only the tool id \(got --role\)/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86 review 1: a custom program is a name, never a path; a detect kind is one of the five', () => {
  for (const bin of ['../x', 'a/b', 'a\\b', '..', '.']) assert.match(customProblems({ ...CUSTOM, detect: { bins: [bin] } }).join(), /names programs, not paths/, bin);
  assert.match(parseDetect('constructor:x').error, /not <kind>:<name>/);
  assert.match(parseDetect('toString:x').error, /not <kind>:<name>/);
});

test('E86 review 1: refusals answer in JSON; --dir names the Product itself for a writer, any folder for a reader', () => {
  const { T, p, home } = product({ '.sdlc/repos.json': JSON.stringify({ schemaVersion: 10, repos: [{ name: 'api', path: 'api' }] }) });
  const repo = path.join(p, 'api');
  try {
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(p, 'specs'));
    const before = snapshot(T);
    for (const dir of [repo, path.join(p, 'specs'), path.join(p, 'typo')]) {
      const r = yad(['toolbox', 'add', 'ecc', '--json', '--dir', dir], { cwd: T, home });
      assert.equal(r.status, 1, dir);
      const out = JSON.parse(r.stdout);
      assert.deepEqual([out.ok, out.command], [false, 'toolbox add']);
      assert.match(out.error, /no Product here/);
      assert.match(out.hint, /name the Product folder itself \(the one holding \.sdlc\/product\.json\): --dir \S*p$/, 'the refusal names the Product it found');
    }
    assert.deepEqual(snapshot(T), before, 'nothing written');
    let r = yad(['toolbox', 'add', 'ecc', '--json', '--dir', p], { cwd: T, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual([JSON.parse(r.stdout).product, JSON.parse(r.stdout).file], ['p', '.sdlc/toolbox.json']);
    // A reader pointed at the code repo reads the Product it belongs to.
    r = yad(['toolbox', 'list', '--json', '--dir', repo], { cwd: T, home });
    const list = JSON.parse(r.stdout);
    assert.equal(list.product, 'p');
    assert.equal(list.tools.find((t) => t.id === 'ecc').because, 'added');
    // Drift refused under --json too.
    put(path.join(p, '.sdlc/hub.json'), '{"schemaVersion":10,"platform":"github"}\n');
    r = yad(['toolbox', 'remove', 'ecc', '--json'], { cwd: p, home });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).code, 'YAD-STATE-008');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86 review 1: through a workspace — a repo beside the Product writes it; the workspace folder itself is told where it is', () => {
  const T = tmp();
  const ws = path.join(T, 'ws');
  const p = path.join(ws, 'product');
  const repo = path.join(ws, 'api');
  const home = path.join(T, 'h');
  try {
    fs.mkdirSync(home, { recursive: true });
    put(path.join(p, '.sdlc/product.json'), '{"schemaVersion":10,"platform":null}\n');
    put(path.join(p, '.sdlc/repos.json'), JSON.stringify({ schemaVersion: 10, repos: [{ name: 'api', path: '../api' }] }));
    put(path.join(ws, '.yad-workspace.json'), JSON.stringify({ version: 1, product: 'product' }));
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    let r = yad(['toolbox', 'add', 'ecc'], { cwd: repo, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(toolboxJSON(p).shipped, { ecc: 'use' });
    r = yad(['toolbox', 'list'], { cwd: ws, home });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /not in a repo the Product registers — the Product is product/);
    r = yad(['toolbox', 'add', 'bmad-method'], { cwd: ws, home });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /the Product is product: cd there/);
    // A broken workspace file is named, not silently skipped.
    put(path.join(ws, '.yad-workspace.json'), '{"version":9,"product":"product"}');
    r = yad(['toolbox', 'check'], { cwd: repo, home });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /is version 9, .* — showing the defaults/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---------- E86 review 2 ----------

test('E86 review 2: one remove clears everything under an id, and its answer agrees with the list', () => {
  const dead = { id: 'ecc', role: 'r', fallback: 'f', detect: { bins: ['x'] } };
  const { T, p, home } = product({ '.sdlc/toolbox.json': JSON.stringify({ shipped: { ecc: 'use', doclint: 'use' }, custom: [dead, CUSTOM] }) });
  try {
    // A dead custom entry under a shipped id, and the shipped `use` line: both go, and the tool is unused.
    let r = yad(['toolbox', 'remove', 'ecc', '--json'], { cwd: p, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual([JSON.parse(r.stdout).used, JSON.parse(r.stdout).changed], [false, true]);
    assert.match(r.stderr, /also removed 1 custom entry under the id ecc, which was ignored/);
    const listed = (id) => JSON.parse(yad(['toolbox', 'list', '--json'], { cwd: p, home }).stdout).tools.find((t) => t.id === id);
    assert.equal(listed('ecc').used, false);
    // A valid custom tool and a dead shipped line under its id: one run, no line left under it.
    r = yad(['toolbox', 'remove', 'doclint'], { cwd: p, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /doclint removed/);
    assert.match(r.stdout, /removed the line for `doclint` under shipped/);
    assert.deepEqual(toolboxJSON(p), { schemaVersion: 10 });
    // A core tool with a dead custom entry under its id: removed AND unused.
    fs.writeFileSync(path.join(p, '.sdlc/toolbox.json'), JSON.stringify({ custom: [{ ...dead, id: 'spec-kit' }] }));
    r = yad(['toolbox', 'remove', 'spec-kit', '--json'], { cwd: p, home });
    assert.equal(JSON.parse(r.stdout).used, false);
    assert.equal(listed('spec-kit').used, false);
    assert.deepEqual(toolboxJSON(p), { schemaVersion: 10, shipped: { 'spec-kit': 'skip' } });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86 review 2: add judges "in use" exactly as the list does — a broken copy before a good one, or alone', () => {
  const { T, p, home } = product({ '.sdlc/toolbox.json': JSON.stringify({ custom: [{ id: 'doclint', role: 'r' }, CUSTOM, { id: 'half' }] }) });
  try {
    let r = yad(['toolbox', 'add', 'doclint', '--json'], { cwd: p, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual([JSON.parse(r.stdout).used, JSON.parse(r.stdout).changed], [true, false]);
    r = yad(['toolbox', 'add', 'doclint', '--custom', '--role', 'r', '--fallback', 'f', '--detect', 'bin:x'], { cwd: p, home });
    assert.match(r.stdout, /doclint is already one of this project's tools/);
    r = yad(['toolbox', 'add', 'half', '--custom', '--role', 'r', '--fallback', 'f', '--detect', 'bin:x'], { cwd: p, home });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /half is in \.sdlc\/toolbox\.json but ignored: role says/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86 review 2: doctor says an entry with no id is fixed by hand', async () => {
  const { toolboxFileChecks } = await import('./doctor.mjs');
  const { T, p } = product({ '.sdlc/toolbox.json': JSON.stringify({ custom: [{ role: 'r' }] }) });
  try {
    const checks = [];
    toolboxFileChecks(checks, p);
    assert.match(checks[0].hint, /\(an entry with no id, or an empty one: fix it by hand\)/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---------- E86 review 3 ----------

test('E86 review 3: a dead custom entry under a shipped id is one removal, said once, with no false undo', () => {
  const dead = (id) => ({ id, role: 'r', fallback: 'f', detect: { bins: ['x'] } });
  const { T, p, home } = product({ '.sdlc/toolbox.json': JSON.stringify({ shipped: { 'spec-kit': 'skip' }, custom: [dead('ecc'), dead('spec-kit'), dead('repomix')] }) });
  try {
    // Scenario A: ecc is not used; only its dead custom entry goes.
    let r = yad(['toolbox', 'remove', 'ecc'], { cwd: p, home });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /removed 1 custom entry under the id ecc, which was ignored .* — ECC .* is still not used here/);
    assert.doesNotMatch(r.stdout, /also removed|already not used|undo with/);
    // Scenario B: spec-kit already skipped.
    r = yad(['toolbox', 'remove', 'spec-kit'], { cwd: p, home });
    assert.match(r.stdout, /removed 1 custom entry under the id spec-kit, .* — Spec Kit is still not used here/);
    assert.doesNotMatch(r.stdout, /undo with/);
    // add clears a dead entry too, and says so once.
    r = yad(['toolbox', 'add', 'repomix'], { cwd: p, home });
    assert.match(r.stdout, /removed 1 custom entry under the id repomix, which was ignored .* — Repomix is still used here/);
    assert.doesNotMatch(r.stdout, /nothing to change|also removed/, 'one write, said once');
    assert.doesNotMatch(r.stdout, /undo with/);
    assert.deepEqual(toolboxJSON(p), { schemaVersion: 10, shipped: { 'spec-kit': 'skip' } });
    // A real change still offers its undo.
    r = yad(['toolbox', 'add', 'spec-kit'], { cwd: p, home });
    assert.match(r.stdout, /undo with `yad toolbox remove spec-kit`/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86 review 3: removing an entry that was ignored says so; an empty id is fixed by hand', async () => {
  const { T, p, home } = product({ '.sdlc/toolbox.json': JSON.stringify({ shipped: { '': 'use' }, custom: [{ id: 'half' }, { id: '', role: 'r' }] }) });
  try {
    const r = yad(['toolbox', 'remove', 'half'], { cwd: p, home });
    assert.match(r.stdout, /removed the entry for half, which was ignored/);
    assert.doesNotMatch(r.stdout, /one of this project's own tools/);
    const c = loadChoices(p);
    assert.equal(c.unreachable, true);
    const { toolboxFileChecks } = await import('./doctor.mjs');
    const checks = [];
    toolboxFileChecks(checks, p);
    assert.match(checks[0].hint, /\(an entry with no id, or an empty one: fix it by hand\)/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---------- E86 review 4 ----------

test('E86 review 4: add says "also removed" when the shipped part changed too', () => {
  const { T, p, home } = product({ '.sdlc/toolbox.json': JSON.stringify({ custom: [{ id: 'ecc', role: 'r', fallback: 'f', detect: { bins: ['x'] } }] }) });
  try {
    const r = yad(['toolbox', 'add', 'ecc'], { cwd: p, home });
    assert.match(r.stdout, /ECC .* is used here now/);
    assert.match(r.stdout, /also removed 1 custom entry under the id ecc/);
    assert.match(r.stdout, /undo with `yad toolbox remove ecc`/);
    assert.deepEqual(toolboxJSON(p), { schemaVersion: 10, shipped: { ecc: 'use' } });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E86 review 4: each way to be out of remove\'s reach is flagged on its own; a broken entry with an id is not', async () => {
  const { toolboxFileChecks } = await import('./doctor.mjs');
  for (const [doc, flagged] of [
    [{ shipped: { '': 'use' } }, true],
    [{ custom: [{ id: '', role: 'r' }] }, true],
    [{ custom: [{ role: 'r' }] }, true],
    [{ custom: ['str'] }, true],
    [{ custom: [{ id: 'Bad Id', role: 'r' }] }, false],
    [{ shipped: { 'future-tool': 'use' } }, false],
  ]) {
    const { T, p } = product({ '.sdlc/toolbox.json': JSON.stringify(doc) });
    try {
      assert.equal(loadChoices(p).unreachable, flagged, JSON.stringify(doc));
      const checks = [];
      toolboxFileChecks(checks, p);
      assert.equal(/fix it by hand\)/.test(checks[0].hint), flagged, JSON.stringify(doc));
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  }
});

// ---------- E86 small notes ----------

test('E86: a removed tool\'s fallback reads as "without it", and a copy\'s reason names the id', () => {
  const { T, p, home } = product({ '.sdlc/toolbox.json': JSON.stringify({ shipped: { ecc: 'use' }, custom: [{ id: 'ecc', role: 'r', fallback: 'f', detect: { bins: ['x'] } }] }) });
  try {
    const r = yad(['toolbox', 'remove', 'ecc'], { cwd: p, home });
    assert.match(r.stdout, /ECC .* is not used here now\. Without it: nothing changes: yadflow's own skills run every step/);
    assert.match(r.stdout, /also removed 1 custom entry under the id ecc, which was ignored \(the id is a shipped tool's\)/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---------- E85: the toolbox step of setup, check, update and join ----------

const { offerToolbox, toolboxCheckLines } = await import('./toolbox.mjs');
const { stripAnsi } = await import('./lib.mjs');

test('E85: the check lines — nothing in use, everything here, and what is missing with how to get it', () => {
  const plain = (lines) => lines.map(stripAnsi);
  assert.match(plain(toolboxCheckLines({ used: [], findings: [] }))[0], /uses no tool from the toolbox — `yad toolbox list` shows them all/);
  const repomix = TOOLBOX.find((t) => t.id === 'repomix');
  assert.deepEqual(plain(toolboxCheckLines({ used: [repomix], findings: [] })), ['  ✓ all 1 tool(s) this project uses are here: Repomix']);
  const lines = plain(toolboxCheckLines({ used: [repomix], findings: [{ id: 'repomix', name: 'Repomix', problem: 'missing', fallback: repomix.fallback }] }));
  assert.match(lines[0], /1 of the 1 tool\(s\) this project uses is not ready here\. None is required\./);
  assert.ok(lines.some((l) => l.includes(`npm: ${repomix.install[0].command}`)), 'the install command is printed, not run');
  assert.match(lines.at(-1), /without it: /);
});

test('E85: the offer never fails the command it is part of — a check that throws is said, and the answer is empty', () => {
  const { T, p } = product();
  try {
    const res = offerToolbox(p, p, { items: [], has: () => { throw new Error('PATH unreadable'); } });
    assert.deepEqual(res, { used: [], findings: [], problems: [], error: 'could not check' });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E85: `yad setup` offers the tools in use after the tools step — a connector chosen there counts — and writes no toolbox.json', () => {
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-e85-')));
  const p = path.join(T, 'p');
  const home = path.join(T, 'h');
  fs.mkdirSync(p, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_UPDATE_NOTIFIER: '1' };
    const run = (args) => spawnSync(process.execPath, [YAD, ...args], { cwd: p, encoding: 'utf8', env });
    // --tools with no answers takes each tool step's default: Figma, Playwright, DeepTutor.
    const r = run(['setup', '--solo', '--greenfield', '--monorepo', '--tools', '--ide-targets', '.claude', '--json']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    for (const id of ['repomix', 'spec-kit', 'impeccable', 'figma', 'playwright', 'deeptutor']) assert.ok(out.toolbox.used.includes(id), id);
    assert.ok(out.toolbox.findings.some((f) => f.id === 'playwright' && f.problem === 'missing'), 'an empty home folder has no Playwright');
    assert.ok(!fs.existsSync(path.join(p, '.sdlc/toolbox.json')), 'offering writes no choice');

    const human = run(['setup', '--solo', '--greenfield', '--monorepo', '--ide-targets', '.claude']);
    assert.equal(human.status, 0, human.stdout + human.stderr);
    assert.match(human.stdout, /\[9\/10\] Toolbox \(external tools this project uses\)[\s\S]*– Playwright MCP: not found[\s\S]*nothing is installed for you[\s\S]*\[10\/10\] Done/);

    // `yad check` and `yad update` end with the same section, exit 0 with tools missing, and write no choice.
    for (const verb of ['check', 'update']) {
      const j = run([verb, '--json']);
      assert.equal(j.status, 0, verb + j.stdout + j.stderr);
      const a = JSON.parse(j.stdout);
      assert.ok(a.toolbox.used.includes('playwright') && a.toolbox.findings.length > 0, verb);
      const h = run([verb]);
      assert.match(h.stdout, /\nToolbox\n[\s\S]*– Playwright MCP: not found/, verb);
    }
    assert.ok(!fs.existsSync(path.join(p, '.sdlc/toolbox.json')));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
