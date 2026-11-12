// E170 — an issue or work item seeds and links an epic, and the link is written back to the item.
//   `yad issues show <ref>`     the full item, for a skill to read. Title and body are marked untrusted.
//   `yad issues link|unlink`    the sidecar, and the comment and labels on the item.
//   `yad epic new --issue`      the item's type label sets the epic type; a defect or change finds its parent
//                               from a definite link, or gets a stub parent. It never guesses from wording.
// The item must be read before anything is created. A failed write-back leaves the link in place and says so.
import fs from 'node:fs';
import path from 'node:path';
import { run, readJSON, forTerminal, c, log, fail, hand, info, ok as said, warn, emitJSON } from './lib.mjs';
import { epicFiles, isVerifiedLedger, productConfigPath } from './manifest.mjs';
import { epicIds, epicRoot, isGenesisType, isValidEpicId, PRODUCT_EPICS, WORK_ITEM_TYPES } from './epic-state.mjs';
import { addItemLabels, closeItem, commentOnItem, removeItemLabels } from './platform.mjs';
import { productIdentity } from './members.mjs';
import { prTarget } from './pr-list.mjs';
import { repoSources } from './standup.mjs';
import { api, shown, whyFailed, httpStatus, TIMEOUT } from './protection.mjs';
import { labelRules, pick, pickType, itemStatus, otherLabels } from './issues.mjs';
import { runEpicNew, epicIdFrom } from './epic.mjs';
import { allLinks, combinedStage, epicStage, itemKey, readLinks, writeLinks } from './issue-links.mjs';

export { closeItem };

const clean = (v) => forTerminal(String(v ?? '')).replace(/\s+/g, ' ').trim();
// A body keeps its lines; everything else `forTerminal` removes is removed from each one.
const cleanBody = (v) => String(v ?? '').split(/\r?\n/).map((l) => forTerminal(l)).join('\n');
const httpUrl = (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
const NO_FIELD = /doesn't exist on type|Field '[^']+' doesn't exist/i;

const ITEM_TO_EPIC = { bug: 'defect', feature: 'feature', enhancement: 'change', security: 'defect', 'tech-debt': 'change', suggestion: 'change' };
const EPIC_TO_ITEM = { defect: 'bug', hotfix: 'bug', feature: 'feature', change: 'enhancement' };

// `12`, `#12` (the Product repo) or `<repo>#12`. A bare `#12` is a shell comment unless quoted, so `12` works too.
export function parseRef(ref) {
  const m = /^(?:(.*[^#])#|#)?(\d{1,10})$/.exec(String(ref ?? '').trim());
  return m ? { label: m[1] ?? 'Product', number: Number(m[2]) } : null;
}

export function resolveTarget(root, ref, { env, runner, authCache = new Map() }) {
  const parsed = parseRef(ref);
  if (!parsed || parsed.number < 1) return { ok: false, why: `"${forTerminal(String(ref ?? ''))}" is not an item reference`, hint: 'use 12, "#12" for the Product repo, or <repo>#12' };
  const productConfig = readJSON(productConfigPath(root), null);
  const identity = productIdentity(root, { productConfig, runner });
  const notRead = [];
  const sources = repoSources(root, identity, productConfig, notRead, env, { localPaths: false });
  const s = sources.find((x) => x.label === parsed.label);
  if (!s) return { ok: false, why: notRead.length ? `the repo list could not be read, so ${forTerminal(parsed.label)} is unknown` : `no registered repo is called ${forTerminal(parsed.label)}`, hint: `known: ${sources.map((x) => x.label).join(', ')}` };
  const t = prTarget({ platform: s.platform, gitUrl: s.gitUrl }, { env, authCache, runner });
  return { ok: true, t, label: s.label, number: parsed.number, productConfig };
}

// The parent item, from the platform's own hierarchy. `{ parent: {repo,number}|null }`, or `{ unknown:true }`.
// A server too old to have the field has no hierarchy at all: that is a real "none".
function readParent(t, number, runner) {
  const gh = t.platform === 'github';
  const [owner, name] = t.repo.split('/');
  const args = gh
    ? ['api', '--hostname', t.host, 'graphql', '-f', 'query=query($o:String!,$n:String!,$i:Int!){repository(owner:$o,name:$n){issue(number:$i){parent{number repository{nameWithOwner}}}}}', '-f', `o=${owner}`, '-f', `n=${name}`, '-F', `i=${number}`]
    : ['api', '--hostname', t.host, 'graphql', '-f', `query=query($p:ID!){project(fullPath:$p){workItems(iids:["${number}"]){nodes{widgets{... on WorkItemWidgetHierarchy{parent{iid namespace{fullPath}}}}}}}}`, '-f', `p=${t.repo}`];
  const r = runner(t.cli, args, { timeout: TIMEOUT });
  if (NO_FIELD.test(`${r.stdout || ''}${r.stderr || ''}`)) return { parent: null };
  if (!r.ok) return { unknown: true };
  let d;
  try { d = JSON.parse(r.stdout)?.data; } catch { return { unknown: true }; }
  if (gh) {
    const issue = d?.repository?.issue;
    if (!issue) return { unknown: true };
    return { parent: issue.parent?.number ? { repo: issue.parent.repository?.nameWithOwner ?? t.repo, number: issue.parent.number } : null };
  }
  const node = d?.project?.workItems?.nodes?.[0];
  if (!node) return { unknown: true };
  const p = (node.widgets || []).find((w) => w && w.parent)?.parent;
  return { parent: p?.iid ? { repo: p.namespace?.fullPath ?? t.repo, number: Number(p.iid) } : null };
}

// One item, in one shape, or `{ ok:false, why }`. A pull request is not an item.
export function readItem(t, number, { runner = run } = {}) {
  const gh = t.platform === 'github';
  const at = gh ? `repos/${t.repo}/issues/${number}` : `projects/${encodeURIComponent(t.repo)}/issues/${number}`;
  const res = api(runner, t.cli, t.host, at);
  const what = `item ${number} of ${shown(t.repo)}`;
  if (!res.ok || !res.body || typeof res.body !== 'object') return { ok: false, why: res.ok || res.status !== 404 ? whyFailed(res.ok ? { unreadable: true } : res, { platform: t.platform, host: t.host, what }) : `${what} does not exist, or your login cannot see it` };
  const n = res.body;
  if (gh && n.pull_request) return { ok: false, why: `${number} in ${shown(t.repo)} is a pull request, not an issue` };
  const confidential = n.confidential === true;
  // A confidential item's labels and text drive nothing: not the type, not the parent, not a message.
  const labels = confidential ? [] : (Array.isArray(n.labels) ? n.labels : []).map((l) => clean(typeof l === 'string' ? l : l?.name)).filter(Boolean);
  const logins = (Array.isArray(n.assignees) ? n.assignees : []).map((a) => clean(gh ? a?.login : a?.username)).filter(Boolean);
  return { ok: true, number, confidential, labels, logins, rawText: confidential ? '' : `${n.title ?? ''}\n${(gh ? n.body : n.description) ?? ''}`,
    title: confidential ? null : clean(n.title), body: confidential ? null : cleanBody(gh ? n.body : n.description),
    url: httpUrl(gh ? n.html_url : n.web_url), state: (n.state === 'closed') ? 'closed' : 'open', kind: !gh && ['issue', 'task', 'incident', 'test_case'].includes(n.issue_type) ? n.issue_type : 'issue' };
}

const bailer = (json) => (message, hint) => {
  if (json) emitJSON({ ok: false, error: message, hint: hint ?? null });
  else { fail(message); if (hint) hand(hint); }
  process.exitCode = 1;
};

function loadItem(root, ref, { env, runner, bail }) {
  const r = resolveTarget(root, ref, { env, runner });
  if (!r.ok) return void bail(r.why, r.hint);
  if (!r.t.ok) return void bail(`${forTerminal(r.label)}: ${r.t.why}`);
  const item = readItem(r.t, r.number, { runner });
  if (!item.ok) return void bail(item.why);
  return { ...r, item };
}

export async function runIssuesShow(root, { ref, json = false, env = process.env, runner = run } = {}) {
  const bail = bailer(json);
  const got = loadItem(root, ref, { env, runner, bail });
  if (!got) return undefined;
  const { item, t, label, productConfig } = got;
  const rules = labelRules(productConfig);
  const out = { ref: `${label === 'Product' ? '' : label}#${item.number}`, repo: label, platform: t.platform, host: t.host, number: item.number, url: item.url, state: item.state, kind: item.kind,
    priority: item.confidential ? null : pick(item.labels, rules.priority).value, type: item.confidential ? null : pickType(item.labels, rules.type).value,
    labels: item.confidential ? [] : item.labels, assignees: item.logins, confidential: item.confidential, title: item.title, body: item.body, untrusted: true, untrustedFields: ['title', 'body', 'labels'] };
  if (json) return emitJSON({ ok: true, ...out });
  log(`${c.bold(out.ref)} ${out.title ?? '(confidential: open it on GitLab to read it)'}`);
  info(`${out.state} · priority ${out.priority ?? 'none'} · type ${out.type ?? 'none'} · assigned ${out.assignees.join(', ') || 'nobody'}`);
  // #514: the labels that are none of yad's own. Each was made safe to print when it was read.
  const others = otherLabels(out.labels, rules);
  if (others.length) info(`labels ${others.join(', ')}`);
  if (out.url) info(out.url);
  if (out.body) log(`\n${out.body}`);
  return undefined;
}

// Null when a linked epic cannot be read: a label yad cannot stand behind is not written.
const statusFor = (root, epics, state) => {
  if (state === 'closed') return 'done'; // closed is done, whatever the epic says
  const stage = combinedStage(epics.map((e) => epicStage(root, e)));
  return stage === null ? null : itemStatus(state, stage).status;
};

// Put the comment and labels on the item. Never throws, and returns what failed; the link is kept either way.
export function writeBack(root, epic, entry, t, { item, rules, epicType, runner = run, epics = [epic], unreadable = [], dryRun = false }) {
  const failed = [];
  const failedWhy = (what, r) => { const code = httpStatus(r); failed.push(`${what}: ${code ? `${t.host} answered HTTP ${code}` : clean(r.stderr || 'the write failed').slice(0, 200)}`); };
  const out = { commented: false, labelled: [], removed: [], failed, notes: [] };
  if (!entry.commentedAt && dryRun) out.commented = true;
  else if (!entry.commentedAt) {
    const r = commentOnItem(t, entry.number, `Linked to yadflow epic \`${epic}\`${epicType ? ` (type: ${epicType})` : ''}.`, { runner });
    if (r.ok) { entry.commentedAt = new Date().toISOString(); out.commented = true; } else failedWhy('the comment', r);
  }
  if (item.confidential) { out.notes.push('a confidential item is left unlabelled, because its labels are not read'); return out; }
  const have = new Set(item.labels.map((l) => l.toLowerCase()));
  const add = [];
  const typeOf = EPIC_TO_ITEM[epicType];
  // Only an item with no type label gets one: a second would make the item's type ambiguous.
  if (typeOf && !pickType(item.labels, rules.type).value) add.push(rules.type[typeOf][0]);
  const status = statusFor(root, epics, item.state);
  const linksUnknown = item.state !== 'closed' && unreadable.length > 0;
  if (linksUnknown) failed.push(`the status label: the item links of ${unreadable.join(', ')} could not be read (.sdlc/issue-links.json), so this item's epics are unknown`);
  else if (status === null) failed.push('the status label: a linked epic could not be read, so the status is unknown');
  const known = status !== null && !linksUnknown;
  if (known && !have.has(rules.status[status][0].toLowerCase())) add.push(rules.status[status][0]);
  const stale = known ? Object.entries(rules.status).filter(([s]) => s !== status).flatMap(([, names]) => names).filter((l) => have.has(l.toLowerCase())) : [];
  if (dryRun) { out.labelled = add; out.removed = stale; return out; }
  if (add.length) { const r = addItemLabels(t, entry.number, add, { runner }); if (r.ok) out.labelled = add; else failedWhy(`the labels ${add.join(', ')}`, r); }
  if (stale.length) { if (removeItemLabels(t, entry.number, stale, { runner }).ok) out.removed = stale; else failed.push('the old status label could not be removed'); }
  return out;
}

function makeEntry(t, item, now) {
  return { platform: t.platform, host: t.host, repo: t.repo, number: item.number, url: item.url, linkedAt: new Date(now).toISOString() };
}

// Add the link (or find the one there) and write back. `{ entry, created, back }`.
export function linkAndWriteBack(root, epic, t, item, { rules, epicType, now, runner }) {
  const items = readLinks(root, epic);
  const key = itemKey({ host: t.host, repo: t.repo, number: item.number });
  let entry = items.find((l) => itemKey(l) === key);
  const created = !entry;
  if (created) { entry = makeEntry(t, item, now); items.push(entry); writeLinks(root, epic, items); }
  const every = allLinks(root);
  const back = writeBack(root, epic, entry, t, { item, rules, epicType, runner, epics: every.byItem.get(key) || [epic], unreadable: every.unreadable });
  writeLinks(root, epic, items);
  return { entry, created, back };
}

function sayBack(back) {
  if (back.commented) info('commented on the item');
  if (back.labelled.length) info(`labels added: ${back.labelled.map(forTerminal).join(', ')}`);
  for (const n of back.notes) info(forTerminal(n));
  for (const f of back.failed) warn(`not written to the item — ${forTerminal(f)}. The link is kept${/^the labels/.test(f) ? '; `yad issues labels` creates missing labels' : ''}`);
}

const SEED_FLAGS = new Set(['--issue', '--type', '--profile', '--stub', '--parent', '--inherits', '--json', '--dir']);
// `epic new --issue` writes to a platform, so a flag it does not use (`--repo`, `--dry-run`) is refused, not dropped.
export const seedForeignFlags = (argv) => argv.filter((a) => a.startsWith('-') && !SEED_FLAGS.has(a.split('=')[0]));

// A leftover approvals.json the child's seed would refuse: records in it, or one that does not parse.
const hasApprovals = (p) => { if (!fs.existsSync(p)) return false; try { const a = JSON.parse(fs.readFileSync(p, 'utf8')); return !Array.isArray(a) || a.length > 0; } catch { return true; } };

// Whether a person ever reopened the item: true, false, or null when the history could not all be read.
function everReopened(t, number, runner) {
  const gh = t.platform === 'github';
  const at = gh ? `repos/${t.repo}/issues/${number}/events?per_page=100` : `projects/${encodeURIComponent(t.repo)}/issues/${number}/resource_state_events?per_page=100`;
  for (let page = 1; page <= 10; page++) {
    const res = api(runner, t.cli, t.host, `${at}&page=${page}`);
    if (!res.ok || !Array.isArray(res.body)) return null;
    if (res.body.some((e) => (gh ? e?.event === 'reopened' : e?.state === 'reopened'))) return true;
    if (res.body.length < 100) return false;
  }
  return null;
}

// ---- sync (E171) -------------------------------------------------------------------------------------

// The repos yad may write to, as Map(host/repo → target). The links file is committed, so anyone with a PR could
// point it at another repo: an item is only ever written if its repo is registered here.
function registeredTargets(root, { env, runner }) {
  const productConfig = readJSON(productConfigPath(root), null);
  const identity = productIdentity(root, { productConfig, runner });
  const notRead = [];
  const sources = repoSources(root, identity, productConfig, notRead, env, { localPaths: false });
  const authCache = new Map();
  const targets = new Map();
  for (const s of sources) {
    const t = prTarget({ platform: s.platform, gitUrl: s.gitUrl }, { env, authCache, runner });
    if (t.host && t.repo) targets.set(`${t.host}/${t.repo}`.toLowerCase(), { ...t, label: s.label });
  }
  return { targets, productConfig, registryUnread: notRead.length > 0 };
}

// Bring each linked item up to date. `only` limits it to one epic's items. Returns the plan of what happened.
// How a changed record reaches the team (#512): `commit <file>` and, on a verified Product, the PR route. The
// Product's pr-title and pr-template checks let a PR of these records alone (issue-links files, the roadmap-items
// file, step owner files) through from any branch, and a review/EP-* branch would advance a step. The gates run
// the default branch's copy of the checks (#426), so that holds once a `yad update` carrying them has merged.
// Like `yad assign` (owners.mjs): with no verified Product there are no Product checks to name.
export function recordRoute(root, file) {
  if (!isVerifiedLedger(readJSON(productConfigPath(root), null))) return `commit ${file}`;
  return `commit ${file} on a branch of its own, not review/…, in a PR titled like \`chore: record tracker links\` — the Product checks let a PR of these records alone through, once a \`yad update\` that carries them has merged on the default branch`;
}

export function syncItems(root, { only = null, dryRun = false, close = true, env = process.env, runner = run, now = Date.now() } = {}) {
  const links = allLinks(root);
  const epicsOf = (key) => links.byItem.get(key) || [];
  const scope = new Set();
  const entriesByEpic = new Map();
  for (const epic of new Set([...links.byItem.values()].flat())) {
    const items = readLinks(root, epic);
    entriesByEpic.set(epic, items);
    if (only === null || epic === only) for (const l of items) scope.add(itemKey(l));
  }
  const out = { items: [], unreadable: links.unreadable, skipped: [], dryRun };
  if (!scope.size) return out;
  const { targets, productConfig, registryUnread } = registeredTargets(root, { env, runner });
  const rules = labelRules(productConfig);
  const touched = new Set();
  for (const key of scope) {
    const epics = epicsOf(key);
    const entries = epics.map((epic) => ({ epic, entry: entriesByEpic.get(epic).find((l) => itemKey(l) === key) }));
    const first = entries[0].entry;
    const t = targets.get(`${first.host}/${first.repo}`.toLowerCase());
    const shownRef = `${forTerminal(first.repo)}#${first.number}`;
    if (!t) { out.skipped.push(`${shownRef}: ${registryUnread ? 'the repo list could not be read' : 'its repo is not registered in this Product'}, so it was not written`); continue; }
    if (!t.ok) { out.items.push({ ref: shownRef, epics, commented: false, labelled: [], removed: [], closed: false, failed: [t.why], notes: [] }); continue; }
    const item = readItem(t, first.number, { runner });
    if (!item.ok) { out.items.push({ ref: shownRef, epics, commented: false, labelled: [], removed: [], closed: false, failed: [item.why], notes: [] }); continue; }
    const row = { ref: shownRef, epics, commented: false, labelled: [], removed: [], closed: false, failed: [], notes: [] };
    for (const { epic, entry } of entries) {
      const had = entry.commentedAt;
      const back = writeBack(root, epic, entry, t, { item, rules, epicType: epicTypeOf(root, epic), runner, epics, unreadable: links.unreadable, dryRun });
      if (entry.commentedAt !== had) touched.add(epic);
      row.commented ||= back.commented;
      row.labelled.push(...back.labelled);
      row.removed.push(...back.removed);
      for (const f of back.failed) if (!row.failed.includes(f)) row.failed.push(f);
      for (const n of back.notes) if (!row.notes.includes(n)) row.notes.push(n);
      // What the next epic of this item must see, so the same label is not sent twice.
      const gone = new Set(back.removed.map((l) => l.toLowerCase()));
      item.labels = [...item.labels.filter((l) => !gone.has(l.toLowerCase())), ...back.labelled];
    }
    // Close once, and only when every epic has shipped. An item a person reopened keeps its `closedByYadAt`.
    const allShipped = !links.unreadable.length && epics.every((e) => epicStage(root, e) === 'shipped');
    if (close && item.state === 'open' && allShipped && !entries.some(({ entry }) => entry.closedByYadAt)) {
      // The links file may not be committed, so the platform decides: an item ever reopened is a person's call.
      const again = everReopened(t, first.number, runner);
      if (again === null) row.failed.push('could not read whether the item was reopened, so it was not closed');
      else if (again) row.notes.push('someone reopened this item, so it stays open');
      else if (dryRun) row.closed = true;
      else if (closeItem(t, first.number, { runner }).ok) {
        row.closed = true;
        for (const { entry } of entries) entry.closedByYadAt = new Date(now).toISOString();
        for (const { epic } of entries) { writeLinks(root, epic, entriesByEpic.get(epic)); touched.add(epic); }
      } else row.failed.push('the item could not be closed');
    }
    out.items.push(row);
  }
  if (!dryRun) for (const epic of touched) writeLinks(root, epic, entriesByEpic.get(epic));
  return out;
}

export async function runIssuesSync(root, { dryRun = false, json = false, env = process.env, runner = run, now = Date.now() } = {}) {
  if (!fs.existsSync(productConfigPath(root))) return bailer(json)('not a Product (no .sdlc/product.json here)', 'run it from the Product, or pass --dir');
  if (env.YAD_PLATFORM_READ === '0') return bailer(json)('platform reads are turned off (YAD_PLATFORM_READ=0)', 'unset it to sync');
  const r = syncItems(root, { dryRun, env, runner, now });
  const failed = r.items.filter((i) => i.failed.length).length + r.skipped.length;
  if (failed || r.unreadable.length) process.exitCode = 1;
  if (json) return emitJSON({ ok: !failed && !r.unreadable.length, ...r });
  for (const i of r.items) {
    const did = [i.commented && 'comment', i.labelled.length && `labels +${i.labelled.map(forTerminal).join(', +')}`, i.removed.length && `labels -${i.removed.map(forTerminal).join(', -')}`, i.closed && 'close'].filter(Boolean);
    log(`  ${i.ref} (${i.epics.join(', ')}): ${did.length ? `${dryRun ? 'would ' : ''}${did.join('; ')}` : 'up to date'}`);
    for (const n of i.notes ?? []) info(`${i.ref}: ${forTerminal(n)}`);
    for (const f of i.failed) warn(`${i.ref}: ${forTerminal(f)}`);
  }
  for (const s of r.skipped) warn(s);
  for (const e of r.unreadable) warn(`${e}: its .sdlc/issue-links.json could not be read, so status labels and closes were held back`);
  if (!r.items.length && !r.skipped.length && !r.unreadable.length) info('no items are linked to an epic');
  else if (!dryRun) info(`${recordRoute(root, 'any .sdlc/issue-links.json this changed')}, so the team keeps the record`);
  return undefined;
}

// After a gate advances, on this machine. Best effort: it prints a warning and never fails the gate. An epic
// with no linked items makes no network call. A gate advanced in CI is caught by the next `yad issues sync`.
export function syncAfterGate(root, epic, { env = process.env, runner = run, now = Date.now() } = {}) {
  try {
    if (env.YAD_PLATFORM_READ === '0') return;
    if (!readLinks(root, epic).length) return;
    // Status and labels only. Closing an item is asked for, with `yad issues sync`.
    const r = syncItems(root, { only: epic, close: false, env, runner, now });
    const changed = r.items.filter((i) => i.commented || i.labelled.length || i.removed.length);
    for (const i of changed) info(`updated ${i.ref}: ${[i.commented && 'comment', ...i.labelled.map((l) => `+${forTerminal(l)}`), ...i.removed.map((l) => `-${forTerminal(l)}`)].filter(Boolean).join(', ')}`);
    if (changed.some((i) => i.commented)) info(`${recordRoute(root, '.sdlc/issue-links.json')}, so the team keeps the record`);
    for (const i of r.items) for (const f of i.failed) warn(`${i.ref}: ${forTerminal(f)}. The gate still passed; \`yad issues sync\` catches up`);
    for (const s of r.skipped) warn(s);
  } catch (e) {
    warn(`the linked items were not updated (${forTerminal(e?.message ?? String(e))}). The gate still passed; \`yad issues sync\` catches up`);
  }
}

const epicTypeOf = (root, epic) => readJSON(epicFiles(epicRoot(root, epic)).state, null)?.type ?? null;
const knownEpic = (root, epic) => isValidEpicId(epic) && !PRODUCT_EPICS.includes(epic) && fs.existsSync(epicFiles(epicRoot(root, epic)).state);

export async function runIssuesLink(root, { ref, epic: raw, json = false, now = Date.now(), env = process.env, runner = run } = {}) {
  const bail = bailer(json);
  const epic = epicIdFrom(raw);
  if (!epic || !knownEpic(root, epic)) return bail(`no epic ${forTerminal(String(raw ?? ''))} here`, 'usage: yad issues link <ref> <EP-id>');
  const got = loadItem(root, ref, { env, runner, bail });
  if (!got) return undefined;
  const rules = labelRules(got.productConfig);
  const { entry, created, back } = linkAndWriteBack(root, epic, got.t, got.item, { rules, epicType: epicTypeOf(root, epic), now, runner });
  if (json) return emitJSON({ ok: true, epic, url: entry.url, number: entry.number, created, commented: back.commented, labelled: back.labelled, failed: back.failed, notes: back.notes });
  said(`${created ? 'linked' : 'already linked:'} ${got.label === 'Product' ? '' : forTerminal(got.label)}#${entry.number} → ${epic}`);
  sayBack(back);
  if (created) info(`${recordRoute(root, '.sdlc/issue-links.json')}, so the team sees the link`);
  return undefined;
}

// Unlink never needs the item, and removes nothing from the platform: a person can tidy the comment and labels.
export async function runIssuesUnlink(root, { ref, epic: raw, json = false, env = process.env, runner = run } = {}) {
  const bail = bailer(json);
  const epic = epicIdFrom(raw);
  if (!epic || !knownEpic(root, epic)) return bail(`no epic ${forTerminal(String(raw ?? ''))} here`, 'usage: yad issues unlink <ref> <EP-id>');
  const r = resolveTarget(root, ref, { env, runner });
  if (!r.ok) return bail(r.why, r.hint);
  if (!r.t.host || !r.t.repo) return bail(`${forTerminal(r.label)}: the repo's address could not be worked out`);
  const key = itemKey({ host: r.t.host, repo: r.t.repo, number: r.number });
  const items = readLinks(root, epic);
  const kept = items.filter((l) => itemKey(l) !== key);
  if (kept.length === items.length) return bail(`${forTerminal(String(ref))} is not linked to ${epic}`);
  writeLinks(root, epic, kept);
  if (json) return emitJSON({ ok: true, epic, number: r.number, removed: true });
  said(`unlinked ${forTerminal(String(ref))} from ${epic}`);
  info('the comment and labels on the item were left as they are');
  return undefined;
}

// The epics an item names for certain: a label `epic: EP-x`, an `EP-x` in its text, or a parent item that is
// already linked. Only epics that exist count. `{ ids }`, or `{ unknown:true, why }` if the hierarchy or a links file could not be read.
export function definiteParents(root, t, item, { self, runner = run }) {
  // A parent needs an epic.md: an epic only just seeded cannot be threaded off yet.
  const known = new Set(epicIds(root).filter((e) => !PRODUCT_EPICS.includes(e) && e !== self && fs.existsSync(path.join(epicRoot(root, e), 'epic.md'))));
  const found = new Set();
  for (const l of item.labels) { const m = /^epic:\s*(EP-[a-z0-9][a-z0-9-]*)$/i.exec(l); if (m) found.add(m[1]); }
  for (const m of item.rawText.matchAll(/(?<![A-Za-z0-9-])EP-[a-z0-9]+(?:-[a-z0-9]+)*/g)) found.add(m[0]);
  const p = readParent(t, item.number, runner);
  const links = p.parent ? allLinks(root) : null;
  if (p.parent) for (const e of links.byItem.get(itemKey({ host: t.host, repo: p.parent.repo, number: p.parent.number })) || []) found.add(e);
  const ids = [...found].filter((e) => known.has(e)).sort();
  if (ids.length) return { ids };
  if (p.unknown) return { unknown: true, why: 'could not read whether the item has a parent item' };
  if (links?.unreadable.length) return { unknown: true, why: `the item has a parent item, but the item links of ${links.unreadable.join(', ')} could not be read (.sdlc/issue-links.json)` };
  return { ids };
}

// `yad epic new <slug> --issue <ref>`.
export async function runEpicNewFromIssue(root, { slug, issue, type = null, profile = null, stub = false, parent = null, inherits = null, today, json = false, now = Date.now(), env = process.env, runner = run } = {}) {
  const bail = bailer(json);
  if (stub) return bail('--issue and --stub cannot be used together', 'a stub anchors code that already shipped; an item seeds new work');
  const epic = epicIdFrom(slug);
  if (!epic || !isValidEpicId(epic)) return bail(`invalid epic id: ${forTerminal(String(slug ?? ''))} (expected EP-<slug>, [a-z0-9-] only)`);
  if (fs.existsSync(epicFiles(epicRoot(root, epic)).state)) return bail(`${epic} already has a lifecycle`, `to link an item to it: yad issues link ${forTerminal(String(issue))} ${epic}`);
  readLinks(root, epic); // a leftover links file that cannot be read refuses here, before anything is made
  const got = loadItem(root, issue, { env, runner, bail });
  if (!got) return undefined;
  const { t, item, productConfig } = got;
  const rules = labelRules(productConfig);
  let epicType = type;
  if (!epicType) {
    const ty = pickType(item.labels, rules.type);
    if (ty.more) return bail('the item has more than one type label', 'choose with --type feature|change|defect|chore|hotfix');
    if (!ty.value) return bail('the item has no type label', item.confidential ? 'a confidential item\'s labels are not used. Pass --type' : 'add one (bug, feature, enhancement), or pass --type');
    epicType = ITEM_TO_EPIC[ty.value];
  }
  if (!WORK_ITEM_TYPES.includes(epicType)) return bail(`unknown work-item type: ${forTerminal(String(epicType))}`, `use one of ${WORK_ITEM_TYPES.join(', ')}`);
  let parentId = parent;
  let stubbed = null;
  if (!isGenesisType(epicType) && !parentId) {
    const d = definiteParents(root, t, item, { self: epic, runner });
    if (d.unknown) return bail(d.why, 'pass --parent <EP-id>, so a duplicate stub is not created');
    if (d.ids.length > 1) return bail(`the item points at more than one epic: ${d.ids.join(', ')}`, 'choose one with --parent');
    if (d.ids.length) parentId = d.ids[0];
    else {
      // Everything that would refuse the child is refused here first: a stub left behind by a typo stays for good.
      if (profile && profile !== 'classic') return bail(`a new stub parent is on the classic route, and a child takes its parent's route: --profile ${forTerminal(profile)} cannot apply`, 'drop --profile, or pass --parent');
      if (inherits) return bail('a new stub parent has nothing to inherit', 'drop --inherits, or pass --parent');
      if (fs.existsSync(path.join(epicRoot(root, epic), 'epic.md'))) return bail(`${epic} already has an epic.md`, 'pass --parent, so its header and the parent agree');
      if (hasApprovals(epicFiles(epicRoot(root, epic)).approvals)) return bail(`${epic} has approval records but no lifecycle`, 'look at that folder first: nothing here overwrites a ledger');
      stubbed = `${epic}-parent`;
      if (fs.existsSync(epicFiles(epicRoot(root, stubbed)).state) || fs.existsSync(path.join(epicRoot(root, stubbed), 'epic.md'))) return bail(`${stubbed} already exists`, `if it is this item's parent, pass --parent ${stubbed}`);
      const s = await runEpicNew(root, { slug: stubbed, stub: true, today, json: true, returnResult: true });
      if (!s?.ok) return bail(`the stub parent ${stubbed} could not be created: ${s?.error ?? 'unknown reason'}`, s?.hint);
      // The same header the yad-stub skill writes: a parent needs an epic.md. It names only the ids, so the
      // item's text stays on the platform.
      fs.writeFileSync(path.join(epicRoot(root, stubbed), 'epic.md'), `---\nid: ${stubbed}\ntitle: Parent of ${epic}\nstatus: draft\nkind: feature\ntype: feature\nthread: ${stubbed}\ntheme:\nverified: false\nstub: backfill-pending\norigin: brownfield\nowner:\nrepos: []\ncreated: ${today}\n---\n\n## Feature (stub)\nAn anchor made so ${epic} can thread off it. Nothing is known about this feature yet: document it with the yad-backfill skill.\n`);
      parentId = stubbed;
    }
  }
  const seeded = await runEpicNew(root, { slug: epic, type: epicType, profile, parent: parentId, inherits, today, json: true, returnResult: true });
  if (!seeded?.ok) return bail(`${seeded?.error ?? 'the epic could not be seeded'}${stubbed ? ` (the stub ${stubbed} was created and stays)` : ''}`, seeded?.hint);
  const { entry, back } = linkAndWriteBack(root, epic, t, item, { rules, epicType, now, runner });
  if (json) return emitJSON({ ...seeded, issue: { number: entry.number, url: entry.url }, parent: parentId ?? null, stubParent: stubbed, commented: back.commented, labelled: back.labelled, failed: back.failed, notes: back.notes });
  said(`${epic} seeded from item ${entry.number} — type ${epicType}${parentId ? `, parent ${parentId}${stubbed ? ' (new stub)' : ''}` : ''}`);
  sayBack(back);
  if (seeded.next) hand(`next: the ${seeded.next} skill. It reads the item with \`yad issues show\``);
  info('the item\'s text is not copied here. Commit the seed on this epic\'s authoring branch');
  return undefined;
}
