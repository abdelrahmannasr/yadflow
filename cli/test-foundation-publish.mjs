// E174: the approved roadmap becomes work items in the Product repo. The rules each test pins:
//   - only after the Foundation review; a parked phase is left out;
//   - one item per row, with the phase's priority, its milestone and `epic: EP-x`;
//   - re-running creates only new rows, and a lost record plus the body marker creates no duplicate;
//   - a failed read of what is already there creates nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.YAD_NO_UPDATE_NOTIFIER = '1';
process.env.YAD_PLATFORM_LOGIN = '0';
if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}

const P = await import('./foundation-publish.mjs');
const { runFoundationNew } = await import('./epic.mjs');
const env = { PATH: process.env.PATH };
const done = (b) => ({ ok: true, code: 0, stdout: JSON.stringify(b), stderr: '' });
const no = (e) => ({ ok: false, code: 1, stdout: '', stderr: e });
const reset = () => { process.exitCode = 0; };
const ROADMAP = `## Summary\nx\n\n## Phase 1 — MVP\n| Feature | Proposed epic id | Status |\n|---|---|---|\n| Sign up | EP-signup | planned |\n| Checkout | EP-checkout | planned |\n\n## Phase 2 — Growth\n| Feature | Proposed epic id | Status |\n|---|---|---|\n| Referrals | EP-referrals | planned |\n\n## Phase 3 — Scale\n| Feature | Proposed epic id | Status |\n|---|---|---|\n| Teams | EP-teams | planned |\n\n## Later / parked\n| Feature | Proposed epic id | Status |\n|---|---|---|\n| Crypto | EP-crypto | planned |\n`;

async function product(platform = 'github', { approved = true } = {}) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-pub-'));
  fs.mkdirSync(path.join(T, '.sdlc'));
  const host = platform === 'github' ? 'github.com' : 'gitlab.com';
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform, git_url: `git@${host}:a/p.git` }));
  fs.writeFileSync(path.join(T, '.sdlc/repos.json'), JSON.stringify({ repos: [] }));
  await runFoundationNew(T, { today: '2026-11-10', json: false });
  fs.writeFileSync(path.join(T, 'foundation/roadmap.md'), ROADMAP);
  const sp = path.join(T, 'foundation/.sdlc/state.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  if (approved) { st.currentStep = 'foundation-done'; fs.writeFileSync(sp, JSON.stringify(st)); }
  return T;
}

function fake(platform = 'github', { existing = [], listFails = false, milestones = [], dropLabels = false } = {}) {
  const gh = platform === 'github';
  const created = [];
  const posts = [];
  let next = 40;
  const runner = (cmd, args) => {
    if (cmd === 'which' || cmd === 'where' || args[0] === 'auth') return { ok: true, code: 0, stdout: '', stderr: '' };
    const xi = args.indexOf('-X');
    const at = xi < 0 ? args.find((a) => /^(repos|projects)\//.test(a)) : args[xi + 2];
    if (xi >= 0) {
      posts.push(args);
      if (/\/milestones$/.test(at)) return done({ number: 7, id: 7 });
      if (/\/labels$/.test(at)) return done({});
      if (/\/issues$/.test(at)) {
        const labels = gh ? args.filter((a) => a.startsWith('labels[]=')).map((a) => a.slice(9)) : (args.find((a) => a.startsWith('labels=')) || '').slice(7).split(',');
        const n = next++;
        const ms = args.find((a) => /^milestone(_id)?=/.test(a));
        created.push({ n, args });
        return done({ number: n, iid: n, html_url: `https://x/${n}`, web_url: `https://x/${n}`, labels: dropLabels ? [] : labels, milestone: ms ? { number: 7, id: 7 } : null });
      }
      return done({});
    }
    if (/\/issues\?/.test(at)) { if (listFails) return no('HTTP 502'); const want = decodeURIComponent((at.match(/labels=([^&]+)/) || [])[1] || ''); return done(existing.filter((e) => (e.labels ?? []).includes(want)).map((e) => ({ number: e.number, iid: e.number, body: e.body, description: e.body, labels: e.labels }))); }
    if (/\/milestones\?/.test(at)) return done(milestones);
    if (/\/labels\?/.test(at)) return done([]);
    if (/\/issues\/\d+$/.test(at)) return done({ number: 41, iid: 41, title: 'x', body: '', state: 'open', html_url: 'https://x/41', web_url: 'https://x/41', labels: [], assignees: [] });
    return no('unexpected');
  };
  return { runner, created, posts };
}
const field = (args, name) => args.filter((a) => a.startsWith(`${name}=`)).map((a) => a.slice(name.length + 1));

test('roadmapRows: priority by phase, parked left out, first id wins', () => {
  const rows = P.roadmapRows(ROADMAP + '\n## Phase 4\n| Feature | Proposed epic id |\n|---|---|\n| Again | EP-signup |\n');
  assert.deepEqual(rows.map((r) => [r.epicId, r.priority, r.phase]), [['EP-signup', 'P1', 'Phase 1 — MVP'], ['EP-checkout', 'P1', 'Phase 1 — MVP'], ['EP-referrals', 'P2', 'Phase 2 — Growth'], ['EP-teams', 'P3', 'Phase 3 — Scale']]);
});

test('refused before the Foundation review has passed', async () => {
  const T = await product('github', { approved: false }); const f = fake();
  await P.runFoundationPublish(T, { env, runner: f.runner });
  assert.equal(f.posts.length, 0); assert.equal(process.exitCode, 1); reset();
});

test('one item per row, with labels, priority and the phase milestone; the record is written', async () => {
  const T = await product(); const f = fake();
  const r = await P.runFoundationPublish(T, { json: true, env, runner: f.runner });
  assert.equal(r.ok, true);
  assert.equal(f.created.length, 4);
  const first = f.created[0].args;
  assert.deepEqual(field(first, 'labels[]').sort(), ['epic: EP-signup', 'feature', 'priority: P1']);
  assert.ok(field(first, 'body')[0].includes('<!-- yad-roadmap: EP-signup -->'));
  assert.ok(f.posts.some((a) => a.includes('title=Phase 1 — MVP')));
  const teams = f.created.find((c) => field(c.args, 'title')[0] === 'Teams').args;
  assert.ok(field(teams, 'labels[]').includes('priority: P3'));
  const rec = JSON.parse(fs.readFileSync(path.join(T, 'foundation/.sdlc/roadmap-items.json'), 'utf8')).items;
  assert.deepEqual(rec.map((e) => e.epicId), ['EP-signup', 'EP-checkout', 'EP-referrals', 'EP-teams']);
});

test('re-running creates nothing new; a lost record plus the marker creates no duplicate', async () => {
  const T = await product(); const f = fake();
  await P.runFoundationPublish(T, { env, runner: f.runner });
  const g = fake();
  const r = await P.runFoundationPublish(T, { json: true, env, runner: g.runner });
  assert.equal(g.created.length, 0); assert.equal(r.alreadyPublished, 4);
  fs.rmSync(path.join(T, 'foundation/.sdlc/roadmap-items.json'));
  const h = fake('github', { existing: [{ number: 5, body: 'x <!-- yad-roadmap: EP-signup -->', labels: ['epic: EP-signup'] }] });
  const s = await P.runFoundationPublish(T, { json: true, env, runner: h.runner });
  assert.equal(h.created.length, 3);
  assert.deepEqual(s.recovered.map((x) => x.epicId), ['EP-signup']);
});

test('a failed read of what is on the repo creates nothing; dry-run writes nothing', async () => {
  const T = await product(); const f = fake('github', { listFails: true });
  await P.runFoundationPublish(T, { env, runner: f.runner });
  assert.equal(f.posts.length, 0); assert.equal(process.exitCode, 1); reset();
  const g = fake();
  const r = await P.runFoundationPublish(T, { dryRun: true, json: true, env, runner: g.runner });
  assert.equal(g.posts.length, 0); assert.equal(r.created.length, 4);
  assert.equal(fs.existsSync(path.join(T, 'foundation/.sdlc/roadmap-items.json')), false);
});

test('an existing milestone is reused; dropped labels are a failure', async () => {
  const T = await product(); const f = fake('github', { milestones: [{ title: 'Phase 1 — MVP', number: 3 }] });
  await P.runFoundationPublish(T, { env, runner: f.runner });
  assert.equal(f.posts.some((a) => a.includes('title=Phase 1 — MVP') && a.some((x) => /\/milestones$/.test(x))), false);
  assert.ok(f.created[0].args.includes('milestone=3'));
  const U = await product(); const g = fake('github', { dropLabels: true });
  const r = await P.runFoundationPublish(U, { json: true, env, runner: g.runner });
  assert.equal(r.ok, false); reset();
});

// #512 review 2: every new item lost its labels, so none is `created` — but each was recorded, so the record
// changed and the commit hint still shows. On a verified Product it names the PR route.
test('#512: the commit hint shows whenever the record was written, with the PR route on a verified Product', async () => {
  const T = await product();
  fs.writeFileSync(path.join(T, '.sdlc/product.json'), JSON.stringify({ platform: 'github', git_url: 'git@github.com:a/p.git', ledger: 'verified' }));
  const lines = [];
  const orig = process.stderr.write; const origLog = console.log; const origErr = console.error;
  process.stderr.write = (x) => { lines.push(String(x)); return true; };
  console.log = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  try { await P.runFoundationPublish(T, { env, runner: fake('github', { dropLabels: true }).runner }); } finally { process.stderr.write = orig; console.log = origLog; console.error = origErr; }
  assert.ok(fs.existsSync(path.join(T, 'foundation/.sdlc/roadmap-items.json')));
  assert.match(lines.join('\n'), /commit foundation\/\.sdlc\/roadmap-items\.json on a branch of its own, not review\/…, in a PR titled like `chore: record tracker links`/);
  reset();
});

test('GitLab: labels as one field and milestone_id', async () => {
  const T = await product('gitlab'); const f = fake('gitlab');
  await P.runFoundationPublish(T, { env, runner: f.runner });
  const a = f.created[0].args;
  assert.ok(a.some((x) => x.startsWith('labels=') && x.includes('epic: EP-signup')));
  assert.ok(a.includes('milestone_id=7'));
  assert.equal(a.some((x) => x.includes('[]')), false);
});

test('a feature whose epic exists is linked', async () => {
  const T = await product();
  const { runEpicNew } = await import('./epic.mjs');
  await runEpicNew(T, { slug: 'signup', type: 'feature', today: '2026-11-10', json: true, returnResult: true });
  const f = fake();
  const r = await P.runFoundationPublish(T, { json: true, env, runner: f.runner });
  assert.deepEqual(r.linked.map((x) => x.epicId), ['EP-signup']);
  const links = JSON.parse(fs.readFileSync(path.join(T, 'epics/EP-signup/.sdlc/issue-links.json'), 'utf8')).items;
  assert.equal(links.length, 1);
  reset();
});

test('foundation status shows each published item; an unreadable record is refused, never overwritten', async () => {
  const T = await product(); const f = fake();
  await P.runFoundationPublish(T, { env, runner: f.runner });
  assert.equal(P.publishedItems(T).get('EP-signup').number, 40);
  const p = path.join(T, 'foundation/.sdlc/roadmap-items.json');
  fs.writeFileSync(p, '{broken');
  await assert.rejects(P.runFoundationPublish(T, { env, runner: fake().runner }));
  assert.equal(fs.readFileSync(p, 'utf8'), '{broken');
  assert.equal(P.publishedItems(T), null);
});

test('the real yad command reaches publish', async () => {
  const { execFileSync } = await import('node:child_process');
  const T = await product();
  const bin = new URL('../bin/yad.mjs', import.meta.url).pathname;
  let out;
  try { out = execFileSync(process.execPath, [bin, 'foundation', 'publish', '--dry-run', '--dir', T, '--json'], { env: { ...process.env, YAD_PLATFORM_READ: '0' }, encoding: 'utf8' }); } catch (e) { out = String(e.stdout); }
  assert.match(out, /turned off/);
  assert.doesNotMatch(out, /unknown foundation action/);
});

test('E174 review: only the parked heading itself is parked, and it is said', () => {
  const skipped = [];
  const rows = P.roadmapRows('## Phase 1 — Car park finder\n| Feature | Proposed epic id |\n|---|---|\n| Find | EP-find |\n\n## Later / parked\n| Feature | Proposed epic id |\n|---|---|\n| X | EP-x |\n', skipped);
  assert.deepEqual(rows.map((r) => [r.epicId, r.priority]), [['EP-find', 'P1']]);
  assert.deepEqual(skipped, ['Later / parked']);
});

test('E174 review: a roadmap edited after its review is refused', async () => {
  const T = await product();
  for (const f of ['purpose.md', 'scope.md', 'mvp.md', 'stack.md', 'repos.md']) fs.writeFileSync(path.join(T, 'foundation', f), `# ${f}\n`);
  const sp = path.join(T, 'foundation/.sdlc/state.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const review = st.steps.find((s) => s.type === 'review+approve');
  review.status = 'done';
  fs.writeFileSync(sp, JSON.stringify(st));
  fs.writeFileSync(path.join(T, 'foundation/.sdlc/approvals.json'), JSON.stringify([{ step: review.id, status: 'approved', by: 'ann', artifactHash: 'sha256:old' }]));
  const f = fake();
  await P.runFoundationPublish(T, { env, runner: f.runner });
  assert.equal(f.posts.length, 0); assert.equal(process.exitCode, 1); reset();
  // The same Foundation, approved as it stands, publishes.
  const { artifactHash } = await import('./epic-state.mjs');
  fs.writeFileSync(path.join(T, 'foundation/.sdlc/approvals.json'), JSON.stringify([{ step: review.id, status: 'approved', by: 'ann', artifactHash: artifactHash(path.join(T, 'foundation'), 'foundation/') }]));
  const g = fake();
  await P.runFoundationPublish(T, { env, runner: g.runner });
  assert.ok(g.created.length > 0); reset();
});

test('E174 review: a stranger\'s issue with the marker but no label does not claim the row', async () => {
  const T = await product();
  const f = fake('github', { existing: [{ number: 9, body: '<!-- yad-roadmap: EP-signup -->', labels: [] }] });
  const r = await P.runFoundationPublish(T, { json: true, env, runner: f.runner });
  assert.equal(r.recovered.length, 0);
  assert.equal(f.created.length, 4);
});

test('E174 review: a phase heading cannot mention anyone in the body', async () => {
  const T = await product();
  fs.writeFileSync(path.join(T, 'foundation/roadmap.md'), '## Phase 1 — For @acme/web #12\n| Feature | Proposed epic id |\n|---|---|\n| A | EP-aa |\n');
  const f = fake();
  await P.runFoundationPublish(T, { env, runner: f.runner });
  const body = field(f.created[0].args, 'body')[0];
  assert.doesNotMatch(body, /@acme|#12/);
});

test('E174 review 2: a solo Foundation changed after its review is refused, using the fingerprint it closed with', async () => {
  const T = await product();
  for (const f of ['purpose.md', 'scope.md', 'mvp.md', 'stack.md', 'repos.md']) fs.writeFileSync(path.join(T, 'foundation', f), `# ${f}\n`);
  const sp = path.join(T, 'foundation/.sdlc/state.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const review = st.steps.find((s) => s.type === 'review+approve');
  review.status = 'done';
  review.closed = { by: 'ann', date: '2026-11-10', hash: 'sha256:old', via: 'approved', waived: 'solo' };
  fs.writeFileSync(sp, JSON.stringify(st));
  const f = fake();
  await P.runFoundationPublish(T, { env, runner: f.runner });
  assert.equal(f.posts.length, 0); assert.equal(process.exitCode, 1); reset();
  const { artifactHash } = await import('./epic-state.mjs');
  review.closed.hash = artifactHash(path.join(T, 'foundation'), 'foundation/');
  fs.writeFileSync(sp, JSON.stringify(st));
  const g = fake();
  await P.runFoundationPublish(T, { env, runner: g.runner });
  assert.ok(g.created.length > 0); reset();
});

// A Foundation that changed after its review: each setup is told the step that really clears it, and the
// tests follow that step to the end — publish goes ahead — rather than reading the wording alone.
const SECTIONS = ['purpose.md', 'scope.md', 'mvp.md', 'stack.md', 'repos.md'];
async function changedFoundation({ platform = 'github', solo = false, ledger = 'local' } = {}) {
  const T = await product(platform === null ? 'github' : platform);
  const cfg = path.join(T, '.sdlc/product.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), platform, ledger, ...(solo ? { solo: true } : {}) }));
  for (const f of SECTIONS) fs.writeFileSync(path.join(T, 'foundation', f), `# ${f}\n`);
  const sp = path.join(T, 'foundation/.sdlc/state.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const review = st.steps.find((s) => s.type === 'review+approve');
  review.status = 'done';
  review.closed = { by: 'ann', date: '2026-11-10', hash: 'sha256:old', pr: 3, via: 'merged', ...(solo ? { waived: 'solo' } : {}) };
  fs.writeFileSync(sp, JSON.stringify(st));
  return { T, sp, reviewId: review.id };
}
const captureJSON = async (fn) => {
  const lines = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (x) => { lines.push(String(x)); return true; };
  try { await fn(); } finally { process.stdout.write = orig; }
  return JSON.parse(lines.join(''));
};
const said = async (fn) => {
  const out = [];
  const keep = { log: console.log, error: console.error };
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try { await fn(); } finally { console.log = keep.log; console.error = keep.error; }
  return out.join('\n');
};
const publishes = async (T) => { const f = fake(); await P.runFoundationPublish(T, { env, runner: f.runner }); const n = f.created.length; reset(); return n > 0; };
const refusal = async (T) => { const f = fake(); const doc = await captureJSON(() => P.runFoundationPublish(T, { json: true, env, runner: f.runner })); reset(); return doc; };
const { artifactHash: hashOf } = await import('./epic-state.mjs');
const mergedPr = (over = {}) => () => ({ ok: true, state: 'MERGED', merged: true, headOid: 'abc', mergedAt: '2026-11-12T10:00:00Z', mergeCommit: 'm1', mergedBy: 'ann', reviews: [], threads: [], ...over });
const openFresh = (T, reviewId, number) => fs.writeFileSync(path.join(T, 'foundation/.sdlc/product-prs.json'),
  JSON.stringify([{ step: reviewId, artifact: 'foundation/', platform: 'github', number, branch: 'review/EP-foundation/foundation', lastSyncedAt: null }]));

test('`yad gate reopen` refuses the Foundation, so no hint names it', async () => {
  const { T, sp } = await changedFoundation();
  const { reopenStep } = await import('./epic-state.mjs');
  assert.throws(() => reopenStep(JSON.parse(fs.readFileSync(sp, 'utf8')), 'foundation', { reason: 'x' }), /Foundation is not reopened/);
  const doc = await refusal(T);
  assert.equal(doc.ok, false);
  assert.doesNotMatch(doc.hint, /gate reopen/);
  const { runFoundationStatus } = await import('./epic.mjs');
  const st = await captureJSON(() => runFoundationStatus(T, { json: true }));
  const w = st.warnings.find((x) => /changed after its review/.test(x));
  assert.ok(w, JSON.stringify(st.warnings));
  assert.doesNotMatch(w, /gate reopen/);
});

test('a solo Foundation with a platform: the hint is a fresh PR/MR, and its merge, synced, clears the refusal', async () => {
  const { T, sp, reviewId } = await changedFoundation({ solo: true });
  const doc = await refusal(T);
  assert.match(doc.hint, /git switch -C review\/EP-foundation\/foundation origin\//);
  assert.match(doc.hint, /yad gate open EP-foundation foundation\/`/);
  assert.match(doc.hint, /merge it yourself \(solo mode\), then `yad gate sync EP-foundation`/);
  assert.equal(await publishes(T), false);
  // The steps the hint gives: a fresh review PR/MR (gate open records it), merged, then a sync.
  openFresh(T, reviewId, 9);
  const { gateSync } = await import('./gate.mjs');
  const headIsCurrent = ({ epicDir, artifact }) => ({ ok: true, hash: hashOf(epicDir, artifact) });
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', reader: mergedPr(), contentAt: headIsCurrent });
  reset();
  const review = JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId);
  assert.equal(review.closed.hash, 'sha256:old', 'the first close is kept');
  assert.equal(review.rereviews.length, 1);
  assert.deepEqual({ pr: review.rereviews[0].pr, via: review.rereviews[0].via, waived: review.rereviews[0].waived, date: review.rereviews[0].date },
    { pr: 9, via: 'merged', waived: 'solo', date: '2026-11-12' });
  assert.equal(await publishes(T), true);
  // A second sync of the same merge writes nothing.
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-13', reader: mergedPr(), contentAt: headIsCurrent });
  reset();
  assert.equal(JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId).rereviews.length, 1);
});

test('a solo re-review covers only what its PR/MR merged: an edit after it, or an old merge re-read, is not covered', async () => {
  const { T, sp, reviewId } = await changedFoundation({ solo: true });
  const { gateSync } = await import('./gate.mjs');
  openFresh(T, reviewId, 9);
  const reviewed = hashOf(path.join(T, 'foundation'), 'foundation/');
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', reader: mergedPr(), contentAt: () => ({ ok: true, hash: reviewed }) });
  reset();
  assert.equal(await publishes(T), true);
  // An unreviewed edit lands on the default branch after that review.
  fs.writeFileSync(path.join(T, 'foundation/roadmap.md'), ROADMAP + '\n| Extra | EP-extra | planned |\n');
  assert.equal(await publishes(T), false);
  // A later sync re-reads the old merge: it merged the old content, and it is not newer — nothing is recorded.
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-13', reader: mergedPr(), contentAt: () => ({ ok: true, hash: reviewed }) });
  reset();
  assert.equal(JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId).rereviews.length, 1);
  assert.equal(await publishes(T), false);
  // The PR/MR that made the first close is not recorded again.
  const { recordSoloRereview } = await import('./epic-state.mjs');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  assert.equal(recordSoloRereview(st, reviewId, { pr: 3, platform: 'github', hash: hashOf(path.join(T, 'foundation'), 'foundation/') }), false);
});

test('a solo re-review binds to what its PR/MR merged, never to the default branch: a fresh PR whose head holds the old text covers nothing new', async () => {
  const { T, sp, reviewId } = await changedFoundation({ solo: true });
  const { gateSync } = await import('./gate.mjs');
  const old = hashOf(path.join(T, 'foundation'), 'foundation/');
  // The default branch moves on; a NEWER PR/MR merges, but its head still holds the old text.
  fs.writeFileSync(path.join(T, 'foundation/roadmap.md'), ROADMAP + '\n| Extra | EP-extra | planned |\n');
  openFresh(T, reviewId, 10);
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', reader: mergedPr(), contentAt: () => ({ ok: true, hash: old }) });
  reset();
  const review = JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId);
  assert.equal(review.rereviews.length, 1);
  assert.equal(review.rereviews[0].hash, old, 'bound to the PR head, not to the default branch as it stands');
  assert.equal(review.rereviews[0].platform, 'github');
  assert.equal(await publishes(T), false);
});

test('a solo re-review whose PR/MR head held no Foundation records nothing', async () => {
  const { T, sp, reviewId } = await changedFoundation({ solo: true });
  openFresh(T, reviewId, 9);
  const { gateSync } = await import('./gate.mjs');
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', reader: mergedPr(), contentAt: () => ({ ok: true, hash: null }) });
  reset();
  assert.equal(JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId).rereviews, undefined);
  assert.equal(await publishes(T), false);
});

test('a solo Product that moved platform: numbering starts again, and a lower MR number is still recorded', async () => {
  const { recordSoloRereview } = await import('./epic-state.mjs');
  const state = { steps: [{ id: 'foundation-review', type: 'review+approve', status: 'done', closed: { pr: 40 },
    rereviews: [{ pr: 41, platform: 'github', hash: 'sha256:a' }] }] };
  assert.equal(recordSoloRereview(state, 'foundation-review', { pr: 2, platform: 'gitlab', hash: 'sha256:b' }), true);
  assert.equal(recordSoloRereview(state, 'foundation-review', { pr: 2, platform: 'gitlab', hash: 'sha256:b' }), false, 'the same MR again writes nothing');
  assert.equal(recordSoloRereview(state, 'foundation-review', { pr: 30, platform: 'github', hash: 'sha256:c' }), false, 'older on the same platform');
  assert.deepEqual(state.steps[0].rereviews.map((r) => [r.platform, r.pr]), [['github', 41], ['gitlab', 2]]);
});

test('after a solo re-review, doneStepUnapproved — the check `yad next`, `yad status` and `yad doctor` share — stops saying the Foundation changed', async () => {
  const { T, sp, reviewId } = await changedFoundation({ solo: true });
  fs.writeFileSync(path.join(T, 'foundation/.sdlc/approvals.json'), JSON.stringify([{ step: reviewId, status: 'approved', approver: 'bob', artifactHash: 'sha256:old' }]));
  const { doneStepUnapproved } = await import('./epic-state.mjs');
  const dir = path.join(T, 'foundation');
  const approvals = JSON.parse(fs.readFileSync(path.join(dir, '.sdlc/approvals.json'), 'utf8'));
  const stepNow = () => JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId);
  assert.ok(doneStepUnapproved(dir, stepNow(), approvals), 'before: reported as changed');
  openFresh(T, reviewId, 9);
  const { gateSync } = await import('./gate.mjs');
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', reader: mergedPr(), contentAt: ({ epicDir, artifact }) => ({ ok: true, hash: hashOf(epicDir, artifact) }) });
  reset();
  assert.equal(doneStepUnapproved(dir, stepNow(), approvals), null, 'after: the re-review covers it');
});

test('a verified solo Product: a failed read of what the fresh PR/MR merged fails the CI run, with the recovery', async () => {
  const { T, sp, reviewId } = await changedFoundation({ solo: true, ledger: 'verified' });
  openFresh(T, reviewId, 9);
  const { execFileSync } = await import('node:child_process');
  const git = (...a) => execFileSync('git', a, { cwd: T, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 'x'); git('add', '-A'); git('commit', '-q', '-m', 'seed');
  const { gateCi } = await import('./gate.mjs');
  const errs = await said(() => gateCi(T, { branch: 'review/EP-foundation/foundation', pr: 9, merged: true, today: '2026-11-12', push: false, reader: mergedPr(),
    branchOf: () => ({ ok: false, reason: 'not asked in tests' }), contentAt: () => ({ ok: false, reason: 'shallow clone' }) }));
  assert.equal(process.exitCode, 1, 'the run goes red');
  reset();
  assert.match(errs, /could not read what PR #9 merged \(shallow clone\)/);
  assert.match(errs, /yad gate ci --branch review\/EP-foundation\/foundation --pr 9 --merged/);
  assert.equal(JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId).rereviews, undefined);
});

test('a solo Product that once closed the Foundation in team mode: the solo re-review still clears it', async () => {
  const { T, reviewId } = await changedFoundation({ solo: true });
  fs.writeFileSync(path.join(T, 'foundation/.sdlc/approvals.json'), JSON.stringify([{ step: reviewId, status: 'approved', approver: 'bob', artifactHash: 'sha256:old' }]));
  assert.equal(await publishes(T), false);
  openFresh(T, reviewId, 9);
  const { gateSync } = await import('./gate.mjs');
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', reader: mergedPr(), contentAt: ({ epicDir, artifact }) => ({ ok: true, hash: hashOf(epicDir, artifact) }) });
  reset();
  assert.equal(await publishes(T), true);
});

test('a team Foundation with a platform: the fresh PR/MR\'s approvals clear it; a merge alone records no re-review', async () => {
  const { T, sp, reviewId } = await changedFoundation({ solo: false });
  fs.writeFileSync(path.join(T, 'foundation/.sdlc/approvals.json'), JSON.stringify([{ step: reviewId, status: 'approved', approver: 'bob', artifactHash: 'sha256:old' }]));
  const doc = await refusal(T);
  assert.match(doc.hint, /yad gate open EP-foundation foundation\/`/);
  assert.match(doc.hint, /once it is approved and merged/);
  openFresh(T, reviewId, 9);
  const { gateSync } = await import('./gate.mjs');
  const headIsCurrent = ({ epicDir, artifact }) => ({ ok: true, hash: hashOf(epicDir, artifact) });
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', reader: mergedPr(), contentAt: headIsCurrent });
  reset();
  assert.equal(JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId).rereviews, undefined);
  assert.equal(await publishes(T), false);
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', reader: mergedPr({ reviews: [{ login: 'cy', state: 'APPROVED', submittedAt: '2026-11-12T09:00:00Z' }] }), contentAt: headIsCurrent });
  reset();
  assert.equal(await publishes(T), true);
});

test('a Foundation with no platform: the hint is `yad gate approve`, and that approval clears the refusal', async () => {
  for (const solo of [true, false]) {
    const { T } = await changedFoundation({ platform: null, solo });
    const doc = await refusal(T);
    assert.match(doc.hint, /`yad gate approve EP-foundation foundation\/ --by <your name>`/);
    assert.doesNotMatch(doc.hint, /git push|gate open/);
    const { gateApprove } = await import('./gate-local.mjs');
    await gateApprove(T, { epic: 'EP-foundation', artifact: 'foundation/', by: 'cy', today: '2026-11-12' });
    reset();
    assert.equal(await publishes(T), true, `solo ${solo}`);
  }
});

test('a verified solo Product: the hint says CI records the merge, and a local sync writes nothing', async () => {
  const { T, sp, reviewId } = await changedFoundation({ solo: true, ledger: 'verified' });
  const doc = await refusal(T);
  assert.match(doc.hint, /CI records the merge as the new review/);
  assert.doesNotMatch(doc.hint, /yad gate sync/);
  openFresh(T, reviewId, 9);
  const { gateSync } = await import('./gate.mjs');
  await gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', local: true, reader: mergedPr(), contentAt: ({ epicDir, artifact }) => ({ ok: true, hash: hashOf(epicDir, artifact) }) });
  reset();
  assert.equal(JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId).rereviews, undefined);
});

test('a verified solo Product: CI at the merge records the solo re-review, and publish goes ahead', async () => {
  const { T, sp, reviewId } = await changedFoundation({ solo: true, ledger: 'verified' });
  openFresh(T, reviewId, 9);
  const { execFileSync } = await import('node:child_process');
  const git = (...a) => execFileSync('git', a, { cwd: T, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 'x'); git('add', '-A'); git('commit', '-q', '-m', 'seed');
  const { gateCi } = await import('./gate.mjs');
  // The run a merge triggers (`gate ci --branch <head> --pr <n> --merged`); the scheduled sweep reads no passed step.
  const ci = await gateCi(T, { branch: 'review/EP-foundation/foundation', pr: 9, merged: true, today: '2026-11-12', push: false, reader: mergedPr(), branchOf: () => ({ ok: false, reason: 'not asked in tests' }),
    contentAt: ({ epicDir, artifact }) => ({ ok: true, hash: hashOf(epicDir, artifact) }) });
  reset();
  assert.equal(ci.committed, true, 'CI commits the record — a write left uncommitted is lost in CI');
  assert.match(git('show', '--name-only', '--format=', 'HEAD').toString(), /foundation\/\.sdlc\/state\.json/);
  const review = JSON.parse(fs.readFileSync(sp, 'utf8')).steps.find((s) => s.id === reviewId);
  assert.equal(review.rereviews?.length, 1);
  assert.equal(review.closed.hash, 'sha256:old');
  assert.equal(await publishes(T), true);
});

test('gate ci commits only what it staged: a file a person had staged stays out of the ledger commit, still staged (#231 review 2)', async () => {
  const { T, reviewId } = await changedFoundation({ solo: true, ledger: 'verified' });
  openFresh(T, reviewId, 9);
  const { execFileSync } = await import('node:child_process');
  const git = (...a) => execFileSync('git', a, { cwd: T, stdio: 'pipe' }).toString();
  git('init', '-q'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 'x'); git('add', '-A'); git('commit', '-q', '-m', 'seed');
  fs.writeFileSync(path.join(T, 'notes.md'), 'mine\n');
  git('add', 'notes.md');
  const { gateCi } = await import('./gate.mjs');
  const ci = await gateCi(T, { branch: 'review/EP-foundation/foundation', pr: 9, merged: true, today: '2026-11-12', push: false, reader: mergedPr(), branchOf: () => ({ ok: false, reason: 'not asked in tests' }),
    contentAt: ({ epicDir, artifact }) => ({ ok: true, hash: hashOf(epicDir, artifact) }) });
  reset();
  assert.equal(ci.committed, true);
  const files = git('show', '--name-only', '--format=', 'HEAD');
  assert.match(files, /foundation\/\.sdlc\/state\.json/);
  assert.doesNotMatch(files, /notes\.md/);
  assert.equal(git('diff', '--cached', '--name-only').trim(), 'notes.md', 'the person\'s file is still staged, theirs to commit');
});

test('a failed read of a merge already on file, or on a read-only run, stays a warning: the run is not failed', async () => {
  const { gateSync } = await import('./gate.mjs');
  // The first close's own PR, read again by a later sync: nothing new could be recorded.
  {
    const { T } = await changedFoundation({ solo: true });
    fs.writeFileSync(path.join(T, 'foundation/.sdlc/product-prs.json'),
      JSON.stringify([{ step: 'foundation-review', artifact: 'foundation/', platform: 'github', number: 3, branch: 'review/EP-foundation/foundation', lastSyncedAt: null }]));
    const out = await said(() => gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', reader: mergedPr(), contentAt: () => ({ ok: false, reason: 'shallow clone' }) }));
    assert.equal(process.exitCode || 0, 0, out); reset();
    assert.match(out, /a later sweep tries again/);
  }
  // A fresh merge, but on a verified ledger's advisory local sync, which writes nothing.
  {
    const { T, reviewId } = await changedFoundation({ solo: true, ledger: 'verified' });
    openFresh(T, reviewId, 9);
    const out = await said(() => gateSync(T, { epic: 'EP-foundation', today: '2026-11-12', local: true, reader: mergedPr(), contentAt: () => ({ ok: false, reason: 'shallow clone' }) }));
    assert.equal(process.exitCode || 0, 0, out); reset();
    assert.match(out, /a later sweep tries again/, 'it reached the warning, not an early return');
  }
});

test('the first close\'s PR number on another platform is another PR/MR: its merge commit tells them apart', async () => {
  const { soloRereviewDue, recordSoloRereview } = await import('./epic-state.mjs');
  const step = () => ({ id: 'foundation-review', type: 'review+approve', status: 'done', closed: { pr: 3, commit: 'gh-merge' } });
  assert.equal(soloRereviewDue(step(), { pr: 3, platform: 'github', commit: 'gh-merge' }), false, 'the first close itself');
  assert.equal(soloRereviewDue(step(), { pr: 3, platform: 'github', commit: null }), false, 'no commit to compare: treated as the first close');
  const state = { steps: [step()] };
  assert.equal(recordSoloRereview(state, 'foundation-review', { pr: 3, platform: 'gitlab', commit: 'gl-merge', hash: 'sha256:b' }), true);
});

test('an old-spelling Foundation review (artifact `discovery/`) is told its own review branch, never `/foundation`', async () => {
  const { T, sp } = await changedFoundation({ solo: true, ledger: 'verified' });
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  for (const s of st.steps) if (s.artifact === 'foundation/') s.artifact = 'discovery/';
  const hint = P.foundationReviewAgain(T, { state: st });
  assert.match(hint, /git switch -C review\/EP-foundation\/discovery /);
  assert.match(hint, /yad gate ci --branch review\/EP-foundation\/discovery --pr <n> --merged/);
  assert.doesNotMatch(hint, /review\/EP-foundation\/foundation/);
});

test('E174 review 2: a near-miss parked heading is published and said', () => {
  const near = [];
  const rows = P.roadmapRows('## Later\n| Feature | Proposed epic id |\n|---|---|\n| Y | EP-y |\n', [], near);
  assert.equal(rows.length, 1);
  assert.deepEqual(near, ['Later']);
});

test('E174 review 3: approvals with no fingerprint fall back to the closing fingerprint; status says the Foundation changed', async () => {
  const T = await product();
  for (const f of ['purpose.md', 'scope.md', 'mvp.md', 'stack.md', 'repos.md']) fs.writeFileSync(path.join(T, 'foundation', f), `# ${f}\n`);
  const sp = path.join(T, 'foundation/.sdlc/state.json');
  const st = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const review = st.steps.find((s) => s.type === 'review+approve');
  review.status = 'done';
  review.closed = { by: 'ann', date: '2026-11-10', hash: 'sha256:old', via: 'merged' };
  fs.writeFileSync(sp, JSON.stringify(st));
  fs.writeFileSync(path.join(T, 'foundation/.sdlc/approvals.json'), JSON.stringify([{ step: review.id, status: 'approved', by: 'bob' }]));
  const f = fake();
  await P.runFoundationPublish(T, { env, runner: f.runner });
  assert.equal(f.posts.length, 0); assert.equal(process.exitCode, 1); reset();
  const { runFoundationStatus } = await import('./epic.mjs');
  const lines = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (x) => { lines.push(String(x)); return true; };
  try { await runFoundationStatus(T, { json: true }); } finally { process.stdout.write = orig; }
  const doc = JSON.parse(lines.join(''));
  assert.equal(doc.changed, true);
  assert.ok(doc.warnings.some((w) => /changed after its review/.test(w)));
  // An approval with a fingerprint beside one without: the old fingerprint still decides.
  fs.writeFileSync(path.join(T, 'foundation/.sdlc/approvals.json'), JSON.stringify([{ step: review.id, status: 'approved', by: 'bob' }, { step: review.id, status: 'approved', by: 'cy', artifactHash: 'sha256:old' }]));
  const g = fake();
  await P.runFoundationPublish(T, { env, runner: g.runner });
  assert.equal(g.posts.length, 0); reset();
});


// ---- the setup epic stays off the roadmap (EP-foundation-first-epic-S04) ----------------------------------
const { runEpicNew } = await import('./epic.mjs');
const { spawnSync } = await import('node:child_process');
const YAD = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'yad.mjs');
const statusOf = (T, text = false) => {
  const r = spawnSync('node', [YAD, 'foundation', 'status', ...(text ? [] : ['--json'])], { cwd: T, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', YAD_PLATFORM_READ: '0' } });
  return text ? r.stdout : JSON.parse(r.stdout);
};

test('foundation status: a seeded epic is listed under setup, never as unlisted; setup is always in --json', async () => {
  const T = await product();
  try {
    assert.deepEqual(statusOf(T).setup, [], 'present and empty with no setup epic');
    await runEpicNew(T, { slug: 'bootstrap', seed: 'bootstrap', today: '2026-11-26', json: true, returnResult: true });
    await runEpicNew(T, { slug: 'pay', today: '2026-11-26', json: true, returnResult: true });
    const j = statusOf(T);
    assert.deepEqual(j.setup, [{ epicId: 'EP-bootstrap', seed: 'bootstrap', status: j.setup[0].status }]);
    assert.equal(typeof j.setup[0].status, 'string');
    assert.deepEqual(j.unlisted, ['EP-pay'], 'the setup epic is not a feature the roadmap misses');
    const out = statusOf(T, true);
    assert.match(out, /setup {2}\(outside the roadmap, never published as an item\)/);
    assert.match(out, new RegExp(`EP-bootstrap {2}bootstrap {2}${j.setup[0].status}`));
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('foundation status: with no setup epic the text has no setup block', async () => {
  const T = await product();
  try { assert.doesNotMatch(statusOf(T, true), /outside the roadmap/); } finally { fs.rmSync(T, { recursive: true, force: true }); }
});

test('foundation publish: a roadmap row naming a setup epic is never published, and the notes say why', async () => {
  const T = await product();
  try {
    // A roadmap row names EP-signup, and that epic was seeded as the setup epic.
    await runEpicNew(T, { slug: 'signup', seed: 'pack', today: '2026-11-26', json: true, returnResult: true });
    const g = fake();
    const r = await P.runFoundationPublish(T, { dryRun: true, json: true, env, runner: g.runner });
    assert.deepEqual(r.created.map((x) => x.epicId).sort(), ['EP-checkout', 'EP-referrals', 'EP-teams']);
    assert.ok(r.notes.some((n) => /EP-signup is the pack setup epic, so its row was left out/.test(n)), r.notes.join(' | '));
    const f = fake();
    const real = await P.runFoundationPublish(T, { json: true, env, runner: f.runner });
    assert.equal(f.created.some((x) => x.args.some((a) => /EP-signup/.test(a))), false, 'no item opened for it');
    assert.ok(real.notes.some((n) => /EP-signup is the pack setup epic, so its row was left out$/.test(n)), real.notes.join(' | '));
    const recorded = JSON.parse(fs.readFileSync(path.join(T, 'foundation/.sdlc/roadmap-items.json'), 'utf8'));
    assert.equal(recorded.items.some((e) => e.epicId === 'EP-signup'), false, 'nothing recorded for it');
  } finally { fs.rmSync(T, { recursive: true, force: true }); reset(); }
});

test('foundation publish: only state.json says "seeded" — a broken sibling file does not hide it, a broken state.json leaves the row out', async () => {
  const T = await product();
  try {
    await runEpicNew(T, { slug: 'signup', seed: 'pack', today: '2026-11-26', json: true, returnResult: true });
    fs.writeFileSync(path.join(T, 'epics/EP-signup/.sdlc/comments.json'), '{ broken');
    await runEpicNew(T, { slug: 'checkout', today: '2026-11-26', json: true, returnResult: true });
    fs.writeFileSync(path.join(T, 'epics/EP-checkout/.sdlc/state.json'), '{ broken');
    const r = await P.runFoundationPublish(T, { dryRun: true, json: true, env, runner: fake().runner });
    assert.deepEqual(r.created.map((x) => x.epicId).sort(), ['EP-referrals', 'EP-teams']);
    assert.ok(r.notes.some((n) => /EP-signup is the pack setup epic/.test(n)));
    assert.ok(r.notes.some((n) => /the ledger of EP-checkout cannot be read, so its row was left out/.test(n)), r.notes.join(' | '));
  } finally { fs.rmSync(T, { recursive: true, force: true }); reset(); }
});

test('foundation publish: a setup epic that was published before it was seeded names its open item', async () => {
  const T = await product();
  try {
    fs.writeFileSync(path.join(T, 'foundation/.sdlc/roadmap-items.json'), JSON.stringify({ items: [
      { epicId: 'EP-signup', platform: 'github', host: 'github.com', repo: 'a/p', number: 5, url: 'https://github.com/a/p/issues/5', publishedAt: '2026-11-20T00:00:00.000Z' },
    ] }));
    await runEpicNew(T, { slug: 'signup', seed: 'bootstrap', today: '2026-11-26', json: true, returnResult: true });
    const r = await P.runFoundationPublish(T, { dryRun: true, json: true, env, runner: fake().runner });
    assert.ok(r.notes.some((n) => /EP-signup is the bootstrap setup epic, so its row was left out — it was already published as #5; close that item/.test(n)), r.notes.join(' | '));
    assert.equal(r.created.some((x) => x.epicId === 'EP-signup'), false);
  } finally { fs.rmSync(T, { recursive: true, force: true }); reset(); }
});
