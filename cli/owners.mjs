// `yad assign` / `yad unassign` / `yad owners` (E47) — assign an authoring step to one person.
//
// Part 4 of the roadmap: advisory claims (E46) cover most collisions, and "stronger than a lock: assign a step
// to one person." An assignment is still ADVICE: with no server nothing can stop an edit. It is shown, and
// warned about at edit time; it never blocks, never holds a gate and never refuses a fold. The row was a bare
// title, so the decisions were the user's (2026-09-25):
//   1. STORAGE: one small file per step, `<epic>/.sdlc/owners/<step>.json`. Not a ledger file name, so
//      `ledger-guard` never guards it and it is writable in both ledger modes; not a key in `state.json`, which
//      a verified Product lets only CI write, and which many skills rewrite by hand. Two assignments made at
//      once on two branches touch two files. Capture takes these files like any person-written `.sdlc/` file;
//      `yad fold` never does (an assignment is not authoring, and a fold of it alone would be a
//      "docs: author <step>" commit with nothing authored).
//   2. EFFECT: `yad next` prints a live owner beside the step, `yad owners` lists them, and the capture hook
//      warns when someone who is not the owner edits the step's files — to the agent under Claude Code, on
//      stderr elsewhere, at most once an hour per step.
//   3. IDENTITY: the git name, made branch-safe by `wipName` — the name capture branches and claims use, so
//      the hook compares like with like and never asks the platform. Two people with one git name are one.
//   4. SCOPE: the authoring steps of an epic or the Foundation that write an artifact (`FOLD_STEPS`). A review
//      step shares its artifact with its author step, and who approves is the platform's and the gate
//      count's to say (Part 3), so review steps are not assigned. No Build lanes.
//   5. REASSIGN: refused while another person owns the step, unless `--force`, which names who was replaced.
//      The owner can always unassign themselves.
//   6. ENDS: an assignment is LIVE while its step's work is open — the author step not passed, or its review
//      not passed yet (rework during a review is still the owner's). After that the file stays as a record,
//      and re-opening the step makes it live again. No time limit.
//   7. `yad assign` writes the file and commits nothing: it reaches the team when it is committed and pulled.
// The hook's throttle lives in the per-clone capture state file, read and written in turn by the push, claims
// and this; two hooks at the same instant can lose an entry — one extra warning, never a broken file.
import fs from 'node:fs';
import path from 'node:path';
import { ok, info, warn, fail, hand, readJSON, writeJSON } from './lib.mjs';
import { epicFiles, isVerifiedLedger, productConfigPath } from './manifest.mjs';
import { STEPS, epicIds, epicRel, epicRoot, isPassed, isValidEpicId, stepStatus } from './epic-state.mjs';
import { capturedEpic, gitIn, isOwnerPath, wipName, WIP_PREFIX } from './capture.mjs';
import { FOLD_STEPS, stepPaths } from './fold.mjs';

export const OWNER_STEPS = FOLD_STEPS;
export const OWNERS_DIR = '.sdlc/owners';
// How long the hook holds back a repeat warning about one step — the same hour claims use.
export const OWNER_WARN_AGAIN_MS = 60 * 60 * 1000;

export const ownerRel = (epic, step) => `${epicRel(epic)}/${OWNERS_DIR}/${step}.json`;
export { isOwnerPath };
const reviewOf = (step) => STEPS.find((s) => s.kind === 'review' && s.reviews === step)?.id || null;

// One owner file, read. `{ record }` when it is a valid assignment, `{ error }` when it is there and is not,
// `{}` when there is none. The file's `step` must be the file's own name: a copied file names another step.
export function readOwnerFile(file, step) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? {} : { error: `cannot be read (${e.code || e.message})` }; }
  let r;
  try { r = JSON.parse(text); } catch { return { error: 'is not valid JSON' }; }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: 'is not a JSON object' };
  if (r.step !== step) return { error: `names the step ${JSON.stringify(r.step ?? null)}, not ${step}` };
  if (typeof r.owner !== 'string' || !r.owner || wipName(r.owner) !== r.owner) return { error: 'has no usable "owner" (a git name, made branch-safe)' };
  return { record: { step, owner: r.owner, name: typeof r.name === 'string' && r.name.trim() ? r.name : r.owner,
    assignedBy: typeof r.assignedBy === 'string' ? r.assignedBy : null, date: typeof r.date === 'string' ? r.date : null,
    ...(r.replaced && typeof r.replaced === 'object' ? { replaced: r.replaced } : {}) } };
}

// The epic's `state.json`, read leniently: null when it is missing or broken.
export function readState(root, epic) {
  try {
    const s = JSON.parse(fs.readFileSync(epicFiles(epicRoot(root, epic)).state, 'utf8'));
    return s && Array.isArray(s.steps) ? s : null;
  } catch { return null; }
}

// Is the step's work still open (decision 6)? `unknown` when the ledger cannot be read — the hook then
// warns (the safe side for advice), and `yad assign` refuses.
export function stepOpen(state, step) {
  if (!state) return { live: true, known: false, state: null };
  const s = state.steps.find((x) => x?.id === step);
  if (!s) return { live: false, known: true, state: null, onChain: false };
  const review = reviewOf(step);
  const r = review ? state.steps.find((x) => x?.id === review) : null;
  const live = !isPassed(s) || (!!r && !isPassed(r));
  return { live, known: true, state: stepStatus(s), onChain: true, reviewState: r ? stepStatus(r) : null };
}

// The owner of a step when that assignment is live, else null.
export function liveOwner(root, epic, step, state = readState(root, epic)) {
  const { record } = readOwnerFile(path.join(root, ownerRel(epic, step)), step);
  return record && stepOpen(state, step).live ? record : null;
}

// Every owner file of one epic: valid ones with whether they are live, broken ones with why (listed, never
// dropped). A file whose name is not an assignable step is named too.
export function readOwners(root, epic) {
  const dir = path.join(root, epicRel(epic), OWNERS_DIR);
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const state = readState(root, epic);
  return names.map((n) => {
    const step = n.slice(0, -'.json'.length);
    const base = { epic, step, path: ownerRel(epic, step) };
    if (!OWNER_STEPS.includes(step)) return { ...base, error: `${base.path}: ${step} is not an authoring step, so nothing reads this file` };
    const { record, error } = readOwnerFile(path.join(dir, n), step);
    if (error) return { ...base, error: `${base.path} ${error}` };
    const open = stepOpen(state, step);
    return { ...base, ...record, live: open.live, stepState: open.state, onChain: open.onChain ?? null };
  });
}

// The git name of the person running this, raw and made branch-safe.
function whoAmI(root, env) {
  const git = gitIn(root, env);
  const raw = git(['config', 'user.name']).out.trim();
  return { raw: raw || null, me: wipName(raw, git(['config', 'user.email']).out.trim()) };
}

// The names this clone has seen on capture branches, each with the git names its tips were saved under —
// to say when `--to` names nobody known here, and to find the branch name of a git name `wipName` alone
// cannot place (one with no Latin letters falls back to the person's email, which only their machine knows).
function knownNames(root, env) {
  const git = gitIn(root, env);
  const r = git(['for-each-ref', '--format=%(refname)%00%(authorname)', `refs/remotes/origin/${WIP_PREFIX}/`, `refs/heads/${WIP_PREFIX}/`]);
  const names = new Map();
  for (const line of r.ok ? r.out.split('\n').filter(Boolean) : []) {
    const [ref, author = ''] = line.split('\0');
    const name = ref.replace(/^refs\/(remotes\/origin|heads)\//, '').slice(WIP_PREFIX.length + 1).split('/')[0];
    if (!name) continue;
    if (!names.has(name)) names.set(name, new Set());
    if (author.trim()) names.get(name).add(author.trim());
  }
  return names;
}

const who = (r) => `${r.name}${wipName(r.name) !== r.owner ? ` (${r.owner})` : ''}`;
const since = (r) => (r.date ? `, since ${r.date}` : '');

// The shared refusals of the two write verbs. Returns the epic's state, or undefined after refusing.
function checkTarget(root, { epic, step, verb, refuse }) {
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/hub.json or product.json here)', 'run it from the Product root, or pass --dir');
  if (!epic || !step) return refuse(`yad ${verb} needs an epic and a step`, `usage: yad ${verb} <epic> <step>${verb === 'assign' ? ' [--to <git name>] [--force]' : ' [--force]'}   (steps: ${OWNER_STEPS.join(', ')})`);
  if (!isValidEpicId(epic)) return refuse(`not an epic id: ${epic}`, 'an epic id looks like EP-<slug> (the Product level is EP-foundation)');
  if (!OWNER_STEPS.includes(step)) {
    const review = STEPS.find((s) => s.id === step && s.kind === 'review');
    return refuse(review ? `${step} is a review step, and review steps are not assigned` : `${step} is not an authoring step with an artifact`,
      review ? `who approves comes from the platform and the gate count; assign the step that writes it: yad ${verb} ${epic} ${review.reviews}` : `steps: ${OWNER_STEPS.join(', ')}`);
  }
  const state = readState(root, epic);
  if (!state) return refuse(`${epicRel(epic)}/.sdlc/state.json is missing or cannot be read`, 'is the epic id right? `yad next` lists the epics');
  if (!state.steps.some((s) => s?.id === step)) return refuse(`${step} is not on ${epic}'s chain`, `its steps: ${state.steps.map((s) => s?.id).filter((id) => OWNER_STEPS.includes(id)).join(', ') || '(none assignable)'}`);
  return state;
}

// `yad assign <epic> <step> [--to <name>] [--force]`. Returns a plain object (E1 makes it the `--json` answer).
export async function runAssign(root, { epic, step, to = null, force = false, env = process.env, today = new Date().toISOString().slice(0, 10) } = {}) {
  const refuse = (msg, hint) => { fail(msg); if (hint) hand(hint); process.exitCode = 1; };
  const state = checkTarget(root, { epic, step, verb: 'assign', refuse });
  if (!state) return;
  const open = stepOpen(state, step);
  if (!open.live) {
    return refuse(`${step} of ${epic} is ${open.state}${open.reviewState ? ` and its review is ${open.reviewState}` : ''} — there is no open work left to own`,
      're-open the step first if it needs more work (`yad unskip` / `yad undefer`, or a change epic)');
  }
  const { raw, me } = whoAmI(root, env);
  const name = to != null ? String(to).trim() : raw;
  if (!name) return refuse(to != null ? '--to needs a name' : 'git has no user.name to assign the step to', to != null ? 'the person\'s git user.name, as they commit' : 'git config user.name "<your name>", or name someone: --to "<their git name>"');
  // Yourself: the very name your capture branches carry, email fallback included. Someone else: their git
  // name as typed, made branch-safe the same way (a name with no Latin letters has no email here to fall back on).
  const known = to != null ? knownNames(root, env) : null;
  const byAuthor = known ? [...known].filter(([, authors]) => authors.has(name)).map(([n]) => n) : [];
  const owner = to == null ? me : (byAuthor.length === 1 ? byAuthor[0] : wipName(name));
  const rel = ownerRel(epic, step);
  const file = path.join(root, rel);
  const prev = readOwnerFile(file, step);
  if (prev.error && !force) return refuse(`${rel} ${prev.error}`, 'fix it by hand, or replace it: --force');
  if (prev.record?.owner === owner) {
    info(`${step} of ${epic} is already assigned to ${who(prev.record)}${since(prev.record)} — nothing to change`);
    return { epic, step, owner, name: prev.record.name, changed: false, replaced: null, path: rel };
  }
  if (prev.record && !force) {
    return refuse(`${step} of ${epic} is assigned to ${who(prev.record)}${since(prev.record)}`,
      `talk to them first; to replace them: yad assign ${epic} ${step}${to != null ? ` --to ${JSON.stringify(name)}` : ''} --force`);
  }
  const replaced = prev.record ? { owner: prev.record.owner, name: prev.record.name } : null;
  const record = { step, owner, name, assignedBy: raw, date: today, ...(replaced ? { replaced } : {}) };
  writeJSON(file, record);
  ok(`${step} of ${epic} assigned to ${who(record)}${replaced ? ` — replacing ${who(replaced)}` : ''}`);
  if (owner !== me && !known?.has(owner)) {
    warn(`no capture branch here is named ${owner} yet — check it is ${name}'s git user.name exactly, or the edit-time warning will never match them`);
  }
  info('advice, not a lock: the capture hook warns anyone else who edits this step\'s files; nothing is blocked');
  hand(`it reaches the team once it is committed and pulled — commit ${rel} on its own (\`yad fold\` never takes it)${isVerifiedLedger(readJSON(productConfigPath(root), null)) ? ', in a PR of its own on this verified Product: the Product checks let a PR of owner files alone through, and a review/EP-* branch is not for it' : ''}`);
  return { epic, step, owner, name, changed: true, replaced, path: rel };
}

// `yad unassign <epic> <step> [--force]`.
export async function runUnassign(root, { epic, step, force = false, env = process.env } = {}) {
  const refuse = (msg, hint) => { fail(msg); if (hint) hand(hint); process.exitCode = 1; };
  if (!checkTarget(root, { epic, step, verb: 'unassign', refuse })) return;
  const rel = ownerRel(epic, step);
  const file = path.join(root, rel);
  const prev = readOwnerFile(file, step);
  if (!prev.record && !prev.error) {
    info(`${step} of ${epic} is not assigned — nothing to change`);
    return { epic, step, changed: false, removed: null, path: rel };
  }
  if (prev.error && !force) return refuse(`${rel} ${prev.error}`, 'fix it by hand, or remove it: --force');
  const { me } = whoAmI(root, env);
  if (prev.record && prev.record.owner !== me && !force) {
    return refuse(`${step} of ${epic} is assigned to ${who(prev.record)}, not you`, `talk to them first; to remove it anyway: yad unassign ${epic} ${step} --force`);
  }
  fs.rmSync(file, { force: true });
  try { fs.rmdirSync(path.dirname(file)); } catch { /* other assignments are still there */ }
  ok(`${step} of ${epic} is no longer assigned${prev.record ? ` (was ${who(prev.record)})` : ''}`);
  hand(`commit the removal of ${rel} so the team sees it`);
  return { epic, step, changed: true, removed: prev.record ? { owner: prev.record.owner, name: prev.record.name } : null, path: rel };
}

// `yad owners [<epic>]`: every assignment, live or not, and every owner file that cannot be read.
export async function runOwners(root, { epic = null, env = process.env } = {}) {
  const refuse = (msg, hint) => { fail(msg); if (hint) hand(hint); process.exitCode = 1; };
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/hub.json or product.json here)', 'run it from the Product root, or pass --dir');
  if (epic && !isValidEpicId(epic)) return refuse(`not an epic id: ${epic}`);
  if (epic && !fs.existsSync(path.join(root, epicRel(epic)))) return refuse(`no epic ${epic} here (${epicRel(epic)}/ does not exist)`, '`yad next` lists the epics');
  const ids = epic ? [epic] : epicIds(root);   // the Foundation included
  const { me } = whoAmI(root, env);
  const owners = ids.flatMap((id) => readOwners(root, id)).map((o) => (o.error ? o : { ...o, mine: o.owner === me }));
  const good = owners.filter((o) => !o.error);
  if (!good.length && !owners.length) ok(`no step is assigned${epic ? ` on ${epic}` : ''}`);
  for (const o of good) {
    const note = o.live ? '' : ` — not live: ${o.onChain === false ? 'the step is not on the chain' : `the step is ${o.stepState}`}`;
    info(`${o.epic} ${o.step} — ${who(o)}${o.mine ? ' (you)' : ''}${since(o)}${o.assignedBy ? `, assigned by ${o.assignedBy}` : ''}${note}`);
  }
  for (const o of owners.filter((x) => x.error)) warn(o.error);
  if (good.some((o) => o.live)) info('advice, not a lock — an assignment is live while its step\'s work is open');
  return { owners };
}

// The capture hook's check (cli/capture.mjs): of the files this capture changed, which belong to a step
// someone ELSE owns? Reads only files on disk. Repeats are held back per step for an hour (kept in the
// capture's per-clone state file), as claims are.
export function ownerWarnings(root, changed, { me, now = Date.now(), statePath = null } = {}) {
  if (!changed.length || !me) return [];
  const byStep = new Map();
  const states = new Map();
  for (const p of changed) {
    const epic = capturedEpic(p);
    if (!epic || isOwnerPath(p)) continue;
    for (const step of OWNER_STEPS) {
      const own = stepPaths(epic, step) || [];
      if (!own.some((s) => p === s || p.startsWith(`${s}/`))) continue;
      if (!states.has(epic)) states.set(epic, readState(root, epic));
      const rec = liveOwner(root, epic, step, states.get(epic));
      if (!rec || rec.owner === me) continue;
      const key = `${epic}\0${step}`;
      if (!byStep.has(key)) byStep.set(key, { epic, step, owner: rec.owner, name: rec.name, date: rec.date, paths: [] });
      byStep.get(key).paths.push(p);
    }
  }
  const hits = [...byStep.values()];
  if (!hits.length || !statePath) return hits;
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') return hits; state = {}; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return hits;   // not ours to overwrite
  const warned = state.ownersWarned && typeof state.ownersWarned === 'object' ? state.ownersWarned : {};
  const fresh = hits.filter((h) => !(now - (Number(warned[`${h.epic}\0${h.step}`]) || 0) < OWNER_WARN_AGAIN_MS));
  const kept = Object.fromEntries(Object.entries(warned).filter(([, t]) => now - Number(t) < OWNER_WARN_AGAIN_MS));
  for (const h of fresh) kept[`${h.epic}\0${h.step}`] = now;
  try { writeJSON(statePath, { ...state, ownersWarned: kept }); } catch { /* a cache */ }
  return fresh;
}
export const ownerWarningText = (hits) => `yad owners: ${hits.length === 1 ? 'this step is' : 'these steps are'} assigned to someone else — advice, not a lock; talk to them before you go further:\n${hits.map((h) => `  • ${h.epic} ${h.step} — ${h.name}${since(h)}: ${h.paths.join(', ')}`).join('\n')}`;
