// E169 — the team's backlog, read from GitHub issues and GitLab issues/tasks/incidents ("tracker items": in
// yadflow "work item" already names an epic's type). Read live from the Product repo and every registered
// code repo, as `yad standup` reads pull requests, and E70's rule holds: an empty list is an answer only
// when the platform answered it. A repo that cannot be read is "not read", never "no items".
//
// THIS COMMAND PRINTS TITLES, unlike standup and `yad usage`: a backlog with no titles is no use. So:
//   - a title or label is written by anyone who can open an item. It is cleaned once when read (`forTerminal`)
//     and escaped for each output; the HTML page's script only moves rows, it never builds markup;
//   - a GitLab confidential item keeps its number and facts, and its title is never read into the model.
// Status is worked out from facts (open or closed, and later the linked epic). A `status:` label is never read.
import fs from 'node:fs';
import { run, readJSON, forTerminal, c, log, fail, hand, info, note } from './lib.mjs';
import { productConfigPath } from './manifest.mjs';
import { platformLogin } from './platform.mjs';
import { readMembers, productIdentity } from './members.mjs';
import { prTarget } from './pr-list.mjs';
import { repoSources, whoseAccount } from './standup.mjs';
import { api, httpStatus, shown, whyFailed, PAGE, TIMEOUT } from './protection.mjs';
import { esc, writeReport } from './usage.mjs';
import { allLinks, combinedStage, epicStage, itemKey } from './issue-links.mjs';

export const MAX_ITEMS = 1000;
const MAX_PAGES = Math.ceil(MAX_ITEMS / PAGE);
const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_CLOSED_DAYS = 30;
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const ITEM_TYPES = ['bug', 'feature', 'enhancement'];
export const STATUSES = ['todo', 'in progress', 'done'];
const SORTS = ['priority', 'type', 'status', 'due', 'updated'];
const DATE_FIELDS = ['created', 'updated', 'due'];
const LABEL_COLOR = { priority: 'b60205', type: '1d76db', status: '0e8a16' };

// ---- labels --------------------------------------------------------------------------------------

// The accepted labels of each value: the first is what `yad issues labels` creates. `issues.priority` and
// `issues.type` in the Product settings replace a value's list, one value at a time.
export function labelRules(productConfig, notes = []) {
  const rules = {
    priority: Object.fromEntries(PRIORITIES.map((p) => [p, [`priority: ${p}`, p]])),
    type: { bug: ['bug', 'type: bug'], feature: ['feature', 'type: feature'], enhancement: ['enhancement', 'type: enhancement'] },
    status: Object.fromEntries(STATUSES.map((s) => [s, [`status: ${s}`]])),
  };
  const set = productConfig?.issues;
  if (set === undefined || set === null) return rules;
  if (typeof set !== 'object' || Array.isArray(set)) { notes.push('the "issues" settings in .sdlc/product.json are not an object — the default labels are used'); return rules; }
  for (const kind of ['priority', 'type']) {
    if (set[kind] === undefined) continue;
    for (const [value, list] of Object.entries(set[kind] ?? {})) {
      const good = Object.hasOwn(rules[kind], value) && Array.isArray(list) && list.length > 0 && list.every((l) => typeof l === 'string' && l.trim());
      if (good) rules[kind][value] = list.map((l) => l.trim());
      else notes.push(`the "issues.${forTerminal(kind)}.${forTerminal(value)}" setting in .sdlc/product.json is not a list of labels for a known value — ignored`);
    }
  }
  return rules;
}

// The first value (in the fixed order: most urgent first) with a label on the item, and whether two differ.
export function pick(labels, table) {
  const have = new Set(labels.map((l) => l.toLowerCase()));
  const found = Object.keys(table).filter((v) => table[v].some((l) => have.has(l.toLowerCase())));
  return { value: found[0] ?? null, more: found.length > 1 };
}

// ---- reading ---------------------------------------------------------------------------------------

const str = (v) => (typeof v === 'string' && v ? v : null);
const clean = (v) => forTerminal(String(v ?? '')).replace(/\s+/g, ' ').trim();
const day = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString().slice(0, 10) : null);
const httpUrl = (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };

const ghFields = 'number title url state createdAt updatedAt closedAt milestone{dueOn} assignees(first:20){nodes{login}} labels(first:100){nodes{name}}';
const GH_ITEMS = `query($owner:String!,$name:String!,$cursor:String,$states:[IssueState!],$since:DateTime){repository(owner:$owner,name:$name){hasIssuesEnabled issues(first:${PAGE},after:$cursor,filterBy:{states:$states,since:$since},orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{${ghFields}}}}}`;

// One state of one GitHub repo, page by page. `{ ok:true, nodes, partial, why?, off? }` or `{ ok:false, why }`.
function readGitHub(t, runner, state, since) {
  const [owner, name, ...rest] = t.repo.split('/');
  if (!name || rest.length) return { ok: false, kind: 'no-url', why: `${shown(t.repo)} is not an owner/name GitHub repo path` };
  const what = `the issues of ${shown(t.repo)}`;
  const nodes = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = ['api', '--hostname', t.host, 'graphql', '-f', `query=${GH_ITEMS}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `states=${state}`];
    if (since) args.push('-f', `since=${since}`);
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const r = runner('gh', args, { timeout: TIMEOUT });
    let why = null;
    let repo = null;
    if (!r.ok) {
      why = httpStatus(r) == null && /\bGraphQL:/.test(`${r.stderr || ''}${r.stdout || ''}`)
        ? `GitHub answered the issue query for ${shown(t.repo)} with an error (the repo may not exist, or your login may not see it)`
        : whyFailed({ ok: false, status: httpStatus(r) }, { platform: 'github', host: t.host, what, plural: true });
    } else {
      try { repo = JSON.parse(r.stdout)?.data?.repository; } catch { /* judged just below */ }
      if (!repo || (repo.hasIssuesEnabled !== false && !Array.isArray(repo.issues?.nodes))) why = whyFailed({ unreadable: true }, { platform: 'github', host: t.host, what, plural: true });
    }
    if (why) return page === 0 ? { ok: false, kind: 'other', why } : { ok: true, nodes, partial: true, why };
    if (repo.hasIssuesEnabled === false) return { ok: true, nodes: [], partial: false, off: true };
    nodes.push(...repo.issues.nodes);
    if (!repo.issues.pageInfo?.hasNextPage) return { ok: true, nodes, partial: false };
    cursor = repo.issues.pageInfo.endCursor;
    if (!cursor) return { ok: true, nodes, partial: true };
  }
  return { ok: true, nodes, partial: true };
}

function readGitLab(t, runner, state, since) {
  const what = `the issues of ${shown(t.repo)}`;
  const at = `projects/${encodeURIComponent(t.repo)}/issues?state=${state}&order_by=updated_at&sort=desc&per_page=${PAGE}${since ? `&updated_after=${encodeURIComponent(since)}` : ''}`;
  const nodes = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = api(runner, 'glab', t.host, `${at}&page=${page}`);
    const list = res.ok && Array.isArray(res.body) ? res.body : null;
    if (!list) {
      const why = whyFailed(res.ok ? { unreadable: true } : res, { platform: 'gitlab', host: t.host, what, plural: true });
      return page === 1 ? { ok: false, kind: 'other', why } : { ok: true, nodes, partial: true, why };
    }
    nodes.push(...list);
    if (list.length < PAGE) return { ok: true, nodes, partial: false };
  }
  return { ok: true, nodes, partial: true };
}

// The platform's answer in one shape. Nothing but these fields leaves this function.
function ghItem(n) {
  return { number: n.number, title: clean(n.title), url: httpUrl(n.url), state: n.state === 'CLOSED' ? 'closed' : 'open', kind: 'issue',
    labels: (n.labels?.nodes || []).map((l) => clean(l?.name)).filter(Boolean),
    logins: (n.assignees?.nodes || []).map((a) => str(a?.login)).filter(Boolean),
    created: day(n.createdAt), updated: day(n.updatedAt), closed: day(n.closedAt), due: day(n.milestone?.dueOn), confidential: false };
}
function glItem(n) {
  const confidential = n.confidential === true;
  return { number: n.iid, title: confidential ? '(confidential: open it on GitLab to read the title)' : clean(n.title), url: httpUrl(n.web_url), state: n.state === 'closed' ? 'closed' : 'open',
    kind: ['issue', 'task', 'incident', 'test_case'].includes(n.issue_type) ? n.issue_type : 'issue',
    labels: confidential ? [] : (Array.isArray(n.labels) ? n.labels.map(clean).filter(Boolean) : []),
    logins: (Array.isArray(n.assignees) ? n.assignees : []).map((a) => str(a?.username)).filter(Boolean),
    created: day(n.created_at), updated: day(n.updated_at), closed: day(n.closed_at), due: day(n.due_date), confidential };
}

// The items of one repo: open ones, and those closed since `closedSinceMs`.
//   `{ ok:true, items, partial, why?, off? }` or `{ ok:false, kind, why }`.
export function listTrackerItems(target, { closedSinceMs, runner = run, env = process.env, authCache = new Map() } = {}) {
  const t = target?.cli ? target : prTarget(target, { runner, env, authCache });
  if (!t.ok) return t;
  const gh = t.platform === 'github';
  const read = gh ? readGitHub : readGitLab;
  // Whole UTC days: what is asked, what is kept and what the report's heading says are the same day.
  const since = `${new Date(closedSinceMs).toISOString().slice(0, 10)}T00:00:00.000Z`;
  const open = read(t, runner, gh ? 'OPEN' : 'opened', null);
  if (!open.ok) return { ...t, ...open };
  if (open.off) return { ...t, ok: true, items: [], partial: false, off: true };
  const closed = read(t, runner, gh ? 'CLOSED' : 'closed', since);
  const toItem = gh ? ghItem : glItem;
  const nodes = [...open.nodes, ...(closed.ok ? closed.nodes : [])].filter((n) => n && Number.isInteger(n.number ?? n.iid));
  const items = nodes.map(toItem).filter((i) => i.state === 'open' || (i.closed && Date.parse(i.closed) >= Date.parse(since.slice(0, 10))));
  const why = open.why || (closed.ok ? closed.why : `the closed items were not read: ${closed.why}`) || null;
  return { ...t, ok: true, items, partial: !!(open.partial || closed.partial || !closed.ok), ...(why ? { why } : {}) };
}

// ---- the model -------------------------------------------------------------------------------------

// Status from facts. `epicStage` is the linked epic's stage, or null with no linked epic.
export function itemStatus(state, epicStage = null) {
  if (state === 'closed') return { status: 'done', flags: epicStage && epicStage !== 'shipped' ? ['closed, epic still running'] : [] };
  if (epicStage === 'shipped') return { status: 'done', flags: ['epic shipped, item still open'] };
  return { status: epicStage ? 'in progress' : 'todo', flags: [] };
}

const rank = (list, v) => { const i = list.indexOf(v); return i < 0 ? list.length : i; };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const late = (v) => v || '9999-99-99';
const tie = (a, b) => cmp(rank(PRIORITIES, a.priority), rank(PRIORITIES, b.priority)) || cmp(late(a.due), late(b.due)) || cmp(b.updated || '', a.updated || '') || cmp(a.ref, b.ref);
export const SORTERS = {
  priority: tie,
  type: (a, b) => cmp(rank(ITEM_TYPES, a.type), rank(ITEM_TYPES, b.type)) || tie(a, b),
  status: (a, b) => cmp(rank(STATUSES, a.status), rank(STATUSES, b.status)) || tie(a, b),
  due: (a, b) => cmp(late(a.due), late(b.due)) || tie(a, b),
  updated: (a, b) => cmp(b.updated || '', a.updated || '') || tie(a, b),
};

// The Product repo's items are `#12`, every other repo's `<label>#12`.
export function buildIssues(root, { now = Date.now(), closedSinceMs = now - DEFAULT_CLOSED_DAYS * DAY, env = process.env, runner } = {}) {
  const r = runner ? { runner } : {};
  const notes = [];
  const productConfig = readJSON(productConfigPath(root), null);
  const rules = labelRules(productConfig, notes);
  const identity = productIdentity(root, { productConfig, ...r });
  const got = readMembers(root, { identity });
  const notRead = [];
  // With no local paths judged, the one thing written here is an unreadable registry: code repos went unread.
  const sources = repoSources(root, identity, productConfig, notRead, env, { localPaths: false });
  const registryUnread = notRead.length > 0;
  const seen = new Set();
  const authCache = new Map();
  const links = allLinks(root);
  if (links.unreadable.length) notes.push(`the item links of ${links.unreadable.join(', ')} could not be read, so items linked there show as unlinked`);
  const stages = new Map();
  const stageOf = (e) => { if (!stages.has(e)) stages.set(e, epicStage(root, e)); return stages.get(e); };
  const items = [];
  const repos = [];
  for (const s of sources) {
    const target = prTarget({ platform: s.platform, gitUrl: s.gitUrl }, { env, authCache, ...r });
    const key = target.host && target.repo ? `${target.host}/${target.repo}`.toLowerCase() : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const res = target.ok ? listTrackerItems(target, { closedSinceMs, env, ...r }) : target;
    repos.push({ label: s.label, platform: target.platform ?? null, host: target.host ?? null, repo: target.repo ?? null, read: !!res.ok, why: res.ok ? null : res.why, partial: !!res.partial, issuesOff: !!res.off });
    if (!res.ok) { notRead.push(`${s.label}: not read — ${res.why}`); continue; }
    if (res.off) notes.push(`${s.label}: issues are turned off for this repo`);
    if (res.partial) notes.push(`${s.label}: not every item was read${res.why ? ` — ${res.why}` : ` (the limit is ${MAX_ITEMS} of each state)`}, so the list is incomplete`);
    for (const it of res.items) {
      const p = pick(it.labels, rules.priority);
      const ty = pick(it.labels, rules.type);
      // Several epics can share an item. A linked epic whose ledger cannot be read still counts as started.
      const linked = links.byItem.get(itemKey({ host: target.host, repo: target.repo, number: it.number })) || [];
      const st = itemStatus(it.state, linked.length ? (combinedStage(linked.map(stageOf)) ?? 'in-shape') : null);
      const flags = [...st.flags];
      const epicRows = linked.map((id) => ({ id, stage: stageOf(id) }));
      if (p.more) flags.push('more than one priority label');
      if (ty.more) flags.push('more than one type label');
      const assignees = it.logins.map((login) => {
        const m = whoseAccount(got.members, { platform: target.platform, host: target.host, login }, got.disputed);
        return { login: clean(login), member: m.member ? m.member.primary.login : null };
      });
      items.push({ ref: `${s.label === 'Product' ? '' : s.label}#${it.number}`, repo: s.label, platform: target.platform, host: target.host, number: it.number, title: it.title, url: it.url,
        state: it.state, kind: it.kind, priority: p.value, type: ty.value, labels: it.labels, assignees, created: it.created, updated: it.updated, closed: it.closed, due: it.due,
        confidential: it.confidential, status: st.status, epic: epicRows[0] ?? null, epics: epicRows, flags });
    }
  }
  items.sort(SORTERS.priority);
  return { items, repos, notRead, notes, closedSince: new Date(closedSinceMs).toISOString().slice(0, 10), untrustedFields: ['title', 'labels'], registryUnread, memberErrors: got.errors?.length ?? 0 };
}

const list = (v) => String(v).split(',').map((x) => x.trim()).filter(Boolean);
const lower = (v) => String(v).toLowerCase();

// Narrow and sort. `mine` (from `--me`) is a map `platform\0host` → this person's login.
export function applyFilters(items, { priority, type, status, assignee, repo, since, until, date = 'created', sort = 'priority', mine = null } = {}) {
  const inList = (want, v, none) => !want || list(want).map(lower).includes(lower(v ?? none));
  const out = items.filter((i) => inList(priority, i.priority, 'none') && inList(type, i.type, 'none') && inList(status, i.status, '') && inList(repo, i.repo, '')
    && (!assignee || (lower(assignee) === 'none' ? i.assignees.length === 0 : i.assignees.some((a) => [a.login, a.member].filter(Boolean).map(lower).includes(lower(assignee)))))
    && (!mine || i.assignees.some((a) => mine.get(`${i.platform}\0${i.host}`)?.toLowerCase() === a.login.toLowerCase()))
    && (!since || (i[date] && i[date] >= since)) && (!until || (i[date] && i[date] <= until)));
  return out.sort(SORTERS[sort]);
}

export function summarize(items) {
  const by = (key, values) => Object.fromEntries([...values, 'none'].map((v) => [v, items.filter((i) => (i[key] ?? 'none') === v).length]));
  return { total: items.length, status: Object.fromEntries(STATUSES.map((s) => [s, items.filter((i) => i.status === s).length])), priority: by('priority', PRIORITIES), type: by('type', ITEM_TYPES),
    unassigned: items.filter((i) => !i.assignees.length).length };
}

// ---- output ----------------------------------------------------------------------------------------

const FOOTER = 'Item titles are included. Check this report before sharing it outside the team. A repo listed under "Not read" may hold more items.';
const who = (i) => (i.assignees.length ? i.assignees.map((a) => a.member || a.login).join(', ') : 'unassigned');
const counts = (s) => `${s.total} item${s.total === 1 ? '' : 's'}: ${STATUSES.map((v) => `${s.status[v]} ${v}`).join(', ')}; ${s.priority.none} with no priority, ${s.type.none} with no type, ${s.unassigned} unassigned`;
const gaps = (m) => [...m.notRead, ...m.notes];

function renderText(m) {
  info(c.bold(counts(m.summary)));
  for (const i of m.items) {
    log(`  ${i.ref.padEnd(14)} ${(i.priority ?? '--').padEnd(3)} ${(i.type ?? '-').padEnd(12)} ${i.status.padEnd(12)} ${who(i).padEnd(16)} ${i.title}${i.flags.length ? c.yellow(`  [${i.flags.join('; ')}]`) : ''}`);
  }
  if (!m.items.length) log(m.notRead.length ? '  nothing found in the repos that answered' : '  no items');
  for (const g of gaps(m)) note(c.yellow(g));
}

// A title in Markdown: every character that could start a link, an image, code or a tag is escaped, and so
// are the triggers of GitHub's automatic links (`https:`, `www.`, an address's `@`).
export const mdEscape = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/([\\`*_{}[\]()<>#|!~&:@])/g, '\\$1').replace(/(?<![a-z0-9])www\./gi, (w) => `${w.slice(0, 3)}\\.`);

export function renderMarkdown(m) {
  const L = ['# Issues and work items', '', `- ${counts(m.summary)}`, `- Closed items since ${m.closedSince}`, '', '| Item | Priority | Type | Status | Assignee | Due | Title | Notes |', '|---|---|---|---|---|---|---|---|'];
  for (const i of m.items) {
    L.push(`| ${i.url ? `[${mdEscape(i.ref)}](${i.url.replace(/[()|]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)})` : mdEscape(i.ref)} | ${i.priority ?? 'none'} | ${i.type ?? 'none'} | ${i.status} | ${mdEscape(who(i))} | ${i.due ?? ''} | ${mdEscape(i.title)} | ${mdEscape(i.flags.join('; '))} |`);
  }
  if (gaps(m).length) L.push('', '## Not read, or incomplete', '', ...gaps(m).map((g) => `- ${mdEscape(g)}`));
  L.push('', `_${FOOTER}_`, '');
  return L.join('\n');
}

const options = (values) => values.map((v) => `<option value="${esc(lower(v))}">${esc(v)}</option>`).join('');

// One self-contained file. The table is written here, escaped, and reads with scripting off. The script only
// hides and re-orders those rows using their data attributes; it never builds markup from an item's text.
export function renderHtml(m) {
  const people = [...new Set(m.items.flatMap((i) => i.assignees.map((a) => a.member || a.login)))].sort();
  const repos = [...new Set(m.items.map((i) => i.repo))].sort();
  const cell = (label, inner, cls = '') => `<td data-label="${label}"${cls ? ` class="${cls}"` : ''}>${inner}</td>`;
  const row = (i) => {
    const members = i.assignees.map((a) => lower(a.member || a.login)).join('\n');
    const num = i.url ? `<a href="${esc(i.url)}" rel="noopener noreferrer">${esc(i.ref)}</a>` : esc(i.ref);
    return `<tr data-priority="${rank(PRIORITIES, i.priority)}" data-p="${esc(lower(i.priority ?? 'none'))}" data-type="${rank(ITEM_TYPES, i.type)}" data-t="${esc(lower(i.type ?? 'none'))}" data-status="${rank(STATUSES, i.status)}" data-s="${esc(i.status)}" data-repo="${esc(lower(i.repo))}" data-members="${esc(members)}" data-created="${esc(i.created ?? '')}" data-updated="${esc(i.updated ?? '')}" data-due="${esc(i.due ?? '')}" data-ref="${esc(i.ref)}">`
      + cell('Item', num, 'ref') + cell('Priority', i.priority ? `<span class="pri pri-${esc(lower(i.priority))}">${esc(i.priority)}</span>` : '<span class="dim">none</span>')
      + cell('Type', i.type ? esc(i.type) : '<span class="dim">none</span>') + cell('Status', `<span class="st st-${rank(STATUSES, i.status)}">${esc(i.status)}</span>`)
      + cell('Title', `${esc(i.title)}${i.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join('')}`, 'title') + cell('Assignee', i.assignees.length ? esc(who(i)) : '<span class="dim">unassigned</span>')
      + cell('Epic', i.epic ? esc(i.epic.id) : '<span class="dim">none</span>') + cell('Created', esc(i.created ?? ''), 'date') + cell('Updated', esc(i.updated ?? ''), 'date') + cell('Due', esc(i.due ?? ''), 'date') + '</tr>';
  };
  const th = (key, label) => `<th scope="col"${key ? ` aria-sort="none"` : ''}>${key ? `<button type="button" data-sort="${key}">${label}</button>` : label}</th>`;
  const select = (id, label, opts) => `<label>${label}<select id="${id}"><option value="">All</option>${opts}</select></label>`;
  const missing = gaps(m);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Issues and work items</title><style>
:root{--bg:#fff;--fg:#1d2026;--dim:#5d6470;--card:#f6f7f9;--line:#e1e4ea;--link:#0b57d0;--warn:#8a4b00;--p0:#b3261e;--p1:#b3541e}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e6e8ee;--dim:#9aa0ad;--card:#181b22;--line:#2b303a;--link:#8ab4f8;--warn:#f0b35a;--p0:#f28b82;--p1:#f6ae74}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:28px 16px}h1{font-size:22px;margin:0 0 4px}.sub{color:var(--dim);margin:0 0 16px}a{color:var(--link)}.dim{color:var(--dim)}
.gaps{border:1px solid var(--line);border-left:4px solid var(--warn);border-radius:6px;padding:10px 14px;margin:0 0 16px}.gaps h2{font-size:14px;margin:0 0 4px}.gaps ul{margin:0;padding-left:18px}
.filters{display:flex;flex-wrap:wrap;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:0 0 12px}
.filters label{display:flex;flex-direction:column;font-size:12px;color:var(--dim);gap:2px}select,input,#reset{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:4px 6px;min-height:32px}#reset{align-self:flex-end;cursor:pointer}
#count{margin:0 0 8px;color:var(--dim)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--dim);white-space:nowrap}th button{all:unset;cursor:pointer}th button:focus-visible{outline:2px solid var(--link)}
[aria-sort=ascending] button::after{content:" ▲"}[aria-sort=descending] button::after{content:" ▼"}td.ref,td.date{white-space:nowrap}td.title{min-width:260px;overflow-wrap:anywhere}
.pri{font-weight:600}.pri-p0{color:var(--p0)}.pri-p1{color:var(--p1)}.st{white-space:nowrap}.st-0{color:var(--dim)}.flag{display:block;color:var(--warn);font-size:12px}
footer{color:var(--dim);font-size:12px;margin-top:20px;border-top:1px solid var(--line);padding-top:10px}
@media (max-width:720px){thead{position:absolute;left:-9999px}tr{display:block;border:1px solid var(--line);border-radius:8px;margin:0 0 10px;padding:6px 10px}td{display:flex;gap:10px;border:0;padding:3px 0}td::before{content:attr(data-label);color:var(--dim);flex:0 0 72px;font-size:12px}td:empty{display:none}td.title{min-width:0;display:block}td.title::before{display:block}}
</style></head><body><div class="wrap"><h1>Issues and work items</h1>
<p class="sub">${esc(counts(m.summary))}. Closed items since ${esc(m.closedSince)}.</p>
${missing.length ? `<section class="gaps"><h2>Not read, or incomplete</h2><ul>${missing.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></section>` : ''}
<form class="filters" id="filters">${select('f-member', 'Member', `<option value="\n">Unassigned</option>${options(people)}`)}${select('f-t', 'Type', `${options(ITEM_TYPES)}<option value="none">None</option>`)}${select('f-p', 'Priority', `${options(PRIORITIES)}<option value="none">None</option>`)}${select('f-s', 'Status', options(STATUSES))}${select('f-repo', 'Repo', options(repos))}
<label>Date<select id="f-date">${DATE_FIELDS.map((d) => `<option value="${d}">${d[0].toUpperCase()}${d.slice(1)}</option>`).join('')}</select></label><label>From<input type="date" id="f-from"></label><label>To<input type="date" id="f-to"></label><button type="reset" id="reset">Clear</button></form>
<p id="count" role="status"></p><table><thead><tr>${th('ref', 'Item')}${th('priority', 'Priority')}${th('type', 'Type')}${th('status', 'Status')}${th('', 'Title')}${th('', 'Assignee')}${th('', 'Epic')}${th('created', 'Created')}${th('updated', 'Updated')}${th('due', 'Due')}</tr></thead>
<tbody id="rows">${m.items.map(row).join('\n')}</tbody></table>${m.items.length ? '' : `<p class="dim">${m.notRead.length ? 'Nothing found in the repos that answered.' : 'No items.'}</p>`}
<footer>${esc(FOOTER)}</footer></div>
<script>${PAGE_SCRIPT}</script></body></html>\n`;
}

// Fixed text: no value from an item is ever part of this script.
const PAGE_SCRIPT = `(function(){var body=document.getElementById('rows'),rows=[].slice.call(body.rows),all=rows.length,$=function(i){return document.getElementById(i)},count=$('count');
function apply(){var m=$('f-member').value,t=$('f-t').value,p=$('f-p').value,s=$('f-s').value,r=$('f-repo').value,d=$('f-date').value,a=$('f-from').value,b=$('f-to').value,n=0;rows.forEach(function(x){var v=x.dataset[d],on=(!t||x.dataset.t===t)&&(!p||x.dataset.p===p)&&(!s||x.dataset.s===s)&&(!r||x.dataset.repo===r)&&(!m||(m==='\\n'?x.dataset.members==='':x.dataset.members.split('\\n').indexOf(m)>=0))&&(!a||(v&&v>=a))&&(!b||(v&&v<=b));x.hidden=!on;if(on)n++});count.textContent='Showing '+n+' of '+all}
var form=$('filters');form.addEventListener('input',apply);form.addEventListener('change',apply);form.addEventListener('reset',function(){setTimeout(apply,0)});form.addEventListener('submit',function(e){e.preventDefault()});
var num={priority:1,type:1,status:1};document.querySelectorAll('[data-sort]').forEach(function(btn){btn.addEventListener('click',function(){var k=btn.dataset.sort,th=btn.parentNode,up=th.getAttribute('aria-sort')!=='ascending';document.querySelectorAll('th[aria-sort]').forEach(function(h){h.setAttribute('aria-sort','none')});th.setAttribute('aria-sort',up?'ascending':'descending');rows.sort(function(x,y){var a=x.dataset[k],b=y.dataset[k];if(!a!==!b)return a?-1:1;var c=num[k]?a-b:a.localeCompare(b,undefined,{numeric:true});return up?c:-c});rows.forEach(function(x){body.appendChild(x)})})});apply()})();`;

// ---- the commands ----------------------------------------------------------------------------------

const LIST_ONLY = new Set(['--priority', '--type', '--status', '--assignee', '--me', '--repo', '--since', '--until', '--date', '--sort', '--closed-since', '--format', '--out', '--json', '--dir']);
const LABEL_FLAGS = new Set(['--dry-run', '--json', '--dir']);
const WORD_FLAGS = new Set(['--json', '--dir']);
export const foreignFlags = (argv, action) => argv.filter((a) => a.startsWith('-') && !(action === 'labels' ? LABEL_FLAGS : action === 'list' ? LIST_ONLY : WORD_FLAGS).has(a.split('=')[0]));

function checkValues(flag, value, allowed) {
  if (!value) return null;
  const bad = list(value).filter((v) => !allowed.map(lower).includes(lower(v)));
  return bad.length ? `unknown ${flag} ${forTerminal(bad.join(', '))} (use ${allowed.join(', ')})` : null;
}

const oneValue = (flag, value, allowed) => (value && !allowed.map(lower).includes(lower(value)) ? `unknown ${flag} ${forTerminal(String(value))} (use one of ${allowed.join(', ')})` : null);
const realDate = (v) => DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

function closedSince(value, now) {
  if (value === null || value === undefined) return { ms: now - DEFAULT_CLOSED_DAYS * DAY };
  const d = String(value).match(/^(\d{1,4})d$/);
  if (d) return { ms: now - Number(d[1]) * DAY };
  if (realDate(value)) return { ms: Date.parse(value) };
  return { error: `--closed-since must be YYYY-MM-DD or <N>d (got ${forTerminal(String(value))})` };
}

// `yad issues [list]`. Returns the model (E1 makes it the `--json` answer), or undefined after refusing.
export async function runIssuesList(root, { priority = null, type = null, status = null, assignee = null, me = false, repo = null, since = null, until = null, date = null, sort = null, closedSince: closed = null, format = null, out = null, json = false, now = Date.now(), env = process.env, runner, loginOf = platformLogin } = {}) {
  const refuse = (msg, hint) => { fail(msg); if (hint) hand(hint); process.exitCode = 1; };
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/product.json here)', 'run it from the Product, or pass --dir');
  if (!format && out) format = /\.html?$/i.test(out) ? 'html' : 'md';
  if (format && !['md', 'html'].includes(format)) return refuse(`unknown --format ${forTerminal(String(format))}`, 'use --format md or --format html (or --json for the data)');
  if (assignee && me) return refuse('pass --assignee <login> or --me, not both');
  for (const bad of [checkValues('--priority', priority, [...PRIORITIES, 'none']), checkValues('--type', type, [...ITEM_TYPES, 'none']), checkValues('--status', status, STATUSES), oneValue('--sort', sort, SORTS), oneValue('--date', date, DATE_FIELDS)]) if (bad) return refuse(bad);
  for (const [flag, v] of [['--since', since], ['--until', until]]) if (v && !realDate(v)) return refuse(`${flag} must be a real date, YYYY-MM-DD (got ${forTerminal(String(v))})`);
  const window = closedSince(closed, now);
  if (window.error) return refuse(window.error);
  const whole = buildIssues(root, { now, closedSinceMs: window.ms, env, ...(runner ? { runner } : {}) });
  let mine = null;
  if (me) {
    mine = new Map();
    for (const r of whole.repos) {
      if (!r.read) continue;
      const key = `${r.platform}\0${r.host}`;
      if (!mine.has(key)) { const l = loginOf(root, r.platform, { env, host: r.host, ...(runner ? { runner } : {}) }); if (l) mine.set(key, l); }
    }
    if (!mine.size && whole.repos.some((r) => r.read)) return refuse('yad cannot tell who you are on these platforms', 'pass --assignee <login>, or log in (gh auth login / glab auth login)');
    for (const r of whole.repos) if (r.read && !mine.has(`${r.platform}\0${r.host}`)) whole.notes.push(`${r.label}: yad cannot tell who you are on ${shown(r.host)}, so its items are left out of --me`);
  }
  // With no readable registry the list of names is incomplete, so a name it lacks proves nothing.
  if (repo && !whole.registryUnread) {
    const known = whole.repos.map((r) => r.label);
    const bad = list(repo).filter((v) => !known.map(lower).includes(lower(v)));
    if (bad.length) return refuse(`no repo named ${forTerminal(bad.join(', '))}`, `use one of: ${known.join(', ')}`);
  }
  const items = applyFilters(whole.items, { priority, type, status, assignee, repo, since, until, date: date ? lower(date) : 'created', sort: sort ? lower(sort) : 'priority', mine });
  const model = { ...whole, items, summary: summarize(items), unfiltered: whole.items.length };
  if (format) {
    const dest = out || `issues-report.${format}`;
    writeReport(dest, format === 'md' ? renderMarkdown(model) : renderHtml(model));
    if (json) note(`wrote ${format.toUpperCase()} report → ${dest}`); else info(`wrote ${format.toUpperCase()} report → ${c.bold(dest)}`);
    for (const g of gaps(model)) if (!json) note(c.yellow(g));
    return { ...model, out: dest };
  }
  if (!json) renderText(model);
  return { ...model, out: null };
}

// Every label name on one repo, lower-cased, or `{ ok:false, why }`.
function readLabels(t, runner) {
  const gh = t.platform === 'github';
  const at = gh ? `repos/${t.repo}/labels?per_page=${PAGE}` : `projects/${encodeURIComponent(t.repo)}/labels?per_page=${PAGE}`;
  const names = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = api(runner, t.cli, t.host, `${at}&page=${page}`);
    if (!res.ok || !Array.isArray(res.body)) return { ok: false, why: whyFailed(res.ok ? { unreadable: true } : res, { platform: t.platform, host: t.host, what: `the labels of ${shown(t.repo)}`, plural: true }) };
    for (const l of res.body) if (typeof l?.name === 'string') names.add(l.name.toLowerCase());
    if (res.body.length < PAGE) return { ok: true, names };
  }
  return { ok: false, why: `${shown(t.repo)} has more labels than yad reads` };
}

function createLabel(t, name, color, runner) {
  const gh = t.platform === 'github';
  const at = gh ? `repos/${t.repo}/labels` : `projects/${encodeURIComponent(t.repo)}/labels`;
  return runner(t.cli, ['api', '--hostname', t.host, '-X', 'POST', at, '-f', `name=${name}`, '-f', `color=${gh ? color : `#${color}`}`], { timeout: TIMEOUT });
}

// `yad issues labels`: add the predefined labels each repo lacks. A label counts as there if ANY accepted
// spelling is (a repo with `P1` is not given `priority: P1`).
export async function runIssuesLabels(root, { dryRun = false, json = false, env = process.env, runner = run } = {}) {
  if (!fs.existsSync(productConfigPath(root))) { fail('not a Product (no .sdlc/product.json here)'); hand('run it from the Product, or pass --dir'); process.exitCode = 1; return undefined; }
  const notes = [];
  const productConfig = readJSON(productConfigPath(root), null);
  const rules = labelRules(productConfig, notes);
  const identity = productIdentity(root, { productConfig, runner });
  const notRead = [];
  const sources = repoSources(root, identity, productConfig, notRead, env, { localPaths: false });
  const authCache = new Map();
  const seen = new Set();
  const repos = [];
  for (const s of sources) {
    const t = prTarget({ platform: s.platform, gitUrl: s.gitUrl }, { env, authCache, runner });
    const key = t.host && t.repo ? `${t.host}/${t.repo}`.toLowerCase() : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    if (!t.ok) { repos.push({ label: s.label, read: false, why: t.why, created: [], failed: [], missing: [] }); continue; }
    const have = readLabels(t, runner);
    if (!have.ok) { repos.push({ label: s.label, read: false, why: have.why, created: [], failed: [], missing: [] }); continue; }
    const missing = Object.entries(rules).flatMap(([kind, table]) => Object.values(table).filter((names) => !names.some((n) => have.names.has(n.toLowerCase()))).map((names) => ({ name: names[0], color: LABEL_COLOR[kind] })));
    const created = [];
    const failed = [];
    if (!dryRun) for (const l of missing) (createLabel(t, l.name, l.color, runner).ok ? created : failed).push(l.name);
    repos.push({ label: s.label, read: true, why: null, created, failed, missing: missing.map((l) => l.name) });
  }
  if (!json) {
    for (const r of repos) {
      if (!r.read) note(c.yellow(`${r.label}: not read — ${r.why}`));
      else if (!r.missing.length) info(`${r.label}: every label is there`);
      else if (dryRun) info(`${r.label}: would create ${r.missing.join(', ')}`);
      else { if (r.created.length) info(`${r.label}: created ${r.created.join(', ')}`); if (r.failed.length) note(c.yellow(`${r.label}: could not create ${r.failed.join(', ')} (your login may not be allowed to)`)); }
    }
    for (const n of [...notRead, ...notes]) note(c.yellow(n));
  }
  if (notRead.length || repos.some((r) => !r.read || r.failed.length)) process.exitCode = 1;
  return { dryRun, repos, notRead, notes };
}
