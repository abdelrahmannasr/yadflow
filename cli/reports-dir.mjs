// The local reports folder (E180).
//
// A report shows the state of the work at one moment, and goes stale as soon as the work moves on. So
// every report yadflow writes — the standup, the usage and issues reports, the brain view page, and
// later the progress map and the doc sites — is saved on THIS machine only, in one folder beside the
// Product, and never committed or pushed unless the person asks for that themselves:
//
//   acme/
//     product/                    <- the Product (its main checkout)
//     product--EP-x/              <- a worktree of it (#115) — it saves into the same folder below
//     product--reports/           <- the reports folder
//       .gitignore                   `*`, so a folder that ends up inside a git tree is still never added
//       index.html                   the catalog page: every saved report, newest first
//       catalog.json                 the same list as data
//       standup/2026-11-14-0900--standup--team--3-waiting.md
//       usage/2026-11-01-1000--usage--team--all-time.html
//
// A file's name says what it is and what state it shows: `<date>-<time>--<kind>--<scope>--<state>.<ext>`.
// The date comes first, so sorting by name sorts by time. Each part is cut down to `a-z 0-9 -`, so the
// name is the same on every system (Windows refuses `:` and a few other characters).
//
// Where the folder is, first match wins:
//   1. `--out <file>` on the command — that file, exactly as before (the catalog is not touched);
//   2. YAD_REPORTS_DIR — a folder the person chose (for example on another disk);
//   3. `<main checkout>--reports`, beside the Product's main checkout. A run from a worktree, or from a
//      code repo (yad finds the Product first), lands in the same one folder.
//
// The catalog records the Product commit each report was made at, so `yad reports list` can say which
// ones are stale: the Product's epics/ or .sdlc/ changed since then.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJSONStrict, writeJSON } from './lib.mjs';

export const REPORTS_SUFFIX = '--reports';
export const CATALOG_FILE = 'catalog.json';
export const INDEX_FILE = 'index.html';
export const CATALOG_VERSION = 1;
export const REPORTS_ENV = 'YAD_REPORTS_DIR';

// The kinds of report. A kind is also its subfolder's name, so only these are accepted.
export const KINDS = Object.freeze({
  'progress-map': 'Progress map',
  'brain-view': 'Brain view',
  usage: 'Usage report',
  standup: 'Standup',
  issues: 'Issues report',
  'docs-site': 'Docs site',
  timeline: 'Timeline',
  defects: 'Defects report',
  learning: 'Learning tutorial',
  status: 'Status',
  history: 'History',
  claims: 'Claims',
  doctor: 'Doctor',
});

const git = (runner, cwd, args) => {
  const r = runner('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, code: r.status, out: String(r.stdout ?? '').trim() };
};

// The Product's MAIN checkout: for a worktree, the folder that holds the shared .git; else `root` itself.
// Only when `root` is the TOP of its checkout: a Product folder inside some other repo (a test fixture,
// a monorepo) keeps its reports beside itself, never beside that other repo.
export function mainCheckout(root, { runner = spawnSync } = {}) {
  const top = git(runner, root, ['rev-parse', '--show-toplevel']);
  const real = (p) => { let r; try { r = fs.realpathSync.native(p); } catch { r = path.resolve(p); } return process.platform === 'win32' ? r.toLowerCase() : r; };
  if (!top.ok || !top.out || real(top.out) !== real(root)) return path.resolve(root);
  const r = git(runner, root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!r.ok || !r.out) return path.resolve(root);
  const common = path.resolve(root, r.out);
  // A normal checkout keeps its git data in `<checkout>/.git`; anything else (a bare repo) has no
  // checkout to stand beside, so the folder given is used.
  return path.basename(common) === '.git' ? path.dirname(common) : path.resolve(root);
}

// → { dir, via: 'env' | 'beside' }
export function reportsDir(root, { env = process.env, runner = spawnSync } = {}) {
  const chosen = env[REPORTS_ENV];
  if (chosen && String(chosen).trim()) return { dir: path.resolve(String(chosen).trim()), via: 'env' };
  const main = mainCheckout(root, { runner });
  return { dir: path.join(path.dirname(main), `${path.basename(main)}${REPORTS_SUFFIX}`), via: 'beside' };
}

// One part of a name: lower case, `a-z 0-9 -` only, no doubled or end dashes, at most `max` long.
export function slug(s, max = 40) {
  const out = String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max).replace(/-+$/g, '');
  return out || 'none';
}

const pad = (n) => String(n).padStart(2, '0');
// The local date and time, `YYYY-MM-DD-HHmm` — the person reads it in their own time.
export const stamp = (at) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;

const EXT_RE = /^[a-z0-9]{1,8}$/;
export function reportName({ kind, scope, state, at = new Date(), ext }) {
  if (!Object.hasOwn(KINDS, kind)) throw new Error(`unknown report kind: ${kind}`);
  if (!EXT_RE.test(String(ext))) throw new Error(`bad report extension: ${ext}`);
  return `${stamp(at)}--${kind}--${slug(scope, 40)}--${slug(state, 40)}.${ext}`;
}

// A free name in `dir`: `name`, else `name-2`, `name-3`… before the extension.
function freeName(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let i = 2; ; i++) { const n = `${base}-${i}${ext}`; if (!fs.existsSync(path.join(dir, n))) return n; }
}

// Make `dir` (and its parents), refusing a path that exists and is not a plain folder.
function ownDir(dir) {
  let st = null;
  try { st = fs.lstatSync(dir); } catch { /* new */ }
  if (st && !st.isDirectory()) return `${dir} is not a plain folder (a file or a link) — remove it, or set ${REPORTS_ENV}`;
  fs.mkdirSync(dir, { recursive: true });
  return null;
}

// Write by a temp file and a rename, never through a link.
function writeNew(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.rmSync(tmp, { force: true });
  try {
    fs.writeFileSync(tmp, content, { flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}

// The `.gitignore` that keeps the folder out of any git tree it may sit in. Written once; a person's own
// edit to it is left alone.
function ensureIgnored(dir) {
  const f = path.join(dir, '.gitignore');
  if (!fs.existsSync(f)) writeNew(f, '# yadflow reports — local to this machine, never committed (E180)\n*\n');
}

// The catalog, or `{ problem }` when the file is there and cannot be read: it is never overwritten then.
export function readCatalog(dir) {
  const file = path.join(dir, CATALOG_FILE);
  let rec;
  try { rec = readJSONStrict(file, null); } catch (e) { return { problem: `${file} cannot be read (${e.message.split('\n')[0]}) — fix or remove it; the catalog was not changed` }; }
  if (rec === null) return { entries: [] };
  if (typeof rec !== 'object' || Array.isArray(rec) || !Array.isArray(rec.entries)) return { problem: `${file} is not a reports catalog — fix or remove it; the catalog was not changed` };
  if (rec.version !== CATALOG_VERSION) return { problem: `${file} is version ${JSON.stringify(rec.version ?? null)}, and this yadflow reads version ${CATALOG_VERSION} — the catalog was not changed` };
  return { entries: rec.entries.filter((e) => e && typeof e.file === 'string') };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// The catalog page. Static: no script, no network; links are relative, so the folder can be moved.
export function renderIndex(entries) {
  const kinds = [...new Set(entries.map((e) => e.kind))].sort((a, b) => (KINDS[a] || a).localeCompare(KINDS[b] || b));
  const section = (k) => {
    const rows = entries.filter((e) => e.kind === k).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return `<h2>${esc(KINDS[k] || k)} <small>${rows.length}</small></h2>\n<table><tr><th>Report</th><th>Scope</th><th>State</th><th>Made</th><th>Product at</th></tr>\n${rows.map((e) =>
      `<tr><td><a href="${esc(e.file.split('/').map(encodeURIComponent).join('/'))}">${esc(path.posix.basename(e.file))}</a>${e.anonymous ? ' <span class="tag">anonymous</span>' : ''}</td><td>${esc(e.scope)}</td><td>${esc(e.state)}</td><td>${esc(String(e.createdAt).replace('T', ' ').slice(0, 16))}</td><td><code>${esc(e.productSha ? e.productSha.slice(0, 10) : '—')}</code> ${esc(e.productBranch || '')}</td></tr>`).join('\n')}\n</table>`;
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Saved reports</title>
<style>
:root{--bg:#fbfbfd;--ink:#1d2333;--muted:#667089;--line:#e3e6ee;--tag:#eef1f8;--link:#2457c5}
@media (prefers-color-scheme: dark){:root{--bg:#0d111c;--ink:#e6eaf4;--muted:#8d97ad;--line:#232a3b;--tag:#1b2233;--link:#8fb6ff}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}p{color:var(--muted);margin:0 0 18px}
h2{font-size:15px;margin:26px 0 8px}h2 small{color:var(--muted);font-weight:500}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}th,td{text-align:left;padding:6px 10px;border-top:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:12px;border-top:0}a{color:var(--link)}
.tag{background:var(--tag);border-radius:4px;padding:1px 6px;font-size:12px;color:var(--muted)}code{font-size:12px}
</style></head><body><main>
<h1>Saved reports</h1>
<p>Each report shows the state of the work when it was made. They are kept on this machine only and never committed. Run <code>yad reports list</code> to see which ones are stale.</p>
${entries.length ? kinds.map(section).join('\n') : '<p>No reports saved yet.</p>'}
</main></body></html>
`;
}

function productAt(root, runner) {
  const sha = git(runner, root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  const br = git(runner, root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return { productSha: sha.ok && /^[0-9a-f]{40,64}$/.test(sha.out) ? sha.out : null, productBranch: br.ok && br.out !== 'HEAD' ? br.out : null };
}

// Save one report into the folder and add it to the catalog.
//   → { file, dir, name, warnings: [] }  |  { problem }
// The report is written even when the catalog cannot be read: the person asked for the report, and
// the broken catalog is named in a warning, never overwritten.
export function saveReport(root, { kind, scope, state, ext, content, command = null, anonymous = false, at = new Date(), env = process.env, runner = spawnSync } = {}) {
  const { dir } = reportsDir(root, { env, runner });
  const sub = path.join(dir, kind);
  const problem = ownDir(dir) || ownDir(sub);
  if (problem) return { problem };
  ensureIgnored(dir);
  const name = freeName(sub, reportName({ kind, scope, state, at, ext }));
  const file = path.join(sub, name);
  writeNew(file, content);
  const warnings = [];
  const cat = readCatalog(dir);
  if (cat.problem) warnings.push(cat.problem);
  else {
    const entry = { file: `${kind}/${name}`, kind, scope: String(scope ?? ''), state: String(state ?? ''), createdAt: at.toISOString(), ...productAt(root, runner), anonymous: !!anonymous, command };
    const entries = [...cat.entries, entry];
    writeJSON(path.join(dir, CATALOG_FILE), { version: CATALOG_VERSION, entries });
    writeNew(path.join(dir, INDEX_FILE), renderIndex(entries));
  }
  return { file, dir, name, warnings };
}

// Is a report stale? → 'fresh' | 'stale' | 'unknown'. Stale: the Product's epics/ or .sdlc/ changed
// between the commit the report was made at and the Product's HEAD now. Changes not yet committed are
// not counted — the record is what is committed.
export function freshness(root, sha, { runner = spawnSync } = {}) {
  if (!sha || !/^[0-9a-f]{40,64}$/.test(sha)) return 'unknown';
  const r = git(runner, root, ['diff', '--quiet', sha, 'HEAD', '--', 'epics', '.sdlc']);
  return r.code === 0 ? 'fresh' : r.code === 1 ? 'stale' : 'unknown';
}

// Every catalog entry, newest first, with `n` (1 = newest), whether its file is still there, and its freshness.
export function listReports(root, { env = process.env, runner = spawnSync } = {}) {
  const { dir, via } = reportsDir(root, { env, runner });
  if (!fs.existsSync(dir)) return { dir, via, entries: [] };
  const cat = readCatalog(dir);
  if (cat.problem) return { dir, via, problem: cat.problem };
  const entries = [...cat.entries]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((e, i) => ({ n: i + 1, ...e, present: insideDir(dir, e.file) && fs.existsSync(path.join(dir, e.file)), freshness: freshness(root, e.productSha, { runner }) }));
  return { dir, via, entries };
}

// A catalog path must stay inside the folder: a hand-edited `../x` is never opened or deleted.
function insideDir(dir, rel) {
  if (typeof rel !== 'string' || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return false;
  const full = path.resolve(dir, rel);
  return full.startsWith(path.resolve(dir) + path.sep);
}

// The entries `prune` would remove: older than `days`, or whose file is gone.
export function pruneReports(root, { days, apply = false, now = Date.now(), env = process.env, runner = spawnSync } = {}) {
  const { dir } = reportsDir(root, { env, runner });
  if (!fs.existsSync(dir)) return { dir, removed: [], kept: 0 };
  const cat = readCatalog(dir);
  if (cat.problem) return { dir, problem: cat.problem };
  const cut = now - days * 864e5;
  const old = (e) => { const t = Date.parse(e.createdAt); return Number.isFinite(t) && t < cut; };
  const gone = (e) => !insideDir(dir, e.file) || !fs.existsSync(path.join(dir, e.file));
  const removed = cat.entries.filter((e) => old(e) || gone(e));
  const kept = cat.entries.filter((e) => !removed.includes(e));
  if (apply && removed.length) {
    for (const e of removed) {
      if (!insideDir(dir, e.file)) continue;
      const f = path.join(dir, e.file);
      let st = null; try { st = fs.lstatSync(f); } catch { /* already gone */ }
      if (st && (st.isFile() || st.isSymbolicLink())) fs.rmSync(f, { force: true });
    }
    writeJSON(path.join(dir, CATALOG_FILE), { version: CATALOG_VERSION, entries: kept });
    writeNew(path.join(dir, INDEX_FILE), renderIndex(kept));
  }
  return { dir, removed: removed.map((e) => ({ file: e.file, createdAt: e.createdAt, reason: gone(e) ? 'missing' : 'old' })), kept: kept.length };
}

// A command's report: to `out` when the person named a file (exactly as before E180, no catalog), else
// saved into the reports folder. → { file, warnings } | { problem }
export function writeOrSave(root, { out = null, ...rest }) {
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, rest.content);
    return { file: out, warnings: [], own: true };
  }
  return saveReport(root, rest);
}
