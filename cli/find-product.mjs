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

const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);

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

// → { root, via: 'here' | 'above' | 'workspace', workspace? } | { problem } | null
export function findProduct(start) {
  const from = path.resolve(start);
  for (let d = from; ; d = path.dirname(d)) {
    if (exists(productConfigPath(d))) return { root: d, via: d === from ? 'here' : 'above' };
    if (fs.existsSync(path.join(d, WORKSPACE_FILE))) {
      const file = path.join(d, WORKSPACE_FILE);
      if (insideGitTree(d)) return { problem: `${file} is inside a git repo, so it is not used (a repo could commit one)` };
      if (sharedFolder(d)) return { problem: `${file} is in your home or temp folder, so it is not used` };
      const ws = readWorkspace(d);
      if (ws.problem) return { problem: ws.problem };
      // Only for a repo this Product registers — never for any folder that happens to sit beside it.
      return registeredRepoHolding(ws.product, from) ? { root: ws.product, via: 'workspace', workspace: d } : null;
    }
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
    if (!repoAt || repoAt === productAt || !within(at, repoAt) || repoAt.length <= bestAt.length) continue;
    best = r;
    bestAt = repoAt;
  }
  return best;
}

// Folders a workspace file is never written into: the home folder, the temp folder and the top of a disk.
// A file there would be found from every folder below it — every project, every test's temp folder.
function sharedFolder(dir) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const d = real(dir);
  return path.dirname(d) === d || d === real(os.homedir()) || d === real(os.tmpdir());
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

// The registry entry for a code repo, read from the Product (E80: a code-repo command run from a
// sibling repo — or any folder inside it — knows its name, platform and default branch). Never the
// Product's own entry.
export function registryEntryFor(productRoot, repoRoot) {
  if (!productRoot) return null;
  return registeredRepoHolding(productRoot, repoRoot);
}
