// `yad ship` — commit the staged atomic change AND open its task PR/MR, in one step (build half).
// A thin orchestration over the two existing engines: `yad commit` then `yad open-pr`. It holds no
// commit/PR logic of its own — it reuses runCommit/runOpenPr so the conventions stay in one place.
// The PR step runs ONLY when the commit actually lands: a failed commit, a tripped atomic guard, or a
// --dry-run all stop before anything is pushed.
import { c, log, info } from './lib.mjs';
import { runCommit } from './commit.mjs';
import { runOpenPr } from './openpr.mjs';

export async function runShip(root, opts = {}) {
  log(c.bold('\nyad ship'));

  // Step 1 — commit by convention (atomic guard, trailers, AI co-author). On --dry-run this just
  // prints the message and returns without committing; we then stop (nothing to open a PR for).
  const committed = await runCommit(root, {
    type: opts.type, message: opts.message, task: opts.task, ai: opts.ai,
    contractChange: opts.contractChange, dryRun: opts.dryRun, force: opts.force,
  });

  if (opts.dryRun) { info('dry run — not committed, PR/MR not opened'); return committed; }

  // runCommit signals failure by setting process.exitCode (not by throwing) — honour it and abort the
  // PR step so we never open a PR for a branch whose commit did not land.
  if (process.exitCode) { info('commit did not land — skipping open-pr'); return committed; }

  // Step 2 — open the task PR/MR from the committed template (pushes the branch, auto-assigns the
  // repo-scoped roster). Pass ONLY an explicit --title: when omitted, runOpenPr derives the title
  // from the committed subject (the full `<type>: …` form), which the pr-title gate expects — passing
  // the bare --message here would override that with a type-less title and fail the gate.
  const opened = await runOpenPr(root, {
    repo: opts.repo, platform: opts.platform, base: opts.base,
    title: opts.title, task: opts.task,
    risk: opts.risk, contractChange: opts.contractChange, today: opts.today,
  });

  return { ...committed, ...opened };
}
