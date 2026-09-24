// E20 — `yad history`: what the Product has done, read from the work items' own files.
//
//   yad history [list] [--type t] [--theme x] [--thread EP-…] [--open|--done] [--json]
//   yad history show <id> [--json]
//   yad history search <text> [the same filters] [--json]
//
// THE RULES, each one the user's decision (2026-09-24):
//   1. BUILT LIVE, every time, by `buildIndex` — the same builder `.sdlc/index.json` is made from, so the
//      two can never describe an item differently. The saved file is not read: it is behind on every
//      branch and after a skill hand-writes `state.json` (E17b), and `yad doctor` already says so. The
//      saved file stays the front door for apps and CI.
//   2. `list` shows EVERY work item, open and finished, NEWEST FIRST by its created date. A date that
//      does not read as a calendar date sorts last — never guessed — and ties sort by id.
//   3. `show` prints the item's summary and lineage, then every step in chain order with its state and
//      its closing record (E18) — the author steps too, which nothing printed before — and, under each
//      review step, the approvals recorded for it (E64), marked stale by the same rule `gate status` uses.
//   4. `search` matches text, ignoring case, in each item's id, title, theme, type and repos, and in its
//      steps' closing records (who closed, who merged, the PR, the commit). It opens nothing outside the
//      item's own ledger files.
//
// A work item whose files cannot be read is never dropped (E19): it is named under every answer,
// whatever the filters, because a filter cannot know what an unreadable item holds.
//
// Read-only: nothing here writes a file.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, info, warn, fail, exists, isPlainObject } from './lib.mjs';
import { productConfigPath, SCHEMA_VERSION } from './manifest.mjs';
import { buildIndex } from './product-index.mjs';
import {
  epicRoot, isValidEpicId, FOUNDATION_EPIC, stepStatus, stepStateDef, acceptedHashes, isStaleHash,
  WORK_ITEM_TYPES, themeKey,
} from './epic-state.mjs';
import { closedLine } from './gate.mjs';

// ---- the pure parts ---------------------------------------------------------------------------------

// A created date as a sortable number, or null when it is not a calendar date. `createdAt` is copied as
// written (E19 never parses it), and E71 met `2026-9-4`, so one-digit months and days are read; a time
// after the date is ignored. Anything else — a word, `2026-13-40` — is null and sorts last.
export function createdKey(v) {
  const m = typeof v === 'string' ? v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y * 10000 + mo * 100 + d;
}

// Newest first; no date last; then by id, so the order is the same on every run.
export function newestFirst(items) {
  return [...items].sort((a, b) => {
    const ka = createdKey(a.createdAt) ?? -Infinity;
    const kb = createdKey(b.createdAt) ?? -Infinity;
    if (ka !== kb) return kb - ka;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Is the work item finished? Every step closed for good: `done`, `skipped` or `satisfied`. A `deferred`
// step is still owed (E37), so it keeps the item open, as does a step in a state this release does not
// know. An item with no steps has not started, so it is open too.
const FINISHED = ['done', 'skipped', 'satisfied'];
export function isFinished(item) {
  const steps = item.steps || {};
  const total = Object.values(steps).reduce((n, v) => n + (Number.isInteger(v) ? v : 0), 0);
  return total > 0 && FINISHED.reduce((n, s) => n + (steps[s] || 0), 0) === total;
}

// The filters, checked before anything is read: a value that can match nothing is a typo, not an answer.
// Returns { error } or { keep(item) }.
export function historyFilter({ type = null, theme = null, thread = null, open = false, done = false } = {}) {
  if (open && done) return { error: '--open and --done cannot be used together' };
  if (type !== null && !WORK_ITEM_TYPES.includes(type)) return { error: `unknown work-item type: ${type} — one of ${WORK_ITEM_TYPES.join(' · ')}` };
  if (thread !== null && !isValidEpicId(thread)) return { error: `invalid thread id: ${thread} (expected EP-<slug>)` };
  // A theme groups by its folded key, as `yad doctor` groups it (E31): `Checkout Revamp` and
  // `checkout-revamp` are one theme typed twice.
  const want = theme === null ? null : themeKey(theme);
  if (want === '') return { error: `--theme ${JSON.stringify(theme)} has no letters or digits to match` };
  return {
    keep: (item) => (type === null || item.type === type)
      && (want === null || themeKey(item.theme) === want)
      && (thread === null || item.thread === thread)
      && (!open || !isFinished(item))
      && (!done || isFinished(item)),
  };
}

// What `search` matches in one item: [{ field, value, step? }], empty when nothing does. `steps` is the
// item's `state.json` steps, or null when they could not be read (then only the summary is searched).
export function searchMatches(item, steps, text) {
  const needle = String(text).toLowerCase();
  const hits = [];
  const test = (field, value, step) => {
    if (value === null || value === undefined) return;
    const s = String(value);
    if (s.toLowerCase().includes(needle)) hits.push({ field, value: s, ...(step ? { step } : {}) });
  };
  test('id', item.id);
  test('title', item.title);
  test('theme', item.theme);
  test('type', item.type);
  for (const r of item.repos || []) test('repo', r);
  for (const s of Array.isArray(steps) ? steps : []) {
    const k = isPlainObject(s) && isPlainObject(s.closed) ? s.closed : null;
    if (!k) continue;
    const id = typeof s.id === 'string' ? s.id : null;
    test('closed.by', k.by, id);
    test('closed.mergedBy', k.mergedBy, id);
    test('closed.pr', k.pr, id);
    test('closed.commit', k.commit, id);
  }
  return hits;
}

// ---- reading ----------------------------------------------------------------------------------------

// The live summary, or { error } when the epics folder itself cannot be listed.
function readItems(root) {
  try {
    const { index } = buildIndex(root);
    return {
      items: index.items.filter((i) => !i.unreadable),
      unreadable: index.items.filter((i) => i.unreadable).map(({ id, dir, why }) => ({ id, dir, why })),
      unlisted: index.unlisted || [],
    };
  } catch (e) {
    return { error: `the epics folder could not be listed (${e.code || e.message})` };
  }
}

// One ledger file: { value } or { why }. A file that is missing gives `def`. Read here rather than through
// `readJSONStrict`, which names every failure `YAD-STATE-001`: a view that says why a file could not be
// read must tell "does not parse" from "is a folder" or "permission denied". Nothing is written, so no
// shape stamp is needed.
function readLedgerFile(file, def) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { value: def };
    return { why: e.code === 'EISDIR' ? 'it is a folder' : (e.code || e.message) };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { why: 'it does not parse' };
  }
}

// The steps of one item's `state.json`, or null when they cannot be read now (the file changed since the
// summary was built, or holds no list).
function readSteps(root, id) {
  const r = readLedgerFile(path.join(epicRoot(root, id), '.sdlc', 'state.json'), null);
  return r.value && Array.isArray(r.value.steps) ? r.value.steps : null;
}

// The whole story of one item, for `show`. Throws nothing: every part that cannot be read says why.
export function itemHistory(root, item) {
  const epicDir = epicRoot(root, item.id);
  const stateRead = readLedgerFile(path.join(epicDir, '.sdlc', 'state.json'), null);
  const steps = stateRead.value && Array.isArray(stateRead.value.steps) ? stateRead.value.steps : null;
  const approvalsRead = readLedgerFile(path.join(epicDir, '.sdlc', 'approvals.json'), []);
  const approvals = Array.isArray(approvalsRead.value) ? approvalsRead.value : null;
  const approvalsWhy = approvals ? null : approvalsRead.why || 'it is not a list';
  const out = [];
  for (const s of steps || []) {
    if (!isPlainObject(s)) continue;
    const review = s.type === 'review+approve';
    const row = {
      id: typeof s.id === 'string' ? s.id : null,
      type: typeof s.type === 'string' ? s.type : null,
      // The canonical state (`blocked` with no record reads `todo`, E38); one this release cannot name
      // is carried as written and flagged, never renamed.
      state: stepStatus(s) || (typeof s.status === 'string' ? s.status : null),
      known: stepStatus(s) !== null,
      closed: isPlainObject(s.closed) ? s.closed : null,
      record: isPlainObject(s.record) ? s.record : null,
    };
    if (review && approvals) {
      // The same rule as `gate status`: stale only when the recorded fingerprint is outside the
      // accepted ones (never "not today's exact hash"). A fingerprint that cannot be taken is said.
      let accepted = null;
      let hashWhy = null;
      try {
        accepted = typeof s.artifact === 'string' ? acceptedHashes(epicDir, s.artifact) : [];
      } catch (e) {
        hashWhy = e.code || e.message;
      }
      row.approvals = approvals.filter((a) => isPlainObject(a) && a.step === s.id).map((a) => ({
        approver: typeof a.approver === 'string' ? a.approver : null,
        status: typeof a.status === 'string' ? a.status : null,
        date: typeof a.date === 'string' ? a.date : null,
        // An inherited record names the epic whose review it took over, not a person (E42).
        ...(typeof a.from === 'string' ? { from: a.from } : {}),
        ...(a.source ? { source: String(a.source) } : {}),
        ...(a.pr != null ? { pr: a.pr } : {}),
        ...(a.engagement ? { engagement: String(a.engagement) } : {}),
        stale: accepted === null ? null : isStaleHash(a.artifactHash, accepted),
      }));
      if (hashWhy) row.staleUnknown = hashWhy;
    }
    out.push(row);
  }
  return {
    steps: steps ? out : null,
    ...(steps ? {} : { stepsWhy: stateRead.why || '.sdlc/state.json has no list of steps' }),
    ...(approvalsWhy ? { approvalsWhy } : {}),
  };
}

// ---- printing ---------------------------------------------------------------------------------------

const nameOf = (item) => item.title || item.id;

function itemLine(item, extra = '') {
  const meta = [
    ...(item.title ? [item.id] : []),
    item.type || (item.id === FOUNDATION_EPIC ? 'product level' : null),
    item.theme ? `#${item.theme}` : null,
    item.currentStep ? `at ${item.currentStep}` : null,
    isFinished(item) ? 'finished' : null,
    item.lastClosed?.date ? `last closed ${item.lastClosed.date}` : null,
  ].filter(Boolean).join(' · ');
  log(`  ${isFinished(item) ? c.green('✓') : c.yellow('•')} ${c.bold(nameOf(item))}  ${c.dim(meta)}${extra}`);
}

function printUnreadable({ unreadable, unlisted }) {
  for (const u of unreadable) warn(`${u.id} could not be read — ${u.why} (not filtered: its type, theme and steps are unknown)`);
  for (const d of unlisted) warn(`${d} holds a .sdlc/ but is not a work-item id, so it is not listed`);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function printJson(obj) {
  process.stdout.write(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...obj }, null, 2)}\n`);
}

// ---- the command --------------------------------------------------------------------------------------

export async function runHistory(root, { action = 'list', args = [], json = false, ...flags } = {}) {
  if (!['list', 'show', 'search'].includes(action)) {
    fail(`unknown history command: ${action} — list, show <id> or search <text>`);
    process.exitCode = 1;
    return;
  }
  if (!exists(productConfigPath(root))) {
    fail('no Product here (.sdlc/product.json) — run `yad history` from the Product');
    process.exitCode = 1;
    return;
  }
  const filter = action === 'show' ? { keep: () => true } : historyFilter(flags);
  if (filter.error) { fail(filter.error); process.exitCode = 1; return; }
  const read = readItems(root);
  if (read.error) { fail(`${read.error}, so there is no honest history to show`); process.exitCode = 1; return; }
  const { unreadable, unlisted } = read;
  const tail = { unreadable, ...(unlisted.length ? { unlisted } : {}) };

  if (action === 'list') {
    const items = newestFirst(read.items.filter(filter.keep));
    if (json) return printJson({ items, ...tail });
    log(c.bold(`\nyad history — ${plural(items.length, 'work item')}${items.length === read.items.length ? '' : ` of ${read.items.length}`}, newest first`));
    for (const item of items) itemLine(item);
    if (!items.length) info(read.items.length ? 'no work item matches these filters' : 'no work items yet');
    printUnreadable(read);
    return;
  }

  if (action === 'search') {
    const text = args.join(' ').trim();
    if (!text) { fail('search needs some text — `yad history search <text>`'); process.exitCode = 1; return; }
    const found = [];
    for (const item of newestFirst(read.items.filter(filter.keep))) {
      const matches = searchMatches(item, readSteps(root, item.id), text);
      if (matches.length) found.push({ ...item, matches });
    }
    if (json) return printJson({ query: text, items: found, ...tail });
    log(c.bold(`\nyad history search ${JSON.stringify(text)} — ${plural(found.length, 'work item')}`));
    for (const item of found) {
      itemLine(item);
      for (const m of item.matches) log(`      ${c.dim(`${m.step ? `${m.step}: ` : ''}${m.field} = ${m.value}`)}`);
    }
    if (!found.length) info('nothing matches');
    printUnreadable(read);
    return;
  }

  // show
  const id = args[0];
  if (!id || !isValidEpicId(id)) {
    fail(id ? `invalid work-item id: ${id} (expected EP-<slug>)` : 'show needs a work-item id — `yad history show <id>`');
    process.exitCode = 1;
    return;
  }
  const bad = unreadable.find((u) => u.id === id);
  if (bad) { fail(`${id} could not be read — ${bad.why}`); process.exitCode = 1; return; }
  const item = read.items.find((i) => i.id === id);
  if (!item) { fail(`no work item ${id} in this Product`); process.exitCode = 1; return; }
  const story = itemHistory(root, item);
  if (json) return printJson({ item, ...story });

  log(`\n  ${c.bold(nameOf(item))}${item.title ? `  ${c.dim(item.id)}` : ''}`);
  const facts = [
    ['type', item.type || (id === FOUNDATION_EPIC ? 'product level' : null)],
    ['theme', item.theme],
    ['thread', item.thread],
    ['parent', item.parent],
    ['profile', item.profile],
    ['created', item.createdAt],
    ['current step', item.currentStep],
    ['repos', item.repos.length ? item.repos.join(', ') : null],
  ].filter(([, v]) => v);
  for (const [k, v] of facts) log(`    ${c.dim(`${k}:`)} ${v}`);
  if (!story.steps) { warn(`the steps could not be read — ${story.stepsWhy}`); process.exitCode = 1; return; }
  log('');
  for (const s of story.steps) {
    // A tick for a step closed for good; a deferred one is still owed, so it keeps the open mark (E37).
    const done = FINISHED.includes(s.state) && stepStateDef(s.state) !== null;
    log(`    ${done ? c.green('✓') : c.yellow('•')} ${s.id ?? '(no id)'} ${c.dim(`— ${s.known ? s.state : `${s.state} (unknown)`}${s.type === 'review+approve' ? ', review' : ''}`)}`);
    if (s.closed) log(`      ${c.dim(closedLine(s.closed))}`);
    if (s.record && !s.closed) {
      const r = s.record;
      log(`      ${c.dim(`${s.state}${r.by ? ` by ${r.by}` : ''}${r.date ? ` on ${r.date}` : ''}${r.reason ? ` — ${r.reason}` : ''}`)}`);
    }
    for (const a of s.approvals || []) {
      const tag = a.stale === true ? ' (stale — the content changed after it)' : '';
      const who = a.status === 'inherited' ? ` from ${a.from || 'the parent epic'}` : ` by ${a.approver || 'someone unnamed'}`;
      log(`      ${c.dim(`${a.status || 'recorded'}${who}${a.date ? ` on ${a.date}` : ''}${a.pr != null ? ` (PR #${a.pr})` : ''}${tag}`)}`);
    }
    if (s.staleUnknown) log(`      ${c.dim(`whether these approvals are stale cannot be told — ${s.staleUnknown}`)}`);
  }
  if (story.approvalsWhy) warn(`.sdlc/approvals.json could not be read — ${story.approvalsWhy}; no approvals are shown`);
  if (!story.steps.length) info('no steps yet');
  const closedCount = story.steps.filter((s) => s.closed).length;
  info(`${plural(closedCount, 'step')} of ${story.steps.length} ${closedCount === 1 ? 'has' : 'have'} a closing record`);
}
