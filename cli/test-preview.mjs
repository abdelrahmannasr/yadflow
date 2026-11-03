// #359: a preview address for each PR/MR. A repo records a pattern (`preview_url` in repos.json, set
// with `yad repo preview`); else the platform's deployment for the PR; else "locally only". The PR/MR
// body carries a Preview line, and `yad review context` hands the address to the review skills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';

const { patternProblems, fillPattern, previewPattern, platformPreview, resolvePreview, prHead, previewLine, urlProblem, budget, PREVIEW_NONE, PREVIEW_UNFILLED, PREVIEW_UNUSABLE, slug } = await import('./preview.mjs');
const { templateBody, withPreviewLine, runOpenPr } = await import('./openpr.mjs');
const { reviewContext } = await import('./review.mjs');
const { previewChecks } = await import('./doctor.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAD = path.join(HERE, '..', 'bin', 'yad.mjs');
const REPO = path.join(HERE, '..');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-preview-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const done = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const yad = (cwd, ...a) => spawnSync(process.execPath, [YAD, ...a], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1', YAD_NO_REPORT: '1' } });

// A scripted runner: the first prefix that matches answers; anything else fails, as an unknown host would.
function fakeRunner(answers = {}) {
  const calls = [];
  const runner = (cmd, args = []) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    for (const [prefix, out] of Object.entries(answers)) {
      if (line.startsWith(prefix)) return typeof out === 'string' ? { ok: true, code: 0, stdout: out, stderr: '' } : out;
    }
    return { ok: false, code: 1, stdout: '', stderr: 'not scripted' };
  };
  runner.calls = calls;
  return runner;
}

test('patternProblems: one rule for a usable pattern', () => {
  for (const good of ['https://pr-{pr}.myapp.dev', 'https://{branch}--{repo}.netlify.app/', 'https://staging.example.com', 'http://localhost:3000/pr/{pr}', 'https://x.dev/?b={branch}&r={repo}'])
    assert.deepEqual(patternProblems(good), [], good);
  const bad = (p, re) => assert.match(patternProblems(p).join(' | '), re, String(p));
  bad('http://pr-{pr}.myapp.dev', /https:\/\//);
  bad('ftp://x.dev', /https:\/\//);
  bad('javascript:alert(1)', /https:\/\//);
  bad('https://pr-{id}.myapp.dev', /unknown placeholder \{id\}/);
  bad('https://pr-{pr.myapp.dev', /lone \{/);
  bad('https://pr {pr}.dev', /space/);
  bad('https://x.dev/<b>', /not allowed/);
  bad('https://user:pw@x.dev', /user name or password/);
  bad(`https://x.dev/${'a'.repeat(2100)}`, /longer than/);
  bad(42, /not text/);
  bad(null, /not text/);
});

test('fillPattern: fills, slugs the branch and repo, and refuses what it cannot fill', () => {
  assert.equal(fillPattern('https://pr-{pr}.myapp.dev', { pr: 12 }), 'https://pr-12.myapp.dev');
  assert.equal(fillPattern('https://{branch}.{repo}.dev', { branch: 'feat/EP-x-S01-T01_Cart', repo: 'Web App' }), 'https://feat-ep-x-s01-t01-cart.web-app.dev');
  assert.equal(fillPattern('https://pr-{pr}.myapp.dev', {}), null, '{pr} before the PR exists');
  assert.equal(fillPattern('https://pr-{pr}.myapp.dev', { pr: '1; rm' }), null, 'a PR number is digits only');
  assert.equal(fillPattern('https://{branch}.dev', { branch: '///' }), null, 'a branch that slugs to nothing');
  assert.equal(fillPattern('http://x.dev/{pr}', { pr: 1 }), null, 'an unusable pattern fills to nothing');
  assert.equal(fillPattern('https://x.dev/$&-{pr}', { pr: 3 }), 'https://x.dev/$&-3', 'a $ is kept as written');
  assert.equal(slug('  A__b//C '), 'a-b-c');
});

test('previewPattern: none, usable, or recorded but unusable', () => {
  assert.deepEqual(previewPattern({ name: 'web' }), {});
  assert.deepEqual(previewPattern({ name: 'web', preview_url: null }), {});
  assert.deepEqual(previewPattern(null), {});
  assert.deepEqual(previewPattern({ preview_url: 'https://pr-{pr}.x.dev' }), { pattern: 'https://pr-{pr}.x.dev' });
  assert.ok(previewPattern({ preview_url: 'http://x.dev' }).problems.length);
  assert.ok(previewPattern({ preview_url: 5 }).problems.length);
});

test('urlProblem: an address from a deployment service must be https and plain', () => {
  assert.equal(urlProblem('https://pr-1.x.vercel.app'), null);
  assert.equal(urlProblem('http://127.0.0.1:8080'), null);
  assert.match(urlProblem('http://pr-1.x.dev'), /https/);
  assert.match(urlProblem('javascript:alert(1)'), /https/);
  assert.match(urlProblem('https://x.dev/‮'), /non-ASCII/);
});

const SHA = 'a'.repeat(40);
const deployments = (list) => JSON.stringify(list);

test('platformPreview (GitHub): the newest successful non-production deployment of the head commit', () => {
  const runner = fakeRunner({
    [`gh api repos/{owner}/{repo}/deployments?sha=${SHA}`]: deployments([
      { id: 3, production_environment: true },
      { id: 2, production_environment: false },
      { id: 1 },
    ]),
    'gh api repos/{owner}/{repo}/deployments/2/statuses': deployments([{ state: 'in_progress', environment_url: '' }, { state: 'success', environment_url: 'https://old.x.dev' }]),
    'gh api repos/{owner}/{repo}/deployments/1/statuses': deployments([{ state: 'success', environment_url: 'https://pr-7.x.vercel.app' }]),
  });
  assert.deepEqual(platformPreview('github', { sha: SHA, runner }), { url: 'https://pr-7.x.vercel.app' });
  assert.ok(!runner.calls.some((c) => c.includes('deployments/3/')), 'a production deployment is the live site, never asked');
  const named = fakeRunner({
    [`gh api repos/{owner}/{repo}/deployments?sha=${SHA}`]: deployments([{ id: 5, environment: 'Production' }, { id: 6, environment: 'prod' }, { id: 7, environment: 'Production – myapp' }, { id: 8, environment: 'production-eu' }, { id: 10, environment: 'prod_us' }]),
    'gh api repos/{owner}/{repo}/deployments/': deployments([{ state: 'success', environment_url: 'https://live.x.dev' }]),
  });
  assert.match(platformPreview('github', { sha: SHA, runner: named }).why, /no preview deployment/, 'an environment named production is production, flag or not');
  const failing = fakeRunner({ [`gh api repos/{owner}/{repo}/deployments?sha=${SHA}`]: deployments([{ id: 1 }, { id: 2 }]) });
  assert.match(platformPreview('github', { sha: SHA, runner: failing }).why, /could not be asked for the deployments' status/, 'failed status calls are not "no deployment"');
});

test('platformPreview (GitHub): no deployment, a failed gh, an odd address, an unreadable answer', () => {
  assert.match(platformPreview('github', { sha: SHA, runner: fakeRunner({ 'gh api': '[]' }) }).why, /no preview deployment/);
  assert.match(platformPreview('github', { sha: SHA, runner: fakeRunner({}) }).why, /could not be asked/);
  assert.match(platformPreview('github', { sha: SHA, runner: fakeRunner({ 'gh api': '{' }) }).why, /cannot read/);
  assert.match(platformPreview('github', { sha: null, runner: fakeRunner({}) }).why, /head commit is not known/);
  assert.match(platformPreview('github', { sha: 'x&y', runner: fakeRunner({}) }).why, /head commit is not known/, 'a sha is hex only before it goes into the API path');
  const odd = fakeRunner({
    [`gh api repos/{owner}/{repo}/deployments?sha=${SHA}`]: deployments([{ id: 1 }]),
    'gh api repos/{owner}/{repo}/deployments/1/statuses': deployments([{ state: 'success', environment_url: 'javascript:alert(1)' }]),
  });
  const r = platformPreview('github', { sha: SHA, runner: odd });
  assert.equal(r.url, null);
  assert.match(r.why, /will not use/);
});

test('platformPreview (GitHub): stops asking once its time budget is spent', () => {
  let t = 0;
  const now = () => t;
  const runner = (cmd, args) => {
    t += 10000;   // every call takes 10 s
    const line = [cmd, ...args].join(' ');
    if (line.includes('/statuses')) return { ok: true, stdout: '[{"state":"failure"}]' };
    return { ok: true, stdout: deployments([{ id: 1 }, { id: 2 }, { id: 3 }]) };
  };
  assert.match(platformPreview('github', { sha: SHA, runner, clock: budget(now) }).why, /too slow/);
  // Each call is handed only the time that is left, never a fresh 8 s.
  const seen = [];
  let t2 = 0;
  const clock = budget(() => t2);
  const timed = (cmd, args, o) => { seen.push(o.timeout); t2 += 6000; return { ok: true, stdout: deployments([{ id: 1 }, { id: 2 }]) }; };
  platformPreview('github', { sha: SHA, runner: timed, clock });
  assert.deepEqual(seen, [8000, 8000, 3000], 'a hard total of 15 s');
});

test('platformPreview (GitLab): this branch\'s deployment whose environment is running and not production', () => {
  const list = deployments([
    { ref: 'main', sha: SHA, environment: { id: 1, name: 'review/main' } },
    { ref: 'feat/x', sha: SHA, environment: { id: 2, name: 'Production' } },
    { ref: 'feat/x', sha: SHA, environment: { id: 3, name: 'review/old' } },
    { ref: 'feat/x', sha: 'c'.repeat(40), environment: { id: 9, name: 'review/older-commit' } },
    { ref: 'feat/x', sha: SHA, environment: { id: 4, name: 'review/feat-x' } },
  ]);
  const runner = fakeRunner({
    'glab api projects/:id/deployments?': list,
    'glab api projects/:id/environments/3': JSON.stringify({ id: 3, name: 'review/old', state: 'stopped', external_url: 'https://dead.review.x.dev' }),
    'glab api projects/:id/environments/4': JSON.stringify({ id: 4, name: 'review/feat-x', state: 'available', tier: 'development', external_url: 'https://feat-x.review.x.dev' }),
  });
  assert.deepEqual(platformPreview('gitlab', { sha: SHA, branch: 'feat/x', runner }), { url: 'https://feat-x.review.x.dev' });
  assert.ok(!runner.calls.some((c) => /environments\/(1|2|9)$/.test(c)), 'another branch, production and another commit are never asked');
  assert.ok(!runner.calls[0].includes('ref='), 'the list has no branch filter: yad filters it');
  const prodTier = fakeRunner({ 'glab api projects/:id/deployments?': deployments([{ ref: 'feat/x', environment: { id: 5, name: 'live' } }]),
    'glab api projects/:id/environments/5': JSON.stringify({ state: 'available', tier: 'production', external_url: 'https://x.dev' }) });
  assert.match(platformPreview('gitlab', { branch: 'feat/x', runner: prodTier }).why, /no successful, running review deployment/);
  const envFails = fakeRunner({ 'glab api projects/:id/deployments?': deployments([{ ref: 'feat/x', environment: { id: 5, name: 'r' } }]) });
  const envDown = platformPreview('gitlab', { branch: 'feat/x', runner: envFails });
  assert.match(envDown.why, /could not be asked about the review environments/);
  assert.equal(envDown.listedNone, undefined, 'environments it could not ask are not "none listed"');
  assert.match(platformPreview('gitlab', { branch: 'feat/x', runner: fakeRunner({}) }).why, /could not be asked/);
  const empty = platformPreview('gitlab', { branch: 'feat/x', runner: fakeRunner({ 'glab api': '[]' }) });
  assert.match(empty.why, /no successful, running review deployment/);
  assert.equal(empty.listedNone, true, 'resolvePreview reads this flag, never the wording');
  assert.equal(platformPreview('gitlab', { branch: 'feat/x', runner: fakeRunner({}) }).listedNone, undefined, 'a GitLab it could not ask listed nothing only in the sense that it was not asked');
  assert.match(platformPreview('gitlab', { branch: null, runner: fakeRunner({}) }).why, /branch is not known/);
  assert.match(platformPreview('bitbucket', {}).why, /not GitHub or GitLab/);
});

test('prHead: with a PR number only the platform answers; without one, this checkout', () => {
  const gh = fakeRunner({ 'gh pr view 9': JSON.stringify({ headRefOid: SHA, headRefName: 'feat/x' }) });
  assert.deepEqual(prHead('github', 9, { runner: gh }), { sha: SHA, branch: 'feat/x' });
  const gl = fakeRunner({ 'glab mr view 9': JSON.stringify({ sha: SHA, source_branch: 'feat/y' }) });
  assert.deepEqual(prHead('gitlab', 9, { runner: gl }), { sha: SHA, branch: 'feat/y' });
  const local = fakeRunner({ 'git rev-parse HEAD': 'b'.repeat(40), 'git rev-parse --abbrev-ref HEAD': 'main' });
  const failed = prHead('github', 9, { runner: local });
  assert.equal(failed.branch, null, 'a gh failure never falls back to this checkout: main is not the PR');
  assert.equal(failed.sha, null);
  assert.match(failed.why, /PR #9's head branch/);
  assert.ok(!local.calls.some((c) => c.startsWith('git')), 'git is not asked when a PR is named');
  assert.deepEqual(prHead('github', null, { runner: local }), { sha: 'b'.repeat(40), branch: 'main' });
  const detached = prHead('github', null, { runner: fakeRunner({ 'git rev-parse HEAD': 'b'.repeat(40), 'git rev-parse --abbrev-ref HEAD': 'HEAD' }) });
  assert.equal(detached.branch, null, 'a detached checkout has no branch, never "HEAD"');
  assert.match(detached.why, /detached/);
  const onMain = prHead('github', null, { runner: local, base: 'main' });
  assert.equal(onMain.branch, null, 'the default branch is no PR\'s branch');
  assert.match(onMain.why, /default branch \(main\), not the PR's$/, 'a fact; resolvePreview chooses the step');
});

test('resolvePreview: the pattern wins, the platform is the fallback, else local-only with why and the fix', () => {
  const head = { sha: SHA, branch: 'b' };
  const never = () => { throw new Error('the platform is not asked when the pattern answers'); };
  const noNet = fakeRunner({});
  assert.deepEqual(resolvePreview({ meta: { name: 'web', preview_url: 'https://pr-{pr}.x.dev' }, platform: 'github', pr: 4, runner: noNet, lookup: never }), { url: 'https://pr-4.x.dev', source: 'pattern' });
  assert.deepEqual(noNet.calls, [], 'a {pr} pattern answers with no call at all');
  const plat = () => ({ url: 'https://dep.x.dev' });
  assert.deepEqual(resolvePreview({ meta: { name: 'web' }, platform: 'github', pr: 4, head, lookup: plat }), { url: 'https://dep.x.dev', source: 'platform' });
  const none = () => ({ url: null, why: 'GitHub lists no preview deployment for this commit' });
  const r = resolvePreview({ meta: { name: 'web' }, platform: 'github', pr: 4, head, lookup: none });
  assert.equal(r.url, null);
  assert.equal(r.source, 'local-only');
  assert.match(r.why, /no preview_url pattern is recorded for this repo; GitHub lists no preview deployment/);
  assert.match(r.why, /set one with `yad repo preview <repo> <pattern>`/);
  const noPr = resolvePreview({ meta: { name: 'web', preview_url: 'https://pr-{pr}.x.dev' }, platform: 'github', pr: null, head, lookup: none });
  assert.match(noPr.why, /needs the PR number \(\{pr\}\), and none was given \(--pr\).* — pass --pr <n>$/);
  const badPat = resolvePreview({ meta: { name: 'web', preview_url: 'http://x.dev' }, platform: 'github', pr: 1, head, lookup: none });
  assert.match(badPat.why, /cannot be used: it must start with https.*set it again/);
  const outside = resolvePreview({ meta: null, platform: 'github', pr: 1, head, lookup: none });
  assert.match(outside.why, /register the repo/);
});

test('resolvePreview: on the default branch without --pr, one next step — pass --pr', () => {
  const onMain = fakeRunner({ 'git rev-parse HEAD': 'b'.repeat(40), 'git rev-parse --abbrev-ref HEAD': 'main' });
  const lookup = () => { throw new Error('no head, nothing to ask'); };
  for (const meta of [{ name: 'web', preview_url: 'https://pr-{pr}.x.dev' }, { name: 'web', preview_url: 'https://{branch}.x.dev' }, { name: 'web' }, { name: 'web', preview_url: 'http://x.dev' }]) {
    const r = resolvePreview({ meta, platform: 'github', pr: null, base: 'main', runner: onMain, lookup });
    assert.equal(r.source, 'local-only', JSON.stringify(meta));
    assert.equal(r.why.split(' — ').length, 2, `one next step: ${r.why}`);
    assert.match(r.why, / — pass --pr <n>$/, r.why);
  }
});

test('platformPreview (GitLab): a merge-request pipeline\'s deployment counts, whatever its commit', () => {
  const runner = fakeRunner({
    'glab api projects/:id/deployments?': deployments([
      { ref: 'feat/x', sha: 'c'.repeat(40), environment: { id: 3, name: 'review/feat-x' } },
      { ref: 'refs/merge-requests/7/head', sha: 'd'.repeat(40), environment: { id: 4, name: 'review/mr-7' } },
    ]),
    'glab api projects/:id/environments/4': JSON.stringify({ state: 'available', external_url: 'https://mr-7.review.x.dev' }),
  });
  assert.deepEqual(platformPreview('gitlab', { sha: SHA, branch: 'feat/x', pr: 7, runner }), { url: 'https://mr-7.review.x.dev' });
  assert.ok(!runner.calls.some((c) => c.endsWith('environments/3')), 'the branch deployment at another commit is still skipped');
  assert.match(platformPreview('gitlab', { sha: SHA, branch: 'feat/x', pr: 8, runner }).why, /no successful/, 'another MR\'s ref is not this one');
  assert.deepEqual(platformPreview('gitlab', { sha: SHA, branch: null, pr: 7, runner }), { url: 'https://mr-7.review.x.dev' }, 'no source branch: the MR ref still counts');
});

test('resolvePreview: GitLab without --pr, and a --pr that is not a number, both say pass --pr', () => {
  const head = { sha: SHA, branch: 'feat/x' };
  const none = () => ({ url: null, listedNone: true, why: 'GitLab lists no successful, running review deployment' });
  const gl = resolvePreview({ meta: { name: 'web' }, platform: 'gitlab', pr: null, head, lookup: none });
  assert.match(gl.why, /found only with --pr — pass --pr <n>$/);
  const glBroken = resolvePreview({ meta: { name: 'web', preview_url: 'http://x' }, platform: 'gitlab', pr: null, head, lookup: () => ({ url: null, listedNone: true, why: 'GitLab lists no successful, running review deployment' }) });
  assert.match(glBroken.why, /found only with --pr — set it again with `yad repo preview <repo> <pattern>`$/, 'a broken pattern is the fix to name first');
  const glDown = resolvePreview({ meta: { name: 'web' }, platform: 'gitlab', pr: null, head, lookup: () => ({ url: null, why: 'GitLab could not be asked for deployments (glab not signed in, offline, or no GitLab remote)' }) });
  assert.doesNotMatch(glDown.why, /found only with --pr/, '--pr would not help a GitLab that cannot be asked');
  assert.match(glDown.why, / — set one with `yad repo preview <repo> <pattern>`$/);
  const bad = resolvePreview({ meta: { name: 'web', preview_url: 'https://pr-{pr}.x.dev' }, platform: 'github', pr: 'abc', head, lookup: none });
  assert.match(bad.why, /--pr\) is not a number.* — pass --pr <n>$/);
  assert.equal(urlProblem(''), 'is not a URL');
});

test('resolvePreview: a {branch} pattern never fills from the wrong branch', () => {
  // gh offline, the reviewer on main: the old fallback answered https://main--web… as "the PR's preview".
  const runner = fakeRunner({ 'git rev-parse HEAD': 'b'.repeat(40), 'git rev-parse --abbrev-ref HEAD': 'main' });
  const lookup = () => { throw new Error('nothing to ask the platform about'); };
  const r = resolvePreview({ meta: { name: 'web', preview_url: 'https://{branch}--web.netlify.app' }, platform: 'github', pr: 12, runner, lookup });
  assert.equal(r.url, null);
  assert.equal(r.source, 'local-only');
  assert.match(r.why, /needs the PR's branch \(\{branch\}\), and it is not known: GitHub could not be asked for PR #12's head branch/);
  assert.equal((r.why.match(/head branch/g) || []).length, 1, 'the reason is said once');
  const ok = resolvePreview({ meta: { name: 'web', preview_url: 'https://{branch}--web.netlify.app' }, platform: 'github', pr: 12,
    runner: fakeRunner({ 'gh pr view 12': JSON.stringify({ headRefOid: SHA, headRefName: 'feat/cart' }) }), lookup });
  assert.deepEqual(ok, { url: 'https://feat-cart--web.netlify.app', source: 'pattern' });
});

test('previewLine: the filled pattern in angle brackets, else the note', () => {
  assert.equal(previewLine({ name: 'web', preview_url: 'https://{branch}.x.dev' }, { branch: 'feat/a' }), '<https://feat-a.x.dev>');
  assert.equal(previewLine({ name: 'web', preview_url: 'https://pr-{pr}.x.dev' }, { branch: 'feat/a' }), PREVIEW_UNFILLED, '{pr} is filled after the PR exists, never "none recorded"');
  assert.equal(previewLine({ name: 'web', preview_url: 'http://x.dev' }, {}), PREVIEW_UNUSABLE, 'an unusable pattern says so, never "none recorded"');
  assert.match(PREVIEW_UNUSABLE, /yad repo preview <repo> <pattern>/);
  assert.equal(previewLine({ name: 'web', preview_url: 'https://{branch}.x.dev' }, { branch: '///' }), PREVIEW_UNFILLED);
  assert.equal(previewLine({ name: 'web' }, {}), PREVIEW_NONE);
  assert.match(PREVIEW_NONE, /locally only/);
});

test('templateBody: the shipped templates carry the Preview line, and it is filled', () => {
  const T = tmp();
  try {
    for (const platform of ['github', 'gitlab']) {
      const body = templateBody(T, platform, { task: 'EP-a-S01-T01', risk: 'low', preview: '<https://pr.x.dev>' });
      assert.match(body, /## Testing\n<!--[^\n]*-->\n- \*\*Preview:\*\* <https:\/\/pr\.x\.dev>\n/, platform);
      assert.doesNotMatch(body, /\*\*Preview:\*\* none\n/);
      assert.match(templateBody(T, platform, { task: 'EP-a-S01-T01', risk: 'low' }), /\*\*Preview:\*\* none\n/, 'no preview given: the template is left as it is');
    }
  } finally { done(T); }
});

test('withPreviewLine: only the Testing section; an older template gets the line there; no Testing is left alone', () => {
  assert.equal(withPreviewLine('## Summary\nx\n\n## Testing\n<!-- how -->\nran it\n', 'P'), '## Summary\nx\n\n## Testing\n<!-- how -->\n- **Preview:** P\nran it\n');
  assert.equal(withPreviewLine('## Testing\r\nran it\r\n', 'P'), '## Testing\r\n- **Preview:** P\r\nran it\r\n', 'a CRLF template keeps CRLF');
  assert.equal(withPreviewLine('## Summary\nx\n', 'P'), '## Summary\nx\n');
  assert.equal(withPreviewLine('**Preview:** mine\n', 'P'), '**Preview:** mine\n', 'no Testing section: nothing is touched');
  assert.equal(withPreviewLine('## Testing\n- **Preview:** old\n', '$&'), '## Testing\n- **Preview:** $&\n', 'replaced in place, a $ kept');
  // The Summary comes from the commit and may hold a line of its own that reads the same.
  assert.equal(withPreviewLine('## Summary\n**Preview:** my notes\n\n## Testing\n- **Preview:** none\n\n## Checklist\n', 'P'),
    '## Summary\n**Preview:** my notes\n\n## Testing\n- **Preview:** P\n\n## Checklist\n');
  assert.equal(withPreviewLine('## Testing\nran it\n\n## Checklist\n- **Preview:** x\n', 'P'), '## Testing\n- **Preview:** P\nran it\n\n## Checklist\n- **Preview:** x\n', 'never past the next heading');
});

// A Product with one registered code repo on a task branch, pushable to a bare remote.
function productWithRepo(entry = {}) {
  const P = tmp();
  const bare = tmp();
  const R = path.join(P, 'web');
  git(bare, 'init', '-q', '--bare');
  fs.mkdirSync(R);
  git(R, 'init', '-q'); git(R, 'config', 'user.email', 'a@b.c'); git(R, 'config', 'user.name', 'x');
  git(R, 'config', 'commit.gpgsign', 'false');
  put(path.join(R, 'seed.txt'), '0'); git(R, 'add', '-A'); git(R, 'commit', '-q', '-m', 'feat: seed');
  git(R, 'branch', '-q', '-M', 'main'); git(R, 'remote', 'add', 'origin', bare);
  git(R, 'checkout', '-q', '-b', 'feat/EP-demo-S01-T01-cart');
  put(path.join(P, '.sdlc/repos.json'), { repos: [{ name: 'web', path: 'web', platform: 'github', default_branch: 'main', ...entry }] });
  return { P, R, bare };
}

test('runOpenPr: a {branch} pattern is in the body as the PR is opened', async () => {
  const { P, bare } = productWithRepo({ preview_url: 'https://{branch}.x.dev' });
  const prev = process.exitCode;
  try {
    let seen; let edited = false;
    const creator = (_p, o) => { seen = o; return { ok: true, url: 'https://github.com/o/r/pull/41' }; };
    await runOpenPr(P, { repo: 'web', platform: 'github', creator, editBody: () => { edited = true; return { ok: true }; }, runner: fakeRunner({}) });
    assert.match(seen.body, /\*\*Preview:\*\* <https:\/\/feat-ep-demo-s01-t01-cart\.x\.dev>/);
    assert.equal(edited, false, 'nothing to fill afterwards');
  } finally { process.exitCode = prev; done(P, bare); }
});

test('templateBody: a summary with a ## Testing of its own never takes the Preview line', () => {
  const T = tmp();
  try {
    const body = templateBody(T, 'github', { task: 'EP-a-S01-T01', risk: 'low', summary: 'fix x\n\n## Testing\nran it by hand', preview: '<https://p.x.dev>' });
    const summaryPart = body.slice(0, body.indexOf('## Impact'));
    assert.doesNotMatch(summaryPart, /Preview/, 'the summary is left as the commit wrote it');
    assert.match(body.slice(body.indexOf('## Impact')), /\*\*Preview:\*\* <https:\/\/p\.x\.dev>/);
  } finally { done(T); }
});

test('runOpenPr: a {pr} pattern is filled once the PR has its number', async () => {
  const { P, bare } = productWithRepo({ preview_url: 'https://pr-{pr}.x.dev' });
  const prev = process.exitCode;
  try {
    let seen; let edit;
    const creator = (_p, o) => { seen = o; return { ok: true, url: 'https://github.com/o/r/pull/41' }; };
    const editBody = (platform, n, body) => { edit = { platform, n, body }; return { ok: true }; };
    await runOpenPr(P, { repo: 'web', platform: 'github', creator, editBody, runner: fakeRunner({}) });
    assert.match(seen.body, /\*\*Preview:\*\* a preview_url pattern is recorded but could not be filled/, 'at open time the number is not known');
    assert.equal(edit.n, 41);
    assert.match(edit.body, /\*\*Preview:\*\* <https:\/\/pr-41\.x\.dev>/);
    assert.equal(edit.body.replace(/\*\*Preview:\*\*[^\n]*/, ''), seen.body.replace(/\*\*Preview:\*\*[^\n]*/, ''), 'only the Preview line changes');
  } finally { process.exitCode = prev; done(P, bare); }
});

test('runOpenPr: a failed edit is said, and the PR stays open; no pattern writes the note', async () => {
  const prev = process.exitCode;
  let { P, bare } = productWithRepo({ preview_url: 'https://pr-{pr}.x.dev' });
  try {
    process.exitCode = 0;
    const creator = () => ({ ok: true, url: 'https://github.com/o/r/pull/41' });
    const warned = [];
    const orig = console.log;
    console.log = (...a) => warned.push(a.join(' '));
    try { await runOpenPr(P, { repo: 'web', platform: 'github', creator, editBody: () => ({ ok: false, reason: 'boom' }), runner: fakeRunner({}) }); }
    finally { console.log = orig; }
    assert.ok(warned.some((l) => /Preview line could not be filled \(boom\).*pr-41\.x\.dev/.test(l)), warned.join('\n'));
    assert.ok(!process.exitCode, 'not a failure');
  } finally { process.exitCode = prev; done(P, bare); }
  ({ P, bare } = productWithRepo());
  try {
    let seen;
    await runOpenPr(P, { repo: 'web', platform: 'github', creator: (_p, o) => { seen = o; return { ok: true, url: 'https://github.com/o/r/pull/2' }; }, runner: fakeRunner({}) });
    assert.match(seen.body, /\*\*Preview:\*\* none recorded — a live design check runs locally only/);
  } finally { process.exitCode = prev; done(P, bare); }
});

test('runOpenPr: an unusable pattern warns and the body says a pattern is recorded; a template with no place skips the edit', async () => {
  const prev = process.exitCode;
  let { P, bare } = productWithRepo({ preview_url: 'http://x.dev' });
  let R;
  const quiet = async (fn) => { const out = []; const orig = console.log; console.log = (...a) => out.push(a.join(' ')); try { await fn(); } finally { console.log = orig; } return out.join('\n'); };
  try {
    let seen;
    const out = await quiet(() => runOpenPr(P, { repo: 'web', platform: 'github', creator: (_p, o) => { seen = o; return { ok: true, url: 'https://github.com/o/r/pull/3' }; }, runner: fakeRunner({}) }));
    assert.match(out, /preview_url pattern cannot be used: it must start with https/);
    assert.match(seen.body, /\*\*Preview:\*\* the recorded preview_url pattern cannot be used/);
  } finally { process.exitCode = prev; done(P, bare); }
  ({ P, R, bare } = productWithRepo({ preview_url: 'https://pr-{pr}.x.dev' }));
  try {
    put(path.join(R, '.github/pull_request_template.md'), '## Summary\n\n## Impact & Risk\n- **Risk level:** low\n\n## Checklist\n');
    let edited = false;
    const out = await quiet(() => runOpenPr(P, { repo: 'web', platform: 'github', creator: () => ({ ok: true, url: 'https://github.com/o/r/pull/8' }), editBody: () => { edited = true; return { ok: true }; }, runner: fakeRunner({}) }));
    assert.equal(edited, false, 'nothing to change: no edit is sent');
    assert.match(out, /no ## Testing section.*https:\/\/pr-8\.x\.dev/);
    assert.doesNotMatch(out, /✓ preview/);
  } finally { process.exitCode = prev; done(P, bare); }
});

test('runOpenPr: a PR URL with no readable number leaves the line unfilled and says so', async () => {
  const { P, bare } = productWithRepo({ preview_url: 'https://pr-{pr}.x.dev' });
  const prev = process.exitCode;
  try {
    let seen; let edited = false;
    const out = []; const orig = console.log; console.log = (...a) => out.push(a.join(' '));
    try { await runOpenPr(P, { repo: 'web', platform: 'github', creator: (_p, o) => { seen = o; return { ok: true, url: 'https://example.com/x' }; }, editBody: () => { edited = true; return { ok: true }; }, runner: fakeRunner({}) }); }
    finally { console.log = orig; }
    assert.equal(edited, false);
    assert.match(out.join('\n'), /left unfilled \(`yad review context --pr <n>` gives the address\)/);
    assert.ok(seen.body.includes(PREVIEW_UNFILLED));
  } finally { process.exitCode = prev; done(P, bare); }
});

test('review context: carries the preview — the pattern, or local-only with why', async () => {
  const { P, bare } = productWithRepo({ preview_url: 'https://pr-{pr}.x.dev' });
  try {
    const runner = fakeRunner({});
    const b = await reviewContext(P, { repo: 'web', pr: 12, runner });
    assert.deepEqual(b.preview, { url: 'https://pr-12.x.dev', source: 'pattern' });
    assert.ok(!runner.calls.some((c) => c.includes('deployments')), 'the pattern answers without asking the host');
  } finally { done(P, bare); }
  const other = productWithRepo();
  try {
    const runner = fakeRunner({ 'gh api': '[]' });
    const b = await reviewContext(other.P, { repo: 'web', pr: 12, runner });
    assert.equal(b.preview.source, 'local-only');
    assert.match(b.preview.why, /no preview_url pattern/);
  } finally { done(other.P, other.bare); }
});

test('yad repo preview: show, set, refuse a bad pattern, clear', () => {
  const { P, bare } = productWithRepo();
  try {
    const reg = () => JSON.parse(fs.readFileSync(path.join(P, '.sdlc/repos.json'), 'utf8')).repos[0];
    let r = yad(P, 'repo', 'preview', 'web', '--json');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).preview_url, null);
    r = yad(P, 'repo', 'preview', 'web', 'https://pr-{pr}.x.dev');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(reg().preview_url, 'https://pr-{pr}.x.dev');
    assert.match(r.stdout + r.stderr, /commit \.sdlc\/repos\.json/);
    const before = fs.readFileSync(path.join(P, '.sdlc/repos.json'), 'utf8');
    r = yad(P, 'repo', 'preview', 'web', 'http://pr-{pr}.x.dev');
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /must start with https:\/\/ .*nothing written/);
    assert.equal(fs.readFileSync(path.join(P, '.sdlc/repos.json'), 'utf8'), before, 'nothing written');
    r = yad(P, 'repo', 'preview', 'nope', 'https://x.dev');
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /unknown repo: nope/);
    r = yad(P, 'repo', 'preview', 'web', 'https://x.dev', '--clear');
    assert.equal(r.status, 1, 'a pattern and --clear together');
    r = yad(P, 'repo', 'preview', 'web', 'https://a', '--push');
    assert.equal(r.status, 1, '--push is refused, not ignored');
    assert.match(r.stdout + r.stderr, /--push does not apply/);
    r = yad(P, 'repo', 'preview', 'web', 'https://a', 'extra');
    assert.notEqual(r.status, 0, 'an extra word is refused');
    r = yad(P, 'repo', 'list', '--json');
    assert.equal(JSON.parse(r.stdout).repos[0].preview_url, 'https://pr-{pr}.x.dev');
    r = yad(P, 'repo', 'preview', 'web', '--clear');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!('preview_url' in reg()));
  } finally { done(P, bare); }
});

test('yad repo preview: a registry that does not parse is refused, never overwritten', () => {
  const P = tmp();
  try {
    put(path.join(P, '.sdlc/repos.json'), '{ broken');
    const r = yad(P, 'repo', 'preview', 'web', 'https://x.dev');
    assert.equal(r.status, 1);
    assert.equal(fs.readFileSync(path.join(P, '.sdlc/repos.json'), 'utf8'), '{ broken');
  } finally { done(P); }
});

test('doctor: repos:preview warns on an unusable pattern and is silent when none is recorded', () => {
  const rows = (entries) => { const checks = []; previewChecks(checks, entries); return checks; };
  assert.deepEqual(rows([{ name: 'web' }]), [], 'no pattern: nothing said');
  const okRow = rows([{ name: 'web', preview_url: 'https://pr-{pr}.x.dev' }]);
  assert.equal(okRow.length, 1);
  assert.equal(okRow[0].status, 'ok');
  const bad = rows([{ name: 'web', preview_url: 'http://x.dev' }, { name: 'api', preview_url: 'https://ok.dev' }]);
  assert.equal(bad[0].status, 'warn');
  assert.equal(bad[0].id, 'repos:preview');
  assert.match(bad[0].message, /web: it must start with https/);
  assert.match(bad[0].hint, /yad repo preview web <pattern>/);
});

test('skills: the review skills use review context\'s preview and say when the check ran locally only', () => {
  for (const s of ['yad-engineer-review', 'yad-review-companion', 'yad-pair-review']) {
    const text = fs.readFileSync(path.join(REPO, 'skills', s, 'SKILL.md'), 'utf8');
    assert.match(text, /`preview`/, s);
    assert.match(text, /locally only/, s);
    assert.match(text, /preview\.url/, s);
  }
  const connect = fs.readFileSync(path.join(REPO, 'skills/yad-connect-repos/SKILL.md'), 'utf8');
  assert.match(connect, /preview_url/);
  assert.match(connect, /yad repo preview/);
});
