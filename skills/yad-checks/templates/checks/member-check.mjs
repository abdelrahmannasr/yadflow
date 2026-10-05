#!/usr/bin/env node
// member-check gate (E131) — a member file (`.sdlc/members/<platform>-<login>.json`) says which accounts and
// which git emails are one person. The active-people count joins a commit to an approval through it, so a
// false file would fold one person into another and make the count SMALLER. This gate refuses that:
//
//   1. A PR may ADD or CHANGE only its author's own file: named `<platform>-<author>.json`, holding the
//      author's account on the Product's platform. Never a bot's.
//   2. On GitHub, every email the PR adds must be the author email of a commit in the PR that GitHub itself
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
//   GitHub: PR_AUTHOR (github.event.pull_request.user.login) and GH_TOKEN (a read token) in the environment.
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
  return { ok: r.status === 0, out: r.stdout || '' };
};
const hash = (email) => {
  const e = String(email || '').trim().toLowerCase();
  return e.indexOf('@', 1) < 0 ? null : `sha256:${createHash('sha256').update(e).digest('hex')}`;
};
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

// The Product's settings under either name (product.json from 4.0, hub.json before). Drift between the two
// is refused by the other gates and the CLI; here the first one found is read.
const settings = parse(fs.existsSync('.sdlc/product.json') ? fs.readFileSync('.sdlc/product.json', 'utf8')
  : fs.existsSync('.sdlc/hub.json') ? fs.readFileSync('.sdlc/hub.json', 'utf8') : 'null');
const platform = settings?.platform === 'github' || settings?.platform === 'gitlab' ? settings.platform : null;

const base = process.argv[2];
if (!base) { say('FAIL [member-check]: usage: node checks/member-check.mjs <base-ref>'); process.exit(1); }
if (!git('rev-parse', '--verify', '-q', `${base}^{commit}`).ok) { say(`FAIL [member-check]: cannot resolve the base ref ${base} (fetch-depth: 0?)`); process.exit(1); }

// Every path the PR touches, with its status. NUL-separated, no renames (a rename is a delete plus an add,
// and each is judged).
const diff = git('diff', '--no-renames', '--name-status', '-z', `${base}...HEAD`);
if (!diff.ok) { say('FAIL [member-check]: git could not list the changed files'); process.exit(1); }
const parts = diff.out.split('\0').filter(Boolean);
const all = [];
for (let i = 0; i + 1 < parts.length; i += 2) all.push({ status: parts[i][0], path: parts[i + 1] });

// A path as a case-insensitive, Unicode-folding file system sees it: `.sdlc/Members/x` and `.ſdlc/members/x`
// land in `.sdlc/members/` on macOS and Windows.
const fold = (p) => p.normalize('NFKC').toLowerCase();
for (const { path } of all) {
  const f = fold(path);
  if ((f === '.sdlc/members' || f.startsWith(DIR)) && !path.startsWith(DIR)) fail(`${JSON.stringify(path)} is another spelling of ${DIR} — a macOS or Windows checkout reads it as a member file this gate does not judge`);
}
// The folders themselves must be folders at HEAD, and nothing under them a link.
for (const p of ['.sdlc', '.sdlc/members']) {
  const t = git('ls-tree', 'HEAD', '--', p).out.trim();
  if (t && !t.startsWith('040000 ')) fail(`${p} is not a folder at HEAD (a link?) — member files are read only from a real ${DIR}`);
}
const tree = git('ls-tree', '-r', '-z', 'HEAD', '--', DIR).out.split('\0').filter(Boolean);
const folded = new Map();
for (const line of tree) {
  const [meta, p] = line.split('\t');
  if (!meta.startsWith('100644 ') && !meta.startsWith('100755 ')) fail(`${p} is not a plain file (a link?) — a member file is never read through one`);
  const k = fold(p);
  if (folded.has(k)) fail(`${p} and ${folded.get(k)} are one file on macOS and Windows — keep one`);
  folded.set(k, p);
}
if (rc) process.exit(rc);

const changed = all.filter((c) => c.path.startsWith(DIR));
if (!changed.length) { say('PASS [member-check]: no member file changed'); process.exit(0); }
if (!platform) { say('FAIL [member-check]: member files changed, but the Product names no platform — nothing can be proven'); process.exit(1); }

// Who opened the PR/MR, asked of the platform's own record.
async function prAuthor() {
  if (platform === 'github') return process.env.PR_AUTHOR || null;
  const url = process.env.CI_API_V4_URL;
  const project = process.env.CI_PROJECT_ID;
  const iid = process.env.CI_MERGE_REQUEST_IID;
  const token = process.env.GITLAB_TOKEN || process.env.SDLC_API_TOKEN;
  if (!url || !project || !iid) return null;
  if (!token) { fail('no API token (GITLAB_TOKEN or SDLC_API_TOKEN) to read who opened this MR — a member file cannot be checked without it; add the token as a masked CI/CD variable'); return null; }
  try {
    const r = await fetch(`${url}/projects/${encodeURIComponent(project)}/merge_requests/${encodeURIComponent(iid)}`, { headers: { 'PRIVATE-TOKEN': token } });
    if (!r.ok) { fail(`could not read the MR (HTTP ${r.status})`); return null; }
    return (await r.json())?.author?.username || null;
  } catch (e) { fail(`could not read the MR: ${e.message}`); return null; }
}

const author = await prAuthor();
if (rc) process.exit(rc);
if (!author || !LOGIN_RE.test(author)) { say(`FAIL [member-check]: cannot tell who opened this ${platform === 'github' ? 'PR' : 'MR'}${author ? ` (${author} is a bot)` : ''} — a member file is changed only by its own person`); process.exit(1); }

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

const prCommits = git('log', '--format=%H%x1f%ae', `${base}..HEAD`).out.split('\n').filter(Boolean).map((l) => { const [sha, email] = l.split('\x1f'); return { sha, hash: hash(email) }; });

for (const { status, path } of changed) {
  const name = path.slice(DIR.length);
  if (status === 'D') { say(`PASS [member-check]: ${path} removed (removing a member can only make the count larger)`); continue; }
  if (name.includes('/') || !name.endsWith('.json')) { fail(`${path}: only <platform>-<login>.json files belong in ${DIR}`); continue; }
  if (name !== `${platform}-${author.toLowerCase()}.json`) { fail(`${path}: a PR may add or change only its author's own member file (${platform}-${author.toLowerCase()}.json) — use \`yad member remove <login> --reason\` to remove someone else's`); continue; }
  const rec = fileAt('HEAD', path);
  if (!rec || !Array.isArray(rec.accounts)) { fail(`${path}: not a member file (no "accounts" list)`); continue; }
  const own = rec.accounts.filter((a) => a?.platform === platform && String(a.login || '').toLowerCase() === author.toLowerCase());
  if (!own.length) { fail(`${path}: does not hold ${author}'s own ${platform} account`); continue; }
  if (platform !== 'github') { say(`PASS [member-check]: ${path} belongs to ${author} (on GitLab its emails feed the team list only)`); continue; }
  const before = emailsOf(fileAt(base, path));
  const added = [...emailsOf(rec)].filter((h) => !before.has(h));
  for (const h of added) {
    const proof = prCommits.filter((c) => c.hash === h).find((c) => String(githubLogin(c.sha) || '').toLowerCase() === author.toLowerCase());
    if (!proof) fail(`${path}: adds an email no commit in this PR proves — GitHub must attribute a commit authored by that email to ${author} (\`yad member add\` writes one such commit per email; verify the email on the account)`);
  }
  if (!rc) say(`PASS [member-check]: ${path} belongs to ${author}${added.length ? `; ${added.length} new email(s), each proven by a commit GitHub attributes to them` : ''}`);
}

// No account on the Product's platform and no email in two files, across every member file at HEAD.
const files = tree.map((l) => l.split('\t')[1]).filter((p) => p.endsWith('.json'));
const accounts = new Map();
const emails = new Map();
for (const p of files) {
  const rec = fileAt('HEAD', p);
  for (const a of Array.isArray(rec?.accounts) ? rec.accounts : []) {
    if (a?.platform !== platform) continue;
    const k = `${a.platform}:${String(a?.host || '').toLowerCase()}:${String(a?.login || '').toLowerCase()}`;
    accounts.set(k, [...new Set([...(accounts.get(k) || []), p])]);
  }
  for (const h of emailsOf(rec)) emails.set(h, [...(emails.get(h) || []), p]);
}
for (const [k, list] of accounts) if (list.length > 1) fail(`the account ${k} is in ${list.join(' and ')} — one account belongs to one member`);
for (const [, list] of emails) if (list.length > 1) fail(`one email is in ${list.join(' and ')} — one email belongs to one member`);

process.exit(rc);
