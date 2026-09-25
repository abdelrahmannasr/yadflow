// `yad claims` (E46) — who else is editing which artifact, read from the E43 capture branches.
//
// "architecture.md — claimed by alice, 10:04." ADVICE, NOT A LOCK: with no server a real lock is impossible,
// and a claim never stops anyone. The decisions were the user's (2026-09-25):
//   1. SOURCE: the capture branches, and nothing else. There is no claim file and no `yad claim` command —
//      "record" is E43's capture, which already commits every edit to `yad/wip/<name>/<epic>` and pushes it.
//   2. SHOW: this command (it fetches everyone's capture branches first), and a warning at edit time from the
//      post-edit capture hook, which reads only what is already fetched and never blocks. On Claude Code the
//      warning reaches the agent (`additionalContext`); elsewhere it is a line on stderr.
//   3. EXPIRY: 4 hours after the branch's last capture — and at once for a file whose change is on the default
//      branch (its content there equals the capture's), so a merged fold releases its files.
//   4. FRESHNESS: the hook's throttled background push also starts a background fetch of everyone's capture
//      branches (cli/capture.mjs), so what the hook reads is minutes old, not hours.
//
// WHAT A CLAIM IS: a file of the epic that differs between the capture branch's tip and the tip's `Yad-Base`
// — the HEAD that capture was built on. That is exactly the person's own in-progress edits. It is NOT the
// diff against the previous capture: after a pull, a capture's tree is the NEW HEAD plus the edits, and the
// pull's changes would read as that person's work. When `Yad-Base` is not in this clone (a later HEAD is not
// an ancestor of the branch, so it was never pushed with it), the parent capture is the fallback and the
// claim is marked `basis: 'parent'` — over-reporting is the safe direction for advice.
//
// LIMITS, said in the README: capture off, or offline, is invisible; the push runs at most every 5 minutes;
// two people with one git name share branches, so they never see each other; clocks are the committer's.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ok, info, warn, fail, hand, readJSON } from './lib.mjs';
import { productConfigPath } from './manifest.mjs';
import { capturedEpic, gitIn, pushEnv, wipName, WIP_PREFIX, fetchAllArgs } from './capture.mjs';
import { resolveDefaultBranch } from './hubcommit.mjs';

export const CLAIM_HOURS = 4;
const CLAIM_MS = CLAIM_HOURS * 60 * 60 * 1000;

// The default branch as a ref this clone holds — origin's copy first, then a local branch — or null.
function defaultRef(root, git) {
  const hub = readJSON(productConfigPath(root), {}) || {};
  const def = resolveDefaultBranch((...a) => { const r = git(a); return { ok: r.ok, stdout: r.out.trim() }; }, hub);
  for (const ref of [`refs/remotes/origin/${def}`, `refs/heads/${def}`]) if (git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]).ok) return { ref, name: def };
  return { ref: null, name: def };
}

// Every open claim this clone can see. `epics` narrows to those epics; `now` is a number of milliseconds.
// Returns { me, claims: [{ path, epic, name, person, lastSavedAt, mine, basis }], defaultBranch }.
export function readClaims(root, { env = process.env, now = Date.now(), epics = null } = {}) {
  const git = gitIn(root, env);
  const prefix = git(['rev-parse', '--show-prefix']).out.trim();
  const me = wipName(git(['config', 'user.name']).out.trim(), git(['config', 'user.email']).out.trim());
  const def = defaultRef(root, git);
  const empty = git(['hash-object', '-t', 'tree', '--stdin'], '').out.trim();
  const fmt = '%(refname)%00%(objectname)%00%(committerdate:unix)%00%(authorname)%00%(trailers:key=Yad-Base,valueonly)';
  // Others' branches from the remote-tracking copies; my own from the local branches, which are the freshest.
  const roots = [`refs/remotes/origin/${WIP_PREFIX}/`, ...(me ? [`refs/heads/${WIP_PREFIX}/${me}/`] : [])];
  const listed = git(['for-each-ref', `--format=${fmt}`, ...roots]);
  const claims = [];
  for (const line of listed.ok ? listed.out.split('\n').filter(Boolean) : []) {
    const [ref, tip, date, person, baseRaw = ''] = line.split('\0');
    const rest = ref.replace(/^refs\/(remotes\/origin|heads)\//, '').slice(WIP_PREFIX.length + 1);
    const slash = rest.indexOf('/');
    const name = rest.slice(0, slash);
    const epic = rest.slice(slash + 1);
    if (slash < 1 || !/^EP-[^/]+$/.test(epic)) continue;
    if (epics && !epics.has(epic)) continue;
    const remote = ref.startsWith('refs/remotes/');
    if (remote && name === me) continue;   // my own: the local branch speaks for it
    const savedMs = Number(date) * 1000;
    if (!Number.isFinite(savedMs) || now - savedMs > CLAIM_MS) continue;
    const base = baseRaw.trim();
    let against;
    let basis = 'yad-base';
    if (base === 'none') against = empty;
    else if (base && git(['cat-file', '-e', `${base}^{tree}`]).ok) against = base;
    else {
      basis = 'parent';
      const parent = git(['rev-parse', '--verify', '-q', `${tip}^`]);
      against = parent.ok ? parent.out.trim() : empty;
    }
    const diff = git(['diff-tree', '-r', '-z', '--name-only', '--no-renames', against, tip]);
    if (!diff.ok) continue;
    let files = diff.out.split('\0').filter((p) => p && p.startsWith(prefix)).map((p) => p.slice(prefix.length))
      .filter((p) => capturedEpic(p) === epic);
    // Landed: the file's content on the default branch is the capture's — the work is merged, the claim ends.
    if (files.length && def.ref) {
      const differs = git(['diff-tree', '-r', '-z', '--name-only', '--no-renames', def.ref, tip]);
      if (differs.ok) {
        const set = new Set(differs.out.split('\0').filter(Boolean).map((p) => p.slice(prefix.length)));
        files = files.filter((p) => set.has(p));
      }
    }
    for (const p of files) {
      claims.push({ path: p, epic, name, person: person || name, lastSavedAt: new Date(savedMs).toISOString(), mine: name === me, basis });
    }
  }
  claims.sort((a, b) => a.path.localeCompare(b.path) || (a.mine - b.mine) || a.name.localeCompare(b.name));
  return { me, claims, defaultBranch: def.name };
}

const clock = (iso) => iso.slice(11, 16);
const ago = (iso, now) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};
export const claimLine = (c, now) => `${c.path} — ${c.person}${c.mine ? ' (you)' : ''}, last saved ${clock(c.lastSavedAt)} UTC (${ago(c.lastSavedAt, now)})`;

// The capture hook's check (cli/capture.mjs): of the files this capture changed, which does someone ELSE
// also have open? Reads only what is already fetched. Repeats are held back per person and file for an hour
// (kept in the capture's per-clone state file), or an agent would hear the same line on every edit.
export const WARN_AGAIN_MS = 60 * 60 * 1000;
export function claimWarnings(root, changed, { env = process.env, now = Date.now(), statePath = null } = {}) {
  if (!changed.length) return [];
  const epics = new Set(changed.map((p) => capturedEpic(p)).filter(Boolean));
  const mine = new Set(changed);
  const hits = readClaims(root, { env, now, epics }).claims.filter((c) => !c.mine && mine.has(c.path));
  if (!hits.length || !statePath) return hits;
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') return hits; state = {}; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return hits;   // not ours to overwrite
  const warned = state.claimsWarned && typeof state.claimsWarned === 'object' ? state.claimsWarned : {};
  const fresh = hits.filter((c) => !(now - (Number(warned[`${c.name}\0${c.path}`]) || 0) < WARN_AGAIN_MS));
  const kept = Object.fromEntries(Object.entries(warned).filter(([, t]) => now - Number(t) < CLAIM_MS));
  for (const c of fresh) kept[`${c.name}\0${c.path}`] = now;
  try { fs.writeFileSync(statePath, `${JSON.stringify({ ...state, claimsWarned: kept }, null, 2)}\n`); } catch { /* a cache */ }
  return fresh;
}
export const warningText = (hits, now) => `yad claims: ${hits.length === 1 ? 'this file is' : 'these files are'} also being edited by someone else — advice, not a lock; talk to them before you go further:\n${hits.map((c) => `  • ${claimLine(c, now)}`).join('\n')}`;

// `yad claims [<epic>] [--no-fetch]`. Returns a plain object (E1 makes it the `--json` answer).
export async function runClaims(root, { epic = null, noFetch = false, env = process.env, now = Date.now() } = {}) {
  const refuse = (msg, hint) => { fail(msg); if (hint) hand(hint); process.exitCode = 1; };
  const git = gitIn(root, env);
  if (!git(['rev-parse', '--show-toplevel']).ok) return refuse('not a git repository — there are no capture branches to read');
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/hub.json or product.json here)', 'run it from the Product root, or pass --dir');
  if (epic && !/^EP-[a-z0-9-]+$/.test(epic)) return refuse(`not an epic id: ${epic}`);
  let fetched = 'skipped';
  if (!noFetch) {
    if (!git(['remote', 'get-url', 'origin']).ok) fetched = 'local';
    else {
      const def = defaultRef(root, git).name;
      const r = spawnSync('git', fetchAllArgs({ prune: true, extra: [`+refs/heads/${def}:refs/remotes/origin/${def}`] }),
        { cwd: root, encoding: 'utf8', timeout: 30_000, env: { ...env, ...pushEnv(env) } });
      fetched = r.status === 0 ? 'done' : 'failed';
    }
  }
  if (fetched === 'local') info('no remote named origin — only your own captures can be read here');
  if (fetched === 'failed') warn('could not fetch the capture branches — showing what was last fetched, which may be old');
  const { claims, defaultBranch } = readClaims(root, { env, now, epics: epic ? new Set([epic]) : null });
  if (!claims.length) ok(`no open claims${epic ? ` on ${epic}` : ''} — nobody's capture branch has an unmerged change saved in the last ${CLAIM_HOURS} hours`);
  for (const c of claims) info(claimLine(c, now));
  if (claims.length) info(`advice, not a lock — a claim ends ${CLAIM_HOURS} hours after the last save, or once the file on ${defaultBranch} matches it`);
  return { fetched, expireHours: CLAIM_HOURS, defaultBranch, claims };
}
