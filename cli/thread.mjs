// `yad thread` (read-only: print a feature thread + its resolved current artifacts) and
// `yad reconcile` (Phase 6 change-reconciler: flag orphan drift + open hotfix debt, never a gate —
// mirrors `yad docs sync`). The hard merge BLOCK is the CI gates (lineage-check / reconcile-debt);
// this only DISCOVERS, exactly as yad-docs-sync flags and the build gates block. Node built-ins only.
import path from 'node:path';
import fs from 'node:fs';
import { c, log, ok, info, warn, hand, readJSON, exists, emitJSON, refuse, forTerminal } from './lib.mjs';
import { readShips } from './ledger.mjs';
import { shipDrift } from './ship-drift.mjs';
import {
  epicRoot, isValidEpicId, epicLineage, readFrontmatter, isStubEpic, typeNoun, currentPhase, isProductLevel,
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
// what keeps the Shape artifacts from going stale. An epic with no stories is NOT sealed (nothing built).
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
      // `type` is the word from shape 5 on; `kind` is the same value under the name this key has
      // always had. Both are emitted for one major so a script reading either keeps working.
      id, type: lin.type, kind: lin.type, parent: lin.parent, inherits: lin.inherits,
      // The free grouping tag from epic.md (E31), null when unset. This is the only machine-readable
      // surface that carries it: `yad next --json` is frozen by the golden test and cannot gain a key.
      theme: lin.theme,
      currentStep: state?.currentStep || 'unseeded',
      // Which of the six phases this epic is in — the same answer `yad next` prints, from the same
      // function. Null is a real answer, not a gap: a stub and any step id this release does not
      // recognise have no phase, and neither is guessed at. (The product level never reaches here —
      // a thread is built from epics with an `epic.md` — but the same predicate is asked anyway.)
      phase: currentPhase(state?.currentStep, { product: isProductLevel(state) }),
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

// Colour a node's type noun for the tree render. The noun words live in one place (`typeNoun`); this
// only layers the per-type colour on top, so the two never drift. Unknown type → uncoloured noun.
const TYPE_COLOR = {
  feature: c.green, change: c.cyan, defect: c.yellow, hotfix: c.red, chore: c.dim,
};
const typeTag = (t) => (TYPE_COLOR[t] || ((s) => s))(typeNoun(t));

export async function runThread(root, { epic, json = false } = {}) {
  if (!epic) {
    // List every distinct thread root in the project.
    const dir = path.join(root, 'epics');
    if (!exists(dir)) return refuse('no epics/ directory', null, { json });
    const roots = new Set();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && isValidEpicId(e.name) && exists(path.join(dir, e.name, 'epic.md'))) {
        roots.add(resolveThread(root, e.name).rootId);
      }
    }
    log(c.bold('\nFeature threads'));
    // The --json answer (E1): one line per thread, as the list prints it.
    const threads = [];
    for (const r of [...roots].sort()) {
      const s = threadSummary(root, r);
      threads.push({ thread: r, theme: s.nodes[0]?.theme ?? null, epics: s.nodes.length, stub: !!s.nodes[0]?.stub, openDebt: s.openDebt.length });
      const debt = s.openDebt.length ? c.red(`  ⚠ ${s.openDebt.length} open reconcile-debt`) : '';
      const stub = s.nodes[0]?.stub ? c.yellow('  [stub · backfill pending]') : '';
      // The genesis epic's grouping theme (E31). This list is where a person looks to see which
      // threads belong together, so it is the one place the tag earns its keep most.
      const theme = s.nodes[0]?.theme ? c.dim(` #${forTerminal(s.nodes[0].theme)}`) : '';
      log(`  ${c.bold(r)}${theme}  ${c.dim(`${s.nodes.length} epic(s)`)}${stub}${debt}`);
    }
    log(c.dim('\n  yad thread <epic>   show one thread in full'));
    if (json) return emitJSON({ threads });
    return { threads };
  }
  if (!isValidEpicId(epic)) return refuse(`invalid epic id: ${epic}`, null, { json });
  const s = threadSummary(root, epic);
  if (json) { emitJSON(s); return; }

  log(c.bold(`\nThread ${s.thread}`) + c.dim('  (genesis → tip)'));
  if (s.broken) log(c.red(`  ✗ broken lineage: ${s.broken}`));
  for (const n of s.nodes) {
    const tag = typeTag(n.type);
    const seal = n.sealed ? c.dim(' [sealed]') : '';
    const stub = n.stub ? c.yellow(' [stub · backfill pending]') : '';
    const dep = n.depth ? c.dim(` ${forTerminal(n.depth)}`) : '';
    // The grouping theme prints only when there is one. An epic with no theme is normal, and an
    // empty `theme: —` on every line would be noise on a surface people read top to bottom.
    const theme = n.theme ? c.dim(` #${forTerminal(n.theme)}`) : '';
    log(`  • ${c.bold(n.id)}  ${tag}${dep}${theme}  ${c.dim('@ ' + forTerminal(n.currentStep))}${seal}${stub}`);
    if (n.parent) log(c.dim(`      parent: ${n.parent}   inherits: [${n.inherits.join(', ') || '—'}]`));
    if (n.defect) log(c.dim(`      defect: ${forTerminal(n.defect.severity || '?')} · escaped@${forTerminal(n.defect.escape_stage || '?')} · ${forTerminal(n.defect.root_cause || '')}`));
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
    for (const d of s.openDebt) log(`    ${forTerminal(d.epicId)}: ${forTerminal(d.reason || '')} — requires [${(d.requires || []).map(forTerminal).join(', ')}]`);
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

export async function runReconcile(root, { action = 'check', thread = null, runner, env } = {}) {
  const roots = thread ? [resolveThread(root, thread).rootId] : threadRoots(root);
  if (!roots.length) { info('no feature threads found (no epics with epic.md yet)'); return { action, flags: 0, threads: [] }; }

  log(c.bold(`\nChange reconcile  ${c.dim(action)}`));
  let flags = 0;
  const threads = [];   // the --json answer (E1)
  for (const r of roots) {
    const s = threadSummary(root, r);
    const issues = [];
    if (s.broken) issues.push(`broken lineage: ${s.broken}`);
    for (const n of s.nodes) if (n.brokenThread) issues.push(`${n.id}: ${n.brokenThread}`);
    for (const d of s.openDebt) issues.push(`open reconcile debt on ${d.epicId} — next change blocked until paid`);
    threads.push({ thread: r, clean: !issues.length, issues });
    if (!issues.length) { ok(`${r} — clean`); continue; }
    flags += issues.length;
    warn(`${r}`);
    for (const i of issues) hand(i);
  }

  // #365: merged work the build ledger does not record — a merged task with no ship record, a story whose
  // repos all hold merged work but whose status is not `shipped` (a hint), and possible matches to check by
  // hand. `check` only: it reads every repo's history and may ask the platform (review 1).
  let ships = null;
  let unknown = 0;
  if (action === 'check') {
    const drift = shipDrift(root, { epics: thread ? new Set(threadEpics(root, roots[0])) : null, ...(runner ? { runner } : {}), ...(env ? { env } : {}) });
    ships = drift;
    if (drift.repos.length || drift.unreadEpics.length || drift.registry || drift.uncompared.length) {
      log(c.bold('\nBuild records'));
      const short = (sha) => (sha ? sha.slice(0, 7) : null);
      if (drift.registry) warn(`.sdlc/repos.json could not be read in full — ${drift.registry}; merged work in what it lists is unknown`);
      for (const r of drift.repos) {
        if (!r.read) warn(`${forTerminal(r.repo)}: not read — ${forTerminal(r.why)}`);
        else (r.partial ? warn : info)(`${forTerminal(r.repo)}: read ${forTerminal(r.ref)} at ${short(r.sha)} (this clone's view — nothing fetched)${r.note ? `; ${forTerminal(r.note)}` : ''}`);
      }
      for (const e of drift.unreadEpics) warn(`${e}: its build ledger could not be read — \`yad doctor\` says why`);
      for (const st of drift.uncompared) warn(`${st}: not compared — it names no repo while the Product registers more than one (add \`repos: [...]\`), or two story files claim its ID`);
      for (const f of drift.findings) {
        if (f.kind === 'merged-no-ship') {
          const where = [short(f.sha), f.pr != null ? `PR/MR ${f.pr}` : null].filter(Boolean).join(', ');
          warn(`${f.story}-${f.task} merged in ${forTerminal(f.repo)} (${where || 'no commit named'}, by ${f.via}) — no ship record`);
          hand(forTerminal(f.fix));
        } else if (f.kind === 'looks-shipped') {
          info(`${f.story}: ${f.fallback ? `the one registered repo (${f.repos.map(forTerminal).join(', ')}), used because it names none,` : `every repo it names (${f.repos.map(forTerminal).join(', ')})`} has merged work, but its status is ${forTerminal(f.status || 'unset')} — if no task is left, set \`status: shipped\` (\`yad checkpoint\` commits it with the ledger)`);
        } else if (f.kind === 'no-story') {
          warn(`${f.task} merged in ${forTerminal(f.repo)} (${short(f.sha) || 'no commit named'}) — ${f.epic} has no story ${f.task.replace(/-T\d+$/, '')}; a typo in its Task trailer, or a story file missing`);
        } else {
          info(`${forTerminal(f.repo)} ${short(f.sha)}: ${f.via} — a possible match for ${f.stories.join(', ')}; check by hand`);
        }
      }
      const counted = drift.findings.filter((f) => f.kind === 'merged-no-ship' || f.kind === 'no-story').length;
      flags += counted;
      // Never an all-clear over what was not read, or read in part (review 2): each such repo, ledger or
      // registry is counted as unknown, and the closing line says so too.
      unknown = drift.repos.filter((r) => !r.read || r.partial).length + drift.unreadEpics.length + drift.uncompared.length + (drift.registry ? 1 : 0);
      // The merged tasks it can record on its own: `yad build sync` (#365) runs `yad build ship` for each.
      const syncEpics = [...new Set(drift.findings.filter((f) => f.kind === 'merged-no-ship').map((f) => f.epic))].sort();
      // Scoped to a thread, it names those epics: a bare `yad build sync` would sync every epic.
      if (syncEpics.length) hand(`${thread ? syncEpics.map((e) => `\`yad build sync ${e}\``).join(', ') : '`yad build sync`'} records these through \`yad build ship\`, and sets each story shipped once every task is — what it cannot record, it lists`);
      if (!counted && !unknown) ok('every merged task has a ship record');
      else if (!counted) info(`no merged task without a ship record in what was read — ${unknown} repo(s), ledger(s), stories or registry not read in full, so merged work there is unknown`);
    }
  }

  if (action === 'refresh') {
    log('');
    info('refresh is advisory: open a reconcile change-epic with `yad-change` (type change) threaded to');
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
  else if (unknown) { info(`no drift and no open debt found — but ${unknown} repo(s), ledger(s), stories or registry were not read in full`); }
  else { ok('all threads reconciled — no drift, no open debt'); }
  return { action, flags, threads, ...(ships ? { ships } : {}) };
}
