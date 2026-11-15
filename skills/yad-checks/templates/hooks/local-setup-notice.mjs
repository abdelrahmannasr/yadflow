// local-setup NOTICE — git's post-merge and post-rewrite hooks run this after a pull (E185 part 4).
//
// When the pull changed the Product's local setup script (`.sdlc/local-setup.json`), it says, in one line, how
// many steps are new or changed for this machine, so the person (or their agent) runs `yad local-setup`.
//
// IT ONLY PRINTS. It runs no step, reaches no network, and never fails the pull: any error, an old git, a file
// that does not parse — it says nothing and exits 0. `YAD_HOOK_DISABLE=1` silences it.
//
// A NODE SCRIPT (E113), importing nothing outside Node itself. NEVER RUN FROM THE PRODUCT'S FILES: yad copies it
// from its own package into this clone's git folder (`.git/yad/local-setup-notice.mjs`), which a pull never
// changes — so a pull can never make a teammate's machine run code the pull brought (review 1). Git runs the hook
// from the top of the repo and passes the Product's folder within it (`.` when the Product is the repo). yad
// rewrites this copy; the Product turns the notice off with `"localSetupNotice": false` in .sdlc/product.json.
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

// Every git call runs from the Product's folder, and never fetches (a partial clone would fetch a missing file).
let productRoot = process.cwd();
const git = (args) => {
  const r = spawnSync('git', ['-C', productRoot, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 5_000, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
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

export function notice(product = '.') {
  if (process.env.YAD_HOOK_DISABLE === '1') return null;
  productRoot = path.resolve(process.cwd(), product);
  // No ORIG_HEAD: no move to compare. One without the file: the pull brought the script itself.
  if (git(['rev-parse', '-q', '--verify', 'ORIG_HEAD^{commit}']) === null) return null;
  const before = git(['show', `ORIG_HEAD:./${FILE}`]) ?? '';
  const after = git(['show', `HEAD:./${FILE}`]);
  if (after === null || before === after) return null;
  // Read relative to the Product (an older git than 2.31 has no --path-format).
  const commonOut = (git(['rev-parse', '--git-common-dir']) || '').trim();
  const common = commonOut ? path.resolve(productRoot, commonOut) : '';
  let record = null;
  if (common) { try { record = parse(fs.readFileSync(path.join(common, 'yad', 'local-setup-done.json'), 'utf8')); } catch { /* none yet */ } }
  const ids = broughtSteps(parse(before), parse(after), record);
  if (!ids.length) return null;
  const shown = ids.length > 6 ? `${ids.slice(0, 6).join(', ')} and ${ids.length - 6} more` : ids.join(', ');
  return `yad: the pull brought ${ids.length} local setup step(s) to look at (${shown}) — run \`yad local-setup\` (your agent: \`yad local-setup list --json\`)`;
}

// Run as a hook: print the line, if any, and never fail.
// Real paths on both sides: Node runs the main module by its real path (a junction, a linked folder, a drive
// letter's case on Windows would otherwise keep this silent for good).
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const isMain = !!process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url));
if (isMain) {
  try { const line = notice(process.argv[2] || '.'); if (line) process.stderr.write(`${line}\n`); } catch { /* never fail the pull */ }
  process.exitCode = 0;
}
