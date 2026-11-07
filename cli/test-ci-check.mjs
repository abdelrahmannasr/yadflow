// E160b: `yad ci check`. The rules each test pins (the case list is in the E160 roadmap row):
//   - yad's CI files on disk: missing → `yad check --fix`, outdated → `yad update`, edited → ask, or `yad report`;
//   - the platform, on each default branch: protected (approvals by mode), the checks required before a merge
//     (GitHub: every job in REQUIRED_CHECKS, from the rulesets and classic protection; GitLab: "Pipelines must
//     succeed" and skipped pipelines), force pushes, deletion; suggestions for stale approvals, threads, and
//     signed commits on a code repo — and a gap when signed commits are required on the Product;
//   - a read that fails is `unknown` with its reason, never `ok`; nothing is written, and only GETs are made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ciCheck } = await import('./ci-check.mjs');
const { REQUIRED_CHECKS } = await import('./manifest.mjs');
const { repoActions, productActions } = await import('./plan.mjs');
const { classify, readAllowList } = await import('./agent-rules.mjs');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-ci-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const isCi = (item) => /^(\.github\/workflows\/|\.gitlab\/ci\/|checks\/)/.test(item) || item === '.sdlc/product-link.json';
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const ON = { ...process.env, YAD_PLATFORM_READ: '' };

// A workspace: the Product and one code repo beside it, each a git repo; yad's CI files written as yad
// writes them (unless `wire` is false).
function workspace({ platform = 'github', product = {}, repos, wire = true, clone = true, include = true } = {}) {
  const T = tmp();
  const root = path.join(T, 'product');
  fs.mkdirSync(root);
  execFileSync('git', ['init', '-q'], { cwd: root, env: { ...process.env, ...GIT_ENV } });
  const host = platform === 'github' ? 'github.com' : 'gitlab.com';
  put(path.join(root, '.sdlc/product.json'), { platform, git_url: `git@${host}:acme/p.git`, default_branch: 'main', ledger: 'verified', ...product });
  const list = repos ?? [{ name: 'app', path: '../app', platform, git_url: `git@${host}:acme/app.git`, default_branch: 'main' }];
  put(path.join(root, '.sdlc/repos.json'), { repos: list });
  if (clone) for (const r of list) { fs.mkdirSync(path.resolve(root, r.path), { recursive: true }); execFileSync('git', ['init', '-q'], { cwd: path.resolve(root, r.path), env: { ...process.env, ...GIT_ENV } }); }
  if (wire) {
    for (const a of productActions(root)) if (isCi(a.item) && a.status !== 'ok') a.apply();
    if (clone) for (const r of list) for (const a of repoActions(root, r)) if (isCi(a.item) && a.status !== 'ok') a.apply();
    // GitLab runs a fragment only when the root pipeline includes it.
    if (platform === 'gitlab' && include) {
      for (const dir of [root, ...(clone ? list.map((r) => path.resolve(root, r.path)) : [])]) {
        const frags = fs.existsSync(path.join(dir, '.gitlab/ci')) ? fs.readdirSync(path.join(dir, '.gitlab/ci')).map((f) => `.gitlab/ci/${f}`) : [];
        put(path.join(dir, '.gitlab-ci.yml'), `# yad\ninclude:\n${frags.map((f) => `  - local: '${f}'\n`).join('')}`);
      }
    }
  }
  return { T, root };
}
const done = (w) => fs.rmSync(w.T, { recursive: true, force: true });

// The platform CLIs, answered from an ordered list of [path regex, status, body]; everything asked is kept.
function fakePlatform({ installed = true, authed = true, calls = [] } = {}) {
  const asked = [];
  const runner = (cmd, args) => {
    asked.push([cmd, ...args].join(' '));
    if (cmd === 'which' || cmd === 'where') return { ok: installed, stdout: '', stderr: '' };
    if (args[0] === 'auth') return { ok: authed, stdout: '', stderr: '' };
    const p = args[args.length - 1];
    for (const [re, code, body] of calls) {
      if (!re.test(p)) continue;
      if (code === 200) return { ok: true, stdout: JSON.stringify(body), stderr: '' };
      const msg = typeof body?.message === 'string' ? body.message : `${code} Error`;
      return { ok: false, stdout: JSON.stringify(body ?? { message: msg }), stderr: cmd === 'gh' ? `gh: ${msg} (HTTP ${code})` : `glab: ${msg} (HTTP ${code})` };
    }
    return { ok: false, stdout: '', stderr: cmd === 'gh' ? 'gh: Not Found (HTTP 404)' : 'glab: 404 Not Found (HTTP 404)' };
  };
  return { runner, asked };
}

// GitHub, for one repo: the repo, its branch, the rules on the branch, and classic protection.
const PR_RULE = (n = 1, extra = {}) => ({ type: 'pull_request', parameters: { required_approving_review_count: n, dismiss_stale_reviews_on_push: true, ...extra } });
const CHECKS_RULE = (contexts, strict = true) => ({ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: strict, required_status_checks: contexts.map((context) => ({ context })) } });
const ALL_RULES = (jobs) => [PR_RULE(), CHECKS_RULE(jobs), { type: 'non_fast_forward' }, { type: 'deletion' }];
const NOT_PROTECTED = [404, { message: 'Branch not protected' }];
// `rules` is the list of rules; `rulesFail` a refused answer instead, as [status, body].
// `queue` is GraphQL's answer for the branch's merge queue (null: none), asked with the repo's name last.
function gh(repo, { rules, rulesFail = null, classic = NOT_PROTECTED, prot = true, queue = [200, { data: { repository: { mergeQueue: null } } }] } = {}) {
  const at = `repos/acme/${repo}`;
  return [
    [new RegExp(`^${at}$`), 200, { default_branch: 'main' }],
    [new RegExp(`^${at}/branches/main$`), 200, { protected: prot }],
    [new RegExp(`^${at}/rules/branches/main`), ...(rulesFail ?? [200, rules])],
    [new RegExp(`^${at}/branches/main/protection$`), ...classic],
    [new RegExp(`^name=${repo}$`), ...queue],
  ];
}
const productJobs = [...REQUIRED_CHECKS.github.product, ...REQUIRED_CHECKS.github.productVerified];
const allSet = () => [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [...ALL_RULES(REQUIRED_CHECKS.github.code), { type: 'required_signatures' }] })];
const byId = (r, name) => Object.fromEntries(r.repos.find((x) => x.name === name).findings.map((f) => [f.id, f]));
const check = (w, calls, opts = {}) => {
  const f = fakePlatform({ calls, ...opts.spec });
  return { r: ciCheck(w.root, { runner: f.runner, env: ON, ...opts }), asked: f.asked };
};

test('E160b case 1: everything set on GitHub — every row ok, complete, no gap', () => {
  const w = workspace();
  try {
    const { r } = check(w, allSet());
    for (const repo of r.repos) for (const f of repo.findings) assert.equal(f.status, 'ok', `${repo.name} ${f.id}: ${f.message}`);
    assert.deepEqual(r.repos.map((x) => x.name), ['Product', 'app']);
    assert.deepEqual(r.summary, { gaps: 0, suggestions: 0, unknown: 0, complete: true });
    assert.deepEqual(Object.keys(byId(r, 'app')).sort(), ['deletion', 'files', 'force-push', 'merge-queue', 'protected', 'required-checks', 'signed-commits', 'stale-approvals', 'up-to-date']);
  } finally { done(w); }
});

test('E160b case 2: a required job missing from the ruleset is a gap that names it, with the settings page', () => {
  const w = workspace();
  try {
    const jobs = REQUIRED_CHECKS.github.code.filter((j) => j !== 'contract-check' && j !== 'member-check');
    const { r } = check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: ALL_RULES(jobs) })]);
    const row = byId(r, 'app')['required-checks'];
    assert.equal(row.status, 'gap');
    assert.match(row.message, /not required before a merge: contract-check/);
    assert.equal(row.fix.actor, 'person');
    assert.equal(row.fix.url, 'https://github.com/acme/app/settings/rules');
    assert.match(row.fix.steps.join(' '), /Require status checks to pass.*contract-check/);
  } finally { done(w); }
});

test('E160b case 3: classic protection — read as an admin it counts; not readable and not covered by rulesets, it is unknown', () => {
  const w = workspace();
  try {
    const classic = { required_status_checks: { contexts: REQUIRED_CHECKS.github.code.slice(0, 5), checks: REQUIRED_CHECKS.github.code.slice(5).map((context) => ({ context })) },
      allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false }, required_pull_request_reviews: { dismiss_stale_reviews: true }, required_signatures: { enabled: true } };
    const admin = check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [PR_RULE()], classic: [200, classic] })]).r;
    for (const id of ['required-checks', 'force-push', 'deletion', 'stale-approvals', 'signed-commits']) assert.equal(byId(admin, 'app')[id].status, 'ok', id);
    // Not an admin: a bare 404. The rulesets hold only the pull request rule, so nothing else is proven.
    const notAdmin = check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [PR_RULE()], classic: [404, { message: 'Not Found' }] })]).r;
    const row = byId(notAdmin, 'app');
    for (const id of ['required-checks', 'force-push', 'deletion']) {
      assert.equal(row[id].status, 'unknown', id);
      assert.match(row[id].message, /readable by a repo admin only/, id);
    }
    assert.equal(notAdmin.summary.complete, false);
    // Not an admin, but the rulesets require every job and block both: proven without classic protection.
    const covered = check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: ALL_RULES(REQUIRED_CHECKS.github.code), classic: [404, { message: 'Not Found' }] })]).r;
    for (const id of ['required-checks', 'force-push', 'deletion', 'stale-approvals']) assert.equal(byId(covered, 'app')[id].status, 'ok', id);
  } finally { done(w); }
});

test('E160b case 4: force push or deletion allowed is a gap; a full page of rules proves nothing', () => {
  const w = workspace();
  try {
    const rules = [PR_RULE(), CHECKS_RULE(REQUIRED_CHECKS.github.code)];
    const { r } = check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules })]);
    assert.equal(byId(r, 'app')['force-push'].status, 'gap');
    assert.match(byId(r, 'app')['force-push'].fix.steps[0], /Block force pushes/);
    assert.equal(byId(r, 'app').deletion.status, 'gap');
    // Not protected at all: classic is proven absent, and so is every rule the list does not hold.
    const bare = check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [], prot: false })]).r;
    assert.equal(byId(bare, 'app').protected.status, 'gap');
    assert.equal(byId(bare, 'app')['force-push'].status, 'gap');
    // 100 rules came back and none blocks a force push: what is past the page is not known.
    const full = Array.from({ length: 100 }, () => ({ type: 'creation' }));
    const paged = check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [PR_RULE(), CHECKS_RULE(REQUIRED_CHECKS.github.code), ...full] })]).r;
    assert.equal(byId(paged, 'app')['force-push'].status, 'unknown');
    // The rules could not be read at all.
    const unread = check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rulesFail: [500, { message: 'boom' }] })]).r;
    assert.equal(byId(unread, 'app')['required-checks'].status, 'unknown');
  } finally { done(w); }
});

// GitLab, for one project: the project and its settings, the branch, protected branches, approvals, push rule.
// The project is in a person's own namespace unless `project.namespace` says a group's.
const NO_ONE = { name: 'main', allow_force_push: false, push_access_levels: [{ access_level: 0 }] };
function gl(repo, { project = {}, prot = true, protectedBranches = [NO_ONE], branchesFail = null, approvals = [200, { reset_approvals_on_push: true, merge_requests_author_approval: false, merge_requests_disable_committers_approval: true }], pushRule = [404, { message: '404 Not found' }] } = {}) {
  const at = `projects/acme%2F${repo}`;
  return [
    [new RegExp(`^${at}$`), 200, { default_branch: 'main', namespace: { kind: 'user' }, ci_config_path: '', only_allow_merge_if_pipeline_succeeds: true, allow_merge_on_skipped_pipeline: false, only_allow_merge_if_all_discussions_are_resolved: true, merge_trains_enabled: false, merge_pipelines_enabled: false, ...project }],
    [new RegExp(`^${at}/repository/branches/main$`), 200, { protected: prot }],
    [new RegExp(`^${at}/protected_branches`), ...(branchesFail ?? [200, protectedBranches])],
    [new RegExp(`^${at}/approval_rules`), 200, [{ name: 'All', rule_type: 'any_approver', approvals_required: 1, protected_branches: [] }]],
    [new RegExp(`^${at}/approvals$`), ...approvals],
    [new RegExp(`^${at}/push_rule$`), ...pushRule],
  ];
}

test('E160b case 5: GitLab — pipelines must succeed, skipped pipelines, threads, approval reset (Premium), force push', () => {
  const w = workspace({ platform: 'gitlab' });
  try {
    const good = check(w, [...gl('p'), ...gl('app', { pushRule: [200, { reject_unsigned_commits: true }] })]).r;
    for (const repo of good.repos) for (const f of repo.findings) assert.equal(f.status, 'ok', `${repo.name} ${f.id}: ${f.message}`);
    const { r } = check(w, [...gl('p'), ...gl('app', {
      project: { only_allow_merge_if_pipeline_succeeds: false, allow_merge_on_skipped_pipeline: true, only_allow_merge_if_all_discussions_are_resolved: false },
      protectedBranches: [{ ...NO_ONE, allow_force_push: true }], approvals: [403, { message: '403 Forbidden' }],
    })]);
    const row = byId(r, 'app');
    assert.equal(row['required-checks'].status, 'gap');
    assert.equal(row['required-checks'].fix.url, 'https://gitlab.com/acme/app/-/settings/merge_requests');
    assert.equal(row['skipped-pipelines'].status, 'gap');
    assert.equal(row.discussions.status, 'suggest');
    assert.equal(row['stale-approvals'].status, 'suggest', 'not Premium: a suggestion, never a gap');
    assert.match(row['stale-approvals'].message, /Premium/);
    assert.equal(row['force-push'].status, 'gap');
    assert.equal(row['signed-commits'].status, 'suggest');
    // Protected by a group's rule, which the project's list leaves out: not known.
    const group = check(w, [...gl('p'), ...gl('app', { protectedBranches: [] })]).r;
    assert.equal(byId(group, 'app')['force-push'].status, 'unknown');
    // A group's project: its own entry saying "no" proves nothing, since a group's rule wins over it.
    const inGroup = byId(check(w, [...gl('p'), ...gl('app', { project: { namespace: { kind: 'group' } } })]).r, 'app');
    assert.equal(inGroup['force-push'].status, 'unknown');
    assert.match(inGroup['force-push'].message, /group's protected-branch rule/);
    assert.equal(inGroup['direct-push'].status, 'unknown');
    // The protected branches could not be read.
    assert.equal(byId(check(w, [...gl('p'), ...gl('app', { branchesFail: [500, { message: '500' }] })]).r, 'app')['force-push'].status, 'unknown');
    // Not protected: force push and direct push are gaps; the default branch still cannot be deleted.
    const bare = check(w, [...gl('p'), ...gl('app', { prot: false, protectedBranches: [] })]).r;
    assert.equal(byId(bare, 'app')['force-push'].status, 'gap');
    assert.match(byId(bare, 'app')['force-push'].fix.steps[0], /protect main/);
    assert.equal(byId(bare, 'app')['direct-push'].status, 'gap');
    assert.equal(byId(bare, 'app').deletion.status, 'ok');
    assert.match(byId(bare, 'app').deletion.message, /default branch/);
  } finally { done(w); }
});

test('E160b case 6: no login, no CLI, reads off, or no platform — the platform rows are unknown with the reason', () => {
  const w = workspace();
  try {
    for (const [why, opts] of [['not logged in', { spec: { authed: false } }], ['not installed', { spec: { installed: false } }], ['turned off', { env: { ...ON, YAD_PLATFORM_READ: '0' } }]]) {
      const { r } = check(w, allSet(), opts);
      const row = byId(r, 'app');
      for (const id of ['protected', 'required-checks', 'force-push', 'deletion']) assert.equal(row[id].status, 'unknown', `${why}: ${id}`);
      assert.equal(row.files.status, 'ok', `${why}: the files are read from disk`);
      assert.equal(r.summary.complete, false, why);
    }
    // Read nothing: every row the repo would have is unknown, the suggestions too.
    const off = byId(check(w, allSet(), { env: { ...ON, YAD_PLATFORM_READ: '0' } }).r, 'Product');
    for (const id of ['protected', 'required-checks', 'force-push', 'deletion', 'stale-approvals', 'signed-commits']) assert.equal(off[id].status, 'unknown', id);
    for (const id of ['merge-queue', 'up-to-date']) assert.equal(off[id]?.status, 'unknown', `#433: ${id} is listed, unknown`);
    // GitLab: its merge rows too.
    const glw = workspace({ platform: 'gitlab' });
    try {
      const gloff = byId(check(glw, [], { env: { ...ON, YAD_PLATFORM_READ: '0' } }).r, 'app');
      for (const id of ['merge-trains', 'author-approval', 'committer-approval']) assert.equal(gloff[id]?.status, 'unknown', `#433: ${id} is listed, unknown`);
      assert.equal(gloff['merge-queue'], undefined, 'no GitHub row on GitLab');
    } finally { done(glw); }
    // No platform at all: nothing holds a merge there — one `platform` row, unknown, never a quiet ok.
    const none = workspace({ product: { platform: null, git_url: null }, repos: [] });
    try {
      const { r } = check(none, []);
      assert.deepEqual(Object.keys(byId(r, 'Product')), ['files', 'platform']);
      assert.equal(byId(r, 'Product').platform.status, 'unknown');
      assert.equal(r.summary.complete, false);
    } finally { done(none); }
  } finally { done(w); }
});

test('E160b case 7: yad\'s files missing, older, or edited — each with its next step', () => {
  const w = workspace({ wire: false });
  try {
    const missing = byId(check(w, allSet()).r, 'app').files;
    assert.equal(missing.status, 'gap');
    assert.deepEqual(missing.fix.commands, ['yad check --fix']);
    for (const a of repoActions(w.root, { name: 'app', path: '../app', platform: 'github' })) if (isCi(a.item)) a.apply();
    fs.appendFileSync(path.join(w.root, '../app/.github/workflows/yad-checks.yml'), '\n# changed\n');
    const outdated = byId(check(w, allSet()).r, 'app').files;
    assert.equal(outdated.status, 'gap');
    assert.match(outdated.message, /older than this yadflow: \.github\/workflows\/yad-checks\.yml/);
    assert.deepEqual(outdated.fix.commands, ['yad update']);
    // The ledger says yad wrote other content there: the team edited yad's file. Never "edit it".
    put(path.join(w.root, '../app/.sdlc/managed.json'), { files: { '.github/workflows/yad-checks.yml': 'a-sha-yad-wrote-before' } });
    const edited = byId(check(w, allSet()).r, 'app').files;
    assert.equal(edited.status, 'gap');
    assert.match(edited.message, /edited by hand: \.github\/workflows\/yad-checks\.yml/);
    assert.match(edited.fix.steps.join(' '), /Ask the person first.*yad report.*do not edit it/);
    // Not cloned here: not read, with the command that clones it.
    fs.rmSync(path.join(w.root, '../app'), { recursive: true, force: true });
    const gone = byId(check(w, allSet()).r, 'app').files;
    assert.equal(gone.status, 'unknown');
    assert.deepEqual(gone.fix.commands, ['yad repo clone app']);
  } finally { done(w); }
});

test('E160b case 8: one repo by name, an unknown name, and the default from the Product vs a code repo (CLI)', () => {
  // The code repo inside the Product's folder, so `yad` finds the Product from it (a workspace file beside
  // them is not read in a temp folder).
  const w = workspace({ repos: [{ name: 'app', path: 'app', platform: 'github', git_url: 'git@github.com:acme/app.git', default_branch: 'main' }] });
  try {
    const one = check(w, allSet(), { repo: 'app' }).r;
    assert.deepEqual(one.repos.map((x) => x.name), ['app']);
    const nope = ciCheck(w.root, { repo: 'nope', env: { ...ON, YAD_PLATFORM_READ: '0' } });
    assert.deepEqual([nope.unknownRepo, nope.names], ['nope', ['app']]);
    const yad = (cwd, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin/yad.mjs'), 'ci', 'check', '--json', ...args], { cwd, env: { ...process.env, NO_COLOR: '1', YAD_PLATFORM_READ: '0' }, encoding: 'utf8' });
    const fromProduct = JSON.parse(yad(w.root).stdout);
    assert.equal(fromProduct.command, 'ci check');
    assert.deepEqual(fromProduct.repos.map((x) => x.name), ['Product', 'app']);
    const fromRepo = JSON.parse(yad(path.join(w.root, 'app')).stdout);
    assert.deepEqual(fromRepo.repos.map((x) => x.name), ['app'], 'inside a code repo: that repo');
    assert.deepEqual(JSON.parse(yad(path.join(w.root, 'app'), '--all').stdout).repos.map((x) => x.name), ['Product', 'app']);
    const refused = yad(w.root, '--repo', 'nope');
    assert.equal(refused.status, 1);
    assert.match(JSON.parse(refused.stdout).error, /no repo named nope is registered/);
    assert.match(JSON.parse(yad(w.root, '--repo', 'app', '--all').stdout).error, /--repo and --all/);
  } finally { done(w); }
});

test('E160b case 9: REQUIRED_CHECKS equals the jobs in yad\'s workflow templates and the table in docs/branch-protection.md', () => {
  const jobs = (file, re) => [...fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(re)].map((m) => m[1]);
  const ghJob = /^ {2}([a-z][a-z0-9-]*):$/gm;
  const glJob = /^(yad-[a-z0-9-]+):$/gm;
  // pr-title and pr-template run from their own file on GitHub (#425), so a list is the jobs of both files.
  const sorted = (a) => [...a].sort();
  const gh = (...files) => sorted(files.flatMap((f) => jobs(`skills/yad-checks/templates/github/${f}`, ghJob)));
  assert.deepEqual(gh('yad-checks.yml', 'yad-pr-text.yml'), sorted(REQUIRED_CHECKS.github.code));
  assert.deepEqual(gh('yad-product-checks.yml', 'yad-product-pr-text.yml'), sorted(REQUIRED_CHECKS.github.product));
  assert.deepEqual(jobs('skills/yad-checks/templates/github/yad-verified-commits.yml', ghJob), REQUIRED_CHECKS.github.productVerified);
  assert.deepEqual(jobs('skills/yad-checks/templates/gitlab/yad-checks.gitlab-ci.yml', glJob), REQUIRED_CHECKS.gitlab.code);
  assert.deepEqual(jobs('skills/yad-checks/templates/gitlab/yad-product-checks.gitlab-ci.yml', glJob), REQUIRED_CHECKS.gitlab.product);
  assert.deepEqual(jobs('skills/yad-checks/templates/gitlab/yad-verified-commits.gitlab-ci.yml', glJob), REQUIRED_CHECKS.gitlab.productVerified);
  // No job sets `name:`, so GitHub names each check after its job.
  for (const f of ['yad-checks.yml', 'yad-pr-text.yml', 'yad-product-checks.yml', 'yad-product-pr-text.yml', 'yad-verified-commits.yml']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'skills/yad-checks/templates/github', f), 'utf8'), /^ {4}name:/m, f);
  const doc = fs.readFileSync(path.join(ROOT, 'docs/branch-protection.md'), 'utf8');
  const row = (label) => [...doc.split('\n').find((l) => l.startsWith(`| ${label} |`)).split('|')[3].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(row('Product'), REQUIRED_CHECKS.github.product);
  assert.deepEqual(row('Product, when the file is there'), REQUIRED_CHECKS.github.productVerified);
  assert.deepEqual(row('Each code repo'), REQUIRED_CHECKS.github.code);
  const glText = doc.slice(doc.indexOf('The checks run as jobs in the merge request pipeline'));
  for (const j of [...REQUIRED_CHECKS.gitlab.product, ...REQUIRED_CHECKS.gitlab.productVerified, ...REQUIRED_CHECKS.gitlab.code]) assert.ok(glText.includes(`\`${j}\``), j);
});

test('E160b case 10: never writes — the folders are unchanged, and every platform call is a GET or a GraphQL query', () => {
  const w = workspace();
  try {
    const snap = (dir) => execFileSync('find', [dir, '-type', 'f', '-not', '-path', '*/.git/*', '-exec', 'shasum', '{}', '+'], { encoding: 'utf8' }).split('\n').sort().join('\n');
    const before = snap(path.dirname(w.root));
    const { asked } = check(w, allSet());
    assert.equal(snap(path.dirname(w.root)), before);
    // #433: the merge queue is read through GraphQL, which gh sends as a POST: a read-only query, never a mutation.
    const graphql = (call) => / graphql -f query=query\(/.test(call) && !/mutation/.test(call) && !/(-X|--method|--input)/.test(call);
    assert.ok(asked.some(graphql), 'the merge queue is asked');
    for (const call of asked) if (!graphql(call)) assert.doesNotMatch(call, /(-X|--method)\s+(?!GET)|--field|-f |--input/, call);
    assert.ok(asked.some((x) => x.includes('rules/branches/main')));
  } finally { done(w); }
});

test('E160b case 11: "Require signed commits" — a gap on the Product, a suggestion on a code repo', () => {
  const w = workspace();
  try {
    const signedRule = { type: 'required_signatures' };
    const { r } = check(w, [...gh('p', { rules: [...ALL_RULES(productJobs), signedRule] }), ...gh('app', { rules: ALL_RULES(REQUIRED_CHECKS.github.code) })]);
    assert.equal(byId(r, 'Product')['signed-commits'].status, 'gap');
    assert.match(byId(r, 'Product')['signed-commits'].message, /unsigned commits/);
    assert.match(byId(r, 'Product')['signed-commits'].fix.steps[0], /turn off/);
    assert.equal(byId(r, 'app')['signed-commits'].status, 'suggest');
    assert.match(byId(r, 'app')['signed-commits'].fix.steps[0], /turn on/);
    // A Product with a local ledger writes no bot commits: not asked.
    const local = workspace({ product: { ledger: 'local' } });
    try {
      const lr = check(local, [...gh('p', { rules: [] }), ...gh('app', { rules: ALL_RULES(REQUIRED_CHECKS.github.code) })]).r;
      assert.equal(byId(lr, 'Product')['signed-commits'], undefined);
      assert.equal(byId(lr, 'Product')['required-checks'], undefined, 'no yad CI on the Product: no checks to require');
    } finally { done(local); }
  } finally { done(w); }
});

test('E160b case 12: `ci check` is a read the agent runs without asking; solo mode reads approvals the other way', () => {
  assert.equal(classify(['ci', 'check']), 'read');
  assert.equal(classify(['ci']), 'read', 'its default action');
  assert.ok(readAllowList().includes('Bash(yad ci check:*)'));
  const w = workspace({ product: { solo: true } });
  try {
    // Classic protection read (as an admin) and holding no review rule: zero approvals is then proven.
    const one = (n) => [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [PR_RULE(n), CHECKS_RULE(REQUIRED_CHECKS.github.code), { type: 'non_fast_forward' }, { type: 'deletion' }], classic: [200, {}] })];
    const blocks = byId(check(w, one(1)).r, 'app');
    assert.equal(blocks.protected.status, 'gap');
    assert.match(blocks.protected.message, /solo mode/);
    assert.equal(blocks['stale-approvals'], undefined, 'solo: no approvals to dismiss');
    assert.equal(byId(check(w, one(0)).r, 'app').protected.status, 'ok');
    // Classic protection not readable: zero approvals cannot be proven, so it is not known.
    const hidden = [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [PR_RULE(0)], classic: [404, { message: 'Not Found' }] })];
    assert.equal(byId(check(w, hidden).r, 'app').protected.status, 'unknown');
  } finally { done(w); }
});

test('E160b round 1: a protection GitHub\'s answers disagree about is not known; the bot\'s steps on a verified Product', () => {
  const w = workspace();
  try {
    // The branch flag says "not protected" while GitHub lists an active rule on it.
    const odd = byId(check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [{ type: 'deletion' }], prot: false })]).r, 'app');
    assert.equal(odd.protected.status, 'unknown');
    // The Product's checks: the steps say to put the gate token's owner on the bypass list.
    const product = byId(check(w, [...gh('p', { rules: [PR_RULE(), { type: 'non_fast_forward' }, { type: 'deletion' }] }), ...gh('app', { rules: ALL_RULES(REQUIRED_CHECKS.github.code) })]).r, 'Product');
    assert.equal(product['required-checks'].status, 'gap');
    assert.match(product['required-checks'].fix.steps.join(' '), /bypass list/);
    // Turning "Require signed commits" off names the classic protection page too.
    const signed = byId(check(w, [...gh('p', { rules: [...ALL_RULES(productJobs), { type: 'required_signatures' }] }), ...gh('app', { rules: ALL_RULES(REQUIRED_CHECKS.github.code) })]).r, 'Product');
    assert.match(signed['signed-commits'].fix.steps[0], /settings\/branches/);
    // Classic protection that lets admins bypass: the ok says so.
    const admins = byId(check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [PR_RULE()], classic: [200, { required_status_checks: { contexts: REQUIRED_CHECKS.github.code }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false }, enforce_admins: { enabled: false } }] })]).r, 'app');
    assert.equal(admins['required-checks'].status, 'ok');
    assert.match(admins['required-checks'].message, /admins bypass/);
  } finally { done(w); }
});

test('E160b round 1: GitLab — yad\'s jobs must be in the root pipeline; direct push; the gate token on a verified Product', () => {
  const w = workspace({ platform: 'gitlab', include: false });
  try {
    const calls = [...gl('p'), ...gl('app')];
    const files = byId(check(w, calls).r, 'app').files;
    assert.equal(files.status, 'gap', 'no root .gitlab-ci.yml: no yad job runs');
    assert.match(files.message, /there is no \.gitlab-ci\.yml/);
    put(path.join(w.root, '../app/.gitlab-ci.yml'), "include:\n  # - local: '.gitlab/ci/yad-checks.yml'\n  - local: '.gitlab/ci/yad-update-guard.yml'\n");
    const partial = byId(check(w, calls).r, 'app').files;
    assert.equal(partial.status, 'gap', 'a commented-out include does not count');
    assert.match(partial.message, /does not include \.gitlab\/ci\/yad-checks\.yml/);
    assert.match(partial.fix.steps[0], /under its top-level `include:`/);
    assert.ok(partial.fix.steps.some((x) => x.startsWith("- local: '.gitlab/ci/yad-checks.yml'")));
    // Maintainers may push straight to main: a gap on a code repo (a suggestion in solo mode).
    const push = byId(check(w, [...gl('p'), ...gl('app', { protectedBranches: [{ ...NO_ONE, push_access_levels: [{ access_level: 40 }] }] })]).r, 'app')['direct-push'];
    assert.equal(push.status, 'gap');
    assert.match(push.fix.steps[0], /No one/);
    // A verified Product: its gate token must push, so direct push is not asked, and the protect step says so.
    const product = byId(check(w, [...gl('p', { prot: false, protectedBranches: [] }), ...gl('app')]).r, 'Product');
    assert.equal(product['direct-push'], undefined);
    assert.match(product.protected.fix.steps[0], /gate token \(SDLC_GATE_TOKEN\)/);
  } finally { done(w); }
});

test('E160b round 1: a refused registry entry says why; a gap exits 1 under --json', () => {
  const w = workspace({ repos: [{ name: 'far', path: '../../far', platform: 'github', git_url: 'git@github.com:acme/far.git' }], clone: false });
  try {
    const far = byId(check(w, []).r, 'far').files;
    assert.equal(far.status, 'unknown');
    assert.match(far.message, /outside the workspace/);
    assert.equal(far.fix, undefined, 'no clone command for an entry yad refuses');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/yad.mjs'), 'ci', 'check', '--json'], { cwd: w.root, env: { ...process.env, NO_COLOR: '1', YAD_PLATFORM_READ: '0' }, encoding: 'utf8' });
    fs.rmSync(path.join(w.root, '.github'), { recursive: true, force: true });
    const gap = spawnSync(process.execPath, [path.join(ROOT, 'bin/yad.mjs'), 'ci', 'check', '--json'], { cwd: w.root, env: { ...process.env, NO_COLOR: '1', YAD_PLATFORM_READ: '0' }, encoding: 'utf8' });
    assert.equal(r.status, 0, 'unknown rows alone do not fail the run');
    assert.equal(gap.status, 1, 'a missing file is a gap');
    assert.equal(JSON.parse(gap.stdout).ok, false);
  } finally { done(w); }
});

test('E160b round 2: GitLab — an entry with no platform, a custom CI file, a full page of rules, rules that disagree', () => {
  const w = workspace({ platform: 'gitlab' });
  try {
    // The entry names no platform; GitLab is told from the URL. yad wired no GitLab files: a gap, never ok.
    const reg = path.join(w.root, '.sdlc/repos.json');
    const entry = JSON.parse(fs.readFileSync(reg, 'utf8')).repos[0];
    put(reg, { repos: [{ ...entry, platform: null }] });
    const unnamed = byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files;
    assert.equal(unnamed.status, 'gap');
    assert.match(unnamed.fix.steps[0], /"platform": "gitlab"/);
    put(reg, { repos: [entry] });
    // The project runs another CI file: the root one is not what GitLab reads.
    const custom = byId(check(w, [...gl('p'), ...gl('app', { project: { ci_config_path: 'ci/main.yml' } })]).r, 'app').files;
    assert.equal(custom.status, 'gap');
    assert.match(custom.message, /no ci\/main\.yml/);
    put(path.join(w.root, '../app/ci/main.yml'), fs.readFileSync(path.join(w.root, '../app/.gitlab-ci.yml'), 'utf8'));
    assert.equal(byId(check(w, [...gl('p'), ...gl('app', { project: { ci_config_path: 'ci/main.yml' } })]).r, 'app').files.status, 'ok');
    assert.equal(byId(check(w, [...gl('p'), ...gl('app', { project: { ci_config_path: 'ci.yml@acme/shared' } })]).r, 'app').files.status, 'unknown', 'a CI file in another project');
    // A fragment named only in a trailing comment does not count; the steps give one YAML line per file.
    put(path.join(w.root, '../app/.gitlab-ci.yml'), "include:\n  - local: '.gitlab/ci/yad-update-guard.yml'\nstages: [test] # .gitlab/ci/yad-checks.yml\n");
    const trailing = byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files;
    assert.equal(trailing.status, 'gap');
    assert.ok(trailing.fix.steps.some((x) => x.startsWith("- local: '.gitlab/ci/yad-checks.yml'")));
    // 100 protected branches: page one says "No one" and no force push, but page two could say otherwise.
    const many = [NO_ONE, ...Array.from({ length: 99 }, (_, i) => ({ name: `rel-${i}`, allow_force_push: false, push_access_levels: [{ access_level: 0 }] }))];
    const full = byId(check(w, [...gl('p'), ...gl('app', { protectedBranches: many })]).r, 'app');
    assert.equal(full['force-push'].status, 'unknown');
    assert.equal(full['direct-push'].status, 'unknown');
    // Two rules match main and disagree about force push: which one applies is not read.
    const mixed = byId(check(w, [...gl('p'), ...gl('app', { protectedBranches: [NO_ONE, { ...NO_ONE, name: 'ma*', allow_force_push: true }] })]).r, 'app');
    assert.equal(mixed['force-push'].status, 'unknown');
  } finally { done(w); }
});

test('E160b round 2: each platform path is asked once per repo', () => {
  const w = workspace();
  try {
    const { asked } = check(w, allSet());
    const api = asked.filter((x) => x.startsWith('gh api'));
    assert.equal(new Set(api).size, api.length, api.join('\n'));
  } finally { done(w); }
});

test('E160b round 3: an unread CI file setting, a path named outside an include, a verified Product with no platform, admins on classic protection', () => {
  const w = workspace({ platform: 'gitlab' });
  try {
    // The project's settings were not read, or the answer left the CI file setting out: not "the default".
    const at = /^projects\/acme%2Fapp$/;
    const noKey = gl('app').map((c) => (c[0].source === at.source ? [c[0], 200, { default_branch: 'main', namespace: { kind: 'user' }, only_allow_merge_if_pipeline_succeeds: true }] : c));
    const unread = byId(check(w, [...gl('p'), ...noKey]).r, 'app').files;
    assert.equal(unread.status, 'unknown');
    assert.match(unread.message, /settings were not read/);
    // The path appears in a script line, not in an include: GitLab runs none of those jobs.
    put(path.join(w.root, '../app/.gitlab-ci.yml'), "include:\n  - local: '.gitlab/ci/yad-update-guard.yml'\ncheck:\n  script: cat .gitlab/ci/yad-checks.yml\n");
    const scripted = byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files;
    assert.equal(scripted.status, 'gap');
    // Every include form yad reads: a list item, a local: value, a bare quoted path.
    put(path.join(w.root, '../app/.gitlab-ci.yml'), "include:\n  - local: \"/.gitlab/ci/yad-update-guard.yml\"\n  - '.gitlab/ci/yad-checks.yml'\n");
    assert.equal(byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files.status, 'ok');
  } finally { done(w); }
  // A Product asked to keep a verified ledger, with no platform set: yad wired none of its CI.
  const p = workspace({ product: { platform: null }, repos: [] });
  try {
    const files = byId(check(p, gh('p', { rules: [] })).r, 'Product').files;
    assert.equal(files.status, 'gap');
    assert.match(files.fix.steps[0], /"platform": "github"/);
  } finally { done(p); }
  // Classic protection that lets admins bypass: the force-push and deletion oks say so.
  const g = workspace();
  try {
    const classic = { required_status_checks: { contexts: REQUIRED_CHECKS.github.code }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false }, enforce_admins: { enabled: false } };
    const row = byId(check(g, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: [PR_RULE()], classic: [200, classic] })]).r, 'app');
    for (const id of ['force-push', 'deletion']) assert.match(row[id].message, /admins bypass/, id);
  } finally { done(g); }
});

test('E160b round 4: only the top-level include counts — not a child pipeline, rules: changes, another project, a text block', () => {
  const w = workspace({ platform: 'gitlab' });
  const file = (text) => { put(path.join(w.root, '../app/.gitlab-ci.yml'), text); return byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files; };
  const guard = "include:\n  - local: '.gitlab/ci/yad-update-guard.yml'\n";
  try {
    for (const [why, text] of [
      ['a child pipeline', `${guard}yad-child:\n  trigger:\n    include:\n      - local: .gitlab/ci/yad-checks.yml\n`],
      ['rules: changes', `${guard}job:\n  rules:\n    - changes:\n      - .gitlab/ci/yad-checks.yml\n`],
      ['another project\'s file', `${guard}  - project: other/x\n    file:\n      - .gitlab/ci/yad-checks.yml\n`],
      ['another project, with a local: key too', `${guard}  - project: other/x\n    local: .gitlab/ci/yad-checks.yml\n`],
      ['-local: with no space (a key named -local)', `${guard}  -local: .gitlab/ci/yad-checks.yml\n`],
      ['a text block', `${guard}job:\n  script:\n    - |\n      .gitlab/ci/yad-checks.yml\n`],
    ]) assert.equal(file(text).status, 'gap', why);
    // Included only under its own rules: whether it runs is not known.
    const gated = file(`${guard}  - local: .gitlab/ci/yad-checks.yml\n    rules:\n      - if: $CI_PIPELINE_SOURCE == "push"\n`);
    assert.equal(gated.status, 'unknown');
    assert.match(gated.message, /only under its own `rules:`/);
    // A list at the key's own column.
    assert.equal(file("include:\n- local: .gitlab/ci/yad-update-guard.yml\n- .gitlab/ci/yad-checks.yml\nstages: [test]\n").status, 'ok');
    // Two top-level include keys: GitLab keeps only the last, so it is not known.
    const twice = file("include:\n  - local: .gitlab/ci/yad-checks.yml\n  - local: .gitlab/ci/yad-update-guard.yml\nstages: [a]\ninclude:\n  - local: other.yml\n");
    assert.equal(twice.status, 'unknown');
    assert.match(twice.message, /two top-level `include:` keys/);
  } finally { done(w); }
});

test('E160b round 5: the map form of include; the admin note only when classic protection is the block; a verified Product with no platform at all', () => {
  const w = workspace({ platform: 'gitlab', repos: [{ name: 'app', path: '../app', platform: 'gitlab', git_url: 'git@gitlab.com:acme/app.git', default_branch: 'main' }] });
  try {
    // yad's code repo has two fragments; the map form takes one `local:`, so name the other in a list item first.
    put(path.join(w.root, '../app/.gitlab-ci.yml'), "include:\n  local: .gitlab/ci/yad-checks.yml\n");
    const map = byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files;
    assert.equal(map.status, 'gap', 'the map form names one file: the other is missing');
    assert.match(map.message, /yad-update-guard/);
    assert.doesNotMatch(map.message, /yad-checks\.yml/, 'the map form\'s file counts');
    put(path.join(w.root, '../app/.gitlab-ci.yml'), "include:\n  local: .gitlab/ci/yad-checks.yml\n  rules:\n    - if: $X\n");
    assert.match(byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files.message, /yad-update-guard/, 'still missing the other one');
  } finally { done(w); }
  const g = workspace();
  try {
    // A ruleset blocks force pushes and deletion; classic protection lets admins bypass. The ruleset holds them.
    const classic = { required_status_checks: { contexts: REQUIRED_CHECKS.github.code }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false }, enforce_admins: { enabled: false } };
    const row = byId(check(g, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: ALL_RULES(REQUIRED_CHECKS.github.code), classic: [200, classic] })]).r, 'app');
    for (const id of ['force-push', 'deletion']) {
      assert.equal(row[id].status, 'ok', id);
      assert.doesNotMatch(row[id].message, /admins bypass/, id);
    }
  } finally { done(g); }
  // Verified asked for, no platform set and none in the git URL: files ok (kept locally), platform unknown.
  const none = workspace({ product: { platform: null, git_url: null }, repos: [] });
  try {
    const r = byId(check(none, []).r, 'Product');
    assert.equal(r.files.status, 'ok');
    assert.match(r.files.message, /set to verified, but with no platform set it is kept locally/);
    assert.equal(r.platform.status, 'unknown');
  } finally { done(none); }
});

test('E160b round 5: a list item with its own rules is gated', () => {
  const w = workspace({ platform: 'gitlab' });
  try {
    put(path.join(w.root, '../app/.gitlab-ci.yml'), "include:\n  - local: .gitlab/ci/yad-update-guard.yml\n  - local: .gitlab/ci/yad-checks.yml\n    rules:\n      - if: $X\n");
    assert.equal(byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files.status, 'unknown');
  } finally { done(w); }
});

test('E160b round 6: the fix lines are pure YAML; the map form is named; a repo with no platform anywhere', () => {
  const w = workspace({ platform: 'gitlab' });
  try {
    put(path.join(w.root, '../app/.gitlab-ci.yml'), "include:\n  local: .gitlab/ci/yad-checks.yml\n");
    const map = byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files;
    assert.match(map.fix.steps[0], /exactly as written \(quotes and braces too\)/);
    assert.match(map.fix.steps[0], /every other line of it moves two more spaces in/);
    assert.doesNotMatch(map.fix.steps[0], /- local: '<|'<that value>'/, 'never new quotes, never a new kind');
    for (const line of map.fix.steps.filter((x) => x.startsWith('- local:'))) assert.match(line, /^- local: '[^']+'$/, line);
    fs.rmSync(path.join(w.root, '../app/.gitlab-ci.yml'));
    const none = byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files;
    assert.match(none.fix.steps[0], /^Create \.gitlab-ci\.yml/);
    assert.doesNotMatch(none.fix.steps.join(' '), /already there/);
  } finally { done(w); }
  const x = workspace({ repos: [{ name: 'app', path: '../app', git_url: 'git@git.example.org:acme/app.git', default_branch: 'main' }] });
  try {
    const row = byId(check(x, gh('p', { rules: ALL_RULES(productJobs) })).r, 'app');
    assert.equal(row.files.status, 'unknown', 'gate scripts with no workflow are not an ok');
    assert.equal(row.platform.status, 'unknown');
  } finally { done(x); }
});

test('E160b round 9: an include written in [ ] or { } (flow style) is not read — unknown, with no rewrite step', () => {
  const w = workspace({ platform: 'gitlab' });
  try {
    for (const text of ["include: ['.gitlab/ci/yad-update-guard.yml', other.yml]\n", 'include: {local: other.yml}\n',
      'include:\n  [a.yml, b.yml]\n', 'include:\n  {local: a.yml}\n', 'include:\n- [a.yml]\n', 'include:\n  -\n    {local: a.yml}\n', 'include:\n-\n  [a.yml]\n', "include:\n  - local: '.gitlab/ci/yad-update-guard.yml'\n  - {local: a.yml}\n"]) {
      put(path.join(w.root, '../app/.gitlab-ci.yml'), text);
      const row = byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files;
      assert.equal(row.status, 'unknown', text);
      assert.match(row.message, /flow style/, text);
      assert.doesNotMatch(row.fix.steps.join(' '), /- local:/, 'no rewrite to get wrong');
    }
  } finally { done(w); }
});

test('E160b round 11: a list item whose dash stands alone is read from its next line', () => {
  const w = workspace({ platform: 'gitlab' });
  try {
    put(path.join(w.root, '../app/.gitlab-ci.yml'), "include:\n  -\n    local: .gitlab/ci/yad-update-guard.yml\n  -\n    '.gitlab/ci/yad-checks.yml'\n");
    assert.equal(byId(check(w, [...gl('p'), ...gl('app')]).r, 'app').files.status, 'ok');
  } finally { done(w); }
});

// #424: with no limit, GitHub stops a stuck job after 6 hours and GitLab at the project's default (1 hour
// unless changed) — a team pays for that runner time. Every job in every CI file yad installs, and in the
// docs workflow it generates, sets its own limit.
test('#424: every job in every CI file yad installs has a time limit', async () => {
  const { pagesWorkflow } = await import('../cli/docs.mjs');
  const files = [];
  for (const dir of ['skills/yad-checks/templates/github', 'skills/yad-product-bridge/templates/github',
    'skills/yad-checks/templates/gitlab', 'skills/yad-product-bridge/templates/gitlab']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (!/\.ya?ml$/.test(f) || f.startsWith('gitlab-ci.include-root')) continue;
      files.push({ name: `${dir}/${f}`, text: fs.readFileSync(path.join(ROOT, dir, f), 'utf8'), gitlab: dir.endsWith('gitlab') });
    }
  }
  // This repo's own workflows too.
  for (const f of fs.readdirSync(path.join(ROOT, '.github/workflows'))) {
    if (!/\.ya?ml$/.test(f)) continue;
    files.push({ name: `.github/workflows/${f}`, text: fs.readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8'), gitlab: false });
  }
  files.push({ name: 'yad docs (GitHub)', text: pagesWorkflow('github'), gitlab: false });
  files.push({ name: 'yad docs (GitLab)', text: pagesWorkflow('gitlab'), gitlab: true });
  let seen = 0;
  for (const { name, text, gitlab } of files) {
    if (!gitlab) {
      const body = text.slice(text.search(/^jobs:$/m));
      const blocks = body.split(/^(?= {2}['"]?[^\s#'"][^:]*['"]?:\s*(?:#.*)?$)/m).slice(1);
      assert.ok(blocks.length, `${name}: no jobs read`);
      for (const b of blocks) {
        seen++;
        assert.match(b, /^ {4}timeout-minutes: \d+$/m, `${name}: job ${b.split(':')[0].trim()} has no timeout-minutes`);
      }
      continue;
    }
    // GitLab: a job is a top-level key that is not a keyword and does not start with a dot; it has a limit when
    // `default:`, its own block, a template it `extends`, or an anchor it merges (`<<: *x`) sets `timeout:`.
    const blocks = new Map();
    const anchors = new Map();
    for (const b of text.split(/^(?=['"]?[^\s#'"-][^:]*['"]?:)/m)) {
      const m = b.match(/^['"]?([^\s#'"-][^:'"]*)['"]?:(?:\s*&([A-Za-z0-9_-]+))?/);
      if (!m) continue;
      blocks.set(m[1], b);
      if (m[2]) anchors.set(m[2], m[1]);
    }
    const all = /^ {2}timeout: \d+ (minutes|hours?)\b/m.test(blocks.get('default') || ''); // `default:` covers every job
    const limited = (key, depth = 0) => {
      if (all) return true;
      const b = blocks.get(key);
      if (!b || depth > 5) return false;
      if (/^ {2}timeout: \d+ (minutes|hours?)\b/m.test(b)) return true;
      const ext = b.match(/^ {2}extends: (\S+)$/m);
      const merge = b.match(/^ {2}<<: \*(\S+)$/m);
      return (ext && limited(ext[1], depth + 1)) || (merge && limited(anchors.get(merge[1]), depth + 1)) || false;
    };
    for (const key of blocks.keys()) {
      if (key.startsWith('.') || ['variables', 'include', 'stages', 'default', 'workflow'].includes(key)) continue;
      seen++;
      assert.ok(limited(key), `${name}: job ${key} has no timeout`);
    }
  }
  assert.ok(seen >= 40, `read only ${seen} jobs — the reader missed some`);
});

// #426 — a gate job runs the BASE branch's copy of checks/, never the PR's own: a PR that changes a gate script
// must not be judged by its own copy, nor read a token the job holds. The files that run gates on PR code:
const GATE_TEMPLATES = [
  ...['yad-checks.yml', 'yad-pr-text.yml', 'yad-product-checks.yml', 'yad-product-pr-text.yml', 'yad-verified-commits.yml']
    .map((f) => ({ name: `skills/yad-checks/templates/github/${f}`, gitlab: false })),
  { name: '.github/workflows/yad-verified-commits.yml', gitlab: false },
  ...['yad-checks.gitlab-ci.yml', 'yad-product-checks.gitlab-ci.yml', 'yad-verified-commits.gitlab-ci.yml', '.gitlab-ci.yml']
    .map((f) => ({ name: `skills/yad-checks/templates/gitlab/${f}`, gitlab: true })),
].map((f) => ({ ...f, text: fs.readFileSync(path.join(ROOT, f.name), 'utf8') }));
const noComments = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
// A YAML block scalar (`key: |` or `- |`) at `at`, as the runner hands it to the shell.
function blockAt(lines, at) {
  const indent = lines[at + 1].match(/^ */)[0].length;
  const out = [];
  for (let i = at + 1; i < lines.length && (!lines[i].trim() || lines[i].startsWith(' '.repeat(indent))); i++) out.push(lines[i].slice(indent));
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return `${out.join('\n')}\n`;
}
const BASE_STEP = '- name: Gate scripts from the base branch (#426)';
function githubStep(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === BASE_STEP);
  assert.ok(at >= 0, 'no base-copy step');
  const run = lines.findIndex((l, i) => i > at && /^\s+run: \|$/.test(l));
  return blockAt(lines, run);
}
function gitlabStep(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l === '.yad_base_checks:');
  const dash = lines.findIndex((l, i) => i > at && /^\s+- \|$/.test(l));
  return blockAt(lines, dash);
}
// The `( … )` the two platforms share, word for word.
const coreOf = (script) => script.slice(script.indexOf('(\n'), script.lastIndexOf('\n)\n') + 3);

test('#426: every gate call runs "$YAD_CHECKS/…", the base branch\'s copy, set up by one shared step; no checkout keeps credentials', () => {
  const cores = new Set();
  const glBlocks = new Set();
  for (const { name, text, gitlab } of GATE_TEMPLATES) {
    const code = noComments(text);
    assert.doesNotMatch(code, /\b(?:bash|node|sh)\s+\.?\/?checks\//, `${name}: a gate call reads checks/ from the PR's tree`);
    assert.match(code, /(?:bash|node) "\$YAD_CHECKS\/[\w.-]+"/, `${name}: no gate call`);
    if (gitlab) {
      // Defined once, and the FIRST line of the script of every job that runs a gate — not a before_script,
      // which would replace the host pipeline's `default: before_script` for these jobs.
      assert.equal((code.match(/^\.yad_base_checks:$/gm) || []).length, 1, name);
      assert.doesNotMatch(code, /^\s*before_script:/m, `${name}: no before_script`);
      const jobs = code.split(/^(?=[\w.-]+:)/m).filter((b) => /"\$YAD_CHECKS\//.test(b) && !b.startsWith('.yad_base_checks:'));
      assert.ok(jobs.length, name);
      for (const j of jobs) assert.match(j, /\n {2}script:\n {4}- !reference \[\.yad_base_checks, script\]\n/, `${name} ${j.split(':')[0]}: the base copy is the script's first line`);
      const s = gitlabStep(text);
      glBlocks.add(s);
      assert.match(s, /^YAD_BASE="\$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"; YAD_CHECKS="\$\(mktemp -d\)\/checks"; export YAD_CHECKS\n/, name);
      cores.add(coreOf(s));
      continue;
    }
    // Every job: checkout without credentials, then the step, then the gate.
    const body = text.slice(text.search(/^jobs:$/m));
    const jobs = body.split(/^(?= {2}[\w-]+:\s*$)/m).slice(1);
    assert.ok(jobs.length, name);
    for (const j of jobs) {
      const job = `${name} ${j.split(':')[0].trim()}`;
      const co = j.indexOf('actions/checkout@');
      const step = j.indexOf(BASE_STEP);
      const gate = j.indexOf('"$YAD_CHECKS/');
      assert.ok(co >= 0 && co < step && step < gate, `${job}: checkout, then the base-copy step, then the gate`);
      assert.match(j.slice(co, step), /persist-credentials: false/, `${job}: the checkout keeps no credentials`);
      assert.match(j.slice(co, step), /fetch-depth: 0/, `${job}: the base branch must be in the checkout`);
      assert.equal(j.split(BASE_STEP).length, 2, `${job}: one base-copy step`);
      const s = githubStep(j);
      assert.match(s, /^YAD_CHECKS="\$RUNNER_TEMP\/yad-base-checks\/checks"\n/, job);
      assert.match(s, /\necho "YAD_CHECKS=\$YAD_CHECKS" >> "\$GITHUB_ENV"\n$/, job);
      assert.match(j, /env: \{ YAD_BASE: "\$\{\{ github\.base_ref \}\}" \}/, job);
      cores.add(coreOf(s));
    }
    assert.doesNotMatch(code, /filter:\s*blob:none/, `${name}: a partial clone leaves out the base's changed checks/`);
  }
  assert.equal(cores.size, 1, 'the base-copy step is word for word the same everywhere');
  // Every GitLab fragment defines the same .yad_base_checks key and the file included last wins: one text.
  assert.equal(glBlocks.size, 1, 'the .yad_base_checks block is the same in every GitLab file');
});

// The upgrade PR: the base's (older) script runs with the new workflow's call. So a call may only use what the
// previous release's script already accepts. A change to this list needs that check, by hand, first.
test('#426: the gate calls are the ones the previous release\'s scripts accept', () => {
  const calls = new Set();
  for (const { text } of GATE_TEMPLATES) {
    for (const m of noComments(text).matchAll(/(bash|node) "\$YAD_CHECKS\/([\w.-]+)"([^\n]*)/g)) {
      calls.add(`${m[2]} ${[...m[3].matchAll(/(?:^|\s)(--[\w-]+)/g)].map((f) => f[1]).join(' ')}`.trim());
    }
  }
  assert.deepEqual([...calls].sort(), [
    'build-test-lint.sh', 'commit-message.sh --profile', 'contract-check.sh', 'epic-open.sh', 'install-deps.sh',
    'ledger-guard.sh', 'lineage-check.sh', 'member-check.mjs', 'pr-template.sh --profile',
    'pr-template.sh --profile --head --changed', 'pr-title.sh --profile', 'pr-title.sh --profile --head --changed',
    'product-checkout.sh', 'reconcile-debt-check.sh', 'risk-map-check.sh', 'spec-link.sh', 'verified-commits.sh',
  ], 'a new script or flag in a gate call: the base branch\'s copy from the previous release runs it on the upgrade PR — make sure that copy accepts it');
});

// The step itself, run as the runner runs it, in a scratch repo: base `main` and a PR branch.
function stepRepo({ baseChecks = true } = {}) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-426-'));
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
  const O = path.join(T, 'origin');
  fs.mkdirSync(O);
  git(O, 'init', '-q', '-b', 'main');
  if (baseChecks) {
    fs.mkdirSync(path.join(O, 'checks'));
    fs.writeFileSync(path.join(O, 'checks/a.sh'), 'echo base-a\n');
  } else fs.writeFileSync(path.join(O, 'README'), 'x\n');
  git(O, 'add', '-A'); git(O, 'commit', '-qm', 'base');
  const P = path.join(T, 'pr');
  git(T, 'clone', '-q', O, P);
  git(P, 'switch', '-qc', 'feat');
  fs.mkdirSync(path.join(P, 'checks'), { recursive: true });
  fs.writeFileSync(path.join(P, 'checks/a.sh'), 'echo pr-a\n');
  fs.writeFileSync(path.join(P, 'checks/b c.sh'), 'echo pr-b\n');
  fs.writeFileSync(path.join(P, 'checks/x.sh'), 'echo pr-x\n', { mode: 0o755 });
  fs.symlinkSync(path.join(T, 'secret'), path.join(P, 'checks/link.sh'));
  fs.writeFileSync(path.join(T, 'secret'), 'echo leaked\n');
  git(P, 'add', '-A'); git(P, 'commit', '-qm', 'pr');
  return { T, P, done: () => fs.rmSync(T, { recursive: true, force: true }) };
}
const env = (extra) => ({ ...process.env, GIT_CONFIG_NOSYSTEM: '1', ...extra });
function runGithubStep(P, T, base = 'main') {
  const step = githubStep(fs.readFileSync(path.join(ROOT, 'skills/yad-checks/templates/github/yad-checks.yml'), 'utf8'));
  const ghenv = path.join(T, 'ghenv');
  const r = spawnSync('bash', ['-e', '-c', step], { cwd: P, encoding: 'utf8', env: env({ RUNNER_TEMP: path.join(T, 'rt'), GITHUB_ENV: ghenv, YAD_BASE: base }) });
  const dir = r.status === 0 ? fs.readFileSync(ghenv, 'utf8').match(/^YAD_CHECKS=(.*)$/m)[1] : null;
  return { ...r, dir };
}
const runIn = (dir, f) => execFileSync('bash', [path.join(dir, f)], { encoding: 'utf8' }).trim();

test('#426 step (GitHub): the base copy runs; a script the base lacks runs from the PR with a note; a link is never followed', () => {
  const { T, P, done } = stepRepo();
  try {
    const r = runGithubStep(P, T);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(runIn(r.dir, 'a.sh'), 'base-a', 'the PR changed a.sh — the base copy still runs');
    assert.equal(runIn(r.dir, 'b c.sh'), 'pr-b');
    assert.match(r.stdout, /note: checks\/b c\.sh is not on main yet, so the copy from this PR runs \(#426\)/);
    assert.ok(fs.statSync(path.join(r.dir, 'x.sh')).mode & 0o100, 'the execute bit is kept');
    assert.ok(!fs.existsSync(path.join(r.dir, 'link.sh')) && !fs.lstatSync(r.dir).isSymbolicLink(), 'the link is not copied');
    assert.match(r.stdout, /note: checks\/link\.sh in this PR is not a plain file, so it is not run \(#426\)/);
    assert.doesNotMatch(r.stdout, /a\.sh is not on/);
    assert.ok(!r.dir.startsWith(P), 'the copy is outside the work tree');
  } finally { done(); }
});

test('#426 step: a base with no checks/ runs the PR\'s copies with one note; an unknown base fails, never falls back', () => {
  const a = stepRepo({ baseChecks: false });
  try {
    const r = runGithubStep(a.P, a.T);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(runIn(r.dir, 'a.sh'), 'pr-a');
    assert.match(r.stdout, /^note: main has no checks\/ folder yet, so the gate scripts from this PR run: 3 files \(#426\)$/m);
    assert.doesNotMatch(r.stdout, /is not on main yet/, 'one note, not one per file');
    const bad = runGithubStep(a.P, a.T, 'nope');
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /FAIL \[base-checks\]: origin\/nope is not in this checkout/);
    assert.ok(!fs.existsSync(path.join(a.T, 'ghenv')) || !/nope/.test(fs.readFileSync(path.join(a.T, 'ghenv'), 'utf8')));
  } finally { a.done(); }
});

test('#426 step (GitLab): the script\'s first line exports YAD_CHECKS to the rest of it, with the same rules', () => {
  const { T, P, done } = stepRepo();
  try {
    for (const f of ['yad-checks.gitlab-ci.yml', 'yad-product-checks.gitlab-ci.yml', 'yad-verified-commits.gitlab-ci.yml', '.gitlab-ci.yml']) {
      const step = gitlabStep(fs.readFileSync(path.join(ROOT, 'skills/yad-checks/templates/gitlab', f), 'utf8'));
      // GitLab runs a job's script lines in one shell, with errexit on.
      const r = spawnSync('bash', ['-c', `set -eo pipefail\n${step}\nbash "$YAD_CHECKS/a.sh"; bash "$YAD_CHECKS/b c.sh"`], { cwd: P, encoding: 'utf8', env: env({ CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main', TMPDIR: T }) });
      assert.equal(r.status, 0, `${f}: ${r.stderr}`);
      assert.match(r.stdout, /^note: checks\/b c\.sh is not on main yet, so the copy from this PR runs \(#426\)\nnote: checks\/link\.sh in this PR is not a plain file, so it is not run \(#426\)\nnote: checks\/x\.sh is not on main yet, so the copy from this PR runs \(#426\)\nbase-a\npr-b\n$/, f);
      const bad = spawnSync('bash', ['-c', `set -eo pipefail\n${step}\necho ran`], { cwd: P, encoding: 'utf8', env: env({ CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'nope', TMPDIR: T }) });
      assert.notEqual(bad.status, 0, f);
      assert.doesNotMatch(bad.stdout, /ran/, `${f}: the job stops`);
    }
  } finally { done(); }
});

test('#426 step: a base symlink stays a link, a submodule or a control character in the PR is said safely, a base checks that is not a folder fails', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-426b-'));
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
  try {
    const O = path.join(T, 'origin');
    fs.mkdirSync(path.join(O, 'checks'), { recursive: true });
    git(O, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(O, 'checks/a.sh'), 'echo base-a\n');
    fs.symlinkSync('a.sh', path.join(O, 'checks/l.sh'));
    git(O, 'add', '-A'); git(O, 'commit', '-qm', 'base');
    const P = path.join(T, 'pr');
    git(T, 'clone', '-q', O, P);
    git(P, 'switch', '-qc', 'feat');
    fs.rmSync(path.join(P, 'checks/l.sh'));
    fs.writeFileSync(path.join(P, 'checks/l.sh'), 'echo pr-l\n');               // the PR turns the link into a file
    fs.writeFileSync(path.join(P, 'checks/n\nl.sh'), 'echo nl\n');
    git(P, 'add', '-A');
    git(P, 'update-index', '--add', '--cacheinfo', `160000,${git(P, 'rev-parse', 'HEAD').trim()},checks/sub`);
    git(P, 'commit', '-qm', 'pr');
    const r = runGithubStep(P, T);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.lstatSync(path.join(r.dir, 'l.sh')).isSymbolicLink(), 'the base\'s link is kept; the PR\'s file does not replace it');
    assert.equal(runIn(r.dir, 'l.sh'), 'base-a');
    assert.match(r.stdout, /^note: checks\/n\?l\.sh is not on main yet, so the copy from this PR runs \(#426\)$/m, 'a control character is printed as ?');
    assert.match(r.stdout, /^note: checks\/sub in this PR is not a plain file, so it is not run \(#426\)$/m);
    assert.ok(!fs.existsSync(path.join(r.dir, 'sub')));
    // A base whose checks is a file, not a folder: FAIL, never "no checks/ on the base".
    fs.rmSync(path.join(O, 'checks'), { recursive: true });
    fs.writeFileSync(path.join(O, 'checks'), 'x\n');
    git(O, 'add', '-A'); git(O, 'commit', '-qm', 'file');
    git(P, 'fetch', '-q', 'origin');
    const bad = runGithubStep(P, T);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /FAIL \[base-checks\]: checks on origin\/main is not a folder/);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('#426 step: one file from a base with no checks/ is "1 file"', () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-426c-'));
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
  try {
    const O = path.join(T, 'origin'); fs.mkdirSync(O);
    git(O, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(O, 'R'), 'x'); git(O, 'add', '-A'); git(O, 'commit', '-qm', 'b');
    const P = path.join(T, 'pr'); git(T, 'clone', '-q', O, P);
    fs.mkdirSync(path.join(P, 'checks')); fs.writeFileSync(path.join(P, 'checks/a.sh'), 'echo a\n'); git(P, 'add', '-A'); git(P, 'commit', '-qm', 'c');
    const r = runGithubStep(P, T);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /run: 1 file \(#426\)$/m);
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

// #428: a newer push to a PR cancels a gate file's older run — every gate re-reads the whole PR range, and a
// merge waits only on the newest run. A file that checks only its own push's commits, or writes to the repo,
// never cancels: the update guard checks `before..HEAD` of one push, so a cancelled run leaves those commits
// unchecked; gate-sync pushes the ledger.
test('#428: the PR gate files cancel their older run; the update guard, gate-sync and a push to main never do', () => {
  // The PR-text files start on an edit too; their group also names the commit, so an older commit's late edit
  // run cannot cancel a newer push's run.
  const group = (name) => `\nconcurrency:\n  group: \${{ github.workflow }}-\${{ github.event.pull_request.number }}${/pr-text/.test(name) ? '-${{ github.event.pull_request.head.sha }}' : ''}\n  cancel-in-progress: true\n`;
  let gh = 0, gl = 0;
  for (const { name, text, gitlab } of GATE_TEMPLATES) {
    if (!gitlab) {
      gh++;
      assert.ok(text.includes(group(name)), `${name}: no per-PR concurrency group that cancels`);
      // The group is keyed on the PR number, so the file must start on pull_request only (no empty number).
      const on = text.slice(text.search(/^on:$/m), text.search(/^concurrency:$/m));
      assert.deepEqual(on.match(/^ {2}[a-z_]+:/gm), ['  pull_request:'], `${name}: starts on more than pull_request`);
      continue;
    }
    // GitLab: every job is interruptible, in its own block or in the template it extends.
    const blocks = new Map();
    for (const b of noComments(text).split(/^(?=['"]?[^\s#'"-][^:]*['"]?:)/m)) {
      const m = b.match(/^['"]?([^\s#'"-][^:'"]*)['"]?:/);
      if (m) blocks.set(m[1], b);
    }
    for (const key of blocks.keys()) {
      if (key.startsWith('.') || ['variables', 'include', 'stages', 'default', 'workflow'].includes(key)) continue;
      gl++;
      const interruptible = (k, depth = 0) => {
        const blk = blocks.get(k);
        if (!blk || depth > 5 || /^ {2}interruptible: false$/m.test(blk)) return false; // the nearest explicit setting wins
        if (/^ {2}interruptible: true$/m.test(blk)) return true;
        const ext = blk.match(/^ {2}extends: (\S+)$/m);
        return Boolean(ext && interruptible(ext[1], depth + 1));
      };
      assert.ok(interruptible(key), `${name}: job ${key} is not interruptible`);
    }
  }
  assert.equal(gh, 6, 'GitHub gate files read');
  assert.equal(gl, 21, 'GitLab gate jobs read');
  for (const f of ['skills/yad-checks/templates/github/yad-update-guard.yml', 'skills/yad-checks/templates/gitlab/yad-update-guard.gitlab-ci.yml',
    'skills/yad-product-bridge/templates/github/yad-gate-sync.yml', 'skills/yad-product-bridge/templates/gitlab/yad-gate-sync.gitlab-ci.yml']) {
    const text = noComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    assert.doesNotMatch(text, /cancel-in-progress: true|interruptible: true/, `${f} must never cancel a run`);
  }
  // This repo's CI: a PR's older run is cancelled; a push to main has a group of its own (its event + commit), so
  // it is neither cancelled nor left waiting — a shared group cancels a waiting run even without
  // cancel-in-progress — and a nightly or by-hand run of the same commit never waits behind it (#434).
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.ok(ci.includes("\nconcurrency:\n  group: ci-${{ github.event.pull_request.number && format('pr-{0}', github.event.pull_request.number) || format('{0}-{1}', github.event_name, github.sha) }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n"), 'ci.yml concurrency');
  // #434: the macOS legs run on a push to main, nightly and by hand, never on a pull request; the required
  // e2e (ubuntu-latest) leg runs on every event.
  assert.ok(ci.includes(`include: \${{ fromJSON(github.event_name == 'pull_request' && '[]' || '[{"os":"macos-latest","node-version":24}]') }}\n`), 'ci.yml test: macOS off PRs');
  assert.ok(ci.includes(`os: \${{ fromJSON(github.event_name == 'pull_request' && '["ubuntu-latest"]' || '["ubuntu-latest","macos-latest"]') }}\n`), 'ci.yml e2e: macOS off PRs');
  assert.match(ci, /\n  schedule:\n    - cron: '[^']+'\n  workflow_dispatch:\n/, 'ci.yml nightly + by hand');
});

// #433: the merge modes yad's checks do not support yet (E166) are gaps; the settings that make the checks
// judge the right base, or the right approvers, are suggestions. Nothing new is fetched: the same reads.
test('#433 GitHub: a merge queue is a gap; "up to date" off is a suggestion; a rule unread is unknown', () => {
  const w = workspace();
  try {
    const rules = (extra = [], strict = true) => [PR_RULE(), CHECKS_RULE(REQUIRED_CHECKS.github.code, strict), { type: 'non_fast_forward' }, { type: 'deletion' }, ...extra];
    const run = (appRules, more = {}) => check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: appRules, ...more })]).r;
    const queued = run(rules([{ type: 'merge_queue', parameters: {} }]));
    const q = byId(queued, 'app')['merge-queue'];
    assert.equal(q.status, 'gap');
    assert.match(q.message, /dropped from the queue when its checks time out/);
    assert.match(q.fix.steps.join(' '), /Turn off "Require merge queue"/);
    assert.equal(q.fix.url, 'https://github.com/acme/app/settings/rules');
    assert.ok(queued.summary.gaps >= 1, 'a gap fails the run');
    // GraphQL sees a queue that classic branch protection turned on, which no ruleset shows.
    const classicQueue = byId(run(rules(), { queue: [200, { data: { repository: { mergeQueue: { id: 'MQ_1' } } } }] }), 'app')['merge-queue'];
    assert.equal(classicQueue.status, 'gap');
    assert.match(classicQueue.fix.steps.join(' '), /classic branch protection \(https:\/\/github\.com\/acme\/app\/settings\/branches\)/);
    // GraphQL not answered, or answered with errors: unknown — unless a ruleset's rule proves the queue.
    for (const queue of [[502, { message: 'Bad Gateway' }], [200, { errors: [{ message: 'x' }], data: null }], [200, { data: { repository: null } }]]) {
      const row = byId(run(rules(), { queue }), 'app')['merge-queue'];
      assert.equal(row.status, 'unknown', JSON.stringify(queue));
    }
    assert.equal(byId(run(rules([{ type: 'merge_queue' }]), { queue: [502, { message: 'x' }] }), 'app')['merge-queue'].status, 'gap');
    // The names are sent with -f, as plain strings, never with -F, which would type a name like `123` or `true`.
    const { asked } = check(w, [...gh('p', { rules: ALL_RULES(productJobs) }), ...gh('app', { rules: rules() })]);
    const graphqlCalls = asked.filter((x) => / graphql /.test(x));
    assert.ok(graphqlCalls.length >= 1, 'the queue is asked');
    for (const call of graphqlCalls) {
      assert.match(call, / -f owner=acme -f branch=main -f name=\S+$/, call);
      assert.doesNotMatch(call, / -F /, call);
    }
    const loose = byId(run(rules([], false)), 'app');
    assert.equal(loose['merge-queue'].status, 'ok');
    assert.equal(loose['up-to-date'].status, 'suggest');
    assert.match(loose['up-to-date'].message, /older base/);
    assert.match(loose['up-to-date'].fix.steps.join(' '), /Require branches to be up to date/);
    // Classic protection alone can turn "up to date" on.
    const classic = [200, { required_status_checks: { strict: true, contexts: [] } }];
    assert.equal(byId(run(rules([], false), { classic }), 'app')['up-to-date'].status, 'ok');
    // The rules not read: "up to date" stays a suggestion that says why (the queue comes from GraphQL).
    const unread = byId(run(null, { rulesFail: [500, { message: 'boom' }] }), 'app');
    assert.equal(unread['up-to-date'].status, 'suggest');
    assert.match(unread['up-to-date'].message, /^not known/);
  } finally { done(w); }
});

test('#433 GitLab: merge trains are a gap, merged-results pipelines are supported, and self-approval is a suggestion in team mode', () => {
  const w = workspace({ platform: 'gitlab' });
  try {
    const app = (opts) => byId(check(w, [...gl('p'), ...gl('app', opts)]).r, 'app');
    const trains = app({ project: { merge_trains_enabled: true, merge_pipelines_enabled: true } });
    assert.equal(trains['merge-trains'].status, 'gap');
    assert.match(trains['merge-trains'].message, /ahead in the train/);
    assert.match(trains['merge-trains'].fix.steps.join(' '), /turn off "Enable merge trains"/);
    assert.equal(trains['merged-results'].status, 'ok');
    assert.match(trains['merged-results'].message, /are on/);
    const off = app({ project: { merge_trains_enabled: false, merge_pipelines_enabled: false } });
    assert.equal(off['merge-trains'].status, 'ok');
    assert.match(off['merged-results'].message, /are off/);
    // Neither setting reported (GitLab Free, or a login that cannot see them): not known, never ok.
    const free = app({ project: { merge_trains_enabled: undefined, merge_pipelines_enabled: undefined } });
    assert.equal(free['merge-trains'].status, 'unknown');
    assert.match(free['merge-trains'].message, /Premium, or your login cannot see it/);
    assert.equal(free['merged-results'], undefined);
    // Merged-results pipelines off proves no train: a train needs them.
    assert.equal(app({ project: { merge_trains_enabled: undefined, merge_pipelines_enabled: false } })['merge-trains'].status, 'ok');
    // Who may approve: the author, or someone who added commits, is a suggestion; unread says Premium.
    const self = app({ approvals: [200, { reset_approvals_on_push: true, merge_requests_author_approval: true, merge_requests_disable_committers_approval: false }] });
    assert.equal(self['author-approval'].status, 'suggest');
    assert.match(self['author-approval'].fix.steps.join(' '), /Prevent approval by author/);
    assert.equal(self['committer-approval'].status, 'suggest');
    assert.match(self['committer-approval'].fix.steps.join(' '), /Prevent approvals by users who add commits/);
    const noPremium = app({ approvals: [403, { message: '403 Forbidden' }] });
    assert.equal(noPremium['author-approval'].status, 'suggest');
    assert.match(noPremium['author-approval'].message, /Premium/);
    const good = app({});
    assert.equal(good['author-approval'].status, 'ok');
    assert.equal(good['committer-approval'].status, 'ok');
  } finally { done(w); }
  // Solo mode: one person writes and approves, so neither approval row is asked.
  const solo = workspace({ platform: 'gitlab', product: { solo: true } });
  try {
    const app = byId(check(solo, [...gl('p'), ...gl('app', { approvals: [200, { merge_requests_author_approval: true, merge_requests_disable_committers_approval: false }] })]).r, 'app');
    assert.equal(app['author-approval'], undefined);
    assert.equal(app['committer-approval'], undefined);
    assert.equal(app['merge-trains'].status, 'ok', 'trains are asked in solo mode too');
  } finally { done(solo); }
});
