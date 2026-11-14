// `yad map` — the progress map's data (E181).
//
// One picture of how close the work is to Production: epics → stories → tasks → branches, flowing through
// each code repo's integration branch ("Development") into its Production branch. Read from the Product
// ledger in this checkout and from READ-ONLY git in each registered code repo; the only git command that
// changes anything is `git fetch origin`, and only with --fetch (it downloads, never uploads).
//
// Two halves, so the rules are tested without git:
//   gatherMap(root, …)          reads the ledger, the code repos and the members → raw facts
//   mapModel(inputs, …)         PURE: states, roll-ups, people and their roles, waiting, what moved, notes
//
// PEOPLE (the user's decisions, 2026-11-14): roles, never counts — owner, builder, reviewer, approver. One
// person, one badge: a name is matched to a member file (E131) the way `yad standup` matches it; a name that
// matches no member keeps its own badge, and one that matches more than one member says so. No emails
// (`shown`), no commit subjects, no machine paths. `--anonymous` names each person "Person A…" in a stable
// order, masks the capture-branch name and any branch part that is a person's name, and drops PR links.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readJSON } from './lib.mjs';
import { productConfigPath } from './manifest.mjs';
import { epicIds, epicRoot, loadLedger, readFrontmatter, FOUNDATION_EPIC } from './epic-state.mjs';
import { readShips } from './ledger.mjs';
import { readRegistry } from './workspace.mjs';
import { readOwners } from './owners.mjs';
import { readMembers, productIdentity } from './members.mjs';
import { gateWaits, whose } from './standup.mjs';
import { shown } from './protection.mjs';
import { readFilesAt, listTreeAt } from './git-read.mjs';

export const STATES = Object.freeze(['live', 'merged', 'active', 'planned', 'idle']);
export const PRODUCTION_GUESSES = Object.freeze(['Production', 'production', 'prod', 'release', 'main', 'master']);
export const DEFAULT_STALE_DAYS = 60;
export const DEFAULT_GROUPS = Object.freeze([{ id: 'other', label: 'Other branches' }]);
const HUES = 8;

// ---- small helpers -------------------------------------------------------------------------------

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
const pretty = (id) => id.replace(/^EP-/, '').replace(/-/g, ' ').replace(/\b\w/, (ch) => ch.toUpperCase());
const tally = (arr, key) => arr.reduce((a, x) => { const k = typeof key === 'function' ? key(x) : x[key]; a[k] = (a[k] || 0) + 1; return a; }, {});
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };
export const compiles = (pattern) => { try { new RegExp(pattern, 'i'); return true; } catch { return false; } };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function frontmatterText(md) {
  const out = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md || '');
  if (!m) return out;
  for (const l of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(l);
    if (!k) continue;
    let v = k[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
    else v = v.replace(/^"(.*)"$/, '$1');
    out[k[1]] = v;
  }
  return out;
}
export function storyTitle(md) {
  const body = String(md || '').replace(/^---[\s\S]*?\n---/, '');
  const at = body.search(/^##\s+Story\b/m);
  const rest = (at >= 0 ? body.slice(at) : body).split(/\r?\n/).filter((l) => l.trim() && !/^#/.test(l.trim()));
  return clip(rest[0] || '', 220);
}
const heading = (md) => { const m = /^#\s+(.+)$/m.exec(String(md || '').replace(/^---[\s\S]*?\n---/, '')); return m ? m[1].trim() : null; };
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);

// ---- people --------------------------------------------------------------------------------------

// Two letters for a badge: the first letters of the first two words, else the first two letters.
export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s._-]/gu, ' ').split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  const two = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return two.toUpperCase();
}
// A stable colour slot for a person: the same key always gets the same hue.
export function hueOf(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % HUES;
}
// A short fingerprint for a key (never shown, never reversible to the text it came from in practice).
const hueKey = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
// "Person A", "Person B", … "Person Z", "Person AA" …
export function personLetter(n) {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return `Person ${s}`;
}

// The resolver: a raw name from the record → one person key. Members first (E131); else the name itself,
// compared without case. A name with an @ is never shown.
export function makeResolver(members = []) {
  const people = new Map();   // key -> { key, name, raws:Set, member: bool, ambiguous: [logins] | null }
  const cache = new Map();
  const resolve = (raw) => {
    const r = String(raw ?? '').trim();
    if (!r) return null;
    if (cache.has(r.toLowerCase())) return cache.get(r.toLowerCase());
    const hit = whose(members, { login: r, name: r });
    let key, name, ambiguous = null;
    if (hit.member) {
      const login = hit.member.primary.login.toLowerCase();
      key = login.includes('@') ? `m:@${hueKey(login)}` : `m:${login}`;
      name = hit.member.names.find((n) => !n.includes('@')) || hit.member.primary.login;
    } else {
      // A raw value with an @ is an email: its key is a fingerprint, so the address never rides in the data.
      key = r.includes('@') ? `n:@${hueKey(r.toLowerCase())}` : `n:${r.toLowerCase()}`;
      name = r;
      if (hit.ambiguous) ambiguous = hit.ambiguous.map((m) => (m.primary.login.includes('@') ? 'a login with an @ in it' : m.primary.login));
    }
    // Any @ (even a leading one, which `shown` lets through) means an address: it is never shown.
    if (!people.has(key)) people.set(key, { key, name: String(name).includes('@') ? 'a name with an @ in it' : shown(name), raws: new Set(), member: !!hit.member, ambiguous });
    people.get(key).raws.add(r);
    cache.set(r.toLowerCase(), key);
    return key;
  };
  return { resolve, people };
}

// ---- the pure model ------------------------------------------------------------------------------

// inputs (from gatherMap, or a test):
//   product { name, branch, sha, behind, fetchedAt }   staleDays   groups [{id,label,pattern?}]   members [...]
//   epics [{ id, title, type, currentStep, createdAt, owner, parent, repos, steps:[{id,status}], onMain,
//            sourceBranch?, stepOwners:{step:name}, approvals:[{step, approver}] }]
//   stories [{ id, epic, title, status, owner, repos, build:{repo:{currentStep, steps:[{id,status}]}} }]
//   tasks [{ story, epic, task, repo, branch, pr, mergeCommit, shippedAt, reviewers:[], builder?,
//            reach: { found, prod, integ, via? } | null }]
//   repos [{ name, available, integrationBranch, productionBranch, productionGuessed, waitingCommits,
//            productionAhead, production:{date,author}|null, integration:{date,author}|null, fetchedAt }]
//   branches [{ repo, name, sha, date, author, inProd, inInteg, ahead }]
//   waits [{ epic, step, kind, owner (raw name) | null }]
// A branch name can hold an address (git allows `@`): each part of it that does is shown as `an-address`, in
// every map, named or not — before anything else reads the name, so ids and matches agree.
// Each masked part keeps a short fingerprint, so two address branches never share a name or an id.
export const noAddress = (name) => (typeof name === 'string' && name.includes('@') ? name.split('/').map((seg) => (seg.includes('@') ? `an-address-${hueKey(seg).slice(0, 6)}` : seg)).join('/') : name);
function withoutAddresses(inputs) {
  const via = (r) => (r && r.via ? { ...r, via: { ...r.via, branch: noAddress(r.via.branch) } } : r);
  return { ...inputs,
    // The raw name is kept beside it only to find the epic, story and group; it never reaches the model.
    branches: (inputs.branches || []).map((b) => ({ ...b, rawName: b.name, name: noAddress(b.name) })),
    // A link holding an address (in its user part, say) is dropped, never shown.
    tasks: (inputs.tasks || []).map((t) => ({ ...t, branch: noAddress(t.branch), reach: via(t.reach), pr: typeof t.pr === 'string' && t.pr.includes('@') ? null : t.pr })),
    product: inputs.product ? { ...inputs.product, branch: noAddress(inputs.product.branch) } : inputs.product,
    epics: (inputs.epics || []).map((e) => ({ ...e, ...(e.sourceBranch ? { sourceBranch: noAddress(e.sourceBranch) } : {}), ...(e.productBranches ? { productBranches: e.productBranches.map(noAddress) } : {}) })) };
}

export function mapModel(inputs, { anonymous = false, previous = null, now = Date.now() } = {}) {
  inputs = withoutAddresses(inputs);
  const staleDays = Number.isInteger(inputs.staleDays) && inputs.staleDays > 0 ? inputs.staleDays : DEFAULT_STALE_DAYS;
  // A group whose pattern does not compile is left out (gatherMap says so) — never a catch-all by mistake.
  const usable = (inputs.groups || []).filter((g) => !g.pattern || compiles(g.pattern));
  const groups = (usable.length ? usable : DEFAULT_GROUPS).map((g) => {
    const re = g.pattern ? new RegExp(g.pattern, 'i') : null;
    return { id: String(g.id), label: String(g.label || g.id), re };
  });
  const { resolve, people } = makeResolver(inputs.members || []);
  const roles = new Map();   // key -> Set(role)
  const role = (key, r) => { if (!key) return; if (!roles.has(key)) roles.set(key, new Set()); roles.get(key).add(r); };

  const epics = inputs.epics.map((e) => ({ ...e, label: pretty(e.id) }));
  const epicIdsLong = epics.map((e) => e.id).sort((a, b) => b.length - a.length);
  const repoBy = new Map(inputs.repos.map((r) => [r.name, r]));

  // Tasks: where each shipped task's merge reached.
  const tasks = inputs.tasks.map((t) => {
    const repo = repoBy.get(t.repo);
    const out = { id: `${t.story}-${t.task}-${t.repo}`, story: t.story, epic: t.epic, task: t.task, repo: t.repo, branch: t.branch || null,
      pr: /^https?:\/\//.test(t.pr || '') ? t.pr : null, shippedAt: t.shippedAt || null, verified: true, note: null, via: null,
      roles: { builder: resolve(t.builder), reviewers: [...new Set(asList(t.reviewers).map(resolve).filter(Boolean))] } };
    role(out.roles.builder, 'builder');
    for (const k of out.roles.reviewers) role(k, 'reviewer');
    if (!repo) { out.state = 'merged'; out.verified = false; out.note = `${t.repo} is not a registered repo`; return out; }
    if (!repo.available) { out.state = 'merged'; out.verified = false; out.note = `${t.repo} is not on this machine, so Production could not be checked`; return out; }
    const r = t.reach;
    if (!r || !r.found) { out.state = 'merged'; out.verified = false; out.note = 'Its merge commit is not in the local copy yet (try --fetch)'; return out; }
    if (r.prod) out.state = 'live';
    else if (r.via) { out.state = 'live'; out.via = r.via.branch; out.note = `Reached ${repo.productionBranch} on ${String(r.via.date).slice(0, 10)} through its own branch “${r.via.branch}”, not through ${repo.integrationBranch}.`; }
    else if (r.integ) out.state = 'merged';
    else { out.state = 'merged'; out.verified = false; out.note = `Merge commit found, but not on ${repo.integrationBranch} or ${repo.productionBranch || 'a Production branch'}`; }
    return out;
  });

  // Branches: merged into Production, else into Development, else active or idle by age.
  const taskBranch = new Set(tasks.map((t) => `${t.repo}:${t.branch}`));
  const branches = inputs.branches.map((b) => {
    const ageDays = Math.max(0, Math.floor((now - Date.parse(b.date)) / 864e5));
    const state = b.inProd ? 'live' : b.inInteg ? 'merged' : ageDays > staleDays ? 'idle' : 'active';
    const raw = b.rawName ?? b.name;   // the epic, story and group are read from the name as it was
    const epic = epicIdsLong.find((id) => new RegExp(`(?:^|[^A-Za-z0-9])${reEsc(id)}(?![A-Za-z0-9])`).test(raw)) || null;
    const sm = epic ? new RegExp(`${reEsc(epic)}-(S\\d+)`).exec(raw) : null;
    const group = epic ? null : (groups.find((g) => !g.re || g.re.test(raw)) || groups[groups.length - 1]).id;
    const author = resolve(b.author);
    role(author, 'builder');
    return { id: `${b.repo}:${b.name}`, repo: b.repo, name: b.name, sha: String(b.sha || '').slice(0, 10), date: b.date, state, ageDays, epic,
      story: sm ? `${epic}-${sm[1]}` : null, group, ahead: state === 'live' || state === 'merged' ? 0 : (Number.isInteger(b.ahead) ? b.ahead : null),
      roles: { builder: author }, task: taskBranch.has(`${b.repo}:${b.name}`) };
  });

  // Stories.
  const started = (s) => Object.values(s.build || {}).some((b) => (b.steps || []).some((x) => ['done', 'in_progress', 'in_review'].includes(x.status)));
  const stories = inputs.stories.map((s) => {
    const mine = tasks.filter((t) => t.story === s.id);
    const open = branches.filter((b) => b.story === s.id && (b.state === 'active' || b.state === 'idle'));
    const out = { id: s.id, epic: s.epic, short: (/-(S\d+)$/.exec(s.id) || [])[1] || s.id, title: s.title || '', status: s.status || 'unknown',
      repos: asList(s.repos), build: s.build || {}, taskCount: mine.length, tasksLive: mine.filter((t) => t.state === 'live').length, roles: { owner: resolve(s.owner) } };
    role(out.roles.owner, 'owner');
    if (s.status === 'shipped') {
      out.state = mine.length && mine.every((t) => t.state === 'live') ? 'live' : 'merged';
      out.verified = mine.length > 0 && mine.every((t) => t.verified);
      out.stateLabel = out.state === 'live' ? 'Shipped and in Production' : 'Shipped, waiting for release';
    } else if (started(s) || mine.length || open.length) {
      out.state = 'active'; out.stateLabel = 'Being built';
    } else {
      out.state = 'planned'; out.stateLabel = s.status === 'approved' ? 'Approved, not started' : s.status === 'draft' ? 'Draft' : String(s.status || 'Not started');
    }
    return out;
  });

  // Epics.
  for (const e of epics) {
    const mine = stories.filter((s) => s.epic === e.id);
    e.storyCount = mine.length;
    e.storiesShipped = mine.filter((s) => s.status === 'shipped').length;
    e.taskCount = tasks.filter((t) => t.epic === e.id).length;
    const owner = resolve(e.owner);
    role(owner, 'owner');
    const stepOwners = Object.entries(e.stepOwners || {}).map(([step, name]) => ({ step, person: resolve(name) })).filter((x) => x.person);
    for (const so of stepOwners) role(so.person, 'owner');
    const seenApproval = new Set();
    const approvers = (e.approvals || []).map((a) => ({ step: a.step, person: resolve(a.approver) }))
      .filter((x) => x.person && !seenApproval.has(`${x.step}\0${x.person}`) && seenApproval.add(`${x.step}\0${x.person}`));
    for (const a of approvers) role(a.person, 'approver');
    e.roles = { owner, stepOwners, approvers };
    const todo = !e.steps?.length || e.steps.every((s) => s.status === 'todo');
    if (mine.length && mine.every((s) => s.state === 'live')) { e.state = 'live'; e.stateLabel = 'All stories in Production'; }
    else if (mine.length && mine.every((s) => s.status === 'shipped')) { e.state = 'merged'; e.stateLabel = 'All stories shipped, waiting for release'; }
    else if (mine.some((s) => s.state !== 'planned') || branches.some((b) => b.epic === e.id && b.state !== 'idle')) { e.state = 'active'; e.stateLabel = `Building — ${e.storiesShipped} of ${mine.length} stories shipped`; }
    else if (todo || e.currentStep === 'backfill-pending') { e.state = 'planned'; e.stateLabel = 'Not started'; }
    else if (e.currentStep === 'ready-for-build') { e.state = 'planned'; e.stateLabel = 'Planned, ready for build'; }
    else { e.state = 'active'; e.stateLabel = `Planning — at step “${e.currentStep}”`; }
    delete e.owner; delete e.stepOwners; delete e.approvals;
  }

  // Waiting on whom: each open gate's owner, by the same rule `yad standup` reads (gateWaits).
  // The person a gate waits on is that step's owner (the live E47 owner, else the epic's): an owner role.
  const waiting = (inputs.waits || []).map((w) => ({ epic: w.epic, step: w.step, kind: w.kind, person: resolve(w.owner) }));
  for (const w of waiting) role(w.person, 'owner');

  // The single-person note: every part of the epic so far came from one person.
  const notes = { onePerson: [] };
  for (const e of epics) {
    const keys = new Set([e.roles.owner, ...e.roles.stepOwners.map((x) => x.person), ...e.roles.approvers.map((x) => x.person)]);
    let parts = 0;
    for (const s of stories.filter((x) => x.epic === e.id)) { if (s.roles.owner) keys.add(s.roles.owner); }
    for (const t of tasks.filter((x) => x.epic === e.id)) { parts++; keys.add(t.roles.builder); for (const r of t.roles.reviewers) keys.add(r); }
    for (const b of branches.filter((x) => x.epic === e.id)) { parts++; keys.add(b.roles.builder); }
    parts += e.roles.approvers.length;
    keys.delete(null); keys.delete(undefined);
    if (keys.size === 1 && parts > 0) notes.onePerson.push(e.id);
  }

  // People, sorted by name, each with the roles they hold — no counts.
  // Everyone the map names is listed, so every badge and every "by" can be looked up; a person seen only as the
  // author of a repo's latest Production or Development commit holds no role.
  const peopleList = [...people.values()]
    .map((p) => ({ key: p.key, name: p.name, initials: initials(p.name), hue: hueOf(p.key), roles: [...(roles.get(p.key) || [])].sort(), ambiguous: p.ambiguous }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key));

  // Repos: by label only, never a path on this machine.
  const repos = inputs.repos.map((r) => ({ name: r.name, available: !!r.available, integrationBranch: r.integrationBranch || null, productionBranch: r.productionBranch || null,
    productionGuessed: !!r.productionGuessed, waitingCommits: r.waitingCommits ?? null, productionAhead: r.productionAhead ?? null, fetchedAt: r.fetchedAt || null,
    production: r.production ? { date: r.production.date, by: resolve(r.production.author) } : null,
    integration: r.integration ? { date: r.integration.date, by: resolve(r.integration.author) } : null }));

  let model = {
    generatedAt: new Date(now).toISOString(), staleDays, anonymous: !!anonymous,
    product: { name: inputs.product?.name || 'Product', branch: inputs.product?.branch || null, sha: inputs.product?.sha || null, behind: inputs.product?.behind ?? null, fetchedAt: inputs.product?.fetchedAt || null },
    repos, groups: groups.map((g) => ({ id: g.id, label: g.label })), epics, stories, tasks, branches, people: peopleList, waiting, notes, moved: [], since: null,
  };
  model.summary = summarize(model);

  if (anonymous) model = anonymize(model, people);

  // What moved: against the previous saved map's digest ({ at, states: { id: state } }).
  // An anonymous map never says what moved: its masked ids would read as new against a named map's digest.
  if (!anonymous && previous && previous.states && typeof previous.states === 'object') {
    const now2 = digestOf(model).states;
    model.moved = Object.entries(now2).filter(([id, st]) => Object.hasOwn(previous.states, id) ? previous.states[id] !== st : true)
      .map(([id, st]) => ({ id, from: Object.hasOwn(previous.states, id) ? previous.states[id] : null, to: st }));
    model.since = typeof previous.at === 'string' ? previous.at : null;
  }
  return model;
}

function summarize(m) {
  const vis = (o) => (o.state === 'merged' && o.verified === false ? 'unver' : o.state);
  return {
    epics: { total: m.epics.length, byState: tally(m.epics, 'state') },
    stories: { total: m.stories.length, byState: tally(m.stories, vis), shipped: m.stories.filter((s) => s.status === 'shipped').length },
    tasks: { total: m.tasks.length, byState: tally(m.tasks, vis), verified: m.tasks.filter((t) => t.verified).length },
    branches: Object.fromEntries(m.repos.filter((r) => r.available).map((r) => {
      const mine = m.branches.filter((b) => b.repo === r.name);
      return [r.name, { total: mine.length, byState: tally(mine, 'state'), waitingCommits: r.waitingCommits, lastRelease: r.production ? r.production.date : null }];
    })),
  };
}

// The state of every item, by id — what a later map compares itself with.
export function digestOf(model) {
  const states = {};
  const vis = (o) => (o.state === 'merged' && o.verified === false ? 'unver' : o.state);
  for (const e of model.epics) states[`epic:${e.id}`] = e.state;
  for (const s of model.stories) states[`story:${s.id}`] = vis(s);
  for (const t of model.tasks) states[`task:${t.id}`] = vis(t);
  for (const b of model.branches) states[`branch:${b.id}`] = b.state;
  return { at: model.generatedAt, states };
}

// `--anonymous`: every person becomes "Person A…" (in the order of their key, so the same team always gets
// the same letters), and nothing else can name them: the capture-branch name, a branch part that is a
// person's name, PR links. Ids are rebuilt from the masked names, so no id carries one either.
function anonymize(model, people) {
  const keys = model.people.map((p) => p.key).sort();
  const alias = new Map(keys.map((k, i) => [k, { key: `p${i + 1}`, name: personLetter(i) }]));
  const raws = [...people.values()].filter((p) => alias.has(p.key)).flatMap((p) => [...p.raws, p.name]).map((r) => String(r).toLowerCase()).filter((r) => r.length >= 2);
  // Each name, each of its words (3 letters or more), and the name with its separators taken out
  // (`bobbuilder`), so `bob.builder/x`, `feat/bob_builder` and `bobbuilder-fix` are all masked.
  const parts = new Set(raws.flatMap((r) => [r, r.replace(/[\s._-]+/g, ''), ...r.split(/[\s._-]+/).filter((x) => x.length >= 3)]));
  const k = (key) => (key && alias.has(key) ? alias.get(key).key : null);
  const maskBranch = (name) => {
    if (!name) return name;
    let n = String(name).replace(/^yad\/wip\/[^/]+\//, 'yad/wip/someone/');
    n = n.split('/').map((seg) => (parts.has(seg.toLowerCase()) || parts.has(seg.toLowerCase().replace(/[._-]+/g, '')) ? 'someone'
      : seg.split(/([._-])/).map((w) => (parts.has(w.toLowerCase()) ? 'someone' : w)).join(''))).join('/');
    return parts.has(n.toLowerCase()) ? 'someone' : n;
  };
  const out = JSON.parse(JSON.stringify(model));
  out.people = model.people.map((p) => { const a = alias.get(p.key); return { ...p, key: a.key, name: a.name, initials: a.name.replace(/^Person /, ''), hue: hueOf(a.key), ambiguous: null }; })
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  for (const e of out.epics) {
    e.roles = { owner: k(e.roles.owner), stepOwners: e.roles.stepOwners.map((x) => ({ step: x.step, person: k(x.person) })), approvers: e.roles.approvers.map((x) => ({ step: x.step, person: k(x.person) })) };
    if (e.sourceBranch) e.sourceBranch = maskBranch(e.sourceBranch);
    if (e.productBranches) e.productBranches = e.productBranches.map(maskBranch);
  }
  for (const s of out.stories) s.roles = { owner: k(s.roles.owner) };
  for (const t of out.tasks) {
    t.roles = { builder: k(t.roles.builder), reviewers: t.roles.reviewers.map(k).filter(Boolean) };
    t.branch = maskBranch(t.branch); t.pr = null;
    if (t.via) { t.via = maskBranch(t.via); t.note = t.note && t.note.replace(/“[^”]*”/, `“${t.via}”`); }
  }
  for (const b of out.branches) {
    b.roles = { builder: k(b.roles.builder) };
    const masked = maskBranch(b.name);
    b.name = masked; b.id = `${b.repo}:${masked}`;
  }
  for (const r of out.repos) {
    if (r.production) r.production.by = k(r.production.by);
    if (r.integration) r.integration.by = k(r.integration.by);
  }
  out.waiting = out.waiting.map((w) => ({ ...w, person: k(w.person) }));
  return out;
}

// Delivered straight to Production on a branch of its own (a merge on the Production branch's first-parent
// line): a branch that names this TASK after the story id counts for it — the task read by its number (T1
// and T01 are one task), after any of - _ . / ; a branch that names only the story (the whole story rebuilt,
// no task id after it) counts for each of its tasks. → { date, branch } | null
export function portFor(direct, story, task) {
  const num = /^T0*(\d+)$/i.exec(String(task))?.[1];
  const taskRe = num ? new RegExp(`${reEsc(story)}[-_./]T0*${num}(?![A-Za-z0-9])`, 'i') : new RegExp(`${reEsc(story)}[-_./]${reEsc(String(task))}(?![A-Za-z0-9])`);
  const storyRe = new RegExp(`${reEsc(story)}(?![\\d])(?![-_./]T\\d)`, 'i');
  // From the FIRST place the story id appears (any later one too), no task id anywhere after it.
  const firstRe = new RegExp(`${reEsc(story)}(?!\\d)`, 'i');
  const storyOnly = (branch) => {
    const m = firstRe.exec(branch);
    return !!m && storyRe.test(branch) && !/[-_./]T\d/i.test(branch.slice(m.index + story.length));
  };
  return direct.find((d) => taskRe.test(d.branch)) || direct.find((d) => storyOnly(d.branch)) || null;
}

// ---- gathering (git and files) -------------------------------------------------------------------

const gitIn = (runner) => (cwd, args, o = {}) => {
  const r = runner('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 1 << 29, windowsHide: true, ...o });
  return { ok: r.status === 0, code: r.status, out: String(r.stdout ?? ''), err: String(r.stderr ?? '') };
};
const isRepo = (g, p) => fs.existsSync(p) && g(p, ['rev-parse', '--git-dir']).ok;
const hasRef = (g, repo, ref) => g(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok;
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
function fetchTime(g, repo) {
  const d = g(repo, ['rev-parse', '--absolute-git-dir']);
  if (!d.ok) return null;
  try { return fs.statSync(path.join(d.out.trim(), 'FETCH_HEAD')).mtime.toISOString(); } catch { return null; }
}
// Each remote-tracking branch of origin: name, sha, committer date, author name. Fields split by NUL.
function remoteBranches(g, repo) {
  const fmt = ['%(refname:lstrip=3)', '%(objectname)', '%(committerdate:iso-strict)', '%(authorname)'].join('%00');
  return lines(g(repo, ['for-each-ref', 'refs/remotes/origin', `--format=${fmt}`]).out).map((l) => {
    const [name, sha, date, author] = l.split('\0');
    return { name, sha, date, author };
  }).filter((b) => b.name && b.name !== 'HEAD');
}
const mergedInto = (g, repo, ref) => new Set(lines(g(repo, ['for-each-ref', 'refs/remotes/origin', '--merged', ref, '--format=%(refname:lstrip=3)']).out));
const count = (g, repo, range) => { const r = g(repo, ['rev-list', '--count', range, '--']); return r.ok ? Number(r.out.trim()) : null; };

// Read one epic from the working tree.
function epicFromTree(root, id) {
  const dir = epicRoot(root, id);
  const led = loadLedger(dir);
  const fm = readFrontmatter(path.join(dir, 'epic.md'));
  let epicMd = '';
  try { epicMd = fs.readFileSync(path.join(dir, 'epic.md'), 'utf8'); } catch { /* no epic.md */ }
  const state = led.state || {};
  const stories = [];
  const sdir = path.join(dir, 'stories');
  if (fs.existsSync(sdir)) {
    for (const f of fs.readdirSync(sdir).filter((n) => n.endsWith('.md')).sort()) {
      let text;
      try { text = fs.readFileSync(path.join(sdir, f), 'utf8'); } catch { continue; }
      const s = frontmatterText(text);
      stories.push({ id: s.id || f.replace(/\.md$/, ''), epic: id, title: storyTitle(text), status: s.status || 'unknown', owner: s.owner || null, repos: asList(s.repos), build: {} });
    }
  }
  for (const b of Object.values(led.buildStates || {})) {
    const s = stories.find((x) => x.id === b?.story);
    if (!s) continue;
    for (const [repo, v] of Object.entries(b.repos || {})) s.build[repo] = { currentStep: v?.currentStep || null, steps: (v?.steps || []).map((x) => ({ id: x.id, status: x.status })) };
  }
  const ships = readShips(dir);
  const stepOwners = {};
  for (const o of readOwners(root, id)) if (!o.error && o.live) stepOwners[o.step] = o.name || o.owner;
  return {
    epic: { id, title: fm.title || heading(epicMd) || null, type: state.type || fm.type || null, currentStep: state.currentStep || null, createdAt: state.createdAt || null,
      owner: typeof fm.owner === 'string' ? fm.owner : null, parent: fm.parent || null, repos: asList(fm.repos), steps: (state.steps || []).map((s) => ({ id: s.id, status: s.status })),
      onMain: true, stepOwners, approvals: (Array.isArray(led.approvals) ? led.approvals : []).filter((a) => a && a.status !== 'revoked').map((a) => ({ step: a.step, approver: a.approver })) },
    stories,
    tasks: ships.filter((t) => t && t.story && t.task).map((t) => ({ story: t.story, epic: id, task: t.task, repo: t.repo, branch: t.branch || null, pr: t.pr || null,
      mergeCommit: t.mergeCommit || null, shippedAt: t.shippedAt || null, reviewers: (t.engineer_review || []).map((r) => r?.approver).filter(Boolean) })),
    ledger: led,
  };
}

// An epic that so far lives only on a Product branch (being written): read from that ref.
function epicFromRef(runner, root, ref, id) {
  const files = listTreeAt(root, ref, [`epics/${id}`], { runner });
  if (!files.some((f) => f.endsWith('/.sdlc/state.json'))) return null;
  const want = files.filter((f) => /\/\.sdlc\/state\.json$|\/epic\.md$|\/stories\/[^/]+\.md$|\/\.sdlc\/build-log\.json$|\/\.sdlc\/build-log\/[^/]+\.json$/.test(f));
  const got = readFilesAt(root, ref, want, { runner });
  const base = `epics/${id}/`;
  const state = json(got.get(`${base}.sdlc/state.json`)) || {};
  const epicMd = got.get(`${base}epic.md`) || '';
  const fm = frontmatterText(epicMd);
  const stories = [], tasks = [];
  const addShip = (t) => { if (t && t.story && t.task) tasks.push({ story: t.story, epic: id, task: t.task, repo: t.repo, branch: t.branch || null, pr: t.pr || null, mergeCommit: t.mergeCommit || null, shippedAt: t.shippedAt || null, reviewers: (t.engineer_review || []).map((r) => r?.approver).filter(Boolean) }); };
  for (const f of want) {
    const text = got.get(f);
    if (/\/stories\//.test(f)) {
      const s = frontmatterText(text);
      stories.push({ id: s.id || path.posix.basename(f, '.md'), epic: id, title: storyTitle(text), status: s.status || 'unknown', owner: s.owner || null, repos: asList(s.repos), build: {} });
    } else if (/\/build-log\.json$/.test(f)) { for (const t of json(text)?.ships || []) addShip(t); }
    else if (/\/build-log\//.test(f)) addShip(json(text));
  }
  return {
    epic: { id, title: fm.title || heading(epicMd) || null, type: state.type || fm.type || null, currentStep: state.currentStep || null, createdAt: state.createdAt || null,
      owner: typeof fm.owner === 'string' ? fm.owner : null, parent: fm.parent || null, repos: asList(fm.repos), steps: (state.steps || []).map((s) => ({ id: s.id, status: s.status })),
      onMain: false, sourceBranch: ref.replace(/^origin\//, ''), stepOwners: {}, approvals: [] },
    stories, tasks,
  };
}

// Everything `mapModel` needs, read from this machine. Read-only, except `git fetch origin` with `fetch`.
//   → { inputs, problems: [text] }
export function gatherMap(root, { fetch = false, runner = spawnSync, now = Date.now(), log = () => {} } = {}) {
  const g = gitIn(runner);
  const problems = [];
  const productConfig = readJSON(productConfigPath(root), null) || {};
  const mapCfg = productConfig.map && typeof productConfig.map === 'object' ? productConfig.map : {};
  if (fetch && isRepo(g, root)) {
    log('downloading the latest for the Product (nothing is uploaded) …');
    if (!g(root, ['fetch', 'origin']).ok) problems.push('the Product could not be fetched; using what is already here');
  }
  const branch = isRepo(g, root) ? g(root, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim() : null;
  const sha = isRepo(g, root) ? g(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).out.trim() || null : null;
  const def = isRepo(g, root) ? g(root, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).out.trim() : '';
  const behind = def && sha ? count(g, root, `HEAD..${def}`) : null;

  // The epics in this checkout, then those only on a branch.
  const epics = [], stories = [], tasks = [], ledgers = new Map();
  for (const id of epicIds(root).filter((x) => x !== FOUNDATION_EPIC)) {
    try {
      const e = epicFromTree(root, id);
      epics.push(e.epic); stories.push(...e.stories); tasks.push(...e.tasks); ledgers.set(id, e.ledger);
    } catch (err) { problems.push(`${id}: its ledger cannot be read (${shown(String(err.message || err).split('\n')[0].split(root + path.sep).join(''))})`); }
  }
  const seen = new Set(epics.map((e) => e.id));
  if (isRepo(g, root)) {
    const pBranches = remoteBranches(g, root).sort((a, z) => String(z.date).localeCompare(String(a.date)));
    for (const b of pBranches) {
      const id = b.name.split('/').find((seg) => /^EP-[A-Za-z0-9-]+$/.test(seg));
      if (!id || seen.has(id)) continue;
      const e = epicFromRef(runner, root, `origin/${b.name}`, id);
      if (!e) continue;
      seen.add(id);
      epics.push(e.epic); stories.push(...e.stories); tasks.push(...e.tasks);
    }
    for (const e of epics) e.productBranches = pBranches.filter((b) => b.name.split('/').includes(e.id)).map((b) => b.name);
  }

  // Waiting on whom (the gate rule `yad standup` reads).
  const identity = productIdentity(root, { productConfig });
  const members = (() => { try { return readMembers(root, { identity }).members; } catch { return []; } })();
  const waits = [];
  try {
    const gw = gateWaits(root, { ledgers, members, productConfig, identity });
    for (const { owner, item } of gw.waits) if (item.kind === 'gate') waits.push({ epic: item.epic, step: item.step, kind: item.kind, owner: owner ? owner.display : null });
  } catch (err) { problems.push(`the open gates could not be read (${shown(String(err.message || err).split('\n')[0])})`); }

  // Code repos.
  const { registry, problem } = readRegistry(root);
  if (problem) problems.push(problem);
  const repos = [], branches = [];
  const productionCfg = mapCfg.production && typeof mapCfg.production === 'object' ? mapCfg.production : {};
  for (const r of registry.repos) {
    if (!r || typeof r.name !== 'string') continue;
    const p = path.resolve(root, typeof r.path === 'string' ? r.path : '');
    const info = { name: r.name, available: typeof r.path === 'string' && isRepo(g, p), integrationBranch: r.default_branch || null, productionBranch: null, productionGuessed: false };
    repos.push(info);
    const mine = tasks.filter((t) => t.repo === r.name);
    if (!info.available) continue;
    if (fetch) {
      log(`downloading the latest for ${r.name} (nothing is uploaded) …`);
      if (!g(p, ['fetch', 'origin']).ok) problems.push(`${r.name} could not be fetched; using what is already here`);
    }
    let live = null;
    if (fetch) { const ls = g(p, ['ls-remote', '--heads', 'origin']); if (ls.ok) live = new Set(lines(ls.out).map((l) => l.split('\t')[1]?.replace('refs/heads/', '')).filter(Boolean)); }
    const all = remoteBranches(g, p);
    info.fetchedAt = fetchTime(g, p);
    const integ = info.integrationBranch && hasRef(g, p, `origin/${info.integrationBranch}`) ? `origin/${info.integrationBranch}` : null;
    const chosen = typeof productionCfg[r.name] === 'string' ? productionCfg[r.name] : null;
    const prodName = chosen && hasRef(g, p, `origin/${chosen}`) ? chosen : (!chosen ? PRODUCTION_GUESSES.find((n) => n !== info.integrationBranch && hasRef(g, p, `origin/${n}`)) : null);
    if (chosen && !prodName) problems.push(`${r.name}: map.production names "${shown(chosen)}", which origin does not have`);
    info.productionBranch = prodName || null;
    info.productionGuessed = !!prodName && !chosen;
    const prod = prodName ? `origin/${prodName}` : null;
    const inProd = prod ? mergedInto(g, p, prod) : new Set();
    const inInteg = integ ? mergedInto(g, p, integ) : new Set();
    if (prod && integ) { info.waitingCommits = count(g, p, `${prod}..${integ}`); info.productionAhead = count(g, p, `${integ}..${prod}`); }
    for (const b of all) {
      if (b.name === prodName) info.production = { date: b.date, author: b.author };
      if (b.name === info.integrationBranch) info.integration = { date: b.date, author: b.author };
    }
    for (const b of all) {
      if (b.name === prodName || b.name === info.integrationBranch) continue;
      if (live && !live.has(b.name)) continue;
      const merged = (prod && inProd.has(b.name)) || (integ && inInteg.has(b.name));
      branches.push({ repo: r.name, name: b.name, sha: b.sha, date: b.date, author: b.author, inProd: !!(prod && inProd.has(b.name)), inInteg: !!(integ && inInteg.has(b.name)),
        ahead: merged ? 0 : count(g, p, `${integ || prod || 'HEAD'}..origin/${b.name}`) });
    }
    // Work rebuilt on its own branch and merged straight into Production names the story in its merge.
    const direct = prod ? lines(g(p, ['log', '--first-parent', '--merges', '-n', '500', '--format=%cI%x00%s', prod]).out).map((l) => {
      const [date, subject] = l.split('\0');
      const m = /Merge branch '([^']+)'/.exec(subject || '') || /Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject || '');
      return m ? { date, branch: m[1] } : null;
    }).filter(Boolean) : [];
    const memo = new Map();
    const reach = (c, ref) => {
      const key = `${c}\0${ref}`;
      if (!memo.has(key)) { const code = g(p, ['merge-base', '--is-ancestor', c, ref]).code; memo.set(key, code === 0 ? true : code === 1 ? false : null); }
      return memo.get(key);
    };
    for (const t of mine) {
      if (!t.mergeCommit || !/^[0-9a-f]{4,64}$/i.test(t.mergeCommit) || !g(p, ['cat-file', '-e', `${t.mergeCommit}^{commit}`]).ok) { t.reach = { found: false }; continue; }
      const via = portFor(direct, t.story, t.task);
      t.reach = { found: true, prod: !!(prod && reach(t.mergeCommit, prod)), integ: !!(integ && reach(t.mergeCommit, integ)), via };
      // The builder: the author of the merged branch's tip (the merge's second parent), else of the commit.
      const parents = g(p, ['rev-list', '--parents', '-n', '1', t.mergeCommit]).out.trim().split(/\s+/);
      const tip = parents.length > 2 ? `${t.mergeCommit}^2` : t.mergeCommit;
      const an = g(p, ['log', '-1', '--format=%an', tip, '--']);
      if (an.ok && an.out.trim()) t.builder = an.out.trim();
    }
  }

  for (const grp of Array.isArray(mapCfg.groups) ? mapCfg.groups : []) {
    if (grp && typeof grp.pattern === 'string' && !compiles(grp.pattern)) problems.push(`map.groups: the pattern of "${shown(String(grp.id))}" is not a valid pattern, so that group is left out`);
  }
  return {
    problems,
    inputs: {
      product: { name: typeof productConfig.name === 'string' && productConfig.name.trim() ? productConfig.name.trim() : path.basename(root), branch: branch && branch !== 'HEAD' ? branch : null, sha, behind, fetchedAt: isRepo(g, root) ? fetchTime(g, root) : null },
      staleDays: Number.isInteger(mapCfg.staleDays) ? mapCfg.staleDays : DEFAULT_STALE_DAYS,
      groups: Array.isArray(mapCfg.groups) ? mapCfg.groups.filter((x) => x && typeof x.id === 'string' && (!x.pattern || typeof x.pattern === 'string')) : [],
      members, epics, stories, tasks, repos, branches, waits, now,
    },
  };
}
