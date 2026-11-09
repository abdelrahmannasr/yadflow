// E170 — an issue or work item seeds and links an epic, and the link is written back to the item.
//   `yad issues show <ref>`     the full item, for a skill to read. Title and body are marked untrusted.
//   `yad issues link|unlink`    the sidecar, and the comment and labels on the item.
//   `yad epic new --issue`      the item's type label sets the epic type; a defect or change finds its parent
//                               from a definite link, or gets a stub parent. It never guesses from wording.
// The item must be read before anything is created. A failed write-back leaves the link in place and says so.
import fs from 'node:fs';
import path from 'node:path';
import { run, readJSON, forTerminal, c, log, fail, hand, info, ok as said, warn, emitJSON } from './lib.mjs';
import { epicFiles, productConfigPath } from './manifest.mjs';
import { epicIds, epicRoot, isGenesisType, isValidEpicId, PRODUCT_EPICS } from './epic-state.mjs';
import { addItemLabels, closeItem, commentOnItem, removeItemLabels } from './platform.mjs';
import { productIdentity } from './members.mjs';
import { prTarget } from './pr-list.mjs';
import { repoSources } from './standup.mjs';
import { api, shown, whyFailed, httpStatus, TIMEOUT } from './protection.mjs';
import { labelRules, pick, itemStatus } from './issues.mjs';
import { runEpicNew, epicIdFrom } from './epic.mjs';
import { allLinks, combinedStage, epicStage, itemKey, readLinks, writeLinks } from './issue-links.mjs';

export { closeItem };

const clean = (v) => forTerminal(String(v ?? '')).replace(/\s+/g, ' ').trim();
// A body keeps its lines; everything else `forTerminal` removes is removed from each one.
const cleanBody = (v) => String(v ?? '').split(/\r?\n/).map((l) => forTerminal(l)).join('\n');
const httpUrl = (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
const NO_FIELD = /doesn't exist on type|Field '[^']+' doesn't exist/i;

const ITEM_TO_EPIC = { bug: 'defect', feature: 'feature', enhancement: 'change' };
const EPIC_TO_ITEM = { defect: 'bug', hotfix: 'bug', feature: 'feature', change: 'enhancement' };

// `12`, `#12` (the Product repo) or `<repo>#12`. A bare `#12` is a shell comment unless quoted, so `12` works too.
export function parseRef(ref) {
  const m = /^(?:(.*[^#])#|#)?(\d{1,10})$/.exec(String(ref ?? '').trim());
  return m ? { label: m[1] ?? 'Product', number: Number(m[2]) } : null;
}

function resolveTarget(root, ref, { env, runner, authCache = new Map() }) {
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
    : ['api', '--hostname', t.host, 'graphql', '-f', `query=query($p:ID!,$i:[String!]){project(fullPath:$p){workItems(iids:$i){nodes{widgets{... on WorkItemWidgetHierarchy{parent{iid namespace{fullPath}}}}}}}}`, '-f', `p=${t.repo}`, '-f', `i[]=${number}`];
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
  const labels = (Array.isArray(n.labels) ? n.labels : []).map((l) => clean(typeof l === 'string' ? l : l?.name)).filter(Boolean);
  const logins = (Array.isArray(n.assignees) ? n.assignees : []).map((a) => clean(gh ? a?.login : a?.username)).filter(Boolean);
  return { ok: true, number, confidential, labels, logins, rawText: `${n.title ?? ''}\n${(gh ? n.body : n.description) ?? ''}`,
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
    priority: item.confidential ? null : pick(item.labels, rules.priority).value, type: item.confidential ? null : pick(item.labels, rules.type).value,
    labels: item.confidential ? [] : item.labels, assignees: item.logins, confidential: item.confidential, title: item.title, body: item.body, untrusted: true, untrustedFields: ['title', 'body', 'labels'] };
  if (json) return emitJSON({ ok: true, ...out });
  log(`${c.bold(out.ref)} ${out.title ?? '(confidential: open it on GitLab to read it)'}`);
  info(`${out.state} · priority ${out.priority ?? 'none'} · type ${out.type ?? 'none'} · assigned ${out.assignees.join(', ') || 'nobody'}`);
  if (out.url) info(out.url);
  if (out.body) log(`\n${out.body}`);
  return undefined;
}

const statusFor = (root, epics, state) => itemStatus(state, combinedStage(epics.map((e) => epicStage(root, e))) ?? 'in-shape').status;

// Put the comment and labels on the item. Never throws, and returns what failed; the link is kept either way.
export function writeBack(root, epic, entry, t, { item, rules, epicType, runner = run, epics = [epic] }) {
  const failed = [];
  const failedWhy = (what, r) => failed.push(`${what}: ${whyFailed({ ok: false, status: httpStatus(r) }, { platform: t.platform, host: t.host, what })}`);
  const out = { commented: false, labelled: [], failed };
  if (!entry.commentedAt) {
    const r = commentOnItem(t, entry.number, `Linked to yadflow epic \`${epic}\`${epicType ? ` (type: ${epicType})` : ''}.`, { runner });
    if (r.ok) { entry.commentedAt = new Date().toISOString(); out.commented = true; } else failedWhy('the comment', r);
  }
  if (item.confidential) { failed.push('labels: a confidential item is left unlabelled, because its labels are not read'); return out; }
  const have = new Set(item.labels.map((l) => l.toLowerCase()));
  const add = [];
  const typeOf = EPIC_TO_ITEM[epicType];
  if (typeOf && !rules.type[typeOf].some((l) => have.has(l.toLowerCase()))) add.push(rules.type[typeOf][0]);
  const status = statusFor(root, epics, item.state);
  const statusLabel = rules.status[status][0];
  if (!have.has(statusLabel.toLowerCase())) add.push(statusLabel);
  const stale = Object.entries(rules.status).filter(([s]) => s !== status).flatMap(([, names]) => names).filter((l) => have.has(l.toLowerCase()));
  if (add.length) { const r = addItemLabels(t, entry.number, add, { runner }); if (r.ok) out.labelled = add; else failedWhy(`the labels ${add.join(', ')}`, r); }
  if (stale.length && !removeItemLabels(t, entry.number, stale, { runner }).ok) failed.push('the old status label could not be removed');
  return out;
}

function makeEntry(t, item, now) {
  return { platform: t.platform, host: t.host, repo: t.repo, number: item.number, url: item.url, linkedAt: new Date(now).toISOString() };
}

// Add the link (or find the one there) and write back. `{ entry, created, back }`.
function linkAndWriteBack(root, epic, t, item, { rules, epicType, now, runner }) {
  const items = readLinks(root, epic);
  const key = itemKey({ host: t.host, repo: t.repo, number: item.number });
  let entry = items.find((l) => itemKey(l) === key);
  const created = !entry;
  if (created) { entry = makeEntry(t, item, now); items.push(entry); writeLinks(root, epic, items); }
  const others = allLinks(root).byItem.get(key) || [epic];
  const back = writeBack(root, epic, entry, t, { item, rules, epicType, runner, epics: others });
  writeLinks(root, epic, items);
  return { entry, created, back };
}

function sayBack(back) {
  if (back.commented) info('commented on the item');
  if (back.labelled.length) info(`labels added: ${back.labelled.map(forTerminal).join(', ')}`);
  for (const f of back.failed) warn(`not written to the item — ${forTerminal(f)}. The link is kept${/labels/.test(f) ? '; `yad issues labels` creates missing labels' : ''}`);
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
  if (json) return emitJSON({ ok: true, epic, url: entry.url, number: entry.number, created, commented: back.commented, labelled: back.labelled, failed: back.failed });
  said(`${created ? 'linked' : 'already linked:'} ${got.label === 'Product' ? '' : forTerminal(got.label)}#${entry.number} → ${epic}`);
  sayBack(back);
  if (created) info('commit .sdlc/issue-links.json on the epic\'s branch so the team sees the link');
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
// already linked. Only epics that exist count. `{ ids }` or `{ unknown:true }` if the hierarchy could not be read.
export function definiteParents(root, t, item, { self, runner = run }) {
  // A parent needs an epic.md: an epic only just seeded cannot be threaded off yet.
  const known = new Set(epicIds(root).filter((e) => !PRODUCT_EPICS.includes(e) && e !== self && fs.existsSync(path.join(epicRoot(root, e), 'epic.md'))));
  const found = new Set();
  for (const l of item.labels) { const m = /^epic:\s*(EP-[a-z0-9][a-z0-9-]*)$/i.exec(l); if (m) found.add(m[1]); }
  for (const m of item.rawText.matchAll(/(?<![A-Za-z0-9-])EP-[a-z0-9]+(?:-[a-z0-9]+)*/g)) found.add(m[0]);
  const p = readParent(t, item.number, runner);
  if (p.parent) for (const e of allLinks(root).byItem.get(itemKey({ host: t.host, repo: p.parent.repo, number: p.parent.number })) || []) found.add(e);
  const ids = [...found].filter((e) => known.has(e)).sort();
  return ids.length || !p.unknown ? { ids } : { unknown: true };
}

// `yad epic new <slug> --issue <ref>`.
export async function runEpicNewFromIssue(root, { slug, issue, type = null, profile = null, stub = false, parent = null, inherits = null, today, json = false, now = Date.now(), env = process.env, runner = run } = {}) {
  const bail = bailer(json);
  if (stub) return bail('--issue and --stub cannot be used together', 'a stub anchors code that already shipped; an item seeds new work');
  const epic = epicIdFrom(slug);
  if (!epic || !isValidEpicId(epic)) return bail(`invalid epic id: ${forTerminal(String(slug ?? ''))} (expected EP-<slug>, [a-z0-9-] only)`);
  if (fs.existsSync(epicFiles(epicRoot(root, epic)).state)) return bail(`${epic} already has a lifecycle`, `to link an item to it: yad issues link ${forTerminal(String(issue))} ${epic}`);
  const got = loadItem(root, issue, { env, runner, bail });
  if (!got) return undefined;
  const { t, item, productConfig } = got;
  const rules = labelRules(productConfig);
  let epicType = type;
  if (!epicType) {
    const ty = pick(item.labels, rules.type);
    if (ty.more) return bail('the item has more than one type label', 'choose with --type feature|change|defect|chore|hotfix');
    if (!ty.value) return bail('the item has no type label', item.confidential ? 'a confidential item\'s labels are not used. Pass --type' : 'add one (bug, feature, enhancement), or pass --type');
    epicType = ITEM_TO_EPIC[ty.value];
  }
  if (item.confidential && !type) return bail('a confidential item\'s labels are not used', 'pass --type');
  let parentId = parent;
  let stubbed = null;
  if (!isGenesisType(epicType) && !parentId) {
    const d = definiteParents(root, t, item, { self: epic, runner });
    if (d.unknown) return bail('could not read whether the item has a parent item', `pass --parent <EP-id>, so a duplicate stub is not created`);
    if (d.ids.length > 1) return bail(`the item points at more than one epic: ${d.ids.join(', ')}`, 'choose one with --parent');
    if (d.ids.length) parentId = d.ids[0];
    else {
      stubbed = `${epic}-parent`;
      if (fs.existsSync(epicFiles(epicRoot(root, stubbed)).state)) return bail(`${stubbed} already exists`, `if it is this item's parent, pass --parent ${stubbed}`);
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
  if (json) return emitJSON({ ...seeded, issue: { number: entry.number, url: entry.url }, parent: parentId ?? null, stubParent: stubbed, commented: back.commented, labelled: back.labelled, failed: back.failed });
  said(`${epic} seeded from item ${entry.number} — type ${epicType}${parentId ? `, parent ${parentId}${stubbed ? ' (new stub)' : ''}` : ''}`);
  sayBack(back);
  if (seeded.next) hand(`next: the ${seeded.next} skill. It reads the item with \`yad issues show\``);
  info('the item\'s text is not copied here. Commit the seed on this epic\'s authoring branch');
  return undefined;
}
