// `yad reports list | open | prune` (E180) — the saved reports in the local reports folder.
// See reports-dir.mjs for where the folder is and how a file is named.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { c, log, ok, info, warn, refuse, emitJSON, forTerminal } from './lib.mjs';
import { listReports, pruneReports, REPORTS_ENV } from './reports-dir.mjs';
import { openUrl } from './report.mjs';

export const REPORTS_USAGE = 'usage: yad reports [list] [--json] · yad reports open <n|file> · yad reports prune --older-than <days> [--apply] [--json]';

const FRESH = { fresh: 'fresh', stale: 'stale — the Product changed since', unknown: 'unknown' };

export async function runReports(root, { action = 'list', args = [], olderThan = null, apply = false, json = false, env = process.env, runner = spawnSync, opener = openUrl } = {}) {
  if (action === 'list') {
    if (args.length) return refuse(`yad reports list takes no words (got: ${args.map(forTerminal).join(' ')})`, REPORTS_USAGE, { json });
    const r = listReports(root, { env, runner });
    if (r.problem) return refuse(r.problem, null, { json });
    if (json) return emitJSON({ dir: r.dir, via: r.via, entries: r.entries });
    log(c.bold('\nyad reports'));
    info(`folder: ${forTerminal(r.dir)}${r.via === 'env' ? ` (from ${REPORTS_ENV})` : ''} — on this machine only, never committed`);
    if (!r.entries.length) { info('no reports saved yet'); return r; }
    for (const e of r.entries) {
      const mark = !e.present ? c.red('missing') : e.freshness === 'stale' ? c.yellow(FRESH.stale) : e.freshness === 'fresh' ? c.green(FRESH.fresh) : c.dim(FRESH.unknown);
      log(`  ${String(e.n).padStart(3)}  ${forTerminal(path.posix.basename(e.file))}  ${mark}${e.anonymous ? c.dim(' · anonymous') : ''}`);
    }
    info('open one: yad reports open <n> · the catalog page: index.html in the folder');
    return r;
  }

  if (action === 'open') {
    if (args.length !== 1) return refuse('name one report: its number from `yad reports list`, or its file name', REPORTS_USAGE, { json });
    const r = listReports(root, { env, runner });
    if (r.problem) return refuse(r.problem, null, { json });
    const want = String(args[0]);
    const hit = /^\d+$/.test(want) ? r.entries.find((e) => e.n === Number(want)) : r.entries.find((e) => e.file === want || path.posix.basename(e.file) === want);
    if (!hit) return refuse(`no saved report ${forTerminal(want)}`, 'see them with: yad reports list', { json });
    if (!hit.present) return refuse(`${forTerminal(hit.file)} is in the catalog but its file is gone`, 'drop it from the catalog with: yad reports prune --older-than 0 --apply', { json });
    const file = path.join(r.dir, hit.file);
    const opened = opener(file);
    if (json) return emitJSON({ file, opened, freshness: hit.freshness });
    if (opened) ok(`opened ${forTerminal(file)}`);
    else info(`no browser opener was found here (open, xdg-open or explorer) — open ${forTerminal(file)} yourself`);
    if (hit.freshness === 'stale') warn('this report is stale: the Product changed since it was made — run the command again for a current one');
    return { file, opened };
  }

  if (action === 'prune') {
    if (args.length) return refuse(`yad reports prune takes no words (got: ${args.map(forTerminal).join(' ')})`, REPORTS_USAGE, { json });
    const days = Number(olderThan);
    if (olderThan === null || olderThan === true || !Number.isInteger(days) || days < 0) return refuse('say how old: --older-than <days> (a whole number, 0 or more)', REPORTS_USAGE, { json });
    const r = pruneReports(root, { days, apply, env, runner });
    if (r.problem) return refuse(r.problem, null, { json });
    if (json) return emitJSON({ dir: r.dir, applied: !!apply, removed: r.removed, kept: r.kept });
    log(c.bold(`\nyad reports prune${apply ? '' : ' (dry run)'}`));
    if (!r.removed.length) { info(`nothing older than ${days} day(s) — ${r.kept} kept`); return r; }
    for (const e of r.removed) log(`  ${apply ? c.red('removed') : 'would remove'}  ${forTerminal(e.file)}${e.reason === 'missing' ? c.dim(' (file already gone)') : e.reason === 'outside' ? c.dim(' (not a report path inside the folder — only dropped from the catalog)') : ''}`);
    if (apply) ok(`removed ${r.removed.length}, kept ${r.kept}`);
    else info(`nothing was deleted — add --apply to remove these ${r.removed.length}`);
    return r;
  }

  return refuse(`unknown action: yad reports ${forTerminal(action)}`, REPORTS_USAGE, { json });
}

