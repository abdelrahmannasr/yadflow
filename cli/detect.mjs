// `yad detect` — which skills, agents, MCP servers and plugins are installed for the agents that could
// run a step here (E50).
//
//   yad detect [--json] [--dir <folder>]
//
// Worked out fresh on every run and never saved: nothing reads it yet except a person, and a saved copy
// would be a new file shape that goes stale the moment someone installs a skill. E51 (bind per profile)
// and E85 (the toolbox check) are the readers this is built for.
//
// TWO PLACES ARE LOOKED IN: the folder the command runs on (what a teammate who clones it also gets), and
// the user's home folder (where most people install skills). Every item says which one, and which agents
// read the place it came from.
//
// IT ONLY READS. No file is written, no directory is made, no network is used, no program is run. The
// E11 lesson is the reason this is stated: a detector that took a folder's existence as consent once
// enrolled projects into installs nobody asked for. Here a found item is only ever REPORTED.
//
// MCP SERVERS ARE NAMED, NEVER DESCRIBED. Their entries carry a command, arguments, a URL, headers and
// environment variables — the last three often hold a token. Only the key a server is listed under is
// read out; nothing else from the entry is ever copied into an item, a problem or an error.
//
// WHERE EACH AGENT LOOKS, checked against each agent's own documentation on 2026-09-30, NOT from memory
// (the project folders repeat the E11 table in manifest.mjs, checked 2026-09-16). Re-check before adding
// one: a guessed place reports skills that no agent ever loads.
//
//   Claude Code  skills .claude/skills, ~/.claude/skills, plugin skills/; agents .claude/agents,
//                ~/.claude/agents, plugin agents/; MCP .mcp.json, ~/.claude.json (user + this project),
//                plugin .mcp.json / plugin.json; plugins ~/.claude/plugins/installed_plugins.json
//   Codex CLI    skills .agents/skills, ~/.agents/skills; agents .codex/agents/*.toml,
//                ~/.codex/agents/*.toml; MCP [mcp_servers.<name>] in .codex/config.toml,
//                ~/.codex/config.toml; plugins [plugins."<name>"] in the same files
//   Cursor       skills .agents .cursor .claude .codex /skills, both in the project and in ~;
//                agents .cursor/agents, ~/.cursor/agents; MCP .cursor/mcp.json, ~/.cursor/mcp.json
//   Gemini CLI   skills .gemini/skills and .agents/skills, both places; agents .gemini/agents,
//                ~/.gemini/agents; MCP mcpServers in .gemini/settings.json, ~/.gemini/settings.json
//   Copilot, Zencoder, opencode  the project skill folders yad installs into (manifest.mjs IDE_AGENTS)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { c, emitJSON, info, log, samePath } from './lib.mjs';
import { IDE_AGENTS, IDE_OPENCODE_DIR } from './manifest.mjs';

// A SKILL.md or agent file bigger than this is not hashed or parsed — no real one comes near it, and a
// huge file in a skills folder is not something to read into memory on every run.
const MAX_FILE_BYTES = 1024 * 1024;
// Config files are allowed more: Claude Code's `~/.claude.json` keeps per-project history and grows.
const MAX_CONFIG_BYTES = 64 * 1024 * 1024;

// Skill folders: `<place>/<skill>/SKILL.md`. The project list is the installer's own table, so the two
// cannot drift; Cursor's `.codex/skills` compatibility folder is added (Codex itself does not read it).
const SKILL_PLACES = [
  ...['.claude', '.agents', '.cursor', '.gemini', '.zencoder'].map((d) => ({ scope: 'project', dir: `${d}/skills`, agents: IDE_AGENTS[d] })),
  { scope: 'project', dir: '.codex/skills', agents: ['Cursor'] },
  { scope: 'user', dir: '.claude/skills', agents: ['Claude Code', 'Cursor'] },
  { scope: 'user', dir: '.agents/skills', agents: ['Codex CLI', 'Gemini CLI', 'Cursor'] },
  { scope: 'user', dir: '.cursor/skills', agents: ['Cursor'] },
  { scope: 'user', dir: '.gemini/skills', agents: ['Gemini CLI'] },
  { scope: 'user', dir: '.codex/skills', agents: ['Cursor'] },
];

// Agent (subagent) definitions: one file each. Codex writes TOML; the others Markdown with frontmatter.
const AGENT_PLACES = [
  { scope: 'project', dir: '.claude/agents', ext: '.md', agents: ['Claude Code'] },
  { scope: 'user', dir: '.claude/agents', ext: '.md', agents: ['Claude Code'] },
  { scope: 'project', dir: '.cursor/agents', ext: '.md', agents: ['Cursor'] },
  { scope: 'user', dir: '.cursor/agents', ext: '.md', agents: ['Cursor'] },
  { scope: 'project', dir: '.gemini/agents', ext: '.md', agents: ['Gemini CLI'] },
  { scope: 'user', dir: '.gemini/agents', ext: '.md', agents: ['Gemini CLI'] },
  { scope: 'project', dir: '.codex/agents', ext: '.toml', agents: ['Codex CLI'] },
  { scope: 'user', dir: '.codex/agents', ext: '.toml', agents: ['Codex CLI'] },
];

// JSON files that list MCP servers under a `mcpServers` object.
const MCP_JSON_PLACES = [
  { scope: 'project', file: '.mcp.json', agents: ['Claude Code'] },
  { scope: 'project', file: '.cursor/mcp.json', agents: ['Cursor'] },
  { scope: 'user', file: '.cursor/mcp.json', agents: ['Cursor'] },
  { scope: 'project', file: '.gemini/settings.json', agents: ['Gemini CLI'] },
  { scope: 'user', file: '.gemini/settings.json', agents: ['Gemini CLI'] },
];

// Codex's config: MCP servers and plugins are TOML tables.
const CODEX_CONFIG_PLACES = [
  { scope: 'project', file: '.codex/config.toml' },
  { scope: 'user', file: '.codex/config.toml' },
];

const CLAUDE_USER_CONFIG = '.claude.json';
const CLAUDE_PLUGINS = '.claude/plugins/installed_plugins.json';
const CLAUDE_USER_SETTINGS = '.claude/settings.json';

// ---- reading, without ever failing ------------------------------------------------------------------

// `stat`, following a link (skill managers install skills as links into `~/.agents/skills`), or null.
const statOf = (p) => { try { return fs.statSync(p); } catch { return null; } };
const isDir = (p) => !!statOf(p)?.isDirectory();

// The entries of a folder, sorted so two runs print the same thing; [] when there is no folder.
function entriesOf(dir) {
  try { return fs.readdirSync(dir).sort(); } catch { return []; }
}

// A file's bytes, or null when it is missing, not a file, too big or unreadable.
function bytesOf(file, max = MAX_FILE_BYTES) {
  const st = statOf(file);
  if (!st?.isFile() || st.size > max) return null;
  try { return fs.readFileSync(file); } catch { return null; }
}

// Parsed JSON, `undefined` when the file is not there, and `null` when it is there but does not parse
// (or is too big to read) — the caller reports that as a problem rather than as "no servers".
function jsonOf(file) {
  if (!statOf(file)) return undefined;
  const bytes = bytesOf(file, MAX_CONFIG_BYTES);
  if (!bytes) return null;
  try { return JSON.parse(bytes.toString('utf8')); } catch { return null; }
}

const sha256 = (bytes) => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- the three file formats -------------------------------------------------------------------------

const unquote = (v) => {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) && t.length >= 2 ? t.slice(1, -1) : t;
};

// The two frontmatter keys this needs: `name`, and `version` — at the top, or nested one level under
// `metadata:` (the Agent Skills spec puts it there). A small reader on purpose: a YAML library is a
// dependency for two keys, and a value this cannot read is simply reported as missing.
export function skillMeta(text) {
  const m = String(text).replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  let inMetadata = false;
  for (const line of m[1].split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (top) {
      inMetadata = top[1] === 'metadata' && top[2].trim() === '';
      if ((top[1] === 'name' || top[1] === 'version') && top[2].trim()) out[top[1]] = unquote(top[2]);
      continue;
    }
    const nested = inMetadata && line.match(/^\s+version:\s*(.+)$/);
    if (nested && out.version === undefined) out.version = unquote(nested[1]);
  }
  return out;
}

// A Codex agent file's top-level `name = "…"` (before any table header).
export function tomlAgentName(text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) return null;
    const m = line.match(/^\s*name\s*=\s*("([^"\\]*)"|'([^']*)')\s*(#.*)?$/);
    if (m) return m[2] ?? m[3];
  }
  return null;
}

// One key of a dotted TOML path: bare, "double" or 'single' quoted. Returns [key, rest] or null.
function tomlKey(s) {
  const t = s.trimStart();
  const m = t.match(/^(?:([A-Za-z0-9_-]+)|"((?:[^"\\]|\\.)*)"|'([^']*)')/);
  if (!m) return null;
  return [m[1] ?? m[2] ?? m[3], t.slice(m[0].length).trimStart()];
}

// The names under a TOML table (`mcp_servers`, `plugins`), from any of the ways TOML can write them:
//   [mcp_servers.docs]        [mcp_servers.docs.env]        [mcp_servers] + docs = { … } / docs.command = …
// Only KEYS are read. A line inside a multi-line string could look like a header; for a list of names
// that is acceptable, and it never exposes a value.
export function tomlTableNames(text, table) {
  const names = new Set();
  let current = null; // the header path of the table the lines below belong to
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      const inner = line.replace(/^\[\[?/, '');
      const path_ = [];
      let rest = inner;
      for (let k = tomlKey(rest); k; k = tomlKey(rest)) {
        path_.push(k[0]);
        rest = k[1];
        if (rest.startsWith('.')) rest = rest.slice(1); else break;
      }
      current = path_;
      if (path_[0] === table && path_.length >= 2) names.add(path_[1]);
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    // A key under the bare `[table]` header, or a dotted `table.name…` key at the top level.
    const k = tomlKey(line);
    if (!k) continue;
    if (current?.length === 1 && current[0] === table) names.add(k[0]);
    else if (current === null && k[0] === table && k[1].startsWith('.')) {
      const sub = tomlKey(k[1].slice(1));
      if (sub) names.add(sub[0]);
    }
  }
  return [...names].sort();
}

// ---- what is found ----------------------------------------------------------------------------------

// How a place is shown: relative to the folder for the project, `~/…` for the home folder. Never the
// home folder's absolute path — it names the machine's user, and this output is pasted into issues.
const shownPath = (scope, rel) => (scope === 'user' ? `~/${rel}` : rel);

function skillsIn(base, place, { scope = place.scope, agents = place.agents, plugin = null, version = null } = {}) {
  const items = [];
  const dir = path.join(base, place.dir);
  for (const entry of entriesOf(dir)) {
    const folder = path.join(dir, entry);
    if (!isDir(folder)) continue;
    const bytes = bytesOf(path.join(folder, 'SKILL.md'));
    if (!bytes) continue;
    const meta = skillMeta(bytes.toString('utf8'));
    items.push({
      kind: 'skill', name: meta.name || entry, scope, where: plugin ? `${plugin}: ${place.dir}/${entry}` : shownPath(scope, `${place.dir}/${entry}`),
      agents: [...agents], version: meta.version ?? version, hash: sha256(bytes), ...(plugin ? { plugin } : {}),
    });
  }
  return items;
}

// opencode's flat copy: `.opencode/commands/<skill>.md`.
function opencodeSkills(root) {
  const items = [];
  const dir = path.join(root, IDE_OPENCODE_DIR);
  for (const entry of entriesOf(dir)) {
    if (!entry.endsWith('.md')) continue;
    const bytes = bytesOf(path.join(dir, entry));
    if (!bytes) continue;
    const meta = skillMeta(bytes.toString('utf8'));
    items.push({ kind: 'skill', name: meta.name || entry.slice(0, -3), scope: 'project', where: `${IDE_OPENCODE_DIR}/${entry}`,
      agents: [...IDE_AGENTS['.opencode']], version: meta.version ?? null, hash: sha256(bytes) });
  }
  return items;
}

function agentsIn(base, place, { scope = place.scope, agents = place.agents, plugin = null, version = null } = {}) {
  const items = [];
  const dir = path.join(base, place.dir);
  for (const entry of entriesOf(dir)) {
    if (!entry.endsWith(place.ext)) continue;
    const bytes = bytesOf(path.join(dir, entry));
    if (!bytes) continue;
    const text = bytes.toString('utf8');
    const name = place.ext === '.toml' ? tomlAgentName(text) : skillMeta(text).name;
    const meta = place.ext === '.md' ? skillMeta(text) : {};
    items.push({
      kind: 'agent', name: name || entry.slice(0, -place.ext.length), scope, where: plugin ? `${plugin}: ${place.dir}/${entry}` : shownPath(scope, `${place.dir}/${entry}`),
      agents: [...agents], version: meta.version ?? version, hash: sha256(bytes), ...(plugin ? { plugin } : {}),
    });
  }
  return items;
}

const mcpItems = (servers, { scope, where, agents, plugin = null }) => Object.keys(servers).sort()
  .map((name) => ({ kind: 'mcp', name, scope, where, agents: [...agents], ...(plugin ? { plugin } : {}) }));

// The folder the project scope reads from, and the home folder the user scope reads from.
function baseOf(scope, root, home) { return scope === 'user' ? home : root; }

// Everything installed, in a fixed order. `root` is the folder the command runs on; `home` the user's
// home folder (a parameter so a test can point it at a fixture). `problems` lists files that are there
// but could not be read — by path and reason only, never by content.
export function detectInstalled(root, { home = os.homedir() } = {}) {
  const items = [];
  const problems = [];
  const problem = (scope, rel, why) => problems.push({ where: shownPath(scope, rel), problem: why });
  // The home folder may BE the project (someone runs it in ~): the user places then repeat the project
  // places, and every item would be listed twice. The project scope wins and those user places are
  // skipped. `~/.claude.json` and the plugin list have no project twin, so they are read either way.
  const sameFolder = !!home && (path.resolve(root) === path.resolve(home) || samePath(root, home));
  const scopes = (list) => list.filter((p) => p.scope === 'project' || (home && !sameFolder));

  for (const place of SKILL_PLACES.filter((p) => p.scope === 'project')) items.push(...skillsIn(root, place));
  items.push(...opencodeSkills(root));
  for (const place of scopes(SKILL_PLACES.filter((p) => p.scope === 'user'))) items.push(...skillsIn(home, place));
  for (const place of scopes(AGENT_PLACES)) items.push(...agentsIn(baseOf(place.scope, root, home), place));

  for (const place of scopes(MCP_JSON_PLACES)) {
    const doc = jsonOf(path.join(baseOf(place.scope, root, home), place.file));
    if (doc === undefined) continue;
    if (!isPlainObject(doc)) { problem(place.scope, place.file, 'does not parse as a JSON object'); continue; }
    if (doc.mcpServers === undefined) continue;
    if (!isPlainObject(doc.mcpServers)) { problem(place.scope, place.file, '`mcpServers` is not an object'); continue; }
    items.push(...mcpItems(doc.mcpServers, { scope: place.scope, where: shownPath(place.scope, place.file), agents: place.agents }));
  }

  // Claude Code's own file in the home folder: user-scope servers at the top, and this project's
  // local-scope servers under `projects[<absolute path>]`.
  if (home) {
    const doc = jsonOf(path.join(home, CLAUDE_USER_CONFIG));
    if (doc === null || (doc !== undefined && !isPlainObject(doc))) problem('user', CLAUDE_USER_CONFIG, 'does not parse as a JSON object');
    else if (doc) {
      if (isPlainObject(doc.mcpServers)) items.push(...mcpItems(doc.mcpServers, { scope: 'user', where: shownPath('user', CLAUDE_USER_CONFIG), agents: ['Claude Code'] }));
      // Keyed by the folder's absolute path as Claude Code wrote it: the exact spelling first, then any key
      // that is the same folder by another spelling (a link, or letter case on Windows and macOS).
      const projects = isPlainObject(doc.projects) ? doc.projects : {};
      const key = Object.hasOwn(projects, path.resolve(root)) ? path.resolve(root) : Object.keys(projects).find((k) => samePath(k, root));
      const mine = key === undefined ? null : projects[key];
      if (isPlainObject(mine?.mcpServers)) items.push(...mcpItems(mine.mcpServers, { scope: 'project', where: `${shownPath('user', CLAUDE_USER_CONFIG)} (this folder)`, agents: ['Claude Code'] }));
    }
  }

  for (const place of scopes(CODEX_CONFIG_PLACES)) {
    const file = path.join(baseOf(place.scope, root, home), place.file);
    const bytes = bytesOf(file, MAX_CONFIG_BYTES);
    if (!bytes) { if (statOf(file)) problem(place.scope, place.file, 'could not be read'); continue; }
    const text = bytes.toString('utf8');
    const where = shownPath(place.scope, place.file);
    for (const name of tomlTableNames(text, 'mcp_servers')) items.push({ kind: 'mcp', name, scope: place.scope, where, agents: ['Codex CLI'] });
    for (const name of tomlTableNames(text, 'plugins')) items.push({ kind: 'plugin', name, scope: place.scope, where, agents: ['Codex CLI'], version: null });
  }

  if (home) items.push(...claudePlugins(root, home, problem));

  // Every item carries the same keys, so a reader never tests whether one exists: `version` and `hash`
  // are null where the place records none (an MCP server, a Codex plugin), `plugin` is null unless a
  // Claude Code plugin brought the item. Only a Claude Code plugin row adds `commit` and `enabled`.
  return { items: items.map((it) => ({ version: null, hash: null, plugin: null, ...it })), problems };
}

// Claude Code plugins, and the skills, agents and MCP servers each one brings. A plugin installed for
// ANOTHER project (a `projectPath` that is not this folder) is not available here and is left out.
function claudePlugins(root, home, problem) {
  const items = [];
  const doc = jsonOf(path.join(home, CLAUDE_PLUGINS));
  if (doc === undefined) return items;
  if (!isPlainObject(doc) || !isPlainObject(doc.plugins)) { problem('user', CLAUDE_PLUGINS, 'does not parse as the installed-plugins list'); return items; }
  const settings = jsonOf(path.join(home, CLAUDE_USER_SETTINGS));
  const enabledMap = isPlainObject(settings?.enabledPlugins) ? settings.enabledPlugins : null;
  for (const id of Object.keys(doc.plugins).sort()) {
    const installs = Array.isArray(doc.plugins[id]) ? doc.plugins[id] : [];
    for (const inst of installs) {
      if (!isPlainObject(inst)) continue;
      if (typeof inst.projectPath === 'string' && !samePath(inst.projectPath, root)) continue;
      const scope = inst.scope === 'user' || inst.scope === undefined ? 'user' : 'project';
      const version = typeof inst.version === 'string' ? inst.version : null;
      items.push({
        kind: 'plugin', name: id, scope, where: shownPath('user', CLAUDE_PLUGINS), agents: ['Claude Code'], version,
        commit: typeof inst.gitCommitSha === 'string' ? inst.gitCommitSha : null,
        // null when the settings file does not say: an absent entry is not proof it is off.
        enabled: enabledMap && Object.hasOwn(enabledMap, id) ? enabledMap[id] === true : null,
      });
      const at = typeof inst.installPath === 'string' ? inst.installPath : null;
      if (!at || !isDir(at)) continue;
      const from = { scope, agents: ['Claude Code'], plugin: id, version };
      items.push(...skillsIn(at, { dir: 'skills' }, from));
      items.push(...agentsIn(at, { dir: 'agents', ext: '.md' }, from));
      items.push(...pluginMcp(at, id, scope, problem));
    }
  }
  return items;
}

// A plugin's MCP servers: `.mcp.json` at its root, or `mcpServers` in `.claude-plugin/plugin.json` —
// an object, or the path of a JSON file inside the plugin.
function pluginMcp(at, id, scope, problem) {
  const found = [];
  const add = (servers, rel) => found.push(...mcpItems(servers, { scope, where: `${id}: ${rel}`, agents: ['Claude Code'], plugin: id }));
  const fromFile = (rel) => {
    const full = path.resolve(at, rel);
    if (path.relative(at, full).startsWith('..')) return; // a plugin's own files only
    const doc = jsonOf(full);
    if (doc === undefined) return;
    if (!isPlainObject(doc)) { problem('user', `.claude/plugins (${id}: ${rel})`, 'does not parse as a JSON object'); return; }
    // `.mcp.json` wraps the servers in `mcpServers`; a file plugin.json points at may list them bare.
    add(isPlainObject(doc.mcpServers) ? doc.mcpServers : doc, rel);
  };
  const manifest = jsonOf(path.join(at, '.claude-plugin', 'plugin.json'));
  if (isPlainObject(manifest?.mcpServers)) add(manifest.mcpServers, '.claude-plugin/plugin.json');
  else if (typeof manifest?.mcpServers === 'string') fromFile(manifest.mcpServers);
  else fromFile('.mcp.json');
  return found;
}

// ---- the command ------------------------------------------------------------------------------------

// How many names one place shows before "… and N more". `--json` always lists every item.
const NAMES_SHOWN = 8;

// A name or version comes from a file anyone could have written: no control character reaches the
// terminal, where one could move the cursor or recolour what follows. `--json` escapes them already.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const clean = (v) => String(v).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');

const KIND_TITLES = [['skill', 'Skills'], ['agent', 'Agents'], ['mcp', 'MCP servers'], ['plugin', 'Plugins']];

export function runDetect(root, { json = false, home = os.homedir() } = {}) {
  const { items, problems } = detectInstalled(root, { home });
  const counts = Object.fromEntries(KIND_TITLES.map(([k]) => [k, items.filter((i) => i.kind === k).length]));
  if (json) return emitJSON({ ok: true, counts, items, problems });

  log(c.bold('Installed for the agents that work in this folder'));
  info('project = inside this folder (a teammate who clones it gets it too) · user = your home folder only');
  for (const [kind, title] of KIND_TITLES) {
    const mine = items.filter((i) => i.kind === kind);
    log(`\n${c.bold(title)} (${mine.length})`);
    if (!mine.length) { info('none found'); continue; }
    // Grouped by the place they came from: a home folder holds dozens of skills, and one line per place
    // with its agents keeps the answer readable. `--json` has every item on its own.
    const groups = new Map();
    for (const it of mine) {
      const place = it.plugin ? `plugin ${it.plugin}` : kind === 'skill' || kind === 'agent' ? it.where.replace(/\/[^/]+$/, '') : it.where;
      const key = `${place}|${it.scope}|${it.agents.join(', ')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    for (const [key, list] of groups) {
      const [place, scope, agents] = key.split('|');
      log(`  ${c.cyan(clean(place))} ${c.dim(`[${scope}] — ${list.length} — read by ${agents}`)}`);
      const label = (it) => (it.version ? `${clean(it.name)} ${c.dim(clean(it.version))}` : clean(it.name)) + (it.enabled === false ? c.dim(' (disabled)') : '');
      const shown = list.slice(0, NAMES_SHOWN).map(label).join(', ');
      log(`    ${shown}${list.length > NAMES_SHOWN ? c.dim(` … and ${list.length - NAMES_SHOWN} more`) : ''}`);
    }
  }
  const dupes = duplicateNames(items.filter((i) => i.kind === 'skill'));
  if (dupes.length) info(`${dupes.length} skill name(s) are installed in more than one place (${dupes.slice(0, 5).map(clean).join(', ')}${dupes.length > 5 ? ', …' : ''}) — which copy an agent loads is that agent's rule`);
  if (items.length) info('`yad detect --json` lists every item, with its version and content hash');
  for (const p of problems) log(`  ${c.yellow('!')} ${p.where}: ${p.problem}`);
  return undefined;
}

function duplicateNames(skills) {
  const seen = new Map();
  for (const s of skills) seen.set(s.name, (seen.get(s.name) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([name]) => name).sort();
}
