// Property-based tests: fast-check feeds each function many random inputs and checks a rule that must
// hold for every one of them. The targets read text yadflow does not control — a branch name from a PR,
// a folder name from a CODEOWNERS-style map, a version string from the registry.
//
// A `.js` file, not `.mjs`, because OpenSSF Scorecard's Fuzzing check only looks in `*.js` / `*.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parseReviewBranch, artifactFromBase } from './epic-state.mjs';
import { folderPathspec } from './riskmap.mjs';
import { parseVersion, normalizeVersion, isNewer } from './update-notice.mjs';

const RUNS = { numRuns: 2000 };

// Text of any kind, weighted towards the characters that mean something to git, a shell or a regex.
const nasty = fc.string({
  unit: fc.oneof(
    fc.constantFrom('/', '\\', '*', '?', '[', ']', ':', '(', ')', '$', '`', ';', '\n', ' ', '.', '-', 'E', 'P', 'a', '0'),
    fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
  ),
  maxLength: 40,
});

// The glob characters folderPathspec must escape, with the backslash that escapes them.
const GLOB = new Set(['\\', '*', '?', '[']);

test('folderPathspec: a folder name never becomes glob syntax, and matches only its own files', () => {
  fc.assert(fc.property(nasty, (dir) => {
    fc.pre(dir !== './');
    const spec = folderPathspec(dir);
    assert.ok(spec.startsWith(':(glob)'), 'one magic prefix');
    const body = spec.slice(':(glob)'.length);
    assert.ok(body.endsWith('*'), 'ends with the one wildcard');
    // Undo the escaping; every glob character in the name must have been escaped, so what is left is
    // exactly the name, and the only wildcard is the final one.
    let out = '';
    for (let i = 0; i < body.length - 1; i++) {
      if (body[i] === '\\') { assert.ok(GLOB.has(body[i + 1]), `escape before ${JSON.stringify(body[i + 1])}`); out += body[++i]; }
      else { assert.ok(!GLOB.has(body[i]), `unescaped ${JSON.stringify(body[i])}`); out += body[i]; }
    }
    assert.equal(out, dir);
  }), RUNS);
});

test('parseReviewBranch: any branch name gives null or a safe EP id, and round-trips', () => {
  fc.assert(fc.property(fc.oneof(nasty, nasty.map((s) => `review/EP-${s}`), nasty.map((s) => `review/${s}`)), (branch) => {
    const r = parseReviewBranch(branch);
    if (r === null) return;
    // The epic id reaches paths and log lines, so it may only hold the characters an EP id allows.
    assert.match(r.epic, /^EP-[a-z0-9-]+$/);
    assert.ok(r.base.length > 0);
    assert.equal(`review/${r.epic}/${r.base}`, branch);
    assert.equal(typeof artifactFromBase(r.base), 'string');
  }), RUNS);
});

const version = fc.tuple(fc.nat(50), fc.nat(50), fc.nat(50), fc.option(fc.constantFrom('rc.1', 'rc.2', 'next.3', 'beta'), { nil: null }))
  .map(([a, b, c, pre]) => `${a}.${b}.${c}${pre ? `-${pre}` : ''}`);
const versionish = fc.oneof(version, version.map((v) => `v${v}`), nasty);

test('update notice: versions parse to their own normal form, and "newer" is a strict order', () => {
  fc.assert(fc.property(versionish, versionish, (a, b) => {
    const n = normalizeVersion(a);
    if (n !== null) {
      assert.equal(normalizeVersion(n), n, 'normal form is stable');
      assert.ok(parseVersion(n));
    }
    assert.equal(isNewer(a, a), false, 'never newer than itself');
    assert.ok(!(isNewer(a, b) && isNewer(b, a)), `${a} and ${b} are not each newer than the other`);
  }), RUNS);
});
