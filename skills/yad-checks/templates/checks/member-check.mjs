#!/usr/bin/env node
// member-check gate (E131) — a member file (`.sdlc/members/<platform>-<login>.json`) says which accounts and
// which git emails are one person. The active-people count joins a commit to an approval through it, so a
// false file would fold one person into another and make the count SMALLER. This gate refuses that:
//
//   1. A PR may ADD or CHANGE only its author's own file: named `<platform>-<author>.json`, holding exactly
//      one account on the Product's platform and host — the author's, with the author's numeric account id
//      (so a login someone renamed away from, and another person registered, cannot take over the old file).
//      Never a bot's.
//   2. On GitHub, every email in a file the PR adds or changes must be the author email of a commit in the PR that GitHub itself
//      attributes to the PR's author (`commits/<sha>` → `author.login`). GitHub links a commit to an account
//      only through an email that account has verified, so this is the platform's proof, not the file's
//      claim. `yad member add` writes one commit per email for exactly this. On GitLab the API says no such
//      thing, so emails there feed the team list only and are never used by the gate count (the user's
//      decision, 2026-10-05) — this gate checks the owner rule alone.
//   3. A PR may DELETE anyone's file (removing a person can only make the count larger). `yad member remove
//      <login> --reason` puts the reason in the commit.
//   4. No account on the Product's platform, and no email, may be in two member files. (An OTHER account
//      two files claim is not refused: the CLI matches it to nobody until one file drops it, and refusing
//      it here would let whoever claimed it first block its real owner from joining.)
//   5. `.sdlc` and `.sdlc/members` are real folders and nothing under them is a link, and no path is a
//      case or Unicode twin of `.sdlc/members/` — a macOS or Windows checkout would read either as a member
//      file this gate never judged (E131 review 1–2; the E115 and E121 lessons).
//
// LIMIT: like every Product gate, this file and the workflow that runs it come from the PR's own checkout,
// so a PR can change the gate it is judged by; branch protection on the default branch is the backstop.
//
// A Node script, not bash: it reads JSON and hashes, and both CI images already have Node (E113's hooks are
// Node for the same reason). Usage: node checks/member-check.mjs <base-ref>
//   GitHub: PR_AUTHOR and PR_AUTHOR_ID (github.event.pull_request.user.login / .id) and GH_TOKEN (a read
//   token) in the environment.
//   GitLab: CI_API_V4_URL, CI_PROJECT_ID, CI_MERGE_REQUEST_IID, and GITLAB_TOKEN or SDLC_API_TOKEN. With no
//   token it FAILS when a member file changed (fail closed — the user's decision, 2026-10-05).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DIR = '.sdlc/members/';
const LOGIN_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
let rc = 0;
const say = (s) => process.stdout.write(`${s}\n`);
const fail = (s) => { say(`FAIL [member-check]: ${s}`); rc = 1; };
const git = (...args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  return { ok: r.status === 0, out: r.stdout || '', status: r.status };
};
const hash = (email) => {
  const e = String(email || '').trim().toLowerCase();
  return e.indexOf('@', 1) < 0 ? null : `sha256:${createHash('sha256').update(e).digest('hex')}`;
};
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

// The Product's settings under either name (product.json from 4.0, hub.json before). Drift between the two
// is refused by the other gates and the CLI; here the first one found is read.
const settingsFile = ['.sdlc/product.json', '.sdlc/hub.json'].find((f) => fs.existsSync(f)) || null;
const settings = settingsFile ? parse(fs.readFileSync(settingsFile, 'utf8')) : null;
const platform = settings?.platform === 'github' || settings?.platform === 'gitlab' ? settings.platform : null;
// The Product's host, from its clone URL (`git@host:…` or `https://host/…`), else the platform's own.
function hostOf(url) {
  const u = String(url || '').trim();
  const scp = u.match(/^(?:[^@/]+@)?([^/:]+):(?!\/)/);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return scp[1].toLowerCase();
  try { return new URL(u).hostname.toLowerCase() || null; } catch { return null; }
}
// The same order the CLI reads it in: the settings' `git_url`, then the clone's origin (review 3).
const productHost = hostOf(settings?.git_url) || hostOf(git('remote', 'get-url', 'origin').out) || (platform === 'gitlab' ? 'gitlab.com' : 'github.com');
const onProduct = (a) => a?.platform === platform && String(a?.host || '').toLowerCase() === productHost;

const base = process.argv[2];
if (!base) { say('FAIL [member-check]: usage: node checks/member-check.mjs <base-ref> — the job must pass the base ref (the branch the PR targets), as yad-product-checks.yml (GitHub) and yad-product-checks.gitlab-ci.yml (GitLab) do'); process.exit(1); }
if (!git('rev-parse', '--verify', '-q', `${base}^{commit}`).ok) { say(`FAIL [member-check]: cannot resolve the base ref ${base} — check the code out with full history (GitHub: actions/checkout with fetch-depth: 0; GitLab: GIT_DEPTH: "0")`); process.exit(1); }

// Every path the PR touches, with its status. NUL-separated, no renames (a rename is a delete plus an add,
// and each is judged).
//
// What the PR changes is what MERGING it into the base makes it (#368), read as contract-check reads it
// (#363 reviews 1, 3-5). A diff from the merge base (`<base>...HEAD`) reads from ONE of several: on a
// GitLab MR pipeline (the branch tip, not a merge commit), a hand-resolved merge could bring a member file
// in that the diff never lists. `git merge-tree --write-tree` (git 2.38+) builds the merge without touching
// anything, and the diff runs from the base to it. A branch that does not merge cleanly fails closed: the
// platform cannot merge it either. An older git falls back to the one merge base, failing closed when
// there are several, when the base removed or moved a file the branch changes (the real merge would
// follow it), when the base has moved on and the branch changes member files, or when the base moved a
// folder's files into the members folder and the branch adds a file to that folder (a merge that follows
// folder renames would carry it in). No merge base at all fails closed too.
const HISTORY = 'check the code out with full history (GitHub: actions/checkout with fetch-depth: 0; GitLab: GIT_DEPTH: "0")';
const bases = git('merge-base', '--all', base, 'HEAD').out.split('\n').filter(Boolean);
if (!bases.length) { say(`FAIL [member-check]: '${base}' and HEAD share no history (a shallow clone has no merge base), so the changed files cannot be listed — ${HISTORY}, and give a base this branch shares history with, then run again`); process.exit(1); }
const built = git('merge-tree', '--write-tree', '--no-messages', base, 'HEAD');
const mergeTree = built.out.split('\n')[0].trim();
let from;
let to;
if (built.status === 0 && mergeTree && git('rev-parse', '--verify', '-q', `${mergeTree}^{tree}`).ok) {
  from = git('rev-parse', '--verify', '-q', `${base}^{commit}`).out.trim();
  to = mergeTree;
  if (bases.length > 1) say(`note [member-check]: '${base}' and HEAD have ${bases.length} merge bases — the change is read as the merge into ${base} makes it`);
} else if (built.status === 1) {
  say(`FAIL [member-check]: this branch does not merge cleanly into ${base}, so what it changes there cannot be read — merge ${base} into the branch, resolve the conflicts, then push again`);
  process.exit(1);
} else if (built.status !== 129) {   // 129: git's usage error, which a git older than 2.38 gives for --write-tree (as contract-check reads it)
  say(`FAIL [member-check]: git could not build the merge of this branch into ${base} (git merge-tree exit ${built.status}) — ${HISTORY}, then run again`);
  process.exit(1);
} else if (bases.length !== 1) {
  say(`FAIL [member-check]: '${base}' and HEAD have ${bases.length} merge bases, and this git (older than 2.38) cannot build the merge into ${base} — merge ${base} into the branch, then push again`);
  process.exit(1);
} else {
  from = bases[0];
  to = 'HEAD';
  // The fallback reads the branch's own diff, so an edit to a file the base has since removed or moved
  // would follow the rename into the merge unseen: such a path fails closed.
  const names = (r, keep) => { const v = r.out.split('\0').filter(Boolean); const o = []; for (let i = 0; i + 1 < v.length; i += 2) if (keep(v[i][0])) o.push(v[i + 1]); return o; };
  const goneRead = git('diff', '--no-renames', '--diff-filter=D', '--name-status', '-z', from, base);
  const mineRead = git('diff', '--no-renames', '--name-status', '-z', from, 'HEAD');
  if (!goneRead.ok || !mineRead.ok) { say(`FAIL [member-check]: git could not list what changed since this branch split off from ${base} — ${HISTORY}, then run again`); process.exit(1); }
  const gone = new Set(names(goneRead, () => true));
  // Every path, not only member files: a base rename from elsewhere INTO the members folder must be caught.
  if (names(mineRead, (s) => s === 'M' || s === 'T').some((f) => gone.has(f))) {
    say(`FAIL [member-check]: ${base} removed or moved a file this branch changes, and this git (older than 2.38) cannot follow it into the merge — merge ${base} into the branch, then push again`);
    process.exit(1);
  }
  // The rules below read the files as the merge would hold them, and this git reads them at HEAD. Once the
  // base has moved on, the merge can hold member files HEAD does not show: a file both sides changed (review
  // 1), a file the branch renamed in and the base edited at its old path, a file the base added that the clash
  // check must see (review 2). So a branch that changes member files fails closed until it holds the base.
  // Any spelling of the folder counts (the twin rule below names it), read the way a case-blind disk reads it.
  const baseTip = git('rev-parse', '--verify', '-q', `${base}^{commit}`).out.trim();
  const memberish = (f) => f.normalize('NFKC').toLowerCase().startsWith('.sdlc/members');
  if (baseTip !== from && names(mineRead, () => true).some(memberish)) {
    say(`FAIL [member-check]: ${base} has moved on since this branch split off, and this git (older than 2.38) cannot read the member files this branch changes as the merge would hold them — merge ${base} into the branch, then push again`);
    process.exit(1);
  }
  // A folder the base moved into the members folder (its files deleted there, member files added): a merge
  // that follows folder renames (merge.directoryRenames=true) carries a file the branch adds to that folder
  // in as a member file this diff never shows. Git's default makes it a conflict; this closes it either way.
  if (baseTip !== from) {
    const baseRead = git('diff', '--no-renames', '--name-status', '-z', from, base);
    if (!baseRead.ok) { say(`FAIL [member-check]: git could not list what changed since this branch split off from ${base} — ${HISTORY}, then run again`); process.exit(1); }
    // Every folder a path sits in (never the top level, which git never renames).
    const folders = (f) => { const out = []; for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) out.push(f.slice(0, i)); return out; };
    // Git renames a folder only when it is gone on that side: the folders of the base's deletions, less any
    // the base still holds — a folder that held only subfolders counts too (review 4).
    const stillThere = new Set(git('ls-tree', '-r', '-d', '--name-only', '-z', base).out.split('\0').filter(Boolean));
    const gone = new Set(names(baseRead, (s) => s === 'D').flatMap(folders).filter((d) => !stillThere.has(d)));
    const movedIn = names(baseRead, (s) => s === 'A').some(memberish);
    if (movedIn && gone.size && names(mineRead, (s) => s === 'A').some((f) => folders(f).some((d) => gone.has(d)))) {
      say(`FAIL [member-check]: ${base} moved files into the members folder from a folder this branch adds a file to, and this git (older than 2.38) cannot tell where the merge puts it — merge ${base} into the branch, then push again`);
      process.exit(1);
    }
  }
}
const diff = git('diff', '--no-renames', '--name-status', '-z', from, to);
// Where every rule below reads the files (review 1): what the merge into the base holds — the tree git
// built, or HEAD on an older git, where any case the merge could hold differently has failed closed above.
const AT = to;
if (!diff.ok) { say('FAIL [member-check]: git could not list the changed files — check the code out with full history (GitHub: actions/checkout with fetch-depth: 0; GitLab: GIT_DEPTH: "0"), and give a base this branch shares history with, then run again'); process.exit(1); }
const parts = diff.out.split('\0').filter(Boolean);
const all = [];
for (let i = 0; i + 1 < parts.length; i += 2) all.push({ status: parts[i][0], path: parts[i + 1] });

// How to take member files out, the one rule every message uses (#381 review 4): a file this PR brings in
// (not on the base) is dropped from it; one the base holds — even one this PR edits — is deleted with git
// rm, which any PR may do (a deletion is never refused).
// "On the base" means the commit the diff above starts from (review 7): the base itself when the merge was
// built (#368), the one merge base on an older git. The path is read literally, never as a pattern.
const split = from;
const modeOnBase = (p) => {
  const t = spawnSync('git', ['--literal-pathspecs', 'ls-tree', '-z', split, '--', p], { encoding: 'utf8' });
  const [meta, at] = (t.status === 0 ? t.stdout : '').split('\0')[0].split('\t');
  return at === p ? meta.slice(0, 6) : null;
};
// A FILE there (a folder is not one), and a plain one (not a link).
const onBase = (p) => { const m = modeOnBase(p); return !!m && m !== '040000'; };
const plainOnBase = (p) => ['100644', '100755'].includes(modeOnBase(p));
// A path as a command takes it: shell-quoted unless it is plain (review 5), so a name with a space pastes whole.
const q = (p) => (/^[A-Za-z0-9._\/@+-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);
// How to UNDO this PR's change to one file (review 6) — not to remove it: the base's copy, if the base holds
// one, comes back; a file only this PR added goes. A teammate's file the PR edited is never deleted by it.
// The command restores the copy the diff compares against: the base's, or (older git) the merge base's.
const restoreFrom = to === 'HEAD' ? `${base}...HEAD` : base;
const undo = (p) => (onBase(p) ? `restore ${q(p)} to the base's copy (git checkout ${q(restoreFrom)} -- ${q(p)})`
  : `drop ${q(p)} from this pull request (git rm it on this branch)`);
const removal = (paths) => {
  const here = paths.filter((p) => !onBase(p));
  const there = paths.filter(onBase);
  return [...(here.length ? [`drop ${here.map(q).join(' and ')} from this pull request (git rm it on this branch)`] : []),
    ...(there.length ? [`git rm ${there.map(q).join(' ')} (any pull request may delete a member file)`] : [])].join('; ');
};

// A path as a case-insensitive, Unicode-folding file system sees it: `.sdlc/Members/x` and `.ſdlc/members/x`
// land in `.sdlc/members/` on macOS and Windows.
// A deletion is never judged here: removing a twin is how one is cleaned up (review 2).
const fold = (p) => p.normalize('NFKC').toLowerCase();
for (const { status, path } of all) {
  if (status === 'D') continue;
  const f = fold(path);
  if ((f === '.sdlc' || f.startsWith('.sdlc/')) && !(path === '.sdlc' || path.startsWith('.sdlc/'))) fail(`${JSON.stringify(path)} is another spelling of .sdlc/, which a macOS or Windows checkout reads as the Product's own folder, unjudged — move it into the real .sdlc/ folder (git mv), or delete it`);
  // `.sdlc/members` itself, a link where the folder goes, is the folder check's below, not a second spelling.
  else if ((f === '.sdlc/members' || f.startsWith(DIR)) && !path.startsWith(DIR) && path !== '.sdlc/members') fail(`${JSON.stringify(path)} is another spelling of ${DIR}, which a macOS or Windows checkout reads as a member file this gate does not judge — move it into the real ${DIR} folder (git mv), or delete it`);
}
// The folders themselves must be folders in the merge, and nothing under them a link.
for (const p of ['.sdlc', '.sdlc/members']) {
  const t = git('ls-tree', AT, '--', p).out.trim();
  if (t && !t.startsWith('040000 ')) fail(`${p} is not a folder in this change (a link?), and member files are read only from a real ${DIR} — replace it with a real folder that holds the files themselves`);
}
// Names of one file (twins): keep ONE per group, take every other out (reviews 4-6). Kept first: a plain file
// (a link is refused in this same run), then a copy the base holds (a new one was meant as another file),
// then the ASCII lower-case name `yad member add` writes. Nothing is renamed: taking the others out clears the clash. When this PR
// brings in that lower-case name beside a base copy, it may be its person's own `yad member add` run — the
// message says how to keep it instead.
const lowerName = (p) => { const n = p.slice(p.lastIndexOf('/') + 1); return n === n.toLowerCase() && /^[\x20-\x7e]*$/.test(n); };
function twins(group) {
  const old = group.filter((g) => onBase(g.path));
  const rank = (g) => (g.plain ? 0 : 2) + (lowerName(g.path) ? 0 : 1);
  // A link is refused in this same run, so it is kept only when every name is one (review 6).
  const plain = group.filter((g) => g.plain);
  const pick = plain.length ? plain : group;
  const pickOld = pick.filter((g) => old.includes(g));
  const keep = [...(pickOld.length ? pickOld : pick)].sort((x, y) => rank(x) - rank(y))[0].path;
  const own = old.length ? group.find((g) => !old.includes(g) && g.plain && lowerName(g.path) && g.path !== keep) : null;
  const instead = own ? `; or, if ${q(own.path)} is your own file as yad member add writes it, keep it and ${removal(group.filter((g) => g !== own).map((g) => g.path))}` : '';
  fail(`${group.map((g) => g.path).join(' and ')} are one file on macOS and Windows — keep ${q(keep)}: ${removal(group.filter((g) => g.path !== keep).map((g) => g.path))}${instead}`);
}
const tree = git('ls-tree', '-r', '-z', AT, '--', DIR).out.split('\0').filter(Boolean);
const folded = new Map();
for (const line of tree) {
  const [meta, p] = line.split('\t');
  const plain = meta.startsWith('100644 ') || meta.startsWith('100755 ');
  // Where the base held a plain file, this PR's link is undone, never deleted: a deletion passes, and would
  // remove that person (review 7). A link the base already held was never read, so deleting it loses nothing.
  const linkFix = plainOnBase(p) ? undo(p) : onBase(p) ? `replace it with the file itself, or git rm it: the gate never read it, so nothing is lost`
    : `replace it with the file itself (yad member add writes it), or ${undo(p)}`;
  if (!plain) fail(`${p} is not a plain file (a link?), and a member file is never read through one — ${linkFix}`);
  const k = fold(p);
  folded.set(k, [...(folded.get(k) || []), { path: p, plain }]);
}
for (const group of folded.values()) if (group.length > 1) twins(group);
if (rc) process.exit(rc);

const changed = all.filter((c) => c.path.startsWith(DIR));
if (!changed.length) { say('PASS [member-check]: no member file changed'); process.exit(0); }
// Where to set it: the file the gate read, or the one `yad setup` writes when there is none (review 1).
if (!platform) {
  const fix = !settingsFile ? 'there is no .sdlc/product.json: run yad setup in the Product, or write the file with "platform" ("github" or "gitlab")'
    : !settings || typeof settings !== 'object' || Array.isArray(settings) ? `${settingsFile} is not valid JSON or not an object: fix it, and set "platform" ("github" or "gitlab") in it`
      : `set "platform" ("github" or "gitlab") in ${settingsFile}`;
  say(`FAIL [member-check]: member files changed, but the Product names no platform, so nothing can be proven — ${fix}`);
  process.exit(1);
}

// Who opened the PR/MR, asked of the platform's own record.
// Returns { login, id }: the numeric id is what stays with a person when a login is renamed and reused.
async function prAuthor() {
  if (platform === 'github') return { login: process.env.PR_AUTHOR || null, id: Number(process.env.PR_AUTHOR_ID) || null };
  const url = process.env.CI_API_V4_URL;
  const project = process.env.CI_PROJECT_ID;
  const iid = process.env.CI_MERGE_REQUEST_IID;
  const token = process.env.GITLAB_TOKEN || process.env.SDLC_API_TOKEN;
  if (!url || !project || !iid) return null;
  if (!token) { fail('no API token (GITLAB_TOKEN or SDLC_API_TOKEN) to read who opened this MR — a member file cannot be checked without it; add a GITLAB_TOKEN masked CI/CD variable with the read_api scope, whose user can see the project'); return null; }
  try {
    const r = await fetch(`${url}/projects/${encodeURIComponent(project)}/merge_requests/${encodeURIComponent(iid)}`, { headers: { 'PRIVATE-TOKEN': token } });
    // What to change, by what GitLab answered, as pr-template says it (#381). Only a refusal is the
    // token's fault; anything else is said as it is, with no advice to change the token.
    if (!r.ok) {
      const name = process.env.GITLAB_TOKEN ? 'GITLAB_TOKEN' : 'SDLC_API_TOKEN';
      const why = {
        401: `${name} was not accepted (expired, revoked, or not a valid token here) — renew or replace it`,
        403: `${name} was refused — give it the read_api scope`,
        404: `${name}'s user cannot see this project — use a token of a project member with Reporter access or more`,
      }[r.status] || 'GitLab did not answer with the MR — run the job again later';
      fail(`could not read the MR (HTTP ${r.status}): ${why}`);
      return null;
    }
    const mr = await r.json();
    return { login: mr?.author?.username || null, id: Number(mr?.author?.id) || null };
  } catch (e) { fail(`could not read the MR: ${e.message} — check that CI_API_V4_URL (${url}) is reachable from the runner and answers as GitLab's API, then run the job again`); return null; }
}

const who = await prAuthor();
if (rc) process.exit(rc);
const author = who?.login || null;
const authorId = who?.id || null;
// Two causes, each with its own fix (#381): the job did not say who opened it, or a bot did.
if (!author || !LOGIN_RE.test(author)) {
  const what = platform === 'github' ? 'PR' : 'MR';
  const fix = author ? `a member file is changed only by its own person: open the ${what} as that person`
    : platform === 'github' ? 'the job must pass PR_AUTHOR and PR_AUTHOR_ID from the pull_request event (github.event.pull_request.user.login and .id), as yad-product-checks.yml does'
      : who ? 'the merge request API named no author; run the job again'
        : 'run the job in a merge request pipeline, which sets CI_API_V4_URL, CI_PROJECT_ID and CI_MERGE_REQUEST_IID, as yad-product-checks.gitlab-ci.yml does';
  say(`FAIL [member-check]: cannot tell who opened this ${what}${author ? ` (${author} is a bot)` : ''} — ${fix}`);
  process.exit(1);
}

const fileAt = (ref, path) => { const r = git('show', `${ref}:${path}`); return r.ok ? parse(r.out) : null; };
const emailsOf = (rec) => new Set(Array.isArray(rec?.emails) ? rec.emails.filter((h) => typeof h === 'string' && HASH_RE.test(h)) : []);

// GitHub's own answer: which account a commit in this PR belongs to. Cached per commit.
const loginOf = new Map();
function githubLogin(sha) {
  if (loginOf.has(sha)) return loginOf.get(sha);
  const r = spawnSync('gh', ['api', `repos/{owner}/{repo}/commits/${sha}`, '--jq', '.author.login // ""'], { encoding: 'utf8' });
  const login = r.status === 0 ? (r.stdout || '').trim() : null;
  loginOf.set(sha, login);
  return login;
}

// The fix for a file that is not the author's own as `yad member add` writes it.
// It pushes its own branch (yad/member/<login>) and PR, so the file is dropped from any other PR.
const again = (p) => `write the file again with yad member add, run by its own person (it opens its own pull request); if this is another pull request, ${undo(p)}`;

const prCommits = git('log', '--format=%H%x1f%ae', `${base}..HEAD`).out.split('\n').filter(Boolean).map((l) => { const [sha, email] = l.split('\x1f'); return { sha, hash: hash(email) }; });

for (const { status, path } of changed) {
  const name = path.slice(DIR.length);
  if (status === 'D') { say(`PASS [member-check]: ${path} removed (removing a member can only make the count larger)`); continue; }
  if (name.includes('/') || !name.endsWith('.json')) { fail(`${path}: only <platform>-<login>.json files belong in ${DIR} — move it to ${DIR}${platform}-<login>.json, or remove it`); continue; }
  if (name !== `${platform}-${author.toLowerCase()}.json`) { fail(`${path}: a PR may add or change only its author's own member file (${platform}-${author.toLowerCase()}.json) — ${undo(path)}, and change only ${platform}-${author.toLowerCase()}.json, which yad member add writes. To remove someone else, use yad member remove <login> --reason "<why>" in a pull request of its own`); continue; }
  const rec = fileAt(AT, path);
  if (!rec || !Array.isArray(rec.accounts)) { fail(`${path}: not a member file (no "accounts" list) — ${again(path)}`); continue; }
  const here = rec.accounts.filter(onProduct);
  if (here.length !== 1) { fail(`${path}: must hold exactly one ${platform} account on ${productHost}, the author's own (it holds ${here.length}) — ${again(path)}`); continue; }
  if (String(here[0].login || '').toLowerCase() !== author.toLowerCase()) { fail(`${path}: does not hold ${author}'s own ${platform} account on ${productHost} — ${again(path)}`); continue; }
  // The numeric id: a login can be renamed away and registered again by someone else.
  if (!authorId) { fail(`${path}: cannot tell the numeric id of who opened this ${platform === 'github' ? 'PR (PR_AUTHOR_ID) — the job must pass PR_AUTHOR_ID from the pull_request event (github.event.pull_request.user.id), as yad-product-checks.yml does' : 'MR — the merge request API gave no author id; run the job again'}`); continue; }
  if (here[0].id !== authorId) { fail(`${path}: the account id in the file (${here[0].id ?? 'none'}) is not the author's (${authorId}) — ${again(path)}`); continue; }
  const was = fileAt(base, path);
  const wasHere = Array.isArray(was?.accounts) ? was.accounts.filter(onProduct) : [];
  if (wasHere.length && wasHere[0].id !== authorId) { fail(`${path}: belonged to account id ${wasHere[0].id}, not ${author}'s (${authorId}), and a reused login does not take over a member file — remove the old file first with yad member remove ${author.toLowerCase()} --reason "<why>", in a pull request of its own`); continue; }
  if (platform !== 'github') { say(`PASS [member-check]: ${path} belongs to ${author} (on GitLab its emails feed the team list only)`); continue; }
  // EVERY email in a changed file is proven, not only the new ones (review 5): an email that reached the
  // branch while this gate was off or edited would otherwise ride along on any later change.
  const added = [...emailsOf(rec)];
  for (const h of added) {
    const proof = prCommits.filter((c) => c.hash === h).find((c) => String(githubLogin(c.sha) || '').toLowerCase() === author.toLowerCase());
    if (!proof) fail(`${path}: holds an email no commit in this PR proves (a commit authored by that email that GitHub attributes to ${author}) — verify the email on ${author}'s account, then run yad member add, which writes one such commit per email`);
  }
  if (!rc) say(`PASS [member-check]: ${path} belongs to ${author}${added.length ? `; ${added.length} email(s), each proven by a commit GitHub attributes to them` : ''}`);
}

// No account on the Product's platform and no email in two files, across every member file in the merge.
const files = tree.map((l) => l.split('\t')[1]).filter((p) => p.endsWith('.json'));
const accounts = new Map();
const emails = new Map();
for (const p of files) {
  const rec = fileAt(AT, p);
  // Keyed on each file's OWN account only (review 2): an OTHER account two files claim is not refused here —
  // the CLI matches it to nobody — or whoever claimed someone's account first would block its owner.
  const login = p.slice(DIR.length).replace(new RegExp(`^${platform}-`), '').replace(/\.json$/, '');
  const k = `${platform}:${productHost}:${login.toLowerCase()}`;
  accounts.set(k, [...new Set([...(accounts.get(k) || []), p])]);
  for (const h of emailsOf(rec)) emails.set(h, [...(emails.get(h) || []), p]);
}
// The key comes from the file NAME, and two well-named files that share one are twins, refused above. So a
// clash here is a file named other than <platform>-<login>.json — which `yad member remove` cannot reach:
// it removes the well-named one (review 1).
const named = (p) => new RegExp(`^${platform}-[^/]+\\.json$`).test(p.slice(DIR.length));
const STALE = 'remove a stale file with yad member remove <login> --reason "<why>"';
// A misnamed file in a clash is taken out by `removal` (review 3, 4); `STALE` only when none is misnamed —
// two well-named files with one key are twins, refused above, so for accounts it is a guard, not a path today.
const misnamed = (list) => { const odd = list.filter((p) => !named(p)); return odd.length ? `${removal(odd)}. Only ${platform}-<login>.json files are member files` : null; };
for (const [k, list] of accounts) if (list.length > 1) fail(`the account ${k} is in ${list.join(' and ')}, and one account belongs to one member — ${misnamed(list) || STALE}`);
// On GitLab an email is never proven and never used by the count, so a shared one is not refused: refusing it
// would let whoever listed someone's known address first block that person (review 3). The CLI pairs it
// with nobody.
if (platform === 'github') for (const [, list] of emails) if (list.length > 1) fail(`one email is in ${list.join(' and ')}, and one email belongs to one member — ${misnamed(list) || `remove it from the file it does not belong in (that file's own person runs yad member add again, which keeps only the emails their account has verified), or ${STALE}`}`);

process.exit(rc);
