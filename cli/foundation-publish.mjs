// E174 — the approved roadmap becomes work items in the Product repo. After the Foundation review passes,
// `yad foundation publish` opens one GitHub issue or GitLab work item per roadmap feature: type feature, a
// priority by phase (the first phase is the MVP: P1, then P2, then P3), the label `epic: EP-x`, and the
// phase as its milestone. A "parked" phase is a decision not to build yet, so it is left out.
//
// The record of what was published is `foundation/.sdlc/roadmap-items.json`. It is outside the Foundation's
// fingerprint (only the section files count), so publishing never makes the review stale. A lost record does
// not cause duplicates: each item's body carries `<!-- yad-roadmap: EP-x -->`, and those are read first.
import fs from 'node:fs';
import path from 'node:path';
import { run, forTerminal, readJSONStrict, writeJSON, c, log, fail, hand, info, warn, emitJSON } from './lib.mjs';
import { err } from './errors.mjs';
import { productConfigPath, epicFiles } from './manifest.mjs';
import { acceptedHashes, doneStepUnapproved, epicRoot, isStaleHash, FOUNDATION_EPIC, isValidEpicId, loadLedger, PRODUCT_DONE, PRODUCT_EPICS, roadmapFeatures } from './epic-state.mjs';
import { createLabel, labelRules, readLabels } from './issues.mjs';
import { linkAndWriteBack, readItem } from './issues-write.mjs';
import { readLinks, itemKey } from './issue-links.mjs';
import { targetOf } from './issues-act.mjs';
import { readMilestones, safeTitle } from './scan.mjs';
import { api } from './protection.mjs';
import { createMilestone, newItem } from './platform.mjs';

const RECORD = path.join('.sdlc', 'roadmap-items.json');
const MARKER = /<!-- yad-roadmap: (EP-[a-z0-9-]+) -->/g;
const PAGE = 100;
// The template's own heading for deferred work, exactly: a phase that merely contains the word ("Car park finder") counts.
const PARKED = /^(later\s*\/\s*)?parked?$/i;

// Whether the Foundation as it stands is not what its review passed. Approvals answer when there are any. With none
// (a solo Product passes on the merge alone), the fingerprint the step was closed with answers. Neither: no claim.
export function foundationChanged(dir, ledger) {
  const review = ledger.state?.steps?.find((st) => st.type === 'review+approve');
  if (!review) return false;
  const approved = (Array.isArray(ledger.approvals) ? ledger.approvals : []).filter((a) => a?.step === review.id && a.status === 'approved');
  if (approved.length) return !!doneStepUnapproved(dir, review, ledger.approvals);
  const hash = review.closed?.hash;
  return !!hash && isStaleHash(hash, acceptedHashes(dir, review.artifact));
}

export const priorityForPhase = (index) => (index === 0 ? 'P1' : index === 1 ? 'P2' : 'P3');
const recordPath = (root) => path.join(epicRoot(root, FOUNDATION_EPIC), RECORD);

const validEntry = (e) => !!e && typeof e === 'object' && !Array.isArray(e) && isValidEpicId(e.epicId) && !!e.host && !!e.repo && Number.isInteger(e.number);
// Strict, as every read before a write is: a record that cannot be understood is refused, never replaced.
export function readRecord(root) {
  const p = recordPath(root);
  const doc = readJSONStrict(p, { items: [] });
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items) || !doc.items.every(validEntry)) throw err('YAD-STATE-001', `${p} is not a roadmap-items file`, 'fix the file or restore it from git');
  return doc.items;
}
const writeRecord = (root, items) => { fs.mkdirSync(path.dirname(recordPath(root)), { recursive: true }); writeJSON(recordPath(root), { items }); };

// The rows to publish, with each one's phase, priority and milestone title. The first table row of an id wins.
export function roadmapRows(text, skipped = [], nearMiss = []) {
  const phases = [];
  const seen = new Set();
  const rows = [];
  for (const r of roadmapFeatures(text)) {
    const phase = (r.phase ?? 'Roadmap').trim();
    if (PARKED.test(phase)) { if (!skipped.includes(phase)) skipped.push(phase); continue; }
    if (/\b(later|parked?)\b/i.test(phase) && !nearMiss.includes(phase)) nearMiss.push(phase);
    if (!isValidEpicId(r.epicId) || PRODUCT_EPICS.includes(r.epicId) || seen.has(r.epicId)) continue;
    seen.add(r.epicId);
    if (!phases.includes(phase)) phases.push(phase);
    rows.push({ epicId: r.epicId, feature: forTerminal(r.feature).replace(/\s+/g, ' ').trim() || r.epicId, phase, priority: priorityForPhase(phases.indexOf(phase)) });
  }
  return rows;
}

// The item already published for one row: open or closed, carrying both the row's `epic: EP-x` label and its body
// marker. The label matters: a person who can only open issues cannot set one, so a stranger's issue that copies
// the marker does not claim the row. Asked per row, so a busy repo is never too big to read.
// `{ found: {number,url} | null }`, or `{ unread: true }`.
function publishedOn(t, epicId, runner) {
  const gh = t.platform === 'github';
  const label = encodeURIComponent(`epic: ${epicId}`);
  const at = gh ? `repos/${t.repo}/issues?labels=${label}&state=all&per_page=${PAGE}` : `projects/${encodeURIComponent(t.repo)}/issues?labels=${label}&scope=all&per_page=${PAGE}`;
  // An epic's defects and changes may carry its label too, so the pages are followed until the marker turns up.
  for (let page = 1; page <= 10; page++) {
    const res = api(runner, t.cli, t.host, `${at}&page=${page}`);
    if (!res.ok || !Array.isArray(res.body)) return { unread: true };
    for (const it of res.body) {
      if (gh && it?.pull_request) continue;
      const n = gh ? it?.number : it?.iid;
      const marks = [...String((gh ? it?.body : it?.description) ?? '').matchAll(MARKER)].map((m) => m[1]);
      if (Number.isInteger(n) && marks.includes(epicId)) return { found: { number: n, url: (gh ? it?.html_url : it?.web_url) ?? null } };
    }
    if (res.body.length < PAGE) return { found: null };
  }
  return { unread: true };
}

// The phase is the team's heading; `safeTitle` breaks a mention or reference so one publish notifies nobody.
const bodyFor = (row) => `A feature on the approved roadmap, phase: ${safeTitle(row.phase.replace(/[*_`<>[\]]/g, ''))}. Its proposed epic is \`${row.epicId}\`.\n\nStart the epic with \`yad epic new ${row.epicId} --issue <this item's number>\` to link it here, so this item's status follows the epic. \`yad foundation publish\` also links an epic that already exists.\n\n<!-- yad-roadmap: ${row.epicId} -->`;
// GitLab allows 255 characters in a title; cut by character, never inside one.
const titleFor = (feature) => [...feature].slice(0, 255).join('');

export async function runFoundationPublish(root, { dryRun = false, json = false, env = process.env, runner = run, now = Date.now() } = {}) {
  const refuse = (message, hint) => {
    process.exitCode = 1;
    if (json) return emitJSON({ ok: false, error: message, hint: hint ?? null });
    fail(message); if (hint) hand(hint);
    return undefined;
  };
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/product.json here)', 'run it from the Product, or pass --dir');
  const dir = epicRoot(root, FOUNDATION_EPIC);
  if (!fs.existsSync(epicFiles(dir).state)) return refuse('this product has no Foundation', 'run `yad foundation new`, then the yad-discovery skill');
  let ledger;
  try { ledger = loadLedger(dir); } catch { return refuse('the Foundation\'s ledger cannot be read', 'run `yad doctor`'); }
  // Only an approved roadmap: a draft could still lose or rename features.
  if (!PRODUCT_DONE.includes(ledger.state?.currentStep)) return refuse('the Foundation has not passed its review yet, so the roadmap is not final', 'publish it after the review: the backlog should hold only approved features');
  // Approved once is not enough: a roadmap edited since its review holds rows nobody approved.
  let changed;
  try { changed = foundationChanged(dir, ledger); } catch { return refuse('the Foundation\'s review could not be checked', 'run `yad doctor`'); }
  if (changed) return refuse('the Foundation changed after its review, so the review no longer covers the roadmap', 'have the Foundation reviewed again (`yad gate reopen EP-foundation foundation`), then publish');
  const file = path.join(dir, 'roadmap.md');
  if (!fs.existsSync(file)) return refuse('foundation/roadmap.md does not exist');
  const skipped = [];
  const nearMiss = [];
  const rows = roadmapRows(fs.readFileSync(file, 'utf8'), skipped, nearMiss);
  const record = readRecord(root);
  if (env.YAD_PLATFORM_READ === '0') return refuse('platform reads are turned off (YAD_PLATFORM_READ=0)');
  let where;
  try { where = targetOf(root, null, { env, runner }); } catch (e) { return refuse(e.message, e.hint); }
  const { t, productConfig } = where;
  const rules = labelRules(productConfig);
  const out = { ok: true, dryRun, created: [], recovered: [], alreadyPublished: 0, linked: [], failed: [], notes: [...skipped.map((p) => `the phase "${forTerminal(p)}" is parked, so its rows were left out`), ...nearMiss.map((p) => `the phase "${forTerminal(p)}" is published; only a heading of exactly "Later / parked" is left out`)] };
  const known = new Map(record.filter((e) => e.host === t.host && e.repo === t.repo).map((e) => [e.epicId, e]));
  const todo = rows.filter((r) => !known.has(r.epicId));
  out.alreadyPublished = rows.length - todo.length;

  if (todo.length) {
    // A lost or uncommitted record must not mean a second item for the same feature.
    const markers = new Map();
    for (const r of todo) {
      const p = publishedOn(t, r.epicId, runner);
      if (p.unread) return refuse(`the items labelled "epic: ${r.epicId}" could not be read, so nothing was created`, 'run it again; already published features are never created twice');
      if (p.found) markers.set(r.epicId, p.found);
    }
    const fresh = [];
    for (const r of todo) {
      const m = markers.get(r.epicId);
      if (m) { out.recovered.push({ epicId: r.epicId, number: m.number, url: m.url }); if (!dryRun) record.push({ epicId: r.epicId, platform: t.platform, host: t.host, repo: t.repo, number: m.number, url: m.url, publishedAt: new Date(now).toISOString() }); }
      else fresh.push(r);
    }
    if (out.recovered.length && !dryRun) writeRecord(root, record);
    const labelsOf = (r) => [rules.type.feature[0], rules.priority[r.priority][0], `epic: ${r.epicId}`];
    if (t.platform === 'gitlab' && fresh.some((r) => labelsOf(r).some((l) => l.includes(',')))) return refuse('a GitLab label name with a comma cannot be sent', 'rename that label in the issues settings of .sdlc/product.json');
    if (dryRun) for (const r of fresh) out.created.push({ epicId: r.epicId, feature: r.feature, phase: r.phase, priority: r.priority, number: null, url: null, wouldCreate: true });
    else if (fresh.length) {
      const have = readLabels(t, runner);
      if (have.ok) for (const name of new Set(fresh.flatMap(labelsOf))) if (!have.names.has(name.toLowerCase())) createLabel(t, name, name.startsWith('epic: ') ? 'c5def5' : '1d76db', runner);
      const milestones = readMilestones(t, runner);
      if (!milestones) out.notes.push('the milestones could not be read, so these items have none');
      const idOf = new Map();
      const milestoneFor = (phase) => {
        if (!milestones) return null;
        if (idOf.has(phase)) return idOf.get(phase);
        let id = milestones.get(phase) ?? null;
        if (id === null) {
          const r = createMilestone(t, phase, { runner });
          try { id = r.ok ? (t.platform === 'github' ? JSON.parse(r.stdout).number : JSON.parse(r.stdout).id) ?? null : null; } catch { id = null; }
          if (id === null) out.notes.push(`the milestone "${forTerminal(phase)}" could not be created`);
        }
        idOf.set(phase, id);
        return id;
      };
      for (const r of fresh) {
        const labels = labelsOf(r);
        const milestone = milestoneFor(r.phase);
        const res = newItem(t, { title: titleFor(r.feature), body: bodyFor(r), labels, milestone }, { runner });
        if (!res.ok) { out.failed.push({ epicId: r.epicId, why: 'the platform refused to create it' }); continue; }
        let b = {};
        try { b = JSON.parse(res.stdout); } catch { /* checked below */ }
        const number = t.platform === 'github' ? b.number : b.iid;
        if (!Number.isInteger(number)) { out.failed.push({ epicId: r.epicId, why: 'the answer named no item number' }); continue; }
        const url = b.html_url ?? b.web_url ?? null;
        record.push({ epicId: r.epicId, platform: t.platform, host: t.host, repo: t.repo, number, url, publishedAt: new Date(now).toISOString() });
        writeRecord(root, record);
        const got = (Array.isArray(b.labels) ? b.labels : []).map((l) => String(typeof l === 'string' ? l : l?.name).toLowerCase());
        const missing = labels.filter((l) => !got.includes(l.toLowerCase()));
        const row = { epicId: r.epicId, feature: r.feature, phase: r.phase, priority: r.priority, number, url };
        if (missing.length) out.failed.push({ ...row, why: `created, but the labels ${missing.join(', ')} were not set: add them on #${number}, or a later publish cannot recognise it` });
        else if (milestone !== null && !b.milestone) out.failed.push({ ...row, why: 'created, but the milestone was not set' });
        else out.created.push(row);
      }
    }
  }

  // A feature whose epic already exists is linked, so its status flows back to the item.
  for (const e of record.filter((x) => x.host === t.host && x.repo === t.repo)) {
    if (!rows.some((r) => r.epicId === e.epicId) || !fs.existsSync(epicFiles(epicRoot(root, e.epicId)).state)) continue;
    let links;
    try { links = readLinks(root, e.epicId); } catch { out.notes.push(`${e.epicId}: its .sdlc/issue-links.json could not be read, so it was not linked`); continue; }
    if (links.some((l) => itemKey(l) === itemKey(e))) continue;
    if (dryRun) { out.linked.push({ epicId: e.epicId, number: e.number, wouldLink: true }); continue; }
    const item = readItem(t, e.number, { runner });
    if (!item.ok) { out.notes.push(`${e.epicId}: item ${e.number} could not be read, so it was not linked`); continue; }
    const epicType = (() => { try { return loadLedger(epicRoot(root, e.epicId)).state?.type ?? null; } catch { return null; } })();
    try {
      const { back } = linkAndWriteBack(root, e.epicId, t, item, { rules, epicType, now, runner });
      out.linked.push({ epicId: e.epicId, number: e.number, failed: back.failed });
    } catch (x) { out.notes.push(`${e.epicId}: it could not be linked (${forTerminal(x?.message ?? String(x))})`); }
  }

  if (out.failed.length) { out.ok = false; process.exitCode = 1; }
  if (json) return out;
  for (const x of out.created) log(`  ${x.priority} ${forTerminal(x.feature)} ${c.dim(`(${x.epicId}, ${forTerminal(x.phase)})`)} ${dryRun ? c.dim('would be created') : x.url ?? `#${x.number}`}`);
  for (const x of out.recovered) info(`${x.epicId} was already on the Product repo as #${x.number}; ${dryRun ? 'it would be recorded' : 'recorded it'}`);
  for (const x of out.linked) info(`${x.epicId} ${x.wouldLink ? 'would be linked' : 'linked'} to #${x.number}`);
  for (const x of out.failed) warn(`${x.epicId}: ${forTerminal(x.why)}${x.url ? ` ${x.url}` : ''}`);
  for (const n of out.notes) info(n);
  info(`${out.created.length} ${dryRun ? 'would be created' : 'created'}, ${out.alreadyPublished} already published`);
  if (!dryRun && (out.created.length || out.recovered.length)) info('commit foundation/.sdlc/roadmap-items.json so the team keeps the record');
  return undefined;
}

// For `yad foundation status`: the item each row was published as, read from the record only (no network).
export function publishedItems(root) {
  try { return new Map(readRecord(root).map((e) => [e.epicId, { number: e.number, url: e.url ?? null }])); } catch { return null; }
}
