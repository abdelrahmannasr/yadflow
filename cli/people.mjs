// How many people are ACTIVE right now (E71) — the live count Part 3's three windows ask for, and the
// number E72's cap (`needed` capped at `active − 1`) will read.
//
// THE SAFETY DIRECTION IS THE OPPOSITE OF E66 AND E67, and it is the whole reason this file exists
// instead of a call into `yad usage`. There, an input nobody could read must never say "nobody worked
// here", because that DROPS an ask and UNDER-asks for review. Here, a low `active` LOWERS the cap and
// weakens every gate, so a partial read that looks like "few people" is the dangerous answer. Part 3
// says it in one line: when counting capacity, err towards MORE people — "undercounting weakens gates
// quietly, overcounting jams them loudly, and we have an exit for jams".
//
// So there is ONE rule here, and every decision below is it applied:
//
//     IF A SOURCE CANNOT BE READ, THE ANSWER IS `null`, NEVER A NUMBER.
//
// Not a partial count, and NOT a floor either: a floor on `active` is a CEILING on the cap, which is
// the same mistake wearing the other hat.
//
// WHY NOT `yad usage`, which already derives a people view. Because every one of its degradations runs
// the wrong way for a gate, and all four are in the code (cli/usage.mjs):
//   * `repoCommitEvents`: `if (!r.ok || !r.stdout) continue` — a repo missing from disk, not a git repo,
//     or a failing git reads as "nobody committed there".
//   * `deriveEvents`: `readJSON(repos.json, { repos: [] })` — a registry that does not parse reads as
//     "no repos". This is the bug E65 fixed in `targets()` by moving to `readJSONStrict`.
//   * `readLedger`: warns and skips a corrupt approvals file — that person vanishes.
//   * no shallow-clone check (E67 added one for exactly this class), and no `--since` at all.
// That is correct for a REPORT, where a gap is a cosmetic flaw. It is wrong for a gate input. What is
// reused is the RULES, which are sound and now shared outright: `loginFromEmail` and `isBot` from
// cli/riskmap.mjs, `ledgerPersonLogin` and `legacyLogins` from cli/epic-state.mjs, and the
// case-insensitive login key. What is new is the failure contract.
//
// NOTHING IS WRITTEN TO DISK (E7's stance, kept): the count is derived live on every call, so it can
// never go stale and never becomes an audit record of its own. No file shape moves.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { readJSONStrict } from './lib.mjs';
import { PROJECT_FILES, epicFiles } from './manifest.mjs';
import { epicIds, epicRoot, ledgerPersonLogin } from './epic-state.mjs';
import { corruptShards, readShips } from './ledger.mjs';
import { isBot, loginFromEmail } from './riskmap.mjs';

// ---- the three windows (Part 3, "Counting people") ----------------------------------------------
//
// | Purpose             | Window                                  | Shape                |
// | Expertise (tier 2)  | 30 days                                 | Fixed. Tight         |
// | Capacity (the cap)  | Last 20 merged PRs, bounded 30–180 days | Adaptive to pace     |
// | Gone / stale        | 120 days                                | Fixed. Long          |
export const EXPERTISE_DAYS = 30;
export const STALE_DAYS = 120;
export const CAPACITY_MERGES = 20;
export const CAPACITY_MIN_DAYS = 30;
export const CAPACITY_MAX_DAYS = 180;

// How much history to ASK GIT FOR, as a multiple of the widest window we can end up using (180 days).
//
// `--since` does not merely filter: git stops walking a chain at the first commit older than the date,
// so a commit whose date is out of order can hide every commit behind it. E67 recorded that limit and
// could accept it — there it UNDER-LISTS, so every name it prints is a real one, the safe side. Here
// the same behaviour UNDER-COUNTS, which lowers the cap. So we ask for twice the window and throw the
// out-of-range commits away in JS, where no ordering can hide anything (the user's decision,
// 2026-09-21). The limit shrinks; it does not vanish, and it is stated in the roadmap row.
export const WALK_PAD = 2;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A `YYYY-MM-DD` date as a whole number of days, or null when it is not one. `Date.parse` rejects an
// impossible day (`2026-02-30`) rather than rolling it forward, which is what we want from a ledger
// field a human may have typed.
export function dayNumber(date) {
  if (!DATE_RE.test(String(date ?? ''))) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 86400000) : null;
}

const dayString = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

// `days` before `date`. Null in, null out — a caller with an unreadable `today` has nothing to ask.
export function daysBefore(date, days) {
  const n = dayNumber(date);
  return n === null ? null : dayString(n - days);
}

export const todayString = () => new Date().toISOString().slice(0, 10);

// ---- who is one person --------------------------------------------------------------------------

// The key two records share when they are the same human. Case-insensitive because GitHub and GitLab
// logins are: `OctoCat` on an approval and `octocat` in a noreply commit address are one approver.
//
// A person whose git name and platform login cannot be JOINED — no noreply address, no roster pair —
// lands on TWO keys and is counted twice. That is deliberate. E64's lesson is that only exact evidence
// proves identity, and the alternative here is guessing two people into one, which makes the count
// SMALLER. Over-counting is the direction Part 3 asks for; the caller is told how many keys are
// name-only so it can say so rather than pretend.
export const personKey = (person) => String(person.login || person.name || '').trim().toLowerCase();

// ---- reading the sources ------------------------------------------------------------------------
//
// Two kinds of evidence, and only two, because Part 3 defines it: "Active" = committed OR approved
// within the window.
//   * APPROVED — the Product ledger: every Shape gate approval, and every Build ship's
//     engineer-review. Both record a platform LOGIN since E62.
//   * COMMITTED — git authorship, in the Product and in every connected code repo. Git records a NAME,
//     plus a login only when the address is a platform `noreply` one.
// A COMMENT is not either of them and does not count. Part 3 names two actions; a commenter has proven
// neither, and widening a definition the row already closed is not this row's call. The same goes for
// whoever MERGED a review PR: `closingRecord` records them, and they are used below to MEASURE THE
// WINDOW, never to fill it.

// Every approval-shaped event in the Product ledger, plus the dates of the merges that set the
// capacity window. Throws nothing: a source it cannot read becomes a line in `unknown`.
function ledgerEvidence(root, aliases) {
  const events = [];
  const merges = [];
  const unknown = [];
  let ids;
  try {
    ids = epicIds(root);
  } catch (e) {
    return { events, merges, unknown: [`the epic list could not be read: ${e.message}`] };
  }
  for (const epic of ids) {
    const dir = epicRoot(root, epic);
    const f = epicFiles(dir);
    // readJSONStrict, not readJSON: a corrupt approvals file must never read as an empty one. This is
    // the read-strictly-before-a-count twin of the read-strictly-before-a-write rule.
    let approvals;
    let state;
    try {
      approvals = readJSONStrict(f.approvals, []);
      state = readJSONStrict(f.state, null);
    } catch (e) {
      unknown.push(`${epic}: ${e.message}`);
      continue;
    }
    if (!Array.isArray(approvals)) {
      unknown.push(`${epic}: approvals.json is not a list`);
      continue;
    }
    for (const a of approvals) {
      if (!a || typeof a !== 'object') continue;
      const name = typeof a.approver === 'string' ? a.approver.trim() : '';
      if (!name || dayNumber(a.date) === null) continue;
      events.push({ ts: a.date, name, login: ledgerPersonLogin(a, name, aliases), how: 'approved' });
    }
    // A merged review PR, as the Product recorded it: a step whose closing record carries a PR number
    // and a date. This is what "the last 20 merged PRs" reads (the user's decision, 2026-09-21) —
    // NOT merge commits on a default branch, because a squash or rebase merge leaves none, and a
    // window that shrinks on teams who squash means fewer people, the unsafe direction.
    for (const s of Array.isArray(state?.steps) ? state.steps : []) {
      const closed = s && typeof s === 'object' ? s.closed : null;
      if (closed && typeof closed === 'object' && closed.pr != null && dayNumber(closed.date) !== null) merges.push(closed.date);
    }
    // A corrupt ship shard is SKIPPED by `readShardDir` — advisory behaviour that is right for a
    // report and wrong for a count, so it is asked about first (cli/ledger.mjs `corruptShards`).
    const bad = corruptShards(f.buildLogDir);
    if (bad.length) {
      unknown.push(`${epic}: ${bad.length} unreadable ship record(s) in .sdlc/build-log/ (${bad.join(', ')})`);
      continue;
    }
    let ships;
    try {
      ships = readShips(dir);
    } catch (e) {
      unknown.push(`${epic}: ${e.message}`);
      continue;
    }
    for (const s of ships) {
      if (!s || typeof s !== 'object') continue;
      if (s.pr != null && dayNumber(s.shippedAt) !== null) merges.push(s.shippedAt);
      for (const er of Array.isArray(s.engineer_review) ? s.engineer_review : []) {
        if (!er || typeof er !== 'object') continue;
        const name = typeof er.approver === 'string' ? er.approver.trim() : '';
        // An engineer-review entry carries no date of its own; the ship's is the day it counted.
        if (!name || dayNumber(s.shippedAt) === null) continue;
        events.push({ ts: s.shippedAt, name, login: ledgerPersonLogin(er, name, aliases), how: 'approved' });
      }
    }
  }
  return { events, merges, unknown };
}

// One git repository's authors, newest first, as `{ ts, name, login }`. `{ unknown }` instead whenever
// git could not answer fully — that is the whole point of this function.
//
// AUTHOR RECORDS ONLY. No `--name-only`, no file list, nothing read back and matched: E67 paid for that
// lesson eight bugs over four review rounds, and the fix was to stop asking git for file names at all.
//
// `--all`, not HEAD: a clone sitting on a feature branch would otherwise miss everyone who merged to
// the default branch since it diverged — fewer people. `--all` can include an abandoned branch, which
// counts someone who is still a real person. Over, not under.
//
// The date is the COMMITTER date (`%cd` with `--since`, which filters on the same field), so a rebase
// or squash counts a commit from when it LANDED. E67 recorded the same behaviour. It refreshes old
// work into the window, which over-counts — the safe side here.
//
// `since` is an ABSOLUTE `YYYY-MM-DD` date, never `'N days ago'`. A relative one is measured from the
// real clock, and the JS range below is measured from the INJECTED `today` — so the two would disagree
// on every day but one, and a fixture test pinned to a fixed `today` would quietly rot into a failure.
// The whole point of injecting `today` is that this file reads no clock at all.
function gitAuthors(repoRoot, since) {
  const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (since === null) return { unknown: 'the window has no readable start date' };
  if (!fs.existsSync(repoRoot)) return { unknown: `${repoRoot} is not on disk` };
  if (git(['rev-parse', '--is-inside-work-tree']).status !== 0) return { unknown: `${repoRoot} is not a git repo` };
  // A shallow clone holds only the newest commits. E67's rule, and the reason is even stronger here:
  // reading a truncated history as "these are all the people" is exactly the quiet under-count.
  if (/true/.test(git(['rev-parse', '--is-shallow-repository']).stdout || '')) {
    return { unknown: `${repoRoot} is a shallow clone — it does not hold enough history to count people` };
  }
  const r = git(['log', '--all', '--no-merges', `--since=${since}`, '--date=short', '--format=%cd%x1f%an%x1f%ae']);
  if (r.status !== 0) return { unknown: `git could not read the history of ${repoRoot}` };
  const out = [];
  for (const line of (r.stdout || '').split('\n')) {
    if (!line) continue;
    // \x1f, never NUL: E67's separator, for the same reason — a reader that takes C strings would cut
    // the line at the first NUL byte.
    const [ts, name, email] = line.split('\x1f');
    if (isBot(name, email)) continue;   // a robot cannot approve, so it is not capacity
    if (dayNumber(ts) === null) continue;
    out.push({ ts, name: String(name || '').trim(), login: loginFromEmail(email), how: 'committed' });
  }
  return { events: out };
}

// The connected code repos, or `{ unknown }`. A registry that is ABSENT means a Product with no code
// repos — a real, readable answer. A registry that does not PARSE means we cannot know how many repos
// were meant to be counted, which is the unsafe unknown (E65 fixed the same confusion in `targets()`).
function connectedRepos(root) {
  const file = path.join(root, PROJECT_FILES.reposRegistry);
  if (!fs.existsSync(file)) return { repos: [] };
  let reg;
  try {
    reg = readJSONStrict(file, null);
  } catch (e) {
    return { unknown: `${PROJECT_FILES.reposRegistry} does not parse: ${e.message}` };
  }
  if (!reg || !Array.isArray(reg.repos)) return { unknown: `${PROJECT_FILES.reposRegistry} holds no \`repos\` list` };
  const repos = [];
  for (const r of reg.repos) {
    if (!r || typeof r.name !== 'string' || !r.name) return { unknown: `${PROJECT_FILES.reposRegistry} holds a repo with no name` };
    // A repo with no path is registered but not on this machine. It is NOT "zero people": we cannot
    // read it, so the count is unknown rather than smaller.
    if (typeof r.path !== 'string' || !r.path) return { unknown: `repo '${r.name}' has no local path — its history cannot be counted here` };
    repos.push({ name: r.name, root: path.resolve(root, r.path) });
  }
  return { repos };
}

// Every piece of evidence, from every source, with one list of the reasons any of it is missing.
export function peopleEvidence(root, { today = todayString(), aliases = new Map(), sinceDays = CAPACITY_MAX_DAYS * WALK_PAD } = {}) {
  const led = ledgerEvidence(root, aliases);
  const events = [...led.events];
  const unknown = [...led.unknown];
  // One absolute date for every repo, computed from the injected `today` (see `gitAuthors`).
  const since = daysBefore(today, sinceDays);

  // The Product's own git history: authoring an artifact is committing.
  const product = gitAuthors(root, since);
  if (product.unknown) unknown.push(product.unknown);
  else events.push(...product.events);

  const conn = connectedRepos(root);
  if (conn.unknown) unknown.push(conn.unknown);
  else {
    for (const repo of conn.repos) {
      const got = gitAuthors(repo.root, since);
      if (got.unknown) unknown.push(`repo '${repo.name}': ${got.unknown}`);
      else events.push(...got.events);
    }
  }
  return { events, merges: led.merges, unknown };
}

// ---- the windows, as pure functions over that evidence -------------------------------------------

// The capacity window in days: how long the last 20 merged PRs took, bounded to 30–180.
//
// FEWER THAN 20 MERGES MEANS THE WIDE END, not a short window. A young or quiet project has little
// history, and reading "little history" as "few people" is the quiet under-count this file exists to
// prevent. `basis` says which branch was taken so a surface can explain the number.
export function capacityWindow(mergeDates, today) {
  const days = [...mergeDates].map(dayNumber).filter((n) => n !== null).sort((a, b) => b - a);
  const now = dayNumber(today);
  if (now === null) return { days: CAPACITY_MAX_DAYS, basis: 'today is not a readable date' };
  if (days.length < CAPACITY_MERGES) {
    return { days: CAPACITY_MAX_DAYS, basis: `only ${days.length} merged PR(s) recorded — fewer than ${CAPACITY_MERGES}, so the window is the wide end` };
  }
  const span = now - days[CAPACITY_MERGES - 1];
  const bounded = Math.min(CAPACITY_MAX_DAYS, Math.max(CAPACITY_MIN_DAYS, span));
  const bound = bounded !== span ? `, bounded from ${span}` : '';
  return { days: bounded, basis: `the last ${CAPACITY_MERGES} merged PRs span ${span} day(s)${bound}` };
}

// The distinct people with an event in [from, today]. Pure, and it never reads a clock.
export function activeIn(events, from, today) {
  const people = new Map();
  for (const e of events) {
    if (!e || e.ts < from || e.ts > today) continue;
    const key = personKey(e);
    if (!key) continue;
    const seen = people.get(key);
    if (!seen) people.set(key, { key, name: e.name || null, login: e.login || null, how: new Set([e.how]) });
    else {
      if (!seen.login && e.login) seen.login = e.login;
      if (!seen.name && e.name) seen.name = e.name;
      seen.how.add(e.how);
    }
  }
  const list = [...people.values()]
    .map((p) => ({ key: p.key, name: p.name, login: p.login, how: [...p.how].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { count: list.length, people: list, nameOnly: list.filter((p) => !p.login).length };
}

// ---- the answer ----------------------------------------------------------------------------------

// The live active count, in all three windows.
//
// `today` is INJECTED, never read from a clock here: the gate predicate's return is compared byte for
// byte by the golden test, and a number derived from the current date would move the snapshot every
// day. `runUsage` already takes `today` the same way.
//
// Shape: { today, unknown: [], capacity: { days, basis, from, active, people, nameOnly }, expertise: {…},
//          stale: {…} }. When `unknown` is not empty EVERY `active` is null — never a partial number.
// The windows themselves are still reported, because "we could not count, and here is the window we
// would have counted over" is a more useful thing to print than silence.
export function activePeople(root, { today = todayString(), aliases = new Map() } = {}) {
  const { events, merges, unknown } = peopleEvidence(root, { today, aliases });
  if (dayNumber(today) === null) unknown.push(`'${today}' is not a readable date`);
  const cap = capacityWindow(merges, today);
  const window = (days, extra = {}) => {
    const from = daysBefore(today, days);
    // The ONE rule of this file: unknown never becomes a small number.
    if (unknown.length || from === null) return { days, from, active: null, people: [], nameOnly: 0, ...extra };
    const got = activeIn(events, from, today);
    return { days, from, active: got.count, people: got.people, nameOnly: got.nameOnly, ...extra };
  };
  return {
    today,
    unknown,
    capacity: window(cap.days, { basis: cap.basis }),
    expertise: window(EXPERTISE_DAYS),
    stale: window(STALE_DAYS),
  };
}
