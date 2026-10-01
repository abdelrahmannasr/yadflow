// The toolbox — every external tool yadflow can use, what each one is for, how it installs, and what
// yadflow does without it (E84).
//
//   yad toolbox list [--json] [--dir <folder>]
//
// THE RULE IT EXISTS FOR: no external tool is ever mandatory, and every one declares a fallback. yadflow
// degrades; it never breaks. This file is the one place that says, per tool, what "degrades" means.
//
// NOT `manifest.mjs`. That is the INSTALL manifest — the files yadflow copies into a project. This list
// is about tools yadflow does NOT ship and never installs on its own.
//
// SHIPPED, NOT A PROJECT FILE (decided with the row). The list moves with each release, like the step
// catalogue. A project-level file that adds or removes tools is E86's (`yad toolbox add / remove`); its
// shape is designed there, by its first writer.
//
// THREE TIERS:
//   core         offered at setup (E85) — repomix, spec-kit, impeccable
//   recommended  listed, never pushed — pools of skills and agents a team may choose (Part 7)
//   connector    the tools a Product connects for design, testing and learning (`yad-connect-*`); the
//                same adapters `skills/sdlc/config.yaml` names, with the same fallbacks
//
// FINDING A TOOL RUNS NOTHING. It reads `yad detect`'s answer (E50) — skills, plugins, MCP servers — and
// looks for a program on PATH by reading folders, never by starting `which`. A tool that `npx` fetches
// on demand (repomix) is "available" whenever `npx` is there.
//
// AN OLD OR NEW VERSION WARNS, IT DOES NOT DISQUALIFY (decided with the row). A tool outside its known
// range still counts as installed: a slightly older tool usually works, and quietly switching to the
// weaker fallback would be worse. A range is only set where a version is actually visible (a plugin's or
// a skill's own record) and a known-good bound exists; `versions: null` means "no bound known".
//
// EVERY INSTALL COMMAND WAS CHECKED AGAINST THE TOOL'S OWN REPOSITORY OR DOCS, on the `checked` date —
// never guessed from a package name (npm `ecc` is an unrelated crypto library, not ECC). A connector set
// up inside a desktop app has no command: its `install` is empty and `manual` links the vendor's steps.
import fs from 'node:fs';
import path from 'node:path';
import { c, emitJSON, info, log } from './lib.mjs';
import { clean, detectInstalled } from './detect.mjs';

export const INSTALL_TYPES = Object.freeze(['plugin', 'npm', 'python', 'script']);
export const TIERS = Object.freeze(['core', 'recommended', 'connector']);
const TIER_TITLES = { core: 'Core — offered at setup', recommended: 'Recommended — listed, never pushed', connector: 'Connectors — design, testing and learning tools a Product connects' };

const CHECKED = '2026-10-01';

// The list itself, checked against each tool's own repository and docs on CHECKED. `install` keeps only
// the routes the roadmap's four types describe (plugin, npm, python, script); a tool's other routes
// (Docker, Homebrew, a VS Code extension) are in its own README, which `source` links. `versions` is null
// everywhere for now: no bound has been tested yet — E88 vets each default and is where a known-good
// range is earned. `records` is the exact line a skill writes when the tool is absent, so E87 can point
// the skill at this entry without renaming anything.
export const TOOLBOX = Object.freeze([
  // ---- core: offered at setup --------------------------------------------------------------------
  {
    id: 'repomix', name: 'Repomix', tier: 'core', role: 'packs each code repo into one file the Shape steps read',
    licence: 'MIT', source: 'https://github.com/yamadashy/repomix', checked: CHECKED,
    install: [
      { type: 'npm', command: 'npx repomix@latest' },
      { type: 'npm', command: 'npm install -g repomix' },
      { type: 'plugin', command: '/plugin marketplace add yamadashy/repomix, then /plugin install repomix-mcp@repomix' },
    ],
    manual: null,
    // yad runs it through `npx repomix@latest` (setup, `yad repo refresh`), so `npx` alone makes it usable.
    detect: { npx: true, bins: ['repomix'], plugins: ['repomix-mcp', 'repomix-commands', 'repomix-explorer'], mcp: ['repomix'], skills: ['repomix-explorer'] },
    versions: null,
    fallback: 'no code pack: repos are not packed, and the Shape steps read the code map alone',
    records: null, note: null,
    usedBy: ['yad setup', 'yad repo refresh', 'yad-connect-repos'],
  },
  {
    id: 'spec-kit', name: 'Spec Kit', tier: 'core', role: 'runs the spec ceremony (specify → plan → tasks) in a code repo',
    licence: 'MIT', source: 'https://github.com/github/spec-kit', checked: CHECKED,
    install: [
      { type: 'python', command: 'uv tool install specify-cli, then specify init <project> --integration claude' },
      { type: 'python', command: 'pipx install specify-cli' },
    ],
    manual: null,
    // Claude Code gets `speckit-<command>` skills since Spec Kit 0.4.5; older installs have flat
    // `speckit.<command>.md` commands, which `yad detect` does not read — the `specify` program still shows.
    detect: { skillPrefixes: ['speckit-', 'speckit.'], bins: ['specify'] },
    versions: null,
    fallback: "yad-spec writes the same spec files by hand, in Spec Kit's layout",
    records: 'speckit: not-installed', note: 'A program named specify on PATH also counts; another tool by that name would too.',
    usedBy: ['yad-spec'],
  },
  {
    id: 'impeccable', name: 'Impeccable', tier: 'core', role: 'drives the UI design step (document, extract, craft)',
    licence: 'Apache-2.0', source: 'https://github.com/pbakaus/impeccable', checked: CHECKED,
    install: [
      { type: 'npm', command: 'npx impeccable install' },
      { type: 'plugin', command: '/plugin marketplace add pbakaus/impeccable, then /plugin install impeccable@impeccable' },
    ],
    manual: null,
    detect: { skills: ['impeccable'], plugins: ['impeccable'] },
    versions: null,
    fallback: 'Markdown-only UI design: yad-ui writes ui-design.md and DESIGN.md directly',
    records: 'impeccable: not-installed', note: null,
    usedBy: ['yad-ui'],
  },

  // ---- recommended: listed, never pushed ---------------------------------------------------------
  {
    id: 'bmad-method', name: 'BMAD-METHOD', tier: 'recommended', role: 'a pool of planning and building skills',
    // The LICENSE file is MIT text with attribution added (GitHub reads it as NOASSERTION); "BMad" is a trademark.
    licence: 'MIT', source: 'https://github.com/bmad-code-org/BMAD-METHOD', checked: CHECKED,
    install: [
      { type: 'npm', command: 'npx bmad-method install' },
      { type: 'plugin', command: '/plugin marketplace add bmad-code-org/bmad-plugins, then install bmad-method from /plugin' },
    ],
    manual: null,
    // The README names a `bmad-core-tools` plugin; the marketplace lists `bmad-toolbox`. Both are kept.
    detect: { skills: ['bmad'], skillPrefixes: ['bmad-', 'bmod-'], plugins: ['bmad-method', 'bmad-toolbox', 'bmad-core-tools'] },
    versions: null,
    fallback: "nothing changes: yadflow's own skills run every step",
    records: null, note: 'Left the engine in E3; returns only as an optional pool you bind with `yad skill bind`.',
    usedBy: ['yad skill bind'],
  },
  {
    id: 'ecc', name: 'ECC (Everything Claude Code)', tier: 'recommended', role: 'a large pool of skills, agents and hooks',
    licence: 'MIT', source: 'https://github.com/affaan-m/ECC', checked: CHECKED,
    install: [
      { type: 'npm', command: 'npx ecc-universal install --guided' },
      { type: 'plugin', command: '/plugin marketplace add https://github.com/affaan-m/ECC, then /plugin install ecc@ecc' },
      { type: 'script', command: 'git clone https://github.com/affaan-m/ECC.git && cd ECC && ./install.sh --profile minimal --target claude' },
    ],
    manual: null,
    // Its skills have no common prefix, so they cannot identify it; the plugin and the program can.
    detect: { plugins: ['ecc'], bins: ['ecc'] },
    versions: null,
    fallback: "nothing changes: yadflow's own skills run every step",
    records: null, note: 'The npm package is ecc-universal. npm `ecc` is an unrelated crypto library.',
    usedBy: ['yad skill bind'],
  },
  {
    id: 'mattpocock-skills', name: 'mattpocock/skills', tier: 'recommended', role: 'a small pool of engineering skills',
    licence: 'MIT', source: 'https://github.com/mattpocock/skills', checked: CHECKED,
    install: [{ type: 'plugin', command: 'claude plugins install mattpocock-skills' }],
    manual: null,
    // Generic names (`tdd`, `code-review`) collide with other packs; this one is its own.
    detect: { plugins: ['mattpocock-skills'], skills: ['setup-matt-pocock-skills'] },
    versions: null,
    fallback: "nothing changes: yadflow's own skills run every step",
    records: null, note: 'About 8 contributors: fine as an option, risky as a default.',
    usedBy: ['yad skill bind'],
  },

  // ---- connectors: what a Product connects (skills/sdlc/config.yaml names the same adapters) -------
  {
    id: 'figma', name: 'Figma', tier: 'connector', role: 'design tool: yad-ui generates and links screens in it',
    licence: 'proprietary', source: 'https://developers.figma.com/docs/figma-mcp-server/', checked: CHECKED,
    install: [{ type: 'plugin', command: 'claude plugin install figma@claude-plugins-official' }],
    manual: 'https://developers.figma.com/docs/figma-mcp-server/',
    detect: { plugins: ['figma'], mcp: ['figma', 'figma-desktop', 'html-to-design'] },
    versions: null,
    fallback: 'markdown-only: yad-ui writes ui-design.md and DESIGN.md only',
    records: null, note: 'Sign-in is your own (OAuth); yadflow stores no token. The desktop server is named figma-desktop.',
    usedBy: ['yad-connect-design', 'yad-ui'],
  },
  {
    id: 'pencil', name: 'Pencil (pen.dev)', tier: 'connector', role: 'design tool: yad-ui writes .pen web and mobile screens',
    licence: 'proprietary', source: 'https://docs.pencil.dev/getting-started/installation', checked: CHECKED,
    install: [],
    manual: 'https://docs.pencil.dev/getting-started/installation',
    detect: { mcp: ['pencil'] },
    versions: null,
    fallback: 'markdown-only: yad-ui writes ui-design.md and DESIGN.md only',
    records: null, note: 'Set up inside the desktop app: open a .pen file, then Settings → MCP → enable your agent.',
    usedBy: ['yad-connect-design', 'yad-ui'],
  },
  {
    id: 'playwright', name: 'Playwright MCP', tier: 'connector', role: 'testing tool: generates and runs browser and API tests',
    licence: 'Apache-2.0', source: 'https://github.com/microsoft/playwright-mcp', checked: CHECKED,
    install: [{ type: 'npm', command: 'claude mcp add playwright npx @playwright/mcp@latest' }],
    manual: null,
    detect: { mcp: ['playwright'], plugins: ['playwright'] },
    versions: null,
    fallback: 'artifacts-only: yad-test-cases writes test-cases.md only',
    records: null,
    note: 'Found by its server name only (yad never reads a server\'s settings), and an unofficial package is often registered under the same name.',
    usedBy: ['yad-connect-testing', 'yad-test-cases'],
  },
  {
    id: 'cypress', name: 'Cypress', tier: 'connector', role: 'testing tool: Cypress specs',
    licence: 'proprietary', source: 'https://docs.cypress.io/cloud/integrations/cloud-mcp', checked: CHECKED,
    install: [],
    manual: 'https://docs.cypress.io/cloud/integrations/cloud-mcp',
    detect: { mcp: ['cypress', 'cypress-cloud'] },
    versions: null,
    fallback: 'artifacts-only: yad-test-cases writes test-cases.md only',
    records: null,
    note: 'No official MCP server runs local tests. The official Cypress Cloud MCP only reads Cloud results; community servers exist but none is vetted.',
    usedBy: ['yad-connect-testing', 'yad-test-cases'],
  },
  {
    id: 'pytest', name: 'pytest', tier: 'connector', role: 'testing tool: service-layer tests',
    licence: 'MIT', source: 'https://github.com/pytest-dev/pytest', checked: CHECKED,
    install: [],
    manual: 'https://docs.pytest.org/',
    detect: { mcp: ['pytest'] },
    versions: null,
    fallback: 'artifacts-only: yad-test-cases writes test-cases.md only',
    records: null,
    note: 'pytest has no official MCP server; the small community ones are not vetted. Connect one you trust under the name pytest.',
    usedBy: ['yad-connect-testing', 'yad-test-cases'],
  },
  {
    id: 'maestro', name: 'Maestro', tier: 'connector', role: 'testing tool: mobile UI flows',
    licence: 'Apache-2.0', source: 'https://github.com/mobile-dev-inc/Maestro', checked: CHECKED,
    install: [{ type: 'script', command: 'curl -fsSL "https://get.maestro.mobile.dev" | bash, then claude mcp add maestro -- maestro mcp' }],
    manual: 'https://docs.maestro.dev/get-started/maestro-mcp',
    detect: { bins: ['maestro'], mcp: ['maestro'] },
    versions: null,
    fallback: 'artifacts-only: yad-test-cases writes test-cases.md only',
    records: null, note: 'Needs Java 17 or later. The MCP server is built into the maestro program.',
    usedBy: ['yad-connect-testing', 'yad-test-cases'],
  },
  {
    id: 'deeptutor', name: 'DeepTutor', tier: 'connector', role: 'learning tool: tutors a team member on what is being built',
    licence: 'Apache-2.0', source: 'https://github.com/HKUDS/DeepTutor', checked: CHECKED,
    install: [{ type: 'python', command: 'pip install -U deeptutor, then deeptutor init' }],
    manual: null,
    detect: { bins: ['deeptutor'] },
    versions: null,
    fallback: 'harness-native tutoring: yad-learn has your agent read the project files directly',
    records: null, note: 'A program, not an MCP server. Needs Python 3.11 or later.',
    usedBy: ['yad-connect-learning', 'yad-learn'],
  },
]);

// ---- checking an entry ------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

// Every way an entry can be malformed, as sentences. [] means it is well formed. Run by the tests over the
// shipped list, so a bad entry fails CI rather than a user's `yad toolbox list`.
export function toolProblems(t) {
  const out = [];
  const need = (ok, what) => { if (!ok) out.push(what); };
  need(typeof t?.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(t.id), 'id is lower-case words joined by -');
  need(typeof t?.name === 'string' && t.name.length > 0, 'name is set');
  need(TIERS.includes(t?.tier), `tier is one of ${TIERS.join(', ')}`);
  need(typeof t?.role === 'string' && t.role.length > 0, 'role is set');
  need(typeof t?.licence === 'string' && t.licence.length > 0, 'licence is set (an SPDX id, or "proprietary")');
  need(typeof t?.source === 'string' && /^https:\/\//.test(t.source), 'source is an https URL');
  need(typeof t?.checked === 'string' && DATE.test(t.checked), 'checked is a YYYY-MM-DD date');
  need(Array.isArray(t?.install), 'install is a list');
  for (const r of Array.isArray(t?.install) ? t.install : []) {
    need(INSTALL_TYPES.includes(r?.type), `an install route's type is one of ${INSTALL_TYPES.join(', ')}`);
    need(typeof r?.command === 'string' && r.command.length > 0, 'an install route has its command');
  }
  need((Array.isArray(t?.install) && t.install.length > 0) || (typeof t?.manual === 'string' && /^https:\/\//.test(t.manual)),
    'a tool with no install command links its manual steps (manual: https URL)');
  const d = t?.detect;
  need(d && typeof d === 'object', 'detect is set');
  if (d && typeof d === 'object') {
    for (const k of ['skills', 'skillPrefixes', 'plugins', 'mcp', 'bins']) need(d[k] === undefined || isStringList(d[k]), `detect.${k} is a list of names`);
    need(d.npx === undefined || typeof d.npx === 'boolean', 'detect.npx is true or false');
    need(['skills', 'skillPrefixes', 'plugins', 'mcp', 'bins'].some((k) => d[k]?.length) || d.npx === true, 'detect names at least one thing to look for');
  }
  need(t?.versions === null || (typeof t?.versions === 'string' && parseRange(t.versions) !== null), 'versions is null or a range this reader understands');
  need(typeof t?.fallback === 'string' && t.fallback.length > 0, 'fallback says what yadflow does without it');
  need(t?.records === null || (typeof t?.records === 'string' && t.records.length > 0), 'records is null or the line a skill writes');
  need(t?.note === null || (typeof t?.note === 'string' && t.note.length > 0), 'note is null or a sentence');
  need(t?.manual === null || (typeof t?.manual === 'string' && /^https:\/\//.test(t.manual)), 'manual is null or an https URL');
  need(isStringList(t?.usedBy), 'usedBy lists the skills or commands that use it');
  return out;
}

// ---- versions ---------------------------------------------------------------------------------------

// `1.2.3`, `v1.2`, `3` → [1,2,3] / [1,2,0] / [3,0,0]; a pre-release (`1.2.3-beta`) is below its release.
// Anything else (a git sha, a date) is not a version this can compare: null.
export function parseVersion(v) {
  const m = String(v ?? '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  // `full`: all three numbers were written. A range needs that (see parseRange); a found version does not.
  return { parts: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4] ? m[4].slice(1) : null, full: m[2] !== undefined && m[3] !== undefined };
}

// The semantic-versioning order: numbers first; then a pre-release is below its release, and two
// pre-releases compare label by label — a number below a word, numbers as numbers, a shorter list first.
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] < b.parts[i] ? -1 : 1;
  if (!a.pre || !b.pre) return a.pre === b.pre ? 0 : a.pre ? -1 : 1;
  const x = a.pre.split('.');
  const y = b.pre.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    const nx = /^\d+$/.test(x[i]);
    const ny = /^\d+$/.test(y[i]);
    if (nx && ny && Number(x[i]) !== Number(y[i])) return Number(x[i]) < Number(y[i]) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    if (!nx && x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

// A range is space-separated comparators, all of which must hold: `>=3.0.0 <4.0.0`, `^3.2.0`, `~1.4.0`,
// `=2.0.0`. A small reader on purpose — the list sets a handful of simple bounds, and a dependency for
// that is not worth its weight. Returns the comparator list, or null when it cannot read the range.
//
// EVERY VERSION IN A RANGE HAS ALL THREE NUMBERS. A partial one (`~1`, `^0`, `>1.2`) means something
// different for each operator, and reading it as `.0` got four of them wrong; refusing it makes
// `toolProblems` reject such a range instead of letting it give a silent wrong answer.
//
// ONE RULE FOR PRE-RELEASES: an upper bound `<X.Y.Z` also keeps out X.Y.Z's own pre-releases
// (`4.0.0-beta` is outside `<4.0.0`), whether it was written or comes from `^` / `~`.
export function parseRange(range) {
  const out = [];
  // `<X.Y.Z-0` — below every pre-release of X.Y.Z, because `0` is the lowest label there is.
  const below = (parts) => ['<', { parts, pre: '0', full: true }];
  for (const tok of String(range).trim().split(/\s+/)) {
    const m = tok.match(/^(>=|<=|>|<|=|\^|~)?(.+)$/);
    const v = m && parseVersion(m[2]);
    if (!v || !v.full) return null;
    const [x, y, z] = v.parts;
    const op = m[1] || '=';
    if (op === '^') out.push(['>=', v], below(x > 0 ? [x + 1, 0, 0] : y > 0 ? [0, y + 1, 0] : [0, 0, z + 1]));
    else if (op === '~') out.push(['>=', v], below([x, y + 1, 0]));
    else if (op === '<' && !v.pre) out.push(below(v.parts));
    else out.push([op, v]);
  }
  return out.length ? out : null;
}

// true or false when both sides can be read; null when either cannot (a sha, a missing version).
export function versionInRange(version, range) {
  const v = parseVersion(version);
  const r = range === null ? null : parseRange(range);
  if (!v || !r) return null;
  return r.every(([op, b]) => {
    const k = compare(v, b);
    return op === '>=' ? k >= 0 : op === '>' ? k > 0 : op === '<=' ? k <= 0 : op === '<' ? k < 0 : k === 0;
  });
}

// ---- finding a tool ---------------------------------------------------------------------------------

// Is a program on PATH — by reading the PATH folders, never by starting one. On Windows a program is
// `name` plus one of PATHEXT's endings (`.EXE`, `.CMD`, …); elsewhere it must be an executable file.
export function onPath(bin, { env = process.env, platform = process.platform } = {}) {
  // Only absolute folders: an empty or relative entry means "the current folder", which is not where a
  // tool is installed, and would make the answer depend on where `yad` happened to run.
  // On Windows that means a drive and a root (C:\x) or a share (\\server\share): \x is on whatever drive
  // is current, and D:x in that drive's current folder. Windows accepts an entry in quotes; so does this.
  const isAbs = platform === 'win32' ? (d) => /^[A-Za-z]:[\\/]/.test(d) || /^[\\/]{2}[^\\/]/.test(d) : path.posix.isAbsolute;
  const unquote = (d) => (platform === 'win32' ? d.replace(/^"(.*)"$/, '$1') : d);
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').map(unquote).filter((d) => d && isAbs(d));
  const exts = platform === 'win32' ? ['', ...String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      try {
        if (!fs.statSync(full).isFile()) continue;
        if (platform !== 'win32') fs.accessSync(full, fs.constants.X_OK);
        return true;
      } catch { /* not here */ }
    }
  }
  return false;
}

const lower = (s) => String(s).toLowerCase();
// A plugin id is `name@marketplace`; the toolbox names the plugin by `name` alone, or by the full id.
const pluginMatches = (id, names) => names.some((n) => lower(n) === lower(id) || lower(n) === lower(String(id).split('@')[0]));

// What the toolbox knows about one tool here: `installed` (something it installs was found), `available`
// (fetched on demand — `npx` is there), `disabled` (found only through a plugin that is turned off), or
// `missing`. `found` lists where, as `yad detect` shows places;
// `version` is the first one a found item records; `inRange` is true, false, or null (nothing to compare).
export function toolStatus(tool, items, { has = onPath } = {}) {
  const d = tool.detect;
  // A Claude Code plugin your settings turn off is not loaded, and neither is anything it brings (its
  // skills, agents and MCP servers carry its id in `plugin`). `enabled: null` means no setting says, which
  // is on. So a tool found ONLY through a plugin that is off is `disabled`, not installed.
  // Claude Code's plugins only: a Codex plugin of the same name has its own switch, which is not read.
  const claude = (it) => Array.isArray(it.agents) && it.agents.includes('Claude Code');
  const off = new Set(items.filter((it) => it.kind === 'plugin' && it.enabled === false && claude(it)).map((it) => it.name));
  const isOff = (it) => claude(it) && off.has(it.kind === 'plugin' ? it.name : it.plugin);
  const matches = items.filter((it) => {
    if (it.kind === 'skill') return (d.skills ?? []).some((n) => lower(n) === lower(it.name)) || (d.skillPrefixes ?? []).some((p) => lower(it.name).startsWith(lower(p)));
    if (it.kind === 'plugin') return pluginMatches(it.name, d.plugins ?? []);
    if (it.kind === 'mcp') return (d.mcp ?? []).some((n) => lower(n) === lower(it.name));
    return false;
  });
  const hits = matches.filter((it) => !isOff(it));
  const bins = (d.bins ?? []).filter((b) => has(b));
  const found = [...new Set([...hits.map((h) => h.where), ...bins.map((b) => `${b} on PATH`)])];
  const version = hits.map((h) => h.version).find((v) => typeof v === 'string' && v) ?? null;
  const inRange = tool.versions === null ? null : versionInRange(version, tool.versions);
  if (found.length) return { state: 'installed', found, version, inRange };
  // `npx` before `disabled`: yadflow runs such a tool through npx, so a plugin that is off does not stop it.
  if (d.npx && has('npx')) return { state: 'available', found: ['npx on PATH'], version: null, inRange: null };
  if (matches.length) return { state: 'disabled', found: [...new Set(matches.map((h) => h.where))], version: null, inRange: null };
  return { state: 'missing', found: [], version: null, inRange: null };
}

// ---- the command ------------------------------------------------------------------------------------

// The lines `yad toolbox list` prints, from rows that already carry their status. Separate so a test can
// read them: a version is the one value here that comes from a file on disk, so it is cleaned like every
// name `yad detect` prints.
export function toolboxLines(rows) {
  const lines = [c.bold('The toolbox — external tools yadflow can use. None is required; each has a fallback.')];
  for (const tier of TIERS) {
    const mine = rows.filter((r) => r.tier === tier);
    if (!mine.length) continue;
    lines.push('', c.bold(TIER_TITLES[tier]));
    for (const r of mine) {
      const s = r.status;
      const version = s.version ? clean(s.version) : null;
      const mark = s.state === 'missing' || s.state === 'disabled' ? c.dim('–') : c.green('✓');
      const state = s.state === 'installed' ? `installed${version ? ` ${version}` : ''}`
        : s.state === 'available' ? 'available (npx fetches it when needed)'
          : s.state === 'disabled' ? 'installed, but its plugin is turned off in your Claude Code settings' : 'not found';
      lines.push(`  ${mark} ${c.bold(r.name)} ${c.dim(`— ${r.role}`)}: ${state}`);
      if (s.inRange === false) lines.push(`      ${c.yellow('!')} version ${version} is outside the known-good range ${r.versions} — still used; if it misbehaves, install a version in range`);
      if (s.state === 'missing' || s.state === 'disabled') lines.push(`      ${c.dim(`without it: ${r.fallback}`)}`);
      if (r.note) lines.push(`      ${c.dim(r.note)}`);
    }
  }
  return lines;
}

export function runToolboxList(root, { json = false, tools = TOOLBOX, items = null, has = onPath } = {}) {
  const found = items ?? detectInstalled(root).items;
  const rows = tools.map((t) => ({ ...t, status: toolStatus(t, found, { has }) }));
  if (json) return emitJSON({ ok: true, tools: rows });
  for (const line of toolboxLines(rows)) log(line);
  info('`yad toolbox list --json` adds each tool\'s licence, source, install commands and where it was found');
  return undefined;
}
