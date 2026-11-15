// local-setup NOTICE — git's post-merge and post-rewrite hooks run this after a pull (E185 part 4).
//
// When the pull changed the Product's local setup script (`.sdlc/local-setup.json`), it says, in one line, how
// many steps are new or changed for this machine, so the person (or their agent) runs `yad local-setup`.
//
// IT ONLY PRINTS. It runs no step, reaches no network, and never fails the pull: any error, an old git, a file
// that does not parse — it says nothing and exits 0. `YAD_HOOK_DISABLE=1` silences it.
//
// A NODE SCRIPT (E113), importing nothing outside Node itself: it runs from the Product, where yadflow may not be
// installed. Git runs it from the top of the repo. yad rewrites this file; the Product turns it off with
// `"localSetupNotice": false` in .sdlc/product.json.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = '.sdlc/local-setup.json';
// The same as cli/local-setup-steps.mjs (a test keeps the two equal).
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const stepHash = (step) => createHash('sha256')
  .update(JSON.stringify({ commands: step.commands ?? [], check: step.check ?? null, when: step.when ?? 'optional' }))
  .digest('hex').slice(0, 16);

const git = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 10_000 });
  return r.status === 0 ? r.stdout : null;
};
const parse = (text) => {
  if (text === null) return null;
  try { const v = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};
// Every step of a script, `{ id → hash }`, both lists, ids yad would accept only.
const hashes = (doc) => {
  const out = new Map();
  for (const list of [doc?.yadflow, doc?.team]) {
    if (!Array.isArray(list)) continue;
    for (const s of list) if (s && typeof s === 'object' && typeof s.id === 'string' && STEP_ID.test(s.id) && !out.has(s.id)) out.set(s.id, stepHash(s));
  }
  return out;
};

// The steps the move from `before` to `after` brought that this machine has not answered as they are now.
// → the ids, in the script's order.
export function broughtSteps(before, after, record) {
  const was = hashes(before);
  const answered = record && typeof record.steps === 'object' && record.steps ? record.steps : {};
  const ids = [];
  for (const [id, hash] of hashes(after)) {
    if (was.get(id) === hash) continue;
    const a = Object.hasOwn(answered, id) ? answered[id] : null;
    if (a && a.hash === hash) continue;
    ids.push(id);
  }
  return ids;
}

export function notice() {
  if (process.env.YAD_HOOK_DISABLE === '1') return null;
  const before = git(['show', `ORIG_HEAD:./${FILE}`]);
  const after = git(['show', `HEAD:./${FILE}`]);
  if (before === null || after === null || before === after) return null;
  const common = (git(['rev-parse', '--path-format=absolute', '--git-common-dir']) || '').trim();
  let record = null;
  if (common) { try { record = parse(fs.readFileSync(path.join(common, 'yad', 'local-setup-done.json'), 'utf8')); } catch { /* none yet */ } }
  const ids = broughtSteps(parse(before), parse(after), record);
  if (!ids.length) return null;
  const shown = ids.length > 6 ? `${ids.slice(0, 6).join(', ')} and ${ids.length - 6} more` : ids.join(', ');
  return `yad: the pull brought ${ids.length} local setup step(s) to look at (${shown}) — run \`yad local-setup\` (your agent: \`yad local-setup list --json\`)`;
}

// Run as a hook: print the line, if any, and never fail.
const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { const line = notice(); if (line) process.stderr.write(`${line}\n`); } catch { /* never fail the pull */ }
  process.exitCode = 0;
}
