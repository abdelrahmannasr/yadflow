// `yad repo features [<repo>] [--max <n>] [--json]` (EP-foundation-first-epic-S03): the candidate feature
// boundaries of each connected repo, with their size — the starting list a pack epic's stories are shaped
// from. READ-ONLY: it writes nothing, makes no network call (no fetch), and does not read the code map.
//
// It reads the files COMMITTED at HEAD (`git ls-tree`), never the working tree or the index, so a file
// changed or added but not committed changes nothing. Lines are counted from the same commit
// (`git grep -I -c`), text files only. The shape is the epic's locked contract (`FeatureBoundary`).
import { spawnSync } from 'node:child_process';
import { c, hand, info, log, run, warn } from './lib.mjs';
import { judgeRepo, shown } from './workspace.mjs';

export const FEATURES_MAX = Object.freeze({ default: 25, min: 1, max: 200 });

// The folders a codebase keeps its features under, when it has them.
const CONTAINERS = ['src', 'lib', 'packages', 'apps'];
// Left out wherever they sit: tests, docs, build output, dependencies, and tool config.
const SKIP_DIRS = new Set([
  'test', 'tests', '__tests__', '__test__', 'spec', 'specs', 'e2e', 'cypress', 'fixtures', '__fixtures__', '__mocks__',
  'doc', 'docs', 'documentation', 'examples', 'example',
  'dist', 'build', 'out', 'coverage', 'target', 'bin-release', 'node_modules', 'vendor', 'tmp',
]);
const SKIP_FILE = /(?:\.|_)(?:test|spec)\.[^/]+$|_test\.go$/;

// Heavy repos list many files: the default 1 MB buffer would cut the answer short.
const BIG = 512 * 1024 * 1024;
const git = (cwd, ...args) => run('git', args, { cwd, maxBuffer: BIG });
// The two reads whose output is a list of paths: not trimmed (a path may start with a space), and with the
// person's own git settings that would change it switched off (colour, full names).
const gitRaw = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'color.ui=never', '-c', 'color.grep=never', '-c', 'grep.fullName=false', ...args], { cwd, encoding: 'utf8', maxBuffer: BIG });
  return { code: r.status, stdout: r.stdout || '', stderr: (r.stderr || '').trim() };
};

// Is this path (repo-relative, `/`-separated) feature code at all?
function counted(p) {
  const parts = p.split('/');
  if (parts.length < 2) return false;                                  // a top-level file: config or a readme
  if (parts.slice(0, -1).some((d) => d.startsWith('.') || SKIP_DIRS.has(d.toLowerCase()))) return false;
  return !SKIP_FILE.test(parts.at(-1));
}

// The boundary a path belongs to: `src/<x>/…` → x (paths `src/x/**`), else the top-level folder. A file
// directly in a container (`src/main.ts`) is the container's own boundary (`src/*`).
function boundaryOf(p, useContainers) {
  const parts = p.split('/');
  if (useContainers && CONTAINERS.includes(parts[0])) {
    return parts.length > 2 ? { key: `${parts[0]}/${parts[1]}`, name: parts[1], glob: `${parts[0]}/${parts[1]}/**` }
      : { key: parts[0], name: parts[0], glob: `${parts[0]}/*` };
  }
  return { key: parts[0], name: parts[0], glob: `${parts[0]}/**` };
}

// Pure: the paths (with their line counts) into at most `max` rows, biggest first, the smallest grouped as
// `other` past the cap. Exported for the tests.
export function groupBoundaries(files, lines = new Map(), { max = FEATURES_MAX.default } = {}) {
  const kept = files.filter(counted);
  const useContainers = kept.some((p) => CONTAINERS.includes(p.split('/')[0]));
  const pool = useContainers ? kept.filter((p) => CONTAINERS.includes(p.split('/')[0])) : kept;
  const by = new Map();
  for (const p of pool) {
    const b = boundaryOf(p, useContainers);
    const row = by.get(b.key) ?? { name: b.name, key: b.key, paths: [b.glob], files: 0, lines: 0 };
    row.files += 1;
    row.lines += lines.get(p) ?? 0;
    by.set(b.key, row);
  }
  // Two containers holding the same name (`apps/web`, `packages/web`) are named by their path instead.
  const names = new Map();
  for (const r of by.values()) names.set(r.name, (names.get(r.name) ?? 0) + 1);
  let rows = [...by.values()].map((r) => ({ name: names.get(r.name) > 1 ? r.key : r.name, paths: r.paths, files: r.files, lines: r.lines }));
  if (!rows.length) {
    // Nothing in a folder: one row for what there is, so the list is never silently empty.
    const top = files.filter((p) => !p.includes('/'));
    return top.length ? [{ name: '(top level)', paths: ['*'], files: top.length, lines: top.reduce((n, p) => n + (lines.get(p) ?? 0), 0) }] : [];
  }
  rows.sort((a, b) => b.lines - a.lines || b.files - a.files || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const rest = rows.slice(max - 1);
  return [...head, {
    name: 'other',
    paths: rest.flatMap((r) => r.paths),
    files: rest.reduce((n, r) => n + r.files, 0),
    lines: rest.reduce((n, r) => n + r.lines, 0),
    grouped: rest.length,
  }];
}

// The default branch, as `yad repo sync` reads it: the registry's word, else origin/HEAD, else `main`.
function defaultBranch(cwd, repo) {
  const okName = (b) => typeof b === 'string' && b !== '' && !/^[-+]/.test(b) && git(cwd, 'check-ref-format', `refs/heads/${b}`).ok;
  if (repo.default_branch != null && repo.default_branch !== '') return okName(repo.default_branch) ? repo.default_branch : null;
  const r = git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  const b = r.ok && r.stdout ? r.stdout.replace(/^origin\//, '') : 'main';
  return okName(b) ? b : null;
}

// One repo's row: `{ repo, head, behind, features, problem? }`.
function repoRow(root, entry, max) {
  const j = judgeRepo(root, entry);
  const repo = j.name;
  const none = (problem, extra = {}) => ({ repo, head: null, behind: null, features: [], problem, ...extra });
  if (j.state === 'missing') return none(`no local clone at ${j.path} — clone it with \`yad repo clone\``);
  if (j.state !== 'present' || j.linked) return none(j.linked ? 'a folder on its path, inside a repo, is a link, so it is not read' : j.reason || 'not readable');
  const cwd = j.target;
  const head = git(cwd, 'rev-parse', '--verify', '--quiet', '--short', 'HEAD^{commit}');
  if (!head.ok || !head.stdout) return none('no commit yet — nothing to list (a bootstrap story makes it)');
  // `-z`: a path is never split or quoted. Paths are relative to the repo's folder, which for a repo kept
  // inside another checkout (`apps/web`) is its own subtree.
  // `<mode> <type> <object>\t<path>` per entry; only blobs are files (a submodule is a `commit` entry).
  const tree = gitRaw(cwd, 'ls-tree', '-r', '-z', 'HEAD');
  if (tree.code !== 0) return none(`git could not list HEAD: ${shown(tree.stderr.split('\n')[0] || 'no reason given')}`);
  const files = [];
  for (const rec of tree.stdout.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab > 0 && rec.slice(0, tab).split(' ')[1] === 'blob') files.push(rec.slice(tab + 1));
  }
  // `HEAD:<path>\0<count>\n` per text file (`-I` skips binaries). Exit 1 is "no text file"; anything else
  // is an error, said as one rather than read as zero lines.
  const lines = new Map();
  const counts = gitRaw(cwd, 'grep', '--no-color', '-I', '-c', '-z', '-e', '', 'HEAD', '--', '.');
  if (counts.code !== 0 && counts.code !== 1) return none(`git could not count lines at HEAD: ${shown(counts.stderr.split('\n')[0] || 'no reason given')}`);
  for (const [, where, n] of counts.stdout.matchAll(/([^\0]*)\0(\d+)\n/g)) lines.set(where.replace(/^HEAD:/, ''), Number(n));
  const branch = defaultBranch(cwd, entry);
  let behind = null;
  if (branch && git(cwd, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).ok) {
    const r = git(cwd, 'rev-list', '--count', `HEAD..refs/remotes/origin/${branch}`);
    if (r.ok && /^\d+$/.test(r.stdout)) behind = Number(r.stdout);
  }
  return { repo, head: head.stdout, behind, branch, features: groupBoundaries(files, lines, { max }) };
}

const num = (n) => n.toLocaleString('en-US');

// `max` is checked by the caller (bin/yad.mjs). `name` limits the run to one connected repo.
export function repoFeatures(root, entries, { name = null, max = FEATURES_MAX.default } = {}) {
  const chosen = name ? entries.filter((r) => r.name === name) : entries;
  return chosen
    .filter((r) => judgeRepo(root, r).state !== 'product')
    .map((r) => repoRow(root, r, max));
}

export function printFeatures(rows) {
  for (const r of rows) {
    if (r.problem) { warn(`${r.repo}  ${r.problem}`); continue; }
    log(`\n  ${c.bold(r.repo)}  ${shown(r.head)}  ${c.dim('(tracked files at HEAD)')}`);
    if (r.behind) warn(`${r.behind} commit${r.behind === 1 ? '' : 's'} behind origin/${r.branch} — pull to list the latest`);
    if (!r.features.length) { info(c.dim('no feature folders (only tests, docs, build output or config)')); continue; }
    const plural = (n, word) => `${num(n)} ${word}${n === 1 ? '' : 's'}`;
    // Names and paths come from the repo's own files, which anyone can commit: cleaned for the terminal.
    const cells = r.features.map((f) => [shown(f.name), f.grouped !== undefined ? plural(f.grouped, 'group') : '', plural(f.files, 'file'), plural(f.lines, 'line'), f.grouped !== undefined ? '' : f.paths.map(shown).join(' ')]);
    const widths = [0, 1, 2, 3].map((i) => Math.max(...cells.map((row) => row[i].length)));
    for (const row of cells) {
      log(`    • ${row.slice(0, 4).map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).filter((cell, i) => i !== 1 || widths[1]).join('  ')}${row[4] ? `   ${row[4]}` : ''}`);
    }
  }
  if (rows.some((r) => !r.problem)) hand('a starting list: rename, merge or split these before the pack epic\'s stories are written');
}

// The `--json` row drops the branch, which the contract does not carry.
export const featuresJSON = (rows) => rows.map(({ branch, ...r }) => r);   // eslint-disable-line no-unused-vars
