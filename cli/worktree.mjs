// `yad worktree add|list|remove <epic>` (issue #115): one git worktree per epic, so AI agents working
// different epics at the same time each have their own folder and HEAD, and cannot change each other's
// files. The user's decisions (2026-10-25):
//   - the worktree sits BESIDE the checkout it is made from: `<workspace>/<product>--EP-x/` and
//     `<workspace>/<repo>--EP-x/`, so the `../<repo>` paths in repos.json and the workspace file still work;
//   - it starts DETACHED at origin/<default>; the step skills make their usual branches inside it, so the
//     Product stays trunk-based (E133);
//   - the Product and the code repos both; a code repo's ignored node_modules are linked, not reinstalled;
//   - `remove` refuses while the worktree holds work (changes, untracked files, commits on no remote, a
//     lock, an operation half done, or the person standing in it), with no override: the fix is printed,
//     and plain `git worktree remove --force` stays the person's own choice.
//
// A worktree is yad's when its own git folder holds the record (cli/worktree-record.mjs). The rules are
// the PURE planners below (`worktreePath`, `planAdd`, `planRemove`); the commands read git, call them,
// and act.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ok, info, warn, hand, run, readJSON, writeJSON, isPlainObject, forTerminal } from './lib.mjs';
import { err } from './errors.mjs';
import { epicRoot, readFrontmatter, isValidEpicId } from './epic-state.mjs';
import { PROJECT_FILES, productConfigPath } from './manifest.mjs';
import { resolveDefaultBranch } from './productcommit.mjs';
import { WORKTREE_RECORD, worktreeAt, sameDir } from './worktree-record.mjs';

const CODE = 'YAD-STATE-010';
const git = (cwd, ...args) => run('git', args, { cwd });
// Untrimmed: `run` trims, which eats the leading space of a porcelain entry (` M file`).
const gitRaw = (cwd, ...args) => String(spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout || '');
// Files yad itself writes into a checkout as local working state: named apart when they keep a worktree
// from being removed, so a finished epic does not look dirty for a reason nobody can see.
export const YAD_LOCAL_FILES = ['.specify/feature.json', '.gitmessage'];
const BUSY = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply'];

// PURE: where a checkout's worktree for an epic goes — beside it, named after it.
export const worktreePath = (main, epic) => path.join(path.dirname(main), `${path.basename(main)}--${epic}`);

// PURE: what `add` does for one target, from the facts the command read.
//   facts: { main, epic, repo, hasOrigin, pathTaken, existing (path of this epic's yad worktree, or null),
//            mainIsLinked (the checkout is itself a linked worktree) }
// → { path, refuse: null | { message, hint } }
export function planAdd({ main, epic, repo, hasOrigin, pathTaken, existing, mainIsLinked }) {
  const where = worktreePath(main, epic);
  const name = repo ?? 'the Product';
  const no = (message, hint) => ({ path: where, refuse: { message, hint } });
  if (mainIsLinked) return no(`${name}'s registered folder is itself a worktree`, 'register the main checkout, then run this again');
  if (existing) return no(`${epic} already has a worktree for ${name}: ${existing}`, 'work there; `yad worktree list` shows them all');
  if (pathTaken) return no(`${where} is already there`, 'move it away, or remove the old worktree with `yad worktree remove`');
  if (!hasOrigin) return no(`${name} has no origin remote, so a worktree's work could not reach the default branch`, 'add the remote (`git remote add origin <url>`), then run this again');
  return { path: where, refuse: null };
}

// PURE: why `remove` must not remove one worktree; [] means it may.
//   facts: { path, missing, inside, locked, busy, changes: [paths], unpushed: n }
export function planRemove({ path: where, missing, inside, locked, busy, changes = [], unpushed = 0 }) {
  const why = [];
  if (missing) return [{ reason: `${where} is gone, but git still lists it`, fix: 'run `git worktree prune` in the main checkout' }];
  if (inside) why.push({ reason: 'you are inside it', fix: `cd out of ${where} first` });
  if (locked) why.push({ reason: `it is locked${locked === true ? '' : ` (${locked})`}`, fix: `git worktree unlock ${where}, once whoever locked it is done` });
  if (busy) why.push({ reason: `a ${busy} is half done in it`, fix: `finish or abort it in ${where}` });
  const own = changes.filter((f) => YAD_LOCAL_FILES.includes(f));
  const others = changes.filter((f) => !YAD_LOCAL_FILES.includes(f));
  if (others.length) {
    why.push({ reason: `${others.length} uncommitted or untracked file(s): ${others.slice(0, 5).join(', ')}${others.length > 5 ? ', …' : ''}`, fix: `commit and push them, or \`git -C ${where} stash -u\`` });
  }
  if (own.length) why.push({ reason: `yad's own working file(s) are there: ${own.join(', ')}`, fix: `they are local state, safe to delete: ${own.map((f) => `rm ${path.join(where, f)}`).join('; ')}` });
  if (unpushed) why.push({ reason: `${unpushed} commit(s) are on no remote`, fix: `push them (\`git -C ${where} push origin HEAD:<branch>\`), or \`yad capture\`` });
  return why;
}

// ---- reading ---------------------------------------------------------------------------------------

function productMain(root) {
  const rec = worktreeAt(root);
  return rec && rec.repo === null && fs.existsSync(productConfigPath(rec.main)) ? rec.main : root;
}

// The checkouts an epic's worktrees can be made from: the Product, and every registered code repo that is
// a checkout of its own beside or inside the workspace. → [{ repo: null|name, main, defaultBranch }]
function targetsOf(productRoot) {
  const main = productMain(productRoot);
  const config = readJSON(productConfigPath(main), null) || {};
  const out = [{ repo: null, main, defaultBranch: resolveDefaultBranch((...a) => git(main, ...a), config) }];
  const reg = readJSON(path.join(main, PROJECT_FILES.reposRegistry), { repos: [] });
  for (const r of Array.isArray(reg?.repos) ? reg.repos : []) {
    if (!isPlainObject(r) || typeof r.name !== 'string' || typeof r.path !== 'string') continue;
    const at = path.resolve(main, r.path);
    if (sameDir(at, main)) continue; // the Product's own entry (a monorepo): its worktree is the Product's
    const named = typeof r.default_branch === 'string' && r.default_branch ? r.default_branch : null;
    out.push({ repo: r.name, main: at, defaultBranch: named, missing: !fs.existsSync(path.join(at, '.git')) });
  }
  return out;
}

// Every yad worktree of one checkout, read from its git folder (so one whose folder is gone still shows).
export function yadWorktrees(main) {
  const common = path.join(main, '.git');
  const dir = path.join(common, 'worktrees');
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    const gitDir = path.join(dir, name);
    const rec = readJSON(path.join(gitDir, WORKTREE_RECORD), null);
    if (!isPlainObject(rec) || typeof rec.epic !== 'string' || !isValidEpicId(rec.epic)) continue;
    let where;
    try { where = path.dirname(path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'gitdir'), 'utf8').trim())); } catch { continue; }
    let locked = false;
    try { locked = fs.readFileSync(path.join(gitDir, 'locked'), 'utf8').trim() || true; } catch { /* not locked */ }
    out.push({ ...rec, gitDir, path: where, missing: !fs.existsSync(path.join(where, '.git')), locked });
  }
  return out;
}

function stateOf(w) {
  if (w.missing) return { branch: null, changes: [], unpushed: 0 };
  const head = git(w.path, 'rev-parse', '--abbrev-ref', 'HEAD');
  const status = gitRaw(w.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
  const links = new Set(Array.isArray(w.links) ? w.links : []);
  const changes = [];
  const parts = status.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const file = e.slice(3);
    if (e[0] === 'R' || e[0] === 'C') i++; // the old name follows a rename or copy
    const bare = file.replace(/\/$/, '');
    if (links.has(bare) && isLinkTo(path.join(w.path, bare))) continue; // yad's own node_modules link
    changes.push(file);
  }
  const unpushed = Number(git(w.path, 'rev-list', '--count', 'HEAD', '--not', '--remotes').stdout || 0);
  const busy = BUSY.find((f) => fs.existsSync(path.join(w.gitDir, f))) || null;
  return { branch: head.ok && head.stdout !== 'HEAD' ? head.stdout : null, changes, unpushed, busy };
}
const isLinkTo = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

// The node_modules folders of the main checkout that git ignores, at the repo root and beside each tracked
// package.json — linked into the worktree where it has none. Relative paths, POSIX form.
export function nodeModulesLinks(main) {
  const listed = gitRaw(main, 'ls-files', '-z', '--', 'package.json', '*/package.json');
  const dirs = new Set(['.']);
  for (const f of listed.split('\0')) if (f) dirs.add(path.posix.dirname(f));
  const out = [];
  for (const d of [...dirs].sort()) {
    const rel = d === '.' ? 'node_modules' : `${d}/node_modules`;
    const src = path.join(main, rel);
    let st;
    try { st = fs.statSync(src); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (!git(main, 'check-ignore', '-q', '--', rel).ok) continue; // tracked or not ignored: not ours to link
    out.push(rel);
  }
  return out;
}

function epicRepos(main, epic) {
  const fm = readFrontmatter(path.join(epicRoot(main, epic), 'epic.md'));
  return Array.isArray(fm.repos) ? fm.repos : [];
}

function pickTargets(productRoot, epic, { repo = null, all = false }) {
  if (!isValidEpicId(epic)) throw err(CODE, `${forTerminal(epic)} is not an epic id`, 'an epic id looks like EP-checkout');
  const targets = targetsOf(productRoot);
  const product = targets[0];
  if (!fs.existsSync(path.join(epicRoot(product.main, epic), '.sdlc', 'state.json'))) throw err(CODE, `no epic ${epic} on the Product`, '`yad next` lists the epics');
  if (repo && repo !== true) {
    const t = targets.find((x) => x.repo === repo);
    if (!t) throw err(CODE, `${forTerminal(repo)} is not a registered repo`, '`yad repo list` shows them');
    return [t];
  }
  if (!all) return [product];
  const wanted = epicRepos(product.main, epic);
  return [product, ...targets.filter((t) => t.repo && wanted.includes(t.repo))];
}

// ---- the commands ----------------------------------------------------------------------------------

export async function runWorktreeAdd(productRoot, { epic, repo = null, all = false, dryRun = false, today = null } = {}) {
  const targets = pickTargets(productRoot, epic, { repo, all });
  const plans = [];
  for (const t of targets) {
    const name = t.repo ?? 'the Product';
    if (t.missing) throw err(CODE, `${t.repo} is not cloned here (${t.main})`, `\`yad repo clone ${t.repo}\` fetches it`);
    const mainIsLinked = !!linkedGit(t.main);
    const existing = yadWorktrees(t.main).find((w) => w.epic === epic && (w.repo ?? null) === t.repo)?.path ?? null;
    const hasOrigin = git(t.main, 'remote', 'get-url', 'origin').ok;
    const where = worktreePath(t.main, epic);
    const plan = planAdd({ main: t.main, epic, repo: t.repo, hasOrigin, pathTaken: fs.existsSync(where), existing, mainIsLinked });
    if (plan.refuse) throw err(CODE, plan.refuse.message, plan.refuse.hint);
    const branch = t.defaultBranch || resolveDefaultBranch((...a) => git(t.main, ...a), {});
    plans.push({ ...t, name, path: plan.path, branch, links: t.repo ? nodeModulesLinks(t.main) : [] });
  }
  if (dryRun) {
    for (const p of plans) info(`would add ${p.path} for ${p.name}, detached at origin/${p.branch}${p.links.length ? `, linking ${p.links.join(', ')}` : ''}`);
    return { epic, dryRun: true, worktrees: plans.map((p) => ({ repo: p.repo, path: p.path, base: p.branch, links: p.links, added: false })) };
  }
  // Every target is checked before any is made, so a refusal never leaves half an epic's worktrees.
  const by = git(plans[0].main, 'config', 'user.name').stdout || null;
  const done = [];
  for (const p of plans) {
    if (!git(p.main, 'fetch', '--quiet', 'origin', `+refs/heads/${p.branch}:refs/remotes/origin/${p.branch}`).ok) {
      throw err(CODE, `could not fetch ${p.branch} for ${p.name}`, `check the network and your login, and that ${p.branch} is its default branch`);
    }
    const added = git(p.main, 'worktree', 'add', '--detach', p.path, `origin/${p.branch}`);
    if (!added.ok) throw err(CODE, `git could not add ${p.path}: ${added.stderr || added.stdout}`, 'fix what git says, then run this again');
    const gitDir = linkedGit(p.path);
    const linked = [];
    for (const rel of p.links) {
      const dst = path.join(p.path, rel);
      if (fs.existsSync(dst)) continue;
      try { fs.symlinkSync(path.join(p.main, rel), dst, process.platform === 'win32' ? 'junction' : 'dir'); linked.push(rel); } catch (e) { warn(`could not link ${rel}: ${e.message}`); }
    }
    writeJSON(path.join(gitDir, WORKTREE_RECORD), { epic, repo: p.repo, base: p.branch, created: today, by, links: linked });
    ok(`${p.name}: ${p.path} (detached at origin/${p.branch})`);
    if (linked.length) warn(`${p.name}: ${linked.join(', ')} ${linked.length > 1 ? 'are links' : 'is a link'} to the main checkout's — do not \`npm install\` in the worktree, or delete the link first`);
    if (p.repo && (fs.existsSync(path.join(p.main, '.husky')) || git(p.main, 'config', 'core.hooksPath').stdout)) {
      info(`${p.name}: its git hooks run in the worktree too — a hook that rewrites files adds them to your commits`);
    }
    done.push({ repo: p.repo, path: p.path, base: p.branch, links: linked, added: true });
  }
  hand(`open each agent's session IN its worktree folder (the capture hook watches the folder the session started in), then make the step's usual branch there`);
  return { epic, dryRun: false, worktrees: done };
}

const linkedGit = (top) => worktreeAt(top)?.gitDir ?? (() => {
  try {
    const text = fs.readFileSync(path.join(top, '.git'), 'utf8');
    const m = text.match(/^gitdir:\s*(.+?)\s*$/m);
    return m ? path.resolve(top, m[1]) : null;
  } catch { return null; }
})();

export async function runWorktreeList(productRoot, { epic = null } = {}) {
  const rows = [];
  for (const t of targetsOf(productRoot)) {
    if (t.missing) continue;
    for (const w of yadWorktrees(t.main)) {
      if (epic && w.epic !== epic) continue;
      const s = stateOf(w);
      rows.push({ epic: w.epic, repo: w.repo ?? null, path: w.path, branch: s.branch, changes: s.changes.length, unpushed: s.unpushed, locked: w.locked !== false, missing: w.missing });
    }
  }
  if (!rows.length) info(epic ? `no yad worktrees for ${epic}` : 'no yad worktrees');
  for (const r of rows) {
    const bits = [r.branch ? `on ${r.branch}` : 'detached'];
    if (r.missing) bits.push('folder gone');
    if (r.changes) bits.push(`${r.changes} changed`);
    if (r.unpushed) bits.push(`${r.unpushed} unpushed`);
    if (r.locked) bits.push('locked');
    info(`${r.epic}  ${r.repo ?? 'Product'}  ${r.path}  (${bits.join(', ')})`);
  }
  return { worktrees: rows };
}

export async function runWorktreeRemove(productRoot, { epic, repo = null, all = false, cwd = process.cwd() } = {}) {
  const targets = pickTargets(productRoot, epic, { repo, all });
  const found = [];
  for (const t of targets) {
    if (t.missing) continue;
    const w = yadWorktrees(t.main).find((x) => x.epic === epic && (x.repo ?? null) === t.repo);
    if (w) found.push({ t, w });
  }
  if (!found.length) throw err(CODE, `no yad worktree for ${epic}${repo && repo !== true ? ` in ${repo}` : ''}`, '`yad worktree list` shows them');
  // Every one is checked before any is removed: with --all, one refusal removes nothing.
  const refused = [];
  for (const f of found) {
    const s = stateOf(f.w);
    const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
    const inside = !f.w.missing && (real(cwd) === real(f.w.path) || real(cwd).startsWith(real(f.w.path) + path.sep));
    const why = planRemove({ path: f.w.path, missing: f.w.missing, inside, locked: f.w.locked, busy: s.busy, changes: s.changes, unpushed: s.unpushed });
    if (why.length) refused.push({ repo: f.t.repo, path: f.w.path, why });
  }
  if (refused.length) {
    for (const r of refused) for (const y of r.why) warn(`${r.repo ?? 'Product'}: ${r.path} — ${y.reason}; ${y.fix}`);
    throw err(CODE, `${epic}'s worktree${found.length > 1 ? 's were' : ' was'} not removed: ${refused.length} still hold${refused.length === 1 ? 's' : ''} work`, 'fix what is listed above, then run this again — nothing was removed');
  }
  const removed = [];
  for (const f of found) {
    for (const rel of Array.isArray(f.w.links) ? f.w.links : []) {
      const p = path.join(f.w.path, rel);
      if (isLinkTo(p)) fs.unlinkSync(p); // the link only — never what it points at
    }
    const r = git(f.t.main, 'worktree', 'remove', f.w.path);
    if (!r.ok) throw err(CODE, `git could not remove ${f.w.path}: ${r.stderr || r.stdout}`, 'fix what git says, then run this again');
    ok(`removed ${f.w.path}`);
    removed.push({ repo: f.t.repo, path: f.w.path });
  }
  return { epic, removed };
}
