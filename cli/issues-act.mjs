// E173 — the agent acts on an issue or work item when an engineer asks: open one for an idea, assign it,
// set its priority or type, edit it, comment, close or reopen it. The request is the permission: the agent
// does it, then reports what changed with the link. It never does any of this on its own initiative.
//
// A new item goes to the Product repo unless the engineer names a registered repo. Every write is checked
// against what the platform answers, so a dropped label, assignee or state is reported, never hidden. A
// security item is never opened where it would announce the hole: on GitHub only a repo known to be private
// takes one, and on GitLab it is confidential. The text is the engineer's, so mentions and links stay, but
// anything shaped like a token is redacted.
import fs from 'node:fs';
import { run, forTerminal, c, log, fail, hand, info, warn, emitJSON } from './lib.mjs';
import { addItemLabels, removeItemLabels, commentOnItem, closeItem, newItem, editItem, reopenItem, setAssignee, platformLogin } from './platform.mjs';
import { api, httpStatus } from './protection.mjs';
import { labelRules, ITEM_TYPES, PRIORITIES } from './issues.mjs';
import { readItem, resolveTarget } from './issues-write.mjs';
import { allLinks, itemKey } from './issue-links.mjs';
import { redact, repoFacts, routeFor } from './scan.mjs';

const MAX_TITLE = 256;
const MAX_BODY = 60000;
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const oneLine = (v) => forTerminal(redact(String(v ?? ''))).replace(/\s+/g, ' ').trim();
const lines = (v) => redact(String(v ?? '')).split(/\r?\n/).map((l) => forTerminal(l)).join('\n');

class Refused extends Error {
  constructor(message, hint = null) { super(message); this.hint = hint; }
}
const refusedOut = (json, e) => {
  process.exitCode = 1;
  if (json) return emitJSON({ ok: false, error: e.message, hint: e.hint });
  fail(e.message); if (e.hint) hand(e.hint);
  return undefined;
};

function titleOf(v) {
  // The length is judged on what was written: redaction can shrink a long run to `[redacted]`.
  if (String(v ?? '').trim().length > MAX_TITLE) throw new Refused(`the title is longer than ${MAX_TITLE} characters`);
  const t = oneLine(v);
  if (!t) throw new Refused('a title is needed', 'pass --title "<one line>"');
  if (t.length > MAX_TITLE) throw new Refused(`the title is longer than ${MAX_TITLE} characters`);
  return t;
}

// The body from `--body` (one line) or `--body-file` (written by the agent outside the repo). Null if neither.
function bodyOf({ body, bodyFile }) {
  if (body != null && bodyFile != null) throw new Refused('pass --body or --body-file, not both');
  if (bodyFile != null) {
    let raw;
    try { raw = fs.readFileSync(bodyFile, 'utf8'); } catch { throw new Refused('the --body-file could not be read'); }
    if (raw.length > MAX_BODY) throw new Refused(`the body is longer than ${MAX_BODY} characters`);
    const t = lines(raw);
    if (t.length > MAX_BODY) throw new Refused(`the body is longer than ${MAX_BODY} characters`);
    return t;
  }
  return body != null ? lines(body) : null;
}

// The repo: the Product unless a registered one is named. `ref` resolution does the registry and login checks.
function targetOf(root, repo, { env, runner }) {
  const r = resolveTarget(root, repo && repo !== 'Product' ? `${repo}#1` : '1', { env, runner });
  if (!r.ok) throw new Refused(r.why, r.hint);
  if (!r.t.ok) throw new Refused(`${forTerminal(r.label)}: ${r.t.why}`);
  return { t: r.t, label: r.label, productConfig: r.productConfig };
}

function itemOf(root, ref, { env, runner }) {
  const r = resolveTarget(root, ref, { env, runner });
  if (!r.ok) throw new Refused(r.why, r.hint);
  if (!r.t.ok) throw new Refused(`${forTerminal(r.label)}: ${r.t.why}`);
  const item = readItem(r.t, r.number, { runner });
  if (!item.ok) throw new Refused(item.why);
  return { ...r, item, ref: `${r.label === 'Product' ? '' : r.label}#${r.number}` };
}

// The login to assign: a name the engineer gave, or their own (`--me`).
function loginOf(root, t, { assignee, me, env, runner }) {
  if (me) {
    const l = platformLogin(root, t.platform, { host: t.host, runner, env });
    if (!l) throw new Refused('your login on this platform could not be read', 'pass the login instead of --me');
    return l;
  }
  if (!LOGIN.test(String(assignee ?? ''))) throw new Refused(`"${forTerminal(String(assignee ?? ''))}" is not a login`);
  return assignee;
}

// GitLab assigns by user id. Exactly one user must have the login.
function gitlabUserId(t, login, runner) {
  const res = api(runner, 'glab', t.host, `users?username=${encodeURIComponent(login)}`);
  if (!res.ok || !Array.isArray(res.body)) throw new Refused(`the user ${forTerminal(login)} could not be looked up on ${t.host}`);
  if (res.body.length !== 1 || !Number.isInteger(res.body[0]?.id)) throw new Refused(`${t.host} has no user ${forTerminal(login)}`);
  return res.body[0].id;
}

const why = (t, r) => (httpStatus(r) ? `${t.host} answered HTTP ${httpStatus(r)}` : forTerminal(String(r.stderr || 'the platform refused it')).replace(/\s+/g, ' ').slice(0, 200));

function report(out, json) {
  if (out.dropped.length) { out.ok = false; process.exitCode = 1; }
  if (json) return out;
  if (out.changed.length) log(`  ${c.bold(forTerminal(out.ref))} ${out.changed.map(forTerminal).join('; ')}${out.url ? ` ${out.url}` : ''}`);
  for (const n of out.notes) info(n);
  for (const d of out.dropped) warn(`not as asked: ${forTerminal(d)}`);
  return undefined;
}
const answer = (ref, url) => ({ ok: true, ref, url: url ?? null, changed: [], dropped: [], notes: [] });

// ---- yad issues new --------------------------------------------------------------------------------

export async function runIssuesNew(root, { title, body = null, bodyFile = null, type = null, priority = null, assignee = null, me = false, repo = null, json = false, env = process.env, runner = run } = {}) {
  try {
    const t0 = titleOf(title);
    const text = bodyOf({ body, bodyFile }) ?? '';
    if (type !== null && !ITEM_TYPES.includes(type)) throw new Refused(`unknown --type ${forTerminal(String(type))}`, `use one of ${ITEM_TYPES.join(', ')}`);
    if (priority !== null && !PRIORITIES.includes(priority)) throw new Refused(`unknown --priority ${forTerminal(String(priority))}`, `use one of ${PRIORITIES.join(', ')}`);
    if (assignee !== null && me) throw new Refused('pass --assignee or --me, not both');
    const { t, label, productConfig } = targetOf(root, repo, { env, runner });
    const rules = labelRules(productConfig);
    // A vulnerability written in the open announces it before it is fixed.
    let confidential = false;
    if (type === 'security') {
      if (t.platform === 'gitlab') confidential = true;
      else if (routeFor('security', 'github', repoFacts(t, runner).vis) !== 'issue') {
        throw new Refused(`${forTerminal(label)} is not known to be a private repo, so a security item there would be public`, 'open a private security advisory on GitHub instead, or file it in a private repo');
      }
    }
    const login = assignee !== null || me ? loginOf(root, t, { assignee, me, env, runner }) : null;
    const who = login && t.platform === 'gitlab' ? gitlabUserId(t, login, runner) : login;
    const labels = [...(type ? [rules.type[type][0]] : []), ...(priority ? [rules.priority[priority][0]] : [])];
    const r = newItem(t, { title: t0, body: text, labels, assignee: who, confidential }, { runner });
    if (!r.ok) throw new Refused(`the item was not created: ${why(t, r)}`);
    let b = {};
    try { b = JSON.parse(r.stdout); } catch { /* checked below */ }
    const number = t.platform === 'github' ? b.number : b.iid;
    const out = answer(`${label === 'Product' ? '' : label}#${number ?? '?'}`, b.html_url ?? b.web_url);
    out.changed.push(`opened in ${label}${labels.length ? ` with ${labels.join(', ')}` : ''}${login ? `, assigned to ${login}` : ''}`);
    const got = (Array.isArray(b.labels) ? b.labels : []).map((l) => String(typeof l === 'string' ? l : l?.name).toLowerCase());
    for (const l of labels) if (!got.includes(l.toLowerCase())) out.dropped.push(`the label ${l} was not set`);
    const logins = (Array.isArray(b.assignees) ? b.assignees : []).map((a) => String(a?.login ?? a?.username ?? '').toLowerCase());
    if (login && !logins.includes(login.toLowerCase())) out.dropped.push(`${login} was not assigned`);
    if (confidential && b.confidential !== true) out.dropped.push('it was NOT made confidential: restrict it now');
    if (!Number.isInteger(number)) out.dropped.push('the answer named no item number');
    return report(out, json);
  } catch (e) {
    if (e instanceof Refused) return refusedOut(json, e);
    throw e;
  }
}

// ---- changing an item ------------------------------------------------------------------------------

// Read, write, read again: what the platform shows afterwards is what is reported.
async function act(root, ref, { json, env, runner }, fn) {
  try {
    const got = itemOf(root, ref, { env, runner });
    const out = answer(got.ref, got.item.url);
    const r = await fn(got, out);
    if (r && !r.ok) throw new Refused(`nothing was changed: ${why(got.t, r)}`);
    return report(out, json);
  } catch (e) {
    if (e instanceof Refused) return refusedOut(json, e);
    throw e;
  }
}

const reread = (got, runner) => { const r = readItem(got.t, got.number, { runner }); return r.ok ? r : null; };

export async function runIssuesAssign(root, { ref, assignee = null, me = false, none = false, json = false, env = process.env, runner = run } = {}) {
  return act(root, ref, { json, env, runner }, async (got, out) => {
    if ([assignee !== null, me, none].filter(Boolean).length !== 1) throw new Refused('name one: a login, --me or --none');
    const login = none ? null : loginOf(root, got.t, { assignee, me, env, runner });
    const who = login && got.t.platform === 'gitlab' ? gitlabUserId(got.t, login, runner) : login;
    const r = setAssignee(got.t, got.number, who, { current: got.item.logins, runner });
    if (!r.ok) return r;
    out.changed.push(login ? `assigned to ${login}` : 'unassigned');
    const after = reread(got, runner);
    if (!after) out.notes.push('the item could not be read again to check the change');
    else if (login ? !after.logins.map((l) => l.toLowerCase()).includes(login.toLowerCase()) : after.logins.length) out.dropped.push(login ? `${login} was not assigned` : 'someone is still assigned');
    return null;
  });
}

export async function runIssuesLabel(root, { ref, priority = null, type = null, json = false, env = process.env, runner = run } = {}) {
  return act(root, ref, { json, env, runner }, async (got, out) => {
    if (priority === null && type === null) throw new Refused('pass --priority, --type or both');
    if (priority !== null && !PRIORITIES.includes(priority)) throw new Refused(`unknown --priority ${forTerminal(String(priority))}`, `use one of ${PRIORITIES.join(', ')}`);
    if (type !== null && !ITEM_TYPES.includes(type)) throw new Refused(`unknown --type ${forTerminal(String(type))}`, `use one of ${ITEM_TYPES.join(', ')}`);
    if (type === 'security' && got.t.platform === 'github' && !got.item.confidential && routeFor('security', 'github', repoFacts(got.t, runner).vis) !== 'issue') {
      throw new Refused('this repo is not known to be private, so a security label would mark a public item as a vulnerability', 'move the report to a private security advisory instead');
    }
    // A confidential item's labels are not read, so the old ones could not be removed.
    if (got.item.confidential) throw new Refused('a confidential item\'s labels are not read, so they cannot be replaced here', 'change them on GitLab');
    const rules = labelRules(got.productConfig);
    const have = new Set(got.item.labels.map((l) => l.toLowerCase()));
    const add = [];
    const remove = [];
    for (const [kind, value] of [['priority', priority], ['type', type]]) {
      if (value === null) continue;
      const want = rules[kind][value][0];
      if (!rules[kind][value].some((l) => have.has(l.toLowerCase()))) add.push(want);
      for (const [other, names] of Object.entries(rules[kind])) if (other !== value) remove.push(...names.filter((l) => have.has(l.toLowerCase())));
    }
    const realNames = new Map(got.item.labels.map((l) => [l.toLowerCase(), l]));
    const stale = remove.map((l) => realNames.get(l.toLowerCase()) ?? l);
    if (!add.length && !stale.length) { out.notes.push('it already has those labels'); return null; }
    if (add.length) { const r = addItemLabels(got.t, got.number, add, { runner }); if (!r.ok) return r; out.changed.push(`labels +${add.join(', +')}`); }
    if (stale.length) { const r = removeItemLabels(got.t, got.number, stale, { runner }); if (r.ok) out.changed.push(`labels -${stale.join(', -')}`); else out.dropped.push(`the old labels ${stale.join(', ')} were not removed`); }
    const after = reread(got, runner);
    if (!after) out.notes.push('the item could not be read again to check the change');
    else {
      const now = new Set(after.labels.map((l) => l.toLowerCase()));
      for (const l of add) if (!now.has(l.toLowerCase())) out.dropped.push(`the label ${l} was not set`);
    }
    return null;
  });
}

export async function runIssuesEdit(root, { ref, title = null, body = null, bodyFile = null, json = false, env = process.env, runner = run } = {}) {
  return act(root, ref, { json, env, runner }, async (got, out) => {
    const fields = {};
    if (title !== null) fields.title = titleOf(title);
    const text = bodyOf({ body, bodyFile });
    if (text !== null) fields.body = text;
    if (!Object.keys(fields).length) throw new Refused('pass --title, --body or --body-file');
    const r = editItem(got.t, got.number, fields, { runner });
    if (!r.ok) return r;
    out.changed.push(`edited the ${Object.keys(fields).join(' and ')}`);
    if (fields.title && !got.item.confidential) {
      const after = reread(got, runner);
      if (after && after.title !== fields.title) out.dropped.push('the title is not the one sent');
    }
    return null;
  });
}

export async function runIssuesComment(root, { ref, body = null, bodyFile = null, json = false, env = process.env, runner = run } = {}) {
  return act(root, ref, { json, env, runner }, async (got, out) => {
    const text = bodyOf({ body, bodyFile });
    if (!text || !text.trim()) throw new Refused('the comment is empty', 'pass --body "<text>" or --body-file <file>');
    const r = commentOnItem(got.t, got.number, text, { runner });
    if (!r.ok) return r;
    out.changed.push('commented');
    return null;
  });
}

// The epics an item is linked to, for the note a close or reopen adds.
function linkedEpics(root, got) {
  try { return allLinks(root).byItem.get(itemKey({ host: got.t.host, repo: got.t.repo, number: got.number })) ?? []; } catch { return []; }
}

export async function runIssuesClose(root, { ref, json = false, env = process.env, runner = run } = {}) {
  return act(root, ref, { json, env, runner }, async (got, out) => {
    if (got.item.state === 'closed') { out.notes.push('it is already closed'); return null; }
    const r = closeItem(got.t, got.number, { runner });
    if (!r.ok) return r;
    out.changed.push('closed');
    const epics = linkedEpics(root, got);
    if (epics.length) out.notes.push(`it is linked to ${epics.join(', ')}; its status shows done from now on`);
    const after = reread(got, runner);
    if (after && after.state !== 'closed') out.dropped.push('it is still open');
    return null;
  });
}

export async function runIssuesReopen(root, { ref, json = false, env = process.env, runner = run } = {}) {
  return act(root, ref, { json, env, runner }, async (got, out) => {
    if (got.item.state === 'open') { out.notes.push('it is already open'); return null; }
    const r = reopenItem(got.t, got.number, { runner });
    if (!r.ok) return r;
    out.changed.push('reopened');
    if (linkedEpics(root, got).length) out.notes.push('`yad issues sync` will not close it again: a reopened item is the team\'s call');
    const after = reread(got, runner);
    if (after && after.state !== 'open') out.dropped.push('it is still closed');
    return null;
  });
}

const ACT_FLAGS = {
  new: ['--title', '--body', '--body-file', '--type', '--priority', '--assignee', '--me', '--repo'],
  assign: ['--me', '--none'],
  label: ['--priority', '--type'],
  edit: ['--title', '--body', '--body-file'],
  comment: ['--body', '--body-file'],
  close: [], reopen: [],
};
export const ACT_ACTIONS = Object.keys(ACT_FLAGS);
export const actForeignFlags = (argv, action) => argv.filter((a) => a.startsWith('-') && ![...ACT_FLAGS[action], '--json', '--dir'].includes(a.split('=')[0]));
