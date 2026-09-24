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
//   2. `list` shows EVERY work item, open and finished, NEWEST FIRST by its created date. A value that is
//      not a real calendar date sorts last — never guessed — and ties sort by id.
//   3. `show` prints the item's summary and lineage, then every step in chain order with its state and
//      its closing record (E18) — the author steps too, which nothing printed before — and, under each
//      review step, the approvals recorded for it (E64), judged by the same rules `gate status` uses.
//   4. `search` matches text, ignoring case, in each item's id, title, theme, type and repos, and in its
//      steps' closing records (who closed, who merged, the PR, the commit). It opens nothing outside the
//      item's own ledger files.
//
// A work item whose files cannot be read is never dropped (E19): `list` and `search` name it under every
// answer, whatever the filters, because a filter cannot know what an unreadable item holds.
//
// Everything printed from a file goes through `shown` (control and bidi characters dropped, one line):
// these values reach other people's terminals, as titles do (E111). `--json` is data and is left as read.
//
// Read-only: nothing here writes a file.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, info, warn, fail, exists, isPlainObject, readJSON } from './lib.mjs';
import { productConfigPath, SCHEMA_VERSION } from './manifest.mjs';
import { buildIndex } from './product-index.mjs';
import {
  epicRoot, isValidEpicId, FOUNDATION_EPIC, stepStatus, acceptedHashes, isStaleHash,
  WORK_ITEM_TYPES, themeKey, threadEpics, resolveThread, shown,
  claimsInherited, claimsSkipped, isSkippableStep, optionalStepsFor,
} from './epic-state.mjs';
import { closedLine, prNumber, requireEngagement, isSolo } from './gate.mjs';

// ---- the pure parts ---------------------------------------------------------------------------------

// A created date as a sortable number, or null when it is not a real calendar date. `createdAt` is
// copied as written (E19 never parses it), and E71 met `2026-9-4`, so one-digit months and days are
// read; a time after the date is ignored. Anything else — a word, `2026-13-40`, `2026-02-31` — is null
// and sorts last.
export function createdKey(v) {
  const m = typeof v === 'string' ? v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
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
// `threadMembers`: the ids in the thread `--thread` names, as `yad thread` finds them — by walking
// `parent:`, never by the `thread:` key, which is only a cache (E20 review: a genesis epic written before
// the key existed never matched its own thread). Returns { error } or { keep(item) }.
export function historyFilter({ type = null, theme = null, thread = null, open = false, done = false } = {}, { threadMembers = null } = {}) {
  if (open && done) return { error: '--open and --done cannot be used together' };
  if (type !== null && !WORK_ITEM_TYPES.includes(type)) return { error: `unknown work-item type: ${type} — one of ${WORK_ITEM_TYPES.join(' · ')}` };
  if (thread !== null && !isValidEpicId(thread)) return { error: `invalid thread id: ${thread} (expected EP-<slug>)` };
  if (thread === FOUNDATION_EPIC) return { error: `${FOUNDATION_EPIC} is the product level and is in no feature thread` };
  // A theme groups by its folded key, as `yad doctor` groups it (E31): `Checkout Revamp` and
  // `checkout-revamp` are one theme typed twice.
  const want = theme === null ? null : themeKey(theme);
  if (want === '') return { error: `--theme ${JSON.stringify(theme)} has no letters or digits to match` };
  const members = thread === null ? null : new Set(threadMembers || []);
  return {
    keep: (item) => (type === null || item.type === type)
      && (want === null || themeKey(item.theme) === want)
      && (members === null || members.has(item.id))
      && (!open || !isFinished(item))
      && (!done || isFinished(item)),
  };
}

// Text compared without case. `NFKC` first, so an accent typed as one character or as two matches
// either way. Not every language's case rules are followed: `ß` does not match `SS`.
const fold = (s) => s.normalize('NFKC').toLowerCase();

// What `search` matches in one item: [{ field, value, step? }], empty when nothing does. `steps` is the
// item's `state.json` steps, or null when they could not be read (then only the summary is searched).
// Only text is matched, and a PR only as a whole number: a value of any other type is not what the file
// says in words, and `String()` of it would match text that is not there (`[object Object]`).
export function searchMatches(item, steps, text) {
  const needle = fold(String(text));
  const hits = [];
  const test = (field, value, step) => {
    if (typeof value !== 'string' || !fold(value).includes(needle)) return;
    hits.push({ field, value, ...(step ? { step } : {}) });
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
    test('closed.pr', prNumber(k.pr), id);
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

// One ledger file: { value }, { missing: true } or { why }. Read here rather than through
// `readJSONStrict`, which names every failure `YAD-STATE-001`: a view that says why a file could not be
// read must tell "does not parse" from "is a folder" or "permission denied". Nothing is written, so no
// shape stamp is needed.
function readLedgerFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { missing: true };
    return { why: e.code === 'EISDIR' ? 'it is a folder' : (e.code || e.message) };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { why: 'it does not parse' };
  }
}

// The steps of one item's `state.json`: { steps } or { why }. The summary was built a moment earlier
// from the same file; if it changed in between (a checkout, a pull), this says so rather than guessing.
export function readSteps(root, id) {
  const r = readLedgerFile(path.join(epicRoot(root, id), '.sdlc', 'state.json'));
  if (r.missing) return { why: 'it is missing now' };
  if (r.why) return { why: r.why };
  return Array.isArray(r.value?.steps) ? { steps: r.value.steps, state: r.value } : { why: 'it has no list of steps' };
}

// The whole story of one item, for `show`. Throws nothing: every part that cannot be read says why.
// `hub`: the Product config, for the engagement rule `gate status` applies.
export function itemHistory(root, item, { hub = null } = {}) {
  const epicDir = epicRoot(root, item.id);
  const stateRead = readSteps(root, item.id);
  const approvalsRead = readLedgerFile(path.join(epicDir, '.sdlc', 'approvals.json'));
  const approvals = approvalsRead.missing ? [] : Array.isArray(approvalsRead.value) ? approvalsRead.value : null;
  const approvalsWhy = approvals ? null : approvalsRead.why || 'it is not a list';
  const reqEng = requireEngagement(hub);
  const solo = isSolo(hub);
  // The steps THIS item's route lets be skipped — what `gatePredicate` asks before it honours a skip.
  const optional = stateRead.state ? optionalStepsFor(stateRead.state) : [];
  const out = [];
  for (const s of stateRead.steps || []) {
    // Every entry in the list is a row, so the count matches the index's: one that is not a step object
    // is said to be one, never skipped.
    if (!isPlainObject(s)) { out.push({ id: null, type: null, state: null, known: false, notAStep: true }); continue; }
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
      ...(typeof s.inheritedFrom === 'string' ? { inheritedFrom: s.inheritedFrom } : {}),
      ...(s.debt === true ? { debt: true } : {}),
    };
    if (review && approvals) {
      // The rules `gate status` and `gatePredicate` count by: an APPROVED record whose fingerprint is
      // outside the accepted ones is stale (never "not today's exact hash"); one that names nobody (an
      // approver that is not non-blank text) is not counted, since the gate counts people; with
      // `requireEngagement` on, one with no verified engagement is not counted. A record of another
      // status is shown, and neither rule applies to it. A fingerprint that cannot be taken is said.
      //
      // `counted` is per RECORD, not a head count: two approvals from one person are both counted, and
      // the gate counts that person once. It is null — no count applies — where the gate counts nothing:
      // in solo mode (approvals are waived, E10), and on a step the gate waives before it reads any
      // approval. That second case is decided by the gate's own test, on what the step CLAIMS — an
      // inherited claim, or a skip this item's route allows (`isSkippableStep`) — never by its final
      // state, as `gate status` decides it: a skip on a step the route requires is not honoured, and its
      // approvals are judged like any other. On a waived step `stale` is null as well — the gate never
      // judges it, and an inherited review's content is the parent's, so this item's own fingerprint
      // would give the wrong answer (the warning in `gatePredicate`). In solo mode `stale` is still told.
      const notJudged = claimsInherited(s) || (claimsSkipped(s) && isSkippableStep(s.id, optional));
      const waived = solo || notJudged;
      let accepted = null;
      let hashWhy = null;
      try {
        accepted = typeof s.artifact === 'string' ? acceptedHashes(epicDir, s.artifact) : [];
      } catch (e) {
        hashWhy = e.code || e.message;
      }
      row.approvals = approvals.filter((a) => isPlainObject(a) && a.step === s.id).map((a) => {
        const approved = a.status === 'approved';
        const stale = !approved || notJudged ? null : accepted === null ? null : isStaleHash(a.artifactHash, accepted);
        const engaged = a.engagement === 'verified';
        const named = typeof a.approver === 'string' && a.approver.trim() !== '';
        return {
          approver: typeof a.approver === 'string' ? a.approver : null,
          status: typeof a.status === 'string' ? a.status : null,
          date: typeof a.date === 'string' ? a.date : null,
          // An inherited record names the epic whose review it took over, not a person (E42).
          ...(typeof a.from === 'string' ? { from: a.from } : {}),
          ...(typeof a.source === 'string' ? { source: a.source } : {}),
          ...(prNumber(a.pr) !== null ? { pr: Number(prNumber(a.pr)) } : {}),
          ...(typeof a.engagement === 'string' ? { engagement: a.engagement } : {}),
          stale,
          counted: !approved ? false : waived || stale === null ? null : !stale && named && (!reqEng || engaged),
        };
      });
      if (hashWhy) row.staleUnknown = hashWhy;
    }
    out.push(row);
  }
  return {
    steps: stateRead.steps ? out : null,
    ...(stateRead.steps ? {} : { stepsWhy: stateRead.why }),
    ...(approvalsWhy ? { approvalsWhy } : {}),
  };
}

// ---- printing ---------------------------------------------------------------------------------------

const nameOf = (item) => shown(item.title) || item.id;
const withFinished = (item) => ({ ...item, finished: isFinished(item) });

function itemLine(item) {
  const meta = [
    ...(item.title ? [item.id] : []),
    shown(item.type) || (item.id === FOUNDATION_EPIC ? 'product level' : null),
    item.theme ? `#${shown(item.theme)}` : null,
    item.currentStep ? `at ${shown(item.currentStep)}` : null,
    isFinished(item) ? 'finished' : null,
    item.lastClosed?.date ? `last closed ${shown(item.lastClosed.date)}` : null,
  ].filter(Boolean).join(' · ');
  log(`  ${isFinished(item) ? c.green('✓') : c.yellow('•')} ${c.bold(nameOf(item))}  ${c.dim(meta)}`);
}

function printUnreadable({ unreadable, unlisted }) {
  for (const u of unreadable) warn(`${u.id} could not be read — ${shown(u.why)} (not filtered: its type, theme and steps are unknown)`);
  // What `unlistedLedgerDirs` returns is more than one kind of folder (a name that is not an id, a
  // symlink, an `epics/EP-foundation` beside `foundation/`), so the line says only what is known.
  for (const d of unlisted) warn(`${shown(d)} holds a .sdlc/ that is not read as a work item, so it is not listed`);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function printJson(obj) {
  process.stdout.write(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...obj }, null, 2)}\n`);
}

function stepLine(s) {
  if (s.notAStep) return `    ${c.yellow('•')} ${c.dim('(not a step object)')}`;
  // A tick for a step closed for good; a deferred one is still owed, so it keeps the open mark (E37).
  const tick = FINISHED.includes(s.state) ? c.green('✓') : c.yellow('•');
  const state = s.known ? s.state : `${shown(s.state) || 'no state'} (unknown)`;
  // The same words `gate status` uses for an inherited step and for debt (E41).
  const notes = [
    s.type === 'review+approve' ? 'review' : null,
    s.inheritedFrom ? `inherited from ${shown(s.inheritedFrom)}` : null,
    s.debt && s.state === 'deferred' ? 'still owed, as debt' : s.debt ? 'owed as debt — being paid back' : null,
  ].filter(Boolean);
  return `    ${tick} ${shown(s.id) || '(no id)'} ${c.dim(`— ${state}${notes.length ? `, ${notes.join(', ')}` : ''}`)}`;
}

function recordLine(s) {
  const r = s.record;
  const t = (v) => (typeof v === 'string' && shown(v) ? shown(v) : null);
  const [by, date, reason, link] = [r.by, r.date, r.reason, r.link].map(t);
  return `${t(s.state) || 'recorded'}${by ? ` by ${by}` : ''}${date ? ` on ${date}` : ''}${reason ? ` — ${reason}` : ''}${link ? ` (${link})` : ''}`;
}

function approvalLine(a) {
  // Why a record is not counted, in the order the gate asks: stale, then nobody named, then engagement.
  const tags = [
    a.stale === true ? 'stale (revoked)' : null,
    a.stale === false && a.counted === false && !(typeof a.approver === 'string' && a.approver.trim()) ? 'names nobody (not counted)' : null,
    a.stale === false && a.counted === false && typeof a.approver === 'string' && a.approver.trim() ? 'not engagement-verified (not counted)' : null,
  ].filter(Boolean);
  const who = a.status === 'inherited' ? ` from ${shown(a.from) || 'the parent epic'}` : ` by ${shown(a.approver) || 'nobody named'}`;
  return `${shown(a.status) || 'recorded'}${who}${a.date ? ` on ${shown(a.date)}` : ''}${a.pr != null ? ` (PR #${a.pr})` : ''}${tags.length ? ` — ${tags.join(', ')}` : ''}`;
}

// ---- the command --------------------------------------------------------------------------------------

export async function runHistory(root, { action = 'list', args = [], json = false, ...flags } = {}) {
  if (!['list', 'show', 'search'].includes(action)) {
    fail(`unknown history command: ${action} — list, show <id> or search <text>`);
    process.exitCode = 1;
    return;
  }
  if (action === 'list' && args.length) {
    fail(`list takes no words (${args.map((a) => JSON.stringify(a)).join(' ')}) — to find text, use \`yad history search <text>\``);
    process.exitCode = 1;
    return;
  }
  const filterSet = ['type', 'theme', 'thread'].filter((k) => flags[k] != null).map((k) => `--${k}`)
    .concat(['open', 'done'].filter((k) => flags[k]).map((k) => `--${k}`));
  if (action === 'show' && filterSet.length) {
    fail(`show prints one work item, so ${filterSet.join(' and ')} cannot apply — the filters are for list and search`);
    process.exitCode = 1;
    return;
  }
  if (!exists(productConfigPath(root))) {
    fail('no Product here (.sdlc/product.json) — run `yad history` from the Product');
    process.exitCode = 1;
    return;
  }
  // Checked before anything is read: a refused value reads no file.
  const checked = action === 'show' ? { keep: () => true } : historyFilter(flags);
  if (checked.error) { fail(checked.error); process.exitCode = 1; return; }
  // The thread's members as `yad thread` finds them — plus its root, which `threadEpics` leaves out when
  // it has no `epic.md` yet (a genesis seeded by `yad-analysis` before its epic step).
  let thread = null;
  if (action !== 'show' && flags.thread) {
    try {
      const walk = resolveThread(root, flags.thread);
      thread = { members: [...new Set([...threadEpics(root, flags.thread), walk.rootId])], broken: walk.broken };
    } catch (e) {
      // The walk reads each member's epic.md as well as the folder, so the message names the walk.
      fail(`the thread ${flags.thread} could not be walked (${e.code || e.message}), so there is no honest history to show`);
      process.exitCode = 1;
      return;
    }
  }
  const filter = thread ? historyFilter(flags, { threadMembers: thread.members }) : checked;
  const read = readItems(root);
  if (read.error) { fail(`${read.error}, so there is no honest history to show`); process.exitCode = 1; return; }
  const { unreadable, unlisted } = read;
  const tail = { unreadable, ...(unlisted.length ? { unlisted } : {}), ...(thread?.broken ? { threadBroken: thread.broken } : {}) };
  // What the walk could not follow is said, never left to read as "nothing in this thread".
  const threadNote = () => { if (thread?.broken) warn(`thread ${flags.thread}: ${thread.broken}`); };

  if (action === 'list') {
    const items = newestFirst(read.items.filter(filter.keep));
    if (json) return printJson({ items: items.map(withFinished), ...tail });
    log(c.bold(`\nyad history — ${plural(items.length, 'work item')}${items.length === read.items.length ? '' : ` of ${read.items.length}`}, newest first`));
    for (const item of items) itemLine(item);
    if (!items.length) info(read.items.length ? 'no work item matches these filters' : 'no work items yet');
    threadNote();
    printUnreadable(read);
    return;
  }

  if (action === 'search') {
    const text = args.join(' ').trim();
    if (!text) { fail('search needs some text — `yad history search <text>`'); process.exitCode = 1; return; }
    const found = [];
    const summaryOnly = [];
    for (const item of newestFirst(read.items.filter(filter.keep))) {
      const r = readSteps(root, item.id);
      if (!r.steps) summaryOnly.push({ id: item.id, why: r.why });
      const matches = searchMatches(item, r.steps || null, text);
      if (matches.length) found.push({ ...withFinished(item), matches });
    }
    if (json) return printJson({ query: text, items: found, ...(summaryOnly.length ? { summaryOnly } : {}), ...tail });
    log(c.bold(`\nyad history search ${JSON.stringify(shown(text))} — ${plural(found.length, 'work item')}`));
    for (const item of found) {
      itemLine(item);
      for (const m of item.matches) log(`      ${c.dim(`${m.step ? `${shown(m.step)}: ` : ''}${m.field} = ${shown(m.value)}`)}`);
    }
    if (!found.length) info('nothing matches');
    threadNote();
    for (const s of summaryOnly) warn(`${s.id}: its steps could not be read (${s.why}), so only its summary was searched`);
    printUnreadable(read);
    return;
  }

  // show
  const id = args[0];
  if (!id || !isValidEpicId(id) || args.length > 1) {
    fail(!id ? 'show needs a work-item id — `yad history show <id>`'
      : args.length > 1 ? 'show takes one work-item id' : `invalid work-item id: ${shown(id)} (expected EP-<slug>)`);
    process.exitCode = 1;
    return;
  }
  const bad = unreadable.find((u) => u.id === id);
  if (bad) { fail(`${id} could not be read — ${shown(bad.why)}`); process.exitCode = 1; return; }
  const item = read.items.find((i) => i.id === id);
  if (!item) { fail(`no work item ${id} in this Product`); process.exitCode = 1; return; }
  const story = itemHistory(root, item, { hub: readJSON(productConfigPath(root), null) });
  // Steps that cannot be read are a failure in both forms: a script reading `--json` must see it too.
  if (!story.steps) process.exitCode = 1;
  if (json) return printJson({ item: withFinished(item), ...story });

  log(`\n  ${c.bold(nameOf(item))}${item.title ? `  ${c.dim(item.id)}` : ''}`);
  const facts = [
    ['type', item.type || (id === FOUNDATION_EPIC ? 'product level' : null)],
    ['theme', item.theme],
    ['thread', item.thread],
    ['parent', item.parent],
    ['profile', item.profile],
    ['created', item.createdAt],
    ['current step', item.currentStep],
    ['repos', item.repos.length ? item.repos.map(shown).join(', ') : null],
  ].map(([k, v]) => [k, typeof v === 'string' ? shown(v) : null]).filter(([, v]) => v);
  for (const [k, v] of facts) log(`    ${c.dim(`${k}:`)} ${v}`);
  if (story.approvalsWhy) warn(`.sdlc/approvals.json could not be read — ${story.approvalsWhy}; no approvals are shown`);
  if (!story.steps) { warn(`the steps could not be read — .sdlc/state.json: ${story.stepsWhy}`); return; }
  log('');
  for (const s of story.steps) {
    log(stepLine(s));
    if (s.closed) log(`      ${c.dim(closedLine(s.closed))}`);
    if (s.record && !s.closed) log(`      ${c.dim(recordLine(s))}`);
    for (const a of s.approvals || []) log(`      ${c.dim(approvalLine(a))}`);
    if (s.staleUnknown) log(`      ${c.dim(`whether these approvals are stale cannot be told — ${shown(s.staleUnknown)}`)}`);
  }
  if (!story.steps.length) info('no steps yet');
  const closedCount = story.steps.filter((s) => s.closed).length;
  info(`${plural(closedCount, 'step')} of ${story.steps.length} ${closedCount === 1 ? 'has' : 'have'} a closing record`);
}
