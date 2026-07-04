// `yad thread` (read-only: print a feature thread + its resolved current artifacts) and
// `yad reconcile` (Phase 6 change-reconciler: flag orphan drift + open hotfix debt, never a gate —
// mirrors `yad docs sync`). The hard merge BLOCK is the CI gates (lineage-check / reconcile-debt);
// this only DISCOVERS, exactly as yad-docs-sync flags and the build gates block. Node built-ins only.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, warn, hand, readJSON, exists } from './lib.mjs';
import { readShips } from './ledger.mjs';
import {
  epicRoot, isValidEpicId, epicLineage, readFrontmatter, isStubEpic,
  resolveThread, threadEpics, resolveCurrentArtifacts, resolveCurrentStories, THREAD_ARTIFACT_BASES,
} from './epic-state.mjs';

// ---- file readers (all derived; no DB) -----------------------------------------------------------

export const loadChange = (root, epic) => readJSON(path.join(epicRoot(root, epic), '.sdlc', 'change.json'), null);
export const loadDebt = (root, epic) => {
  const v = readJSON(path.join(epicRoot(root, epic), '.sdlc', 'reconcile-debt.json'), []);
  return Array.isArray(v) ? v : [];
};
// The build ledger is shard-then-fold now (cli/ledger.mjs): union the folded file + loose ship shards
// so a caller sees every ship whether or not `yad tidy up` has folded them yet.
export const loadBuildLog = (root, epic) => ({ epic, ships: readShips(epicRoot(root, epic)) });

// An epic is SEALED once every authored story is `shipped` (config.yaml change.seal_on). A sealed epic
// refuses new behaviour (epic-open.sh) — a further change must open a new threaded change-epic, which is
// what keeps the front artifacts from going stale. An epic with no stories is NOT sealed (nothing built).
export function sealedEpic(root, epic) {
  const dir = path.join(epicRoot(root, epic), 'stories');
  if (!exists(dir)) return false;
  const stories = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.md$/.test(e.name)).map((e) => e.name);
  if (!stories.length) return false;
  return stories.every((f) => readFrontmatter(path.join(dir, f)).status === 'shipped');
}

// The OPEN hotfix debt across a thread (every epic that shares the root). An open entry blocks the next
// normal change on the thread until paid (reconcile-debt-check.sh enforces; this reports).
export function openDebtOnThread(root, threadOrEpic) {
  const out = [];
  for (const id of threadEpics(root, threadOrEpic)) {
    for (const d of loadDebt(root, id)) if (d.status === 'open') out.push({ ...d, epicId: d.epicId || id });
  }
  return out;
}

// ---- thread summary (what `yad thread` + yad-status render) --------------------------------------

export function threadSummary(root, threadOrEpic) {
  const { rootId, broken } = resolveThread(root, threadOrEpic);
  const members = threadEpics(root, rootId);
  const nodes = members.map((id) => {
    const lin = epicLineage(root, id);
    const state = readJSON(path.join(epicRoot(root, id), '.sdlc', 'state.json'), null);
    const change = loadChange(root, id);
    return {
      id, kind: lin.kind, parent: lin.parent, inherits: lin.inherits,
      currentStep: state?.currentStep || 'unseeded',
      sealed: sealedEpic(root, id),
      stub: isStubEpic(root, id),
      depth: change?.depth || null,
      defect: change?.defect || null,
      brokenThread: resolveThread(root, id).broken || null,
    };
  });
  return {
    thread: rootId,
    broken,
    nodes,
    resolved: resolveCurrentArtifacts(root, rootId),
    resolvedStories: resolveCurrentStories(root, rootId),
    openDebt: openDebtOnThread(root, rootId),
  };
}

const KIND_TAG = { feature: c.green('feature'), change: c.cyan('change'), defect: c.yellow('defect'), hotfix: c.red('hotfix') };

export async function runThread(root, { epic, json = false } = {}) {
  if (!epic) {
    // List every distinct thread root in the project.
    const dir = path.join(root, 'epics');
    if (!exists(dir)) { log(c.red('no epics/ directory')); process.exitCode = 1; return; }
    const roots = new Set();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && isValidEpicId(e.name) && exists(path.join(dir, e.name, 'epic.md'))) {
        roots.add(resolveThread(root, e.name).rootId);
      }
    }
    log(c.bold('\nFeature threads'));
    for (const r of [...roots].sort()) {
      const s = threadSummary(root, r);
      const debt = s.openDebt.length ? c.red(`  ⚠ ${s.openDebt.length} open reconcile-debt`) : '';
      const stub = s.nodes[0]?.stub ? c.yellow('  [stub · backfill pending]') : '';
      log(`  ${c.bold(r)}  ${c.dim(`${s.nodes.length} epic(s)`)}${stub}${debt}`);
    }
    log(c.dim('\n  yad thread <epic>   show one thread in full'));
    return;
  }
  if (!isValidEpicId(epic)) { log(c.red(`invalid epic id: ${epic}`)); process.exitCode = 1; return; }
  const s = threadSummary(root, epic);
  if (json) { log(JSON.stringify(s, null, 2)); return; }

  log(c.bold(`\nThread ${s.thread}`) + c.dim('  (genesis → tip)'));
  if (s.broken) log(c.red(`  ✗ broken lineage: ${s.broken}`));
  for (const n of s.nodes) {
    const tag = KIND_TAG[n.kind] || n.kind;
    const seal = n.sealed ? c.dim(' [sealed]') : '';
    const stub = n.stub ? c.yellow(' [stub · backfill pending]') : '';
    const dep = n.depth ? c.dim(` ${n.depth}`) : '';
    log(`  • ${c.bold(n.id)}  ${tag}${dep}  ${c.dim('@ ' + n.currentStep)}${seal}${stub}`);
    if (n.parent) log(c.dim(`      parent: ${n.parent}   inherits: [${n.inherits.join(', ') || '—'}]`));
    if (n.defect) log(c.dim(`      defect: ${n.defect.severity || '?'} · escaped@${n.defect.escape_stage || '?'} · ${n.defect.root_cause || ''}`));
    if (n.brokenThread) log(c.red(`      ✗ ${n.brokenThread}`));
  }
  log(c.bold('\n  Current truth') + c.dim('  (authoritative source per artifact)'));
  for (const base of THREAD_ARTIFACT_BASES) {
    const v = s.resolved[base];
    const disp = Array.isArray(v) ? (v.length ? v.join(' + ') : c.dim('(none)')) : (v || c.dim('(none)'));
    log(`    ${base.padEnd(12)} ${c.dim('←')} ${disp}`);
  }
  const sids = Object.keys(s.resolvedStories).sort();
  if (sids.length) {
    log(c.dim(`    composed stories (${sids.length}): ` + sids.map((id) => `${id}←${s.resolvedStories[id]}`).join(', ')));
  }
  if (s.openDebt.length) {
    log(c.red('\n  ⚠ Open reconcile debt (blocks the next change until paid):'));
    for (const d of s.openDebt) log(`    ${d.epicId}: ${d.reason || ''} — requires [${(d.requires || []).join(', ')}]`);
  } else {
    log(c.green('\n  ✓ no open reconcile debt'));
  }
}

// ---- the change-reconciler (yad reconcile — advisory, never a gate) ------------------------------

// Distinct thread roots in the project.
function threadRoots(root) {
  const dir = path.join(root, 'epics');
  if (!exists(dir)) return [];
  const roots = new Set();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && isValidEpicId(e.name) && exists(path.join(dir, e.name, 'epic.md'))) {
      roots.add(resolveThread(root, e.name).rootId);
    }
  }
  return [...roots].sort();
}

export async function runReconcile(root, { action = 'check', thread = null } = {}) {
  const roots = thread ? [resolveThread(root, thread).rootId] : threadRoots(root);
  if (!roots.length) { info('no feature threads found (no epics with epic.md yet)'); return; }

  log(c.bold(`\nChange reconcile  ${c.dim(action)}`));
  let flags = 0;
  for (const r of roots) {
    const s = threadSummary(root, r);
    const issues = [];
    if (s.broken) issues.push(`broken lineage: ${s.broken}`);
    for (const n of s.nodes) if (n.brokenThread) issues.push(`${n.id}: ${n.brokenThread}`);
    for (const d of s.openDebt) issues.push(`open reconcile debt on ${d.epicId} — next change blocked until paid`);
    if (!issues.length) { ok(`${r} — clean`); continue; }
    flags += issues.length;
    warn(`${r}`);
    for (const i of issues) hand(i);
  }

  if (action === 'refresh') {
    log('');
    info('refresh is advisory: open a reconcile change-epic with `yad-change` (kind: change) threaded to');
    info('the affected feature, then pay any open debt (update artifacts + add a regression test).');
    info('for shipped brownfield code with NO epic at all, anchor it first with `yad-stub`, then thread');
    info('the change/defect off that stub (and run `yad-backfill` to make the anchor real).');
  }
  if (action === 'wire') {
    log('');
    info('wire installs an advisory CI job that runs `yad reconcile --check` on push (no block) — the');
    info('hard enforcement is the lineage-check / epic-open / reconcile-debt gates in yad-checks.');
  }

  log('');
  if (flags) { warn(`${flags} item(s) need attention — reconcile is advisory; the gates block at merge`); }
  else { ok('all threads reconciled — no drift, no open debt'); }
}
