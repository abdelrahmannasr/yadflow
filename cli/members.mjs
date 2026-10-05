// `yad member add` / `yad member list` / `yad member remove` (E131) — who is on the team, and every
// identity each person shows up under.
//
// E62 removed the roster because it did six jobs. This record does ONE: it says that a git email and a
// set of platform accounts are one person. It holds no role, requests no reviewer, and is no allowlist —
// write access to the repo is still the only allowlist (E62 (3)). The decisions were the user's
// (2026-10-05):
//   1. `yad join` runs `yad member add`: it logs the person in on the Product's platform when they are
//      not (`gh auth login` / `glab auth login`, interactive only), and records only what it can prove.
//   2. ONE FILE PER PERSON, `.sdlc/members/<platform>-<login>.json`, named by their account on the
//      Product's own platform and host. It also lists their other accounts (GitHub, GitLab, a
//      self-hosted host), so an account belongs to one member only — two files naming one account, or
//      one email, are refused by the CI check and reported by `yad doctor`.
//   3. IDENTITY ONLY FOR THE GATE COUNT. A member file can only JOIN two keys of one person (a commit's
//      email to an approval's login). It never removes anyone from the count: a person who never joined
//      still counts. E71's rule — err toward more people — holds.
//   4. Only proven accounts are on the team list (what `yad member list` and the standup read).
//   5. A member is ACTIVE while they commit or approve within the TTL (90 days by default,
//      `members.ttlDays` in the Product settings). After it, the platform is asked whether they still
//      have access: yes is IDLE, no is LEFT (off the team list). Their next commit or approval makes
//      them active again. The status is worked out on every read; nothing runs in the background, and a
//      file is never deleted by the TTL — deleting it would lose the email ↔ login pairing.
//   6. EMAILS ARE STORED HASHED (`sha256:` of the trimmed, lower-cased address). A commit's email is
//      hashed the same way when it is read, so matching still works and the file shows no address.
//   7. On a GitLab Product the pairings feed the standup only, never the gate count: GitLab's API cannot
//      tell CI which account wrote a commit, so CI cannot prove an email belongs to the PR's author.
//   8. The CI check (`checks/member-check.mjs`) fails closed on GitLab when it has no API token.
//
// PROOF. An email joins a person when it is a VERIFIED email of their account on the platform (`user/emails`,
// asked with that account's own token), and it is the git `user.email` of the Product or of a registered repo
// on this machine. A second account joins when it lists one of those emails as verified too. On a verified
// GitHub Product, CI proves it again on the PR: the file's account must be the PR's author, and each email
// the file adds must be the author of a commit in the PR that GitHub itself attributes to that account.
// `yad member add` therefore writes one commit per email, each authored by that email.
//
// WRITING. `yad member add` builds its commits with a private index (`GIT_INDEX_FILE`) on top of the
// default branch, the way `yad capture` does, so the person's checkout, index and branch are never
// touched. It pushes `yad/member/<login>` and opens a PR/MR. Any step that fails leaves what was done,
// says what to run next, and never fails `yad join`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { c, log, ok, info, warn, fail, hand, run, readJSON, forTerminal, isPlainObject, asset } from './lib.mjs';
import { productConfigPath, isVerifiedLedger, SCHEMA_VERSION } from './manifest.mjs';
import { LOGIN_RE, hostFromGitUrl, plainHost } from './platform.mjs';
import { repoPathFromGitUrl, httpStatus } from './protection.mjs';
import { readRegistry, judgeRepo, runnable } from './workspace.mjs';
import { resolveDefaultBranch } from './productcommit.mjs';

export const MEMBERS_DIR = '.sdlc/members';
export const DEFAULT_TTL_DAYS = 90;
export const MEMBER_BRANCH_PREFIX = 'yad/member';
const PLATFORMS = ['github', 'gitlab'];
const DEFAULT_HOST = { github: 'github.com', gitlab: 'gitlab.com' };
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEOUT = 15_000;
const BRANCH_RE = /^\w[\w./-]*$/;

// ---- the record ---------------------------------------------------------------------------------

// The stored form of an email. Null for anything that is not a non-empty string with an `@` after its
// first character — git's `%ae` can be empty, and an empty email must never match another empty one.
export function hashEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (e.indexOf('@', 1) < 0) return null;
  return `sha256:${createHash('sha256').update(e).digest('hex')}`;
}

// A login yad may use as a file name and in an API path: the platform's own login shape, never a bot.
export const validLogin = (login) => typeof login === 'string' && LOGIN_RE.test(login) && !/\[bot\]$/i.test(login) && login.length <= 100;
export const memberFileName = (platform, login) => `${platform}-${String(login).toLowerCase()}.json`;
export const memberRel = (platform, login) => `${MEMBERS_DIR}/${memberFileName(platform, login)}`;
export const memberBranch = (login) => `${MEMBER_BRANCH_PREFIX}/${String(login).toLowerCase()}`;
const accountKey = (a) => `${a.platform}\0${String(a.host).toLowerCase()}\0${String(a.login).toLowerCase()}`;
const accountLabel = (a) => `${a.platform === 'github' ? 'GitHub' : 'GitLab'} ${forTerminal(a.login)}${a.host !== DEFAULT_HOST[a.platform] ? ` on ${forTerminal(a.host)}` : ''}`;

// The Product's own platform, host and repo path, from its settings (`platform`, `git_url`), else from the
// clone's `origin`. `platform` is null on a Product with no platform: then nothing can be proven.
export function productIdentity(root, { runner = run, productConfig = readJSON(productConfigPath(root), null) } = {}) {
  const platform = PLATFORMS.includes(productConfig?.platform) ? productConfig.platform : null;
  let url = typeof productConfig?.git_url === 'string' ? productConfig.git_url : '';
  if (!url) url = runner('git', ['remote', 'get-url', 'origin'], { cwd: root }).stdout || '';
  const host = plainHost(hostFromGitUrl(url)) || (platform ? DEFAULT_HOST[platform] : null);
  return { platform, host, repo: repoPathFromGitUrl(url), defaultBranch: typeof productConfig?.default_branch === 'string' ? productConfig.default_branch : null, verified: isVerifiedLedger(productConfig) };
}

// The TTL in days: `members.ttlDays` in the Product settings when it is a whole number from 1 to 3650.
export function ttlDays(productConfig) {
  const v = productConfig?.members?.ttlDays;
  return Number.isInteger(v) && v >= 1 && v <= 3650 ? v : DEFAULT_TTL_DAYS;
}

// One member file, checked. `{ record }` or `{ error }`. The file must be named by its account on the
// Product's platform and host — a copied file names another person, and is refused, not trusted.
export function readMemberFile(file, { platform, host } = {}) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { error: `cannot be read (${e.code || e.message})` }; }
  let r;
  try { r = JSON.parse(text); } catch { return { error: 'is not valid JSON' }; }
  if (!isPlainObject(r)) return { error: 'is not a JSON object' };
  if (!Array.isArray(r.accounts) || !r.accounts.length) return { error: 'has no "accounts" list' };
  const accounts = [];
  for (const a of r.accounts) {
    if (!isPlainObject(a) || !PLATFORMS.includes(a.platform) || !plainHost(a.host) || !validLogin(a.login)) return { error: 'holds an account that is not { platform: github|gitlab, host, login }' };
    if (a.id !== undefined && !(Number.isSafeInteger(a.id) && a.id > 0)) return { error: `holds an account whose "id" is not a positive whole number (${forTerminal(a.login)})` };
    accounts.push({ platform: a.platform, host: a.host.toLowerCase(), login: a.login, ...(a.id !== undefined ? { id: a.id } : {}) });
  }
  if (new Set(accounts.map(accountKey)).size !== accounts.length) return { error: 'lists one account twice' };
  const emails = Array.isArray(r.emails) ? r.emails : [];
  if (!emails.every((h) => typeof h === 'string' && HASH_RE.test(h))) return { error: 'holds an email that is not stored as sha256:<64 hex>' };
  const names = Array.isArray(r.names) ? r.names : [];
  if (!names.every((n) => typeof n === 'string' && n.trim() && n.length <= 200)) return { error: 'holds a name that is not a short, non-empty text' };
  if (r.joined !== undefined && !(typeof r.joined === 'string' && DATE_RE.test(r.joined))) return { error: 'has a "joined" date that is not YYYY-MM-DD' };
  if (r.proved !== undefined && !(typeof r.proved === 'string' && DATE_RE.test(r.proved))) return { error: 'has a "proved" date that is not YYYY-MM-DD' };
  if (!platform) return { error: 'cannot be checked: the Product names no platform' };
  const primary = accounts.find((a) => a.platform === platform && a.host === String(host).toLowerCase());
  if (!primary) return { error: `has no ${platform} account on ${forTerminal(host)}, the Product's own platform` };
  if (accounts.filter((a) => a.platform === platform && a.host === String(host).toLowerCase()).length > 1) return { error: `lists two accounts on ${forTerminal(host)} — one person has one account on the Product's own platform` };
  if (path.basename(file) !== memberFileName(platform, primary.login)) return { error: `names ${forTerminal(primary.login)}, so it must be called ${memberFileName(platform, primary.login)}` };
  return { record: { primary, accounts, emails: [...new Set(emails)], names: [...new Set(names.map((n) => n.trim()))], joined: r.joined ?? null, proved: r.proved ?? null } };
}

// Every member file. Returns { members, errors, duplicates }: `errors` are files that cannot be used (listed,
// never dropped), and `duplicates` the accounts and emails two files share. A shared account or email is
// left out of every pairing — both files keep their members, but neither joins anything through it, so
// the count over-counts, never under-counts.
export function readMembers(root, { identity = null } = {}) {
  const id = identity || productIdentity(root);
  const dir = path.join(root, MEMBERS_DIR);
  const none = (errors) => ({ members: [], errors, duplicates: [], dupAccounts: new Set(), dupEmails: new Set(), identity: id });
  // A LINK is never followed (E131 review 1): the member-check gate judges `.sdlc/members/` by the paths a
  // PR changes, so a folder or file reached through a link would hold pairings no gate ever saw. The same
  // refusal E115 makes for links under specs/.
  const linked = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
  if (linked(path.join(root, '.sdlc')) || linked(dir)) return none([{ rel: MEMBERS_DIR, error: `${MEMBERS_DIR} is reached through a link, so no member file is read` }]);
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); }
  catch (e) { return none(e.code === 'ENOENT' ? [] : [{ rel: MEMBERS_DIR, error: `${MEMBERS_DIR} cannot be listed (${e.code || e.message})` }]); }
  const members = [];
  const errors = [];
  for (const n of names) {
    const rel = `${MEMBERS_DIR}/${n}`;
    if (linked(path.join(dir, n))) { errors.push({ rel, error: `${rel} is a link — a member file is never read through one` }); continue; }
    const { record, error } = readMemberFile(path.join(dir, n), id);
    if (error) errors.push({ rel, error: `${rel} ${error}` });
    else members.push({ rel, ...record });
  }
  // WHO WINS when two files name one account (E131 review 6). A member's account on the Product's own
  // platform is proven by CI (it is the PR's author); their OTHER accounts are not. So:
  //   - one primary account, or one email, in two files: a real conflict — neither file joins it;
  //   - an other account that is someone's PRIMARY: the primary's owner keeps it, the claim is ignored;
  //   - an other account two files claim: disputed — matched by nobody until one file drops it.
  // A claim that is ignored never blocks the person it names: their own file is still read in full.
  const seenAcc = new Map();
  const seenPrimary = new Map();
  const seenMail = new Map();
  for (const m of members) {
    seenPrimary.set(accountKey(m.primary), [...(seenPrimary.get(accountKey(m.primary)) || []), m.rel]);
    for (const a of m.accounts) if (accountKey(a) !== accountKey(m.primary)) seenAcc.set(accountKey(a), [...(seenAcc.get(accountKey(a)) || []), m.rel]);
    for (const h of m.emails) seenMail.set(h, [...(seenMail.get(h) || []), m.rel]);
  }
  const dupAccounts = new Set([...seenPrimary].filter(([, rels]) => rels.length > 1).map(([k]) => k));
  const disputed = new Set([...seenAcc].filter(([k, rels]) => rels.length > 1 || seenPrimary.has(k)).map(([k]) => k));
  const dupEmails = new Set([...seenMail].filter(([, rels]) => rels.length > 1).map(([h]) => h));
  const label = (k) => { const [p, h, l] = k.split('\0'); return accountLabel({ platform: p, host: h, login: l }); };
  const duplicates = [
    ...[...seenPrimary].filter(([k]) => dupAccounts.has(k)).map(([k, rels]) => `the ${label(k)} account is in ${rels.join(' and ')}`),
    ...[...seenMail].filter(([h]) => dupEmails.has(h)).map(([, rels]) => `one email is in ${rels.join(' and ')}`),
    ...[...disputed].map((k) => `the ${label(k)} account is claimed by ${[...(seenPrimary.get(k) || []), ...seenAcc.get(k)].join(' and ')}${seenPrimary.has(k) ? ` — it is ${seenPrimary.get(k)[0]}'s own, so the other claim is ignored` : ' — neither is matched until one file drops it'}`),
  ];
  for (const m of members) m.matchLogins = m.accounts.filter((a) => accountKey(a) === accountKey(m.primary) || !disputed.has(accountKey(a))).map((a) => a.login.toLowerCase());
  return { members, errors, duplicates, dupAccounts, dupEmails, disputed, identity: id };
}

// The pairings the GATE COUNT may use: a commit email's hash → the login that approves on the Product.
// Only on a GitHub Product (decision 7), only a member's account on the Product's own host, and never an
// account or email two files share. An unreadable file adds nothing — the count then over-counts.
// `anyPlatform`: the same pairing for a REPORT (`yad usage`, the standup), where GitLab's pairings count too.
export function gateMemberMap(root, { read = null, anyPlatform = false } = {}) {
  const map = new Map();
  let got;
  try { got = read || readMembers(root); } catch { return map; }
  if (got.identity?.platform !== 'github' && !(anyPlatform && got.identity?.platform)) return map;
  // The GATE COUNT trusts a pairing only where the member-check gate judged it (review 2, finding 2): a
  // verified Product with the shipped gate installed and run by its checks workflow. Anywhere else a file
  // is its owner's statement, and a statement must never make the count smaller.
  const judged = anyPlatform ? null : judgedMemberFiles(root, got.identity);
  if (judged && !judged.files.size) return map;
  for (const m of got.members) {
    if (got.dupAccounts.has(accountKey(m.primary))) continue;
    if (judged && !judged.files.has(m.rel)) continue;
    for (const h of m.emails) if (!got.dupEmails.has(h)) map.set(h, m.primary.login);
  }
  return map;
}

// The default branch AS ORIGIN SAYS IT (review 5): origin's own HEAD when the clone knows it; otherwise the
// name in the settings, but only when origin's copy of those settings, on that branch, names it too — a
// local edit to the settings must not point the count at a branch someone pushed with a made-up history.
// Null when it cannot be told. Returns the plain branch name.
export function originDefault(root) {
  const g = gitAt(root);
  const head = g(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const fromHead = head.ok ? head.out.replace(/^origin\//, '') : '';
  if (fromHead && BRANCH_RE.test(fromHead) && !fromHead.includes('..')) return fromHead;
  const local = readJSON(productConfigPath(root), null)?.default_branch;
  const name = typeof local === 'string' && local ? local : 'main';
  if (!BRANCH_RE.test(name) || name.includes('..')) return null;
  const read = (f) => { const r = g(['show', `refs/remotes/origin/${name}:./${f}`]); return r.ok ? parse(r.out) : undefined; };
  const there = read('.sdlc/product.json') ?? read('.sdlc/hub.json');
  if (there === undefined) return null;
  return (typeof there?.default_branch === 'string' && there.default_branch ? there.default_branch : 'main') === name ? name : null;
}

// The member-check gate and its workflow, per platform: the shipped copy and where it is installed.
const GATE_FILES = (platform) => [
  ['skills/yad-checks/templates/checks/member-check.mjs', 'checks/member-check.mjs'],
  platform === 'gitlab'
    ? ['skills/yad-checks/templates/gitlab/yad-product-checks.gitlab-ci.yml', '.gitlab/ci/yad-product-checks.yml']
    : ['skills/yad-checks/templates/github/yad-product-checks.yml', '.github/workflows/yad-product-checks.yml'],
];
// Line endings never decide (a Windows checkout writes CRLF): only the text.
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

// Which member files the GATE COUNT may trust: the set of their paths, or an empty set. Read entirely from
// the default branch AS ORIGIN HAS IT (review 4) — never the files on disk or a commit nobody pushed.
//   1. LIVE: the Product is verified, and at origin/<default> both the gate script and the workflow that runs
//      it are exactly the copies this yadflow ships (review 3: a commented-out line or `if: false` job would
//      mention the gate without running it).
//   2. SINCE: the last first-parent commit on origin/<default> that changed EITHER file in any way (review 4:
//      one PR could switch the gate off and add a forged file, judged by its own disabled gate, and a later
//      PR restore it). From that commit on, every change that reached the branch was judged by the gate as
//      shipped. So every `yad update` that changes either file resets trust — each member runs `yad member
//      add` again. That only ever makes the count higher, the direction E71 allows.
//   3. JUDGED: a member file changed on the first-parent line strictly after SINCE, and the same on disk as
//      on origin/<default> (an edit or a local commit is nobody's proof).
// Anything that cannot be read — no origin branch, a shallow clone, git missing — trusts nothing.
export function judgedMemberFiles(root, identity) {
  const none = { live: false, files: new Set(), since: null };
  if (!identity?.verified || !PLATFORMS.includes(identity.platform)) return none;
  const g = gitAt(root);
  const branch = originDefault(root);
  if (!branch) return none;
  const base = `refs/remotes/origin/${branch}`;
  if (!g(['rev-parse', '--verify', '-q', `${base}^{commit}`]).ok) return none;
  for (const [src, dest] of GATE_FILES(identity.platform)) {
    const at = g(['show', `${base}:./${dest}`]);
    let shipped;
    try { shipped = fs.readFileSync(asset(src), 'utf8'); } catch { return none; }
    if (!at.ok || !sameText(at.out, shipped.trim())) return none;
  }
  const since = g(['log', '--first-parent', '-1', '--format=%H', base, '--', ...GATE_FILES(identity.platform).map(([, d]) => d)]).out.trim();
  if (!since) return { ...none, live: true };
  // One walk for every member file (review 4: not three git runs per file on every gate command).
  const changed = g(['log', '--first-parent', '--relative', '--name-only', '--format=', `${since}..${base}`, '--', MEMBERS_DIR]);
  if (!changed.ok) return { ...none, live: true };
  // Each candidate must be on disk byte for byte as origin holds it (review 5): an untracked copy, or an edit
  // git was told to ignore (`--assume-unchanged`), is not what the gate judged. One git run for them all.
  const cands = [...new Set(changed.out.split('\n').filter(Boolean))];
  const batch = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: cands.map((f) => `${base}:./${f}\n`).join(''), maxBuffer: 1 << 28 });
  const out = batch.status === 0 ? batch.stdout : Buffer.alloc(0);
  const files = new Set();
  let at = 0;
  for (const f of cands) {
    const nl = out.indexOf(10, at);
    if (nl < 0) break;
    const header = out.subarray(at, nl).toString();
    at = nl + 1;
    const m = header.match(/^[0-9a-f]+ blob (\d+)$/);
    if (!m) continue;   // missing at origin: deleted there
    const blob = out.subarray(at, at + Number(m[1]));
    at += Number(m[1]) + 1;
    let disk;
    try { if (fs.lstatSync(path.join(root, f)).isSymbolicLink()) continue; disk = fs.readFileSync(path.join(root, f)); } catch { continue; }
    if (sameText(disk.toString('utf8'), blob.toString('utf8'))) files.add(f);
  }
  return { live: true, files, since };
}

// Is the gate live at origin's default branch? (doctor and `yad member add` say so when it is not.)
export const memberGateLive = (root, identity) => judgedMemberFiles(root, identity).live;

// Does this piece of evidence (a commit, an approval, a ship) belong to this member? By any of their
// accounts' logins, any email, or any git name. The standup and the status read it; the gate count never
// does (names prove nothing, and other accounts are not proven on the PR).
export function memberMatches(member, e) {
  const login = String(e?.login || '').toLowerCase();
  const logins = member.matchLogins || member.accounts.map((a) => a.login.toLowerCase());
  if (login && logins.includes(login)) return true;
  if (e?.emailHash && member.emails.includes(e.emailHash)) return true;
  const name = String(e?.name || '').trim().toLowerCase();
  return !!name && member.names.some((n) => n.toLowerCase() === name);
}

// ---- the platform: who is logged in, and what they can prove -------------------------------------

// The GitHub accounts gh holds, per host. `gh auth status` has no --json (gh 2.79), so its lines are read:
// `Logged in to <host> account <login> (…)` since gh 2.40, `Logged in to <host> as <login> (…)` before.
export function ghAccounts({ runner = run, env = process.env } = {}) {
  const r = runner('gh', ['auth', 'status'], { env, timeout: TIMEOUT });
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const out = [];
  // Each account's block may say `- Active account: true|false` (gh 2.40+); before that there was one per host.
  const blocks = text.split(/(?=Logged in to )/);
  for (const b of blocks) {
    const m = b.match(/^Logged in to (\S+) (?:account|as) (\S+)/);
    if (!m) continue;
    const host = plainHost(m[1]?.toLowerCase());
    const login = m[2]?.replace(/[()]/g, '');
    const active = !/Active account:\s*false/i.test(b);
    if (host && validLogin(login) && !out.some((a) => a.host === host && a.login === login)) out.push({ platform: 'github', host, login, active });
  }
  return out;
}

// The environment that makes gh answer as ONE of its accounts: its own token, for github.com and for an
// Enterprise host alike. Null when gh will not hand the token out.
function ghEnvFor(account, { runner = run, env = process.env } = {}) {
  const t = runner('gh', ['auth', 'token', '-h', account.host, '-u', account.login], { env, timeout: TIMEOUT });
  const token = (t.stdout || '').trim();
  if (!t.ok || !token) return null;
  return { ...env, GH_TOKEN: token, GH_ENTERPRISE_TOKEN: token, GH_PROMPT_DISABLED: '1' };
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// One account's id and VERIFIED emails, asked of the platform with that account's own token.
// Returns { account: {platform, host, login, id}, emails: [plain addresses], problem? }.
export function accountProof(account, { runner = run, env = process.env } = {}) {
  if (account.platform === 'github') {
    const genv = ghEnvFor(account, { runner, env });
    if (!genv) return { account, emails: [], problem: `gh would not give the token of ${accountLabel(account)}` };
    const u = runner('gh', ['api', '--hostname', account.host, 'user'], { env: genv, timeout: TIMEOUT });
    const user = u.ok ? parse(u.stdout) : null;
    if (!user?.login || !validLogin(user.login)) return { account, emails: [], problem: `${accountLabel(account)}: the platform did not say who this token belongs to (a GitHub App token has no user)` };
    const proved = { platform: 'github', host: account.host, login: user.login, ...(Number.isSafeInteger(user.id) ? { id: user.id } : {}) };
    const e = runner('gh', ['api', '--hostname', account.host, 'user/emails', '--paginate', '--jq', '.[] | select(.verified == true) | .email'], { env: genv, timeout: TIMEOUT });
    if (!e.ok) {
      const code = httpStatus(e);
      return { account: proved, emails: [], problem: code === 404 || code === 403
        ? `${accountLabel(proved)}: the token cannot read its email addresses — run \`gh auth refresh -h ${account.host} -s user:email\` (a fine-grained token needs "Email addresses: read")`
        : `${accountLabel(proved)}: its email addresses could not be read${code ? ` (HTTP ${code})` : ''}` };
    }
    // One verified address per line, across every page. GitHub does not list the account's own noreply
    // address (E131 review 8), yet it attributes a commit authored by it to the account — so it is proof.
    const emails = (e.stdout || '').split('\n').map((l) => l.trim()).filter((l) => l.includes('@'));
    const noreply = `users.noreply.${account.host === 'github.com' ? 'github.com' : account.host}`;
    emails.push(`${proved.login}@${noreply}`, ...(proved.id ? [`${proved.id}+${proved.login}@${noreply}`] : []));
    return { account: proved, emails };
  }
  // GitLab: one account per host, asked through glab's own login for that host.
  const u = runner('glab', ['api', '--hostname', account.host, 'user'], { env, timeout: TIMEOUT });
  const user = u.ok ? parse(u.stdout) : null;
  if (!user?.username || !validLogin(user.username)) return { account, emails: [], problem: `GitLab on ${forTerminal(account.host)}: not logged in (\`glab auth login --hostname ${account.host}\`)` };
  const proved = { platform: 'gitlab', host: account.host, login: user.username, ...(Number.isSafeInteger(user.id) ? { id: user.id } : {}) };
  // The primary email of a GitLab account is always confirmed, and `commit_email` can only be one of the
  // confirmed ones; `user/emails` lists the secondary ones, each with `confirmed_at` once confirmed.
  const emails = [user.email, user.commit_email].filter((x) => typeof x === 'string' && x.includes('@'));
  const e = runner('glab', ['api', '--hostname', account.host, 'user/emails'], { env, timeout: TIMEOUT });
  if (e.ok) for (const x of parse(e.stdout) || []) if (x && typeof x.email === 'string' && x.confirmed_at) emails.push(x.email);
  return { account: proved, emails: [...new Set(emails)], ...(e.ok ? {} : { problem: `${accountLabel(proved)}: its other email addresses could not be read — the token needs the read_user scope` }) };
}

// The git user.email and user.name of the Product and of every registered repo on this machine, each
// judged before git runs in it (E81 — a registered folder is shared content). Names are kept as typed.
export function gitIdentities(root, { runner = run, repos = [] } = {}) {
  const emails = new Set();
  const names = new Set();
  for (const dir of [root, ...repos]) {
    const e = (runner('git', ['config', 'user.email'], { cwd: dir }).stdout || '').trim();
    const n = (runner('git', ['config', 'user.name'], { cwd: dir }).stdout || '').trim();
    if (e) emails.add(e);
    if (n) names.add(n);
  }
  return { emails: [...emails], names: [...names] };
}

// The record to write for the person on this machine, or { problem } with the sentence that says what to
// fix. Pure over its inputs, so every rule is testable without a platform.
//   identity  the Product's platform and host
//   proofs    accountProof() of every account this machine is logged in to
//   git       gitIdentities()
export function buildRecord({ identity, proofs, git, today, existing = null }) {
  if (!identity?.platform) return { problem: 'the Product names no platform, so no account can be proven — a member file needs one' };
  const host = String(identity.host).toLowerCase();
  const onProduct = proofs.filter((p) => p.account.platform === identity.platform && p.account.host === host);
  if (!onProduct.length) return { problem: `not logged in to ${identity.platform === 'github' ? 'GitHub' : 'GitLab'} on ${forTerminal(host)}, the Product's platform`, login: true };
  const gitHashes = new Map(git.emails.map((e) => [hashEmail(e), e]).filter(([h]) => h));
  const verifiedOn = (p) => new Set(p.emails.map(hashEmail).filter(Boolean));
  // One account on the Product's own platform: the one whose verified emails include a git email here.
  // Two logged-in accounts that both qualify cannot be told apart — the person picks with `gh auth switch`.
  const matching = onProduct.filter((p) => [...verifiedOn(p)].some((h) => gitHashes.has(h)));
  if (!matching.length) {
    const tried = onProduct.map((p) => accountLabel(p.account)).join(', ');
    const why = onProduct.map((p) => p.problem).filter(Boolean);
    return { problem: `no git email here (${git.emails.length ? `${git.emails.length} found` : 'git has no user.email'}) is a verified email of ${tried}${why.length ? ` — ${why.join('; ')}` : ''}`,
      hint: 'add and verify that email on the platform, or set git user.email to one the account has verified, then run `yad member add` again' };
  }
  if (matching.length > 1) return { problem: `more than one ${identity.platform} account on ${forTerminal(host)} is logged in and has verified a git email here (${matching.map((p) => p.account.login).join(', ')})`, hint: 'keep one (`gh auth switch`), then run `yad member add` again' };
  const primary = matching[0];
  const emails = new Set([...verifiedOn(primary)].filter((h) => gitHashes.has(h)));
  // Other accounts: those that share a verified email with the ones above.
  const others = proofs.filter((p) => p !== primary && !(p.account.platform === identity.platform && p.account.host === host)
    && [...verifiedOn(p)].some((h) => emails.has(h)));
  // Emails come from the PRIMARY account only (E131 review 3): CI proves an email by the commit GitHub gives
  // to the PR's author, and an email only another account verified would be given to nobody — the PR yad
  // opened would fail its own gate. Another account joins through an email the primary verified too.
  const skipped = proofs.filter((p) => p !== primary && !others.includes(p)).map((p) => accountLabel(p.account));
  const unproven = [...gitHashes].filter(([h]) => !emails.has(h)).length;
  const keep = existing && existing.primary.login.toLowerCase() === primary.account.login.toLowerCase() ? existing : null;
  const accounts = [primary.account, ...others.map((p) => p.account)];
  for (const a of keep?.accounts || []) if (!accounts.some((b) => accountKey(b) === accountKey(a))) accounts.push(a);
  // EVERY change re-proves EVERY email (E131 review 5): the gate proves each email in a changed file, so a
  // file cannot carry an email in from a time the gate was off. An email the file already holds is kept
  // only while the account still verifies it — its address comes from the platform's answer, so it can be
  // proven again from any machine — and dropped once it is not.
  const plain = new Map(primary.emails.map((e) => [hashEmail(e), e]).filter(([h]) => h));
  for (const h of keep?.emails || []) if (plain.has(h)) emails.add(h);
  const record = {
    accounts,
    emails: [...emails].sort(),
    names: [...new Set([...(keep?.names || []), ...git.names])].sort(),
    joined: keep?.joined || today,
    proved: today,
  };
  const dropped = (keep?.emails || []).filter((h) => !emails.has(h)).length;
  return { record, primary: primary.account, skipped, unproven, dropped, plainByHash: new Map(record.emails.map((h) => [h, plain.get(h)])), newEmails: record.emails };
}

// The bytes of a member file, as `writeJSON` would write them: the shape stamp first, two-space JSON.
export const memberJSON = (record) => `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...record }, null, 2)}\n`;

// ---- writing it: commits on a branch, never the checkout --------------------------------------------

function gitAt(root, extra = null) {
  return (args, input = null) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, env: extra ? { ...process.env, ...extra } : process.env, ...(input !== null ? { input } : {}) });
    return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
}

// One commit per email, for EVERY email in the file (CI's proof: GitHub attributes each to the account that
// verified that email, and the gate asks it of every email in a changed file). The first commit writes the
// file with the first email, each later one adds the next; the last holds them all.
// Built on `base` with a private index. Signed when git signs (`commit.gpgsign`), as a person's commit is.
// Returns { branch, head, commits } or { error }.
export function commitMember(root, { rel, record, plainByHash, base, name, login, subject }) {
  const git = gitAt(root);
  const prefix = git(['rev-parse', '--show-prefix']).out;
  const target = `${prefix}${rel}`;
  const sign = git(['config', '--bool', 'commit.gpgsign']).out === 'true';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-member-'));
  const idx = gitAt(root, { GIT_INDEX_FILE: path.join(tmp, 'index') });
  try {
    if (!idx(['read-tree', base]).ok) return { error: `could not read ${base}` };
    const steps = record.emails.map((h, i) => ({ emails: record.emails.slice(0, i + 1), email: plainByHash.get(h) }));
    if (!steps.length || steps.some((x) => !x.email)) return { error: 'every email needs its own address to author its proof commit' };
    let parent = base;
    const commits = [];
    for (const [i, s] of steps.entries()) {
      const blob = idx(['hash-object', '-w', '--stdin'], memberJSON({ ...record, emails: s.emails }));
      if (!blob.ok) return { error: `could not write the file: ${blob.err}` };
      if (!idx(['update-index', '--add', '--cacheinfo', `100644,${blob.out},${target}`]).ok) return { error: 'could not stage the file' };
      const tree = idx(['write-tree']);
      if (!tree.ok) return { error: `could not write the tree: ${tree.err}` };
      const msg = `${subject}${steps.length > 1 ? ` (${i + 1}/${steps.length})` : ''}\n\nAdds ${login}'s member file: one job, identity — it joins a git email to a platform account.\n`;
      const author = gitAt(root, { GIT_AUTHOR_NAME: name || login, GIT_AUTHOR_EMAIL: s.email || '' });
      const commit = author(['commit-tree', ...(sign ? ['-S'] : []), tree.out, '-p', parent, '-F', '-'], msg);
      if (!commit.ok) return { error: `could not commit${sign ? ' (git signs commits here — is the signing key available?)' : ''}: ${commit.err}` };
      parent = commit.out;
      commits.push(parent);
    }
    const branch = memberBranch(login);
    const moved = git(['update-ref', '-m', 'yad member add', `refs/heads/${branch}`, parent]);
    if (!moved.ok) return { error: `could not move ${branch}: ${moved.err}` };
    return { branch, head: parent, commits };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const PR_BODY = (login, emails) => `## Summary

Adds the team member file for @${login}. It records one thing — identity: which platform accounts and which git
emails (stored hashed) belong to one person. It grants no access, holds no role and requests no reviewer.

## Impact & Risk

Risk level: low

- The active-people count joins this person's commits to their approvals (one person, not two).
- ${emails} email(s); each is added by its own commit, authored by that email, so CI can check that the platform
  attributes it to @${login}.

## Checklist

- [x] Written by \`yad member add\` from the platform's own answer (verified emails only)
- [x] Only my own member file changes
`;

// Push the branch and open the PR/MR. Never prompts (a clone that needs a password says so instead).
export function publishMember(root, { branch, base, login, platform, host, title, emails, runner = run }) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  // The branch is yad's own and is rebuilt from the default branch on every run (E131 review 4), so a run
  // after an earlier one replaces it — with a lease on what origin held when it was read, never blindly.
  // The lease names the exact commit origin holds (empty: the branch must not exist yet), read just now from
  // origin itself — a single-branch clone has no remote-tracking ref for git to find on its own.
  const remote = runner('git', ['ls-remote', 'origin', `refs/heads/${branch}`], { cwd: root, env, timeout: 60_000 });
  if (!remote.ok) return { pushed: false, error: `could not read origin: ${forTerminal(remote.stderr || 'git ls-remote failed')}` };
  const held = (remote.stdout || '').split(/\s/)[0] || '';
  const push = runner('git', ['push', '--no-verify', '--quiet', `--force-with-lease=refs/heads/${branch}:${held}`, '-u', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], { cwd: root, env, timeout: 60_000 });
  if (!push.ok) return { pushed: false, error: `could not push ${branch}: ${forTerminal(push.stderr || 'git push failed')}` };
  const body = PR_BODY(login, emails);
  const r = platform === 'github'
    ? runner('gh', ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body], { cwd: root, env: { ...process.env, ...(host && host !== 'github.com' ? { GH_HOST: host } : {}) }, timeout: 60_000 })
    : runner('glab', ['mr', 'create', '--source-branch', branch, '--target-branch', base, '--title', title, '--description', body, '--yes'], { cwd: root, timeout: 60_000 });
  // One already open for the branch is the one this push updated.
  if (!r.ok && /already exists/i.test(`${r.stderr} ${r.stdout}`)) {
    const url = `${r.stderr} ${r.stdout}`.match(/https?:\/\/\S+/)?.[0] || null;
    return { pushed: true, url, existing: true };
  }
  if (!r.ok) return { pushed: true, error: `pushed ${branch}, but could not open the ${platform === 'github' ? 'PR' : 'MR'}: ${forTerminal(r.stderr || 'failed')}` };
  const url = (r.stdout || '').split('\n').map((l) => l.trim()).find((l) => /^https?:\/\//.test(l)) || null;
  return { pushed: true, url };
}

// ---- status: active / idle / left / unknown -------------------------------------------------------

// The last day each member did something the count calls activity (a commit or an approval), from the
// evidence `peopleEvidence` reads. Null when nothing was seen in what was read.
export function lastActive(member, events) {
  let last = null;
  for (const e of events) if (e?.ts && memberMatches(member, e) && (!last || e.ts > last)) last = String(e.ts).slice(0, 10);
  return last;
}

// Does the account still have access to the Product's repo? 'yes' | 'no' | 'unknown'. Only a clear answer
// from the platform says 'no': an error, a timeout, a 403 (no right to ask, an SSO org) is 'unknown' — a
// person is never marked as gone on a guess.
export function accessCheck(identity, member, { runner = run } = {}) {
  const a = member.primary;
  if (!identity?.repo) return 'unknown';
  if (a.platform === 'github') {
    const r = runner('gh', ['api', '--hostname', a.host, `repos/${identity.repo}/collaborators/${a.login}/permission`, '--jq', '.permission'], { timeout: TIMEOUT });
    if (!r.ok) return 'unknown';
    const perm = r.stdout.trim();
    if (perm === 'none') return 'no';
    if (['admin', 'maintain', 'write', 'triage'].includes(perm)) return 'yes';
    // `read` on a PUBLIC repo is everyone's (E131 review 7): it says nothing about this person.
    if (perm === 'read') return runner('gh', ['api', '--hostname', a.host, `repos/${identity.repo}`, '--jq', '.private'], { timeout: TIMEOUT }).stdout?.trim() === 'true' ? 'yes' : 'unknown';
    return 'unknown';
  }
  if (!Number.isSafeInteger(a.id)) return 'unknown';
  const r = runner('glab', ['api', '--hostname', a.host, `projects/${encodeURIComponent(identity.repo)}/members/all/${a.id}`], { timeout: TIMEOUT });
  if (r.ok) return 'yes';
  // A 404 answers "not a member" only when the project itself can be read.
  if (httpStatus(r) === 404 && runner('glab', ['api', '--hostname', a.host, `projects/${encodeURIComponent(identity.repo)}`], { timeout: TIMEOUT }).ok) return 'no';
  return 'unknown';
}

// The access answers of today, per clone, kept in git's common folder (never committed; every worktree of
// one clone shares it). One read per member per day.
function accessCache(root) {
  const r = gitAt(root)(['rev-parse', '--git-common-dir']);
  if (!r.ok) return null;
  const dir = path.resolve(root, r.out);
  return path.join(dir, 'yad-members-access.json');
}

// Every member's status. `events` are the activity records (commit / approval); `today` a YYYY-MM-DD.
// `access` is called only for a member whose TTL ran out, and only once a day (cached).
export function memberStatuses(root, members, { events, today, ttl = DEFAULT_TTL_DAYS, identity, access = accessCheck, offline = false } = {}) {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - ttl * 86400000).toISOString().slice(0, 10);
  const file = offline ? null : accessCache(root);
  let cache = {};
  try { const c0 = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; if (c0?.date === today && isPlainObject(c0.answers)) cache = c0.answers; } catch { /* none yet */ }
  let wrote = false;
  const out = members.map((m) => {
    const last = lastActive(m, events);
    if (last && last >= cutoff) return { ...m, status: 'active', lastActive: last };
    const key = accountKey(m.primary);
    let answer = offline ? 'unknown' : cache[key];
    // An `unknown` is not kept: one network failure must not hide the answer for a day (review 7).
    if (!answer) { answer = access(identity, m); if (answer !== 'unknown') { cache[key] = answer; wrote = true; } }
    return { ...m, status: answer === 'yes' ? 'idle' : answer === 'no' ? 'left' : 'unknown', lastActive: last };
  });
  if (wrote && file) { try { fs.writeFileSync(file, `${JSON.stringify({ date: today, answers: cache })}\n`); } catch { /* a cache, nothing more */ } }
  return out;
}

// The registered repos on this machine that git may run in (judged first, E81), and the GitLab hosts they
// live on — where `yad member add` looks for the person's other git emails and accounts.
export function registeredRepos(root, { runner = run } = {}) {
  const { registry } = readRegistry(root);
  const dirs = [];
  const hosts = new Set();
  for (const r of registry.repos) {
    const j = judgeRepo(root, r);
    if (j.state !== 'present' || !runnable(j)) continue;
    const dir = path.resolve(root, r.path);
    dirs.push(dir);
    const host = plainHost(hostFromGitUrl(runner('git', ['remote', 'get-url', 'origin'], { cwd: dir }).stdout || ''));
    if (host && /gitlab/i.test(host)) hosts.add(host);
  }
  return { dirs, hosts: [...hosts] };
}

// The member files as a git ref holds them, read with the same rules as the folder on disk: each plain file
// is written into a scratch Product and `readMembers` judges it. A link or a folder in its place is skipped,
// as `readMembers` would refuse it.
export function membersAt(root, ref, identity) {
  const git = gitAt(root);
  const prefix = git(['rev-parse', '--show-prefix']).out;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-members-at-'));
  try {
    const dir = path.join(tmp, MEMBERS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const ls = gitAt(root)(['ls-tree', '-z', `${ref}:${prefix}${MEMBERS_DIR}`]);
    for (const line of ls.ok ? ls.out.split('\0').filter(Boolean) : []) {
      const [meta, name] = line.split('\t');
      if (!/^100(644|755) blob /.test(meta) || !name.endsWith('.json') || name.includes('/')) continue;
      const blob = git(['cat-file', 'blob', meta.split(' ')[2]]);
      if (blob.ok) fs.writeFileSync(path.join(dir, name), blob.out);
    }
    return readMembers(tmp, { identity });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- the commands -------------------------------------------------------------------------------

const refuser = () => (msg, hint) => { fail(msg); if (hint) hand(hint); process.exitCode = 1; };
const interactive = (env) => process.stdin.isTTY && process.stdout.isTTY && !env.SDLC_NONINTERACTIVE && !env.CI;

// `yad member add` — prove who is on this machine and write their member file on a branch with a PR/MR.
// `soft`: called by `yad join` — a problem is a warning and the next step, never a failure.
export async function runMemberAdd(root, { soft = false, noPush = false, runner = run, env = process.env, repos = undefined, today = new Date().toISOString().slice(0, 10), noLogin = false } = {}) {
  const refuse = soft ? (msg, hint) => { warn(msg); if (hint) hand(hint); } : refuser();
  log(c.bold(soft ? 'Team member' : '\nyad member add'));
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/product.json here)', 'run it from the Product, or pass --dir');
  // The switch every platform lookup obeys (offline work, and the test suite, which must never ask the
  // developer's real account). With an injected runner the lookups are fakes, so it does not apply.
  if (env.YAD_PLATFORM_LOGIN === '0' && runner === run) return refuse('platform lookups are off (YAD_PLATFORM_LOGIN=0), so no account can be proven', 'run `yad member add` without it');
  const identity = productIdentity(root, { runner });
  if (repos === undefined) repos = registeredRepos(root, { runner });
  if (!identity.platform) return refuse('the Product names no platform — a member file needs an account the platform can prove', 'set the platform in the Product settings (`yad setup`), then run `yad member add`');
  const cli = identity.platform === 'github' ? 'gh' : 'glab';
  const discover = () => {
    const accounts = ghAccounts({ runner, env });
    // GitLab: one account per host. The Product's host, and every GitLab host a registered repo lives on.
    const glHosts = new Set(identity.platform === 'gitlab' ? [identity.host] : []);
    for (const h of (repos?.hosts || [])) glHosts.add(h);
    for (const host of glHosts) accounts.push({ platform: 'gitlab', host, login: '(asked)' });
    return accounts;
  };
  let accounts = discover();
  const onProduct = () => accounts.some((a) => a.platform === identity.platform && a.host === identity.host && (a.platform === 'gitlab' || validLogin(a.login)));
  if (identity.platform === 'github' && !onProduct()) {
    if (interactive(env) && !noLogin) {
      info(`not logged in to GitHub on ${identity.host} — starting \`gh auth login\``);
      spawnSync('gh', ['auth', 'login', '--hostname', identity.host, '--scopes', 'user:email'], { stdio: 'inherit' });
      accounts = discover();
    }
    if (!onProduct()) return refuse(`not logged in to GitHub on ${identity.host}`, `run \`gh auth login --hostname ${identity.host} --scopes user:email\`, then \`yad member add\``);
  }
  let proofs = accounts.map((a) => accountProof(a, { runner, env }));
  if (identity.platform === 'gitlab' && !proofs.some((p) => p.account.platform === 'gitlab' && p.account.host === identity.host && validLogin(p.account.login))) {
    if (interactive(env) && !noLogin) {
      info(`not logged in to GitLab on ${identity.host} — starting \`glab auth login\``);
      spawnSync('glab', ['auth', 'login', '--hostname', identity.host], { stdio: 'inherit' });
      proofs = discover().map((a) => accountProof(a, { runner, env }));
    }
  }
  proofs = proofs.filter((p) => validLogin(p.account.login));
  const git = gitIdentities(root, { runner, repos: repos?.dirs || [] });
  // Built on the default branch AS ORIGIN HAS IT, so the PR holds only this change — never on whatever the
  // checkout is on (E131 review 5). The name comes from the shared settings, so only a plain branch name is
  // used, and it reaches git inside a full refspec, never where it could be read as an option.
  const g = gitAt(root);
  const base = resolveDefaultBranch((...a) => { const r = g(a); return { ok: r.ok, stdout: r.out }; }, readJSON(productConfigPath(root), null));
  if (!BRANCH_RE.test(base) || base.includes('..')) return refuse(`the Product's default branch is not a plain branch name: ${forTerminal(base)}`, 'fix default_branch in the Product settings');
  g(['fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`]);
  if (!g(['rev-parse', '--verify', '-q', `refs/remotes/origin/${base}^{commit}`]).ok) return refuse(`could not read origin's ${base} — the member file is built on it`, 'check the clone can fetch from origin, then run `yad member add` again');
  const baseRef = `refs/remotes/origin/${base}`;
  // The member files AS THEY ARE ON THAT BRANCH (review 2, finding 3): the checkout may be behind — still
  // holding a file someone removed, or missing one someone added — and the PR is judged against the branch.
  const existingAll = membersAt(root, baseRef, identity);
  const mine = existingAll.members.find((m) => proofs.some((p) => p.account.platform === identity.platform && p.account.host === identity.host && p.account.login.toLowerCase() === m.primary.login.toLowerCase()));
  const built = buildRecord({ identity, proofs, git, today, existing: mine || null });
  if (built.problem) return refuse(built.problem, built.hint || (built.login ? `run \`${cli} auth login --hostname ${identity.host}\`, then \`yad member add\`` : null));
  const { record, primary, plainByHash } = built;
  if (!Number.isSafeInteger(primary.id)) return refuse(`the platform did not give the numeric id of ${accountLabel(primary)} — the member-check gate needs it`, 'run `yad member add` again; if it keeps failing, report it with `yad report`');
  // A login renamed away and registered again by someone else is another account: the old file is not theirs.
  if (mine && mine.primary.id !== primary.id) return refuse(`${mine.rel} belongs to another account with the login ${forTerminal(primary.login)} (id ${mine.primary.id}, yours is ${primary.id})`, 'that file is someone else\'s — ask the team to remove it (`yad member remove <login> --reason …`), then run `yad member add`');
  // An account or email another member file already holds is not added here: CI would refuse the PR.
  // A clash that CI refuses: your Product account as someone's primary, or an email another file holds. An
  // OTHER account someone else also claims is not refused — your file is the truth about you, and the
  // claims are reported (`yad member list`, `yad doctor`) until one is dropped.
  const taken = existingAll.members.filter((m) => m !== mine);
  if (taken.some((m) => accountKey(m.primary) === accountKey(primary))) return refuse(`the ${accountLabel(primary)} account is already in another member file`, 'one account belongs to one member — if that file is yours from another login, remove it first (`yad member remove <login> --reason …`)');
  // An email another file lists is left out of yours, with a warning — never a refusal of the whole add
  // (review 3): on GitLab anyone can list a known address, and that must not block its owner from joining.
  const shared = record.emails.filter((h) => taken.some((m) => m.emails.includes(h)));
  if (shared.length) {
    warn(`${shared.length} of your emails ${shared.length === 1 ? 'is' : 'are'} already in another member file — left out of yours; \`yad member list\` names the file`);
    record.emails = record.emails.filter((h) => !shared.includes(h));
    if (!record.emails.length) return refuse('every email of yours is already in another member file', 'ask the team to remove the file that lists them (`yad member remove <login> --reason …`), then run `yad member add`');
  }
  for (const a of record.accounts.slice(1)) {
    const other = taken.find((m) => m.accounts.some((b) => accountKey(b) === accountKey(a)));
    if (other) warn(`the ${accountLabel(a)} account is also claimed by ${other.rel} — neither claim is matched until one file drops it`);
  }
  const rel = memberRel(identity.platform, primary.login);
  if (identity.platform === 'github' && identity.verified && !memberGateLive(root, identity)) {
    warn('the member-check gate is missing or not the shipped copy here — until `yad update` installs it, the active-people count does not use member files, and a file merged before it is not trusted later either (run `yad member add` again then)');
  }
  if (built.dropped) info(`${built.dropped} email(s) in your file are no longer verified on the account — dropped`);
  // Up to date only when nothing but the day changed AND the gate as shipped has judged the file — else a
  // fresh change re-proves every email (review 5).
  const strip = (r) => memberJSON({ accounts: r.accounts, emails: r.emails, names: r.names, joined: r.joined });
  const judged = identity.platform === 'github' && identity.verified ? judgedMemberFiles(root, identity).files.has(rel) : true;
  const same = !!mine && judged && strip(mine) === strip(record);
  for (const s of built.skipped) info(`${s}: logged in here, but shares no verified email with ${accountLabel(primary)} — not added`);
  if (built.unproven) info(`${built.unproven} git email(s) here are not verified on the account — not added (they stay counted as their own person)`);
  if (same) {
    ok(`${rel} is up to date — ${accountLabel(primary)}`);
    return { login: primary.login, path: rel, changed: false };
  }
  const subject = mine ? `chore(product): update team member ${primary.login}` : `chore(product): add team member ${primary.login}`;
  const made = commitMember(root, { rel, record, plainByHash, base: baseRef, name: git.names[0], login: primary.login, subject });
  if (made.error) return refuse(made.error, 'nothing was pushed; fix it and run `yad member add` again');
  ok(`wrote ${rel} on ${made.branch} (${made.commits.length} commit(s)) — ${accountLabel(primary)}${record.accounts.length > 1 ? ` + ${record.accounts.length - 1} other account(s)` : ''}, ${record.emails.length} email(s), stored hashed`);
  if (noPush) {
    hand(`push it and open a ${identity.platform === 'github' ? 'PR' : 'MR'}: git push -u origin ${made.branch}`);
    return { login: primary.login, path: rel, changed: true, branch: made.branch, pushed: false };
  }
  const pub = publishMember(root, { branch: made.branch, base, login: primary.login, platform: identity.platform, host: identity.host, title: subject, emails: record.emails.length, runner });
  if (pub.error) {
    warn(pub.error);
    hand(pub.pushed ? `open it yourself from ${made.branch} into ${base}` : `when you can push: git push -u origin ${made.branch}, then open a ${identity.platform === 'github' ? 'PR' : 'MR'} into ${base} (or run \`yad member add\` again)`);
  } else ok(`opened ${pub.url || `the ${identity.platform === 'github' ? 'PR' : 'MR'}`} — it joins the team list once it merges`);
  return { login: primary.login, path: rel, changed: true, branch: made.branch, pushed: !!pub.pushed, url: pub.url || null };
}

// `yad member list` — every member, their status and why; every file that cannot be used; every duplicate.
export async function runMemberList(root, { events = null, today = new Date().toISOString().slice(0, 10), offline = false, access = accessCheck } = {}) {
  const refuse = refuser();
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/product.json here)', 'run it from the Product, or pass --dir');
  const productConfig = readJSON(productConfigPath(root), null);
  const identity = productIdentity(root, { productConfig });
  const got = readMembers(root, { identity });
  const ttl = ttlDays(productConfig);
  let evidence = events;
  if (!evidence) {
    const { peopleEvidence } = await import('./people.mjs');
    try { evidence = peopleEvidence(root, { today, sinceDays: Math.max(ttl, 1) + 1 }).events; } catch { evidence = []; }
  }
  const members = memberStatuses(root, got.members, { events: evidence, today, ttl, identity, access, offline });
  const team = members.filter((m) => m.status !== 'left');
  if (!members.length && !got.errors.length) info('no member files yet — each person runs `yad member add` (or `yad join` does it)');
  for (const m of members) {
    const others = m.accounts.length > 1 ? ` + ${m.accounts.slice(1).map(accountLabel).join(', ')}` : '';
    const why = m.status === 'active' ? `last active ${m.lastActive}` : m.status === 'idle' ? `nothing in ${ttl} days${m.lastActive ? ` (last ${m.lastActive})` : ''}, still has access`
      : m.status === 'left' ? 'no longer has access to the Product — off the team list until they commit or approve again' : `nothing in ${ttl} days; access could not be checked`;
    (m.status === 'left' ? warn : info)(`${accountLabel(m.primary)}${others} — ${m.status}: ${why}`);
  }
  for (const e of got.errors) warn(e.error);
  for (const d of got.duplicates) warn(`${d} — one account or email belongs to one member; neither file joins it until one is fixed`);
  if (identity.platform === 'gitlab' && members.length) info('on GitLab the pairings feed the team list only, not the gate count (CI cannot prove an email belongs to the MR author)');
  if (!identity.verified && members.length) info('no CI checks member files on this Product (a local ledger, or no platform) — each file is its owner\'s own statement');
  return {
    ttlDays: ttl,
    members: members.map((m) => ({ path: m.rel, login: m.primary.login, accounts: m.accounts, names: m.names, emails: m.emails.length, joined: m.joined, status: m.status, lastActive: m.lastActive || null })),
    team: team.map((m) => m.primary.login),
    errors: got.errors.map((e) => e.error),
    duplicates: got.duplicates,
  };
}

// `yad member remove [<login>] [--reason]` — delete a member file. Your own needs no reason; anyone
// else's needs one, and is a deletion only (the CI check lets a PR that only DELETES a file through).
export async function runMemberRemove(root, { login = null, reason = null, runner = run, env = process.env } = {}) {
  const refuse = refuser();
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/product.json here)', 'run it from the Product, or pass --dir');
  const identity = productIdentity(root, { runner });
  if (!identity.platform) return refuse('the Product names no platform, so it has no member files');
  const me = identity.platform === 'github'
    ? ((ghAccounts({ runner, env }).filter((a) => a.host === identity.host).find((a) => a.active) || {}).login || null)
    : (() => { const r = runner('glab', ['api', '--hostname', identity.host, 'user'], { env, timeout: TIMEOUT }); const u = r.ok ? parse(r.stdout) : null; return validLogin(u?.username) ? u.username : null; })();
  const who = login || me;
  if (!who) return refuse('whose member file? (not logged in here, so yad cannot tell who you are)', 'usage: yad member remove [<login>] [--reason "<why>"]');
  if (!validLogin(who)) return refuse(`not a login: ${forTerminal(who)}`);
  const rel = memberRel(identity.platform, who);
  if (!fs.existsSync(path.join(root, rel))) return refuse(`no member file for ${forTerminal(who)} (${rel})`, '`yad member list` shows the members');
  const own = me && me.toLowerCase() === who.toLowerCase();
  if (!own && !(typeof reason === 'string' && reason.trim())) return refuse(`${who} is not you — removing someone else's member file needs --reason "<why>"`, `yad member remove ${who} --reason "<why>"`);
  fs.rmSync(path.join(root, rel), { force: true });
  ok(`removed ${rel}${own ? '' : ` — reason: ${forTerminal(reason.trim())}`}`);
  hand(`commit the removal on its own${own ? '' : `, with the reason in the message: git commit -m "chore(product): remove team member ${who}" -m "Reason: ${forTerminal(reason.trim()).replace(/"/g, "'")}"`} — on a verified Product, in a PR of its own`);
  return { login: who, path: rel, removed: true, reason: own ? null : reason.trim() };
}
