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
const member = (T, file, rec) => put(path.join(T, M.MEMBERS_DIR, file), rec);
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
    member(T, 'github-alice.json', alice({ accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }, { platform: 'gitlab', host: 'gitlab.com', login: 'al' }] }));
    member(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }, { platform: 'gitlab', host: 'gitlab.com', login: 'al' }, { platform: 'github', host: 'ghe.io', login: 'alice' }] });
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
    member(T, 'github-alice.json', alice());
    member(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }], emails: [M.hashEmail('bob@work.com')], names: ['Bob'] });
    let map = M.gateMemberMap(T);
    assert.equal(map.get(M.hashEmail('alice@work.com')), 'alice');
    assert.equal(map.get(M.hashEmail('bob@work.com')), 'bob');
    // Bob claims Alice's email: neither file joins it any more.
    member(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }], emails: [M.hashEmail('bob@work.com'), M.hashEmail('alice@work.com')] });
    const got = M.readMembers(T);
    assert.equal(got.duplicates.length, 1);
    map = M.gateMemberMap(T);
    assert.equal(map.has(M.hashEmail('alice@work.com')), false, 'a shared email is dropped from every pairing');
    assert.equal(map.get(M.hashEmail('bob@work.com')), 'bob', 'the rest of the file still pairs');
    // Bob lists Alice's GitLab account too: a shared account is reported.
    member(T, 'github-alice.json', alice({ accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }, { platform: 'gitlab', host: 'gitlab.com', login: 'al' }] }));
    member(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }, { platform: 'gitlab', host: 'gitlab.com', login: 'AL' }] });
    assert.match(M.readMembers(T).duplicates.join('\n'), /GitLab al account is claimed by/);
    // An unreadable file is listed, never dropped, and adds no pairing.
    member(T, 'github-carol.json', '{');
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

test('E131 THE COUNT: a work-email committer who approves by login is ONE person with a member file, two without', () => {
  const T = product();
  try {
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
    member(T, 'github-alice.json', alice());
    assert.equal(activePeople(T, { today: TODAY }).capacity.active, 3, 'Alice is one person now; Bob, with no file, still counts twice');
    member(T, 'github-bob.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'bob' }], emails: [M.hashEmail('bob@work.com')] });
    assert.equal(activePeople(T, { today: TODAY }).capacity.active, 2);
    // A file that does not parse adds no pairing: the count goes back UP, never down.
    member(T, 'github-bob.json', '{');
    assert.equal(activePeople(T, { today: TODAY }).capacity.active, 3);
    // A member who never committed or approved adds nobody: a file is never a person by itself.
    member(T, 'github-carol.json', { accounts: [{ platform: 'github', host: 'github.com', login: 'carol' }], emails: [M.hashEmail('carol@x.io')] });
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

test('E131 buildRecord: an update keeps what the file already holds and says which emails are new', () => {
  const existing = { primary: { platform: 'github', host: 'github.com', login: 'alice' }, accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }, { platform: 'gitlab', host: 'gitlab.com', login: 'old' }], emails: [M.hashEmail('old@x.io')], names: ['Al'], joined: '2026-01-01' };
  const r = M.buildRecord({ identity: ID, today: TODAY, existing, git: { emails: ['alice@work.com'], names: ['Alice Smith'] }, proofs: [proof('github', 'github.com', 'alice', ['alice@work.com'])] });
  assert.equal(r.record.joined, '2026-01-01');
  assert.ok(r.record.accounts.some((a) => a.login === 'old'));
  assert.deepEqual(r.newEmails, [M.hashEmail('alice@work.com')]);
  assert.equal(r.record.emails.length, 2);
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
    const made = M.commitMember(T, { rel: M.memberRel('github', 'alice'), record, newEmails: record.emails, plainEmails: ['alice@work.com', 'a@home.io'], base: 'HEAD', name: 'Alice Smith', login: 'alice', subject: 'chore(product): add team member alice' });
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
const rec = (login, emails) => ({ accounts: [{ platform: 'github', host: 'github.com', login }], emails: emails.map(M.hashEmail).sort() });

test('E131 member-check: no member file changed is a pass', () => {
  const g = gateRepo();
  try {
    g.commitAs('x@y.z', { 'other.txt': 'x' });
    const r = g.check({ PR_AUTHOR: 'alice' });
    assert.equal(r.code, 0);
    assert.match(r.out, /no member file changed/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E131 member-check: your own file, each email proven by a commit GitHub gives to you', () => {
  const g = gateRepo();
  try {
    const sha = g.commitAs('alice@work.com', { [FILE('alice')]: rec('alice', ['alice@work.com']) });
    g.attribute(sha, 'alice');
    const r = g.check({ PR_AUTHOR: 'Alice' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 new email\(s\), each proven/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
});

test('E131 member-check: an email no commit proves is refused (the forgery case)', () => {
  const g = gateRepo();
  try {
    // Alice adds Bob's email to her file. The commit is authored by Bob's email, but GitHub gives it to Bob.
    const sha = g.commitAs('bob@work.com', { [FILE('alice')]: rec('alice', ['bob@work.com']) });
    g.attribute(sha, 'bob');
    const r = g.check({ PR_AUTHOR: 'alice' });
    assert.equal(r.code, 1);
    assert.match(r.out, /adds an email no commit in this PR proves/);
    // And a commit GitHub cannot attribute at all proves nothing either.
    const g2 = gateRepo();
    try {
      g2.commitAs('alice@work.com', { [FILE('alice')]: rec('alice', ['alice@work.com']) });
      assert.equal(g2.check({ PR_AUTHOR: 'alice' }).code, 1);
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
    let r = g.check({ PR_AUTHOR: 'alice' });
    assert.equal(r.code, 1);
    assert.match(r.out, /only its author's own member file/);
    git(g.T, 'reset', '-q', '--hard', 'main');
    g.commitAs('alice@work.com', { [FILE('bob')]: null }, 'chore(product): remove team member bob');
    r = g.check({ PR_AUTHOR: 'alice' });
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
    const sha = g.commitAs('alice@work.com', { [FILE('alice')]: { accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }, { platform: 'gitlab', host: 'gitlab.com', login: 'AL' }], emails: [M.hashEmail('alice@work.com')] } });
    g.attribute(sha, 'alice');
    let r = g.check({ PR_AUTHOR: 'alice' });
    assert.equal(r.code, 0, r.out);
    // But naming Bob's own GitHub account in Alice's file is refused.
    const sha2 = g.commitAs('alice@work.com', { [FILE('alice')]: { accounts: [{ platform: 'github', host: 'github.com', login: 'alice' }, { platform: 'github', host: 'github.com', login: 'Bob' }], emails: [M.hashEmail('alice@work.com')] } });
    g.attribute(sha2, 'alice');
    r = g.check({ PR_AUTHOR: 'alice' });
    assert.equal(r.code, 1);
    assert.match(r.out, /github:github\.com:bob is in/);
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
    const r = link.check({ PR_AUTHOR: 'mallory' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\.sdlc\/members is not a folder at HEAD/);
  } finally { fs.rmSync(link.T, { recursive: true, force: true }); }
  const inner = gateRepo();
  try {
    put(path.join(inner.T, 'elsewhere.json'), rec('mallory', ['victim@x.io']));
    fs.mkdirSync(path.join(inner.T, M.MEMBERS_DIR), { recursive: true });
    fs.symlinkSync('../../elsewhere.json', path.join(inner.T, M.MEMBERS_DIR, 'github-mallory.json'));
    git(inner.T, 'add', '-A');
    git(inner.T, 'commit', '-q', '-m', 'inner link');
    assert.match(inner.check({ PR_AUTHOR: 'mallory' }).out, /not a plain file/);
  } finally { fs.rmSync(inner.T, { recursive: true, force: true }); }
  const twin = gateRepo();
  try {
    twin.commitAs('m@x.io', { '.sdlc/Members/github-mallory.json': rec('mallory', ['victim@x.io']) });
    const r = twin.check({ PR_AUTHOR: 'mallory' });
    assert.equal(r.code, 1);
    assert.match(r.out, /another spelling of \.sdlc\/members/);
  } finally { fs.rmSync(twin.T, { recursive: true, force: true }); }
});

test('E131 member-check: on GitLab with no API token a member change FAILS closed', () => {
  const g = gateRepo('gitlab');
  try {
    g.commitAs('alice@work.com', { [`${M.MEMBERS_DIR}/gitlab-alice.json`]: { accounts: [{ platform: 'gitlab', host: 'gitlab.com', login: 'alice' }] } });
    const r = g.check({ CI_API_V4_URL: 'http://127.0.0.1:9/api/v4', CI_PROJECT_ID: '1', CI_MERGE_REQUEST_IID: '2', GITLAB_TOKEN: '', SDLC_API_TOKEN: '' });
    assert.equal(r.code, 1);
    assert.match(r.out, /no API token/);
  } finally { fs.rmSync(g.T, { recursive: true, force: true }); }
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
