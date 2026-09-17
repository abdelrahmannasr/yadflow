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

import { c, fail, hand, info, log, ok, readJSONStrict, run, warn } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { draftRiskMap, parseRiskMap, RISK_MAP_FILE, riskMapFindings } from './riskmap.mjs';

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
function targets(root, name) {
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
    if (hit) return { list: [{ name: hit.name, root: path.resolve(root, hit.path) }] };
    const p = path.resolve(root, name);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return { list: [{ name, root: p }] };
    return { error: `unknown repo: ${name}`, hint: 'name a repo from .sdlc/repos.json (`yad repo list`) or give the path to a code repo' };
  }
  if (repos.length) return { list: repos.map((r) => ({ name: r.name, root: path.resolve(root, r.path) })) };
  if (hasRegistry) return { error: `no repos in ${PROJECT_FILES.reposRegistry}`, hint: 'connect one (`yad setup`), or name the path to a code repo' };
  return { list: [{ name: path.basename(path.resolve(root)), root: path.resolve(root) }] };
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
    if (json) log(JSON.stringify({ ok: false, error: t.error, hint: t.hint }, null, 2));
    else { fail(t.error); hand(t.hint); }
    process.exitCode = 1;
    return { ok: false };
  }
  const { list } = t;

  if (action === 'check') {
    const repos = list.map((t) => ({ name: t.name, root: t.root, ...checkRepo(t.root) }));
    if (json) {
      log(JSON.stringify({ ok: true, repos: repos.map((r) => ({ name: r.name, git: r.git, map: r.map, findings: r.findings })) }, null, 2));
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
      log(JSON.stringify({ ok: !results.some((r) => r.refused), dryRun, repos: results }, null, 2));
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
