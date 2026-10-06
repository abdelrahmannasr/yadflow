// `yad standup` (E132) — a daily status for each team member: what they did since the last standup, what
// they are working on now, and what is waiting.
//
// READ-ONLY, DERIVED LIVE, FACTS ONLY. Nothing here is stored; every line is rebuilt from git, the Product
// ledgers, the capture branches and the platform each time. No score, no ranking and no judging flag
// (`yad usage`'s rule), and never an email, a commit message, a PR title or a comment body. The one write
// is E131's access cache in git's own folder (`memberStatuses`), never a Product file.
//
// WHO. The team list is E131's member files. Each member is one block, joined through every identity the
// file holds: a commit by its email hash or login, a ledger record by login, a step owner, a claim or a
// capture branch by the git name (`wipName`), a PR by the platform login. Anyone seen who matches no member
// gets a section of their own — nobody is hidden (E71) — and a member whose access has gone (`left`) is
// listed once at the end. A piece of evidence two members both match is never given to one of them: it is
// listed with the people seen, and says so.
//
// WHEN. The window starts at midnight of the previous working day (Monday reads back to Friday; no holiday
// logic) in ONE declared zone — UTC unless `--tz` — and ends now; `--since` moves the start. Commits,
// claims and platform times are exact, compared in epoch milliseconds (never `--date=short`, which reads
// each commit in its own zone — the bug E71 fixed). Every ledger record carries a UTC date and no time, so
// one is in when its date is on or after the UTC date of the start: included, never dropped. The header
// says both.
//
// WAITING (the user's decision, 2026-10-06), each line saying what it waits for:
//   (a) an open gate on a step the member owns — waiting for approvals, or for its review PR to merge;
//   (b) a next move that is theirs — their owned author step is the epic's current step; comments recorded
//       on their open gate;
//   and their own open PRs/MRs whose checks fail or run, or that have no approving review yet.
// E62 requests no reviewers, so nothing here ever says a review is waiting ON someone.
//
// PLATFORM. The Product and EVERY registered repo, by its `git_url` (the user's decision) — one list call
// each (`cli/pr-list.mjs`). A repo that cannot be read prints "platform not read — <why>", and a block with
// no PR facts says so, never "nothing".
import fs from 'node:fs';
import path from 'node:path';
import { c, log, info, warn, fail, hand, note, readJSON, forTerminal } from './lib.mjs';
import { productConfigPath } from './manifest.mjs';
import { STEPS, epicIds, epicRoot, loadLedger, isPassed, stepStatus, authorStepFor, acceptedHashes, gatePredicate, gateRuleFor, gateRuleSum, optionalStepsFor, readFrontmatter, legacyLogins } from './epic-state.mjs';
import { isSolo, requireEngagement } from './gate.mjs';
import { readOwners } from './owners.mjs';
import { readClaims, fetchCaptures } from './claims.mjs';
import { gitIn, wipName, WIP_PREFIX } from './capture.mjs';
import { gitAuthors, personKey } from './people.mjs';
import { isBot } from './riskmap.mjs';
import { readMembers, memberStatuses, memberMatches, productIdentity, ttlDays, accountLabel, accessCheck } from './members.mjs';
import { ledgerEvents, esc, mdText, writeReport } from './usage.mjs';
import { readRegistry, judgeRepo, runnable } from './workspace.mjs';
import { listPrs, prTarget } from './pr-list.mjs';
import { shown } from './protection.mjs';
import { platformLogin } from './platform.mjs';

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SINCE_REL = /^([1-9]\d{0,3})([hd])$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- the clock -----------------------------------------------------------------------------------

// Is `tz` an IANA zone this Node knows? (`Intl` throws a RangeError for one it does not.)
export function validZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// The wall-clock parts of an instant in a zone.
function zoneParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

// How far the zone's wall clock is ahead of UTC at an instant, in milliseconds.
const zoneOffset = (ms, tz) => {
  const p = zoneParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - (ms - (((ms % 1000) + 1000) % 1000));
};

// The instant of midnight starting a calendar day in a zone. Twice, so a day whose offset differs from the
// guess's (a daylight-saving change) still lands on its own midnight.
// A zone whose clock jumps over midnight (America/Santiago, America/Havana on their change days) has no
// 00:00 that day: the answer then lands an hour early, on the day before, so it is moved forward an hour
// at a time to the day's first instant.
export function zoneMidnight(y, m, d, tz) {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffset(guess, tz);
  let t = guess - zoneOffset(first, tz);
  for (let i = 0; i < 3; i++) {
    const p = zoneParts(t, tz);
    if (Date.UTC(p.y, p.m - 1, p.d) >= guess) break;
    t += 3_600_000 - ((p.mi * 60 + p.s) * 1000);
  }
  return t;
}

// `YYYY-MM-DD HH:MM` on the zone's wall clock.
export function zoneStamp(ms, tz) {
  const p = zoneParts(ms, tz);
  const two = (n) => String(n).padStart(2, '0');
  return `${p.y}-${two(p.m)}-${two(p.d)} ${two(p.h)}:${two(p.mi)}`;
}
const weekday = (ms, tz) => { const p = zoneParts(ms, tz); return WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]; };
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The window: `{ startMs, endMs, tz, basis, startUtcDay }`, or `{ error, hint }`.
//   no `since`        midnight of the previous working day in `tz` — Monday, Saturday and Sunday read back to
//                     Friday; any other day to the day before.
//   `YYYY-MM-DD`      midnight of that day in `tz`.
//   `<N>h` / `<N>d`   N hours or days before now.
export function windowFor(nowMs, { tz = 'UTC', since = null } = {}) {
  if (!validZone(tz)) return { error: `not a time zone this system knows: ${forTerminal(String(tz))}`, hint: 'pass an IANA zone name, e.g. --tz Europe/Berlin or --tz America/New_York (UTC is the default)' };
  let startMs;
  let basis;
  if (since == null || since === '') {
    const p = zoneParts(nowMs, tz);
    const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    const back = dow === 1 ? 3 : dow === 0 ? 2 : 1;
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d) - back * DAY_MS);
    startMs = zoneMidnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), tz);
    basis = 'since the previous working day';
  } else if (DATE_RE.test(since)) {
    const [, y, m, d] = since.match(DATE_RE).map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return { error: `--since ${forTerminal(since)} is not a real date`, hint: 'use YYYY-MM-DD, <N>h or <N>d' };
    startMs = zoneMidnight(y, m, d, tz);
    basis = `since ${since}`;
  } else if (SINCE_REL.test(since)) {
    const [, n, unit] = since.match(SINCE_REL);
    startMs = nowMs - Number(n) * (unit === 'h' ? 3_600_000 : DAY_MS);
    basis = `the last ${n} ${unit === 'h' ? 'hour' : 'day'}${n === '1' ? '' : 's'}`;
  } else {
    return { error: `--since ${forTerminal(String(since))} is not a date or a length of time`, hint: 'use YYYY-MM-DD (midnight in --tz), <N>h or <N>d — e.g. --since 24h' };
  }
  if (startMs > nowMs) return { error: `--since ${forTerminal(since)} is in the future`, hint: 'pick a day on or before today' };
  return { startMs, endMs: nowMs, tz, basis, startUtcDay: utcDay(startMs) };
}

// ---- the sources ---------------------------------------------------------------------------------

// Every capture branch (E43) saved inside the window: `{ name, epic, at }` — others' from origin's copies,
// this clone's own from its local branches (the freshest).
function wipSaves(root, env, startMs) {
  const git = gitIn(root, env);
  const me = wipName(git(['config', 'user.name']).out.trim(), git(['config', 'user.email']).out.trim());
  const r = git(['for-each-ref', '--format=%(refname)%00%(committerdate:unix)', `refs/remotes/origin/${WIP_PREFIX}/`, ...(me ? [`refs/heads/${WIP_PREFIX}/${me}/`] : [])]);
  const out = [];
  for (const line of r.ok ? r.out.split('\n').filter(Boolean) : []) {
    const [ref, date] = line.split('\0');
    const remote = ref.startsWith('refs/remotes/');
    const rest = ref.replace(/^refs\/(remotes\/origin|heads)\//, '').slice(WIP_PREFIX.length + 1);
    const slash = rest.indexOf('/');
    const name = rest.slice(0, slash);
    const epic = rest.slice(slash + 1);
    if (slash < 1 || !/^EP-[^/]+$/.test(epic) || (remote && name === me)) continue;
    const at = Number(date) * 1000;
    if (Number.isFinite(at) && at >= startMs) out.push({ name, epic, at });
  }
  return out;
}

// The repos to read: the Product and every registered repo. `dir` is set only when git may run there
// (judged first, E81); `gitUrl` is what the platform is asked about.
function repoSources(root, identity, productConfig, notRead, env) {
  const productUrl = typeof productConfig?.git_url === 'string' && productConfig.git_url ? productConfig.git_url
    : (gitIn(root, env)(['remote', 'get-url', 'origin']).out.trim() || '');
  const out = [{ label: 'Product', dir: root, gitUrl: productUrl, platform: identity.platform }];
  const { registry, problem } = readRegistry(root);
  if (problem) notRead.push(`${problem} — the code repos are not read`);
  for (const r of registry.repos) {
    if (!r || typeof r.name !== 'string' || !r.name) continue;
    const label = forTerminal(r.name);
    let dir = null;
    if (typeof r.path === 'string' && r.path) {
      const j = judgeRepo(root, r);
      if (runnable(j)) dir = path.resolve(root, r.path);
      else notRead.push(`${label}: ${j.state === 'missing' ? 'not cloned on this machine' : j.linked ? "reached through a link inside a repo's tree" : j.reason} — its commits are not read`);
    } else notRead.push(`${label}: no local path — its commits are not read`);
    out.push({ label, dir, gitUrl: typeof r.git_url === 'string' ? r.git_url : '', platform: ['github', 'gitlab'].includes(r.platform) ? r.platform : null });
  }
  return out;
}

// ---- attribution ---------------------------------------------------------------------------------

// The one member a piece of evidence belongs to: `{ member }`, `{ ambiguous: [...] }` when more than one
// matches, or `{}` when none does.
function whose(members, e) {
  const hit = members.filter((m) => memberMatches(m, e));
  if (hit.length === 1) return { member: hit[0] };
  return hit.length ? { ambiguous: hit } : {};
}
// A git name made branch-safe (an owner file, a claim, a capture branch) — compared with the same form of
// each name a member file holds.
function whoseWip(members, w) {
  const hit = members.filter((m) => m.names.some((n) => wipName(n) === w));
  if (hit.length === 1) return { member: hit[0] };
  return hit.length ? { ambiguous: hit } : {};
}

// The member whose account on this platform and host has this login — a PR/MR author. A login on GitHub
// and the same login on GitLab can be two people, so the platform and host must match too; an account two
// files claim (`matchLogins` leaves it out) matches nobody.
function whoseAccount(members, { platform, host, login }) {
  const want = String(login || '').toLowerCase();
  const hit = members.filter((m) => m.accounts.some((a) => a.platform === platform && String(a.host).toLowerCase() === String(host || '').toLowerCase()
    && a.login.toLowerCase() === want && (m.matchLogins || []).includes(want)));
  if (hit.length === 1) return { member: hit[0] };
  return hit.length ? { ambiguous: hit } : {};
}

// ---- the model -----------------------------------------------------------------------------------

// Every value a shared file holds is made safe before it joins a line (`forTerminal`: no control
// character reaches the terminal), and a name is shown only when it is not an email address (`shown`).
// The text is built once and shared by the terminal, Markdown and HTML outputs.
const safe = (v) => forTerminal(String(v ?? ''));
const nameOf = (v) => shown(String(v ?? '').trim() || 'someone');
const isDay = (d) => typeof d === 'string' && DATE_RE.test(d);
// A ledger list's records: only plain objects (a `null` or a number in a shared file is skipped, not a crash).
const records = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : []);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const prWord = (platform) => (platform === 'gitlab' ? 'MR !' : 'PR #');

// The whole report as data. `now` is epoch milliseconds (injected, so a test can pin the day).
export function buildStandup(root, { now = Date.now(), tz = 'UTC', since = null, env = process.env, runner, fetch = true, access = accessCheck } = {}) {
  const win = windowFor(now, { tz, since });
  if (win.error) return win;
  const productConfig = readJSON(productConfigPath(root), null);
  const identity = productIdentity(root, { productConfig, ...(runner ? { runner } : {}) });
  const notRead = [];
  const notes = [];
  const fetched = fetch ? fetchCaptures(root, env) : 'skipped';
  const got = readMembers(root, { identity });
  const ttl = ttlDays(productConfig);
  const today = utcDay(now);
  const inDay = (d) => isDay(d) && d >= win.startUtcDay;
  const inTime = (ms) => Number.isFinite(ms) && ms >= win.startMs && ms <= now;

  // Platform first: whether the Product's platform answered decides whether a member's access may be asked.
  const sources = repoSources(root, identity, productConfig, notRead, env);
  const seenRepo = new Set();
  const prs = [];
  const authCache = new Map();
  for (const s of sources) {
    const target = prTarget({ platform: s.platform, gitUrl: s.gitUrl }, { env, authCache, ...(runner ? { runner } : {}) });
    // One repo, one call: a registered repo that is the Product itself (a monorepo) is not asked twice.
    const key = target.host && target.repo ? `${target.host}/${target.repo}`.toLowerCase() : null;
    if (key && seenRepo.has(key)) continue;
    if (key) seenRepo.add(key);
    const t = target.ok ? listPrs(target, { sinceMs: win.startMs, env, ...(runner ? { runner } : {}) }) : target;
    prs.push({ label: s.label, ...t });
  }
  const prRead = prs.filter((p) => p.ok);
  const prMissing = prs.filter((p) => !p.ok);
  for (const p of prRead) {
    if (p.openPartial) notes.push(`${p.label}: more than ${p.open.length} open ${p.platform === 'gitlab' ? 'MRs' : 'PRs'} — only the newest ${p.open.length} were read`);
    if (p.mergedPartial) notes.push(`${p.label}: more ${p.platform === 'gitlab' ? 'MRs' : 'PRs'} were merged in the window than one page holds — only the newest were read`);
  }

  // Commits: exact times, over the window and the TTL look-back the status needs.
  const readFrom = utcDay(Math.min(win.startMs - DAY_MS, Date.parse(`${today}T00:00:00Z`) - (ttl + 1) * DAY_MS));
  const commits = [];
  // One repository, read once: `git log --all` in a monorepo's registered folder (`path: .`, or `apps/web`)
  // reads the very history the Product's read did, and would count each commit again.
  const seenGit = new Map();
  for (const s of sources) {
    if (!s.dir) continue;
    const common = gitIn(s.dir, env)(['rev-parse', '--git-common-dir']);
    if (common.ok) {
      let real = path.resolve(s.dir, common.out.trim());
      try { real = fs.realpathSync(real); } catch { /* the path as git gave it */ }
      if (seenGit.has(real)) { notes.push(`${s.label}: the same git repository as ${seenGit.get(real)} — its commits are counted once, under ${seenGit.get(real)}`); continue; }
      seenGit.set(real, s.label);
    }
    const g = gitAuthors(s.dir, readFrom);
    if (g.unknown) { notRead.push(`${s.label}: ${g.unknown} — its commits are not read`); continue; }
    for (const e of g.events) commits.push({ ...e, repo: s.label });
  }

  // The ledgers: approvals, comments, ships (attributed as `yad usage` attributes them), and closed steps.
  const aliases = legacyLogins(productConfig);
  let epics = [];
  try { epics = epicIds(root); } catch (e) { notRead.push(`the epic list could not be read: ${e.message}`); }
  const ledgerEv = [];
  const ledgers = new Map();
  for (const epic of epics) {
    try { ledgers.set(epic, loadLedger(epicRoot(root, epic))); } catch (e) { notRead.push(`${epic}: its ledger cannot be read (${e.message})`); continue; }
    try { ledgerEv.push(...ledgerEvents(root, epic, aliases)); } catch (e) { notRead.push(`${epic}: its ledger cannot be read (${e.message})`); }
  }

  // Status (E131): active / idle / left / unknown, from commits, approvals and ships. When the Product's own
  // platform was not read, nobody's access is asked — a bad network never makes anyone `left`.
  // Only a real calendar date is activity: a date in a shared file is checked before the status reads it.
  const activity = [...commits.map((e) => ({ ts: e.ts, login: e.login, emailHash: e.emailHash, name: e.name })),
    ...ledgerEv.filter((e) => (e.action === 'approved' || e.action === 'shipped') && isDay(e.ts) && typeof e.actor === 'string')
      .map((e) => ({ ts: e.ts, login: e.login || e.actor, name: e.actor }))];
  const offline = !prs[0]?.ok;
  const members = memberStatuses(root, got.members, { events: activity, today, ttl, identity, access, offline });

  const blocks = new Map(members.map((m) => [m, { done: [], working: [], waiting: [] }]));
  const unlisted = new Map();
  const place = (owner, display, key, section, item) => {
    if (owner.member) { blocks.get(owner.member)[section].push(item); return; }
    const k = owner.ambiguous ? `ambiguous:${key}` : key;
    if (!unlisted.has(k)) unlisted.set(k, { who: nameOf(display), ambiguous: owner.ambiguous ? owner.ambiguous.map((m) => m.primary.login) : null, done: [], working: [], waiting: [] });
    unlisted.get(k)[section].push(item);
  };
  const byEvent = (e, display, section, item) => place(whose(members, e), display, personKey({ login: e.login, name: e.name }) || `name:${display}`, section, item);
  const byWip = (w, display, section, item) => place(whoseWip(members, w), display, `wip:${w}`, section, item);
  const byAccount = (acct, section, item) => place(whoseAccount(members, acct), acct.login, `login:${String(acct.login).toLowerCase()}`, section, item);

  // DONE — commits, one line per person and repo.
  const commitGroups = new Map();
  for (const e of commits) {
    if (!inTime(e.at * 1000)) continue;
    const owner = whose(members, e);
    const who = owner.member ? `m:${owner.member.rel}` : `${owner.ambiguous ? 'amb:' : ''}${personKey({ login: e.login, name: e.name })}`;
    const k = `${who}\0${e.repo}`;
    if (!commitGroups.has(k)) commitGroups.set(k, { e, count: 0, last: 0 });
    const g = commitGroups.get(k);
    g.count++;
    g.last = Math.max(g.last, e.at * 1000);
  }
  for (const { e, count, last } of commitGroups.values()) {
    byEvent(e, e.login || e.name || 'someone', 'done', { kind: 'commits', repo: e.repo, count, last: new Date(last).toISOString(), text: `${plural(count, 'commit')} in ${safe(e.repo)} (last ${zoneStamp(last, tz)})` });
  }
  // DONE — approvals, comments, ships (the ledger's date only).
  // A ledger names people by platform login: a `[bot]` login is a robot, not a person seen.
  for (const e of ledgerEv) {
    if (!inDay(e.ts) || typeof e.actor !== 'string' || isBot(e.actor)) continue;
    const what = e.artifact ? `${e.epic} ${safe(e.artifact)}` : e.epic;
    const item = e.action === 'approved' ? { kind: 'approved', epic: e.epic, artifact: e.artifact || null, date: e.ts, text: `approved ${what} (${e.ts})` }
      : e.action === 'commented' ? { kind: 'commented', epic: e.epic, artifact: e.artifact || null, date: e.ts, text: `commented on ${what} (${e.ts})` }
        : { kind: 'shipped', epic: e.epic, story: e.story || null, task: e.task || null, repo: e.repo || null, date: e.ts, text: `engineer review of ${[e.story, e.task].filter(Boolean).map(safe).join('/') || e.epic}${e.repo ? ` in ${safe(e.repo)}` : ''}, shipped ${e.ts}` };
    // A report, not the count: the name a ledger records is the platform login since E62, so it is matched
    // against members' logins too. The gate count never reads this (E64: only a stamped record proves it).
    byEvent({ login: e.login || e.actor, name: e.actor }, e.actor, 'done', item);
  }
  // DONE — steps closed. A merge is the merger's when the platform named one; anything else is `by`'s.
  for (const [epic, led] of ledgers) {
    for (const s of led.state?.steps || []) {
      const cl = s?.closed;
      if (!cl || typeof cl !== 'object' || !inDay(cl.date)) continue;
      const who = cl.via === 'merge' && typeof cl.mergedBy === 'string' && cl.mergedBy.trim() ? cl.mergedBy : cl.by;
      // On CI the closing record's `by` is the job's git name — `yad-gate-sync` in the shipped workflow, or a
      // `[bot]` name. A closing record carries no email, so the exact name is the evidence here (`isGateBot`
      // needs the address too, which a commit has and this record does not).
      if (typeof who !== 'string' || !who.trim() || isBot(who) || who.trim() === 'yad-gate-sync') continue;
      byEvent({ login: who, name: who }, who, 'done', { kind: 'closed', epic, step: s.id, via: cl.via || null, date: cl.date, text: `closed ${epic} ${safe(s.id)}${cl.via ? ` (${safe(cl.via)})` : ''}, ${cl.date}` });
    }
  }
  // DONE — merged PRs/MRs, by their author.
  for (const p of prRead) {
    for (const pr of p.merged) {
      if (!pr.author || !Number.isSafeInteger(pr.number)) continue;
      byAccount({ platform: p.platform, host: p.host, login: pr.author }, 'done', { kind: 'merged', repo: p.label, number: pr.number, at: pr.mergedAt, text: `${prWord(p.platform)}${pr.number} merged in ${p.label} (${zoneStamp(Date.parse(pr.mergedAt), tz)})` });
    }
  }

  // WORKING ON — owned open steps (E47), open claims (E46), capture branches saved in the window (E43).
  for (const epic of epics) {
    for (const o of readOwners(root, epic)) {
      if (o.error || !o.live) continue;
      byWip(o.owner, o.name || o.owner, 'working', { kind: 'owns', epic, step: o.step, state: o.stepState || null, text: `owns ${epic} ${safe(o.step)}${o.stepState ? ` (${safe(o.stepState)})` : ''}` });
    }
  }
  const claimed = new Set();
  const claimGroups = new Map();
  for (const cl of readClaims(root, { env, now }).claims) {
    const k = `${cl.name}\0${cl.epic}`;
    if (!claimGroups.has(k)) claimGroups.set(k, { cl, files: [], last: 0 });
    const g = claimGroups.get(k);
    g.files.push(cl.path);
    g.last = Math.max(g.last, Date.parse(cl.lastSavedAt));
    claimed.add(k);
  }
  for (const { cl, files, last } of claimGroups.values()) {
    byWip(cl.name, cl.person || cl.name, 'working', { kind: 'editing', epic: cl.epic, files, last: new Date(last).toISOString(), text: `editing ${files.map(safe).join(', ')} (last saved ${zoneStamp(last, tz)})` });
  }
  for (const w of wipSaves(root, env, win.startMs)) {
    if (claimed.has(`${w.name}\0${w.epic}`)) continue;
    byWip(w.name, w.name, 'working', { kind: 'drafts', epic: w.epic, last: new Date(w.at).toISOString(), text: `saved drafts on ${safe(w.epic)} (${zoneStamp(w.at, tz)}; nothing unmerged is open now)` });
  }

  // WAITING — gates, by the owner of the step they review: the live E47 owner, else the epic's `owner`.
  // Each epic on its own: a shared file that is not what yad writes stops that epic's lines, said in
  // "not read", never the whole report.
  const solo = isSolo(productConfig);
  const engagement = requireEngagement(productConfig);
  const ownerless = [];
  const mergeWord = identity.platform ? `its review ${identity.platform === 'gitlab' ? 'MR' : 'PR'} to merge` : '`yad gate advance` (no platform: the gate moves on when it is advanced)';
  for (const [epic, led] of ledgers) {
    try {
      const state = led.state;
      if (!state?.steps) continue;
      const owners = new Map(readOwners(root, epic).filter((o) => !o.error && o.live).map((o) => [o.step, o]));
      const front = readFrontmatter(path.join(epicRoot(root, epic), 'epic.md')).owner || readFrontmatter(path.join(epicRoot(root, epic), 'roadmap.md')).owner;
      const epicOwner = typeof front === 'string' && front.trim() ? front.trim() : null;
      const ownerOf = (stepId) => {
        const o = owners.get(stepId);
        if (o) return { at: whoseWip(members, o.owner), display: o.name || o.owner, key: `wip:${o.owner}` };
        if (epicOwner) return { at: whose(members, { login: epicOwner, name: epicOwner }), display: epicOwner, key: personKey({ login: epicOwner }) };
        return null;
      };
      const put = (stepId, item) => {
        const o = ownerOf(stepId);
        if (!o) { ownerless.push(item); return; }
        place(o.at, o.display, o.key, 'waiting', item);
      };
      const approvals = records(led.approvals);
      const comments = records(led.comments);
      const reviewPrs = records(led.productPrs);
      // (b) the current step is an author step someone owns, and it is not done.
      const cur = state.steps.find((s) => s?.id === state.currentStep);
      const curDef = STEPS.find((d) => d.id === cur?.id);
      if (cur && !isPassed(cur) && curDef && curDef.kind !== 'review' && cur.type !== 'review+approve' && ownerOf(cur.id)) {
        put(cur.id, { kind: 'next-move', epic, step: cur.id, state: stepStatus(cur), text: `${epic} ${safe(cur.id)} is the current step and theirs to author (${stepStatus(cur) || 'unknown state'})` });
      }
      // (a) an open gate: its author step passed, the review not yet. Read through the gate's own predicate,
      // so this line never says more than `yad gate status` would (engagement, revoked approvals, solo).
      for (const s of state.steps.filter((x) => x?.type === 'review+approve' && !isPassed(x))) {
        const a = authorStepFor(state, s);
        if (!a || !isPassed(a)) continue;
        const verdict = gatePredicate({ step: s, approvals, acceptedHashes: acceptedHashes(epicRoot(root, epic), s.artifact), solo, requireEngagement: engagement, optional: optionalStepsFor(state) });
        const rule = gateRuleFor(s);
        const pr = reviewPrs.find((p) => (typeof p.step === 'string' && p.step === s.id) || (typeof p.artifact === 'string' && p.artifact === s.artifact));
        const prNo = pr && Number.isSafeInteger(pr.number) ? pr.number : null;
        const via = prNo != null ? `${prWord(identity.platform)}${prNo}` : null;
        const asks = rule.riskStep ? `; the count asks ${gateRuleSum(rule)} (risk step advisory)` : '';
        const waitsFor = solo
          ? `waits for ${via ? `review ${via} to merge` : mergeWord} (solo mode: approvals waived)`
          : verdict.approvalsSatisfied
            ? `has the ${plural(verdict.have ?? 0, 'approval')} it needs to pass; waits for ${via ? `review ${via} to merge` : mergeWord}${asks}`
            : `waits for approval — missing: ${verdict.missing.map(safe).join('; ')}${asks}${via ? `; review ${via}` : ''}`;
        put(a.id, { kind: 'gate', epic, step: s.id, approvals: verdict.have ?? null, needed: rule.base, asks: rule.needed, missing: verdict.missing, pr: prNo, text: `${epic} ${safe(s.id)} ${waitsFor}` });
        const rounds = comments.filter((x) => x.step === s.id && Number.isSafeInteger(x.round) && x.round >= 0);
        if (rounds.length) {
          const round = Math.max(...rounds.map((x) => x.round));
          const count = rounds.filter((x) => x.round === round).reduce((n, x) => n + (Number.isSafeInteger(x.count) && x.count >= 0 && x.count <= 100_000 ? x.count : 1), 0);
          put(a.id, { kind: 'comments', epic, step: s.id, round, count, text: `${epic} ${safe(s.id)}: ${plural(count, 'comment')} recorded in review round ${round} (yad does not know which are answered)` });
        }
      }
    } catch (e) {
      notRead.push(`${epic}: its gates could not be read (${safe(e.message)}) — nothing is said about what waits there`);
    }
  }
  // WAITING / WORKING — their own open PRs/MRs.
  for (const p of prRead) {
    for (const pr of p.open) {
      if (!pr.author || !Number.isSafeInteger(pr.number)) continue;
      const facts = [pr.draft ? 'draft' : null,
        pr.checks === 'failing' ? 'checks failing' : pr.checks === 'running' ? 'checks running' : pr.checks === 'passing' ? 'checks passing' : null,
        pr.review === 'none' ? 'no review yet' : pr.review === 'changes-requested' ? 'changes requested' : pr.review === 'reviewed' ? 'reviewed, not approved' : pr.review === 'approved' ? 'approved' : null,
        pr.status ? `merge status ${forTerminal(pr.status)}` : null].filter(Boolean);
      const waits = !pr.draft && (pr.waits || pr.checks === 'failing' || pr.checks === 'running' || ['none', 'changes-requested', 'reviewed'].includes(pr.review));
      byAccount({ platform: p.platform, host: p.host, login: pr.author }, waits ? 'waiting' : 'working', { kind: 'open-pr', repo: p.label, number: pr.number, draft: pr.draft, checks: pr.checks, review: pr.review, text: `${prWord(p.platform)}${pr.number} open in ${p.label}${facts.length ? ` — ${facts.join(', ')}` : ''}` });
    }
  }

  const prNote = prMissing.length ? `platform not read for ${prMissing.map((p) => p.label).join(', ')} — PR/MR facts there are unknown, not none` : null;
  const shape = (m) => ({
    login: m.primary.login, logins: m.accounts.map((a) => a.login), account: accountLabel(m.primary), accounts: m.accounts.map(accountLabel), status: m.status, lastActive: isDay(m.lastActive) ? m.lastActive : null, ...blocks.get(m),
  });
  const team = members.filter((m) => m.status !== 'left').map(shape);
  const left = members.filter((m) => m.status === 'left').map(shape);
  return {
    window: { start: new Date(win.startMs).toISOString(), end: new Date(now).toISOString(), tz, basis: win.basis, ledgerFrom: win.startUtcDay },
    fetched,
    ttlDays: ttl,
    team,
    left,
    unlisted: [...unlisted.values()],
    ownerless,
    platform: prs.map((p) => ({ repo: p.label, read: !!p.ok, ...(p.ok ? {} : { why: p.why }) })),
    prNote,
    notRead,
    notes,
    memberErrors: got.errors.map((e) => e.error),
    duplicates: got.duplicates,
  };
}

// Narrow the report to one member: by any of their logins (any account), case-insensitive.
export function onlyMember(model, login) {
  const want = String(login).toLowerCase();
  const pick = (list) => list.filter((m) => m.logins.some((l) => l.toLowerCase() === want));
  return { ...model, team: pick(model.team), left: pick(model.left), unlisted: [], ownerless: [], member: login };
}

// ---- rendering -----------------------------------------------------------------------------------

const SECTIONS = [['done', 'Done'], ['working', 'Working on'], ['waiting', 'Waiting']];
const FOOTER = 'Derived, read-only — rebuilt from git, the Product ledgers, the capture branches and the platform each time it runs. Facts only: no score, no ranking, and no emails, commit messages, PR titles or comment bodies.';

export function headerLines(model) {
  const w = model.window;
  const start = Date.parse(w.start);
  const end = Date.parse(w.end);
  return [
    `window: ${weekday(start, w.tz)} ${zoneStamp(start, w.tz)} → ${weekday(end, w.tz)} ${zoneStamp(end, w.tz)} (${w.tz}) — ${w.basis}`,
    `ledger records carry a UTC date and no time: one dated ${w.ledgerFrom} or later is in`,
  ];
}

// "nothing" only when every source answered; otherwise the empty section says what may be missing.
const emptyLine = (model) => {
  const gaps = [model.prNote ? 'the platform was not read for every repo' : null, model.notRead.length ? 'some git history or ledgers were not read' : null,
    model.fetched === 'failed' ? 'the capture branches could not be fetched' : null].filter(Boolean);
  return gaps.length ? `nothing recorded here — but ${gaps.join(', and ')}, so something may be missing (see the end)` : 'nothing';
};

function blockText(model, b, title) {
  log(`\n  ${c.bold(title)}`);
  for (const [k, label] of SECTIONS) {
    log(`    ${c.dim(label)}`);
    if (!b[k].length) log(`      ${c.dim(emptyLine(model))}`);
    for (const it of b[k]) log(`      • ${it.text}`);
  }
}

const memberTitle = (m) => `${forTerminal(m.login)} ${c.dim(`— ${m.status}${m.lastActive ? `, last active ${m.lastActive}` : ''}${m.accounts.length > 1 ? ` · ${m.accounts.join(', ')}` : ''}`)}`;
const unlistedTitle = (u) => `${forTerminal(u.who)}${u.ambiguous ? c.dim(` — matches more than one member (${u.ambiguous.join(', ')}); not given to either`) : ''}`;

export function renderText(model) {
  log(c.bold('\nyad standup'));
  for (const l of headerLines(model)) info(l);
  if (model.fetched === 'failed') warn('could not fetch the capture branches — claims and drafts are as last fetched');
  if (model.fetched === 'local') info('no remote named origin — only your own capture branches are read');
  if (!model.team.length && !model.left.length) {
    info(model.member ? `no member ${forTerminal(model.member)} on the team list`
      : model.memberErrors.length ? 'no member file could be read — the reasons are listed at the end'
        : 'no team list yet — each person runs `yad member add` (or `yad join` does it)');
  }
  for (const m of model.team) blockText(model, m, memberTitle(m));
  if (model.unlisted.length) {
    log(`\n  ${c.bold('Seen, not on the team list')} ${c.dim('— people in the record who match no member file')}`);
    for (const u of model.unlisted) blockText(model, u, unlistedTitle(u));
  }
  if (model.ownerless.length) {
    log(`\n  ${c.bold('Open gates nobody owns')} ${c.dim('— no step owner (yad assign) and no epic owner')}`);
    for (const it of model.ownerless) log(`      • ${it.text}`);
  }
  if (model.left.length) {
    log(`\n  ${c.bold('Left')} ${c.dim('— no longer has access to the Product')}`);
    for (const m of model.left) log(`      • ${forTerminal(m.login)}${m.lastActive ? c.dim(` (last active ${m.lastActive})`) : ''}`);
  }
  log('');
  for (const p of model.platform) if (!p.read) warn(`${p.repo}: platform not read — ${p.why}`);
  for (const n of model.notRead) warn(n);
  for (const n of model.notes) info(n);
  for (const e of model.memberErrors) warn(e);
  for (const d of model.duplicates) warn(`${d} — one account or email belongs to one member; neither file joins it until one is fixed`);
  note(c.dim(FOOTER));
}

export function renderMarkdown(model) {
  const L = ['# Standup', '', ...headerLines(model).map((l) => `- ${mdText(l)}`), ''];
  const block = (b, title) => {
    L.push(`## ${mdText(title)}`, '');
    for (const [k, label] of SECTIONS) {
      L.push(`**${label}**`, '');
      if (!b[k].length) L.push(`- _${emptyLine(model)}_`);
      for (const it of b[k]) L.push(`- ${mdText(it.text)}`);
      L.push('');
    }
  };
  for (const m of model.team) block(m, `${m.login} — ${m.status}${m.lastActive ? `, last active ${m.lastActive}` : ''}`);
  if (model.unlisted.length) {
    L.push('# Seen, not on the team list', '');
    for (const u of model.unlisted) block(u, `${u.who}${u.ambiguous ? ` (matches ${u.ambiguous.join(', ')})` : ''}`);
  }
  if (model.ownerless.length) { L.push('# Open gates nobody owns', ''); for (const it of model.ownerless) L.push(`- ${mdText(it.text)}`); L.push(''); }
  if (model.left.length) { L.push('# Left', ''); for (const m of model.left) L.push(`- ${mdText(m.login)}${m.lastActive ? ` (last active ${m.lastActive})` : ''}`); L.push(''); }
  const missing = [...model.platform.filter((p) => !p.read).map((p) => `${p.repo}: platform not read — ${p.why}`), ...model.notRead, ...model.notes];
  if (missing.length) { L.push('# Not read', ''); for (const n of missing) L.push(`- ${mdText(n)}`); L.push(''); }
  L.push(`_${FOOTER}_`, '');
  return L.join('\n');
}

export function renderHtml(model) {
  const list = (items, empty) => (items.length ? `<ul>${items.map((it) => `<li>${esc(it.text)}</li>`).join('')}</ul>` : `<p class="none">${esc(empty)}</p>`);
  const block = (b, title, sub = '') => `<section class="member"><h2>${esc(title)}${sub ? ` <span>${esc(sub)}</span>` : ''}</h2>${SECTIONS.map(([k, label]) => `<h3>${label}</h3>${list(b[k], emptyLine(model))}`).join('')}</section>`;
  const missing = [...model.platform.filter((p) => !p.read).map((p) => `${p.repo}: platform not read — ${p.why}`), ...model.notRead, ...model.notes];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>yadflow — standup</title><style>
:root{--bg:#fff;--fg:#1d2026;--dim:#5d6470;--card:#f6f7f9;--line:#e1e4ea}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e6e8ee;--dim:#9aa0ad;--card:#181b22;--line:#262a33}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:28px 16px}h1{font-size:22px;margin:0 0 6px}.sub{color:var(--dim);margin:0 0 20px;padding-left:18px}
.member{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 12px}
h2{font-size:15px;margin:0 0 4px}h2 span{color:var(--dim);font-weight:400;font-size:13px}h3{font-size:12px;color:var(--dim);margin:10px 0 2px;text-transform:uppercase;letter-spacing:.04em}
ul{margin:0;padding-left:18px}.none{color:var(--dim);margin:0}.group{font-size:17px;margin:24px 0 10px}
footer{color:var(--dim);font-size:12px;margin-top:24px;border-top:1px solid var(--line);padding-top:12px}
</style></head><body><div class="wrap">
<h1>Standup</h1><ul class="sub">${headerLines(model).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
${model.team.length ? model.team.map((m) => block(m, m.login, `${m.status}${m.lastActive ? `, last active ${m.lastActive}` : ''}`)).join('') : '<p class="none">No team list yet.</p>'}
${model.unlisted.length ? `<h2 class="group">Seen, not on the team list</h2>${model.unlisted.map((u) => block(u, u.who, u.ambiguous ? `matches ${u.ambiguous.join(', ')}` : '')).join('')}` : ''}
${model.ownerless.length ? `<h2 class="group">Open gates nobody owns</h2>${list(model.ownerless, '')}` : ''}
${model.left.length ? `<h2 class="group">Left</h2><ul>${model.left.map((m) => `<li>${esc(m.login)}${m.lastActive ? ` (last active ${esc(m.lastActive)})` : ''}</li>`).join('')}</ul>` : ''}
${missing.length ? `<h2 class="group">Not read</h2><ul>${missing.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
<footer>${esc(FOOTER)}</footer>
</div></body></html>\n`;
}

// ---- the command ---------------------------------------------------------------------------------

const STANDUP_FLAGS = new Set(['--since', '--tz', '--member', '--me', '--format', '--out', '--json', '--dir']);

// The flags a person typed that standup does not take (a `--sinse` typo must not be silent).
export function foreignFlags(argv) {
  return argv.filter((a) => a.startsWith('-') && !STANDUP_FLAGS.has(a.split('=')[0]));
}

// `yad standup`. Returns the model (E1 makes it the `--json` answer), or undefined after refusing.
export async function runStandup(root, { now = Date.now(), tz = 'UTC', since = null, member = null, me = false, format = null, out = null, json = false, env = process.env, runner, fetch = true, access } = {}) {
  const refuse = (msg, hint) => { fail(msg); if (hint) hand(hint); process.exitCode = 1; };
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/product.json here)', 'run it from the Product, or pass --dir');
  if (!format && out) format = /\.html?$/i.test(out) ? 'html' : 'md';
  if (format && !['md', 'html'].includes(format)) return refuse(`unknown --format ${forTerminal(String(format))}`, 'use --format md or --format html (or --json for the data)');
  if (member && me) return refuse('pass --member <login> or --me, not both');
  const win = windowFor(now, { tz, since });
  if (win.error) return refuse(win.error, win.hint);
  let who = member;
  if (me) {
    const productConfig = readJSON(productConfigPath(root), null);
    const id = productIdentity(root, { productConfig, ...(runner ? { runner } : {}) });
    who = id.platform ? platformLogin(root, id.platform, { env, host: id.host, ...(runner ? { runner } : {}) }) : null;
    if (!who) {
      const name = gitIn(root, env)(['config', 'user.name']).out.trim();
      const found = name ? readMembers(root, { identity: id }).members.filter((m) => m.names.some((n) => n.toLowerCase() === name.toLowerCase())) : [];
      if (found.length === 1) who = found[0].primary.login;
    }
    if (!who) return refuse('yad cannot tell who you are here — not logged in to the Product\'s platform, and your git name is on no single member file', 'pass --member <login>, or log in (gh auth login / glab auth login)');
  }
  let model = buildStandup(root, { now, tz, since, env, runner, fetch, ...(access ? { access } : {}) });
  if (model.error) return refuse(model.error, model.hint);
  if (who) model = onlyMember(model, who);
  if (format) {
    const dest = out || `standup-report.${format}`;
    writeReport(dest, format === 'md' ? renderMarkdown(model) : renderHtml(model));
    if (json) note(`wrote ${format.toUpperCase()} report → ${dest}`);
    else info(`wrote ${format.toUpperCase()} report → ${c.bold(dest)}`);
    return { ...model, out: dest };
  }
  if (!json) renderText(model);
  return { ...model, out: null };
}
