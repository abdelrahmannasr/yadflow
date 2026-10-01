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
  for (const section of ['design', 'testing', 'learning']) {
    const block = yaml.slice(yaml.search(new RegExp(`^${section}:`, 'm')));
    const tools = block.match(/^\s+tools:\s*\[([^\]]*)\]/m)[1].split(',').map((x) => x.trim());
    const degrade = block.match(/^\s+degrade:\s*([\w-]+)/m)[1];
    for (const id of tools) {
      const t = TOOLBOX.find((x) => x.id === id);
      assert.ok(t, `${section}: ${id} is in the toolbox`);
      assert.equal(t.tier, 'connector', id);
      assert.ok(t.fallback.startsWith(degrade), `${id}: the fallback is config.yaml's "${degrade}"`);
    }
  }
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
  assert.ok(toolProblems(null).length > 5, 'nothing at all is many problems, not a crash');
});

test('E84: versions and ranges', () => {
  assert.deepEqual(parseVersion('v1.2'), { parts: [1, 2, 0], pre: false });
  assert.deepEqual(parseVersion('3.7.1-beta.2+build'), { parts: [3, 7, 1], pre: true });
  assert.equal(parseVersion('aa5654b7acb7'), null, 'a git sha is not a version');
  assert.equal(parseVersion(null), null);
  assert.equal(parseRange('latest'), null);
  const cases = [
    ['3.7.1', '>=3.0.0 <4.0.0', true], ['4.0.0', '>=3.0.0 <4.0.0', false], ['2.9.9', '>=3.0.0', false],
    ['4.0.0-beta', '^3.2', false], ['3.9.9', '^3.2', true], ['3.1.0', '^3.2', false],
    ['0.2.5', '^0.2.1', true], ['0.3.0', '^0.2.1', false],
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
    const env = { PATH: [path.join(T, 'none'), path.join(T, 'a')].join(':') };
    assert.equal(onPath('tool', { env, platform: 'linux' }), true);
    assert.equal(onPath('missing', { env, platform: 'linux' }), false);
    assert.equal(onPath('dir', { env, platform: 'linux' }), false, 'a folder is not a program');
    if (process.platform !== 'win32') assert.equal(onPath('plain', { env, platform: 'linux' }), false, 'a file that cannot run is not a program');
    // Windows: a program is its name plus a PATHEXT ending.
    put(path.join(T, 'w/maestro.CMD'), '@echo off');
    const winEnv = { Path: path.join(T, 'w'), PATHEXT: '.EXE;.CMD' };
    assert.equal(onPath('maestro', { env: winEnv, platform: 'win32' }), true);
    assert.equal(onPath('maestro', { env: { ...winEnv, PATHEXT: '.EXE' }, platform: 'win32' }), false);
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
  assert.equal(toolStatus(tool({ mcp: ['pencil'] }), [item('mcp', 'pencil', '~/.claude.json')], { has: none }).state, 'installed');
  assert.equal(toolStatus(tool({ mcp: ['pencil'] }), [item('skill', 'pencil', 'x')], { has: none }).state, 'missing', 'the kind must match');
  assert.deepEqual(toolStatus(tool({ bins: ['deeptutor'] }), [], { has: (b) => b === 'deeptutor' }), { state: 'installed', found: ['deeptutor on PATH'], version: null, inRange: null });
  assert.deepEqual(toolStatus(tool({ npx: true }), [], { has: (b) => b === 'npx' }), { state: 'available', found: ['npx on PATH'], version: null, inRange: null });
  assert.equal(toolStatus(tool({ npx: true }), [], { has: none }).state, 'missing');
  const old = toolStatus(tool({ skills: ['impeccable'] }, '>=4.0.0'), [item('skill', 'impeccable', 'x', '3.7.1')], { has: none });
  assert.deepEqual([old.state, old.version, old.inRange], ['installed', '3.7.1', false], 'out of range: still installed');
  assert.equal(toolStatus(tool({ skills: ['impeccable'] }, '>=4.0.0'), [item('skill', 'impeccable', 'x', 'aa5654b7acb7')], { has: none }).inRange, null);
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

test('E84: `yad toolbox list` answers in the E1 envelope, writes nothing, and refuses what E86 will add', () => {
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

    for (const [args, re] of [[['toolbox', 'add', 'x'], /not built yet \(E86\)/], [['toolbox', 'check'], /not built yet \(E86\)/], [['toolbox', 'frob'], /unknown toolbox action: frob/], [['toolbox', 'list', 'extra'], /takes no more words/]]) {
      const bad = yad(args, { cwd: proj, home });
      assert.equal(bad.status, 1, args.join(' '));
      assert.match(bad.stdout, re);
    }
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
