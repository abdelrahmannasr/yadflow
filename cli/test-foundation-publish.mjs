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

test('E174 review 2: a near-miss parked heading is published and said', () => {
  const near = [];
  const rows = P.roadmapRows('## Later\n| Feature | Proposed epic id |\n|---|---|\n| Y | EP-y |\n', [], near);
  assert.equal(rows.length, 1);
  assert.deepEqual(near, ['Later']);
});

