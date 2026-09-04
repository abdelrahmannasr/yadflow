// Golden compatibility test — the alarm bell for the engine roadmap.
//
// `cli/fixtures/golden-v3/` is a REAL v3 project (this repo's own hub and its two EP-checkout epics)
// frozen exactly as it stood before Wave 1 began. This test runs the engine's three read-only views
// over it and compares them to a committed snapshot:
//
//   * `yad next --json`        — the one next action per epic (cli/next.mjs)
//   * `yad doctor --json`      — the deterministic half of its findings (cli/doctor.mjs)
//   * the gate predicate       — pass/fail + rule per review step (cli/epic-state.mjs)
//
// Roadmap rule (docs/roadmap-idea-1.md, Part 2 rule 6): a real v3 project, frozen — if it breaks, the
// change is wrong. No exceptions. So there is deliberately NO regeneration flag here. A diff in the
// snapshot is a finding to explain, not a file to refresh: updating `golden-v3.expected.json` means
// stating in the PR which behaviour changed and why that is intended.
//
// Why only two of doctor's four sections are snapshotted: `environment` embeds the running Node
// version, and `project` embeds the CLI version, the result of `gh auth status`, and the HEADs of
// repos that do not exist under a fixture. Those are facts about the machine, not about the project,
// so freezing them would make this test fail on a new laptop instead of on a real regression. The
// `epics` and `threads` sections are pure file reads and are byte-identical with or without `gh`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { runNext } from './next.mjs';
import { collectDoctor } from './doctor.mjs';
import { loadLedger, gatePredicate, artifactHash } from './epic-state.mjs';
import { touchedDomains, loadHub, isSolo, requireEngagement } from './gate.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const FIXTURE = path.join(ROOT, 'cli', 'fixtures', 'golden-v3');
export const EXPECTED = path.join(ROOT, 'cli', 'fixtures', 'golden-v3.expected.json');

// Sections of `yad doctor --json` that describe the PROJECT rather than the machine it runs on.
const FROZEN_SECTIONS = new Set(['epics', 'threads']);

// gate.mjs hardcodes one required reviewer for every gate (`defaultReviewers`, gate.mjs). Mirrored
// here rather than exported, so a change to that constant shows up as a snapshot diff to explain.
const DEFAULT_REVIEWERS = 1;

const sha256 = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`;

// Files the operating system leaves lying about, which are gitignored and are not part of any
// yadflow project. Finder writes .DS_Store just for browsing a folder, so without this a developer
// who opens the fixture directory gets a red test blaming a fixture edit that never happened.
const OS_JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|\._.*)$/;

// Every file in the fixture, by path, with its content hash — so editing the frozen project itself
// fails this test just as loudly as changing the engine does.
export function fileManifest(dir) {
  const out = {};
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const name of fs.readdirSync(abs).sort()) {
      if (OS_JUNK.test(name)) continue;
      const childRel = rel ? path.join(rel, name) : name;
      const st = fs.statSync(path.join(abs, name));
      if (st.isDirectory()) walk(childRel);
      else out[childRel.split(path.sep).join('/')] = sha256(fs.readFileSync(path.join(abs, name)));
    }
  };
  walk('');
  return out;
}

// Capture what a `--json` command prints. The JSON commands write with console.log (cli/lib.mjs
// `log`), so this is how the existing suite reads them too (`nextJSON` in cli/test.mjs).
async function grab(fn) {
  const orig = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = orig; }
  return lines.join('\n');
}

// The three views, in the shape the snapshot stores them.
export async function collectGolden(root) {
  // `version` is the CLI's own package version, which moves on every release and says nothing about
  // the project — drop it so a release cannot break the golden.
  const next = JSON.parse(await grab(() => runNext(root, { json: true })));
  delete next.version;

  // The real `yad doctor --json` entry point, filtered to the sections that describe the project.
  const doctor = collectDoctor(root).checks.filter((c) => FROZEN_SECTIONS.has(c.section));

  // The gate predicate, wired the way gateSync wires it (cli/gate.mjs). `threadsResolved` and
  // `merged` are the platform's answers, which a frozen fixture has no way to know; both are set
  // true so the snapshot isolates the part the predicate actually decides — the approval rule.
  const { hub } = loadHub(root);
  const solo = isSolo(hub);
  const reqEng = requireEngagement(hub);
  const gates = [];
  const epicsDir = path.join(root, 'epics');
  for (const epic of fs.readdirSync(epicsDir).sort()) {
    const epicDir = path.join(epicsDir, epic);
    if (!fs.statSync(epicDir).isDirectory()) continue;
    const ledger = loadLedger(epicDir);
    if (!ledger.state) continue;
    for (const step of ledger.state.steps.filter((s) => s.type === 'review+approve')) {
      // The hash comes from the step's OWN epic directory, unconditionally — exactly what gateSync
      // passes (`artifactHash(epicDir, pr.artifact)`, cli/gate.mjs). Resolving it any other way would
      // mean the snapshot froze this test's opinion instead of the engine's answer.
      //
      // One consequence is deliberate and worth knowing before reading the snapshot: an `inherited`
      // step (a change-epic carrying its parent's artifact by reference) is pre-marked `done`, so
      // gateSync never opens a PR for it and never evaluates it. Asking anyway is how this test
      // freezes the short-circuit's behaviour. Where the child happens to have its own file of the
      // same name, that hash is not the one `boundHash` was bound to, so the predicate reports drift.
      // That recorded `false` is the engine's answer to a question production does not ask — it is a
      // frozen behaviour, NOT a finding about the health of the frozen project.
      const pred = gatePredicate({
        step,
        approvals: ledger.approvals,
        currentHash: artifactHash(epicDir, step.artifact),
        touchedDomains: touchedDomains(epicDir, step),
        defaultReviewers: DEFAULT_REVIEWERS,
        threadsResolved: true,
        merged: true,
        solo,
        requireEngagement: reqEng,
      });
      gates.push({ epic, step: step.id, ...pred });
    }
  }

  return { next, doctor, gates };
}

test('golden v3: the frozen project still reads exactly as it did', async () => {
  const expected = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));

  // The fixture is read-only input, but `next` and `doctor` are the engine's own code paths and a
  // regression could start writing. Run against a throwaway copy, then prove the original is intact.
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-golden-'));
  try {
    const before = fileManifest(FIXTURE);
    assert.deepEqual(before, expected.files,
      'the frozen v3 project itself changed — golden-v3/ is an archive, not a working project');

    fs.cpSync(FIXTURE, T, { recursive: true });
    const actual = await collectGolden(T);

    assert.deepEqual(actual.next, expected.next, '`yad next --json` changed on the frozen v3 project');
    assert.deepEqual(actual.doctor, expected.doctor, '`yad doctor --json` changed on the frozen v3 project');
    assert.deepEqual(actual.gates, expected.gates, 'the gate predicate changed on the frozen v3 project');

    assert.deepEqual(fileManifest(T), expected.files,
      'a read-only command wrote to the project — next/doctor/gatePredicate must not mutate state');
    assert.deepEqual(fileManifest(FIXTURE), before, 'the fixture was modified while the test ran');
  } finally {
    fs.rmSync(T, { recursive: true, force: true });
  }
});

test('golden v3: reading it twice gives the same answer', async () => {
  // A snapshot is only worth committing if the thing it snapshots is deterministic. This catches a
  // future dependency on the clock, the working directory, or iteration order before it can bake a
  // machine-specific value into the expected file.
  //
  // Also runs on a copy: node:test still runs this test after the one above fails, so reading the
  // real archive here would let the very regression that test guards against (a read-only command
  // that starts writing) dirty the committed fixture on the developer's disk.
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-golden-det-'));
  try {
    fs.cpSync(FIXTURE, T, { recursive: true });
    const a = await collectGolden(T);
    const b = await collectGolden(T);
    assert.deepEqual(a, b, 'the engine gave two different answers for the same unchanged project');
  } finally {
    fs.rmSync(T, { recursive: true, force: true });
  }
});
