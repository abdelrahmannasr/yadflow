// `yad commit` — commit by the SDLC conventions (CONTRIBUTING.md / config.yaml build).
// Subject is Conventional Commits; trailers are emitted in the fixed order
// Task -> Contract-Change -> Ledger-Override -> Co-Authored-By. The human git author OWNS the commit;
// the AI is only a co-author (flagged with --ai, or `none` for human-only). An atomic-commit guard keeps diffs small.
// An explicit --task id is validated against the spec-link gate contract (<story>-T<NN>) so a
// malformed trailer fails locally rather than after a push.
//
// `--manual --reason` (E49) is the door past the Product's local ledger hook (E48): the commit runs with
// the hook's skip switch, and the reason is recorded as a `Ledger-Override:` trailer so the reviewer —
// and the CI `ledger-guard` check, which quotes it — can see why. It opens this machine's hook and
// nothing more: CI still fails the commit, because anyone can type a trailer.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, warn, fail, run, exists } from './lib.mjs';
import {
  COMMIT_TYPES, AI_COAUTHORS, ATOMIC_FILE_LIMIT,
  TASK_TRAILER, CONTRACT_CHANGE_TRAILER, LEDGER_OVERRIDE_TRAILER, COAUTHOR_TRAILER, TASK_ID_RE,
  productConfigPath,
} from './manifest.mjs';
import { OWNING_COMMIT_ENV, stagedLedgerHits } from './hook.mjs';

// PURE — unit tested directly. Build the full commit message text.
export function buildCommitMessage({ type, subject, task, contractChange = false, ai = 'none', body = '', override = null }) {
  if (!COMMIT_TYPES.includes(type)) throw new Error(`invalid commit type "${type}" (one of: ${COMMIT_TYPES.join(', ')})`);
  if (!subject || !subject.trim()) throw new Error('commit subject is required');
  if (!(ai in AI_COAUTHORS)) throw new Error(`unknown --ai "${ai}" (one of: ${Object.keys(AI_COAUTHORS).join(', ')})`);
  if (/\.$/.test(subject.trim())) throw new Error('subject must not end with a period');
  // A malformed task id (e.g. a bare story `EP-x-S01` with no -T<NN>) commits fine locally but
  // then fails the spec-link CI gate — forcing a history rewrite + force-push. Reject it here so
  // it never enters a trailer. A branch-derived id (taskFromBranch, which matches without case) is
  // validated the same way, so `feat/EP-Demo-S01-T01` is caught here too, as spec-link would.
  if (task && !TASK_ID_RE.test(task)) {
    throw new Error(`invalid --task "${task}" (expected EP-<slug>-S<n>-T<NN> with a lowercase slug, e.g. EP-x-S01-T02) — the spec-link CI gate would reject it`);
  }

  // A trailer is one line: a newline in the reason would end it early and start a line git reads as
  // body text or as a trailer of its own.
  if (override !== null && (typeof override !== 'string' || !override.trim() || /[\r\n]/.test(override))) {
    throw new Error('--reason must be one non-empty line (it becomes the Ledger-Override trailer)');
  }

  const trailers = [];
  if (task) trailers.push(`${TASK_TRAILER}: ${task}`);
  if (contractChange) trailers.push(`${CONTRACT_CHANGE_TRAILER}: yes`);
  if (override !== null) trailers.push(`${LEDGER_OVERRIDE_TRAILER}: ${override.trim()}`);
  const co = AI_COAUTHORS[ai];
  if (co) trailers.push(`${COAUTHOR_TRAILER}: ${co.name} <${co.email}>`);

  const parts = [`${type}: ${subject.trim()}`];
  if (body?.trim()) parts.push('', body.trim());
  if (trailers.length) parts.push('', trailers.join('\n'));
  return parts.join('\n');
}

// feat/EP-checkout-S01-T01-create-order -> EP-checkout-S01-T01
export function taskFromBranch(branch = '') {
  const m = branch.match(/(.+-S\d+-T\d+)(?:-|$)/i);
  return m ? m[1].replace(/^[a-z]+\//i, '') : null;
}

export async function runCommit(root, opts = {}) {
  log(c.bold('\nyad commit'));
  // Any folder inside the work tree, not only its top: a Product can be a subfolder of its repo, and the
  // ledger refusal sends the person to this command from there.
  if (!run('git', ['rev-parse', '--show-toplevel'], { cwd: root }).ok) { fail('not a git repo'); process.exitCode = 1; return; }
  // --manual and --reason come as a pair: an override with no reason records nothing, and a reason with
  // no --manual would be silently dropped.
  if (opts.manual && opts.reason === undefined) { fail('--manual needs --reason "<why>" — the reason is recorded in the commit as a Ledger-Override trailer'); process.exitCode = 1; return; }
  if (!opts.manual && opts.reason !== undefined) { fail('--reason is only for --manual (the ledger override)'); process.exitCode = 1; return; }

  const staged = run('git', ['diff', '--cached', '--name-only'], { cwd: root }).stdout.split('\n').filter(Boolean);
  if (!staged.length) { fail('nothing staged — `git add` your atomic change first'); process.exitCode = 1; return; }

  // An override is recorded only when there is something to override: a staged file the Product's
  // ledger hook refuses. In a code repo, on a local ledger, or for a new epic's seed, nothing is.
  // Asked without the skip switch: a YAD_HOOK_DISABLE left set in the shell would hide every hit.
  const hookEnv = { ...process.env };
  delete hookEnv.YAD_HOOK_DISABLE;
  if (opts.manual && !stagedLedgerHits({ cwd: root, env: hookEnv }).hits.length) {
    fail('--manual: nothing staged here is a file the ledger hook refuses (it guards the CI-owned ledger on a verified Product) — commit without --manual and --reason');
    process.exitCode = 1;
    return;
  }

  if (staged.length > ATOMIC_FILE_LIMIT && !opts.force) {
    fail(`${staged.length} files staged (atomic guard: ≤${ATOMIC_FILE_LIMIT}). Split the change, or pass --force.`);
    for (const f of staged) info(f);
    process.exitCode = 1;
    return;
  }

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }).stdout;
  const task = opts.task || taskFromBranch(branch);
  if (!task) {
    // spec-link is a code-repo gate (REPO_WIRING.common), not a Product gate — so a missing Task trailer
    // is expected on a Product PR (Shape artifact review or Product tooling) and only matters on a repo.
    const onHub = exists(productConfigPath(root));
    warn(onHub
      ? 'no Task trailer (none given and branch has no -S0N-T0N) — fine for a Product PR; required on code-repo tasks (spec-link gate)'
      : 'no Task trailer (none given and branch has no -S0N-T0N) — spec-link gate will fail on a code repo');
  }

  let message;
  try {
    message = buildCommitMessage({
      type: opts.type, subject: opts.message, task,
      contractChange: !!opts.contractChange, ai: opts.ai || 'none',
      override: opts.manual ? String(opts.reason) : null,
    });
  } catch (e) { fail(e.message); process.exitCode = 1; return; }

  // The --json answer (E1): what was (or would be) committed.
  const answer = { message, task: task || null, files: staged, contractChange: !!opts.contractChange, manual: !!opts.manual, reason: opts.manual ? String(opts.reason).trim() : null };
  if (opts.dryRun) { log('\n' + c.dim(message) + '\n'); info('dry run — not committed'); return { ...answer, committed: false, dryRun: true }; }

  // Only yad's own hook is skipped — any other pre-commit hook (husky, lint-staged) still runs.
  const r = run('git', ['commit', '-m', message], { cwd: root, ...(opts.manual ? { env: OWNING_COMMIT_ENV() } : {}) });
  if (!r.ok) { fail(`git commit failed — ${r.stderr.split('\n')[0] || r.code}`); process.exitCode = 1; return { ...answer, committed: false, dryRun: false }; }
  ok(`committed ${staged.length} file(s)${task ? ` for ${task}` : ''}`);
  if (opts.contractChange) warn('Contract-Change: yes — this routes back to the architecture gate');
  if (opts.manual) warn('Ledger-Override recorded — the ledger-guard check on the pull request still fails this commit; the reason is there for the reviewer');
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: root });
  return { ...answer, committed: true, dryRun: false, commit: sha.ok ? sha.stdout : null };
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
