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
const CHECKS_RULE = (contexts) => ({ type: 'required_status_checks', parameters: { required_status_checks: contexts.map((context) => ({ context })) } });
const ALL_RULES = (jobs) => [PR_RULE(), CHECKS_RULE(jobs), { type: 'non_fast_forward' }, { type: 'deletion' }];
const NOT_PROTECTED = [404, { message: 'Branch not protected' }];
// `rules` is the list of rules; `rulesFail` a refused answer instead, as [status, body].
function gh(repo, { rules, rulesFail = null, classic = NOT_PROTECTED, prot = true } = {}) {
  const at = `repos/acme/${repo}`;
  return [
    [new RegExp(`^${at}$`), 200, { default_branch: 'main' }],
    [new RegExp(`^${at}/branches/main$`), 200, { protected: prot }],
    [new RegExp(`^${at}/rules/branches/main`), ...(rulesFail ?? [200, rules])],
    [new RegExp(`^${at}/branches/main/protection$`), ...classic],
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
    assert.deepEqual(Object.keys(byId(r, 'app')).sort(), ['deletion', 'files', 'force-push', 'protected', 'required-checks', 'signed-commits', 'stale-approvals']);
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
function gl(repo, { project = {}, prot = true, protectedBranches = [NO_ONE], branchesFail = null, approvals = [200, { reset_approvals_on_push: true }], pushRule = [404, { message: '404 Not found' }] } = {}) {
  const at = `projects/acme%2F${repo}`;
  return [
    [new RegExp(`^${at}$`), 200, { default_branch: 'main', namespace: { kind: 'user' }, ci_config_path: '', only_allow_merge_if_pipeline_succeeds: true, allow_merge_on_skipped_pipeline: false, only_allow_merge_if_all_discussions_are_resolved: true, ...project }],
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
  assert.deepEqual(jobs('skills/yad-checks/templates/github/yad-checks.yml', ghJob), REQUIRED_CHECKS.github.code);
  assert.deepEqual(jobs('skills/yad-checks/templates/github/yad-product-checks.yml', ghJob), REQUIRED_CHECKS.github.product);
  assert.deepEqual(jobs('skills/yad-checks/templates/github/yad-verified-commits.yml', ghJob), REQUIRED_CHECKS.github.productVerified);
  assert.deepEqual(jobs('skills/yad-checks/templates/gitlab/yad-checks.gitlab-ci.yml', glJob), REQUIRED_CHECKS.gitlab.code);
  assert.deepEqual(jobs('skills/yad-checks/templates/gitlab/yad-product-checks.gitlab-ci.yml', glJob), REQUIRED_CHECKS.gitlab.product);
  assert.deepEqual(jobs('skills/yad-checks/templates/gitlab/yad-verified-commits.gitlab-ci.yml', glJob), REQUIRED_CHECKS.gitlab.productVerified);
  // No job sets `name:`, so GitHub names each check after its job.
  for (const f of ['yad-checks.yml', 'yad-product-checks.yml', 'yad-verified-commits.yml']) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'skills/yad-checks/templates/github', f), 'utf8'), /^ {4}name:/m, f);
  const doc = fs.readFileSync(path.join(ROOT, 'docs/branch-protection.md'), 'utf8');
  const row = (label) => [...doc.split('\n').find((l) => l.startsWith(`| ${label} |`)).split('|')[3].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(row('Product'), REQUIRED_CHECKS.github.product);
  assert.deepEqual(row('Product, when the file is there'), REQUIRED_CHECKS.github.productVerified);
  assert.deepEqual(row('Each code repo'), REQUIRED_CHECKS.github.code);
  const glText = doc.slice(doc.indexOf('The checks run as jobs in the merge request pipeline'));
  for (const j of [...REQUIRED_CHECKS.gitlab.product, ...REQUIRED_CHECKS.gitlab.productVerified, ...REQUIRED_CHECKS.gitlab.code]) assert.ok(glText.includes(`\`${j}\``), j);
});

test('E160b case 10: never writes — the folders are unchanged, and every platform call is a GET', () => {
  const w = workspace();
  try {
    const snap = (dir) => execFileSync('find', [dir, '-type', 'f', '-not', '-path', '*/.git/*', '-exec', 'shasum', '{}', '+'], { encoding: 'utf8' }).split('\n').sort().join('\n');
    const before = snap(path.dirname(w.root));
    const { asked } = check(w, allSet());
    assert.equal(snap(path.dirname(w.root)), before);
    for (const call of asked) assert.doesNotMatch(call, /(-X|--method)\s+(?!GET)|--field|-f |--input/, call);
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
    assert.match(partial.fix.steps[0], /under its top-level `include:` list/);
    assert.ok(partial.fix.steps.includes("  - local: '.gitlab/ci/yad-checks.yml'"));
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
    assert.ok(trailing.fix.steps.includes("  - local: '.gitlab/ci/yad-checks.yml'"));
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
      ['a text block', `${guard}job:\n  script:\n    - |\n      .gitlab/ci/yad-checks.yml\n`],
    ]) assert.equal(file(text).status, 'gap', why);
    // Included only under its own rules: whether it runs is not known.
    const gated = file(`${guard}  - local: .gitlab/ci/yad-checks.yml\n    rules:\n      - if: $CI_PIPELINE_SOURCE == "push"\n`);
    assert.equal(gated.status, 'unknown');
    assert.match(gated.message, /only under its own `rules:`/);
    // A list at the key's own column, and a map form.
    assert.equal(file("include:\n- local: .gitlab/ci/yad-update-guard.yml\n- .gitlab/ci/yad-checks.yml\nstages: [test]\n").status, 'ok');
  } finally { done(w); }
});
