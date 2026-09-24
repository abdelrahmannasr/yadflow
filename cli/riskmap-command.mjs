// `yad risk-map check|draft [<repo>]` — the risk map of a code repo (E65). The rules live in
// cli/riskmap.mjs; this finds the repos, lists their files, prints and writes.
//
// `draft` only ADDS: an `unset` line for every directory nothing covers. It never changes a line that is
// already there, so a level a person confirmed is never overwritten. Classifying the `unset` lines is the
// `yad-connect-repos` skill's job — an AI agent reads the code, which this command cannot do.
//
// `check` is the local twin of `checks/risk-map-check.sh`, over the whole repo instead of one change.
// It is advisory like the CI check: it prints warnings and never sets a failing exit code for them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { c, fail, hand, info, log, ok, readJSONStrict, run, warn, emitJSON } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { changeLevel, draftRiskMap, folderPathspec, highTouched, parseRiskMap, pathspecsFor, rankAuthors, recentAuthors, RISK_MAP_FILE, riskMapFindings, touchedFolders } from './riskmap.mjs';

// Every file in a code repo, as the map sees it: tracked files plus new files git does not ignore, so a
// directory someone has just created is asked about before it is committed. null when it is not a git repo.
export function repoFiles(repoRoot) {
  // Not `run`: it trims stdout, and ` notes/a.md` sorts first, so its leading space would be lost. And a
  // large repo's list is many megabytes; spawnSync's default 1 MiB buffer would fail it as "not a git repo".
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) return null;
  return [...new Set(r.stdout.split('\0').filter(Boolean))];
}

export function readRiskMap(repoRoot) {
  const file = path.join(repoRoot, RISK_MAP_FILE);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// The repos to act on: { list } or { error, hint }. A name from `.sdlc/repos.json` first; else a path to a
// code repo; with neither, every connected repo — or the directory itself, but ONLY when there is no
// registry file at all (run inside a code repo). A registry that is empty or does not parse is a Product
// with no repos to name, and `draft` must never fall back to writing a map into the Product itself.
// Each entry carries the registry's `platform` when it has one (`yad codeowners check` reads it).
export function targets(root, name) {
  const regFile = path.join(root, PROJECT_FILES.reposRegistry);
  const hasRegistry = fs.existsSync(regFile);
  let registry = { repos: [] };
  if (hasRegistry) {
    try {
      registry = readJSONStrict(regFile, { repos: [] });
    } catch {
      return { error: `${PROJECT_FILES.reposRegistry} does not parse`, hint: 'fix the JSON (`yad doctor`), or name the path to a code repo' };
    }
  }
  const repos = Array.isArray(registry?.repos) ? registry.repos.filter((r) => r && typeof r.name === 'string' && typeof r.path === 'string' && r.path) : [];
  if (name) {
    const hit = repos.find((r) => r.name === name);
    if (hit) return { list: [{ name: hit.name, root: path.resolve(root, hit.path), platform: hit.platform || null }] };
    const p = path.resolve(root, name);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return { list: [{ name, root: p }] };
    return { error: `unknown repo: ${name}`, hint: 'name a repo from .sdlc/repos.json (`yad repo list`) or give the path to a code repo' };
  }
  if (repos.length) return { list: repos.map((r) => ({ name: r.name, root: path.resolve(root, r.path), platform: r.platform || null })) };
  if (hasRegistry) return { error: `no repos in ${PROJECT_FILES.reposRegistry}`, hint: 'connect one (`yad setup`), or name the path to a code repo' };
  return { list: [{ name: path.basename(path.resolve(root)), root: path.resolve(root) }] };
}

// E66 — the level the change on HEAD takes from the map on `baseRef` (the twin of
// `checks/risk-map-check.sh --level`). The map is read from the BASE, never the working tree, so a change
// cannot lower its own count; the files are every path changed since HEAD left the base (three dots),
// deletions and moves included. Returns { base, files, level, step, dirs } from `changeLevel`, or
// { base, noMap: why } when the base holds no map (nothing adds a step), or { base, unknown: why } when
// the level cannot be read — which a caller must say, never read as zero.
export function baseChangeLevel(repoRoot, baseRef) {
  const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30 });
  const base = baseRef;
  if (git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]).status !== 0 || git(['merge-base', baseRef, 'HEAD']).status !== 0) {
    return { base, unknown: `base ref '${baseRef}' not found, or it shares no history with HEAD (a shallow clone?)` };
  }
  // Only a real file is a map: `git show` would print a symlink's target as if it were the text.
  // --full-tree: ls-tree reads a path from the current folder, so from a subfolder it would find no map.
  const entry = git(['ls-tree', '--full-tree', baseRef, '--', RISK_MAP_FILE]).stdout || '';
  if (!entry) return { base, noMap: `'${baseRef}' has no ${RISK_MAP_FILE}` };
  if (!/^100(644|755) blob /.test(entry)) return { base, noMap: `'${baseRef}' holds ${RISK_MAP_FILE}, but not as a file` };
  const text = git(['show', `${baseRef}:${RISK_MAP_FILE}`]);
  const diff = git(['diff', '--name-only', '-z', '--no-renames', `${baseRef}...HEAD`]);
  if (text.status !== 0 || diff.status !== 0) return { base, unknown: `git could not read ${baseRef}` };
  const files = diff.stdout.split('\0').filter(Boolean);
  const parsed = parseRiskMap(text.stdout);
  const got = changeLevel(parsed, files);
  if (got.unsupported) return { base, unknown: `the map on ${baseRef} is written for a newer risk-map version` };
  // `entries` and `changed` are what E67's history query needs next, and reading the map twice could read
  // two different maps (the base can move between the calls).
  return { base, files: files.length, entries: parsed.entries, changed: files, ...got };
}

// The environment for a git call that carries pathspecs. Four variables change how git reads EVERY
// pathspec: `GIT_LITERAL_PATHSPECS` makes `:(glob)src/*` match nothing (and git still exits 0, so the
// answer would read as "nobody"), `GIT_ICASE_PATHSPECS` makes `src/` match `SRC/` (the wrong people),
// and the glob pair changes what `*` means. The pathspecs here say exactly what they mean, so none of
// the four may reach git.
export const PATHSPEC_ENV = ['GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'];
export function gitEnv() {
  const env = { ...process.env };
  for (const k of PATHSPEC_ENV) delete env[k];
  return env;
}

// Git's own words for E67's window (Part 3: expertise is a fixed, tight 30 days).
export const HISTORY_WINDOW = '30 days ago';

// E67 — the people with recent commits in the `high` directories this change touches, read from the BASE
// branch's history so a change cannot add its own. ONE QUERY PER DIRECTORY, each carrying the pathspecs
// that describe that directory as the map sees it (`pathspecsFor`), so git applies the cover rule and
// returns author records only — no file names are read back, which is what let an odd path name the
// wrong person. `window` is handed to git as written (`--since`), and git filters on the COMMITTER date,
// so a rebased or squashed commit counts from when it landed.
// Returns { authors: [{ name, login }] } — the people in map order of the directory they worked in,
// newest first within each, nobody twice — or { unknown: why }, never an empty list for a history it
// could not read: a shallow clone holds only the newest commits, and reading that as "nobody has worked
// here" would drop the ask instead of raising it. The twin is `--level` in checks/risk-map-check.sh.
export function recentAuthorsFor(repoRoot, baseRef, { entries, changed, window = HISTORY_WINDOW } = {}) {
  const h = historyReader(repoRoot, baseRef);
  if (h.unknown) return h;
  const commits = [];
  for (const e of highTouched(entries, changed)) {
    const got = h.authorRecords(pathspecsFor(entries, e.dir), window);
    if (!got) return { unknown: `git could not read the history of '${e.dir}' on '${baseRef}'` };
    commits.push(...got);
  }
  return { authors: recentAuthors(commits, h.own) };
}

// The one git reader behind E67's ask and E68's suggestion. Returns { unknown: why } for a history it
// cannot read — a shallow clone holds only the newest commits, and reading that as "nobody has worked
// here" would be a guess — or { own, authorRecords }: the addresses of the change's own authors (left out
// of every answer: an approval, and a suggestion, have to be someone else), and a function that runs ONE
// log on the base branch for a set of pathspecs and returns its author records, or null when git fails.
// `what` names what a shallow clone lacks, for the sentence (E69 reads a whole branch, not directories).
function historyReader(repoRoot, baseRef, { what = 'those directories' } = {}) {
  const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30, env: gitEnv() });
  if (/true/.test(git(['rev-parse', '--is-shallow-repository']).stdout || '')) {
    return { unknown: `this is a shallow clone — it does not hold the history of ${what}` };
  }
  const own = git(['log', `${baseRef}..HEAD`, '--no-merges', '--format=%ae']);
  if (own.status !== 0) return { unknown: `git could not read the history of '${baseRef}'` };
  const authorRecords = (pathspecs, window) => {
    // --no-merges: a merge commit is nobody's work here. --no-renames: a file moved OUT of the directory
    // is work in it, counted where it was (E66). --full-history: without it git simplifies a
    // path-filtered log and hides a side branch whose merge kept the other side.
    // --no-show-signature: `log.showSignature=true` (common where commits are signed) prints a signature
    // check for each commit into this output, and each such line would read as a person.
    // --no-follow: `log.follow=true` makes git crash on a single `:(glob)dir/*` pathspec (E68's kind; E67's
    // `:(literal)` ones are unaffected), which would read every one-folder suggestion as "not read".
    const r = git(['log', baseRef, '--no-merges', '--no-renames', '--full-history', '--no-show-signature', '--no-follow', `--since=${window}`,
      '--format=%an%x1f%ae', '--', ...pathspecs]);
    if (r.status !== 0) return null;
    return r.stdout.split('\n').filter(Boolean).map((line) => {
      const [name, email] = line.split('\x1f');
      return { name, email };
    });
  };
  return { own: own.stdout.split('\n').filter(Boolean), authorRecords };
}

// E68 — the files this change touches, deletions and moves included (E66's range: three dots, from where
// the branch left its base, `--no-renames`, NUL-separated so an odd name is never quoted). Read WITHOUT the
// risk map, because most repos have none and a suggestion does not need one. { files } or { unknown }.
export function changedSince(repoRoot, baseRef) {
  const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]).status !== 0 || git(['merge-base', baseRef, 'HEAD']).status !== 0) {
    return { unknown: `base ref '${baseRef}' not found, or it shares no history with HEAD (a shallow clone?)` };
  }
  const diff = git(['diff', '--name-only', '-z', '--no-renames', `${baseRef}...HEAD`]);
  if (diff.status !== 0) return { unknown: `git could not read the change against ${baseRef}` };
  return { files: diff.stdout.split('\0').filter(Boolean) };
}

// How many folders one suggestion asks git about. Every folder goes into ONE log, so the cost does not
// grow with the count; the cap only keeps the command line short. A cut is always printed.
export const SUGGEST_FOLDER_CAP = 200;

// E68 — who has committed in the folders this change touches, in the window: a SUGGESTION of who may know
// the code, never an ask, never a request. The files DIRECTLY in each touched folder (`folderPathspec`),
// all in one log, so a commit touching two of them is counted once. Returns { authors: [{ name, login,
// commits }], folders, skipped } or { unknown: why } — never an empty list for a history it could not read.
export function suggestedAuthorsFor(repoRoot, baseRef, { changed, window = HISTORY_WINDOW, cap = SUGGEST_FOLDER_CAP } = {}) {
  const all = touchedFolders(changed);
  const folders = all.slice(0, cap);
  if (!folders.length) return { authors: [], folders: 0, skipped: 0 };
  const h = historyReader(repoRoot, baseRef);
  if (h.unknown) return h;
  const got = h.authorRecords(folders.map(folderPathspec), window);
  if (!got) return { unknown: `git could not read the history of '${baseRef}'` };
  return { authors: rankAuthors(got, h.own), folders: folders.length, skipped: all.length - folders.length };
}

// E69's window for the "owner seems inactive" hint: longer than E67's 30 days, so a person on leave or
// busy in another repo for a month is not named.
export const OWNER_WINDOW = '90 days ago';

// E69 — the platform logins that committed on `ref` in the window, read from noreply commit addresses:
// [{ login, host }], host 'github' or 'gitlab'. The whole history of `ref` (no pathspec — work anywhere in
// the repo counts), through the one reader E67 and E68 share, so the shallow-clone refusal and the robot
// rule are the same code. With `ref` HEAD there is no change of one's own to leave out. { unknown: why }
// for a history it cannot read, never an empty list.
export function recentLoginsFor(repoRoot, ref = 'HEAD', { window = OWNER_WINDOW } = {}) {
  const h = historyReader(repoRoot, ref, { what: 'this branch' });
  if (h.unknown) return h;
  const got = h.authorRecords([], window);
  if (!got) return { unknown: `git could not read the history of '${ref}'` };
  return { logins: rankAuthors(got).filter((a) => a.login).map((a) => ({ login: a.login, host: a.loginHost })) };
}

export function checkRepo(repoRoot) {
  const text = readRiskMap(repoRoot);
  // No map: nothing to check, so the repo's file list (slow on a large repo) is never read.
  if (text === null) return { git: run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot }).ok, map: false, findings: [] };
  const files = repoFiles(repoRoot);
  if (!files) return { git: false, map: true, findings: [] };
  const parsed = parseRiskMap(text);
  return { git: true, map: true, entries: parsed.entries, findings: riskMapFindings(parsed, { files }) };
}

const findingLine = (f) => `${c.bold(f.code)}${f.target ? ` ${f.target}` : ''}: ${f.message}`;

export async function runRiskMap(root, { action = 'check', name, json = false, dryRun = false } = {}) {
  const t = targets(root, name);
  if (t.error) {
    if (json) emitJSON({ ok: false, error: t.error, hint: t.hint });
    else { fail(t.error); hand(t.hint); }
    process.exitCode = 1;
    return { ok: false };
  }
  const { list } = t;

  if (action === 'check') {
    const repos = list.map((t) => ({ name: t.name, root: t.root, ...checkRepo(t.root) }));
    if (json) {
      emitJSON({ ok: true, repos: repos.map((r) => ({ name: r.name, git: r.git, map: r.map, findings: r.findings })) });
      return { ok: true, repos };
    }
    for (const r of repos) {
      log(c.bold(`\nrisk map — ${r.name}`));
      if (!r.git) { warn(`${r.root} is not a git repo — skipped`); continue; }
      if (!r.map) { info(`no ${RISK_MAP_FILE} yet — no directory has a risk level`); hand(`draft one with \`yad risk-map draft ${r.name}\``); continue; }
      if (!r.findings.length) { ok('every directory has a confirmed level'); continue; }
      for (const f of r.findings) warn(findingLine(f));
      hand(`fix ${RISK_MAP_FILE} in ${r.name} and commit it through a PR — the warnings are advisory and block nothing`);
    }
    return { ok: true, repos };
  }

  if (action === 'draft') {
    const results = [];
    for (const t of list) {
      const files = repoFiles(t.root);
      if (!files) { results.push({ name: t.name, git: false, added: [], written: false }); continue; }
      const before = readRiskMap(t.root);
      const d = draftRiskMap(before, files);
      const changed = !d.refused && d.text !== before;
      if (changed && !dryRun) {
        fs.mkdirSync(path.join(t.root, '.sdlc'), { recursive: true });
        fs.writeFileSync(path.join(t.root, RISK_MAP_FILE), d.text);
      }
      results.push({ name: t.name, git: true, added: d.added, unwritable: d.unwritable, refused: d.refused, written: changed && !dryRun });
    }
    if (json) {
      emitJSON({ ok: !results.some((r) => r.refused), dryRun, repos: results });
    } else {
      for (const r of results) {
        log(c.bold(`\nrisk map — ${r.name}`));
        if (!r.git) { warn('not a git repo — skipped'); continue; }
        if (r.refused) { fail(`${RISK_MAP_FILE} is ${r.refused} — nothing was written over it`); continue; }
        if (r.unwritable.length) warn(`not added — a map line cannot hold these names (a space, \`#\`, \`*\`, \`?\`, \`[\` or \`\\\`): ${r.unwritable.join(' ')}; rename them to give them a level`);
        if (!r.added.length) { ok('every directory already has a line — nothing to add'); continue; }
        (r.written ? ok : info)(`${r.written ? 'added' : 'would add'} ${r.added.length} unset line(s): ${r.added.join(' ')}`);
      }
      if (results.some((r) => r.added.length)) {
        hand('classify the `unset` lines: ask your AI agent to run the risk-map step of yad-connect-repos (it reads the code), or set them by hand');
        hand(`then review every \`guessed\` level, change the right ones to \`confirmed\`, and commit ${RISK_MAP_FILE} in the code repo through a PR`);
      }
    }
    if (results.some((r) => r.refused)) process.exitCode = 1;
    return { ok: !results.some((r) => r.refused), repos: results };
  }

  fail(`unknown risk-map action: ${action} (check | draft)`);
  process.exitCode = 1;
  return { ok: false };
}
