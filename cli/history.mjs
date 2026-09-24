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
//   2. `list` shows EVERY work item, open and shape-done, NEWEST FIRST by its created date. A value that
//      is not a real calendar date sorts last — never guessed — and ties sort by id.
//   3. `show` prints the item's summary and lineage, then every step in chain order with its state and
//      its closing record (E18) — the author steps too, which nothing printed before — and, under each
//      review step, the approvals recorded for it (E64), judged by the rules the gate counts by.
//   4. `search` matches text, ignoring case, in each item's id, title, theme, type and repos, and in its
//      steps' closing records (who closed, who merged, the PR, the commit). Approvals and the text of an
//      artifact are not searched.
//   5. "SHAPE DONE", never "finished" (the PR review): an item's `state.json` holds its Shape steps only —
//      Build (the code, the checks, the code review) is tracked elsewhere — so an item whose Shape steps
//      are all closed may have shipped nothing. `--open` / `--done` and `shapeDone` say Shape only.
//   6. `--json` refusals are `{ ok: false, error, hint }` — `yad next --json`'s shape — and every key of
//      an answer is ALWAYS present (null, false or [] when there is nothing), so a script never has to
//      ask whether a key exists. `schemaVersion` is the file shape, as in `yad index --json`; a version
//      for this output is E1's to decide.
//
// What it reads: each work item's `state.json`, `epic.md` and `change.json` (the summary), and for `show`
// and `search` its `state.json` again and its `approvals.json`; `--thread` also reads the `epic.md` of
// the work items it walks through; `show` reads the Product's settings (`hub.json`/`product.json`) for
// solo mode and the engagement rule. Nothing is written.
//
// A work item whose files cannot be read is never dropped (E19): `list` and `search` name it under every
// answer, whatever the filters, because a filter cannot know what an unreadable item holds.
//
// Everything printed from a file goes through `printable` (control and bidi characters dropped, one
// line): these values reach other people's terminals, as titles do (E111). `--json` carries each value
// as the file holds it, except where a field is kept only when it is what it should be (an approver,
// status or date only when it is text, a PR only when it is a whole number) — never a value re-typed.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, info, warn, fail, hand, exists, isPlainObject } from './lib.mjs';
import { productConfigPath, SCHEMA_VERSION } from './manifest.mjs';
import { buildIndex } from './product-index.mjs';
import {
  epicRoot, isValidEpicId, FOUNDATION_EPIC, stepStatus, acceptedHashes, isStaleHash,
  WORK_ITEM_TYPES, themeKey, threadEpics, resolveThread, printable,
  claimsInherited, claimsSkipped, isSkippableStep, optionalStepsFor,
} from './epic-state.mjs';
import { closedLine, prText, requireEngagement, isSolo } from './gate.mjs';

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

// Are the item's SHAPE steps done (rule 5)? Every step in its `state.json` closed for good: `done`,
// `skipped` or `satisfied`. A `deferred` step is still owed (E37), so it keeps the item open, as does a
// step in a state this release does not know. An item with no steps has not started, so it is open.
// Build is not counted: it is not in this file.
const SHAPE_DONE_STATES = ['done', 'skipped', 'satisfied'];
export function isShapeDone(item) {
  const steps = item.steps || {};
  const total = Object.values(steps).reduce((n, v) => n + (Number.isInteger(v) ? v : 0), 0);
  return total > 0 && SHAPE_DONE_STATES.reduce((n, s) => n + (steps[s] || 0), 0) === total;
}

// What is wrong with the filters, or null. Checked before anything is read: a value that can match
// nothing is a typo, not an answer. A type is compared without case (`Chore` is `chore`).
export function filterError({ type = null, theme = null, thread = null, open = false, done = false } = {}) {
  if (open && done) return { error: '--open and --done cannot be used together', hint: 'use one, or neither to see every work item' };
  if (type !== null && !WORK_ITEM_TYPES.includes(String(type).toLowerCase())) {
    return { error: `unknown work-item type: ${type}`, hint: `a work-item type is one of ${WORK_ITEM_TYPES.join(' · ')}` };
  }
  if (thread !== null && !isValidEpicId(thread)) return { error: `invalid thread id: ${thread}`, hint: 'a thread is named by a work-item id, EP-<slug>' };
  if (thread === FOUNDATION_EPIC) {
    return { error: `${FOUNDATION_EPIC} is the product level and is in no feature thread`, hint: `\`yad history show ${FOUNDATION_EPIC}\` shows it` };
  }
  if (theme !== null && themeKey(theme) === '') return { error: `--theme ${JSON.stringify(theme)} has no letters or digits to match`, hint: 'a theme is matched by its letters and digits' };
  return null;
}

// The filters as one test: { error, hint } or { keep(item) }. `threadMembers`: the ids in the thread
// `--thread` names, as `yad thread` finds them — by walking `parent:`, never by the `thread:` key, which
// is only a cache (a genesis written before the key existed never matched its own thread).
export function historyFilter(flags = {}, { threadMembers = null } = {}) {
  const bad = filterError(flags);
  if (bad) return bad;
  const { type = null, theme = null, thread = null, open = false, done = false } = flags;
  const wantType = type === null ? null : String(type).toLowerCase();
  // A theme groups by its folded key, as `yad doctor` groups it (E31): `Checkout Revamp` and
  // `checkout-revamp` are one theme typed twice.
  const wantTheme = theme === null ? null : themeKey(theme);
  const members = thread === null ? null : new Set(threadMembers || []);
  return {
    keep: (item) => (wantType === null || item.type === wantType)
      && (wantTheme === null || themeKey(item.theme) === wantTheme)
      && (members === null || members.has(item.id))
      && (!open || !isShapeDone(item))
      && (!done || isShapeDone(item)),
  };
}

// Text compared without case. `NFKC` first, so an accent typed as one character or as two matches
// either way. Not every language's case rules are followed: `ß` does not match `SS`.
const fold = (s) => s.normalize('NFKC').toLowerCase();

// What `search` matches in one item: [{ field, value, step }], empty when nothing does. `steps` is the
// item's `state.json` steps, or null when they could not be read (then only the summary is searched).
//   - words (id, title, theme, type, repos, who closed, who merged) match anywhere in the value;
//   - a PR matches as the WHOLE number — `12`, `#12`, `PR 12` or `PR #12` finds PR 12, never 112 —
//     since a part of a number is not a PR anyone means;
//   - a commit matches from its START, and only from 4 characters on: a short commit finds the full one,
//     and a digit or two does not match half the hashes in the Product.
// Only text is matched, and a PR only as a whole number: `String()` of any other value would match text
// that is not in the file (`[object Object]`).
export function searchMatches(item, steps, text) {
  const needle = fold(String(text).trim());
  // `12`, `#12`, `PR 12`, `pr12` and `PR #12` all name PR 12.
  const prWanted = needle.replace(/^(pr\s*#?|#)\s*/, '');
  const prQuery = /^\d+$/.test(prWanted) ? Number(prWanted) : null;
  const hits = [];
  const hit = (field, value, step) => hits.push({ field, value, step: step ?? null });
  const words = (field, value, step) => { if (typeof value === 'string' && fold(value).includes(needle)) hit(field, value, step); };
  words('id', item.id);
  words('title', item.title);
  words('theme', item.theme);
  words('type', item.type);
  for (const r of item.repos || []) words('repo', r);
  for (const s of Array.isArray(steps) ? steps : []) {
    const k = isPlainObject(s) && isPlainObject(s.closed) ? s.closed : null;
    if (!k) continue;
    const id = typeof s.id === 'string' ? s.id : null;
    words('closed.by', k.by, id);
    words('closed.mergedBy', k.mergedBy, id);
    const pr = prText(k.pr);
    if (pr !== null && prQuery !== null && Number(pr) === prQuery) hit('closed.pr', pr, id);
    if (typeof k.commit === 'string' && needle.length >= 4 && fold(k.commit).startsWith(needle)) hit('closed.commit', k.commit, id);
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

// One JSON file: { value }, { missing: true } or { why }. Read here rather than through
// `readJSONStrict`, which names every failure `YAD-STATE-001`: a view that says why a file could not be
// read must tell "does not parse" from "is a folder" or "permission denied". Nothing is written, so no
// shape stamp is needed.
function readJsonFile(file) {
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

// One item's `state.json`: { state, steps } or { why }. The summary was built a moment earlier from the
// same file; if it changed in between (a checkout, a pull), this says so rather than guessing. `state`
// is the whole file, for the route (`optionalStepsFor`).
export function readState(root, id) {
  const r = readJsonFile(path.join(epicRoot(root, id), '.sdlc', 'state.json'));
  if (r.missing) return { why: 'it is missing now' };
  if (r.why) return { why: r.why };
  return Array.isArray(r.value?.steps) ? { state: r.value, steps: r.value.steps } : { why: 'it has no list of steps' };
}

// The Product's settings, strictly: { hub } or { why }. A file that does not parse is said, never read
// as "team mode, no engagement rule" — that would print a confident count the gate itself refuses.
function readHub(root) {
  const r = readJsonFile(productConfigPath(root));
  if (r.missing) return { hub: null };
  if (r.why) return { why: r.why };
  return isPlainObject(r.value) ? { hub: r.value } : { why: 'it is not an object' };
}

// Why a recorded approval does not count, in the order the gate asks — or null when it counts:
//   'not-an-approval' (another status, such as `inherited` or `changes-requested`), 'stale', 'unnamed'
//   (it names nobody; the gate counts people), 'unengaged' (engagement is required and not verified).
function notCountedReason(a, { approved, stale, named, reqEng }) {
  if (!approved) return 'not-an-approval';
  if (stale) return 'stale';
  if (!named) return 'unnamed';
  if (reqEng && a.engagement !== 'verified') return 'unengaged';
  return null;
}

const NOT_JUDGED = { stale: null, counted: null, notCounted: null };

// The whole story of one item, for `show`. Throws nothing: every part that cannot be read says why.
// `hub` / `hubWhy`: the Product's settings, or why they could not be read.
export function itemHistory(root, item, { hub = null, hubWhy = null } = {}) {
  const epicDir = epicRoot(root, item.id);
  const stateRead = readState(root, item.id);
  const approvalsRead = readJsonFile(path.join(epicDir, '.sdlc', 'approvals.json'));
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
    if (!isPlainObject(s)) {
      out.push({ id: null, type: null, state: null, known: false, notAStep: true, closed: null, record: null, inheritedFrom: null, debt: false, approvals: null, staleUnknown: null });
      continue;
    }
    const review = s.type === 'review+approve';
    const row = {
      id: typeof s.id === 'string' ? s.id : null,
      type: typeof s.type === 'string' ? s.type : null,
      // The canonical state (`blocked` with no record reads `todo`, E38); one this release cannot name
      // is carried as written and flagged, never renamed.
      state: stepStatus(s) || (typeof s.status === 'string' ? s.status : null),
      known: stepStatus(s) !== null,
      notAStep: false,
      closed: isPlainObject(s.closed) ? s.closed : null,
      record: isPlainObject(s.record) ? s.record : null,
      inheritedFrom: typeof s.inheritedFrom === 'string' ? s.inheritedFrom : null,
      debt: s.debt === true,
      approvals: review && approvals ? [] : null,
      staleUnknown: null,
    };
    if (review && approvals) {
      // The rules `gate status` and `gatePredicate` count by. An APPROVED record whose fingerprint is
      // outside the accepted ones is stale (never "not today's exact hash"); one that names nobody is not
      // counted, since the gate counts people; with `requireEngagement` on, one with no verified
      // engagement is not counted. A record of another status is shown, and counts for nothing.
      //
      // `counted` is per RECORD, not a head count: two approvals from one person are both counted, and
      // the gate counts that person once. It is null — no count applies — where the gate counts nothing:
      // in solo mode (approvals are waived, E10), and on a step the gate waives before it reads any
      // approval. That second case is decided by the gate's own test, on what the step CLAIMS — an
      // inherited claim, or a skip this item's route allows (`isSkippableStep`) — never by its final
      // state, as `gate status` decides it: a skip on a step the route requires is not honoured, and its
      // approvals are judged like any other. On a waived step `stale` is null as well — `gatePredicate`
      // never judges it, and an inherited review's content is the parent's, so this item's own
      // fingerprint would give the wrong answer. In solo mode `stale` is still told. When the settings
      // cannot be read, solo mode and the engagement rule are unknown, so `counted` is null too.
      const notJudged = claimsInherited(s) || (claimsSkipped(s) && isSkippableStep(s.id, optional));
      let accepted = null;
      if (!notJudged) {
        try {
          accepted = typeof s.artifact === 'string' ? acceptedHashes(epicDir, s.artifact) : [];
        } catch (e) {
          row.staleUnknown = e.code || e.message;
        }
      }
      row.approvals = approvals.filter((a) => isPlainObject(a) && a.step === s.id).map((a) => {
        const approved = a.status === 'approved';
        const pr = prText(a.pr);
        const fields = {
          approver: typeof a.approver === 'string' ? a.approver : null,
          status: typeof a.status === 'string' ? a.status : null,
          date: typeof a.date === 'string' ? a.date : null,
          // An inherited record names the epic whose review it took over, not a person (E42).
          from: typeof a.from === 'string' ? a.from : null,
          source: typeof a.source === 'string' ? a.source : null,
          pr: pr === null ? null : Number(pr),
          engagement: typeof a.engagement === 'string' ? a.engagement : null,
        };
        if (notJudged) return { ...fields, ...NOT_JUDGED };
        const stale = !approved ? null : accepted === null ? null : isStaleHash(a.artifactHash, accepted);
        if (approved && (stale === null || solo || hubWhy)) return { ...fields, stale, counted: null, notCounted: null };
        // Named by the gate's own test (`gatePredicate`): any text that is not blank, even text with
        // nothing printable in it — the gate counts that record, so this must too.
        const named = typeof a.approver === 'string' && a.approver.trim() !== '';
        const notCounted = notCountedReason(a, { approved, stale, named, reqEng });
        return { ...fields, stale, counted: notCounted === null, notCounted };
      });
    }
    out.push(row);
  }
  // The thread as `yad thread` walks it, not the `thread:` key in epic.md, which is only a cache.
  let thread = { root: null, broken: null };
  if (item.id !== FOUNDATION_EPIC) {
    try {
      const walk = resolveThread(root, item.id);
      thread = { root: walk.rootId, broken: walk.broken || null };
    } catch (e) {
      thread = { root: null, broken: `the thread could not be walked (${e.code || e.message})` };
    }
  }
  return {
    thread,
    steps: stateRead.steps ? out : null,
    stepsWhy: stateRead.steps ? null : stateRead.why,
    approvalsWhy,
    hubWhy,
  };
}

// ---- printing ---------------------------------------------------------------------------------------

const nameOf = (item) => printable(item.title) ?? item.id;
const typeOf = (item) => printable(item.type) ?? (item.id === FOUNDATION_EPIC ? 'product level (the Foundation)' : null);
const withShapeDone = (item) => ({ ...item, shapeDone: isShapeDone(item) });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function itemLine(item) {
  const meta = [
    ...(item.title ? [item.id] : []),
    typeOf(item),
    printable(item.theme) ? `#${printable(item.theme)}` : null,
    printable(item.currentStep) ? `at ${printable(item.currentStep)}` : null,
    isShapeDone(item) ? 'shape done' : null,
    printable(item.lastClosed?.date) ? `last closed ${printable(item.lastClosed.date)}` : null,
  ].filter(Boolean).join(' · ');
  log(`  ${isShapeDone(item) ? c.green('✓') : c.yellow('•')} ${c.bold(nameOf(item))}  ${c.dim(meta)}`);
}

function printUnreadable({ unreadable, unlisted }) {
  for (const u of unreadable) warn(`${u.id} could not be read — ${printable(u.why)} (not filtered: its type, theme and steps are unknown)`);
  // What `unlistedLedgerDirs` returns is more than one kind of folder (a name that is not an id, a
  // symlink, an `epics/EP-foundation` beside `foundation/`), so the line says only what is known.
  for (const d of unlisted) warn(`${printable(d)} holds a .sdlc/ that is not read as a work item, so it is not listed`);
  if (unreadable.length || unlisted.length) hand('fix or restore the files named above — `yad doctor` checks them');
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...obj }, null, 2)}\n`);
}

// A refusal, in the form the caller asked for (rule 6): JSON under `--json`, a line and a hint otherwise.
function refuse(json, error, hint = null) {
  process.exitCode = 1;
  if (json) return printJson({ ok: false, error, hint });
  fail(error);
  if (hint) hand(hint);
}

function stepLine(s) {
  if (s.notAStep) return `    ${c.yellow('•')} ${c.dim('(not a step object)')}`;
  // A tick for a step closed for good; a deferred one is still owed, so it keeps the open mark (E37).
  const tick = SHAPE_DONE_STATES.includes(s.state) ? c.green('✓') : c.yellow('•');
  const state = s.known ? s.state : `${printable(s.state) ?? 'no state'} (unknown)`;
  // The same words `gate status` uses for an inherited step and for debt (E41).
  const notes = [
    s.type === 'review+approve' ? 'review' : null,
    printable(s.inheritedFrom) ? `inherited from ${printable(s.inheritedFrom)}` : null,
    s.debt && s.state === 'deferred' ? 'still owed, as debt' : s.debt ? 'owed as debt — being paid back' : null,
  ].filter(Boolean);
  return `    ${tick} ${printable(s.id) ?? '(no id)'} ${c.dim(`— ${state}${notes.length ? `, ${notes.join(', ')}` : ''}`)}`;
}

function recordLine(s) {
  const r = s.record;
  const [by, date, reason, link] = [r.by, r.date, r.reason, r.link].map(printable);
  // A link the reason already names is not said twice ("carried by reference from EP-x (EP-x)").
  const linkShown = link && !(reason && reason.includes(link)) ? ` (${link})` : '';
  return `${printable(s.state) ?? 'recorded'}${by ? ` by ${by}` : ''}${date ? ` on ${date}` : ''}${reason ? ` — ${reason}` : ''}${linkShown}`;
}

const NOT_COUNTED_WORDS = {
  stale: 'stale (revoked)',
  unnamed: 'names nobody (not counted)',
  unengaged: 'not engagement-verified (not counted)',
};

function approvalLine(a) {
  // The reason is carried on the record (`notCounted`), so the words can never disagree with the count.
  const tag = NOT_COUNTED_WORDS[a.notCounted] || (a.stale === true ? NOT_COUNTED_WORDS.stale : null);
  const nameless = typeof a.approver === 'string' && a.approver.trim() !== '' ? 'a name with no visible characters' : 'nobody named';
  const who = a.status === 'inherited' ? ` from ${printable(a.from) ?? 'the parent epic'}` : ` by ${printable(a.approver) ?? nameless}`;
  return `${printable(a.status) ?? 'recorded'}${who}${a.date ? ` on ${printable(a.date)}` : ''}${a.pr !== null ? ` (PR #${a.pr})` : ''}${tag ? ` — ${tag}` : ''}`;
}

// ---- the commands -------------------------------------------------------------------------------------

function listCmd(read, keep, { json, thread, threadNote }) {
  const items = newestFirst(read.items.filter(keep));
  if (json) {
    return printJson({ ok: true, items: items.map(withShapeDone), unreadable: read.unreadable, unlisted: read.unlisted, threadBroken: thread?.broken ?? null });
  }
  const more = read.unreadable.length ? ` (${read.unreadable.length} more could not be read)` : '';
  log(c.bold(`\nyad history — ${plural(items.length, 'work item')}${items.length === read.items.length ? '' : ` of ${read.items.length}`}${more}, newest first`));
  for (const item of items) itemLine(item);
  if (!items.length) info(read.items.length ? 'no work item matches these filters' : 'no work items yet');
  threadNote();
  printUnreadable(read);
}

function searchCmd(root, read, keep, text, { json, thread, threadNote }) {
  const found = [];
  const summaryOnly = [];
  for (const item of newestFirst(read.items.filter(keep))) {
    const r = readState(root, item.id);
    if (!r.steps) summaryOnly.push({ id: item.id, why: r.why });
    const matches = searchMatches(item, r.steps || null, text);
    if (matches.length) found.push({ ...withShapeDone(item), matches });
  }
  if (json) {
    return printJson({ ok: true, query: text, items: found, summaryOnly, unreadable: read.unreadable, unlisted: read.unlisted, threadBroken: thread?.broken ?? null });
  }
  log(c.bold(`\nyad history search ${JSON.stringify(printable(text))} — ${plural(found.length, 'work item')}`));
  for (const item of found) {
    itemLine(item);
    for (const m of item.matches) log(`      ${c.dim(`${m.step ? `${printable(m.step)}: ` : ''}${m.field} = ${printable(m.value)}`)}`);
  }
  if (!found.length) {
    info('nothing matches');
    hand('search covers ids, titles, themes, types, repos, and who closed or merged a step, its PR and its commit — not approvals; `yad history show <id>` lists an item\'s approvals');
  }
  threadNote();
  for (const s of summaryOnly) warn(`${s.id}: its steps could not be read (${s.why}), so only its summary was searched`);
  printUnreadable(read);
}

function showCmd(root, read, id, { json }) {
  const bad = read.unreadable.find((u) => u.id === id);
  if (bad) return refuse(json, `${id} could not be read — ${printable(bad.why)}`, 'fix or restore its files — `yad doctor` checks them');
  const item = read.items.find((i) => i.id === id);
  if (!item) return refuse(json, `no work item ${id} in this Product`, '`yad history` lists the work items');
  const hubRead = readHub(root);
  const story = itemHistory(root, item, { hub: hubRead.hub ?? null, hubWhy: hubRead.why ?? null });
  // Steps that cannot be read are a failure in both forms: a script reading `--json` must see it too.
  if (!story.steps) process.exitCode = 1;
  if (json) {
    const failed = story.steps ? {} : { error: `the steps could not be read — .sdlc/state.json: ${story.stepsWhy}`, hint: 'restore it from git — `yad doctor` checks it' };
    return printJson({ ok: story.steps !== null, ...failed, item: withShapeDone(item), ...story });
  }

  log(`\n  ${c.bold(nameOf(item))}${item.title ? `  ${c.dim(item.id)}` : ''}`);
  const threadText = story.thread.root ? `${story.thread.root}${story.thread.broken ? ` (${printable(story.thread.broken)})` : ''}` : null;
  const facts = [
    ['type', typeOf(item)],
    ['theme', printable(item.theme)],
    ['thread', threadText],
    ['parent', printable(item.parent)],
    ['profile', printable(item.profile)],
    ['created', printable(item.createdAt)],
    ['current step', printable(item.currentStep)],
    ['repos', item.repos.length ? item.repos.map((r) => printable(r)).filter(Boolean).join(', ') : null],
    ['shape', isShapeDone(item) ? 'done (Build is not shown here)' : null],
  ].filter(([, v]) => v);
  for (const [k, v] of facts) log(`    ${c.dim(`${k}:`)} ${v}`);
  if (story.hubWhy) warn(`the Product's settings could not be read — ${story.hubWhy}; whether an approval counts is not told`);
  if (story.approvalsWhy) {
    warn(`.sdlc/approvals.json could not be read — ${story.approvalsWhy}; no approvals are shown`);
    hand('restore it from git — `yad doctor` checks it');
  }
  if (!story.steps) {
    warn(`the steps could not be read — .sdlc/state.json: ${story.stepsWhy}`);
    hand('restore it from git — `yad doctor` checks it');
    return;
  }
  if (!story.steps.length) { info('no steps yet'); return; }
  log('');
  for (const s of story.steps) {
    log(stepLine(s));
    if (s.closed) log(`      ${c.dim(closedLine(s.closed))}`);
    if (s.record && !s.closed) log(`      ${c.dim(recordLine(s))}`);
    for (const a of s.approvals || []) log(`      ${c.dim(approvalLine(a))}`);
    if (s.staleUnknown) log(`      ${c.dim(`whether these approvals are stale cannot be told — ${printable(s.staleUnknown)}`)}`);
  }
  const closedCount = story.steps.filter((s) => s.closed).length;
  info(`${plural(closedCount, 'step')} of ${story.steps.length} ${closedCount === 1 ? 'has' : 'have'} a closing record`);
}

// The flags `yad history` takes. `unknownFlags`: any other flag the dispatcher saw, which is refused —
// a flag quietly ignored reads as a filter that was applied (`--since` would print everything).
export const HISTORY_FLAGS = ['--type', '--theme', '--thread', '--open', '--done', '--json', '--dir'];

export async function runHistory(root, { action = 'list', args = [], json = false, unknownFlags = [], ...flags } = {}) {
  // A flag first: `yad history --opne` is a mistyped flag, not a subcommand named `--opne`.
  if (unknownFlags.length) {
    return refuse(json, `yad history does not take ${unknownFlags.join(', ')}`, `its flags are ${HISTORY_FLAGS.join(', ')}`);
  }
  if (!['list', 'show', 'search'].includes(action)) {
    return refuse(json, `unknown history command: ${printable(action)}`, 'use `yad history list`, `yad history show <id>` or `yad history search <text>`');
  }
  if (action === 'list' && args.length) {
    return refuse(json, `list takes no words (${args.map((a) => JSON.stringify(printable(a) ?? '')).join(' ')})`, 'to find text, use `yad history search <text>`');
  }
  const filtersGiven = ['type', 'theme', 'thread'].filter((k) => flags[k] != null).map((k) => `--${k}`)
    .concat(['open', 'done'].filter((k) => flags[k]).map((k) => `--${k}`));
  if (action === 'show' && filtersGiven.length) {
    return refuse(json, `show prints one work item, so ${filtersGiven.join(' and ')} cannot apply`, 'the filters are for list and search');
  }
  if (action === 'show' && (!args[0] || !isValidEpicId(args[0]) || args.length > 1)) {
    return refuse(json, !args[0] ? 'show needs a work-item id' : args.length > 1 ? 'show takes one work-item id' : `invalid work-item id: ${printable(args[0])}`,
      'a work-item id is EP-<slug>; `yad history` lists them');
  }
  const text = action === 'search' ? args.join(' ').trim() : null;
  if (action === 'search' && !text) return refuse(json, 'search needs some text', 'yad history search <text>');
  if (!exists(productConfigPath(root))) return refuse(json, 'no Product here (.sdlc/product.json)', 'run `yad history` from the Product, or pass --dir <path>');
  // Checked before anything is read: a refused value reads no file.
  if (action !== 'show') {
    const bad = filterError(flags);
    if (bad) return refuse(json, bad.error, bad.hint);
  }
  // The thread's members as `yad thread` finds them — plus its root, which `threadEpics` leaves out when
  // it has no `epic.md` yet (a genesis seeded by `yad-analysis` before its epic step). A thread whose
  // named epic has no folder is refused; a walk broken further up is reported, never read as "empty".
  let thread = null;
  if (action !== 'show' && flags.thread) {
    try {
      const walk = resolveThread(root, flags.thread);
      if (walk.broken === `missing epic ${flags.thread}`) {
        return refuse(json, `no work item ${flags.thread} to start a thread from`, '`yad thread` lists the feature threads');
      }
      thread = { members: [...new Set([...threadEpics(root, flags.thread), walk.rootId])], broken: walk.broken || null };
    } catch (e) {
      // The walk reads each member's epic.md as well as the folder, so the message names the walk.
      return refuse(json, `the thread ${flags.thread} could not be walked (${e.code || e.message})`, 'fix or restore the files it reads — `yad doctor` checks them');
    }
  }
  const read = readItems(root);
  if (read.error) return refuse(json, `${read.error}, so there is no honest history to show`, '`yad doctor` checks the Product');
  if (action === 'show') return showCmd(root, read, args[0], { json });
  const { keep } = historyFilter(flags, { threadMembers: thread?.members ?? null });
  // What the walk could not follow is said, never left to read as "nothing in this thread".
  const threadNote = () => { if (thread?.broken) warn(`thread ${flags.thread}: ${printable(thread.broken)}`); };
  if (action === 'list') return listCmd(read, keep, { json, thread, threadNote });
  return searchCmd(root, read, keep, text, { json, thread, threadNote });
}
