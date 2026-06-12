// `yad open-pr` — open a code-repo task PR/MR from the repo's platform template (build half).
// Detects the platform, pushes the current branch, and creates the PR/MR with Summary / Story-task /
// Impact & Risk prefilled. Distinct from `yad gate open`, which opens a front-half artifact-review PR
// on the product hub.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, hand, fail, run, exists, readJSON } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { detectPlatform, createPr } from './platform.mjs';
import { taskFromBranch } from './commit.mjs';

// Resolve the target code repo: --repo <name> from the registry, else --dir, else cwd.
function resolveRepo(root, { repo, dir }) {
  if (repo) {
    const reg = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
    const found = reg.repos.find((r) => r.name === repo);
    if (found) return { repoRoot: path.resolve(root, found.path), meta: found };
  }
  return { repoRoot: path.resolve(root, dir || '.'), meta: null };
}

function templateBody(repoRoot, platform, { task, risk, contract, domains }) {
  const tplPath = platform === 'gitlab'
    ? path.join(repoRoot, '.gitlab/merge_request_templates/Default.md')
    : path.join(repoRoot, '.github/pull_request_template.md');
  const base = exists(tplPath) ? fs.readFileSync(tplPath, 'utf8') : '## Summary\n\n## Impact & Risk\n';
  // Fill the obvious fields; leave the rest of the committed template intact for the author.
  return base
    .replace(/EP-<slug>-S0N-T0N/g, task || 'EP-<slug>-S0N-T0N')
    .replace(/(\*\*Risk level:\*\*)\s*\w+/i, `$1 ${risk}`)
    .replace(/(\*\*Contract surface touched:\*\*)\s*\w+/i, `$1 ${contract ? 'yes' : 'no'}`)
    .replace(/(\*\*Domains \/ repos touched:\*\*).*/i, `$1 ${domains || '<repo>'}`);
}

export async function runOpenPr(root, opts = {}) {
  log(c.bold('\nyad open-pr'));
  const { repoRoot, meta } = resolveRepo(root, opts);
  if (!exists(path.join(repoRoot, '.git'))) { fail(`not a git repo: ${repoRoot}`); process.exitCode = 1; return; }

  const remote = run('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot }).stdout;
  const platform = opts.platform || meta?.platform || detectPlatform(remote);
  if (!platform) { fail('could not detect platform (github/gitlab) — pass --platform'); process.exitCode = 1; return; }

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot }).stdout;
  const baseBranch = opts.base || meta?.default_branch || 'main';
  if (branch === baseBranch) { fail(`on ${baseBranch} — switch to your task branch first`); process.exitCode = 1; return; }

  // Push the branch (sets upstream) using the user's own auth. Abort on failure — creating a PR for a
  // branch that is not on the remote just fails with a more confusing error.
  info(`pushing ${branch} …`);
  const push = run('git', ['push', '-u', 'origin', branch], { cwd: repoRoot });
  if (!push.ok) { fail(`git push failed — ${push.stderr.split('\n')[0] || 'unknown'}`); process.exitCode = 1; return; }

  const task = opts.task || taskFromBranch(branch);
  const title = opts.title || run('git', ['log', '-1', '--format=%s'], { cwd: repoRoot }).stdout || `task ${task || branch}`;
  const body = templateBody(repoRoot, platform, {
    task, risk: opts.risk || 'low', contract: !!opts.contractChange, domains: meta?.name,
  });

  const r = createPr(platform, { title, body, base: baseBranch, head: branch, cwd: repoRoot });
  if (!r.ok) { fail(`could not open PR/MR — ${r.reason || 'unknown'}`); process.exitCode = 1; return; }
  ok(`opened ${r.url}`);
  if (opts.risk === 'high' || opts.contractChange) hand('high risk / contract surface — run `bash checks/risk-route.sh "<pr body>"` for required reviewers');
  return { url: r.url };
}
