// `yad open-pr` — open a code-repo task PR/MR from the repo's platform template (build half).
// Detects the platform, pushes the current branch, and creates the PR/MR with Summary / Story-task /
// Impact & Risk prefilled. Distinct from `yad gate open`, which opens a front-half artifact-review PR
// on the product hub.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, hand, fail, run, exists, readJSON } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { detectPlatform, createPr, reviewersForScopes, resolveCommitterLogin } from './platform.mjs';
import { taskFromBranch } from './commit.mjs';
import { parseReviewBranch, artifactFromBase } from './epic-state.mjs';
import { gateOpen } from './gate.mjs';

// Resolve the target code repo: --repo <name> from the registry, else --dir, else cwd.
function resolveRepo(root, { repo, dir }) {
  if (repo) {
    const reg = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
    const found = reg.repos.find((r) => r.name === repo);
    if (found) return { repoRoot: path.resolve(root, found.path), meta: found };
  }
  return { repoRoot: path.resolve(root, dir || '.'), meta: null };
}

// Which SDLC stage is this PR? The hub serves two vehicles; a code repo only one. Mirrors the
// `--head` split the hub pattern gates (pr-title.sh/pr-template.sh) already apply:
//   code-repo    — NOT the product hub (a registry repo via --repo, or root is not a hub).
//   hub-front    — the hub itself AND head is a review/EP-* branch (artifact-review PR).
//   hub-tooling  — the hub itself AND head is anything else (a tooling/CI change to the hub).
// `meta` (truthy when resolved from the repos registry via --repo) is a connected code repo, so it is
// never the hub regardless of its path. Otherwise "is the hub" = repoRoot resolves to root AND root
// carries .sdlc/hub.json. path.resolve normalises `--dir .` / trailing slashes.
export function detectStage(root, repoRoot, head, meta) {
  if (meta) return 'code-repo';
  const isHub = path.resolve(repoRoot) === path.resolve(root)
    && exists(path.join(root, PROJECT_FILES.hubConfig));
  if (!isHub) return 'code-repo';
  return /^review\/EP-[a-z0-9-]+\//.test(head || '') ? 'hub-front' : 'hub-tooling';
}

// The bundled code-task template — the same file `REPO_WIRING` installs into code repos, resolved
// from the package (mirrors how manifest.mjs reads ../package.json). Used for a hub-tooling PR, whose
// `.github/pull_request_template.md` is the ARTIFACT-REVIEW template (wrong shape for the code-task
// hub gate). Falls back to a minimal body that still carries every section the gate requires.
function codeTaskTemplate(platform) {
  const rel = platform === 'gitlab'
    ? '../skills/yad-pr-template/templates/gitlab/merge_request_templates/Default.md'
    : '../skills/yad-pr-template/templates/github/pull_request_template.md';
  try {
    return fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  } catch {
    return [
      '## Summary', '',
      '## Impact & Risk',
      '- **Domains / repos touched:** <repo>',
      '- **Contract surface touched:** no',
      '- **Risk level:** low',
      '',
      '## Checklist',
      '- [ ] Lint, build, and tests pass (build/test/lint gate)',
      '',
    ].join('\n');
  }
}

export function templateBody(repoRoot, platform, { task, risk, contract, domains, stage }) {
  // hub-tooling: the hub's own template is artifact-review — use the bundled code-task template so the
  // body matches the shape the hub `pr-template` gate demands for a non-review head.
  let base;
  if (stage === 'hub-tooling') {
    base = codeTaskTemplate(platform);
  } else {
    const tplPath = platform === 'gitlab'
      ? path.join(repoRoot, '.gitlab/merge_request_templates/Default.md')
      : path.join(repoRoot, '.github/pull_request_template.md');
    base = exists(tplPath) ? fs.readFileSync(tplPath, 'utf8') : codeTaskTemplate(platform);
  }
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

  const stage = detectStage(root, repoRoot, branch, meta);

  // hub-front: this is a front-half artifact-review PR (review/EP-*/<artifact> head on the hub). The
  // artifact-review title, body, and ledger bookkeeping all live in `yad gate open` — delegate to it
  // rather than emit the code-task shape (which the hub gate would reject). Push first (gateOpen does
  // not push), then hand off; any --title/--message is dropped (gateOpen sets `review: …`).
  if (stage === 'hub-front') {
    const parsed = parseReviewBranch(branch);
    if (!parsed) { fail(`could not parse review branch '${branch}' (expected review/EP-<slug>/<artifact>)`); process.exitCode = 1; return; }
    info(`pushing ${branch} …`);
    const fpush = run('git', ['push', '-u', 'origin', branch], { cwd: repoRoot });
    if (!fpush.ok) { fail(`git push failed — ${fpush.stderr.split('\n')[0] || 'unknown'}`); process.exitCode = 1; return; }
    // Pass the branch we just pushed as the head so gateOpen opens the PR against it (its own
    // recompute would collapse a per-story base). gateOpen signals failure by returning no url —
    // mirror open-pr's own error contract so `ship` sees the non-zero exit and never reports success.
    const res = await gateOpen(root, { epic: parsed.epic, artifact: artifactFromBase(parsed.base), head: branch });
    if (!res?.url) process.exitCode = 1;
    return res;
  }

  // Push the branch (sets upstream) using the user's own auth. Abort on failure — creating a PR for a
  // branch that is not on the remote just fails with a more confusing error.
  info(`pushing ${branch} …`);
  const push = run('git', ['push', '-u', 'origin', branch], { cwd: repoRoot });
  if (!push.ok) { fail(`git push failed — ${push.stderr.split('\n')[0] || 'unknown'}`); process.exitCode = 1; return; }

  const task = opts.task || taskFromBranch(branch);
  const title = opts.title || run('git', ['log', '-1', '--format=%s'], { cwd: repoRoot }).stdout || `task ${task || branch}`;
  const body = templateBody(repoRoot, platform, {
    task, risk: opts.risk || 'low', contract: !!opts.contractChange, domains: meta?.name, stage,
  });

  // Auto-assign from the hub roster, scoped to this repo: assignee = the committer (resolved from
  // local git identity), reviewers = the repo's reviewers + domain-owners, minus the committer.
  // Degrades cleanly when there is no roster / the committer is unmapped (gh self-assigns via @me).
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig), { roster: [] });
  const roster = hub.roster || [];
  const committer = resolveCommitterLogin(repoRoot, roster);
  const scope = meta?.name ? [meta.name] : [];
  const reviewers = reviewersForScopes(roster, scope, { excludeLogin: committer });
  const assignees = committer ? [committer] : [];

  const r = createPr(platform, { title, body, base: baseBranch, head: branch, reviewers, assignees, cwd: repoRoot });
  if (!r.ok) { fail(`could not open PR/MR — ${r.reason || 'unknown'}`); process.exitCode = 1; return; }
  ok(`opened ${r.url}`);
  if (opts.risk === 'high' || opts.contractChange) hand('high risk / contract surface — run `bash checks/risk-route.sh "<pr body>"` for required reviewers');
  return { url: r.url };
}
