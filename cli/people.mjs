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

const dayString = (n) => new Date(n * 86400000).toISOString().slice(0, 10);

// A `YYYY-MM-DD` date as a whole number of days, or null when it is not one.
//
// The round-trip is the real check. `Date.parse` does NOT reject an impossible day: it rolls it
// forward, so `2026-02-30` silently becomes 2 March and a typo in a ledger a human edited would be
// read as a real date a couple of days out. Parsing it back and comparing the text is what rejects it.
export function dayNumber(date) {
  const text = String(date ?? '');
  if (!DATE_RE.test(text)) return null;
  const t = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const n = Math.floor(t / 86400000);
  return dayString(n) === text ? n : null;
}

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
  // `epicIds` drops a directory whose name is not a valid id — and, because `Dirent.isDirectory()` is
  // false for a symlink, a symlinked epic too. That guard is right for an enumerator that turns a name
  // into a path segment; it is wrong for a counter, because the approvals inside go with it. Anything
  // holding a `.sdlc/` that the enumerator did not name is reported.
  try {
    const epicsDir = path.join(root, 'epics');
    if (fs.existsSync(epicsDir)) {
      const named = new Set(ids);
      for (const e of fs.readdirSync(epicsDir)) {
        if (named.has(e) || !fs.existsSync(path.join(epicsDir, e, '.sdlc'))) continue;
        unknown.push(`epics/${e} holds a ledger but is not a readable epic id — its people are not counted`);
      }
    }
  } catch (e) {
    unknown.push(`the epics folder could not be listed: ${e.code || e.message}`);
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
      // A record naming nobody IS nobody — the same rule `gatePredicate` and `mapApprovers` apply.
      if (!name) continue;
      // But a record that names SOMEBODY and carries a date we cannot read is a source we could not
      // read, not one person fewer. These dates are written by LLM-driven skills from a `<YYYY-MM-DD>`
      // template, so a `2026-9-4` is a realistic input. The value is never printed — only the field.
      if (dayNumber(a.date) === null) {
        unknown.push(`${epic}: an approval has no readable \`date\``);
        continue;
      }
      // `status` is not filtered: someone who asked for changes reviewed the artifact and is plainly
      // active. It counts them in, which is the safe direction, and never counts them as an approval —
      // nothing here feeds `have`.
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
    // The FOLDED build-log has the same hazard in a different shape: `readShips` does
    // `Array.isArray(foldedObj?.ships) ? … : []`, so a file that parses but whose `ships` is missing or
    // is not a list reads as "no ships at all" — every engineer-review approver and every merge date in
    // it vanishes, with no throw. That shrinks the count AND widens the window. `corruptShards` cannot
    // see it: it only inspects the shard directory.
    if (fs.existsSync(f.buildLog)) {
      let folded;
      try {
        folded = readJSONStrict(f.buildLog, null);
      } catch (e) {
        unknown.push(`${epic}: ${e.message}`);
        continue;
      }
      if (!folded || typeof folded !== 'object' || Array.isArray(folded) || !Array.isArray(folded.ships)) {
        unknown.push(`${epic}: .sdlc/build-log.json holds no \`ships\` list`);
        continue;
      }
    }
    // A corrupt ship shard is SKIPPED by `readShardDir` — advisory behaviour that is right for a
    // report and wrong for a count, so it is asked about first (cli/ledger.mjs `corruptShards`).
    const shards = corruptShards(f.buildLogDir);
    if (shards.unreadable) {
      unknown.push(`${epic}: ${shards.unreadable}`);
      continue;
    }
    if (shards.bad.length) {
      unknown.push(`${epic}: ${shards.bad.length} unreadable ship record(s) in .sdlc/build-log/ (${shards.bad.join(', ')})`);
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
      // `readShips` de-duplicates on `story|task|repo`, so two ships missing those fields collide on
      // `undefined|undefined|undefined` and one silently replaces the other — taking its engineer
      // reviewers with it. We cannot tell which was lost, so the whole count is unknown.
      if (s.story == null || s.task == null || s.repo == null) {
        unknown.push(`${epic}: a ship record has no story/task/repo, so ships cannot be told apart`);
        continue;
      }
      // A merge date we cannot read only costs a point on the WINDOW, which then stays at the wide end
      // — more days, more people. Safe, so it is skipped rather than reported.
      if (s.pr != null && dayNumber(s.shippedAt) !== null) merges.push(s.shippedAt);
      const reviews = Array.isArray(s.engineer_review) ? s.engineer_review : [];
      // An engineer-review entry carries no date of its own; the ship's is the day it counted. So a ship
      // with reviewers and no readable `shippedAt` loses PEOPLE, which is never skipped quietly.
      if (reviews.length && dayNumber(s.shippedAt) === null) {
        unknown.push(`${epic}: a ship with engineer reviews has no readable \`shippedAt\``);
        continue;
      }
      for (const er of reviews) {
        if (!er || typeof er !== 'object') continue;
        const name = typeof er.approver === 'string' ? er.approver.trim() : '';
        if (!name) continue;
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
// Injecting `today` is what lets a CALLER fix the day — `gate sync` and `gate ci` pass theirs, and the
// golden test would otherwise move daily. It does not mean nothing here reads a clock: `todayString()`
// is the default, and `gate status`, `gate open` and `gate review` take it.
// Does this clone hold that commit? Used to tell a clone that is provably behind the registry from one
// that is merely old.
export function gitHas(repoRoot, sha) {
  const r = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repoRoot, encoding: 'utf8' });
  return r.status === 0;
}

function gitAuthors(repoRoot, since) {
  const git = (args) => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (since === null) return { unknown: 'the window has no readable start date' };
  if (!fs.existsSync(repoRoot)) return { unknown: `${repoRoot} is not on disk` };
  if (git(['rev-parse', '--is-inside-work-tree']).status !== 0) return { unknown: `${repoRoot} is not a git repo` };
  // A shallow clone holds only the newest commits. E67's rule, and the reason is even stronger here:
  // reading a truncated history as "these are all the people" is exactly the quiet under-count.
  // The exit status matters as much as the word: `--is-shallow-repository` did not exist before git
  // 2.15, and there the command FAILS and prints nothing — which would have read as "not shallow".
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  if (shallow.status !== 0) return { unknown: `${repoRoot}: this git cannot say whether the clone is shallow` };
  if (/true/.test(shallow.stdout || '')) {
    return { unknown: `${repoRoot} is a shallow clone — it does not hold enough history to count people` };
  }
  // `%ct`, the committer date as EPOCH SECONDS — never `%cd` with `--date=short`. `%cd` renders the date
  // in the COMMIT'S OWN timezone, while every other date here comes from `toISOString()` and is UTC, so
  // the two clocks disagreed by up to a day. A commit made at 08:00 in Tokyo is 23:00 the previous day
  // in UTC: git printed tomorrow's date, the range below dropped it, and a real person vanished —
  // `active: 0` with an empty `unknown`, the exact outcome this file exists to prevent.
  const r = git(['log', '--all', '--no-merges', `--since=${since}`, '--format=%ct%x1f%an%x1f%ae']);
  if (r.status !== 0) return { unknown: `git could not read the history of ${repoRoot}` };
  const out = [];
  for (const line of (r.stdout || '').split('\n')) {
    if (!line) continue;
    // \x1f, never NUL: E67's separator, for the same reason — a reader that takes C strings would cut
    // the line at the first NUL byte.
    const [ct, name, email] = line.split('\x1f');
    if (isBot(name, email)) continue;   // a robot cannot approve, so it is not capacity
    const secs = Number(ct);
    if (!Number.isFinite(secs)) continue;
    out.push({ ts: dayString(Math.floor(secs / 86400)), name: String(name || '').trim(), login: loginFromEmail(email), how: 'committed' });
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
    repos.push({ name: r.name, root: path.resolve(root, r.path), syncedHead: typeof r.syncedHead === 'string' ? r.syncedHead : null });
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
      // A clone last fetched months ago answers with a small number and no complaint — the one
      // failure this reader cannot see from git alone. The registry records the commit it last packed
      // (`syncedHead`); if this clone does not even hold that, it is provably behind, and behind means
      // fewer people. It is a floor, not a freshness guarantee: a clone that HAS it may still be stale,
      // which stays a stated limit.
      if (repo.syncedHead && !gitHas(repo.root, repo.syncedHead)) {
        unknown.push(`repo '${repo.name}': this clone does not hold the commit the registry last packed — it is behind, and a behind clone shows fewer people`);
        continue;
      }
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
// HERE THE SAFETY DIRECTION IS INVERTED, and it is the one place in this file where it is. Everywhere
// else more evidence means more people. For merges, MORE records push the 20th-newest merge closer to
// today, which makes the span smaller, the window narrower, and the count SMALLER. So a merge date that
// is wrong in the "recent" direction is the dangerous one, and a future date is the sharp edge: it
// makes `span` negative, and clamping a negative number lands on the NARROW end. Twenty bad records
// would have taken the window from 180 days to 30 and printed "-111 day(s)" as the reason.
export function capacityWindow(mergeDates, today) {
  const now = dayNumber(today);
  if (now === null) return { days: CAPACITY_MAX_DAYS, basis: 'today is not a readable date' };
  // A merge cannot have happened after today. One that says so is a wrong clock or a typo, and
  // believing it would narrow the window.
  const days = [...mergeDates].map(dayNumber).filter((n) => n !== null && n <= now).sort((a, b) => b - a);
  if (days.length < CAPACITY_MERGES) {
    return { days: CAPACITY_MAX_DAYS, basis: `only ${days.length} merged PR(s) recorded — fewer than ${CAPACITY_MERGES}, so the window is the wide end` };
  }
  const span = now - days[CAPACITY_MERGES - 1];
  if (span < 0) return { days: CAPACITY_MAX_DAYS, basis: 'the merge dates are not in a readable order — the window is the wide end' };
  const bounded = Math.min(CAPACITY_MAX_DAYS, Math.max(CAPACITY_MIN_DAYS, span));
  const bound = bounded !== span ? `, bounded from ${span}` : '';
  return { days: bounded, basis: `the last ${CAPACITY_MERGES} merged PRs span ${span} day(s)${bound}` };
}

// The distinct people with an event ON OR AFTER `from`. Pure, and it never reads a clock.
//
// THERE IS NO UPPER BOUND, deliberately. A date in the future is not a reason to forget a person: clock
// skew, a rebase, a hand-edited ledger and a machine in another timezone all produce one, and dropping
// it makes the count SMALLER — the one direction this file may never go. Keeping it can only add a
// person who is real, which Part 3 asks for in as many words.
export function activeIn(events, from) {
  const people = new Map();
  for (const e of events) {
    if (!e || !e.ts || e.ts < from) continue;
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
  // NOTHING BELOW MAY THROW OUT OF HERE. `gate sync`, `gate status`, `gate open` and `gate review`
  // call this with no guard of their own, so an unexpected filesystem error would stop a gate that
  // worked yesterday. Every known case is already turned into an `unknown` line; this catches the ones
  // nobody has thought of yet, and turns them into the same answer rather than an exception.
  let events = [];
  let merges = [];
  let unknown = [];
  try {
    ({ events, merges, unknown } = peopleEvidence(root, { today, aliases }));
  } catch (e) {
    unknown = [`the people could not be read: ${e.code || e.message}`];
  }
  if (dayNumber(today) === null) unknown.push(`'${today}' is not a readable date`);
  const cap = capacityWindow(merges, today);
  const window = (days, extra = {}) => {
    const from = daysBefore(today, days);
    // The ONE rule of this file: unknown never becomes a small number.
    if (unknown.length || from === null) return { days, from, active: null, people: [], nameOnly: 0, ...extra };
    const got = activeIn(events, from);
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

// The capacity count as ONE human-readable line, defined here beside the rule for the same reason
// `gateRuleSum` is defined beside `gateRuleFor`: several surfaces print it, and several copies of the
// wording would eventually disagree about what the number means.
//
// It always says what it does NOT do. E71 reports the count; E72 is what turns it into the cap on
// `needed`, so a reader must never take today's number as a requirement that is already being applied.
export function activeSum(counted) {
  const cap = counted?.capacity;
  // `== null` on purpose, so a missing count and an explicitly null one take the SAME branch. With
  // `=== null`, an `undefined` slipped through the counted branch and printed a disclaimer for a number
  // that was not there.
  if (!cap || cap.active == null) {
    const [first, ...rest] = counted?.unknown || [];
    const more = rest.length ? ` (and ${rest.length} more)` : '';
    return `active people: NOT COUNTED — ${first || 'a source could not be read'}${more}`;
  }
  // THE DISCLAIMER TRAVELS WITH THE NUMBER, and that is not a style choice. `activeBasis` is printed
  // through `note()`, which writes to stderr, while this goes to stdout through `log()` — so anything
  // that captures or pipes stdout alone (CI logs, a redirect) would keep the number and lose the
  // sentence saying it enforces nothing. E72 is what makes it a cap.
  return `active people: ${cap.active} in the last ${cap.days} days — reported only, it does not cap the approval count yet`;
}

// Why that window is the length it is. The second line under `activeSum`, and the only part that may be
// lost without misleading anyone — the number above carries its own disclaimer.
export const activeBasis = (counted) => (counted?.capacity?.active == null
  ? 'an unreadable source is never counted as few people — the cap will not be applied from an unknown'
  : String(counted?.capacity?.basis || ''));
