// `yad detect` — which skills, agents, MCP servers and plugins are installed for the agents that could
// run a step here (E50).
//
//   yad detect [--json] [--dir <folder>]
//
// Worked out fresh on every run and never saved: nothing reads it yet except a person, and a saved copy
// would be a new file shape that goes stale the moment someone installs a skill. `yad skill list` /
// `yad skill bind` (E51, "is this skill installed here?") and E85 (the toolbox check) read it too.
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
  { scope: 'project', file: '.gemini/settings.json', agents: ['Gemini CLI'], comments: true },
  { scope: 'user', file: '.gemini/settings.json', agents: ['Gemini CLI'], comments: true },
];

// Codex's config: MCP servers and plugins are TOML tables.
const CODEX_CONFIG_PLACES = [
  { scope: 'project', file: '.codex/config.toml' },
  { scope: 'user', file: '.codex/config.toml' },
];

// The two reasons a JSON file is a problem. "Could not be read" covers a file that does not parse and one
// too big to read — the same answer for the same cause, whichever file it is.
const NOT_JSON = 'could not be read as a JSON object';
const NOT_SERVERS = '`mcpServers` is not an object';

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
function jsonOf(file, { comments = false } = {}) {
  if (!statOf(file)) return undefined;
  const bytes = bytesOf(file, MAX_CONFIG_BYTES);
  if (!bytes) return null;
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  try { return JSON.parse(comments ? stripJsonComments(text) : text); } catch { return null; }
}

// `//` and `/* */` comments removed, strings left alone — for a file its agent reads that way (Gemini CLI
// strips comments from settings.json before parsing it). Not for the others: a comment there stops the
// agent from loading the file, so reading past it would report servers the agent never sees.
export function stripJsonComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      out += ' ';
    } else out += ch;
  }
  return out;
}

// The same content hashes the same on every machine: CRLF counts as LF, as `contentSha` in lib.mjs does
// (E113). Git on Windows checks a committed SKILL.md out with CRLF, and E55 will compare these hashes
// across machines. A file with no CR hashes exactly as its bytes do.
const sha256 = (bytes) => {
  const text = bytes.includes(13) ? Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : bytes;
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
};
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// A name or version comes from a file anyone could have written: no control character reaches the
// terminal, where one could move the cursor or recolour what follows, and no character that reorders or
// breaks a line (the bidirectional marks, overrides and isolates, the line and paragraph separators), and
// no zero-width character (a name made only of them would print as nothing). This is for the TERMINAL:
// `--json` escapes only U+0000–001F and hands the rest to a program unchanged.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
export const clean = (v) => String(v).replace(UNSAFE, '?');

// ---- the three file formats -------------------------------------------------------------------------

// The two frontmatter keys this needs: `name`, and `version` — at the top, or nested one level under
// `metadata:` (the Agent Skills spec puts it there). A small reader on purpose: a YAML library is a
// dependency for two keys, and a value this cannot read is simply reported as missing.
export function skillMeta(text) {
  const m = String(text).replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  let inMetadata = false;
  let childIndent = null; // the indent of `metadata:`'s own keys; a deeper `version:` is not its version
  for (const line of m[1].split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (top) {
      inMetadata = top[1] === 'metadata' && scalar(top[2]) === '';
      childIndent = null;
      if ((top[1] === 'name' || top[1] === 'version') && printable(scalar(top[2]))) out[top[1]] = scalar(top[2]);
      continue;
    }
    const nested = inMetadata && line.match(/^(\s+)([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!nested) continue;
    childIndent ??= nested[1].length;
    if (nested[1].length === childIndent && nested[2] === 'version' && out.version === undefined && printable(scalar(nested[3]))) out.version = scalar(nested[3]);
  }
  return out;
}

// A value made only of control and invisible characters is no value: the folder name is used instead.
const printable = (v) => /\S/.test(String(v).replace(UNSAFE, ''));

// A one-line YAML value: a quoted string as written, or a plain one with a ` # comment` cut off. A value
// with a trailing comment is otherwise read AS the value (the frontmatter trap this project has hit).
function scalar(v) {
  const t = v.trim();
  // The closing quote is the FIRST one after the opening, escapes aside, so `"a" # was "b"` is `a`. A
  // double-quoted value decodes its escapes (JSON's are a subset of YAML's); a single-quoted one has only
  // one, `''` for a quote.
  // YAML escapes JSON lacks (`\x41`, `\e`, `\0`) make the parse fail, and the value is then shown as
  // written — a display matter only.
  const dq = t.match(/^"((?:[^"\\]|\\.)*)"\s*(#.*)?$/);
  if (dq) { try { return JSON.parse(`"${dq[1]}"`); } catch { return dq[1]; } }
  const sq = t.match(/^'((?:[^']|'')*)'\s*(#.*)?$/);
  if (sq) return sq[1].replace(/''/g, "'");
  return t.replace(/(^|\s)#.*$/, '').trim();
}

// ---- TOML: keys only --------------------------------------------------------------------------------
//
// Codex keeps MCP servers and plugins as TOML tables, and its agents as TOML files. This reads KEYS, and
// the one string value `name`, and skips every other value WHOLE — a multi-line array, a `"""` string,
// an inline table — so text inside a value can never be taken for a key. That matters because the values
// under `[mcp_servers.<name>]` are commands, arguments and environment variables, and they hold tokens:
// a line-by-line reader once listed `"sk-live-…"`, an element of a multi-line `args` array, as a server.
// A statement this cannot follow is dropped up to the end of its line; nothing from it is kept.

// The file as tokens: strings, bare words, punctuation and line breaks. Comments are dropped. A
// multi-line string is only ever a value, so its text is never kept (`v: null`).
function tomlTokens(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const out = [];
  let i = 0;
  // A basic string's escapes, as TOML defines them (JSON has no `\U` or `\e`). An escape TOML does not
  // define is kept as written.
  const ESC = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
  const decode = (raw) => raw.replace(/\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)/g, (all, e) => {
    if (e.length > 1) { const cp = parseInt(e.slice(1), 16); return cp <= 0x10ffff ? String.fromCodePoint(cp) : all; }
    return Object.hasOwn(ESC, e) ? ESC[e] : all;
  });
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') { out.push({ t: 'nl' }); i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
    if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    const triple = src.slice(i, i + 3);
    if (triple === '"""' || triple === "'''") {
      let j = i + 3;
      for (;;) {
        const at = src.indexOf(triple, j);
        if (at < 0) { j = src.length; break; }
        // In a basic string `\"""` is an escaped quote, unless the backslash is itself escaped.
        let slashes = 0;
        while (triple === '"""' && src[at - 1 - slashes] === '\\') slashes++;
        if (slashes % 2 === 1) { j = at + 1; continue; }
        // Up to two quotes may sit right before the closing three: the string ends at the last three.
        j = at + 3;
        while (src[j] === triple[0] && j - at < 5) j++;
        break;
      }
      out.push({ t: 'str', v: null });
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch && src[j] !== '\n') j += ch === '"' && src[j] === '\\' ? 2 : 1;
      const raw = src.slice(i + 1, Math.min(j, src.length));
      out.push({ t: 'str', v: ch === '"' ? decode(raw) : raw });
      i = src[j] === ch ? j + 1 : j;
      continue;
    }
    if ('[]{}=.,'.includes(ch)) { out.push({ t: ch }); i++; continue; }
    let j = i;
    while (j < src.length && !' \t\r\n#[]{}=.,"\''.includes(src[j])) j++;
    out.push({ t: 'word', v: src.slice(i, j) });
    i = j;
  }
  return out;
}

// Every statement of the file: a table header (`header: true`), or a `key = value` with its FULL path
// (the header's path, then the key's own). For a value, only two things are kept: a single-line string
// (`str`, for the one caller that wants `name`) and the first-level keys of an inline table.
function tomlEntries(text) {
  const tk = tomlTokens(text);
  const entries = [];
  let i = 0;
  let table = [];
  const isKey = (x) => !!x && (x.t === 'word' || (x.t === 'str' && x.v !== null));
  const toLineEnd = () => { while (i < tk.length && tk[i].t !== 'nl') i++; };
  const keyPath = () => {
    const parts = [];
    while (isKey(tk[i])) {
      parts.push(tk[i].v);
      i++;
      if (tk[i]?.t === '.') i++; else break;
    }
    return parts;
  };
  // Steps over one value, and returns the first-level keys when it is an inline table.
  const value = (depth = 0) => {
    const x = tk[i];
    if (!x || depth > 64) { toLineEnd(); return null; }
    if (x.t === '{') {
      i++;
      const keys = [];
      while (i < tk.length && tk[i].t !== '}') {
        if (tk[i].t === ',' || tk[i].t === 'nl') { i++; continue; }
        const k = keyPath();
        if (!k.length || tk[i]?.t !== '=') { i++; continue; }
        i++;
        keys.push(k[0]);
        value(depth + 1);
      }
      i++;
      return keys;
    }
    if (x.t === '[') {
      i++;
      while (i < tk.length && tk[i].t !== ']') {
        if (tk[i].t === ',' || tk[i].t === 'nl') { i++; continue; }
        const before = i;
        value(depth + 1);
        if (i === before) i++;
      }
      i++;
      return null;
    }
    if (x.t === 'str') { i++; return null; }
    // A bare scalar — a number, a date, `true` — may hold dots: step over words and dots together.
    while (i < tk.length && (tk[i].t === 'word' || tk[i].t === '.')) i++;
    return null;
  };
  while (i < tk.length) {
    if (tk[i].t === 'nl') { i++; continue; }
    if (tk[i].t === '[') {
      i += tk[i + 1]?.t === '[' ? 2 : 1;
      table = keyPath();
      toLineEnd();
      entries.push({ path: table, header: true });
      continue;
    }
    const k = keyPath();
    if (!k.length || tk[i]?.t !== '=') { toLineEnd(); continue; }
    i++;
    const str = tk[i]?.t === 'str' ? tk[i].v : null;
    const inlineKeys = value();
    entries.push({ path: [...table, ...k], str, inlineKeys });
    toLineEnd();
  }
  return entries;
}

// A Codex agent file's top-level `name = "…"` (before any table header).
export function tomlAgentName(text) {
  for (const e of tomlEntries(text)) {
    if (e.header) return null;
    if (e.path.length === 1 && e.path[0] === 'name') return typeof e.str === 'string' && e.str ? e.str : null;
  }
  return null;
}

// The names under a TOML table (`mcp_servers`, `plugins`), from any of the ways TOML can write them:
//   [mcp_servers.docs]   [mcp_servers.docs.env]   [mcp_servers] + docs = { … } / docs.command = …
//   mcp_servers.docs.command = …   mcp_servers = { docs = { … } }
export function tomlTableNames(text, table) {
  const names = new Set();
  for (const e of tomlEntries(text)) {
    if (e.path[0] !== table) continue;
    if (e.path.length >= 2) names.add(e.path[1]);
    else if (Array.isArray(e.inlineKeys)) for (const k of e.inlineKeys) names.add(k);
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
  // One line per file and reason: run in the home folder, a file is both the folder's and the user's.
  const problem = (scope, rel, why) => {
    const where = shownPath(scope, rel);
    if (!problems.some((p) => p.where === where && p.problem === why)) problems.push({ where, problem: why });
  };
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
    const doc = jsonOf(path.join(baseOf(place.scope, root, home), place.file), { comments: !!place.comments });
    if (doc === undefined) continue;
    if (!isPlainObject(doc)) { problem(place.scope, place.file, NOT_JSON); continue; }
    if (doc.mcpServers === undefined) continue;
    if (!isPlainObject(doc.mcpServers)) { problem(place.scope, place.file, NOT_SERVERS); continue; }
    items.push(...mcpItems(doc.mcpServers, { scope: place.scope, where: shownPath(place.scope, place.file), agents: place.agents }));
  }

  // Claude Code's own file in the home folder: user-scope servers at the top, and this project's
  // local-scope servers under `projects[<absolute path>]`.
  if (home) {
    const doc = jsonOf(path.join(home, CLAUDE_USER_CONFIG));
    if (doc === null || (doc !== undefined && !isPlainObject(doc))) problem('user', CLAUDE_USER_CONFIG, NOT_JSON);
    else if (doc) {
      if (isPlainObject(doc.mcpServers)) items.push(...mcpItems(doc.mcpServers, { scope: 'user', where: shownPath('user', CLAUDE_USER_CONFIG), agents: ['Claude Code'] }));
      else if (doc.mcpServers !== undefined) problem('user', CLAUDE_USER_CONFIG, NOT_SERVERS);
      // Keyed by the folder's absolute path as Claude Code wrote it: the exact spelling first, then any key
      // that is the same folder by another spelling (a link, or letter case on Windows and macOS).
      const projects = isPlainObject(doc.projects) ? doc.projects : {};
      // Only an entry that is an object counts: a stray value under the exact spelling must not hide the
      // real entry under another one.
      const usable = (k) => isPlainObject(projects[k]);
      const exact = path.resolve(root);
      const key = Object.hasOwn(projects, exact) && usable(exact) ? exact : Object.keys(projects).find((k) => usable(k) && samePath(k, root));
      const mine = key === undefined ? null : projects[key];
      // `user`, not `project`: these live in YOUR home folder and a teammate who clones gets none of them.
      if (isPlainObject(mine?.mcpServers)) items.push(...mcpItems(mine.mcpServers, { scope: 'user', where: `${shownPath('user', CLAUDE_USER_CONFIG)} (this folder)`, agents: ['Claude Code'] }));
      else if (isPlainObject(mine) && mine.mcpServers !== undefined) problem('user', `${CLAUDE_USER_CONFIG} (this folder)`, NOT_SERVERS);
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
  // On or off, as Claude Code decides it: `.claude/settings.local.json` over `.claude/settings.json` in the
  // folder, over `~/.claude/settings.json`. null when none of the three says. A file that is there and
  // cannot be read is a problem: the answer then falls through to the next file, and that must be visible.
  // Run in the home folder, the folder's `.claude/settings.json` IS the home one: read it once.
  const inHome = path.resolve(root) === path.resolve(home) || samePath(root, home);
  const enabledIn = [['project', '.claude/settings.local.json'], ['project', '.claude/settings.json'], ...(inHome ? [] : [['user', CLAUDE_USER_SETTINGS]])]
    .map(([scope, rel]) => {
      const d = jsonOf(path.join(scope === 'user' ? home : root, rel));
      if (d === null || (d !== undefined && !isPlainObject(d))) problem(scope, rel, NOT_JSON);
      return isPlainObject(d?.enabledPlugins) ? d.enabledPlugins : null;
    });
  const enabledOf = (id) => {
    for (const m of enabledIn) if (m && Object.hasOwn(m, id) && typeof m[id] === 'boolean') return m[id];
    return null;
  };
  for (const id of Object.keys(doc.plugins).sort()) {
    const installs = Array.isArray(doc.plugins[id]) ? doc.plugins[id] : [];
    for (const inst of installs) {
      if (!isPlainObject(inst)) continue;
      if (typeof inst.projectPath === 'string' && !samePath(inst.projectPath, root)) continue;
      // Claude Code's `project` scope is recorded in the folder's own `.claude/settings.json`, so a teammate
      // gets it; `user` and `local` are this person's alone.
      const scope = inst.scope === 'project' ? 'project' : 'user';
      const version = typeof inst.version === 'string' ? inst.version : null;
      items.push({
        kind: 'plugin', name: id, scope, where: shownPath('user', CLAUDE_PLUGINS), agents: ['Claude Code'], version,
        commit: typeof inst.gitCommitSha === 'string' ? inst.gitCommitSha : null,
        // null when the settings file does not say: an absent entry is not proof it is off.
        enabled: enabledOf(id),
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
  const bad = (rel, why = NOT_JSON) => problem('user', `.claude/plugins (${id}: ${rel})`, why);
  // `optional`: the default `.mcp.json` a plugin need not have. A file the plugin NAMES must be there.
  const fromFile = (rel, { optional = false } = {}) => {
    const full = path.resolve(at, rel);
    // The plugin's own files only. `path.relative` across two Windows drives is an absolute path with no
    // `..` in it, so that is refused too; a name that merely starts with `..` (`..x.json`) is not.
    const r = path.relative(at, full);
    // Named by the manifest, never by the path it gave: that path may be absolute and name the machine.
    if (!r) { bad('.claude-plugin/plugin.json', 'names the plugin folder, not an MCP file'); return; }
    if (r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) { bad('.claude-plugin/plugin.json', 'names an MCP file outside the plugin'); return; }
    const doc = jsonOf(full);
    if (doc === undefined) { if (!optional) bad('.claude-plugin/plugin.json', 'names an MCP file that is not there'); return; }
    if (!isPlainObject(doc)) { bad(r.split(path.sep).join('/')); return; }
    // `.mcp.json` wraps the servers in `mcpServers`; a file plugin.json points at may list them bare. A
    // `mcpServers` that is not an object is a problem, as it is in `.cursor/mcp.json` — reading the whole
    // file as the list instead would name its other keys (`$schema`, `mcpServers`) as servers.
    const shown = r.split(path.sep).join('/');
    if (!Object.hasOwn(doc, 'mcpServers')) add(doc, shown);
    else if (isPlainObject(doc.mcpServers)) add(doc.mcpServers, shown);
    else bad(shown, NOT_SERVERS);
  };
  const manifest = jsonOf(path.join(at, '.claude-plugin', 'plugin.json'));
  if (manifest === null || (manifest !== undefined && !isPlainObject(manifest))) bad('.claude-plugin/plugin.json');
  const declared = isPlainObject(manifest) ? manifest.mcpServers : undefined;
  // `mcpServers` may be the servers, the path of a file holding them, or a list of either. Anything else
  // is a problem, as a `mcpServers` that is not an object is everywhere else.
  const one = (d) => {
    if (isPlainObject(d)) add(d, '.claude-plugin/plugin.json');
    else if (typeof d === 'string') fromFile(d);
    else bad('.claude-plugin/plugin.json', NOT_SERVERS);
  };
  if (declared === undefined) fromFile('.mcp.json', { optional: true });
  else if (Array.isArray(declared)) declared.forEach(one);
  else one(declared);
  return found;
}

// ---- the command ------------------------------------------------------------------------------------

// How many names one place shows before "… and N more". `--json` always lists every item.
const NAMES_SHOWN = 8;

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
      const agents = it.agents.join(', ');
      const key = JSON.stringify([place, it.scope, agents]);
      if (!groups.has(key)) groups.set(key, { place, scope: it.scope, agents, list: [] });
      groups.get(key).list.push(it);
    }
    for (const { place, scope, agents, list } of groups.values()) {
      log(`  ${c.cyan(clean(place))} ${c.dim(`[${scope}] — ${list.length} — read by ${agents}`)}`);
      const label = (it) => (it.version ? `${clean(it.name)} ${c.dim(clean(it.version))}` : clean(it.name)) + (it.enabled === false ? c.dim(' (disabled)') : '');
      const shown = list.slice(0, NAMES_SHOWN).map(label).join(', ');
      log(`    ${shown}${list.length > NAMES_SHOWN ? c.dim(` … and ${list.length - NAMES_SHOWN} more`) : ''}`);
    }
  }
  const dupes = duplicateNames(items.filter((i) => i.kind === 'skill'));
  if (dupes.length) info(`${dupes.length} skill name(s) are installed in more than one place (${dupes.slice(0, 5).map(clean).join(', ')}${dupes.length > 5 ? ', …' : ''}) — which copy an agent loads is that agent's rule`);
  if (items.length) info('`yad detect --json` lists every item, with its version and content hash');
  for (const p of problems) log(`  ${c.yellow('!')} ${clean(p.where)}: ${p.problem}`);
  return undefined;
}

function duplicateNames(skills) {
  const seen = new Map();
  for (const s of skills) seen.set(s.name, (seen.get(s.name) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([name]) => name).sort();
}
