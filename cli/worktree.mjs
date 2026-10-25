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
import { WORKTREE_RECORD, worktreeAt, sameDir, linkedGitDir, commonDirOf } from './worktree-record.mjs';

const CODE = 'YAD-STATE-010';
const git = (cwd, ...args) => run('git', args, { cwd });
// Untrimmed: `run` trims, which eats the leading space of a porcelain entry (` M file`).
const gitRawResult = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return { ok: r.status === 0, stdout: String(r.stdout || '') };
};
const gitRaw = (cwd, ...args) => gitRawResult(cwd, ...args).stdout;
// Files yad itself writes into a checkout as local working state: named apart when they keep a worktree
// from being removed, so a finished epic does not look dirty for a reason nobody can see.
export const YAD_LOCAL_FILES = ['.specify/feature.json', '.gitmessage'];
const BUSY = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply'];

// PURE: where a checkout's worktree for an epic goes — beside it, named after it.
export const worktreePath = (main, epic) => path.join(path.dirname(main), `${path.basename(main)}--${epic}`);

// PURE: what `add` does for one target, from the facts the command read.
//   facts: { main, epic, repo, hasOrigin, pathTaken, existing ({ path, missing } of this epic's yad
//            worktree, or null), mainIsLinked (the checkout is itself a linked worktree), nested (a code
//            repo kept inside the Product's folder) }
// → { path, skip (already there: a re-run goes on with the rest), refuse: null | { message, hint } }
export function planAdd({ main, epic, repo, hasOrigin, pathTaken, existing, mainIsLinked, nested = false }) {
  const where = worktreePath(main, epic);
  const name = repo ?? 'the Product';
  const no = (message, hint) => ({ path: where, skip: false, refuse: { message, hint } });
  if (mainIsLinked) return no(`${name}'s registered folder is itself a worktree`, 'register the main checkout, then run this again');
  // Its worktree would sit inside the Product's own checkout, and could not find the Product or its repos.
  if (nested) return no(`${name} is kept inside the Product's folder, and a worktree is only made for a repo beside it`, 'keep the repo beside the Product (`../<repo>` in repos.json) to give it worktrees');
  if (existing?.missing) return no(`${epic}'s worktree for ${name} is gone (${existing.path}), but git still lists it`, 'run `git worktree prune` in the main checkout, then run this again');
  if (existing) return { path: existing.path, skip: true, refuse: null };
  if (pathTaken) return no(`${where} is already there`, 'move it away (a worktree yad did not record: `git worktree remove` it), then run this again');
  if (!hasOrigin) return no(`${name} has no origin remote, so a worktree's work could not reach the default branch`, 'add the remote (`git remote add origin <url>`), then run this again');
  return { path: where, skip: false, refuse: null };
}

// PURE: why `remove` must not remove one worktree; [] means it may.
//   facts: { path, missing, inside, locked, busy, changes: [paths], unpushed: n }
export function planRemove({ path: where, missing, inside, locked, busy, changes = [], unpushed = 0, readable = true, product = false }) {
  const why = [];
  if (missing) return [{ reason: `${where} is gone, but git still lists it`, fix: 'run `git worktree prune` in the main checkout' }];
  if (inside) why.push({ reason: 'you are inside it', fix: `cd out of ${where} first` });
  if (!readable) why.push({ reason: 'git could not read its status', fix: `check \`git -C ${where} status\`` });
  if (locked) why.push({ reason: `it is locked${locked === true ? '' : ` (${locked})`}`, fix: `git worktree unlock ${where}, once whoever locked it is done` });
  if (busy) why.push({ reason: `a ${busy} is half done in it`, fix: `finish or abort it in ${where}` });
  const own = changes.filter((f) => YAD_LOCAL_FILES.includes(f));
  const others = changes.filter((f) => !YAD_LOCAL_FILES.includes(f));
  if (others.length) {
    why.push({ reason: `${others.length} uncommitted or untracked file(s): ${others.slice(0, 5).join(', ')}${others.length > 5 ? ', …' : ''}`, fix: `commit and push them, or \`git -C ${where} stash -u\`` });
  }
  if (own.length) why.push({ reason: `yad's own working file(s) are there: ${own.join(', ')}`, fix: `they are local state, safe to delete: ${own.map((f) => `rm ${path.join(where, f)}`).join('; ')}` });
  if (unpushed === null) why.push({ reason: 'git could not count its commits that are on no remote', fix: `check \`git -C ${where} log --not --remotes\`` });
  else if (unpushed) why.push({ reason: `${unpushed} commit(s) are on no remote`, fix: product ? `yad's own commits: \`yad checkpoint --push\` there; a step's: push its branch (\`git -C ${where} push origin HEAD:<branch>\`)` : `push them (\`git -C ${where} push origin HEAD:<branch>\`), or \`yad capture\`` });
  return why;
}

// ---- reading ---------------------------------------------------------------------------------------

function productMain(root) {
  const rec = worktreeAt(root);
  return rec && rec.repo === null && fs.existsSync(productConfigPath(rec.main)) ? rec.main : root;
}

// The checkouts an epic's worktrees can be made from: the Product, and every registered code repo.
// → [{ repo: null|name, main, defaultBranch, missing, nested }]
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
    const nested = within(at, main) && !sameDir(at, main); // on disk, as the disk spells it
    out.push({ repo: r.name, main: at, defaultBranch: named, missing: !fs.existsSync(path.join(at, '.git')), nested });
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

function stateOf(w, { ignored: wantIgnored = false } = {}) {
  if (w.missing) return { branch: null, changes: [], ignored: [], unpushed: 0, readable: true };
  const head = git(w.path, 'rev-parse', '--abbrev-ref', 'HEAD');
  // As capture reads it: no rename pairs to unpick, and no index refresh in a tree an agent may be using.
  const status = gitRawResult(w.path, 'status', '--porcelain=v1', '-z', '--untracked-files=all', ...(wantIgnored ? ['--ignored'] : []), '--no-renames');
  const links = new Set(Array.isArray(w.links) ? w.links : []);
  const changes = [];
  const ignored = [];
  for (const e of status.stdout.split('\0')) {
    if (e.length < 4) continue;
    const file = e.slice(3);
    const bare = file.replace(/\/$/, '');
    if (links.has(bare) && isLinkTo(path.join(w.path, bare))) continue; // yad's own node_modules link
    (e.startsWith('!!') ? ignored : changes).push(file);
  }
  const count = git(w.path, 'rev-list', '--count', 'HEAD', '--not', '--remotes');
  const unpushed = count.ok && /^\d+$/.test(count.stdout) ? Number(count.stdout) : null; // unknown is not 0
  const busy = BUSY.find((f) => fs.existsSync(path.join(w.gitDir, f))) || null;
  return { branch: head.ok && head.stdout !== 'HEAD' ? head.stdout : null, changes, ignored, unpushed, busy, readable: status.ok };
}
const isLinkTo = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
// Is `dir` the folder `top`, or inside it — compared on disk, as the disk spells it (find-product's rule).
function within(dir, top) {
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const [d, t] = [real(dir), real(top)];
  return !!d && !!t && (fold(d) === fold(t) || fold(d).startsWith(fold(t) + path.sep));
}

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
  // Every target is checked — and fetched — before any worktree is made, so a refusal makes nothing.
  for (const t of targets) {
    const name = t.repo ?? 'the Product';
    if (t.missing) throw err(CODE, `${t.repo} is not cloned here (${t.main})`, `\`yad repo clone ${t.repo}\` fetches it`);
    const mine = yadWorktrees(t.main).find((w) => w.epic === epic && (w.repo ?? null) === t.repo);
    const where = worktreePath(t.main, epic);
    const plan = planAdd({
      main: t.main, epic, repo: t.repo, nested: !!t.nested, mainIsLinked: !!linkedGitDir(t.main),
      hasOrigin: git(t.main, 'remote', 'get-url', 'origin').ok, pathTaken: fs.existsSync(where),
      existing: mine ? { path: mine.path, missing: mine.missing } : null,
    });
    if (plan.refuse) throw err(CODE, plan.refuse.message, plan.refuse.hint);
    const branch = t.defaultBranch || resolveDefaultBranch((...a) => git(t.main, ...a), {});
    plans.push({ ...t, name, path: plan.path, skip: plan.skip, branch, links: t.repo && !plan.skip ? nodeModulesLinks(t.main) : [] });
  }
  if (dryRun) {
    for (const p of plans) info(p.skip ? `${p.name}: ${p.path} is already there` : `would add ${p.path} for ${p.name}, detached at origin/${p.branch}${p.links.length ? `, linking ${p.links.join(', ')}` : ''}`);
    return { epic, dryRun: true, worktrees: plans.map((p) => ({ repo: p.repo, path: p.path, base: p.branch, links: p.links, added: false, existing: p.skip })) };
  }
  for (const p of plans.filter((x) => !x.skip)) {
    if (!git(p.main, 'fetch', '--quiet', 'origin', `+refs/heads/${p.branch}:refs/remotes/origin/${p.branch}`).ok) {
      throw err(CODE, `could not fetch ${p.branch} for ${p.name}`, `check the network and your login, and that ${p.branch} is its default branch — nothing was made`);
    }
  }
  const by = git(plans[0].main, 'config', 'user.name').stdout || null;
  const done = [];
  const made = [];
  try {
    for (const p of plans) {
      if (p.skip) {
        info(`${p.name}: ${p.path} is already there`);
        done.push({ repo: p.repo, path: p.path, base: p.branch, links: [], added: false, existing: true });
        continue;
      }
      const added = git(p.main, 'worktree', 'add', '--detach', p.path, `origin/${p.branch}`);
      // git keeps a worktree whose post-checkout hook failed, and still fails: that one is taken back too.
      if (!added.ok && sameDir(commonDirOf(linkedGitDir(p.path) || ''), path.join(p.main, '.git'))) made.push(p);
      if (!added.ok) throw err(CODE, `git could not add ${p.path}: ${added.stderr || added.stdout}`, 'fix what git says, then run this again — the worktrees this run made were taken back');
      made.push(p);
      const linked = linkNodeModules(p);
      p.linked = linked;
      writeJSON(path.join(linkedGitDir(p.path), WORKTREE_RECORD), { epic, repo: p.repo, base: p.branch, created: today, by, links: linked });
      done.push({ repo: p.repo, path: p.path, base: p.branch, links: linked, added: true, existing: false });
    }
  } catch (e) {
    // Take back what this run made, so a re-run starts clean: each is fresh, holding only checked-out files.
    for (const p of made.reverse()) {
      for (const rel of p.linked || []) { const at = path.join(p.path, rel); if (isLinkTo(at)) fs.unlinkSync(at); }
      if (git(p.main, 'worktree', 'remove', p.path).ok) dropExcludeLines(p.main, p.linked || []);
      else warn(`could not take back ${p.path} — remove it with \`git worktree remove ${p.path}\``);
    }
    throw e;
  }
  for (const p of made) {
    ok(`${p.name}: ${p.path} (detached at origin/${p.branch})`);
    if (p.linked.length) warn(`${p.name}: ${p.linked.join(', ')} ${p.linked.length > 1 ? 'are links' : 'is a link'} to the main checkout's — do not \`npm install\` in the worktree, or delete the link first`);
    if (p.repo && (fs.existsSync(path.join(p.main, '.husky')) || git(p.main, 'config', 'core.hooksPath').stdout)) {
      info(`${p.name}: its git hooks run in the worktree too — a hook that rewrites files adds them to your commits`);
    }
  }
  if (made.length) hand(`open each agent's session IN its worktree folder (the capture hook watches the folder the session started in), then make the step's usual branch there`);
  return { epic, dryRun: false, worktrees: done };
}

// Link each planned node_modules into the new worktree. A `node_modules/` ignore line matches folders only,
// and git sees a link as a file — so a link it would not ignore is excluded in the repo's own
// `info/exclude` (local, never committed), or taken back: it must never be staged by a `git add -A`.
function linkNodeModules(p) {
  const linked = [];
  for (const rel of p.links) {
    const dst = path.join(p.path, rel);
    if (fs.existsSync(dst)) continue;
    try { fs.symlinkSync(path.join(p.main, rel), dst, process.platform === 'win32' ? 'junction' : 'dir'); } catch (e) { warn(`could not link ${rel}: ${e.message}`); continue; }
    if (!git(p.path, 'check-ignore', '-q', '--', rel).ok) {
      const file = excludeFile(p.path);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const had = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        if (!had.split(/\r?\n/).includes(`/${rel}`)) fs.appendFileSync(file, `${had && !had.endsWith('\n') ? '\n' : ''}${EXCLUDE_MARK}\n/${rel}\n`);
      } catch { /* checked below */ }
      if (!git(p.path, 'check-ignore', '-q', '--', rel).ok) {
        fs.unlinkSync(dst);
        warn(`${p.name}: ${rel} was not linked — git would not ignore the link, so a \`git add -A\` would commit it`);
        continue;
      }
    }
    linked.push(rel);
  }
  return linked;
}

// `info/exclude` is a common-dir file: the main checkout and every worktree of the repo share it.
const EXCLUDE_MARK = '# yad worktree (#115): the node_modules link';
const excludeFile = (dir) => path.resolve(dir, git(dir, 'rev-parse', '--git-path', 'info/exclude').stdout || '.git/info/exclude');
// After a worktree is gone: drop yad's own pair (the mark, then `/<rel>`) for each link no other yad
// worktree of the repo still has — another epic's link must stay unstageable. Only a pair under yad's mark
// goes; a line the person wrote stays.
export function dropExcludeLines(main, rels) {
  const kept = new Set(yadWorktrees(main).flatMap((w) => (Array.isArray(w.links) ? w.links : [])));
  const gone = new Set(rels.filter((rel) => !kept.has(rel)).map((rel) => `/${rel}`));
  if (!gone.size) return;
  const file = excludeFile(main);
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return; }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, '') === EXCLUDE_MARK && gone.has((lines[i + 1] ?? '').replace(/\r$/, ''))) { i++; continue; }
    out.push(lines[i]);
  }
  if (out.length === lines.length) return;
  try { fs.writeFileSync(file, out.join('\n')); } catch (e) { warn(`could not tidy ${file}: ${e.message} — yad's lines there are harmless`); }
}

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
  // --all: every checkout's worktree for the epic, also one of a repo the epic no longer names.
  const picked = pickTargets(productRoot, epic, { repo, all });
  const targets = all ? targetsOf(productRoot) : picked;
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
    const s = stateOf(f.w, { ignored: true });
    const inside = !f.w.missing && within(cwd, f.w.path);
    const why = planRemove({ path: f.w.path, missing: f.w.missing, inside, locked: f.w.locked, busy: s.busy, changes: s.changes, unpushed: s.unpushed, readable: s.readable, product: f.t.repo === null });
    if (why.length) refused.push({ repo: f.t.repo, path: f.w.path, why });
    f.ignored = s.ignored;
  }
  if (refused.length) {
    for (const r of refused) for (const y of r.why) warn(`${r.repo ?? 'Product'}: ${r.path} — ${y.reason}; ${y.fix}`);
    throw err(CODE, `${epic}'s worktree${found.length > 1 ? 's were' : ' was'} not removed: ${refused.length} still hold${refused.length === 1 ? 's' : ''} work`, 'fix what is listed above, then run this again — nothing was removed');
  }
  const removed = [];
  for (const f of found) {
    // Files git ignores (an .env, build output) go with the folder, as `git worktree remove` does: said first.
    if (f.ignored?.length) warn(`${f.t.repo ?? 'Product'}: removed with it, as git ignores them: ${f.ignored.slice(0, 8).join(', ')}${f.ignored.length > 8 ? ', …' : ''}`);
    const links = (Array.isArray(f.w.links) ? f.w.links : []).filter((rel) => isLinkTo(path.join(f.w.path, rel)));
    for (const rel of links) fs.unlinkSync(path.join(f.w.path, rel)); // the link only — never what it points at
    const r = git(f.t.main, 'worktree', 'remove', f.w.path);
    if (!r.ok) {
      for (const rel of links) { try { fs.symlinkSync(path.join(f.t.main, rel), path.join(f.w.path, rel), process.platform === 'win32' ? 'junction' : 'dir'); } catch { /* said below */ } }
      throw err(CODE, `git could not remove ${f.w.path}: ${r.stderr || r.stdout}`, `fix what git says, then run this again${removed.length ? ` (already removed: ${removed.map((x) => x.path).join(', ')})` : ''}`);
    }
    dropExcludeLines(f.t.main, Array.isArray(f.w.links) ? f.w.links : []); // also a link the person deleted
    ok(`removed ${f.w.path}`);
    removed.push({ repo: f.t.repo, path: f.w.path });
  }
  return { epic, removed };
}
