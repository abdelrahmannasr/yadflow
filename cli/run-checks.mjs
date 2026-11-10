// `yad run checks` (issue #347): run every pull request gate on this machine before pushing, so a failure
// shows here and not after a CI round trip. The same words for a GitHub pull request and a GitLab merge
// request.
//
// What makes "passes here" mean "passes in CI":
//   - the repo's OWN installed `checks/` scripts run, not the templates this package ships — CI runs the
//     installed copies. One whose content differs from the shipped template is named.
//   - the base is the branch the change will merge into, chosen as `yad open-pr` chooses it
//     (`resolveBaseBranch`: the registry, then origin/HEAD; on the Product itself its own settings
//     between them), fetched first.
//   - the four Product-reading gates read the Product's DEFAULT BRANCH, as CI's product-checkout.sh
//     clones it (the user's decision, 2026-10-19): it is written out from the local Product clone's
//     `origin/<default_branch>` to where `.sdlc/product-link.json` ON THE BASE says, just before those
//     four gates, and removed right after them — so the build gates never see it, as in CI. Written with
//     a private index: the Product clone's own index, branch and files are never touched. The path gets
//     the checks product-checkout.sh applies (no symlink on the way, nothing tracked there). A run removes
//     only what it wrote itself; a folder already there is read as it is and kept.
//   - every gate runs, even after one fails (CI jobs run side by side), then one summary.
//
// What cannot be the same here, and says so:
//   - verified-commits asks the platform for its Verified badge, which an unpushed commit does not have.
//     Locally each commit's signature is checked with git instead (`%G?`); the badge is judged in CI.
//   - member-check needs the PR's author, which only the platform event carries. It runs when no member
//     file changes, and otherwise is left to CI with a note.
//   - pr-title and pr-template need text the PR does not have yet: --title and --body <file>, with the
//     subject of a one-commit branch as the title (it becomes the squash title).
//   - CI on GitHub tests the merge of the branch into the base; here it is the branch tip. A note says so
//     when the branch is not on top of the base.
//   - the build gates use this machine's Node and tools.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout, clearTimeout, setImmediate } from 'node:timers';
import { c, log, info, warn, fail, hand, ok, run, exists, readJSON, refuse, inJSON, asset, contentSha } from './lib.mjs';
import { detectPlatform, forkBranch, forkBranchWords, resolveBaseBranch } from './platform.mjs';
import { registryEntryFor } from './find-product.mjs';
import { repoPathFromGitUrl } from './protection.mjs';
import { rangeTasks, groupWarnings } from './build.mjs';

// GitLab hands CI only this many characters of a merge request description (#164, #343).
const GITLAB_DESCRIPTION_CUT = 2700;
const PRODUCT_GATES = new Set(['contract-check', 'lineage-check', 'epic-open', 'reconcile-debt']);

const git = (cwd, args, opts = {}) => run('git', args, { cwd, ...opts });

// A branch name git accepts, and never one read as an option: a value from a file the PR can shape
// (`default_branch`) reaches `git fetch` (review 1: `--upload-pack=…` ran a command).
function safeBranch(b) {
  if (typeof b !== 'string' || !b || b.startsWith('-')) return null;
  return run('git', ['check-ref-format', '--branch', b]).ok ? b : null;
}
// Fetch one branch by an explicit refspec: the name is data, never an option.
const fetchBranch = (cwd, b) => git(cwd, ['fetch', '--quiet', 'origin', `+refs/heads/${b}:refs/remotes/origin/${b}`]);

// The shipped template a gate was installed from, or null.
function shippedTemplate(script) {
  const skills = asset('skills');
  for (const sk of fs.readdirSync(skills)) {
    const p = path.join(skills, sk, 'templates', 'checks', script);
    if (exists(p)) return p;
  }
  return null;
}

// The record path's checks, as product-checkout.sh makes them: relative, no `..`, no `.git` part. A quote
// or a backslash is refused too: the gate reads such a value as no path at all.
function safeRecordPath(p) {
  // Only ASCII spaces count as space, as the gate's [[:space:]] does under LC_ALL=C (trim() takes NBSP too).
  if (typeof p !== 'string' || !/[^ \t\n\v\f\r]/.test(p) || path.isAbsolute(p) || /["\\]/.test(p)) return null;
  const parts = p.split('/').filter((x) => x && x !== '.');
  if (!parts.length || parts.some((x) => x === '..' || x.toLowerCase() === '.git')) return null;
  return parts.join('/');
}

// The record on the base, read as product-checkout.sh's `field` reads it — never parsed as JSON: the raw
// bytes (LC_ALL=C there, latin1 here) with CR and LF dropped, the last `"key": "value"` whose value holds no
// quote and no backslash. So a value written with a JSON escape (`\/`, `\t`, `\u00e9`) reads as empty here
// as it does in CI, and a record that does not parse, a nested key or a duplicate one reads the same in
// both. `isSet` is the gate's own `"key": "<one character>` test. Null when the base has no record.
function recordFields(repoRoot, base) {
  const shown = spawnSync('git', ['show', `${base}:.sdlc/product-link.json`], { cwd: repoRoot, encoding: 'latin1' });
  if (shown.status !== 0) return null;
  const flat = shown.stdout.replace(/[\r\n]/g, '');
  const field = (key) => flat.match(new RegExp(`^.*"${key}"[ \\t\\f\\v]*:[ \\t\\f\\v]*"([^"\\\\]*)"`, 's'))?.[1] ?? '';
  // A NUL byte: sed reads past it, so the value loses it after the match; bash's $(…) drops it before
  // the `isSet` test.
  const isSet = (key) => new RegExp(`"${key}"[ \\t\\f\\v]*:[ \\t\\f\\v]*"[^"]`).test(flat.replace(/\0/g, ''));
  return { field: (key) => Buffer.from(field(key).replace(/\0/g, ''), 'latin1').toString('utf8'), isSet };
}

// Read the record on the base and decide where the Product goes. Returns { rel, branch, record, fail? }
// or { none: note }.
function readRecord(repoRoot, base) {
  const fields = recordFields(repoRoot, base);
  if (!fields) return { none: true };
  const { field, isSet } = fields;
  const url = field('git_url');
  const dest = field('path');
  // No git_url it can read: CI's product-checkout clones nothing and says so before it looks at the path,
  // so nothing is written here either, and nothing else in the record fails.
  if (!url && isSet('git_url')) return { nothing: `.sdlc/product-link.json on ${base} names a git_url CI's product-checkout cannot read (it is written with a JSON escape, a quote or a backslash), so CI checks no Product out — write it in the record without escapes and merge that change first. Nothing is written here` };
  if (!url) return { nothing: `.sdlc/product-link.json on ${base} names no git_url, so CI checks no Product out — nothing is written here either` };
  const rel = safeRecordPath(dest);
  // `yad check --fix` writes a missing path and keeps one that is set (even one of only spaces, or one
  // written with an escape), so the fix named differs by case. It reaches only the repos cloned on that
  // machine, on their default branch.
  if (!rel) {
    const ci = "CI's product-checkout fails it too when YAD_PRODUCT_TOKEN is set";
    if (!dest && isSet('path')) return { fail: `.sdlc/product-link.json on ${base} names a path the gate cannot read (it is written with a JSON escape, a quote or a backslash) — ${ci}. Change path in it to a plain folder such as .yad/product, and merge that change first: the record is read from ${base}` };
    if (!dest) return { fail: `.sdlc/product-link.json on ${base} names no path — ${ci}; run \`yad check --fix --push\` from the Product, on a machine that has this repo cloned and on its default branch; it writes path .yad/product to the record there. Or set path yourself and merge that change first` };
    return { fail: `.sdlc/product-link.json on ${base} says path ${JSON.stringify(dest)}, which is not a folder inside this repo — ${ci}. Change path in it to one, such as .yad/product, and merge that change first: the record is read from ${base}, so changing it on this branch does not help` };
  }
  // No default_branch is deliberate (cli/plan.mjs writes null when it does not know): CI then clones the
  // remote's own default branch, so placeProduct asks the Product clone's origin/HEAD for it.
  const raw = field('default_branch') || null;
  const branch = raw === null ? null : safeBranch(raw);
  if (raw !== null && !branch) return { fail: `.sdlc/product-link.json on ${base} names a default_branch git cannot use as a branch name — run \`yad check --fix --push\` from the Product to write it again` };
  // Nothing on the way may be a symlink, and nothing there may be tracked: CI's product-checkout refuses
  // both (when YAD_PRODUCT_TOKEN is set; without it, it checks nothing out).
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const p = path.join(repoRoot, ...parts.slice(0, i));
    let st;
    try { st = fs.lstatSync(p); } catch { break; }
    if (st.isSymbolicLink()) return { fail: `'${parts.slice(0, i).join('/')}' is a symlink — the Product is not written through it (CI refuses it too, when YAD_PRODUCT_TOKEN is set). Point path in .sdlc/product-link.json at a real folder` };
    if (i < parts.length && !st.isDirectory()) return { fail: `'${parts.slice(0, i).join('/')}' is a file where the Product's folder goes — move it, or point path in .sdlc/product-link.json elsewhere` };
  }
  const tracked = git(repoRoot, ['ls-files', '-z', '--', rel]);
  if (tracked.ok && tracked.stdout) return { fail: `'${rel}' holds files this repo tracks — the Product cannot be checked out there (CI refuses it too, when YAD_PRODUCT_TOKEN is set). Untrack them only if they do not belong in this repo (git rm -r --cached -- '${rel.replaceAll("'", "'\\''")}', and add the folder to .gitignore), or change path in .sdlc/product-link.json to an untracked folder such as .yad/product and merge that change first (the record is read from ${base})` };
  return { rel, branch, record: { git_url: url } };
}

// Remove a copy this run wrote: `dest` itself (it did not exist before), then each folder this run made on
// the way to it, from the inside out, only while it is empty — a file someone put there meanwhile stays.
// What mkdirSync({ recursive }) reports it made, in the form path.join gives: on Windows, Node 18 and 20
// report it in the long `\\?\C:\…` form, which would never match `dest`.
export const plainPath = (p, P = path) => (typeof p === 'string' && p ? P.resolve(p.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '')) : p);

export function removeCopy(dest, created) {
  fs.rmSync(dest, { recursive: true, force: true });
  removeParents(dest, created);
}
// The folders this run made on the way to `dest` (`created` is the top one), only while each is empty.
// Bounded by `created`, which is `dest` or an ancestor of it inside the repo (built with path.join, so the
// same separators as path.dirname on every platform).
export function removeParents(dest, created) {
  if (!created || created === dest || !dest.startsWith(created + path.sep)) return;
  for (let d = path.dirname(dest); d.length >= created.length; d = path.dirname(d)) {
    try { fs.rmdirSync(d); } catch { break; }
    if (d === created) break;
  }
}

// Write the Product's default branch to `rel`. Returns { placed, created?, note } or { fail }.
function placeProduct(repoRoot, productRoot, { rel, branch: recorded, record }, { fetch }) {
  const dest = path.join(repoRoot, rel);
  // A run removes only what it wrote itself. A folder already there — the user's own, another run's in use,
  // or one a killed run left behind — is read as it is and never removed (CI's product-checkout leaves an
  // existing folder too).
  const alreadyThere = { placed: false, existing: dest, note: `${rel} is already there, so it is read as it is — it may not be the Product's default branch (another run may be using it, or a run that was killed left it): remove it to read the default branch` };
  if (exists(dest)) return alreadyThere;
  if (!productRoot) {
    return { placed: false, note: `no Product clone found from this repo (the workspace file names it), so ${rel} is not written — the Product-reading gates may read what product-repo in a link.md reaches on this machine, including unmerged edits, where CI would read nothing` };
  }
  const notes = [];
  let branch = recorded;
  if (!branch) {
    const h = git(productRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
    branch = safeBranch(h.ok && h.stdout.startsWith('origin/') ? h.stdout.slice('origin/'.length) : '') || 'main';
    notes.push(`the record names no default_branch, so the Product clone's origin/HEAD says it: ${branch}`);
  }
  const want = repoPathFromGitUrl(record?.git_url || '');
  const have = repoPathFromGitUrl(git(productRoot, ['remote', 'get-url', 'origin']).stdout);
  if (want && have && want.toLowerCase() !== have.toLowerCase()) notes.push(`the Product clone's origin is ${have}, but the record names ${want} — it is read anyway`);
  if (fetch && !fetchBranch(productRoot, branch).ok) notes.push(`could not fetch ${branch} in the Product clone — its last fetched copy is read`);
  const sha = git(productRoot, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}^{commit}`]);
  if (!sha.ok || !sha.stdout) {
    return { placed: false, note: [...notes, `the Product clone has no origin/${branch}, so ${rel} is not written — the Product-reading gates may read what product-repo in a link.md reaches on this machine, where CI would read the default branch`].join('; ') };
  }
  // Making the folder itself is the claim: one mkdir, which fails when another run made it first, between
  // the check above and here (the fetch takes seconds). `created` is the top folder this run made (`.yad`
  // for `.yad/product`) — what mkdir reports, so the clean-up removes only what this run made.
  let top;
  let created;
  try {
    top = plainPath(fs.mkdirSync(path.dirname(dest), { recursive: true }));
    fs.mkdirSync(dest);
    created = top || dest;
  } catch (e) {
    removeParents(dest, top);
    if (e.code === 'EEXIST') {
      let isDir = false;
      try { isDir = fs.lstatSync(dest).isDirectory(); } catch { /* gone again */ }
      return isDir ? { ...alreadyThere, note: [...notes, alreadyThere.note].join('; ') } : { placed: false, note: [...notes, `a file is where the Product's folder goes (${rel}) — move it, or point path in .sdlc/product-link.json elsewhere`].join('; ') };
    }
    return { placed: false, note: [...notes, `could not make ${rel} (${e.message}) — the Product-reading gates may read what product-repo in a link.md reaches on this machine`].join('; ') };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-run-checks-'));
  const idx = path.join(tmp, 'index');
  try {
    const env = { ...process.env, GIT_INDEX_FILE: idx };
    delete env.GIT_DIR; delete env.GIT_WORK_TREE;
    const read = spawnSync('git', ['read-tree', sha.stdout], { cwd: productRoot, env, encoding: 'utf8' });
    const out = read.status === 0
      ? spawnSync('git', ['checkout-index', '-a', '-f'], { cwd: productRoot, env: { ...env, GIT_WORK_TREE: dest }, encoding: 'utf8' })
      : read;
    if (out.status !== 0) throw new Error((out.stderr || '').trim().split('\n')[0] || 'git could not write it');
  } catch (e) {
    removeCopy(dest, created);
    return { placed: false, note: [...notes, `could not write the Product's ${branch} to ${rel} (${e.message}) — the Product-reading gates may read what product-repo in a link.md reaches on this machine`].join('; ') };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { placed: true, created, dest, note: [...notes, `the Product's ${branch} (${sha.stdout.slice(0, 12)}) is written to ${rel}, as CI checks it out, and removed after these gates`].join('; ') };
}

// Each commit's signature, as git reads it here. `%G?`: G good, U good with unknown trust, X/Y expired,
// R revoked, E cannot be checked (no key here), B bad, N none — or a signature git has no way to check:
// an SSH one with no gpg.ssh.allowedSignersFile reads N too, so the commit object itself is asked.
function localSignatures(repoRoot, base) {
  const r = git(repoRoot, ['log', '--format=%H %G? %P', `${base}..HEAD`]);
  if (!r.ok) return { status: 'fail', lines: [`FAIL [verified-commits]: git could not list the commits in ${base}..HEAD`] };
  const lines = [];
  let bad = 0;
  for (const row of r.stdout.split('\n').filter(Boolean)) {
    const [sha, mark, ...parents] = row.split(' ');
    const short = sha.slice(0, 7);
    let m = mark;
    if (m === 'N' && /^gpgsig(-sha256)? /m.test(git(repoRoot, ['cat-file', 'commit', sha]).stdout.split('\n\n')[0])) m = 'E';
    if (m === 'N' && parents.length > 1) { lines.push(`note [verified-commits]: ${short} is an unsigned merge commit — CI waives it only when it adds nothing of its own`); continue; }
    if (m === 'N') { bad++; lines.push(`FAIL [verified-commits]: ${short} is not signed — sign commits (git config commit.gpgsign true, with a GPG or SSH key added to your account), then re-sign: git rebase --exec 'git commit --amend --no-edit -S' ${base}, and force-push`); continue; }
    if (m === 'B' || m === 'R') { bad++; lines.push(`FAIL [verified-commits]: ${short} has a ${m === 'B' ? 'bad' : 'revoked'} signature — re-sign it with a key your account holds`); continue; }
    if (m === 'X' || m === 'Y') { lines.push(`note [verified-commits]: ${short} is signed, but the ${m === 'X' ? 'signature' : 'key'} has expired — the platform may not mark it Verified`); continue; }
    if (m === 'E') { lines.push(`note [verified-commits]: ${short} is signed, but this machine cannot check the key — the platform checks it in CI`); continue; }
    lines.push(`PASS [verified-commits]: ${short} is signed`);
  }
  if (!lines.length) lines.push(`PASS [verified-commits]: no commits in ${base}..HEAD`);
  lines.push('note [verified-commits]: checked with git here; the platform\'s Verified badge (your key on your account) is judged in CI after the push');
  return { status: bad ? 'fail' : 'pass', lines };
}

// Run one gate, its output shown as it comes, and resolved when it ends. `stop` kills it on a signal.
function runGate(cmd, args, { cwd, env }, live) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    // Its own process group, so a stop reaches the whole gate — bash and the npm/node it starts — and not
    // bash alone, which would leave them holding the output open.
    const detached = process.platform !== 'win32';
    try { child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached }); } catch (e) { resolve({ error: e }); return; }
    live.group = detached;
    live.child = child;
    let partial = '';
    const take = (d) => {
      const s = d.toString();
      out += s;
      partial += s;
      const cut = partial.lastIndexOf('\n');
      if (cut >= 0) { log(partial.slice(0, cut).replace(/^/gm, '  ')); partial = partial.slice(cut + 1); }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    let done = false;
    let wait = null;
    const finish = (res) => {
      if (wait) clearTimeout(wait);
      if (done) return;
      done = true;
      live.child = null;
      if (partial) log(`  ${partial}`);
      resolve({ ...res, out: out.replace(/\s+$/, '') });
    };
    child.on('error', (e) => finish({ error: e }));
    // Done when the gate EXITS, not when every process holding its output lets go: a server or watcher
    // it left behind would hold the run open. What it left is ended with its process group, after a short
    // wait for the last output.
    let ended = 0;
    child.stdout.on('end', () => { ended++; });
    child.stderr.on('end', () => { ended++; });
    child.on('close', (status, signal) => finish({ status, signal }));
    child.on('exit', (status, signal) => {
      const end = () => {
        if (detached) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* none left */ } }
        child.stdout.destroy(); child.stderr.destroy();
        finish({ status, signal });
      };
      // Nothing left holding the output: done now. Otherwise a short wait for the last of it.
      if (ended === 2) end(); else wait = setTimeout(end, 300);
    });
  });
}

export async function runChecks(dir, opts = {}) {
  log(c.bold('\nyad run checks'));
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return refuse(`not a git repo: ${dir}`, 'run it inside the repo whose change you want checked');
  const repoRoot = top.stdout;
  const checksDir = path.join(repoRoot, 'checks');
  if (!exists(checksDir)) return refuse(`no checks/ folder in ${repoRoot} — the gates are not installed here`, 'run `yad check --fix` from the Product to install them');
  let bodyFile = null;
  if (opts.body) {
    bodyFile = path.resolve(process.cwd(), opts.body);
    if (!exists(bodyFile)) return refuse(`--body file not found: ${opts.body}`, 'save the PR/MR description to a file and pass its path');
  }

  const settings = readJSON(path.join(repoRoot, '.sdlc/product.json'), null) || readJSON(path.join(repoRoot, '.sdlc/hub.json'), null);
  const isProduct = !!settings;
  const branchName = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout;
  const meta = registryEntryFor(opts.product || null, repoRoot)?.meta || null;
  // The registry's platform first: a self-hosted GitLab's host need not say "gitlab".
  const platform = (isProduct ? settings.platform : null) || meta?.platform
    || detectPlatform(git(repoRoot, ['remote', 'get-url', 'origin']).stdout) || null;

  // The base: as given, else the branch `yad open-pr` would open the PR against, fetched first.
  let base = opts.base;
  let chosenBase = null;
  if (!base) {
    // The Product's own default_branch counts only for the Product itself: a code repo's trunk is its own.
    const chosen = resolveBaseBranch(platform, { cwd: repoRoot, meta, productConfig: isProduct ? settings : null, probe: false });
    const b = safeBranch(chosen.base);
    if (!b) return refuse(`the base branch '${chosen.base}' (from ${chosen.source}) is not a branch name git accepts`, 'pass --base <ref>');
    if (opts.fetch !== false && !fetchBranch(repoRoot, b).ok) warn(`could not fetch ${b} from origin — the last fetched origin/${b} is the base`);
    base = `origin/${b}`;
    // A base nobody chose may not be where this branch was cut from (#450) — `yad open-pr` stops there;
    // this run only warns, as it opens nothing.
    if (!['registry', 'product'].includes(chosen.source)) chosenBase = b;
  } else if (base.startsWith('-')) {
    return refuse(`--base '${base}' is not a ref`, 'pass a branch or commit, such as origin/main');
  }
  if (!git(repoRoot, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`]).ok) {
    return refuse(`base '${base}' is not a commit here`, 'fetch it (git fetch origin), or pass --base <ref>');
  }
  info(`${isProduct ? 'Product' : 'code repo'} ${path.basename(repoRoot)} · branch ${branchName} · base ${base}`);
  if (chosenBase) {
    const fork = forkBranch(repoRoot, { base: chosenBase, head: branchName });
    if (fork && !fork.skipped) warn(forkBranchWords(fork, chosenBase, { ref: 'origin/', verb: 'check against' }));
  }
  // A grouped PR (#350) — commits carrying several tasks — is warned about over its size limit, as
  // `yad open-pr` warns. Never a failed gate.
  if (!isProduct) {
    const ids = rangeTasks(repoRoot, `${base}..HEAD`);
    const productSettings = opts.product ? (readJSON(path.join(opts.product, '.sdlc/product.json'), null) || readJSON(path.join(opts.product, '.sdlc/hub.json'), null)) : null;
    for (const line of groupWarnings(repoRoot, base, ids, productSettings || {})) warn(line);
  }
  if (!git(repoRoot, ['merge-base', '--is-ancestor', base, 'HEAD']).ok) {
    info(`this branch is not on top of ${base}: CI on GitHub tests the merge of the two, this run the branch tip — rebase onto ${base} for the same answer`);
  }
  // Uncommitted work, but not a Product copy at the record's path (one already there gets its own note when the Product gates run).
  let recRel = null;
  // Read as readRecord and the gate read it, so the same folder is skipped.
  recRel = safeRecordPath(recordFields(repoRoot, base)?.field('path') ?? '');
  const st = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], { cwd: repoRoot, encoding: 'utf8' });
  // A rename or copy is two entries, `R  new` then the old name with no status: the old one is skipped.
  const entries = (st.stdout || '').split('\0');
  const changed = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    changed.push(e.slice(3));
    if ('RC'.includes(e[0]) || 'RC'.includes(e[1])) i++;
  }
  // An untracked folder on the record's path (`.yad/`, shown collapsed) is skipped whole.
  const dirty = changed
    .filter((p) => !(recRel && (p.startsWith(`${recRel}/`) || `${recRel}/`.startsWith(`${p.replace(/\/$/, '')}/`))));
  if (dirty.length) info(`uncommitted changes are built and tested here but are not in the push (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? `, and ${dirty.length - 3} more` : ''}) — commit or stash them for CI's answer`);
  if (git(repoRoot, ['rev-list', '--count', `${base}..HEAD`]).stdout === '0') {
    info(`no commits in ${base}..HEAD — there is nothing of this branch's own to check`);
  }

  // The PR text.
  let title = opts.title || null;
  let titleNote = null;
  // A Product review branch's title is `review: <artifact> (EP-<slug>)`, which `yad gate open` writes — a
  // commit subject is never it.
  const reviewHead = isProduct && /^review\/EP-/.test(branchName);
  if (isProduct && branchName === 'HEAD') info('HEAD is detached: the Product gates split by branch name, so check out the branch the PR comes from for CI\'s answer');
  if (!title && !reviewHead) {
    const subjects = git(repoRoot, ['log', '--no-merges', '--format=%s', `${base}..HEAD`]).stdout.split('\n').filter(Boolean);
    if (subjects.length === 1) { title = subjects[0]; titleNote = 'the title is the branch\'s one commit subject (pass --title to check another)'; }
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-run-checks-'));
  let placed = null;
  const live = { child: null, stopped: false };
  // A folder this run read as it was (another run's copy, say) may be removed by that run meanwhile.
  const checkVanished = () => {
    if (!placed?.existing || placed.vanished !== undefined) return;
    placed.vanished = !exists(placed.existing);
    if (placed.vanished) warn(`${record?.rel || 'the Product copy'} was removed while the Product gates read it (another run ended) — their answers may be wrong; run again`);
  };
  const removeProduct = () => {
    if (!placed?.placed) return;
    removeCopy(placed.dest, placed.created);
    placed.placed = false;
  };
  // The gate runs in a session of its own, so a Ctrl-C reaches only yad, which passes it on. It ends the
  // run: the gate is stopped, the Product copy removed, and nothing after it runs. A gate that ignores it
  // is killed on the second signal, or after five seconds.
  const killGate = (sig) => {
    const ch = live.child;
    if (!ch) return;
    try {
      if (live.group) process.kill(-ch.pid, sig);
      else if (process.platform === 'win32' && sig === 'SIGKILL') spawnSync('taskkill', ['/T', '/F', '/PID', String(ch.pid)]);
      else ch.kill(sig);
    } catch { /* already gone */ }
  };
  let escalate = null;
  const onSignal = (sig) => {
    if (live.stopped) { killGate('SIGKILL'); return; }
    live.stopped = sig;
    killGate(sig);
    escalate = setTimeout(() => killGate('SIGKILL'), 5000);
    escalate.unref();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const s of signals) process.on(s, onSignal);

  const results = [];
  let record = null;
  try {
    // The changed paths, for the Product's pr-title/pr-template split, built as yad-product-pr-text.yml does.
    const changedFile = path.join(scratch, 'changed');
    if (isProduct) {
      const d = git(repoRoot, ['-c', 'core.quotePath=false', 'diff', '--no-renames', '--name-only', `${base}...HEAD`]);
      fs.writeFileSync(changedFile, d.ok ? `${d.stdout}\n` : '');
    }

    const profile = isProduct ? 'product' : 'code';
    const head = isProduct ? ['--head', branchName, '--changed', changedFile] : [];
    const titleNeeds = title ? null : reviewHead
      ? 'a review branch: pass --title "review: <artifact> (EP-<slug>)" — `yad gate open` writes that title'
      : 'no title: pass --title "<the PR/MR title>" (a branch of one commit uses its subject)';
    const bodyNeeds = bodyFile ? null : 'no description: pass --body <file holding the PR/MR description>';
    // The build gates first and the four Product-reading gates together, so the Product copy exists only
    // while they run — in CI the build job never has it.
    const gates = isProduct
      ? [
        { name: 'commit-message', script: 'commit-message.sh', args: ['--profile', profile, base] },
        { name: 'pr-title', script: 'pr-title.sh', args: ['--profile', profile, ...head, title], needs: titleNeeds },
        { name: 'pr-template', script: 'pr-template.sh', args: ['--profile', profile, ...head, bodyFile], needs: bodyNeeds },
        { name: 'ledger-guard', script: 'ledger-guard.sh', args: [base] },
        { name: 'member-check', script: 'member-check.mjs', node: true, args: [base] },
        { name: 'verified-commits', local: true },
      ]
      : [
        { name: 'spec-link', script: 'spec-link.sh', args: [base] },
        { name: 'commit-message', script: 'commit-message.sh', args: ['--profile', profile, base] },
        { name: 'pr-title', script: 'pr-title.sh', args: ['--profile', profile, title], needs: titleNeeds },
        { name: 'pr-template', script: 'pr-template.sh', args: ['--profile', profile, bodyFile], needs: bodyNeeds },
        { name: 'risk-map', script: 'risk-map-check.sh', args: [base] },
        // The base, as CI passes it: a Unity project skips both, unless its base has a package.json (#496).
        { name: 'install-deps', script: 'install-deps.sh', args: [base], build: true },
        { name: 'build/test/lint', script: 'build-test-lint.sh', args: [base], build: true, after: 'install-deps' },
        { name: 'contract-check', script: 'contract-check.sh', args: [base] },
        { name: 'lineage-check', script: 'lineage-check.sh', args: [base] },
        { name: 'epic-open', script: 'epic-open.sh', args: [base] },
        { name: 'reconcile-debt', script: 'reconcile-debt-check.sh', args: [base] },
        { name: 'verified-commits', local: true },
        { name: 'backfill', script: 'backfill-check.sh', args: [base], optional: true },
      ];

    // Nothing from the shell this runs in may make a gate act as in CI, or read another settings file,
    // platform or git folder. GITHUB_TOKEN stays: gh reads it to sign in.
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
      if (k === 'CI' || k === 'GITLAB_CI' || k.startsWith('CI_') || (k.startsWith('GITHUB_') && k !== 'GITHUB_TOKEN')
        || k.startsWith('SDLC_') || k === 'GIT_DIR' || k === 'GIT_WORK_TREE' || k === 'GIT_INDEX_FILE') delete env[k];
    }
    // The build gates get what the CI job sets for them.
    const headSha = git(repoRoot, ['rev-parse', 'HEAD']).stdout;
    const baseSha = git(repoRoot, ['rev-parse', `${base}^{commit}`]).stdout;
    const buildEnv = { ...env, CI: 'true', NX_BASE: baseSha, NX_HEAD: headSha, YAD_TEST_MAX_WORKERS: env.YAD_TEST_MAX_WORKERS || '2' };

    for (const g of gates) {
      if (live.stopped) break;
      const scriptPath = g.script ? path.join(checksDir, g.script) : null;
      if (g.optional && !exists(scriptPath)) continue;
      // The copy exists only while the Product-reading gates run, whichever of them is installed.
      if (placed?.placed && !PRODUCT_GATES.has(g.name)) removeProduct();
      if (placed?.existing && !PRODUCT_GATES.has(g.name)) checkVanished();
      log(`\n${c.bold(g.name)}`);
      const r = { name: g.name, status: 'pass', reason: null, output: '' };
      results.push(r);

      // The Product goes in place just before the first Product-reading gate.
      if (!isProduct && PRODUCT_GATES.has(g.name) && !record) {
        record = readRecord(repoRoot, base);
        if (record.fail) {
          results.splice(results.length - 1, 0, { name: 'product-checkout', status: 'fail', reason: 'the Product could not be put where CI puts it', output: `FAIL [product-checkout]: ${record.fail}` });
          log(`  FAIL [product-checkout]: ${record.fail}`);
        } else if (record.nothing) {
          info(record.nothing);
        } else if (record.none) {
          info(`no .sdlc/product-link.json on ${base}, so nothing is checked out for the Product — the Product-reading gates read what product-repo in a link.md reaches on this machine (CI reaches nothing, and they skip their Product check there)`);
        } else {
          placed = placeProduct(repoRoot, opts.product || null, record, { fetch: opts.fetch !== false });
          info(placed.note);
        }
      }

      // In CI these four are steps after product-checkout in the same job: they never run when it fails.
      if (record?.fail && PRODUCT_GATES.has(g.name)) { r.status = 'skip'; r.reason = 'product-checkout failed, so it was not run (as in CI)'; info(r.reason); continue; }
      if (g.local) {
        const s = localSignatures(repoRoot, base);
        r.status = s.status; r.output = s.lines.join('\n');
        log(r.output.replace(/^/gm, '  '));
        continue;
      }
      if (!exists(scriptPath)) {
        r.status = 'skip';
        r.reason = `checks/${g.script} is not installed here — \`yad check --fix\` installs the gates this repo is wired for`;
        info(r.reason);
        continue;
      }
      if (g.build && opts.build === false) { r.status = 'skip'; r.reason = 'skipped with --no-build'; info(r.reason); continue; }
      if (g.after && results.find((x) => x.name === g.after)?.status === 'fail') { r.status = 'skip'; r.reason = `${g.after} failed, so it was not run`; info(r.reason); continue; }
      if (g.needs) { r.status = 'skip'; r.reason = g.needs; info(r.reason); continue; }
      if (g.name === 'member-check') {
        const m = git(repoRoot, ['diff', '--no-renames', '--name-only', `${base}...HEAD`, '--', '.sdlc/members']);
        if (m.ok && m.stdout) { r.status = 'skip'; r.reason = 'a member file changes, and the gate needs the PR\'s author, which only CI has — it is judged in CI'; info(r.reason); continue; }
      }
      if (g.name === 'install-deps') info('installs from the lockfile as CI does (npm ci or pnpm install --frozen-lockfile, which replace node_modules; Corepack is enabled when package.json pins a package manager) — --no-build skips it');
      const shipped = shippedTemplate(g.script);
      if (shipped && contentSha(shipped) !== contentSha(scriptPath)) {
        r.differs = true;
        warn(`checks/${g.script} is not the gate this yadflow ships — CI runs the committed copy; if it is an older one, \`yad update\` replaces it`);
      }
      if (live.stopped) { results.pop(); break; }
      const p = await runGate(g.node ? process.execPath : 'bash', [scriptPath, ...g.args], { cwd: repoRoot, env: g.build ? buildEnv : env }, live);
      r.output = p.out || '';
      if (p.error) {
        r.status = 'fail';
        r.reason = `could not run it: ${p.error.message}${process.platform === 'win32' && !g.node ? ' — the gates need bash (Git Bash) on the PATH' : ''}`;
        log(`  ${r.reason}`);
      } else if (live.stopped || (process.platform === 'win32' && (p.status === 130 || p.status === 3221225786))) {
        r.status = 'skip'; r.reason = 'stopped';
        live.stopped = live.stopped || 'SIGINT';
      } else {
        r.exit = p.status;
        r.status = p.status === 0 ? 'pass' : 'fail';
        // A gate that passed by skipping says so (#496): a skipped gate is not a pass.
        if (r.status === 'pass' && /^SKIP \[/m.test(r.output)) { r.status = 'skip'; r.reason = 'a Unity project: build and test it with Unity\'s own CI'; }
      }
      if (g.name === 'pr-title' && titleNote) info(titleNote);
      if (g.name === 'pr-template' && platform === 'gitlab') {
        const len = [...fs.readFileSync(bodyFile, 'utf8')].length;
        if (len >= GITLAB_DESCRIPTION_CUT) warn(`the description is ${len} characters; GitLab hands CI only the first ${GITLAB_DESCRIPTION_CUT} — the gate then reads the rest from GitLab's API with a token, so keep the required sections near the top`);
      }
    }
    // A signal that came during the last synchronous step is handled before the listeners go.
    await new Promise((r) => setImmediate(r));
    checkVanished();
  } finally {
    if (escalate) clearTimeout(escalate);
    removeProduct();
    fs.rmSync(scratch, { recursive: true, force: true });
    for (const s of signals) process.removeListener(s, onSignal);
  }

  const failed = results.filter((r) => r.status === 'fail');
  const skipped = results.filter((r) => r.status === 'skip');
  const passed = results.filter((r) => r.status === 'pass');
  const json = () => ({
    repo: path.basename(repoRoot), kind: isProduct ? 'product' : 'code', base, platform,
    product: placed ? { placed: !!placed.dest, path: record?.rel || null, note: placed.note || null, ...(placed.vanished ? { vanished: true } : {}) } : null,
    gates: results.map(({ name, status, reason, exit, differs, output }) => ({
      name, status, ...(reason ? { reason } : {}), ...(exit !== undefined ? { exit } : {}), ...(differs ? { differs: true } : {}),
      // The FAIL lines, so an agent reading --json sees what to change without the whole log.
      fails: (output || '').split('\n').map((l) => l.trim()).filter((l) => /^FAIL /.test(l)),
    })),
    passed: passed.length, failed: failed.length, skipped: skipped.length,
    stopped: !!live.stopped,
  });
  if (live.stopped) {
    fail(`stopped (${live.stopped}) — nothing after that gate ran${placed?.dest ? '; the Product copy is removed' : ''}`);
    process.exitCode = { SIGTERM: 143, SIGHUP: 129 }[live.stopped] || 130;
    return inJSON() ? json() : { stopped: true };
  }
  log(`\n${c.bold('Summary')}`);
  for (const r of results) {
    const line = `${r.name}${r.reason ? ` — ${r.reason}` : ''}`;
    if (r.status === 'pass') ok(line);
    else if (r.status === 'skip') info(`skipped: ${line}`);
    else log(`  ${c.red('✗')} ${line}`);
  }
  if (failed.length) {
    fail(`${failed.length} gate${failed.length > 1 ? 's' : ''} failed: ${failed.map((r) => r.name).join(', ')}`);
    hand('fix what each FAIL line says, then run `yad run checks` again — docs/GATES.md lists every message and what to change');
    process.exitCode = 1;
  } else {
    ok(`${passed.length} passed${skipped.length ? `, ${skipped.length} skipped (a skipped gate is not a pass)` : ''} — push when ready`);
  }
  if (inJSON()) return json();
  return { failed: failed.length };
}
