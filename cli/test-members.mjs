// `yad member` (E131): one file per person, identity only. The rules each test pins:
//   - an account or an email belongs to one member; a shared one joins nothing (over-count, never under);
//   - only a VERIFIED email of the logged-in account joins, and only on a GitHub Product for the gate count;
//   - the gate count can only JOIN two keys of one person — a member file never removes anyone;
//   - status is derived on read, and only a clear "no access" from the platform makes someone `left`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The #280 guard (cli/test.mjs): printed lines go to stderr while the runner owns stdout.
if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';
process.env.YAD_PLATFORM_LOGIN = '0';
for (const k of Object.keys(process.env)) if (/^GIT_(AUTHOR|COMMITTER)_/.test(k)) delete process.env[k];

const M = await import('./members.mjs');
const { activePeople, daysBefore } = await import('./people.mjs');

const TODAY = '2026-10-05';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yad-members-'));
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text)); };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString().trim();
const GH = { platform: 'github', host: 'github.com' };

function product({ platform = 'github', gitUrl = 'git@github.com:acme/product.git', extra = {} } = {}) {
  const T = tmp();
  git(T, 'init', '-q', '-b', 'main');
  git(T, 'config', 'user.name', 'Alice Smith');
  git(T, 'config', 'user.email', 'alice@work.com');
  git(T, 'config', 'commit.gpgsign', 'false');
  put(path.join(T, '.sdlc/product.json'), { platform, git_url: gitUrl, default_branch: 'main', ...extra });
  return T;
}
// A verified GitHub Product with the member-check gate installed and run: the only place the gate count
// trusts a member file (review 2).
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
function liveGate(T) {
  const cfg = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/product.json'), 'utf8'));
  put(path.join(T, '.sdlc/product.json'), { ...cfg, ledger: 'verified' });
  fs.mkdirSync(path.join(T, 'checks'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'skills/yad-checks/templates/checks/member-check.mjs'), path.join(T, 'checks/member-check.mjs'));
  fs.mkdirSync(path.join(T, '.github/workflows'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'skills/yad-checks/templates/github/yad-product-checks.yml'), path.join(T, '.github/workflows/yad-product-checks.yml'));
  git(T, 'add', '--', '.sdlc/product.json', 'checks', '.github');
  git(T, 'commit', '-q', '--allow-empty', '-m', 'chore(product): install the member-check gate');
  // The count reads what origin's default branch holds (review 4): give the Product an origin, and push.
  if (!fs.existsSync(path.join(T, '.git', 'test-origin'))) {
    git(T, 'init', '-q', '--bare', path.join(T, '.git', 'test-origin'));
    git(T, 'remote', 'add', 'origin', path.join(T, '.git', 'test-origin'));
  }
  git(T, 'push', '-q', '-f', 'origin', 'HEAD:refs/heads/main');
  git(T, 'fetch', '-q', 'origin');
}
const member = (T, file, rec) => put(path.join(T, M.MEMBERS_DIR, file), rec);
// A member file merged AFTER the gate arrived, and pushed — the only kind the count trusts (reviews 3–4).
const memberC = (T, file, rec, { push = true } = {}) => {
  member(T, file, rec);
  git(T, 'add', '-A', '--', M.MEMBERS_DIR);
  git(T, 'commit', '-q', '--allow-empty', '-m', `member ${file}`);
  if (push && fs.existsSync(path.join(T, '.git', 'test-origin'))) { git(T, 'push', '-q', '-f', 'origin', 'HEAD:refs/heads/main'); git(T, 'fetch', '-q', 'origin'); }
};
const alice = (over = {}) => ({ accounts: [{ platform: 'github', host: 'github.com', login: 'alice', id: 1 }], emails: [M.hashEmail('alice@work.com')], names: ['Alice Smith'], joined: TODAY, ...over });

test('E131 readMembers: a members folder reached through a link is never read (review 1)', () => {
  const T = product();
  try {
    put(path.join(T, 'other', 'github-mallory.json'), { accounts: [{ platform: 'github', host: 'github.com', login: 'mallory' }], emails: [M.hashEmail('victim@x.io')] });
    fs.symlinkSync('../other', path.join(T, M.MEMBERS_DIR));
    const got = M.readMembers(T);
    assert.equal(got.members.length, 0);
    assert.match(got.errors[0].error, /reached through a link/);
    assert.equal(M.gateMemberMap(T).size, 0);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 readMembers: an OTHER account two files claim is matched by nobody; one that is someone\'s own stays theirs (review 6)', () => {
  const T = product();
  try {
    liveGate(T);
    memberC(T, 'github-alice.json', alice({ accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }, { platform: 'gitlab', host: 'gitlab.com', login: 'al' }] }));
    memberC(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }, { platform: 'gitlab', host: 'gitlab.com', login: 'al' }, { platform: 'github', host: 'ghe.io', login: 'alice' }] });
    const got = M.readMembers(T);
    const [a, b] = got.members;
    assert.equal(M.memberMatches(a, { login: 'al' }), false, 'disputed: nobody');
    assert.equal(M.memberMatches(b, { login: 'al' }), false);
    assert.equal(M.memberMatches(a, { login: 'alice' }), true);
    assert.equal(M.gateMemberMap(T).get(M.hashEmail('alice@work.com')), 'alice', 'Alice\'s own pairing is untouched');
    assert.match(got.duplicates.join('\n'), /claimed by/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 hashEmail: one address, any spelling; nothing that is not an address', () => {
  assert.equal(M.hashEmail(' Alice@Work.com '), M.hashEmail('alice@work.com'));
  assert.match(M.hashEmail('a@b.c'), /^sha256:[0-9a-f]{64}$/);
  for (const bad of ['', '   ', '@x.io', 'no-at', null, undefined, 5]) assert.equal(M.hashEmail(bad), null, String(bad));
});

test('E131 readMemberFile: a usable file, and every way one is refused', () => {
  const T = product();
  try {
    const f = path.join(T, M.MEMBERS_DIR, 'github-alice.json');
    member(T, 'github-alice.json', alice());
    const ok = M.readMemberFile(f, GH);
    assert.equal(ok.record.primary.login, 'alice');
    const bad = (rec, re, name = 'github-alice.json') => { member(T, name, rec); assert.match(M.readMemberFile(path.join(T, M.MEMBERS_DIR, name), GH).error, re); };
    bad('{', /not valid JSON/);
    bad([], /not a JSON object/);
    bad(alice({ accounts: [] }), /no "accounts"/);
    bad(alice({ accounts: [{ platform: 'github', host: 'github.com', login: 'dependabot[bot]' }] }), /not \{ platform/);
    bad(alice({ emails: ['alice@work.com'] }), /stored as sha256/);
    bad(alice({ joined: '5 Oct' }), /YYYY-MM-DD/);
    bad(alice({ accounts: [{ platform: 'gitlab', host: 'gitlab.com', login: 'alice' }] }), /no github account on github\.com/);
    bad(alice({ accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }, { platform: 'github', host: 'github.com', login: 'alice2' }] }), /two accounts on github\.com/);
    bad(alice(), /must be called github-alice\.json/, 'github-bob.json');
    bad(alice({ accounts: [{ platform: 'github', host: 'github.com', login: 'alice', id: -3 }] }), /positive whole number/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 readMembers + gateMemberMap: a shared account or email joins nothing', () => {
  const T = product();
  try {
    liveGate(T);
    memberC(T, 'github-alice.json', alice());
    memberC(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }], emails: [M.hashEmail('bob@work.com')], names: ['Bob'] });
    let map = M.gateMemberMap(T);
    assert.equal(map.get(M.hashEmail('alice@work.com')), 'alice');
    assert.equal(map.get(M.hashEmail('bob@work.com')), 'bob');
    // Bob claims Alice's email: neither file joins it any more.
    memberC(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }], emails: [M.hashEmail('bob@work.com'), M.hashEmail('alice@work.com')] });
    const got = M.readMembers(T);
    assert.equal(got.duplicates.length, 1);
    map = M.gateMemberMap(T);
    assert.equal(map.has(M.hashEmail('alice@work.com')), false, 'a shared email is dropped from every pairing');
    assert.equal(map.get(M.hashEmail('bob@work.com')), 'bob', 'the rest of the file still pairs');
    // Bob lists Alice's GitLab account too: a shared account is reported.
    memberC(T, 'github-alice.json', alice({ accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }, { platform: 'gitlab', host: 'gitlab.com', login: 'al' }] }));
    memberC(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }, { platform: 'gitlab', host: 'gitlab.com', login: 'AL' }] });
    assert.match(M.readMembers(T).duplicates.join('\n'), /GitLab al account is claimed by/);
    // An unreadable file is listed, never dropped, and adds no pairing.
    memberC(T, 'github-carol.json', '{');
    assert.equal(M.readMembers(T).errors.length, 1);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 gateMemberMap: a GitLab Product pairs nothing for the gate count (decision 7)', () => {
  const T = product({ platform: 'gitlab', gitUrl: 'git@gitlab.com:acme/product.git' });
  try {
    member(T, 'gitlab-alice.json', { accounts: [{ platform: 'gitlab', host: 'gitlab.com', login: 'alice' }], emails: [M.hashEmail('alice@work.com')] });
    assert.equal(M.readMembers(T).members.length, 1, 'the member is on the team list');
    assert.equal(M.gateMemberMap(T).size, 0, 'but nothing joins in the gate count');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 gateMemberMap: no pairing unless the member-check gate is live (review 2) and judged the file (review 3)', () => {
  const T = product();
  try {
    memberC(T, 'github-alice.json', alice());
    assert.equal(M.gateMemberMap(T).size, 0, 'a local-ledger Product: a file is only its owner\'s statement');
    liveGate(T);
    assert.equal(M.gateMemberMap(T).size, 0, 'merged BEFORE the gate arrived: no gate judged it');
    memberC(T, 'github-alice.json', alice({ names: ['Alice Smith', 'alice'] }));
    assert.equal(M.gateMemberMap(T).size, 1, 'changed again after it: judged, trusted');
    member(T, 'github-alice.json', alice({ emails: [M.hashEmail('bob@work.com')] }));
    assert.equal(M.gateMemberMap(T).size, 0, 'an edit not committed is nobody\'s proof');
    memberC(T, 'github-alice.json', alice({ names: ['Alice Smith', 'alice'] }));
    assert.equal(M.gateMemberMap(T).size, 1);
    // Committed but never pushed: nobody's proof (review 4).
    memberC(T, 'github-alice.json', alice({ names: ['A'] }), { push: false });
    assert.equal(M.gateMemberMap(T).size, 0, 'a local commit is not what origin judged');
    git(T, 'push', '-q', '-f', 'origin', 'HEAD:refs/heads/main');
    git(T, 'fetch', '-q', 'origin');
    assert.equal(M.gateMemberMap(T).size, 1);
    // An edit to the gate that origin holds: not live. Restored: live again, but every file needs a new
    // judged change (review 4 — one PR could disable it, add a forged file, and a later PR restore it).
    const edit = (rel, text) => { fs.writeFileSync(path.join(T, rel), text); git(T, 'commit', '-q', '-am', `edit ${rel}`); git(T, 'push', '-q', '-f', 'origin', 'HEAD:refs/heads/main'); git(T, 'fetch', '-q', 'origin'); };
    const gate = fs.readFileSync(path.join(T, 'checks/member-check.mjs'), 'utf8');
    edit('checks/member-check.mjs', 'process.exit(0)\n');
    assert.equal(M.gateMemberMap(T).size, 0, 'a gutted gate is not live');
    edit('checks/member-check.mjs', gate);
    assert.equal(M.gateMemberMap(T).size, 0, 'restored: the file was judged by the gutted gate, so not trusted');
    memberC(T, 'github-alice.json', alice({ names: ['Alice Smith'] }));
    assert.equal(M.gateMemberMap(T).size, 1, 'a new judged change: trusted');
    const wf = fs.readFileSync(path.join(T, '.github/workflows/yad-product-checks.yml'), 'utf8');
    edit('.github/workflows/yad-product-checks.yml', wf.replace('  member-check:\n    runs-on: ubuntu-latest\n    if: github.event.action != \'edited\'', '  member-check:\n    runs-on: ubuntu-latest\n    if: false'));
    assert.equal(M.gateMemberMap(T).size, 0, 'an `if: false` job is not live');
    edit('.github/workflows/yad-product-checks.yml', wf);
    assert.equal(M.gateMemberMap(T).size, 0, 'restored: trust starts again from here');
    assert.equal(M.gateMemberMap(T, { anyPlatform: true }).size, 1, 'a report still reads it');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 THE COUNT: a work-email committer who approves by login is ONE person with a member file, two without', () => {
  const T = product();
  try {
    liveGate(T);
    put(path.join(T, 'epics/EP-x/.sdlc/state.json'), { currentStep: 'epic-review', steps: [] });
    put(path.join(T, 'epics/EP-x/.sdlc/approvals.json'), [
      { approver: 'alice', date: daysBefore(TODAY, 2), source: 'bridge' },
      { approver: 'bob', date: daysBefore(TODAY, 2), source: 'bridge' },
    ]);
    put(path.join(T, 'a.txt'), 'x');
    git(T, 'add', '-A');
    git(T, 'commit', '-q', '-m', 'alice commits with her work email');
    put(path.join(T, 'b.txt'), 'y');
    git(T, 'add', '-A');
    execFileSync('git', ['-c', 'user.name=Bob Jones', '-c', 'user.email=bob@work.com', 'commit', '-q', '-m', 'bob too'], { cwd: T, stdio: 'pipe' });
    const before = activePeople(T, { today: TODAY });
    assert.deepEqual(before.unknown, []);
    assert.equal(before.capacity.active, 4, 'two people read as four: E108 blocker (a)');
    memberC(T, 'github-alice.json', alice());
    assert.equal(activePeople(T, { today: TODAY }).capacity.active, 3, 'Alice is one person now; Bob, with no file, still counts twice');
    memberC(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }], emails: [M.hashEmail('bob@work.com')] });
    assert.equal(activePeople(T, { today: TODAY }).capacity.active, 2);
    // A file that does not parse adds no pairing: the count goes back UP, never down.
    memberC(T, 'github-bob.json', '{');
    assert.equal(activePeople(T, { today: TODAY }).capacity.active, 3);
    // A member who never committed or approved adds nobody: a file is never a person by itself.
    memberC(T, 'github-carol.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'carol' }], emails: [M.hashEmail('carol@x.io')] });
    assert.equal(activePeople(T, { today: TODAY }).capacity.active, 3);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- the proof -------------------------------------------------------------------------------------
const proof = (platform, host, login, emails, id = 7) => ({ account: { platform, host, login, id }, emails });
const ID = { platform: 'github', host: 'github.com' };

test('E131 buildRecord: only a verified email of the logged-in account joins', () => {
  const git0 = { emails: ['alice@work.com', 'alice@home.io'], names: ['Alice Smith'] };
  const r = M.buildRecord({ identity: ID, today: TODAY, git: git0, proofs: [proof('github', 'github.com', 'alice', ['alice@work.com', 'other@x.io'])] });
  assert.equal(r.primary.login, 'alice');
  assert.deepEqual(r.record.emails, [M.hashEmail('alice@work.com')], 'home email is not verified on the account: not added');
  assert.equal(r.unproven, 1);
  assert.equal(r.record.joined, TODAY);
  const none = M.buildRecord({ identity: ID, today: TODAY, git: git0, proofs: [proof('github', 'github.com', 'alice', ['x@y.z'])] });
  assert.match(none.problem, /no git email here .* is a verified email of GitHub alice/);
  const out = M.buildRecord({ identity: ID, today: TODAY, git: git0, proofs: [] });
  assert.equal(out.login, true, 'not logged in on the Product platform says to log in');
  assert.match(M.buildRecord({ identity: { platform: null }, today: TODAY, git: git0, proofs: [] }).problem, /names no platform/);
});

test('E131 buildRecord: emails come from the primary account only (review 3)', () => {
  const r = M.buildRecord({ identity: ID, today: TODAY, git: { emails: ['alice@work.com', 'alice@gl.io'], names: [] }, proofs: [
    proof('github', 'github.com', 'alice', ['alice@work.com']),
    proof('gitlab', 'gitlab.com', 'al', ['alice@work.com', 'alice@gl.io']),
  ] });
  assert.deepEqual(r.record.emails, [M.hashEmail('alice@work.com')], 'an email only GitLab verified would fail the GitHub gate');
  assert.equal(r.record.accounts.length, 2);
});

test('E131 buildRecord: another account joins only through a shared verified email', () => {
  const git0 = { emails: ['alice@work.com'], names: ['Alice Smith', 'alice'] };
  const r = M.buildRecord({ identity: ID, today: TODAY, git: git0, proofs: [
    proof('github', 'github.com', 'alice', ['alice@work.com']),
    proof('gitlab', 'gitlab.com', 'alice-g', ['alice@work.com']),
    proof('github', 'ghe.corp.io', 'asmith', ['someone@else.io']),
  ] });
  assert.deepEqual(r.record.accounts.map((a) => `${a.platform}:${a.host}:${a.login}`), ['github:github.com:alice', 'gitlab:gitlab.com:alice-g']);
  assert.deepEqual(r.skipped, ['GitHub asmith on ghe.corp.io'], 'an account with no shared email is named, not added');
  assert.deepEqual(r.record.names, ['Alice Smith', 'alice']);
  const two = M.buildRecord({ identity: ID, today: TODAY, git: git0, proofs: [
    proof('github', 'github.com', 'alice', ['alice@work.com']), proof('github', 'github.com', 'alice-alt', ['alice@work.com']),
  ] });
  assert.match(two.problem, /more than one github account/);
});

test('E131 buildRecord: an update keeps an email only while the account still verifies it, and re-proves them all (review 5)', () => {
  const existing = { primary: { platform: 'github', host: 'github.com', login: 'alice' }, accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }, { platform: 'gitlab', host: 'gitlab.com', login: 'old' }], emails: [M.hashEmail('home@x.io'), M.hashEmail('gone@x.io')], names: ['Al'], joined: '2026-01-01' };
  // home@x.io is not this machine's git email, but the account still verifies it: kept, provable from here.
  const r = M.buildRecord({ identity: ID, today: TODAY, existing, git: { emails: ['alice@work.com'], names: ['Alice Smith'] }, proofs: [proof('github', 'github.com', 'alice', ['alice@work.com', 'home@x.io'])] });
  assert.equal(r.record.joined, '2026-01-01');
  assert.equal(r.record.proved, `${TODAY}T00:00:00Z`, 'a moment, so a same-day re-run still changes the file (review 6)');
  assert.ok(r.record.accounts.some((a) => a.login === 'old'));
  assert.deepEqual(r.record.emails, [M.hashEmail('alice@work.com'), M.hashEmail('home@x.io')].sort());
  assert.equal(r.dropped, 1, 'gone@x.io is no longer verified: dropped');
  assert.deepEqual(r.newEmails, r.record.emails, 'every email is proven again');
  assert.equal(r.plainByHash.get(M.hashEmail('home@x.io')), 'home@x.io');
});

test('E131 ghAccounts: both spellings of `gh auth status`, and never a bot or a bad host', () => {
  const runner = () => ({ ok: true, stdout: 'github.com\n  ✓ Logged in to github.com account alice (keyring)\n  ✓ Logged in to github.com account alice-alt (keyring)\nghe.corp.io\n  ✓ Logged in to ghe.corp.io as asmith (oauth_token)\n  ✓ Logged in to $(evil) account x\n  ✓ Logged in to github.com account dependabot[bot]', stderr: '' });
  assert.deepEqual(M.ghAccounts({ runner }).map((a) => `${a.host}:${a.login}`), ['github.com:alice', 'github.com:alice-alt', 'ghe.corp.io:asmith']);
});

test('E131 accountProof: asks with the account\'s own token; a missing scope says how to fix it', () => {
  const calls = [];
  const runner = (cmd, args, opts) => {
    calls.push({ args, token: opts?.env?.GH_TOKEN });
    if (args[0] === 'auth') return { ok: true, stdout: 'tok-alice' };
    if (args.includes('user/emails')) return { ok: true, stdout: 'alice@work.com\n' };
    return { ok: true, stdout: '{"login":"alice","id":42}' };
  };
  const p = M.accountProof({ platform: 'github', host: 'github.com', login: 'alice' }, { runner, env: {} });
  assert.deepEqual(p.emails, ['alice@work.com', 'alice@users.noreply.github.com', '42+alice@users.noreply.github.com'], 'verified ones, plus the account\'s own noreply addresses (review 8)');
  assert.equal(p.account.id, 42);
  assert.ok(calls.filter((c) => c.args[0] === 'api').every((c) => c.token === 'tok-alice'));
  const noScope = (cmd, args) => (args[0] === 'auth' ? { ok: true, stdout: 't' } : args.includes('user/emails') ? { ok: false, stderr: 'gh: Not Found (HTTP 404)' } : { ok: true, stdout: '{"login":"alice","id":1}' });
  assert.match(M.accountProof({ platform: 'github', host: 'github.com', login: 'alice' }, { runner: noScope, env: {} }).problem, /gh auth refresh -h github\.com -s user:email/);
  const gl = (cmd, args) => (args.includes('user/emails') ? { ok: true, stdout: '[{"email":"b@x.io","confirmed_at":"2026-01-01"},{"email":"c@x.io","confirmed_at":null}]' } : { ok: true, stdout: '{"username":"al","id":9,"email":"a@x.io","commit_email":"a@x.io"}' });
  assert.deepEqual(M.accountProof({ platform: 'gitlab', host: 'gitlab.com', login: '(asked)' }, { runner: gl }).emails.sort(), ['a@x.io', 'b@x.io']);
});

test('E131 memberStatuses: active, idle, left, unknown — and only a clear "no" is left', () => {
  const T = product();
  try {
    const mk = (login) => ({ rel: `x/${login}`, primary: { platform: 'github', host: 'github.com', login }, accounts: [{ platform: 'github', host: 'github.com', login }], emails: [M.hashEmail(`${login}@w.io`)], names: [] });
    const members = ['ann', 'ida', 'leo', 'una'].map(mk);
    const events = [
      { ts: daysBefore(TODAY, 3), name: 'Ann', emailHash: M.hashEmail('ann@w.io'), how: 'committed' },
      { ts: daysBefore(TODAY, 200), login: 'ida', how: 'approved' },
    ];
    let asked = 0;
    const access = (_id, m) => { asked++; return { ida: 'yes', leo: 'no', una: 'unknown' }[m.primary.login]; };
    const got = M.memberStatuses(T, members, { events, today: TODAY, ttl: 90, identity: { repo: 'acme/product' }, access });
    assert.deepEqual(got.map((m) => `${m.primary.login}:${m.status}`), ['ann:active', 'ida:idle', 'leo:left', 'una:unknown']);
    assert.equal(got[1].lastActive, daysBefore(TODAY, 200));
    assert.equal(asked, 3, 'an active member is never asked about');
    M.memberStatuses(T, members, { events, today: TODAY, ttl: 90, identity: { repo: 'acme/product' }, access });
    assert.equal(asked, 4, 'a clear answer is kept for the day; an unknown is asked again (review 7)');
    // Coming back: one new commit makes a member active again, with no re-join.
    const back = M.memberStatuses(T, [members[2]], { events: [{ ts: TODAY, login: 'leo', how: 'committed' }], today: TODAY, ttl: 90, access });
    assert.equal(back[0].status, 'active');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 accessCheck: a 403 or an error is unknown; GitLab 404 is "no" only when the project reads', () => {
  const gh = (out) => () => out;
  const m = { primary: { platform: 'github', host: 'github.com', login: 'leo' } };
  assert.equal(M.accessCheck({ repo: 'a/b' }, m, { runner: gh({ ok: true, stdout: 'write' }) }), 'yes');
  const pub = (isPrivate) => (cmd, args) => (args[3].endsWith('/permission') ? { ok: true, stdout: 'read' } : { ok: true, stdout: String(isPrivate) });
  assert.equal(M.accessCheck({ repo: 'a/b' }, m, { runner: pub(false) }), 'unknown', 'read on a public repo is everyone\'s (review 7)');
  assert.equal(M.accessCheck({ repo: 'a/b' }, m, { runner: pub(true) }), 'yes');
  assert.equal(M.accessCheck({ repo: 'a/b' }, m, { runner: gh({ ok: true, stdout: 'none' }) }), 'no');
  assert.equal(M.accessCheck({ repo: 'a/b' }, m, { runner: gh({ ok: false, stderr: 'HTTP 403' }) }), 'unknown');
  assert.equal(M.accessCheck({ repo: null }, m, { runner: gh({ ok: true, stdout: 'none' }) }), 'unknown');
  const g = { primary: { platform: 'gitlab', host: 'gitlab.com', login: 'leo', id: 5 } };
  const gl = (projectOk) => (cmd, args) => (args[3].includes('/members/') ? { ok: false, stderr: 'glab: 404 Not Found (HTTP 404)' } : { ok: projectOk });
  assert.equal(M.accessCheck({ repo: 'g/p' }, g, { runner: gl(true) }), 'no');
  assert.equal(M.accessCheck({ repo: 'g/p' }, g, { runner: gl(false) }), 'unknown');
  assert.equal(M.accessCheck({ repo: 'g/p' }, { primary: { ...g.primary, id: undefined } }, { runner: gl(true) }), 'unknown', 'no id, no question');
});

test('E131 commitMember: one commit per email, each authored by it, on a branch — the checkout untouched', () => {
  const T = product();
  try {
    put(path.join(T, 'README.md'), 'hi');
    git(T, 'add', '-A');
    git(T, 'commit', '-q', '-m', 'init');
    put(path.join(T, 'dirty.txt'), 'mine');   // the person's own work in progress
    const record = { accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }], emails: [M.hashEmail('alice@work.com'), M.hashEmail('a@home.io')].sort(), names: ['Alice Smith'], joined: TODAY };
    const made = M.commitMember(T, { rel: M.memberRel('github', 'alice'), record, plainByHash: new Map([['alice@work.com', 'a@home.io'].map((e) => [M.hashEmail(e), e])].flat()), base: 'HEAD', name: 'Alice Smith', login: 'alice', subject: 'chore(product): add team member alice' });
    assert.equal(made.error, undefined);
    assert.equal(made.branch, 'yad/member/alice');
    assert.equal(made.commits.length, 2);
    const authors = git(T, 'log', '--format=%ae', 'main..yad/member/alice').split('\n').sort();
    assert.deepEqual(authors, ['a@home.io', 'alice@work.com'].sort());
    const final = JSON.parse(git(T, 'show', 'yad/member/alice:.sdlc/members/github-alice.json'));
    assert.deepEqual(final.emails, record.emails);
    assert.equal(final.schemaVersion > 0, true);
    assert.equal(git(T, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'still on the person\'s branch');
    assert.equal(fs.existsSync(path.join(T, M.MEMBERS_DIR)), false, 'nothing written to the checkout');
    assert.match(git(T, 'status', '--porcelain'), /dirty\.txt/, 'their own work is where they left it');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 runMemberAdd: no platform lookups under YAD_PLATFORM_LOGIN=0, and soft from join', async () => {
  const T = product();
  const code = process.exitCode;
  try {
    const r = await M.runMemberAdd(T, { soft: true });
    assert.equal(r, undefined);
    assert.equal(process.exitCode, code, 'soft: a warning, never a failure');
    await M.runMemberAdd(T, {});
    assert.equal(process.exitCode, 1, 'typed by hand it fails and says why');
  } finally { process.exitCode = code; fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 runMemberAdd end to end with fake platforms: writes, commits per email, never pushes with --no-push', async () => {
  const T = product();
  const origin = tmp();
  try {
    put(path.join(T, 'README.md'), 'hi');
    git(T, 'add', '-A');
    git(T, 'commit', '-q', '-m', 'init');
    git(origin, 'init', '-q', '--bare', '-b', 'main');
    git(T, 'remote', 'add', 'origin', origin);
    git(T, 'push', '-q', 'origin', 'main');
    // The checkout moves on to a branch with work of its own: the member branch must not carry it (review 5).
    git(T, 'checkout', '-q', '-b', 'feature');
    put(path.join(T, 'wip.txt'), 'mine');
    git(T, 'add', '-A');
    git(T, 'commit', '-q', '-m', 'unmerged work');
    const runner = (cmd, args, opts) => {
      if (cmd === 'git') {
        const r = (() => { try { return { ok: true, stdout: execFileSync('git', args, { cwd: opts?.cwd, stdio: 'pipe' }).toString().trim() }; } catch { return { ok: false, stdout: '' }; } })();
        return r;
      }
      if (cmd === 'gh' && args[0] === 'auth' && args[1] === 'status') return { ok: true, stdout: '  ✓ Logged in to github.com account alice (keyring)' };
      if (cmd === 'gh' && args[0] === 'auth') return { ok: true, stdout: 'tok' };
      if (cmd === 'gh' && args.includes('user/emails')) return { ok: true, stdout: 'alice@work.com' };
      if (cmd === 'gh') return { ok: true, stdout: '{"login":"alice","id":3}' };
      return { ok: false, stdout: '' };
    };
    const r = await M.runMemberAdd(T, { runner, env: {}, noPush: true, repos: { dirs: [], hosts: [] }, today: TODAY });
    assert.equal(r.changed, true);
    assert.equal(r.pushed, false);
    const file = JSON.parse(git(T, 'show', 'yad/member/alice:.sdlc/members/github-alice.json'));
    assert.deepEqual(file.accounts, [{ platform: 'github', host: 'github.com', login: 'alice', id: 3 }]);
    assert.deepEqual(file.emails, [M.hashEmail('alice@work.com')]);
    assert.equal(JSON.stringify(file).includes('alice@work.com'), false, 'the address itself is never written');
    assert.deepEqual(git(T, 'log', '--format=%s', 'origin/main..yad/member/alice').split('\n'), ['chore(product): add team member alice'], 'built on origin\'s main, not on the checkout');
    // Someone listed Alice's known address in their own file on origin (review 3): it is left out of hers,
    // never a refusal of her whole join — unless it was her only email.
    const code = process.exitCode;
    const other = tmp();
    try {
      git(other, 'clone', '-q', origin, '.');
      put(path.join(other, M.MEMBERS_DIR, 'github-bob.json'), { accounts: [{ platform: 'github', host: 'github.com', login: 'bob', id: 2 }], emails: [M.hashEmail('alice@work.com')] });
      git(other, 'add', '-A');
      execFileSync('git', ['-c', 'user.name=Bob', '-c', 'user.email=bob@x.io', 'commit', '-q', '-m', 'bob'], { cwd: other, stdio: 'pipe' });
      git(other, 'push', '-q', 'origin', 'HEAD:main');
      await M.runMemberAdd(T, { runner, env: {}, noPush: true, repos: { dirs: [], hosts: [] }, today: TODAY });
      assert.equal(process.exitCode, 1, 'her only email is taken: said, with what to do');
      // A file on origin for the login "alice" but another account id: a reused login takes nothing over.
      process.exitCode = code;
      fs.rmSync(path.join(other, M.MEMBERS_DIR, 'github-bob.json'));
      put(path.join(other, M.MEMBERS_DIR, 'github-alice.json'), { accounts: [{ platform: 'github', host: 'github.com', login: 'alice', id: 99 }], emails: [] });
      git(other, 'add', '-A');
      execFileSync('git', ['-c', 'user.name=Old', '-c', 'user.email=old@x.io', 'commit', '-q', '-m', 'old alice'], { cwd: other, stdio: 'pipe' });
      git(other, 'push', '-q', 'origin', 'HEAD:main');
      await M.runMemberAdd(T, { runner, env: {}, noPush: true, repos: { dirs: [], hosts: [] }, today: TODAY });
      assert.equal(process.exitCode, 1, 'id 99 is not account 3');
    } finally { process.exitCode = code; fs.rmSync(other, { recursive: true, force: true }); }
  } finally { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(origin, { recursive: true, force: true }); }
});

test('E131 runMemberRemove: your own freely; anyone else needs --reason', async () => {
  const T = product();
  const code = process.exitCode;
  try {
    member(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }] });
    const runner = (cmd) => (cmd === 'gh' ? { ok: true, stdout: '  ✓ Logged in to github.com account alice (keyring)' } : { ok: true, stdout: 'git@github.com:acme/product.git' });
    await M.runMemberRemove(T, { login: 'bob', runner, env: {} });
    assert.equal(process.exitCode, 1);
    assert.ok(fs.existsSync(path.join(T, M.MEMBERS_DIR, 'github-bob.json')));
    process.exitCode = code;
    const r = await M.runMemberRemove(T, { login: 'bob', reason: 'left the company', runner, env: {} });
    assert.equal(r.removed, true);
    assert.equal(fs.existsSync(path.join(T, M.MEMBERS_DIR, 'github-bob.json')), false);
  } finally { process.exitCode = code; fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- the CI gate ---------------------------------------------------------------------------------
const CHECK = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'skills/yad-checks/templates/checks/member-check.mjs');

// A Product repo on `main`, and a PR branch. `gh` is a fake on PATH: it answers `.author.login` for a commit
// from a table of sha → login the test fills in.
function gateRepo(platform = 'github') {
  const T = product({ platform, gitUrl: platform === 'github' ? 'git@github.com:acme/product.git' : 'git@gitlab.com:acme/product.git' });
  put(path.join(T, 'README.md'), 'hi');
  git(T, 'add', '-A');
  git(T, 'commit', '-q', '-m', 'init');
  git(T, 'checkout', '-q', '-b', 'pr');
  const bin = path.join(T, '.fakebin');
  const table = path.join(T, '.git', 'logins');
  fs.writeFileSync(table, '');
  put(path.join(bin, 'gh'), `#!/bin/sh\nsha=$(echo "$2" | sed 's#.*/commits/##')\ngrep "^$sha " "${table}" | cut -d' ' -f2\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const commitAs = (email, files, msg = 'chore(product): member') => {
    for (const [rel, rec] of Object.entries(files)) {
      if (rec === null) fs.rmSync(path.join(T, rel)); else put(path.join(T, rel), rec);
    }
    git(T, 'add', '-A');
    execFileSync('git', ['-c', `user.email=${email}`, 'commit', '-q', '-m', msg], { cwd: T, stdio: 'pipe' });
    return git(T, 'rev-parse', 'HEAD');
  };
  const attribute = (sha, login) => fs.appendFileSync(table, `${sha} ${login}\n`);
  const check = (env = {}) => {
    const r = spawnSyncNode(CHECK, ['main'], { cwd: T, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env } });
    return { code: r.status, out: r.stdout };
  };
  return { T, commitAs, attribute, check };
}
import { spawnSync as spawnSyncNode0 } from 'node:child_process';
const spawnSyncNode = (file, args, opts) => spawnSyncNode0(process.execPath, [file, ...args], { encoding: 'utf8', ...opts });
const FILE = (login) => `${M.MEMBERS_DIR}/github-${login}.json`;
const IDS = { alice: 1, bob: 2, mallory: 3 };
const rec = (login, emails) => ({ accounts: [{ platform: 'github', host: 'github.com', login, id: IDS[login] }], emails: emails.map(M.hashEmail).sort() });
const as = (login) => ({ PR_AUTHOR: login, PR_AUTHOR_ID: String(IDS[login.toLowerCase()] ?? '') });

test('E131 member-check: no member file changed is a pass', () => {
  const g = gateRepo();
  try {
    g.commitAs('x@y.z', { 'other.txt': 'x' });
    const r = g.check(as('alice'));
    assert.equal(r.code, 0);
    assert.match(r.out, /no member file changed/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E131 member-check: your own file, each email proven by a commit GitHub gives to you', () => {
  const g = gateRepo();
  try {
    const sha = g.commitAs('alice@work.com', { [FILE('alice')]: rec('alice', ['alice@work.com']) });
    g.attribute(sha, 'alice');
    const r = g.check(as('Alice'));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 email\(s\), each proven/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

// #368: the change is read as the merge into the base makes it. A criss-cross history has two merge
// bases; `<base>...HEAD` read from one of them, and a GitLab MR pipeline runs on the branch tip.
function crissCross(g) {
  const sh = (...a) => execFileSync('git', ['-c', 'user.email=dev@work.com', '-c', 'user.name=dev', ...a], { cwd: g.T, stdio: 'pipe' }).toString().trim();
  sh('checkout', '-q', 'main');
  put(path.join(g.T, 'a.txt'), 'a\n');
  sh('add', '-A'); sh('commit', '-q', '-m', 'chore: a');
  const a = sh('rev-parse', 'HEAD');
  sh('checkout', '-q', 'pr');
  put(path.join(g.T, 'b.txt'), 'b\n');
  sh('add', '-A'); sh('commit', '-q', '-m', 'chore: b');
  const b = sh('rev-parse', 'HEAD');
  sh('merge', '-q', '--no-edit', a);          // the branch takes the base's commit…
  sh('checkout', '-q', 'main');
  sh('merge', '-q', '--no-edit', b);          // …and the base takes the branch's: two merge bases
  sh('checkout', '-q', 'pr');
  assert.equal(sh('merge-base', '--all', 'main', 'HEAD').split('\n').length, 2);
}
// git 2.38+ builds the merge (`merge-tree --write-tree`); an older one falls back.
const writeTreeGit = (() => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-mt-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: T });
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: T });
    return spawnSyncNode0('git', ['merge-tree', '--write-tree', 'HEAD', 'HEAD'], { cwd: T }).status === 0;
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
})();
// A git that answers `merge-tree` as one older than 2.38 does (exit 129), and runs everything else.
function olderGit(g) {
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const dir = path.join(g.T, '.oldgit');
  put(path.join(dir, 'git'), `#!/bin/sh\n[ "$1" = merge-tree ] && exit 129\nexec '${real}' "$@"\n`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  return { PATH: `${dir}:${path.join(g.T, '.fakebin')}:${process.env.PATH}` };
}

// This shows the merge-tree path runs with two merge bases (the note); the file it refuses would be listed
// from either merge base too. The test that the old gate passes and this one refuses is review 1's below.
test('#368 member-check: with two merge bases the change is read as the merge makes it', { skip: !writeTreeGit && 'git older than 2.38' }, () => {
  const g = gateRepo();
  try {
    crissCross(g);
    // Bob's file, brought in on Alice's PR: judged (and refused), not missed.
    const sha = g.commitAs('alice@work.com', { [FILE('bob')]: rec('bob', ['bob@work.com']) });
    g.attribute(sha, 'alice');
    const r = g.check(as('alice'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /note \[member-check\]: 'main' and HEAD have 2 merge bases — the change is read as the merge into main makes it/);
    assert.match(r.out, /FAIL \[member-check\]: .*github-bob\.json/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('#368 member-check: a branch that does not merge cleanly fails closed', { skip: !writeTreeGit && 'git older than 2.38' }, () => {
  const g = gateRepo();
  try {
    const sh = (...a) => execFileSync('git', ['-c', 'user.email=dev@work.com', '-c', 'user.name=dev', ...a], { cwd: g.T, stdio: 'pipe' });
    sh('checkout', '-q', 'main'); put(path.join(g.T, 'c.txt'), 'main\n'); sh('add', '-A'); sh('commit', '-q', '-m', 'chore: c');
    sh('checkout', '-q', 'pr'); put(path.join(g.T, 'c.txt'), 'pr\n'); sh('add', '-A'); sh('commit', '-q', '-m', 'chore: c');
    const r = g.check(as('alice'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL \[member-check\]: this branch does not merge cleanly into main, so what it changes there cannot be read — merge main into the branch, resolve the conflicts, then push again$/m);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

// #368 review 1: two changes that each pass, merged into a file neither shows. Alice's file holds a second
// account that is not on the Product's host; the base moves its host and login to Bob's GitHub account, and
// her branch moves only its platform. Merged, the file names Bob's account on the Product — the gate must
// read the file as the merge holds it, not at the branch's HEAD.
function mergedIntoBob(g) {
  const file = (platform, host, login, id) => `{
  "accounts": [
    { "platform": "github", "host": "github.com", "login": "alice", "id": 1 },
    {
      "platform": "${platform}",


      "host": "${host}",
      "login": "${login}",
      "id": ${id}
    }
  ],
  "emails": []
}
`;
  const sh = (...a) => execFileSync('git', ['-c', 'user.email=dev@work.com', '-c', 'user.name=dev', ...a], { cwd: g.T, stdio: 'pipe' });
  sh('checkout', '-q', 'main');
  put(path.join(g.T, FILE('alice')), file('gitlab', 'ghe.example', 'nobody', 9));
  sh('add', '-A'); sh('commit', '-q', '-m', 'chore(product): alice joined');
  sh('checkout', '-q', 'pr'); sh('reset', '-q', '--hard', 'main');
  sh('checkout', '-q', 'main');
  put(path.join(g.T, FILE('alice')), file('gitlab', 'github.com', 'bob', 2));
  sh('commit', '-q', '-am', 'chore(product): alice edits her other account');
  sh('checkout', '-q', 'pr');
  const sha = g.commitAs('alice@work.com', { [FILE('alice')]: file('github', 'ghe.example', 'nobody', 9) });
  g.attribute(sha, 'alice');
}

test('#368 review 1: a file both sides changed is judged as the merge holds it', { skip: !writeTreeGit && 'git older than 2.38' }, () => {
  const g = gateRepo();
  try {
    mergedIntoBob(g);
    const r = g.check(as('alice'));
    assert.equal(r.code, 1, `the merge puts Bob's GitHub account in Alice's file: ${r.out}`);
    assert.match(r.out, /FAIL \[member-check\]: .*github-alice\.json/);
    assert.doesNotMatch(r.out, /PASS \[member-check\]/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('#368 review 1: on a git older than 2.38, a member file both sides changed fails closed', () => {
  const g = gateRepo();
  try {
    mergedIntoBob(g);
    const r = g.check({ ...as('alice'), ...olderGit(g) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL \[member-check\]: main has moved on since this branch split off, and this git \(older than 2\.38\) cannot read the member files this branch changes as the merge would hold them — merge main into the branch, then push again$/m);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('#368 review 2: on a git older than 2.38, member files changed while the base moved on fail closed — a rename in, a file the base added', () => {
  const MOVED = /^FAIL \[member-check\]: main has moved on since this branch split off, and this git \(older than 2\.38\) cannot read the member files this branch changes as the merge would hold them — merge main into the branch, then push again$/m;
  const sh = (g, ...a) => execFileSync('git', ['-c', 'user.email=dev@work.com', '-c', 'user.name=dev', ...a], { cwd: g.T, stdio: 'pipe' });
  // The branch renames a file into the folder; the base then edits it at its old path, and a real merge
  // follows the rename — the merged member file holds the base's edit, which HEAD does not show.
  let g = gateRepo();
  try {
    sh(g, 'checkout', '-q', 'main');
    put(path.join(g.T, 'notes/x.json'), JSON.stringify(rec('alice', ['alice@work.com']), null, 2));
    sh(g, 'add', '-A'); sh(g, 'commit', '-q', '-m', 'chore: notes');
    sh(g, 'checkout', '-q', 'pr'); sh(g, 'reset', '-q', '--hard', 'main');
    fs.mkdirSync(path.dirname(path.join(g.T, FILE('alice'))), { recursive: true });
    sh(g, 'mv', 'notes/x.json', FILE('alice'));
    execFileSync('git', ['-c', 'user.email=alice@work.com', 'commit', '-q', '-m', 'chore(product): member'], { cwd: g.T, stdio: 'pipe' });
    g.attribute(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: g.T }).toString().trim(), 'alice');
    sh(g, 'checkout', '-q', 'main');
    put(path.join(g.T, 'notes/x.json'), JSON.stringify(rec('alice', ['alice@work.com', 'eve@else.com']), null, 2));
    sh(g, 'commit', '-q', '-am', 'chore: notes edited'); sh(g, 'checkout', '-q', 'pr');
    assert.match(g.check({ ...as('alice'), ...olderGit(g) }).out, MOVED);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
  // The base adds Bob's file with an email this branch's own file also holds: the clash check must see it.
  g = gateRepo();
  try {
    sh(g, 'checkout', '-q', 'main');
    put(path.join(g.T, FILE('bob')), JSON.stringify(rec('bob', ['shared@work.com'])));
    sh(g, 'add', '-A'); sh(g, 'commit', '-q', '-m', 'chore(product): bob joined'); sh(g, 'checkout', '-q', 'pr');
    const sha = g.commitAs('shared@work.com', { [FILE('alice')]: rec('alice', ['shared@work.com']) });
    g.attribute(sha, 'alice');
    assert.match(g.check({ ...as('alice'), ...olderGit(g) }).out, MOVED);
    if (writeTreeGit) assert.match(g.check(as('alice')).out, /FAIL \[member-check\]: one email is in/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('#368 review 3: on a git older than 2.38, a folder the base moved into the members folder, with a file the branch adds there, fails closed', () => {
  const g = gateRepo();
  try {
    const sh = (...a) => execFileSync('git', ['-c', 'user.email=dev@work.com', '-c', 'user.name=dev', ...a], { cwd: g.T, stdio: 'pipe' });
    sh('checkout', '-q', 'main');
    put(path.join(g.T, 'foo/github-carol.json'), JSON.stringify(rec('alice', [])));
    sh('add', '-A'); sh('commit', '-q', '-m', 'chore: foo');
    sh('checkout', '-q', 'pr'); sh('reset', '-q', '--hard', 'main');
    put(path.join(g.T, 'foo/github-mallory.json'), JSON.stringify(rec('mallory', [])));
    sh('add', '-A'); sh('commit', '-q', '-m', 'chore: a note');
    sh('checkout', '-q', 'main');
    fs.mkdirSync(path.join(g.T, '.sdlc/members'), { recursive: true });
    sh('mv', 'foo/github-carol.json', '.sdlc/members/github-carol.json');
    sh('commit', '-q', '-m', 'chore: foo moved'); sh('checkout', '-q', 'pr');
    const r = g.check({ ...as('alice'), ...olderGit(g) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL \[member-check\]: main moved files into the members folder from a folder this branch adds a file to, and this git \(older than 2\.38\) cannot tell where the merge puts it — merge main into the branch, then push again$/m);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('#368 member-check: a git older than 2.38 falls back to the one merge base, and fails closed on two', () => {
  const g = gateRepo();
  try {
    const old = olderGit(g);
    // One merge base: read as before.
    const sha = g.commitAs('alice@work.com', { [FILE('alice')]: rec('alice', ['alice@work.com']) });
    g.attribute(sha, 'alice');
    let r = g.check({ ...as('alice'), ...old });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 email\(s\), each proven/);
    // Two: this git cannot build the merge.
    crissCross(g);
    r = g.check({ ...as('alice'), ...old });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^FAIL \[member-check\]: 'main' and HEAD have 2 merge bases, and this git \(older than 2\.38\) cannot build the merge into main — merge main into the branch, then push again$/m);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E131 member-check: an email no commit proves is refused (the forgery case)', () => {
  const g = gateRepo();
  try {
    // Alice adds Bob's email to her file. The commit is authored by Bob's email, but GitHub gives it to Bob.
    const sha = g.commitAs('bob@work.com', { [FILE('alice')]: rec('alice', ['bob@work.com']) });
    g.attribute(sha, 'bob');
    const r = g.check(as('alice'));
    assert.equal(r.code, 1);
    assert.match(r.out, /holds an email no commit in this PR proves/);
    // And a commit GitHub cannot attribute at all proves nothing either.
    const g2 = gateRepo();
    try {
      g2.commitAs('alice@work.com', { [FILE('alice')]: rec('alice', ['alice@work.com']) });
      assert.equal(g2.check(as('alice')).code, 1);
    } finally { fs.rmSync(g2.T, { recursive: true, force: true }); }
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E131 member-check: someone else\'s file is refused; a deletion is allowed; a bot is refused', () => {
  const g = gateRepo();
  try {
    git(g.T, 'checkout', '-q', 'main');
    put(path.join(g.T, FILE('bob')), rec('bob', []));
    git(g.T, 'add', '-A');
    git(g.T, 'commit', '-q', '-m', 'bob joined');
    git(g.T, 'checkout', '-q', 'pr');
    git(g.T, 'rebase', '-q', 'main');
    g.commitAs('alice@work.com', { [FILE('bob')]: rec('bob', ['alice@work.com']) });
    let r = g.check(as('alice'));
    assert.equal(r.code, 1);
    assert.match(r.out, /only its author's own member file/);
    // A reused login: the file was account 2's; someone else now called bob (id 9) cannot take it over.
    git(g.T, 'reset', '-q', '--hard', 'main');
    const shaB = g.commitAs('bob@new.io', { [FILE('bob')]: { accounts: [{ platform: 'github', host: 'github.com', login: 'bob', id: 9 }], emails: [M.hashEmail('bob@new.io')] } });
    g.attribute(shaB, 'bob');
    r = g.check({ PR_AUTHOR: 'bob', PR_AUTHOR_ID: '9' });
    assert.equal(r.code, 1);
    assert.match(r.out, /belonged to account id 2, not bob's \(9\), and a reused login does not take over a member file — remove the old file first with yad member remove bob --reason "<why>", in a pull request of its own\n/);
    assert.match(g.check({ PR_AUTHOR: 'bob', PR_AUTHOR_ID: '2' }).out, /account id in the file \(9\) is not the author's \(2\)/);
    git(g.T, 'reset', '-q', '--hard', 'main');
    g.commitAs('alice@work.com', { [FILE('bob')]: null }, 'chore(product): remove team member bob');
    r = g.check(as('alice'));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /removed/);
    assert.equal(g.check({ PR_AUTHOR: 'dependabot[bot]' }).code, 1, 'a bot opened it: refused');
    assert.equal(g.check({}).code, 1, 'no author known: refused');
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E131 member-check: someone\'s Product account in another file is refused; two claims on an OTHER account are not', () => {
  const g = gateRepo();
  try {
    git(g.T, 'checkout', '-q', 'main');
    put(path.join(g.T, FILE('bob')), { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }, { platform: 'gitlab', host: 'gitlab.com', login: 'al' }] });
    git(g.T, 'add', '-A');
    git(g.T, 'commit', '-q', '-m', 'bob');
    git(g.T, 'checkout', '-q', 'pr');
    git(g.T, 'rebase', '-q', 'main');
    // Bob claimed Alice's GitLab account first. Alice's own claim must not be blocked by it.
    const sha = g.commitAs('alice@work.com', { [FILE('alice')]: { accounts: [{ platform: 'github', host: 'github.com', login: 'alice', id: 1 }, { platform: 'gitlab', host: 'gitlab.com', login: 'AL' }], emails: [M.hashEmail('alice@work.com')] } });
    g.attribute(sha, 'alice');
    let r = g.check(as('alice'));
    assert.equal(r.code, 0, r.out);
    // But naming Bob's own GitHub account in Alice's file is refused: one account on the Product's host.
    const sha2 = g.commitAs('alice@work.com', { [FILE('alice')]: { accounts: [{ platform: 'github', host: 'github.com', login: 'alice', id: 1 }, { platform: 'github', host: 'github.com', login: 'Bob' }], emails: [M.hashEmail('alice@work.com')] } });
    g.attribute(sha2, 'alice');
    r = g.check(as('alice'));
    assert.equal(r.code, 1);
    assert.match(r.out, /exactly one github account on github\.com/);
    // And Bob's own PR is never blocked by an other-account claim Alice made on his GitHub Enterprise login.
    git(g.T, 'reset', '-q', '--hard', 'main');
    const sha3 = g.commitAs('alice@work.com', { [FILE('alice')]: { accounts: [{ platform: 'github', host: 'github.com', login: 'alice', id: 1 }, { platform: 'github', host: 'ghe.io', login: 'bob' }], emails: [M.hashEmail('alice@work.com')] } });
    g.attribute(sha3, 'alice');
    assert.equal(g.check(as('alice')).code, 0);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E131 member-check: a linked members folder, a link inside it, and a case twin are refused (review 1–2)', () => {
  const link = gateRepo();
  try {
    // The attack from the review: delete nothing, put the file elsewhere, link the folder to it.
    put(path.join(link.T, 'other', 'github-mallory.json'), rec('mallory', ['victim@x.io']));
    fs.mkdirSync(path.join(link.T, '.sdlc'), { recursive: true });
    fs.symlinkSync('../other', path.join(link.T, M.MEMBERS_DIR));
    git(link.T, 'add', '-A');
    git(link.T, 'commit', '-q', '-m', 'link');
    const r = link.check(as('mallory'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\.sdlc\/members is not a folder in this change/);
  } finally { fs.rmSync(link.T, { recursive: true, force: true }); }
  const inner = gateRepo();
  try {
    put(path.join(inner.T, 'elsewhere.json'), rec('mallory', ['victim@x.io']));
    fs.mkdirSync(path.join(inner.T, M.MEMBERS_DIR), { recursive: true });
    fs.symlinkSync('../../elsewhere.json', path.join(inner.T, M.MEMBERS_DIR, 'github-mallory.json'));
    git(inner.T, 'add', '-A');
    git(inner.T, 'commit', '-q', '-m', 'inner link');
    assert.match(inner.check(as('mallory')).out, /not a plain file/);
  } finally { fs.rmSync(inner.T, { recursive: true, force: true }); }
  const twin = gateRepo();
  try {
    twin.commitAs('m@x.io', { '.sdlc/Members/github-mallory.json': rec('mallory', ['victim@x.io']) });
    const r = twin.check(as('mallory'));
    assert.equal(r.code, 1);
    assert.match(r.out, /another spelling of \.sdlc\/members/);
    // Merged anyway (an older gate): the PR that DELETES it must pass — it is the clean-up (review 2).
    git(twin.T, 'branch', '-f', 'main', 'HEAD');
    twin.commitAs('m@x.io', { '.sdlc/Members/github-mallory.json': null }, 'chore(product): remove a twin');
    const clean = twin.check(as('mallory'));
    assert.equal(clean.code, 0, clean.out);
  } finally { fs.rmSync(twin.T, { recursive: true, force: true }); }
});

test('E131 member-check: on GitLab with no API token a member change FAILS closed', () => {
  const g = gateRepo('gitlab');
  try {
    g.commitAs('alice@work.com', { [`${M.MEMBERS_DIR}/gitlab-alice.json`]: { accounts: [{ platform: 'gitlab', host: 'gitlab.com', login: 'alice' }] } });
    const r = g.check({ CI_API_V4_URL: 'http://127.0.0.1:9/api/v4', CI_PROJECT_ID: '1', CI_MERGE_REQUEST_IID: '2', GITLAB_TOKEN: '', SDLC_API_TOKEN: '' });
    assert.equal(r.code, 1);
    assert.match(r.out, /no API token .* — .*; add a GITLAB_TOKEN masked CI\/CD variable with the read_api scope, whose user can see the project\n/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

// Every failure says what is wrong AND what to change (#381): `FAIL [member-check]: <wrong> — <change>`.
test('E131 member-check: each failure says what to change (#381)', () => {
  // The fix of the first FAIL line; every FAIL line has exactly one ' — ' between what is wrong and the fix.
  const fixOf = (out) => {
    for (const x of out.split('\n').filter((y) => y.startsWith('FAIL [member-check]: '))) assert.equal(x.split(' — ').length, 2, `one ' — ' in: ${x}`);
    const l = out.split('\n').find((x) => x.startsWith('FAIL [member-check]: '));
    return l ? l.slice(l.indexOf(' — ') + 3) : null;
  };
  // Its own file, new in this PR: dropped from another PR; one the base holds is restored, never deleted (review 6).
  const AGAIN = /^write the file again with yad member add, run by its own person \(it opens its own pull request\); if this is another pull request, drop \.sdlc\/members\/github-alice\.json from this pull request \(git rm it on this branch\)$/;
  // The copy the diff starts from (#368): the base itself where git builds the merge, the merge base on an older git.
  const AGAIN_BASE = new RegExp(`^write the file again with yad member add, run by its own person \\(it opens its own pull request\\); if this is another pull request, restore \\.sdlc/members/github-alice\\.json to the base's copy \\(git checkout ${writeTreeGit ? 'main' : 'main\\.\\.\\.HEAD'} -- \\.sdlc/members/github-alice\\.json\\)$`);
  const g = gateRepo();
  try {
    g.commitAs('alice@work.com', { [FILE('alice')]: { accounts: [{ platform: 'github', host: 'github.com', login: 'alice', id: 1 }] } });
    // The job passed no author, and a bot opened it: two causes, two fixes.
    assert.match(fixOf(g.check({ PR_AUTHOR: '', PR_AUTHOR_ID: '' }).out), /^the job must pass PR_AUTHOR and PR_AUTHOR_ID from the pull_request event \(github\.event\.pull_request\.user\.login and \.id\), as yad-product-checks\.yml does$/);
    const bot = g.check({ PR_AUTHOR: 'dependabot[bot]' }).out;
    assert.match(bot, /cannot tell who opened this PR \(dependabot\[bot\] is a bot\) — /);
    assert.match(fixOf(bot), /^a member file is changed only by its own person: open the PR as that person$/);
    assert.match(fixOf(g.check({ PR_AUTHOR: 'alice', PR_AUTHOR_ID: '' }).out), /^the job must pass PR_AUTHOR_ID from the pull_request event \(github\.event\.pull_request\.user\.id\), as yad-product-checks\.yml does$/);
    assert.match(fixOf(g.check({ PR_AUTHOR: 'alice', PR_AUTHOR_ID: '7' }).out), AGAIN, 'the account id is not the author\'s');
    for (const [bad, says] of [
      [{}, /not a member file \(no "accounts" list\) — /],
      [{ accounts: [] }, /must hold exactly one github account on github\.com, the author's own \(it holds 0\) — /],
      [{ accounts: [{ platform: 'github', host: 'github.com', login: 'bob', id: 1 }] }, /does not hold alice's own github account on github\.com — /],
    ]) {
      git(g.T, 'reset', '-q', '--hard', 'main');
      g.commitAs('alice@work.com', { [FILE('alice')]: bad });
      const out = g.check(as('alice')).out;
      assert.match(out, says, out);
      assert.match(fixOf(out), AGAIN, JSON.stringify(bad));
    }
    git(g.T, 'reset', '-q', '--hard', 'main');
    g.commitAs('alice@work.com', { '.sdlc/members/notes.txt': 'x' });
    assert.match(fixOf(g.check(as('alice')).out), /^move it to \.sdlc\/members\/github-<login>\.json, or remove it$/);
    // A file that is not the author's own: misnamed, or someone else's — new in this PR, or a teammate's the
    // base holds, which is restored, never deleted (review 6: git rm would remove them and pass).
    const OWN = (undo) => `${undo}, and change only github-alice.json, which yad member add writes. To remove someone else, use yad member remove <login> --reason "<why>" in a pull request of its own`;
    for (const file of [`${M.MEMBERS_DIR}/alice.json`, FILE('bob')]) {
      git(g.T, 'reset', '-q', '--hard', 'main');
      g.commitAs('alice@work.com', { [file]: rec('alice', []) });
      const out = g.check(as('alice')).out;
      assert.ok(out.includes(`${file}: a PR may add or change only its author's own member file (github-alice.json) — `), out);
      assert.equal(fixOf(out), OWN(`drop ${file} from this pull request (git rm it on this branch)`));
    }
    const mainBefore = git(g.T, 'rev-parse', 'main');
    git(g.T, 'checkout', '-q', 'main');
    put(path.join(g.T, FILE('bob')), rec('bob', []));
    put(path.join(g.T, FILE('alice')), rec('alice', []));
    git(g.T, 'add', '-A');
    git(g.T, 'commit', '-q', '-m', 'bob and alice joined');
    git(g.T, 'checkout', '-q', 'pr');
    git(g.T, 'reset', '-q', '--hard', 'main');
    g.commitAs('alice@work.com', { [FILE('bob')]: { ...rec('bob', []), names: ['B'] } });
    // Bob changes his own file on main after this branch split off: the restore is the split point's copy,
    // and following it passes (review 7: the base's tip would leave the file changed).
    git(g.T, 'checkout', '-q', 'main');
    put(path.join(g.T, FILE('bob')), { ...rec('bob', []), names: ['Bob B'] });
    git(g.T, 'commit', '-q', '-am', 'bob renamed himself');
    git(g.T, 'checkout', '-q', 'pr');
    // Both sides changed bob's file (#368): git 2.38+ builds the merge, which conflicts, so the gate fails
    // closed as the platform would; an older git cannot read the file as the merge would hold it, and fails
    // closed too. Undoing the branch's edit (the split point's copy) is what clears both.
    if (writeTreeGit) assert.equal(fixOf(g.check(as('alice')).out), 'merge main into the branch, resolve the conflicts, then push again');
    const old = olderGit(g);
    assert.equal(fixOf(g.check({ ...as('alice'), ...old }).out), 'merge main into the branch, then push again');
    git(g.T, 'checkout', 'main...HEAD', '--', FILE('bob'));
    git(g.T, 'commit', '-q', '-m', 'undo the edit to bob');
    assert.match(g.check(as('alice')).out, /PASS \[member-check\]: no member file changed/);
    assert.match(g.check({ ...as('alice'), ...old }).out, /PASS \[member-check\]: no member file changed/);
    // A link put over a teammate's file is undone, not deleted: git rm would remove bob, and pass (review 7).
    git(g.T, 'reset', '-q', '--hard', 'HEAD~2');
    fs.rmSync(path.join(g.T, FILE('bob')));
    fs.symlinkSync('../../README.md', path.join(g.T, FILE('bob')));
    git(g.T, 'add', '-A');
    git(g.T, 'commit', '-q', '-m', 'bob, linked');
    // Both sides changed bob's file here too (the base renamed him, the branch linked it): closed on both paths.
    const linked = g.check({ ...as('alice'), ...old }).out;
    assert.equal(fixOf(linked), 'merge main into the branch, then push again', linked);
    if (writeTreeGit) assert.equal(g.check(as('alice')).code, 1);
    git(g.T, 'checkout', 'main...HEAD', '--', FILE('bob'));
    git(g.T, 'commit', '-q', '-m', 'undo the link');
    assert.match(g.check(as('alice')).out, /PASS \[member-check\]: no member file changed/);
    // Her own file the base holds, edited wrong: restored in another PR.
    git(g.T, 'reset', '-q', '--hard', 'main');
    g.commitAs('alice@work.com', { [FILE('alice')]: {} });
    assert.match(fixOf(g.check(as('alice')).out), AGAIN_BASE);
    git(g.T, 'branch', '-f', 'main', mainBefore);
    git(g.T, 'reset', '-q', '--hard', 'main');
    // Two spellings of one file: which to keep, and how to take the other out (review 4). Written into git's
    // index, not the disk: a Mac's disk holds only one of them.
    const mainWas = git(g.T, 'rev-parse', 'main');
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: g.T, input: '{}' }).toString().trim();
    const twinsOf = (onMain, inPr) => {
      git(g.T, 'branch', '-f', 'main', mainWas);
      git(g.T, 'reset', '-q', '--hard', 'main');
      for (const [names, branch] of [[onMain, 'main'], [inPr, 'pr']]) {
        if (branch === 'main') git(g.T, 'checkout', '-q', 'main');
        for (const f of names) {
          const [name, mode] = Array.isArray(f) ? f : [f, '100644'];
          git(g.T, 'update-index', '--add', '--cacheinfo', `${mode},${blob},${M.MEMBERS_DIR}/${name}`);
        }
        git(g.T, 'commit', '-q', '--allow-empty', '-m', `twins on ${branch}`);
        if (branch === 'main') { git(g.T, 'checkout', '-q', '-f', 'pr'); git(g.T, 'reset', '-q', '--hard', 'main'); }
      }
      const out = g.check(as('alice')).out;
      fixOf(out);
      const lines = out.split('\n').filter((l) => l.includes('are one file on macOS and Windows — '));
      assert.equal(lines.length, 1, `one message per group of names:\n${out}`);
      return lines[0].slice(lines[0].indexOf(' — ') + 3);
    };
    const D = M.MEMBERS_DIR;
    const RM = '(any pull request may delete a member file)';
    // Both new in this PR: keep the lower-case name, drop the other.
    assert.equal(twinsOf([], ['github-alice.json', 'github-ALICE.json']), `keep ${D}/github-alice.json: drop ${D}/github-ALICE.json from this pull request (git rm it on this branch)`);
    // The base holds one: keep the base's copy and drop the new one — unless the new one is its person's own
    // yad member add file, which may keep it and git rm the base's copy instead (review 5).
    assert.equal(twinsOf(['github-Alice.json'], ['github-alice.json']), `keep ${D}/github-Alice.json: drop ${D}/github-alice.json from this pull request (git rm it on this branch); or, if ${D}/github-alice.json is your own file as yad member add writes it, keep it and git rm ${D}/github-Alice.json ${RM}`);
    // Both on the base, neither in lower case: keep one, git rm the other. No rename: that clears it.
    assert.equal(twinsOf(['GitHub-Alice.json', 'github-ALICE.json'], []), `keep ${D}/GitHub-Alice.json: git rm ${D}/github-ALICE.json ${RM}`);
    // Three names of one file: ONE kept for the group, the rest taken out (review 5).
    assert.equal(twinsOf(['github-AB.json', 'github-Ab.json', 'github-ab.json'], []), `keep ${D}/github-ab.json: git rm ${D}/github-AB.json ${D}/github-Ab.json ${RM}`);
    // A link the base holds is not kept: the gate refuses it in the same run (review 6).
    assert.equal(twinsOf([['github-Alice.json', '120000']], ['github-alice.json']), `keep ${D}/github-alice.json: git rm ${D}/github-Alice.json ${RM}`);
    // A plain file is kept over a link; a non-ASCII name is quoted, so the command pastes whole.
    assert.equal(twinsOf([], [['github-alice.json', '120000'], 'github-ALICE.json']), `keep ${D}/github-ALICE.json: drop ${D}/github-alice.json from this pull request (git rm it on this branch)`);
    assert.equal(twinsOf(['github-\uff53am.json', 'github-sam.json'], []), `keep ${D}/github-sam.json: git rm '${D}/github-\uff53am.json' ${RM}`);
    git(g.T, 'branch', '-f', 'main', mainWas);
    git(g.T, 'reset', '-q', '--hard', 'main');
    // An email no commit GitHub gives to the author proves.
    git(g.T, 'reset', '-q', '--hard', 'main');
    g.commitAs('alice@work.com', { [FILE('alice')]: rec('alice', ['alice@work.com']) });
    const unproven = g.check(as('alice')).out;
    assert.match(unproven, /holds an email no commit in this PR proves \(a commit authored by that email that GitHub attributes to alice\) — /, unproven);
    assert.equal(fixOf(unproven), "verify the email on alice's account, then run yad member add, which writes one such commit per email");
    // The job passed no base.
    assert.equal(fixOf(spawnSyncNode(CHECK, [], { cwd: g.T }).stdout), 'the job must pass the base ref (the branch the PR targets), as yad-product-checks.yml (GitHub) and yad-product-checks.gitlab-ci.yml (GitLab) do');
    // Another spelling of either folder. Written into git's index, not the disk: a Mac's disk would put
    // `.SDLC/x.json` in the real `.sdlc/`.
    for (const [file, dir] of [['.sdlc/Members/github-alice.json', '.sdlc/members/'], ['.SDLC/x.json', '.sdlc/']]) {
      git(g.T, 'reset', '-q', '--hard', 'main');
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: g.T, input: 'x' }).toString().trim();
      git(g.T, 'update-index', '--add', '--cacheinfo', `100644,${blob},${file}`);
      git(g.T, 'commit', '-q', '-m', 'twin');
      const out = g.check(as('alice')).out;
      assert.ok(out.includes(`another spelling of ${dir}, which`), out);
      assert.equal(fixOf(out), `move it into the real ${dir} folder (git mv), or delete it`);
    }
    // The Product names no platform: the fix names the file the gate read, or says there is none.
    for (const [files, fix] of [
      [{ '.sdlc/product.json': { git_url: 'git@github.com:acme/product.git' } }, 'set "platform" ("github" or "gitlab") in .sdlc/product.json'],
      [{ '.sdlc/product.json': '{' }, '.sdlc/product.json is not valid JSON or not an object: fix it, and set "platform" ("github" or "gitlab") in it'],
      [{ '.sdlc/product.json': '[]' }, '.sdlc/product.json is not valid JSON or not an object: fix it, and set "platform" ("github" or "gitlab") in it'],
      [{ '.sdlc/product.json': null, '.sdlc/hub.json': { git_url: 'x' } }, 'set "platform" ("github" or "gitlab") in .sdlc/hub.json'],
      [{ '.sdlc/product.json': null }, 'there is no .sdlc/product.json: run yad setup in the Product, or write the file with "platform" ("github" or "gitlab")'],
    ]) {
      git(g.T, 'reset', '-q', '--hard', 'main');
      g.commitAs('alice@work.com', { ...files, [FILE('alice')]: rec('alice', []) });
      const out = g.check(as('alice')).out;
      assert.match(out, /member files changed, but the Product names no platform, so nothing can be proven — /, out);
      assert.equal(fixOf(out), fix);
    }
    // One account, and one email, in two files: a stale file on the base.
    git(g.T, 'checkout', '-q', 'main');
    put(path.join(g.T, M.MEMBERS_DIR, 'alice.json'), rec('alice', []));
    put(path.join(g.T, FILE('bob')), rec('bob', ['alice@work.com']));
    git(g.T, 'add', '-A');
    git(g.T, 'commit', '-q', '-m', 'stale files');
    git(g.T, 'checkout', '-q', 'pr');
    git(g.T, 'reset', '-q', '--hard', 'main');
    const sha = g.commitAs('alice@work.com', { [FILE('alice')]: rec('alice', ['alice@work.com']) });
    g.attribute(sha, 'alice');
    const dup = g.check(as('alice')).out.split('\n');
    // The clash is with a file named other than github-<login>.json, which yad member remove cannot reach.
    assert.equal(fixOf(dup.find((l) => l.includes('the account github:github.com:alice is in'))), 'git rm .sdlc/members/alice.json (any pull request may delete a member file). Only github-<login>.json files are member files', dup.join('\n'));
    assert.equal(fixOf(dup.find((l) => l.includes('one email is in'))), 'remove it from the file it does not belong in (that file\'s own person runs yad member add again, which keeps only the emails their account has verified), or remove a stale file with yad member remove <login> --reason "<why>"');
    // The misnamed file is this PR's own: both lines say to drop it from this PR, never a PR of its own.
    git(g.T, 'checkout', '-q', 'main');
    git(g.T, 'rm', '-q', `${M.MEMBERS_DIR}/alice.json`);
    put(path.join(g.T, FILE('alice')), rec('alice', []));
    git(g.T, 'add', '-A');
    git(g.T, 'commit', '-q', '-m', 'alice, well named');
    git(g.T, 'checkout', '-q', 'pr');
    git(g.T, 'reset', '-q', '--hard', 'main');
    g.commitAs('alice@work.com', { [`${M.MEMBERS_DIR}/alice.json`]: rec('alice', []) });
    const added = g.check(as('alice')).out.split('\n');
    assert.match(fixOf(added.join('\n')), /^drop \.sdlc\/members\/alice\.json from this pull request \(git rm it on this branch\), and change only /, added.join('\n'));
    assert.equal(fixOf(added.find((l) => l.includes('the account github:github.com:alice is in'))), 'drop .sdlc/members/alice.json from this pull request (git rm it on this branch). Only github-<login>.json files are member files', added.join('\n'));
    // A misnamed file the base holds that this PR only edits: dropping the edit leaves it, so git rm (review 4).
    git(g.T, 'checkout', '-q', 'main');
    put(path.join(g.T, M.MEMBERS_DIR, 'alice.json'), rec('alice', []));
    git(g.T, 'add', '-A');
    git(g.T, 'commit', '-q', '-m', 'alice, also misnamed');
    git(g.T, 'checkout', '-q', 'pr');
    git(g.T, 'reset', '-q', '--hard', 'main');
    g.commitAs('alice@work.com', { [`${M.MEMBERS_DIR}/alice.json`]: { ...rec('alice', []), names: ['A'] } });
    const edited = g.check(as('alice')).out.split('\n');
    assert.equal(fixOf(edited.find((l) => l.includes('the account github:github.com:alice is in'))), 'git rm .sdlc/members/alice.json (any pull request may delete a member file). Only github-<login>.json files are member files', edited.join('\n'));
    // A misnamed file this PR adds with an email another file holds: the email message says drop it too.
    git(g.T, 'reset', '-q', '--hard', 'main');
    g.commitAs('alice@work.com', { [`${M.MEMBERS_DIR}/carol x.json`]: rec('carol', ['alice@work.com']) });
    const carol = g.check(as('alice')).out.split('\n');
    assert.equal(fixOf(carol.find((l) => l.includes('one email is in'))), "drop '.sdlc/members/carol x.json' from this pull request (git rm it on this branch). Only github-<login>.json files are member files", carol.join('\n'));
    // A base that shares no history: git cannot list the changes.
    git(g.T, 'checkout', '-q', '--orphan', 'alone');
    git(g.T, 'commit', '-q', '-m', 'unrelated');
    git(g.T, 'branch', '-f', 'main', 'HEAD');
    git(g.T, 'checkout', '-q', 'pr');
    assert.match(fixOf(g.check(as('alice')).out), /^check the code out with full history \(GitHub: actions\/checkout with fetch-depth: 0; GitLab: GIT_DEPTH: "0"\), and give a base this branch shares history with, then run again$/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
  // A link where a folder or a file goes.
  const link = gateRepo();
  try {
    fs.mkdirSync(path.join(link.T, '.sdlc'), { recursive: true });
    fs.symlinkSync('../other', path.join(link.T, M.MEMBERS_DIR));
    git(link.T, 'add', '-A');
    git(link.T, 'commit', '-q', '-m', 'link');
    const linked = link.check(as('alice')).out;
    assert.match(fixOf(linked), /^replace it with a real folder that holds the files themselves$/);
    assert.doesNotMatch(linked, /another spelling/, 'a link where the folder goes is not a second spelling of it');
    fs.rmSync(path.join(link.T, M.MEMBERS_DIR));
    fs.mkdirSync(path.join(link.T, M.MEMBERS_DIR));
    fs.symlinkSync('../../README.md', path.join(link.T, FILE('alice')));
    git(link.T, 'add', '-A');
    git(link.T, 'commit', '-q', '-m', 'file link');
    assert.match(fixOf(link.check(as('alice')).out), /^replace it with the file itself \(yad member add writes it\), or drop \.sdlc\/members\/github-alice\.json from this pull request \(git rm it on this branch\)$/);
  } finally { fs.rmSync(link.T, { recursive: true, force: true }); }
});

// On GitLab the MR is read from the API: each answer says what to change, as pr-template does (#381). The
// gate runs async here, so this process can answer as GitLab.
test('E131 member-check: on GitLab each API answer says what to change (#381)', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  let answer = { status: 200, body: {} };
  const server = http.createServer((req, res) => { res.writeHead(answer.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer.body)); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const api = `http://127.0.0.1:${server.address().port}/api/v4`;
  const g = gateRepo('gitlab');
  const run = (env) => new Promise((ok) => {
    const c = spawn(process.execPath, [CHECK, 'main'], { cwd: g.T, env: { ...process.env, GITLAB_TOKEN: '', SDLC_API_TOKEN: '', ...env } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', (code) => ok({ code, out }));
  });
  const MR = { CI_API_V4_URL: api, CI_PROJECT_ID: '1', CI_MERGE_REQUEST_IID: '2' };
  try {
    g.commitAs('alice@work.com', { [`${M.MEMBERS_DIR}/gitlab-alice.json`]: { accounts: [{ platform: 'gitlab', host: 'gitlab.com', login: 'alice', id: 1 }] } });
    for (const [status, token, fix] of [
      [401, 'GITLAB_TOKEN', 'GITLAB_TOKEN was not accepted (expired, revoked, or not a valid token here) — renew or replace it'],
      [403, 'SDLC_API_TOKEN', 'SDLC_API_TOKEN was refused — give it the read_api scope'],
      [404, 'GITLAB_TOKEN', "GITLAB_TOKEN's user cannot see this project — use a token of a project member with Reporter access or more"],
      [502, 'GITLAB_TOKEN', 'GitLab did not answer with the MR — run the job again later'],
    ]) {
      answer = { status, body: {} };
      const r = await run({ ...MR, [token]: 't' });
      assert.equal(r.code, 1, r.out);
      assert.ok(r.out.includes(`FAIL [member-check]: could not read the MR (HTTP ${status}): ${fix}\n`), r.out);
      for (const l of r.out.split('\n').filter((x) => x.startsWith('FAIL '))) assert.equal(l.split(' — ').length, 2, `one ' — ' in: ${l}`);
    }
    // The API named no author; the job ran outside a merge request pipeline; the API cannot be reached.
    // The API named the author but no numeric id.
    answer = { status: 200, body: { author: { username: 'alice' } } };
    assert.match((await run({ ...MR, GITLAB_TOKEN: 't' })).out, /gitlab-alice\.json: cannot tell the numeric id of who opened this MR — the merge request API gave no author id; run the job again\n/);
    answer = { status: 200, body: { author: null } };
    assert.match((await run({ ...MR, GITLAB_TOKEN: 't' })).out, /cannot tell who opened this MR — the merge request API named no author; run the job again\n/);
    assert.match((await run({ GITLAB_TOKEN: 't', CI_API_V4_URL: '', CI_PROJECT_ID: '', CI_MERGE_REQUEST_IID: '' })).out, /cannot tell who opened this MR — run the job in a merge request pipeline, which sets CI_API_V4_URL, CI_PROJECT_ID and CI_MERGE_REQUEST_IID, as yad-product-checks\.gitlab-ci\.yml does\n/);
    const down = await run({ ...MR, CI_API_V4_URL: 'http://127.0.0.1:9/api/v4', GITLAB_TOKEN: 't' });
    assert.match(down.out, /could not read the MR: .+ — check that CI_API_V4_URL \(http:\/\/127\.0\.0\.1:9\/api\/v4\) is reachable from the runner and answers as GitLab's API, then run the job again\n/);
  } finally { server.close(); fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E131 doctor: an unusable file, a duplicate, and an unchecked Product are each said', async () => {
  const { memberChecks } = await import('./doctor.mjs');
  const T = product();
  try {
    member(T, 'github-alice.json', alice());
    member(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }], emails: [M.hashEmail('alice@work.com')] });
    member(T, 'github-carol.json', '{');
    const checks = [];
    memberChecks(checks, T);
    const ids = checks.map((c) => `${c.id}:${c.status}`);
    assert.deepEqual(ids, ['members:unreadable:warn', 'members:duplicate:warn', 'members:unchecked:ok']);
    assert.equal(JSON.stringify(checks).includes('alice@work.com'), false, 'no address is ever printed');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 yad usage: a member file makes one person one row', async () => {
  const { deriveEvents } = await import('./usage.mjs');
  const T = product({ platform: 'gitlab', gitUrl: 'git@gitlab.com:acme/product.git' });
  try {
    put(path.join(T, 'epics/EP-x/epic.md'), 'x');
    git(T, 'add', '-A');
    git(T, 'commit', '-q', '-m', 'author the epic');
    assert.deepEqual([...new Set(deriveEvents(T, {}).map((e) => e.actor))], ['Alice Smith']);
    member(T, 'gitlab-alice.json', { accounts: [{ platform: 'gitlab', host: 'gitlab.com', login: 'alice' }], emails: [M.hashEmail('alice@work.com')] });
    assert.deepEqual([...new Set(deriveEvents(T, {}).map((e) => e.actor))], ['alice'], 'a report joins GitLab pairings too');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 membersAt: the files as a branch holds them, not as the checkout does (review 2, finding 3)', () => {
  const T = product();
  try {
    member(T, 'github-alice.json', alice());
    git(T, 'add', '-A');
    git(T, 'commit', '-q', '-m', 'alice joined');
    const joined = git(T, 'rev-parse', 'HEAD');
    git(T, 'rm', '-q', M.memberRel('github', 'alice'));
    git(T, 'commit', '-q', '-m', 'alice removed');
    const removed = git(T, 'rev-parse', 'HEAD');
    git(T, 'checkout', '-q', joined);   // a checkout that is behind still holds the file
    assert.equal(M.readMembers(T).members.length, 1);
    assert.equal(M.membersAt(T, removed, { platform: 'github', host: 'github.com' }).members.length, 0, 'on the branch it is gone');
    assert.equal(M.membersAt(T, joined, { platform: 'github', host: 'github.com' }).members[0].primary.login, 'alice');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 member-check: a small edit to a file carrying an unproven email is refused (review 5)', () => {
  const g = gateRepo();
  try {
    // A file holding the victim's email reached main while the gate was off.
    git(g.T, 'checkout', '-q', 'main');
    put(path.join(g.T, FILE('mallory')), rec('mallory', ['victim@x.io']));
    git(g.T, 'add', '-A');
    git(g.T, 'commit', '-q', '-m', 'merged while the gate was off');
    git(g.T, 'checkout', '-q', 'pr');
    git(g.T, 'rebase', '-q', 'main');
    // Now a harmless-looking change: a name. Every email in the file must be proven again.
    const sha = g.commitAs('mallory@x.io', { [FILE('mallory')]: { ...rec('mallory', ['victim@x.io']), names: ['Mal'] } });
    g.attribute(sha, 'mallory');
    const r = g.check(as('mallory'));
    assert.equal(r.code, 1);
    assert.match(r.out, /holds an email no commit in this PR proves/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E131 judgedMemberFiles: an untracked or ignored local copy is not what origin holds (review 5)', () => {
  const T = product();
  try {
    liveGate(T);
    memberC(T, 'github-alice.json', alice());
    assert.equal(M.gateMemberMap(T).size, 1);
    git(T, 'update-index', '--assume-unchanged', M.memberRel('github', 'alice'));
    fs.writeFileSync(path.join(T, M.memberRel('github', 'alice')), JSON.stringify(alice({ emails: [M.hashEmail('victim@x.io')] })));
    assert.equal(M.gateMemberMap(T).size, 0, 'an edit git was told to ignore is still an edit');
    // A local settings edit cannot point the count at another branch on origin.
    git(T, 'update-index', '--no-assume-unchanged', M.memberRel('github', 'alice'));
    git(T, 'checkout', '-q', '--', M.memberRel('github', 'alice'));
    const cfg = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/product.json'), 'utf8'));
    git(T, 'push', '-q', 'origin', 'HEAD:refs/heads/fake');
    git(T, 'fetch', '-q', 'origin');
    put(path.join(T, '.sdlc/product.json'), { ...cfg, default_branch: 'fake' });
    assert.equal(M.originDefault(T), null, 'origin\'s own settings on that branch do not name it');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E131 buildRecord: a partial email list never drops an email as "no longer verified" (review 6)', () => {
  const existing = { primary: { platform: 'gitlab', host: 'gitlab.com', login: 'al' }, accounts: [{ platform: 'gitlab', host: 'gitlab.com', login: 'al' }], emails: [M.hashEmail('second@x.io')], names: [], joined: '2026-01-01' };
  const p = { ...proof('gitlab', 'gitlab.com', 'al', ['al@x.io']), problem: 'GitLab al: its other email addresses could not be read — the token needs the read_user scope' };
  const r = M.buildRecord({ identity: { platform: 'gitlab', host: 'gitlab.com' }, today: TODAY, existing, git: { emails: ['al@x.io'], names: [] }, proofs: [p] });
  assert.match(r.problem, /could not be checked: .*read_user/);
});

test('E131 originDefault: origin/HEAD and the settings disagreeing trusts nothing (review 6)', () => {
  const T = product();
  try {
    liveGate(T);
    assert.equal(M.originDefault(T), 'main');
    git(T, 'push', '-q', 'origin', 'HEAD:refs/heads/master');
    git(T, 'fetch', '-q', 'origin');
    git(T, 'remote', 'set-head', 'origin', 'master');   // an old clone's record
    assert.equal(M.originDefault(T), null);
    git(T, 'remote', 'set-head', 'origin', 'main');
    assert.equal(M.originDefault(T), 'main');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});
