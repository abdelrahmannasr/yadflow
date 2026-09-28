// `yad new` · `yad init` · `yad join` (E79) — the three ways into a workspace.
//
// A WORKSPACE is the folder that holds the Product and the code repos side by side:
//
//   my-product/
//     product/      <- the Product (goals, epics, decisions) — its own git repo
//     backend/      <- a code repo, registered in product/.sdlc/repos.json as `../backend`
//     frontend/
//
// Until E80 writes `.yad-workspace.json`, the workspace is what setup has always called it: the Product
// folder's parent (`insideWorkspace` in setup.mjs, issue #129).
//
//   yad new <name>      greenfield: make <name>/product/, `git init` it, run setup inside it
//   yad init            brownfield: in a folder that already holds code repos, make (or pick) the
//                       Product folder, run setup, and offer the repos found beside it
//   yad join <url>      anyone else: clone the Product and every repo it registers, then do the
//                       per-machine steps only
//
// `yad setup` is unchanged: new and init are front doors over it, not a replacement.
//
// NOTHING HERE WRITES OUTSIDE THIS MACHINE. `new` never creates a remote — it prints the exact
// `gh repo create` / `glab repo create` line. `join` never commits, never pushes, and never changes a
// file the team shares: it installs only what git ignores in the Product (the per-machine skill copies)
// and the git pre-commit hook, which git never shares (E48).
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { c, log, ok, info, warn, hand, fail, run, exists, readJSON } from './lib.mjs';
import { productConfigPath, PROJECT_FILES } from './manifest.mjs';
import { runSetup, insideWorkspace, throughGitDir, selectIdeTargets } from './setup.mjs';
import { moduleActions, gitHookActions } from './plan.mjs';

// The Product's folder inside a workspace. `join` clones to it and `new` creates it, so a workspace
// made by `new` and one made by `join` from its remote look the same.
export const PRODUCT_DIR = 'product';

// A folder name we create: letters, digits, `.`, `_`, `-`, not starting with `.` or `-`. No separator,
// so it is always one folder under the one it is made in.
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const validFolderName = (name) => typeof name === 'string' && FOLDER_RE.test(name);

// Text read from a shared file (a repo name, a path) is shown in the terminal: every control character
// becomes a space, so a registry entry cannot move the cursor or recolour what follows.
export const shown = (s) => [...String(s ?? '')].map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch)).join('');

// A folder as the person's shell reaches it: relative to where they ran yad (which `--dir` may not
// be), quoted when it holds a space.
const fromShell = (dir) => { const r = path.relative(process.cwd(), dir) || '.'; return /\s/.test(r) ? `"${r}"` : r; };

const isEmptyDir = (dir) => { try { return fs.readdirSync(dir).length === 0; } catch { return false; } };
// Empty, or holding only `.git`: a fresh clone of an empty remote.
const isBareStart = (dir) => { try { return fs.readdirSync(dir).every((n) => n === '.git'); } catch { return false; } };

// `insideWorkspace` and `throughGitDir` judge the path TEXT. A link the Product commits makes the text
// lie: `evil -> ../../..` carries `evil/x` outside the workspace, and `g -> .git` carries `g/hooks` into
// git's own storage, where a cloned hook or config runs commands (E79 reviews 1 and 3). So a clone
// target is refused when any folder on the way to it, below the workspace, is a link — a dangling one
// too. What is not there yet is made by this clone, so it cannot be a link.
function throughLink(productRoot, target) {
  const root = path.resolve(productRoot);
  const workspace = path.dirname(root) === root ? root : path.dirname(root);
  let cur = workspace;
  for (const part of path.relative(workspace, target).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch { return false; }
    if (st.isSymbolicLink()) return true;
  }
  return false;
}
const insideGitRepo = (dir) => run('git', ['rev-parse', '--show-toplevel'], { cwd: dir });

// The folder `join` makes from a remote URL: its last path segment without `.git`. So the remote
// `new acme` tells you to create (`acme`) joins back into `acme/`.
export function workspaceNameFromUrl(url) {
  const last = String(url || '').replace(/[\\/]+$/, '').split(/[\\/:]/).pop() || '';
  return last.replace(/\.git$/i, '');
}

// `git init` on a named branch. `-b` needs git 2.28; an older git gets the same result from pointing
// the unborn HEAD at the branch.
export function gitInit(dir, branch = 'main') {
  if (run('git', ['init', '-q', '-b', branch], { cwd: dir }).ok) return true;
  if (!run('git', ['init', '-q'], { cwd: dir }).ok) return false;
  return run('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: dir }).ok;
}

function gitClone(url, target, env) {
  const r = spawnSync('git', ['clone', '-q', '--', url, target], { encoding: 'utf8', env, windowsHide: true });
  return { ok: r.status === 0, error: (r.stderr || r.error?.message || '').trim().split('\n').pop() || `git clone exited ${r.status}` };
}
// A clone that needs a password must not sit waiting at a prompt nobody will answer.
const cloneEnv = () => (process.env.SDLC_NONINTERACTIVE ? { ...process.env, GIT_TERMINAL_PROMPT: '0' } : process.env);

// THE CLONE STEP — shared with E81 (detect and fetch missing repos). For each repo the Product's
// registry lists, put a clone at its `path` (relative to the Product) when none is there.
//
// The registry is SHARED content — anyone who can push to the Product wrote it — so every entry is
// judged before git runs: a path outside the workspace is refused (the same bound setup keeps), the
// Product itself (`.`, a monorepo) is not cloned, and the URL is passed after `--` so it can never be
// read as a git option. A failure is recorded and the next repo is tried: one bad entry never stops
// the rest (the roadmap: "partial clone failures never fail the whole join").
//
// Returns { cloned, present, failed }, each a list of { name, path, reason? }.
export function cloneMissingRepos(productRoot, registry, { clone = gitClone, env = cloneEnv() } = {}) {
  const out = { cloned: [], present: [], failed: [] };
  // A `repos` that is not a list (`{}`, `5`) is a broken shared file: nothing to clone, and the caller
  // says so — the per-machine steps still run.
  for (const repo of Array.isArray(registry?.repos) ? registry.repos : []) {
    const name = shown(repo?.name || '(unnamed)');
    const rpath = typeof repo?.path === 'string' ? repo.path : '';
    const entry = { name, path: shown(rpath) };
    if (!rpath) { out.failed.push({ ...entry, reason: 'no path recorded' }); continue; }
    const target = path.resolve(productRoot, rpath);
    if (target === path.resolve(productRoot)) { out.present.push({ ...entry, reason: 'the Product itself' }); continue; }
    if (throughGitDir(productRoot, rpath)) { out.failed.push({ ...entry, reason: 'it runs through a .git folder — git\'s own storage, never a code repo; not cloned' }); continue; }
    if (!insideWorkspace(productRoot, rpath)) { out.failed.push({ ...entry, reason: 'outside the workspace (the Product folder\'s parent) — not cloned' }); continue; }
    // Already there: nothing is written, so where a link of this machine's own points does not matter.
    // "Present" is only ever a skip — anything that later fetches or pulls in a present repo (E81) must
    // run `throughLink` and `insideWorkspace` on it first.
    if (exists(path.join(target, '.git'))) { out.present.push(entry); continue; }
    if (throughLink(productRoot, target)) { out.failed.push({ ...entry, reason: 'a folder on its path is a link, so where the clone lands is not what the path says — not cloned' }); continue; }
    if (exists(target) && !isEmptyDir(target)) { out.failed.push({ ...entry, reason: 'the folder exists and is not a git repo — move it aside and re-run' }); continue; }
    const url = typeof repo.git_url === 'string' ? repo.git_url.trim() : '';
    if (!url) { out.failed.push({ ...entry, reason: 'no git_url recorded — clone it by hand' }); continue; }
    if (url.startsWith('-')) { out.failed.push({ ...entry, reason: 'the recorded git_url starts with "-"' }); continue; }
    // A path through a file (`.sdlc/hub.json/x`) or a dangling link fails here — for this entry only.
    let r;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      r = clone(url, target, env);
    } catch (e) { r = { ok: false, error: `cannot make its folder (${e.code || e.message})` }; }
    if (r.ok) out.cloned.push(entry);
    else out.failed.push({ ...entry, reason: shown(r.error) });
  }
  return out;
}

// The lines that put the Product on a platform — printed, never run.
export function remoteSteps({ name, platform, branch = 'main' }) {
  const first = ['git add -A', `git commit -m "chore: start the ${name} Product"`];
  if (platform === 'github') return [...first, `gh repo create ${name} --private --source=. --remote=origin --push`];
  if (platform === 'gitlab') return [...first, `glab repo create ${name} --private`, 'git remote add origin <the URL glab printed>', `git push -u origin ${branch}`];
  return [...first, 'git remote add origin <your remote URL>', `git push -u origin ${branch}`];
}

const refuse = (message) => { fail(message); process.exitCode = 1; return null; };

// ---- yad new <name> ------------------------------------------------------------------------------
export async function runNew(cwd, name, opts = {}) {
  log(c.bold('\nyad new'));
  if (!validFolderName(name)) return refuse(`usage: yad new <name> — a folder name of letters, digits, ".", "_" or "-" (got ${name === undefined ? 'nothing' : JSON.stringify(shown(name))})`);
  const inside = insideGitRepo(cwd);
  if (inside.ok) return refuse(`${cwd} is inside the git repo ${inside.stdout} — a workspace holds its repos side by side, so run \`yad new\` from a folder outside any repo`);
  const workspace = path.join(cwd, name);
  if (exists(workspace) && !isEmptyDir(workspace)) return refuse(`${workspace} already exists and is not empty — pick another name, or run \`yad init\` inside it to connect what is there`);
  const product = path.join(workspace, PRODUCT_DIR);
  fs.mkdirSync(product, { recursive: true });
  if (!gitInit(product)) return refuse(`git init failed in ${product}`);
  ok(`created ${path.join(name, PRODUCT_DIR)}/ (git, branch main)`);

  const setup = await runSetup(product, { ...opts, greenfield: !opts.brownfield });
  if (process.exitCode) return null;

  // Setup asked for the default branch; the repo has no commit yet, so HEAD can still follow the answer.
  const hub = readJSON(productConfigPath(product), {}) || {};
  const branch = hub.default_branch || 'main';
  if (branch !== 'main' && !run('git', ['rev-parse', '-q', '--verify', 'HEAD'], { cwd: product }).ok) {
    run('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: product });
  }
  const steps = remoteSteps({ name, platform: hub.platform, branch });
  log('');
  log(c.bold('Put the Product on your platform') + c.dim(' (yad creates nothing outside this machine — run these yourself):'));
  log(`  cd ${fromShell(product)}`);
  for (const s of steps) log(`  ${s}`);
  hand('teammates then join with: `yad join <the Product\'s clone URL>`');
  return { workspace, product, platform: hub.platform ?? null, branch, remoteSteps: steps, setup };
}

// ---- yad init ------------------------------------------------------------------------------------
export async function runInit(cwd, opts = {}) {
  log(c.bold('\nyad init'));
  const inside = insideGitRepo(cwd);
  if (inside.ok) {
    return refuse(`${cwd} is inside the git repo ${inside.stdout}. \`yad init\` runs in the folder that HOLDS your repos. For one repo that holds all the code, run \`yad setup --brownfield --monorepo\` inside it instead`);
  }
  const children = fs.readdirSync(cwd, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
  let productName = opts.path;
  if (productName !== undefined && !validFolderName(productName)) return refuse(`--path must be one folder name (got ${JSON.stringify(shown(productName))})`);
  if (productName === undefined) {
    const products = children.filter((n) => exists(productConfigPath(path.join(cwd, n))));
    if (products.length > 1) return refuse(`more than one Product here (${products.join(', ')}) — name the one to use with --path <folder>`);
    productName = products[0] || PRODUCT_DIR;
  }
  const product = path.join(cwd, productName);
  // An existing folder becomes the Product only when it already is one, or has nothing in it yet (a
  // fresh clone of an empty remote holds just `.git`). Anything else is someone's code: setup would
  // write the Product's files into it.
  if (exists(product) && !exists(productConfigPath(product)) && !isBareStart(product)) {
    return refuse(`${productName}/ already holds files and is not a Product — name a new folder for the Product with --path <folder>`);
  }
  if (!exists(product)) {
    fs.mkdirSync(product);
    if (!gitInit(product)) return refuse(`git init failed in ${product}`);
    ok(`created ${productName}/ (git, branch main)`);
  } else info(`Product folder: ${productName}/`);

  const repos = children.filter((n) => n !== productName && exists(path.join(cwd, n, '.git')));
  const found = repos.filter(validFolderName);
  const odd = repos.filter((n) => !validFolderName(n));
  if (odd.length) warn(`not offered (a repo name must be letters, digits, ".", "_" or "-"): ${odd.map(shown).join(', ')} — connect them with \`yad setup\` under another name`);
  if (found.length) info(`found ${found.length} repo(s) beside it: ${found.join(', ')}`);
  else info('found no repos beside it — connect them later with `yad setup`');
  const discovered = found.map((n) => ({ name: n, rpath: `../${n}` }));
  const layout = opts.monorepo ? {} : { separate: true };
  const setup = await runSetup(product, { ...opts, brownfield: !opts.greenfield, ...layout, discovered });
  if (process.exitCode) return null;
  return { workspace: cwd, product, found, setup };
}

// ---- yad join <url> [folder] ---------------------------------------------------------------------
// The per-machine skill copies: only what git IGNORES in the Product. A copy the team commits is a
// shared file — installing a missing one, or refreshing an old one, is `yad update`'s job, pushed as a
// change everyone sees. So those are counted and named, never written.
function installLocalSkills(product, ideTargets) {
  const ignored = (rel) => spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: product, windowsHide: true }).status === 0;
  // `check-ignore` is asked about a path that may not exist yet, so a folder-only pattern
  // (`/.claude/skills/yad-*/`) is not matched and the copy is counted as shared — the safe side. Ignore
  // the folder itself (`.claude/`, `.claude/skills/`) for join to install into it.
  const res = { installed: [], stale: [], shared: [] };
  for (const a of moduleActions(product, ideTargets)) {
    if (a.status === 'ok') continue;
    const rel = a.paths[0];
    const local = !!rel && ignored(rel);
    if (local && (a.status === 'new' || a.status === 'missing')) { a.apply(); res.installed.push(rel); }
    else (local ? res.stale : res.shared).push(rel || `${a.scope}/${a.item}`);
  }
  return res;
}

export async function runJoin(cwd, url, folder, opts = {}) {
  log(c.bold('\nyad join'));
  if (typeof url !== 'string' || !url.trim() || url.startsWith('-')) return refuse('usage: yad join <the Product\'s clone URL> [folder]');
  const wsName = folder ?? workspaceNameFromUrl(url);
  if (!validFolderName(wsName)) return refuse(`cannot make a folder name from ${JSON.stringify(shown(url))} — pass one: yad join <url> <folder>`);
  const inside = insideGitRepo(cwd);
  if (inside.ok) return refuse(`${cwd} is inside the git repo ${inside.stdout} — run \`yad join\` from a folder outside any repo`);
  const workspace = path.join(cwd, wsName);
  const product = path.join(workspace, PRODUCT_DIR);

  // A re-run after a partial join finds the Product already there and carries on with what is missing.
  if (exists(path.join(product, '.git'))) info(`${path.join(wsName, PRODUCT_DIR)}/ already cloned`);
  else {
    if (exists(product) && !isEmptyDir(product)) return refuse(`${product} exists and is not a git repo — move it aside and re-run`);
    fs.mkdirSync(workspace, { recursive: true });
    const r = gitClone(url, product, cloneEnv());
    if (!r.ok) return refuse(`could not clone the Product: ${shown(r.error)}`);
    ok(`cloned the Product into ${path.join(wsName, PRODUCT_DIR)}/`);
  }
  if (!exists(productConfigPath(product))) return refuse(`${path.join(wsName, PRODUCT_DIR)}/ has no .sdlc/hub.json — that repo is not a yad Product`);

  const registry = readJSON(path.join(product, PROJECT_FILES.reposRegistry), { repos: [] }) || { repos: [] };
  if (!Array.isArray(registry.repos)) warn(`${PROJECT_FILES.reposRegistry} has no list of repos — nothing to clone; fix it in the Product and re-run`);
  const repos = cloneMissingRepos(product, registry);
  for (const r of repos.cloned) ok(`cloned ${r.name} → ${r.path}`);
  for (const r of repos.present) info(`${r.name}: ${r.reason || 'already there'}`);
  for (const r of repos.failed) warn(`${r.name} (${r.path}): ${r.reason}`);

  // The per-machine steps.
  const ideTargets = await selectIdeTargets(product, opts.ideTargets);
  const skills = installLocalSkills(product, ideTargets);
  if (skills.installed.length) ok(`installed ${skills.installed.length} skill folder(s) the Product's git ignores (per machine)`);
  if (skills.stale.length) info(`${skills.stale.length} per-machine skill copy(ies) differ from this yadflow's — left as they are; \`yad update\` refreshes them`);
  if (skills.shared.length) info(`${skills.shared.length} managed file(s) are missing or out of date here in folders the Product's git does not ignore — writing them is a change the team shares (\`yad update\`), so join leaves them`);
  const hook = gitHookActions(product);
  for (const a of hook) a.apply();
  if (hook.length) ok('installed the git pre-commit hook in this clone');

  log('');
  if (repos.failed.length) hand(`${repos.failed.length} repo(s) not cloned — fix what is named above and re-run \`yad join ${shown(url)}\`; it keeps what is already there`);
  hand(`start with: cd ${fromShell(product)} && yad next`);
  return {
    workspace, product,
    repos, skills: { installed: skills.installed, stale: skills.stale.length, shared: skills.shared.length },
    hook: hook.length ? 'installed' : 'unchanged',
  };
}
