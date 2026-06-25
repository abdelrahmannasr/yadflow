// `yad commit` — commit by the SDLC conventions (CONTRIBUTING.md / config.yaml build).
// Subject is Conventional Commits; trailers are emitted in the fixed order
// Task -> Contract-Change -> Co-Authored-By. The human git author OWNS the commit; the AI is only a
// co-author (flagged with --ai, or `none` for human-only). An atomic-commit guard keeps diffs small.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, warn, fail, run, exists } from './lib.mjs';
import {
  COMMIT_TYPES, AI_COAUTHORS, ATOMIC_FILE_LIMIT,
  TASK_TRAILER, CONTRACT_CHANGE_TRAILER, COAUTHOR_TRAILER, PROJECT_FILES,
} from './manifest.mjs';

// PURE — unit tested directly. Build the full commit message text.
export function buildCommitMessage({ type, subject, task, contractChange = false, ai = 'none', body = '' }) {
  if (!COMMIT_TYPES.includes(type)) throw new Error(`invalid commit type "${type}" (one of: ${COMMIT_TYPES.join(', ')})`);
  if (!subject || !subject.trim()) throw new Error('commit subject is required');
  if (!(ai in AI_COAUTHORS)) throw new Error(`unknown --ai "${ai}" (one of: ${Object.keys(AI_COAUTHORS).join(', ')})`);
  if (/\.$/.test(subject.trim())) throw new Error('subject must not end with a period');

  const trailers = [];
  if (task) trailers.push(`${TASK_TRAILER}: ${task}`);
  if (contractChange) trailers.push(`${CONTRACT_CHANGE_TRAILER}: yes`);
  const co = AI_COAUTHORS[ai];
  if (co) trailers.push(`${COAUTHOR_TRAILER}: ${co.name} <${co.email}>`);

  const parts = [`${type}: ${subject.trim()}`];
  if (body?.trim()) parts.push('', body.trim());
  if (trailers.length) parts.push('', trailers.join('\n'));
  return parts.join('\n');
}

// feat/EP-istifta-inquiries-S01-T01-create-inquiry -> EP-istifta-inquiries-S01-T01
export function taskFromBranch(branch = '') {
  const m = branch.match(/(.+-S\d+-T\d+)(?:-|$)/i);
  return m ? m[1].replace(/^[a-z]+\//i, '') : null;
}

export async function runCommit(root, opts = {}) {
  log(c.bold('\nyad commit'));
  if (!exists(path.join(root, '.git'))) { fail('not a git repo'); process.exitCode = 1; return; }

  const staged = run('git', ['diff', '--cached', '--name-only'], { cwd: root }).stdout.split('\n').filter(Boolean);
  if (!staged.length) { fail('nothing staged — `git add` your atomic change first'); process.exitCode = 1; return; }

  if (staged.length > ATOMIC_FILE_LIMIT && !opts.force) {
    warn(`${staged.length} files staged (atomic guard: ≤${ATOMIC_FILE_LIMIT}). Split the change, or pass --force.`);
    for (const f of staged) info(f);
    process.exitCode = 1;
    return;
  }

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }).stdout;
  const task = opts.task || taskFromBranch(branch);
  if (!task) {
    // spec-link is a code-repo gate (REPO_WIRING.common), not a hub gate — so a missing Task trailer
    // is expected on a hub PR (front-half artifact review or hub tooling) and only matters on a repo.
    const onHub = exists(path.join(root, PROJECT_FILES.hubConfig));
    warn(onHub
      ? 'no Task trailer (none given and branch has no -S0N-T0N) — fine for a hub PR; required on code-repo tasks (spec-link gate)'
      : 'no Task trailer (none given and branch has no -S0N-T0N) — spec-link gate will fail on a code repo');
  }

  let message;
  try {
    message = buildCommitMessage({
      type: opts.type, subject: opts.message, task,
      contractChange: !!opts.contractChange, ai: opts.ai || 'none',
    });
  } catch (e) { fail(e.message); process.exitCode = 1; return; }

  if (opts.dryRun) { log('\n' + c.dim(message) + '\n'); info('dry run — not committed'); return { message }; }

  const r = run('git', ['commit', '-m', message], { cwd: root });
  if (!r.ok) { fail(`git commit failed — ${r.stderr.split('\n')[0] || r.code}`); process.exitCode = 1; return { message }; }
  ok(`committed ${staged.length} file(s)${task ? ` for ${task}` : ''}`);
  if (opts.contractChange) warn('Contract-Change: yes — this routes back to the architecture gate');
  return { message };
}

// installed by yad-implement, but offer it here too for convenience.
export function ensureGitMessage(repoRoot, templateSrc) {
  const dest = path.join(repoRoot, '.gitmessage');
  if (exists(dest)) return false;
  if (!templateSrc || !exists(templateSrc)) return false;
  fs.copyFileSync(templateSrc, dest);
  run('git', ['config', 'commit.template', '.gitmessage'], { cwd: repoRoot });
  return true;
}
