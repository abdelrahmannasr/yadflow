// `yad new` · `yad init` · `yad join` (E79) — the three ways into a workspace.
//
// A WORKSPACE is the folder that holds the Product and the code repos side by side:
//
//   my-product/
//     product/      <- the Product (goals, epics, decisions) — its own git repo
//     backend/      <- a code repo, registered in product/.sdlc/repos.json as `../backend`
//     frontend/
//
// The workspace is the Product folder's parent (`insideWorkspace` in setup.mjs, issue #129). All three
// commands write `.yad-workspace.json` there (E80, cli/find-product.mjs), so yad finds the Product from
// inside any repo it registers.
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
import { fileURLToPath } from 'node:url';
import { c, log, ok, info, warn, hand, fail, run, exists, readJSON, readJSONStrict } from './lib.mjs';
import { productConfigPath, PROJECT_FILES } from './manifest.mjs';
import { runSetup, insideWorkspace, throughGitDir, selectIdeTargets } from './setup.mjs';
import { moduleActions, gitHookActions } from './plan.mjs';
import { writeWorkspaceFile, WORKSPACE_FILE } from './find-product.mjs';

// E80: the file that lets yad find the Product from inside the repos it registers. Written by all three.
function noteWorkspaceFile(product) {
  const r = writeWorkspaceFile(product);
  if (r === 'written') ok(`wrote ${WORKSPACE_FILE} — yad finds the Product from any repo it registers`);
  else if (r.startsWith('skipped')) warn(`${WORKSPACE_FILE} not written (${r.replace(/^skipped: /, '')})`);
  return r;
}

// The Product's folder inside a workspace. `join` clones to it and `new` creates it, so a workspace
// made by `new` and one made by `join` from its remote look the same.
export const PRODUCT_DIR = 'product';

// A folder name we create: letters, digits, `.`, `_`, `-`, not starting with `.` or `-`. No separator,
// so it is always one folder under the one it is made in.
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const validFolderName = (name) => typeof name === 'string' && FOLDER_RE.test(name);

// Text read from a shared file (a repo name, a path) is shown in the terminal: every control character
// (C0, DEL and C1 — U+0080–U+009F, which some terminals obey too) becomes a space, so a registry entry cannot move the cursor or recolour what follows.
export const shown = (s) => [...String(s ?? '')].map((ch) => { const n = ch.charCodeAt(0); return n < 32 || (n >= 127 && n <= 159) ? ' ' : ch; }).join('');

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

// How a clone may reach its source. `join`'s Product URL is the person's own, typed by them: git's own
// rules. A REGISTERED repo's URL was chosen by the shared registry, so git is told which transports it
// may use, by `GIT_ALLOW_PROTOCOL` (git 2.6.1+) — which git obeys over every `protocol.*.allow` setting,
// so a value the person's environment carries cannot widen it (E81 review 5) — and by
// `protocol.file.allow` as a second word. A network URL gets the network transports only, never the
// file one: git reads `evil.com:x` as a LOCAL folder when one by that name exists (E81 reviews 3–4). A
// local source (the YAD_ALLOW_LOCAL_REMOTES door) gets the file transport only.
const TRANSPORTS = { network: 'https:http:ssh:git', local: 'file' };
function gitClone(url, target, env, { kind = null } = {}) {
  const allow = TRANSPORTS[kind];
  const args = allow ? ['-c', `protocol.file.allow=${kind === 'local' ? 'always' : 'never'}`] : [];
  const r = spawnSync('git', [...args, 'clone', '-q', '--', url, target], { encoding: 'utf8', env: allow ? { ...env, GIT_ALLOW_PROTOCOL: allow } : env, windowsHide: true });
  let error = (r.stderr || r.error?.message || '').trim().split('\n').pop() || `git clone exited ${r.status}`;
  if (kind === 'network' && /transport '.*' not allowed/.test(error)) error += ' — a registered repo is cloned over the network only (an `insteadOf` rule of yours may point it at a local folder)';
  return { ok: r.status === 0, error };
}

// A registered repo's `git_url` is shared text, handed to `git clone`. Only a network address is cloned:
// `https://`, `http://`, `ssh://`, `git://`, or scp-style `user@host:path` / `host:path` (an ssh alias
// too). A plain path, `file://` or any `<helper>::` URL is refused — a local path can name a folder the
// Product itself commits (E81 review 3). The pattern is the first gate; the transports `gitClone` allows
// are the second.
//
// A team whose remotes really are on a disk sets YAD_ALLOW_LOCAL_REMOTES=1: then a local path or
// `file://` URL is cloned when it names a FOLDER THAT EXISTS outside the workspace. It is resolved on
// disk (links followed, `file:///C:/x` read as Windows does, `%` refused because git decodes it), and git
// is handed that resolved path — never the typed text, which git could read another way (it tries
// `<path>.git` when `<path>` is not there; E81 review 5). Compared without case where the disk ignores it.
// The host keeps to letters, digits, `.`, `_` and `-` (an IPv6 host in brackets), and the user and
// password to those plus `~` and `+`, in every form git hands to ssh: an ssh config whose `ProxyCommand`
// or `Match exec` uses `%h` or `%r` on an OpenSSH before 9.6 puts them in a shell command
// (CVE-2023-51385; E81 reviews 6–7). No `%` there: git decodes `%24%28` to `$(` before ssh sees it.
// Only `http(s)://`, which goes to curl and never to ssh, may carry `%` in its user and password (a
// login that is an email address, `me%40corp.com@`).
// Each starts with a letter or digit — never `-`, which ssh would read as an option (git refuses it too).
const HOST = String.raw`(?:\w[\w-]*(?:\.[\w-]+)*|\[[0-9a-f:.]+\])`;
const USER = String.raw`\w[\w.~+-]*`;
const HTTP_USER = String.raw`[\w%][\w.~%+-]*`;
const NETWORK_URL_RE = new RegExp(String.raw`^(?![^/]*::)(?:https?:\/\/(?:${HTTP_USER}(?::${HTTP_USER}?)?@)?${HOST}(?::\d*)?(?:\/|$)|(?:ssh|git|git\+ssh|ssh\+git):\/\/(?:${USER}(?::${USER}?)?@)?${HOST}(?::\d*)?(?:\/|$)|${USER}@${HOST}:(?!\/\/)|\w[\w-]+(?:\.[\w-]+)*:(?!\/\/))`, 'i');
// A control character anywhere in the URL, typed or %-encoded (`%0d`, `%1b`), is refused. git decodes
// the user, password and path of a `scheme://` URL and writes them to the person's credential helper one
// `key=value` per line: a carriage return there makes a helper that ends lines on it (Git Credential
// Manager does) read `host=github.com` and hand that token to the URL's own host (CVE-2024-52006); an
// escape in the user repaints the terminal in git's password prompt (CVE-2024-50349). git before 2.48.1
// guards against neither (E81 review 8). `%40` and every other printable escape still pass.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]|%(?:[01][0-9a-f]|7f)/i;
export const localRemotesAllowed = (env = process.env) => env.YAD_ALLOW_LOCAL_REMOTES === '1';
const folded = (p) => (process.platform === 'darwin' || process.platform === 'win32' ? p.toLowerCase() : p);
const under = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
// { kind: 'network', url } — the URL as recorded; { kind: 'local', url } — the resolved folder; or null.
export function cloneSource(productRoot, url, env = process.env) {
  if (CONTROL_RE.test(url)) return null;
  if (NETWORK_URL_RE.test(url)) return { kind: 'network', url };
  if (!localRemotesAllowed(env) || url.includes('%') || url.includes('::')) return null;
  let p = url;
  if (/^file:/i.test(url)) { try { p = fileURLToPath(url); } catch { return null; } }
  if (!path.isAbsolute(p)) return null;
  let real;
  try { real = fs.realpathSync.native(p); if (!fs.statSync(real).isDirectory()) return null; } catch { return null; }
  const root = path.resolve(productRoot);
  let workspace = path.dirname(root) === root ? root : path.dirname(root);
  try { workspace = fs.realpathSync.native(workspace); } catch { /* as resolved */ }
  return under(folded(real), folded(workspace)) ? null : { kind: 'local', url: real };
}

// A judged entry git may run in: a checkout that is there (or the Product itself), and not reached through
// a link inside a repo's tree (E81). Doctor's checks and `sync`'s stale count use it; the `list`,
// `refresh` and `sync` loops branch on the same states themselves, to say which one applies.
export const runnable = (j) => (j.state === 'present' || j.state === 'product') && !j.linked;

// A clone that needs a password must not sit waiting at a prompt nobody will answer.
const cloneEnv = () => (process.env.SDLC_NONINTERACTIVE ? { ...process.env, GIT_TERMINAL_PROMPT: '0' } : process.env);

// WHERE A REGISTRY ENTRY STANDS ON THIS MACHINE, judged before any git runs (E81). Shared by every
// command that acts on the registered repos — the clone step (`yad join`, `yad repo clone`), `yad repo
// list`, `yad repo sync` and `yad doctor` — so one never says "run X" for an entry X then refuses.
//
// The registry is SHARED content — anyone who can push to the Product wrote it — so a path outside the
// workspace is refused (the same bound setup keeps), a path through a `.git` folder or a link is refused,
// and a folder that exists but holds no `.git` is refused too: a Product can commit a folder shaped like
// a BARE git repo (`HEAD`, `config`, `objects/`), and git run there reads that `config`, whose
// `core.fsmonitor` runs a command. The Product itself (`.`, a monorepo) is its own state.
//
// Returns { name, path, target, state, reason?, inside?, linked?, url?, urlKind? } — `url` and `urlKind`
// ('network' | 'local') only for 'missing': what the clone step hands git. State is one of:
//   'product'   the Product itself; never cloned
//   'present'   a git checkout is there (`.git` at the path), or the path is a folder inside one (`inside`
//               names the checkout). `linked` is set when a folder on the way, deeper than the workspace
//               folder itself, is a link — see `inRepoLink`
//   'missing'   nothing there yet, and the clone step can make it
//   'refused'   not there, or not a checkout, and the clone step will not make it; `reason` says why
export function judgeRepo(productRoot, repo) {
  if (!repo || typeof repo !== 'object' || Array.isArray(repo)) return { name: '(not an entry)', path: '', state: 'refused', reason: 'this entry in repos.json is not an object' };
  const name = shown(repo?.name || '(unnamed)');
  const rpath = typeof repo?.path === 'string' ? repo.path : '';
  const entry = { name, path: shown(rpath) };
  if (!rpath) return { ...entry, state: 'refused', reason: 'no path recorded' };
  const target = path.resolve(productRoot, rpath);
  const at = { ...entry, target };
  if (target === path.resolve(productRoot)) return { ...at, state: 'product', reason: 'the Product itself' };
  if (throughGitDir(productRoot, rpath)) return { ...at, state: 'refused', reason: 'it runs through a .git folder — git\'s own storage, never a code repo' };
  if (!insideWorkspace(productRoot, rpath)) return { ...at, state: 'refused', reason: 'outside the workspace (the Product folder\'s parent)' };
  if (exists(path.join(target, '.git'))) return { ...at, state: 'present', ...(inRepoLink(productRoot, target) ? { linked: true } : {}) };
  // A folder inside a checkout (the monorepo layout: `apps/web` in the Product's own repo) has no `.git`
  // of its own, and git finds the checkout by walking up. It is present when no link deeper than the
  // workspace folder is on the way (so the walk git makes is the one read here — a link of the person's
  // own directly in the workspace folder is followed, as for a checkout) and no folder on the way could
  // be taken for a bare repo, where git would stop and read that folder's `config`.
  const top = exists(target) && !inRepoLink(productRoot, target) ? enclosingCheckout(productRoot, target) : null;
  if (top) {
    if (headOnWay(target, top)) return { ...at, state: 'refused', reason: 'a folder on its way holds an entry named HEAD, so git could take it for a bare repo and read its config' };
    return { ...at, state: 'present', inside: top };
  }
  if (throughLink(productRoot, target)) return { ...at, state: 'refused', reason: 'a folder on its path is a link, so where the clone lands is not what the path says' };
  if (exists(target) && !isEmptyDir(target)) return { ...at, state: 'refused', reason: 'the folder exists and is not a git repo — move it aside and re-run' };
  const url = typeof repo.git_url === 'string' ? repo.git_url.trim() : '';
  if (!url) return { ...at, state: 'refused', reason: 'no git_url recorded — clone it by hand' };
  if (url.startsWith('-')) return { ...at, state: 'refused', reason: 'the recorded git_url starts with "-"' };
  const src = cloneSource(productRoot, url);
  if (!src) return { ...at, state: 'refused', reason: 'the recorded git_url is not a network address (https://, http://, ssh://, git://, user@host:path or host:path) — clone it by hand, or set YAD_ALLOW_LOCAL_REMOTES=1 for a local folder outside the workspace' };
  return { ...at, state: 'missing', url: src.url, urlKind: src.kind };
}

// The nearest folder above `target`, below the workspace folder, that holds `.git`: the checkout git
// finds from `target`. Null when there is none.
function enclosingCheckout(productRoot, target) {
  const root = path.resolve(productRoot);
  const workspace = path.dirname(root) === root ? root : path.dirname(root);
  for (let cur = path.dirname(target); cur.startsWith(workspace + path.sep); cur = path.dirname(cur)) {
    if (exists(path.join(cur, '.git'))) return cur;
  }
  return null;
}

// Git takes a folder for a bare repo only when it holds `HEAD` — then `objects/` and `refs/` may come
// from anywhere (a `commondir` file points elsewhere), and `HEAD` may be a link that points nowhere
// (E81 review 2 made git run a command both ways). So the one sound test is the part git always needs:
// ANY entry named `HEAD`, of any kind, read with `lstat` so a dangling link counts. The file system
// matches the name as git's own lookup does (without case on macOS and Windows). From `target` up to,
// not including, the checkout `top`.
const hasHead = (dir) => { try { fs.lstatSync(path.join(dir, 'HEAD')); return true; } catch { return false; } };
function headOnWay(target, top) {
  for (let cur = target; cur !== top && cur.startsWith(top + path.sep); cur = path.dirname(cur)) {
    if (hasHead(cur)) return true;
  }
  return false;
}

// Where `yad repo refresh` writes a repo's pack and where `--push` stages its code-map: from the SHARED
// registry (`contextPack`, `codeMap`, or a default built from the repo's `name`). Allowed only under
// `.sdlc/code-context/` in the Product, with no `..`, no `.git` part and no link on the way — else a
// registry entry chooses a file outside the Product to write, or one inside it to commit and push.
export const CODE_CONTEXT_DIR = '.sdlc/code-context';
export function codeContextPathOk(productRoot, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return false;
  const norm = path.posix.normalize(rel.replace(/\\/g, '/'));
  if (!norm.startsWith(`${CODE_CONTEXT_DIR}/`)) return false;
  const parts = norm.split('/');
  if (parts.some((p) => p === '..' || /^\.git$/i.test(p.split(':')[0].replace(/[. ]+$/, '')) || /^git~\d+$/i.test(p))) return false;
  let cur = path.resolve(productRoot);
  for (const part of parts) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch { return true; }
    if (st.isSymbolicLink()) return false;
  }
  return true;
}

// A link on the way to a PRESENT repo that lies inside some repo's tree — deeper than the workspace
// folder's own children. The workspace folder is the person's: `ws/backend -> /src/backend` is their own
// layout, and a clone there is theirs. A link any deeper was written by whoever writes that repo — the
// Product's `evil -> ../../..` — so `yad repo sync` will not run git through it.
function inRepoLink(productRoot, target) {
  const root = path.resolve(productRoot);
  const workspace = path.dirname(root) === root ? root : path.dirname(root);
  const parts = path.relative(workspace, target).split(path.sep).filter(Boolean);
  let cur = workspace;
  for (const [i, part] of parts.entries()) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch { return false; }
    if (i > 0 && st.isSymbolicLink()) return true;
  }
  return false;
}

// THE CLONE STEP — `yad join` and `yad repo clone` (E81). For each repo the registry lists that
// `judgeRepo` finds missing, put a clone at its `path` (relative to the Product). The URL is passed after
// `--` so it can never be read as a git option. A failure is recorded and the next repo is tried: one bad
// entry never stops the rest (the roadmap: "partial clone failures never fail the whole join"). A present
// repo is only ever skipped — nothing here runs git in it.
//
// Returns { cloned, present, failed }, each a list of { name, path, reason? }.
export function cloneMissingRepos(productRoot, registry, { clone = gitClone, env = cloneEnv() } = {}) {
  const out = { cloned: [], present: [], failed: [] };
  // A `repos` that is not a list (`{}`, `5`) is a broken shared file: nothing to clone, and the caller
  // says so — the per-machine steps still run.
  for (const repo of Array.isArray(registry?.repos) ? registry.repos : []) {
    const j = judgeRepo(productRoot, repo);
    const entry = { name: j.name, path: j.path };
    if (j.state === 'product') { out.present.push({ ...entry, reason: j.reason }); continue; }
    if (j.state === 'present') { out.present.push(entry); continue; }
    if (j.state === 'refused') { out.failed.push({ ...entry, reason: j.reason }); continue; }
    // A path through a file (`.sdlc/hub.json/x`) or a dangling link fails here — for this entry only.
    let r;
    try {
      fs.mkdirSync(path.dirname(j.target), { recursive: true });
      // The transports by what the URL passed as (E81 reviews 4–5): see `gitClone`.
      r = clone(j.url, j.target, env, { kind: j.urlKind });
    } catch (e) { r = { ok: false, error: `cannot make its folder (${e.code || e.message})` }; }
    if (r.ok) out.cloned.push(entry);
    else out.failed.push({ ...entry, reason: shown(r.error) });
  }
  return out;
}

// What the clone step did, said the same way by `join` and `repo clone`.
export function reportClones(repos) {
  for (const r of repos.cloned) ok(`cloned ${r.name} → ${r.path}`);
  for (const r of repos.present) info(`${r.name}: ${r.reason || 'already there'}`);
  for (const r of repos.failed) warn(`${r.name} (${r.path}): ${r.reason}`);
}

// The Product's registry, read strictly (E81, from join): a file that does not parse (a merge-conflict
// marker left in it) must be SAID, not read as "no repos". Returns { registry, problem } — `problem` is
// the sentence to show, with the file's absolute path (a home folder name, spaces and all) taken out;
// `registry` is then `{ repos: [] }`. A file that parses and holds no list (`null`, `[]`, `5`) is a
// problem too.
export function readRegistry(productRoot) {
  const regFile = path.join(productRoot, PROJECT_FILES.reposRegistry);
  let registry;
  try { registry = readJSONStrict(regFile, { repos: [] }); }
  catch (e) {
    const why = (e.message || '').replace(`corrupt JSON in ${regFile}: `, '').split(regFile).join(PROJECT_FILES.reposRegistry);
    return { registry: { repos: [] }, problem: `${PROJECT_FILES.reposRegistry} in the Product cannot be read (${shown(why)})` };
  }
  if (!Array.isArray(registry?.repos)) return { registry: { repos: [] }, problem: `${PROJECT_FILES.reposRegistry} has no list of repos` };
  return { registry, problem: null };
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
  noteWorkspaceFile(product);

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
  hand(`then, from here: cd ${fromShell(product)} && yad next`);
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
  noteWorkspaceFile(product);
  // Setup's own "yad next" is said from the Product; the person is still in the workspace folder.
  hand(`start with: cd ${fromShell(product)} && yad next`);
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

  const { registry, problem } = readRegistry(product);
  if (problem) warn(`${problem} — nothing to clone; fix it in the Product and re-run`);
  const repos = cloneMissingRepos(product, registry);
  reportClones(repos);

  // The per-machine steps.
  const ideTargets = await selectIdeTargets(product, opts.ideTargets);
  const skills = installLocalSkills(product, ideTargets);
  if (skills.installed.length) ok(`installed ${skills.installed.length} skill folder(s) the Product's git ignores (per machine)`);
  if (skills.stale.length) info(`${skills.stale.length} per-machine skill copy(ies) differ from this yadflow's — left as they are; \`yad update\` refreshes them`);
  if (skills.shared.length) info(`${skills.shared.length} managed file(s) are missing or out of date here in folders the Product's git does not ignore — writing them is a change the team shares (\`yad update\`), so join leaves them`);
  noteWorkspaceFile(product);
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
