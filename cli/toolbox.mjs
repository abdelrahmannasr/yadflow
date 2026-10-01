// The toolbox — every external tool yadflow can use, what each one is for, how it installs, and what
// yadflow does without it (E84).
//
//   yad toolbox list [--json] [--dir <folder>]
//   yad toolbox check [--json] [--dir <folder>]
//   yad toolbox add <id> | add <id> --custom --role … --fallback … --detect … [--install …] [--source …]
//   yad toolbox remove <id>
//
// THE RULE IT EXISTS FOR: no external tool is ever mandatory, and every one declares a fallback. yadflow
// degrades; it never breaks. This file is the one place that says, per tool, what "degrades" means.
//
// NOT `manifest.mjs`. That is the INSTALL manifest — the files yadflow copies into a project. This list
// is about tools yadflow does NOT ship and never installs on its own.
//
// SHIPPED, NOT A PROJECT FILE (decided with E84). The list moves with each release, like the step
// catalogue. What a team CHOOSES from it is a project file, `.sdlc/toolbox.json` in the Product (E86):
// which shipped tools it uses or skips, and its own tools. See "the team's choices" below.
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
import { c, emitJSON, exists, hand, info, log, ok, readJSON, readJSONStrict, refuse, warn, writeJSON } from './lib.mjs';
import { clean, detectInstalled } from './detect.mjs';
import { PROJECT_FILES, SCHEMA_VERSION } from './manifest.mjs';

export const INSTALL_TYPES = Object.freeze(['plugin', 'npm', 'python', 'script']);
export const TIERS = Object.freeze(['core', 'recommended', 'connector']);
const TIER_TITLES = { core: 'Core — offered at setup', recommended: 'Recommended — listed, never pushed', connector: 'Connectors — design, testing and learning tools a Product connects' };

const CHECKED = '2026-10-01';

// The list itself, checked against each tool's own repository and docs on CHECKED. `install` keeps only
// the routes the roadmap's four types describe (plugin, npm, python, script); a tool's other routes
// (Docker, Homebrew, a VS Code extension) are in its own README, which `source` links. `versions` is null
// everywhere for now: no bound has been tested yet — E88 vets each default and is where a known-good
// range is earned. `records` is the exact line a skill writes when the tool is absent. Each skill in
// `usedBy` quotes `fallback` and `records` word for word in its "When a tool is missing" section (E87):
// change the words here, then rewrite the sections with `skillFallbackSection`.
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
    fallback: 'no Repomix pack: yad setup and yad repo refresh skip it, yad-connect-repos and yad-backfill put the same context together by hand from the source tree and the recent git log, and the Shape steps read the code map',
    records: 'source: repomix-unavailable', note: null,
    usedBy: ['yad setup', 'yad repo refresh', 'yad-connect-repos', 'yad-backfill'],
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
  // A skill's section adds the full stop (E87), so a fallback ending in one would print two.
  need(typeof t?.fallback !== 'string' || !/[.\s]$/.test(t.fallback), 'fallback ends without a full stop or a space');
  need(t?.records === null || (typeof t?.records === 'string' && t.records.length > 0), 'records is null or the line a skill writes');
  need(t?.note === null || (typeof t?.note === 'string' && t.note.length > 0), 'note is null or a sentence');
  need(t?.manual === null || (typeof t?.manual === 'string' && /^https:\/\//.test(t.manual)), 'manual is null or an https URL');
  need(isStringList(t?.usedBy), 'usedBy lists the skills or commands that use it');
  need(t?.tier !== 'connector' || !isStringList(t?.usedBy) || connectorFile(t) !== null, 'a connector names the yad-connect-* skill that connects it');
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
  // is current, and D:x in that drive's current folder. Windows accepts an entry in quotes; so does this —
  // but not a `;` inside the quotes, which the plain split cuts in two (rare; that folder is then missed).
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

// ---- the team's choices (E86) -----------------------------------------------------------------------
//
// `.sdlc/toolbox.json` in the Product, committed, so the whole team shares one answer:
//
//   { "schemaVersion": 10,
//     "shipped": { "<id>": "use" | "skip" },     only where this project differs from the default
//     "custom":  [ { "id", "role", "fallback", "detect", "install"?, "source"?, "name"? } ] }
//
// IN USE BY DEFAULT: the core tools (setup offers them), and a connector the Product has connected — the
// `tool` its design.json, testing.json or learning.json names. Everything else is listed, not in use.
// `add` and `remove` write only a difference from that default, so the file never repeats one, and a
// later release that changes a default is not overruled by a line nobody chose.
//
// RECORDS ONLY (decided with the row). Nothing here installs a tool or starts a program: `add` prints the
// install command, and the person runs it. `yad toolbox check` then says whether it is found.

export const TOOL_ID = /^[a-z0-9][a-z0-9-]*$/;
const CHOICES = ['use', 'skip'];
// `--detect skill:x,prefix:y-,plugin:p,mcp:m,bin:b` — the same five things a shipped entry looks for.
const DETECT_KINDS = Object.freeze({ skill: 'skills', prefix: 'skillPrefixes', plugin: 'plugins', mcp: 'mcp', bin: 'bins' });
const CONNECTOR_FILES = ['designConfig', 'testingConfig', 'learningConfig'];
const FILE = PROJECT_FILES.toolboxConfig;
const ADD_USAGE = 'usage: yad toolbox add <id>   or   yad toolbox add <id> --custom --role "<what it does>" --fallback "<what happens without it>" --detect <kind>:<name>[,…] [--install "<type>: <command>"] [--source <https URL>]';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const shippedTool = (id) => TOOLBOX.find((t) => t.id === id) ?? null;

// The file as it is on disk, for a read-modify-write: `{ doc }` or `{ error }`. STRICT, like
// `yad skill bind`: a file that does not parse is refused, never rebuilt from nothing — that would delete
// every choice in it, silently.
export function readToolboxFile(root) {
  const file = path.join(root, FILE);
  if (!exists(file)) return { doc: {} };
  let raw;
  try { raw = readJSONStrict(file, null); } catch { return { error: 'does not parse [YAD-STATE-001]' }; }
  if (!isObject(raw)) return { error: 'has the wrong shape [YAD-STATE-002]' };
  if (raw.shipped !== undefined && !isObject(raw.shipped)) return { error: '`shipped` must be a JSON object [YAD-STATE-002]' };
  if (raw.custom !== undefined && !Array.isArray(raw.custom)) return { error: '`custom` must be a JSON list [YAD-STATE-002]' };
  return { doc: raw };
}

// Every way a team's own entry can be malformed, as sentences; [] means it is usable. Lighter than
// `toolProblems`: a licence, a checked date and `usedBy` are the shipped list's promises, not a team's.
export function customProblems(t) {
  if (!isObject(t)) return ['an entry is a JSON object'];
  const out = [];
  const need = (ok, what) => { if (!ok) out.push(what); };
  need(typeof t.id === 'string' && TOOL_ID.test(t.id), 'id is lower-case words joined by -');
  need(!(typeof t.id === 'string' && shippedTool(t.id)), 'id is not the id of a shipped tool');
  need(t.name === undefined || (typeof t.name === 'string' && t.name.length > 0), 'name, when set, is text');
  need(typeof t.role === 'string' && t.role.trim().length > 0, 'role says what it does');
  need(typeof t.fallback === 'string' && t.fallback.trim().length > 0, 'fallback says what happens without it');
  const d = t.detect;
  const kinds = Object.values(DETECT_KINDS);
  need(isObject(d) && Object.keys(d).every((k) => kinds.includes(k) && isStringList(d[k])) && kinds.some((k) => d[k]?.length),
    `detect names at least one thing to look for (${kinds.join(', ')}), each a list of names`);
  // A program is a plain name looked up on PATH. A path (`../x`) would make every teammate's `check`
  // look at a file the shared file chose, so it is refused.
  need(!isObject(d) || !Array.isArray(d.bins) || d.bins.every((b) => typeof b !== 'string' || (!/[\\/]/.test(b) && b !== '.' && b !== '..')),
    'detect.bins names programs, not paths (no / or \\)');
  need(t.install === undefined || (Array.isArray(t.install) && t.install.every((r) => INSTALL_TYPES.includes(r?.type) && typeof r?.command === 'string' && r.command.length > 0)),
    `install, when set, is a list of { type: ${INSTALL_TYPES.join(' | ')}, command }`);
  need(t.source === undefined || t.source === null || (typeof t.source === 'string' && /^https:\/\//.test(t.source)), 'source, when set, is an https URL');
  return out;
}

// A team's entry in the shipped entries' shape, so one printer and one finder serve both.
const customRow = (t) => ({
  id: t.id, name: t.name || t.id, tier: 'project', role: t.role,
  licence: null, source: t.source ?? null, checked: null,
  install: t.install ?? [], manual: null,
  detect: Object.fromEntries(Object.values(DETECT_KINDS).filter((k) => t.detect[k]?.length).map((k) => [k, t.detect[k]])),
  versions: null, fallback: t.fallback, records: null, note: null, usedBy: [],
});

// The connector each of design.json, testing.json and learning.json names, when it is one the toolbox
// knows: id → the file. `none` and an adapter the toolbox does not list name nothing here.
export function connectedTools(root) {
  const out = new Map();
  for (const key of CONNECTOR_FILES) {
    const doc = readJSON(path.join(root, PROJECT_FILES[key]), null);
    const id = isObject(doc) && typeof doc.tool === 'string' ? doc.tool : null;
    if (id && shippedTool(id)?.tier === 'connector' && !out.has(id)) out.set(id, PROJECT_FILES[key]);
  }
  return out;
}

// What the Product says, read leniently: a broken file or line is a `problem` and the defaults stand,
// because a list must still answer. With no Product, there is nothing to read: the defaults.
export function loadChoices(productRoot) {
  const problems = [];
  let doc = {};
  if (productRoot) {
    const r = readToolboxFile(productRoot);
    if (r.error) problems.push(`${FILE} ${r.error} — showing the defaults`);
    else doc = r.doc;
  }
  const shipped = new Map();
  // A line no `yad toolbox remove <id>` can reach — no id, or an empty one — is fixed by hand only.
  let unreachable = false;
  for (const [id, v] of Object.entries(doc.shipped ?? {})) {
    if (!id) unreachable = true;
    // A tool from a newer release, or a typo: the line stays in the file and does nothing here.
    if (!shippedTool(id)) problems.push(`${FILE}: \`${clean(id)}\` is not a tool this yadflow ships — ignored`);
    else if (!CHOICES.includes(v)) problems.push(`${FILE}: \`${id}\` should be "use" or "skip" — ignored`);
    else shipped.set(id, v);
  }
  const custom = [];
  for (const [i, t] of (doc.custom ?? []).entries()) {
    const hasId = isObject(t) && typeof t.id === 'string' && t.id.length > 0;
    const label = hasId ? `\`${clean(t.id)}\`` : `number ${i + 1}`;
    const p = customProblems(t);
    if (p.length && !hasId) unreachable = true;
    if (p.length) problems.push(`${FILE}: custom tool ${label} is ignored — ${p.join('; ')}`);
    else if (custom.some((c2) => c2.id === t.id)) problems.push(`${FILE}: custom tool ${label} is listed twice — the first one is used`);
    else custom.push(customRow(t));
  }
  return { problems, unreachable, shipped, custom, connected: productRoot ? connectedTools(productRoot) : new Map() };
}

// Is a tool in use here, and why. `because`: core | connected | added | removed | custom | null.
const defaultUsed = (tool, connected) => tool.tier === 'core' || connected.has(tool.id);
export function toolUse(tool, { shipped, connected }) {
  if (tool.tier === 'project') return { used: true, because: 'custom' };
  const choice = shipped.get(tool.id);
  if (choice === 'use') return { used: true, because: 'added' };
  if (choice === 'skip') return { used: false, because: 'removed' };
  if (tool.tier === 'core') return { used: true, because: 'core' };
  if (connected.has(tool.id)) return { used: true, because: 'connected', connectedIn: connected.get(tool.id) };
  return { used: false, because: null };
}

// ---- what a skill does when its tool is missing (E87) ------------------------------------------------
//
// Every skill a shipped tool's `usedBy` names carries one section, built here, so its words are the
// toolbox's words and a test can hold the two together. A skill decides from yad's own answer — one rule
// for every skill, which already sees a plugin turned off in Claude Code — not from its own guess:
//   core       used when `yad toolbox list --json` says `used: true` and the state is `installed` or
//              `available`. A team's `skip` (`yad toolbox remove <id>`) means the fallback, even when the
//              tool is installed.
//   connector  used when the Product's design, testing or learning file connects it. The connect skill
//              writes that file and the step skill follows it, as before E87.
// Recommended tools are bound with `yad skill bind`, so no skill names one.
export const SKILL_FALLBACK_HEADING = '## When a tool is missing';
const CONNECT_FILES = { 'yad-connect-design': 'designConfig', 'yad-connect-testing': 'testingConfig', 'yad-connect-learning': 'learningConfig' };

// The Product file that connects a connector: the one its `yad-connect-*` skill writes.
export function connectorFile(tool) {
  const skill = tool.usedBy.find((u) => CONNECT_FILES[u]);
  return skill ? PROJECT_FILES[CONNECT_FILES[skill]] : null;
}

// The skills (folders under skills/, not `yad <command>`s) that use a tool.
export const skillsUsing = (tool) => tool.usedBy.filter((u) => !u.startsWith('yad '));

export function skillFallbackSection(skill, tools = TOOLBOX) {
  const mine = tools.filter((t) => t.tier !== 'recommended' && skillsUsing(t).includes(skill));
  if (!mine.length) return null;
  const lines = [
    SKILL_FALLBACK_HEADING,
    '',
    '<!-- Written from yadflow\'s cli/toolbox.mjs (E87). Change the words there: a test holds this section to it. -->',
    '',
    'No tool below is required. When one is missing, this skill still finishes, using the fallback written',
    'beside it. Decide from yad\'s answer, not from a guess: run `yad toolbox list --json` and read the',
    'entry with the tool\'s `id`. Run it where the tool will run: for work inside a code repo, add',
    '`--dir <that repo>`, so the tools installed there are found (the choices still come from its Product).',
    'If yad cannot answer (it is not installed here, or the command fails),',
    'use the check in the steps below. Tell the person which tools you used and which fallbacks, and why.',
    '',
  ];
  for (const t of mine) {
    const record = t.records ? ` Record \`${t.records}\` — it means the tool was not used, whatever the reason.` : '';
    if (t.tier === 'connector') {
      lines.push(`- **${t.name}** (\`${t.id}\`, a connector). Used when \`${connectorFile(t)}\` connects it: the connect skill writes that file, and the steps below follow it. Without it: ${t.fallback}.${record}`);
    } else {
      lines.push(`- **${t.name}** (\`${t.id}\`). Use it when its entry has \`used: true\` and \`status.state\` is \`installed\` or \`available\`. Otherwise — not found, its plugin turned off in Claude Code, or the team chose not to use it (\`yad toolbox remove ${t.id}\`) — do this instead: ${t.fallback}.${record}`);
    }
  }
  return lines.join('\n');
}

// Every row — shipped, then the team's own — with what is found here and whether it is in use. Finding
// reads `detectRoot` (the folder yad runs in: a code repo's own skills count); the choices come from the
// Product, which may be another folder.
export function toolboxRows(detectRoot, productRoot, { tools = TOOLBOX, items = null, has = onPath } = {}) {
  const found = items ?? detectInstalled(detectRoot).items;
  const choices = loadChoices(productRoot);
  const rows = [...tools, ...choices.custom].map((t) => ({ ...t, status: toolStatus(t, found, { has }), ...toolUse(t, choices) }));
  return { rows, problems: choices.problems };
}

// ---- the command ------------------------------------------------------------------------------------

const TITLES = { ...TIER_TITLES, project: 'Added by this project' };
const BECAUSE = { core: 'used here', connected: 'used here — connected', added: 'used here — added', custom: 'used here', removed: 'not used here — removed' };

// The lines `yad toolbox list` prints, from rows that already carry their status. Separate so a test can
// read them. Everything from a file is cleaned like every name `yad detect` prints: a found version, and
// every word of a team's own entry (the Product's file is shared, so anyone can write in it).
export function toolboxLines(rows) {
  const lines = [c.bold('The toolbox — external tools yadflow can use. None is required; each has a fallback.')];
  for (const tier of [...TIERS, 'project']) {
    const mine = rows.filter((r) => r.tier === tier);
    if (!mine.length) continue;
    lines.push('', c.bold(TITLES[tier]));
    for (const r of mine) {
      const s = r.status;
      const version = s.version ? clean(s.version) : null;
      const mark = s.state === 'missing' || s.state === 'disabled' ? c.dim('–') : c.green('✓');
      const state = s.state === 'installed' ? `installed${version ? ` ${version}` : ''}`
        : s.state === 'available' ? 'available (npx fetches it when needed)'
          : s.state === 'disabled' ? 'installed, but its plugin is turned off in your Claude Code settings' : 'not found';
      const tag = r.because ? c.cyan(` [${BECAUSE[r.because]}]`) : '';
      lines.push(`  ${mark} ${c.bold(clean(r.name))} ${c.dim(`— ${clean(r.role)}`)}: ${state}${tag}`);
      if (s.inRange === false) lines.push(`      ${c.yellow('!')} version ${version} is outside the known-good range ${r.versions} — still used; if it misbehaves, install a version in range`);
      if (s.state === 'missing' || s.state === 'disabled') lines.push(`      ${c.dim(`without it: ${clean(r.fallback)}`)}`);
      if (r.note) lines.push(`      ${c.dim(r.note)}`);
    }
  }
  return lines;
}

export function runToolboxList(root, { json = false, productRoot = null, tools = TOOLBOX, items = null, has = onPath } = {}) {
  const { rows, problems } = toolboxRows(root, productRoot, { tools, items, has });
  if (json) return emitJSON({ ok: true, ...(productRoot ? where(productRoot) : { product: null, file: null }), tools: rows, problems });
  for (const line of toolboxLines(rows)) log(line);
  for (const p of problems) warn(p);
  info(productRoot
    ? '[used here] = in use in this Product; change it with `yad toolbox add <id>` / `yad toolbox remove <id>`'
    : 'no Product here, so this shows the defaults: the core tools are the ones in use');
  info('`yad toolbox list --json` adds each tool\'s licence, source, install commands and where it was found');
  return undefined;
}

// How to get a tool, as lines: each install command, else the vendor's steps, else its source.
const howToGet = (r) => (r.install.length ? r.install.map((i) => `${i.type}: ${clean(i.command)}`)
  : r.manual ? [`set it up by hand: ${r.manual}`] : r.source ? [`see ${clean(r.source)}`] : []);

// The tools this project uses that are not ready here: `missing`, `disabled` (its plugin is off), or
// `out-of-range` (found, but outside its known-good versions — still used). The function E85 calls.
export function toolboxCheck(root, productRoot, opts = {}) {
  const { rows, problems } = toolboxRows(root, productRoot, opts);
  const used = rows.filter((r) => r.used);
  const findings = used.flatMap((r) => {
    const s = r.status;
    const problem = s.state === 'missing' ? 'missing' : s.state === 'disabled' ? 'disabled' : s.inRange === false ? 'out-of-range' : null;
    if (!problem) return [];
    return [{ id: r.id, name: r.name, tier: r.tier, problem, version: s.version, versions: r.versions, install: r.install, manual: r.manual, source: r.source, fallback: r.fallback }];
  });
  return { used, findings, problems };
}

// The lines a check prints, from `toolboxCheck`'s answer, without the closing hint. One printer for
// `yad toolbox check` and for the toolbox step of setup, update, check and join (E85), so they cannot
// say it differently.
export function toolboxCheckLines({ used, findings }) {
  if (!used.length) return [`  ${c.dim('•')} this project uses no tool from the toolbox — \`yad toolbox list\` shows them all`];
  if (!findings.length) return [`  ${c.green('✓')} all ${used.length} tool(s) this project uses are here: ${used.map((r) => clean(r.name)).join(', ')}`];
  const lines = [c.bold(`${findings.length} of the ${used.length} tool(s) this project uses ${findings.length === 1 ? 'is' : 'are'} not ready here. None is required.`)];
  for (const f of findings) {
    const r = used.find((u) => u.id === f.id);
    const what = f.problem === 'missing' ? 'not found'
      : f.problem === 'disabled' ? 'installed, but its plugin is turned off in your Claude Code settings'
        : `version ${clean(f.version)} is outside the known-good range ${f.versions} — still used`;
    lines.push(`  ${f.problem === 'out-of-range' ? c.yellow('!') : c.dim('–')} ${c.bold(clean(f.name))}: ${what}`);
    if (f.problem === 'disabled') lines.push(`      ${c.dim('turn it on with /plugin in Claude Code')}`);
    else for (const line of howToGet(r)) lines.push(`      ${c.dim(line)}`);
    if (f.problem !== 'out-of-range') lines.push(`      ${c.dim(`without it: ${clean(f.fallback)}`)}`);
  }
  return lines;
}

// NEVER FAILS (decided with the row): no tool is required, so a missing one is news, not an error. Exit 0.
export function runToolboxCheck(root, { json = false, productRoot = null, ...opts } = {}) {
  const res = toolboxCheck(root, productRoot, opts);
  const { used, findings, problems } = res;
  if (json) return emitJSON({ ok: true, ...(productRoot ? where(productRoot) : { product: null, file: null }), used: used.map((r) => r.id), findings, problems });
  for (const p of problems) warn(p);
  for (const line of toolboxCheckLines(res)) log(line);
  if (findings.length) info(productRoot ? 'stop using a tool, for the whole team, with `yad toolbox remove <id>`' : 'no Product here, so this checks the core tools only');
  return undefined;
}

// The toolbox step of `yad setup`, `yad check`, `yad update` and `yad join` (E85). It OFFERS: it prints
// what the project uses that is not here and how to get it. It installs nothing, runs no program and
// writes no file (decided with the row, as `yad toolbox add` is) — and it never fails the command it is
// part of. Returns the part of the --json answer it adds: `{ used, findings, problems }`.
// `canRemove: false` leaves out the `remove` advice — for `yad join`, whose reader just cloned the team's
// choices: one person's machine lacking a tool is no reason to change what the whole team uses.
export function offerToolbox(root, productRoot, { canRemove = true, ...opts } = {}) {
  let res;
  // A step inside another command: if finding tools throws (a home folder that cannot be read), the
  // command it is part of still finishes, and says why the step is missing.
  try { res = toolboxCheck(root, productRoot, opts); } catch (e) {
    warn(`toolbox: could not check the tools here (${clean(e?.message ?? String(e))}) — run \`yad toolbox check\` to see why`);
    return { used: [], findings: [], problems: [], error: 'could not check' };
  }
  for (const p of res.problems) warn(p);
  for (const line of toolboxCheckLines(res)) log(line);
  if (res.findings.length) {
    info(canRemove
      ? 'nothing is installed for you: follow the steps you choose, or, for the whole team, stop using a tool with `yad toolbox remove <id>`'
      : 'nothing is installed for you: follow the steps you choose');
  }
  return { used: res.used.map((r) => r.id), findings: res.findings, problems: res.problems };
}

// `--detect skill:x,plugin:p` → { skills: ['x'], plugins: ['p'] }, or { error }.
export function parseDetect(text) {
  const out = {};
  for (const part of String(text ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^([a-z]+):(.+)$/);
    const key = m && Object.hasOwn(DETECT_KINDS, m[1]) ? DETECT_KINDS[m[1]] : null;
    if (!key) return { error: `\`${clean(part)}\` is not <kind>:<name> — the kinds are ${Object.keys(DETECT_KINDS).join(', ')}` };
    (out[key] ??= []).push(m[2].trim());
  }
  return Object.keys(out).length ? { detect: out } : { error: '--detect names nothing to look for' };
}

// `--install "npm: npx thing"` → { type, command }, or { error }.
export function parseInstall(text) {
  const m = String(text ?? '').match(/^\s*([a-z]+)\s*:\s*(.+?)\s*$/);
  if (!m || !INSTALL_TYPES.includes(m[1])) return { error: `--install is "<type>: <command>", the type one of ${INSTALL_TYPES.join(', ')}` };
  return { route: { type: m[1], command: m[2] } };
}

const CUSTOM_FLAGS = ['role', 'fallback', 'detect', 'install', 'source'];
const brokenFile = (error, json) => refuse(`${FILE} ${error}`, 'fix the file (or restore it from git) first — writing over it would delete every choice it holds', { json });

// The document plus one edit, ready to write. `schemaVersion` is set outright, as `yad skill bind` does:
// this command is the file's engine writer, so its write IS the file's migration. Keys this release does
// not know are kept; an empty `shipped` or `custom` is left out.
function save(productRoot, doc, shipped, custom) {
  const next = { ...doc, schemaVersion: SCHEMA_VERSION, shipped, custom };
  if (!Object.keys(shipped).length) delete next.shipped;
  if (!custom.length) delete next.custom;
  writeJSON(path.join(productRoot, FILE), next);
}

// The one edit both verbs make to a shipped tool: write `want` only where it differs from the default.
function setShipped(doc, tool, want, connected) {
  const shipped = { ...(isObject(doc.shipped) ? doc.shipped : {}) };
  if (defaultUsed(tool, connected) === (want === 'use')) delete shipped[tool.id];
  else shipped[tool.id] = want;
  return shipped;
}
const sameJSON = (a, b) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

// Where the file is, for an answer: the Product as a path from here, since run from a code repo nothing
// else on stdout names it. Both sides as the disk has them: `process.cwd()` is already resolved, and a
// Product reached through a link (macOS's /var is /private/var) would otherwise climb to the top and back.
const onDisk = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const where = (productRoot) => ({ product: path.relative(onDisk(process.cwd()), onDisk(productRoot)) || '.', file: FILE });

// The edit to a shipped tool, said truthfully. Whether the FILE changed and whether the tool's USE changed
// are two questions: removing a line that did nothing (`"figma": "bogus"`, or one that repeats the
// default) changes the file and not the use.
function sayEdit(tool, was, now, changed) {
  const state = now.used ? 'used here' : 'not used here';
  if (!changed) info(`${tool.name} is already ${state} — nothing to change`);
  else if (was.used === now.used) info(`${tool.name} is already ${state} — removed a line in ${FILE} that did nothing`);
  // The fallback is printed as `list` prints it, after "without it:" — on its own, ECC's ("nothing
  // changes: …") read as if the remove had done nothing.
  else ok(now.used ? `${tool.name} is used here now` : `${tool.name} is not used here now. Without it: ${clean(tool.fallback)}`);
}
// The whole report of an edit to a SHIPPED tool, for both verbs — one function, so `add` and `remove`
// cannot say it differently again. Two facts, each said once: the shipped part (`sayEdit`), and the
// dead custom copies under the tool's id that the same write removed.
function sayShippedEdit(tool, was, now, shippedChanged, copies) {
  if (shippedChanged || !copies) sayEdit(tool, was, now, shippedChanged);
  if (copies) {
    // When only copies went, the tool's use did not change: `customProblems` rejects every custom entry
    // under a shipped tool's id, so no copy ever counted toward using it. If that rule ever changes,
    // this branch must call `sayEdit` too.
    const what = `${copies} custom entr${copies > 1 ? 'ies' : 'y'} under the id ${tool.id}, which ${copies > 1 ? 'were' : 'was'} ignored (the id is a shipped tool's)`;
    info(shippedChanged ? `also removed ${what}` : `removed ${what} — ${tool.name} is still ${now.used ? 'used' : 'not used'} here`);
  }
}
const usedFrom = (shipped, connected) => ({ shipped: new Map(Object.entries(shipped).filter(([, v]) => CHOICES.includes(v))), connected });
const sameId = (id) => (t) => isObject(t) && t.id === id;

export function runToolboxAdd(productRoot, { id, custom = false, json = false, ...flags } = {}) {
  if (!id) return refuse('yad toolbox add needs a tool id', ADD_USAGE, { json });
  if (!TOOL_ID.test(id)) return refuse(`\`${clean(id)}\` is not a tool id`, 'an id is lower-case letters, digits and dashes — `yad toolbox list --json` shows each one', { json });
  const given = CUSTOM_FLAGS.filter((k) => flags[k] !== undefined);
  if (!custom && given.length) return refuse(`--${given[0]} describes a tool of your own, and goes with --custom`, ADD_USAGE, { json });
  const { doc, error } = readToolboxFile(productRoot);
  if (error) return brokenFile(error, json);
  const list = Array.isArray(doc.custom) ? doc.custom : [];
  const tool = shippedTool(id);
  const mine = list.find(sameId(id));
  // In use exactly when `list` says so: `loadChoices` keeps the first USABLE copy, so a broken copy
  // before a good one does not make the tool unused, and a broken copy alone does not make it used.
  const usable = loadChoices(productRoot).custom.some((r) => r.id === id);
  const ignored = () => refuse(`${id} is in ${FILE} but ignored: ${customProblems(mine).join('; ')}`, `fix it by hand, or \`yad toolbox remove ${id}\` and add it again with --custom`, { json });

  if (custom) {
    if (tool) return refuse(`${id} is a shipped tool`, `\`yad toolbox add ${id}\` marks it as used here`, { json });
    if (usable) return refuse(`${id} is already one of this project's tools`, `to change it, \`yad toolbox remove ${id}\` and add it again`, { json });
    if (mine) return ignored();
    const d = parseDetect(flags.detect);
    if (flags.detect === undefined || d.error) return refuse(d.error && flags.detect !== undefined ? d.error : 'a tool of your own needs --detect, so yadflow can tell whether it is here', ADD_USAGE, { json });
    const entry = { id, role: flags.role, fallback: flags.fallback, detect: d.detect };
    if (flags.install !== undefined) {
      const r = parseInstall(flags.install);
      if (r.error) return refuse(r.error, ADD_USAGE, { json });
      entry.install = [r.route];
    }
    if (flags.source !== undefined) entry.source = flags.source;
    const problems = customProblems(entry);
    if (problems.length) return refuse(`cannot add ${id}: ${problems.join('; ')}`, ADD_USAGE, { json });
    save(productRoot, doc, isObject(doc.shipped) ? doc.shipped : {}, [...list, entry]);
    ok(`${id} added — a tool of this project's own, in use here`);
    hand(`written to ${FILE} — commit it so the team shares it (undo with \`yad toolbox remove ${id}\`); \`yad toolbox check\` says whether it is found`);
    return { id, used: true, because: 'custom', changed: true, ...where(productRoot) };
  }

  if (!tool) {
    if (usable) {
      info(`${id} is already one of this project's tools — nothing to change`);
      return { id, used: true, because: 'custom', changed: false, ...where(productRoot) };
    }
    // An entry `list` and `check` ignore is not in use, whatever the file says.
    if (mine) return ignored();
    return refuse(`${id} is not in the toolbox`, '`yad toolbox list --json` shows each id; add a tool of your own with `yad toolbox add <id> --custom …`', { json });
  }
  const connected = connectedTools(productRoot);
  const was = toolUse(tool, loadChoices(productRoot));
  const shipped = setShipped(doc, tool, 'use', connected);
  // A custom entry under a shipped id is ignored; it goes in the same write, as `remove` does it.
  const left = list.filter((t) => !sameId(id)(t));
  const copies = list.length - left.length;
  const shippedChanged = !sameJSON(shipped, doc.shipped);
  const changed = shippedChanged || copies > 0;
  if (changed) save(productRoot, doc, shipped, left);
  const now = toolUse(tool, usedFrom(shipped, connected));
  sayShippedEdit(tool, was, now, shippedChanged, copies);
  // Records only: the person installs it.
  const how = howToGet(tool);
  if (how.length) hand(`to install it: ${how.join('   or   ')}`);
  // An undo is offered only when the tool's use changed: after clearing a line that did nothing, the
  // "opposite" command would switch the tool off, not put anything back.
  if (changed) hand(`written to ${FILE} — commit it so the team shares it${was.used !== now.used ? ` (undo with \`yad toolbox remove ${id}\`)` : ''}; \`yad toolbox check\` says whether it is found`);
  return { id, ...now, changed, ...where(productRoot) };
}

// Removes EVERYTHING the file holds under `id`, in one write: the shipped tool's use, every custom entry
// with that id (a dead one sharing a shipped tool's id included), and a shipped line for a tool this
// release does not ship — so it also clears each line `yad doctor` names as doing nothing.
export function runToolboxRemove(productRoot, { id, json = false, ...flags } = {}) {
  if (!id) return refuse('yad toolbox remove needs a tool id', 'usage: yad toolbox remove <id>', { json });
  const given = CUSTOM_FLAGS.filter((k) => flags[k] !== undefined);
  if (flags.custom || given.length) return refuse(`yad toolbox remove takes only the tool id (got ${flags.custom ? '--custom' : `--${given[0]}`})`, 'usage: yad toolbox remove <id>', { json });
  const { doc, error } = readToolboxFile(productRoot);
  if (error) return brokenFile(error, json);
  const list = Array.isArray(doc.custom) ? doc.custom : [];
  const shipped0 = isObject(doc.shipped) ? doc.shipped : {};
  const tool = shippedTool(id);
  const left = list.filter((t) => !sameId(id)(t));
  const copies = list.length - left.length;
  const deadLine = !tool && Object.hasOwn(shipped0, id);
  if (!tool && !copies && !deadLine) {
    if (!TOOL_ID.test(id)) return refuse(`\`${clean(id)}\` is not a tool id`, 'an id is lower-case letters, digits and dashes — `yad toolbox list --json` shows each one', { json });
    return refuse(`${id} is not in the toolbox`, '`yad toolbox list --json` shows each id', { json });
  }
  if (tool) {
    const connected = connectedTools(productRoot);
    const was = toolUse(tool, loadChoices(productRoot));
    const shipped = setShipped(doc, tool, 'skip', connected);
    const shippedChanged = !sameJSON(shipped, doc.shipped);
    const changed = shippedChanged || copies > 0;
    if (changed) save(productRoot, doc, shipped, left);
    const now = toolUse(tool, usedFrom(shipped, connected));
    sayShippedEdit(tool, was, now, shippedChanged, copies);
    // Removing it from the toolbox does not disconnect it: the connect skill owns that file.
    if (connected.has(id)) info(`${connected.get(id)} still connects it — \`${tool.usedBy[0]}\` changes the connection`);
    if (changed) hand(`written to ${FILE} — commit it so the team shares it${was.used !== now.used ? ` (undo with \`yad toolbox add ${id}\`)` : ''}`);
    return { id, ...now, changed, ...where(productRoot) };
  }
  const usableBefore = loadChoices(productRoot).custom.some((r) => r.id === id);
  const shipped = { ...shipped0 };
  if (deadLine) delete shipped[id];
  save(productRoot, doc, shipped, left);
  if (copies) {
    const many = copies > 1 ? ` (listed ${copies} times; every copy is gone)` : '';
    ok(usableBefore ? `${clean(id)} removed — it was one of this project's own tools${many}` : `removed the entry for ${clean(id)}, which was ignored${many}`);
  }
  if (deadLine) ok(`removed the line for \`${clean(id)}\` under shipped — a tool this yadflow does not ship`);
  hand(`written to ${FILE} — commit it so the team shares it`);
  return { id, used: false, because: null, changed: true, ...where(productRoot) };
}
