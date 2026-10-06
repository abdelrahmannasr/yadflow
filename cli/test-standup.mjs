// `yad standup` (E132): a daily status per team member, derived live. The rules each test pins:
//   - the window starts at midnight of the previous working day in ONE declared zone (Monday → Friday);
//   - commits and platform times are exact; a ledger record (a UTC date) is in from the start's UTC date;
//   - one person is one block, joined through every identity their member file holds;
//   - anyone seen who matches no member gets a section, and evidence two members match is given to neither;
//   - a platform that cannot be read says "platform not read", never "nothing", and makes nobody `left`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
process.env.YAD_PLATFORM_READ = '0';
process.env.YAD_CAPTURE = '0';
for (const k of Object.keys(process.env)) if (/^GIT_(AUTHOR|COMMITTER)_/.test(k)) delete process.env[k];

const S = await import('./standup.mjs');
const { listPrs, prTarget } = await import('./pr-list.mjs');
const { hashEmail, MEMBERS_DIR } = await import('./members.mjs');
const { runEpicNew } = await import('./epic.mjs');

const YAD = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'yad.mjs');
// Monday 2026-10-05, 09:00 UTC. The default window starts Friday 2026-10-02 00:00 UTC.
const NOW = Date.parse('2026-10-05T09:00:00Z');
const START = Date.parse('2026-10-02T00:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yad-standup-'));
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text, null, 2)); };
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, ...env } }).toString().trim();
const iso = (ms) => new Date(ms).toISOString();
// A commit by someone, at an exact instant (author and committer date both).
const commitAs = (T, name, email, ms, msg = 'work') => git(T, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', msg],
  { GIT_AUTHOR_DATE: iso(ms), GIT_COMMITTER_DATE: iso(ms) });

function product({ platform = 'github', gitUrl = 'git@github.com:acme/product.git' } = {}) {
  const T = tmp();
  git(T, ['init', '-q', '-b', 'main']);
  git(T, ['config', 'user.name', 'Alice Smith']);
  git(T, ['config', 'user.email', 'alice@work.com']);
  git(T, ['config', 'commit.gpgsign', 'false']);
  put(path.join(T, '.sdlc/product.json'), { platform, git_url: gitUrl, default_branch: 'main' });
  commitAs(T, 'Alice Smith', 'alice@work.com', START - 10 * 86400000, 'chore: start');
  return T;
}
const memberFile = (T, login, { names = [], emails = [], others = [] } = {}) => put(path.join(T, MEMBERS_DIR, `github-${login}.json`), {
  accounts: [{ platform: 'github', host: 'github.com', login, id: login.length }, ...others], emails: emails.map(hashEmail), names, joined: '2026-09-01',
});

// A fake gh: logged in, and one GraphQL answer for the repo.
function ghRunner({ open = [], merged = [], fail = null, total = null } = {}) {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'which' || cmd === 'where') return { ok: true, stdout: `/bin/${args[0]}` };
    if (args[0] === 'auth') return { ok: true, stdout: '' };
    if (args.includes('graphql')) {
      if (fail) return { ok: false, stdout: '', stderr: fail };
      const node = (p) => ({ number: p.number, isDraft: !!p.draft, author: { __typename: p.bot ? 'Bot' : 'User', login: p.author }, reviewDecision: p.decision ?? null, reviews: { totalCount: p.reviews ?? 0 }, latestOpinionatedReviews: { nodes: (p.latest || []).map((state) => ({ state })) }, commits: { nodes: [{ commit: { statusCheckRollup: p.checks === undefined ? null : { state: p.checks } } }] } });
      return { ok: true, stdout: JSON.stringify({ data: { repository: {
        open: { totalCount: total ?? open.length, nodes: open.map(node) },
        merged: { nodes: merged.map((p) => ({ number: p.number, mergedAt: p.at, updatedAt: p.updated || p.at, author: { __typename: 'User', login: p.author } })) },
      } } }) };
    }
    if (args.includes('/permission')) return { ok: true, stdout: 'none' };
    return { ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
  };
  runner.calls = calls;
  return runner;
}
const ON = { ...process.env, YAD_PLATFORM_READ: '' };

// ---- the clock -------------------------------------------------------------------------------------

test('E132 windowFor: the previous working day, Monday back to Friday, in one zone', () => {
  const at = (s, opts) => S.windowFor(Date.parse(s), opts);
  assert.equal(at('2026-10-05T09:00:00Z').startMs, Date.parse('2026-10-02T00:00:00Z'), 'Monday reads back to Friday');
  assert.equal(at('2026-10-06T09:00:00Z').startMs, Date.parse('2026-10-05T00:00:00Z'), 'Tuesday reads back to Monday');
  assert.equal(at('2026-10-04T09:00:00Z').startMs, Date.parse('2026-10-02T00:00:00Z'), 'Sunday reads back to Friday');
  assert.equal(at('2026-10-03T09:00:00Z').startMs, Date.parse('2026-10-02T00:00:00Z'), 'Saturday reads back to Friday');
  assert.equal(at('2026-10-05T00:00:00Z').startMs, Date.parse('2026-10-02T00:00:00Z'), 'midnight itself is the new day');
  // Sunday 20:00 UTC is Monday 05:00 in Tokyo: the window is Tokyo's Friday, from its own midnight.
  const tokyo = at('2026-10-04T20:00:00Z', { tz: 'Asia/Tokyo' });
  assert.equal(tokyo.startMs, Date.parse('2026-10-01T15:00:00Z'));
  assert.equal(tokyo.startUtcDay, '2026-10-01', 'a ledger date is compared with the UTC day of the start');
  // Berlin leaves summer time on Sunday 2026-10-25: Friday's midnight is +02:00, Monday's is +01:00.
  assert.equal(at('2026-10-26T08:00:00Z', { tz: 'Europe/Berlin' }).startMs, Date.parse('2026-10-22T22:00:00Z'));
  assert.equal(at('2026-10-27T08:00:00Z', { tz: 'Europe/Berlin' }).startMs, Date.parse('2026-10-25T23:00:00Z'));
  assert.equal(S.zoneStamp(Date.parse('2026-10-25T23:00:00Z'), 'Europe/Berlin'), '2026-10-26 00:00');
});

test('E132 windowFor: --since as a date, hours or days — and refusals', () => {
  assert.equal(S.windowFor(NOW, { since: '2026-09-30' }).startMs, Date.parse('2026-09-30T00:00:00Z'));
  assert.equal(S.windowFor(NOW, { since: '2026-09-30', tz: 'America/New_York' }).startMs, Date.parse('2026-09-30T04:00:00Z'));
  assert.equal(S.windowFor(NOW, { since: '24h' }).startMs, NOW - 86400000);
  assert.equal(S.windowFor(NOW, { since: '3d' }).startMs, NOW - 3 * 86400000);
  assert.match(S.windowFor(NOW, { since: '3d' }).basis, /last 3 days/);
  assert.match(S.windowFor(NOW, { tz: 'Mars/Olympus' }).error, /not a time zone/);
  assert.match(S.windowFor(NOW, { since: 'yesterday' }).error, /not a date or a length of time/);
  assert.match(S.windowFor(NOW, { since: '2026-02-30' }).error, /not a real date/);
  assert.match(S.windowFor(NOW, { since: '2026-10-06' }).error, /in the future/);
  assert.match(S.windowFor(NOW, { since: '0h' }).error, /not a date or a length/);
});

// ---- the platform ----------------------------------------------------------------------------------

test('E132 listPrs: none only from an answer; a refusal or no login is "not read" with the reason', () => {
  const t = { platform: 'github', gitUrl: 'git@github.com:acme/api.git' };
  const empty = listPrs(t, { sinceMs: START, runner: ghRunner(), env: ON });
  assert.equal(empty.ok, true);
  assert.deepEqual([empty.open, empty.merged], [[], []]);
  const refused = listPrs(t, { sinceMs: START, runner: ghRunner({ fail: 'gh: Forbidden (HTTP 403)' }), env: ON });
  assert.equal(refused.ok, false);
  assert.match(refused.why, /HTTP 403/);
  const offline = listPrs(t, { sinceMs: START, runner: ghRunner({ fail: 'dial tcp: lookup api.github.com: no such host' }), env: ON });
  assert.match(offline.why, /could not reach github\.com/);
  assert.match(listPrs(t, { sinceMs: START, runner: ghRunner(), env: { YAD_PLATFORM_READ: '0' } }).why, /turned off/);
  const noCli = (cmd) => ({ ok: cmd !== 'which' && cmd !== 'where' });
  assert.match(prTarget(t, { runner: noCli, env: ON }).why, /gh is not installed/);
  const noLogin = (cmd, args) => ({ ok: cmd === 'which' || cmd === 'where' || args[0] !== 'auth' });
  assert.match(prTarget(t, { runner: noLogin, env: ON }).why, /not logged in for github\.com/);
  assert.match(prTarget({ gitUrl: '' }, { env: ON }).why, /no platform/);
  assert.match(prTarget({ platform: 'github', gitUrl: 'git@ho$t:a/b.git' }, { env: ON }).why, /not a plain host name/);
  const garbled = (cmd, args) => (args?.includes('graphql') ? { ok: true, stdout: 'not json' } : { ok: true, stdout: '' });
  assert.match(listPrs(t, { sinceMs: START, runner: garbled, env: ON }).why, /could not read/);
});

test('E132 listPrs: GitHub facts — checks, reviews, bots, the window, and a full page said', () => {
  const t = { platform: 'github', gitUrl: 'https://github.com/acme/api' };
  const r = listPrs(t, { sinceMs: START, env: ON, runner: ghRunner({
    open: [
      { number: 7, author: 'alice', checks: 'FAILURE', reviews: 0 },
      { number: 8, author: 'bob', checks: 'SUCCESS', decision: 'APPROVED', reviews: 1 },
      { number: 9, author: 'renovate', bot: true },
      { number: 10, author: 'cy', checks: 'PENDING', decision: 'CHANGES_REQUESTED', reviews: 2, draft: true },
      // No required-review rule: GitHub gives no decision, and the reviews themselves say what happened.
      { number: 12, author: 'di', reviews: 1, latest: ['APPROVED'] },
      { number: 13, author: 'di', reviews: 2, latest: ['APPROVED', 'CHANGES_REQUESTED'] },
      { number: 14, author: 'di', reviews: 1, latest: [] },
    ],
    merged: [{ number: 5, author: 'bob', at: iso(START + 3600000) }, { number: 4, author: 'bob', at: iso(START - 1000) }],
    total: 150,
  }) });
  assert.deepEqual(r.open.map((p) => [p.number, p.author, p.checks, p.review, p.draft]), [
    [7, 'alice', 'failing', 'none', false], [8, 'bob', 'passing', 'approved', false], [9, null, 'none', 'none', false], [10, 'cy', 'running', 'changes-requested', true],
    [12, 'di', 'none', 'approved', false], [13, 'di', 'none', 'changes-requested', false], [14, 'di', 'none', 'reviewed', false],
  ]);
  assert.deepEqual(r.merged.map((p) => p.number), [5], 'a merge before the window is not in it');
  assert.equal(r.openPartial, true, '150 open, 7 read: said, never read as the whole list');
  assert.equal(r.mergedPartial, false);
});

test('E132 listPrs: GitLab — only the pipeline words become a check state; every other status is GitLab\'s own word', () => {
  const t = { platform: 'gitlab', gitUrl: 'git@gitlab.com:grp/sub/api.git' };
  const seen = [];
  const runner = (cmd, args) => {
    seen.push(args.join(' '));
    if (cmd === 'which' || args[0] === 'auth') return { ok: true, stdout: '' };
    if (args.at(-1).includes('state=opened')) return { ok: true, stdout: JSON.stringify([
      { iid: 3, author: { username: 'alice' }, detailed_merge_status: 'ci_must_pass' },
      { iid: 4, author: { username: 'bob' }, detailed_merge_status: 'not_approved', draft: false },
      { iid: 5, author: { username: 'cy' }, detailed_merge_status: 'need_rebase' },
    ]) };
    if (args.at(-1).includes('state=merged')) return { ok: true, stdout: JSON.stringify([{ iid: 2, author: { username: 'bob' }, merged_at: iso(START + 60000) }]) };
    return { ok: false, stderr: 'glab: 404 Not Found (HTTP 404)' };
  };
  const r = listPrs(t, { sinceMs: START, runner, env: ON });
  assert.equal(r.ok, true);
  assert.deepEqual(r.open.map((p) => [p.number, p.checks, p.review, p.status ?? null, p.waits]), [[3, 'failing', null, null, true], [4, null, null, 'not_approved', true], [5, null, null, 'need_rebase', true]]);
  assert.deepEqual(r.merged.map((p) => p.number), [2]);
  assert.ok(seen.some((s) => s.includes(`projects/${encodeURIComponent('grp/sub/api')}/merge_requests?state=opened`)), 'the full project path, subgroup and all');
  const refused = (cmd, args) => (cmd === 'which' || args[0] === 'auth' ? { ok: true, stdout: '' } : { ok: false, stderr: 'glab: 403 Forbidden (HTTP 403)' });
  assert.match(listPrs(t, { sinceMs: START, runner: refused, env: ON }).why, /GitLab refused to show the merge requests/);
});

// ---- the report ------------------------------------------------------------------------------------

// Two members (alice, bob), one person seen who joined nothing (carol), an epic whose review gate alice owns.
async function teamFixture() {
  const T = product();
  memberFile(T, 'alice', { names: ['Alice Smith'], emails: ['alice@work.com'] });
  memberFile(T, 'bob', { names: ['Bob Chen'], emails: ['bob@work.com'] });
  await runEpicNew(T, { slug: 'checkout', today: '2026-09-20' });
  const sdlc = path.join(T, 'epics/EP-checkout/.sdlc');
  const state = JSON.parse(fs.readFileSync(path.join(sdlc, 'state.json'), 'utf8'));
  state.steps[0].status = 'done';
  state.steps[0].closed = { by: 'alice', date: '2026-10-02', via: 'human' };
  state.steps[1].status = 'in_progress';
  state.currentStep = 'epic-review';
  put(path.join(sdlc, 'state.json'), state);
  put(path.join(sdlc, 'approvals.json'), [{ artifact: 'epic.md', step: 'epic-review', approver: 'bob', status: 'approved', date: '2026-10-01' }]);
  put(path.join(sdlc, 'comments.json'), [
    { artifact: 'epic.md', step: 'epic-review', commenter: 'bob', round: 1, count: 1, date: '2026-10-01' },
    { artifact: 'epic.md', step: 'epic-review', commenter: 'bob', round: 2, count: 2, date: '2026-10-02' },
  ]);
  put(path.join(sdlc, 'owners/epic.json'), { step: 'epic', owner: 'alice-smith', name: 'Alice Smith', date: '2026-09-20' });
  put(path.join(sdlc, 'build-log.json'), { ships: [{ story: 'EP-checkout-S01', task: 'T01', repo: 'api', shippedAt: '2026-10-03', engineer_review: [{ approver: 'bob' }] }] });
  git(T, ['add', '-A']);
  commitAs(T, 'Alice Smith', 'alice@work.com', START - 3 * 86400000, 'docs: epic');
  commitAs(T, 'Alice Smith', 'alice@work.com', START - 1000, 'docs: one second too early');
  commitAs(T, 'Alice Smith', 'alice@work.com', START + 3600000, 'docs: in');
  commitAs(T, 'A. Smith', 'alice@work.com', START + 7200000, 'docs: same email, other name');
  commitAs(T, 'Carol', 'carol@x.io', START + 5000, 'docs: carol');
  return T;
}
const texts = (list) => list.map((i) => i.text);

test('E132 buildStandup: one block per member, exact commit times, date-only ledger records, waiting stated', async () => {
  const T = await teamFixture();
  try {
    const runner = ghRunner({ open: [{ number: 7, author: 'alice', checks: 'FAILURE' }, { number: 11, author: 'dave', checks: 'SUCCESS', decision: 'APPROVED', reviews: 1 }], merged: [{ number: 5, author: 'bob', at: iso(START + 3600000) }] });
    const m = S.buildStandup(T, { now: NOW, fetch: false, runner, env: ON, access: () => 'yes' });
    const alice = m.team.find((x) => x.login === 'alice');
    const bob = m.team.find((x) => x.login === 'bob');
    assert.deepEqual(texts(alice.done), ['2 commits in Product (last 2026-10-02 02:00)', 'closed EP-checkout epic (human), 2026-10-02'], 'the commit one second before the window is out; a second git name joins by email');
    assert.deepEqual(texts(alice.working), ['owns EP-checkout epic (done)']);
    assert.deepEqual(texts(alice.waiting), [
      'EP-checkout epic-review has the 1 approval it needs to pass; waits for its review PR to merge',
      'EP-checkout epic-review: 2 comments recorded in review round 2 (yad does not know which are answered)',
      'PR #7 open in Product — checks failing, no review yet',
    ]);
    // bob's approval is dated the day BEFORE the window's UTC day: out. His comment ON that day: in.
    assert.deepEqual(texts(bob.done), [
      'commented on EP-checkout epic.md (2026-10-02)',
      'engineer review of EP-checkout-S01/T01 in api, shipped 2026-10-03',
      'PR #5 merged in Product (2026-10-02 01:00)',
    ]);
    assert.deepEqual(m.unlisted.map((u) => [u.who, texts(u.done), texts(u.working)]), [
      ['Carol', ['1 commit in Product (last 2026-10-02 00:00)'], []],
      ['dave', [], ['PR #11 open in Product — checks passing, approved']],
    ]);
    assert.equal(m.window.ledgerFrom, '2026-10-02');
    assert.deepEqual(m.platform, [{ repo: 'Product', read: true }]);
    assert.equal(m.prNote, null);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 buildStandup: an unread platform says so, and nobody becomes `left` on it', async () => {
  const T = await teamFixture();
  try {
    memberFile(T, 'gone', { names: ['Gone Person'] });
    let asked = 0;
    const m = S.buildStandup(T, { now: NOW, fetch: false, access: () => { asked++; return 'no'; } });
    assert.equal(asked, 0, 'the platform was not read, so no access question is asked');
    assert.equal(m.team.find((x) => x.login === 'gone').status, 'unknown');
    assert.deepEqual(m.platform, [{ repo: 'Product', read: false, why: 'platform reads are turned off (YAD_PLATFORM_READ=0)' }]);
    assert.match(m.prNote, /platform not read for Product — PR\/MR facts there are unknown, not none/);
    // Read: a clear "no access" is `left`, listed once at the end and off the team.
    const read = S.buildStandup(T, { now: NOW, fetch: false, runner: ghRunner(), env: ON, access: (_i, mm) => (mm.primary.login === 'gone' ? 'no' : 'yes') });
    assert.deepEqual(read.left.map((x) => x.login), ['gone']);
    assert.ok(!read.team.some((x) => x.login === 'gone'));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 buildStandup: evidence two members both match is given to neither', async () => {
  const T = product();
  try {
    memberFile(T, 'sam1', { names: ['Sam'] });
    memberFile(T, 'sam2', { names: ['Sam'] });
    commitAs(T, 'Sam', 'sam@unknown.io', START + 60000);
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    assert.deepEqual(m.team.map((x) => x.done.length), [0, 0]);
    assert.deepEqual(m.unlisted.map((u) => [u.who, u.ambiguous]), [['Sam', ['sam1', 'sam2']]]);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 buildStandup: a claim and a draft branch land on the member through their git name', async () => {
  const T = await teamFixture();
  try {
    // alice's own capture branch: one unmerged edit to the epic, saved an hour ago.
    git(T, ['checkout', '-q', '-b', 'yad/wip/alice-smith/EP-checkout']);
    put(path.join(T, 'epics/EP-checkout/epic.md'), '# changed\n');
    git(T, ['add', '-A']);
    commitAs(T, 'Alice Smith', 'alice@work.com', NOW - 3600000, 'wip(EP-checkout): capture');
    git(T, ['checkout', '-q', 'main']);
    // bob's older draft branch, saved in the window but with nothing open now.
    git(T, ['branch', 'yad/wip/bob-chen/EP-checkout', 'main']);
    git(T, ['update-ref', 'refs/remotes/origin/yad/wip/bob-chen/EP-checkout', 'yad/wip/bob-chen/EP-checkout']);
    git(T, ['branch', '-D', 'yad/wip/bob-chen/EP-checkout']);
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    const alice = m.team.find((x) => x.login === 'alice');
    assert.ok(texts(alice.working).includes('editing epics/EP-checkout/epic.md (last saved 2026-10-05 08:00)'), texts(alice.working).join(' | '));
    assert.ok(!texts(alice.working).some((t) => t.startsWith('saved drafts')), 'a branch with an open claim is not said twice');
    const bob = m.team.find((x) => x.login === 'bob');
    assert.deepEqual(texts(bob.working), ['saved drafts on EP-checkout (2026-10-02 00:00; nothing unmerged is open now)']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 buildStandup: the current author step an owner holds is their next move; a gate nobody owns is listed', async () => {
  const T = product();
  try {
    memberFile(T, 'alice', { names: ['Alice Smith'] });
    await runEpicNew(T, { slug: 'pay', today: '2026-09-20' });
    await runEpicNew(T, { slug: 'ship', today: '2026-09-20' });
    put(path.join(T, 'epics/EP-pay/.sdlc/owners/epic.json'), { step: 'epic', owner: 'alice-smith', name: 'Alice Smith', date: '2026-09-20' });
    const f = path.join(T, 'epics/EP-ship/.sdlc/state.json');
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    st.steps[0].status = 'done';
    st.steps[1].status = 'in_progress';
    st.steps[1].risk_tags = ['contract'];
    st.currentStep = 'epic-review';
    put(f, st);
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    assert.deepEqual(texts(m.team[0].waiting), ['EP-pay epic is the current step and theirs to author (in_progress)']);
    assert.deepEqual(texts(m.ownerless), ['EP-ship epic-review waits for approval — missing: 1 approval(s); the count asks 3 approvers = base 1 + contract risk 2 (risk step advisory)']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- the command -----------------------------------------------------------------------------------

test('E132 runStandup: --member, --me, the report formats, and refusals', async () => {
  const T = await teamFixture();
  const out = tmp();
  try {
    const only = await S.runStandup(T, { now: NOW, fetch: false, member: 'BOB', json: true });
    assert.deepEqual(only.team.map((x) => x.login), ['bob']);
    assert.deepEqual([only.unlisted, only.ownerless], [[], []]);
    const me = await S.runStandup(T, { now: NOW, fetch: false, me: true, json: true });
    assert.deepEqual(me.team.map((x) => x.login), ['alice'], 'not logged in: the git name finds the one member file');
    const md = await S.runStandup(T, { now: NOW, fetch: false, format: 'md', out: path.join(out, 'r.md') });
    const text = fs.readFileSync(md.out, 'utf8');
    assert.match(text, /^# Standup/);
    assert.match(text, /## alice — active/);
    assert.match(text, /# Seen, not on the team list/);
    assert.match(text, /Product: platform not read — platform reads are turned off/);
    assert.ok(!/@/.test(text.replace(/\(YAD_PLATFORM_READ=0\)/, '')), 'no email address anywhere');
    const html = await S.runStandup(T, { now: NOW, fetch: false, out: path.join(out, 'r.html') });
    assert.match(fs.readFileSync(html.out, 'utf8'), /<h1>Standup<\/h1>/, '--out ending .html picks the format');
    for (const [opts, re] of [
      [{ format: 'pdf' }, /unknown --format pdf/],
      [{ member: 'a', me: true }, /not both/],
      [{ tz: 'Nowhere/Zone' }, /not a time zone/],
    ]) {
      process.exitCode = 0;
      assert.equal(await S.runStandup(T, { now: NOW, fetch: false, ...opts }), undefined);
      assert.equal(process.exitCode, 1, re.source);
    }
    process.exitCode = 0;
  } finally { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});

test('E132 yad standup (CLI): the JSON envelope, and a foreign flag refused rather than ignored', async () => {
  const T = await teamFixture();
  try {
    const env = { ...process.env, SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1', NO_COLOR: '1' };
    const r = spawnSync(process.execPath, [YAD, 'standup', '--json', '--since', '30d'], { cwd: T, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.command, 'standup');
    assert.equal(j.ok, true);
    assert.ok(j.team.some((x) => x.login === 'alice'));
    assert.match(j.window.basis, /last 30 days/);
    const bad = spawnSync(process.execPath, [YAD, 'standup', '--json', '--sinse', '2d'], { cwd: T, encoding: 'utf8', env });
    assert.equal(bad.status, 1);
    assert.match(JSON.parse(bad.stdout).error, /does not take --sinse/);
    const text = spawnSync(process.execPath, [YAD, 'standup', '--tz', 'Asia/Tokyo'], { cwd: T, encoding: 'utf8', env });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /\(Asia\/Tokyo\) — since the previous working day/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 renderText: every section prints — the people seen, gates nobody owns, who left, and what was not read', async () => {
  const T = await teamFixture();
  try {
    memberFile(T, 'gone', { names: ['Gone Person'] });
    const f = path.join(T, 'epics/EP-checkout/.sdlc/owners/epic.json');
    fs.rmSync(f);
    const m = S.buildStandup(T, { now: NOW, fetch: false, runner: ghRunner({ fail: 'gh: Forbidden (HTTP 403)' }), env: ON, access: () => 'no' });
    const lines = [];
    const [log, err] = [console.log, console.error];
    console.log = (...a) => lines.push(a.join(' '));
    console.error = (...a) => lines.push(a.join(' '));
    try { S.renderText({ ...m, fetched: 'failed', notes: ['a note'] }); } finally { console.log = log; console.error = err; }
    const out = lines.join('\n');
    for (const re of [/window: Fri 2026-10-02 00:00 → Mon 2026-10-05 09:00 \(UTC\)/, /Seen, not on the team list/, /Open gates nobody owns/,
      /EP-checkout epic-review has the 1 approval it needs/, /could not fetch the capture branches/, /Product: platform not read — GitHub refused/,
      /nothing recorded here — but the platform was not read for every repo, and the capture branches could not be fetched/, /a note/, /no emails, commit messages, PR titles or comment bodies/]) assert.match(out, re);
    assert.equal(m.left.length, 0, 'the platform refused, so nobody is `left`');
    assert.ok(!/@/.test(out), 'no email address anywhere');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 buildStandup: a robot that closed a step or recorded a review is not a person seen', async () => {
  const T = await teamFixture();
  try {
    const f = path.join(T, 'epics/EP-checkout/.sdlc/state.json');
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    st.steps[0].closed = { by: 'yad-gate-sync', date: '2026-10-02', via: 'human' };
    put(f, st);
    put(path.join(T, 'epics/EP-checkout/.sdlc/comments.json'), [{ artifact: 'epic.md', step: 'epic-review', commenter: 'coderabbitai[bot]', round: 1, count: 1, date: '2026-10-02' }]);
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    assert.deepEqual(m.unlisted.map((u) => u.who), ['Carol']);
    assert.ok(!texts(m.team.find((x) => x.login === 'alice').done).some((t) => t.startsWith('closed')));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- review round 1 ---------------------------------------------------------------------------------

test('E132 review 1: a malformed ledger is "not read" for that epic, never a crash of the whole report', async () => {
  const T = await teamFixture();
  try {
    const sdlc = path.join(T, 'epics/EP-checkout/.sdlc');
    put(path.join(sdlc, 'approvals.json'), [null, 5, { step: 'epic-review', approver: 'bob', status: 'approved', date: '2026-10-02' }]);
    put(path.join(sdlc, 'comments.json'), [null]);
    put(path.join(sdlc, 'product-prs.json'), [null, { step: 'other', number: 9 }, { artifact: 'epic.md', step: 'epic-review', number: 4 }]);
    put(path.join(sdlc, 'hub-prs.json'), [null, { step: 'other', number: 9 }, { artifact: 'epic.md', step: 'epic-review', number: 4 }]);
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    const alice = m.team.find((x) => x.login === 'alice');
    assert.ok(texts(alice.waiting).includes('EP-checkout epic-review has the 1 approval it needs to pass; waits for review PR #4 to merge'), texts(alice.waiting).join(' | '));
    assert.ok(m.notRead.some((n) => /EP-checkout: its ledger cannot be read/.test(n)), 'the report reader (yad usage\'s) stops on the null and says so');
    assert.match(S.renderMarkdown(m), /nothing recorded here — but the platform was not read for every repo, and some git history or ledgers were not read/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 review 1: a control character in a shared file never reaches the text; an email-shaped name is hidden', async () => {
  const T = await teamFixture();
  try {
    const sdlc = path.join(T, 'epics/EP-checkout/.sdlc');
    const st = JSON.parse(fs.readFileSync(path.join(sdlc, 'state.json'), 'utf8'));
    st.steps[0].closed = { by: 'alice', date: '2026-10-02', via: 'hu\u001b[2Jman' };
    put(path.join(sdlc, 'state.json'), st);
    put(path.join(sdlc, 'comments.json'), [{ artifact: 'epic\u001b]0;pwned\u0007.md', step: 'epic-review', commenter: 'bob', round: 1, count: 1, date: '2026-10-02' },
      { artifact: 'epic.md', step: 'epic-review', commenter: 'bob', round: 1, count: 1, date: '2026-10-0\u001b' }]);
    put(path.join(sdlc, 'build-log.json'), { ships: [{ story: 'S\u001b[31m', task: 'T01', repo: 'a\u0007pi', shippedAt: '2026-10-03', engineer_review: [{ approver: 'bob' }] }] });
    commitAs(T, 'eve@corp.example', 'eve@corp.example', START + 60000);
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    const all = JSON.stringify([m.team, m.unlisted, m.ownerless].flat().flatMap((b) => [b.who, ...(b.done || []), ...(b.working || []), ...(b.waiting || [])].map((x) => x?.text ?? x)));
    assert.ok(!/\\u00[01][0-9a-f]|\\u007f|\\[bfrt]/i.test(all), all);   // JSON writes any control character as an escape
    assert.ok(!/eve@corp/.test(all), 'an email used as a git name is never printed');
    assert.ok(m.unlisted.some((u) => u.who === 'a name with an @ in it'));
    assert.ok(!texts(m.team.find((x) => x.login === 'bob').done).some((t) => /2026-10-0\b/.test(t)), 'a date that is not a date is not in the window');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 review 1: a monorepo\'s registered folders are one git history, counted once', async () => {
  const T = await teamFixture();
  try {
    fs.mkdirSync(path.join(T, 'apps/web'), { recursive: true });
    put(path.join(T, '.sdlc/repos.json'), { repos: [{ name: 'self', path: '.' }, { name: 'web', path: 'apps/web' }] });
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    assert.deepEqual(texts(m.team.find((x) => x.login === 'alice').done).filter((t) => /commit/.test(t)), ['2 commits in Product (last 2026-10-02 02:00)']);
    assert.ok(m.notes.some((n) => /^self: the same git repository as Product/.test(n)));
    assert.ok(m.notes.some((n) => /^web: the same git repository as Product/.test(n)));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 review 1: the gate line follows the gate\'s own rule — an approval without engagement does not count', async () => {
  const T = await teamFixture();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(T, '.sdlc/product.json'), 'utf8'));
    put(path.join(T, '.sdlc/product.json'), { ...cfg, review: { requireEngagement: true } });
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    const gate = m.team.find((x) => x.login === 'alice').waiting.find((i) => i.kind === 'gate');
    assert.match(gate.text, /^EP-checkout epic-review waits for approval — missing: 1 approval\(s\); 1 approval\(s\) without verified engagement/);
    // No platform: nothing merges; the gate moves on when it is advanced.
    put(path.join(T, '.sdlc/product.json'), { ...cfg, platform: null, git_url: '' });
    const local = S.buildStandup(T, { now: NOW, fetch: false });
    // (With no platform no member file is readable, so the owner is a person seen.)
    assert.match([...local.team, ...local.unlisted].flatMap((b) => b.waiting).find((i) => i.kind === 'gate').text, /waits for `yad gate advance`/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 review 1: a PR author is matched on the PR\'s own platform and host only', async () => {
  const T = await teamFixture();
  try {
    put(path.join(T, '.sdlc/repos.json'), { repos: [{ name: 'api', git_url: 'git@gitlab.com:acme/api.git', platform: 'gitlab' }] });
    const runner = (cmd, args) => {
      if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, stdout: '' };
      if (args.includes('graphql')) return { ok: true, stdout: JSON.stringify({ data: { repository: { open: { totalCount: 0, nodes: [] }, merged: { nodes: [] } } } }) };
      if (args.at(-1).includes('state=opened')) return { ok: true, stdout: JSON.stringify([{ iid: 3, author: { username: 'alice' }, detailed_merge_status: 'mergeable' }]) };
      if (args.at(-1).includes('state=merged')) return { ok: true, stdout: '[]' };
      return { ok: false, stderr: 'HTTP 404' };
    };
    const m = S.buildStandup(T, { now: NOW, fetch: false, runner, env: ON, access: () => 'yes' });
    assert.ok(!texts(m.team.find((x) => x.login === 'alice').working).some((t) => /MR !3/.test(t)), 'GitLab alice is not GitHub alice');
    assert.deepEqual(m.unlisted.find((u) => u.who === 'alice')?.working.map((i) => i.text), ['MR !3 open in api — merge status mergeable']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 review 1: smaller fixes — a GraphQL error is not "offline", a merger that is not text falls back, a file-less team, a zone with no midnight', async () => {
  const t = { platform: 'github', gitUrl: 'git@github.com:acme/gone.git' };
  const gql = listPrs(t, { sinceMs: START, env: ON, runner: ghRunner({ fail: "GraphQL: Could not resolve to a Repository with the name 'acme/gone'. (repository)" }) });
  assert.match(gql.why, /answered the pull-request query for acme\/gone with an error/);
  const T = await teamFixture();
  try {
    const f = path.join(T, 'epics/EP-checkout/.sdlc/state.json');
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    st.steps[0].closed = { by: 'alice', date: '2026-10-02', via: 'merge', mergedBy: 5 };
    put(f, st);
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    assert.ok(texts(m.team.find((x) => x.login === 'alice').done).includes('closed EP-checkout epic (merge), 2026-10-02'));
    // Every member file refused: the first line says so, not "no team list yet".
    put(path.join(T, MEMBERS_DIR, 'github-alice.json'), '{ broken');
    put(path.join(T, MEMBERS_DIR, 'github-bob.json'), '{ broken');
    const lines = [];
    const [log, err] = [console.log, console.error];
    console.log = (...a) => lines.push(a.join(' '));
    console.error = (...a) => lines.push(a.join(' '));
    try { S.renderText(S.buildStandup(T, { now: NOW, fetch: false })); } finally { console.log = log; console.error = err; }
    assert.match(lines.join('\n'), /no member file could be read — the reasons are listed at the end/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
  // America/Santiago skips 00:00 on 2026-09-06: that day starts at 01:00 local, never the evening before.
  const santiago = S.zoneMidnight(2026, 9, 6, 'America/Santiago');
  assert.equal(S.zoneStamp(santiago, 'America/Santiago'), '2026-09-06 01:00');
  assert.equal(S.zoneStamp(S.zoneMidnight(2026, 9, 7, 'America/Santiago'), 'America/Santiago'), '2026-09-07 00:00');
});

test('E132 review 1: commits by one name, one ambiguous and one unmatched, stay two lines', async () => {
  const T = product();
  try {
    memberFile(T, 'sam1', { names: ['Sam One'], emails: ['shared@x.io'] });
    memberFile(T, 'sam2', { names: ['Sam Two'], emails: ['shared@x.io'] });
    commitAs(T, 'Sam', 'shared@x.io', START + 60000);
    commitAs(T, 'Sam', 'other@x.io', START + 120000);
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    assert.deepEqual(m.unlisted.map((u) => [u.who, u.ambiguous, texts(u.done)]).sort((a, b) => (a[1] ? -1 : 1) - (b[1] ? -1 : 1)), [
      ['Sam', ['sam1', 'sam2'], ['1 commit in Product (last 2026-10-02 00:01)']],
      ['Sam', null, ['1 commit in Product (last 2026-10-02 00:02)']],
    ]);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// ---- review round 2 ---------------------------------------------------------------------------------

test('E132 review 2: a parse error quoting raw bytes is cleaned, and names no path of this machine', async () => {
  const T = await teamFixture();
  try {
    fs.writeFileSync(path.join(T, 'epics/EP-checkout/.sdlc/approvals.json'), '[{"a":\u001b]0;PWNED\u0007 }]');
    const m = S.buildStandup(T, { now: NOW, fetch: false });
    const line = m.notRead.find((n) => n.startsWith('EP-checkout: its ledger cannot be read'));
    assert.ok(line, m.notRead.join(' | '));
    assert.ok(![...line].some((ch) => ch.charCodeAt(0) < 32), JSON.stringify(line));
    assert.ok(!line.includes(T) && !line.includes(fs.realpathSync(T)), 'no absolute path');
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 review 2: another account two files claim is matched by neither, on any platform', async () => {
  const T = await teamFixture();
  try {
    const gl = { platform: 'gitlab', host: 'gitlab.com', login: 'alice' };
    memberFile(T, 'alice', { names: ['Alice Smith'], emails: ['alice@work.com'], others: [gl] });
    memberFile(T, 'bob', { names: ['Bob Chen'], emails: ['bob@work.com'], others: [gl] });
    put(path.join(T, '.sdlc/repos.json'), { repos: [{ name: 'api', git_url: 'git@gitlab.com:acme/api.git', platform: 'gitlab' }] });
    const runner = (cmd, args) => {
      if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, stdout: '' };
      if (args.includes('graphql')) return { ok: true, stdout: JSON.stringify({ data: { repository: { open: { totalCount: 0, nodes: [] }, merged: { nodes: [] } } } }) };
      if (args.at(-1).includes('state=opened')) return { ok: true, stdout: '[]' };
      if (args.at(-1).includes('state=merged')) return { ok: true, stdout: JSON.stringify([{ iid: 7, author: { username: 'alice' }, merged_at: iso(START + 60000) }]) };
      return { ok: false, stderr: 'HTTP 404' };
    };
    const m = S.buildStandup(T, { now: NOW, fetch: false, runner, env: ON, access: () => 'yes' });
    for (const who of ['alice', 'bob']) assert.ok(!texts(m.team.find((x) => x.login === who).done).some((t) => /MR !7/.test(t)), who);
    // Listed with the people seen, and naming the two files that claim it (review 3).
    assert.deepEqual(m.unlisted.filter((u) => u.who === 'alice').map((u) => [u.ambiguous, u.done.map((i) => i.text)]), [[['alice', 'bob'], ['MR !7 merged in api (2026-10-02 00:01)']]]);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 review 2: every format ends with the same gaps; a partial page counts as one; the empty-team line is shared', async () => {
  const T = await teamFixture();
  try {
    const many = Array.from({ length: 100 }, (_, i) => ({ number: 100 + i, author: 'zed', at: iso(START + 1000 + i) }));
    put(path.join(T, MEMBERS_DIR, 'github-zz.json'), '{ broken');
    const m = { ...S.buildStandup(T, { now: NOW, fetch: false, runner: ghRunner({ merged: many }), env: ON, access: () => 'yes' }), fetched: 'failed' };
    assert.equal(m.prPartial, true);
    const md = S.renderMarkdown(m);
    const html = S.renderHtml(m);
    for (const out of [md, html]) {
      assert.match(out, /could not fetch the capture branches/);
      assert.match(out, /github-zz\.json/);
      assert.match(out, /more PRs were merged in the window than one page holds/);
    }
    assert.match(md, /not every PR\/MR fitted on one page/);
    const none = { ...m, team: [], left: [], member: null };
    assert.match(S.renderHtml(none), /no member file could be read/);
    assert.match(S.renderMarkdown(none), /no member file could be read/);
    assert.match(S.renderHtml({ ...none, memberErrors: [], left: [{ login: 'x', status: 'left', lastActive: null, logins: ['x'] }] }), /everyone on the team list has left/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 review 2: a clock that goes back at midnight starts the day at the first 00:00', () => {
  // Asia/Amman, 2020-10-30: 01:00 went back to 00:00, so midnight came twice — UTC+3, then UTC+2.
  assert.equal(S.zoneMidnight(2020, 10, 30, 'Asia/Amman'), Date.parse('2020-10-29T21:00:00Z'));
  assert.equal(S.zoneMidnight(2020, 10, 31, 'Asia/Amman'), Date.parse('2020-10-30T22:00:00Z'));
});

// ---- review round 3 ---------------------------------------------------------------------------------

test('E132 review 3: no path of this machine reaches the report — not from git, not from a relative --dir', async () => {
  const T = await teamFixture();
  const api = tmp();
  try {
    // A registered clone that is shallow: people.mjs names it by its absolute path.
    git(api, ['init', '-q', '-b', 'main']);
    commitAs(api, 'Alice Smith', 'alice@work.com', START - 86400000);
    commitAs(api, 'Alice Smith', 'alice@work.com', START + 1000);
    const shallow = path.join(T, '..', `${path.basename(T)}-api`);
    git(path.dirname(shallow), ['clone', '-q', '--depth', '1', `file://${api}`, shallow]);
    put(path.join(T, '.sdlc/repos.json'), { repos: [{ name: 'api', path: `../${path.basename(shallow)}` }] });
    fs.writeFileSync(path.join(T, 'epics/EP-checkout/.sdlc/approvals.json'), '{ broken');
    const cwd = process.cwd();
    process.chdir(T);
    let m;
    try { m = S.buildStandup('.', { now: NOW, fetch: false }); } finally { process.chdir(cwd); }
    const all = [...m.notRead, ...m.notes].join('\n');
    assert.match(all, /api: <api> is a shallow clone/);
    assert.match(all, /EP-checkout: its ledger cannot be read \(corrupt JSON in epics\/EP-checkout\/\.sdlc\/approvals\.json/, 'a relative root: nothing to cut, and no dot rewritten');
    for (const p of [T, fs.realpathSync(T), shallow, fs.realpathSync(shallow), os.tmpdir()]) assert.ok(!all.includes(p), p);
    // An absolute root: the Product's own path is named <Product>.
    const abs = S.buildStandup(T, { now: NOW, fetch: false });
    assert.ok(abs.notRead.some((n) => /corrupt JSON in <Product>\/epics\/EP-checkout\/\.sdlc\/approvals\.json/.test(n)), abs.notRead.join(' | '));
    assert.ok(!abs.notRead.join('\n').includes(T));
    fs.rmSync(shallow, { recursive: true, force: true });
  } finally { fs.rmSync(T, { recursive: true, force: true }); fs.rmSync(api, { recursive: true, force: true }); }
});

test('E132 review 3: --member for someone who left says so; an unmatched login is kept apart per platform; no origin is said in every format', async () => {
  const T = await teamFixture();
  try {
    put(path.join(T, '.sdlc/repos.json'), { repos: [{ name: 'api', git_url: 'git@gitlab.com:acme/api.git', platform: 'gitlab' }] });
    const runner = (cmd, args) => {
      if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, stdout: '' };
      if (args.includes('graphql')) return { ok: true, stdout: JSON.stringify({ data: { repository: { open: { totalCount: 1, nodes: [{ number: 1, isDraft: true, author: { __typename: 'User', login: 'sam' }, reviewDecision: null, reviews: { totalCount: 0 }, latestOpinionatedReviews: { nodes: [] }, commits: { nodes: [] } }] }, merged: { nodes: [] } } } }) };
      if (args.at(-1).includes('state=opened')) return { ok: true, stdout: JSON.stringify([{ iid: 2, author: { username: 'sam' }, draft: true }]) };
      if (args.at(-1).includes('state=merged')) return { ok: true, stdout: '[]' };
      if (args.includes('/permission') || String(args.at(-1)).includes('/permission')) return { ok: true, stdout: 'none' };
      return { ok: false, stderr: 'HTTP 404' };
    };
    memberFile(T, 'gone', { names: ['Gone Person'] });
    const m = S.buildStandup(T, { now: NOW, fetch: false, runner, env: ON, access: (_i, mm) => (mm.primary.login === 'gone' ? 'no' : 'yes') });
    assert.deepEqual(m.unlisted.filter((u) => u.who === 'sam').map((u) => u.working.map((i) => i.text)), [['PR #1 open in Product — draft, no review yet'], ['MR !2 open in api — draft']]);
    assert.equal(S.noTeamLine(S.onlyMember(m, 'gone')), 'gone has left — listed under Left');
    const local = { ...m, fetched: 'local' };
    for (const out of [S.renderMarkdown(local), S.renderHtml(local)]) assert.match(out, /no remote named origin — only your own capture branches are read/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('E132 review 3: a clock that goes back more than an hour, or half an hour, at midnight', () => {
  assert.equal(S.zoneStamp(S.zoneMidnight(2006, 4, 15, 'Asia/Colombo') - 60000, 'Asia/Colombo'), '2006-04-14 23:59');
  assert.equal(S.zoneMidnight(2006, 4, 15, 'Asia/Colombo'), Date.parse('2006-04-14T18:00:00Z'));
});

// ---- review round 4 ---------------------------------------------------------------------------------

test('E132 review 4: a Windows path is cut at a backslash, in any case; a name is put in as plain text', () => {
  const places = [['C:\\Users\\ada\\work\\product', '<Product>'], ['C:\\Users\\ada\\work\\product\\apps\\api', '<api>'], ['/Users/x/api', '<$&>']];
  assert.equal(S.scrubPaths('corrupt JSON in c:\\users\\ada\\work\\product\\epics\\EP-x\\.sdlc\\approvals.json: bad', places),
    'corrupt JSON in <Product>\\epics\\EP-x\\.sdlc\\approvals.json: bad');
  assert.equal(S.scrubPaths('C:\\Users\\ada\\work\\product\\apps\\api is a shallow clone', places), '<api> is a shallow clone');
  assert.equal(S.scrubPaths('C:\\Users\\ada\\work\\productive stays', places), 'C:\\Users\\ada\\work\\productive stays', 'a longer folder name is not cut');
  assert.equal(S.scrubPaths('/Users/x/api is a shallow clone', places), '<$&> is a shallow clone', 'a repo named `$&` never writes the path back');
});
