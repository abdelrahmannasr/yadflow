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
    assert.match(all, /api: \[api\] is a shallow clone/);
    assert.match(all, /EP-checkout: its ledger cannot be read \(corrupt JSON in epics\/EP-checkout\/\.sdlc\/approvals\.json/, 'a relative root: nothing to cut, and no dot rewritten');
    for (const p of [T, fs.realpathSync(T), shallow, fs.realpathSync(shallow), os.tmpdir()]) assert.ok(!all.includes(p), p);
    // An absolute root: the Product's own path is named [Product] (square brackets: Markdown keeps them).
    const abs = S.buildStandup(T, { now: NOW, fetch: false });
    assert.ok(abs.notRead.some((n) => /corrupt JSON in \[Product\]\/epics\/EP-checkout\/\.sdlc\/approvals\.json/.test(n)), abs.notRead.join(' | '));
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

// ---- yad status --brief (#349) ---------------------------------------------------------------------

const St = await import('./status.mjs');

// A Product beside one code repo it registers (`api`), so "here" can be a task branch in that repo.
async function statusFixture() {
  const P = tmp();
  const T = path.join(P, 'product');
  const api = path.join(P, 'api');
  for (const d of [T, api]) {
    fs.mkdirSync(d, { recursive: true });
    git(d, ['init', '-q', '-b', 'main']);
    git(d, ['config', 'user.name', 'Alice Smith']);
    git(d, ['config', 'user.email', 'alice@work.com']);
    git(d, ['config', 'commit.gpgsign', 'false']);
    git(d, ['commit', '-q', '--allow-empty', '-m', 'chore: start']);
  }
  put(path.join(T, '.sdlc/product.json'), { platform: 'github', git_url: 'git@github.com:acme/product.git', default_branch: 'main' });
  put(path.join(T, '.sdlc/repos.json'), { repos: [{ name: 'api', path: '../api', git_url: 'git@github.com:acme/api.git', platform: 'github' }] });
  put(path.join(P, '.yad-workspace.json'), { version: 1, product: 'product' });
  await runEpicNew(T, { slug: 'pay', today: '2026-09-20' });
  return { P, T, api };
}
// A fake gh: logged in as `login`; each repo answers its own open PRs (with their head branches).
function statusRunner({ login = 'alice', open = {} } = {}) {
  return (cmd, args) => {
    if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, stdout: '' };
    if (cmd === 'git') return { ok: false, stdout: '' };
    if (args.includes('user')) return login ? { ok: true, stdout: login } : { ok: false, stdout: '' };
    if (args.includes('graphql')) {
      const name = args.find((a) => a.startsWith('name=')).slice(5);
      const nodes = (open[name] || []).map((p) => ({ number: p.number, isDraft: false, headRefName: p.branch, author: { __typename: 'User', login: p.author }, reviewDecision: null, reviews: { totalCount: 0 }, latestOpinionatedReviews: { nodes: [] }, commits: { nodes: [] } }));
      return { ok: true, stdout: JSON.stringify({ data: { repository: { open: { totalCount: nodes.length, nodes }, merged: { nodes: [] } } } }) };
    }
    return { ok: false, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
  };
}
const statusEnv = { ...ON, YAD_PLATFORM_LOGIN: '' };

test('#349 yad status: a project not set up says so', () => {
  const T = tmp();
  try {
    assert.deepEqual(St.buildStatus(T, { fetch: false }), { setUp: false });
    assert.deepEqual(St.briefLines({ setUp: false }), ['Project not set up yet — run yad setup']);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('#418 yad status and yad next: a done review whose artifact changed after it was approved is owed a fresh review', async () => {
  const { P, T } = await statusFixture();
  try {
    const f = path.join(T, 'epics/EP-pay/.sdlc/state.json');
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    const review = st.steps.find((s) => s.type === 'review+approve');
    for (const s of st.steps) if (st.steps.indexOf(s) <= st.steps.indexOf(review)) s.status = 'done';
    put(f, st);
    put(path.join(T, 'epics/EP-pay', review.artifact), '---\nid: EP-pay\nstatus: approved\n---\n# Pay, as it stands now\n');
    // approved, then the artifact changed: the approval's fingerprint is of older content
    put(path.join(T, 'epics/EP-pay/.sdlc/approvals.json'), [{ artifact: review.artifact, step: review.id, approver: 'bo', status: 'approved', date: '2026-10-01', source: 'bridge', artifactHash: 'sha256:older', approvedAt: '2026-10-01T00:00:00Z', pr: 3, engagement: 'none' }]);
    const m = St.buildStatus(T, { cwd: T, fetch: false });
    const fix = 'review epic.md as it stands on a fresh PR/MR: `git fetch --prune origin`, `git switch -C review/EP-pay/epic origin/main`, `git commit --allow-empty -m "docs(ep-pay): review epic as merged"`, `git push --force-with-lease -u origin review/EP-pay/epic`, then `yad gate open EP-pay epic.md`';
    assert.deepEqual(m.owed.filter((o) => o.kind === 'unapproved-change'), [{ kind: 'unapproved-change', epic: 'EP-pay', step: review.id, artifact: review.artifact, fix }]);
    assert.ok(St.briefLines(m).includes(`  EP-pay: ${review.id} is done, but ${review.artifact} changed after it was approved — ${fix}`), St.briefLines(m).join('\n'));
    const next = spawnSync(process.execPath, [YAD, 'next', 'EP-pay', '--dir', T], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    const said = `${next.stdout}${next.stderr}`;
    assert.match(said, /epic-review is done, but epic\.md changed after it was approved/);
    assert.ok(said.includes(fix), said);
    // solo mode counts no approvals, and the gate says nothing there: neither do status and next
    const settings = path.join(T, '.sdlc/product.json');
    const before = fs.readFileSync(settings, 'utf8');
    put(settings, { ...JSON.parse(before), solo: true });
    assert.equal(St.buildStatus(T, { cwd: T, fetch: false }).owed.filter((o) => o.kind === 'unapproved-change').length, 0);
    assert.doesNotMatch(spawnSync(process.execPath, [YAD, 'next', 'EP-pay', '--dir', T], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }).stderr, /changed after it was approved/);
    fs.writeFileSync(settings, before);
    // re-approved on the content as it stands: nothing owed
    const { artifactHash } = await import('./epic-state.mjs');
    put(path.join(T, 'epics/EP-pay/.sdlc/approvals.json'), [{ artifact: review.artifact, step: review.id, approver: 'bo', status: 'approved', date: '2026-10-02', source: 'bridge', artifactHash: artifactHash(path.join(T, 'epics/EP-pay'), review.artifact), approvedAt: '2026-10-02T00:00:00Z', pr: 4, engagement: 'none' }]);
    assert.equal(St.buildStatus(T, { cwd: T, fetch: false }).owed.filter((o) => o.kind === 'unapproved-change').length, 0);
  } finally { fs.rmSync(P, { recursive: true, force: true }); }
});

test('#349 yad status: here is the task branch and its lane step; owed lists recorded blockers, debt and hotfix debt — a bare blocked is not one', async () => {
  const { P, T, api } = await statusFixture();
  try {
    const f = path.join(T, 'epics/EP-pay/.sdlc/state.json');
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    st.steps[0] = { ...st.steps[0], status: 'blocked', record: { reason: 'waiting on legal', by: 'alice', date: '2026-10-01' } };
    put(f, st);
    put(path.join(T, 'epics/EP-pay/.sdlc/reconcile-debt.json'), [{ status: 'open', reason: 'hotfix' }, { status: 'paid' }]);
    put(path.join(T, 'epics/EP-pay/.sdlc/build-state/EP-pay-S01.json'), { story: 'EP-pay-S01', repos: {
      api: { currentStep: 'implement', steps: [{ id: 'spec', status: 'done' }, { id: 'tasks', status: 'done' }, { id: 'implement', status: 'blocked', record: { reason: 'waiting on human decisions: token scope' } }, { id: 'checks', status: 'todo' }] },
      web: { currentStep: 'spec', steps: [{ id: 'spec', status: 'blocked' }] },
    } });
    git(api, ['checkout', '-q', '-b', 'feat/EP-pay-S01-T02-refund']);
    const m = St.buildStatus(T, { cwd: api, fetch: false });
    assert.equal(m.here.story, 'EP-pay-S01');
    assert.equal(m.here.task, 'T02');
    assert.equal(m.here.repo, 'api');
    assert.equal(m.here.step, 'implement');
    assert.equal(m.here.reason, 'waiting on human decisions: token scope');
    assert.deepEqual(m.owed.map((o) => [o.kind, o.step ?? o.count, o.repo ?? null]), [
      ['blocked', 'epic', null], ['blocked', 'implement', 'api'], ['hotfix-debt', 1, null],
    ], 'the bare blocked spec in web is the old spelling of todo, not a blocker');
    const lines = St.briefLines(m);
    assert.equal(lines[0], 'here: EP-pay-S01 T02 in api — implement (blocked) — blocked: waiting on human decisions: token scope');
    assert.ok(lines.includes('open PRs/MRs: not asked (--no-fetch)'));
    assert.ok(lines.includes('  EP-pay: epic blocked — waiting on legal'));
    assert.ok(lines.includes('  EP-pay: 1 open hotfix debt — yad reconcile check'));
    // On the Product's own checkout, on a branch that is not a task's: said, never guessed.
    assert.equal(St.buildStatus(T, { cwd: T, fetch: false }).here.why, 'not a task branch');
  } finally { fs.rmSync(P, { recursive: true, force: true }); }
});

test('#349 yad status: your open PRs from the platform, follow-up PRs as owed, and a repo not read is "unknown, not none"', async () => {
  const { P, T } = await statusFixture();
  try {
    const runner = statusRunner({ open: {
      product: [{ number: 4, author: 'bob', branch: 'review/EP-pay-epic' }],
      api: [{ number: 7, author: 'alice', branch: 'feat/EP-pay-S01-T02-refund' }, { number: 9, author: 'bob', branch: 'fix/EP-pay-S01-T01-followup-null-check' }],
    } });
    const m = St.buildStatus(T, { fetch: true, env: statusEnv, runner });
    assert.equal(m.prs.whose, 'yours');
    assert.deepEqual(m.prs.listed.map((p) => [p.repo, p.number, p.task]), [['api', 7, 'EP-pay-S01-T02']]);
    assert.equal(m.prs.others, 2);
    assert.deepEqual(m.owed.filter((o) => o.kind === 'follow-up-pr').map((o) => [o.repo, o.number, o.task]), [['api', 9, 'EP-pay-S01-T01']]);
    const lines = St.briefLines(m);
    assert.ok(lines.includes('open PRs/MRs (yours): 1 — 2 by others'), lines.join('\n'));
    assert.ok(lines.includes('  api PR #7 EP-pay-S01-T02 — checks none, review none'), lines.join('\n'));
    assert.ok(lines.includes('  api PR #9: open follow-up of EP-pay-S01-T01'), lines.join('\n'));
    // No login known: every open PR is listed, and the line says why — never a silent filter.
    const all = St.buildStatus(T, { fetch: true, env: statusEnv, runner: statusRunner({ login: null, open: { api: [{ number: 7, author: 'alice', branch: 'x' }] } }) });
    assert.equal(all.prs.whose, 'all');
    assert.match(St.briefLines(all).find((l) => l.startsWith('open PRs')), /who you are on the platform is not known, so every open one is listed/);
    // The platform not read: unknown, not none.
    const off = St.buildStatus(T, { fetch: true, env: { ...statusEnv, YAD_PLATFORM_READ: '0' }, runner });
    assert.ok(St.briefLines(off).includes('  platform not read for Product, api — PR/MR facts there are unknown, not none'));
    // Nothing read at all: the count is unknown, not 0 (review 1).
    assert.equal(off.prs.whose, 'none');
    assert.ok(St.briefLines(off).includes('open PRs/MRs: unknown — no repo could be read'));
  } finally { fs.rmSync(P, { recursive: true, force: true }); }
});

test('#349 yad status: the view stays near 20 lines however much there is', () => {
  const m = {
    setUp: true, here: { branch: 'main', task: null, why: 'not a task branch' }, finished: 3,
    epics: Array.from({ length: 30 }, (_, i) => ({ epic: `EP-e${i}`, step: 'epic', status: 'in_progress', next: 'invoke yad-epic' })),
    prs: { asked: true, whose: 'yours', others: 0, partial: [], followUps: [], listed: Array.from({ length: 30 }, (_, i) => ({ repo: 'api', platform: 'github', number: i, task: null })), notRead: Array.from({ length: 5 }, (_, i) => ({ label: `r${i}` })) },
    owed: Array.from({ length: 30 }, (_, i) => ({ kind: 'hotfix-debt', epic: `EP-e${i}`, count: 1 })),
  };
  const lines = St.briefLines(m);
  assert.ok(lines.length <= 22, `${lines.length} lines`);
  assert.ok(lines.includes('  … +25 more — yad next --all'));
  assert.ok(lines.includes('  … +26 more — yad standup'));
  assert.ok(lines.includes('  platform not read for r0, r1, r2, r3, r4 — PR/MR facts there are unknown, not none'));
});

test('#349 yad status: the CLI finds the Product from a registered repo, keeps --brief and --json, and refuses with no Product', async () => {
  const { P, T, api } = await statusFixture();
  try {
    const env = { ...process.env, NO_COLOR: '1' };
    const r = spawnSync(process.execPath, [YAD, 'status', '--brief', '--no-fetch', '--json'], { cwd: api, encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.command, 'status');
    assert.equal(j.here.repo, 'api');
    assert.deepEqual(j.epics.map((e) => e.epic), ['EP-pay']);
    const plain = spawnSync(process.execPath, [YAD, 'status', '--no-fetch'], { cwd: T, encoding: 'utf8', env });
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /epics: 1 open/);
    const none = spawnSync(process.execPath, [YAD, 'status', '--no-fetch'], { cwd: os.tmpdir(), encoding: 'utf8', env });
    assert.notEqual(none.status, 0);
    assert.match(none.stdout + none.stderr, /no Product here/);
  } finally { fs.rmSync(P, { recursive: true, force: true }); }
});

test('#349 review 1: finished is the engine\'s shipped rule, a bad lane is skipped not a crash, a skipped lane says so, and every line is plain text', async () => {
  const { P, T, api } = await statusFixture();
  try {
    const dir = path.join(T, 'epics/EP-pay');
    const f = path.join(dir, '.sdlc/state.json');
    const st = JSON.parse(fs.readFileSync(f, 'utf8'));
    st.steps = st.steps.map((s) => ({ ...s, status: 'done' }));
    st.currentStep = 'ready-for-build';
    put(f, st);
    put(path.join(dir, 'stories/EP-pay-S01.md'), '---\nid: EP-pay-S01\nrepos: [api]\n---\n');
    put(path.join(dir, 'stories/EP-pay-S02.md'), '---\nid: EP-pay-S02\nrepos: [api]\n---\n');
    const shipped = { currentStep: 'engineer-review', steps: ['spec', 'tasks', 'implement', 'checks', 'engineer-review'].map((id) => ({ id, status: 'done' })) };
    put(path.join(dir, '.sdlc/build-state/EP-pay-S01.json'), { story: 'EP-pay-S01', repos: { api: shipped } });
    // S02 has not begun Build: the epic is not finished, though every lane on disk shipped.
    const open = St.buildStatus(T, { fetch: false });
    assert.deepEqual([open.epics.map((e) => e.epic), open.finished], [['EP-pay'], 0]);
    put(path.join(dir, '.sdlc/build-state/EP-pay-S02.json'), { story: 'EP-pay-S02', repos: { api: shipped } });
    assert.deepEqual([St.buildStatus(T, { fetch: false }).epics.length, St.buildStatus(T, { fetch: false }).finished], [0, 1]);
    // A lane whose steps are not a list is skipped, as `yad next` skips it — never a crash.
    put(path.join(dir, '.sdlc/build-state/EP-pay-S02.json'), { story: 'EP-pay-S02', repos: { api: { steps: {} }, web: { steps: 'x' } } });
    git(api, ['checkout', '-q', '-b', 'feat/EP-pay-S02-T01-a']);
    assert.equal(St.buildStatus(T, { cwd: api, fetch: false }).here.why, 'the lane in api has no steps yet');
    put(path.join(dir, '.sdlc/build-state/EP-pay-S02.json'), { story: 'EP-pay-S02', repos: { api: { status: 'skipped', record: { reason: 'no API change' } } } });
    assert.equal(St.briefLines(St.buildStatus(T, { cwd: api, fetch: false }))[0], 'here: EP-pay-S02 T01 in api — the lane is skipped in api — no API change');
    // A value from a shared file with a control character reaches the terminal as plain text.
    put(path.join(dir, '.sdlc/build-state/EP-pay-S02.json'), { story: 'EP-pay-S02', repos: { api: { currentStep: 'spec', steps: [{ id: 'spec', status: 'blocked', record: { reason: 'wait\u001b]0;owned\u0007\u009b31m' } }] } } });
    const lines = St.briefLines(St.buildStatus(T, { cwd: api, fetch: false }));
    // eslint-disable-next-line no-control-regex -- finding a control character is the point
    assert.ok(lines.every((l) => !/[\u0000-\u001f\u007f-\u009f]/.test(l)), JSON.stringify(lines));
  } finally { fs.rmSync(P, { recursive: true, force: true }); }
});

test('#349 review 1: a monorepo that registers the Product folder itself finds its lane', async () => {
  const { P, T } = await statusFixture();
  try {
    put(path.join(T, '.sdlc/repos.json'), { repos: [{ name: 'app', path: '.', git_url: 'git@github.com:acme/product.git', platform: 'github' }] });
    put(path.join(T, 'epics/EP-pay/.sdlc/build-state/EP-pay-S01.json'), { story: 'EP-pay-S01', repos: { app: { currentStep: 'implement', steps: [{ id: 'spec', status: 'done' }, { id: 'tasks', status: 'done' }, { id: 'implement', status: 'in_progress' }] } } });
    git(T, ['checkout', '-q', '-b', 'feat/EP-pay-S01-T01-a']);
    const h = St.buildStatus(T, { cwd: T, fetch: false }).here;
    assert.deepEqual([h.repo, h.step, h.status], ['app', 'implement', 'in_progress']);
  } finally { fs.rmSync(P, { recursive: true, force: true }); }
});

test('#349 review 1: more open PRs than one page holds is said, not hidden', () => {
  const m = { setUp: true, here: { branch: null, task: null, why: 'no branch checked out' }, finished: 0, epics: [], owed: [],
    prs: { asked: true, whose: 'yours', others: 0, partial: ['api'], followUps: [], listed: [], notRead: [] } };
  assert.ok(St.briefLines(m).includes('  more open PRs/MRs than one page holds in api — only the newest were read'));
});

test('#349 review 2: a re-opened step or an open test-cases track keeps a shipped epic listed, and says what is open', async () => {
  const { P, T, api } = await statusFixture();
  try {
    const dir = path.join(T, 'epics/EP-pay');
    const f = path.join(dir, '.sdlc/state.json');
    const base = JSON.parse(fs.readFileSync(f, 'utf8'));
    put(path.join(dir, 'stories/EP-pay-S01.md'), '---\nid: EP-pay-S01\nrepos: [api]\n---\n');
    put(path.join(dir, '.sdlc/build-state/EP-pay-S01.json'), { story: 'EP-pay-S01', repos: { api: { currentStep: 'engineer-review', steps: ['spec', 'tasks', 'implement', 'checks', 'engineer-review'].map((id) => ({ id, status: 'done' })) } } });
    for (const [open, word] of [['ui-design', /re-opened: invoke the yad-ui skill/], ['test-cases', /parallel: invoke the yad-test-cases skill/], ['test-cases-review', /open: test-cases-review \(in_progress\)/]]) {
      put(f, { ...base, currentStep: 'ready-for-build', steps: base.steps.map((s) => ({ ...s, status: s.id === open ? 'in_progress' : 'done' })) });
      const m = St.buildStatus(T, { fetch: false });
      assert.deepEqual([m.epics.map((e) => e.epic), m.finished], [['EP-pay'], 0], open);
      assert.match(m.epics[0].next, word);
    }
    // The common Build state: test-cases in progress, its review still todo — the review is not "open" too (review 5).
    put(f, { ...base, currentStep: 'ready-for-build', steps: base.steps.map((s) => ({ ...s, status: s.id === 'test-cases' ? 'in_progress' : s.id === 'test-cases-review' ? 'todo' : 'done' })) });
    assert.doesNotMatch(St.buildStatus(T, { fetch: false }).epics[0].next, /open: test-cases-review/);
    // The skill a project binds is the one "here" names, as `yad next` does (review 3).
    put(f, { ...base, currentStep: 'ready-for-build', steps: base.steps.map((s) => ({ ...s, status: 'done' })) });
    put(path.join(T, '.sdlc/skills.json'), { steps: { implement: 'my-impl' } });
    put(path.join(dir, '.sdlc/build-state/EP-pay-S01.json'), { story: 'EP-pay-S01', repos: { api: { currentStep: 'implement', steps: [{ id: 'spec', status: 'done' }, { id: 'tasks', status: 'done' }, { id: 'implement', status: 'in_progress' }] } } });
    git(api, ['checkout', '-q', '-b', 'feat/EP-pay-S01-T01-x']);
    assert.equal(St.buildStatus(T, { cwd: api, fetch: false }).here.skill, 'my-impl');
  } finally { fs.rmSync(P, { recursive: true, force: true }); }
});

test('#349 review 2: an unreadable registry is "unknown, not none" for the code repos', async () => {
  const { P, T } = await statusFixture();
  try {
    put(path.join(T, '.sdlc/repos.json'), '<<<<<<< HEAD\n{');
    const m = St.buildStatus(T, { fetch: true, env: statusEnv, runner: statusRunner() });
    assert.deepEqual(m.prs.notRead.map((n) => n.label), ['the registered repos']);
    assert.ok(St.briefLines(m).includes('  platform not read for the registered repos — PR/MR facts there are unknown, not none'));
  } finally { fs.rmSync(P, { recursive: true, force: true }); }
});

test('#349 follow-up: a git worktree of a registered repo is that repo, on the worktree\'s own branch', async () => {
  const { P, T, api } = await statusFixture();
  try {
    put(path.join(T, 'epics/EP-pay/.sdlc/build-state/EP-pay-S01.json'), { story: 'EP-pay-S01', repos: { api: { currentStep: 'implement', steps: [{ id: 'spec', status: 'done' }, { id: 'tasks', status: 'done' }, { id: 'implement', status: 'in_progress' }] } } });
    // Where an agent's worktree usually sits: inside the repo's own folder.
    const wt = path.join(api, '.claude/worktrees/t01');
    git(api, ['worktree', 'add', '-q', '-b', 'feat/EP-pay-S01-T01-x', wt]);
    const h = St.buildStatus(T, { cwd: wt, fetch: false }).here;
    assert.deepEqual([h.repo, h.story, h.task, h.step], ['api', 'EP-pay-S01', 'T01', 'implement']);
    assert.equal(St.buildStatus(T, { cwd: api, fetch: false }).here.why, 'not a task branch', 'the main checkout keeps its own branch');
    // The CLI finds the Product from inside the worktree, too.
    const r = spawnSync(process.execPath, [YAD, 'status', '--no-fetch', '--json'], { cwd: wt, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).here.repo, 'api');
  } finally { fs.rmSync(P, { recursive: true, force: true }); }
});
