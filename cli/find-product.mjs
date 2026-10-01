// Find the Product from wherever yad runs (E80).
//
// A WORKSPACE is the folder that holds the Product and the code repos side by side (E79):
//
//   acme/
//     .yad-workspace.json   { "version": 1, "product": "product" }
//     product/              <- the Product
//     backend/  web/        <- code repos
//
// `findProduct(start)` walks up from `start` and stops at the FIRST of:
//   - a folder that is a Product (it has `.sdlc/hub.json` or `.sdlc/product.json`) — so any subfolder of
//     the Product finds it;
//   - a folder holding `.yad-workspace.json` — its `product` names the Product folder beside the repos.
//     It is used ONLY when `start` is inside a repo that Product registers in its `repos.json`. A
//     workspace can be a shared folder (`~/Projects`, holding many teams' repos — setup always allowed
//     that), and a file there must not send an unrelated repo's `yad epic new` or `yad kill` to this
//     Product (E80 review 1). Anywhere else in the workspace there is no Product.
//
// The workspace file is per machine: the workspace folder is not a git repo (`yad new`, `init` and `join`
// refuse to make one inside a repo). So a `.yad-workspace.json` found INSIDE a git work tree is not used
// — a code repo could commit one, pointing yad at a Product folder of its own making — nor one in the
// home or temp folder. The walk STOPS there with the reason, rather than going on up to whatever
// Product lies above.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exists, readJSON, writeJSON } from './lib.mjs';
import { productConfigPath, PROJECT_FILES } from './manifest.mjs';

export const WORKSPACE_FILE = '.yad-workspace.json';
export const WORKSPACE_VERSION = 1;

// The Product folder a workspace file may name: one folder, beside the file — never a path.
const PRODUCT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// Is `dir`, or any folder above it, a git work tree? A `.git` folder or file (a worktree, a submodule)
// is enough — no git run needed.
function insideGitTree(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

// On disk, as the disk spells it: `.native` returns the stored case (APFS and NTFS ignore case, and the JS
// realpath keeps whatever case it was given) and Windows' long names for 8.3 short ones — the same rule
// as `samePath` in lib.mjs. Windows compares without case, too.
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const within = (child, parent) => fold(child) === fold(parent) || fold(child).startsWith(fold(parent) + path.sep);

// Read one workspace file. `{ product }` (an absolute Product root) or `{ problem }`.
export function readWorkspace(workspaceDir) {
  const file = path.join(workspaceDir, WORKSPACE_FILE);
  const rec = readJSON(file, null);
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { problem: `${file} cannot be read` };
  if (rec.version !== WORKSPACE_VERSION) return { problem: `${file} is version ${JSON.stringify(rec.version ?? null)}, and this yadflow reads version ${WORKSPACE_VERSION}` };
  if (typeof rec.product !== 'string' || !PRODUCT_NAME_RE.test(rec.product)) return { problem: `${file}: "product" must be one folder name beside it` };
  const product = path.join(workspaceDir, rec.product);
  if (!exists(productConfigPath(product))) return { problem: `${file} names ${rec.product}/, which is not a Product` };
  return { product };
}

export const hasProduct = (dir) => exists(productConfigPath(dir));

// The Product a folder's own workspace file names, when the file is there and usable; else null.
export function workspaceProduct(dir) {
  if (!fs.existsSync(path.join(dir, WORKSPACE_FILE)) || insideGitTree(dir)) return null;
  return readWorkspace(dir).product || null;
}

// → { root, via: 'here' | 'above' | 'workspace', workspace?, repo? } | { problem } | { elsewhere } | null
//   `repo`       the registry entry of the code repo `start` is in, when there is one;
//   `elsewhere`  a workspace's Product, found from a folder that is not in one of its repos (the workspace
//                folder itself, say) — not used, but worth naming to the person.
export function findProduct(start) {
  const from = path.resolve(start);
  // Crossing a git repo's top on the way up: the Product above is some OTHER repo's (E80 review 2). It is
  // used only when it registers the repo `start` is in — the same rule as the workspace file's, so an
  // unrelated repo nested in the Product's folder (`vendor/lib`) never writes to it.
  let crossedRepo = false;
  for (let d = from; ; d = path.dirname(d)) {
    if (exists(productConfigPath(d))) {
      if (d === from) return { root: d, via: 'here' };
      const repo = registeredRepoHolding(d, from);
      if (crossedRepo && !repo) return null;
      return { root: d, via: 'above', ...(repo ? { repo } : {}) };
    }
    if (fs.existsSync(path.join(d, WORKSPACE_FILE))) {
      const file = path.join(d, WORKSPACE_FILE);
      if (insideGitTree(d)) return { problem: `${file} is inside a git repo, so it is not used (a repo could commit one)` };
      if (sharedFolder(d)) return { problem: `${file} is in your home or temp folder, so it is not used` };
      const ws = readWorkspace(d);
      if (ws.problem) return { problem: ws.problem };
      // Only for a repo this Product registers — never for any folder that happens to sit beside it.
      const repo = registeredRepoHolding(ws.product, from);
      return repo ? { root: ws.product, via: 'workspace', workspace: d, repo } : { elsewhere: ws.product };
    }
    if (fs.existsSync(path.join(d, '.git'))) crossedRepo = true;
    if (path.dirname(d) === d) return null;
  }
}

// The registry entry whose folder holds `dir` — the repo itself or any folder inside it — compared on
// disk (a link or a different spelling of the same folder still matches). The deepest one wins; the
// Product's own entry (a monorepo, `.`) never does.
export function registeredRepoHolding(productRoot, dir) {
  const at = real(dir);
  const productAt = real(productRoot);
  if (!at || !productAt) return null;
  const reg = readJSON(path.join(productRoot, PROJECT_FILES.reposRegistry), null);
  let best = null;
  let bestAt = '';
  for (const r of Array.isArray(reg?.repos) ? reg.repos : []) {
    if (typeof r?.path !== 'string') continue;
    const repoAt = real(path.resolve(productRoot, r.path));
    if (!repoAt || fold(repoAt) === fold(productAt) || !within(at, repoAt) || repoAt.length <= bestAt.length) continue;
    best = r;
    bestAt = repoAt;
  }
  return best;
}

// Folders a workspace file is never written into: the home folder, the temp folder and the top of a disk.
// A file there would be found from every folder below it — every project, every test's temp folder.
function sharedFolder(dir) {
  const onDisk = (p) => fold(real(p) ?? path.resolve(p));
  const d = onDisk(dir);
  return path.dirname(d) === d || d === onDisk(os.homedir()) || d === onDisk(os.tmpdir());
}

// Does a registered repo live BESIDE the Product (not inside it)? Only then does a workspace file help
// from a code repo — `yad check --fix` writes one only for such a Product (E80).
export function hasSiblingRepo(productRoot) {
  const root = path.resolve(productRoot);
  const workspace = path.dirname(root);
  const reg = readJSON(path.join(root, PROJECT_FILES.reposRegistry), null);
  return (Array.isArray(reg?.repos) ? reg.repos : []).some((r) => {
    if (typeof r?.path !== 'string') return false;
    const at = path.resolve(root, r.path);
    // …and is on this machine: a teammate who cloned the Product alone gains nothing from the file.
    return !(at === root || at.startsWith(root + path.sep)) && at.startsWith(workspace + path.sep) && fs.existsSync(at);
  });
}

// The workspace file for this Product: 'ok' | 'missing' | 'other: <why>' (another file there, or a
// folder a file is never written into). Read by `yad doctor` and `yad check`.
export function workspaceFileState(productRoot) {
  const root = path.resolve(productRoot);
  const workspace = path.dirname(root);
  const name = path.basename(root);
  if (path.dirname(root) === root || sharedFolder(workspace)) return 'other: the folder above the Product is your home folder, the temp folder or the top of the disk — move the Product into a folder of its own';
  if (!PRODUCT_NAME_RE.test(name)) return `other: the Product folder's name (${name}) is not one a workspace file can hold`;
  if (insideGitTree(workspace)) return 'other: the folder above the Product is inside a git repo';
  const cur = readJSON(path.join(workspace, WORKSPACE_FILE), null);
  if (cur && cur.product === name && cur.version === WORKSPACE_VERSION) return 'ok';
  if (cur && cur.product === name) return `other: ${WORKSPACE_FILE} there is version ${JSON.stringify(cur.version ?? null)}, not ${WORKSPACE_VERSION}`;
  if (cur) return `other: ${WORKSPACE_FILE} there names ${typeof cur.product === 'string' ? `${cur.product}/` : 'no Product'}`;
  return 'missing';
}

// Write the workspace file beside the Product: `{ version, product }`, the Product folder's own name.
// Only where `workspaceFileState` says it is missing — never over another file, never inside a git work
// tree (it would be committed to someone's repo, and is ignored there — see above), never into a shared
// folder. Returns 'written' | 'ok' | 'skipped: <why>'.
export function writeWorkspaceFile(productRoot) {
  const state = workspaceFileState(productRoot);
  if (state === 'ok') return 'ok';
  if (state !== 'missing') return `skipped: ${state.replace(/^other: /, '')}`;
  const root = path.resolve(productRoot);
  writeJSON(path.join(path.dirname(root), WORKSPACE_FILE), { version: WORKSPACE_VERSION, product: path.basename(root) });
  return 'written';
}

// The top of the git checkout `dir` is in: the nearest folder holding `.git` (a folder, or the file a
// worktree or submodule has). Null outside any checkout.
export function gitTopOf(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

// Where `yad toolbox` and the toolbox section of `check` / `update` look for tools (E85), given
// `findProduct(from)`'s answer. Finding reads `<folder>/.claude/…` and never walks up, so a subfolder
// must be lifted to the top of what the person is working in. That is the DEEPEST of these that holds
// `from`: the git checkout it is in (a worktree inside `api/` is its own checkout, on its own branch — never
// swapped for api's, as in E80 review 3), the registered repo holding it (`apps/web` in a monorepo is not
// a checkout of its own), and the Product found from it. A checkout ABOVE the Product (a Product that is
// not a git repo, inside one that is not ours) is never deeper than the Product, so it never wins. Reads
// only whether `.git` exists; runs nothing.
export function toolsFolder(found, from) {
  const at = real(from);
  if (!at) return from;
  // Both spellings: the shell's (through a link) and the one on disk, so `check` (given the shell's
  // folder) and `yad toolbox check` (given the process's) look in the same place (E85 review 4).
  const candidates = [gitTopOf(from), gitTopOf(at)];
  if (found?.root && found.repo && typeof found.repo.path === 'string') candidates.push(path.resolve(found.root, found.repo.path));
  if (found?.root && (found.via === 'here' || found.via === 'above')) candidates.push(found.root);
  let best = null;
  for (const c of candidates) {
    const cAt = c && real(c);
    if (cAt && within(at, cAt) && (!best || cAt.length > best.length)) best = cAt;
  }
  return best ?? from;
}

// The registry entry for the code repo a code-repo command runs in (E80), with the folder to work in.
// It is the CHECKOUT that must be the registered repo — not merely a folder inside it: a worktree or a
// repo nested in `backend/` is another checkout, on another branch, and must never be swapped for
// backend's own (E80 review 3). → { meta, top } or null. Never the Product's own entry.
export function registryEntryFor(productRoot, dir) {
  if (!productRoot) return null;
  const top = gitTopOf(dir);
  if (!top) return null;
  const meta = registeredRepoHolding(productRoot, top);
  if (!meta) return null;
  const at = real(path.resolve(productRoot, meta.path));
  const topAt = real(top);
  return at && topAt && fold(at) === fold(topAt) ? { meta, top } : null;
}
