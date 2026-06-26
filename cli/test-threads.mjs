// Phase 6 feature-thread engine tests. Run: node --test cli/test-threads.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveThread, threadEpics, resolveCurrentArtifacts, epicLineage, gatePredicate,
} from './epic-state.mjs';
import { sealedEpic, openDebtOnThread, threadSummary } from './thread.mjs';

// Minimal hub builder: write an epic with lineage frontmatter (+ optional stories/lock/debt).
function hub() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-thread-'));
  fs.mkdirSync(path.join(T, 'epics'), { recursive: true });
  return T;
}
function writeEpic(T, id, fm, { stories = null, lockHash = null, debt = null } = {}) {
  const dir = path.join(T, 'epics', id);
  fs.mkdirSync(path.join(dir, '.sdlc'), { recursive: true });
  const front = Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n');
  fs.writeFileSync(path.join(dir, 'epic.md'), `---\nid: ${id}\n${front}\n---\n\n## Goal\nx\n`);
  if (stories) {
    fs.mkdirSync(path.join(dir, 'stories'), { recursive: true });
    stories.forEach((st, i) => fs.writeFileSync(
      path.join(dir, 'stories', `${id}-S0${i + 1}.md`),
      `---\nid: ${id}-S0${i + 1}\nepic: ${id}\nstatus: ${st}\nrepos: [backend]\n---\n\n## Story\nx\n`,
    ));
  }
  if (lockHash) fs.writeFileSync(path.join(dir, '.sdlc/contract-lock.json'), JSON.stringify({ artifact: 'contract.md', hash: lockHash }));
  if (debt) fs.writeFileSync(path.join(dir, '.sdlc/reconcile-debt.json'), JSON.stringify(debt));
  return dir;
}

test('resolveThread: linear chain resolves genesis-first with the genesis root', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  writeEpic(T, 'EP-chg', { kind: 'change', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic', 'architecture'] });
  writeEpic(T, 'EP-fix', { kind: 'defect', parent: 'EP-chg', thread: 'EP-gen', inherits: ['epic'] });

  const r = resolveThread(T, 'EP-fix');
  assert.equal(r.rootId, 'EP-gen');
  assert.deepEqual(r.chain, ['EP-gen', 'EP-chg', 'EP-fix']);
  assert.equal(r.broken, null);
  // threadEpics groups everything sharing the root, genesis-first.
  assert.deepEqual(threadEpics(T, 'EP-chg'), ['EP-gen', 'EP-chg', 'EP-fix']);
});

test('resolveThread: a missing parent and a thread-cache mismatch are flagged broken', () => {
  const T = hub();
  writeEpic(T, 'EP-orphan', { kind: 'change', parent: 'EP-ghost', thread: 'EP-ghost' });
  assert.match(resolveThread(T, 'EP-orphan').broken, /missing parent epic EP-ghost/);

  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  writeEpic(T, 'EP-bad', { kind: 'change', parent: 'EP-gen', thread: 'EP-wrong' });
  assert.match(resolveThread(T, 'EP-bad').broken, /thread cache 'EP-wrong' != computed root 'EP-gen'/);
});

test('resolveThread: a cycle is detected, not looped forever', () => {
  const T = hub();
  writeEpic(T, 'EP-a', { kind: 'change', parent: 'EP-b', thread: 'EP-a' });
  writeEpic(T, 'EP-b', { kind: 'change', parent: 'EP-a', thread: 'EP-a' });
  assert.match(resolveThread(T, 'EP-a').broken, /cycle/);
});

test('resolveCurrentArtifacts: a defect-epic owns only what it re-authored; genesis owns the rest', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  // defect-fix: inherits epic/architecture/contract/ui-design, re-authors stories + test-cases.
  writeEpic(T, 'EP-fix', {
    kind: 'defect', parent: 'EP-gen', thread: 'EP-gen',
    inherits: ['epic', 'architecture', 'contract', 'ui-design'],
  });
  const owner = resolveCurrentArtifacts(T, 'EP-gen');
  assert.equal(owner.epic, 'EP-gen');
  assert.equal(owner.architecture, 'EP-gen');
  assert.equal(owner.contract, 'EP-gen');
  assert.equal(owner['ui-design'], 'EP-gen');
  assert.equal(owner.stories, 'EP-fix');       // re-authored by the defect
  assert.equal(owner['test-cases'], 'EP-fix');  // re-authored by the defect
});

test('resolveCurrentArtifacts: a later contract-surface change shadows architecture+contract', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' });
  writeEpic(T, 'EP-fix', { kind: 'defect', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic', 'architecture', 'contract', 'ui-design'] });
  // contract-surface change re-authors architecture + contract (omits them from inherits).
  writeEpic(T, 'EP-surf', { kind: 'change', parent: 'EP-fix', thread: 'EP-gen', inherits: ['epic', 'ui-design'] });
  const owner = resolveCurrentArtifacts(T, 'EP-gen');
  assert.equal(owner.architecture, 'EP-surf');
  assert.equal(owner.contract, 'EP-surf');
  assert.equal(owner.stories, 'EP-surf');       // EP-surf re-authored stories too
  assert.equal(owner['test-cases'], 'EP-surf');
  assert.equal(owner.epic, 'EP-gen');            // never re-authored
});

test('gatePredicate: an inherited step is satisfied without re-review; a drifted boundHash fails', () => {
  const inherited = { id: 'architecture-review', inherited: true, inheritedFrom: 'EP-gen', boundHash: 'sha256:abc' };
  // No approvals at all, but inherited -> passes (the approval lives upstream).
  const ok = gatePredicate({ step: inherited, approvals: [], currentHash: 'sha256:abc' });
  assert.equal(ok.passed, true);
  assert.equal(ok.rule, 'inherited');
  // boundHash != current hash -> corruption, fails (re-thread).
  const drift = gatePredicate({ step: inherited, approvals: [], currentHash: 'sha256:DIFFERENT' });
  assert.equal(drift.passed, false);
  assert.match(drift.missing[0], /drifted/);
  // A normal (non-inherited) step still needs approvals (regression guard).
  const normal = gatePredicate({ step: { id: 'stories-review' }, approvals: [], currentHash: null });
  assert.equal(normal.passed, false);
});

test('sealedEpic + openDebtOnThread + threadSummary reflect ship + debt state', () => {
  const T = hub();
  writeEpic(T, 'EP-gen', { kind: 'feature', thread: 'EP-gen' }, { stories: ['shipped', 'shipped'] });
  assert.equal(sealedEpic(T, 'EP-gen'), true);                 // all stories shipped -> sealed
  writeEpic(T, 'EP-open', { kind: 'feature', thread: 'EP-open' }, { stories: ['shipped', 'draft'] });
  assert.equal(sealedEpic(T, 'EP-open'), false);               // one draft -> open
  assert.equal(sealedEpic(T, 'EP-gen'), true);

  // A hotfix on the EP-gen thread with open debt.
  writeEpic(T, 'EP-hot', { kind: 'hotfix', parent: 'EP-gen', thread: 'EP-gen', inherits: ['epic'] },
    { debt: [{ thread: 'EP-gen', epicId: 'EP-hot', status: 'open', reason: 'outage', requires: ['artifacts-updated', 'regression-test'] }] });
  const open = openDebtOnThread(T, 'EP-gen');
  assert.equal(open.length, 1);
  assert.equal(open[0].epicId, 'EP-hot');

  const s = threadSummary(T, 'EP-gen');
  assert.equal(s.thread, 'EP-gen');
  assert.equal(s.openDebt.length, 1);
  assert.ok(s.nodes.find((n) => n.id === 'EP-gen').sealed);
});

test('epicLineage defaults an un-migrated genesis epic to kind:feature', () => {
  const T = hub();
  // No kind/parent/thread frontmatter at all.
  const dir = path.join(T, 'epics', 'EP-legacy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'epic.md'), '---\nid: EP-legacy\nrepos: [backend]\n---\n\n## Goal\nx\n');
  const lin = epicLineage(T, 'EP-legacy');
  assert.equal(lin.kind, 'feature');
  assert.equal(lin.parent, null);
  assert.deepEqual(resolveThread(T, 'EP-legacy').chain, ['EP-legacy']);
});
