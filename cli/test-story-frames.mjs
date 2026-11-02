// #354: each story records its design frames (`design-frames: [id, …]`), `yad story frames` reads them
// with their names and links from the epic's design-links.json, and `yad doctor` warns on any it cannot
// read. One rule (`frameFindings`) decides for both, and every finding is a warning in both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_TEST_CONTEXT) {
  const write = process.stdout.write;
  for (const k of ['log', 'info']) {
    const orig = console[k];
    console[k] = (...a) => (process.stdout.write === write ? console.error(...a) : orig(...a));
  }
}
process.env.YAD_NO_UPDATE_NOTIFIER = '1';

const { frameFindings, readDesignLinks, readStoryFrames, allStoryFrames, FRAMES_KEY } = await import('./story-frames.mjs');
const { storyFrameChecks } = await import('./doctor.mjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const YAD = path.join(HERE, '..', 'bin', 'yad.mjs');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yad-frames-')));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const done = (T) => fs.rmSync(T, { recursive: true, force: true });
const story = (id, line) => `---\nid: ${id}\nepic: ${id.replace(/-S\d+$/, '')}\nstatus: draft\nrepos: [web]\n${line === null ? '' : `${line}\n`}---\n\n## Story\n`;
const LINKS = {
  tool: 'pencil', fileUrl: 'https://design.example/f', direction: 'generate', source: 'pencil',
  screens: [
    { name: 'Cart', platform: 'web', nodeId: '12:34', url: 'https://design.example/f?node=12:34' },
    { name: 'Pay', platform: 'mobile', nodeId: 'aB3xQ', url: 'https://design.example/f?node=aB3xQ' },
  ],
};
const ok = { state: 'ok', tool: 'pencil', fileUrl: LINKS.fileUrl, screens: LINKS.screens };
const kinds = (r) => r.findings.map((f) => f.kind);

// A Product with one epic: its design-links.json (or none) and the given stories.
function product(stories, links = LINKS) {
  const T = tmp();
  const epic = path.join(T, 'epics', 'EP-shop');
  fs.mkdirSync(epic, { recursive: true });
  if (links !== null) put(path.join(epic, '.sdlc', 'design-links.json'), links);
  for (const [id, line] of Object.entries(stories)) put(path.join(epic, 'stories', `${id}.md`), story(id, line));
  return T;
}
const yad = (T, ...args) => spawnSync(process.execPath, [YAD, ...args, '--dir', T], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', SDLC_NONINTERACTIVE: '1' } });

test('#354: frameFindings — no key, an empty list, and IDs that all resolve', () => {
  assert.deepEqual(frameFindings({}, ok), { recorded: false, ids: [], frames: [], findings: [] });
  const none = frameFindings({ [FRAMES_KEY]: [] }, { state: 'missing' });
  assert.equal(none.recorded, true);
  assert.deepEqual(none.findings, [], '`[]` needs no design-links.json — a story with no screens');
  const r = frameFindings({ [FRAMES_KEY]: ['12:34', 'aB3xQ'] }, ok);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.frames, [
    { id: '12:34', found: true, name: 'Cart', platform: 'web', url: LINKS.screens[0].url },
    { id: 'aB3xQ', found: true, name: 'Pay', platform: 'mobile', url: LINKS.screens[1].url },
  ], 'a Figma 12:34 ID and a Pencil-style ID both resolve');
});

test('#354: frameFindings — every problem is a finding, never a silent "no frames"', () => {
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12:34', '99:99'] }, ok)), ['not-found']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: '[12:34] # the cart' }, ok)), ['commented'], 'the comment trap');
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: '' }, ok)), ['not-a-list'], 'blank — what a `- id` block list reads as');
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: '12:34' }, ok)), ['not-a-list']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12 34'] }, ok)), ['bad-id', 'not-found']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12:34', '12:34'] }, ok)), ['duplicate']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12:34'] }, { state: 'missing' })), ['no-design-links']);
  assert.deepEqual(kinds(frameFindings({ [FRAMES_KEY]: ['12:34'] }, { state: 'unreadable', why: 'x' })), ['design-links-unreadable']);
});

test('#354: frameFindings — text from the files reaches the terminal cleaned', () => {
  const r = frameFindings({ [FRAMES_KEY]: ['\x1b[31m1:2'] }, ok);
  for (const f of r.findings) assert.ok(!f.message.includes('\x1b'), f.message);
});

test('#354: readDesignLinks — missing, not JSON, no screens list, and ok', () => {
  const T = tmp();
  try {
    assert.equal(readDesignLinks(T).state, 'missing');
    put(path.join(T, '.sdlc', 'design-links.json'), '{ nope');
    assert.equal(readDesignLinks(T).state, 'unreadable');
    put(path.join(T, '.sdlc', 'design-links.json'), { tool: 'figma' });
    assert.equal(readDesignLinks(T).state, 'unreadable');
    put(path.join(T, '.sdlc', 'design-links.json'), LINKS);
    const r = readDesignLinks(T);
    assert.equal(r.state, 'ok');
    assert.equal(r.screens.length, 2);
  } finally { done(T); }
});

test('#354: the frontmatter reader round-trips the key the stories step writes', () => {
  const T = product({ 'EP-shop-S01': `${FRAMES_KEY}: [12:34, aB3xQ]`, 'EP-shop-S02': `${FRAMES_KEY}: []`, 'EP-shop-S03': null });
  try {
    assert.deepEqual(readStoryFrames(T, 'EP-shop-S01').frames.map((f) => f.found), [true, true]);
    const s2 = readStoryFrames(T, 'EP-shop-S02');
    assert.deepEqual([s2.recorded, s2.ids, s2.findings], [true, [], []]);
    assert.equal(readStoryFrames(T, 'EP-shop-S03').recorded, false);
    assert.throws(() => readStoryFrames(T, 'EP-shop-S09'), /no story file/);
    assert.throws(() => readStoryFrames(T, 'shop'), /not a story id/);
    assert.throws(() => readStoryFrames(T, undefined), /needs a story id/);
  } finally { done(T); }
});

test('#354: yad story frames — text, --json, and the exit code', () => {
  const T = product({ 'EP-shop-S01': `${FRAMES_KEY}: [12:34, 99:99]` });
  try {
    const text = yad(T, 'story', 'frames', 'EP-shop-S01');
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /12:34 {2}Cart {2}\[web\]/);
    assert.match(text.stdout, /99:99 — not found/);
    const j = yad(T, 'story', 'frames', 'EP-shop-S01', '--json');
    assert.equal(j.status, 0, j.stderr);
    const out = JSON.parse(j.stdout);
    assert.equal(out.command, 'story frames');
    assert.equal(out.ok, true);
    assert.equal(out.tool, 'pencil');
    assert.deepEqual(out.frames.map((f) => [f.id, f.found]), [['12:34', true], ['99:99', false]]);
    assert.deepEqual(out.findings.map((f) => f.kind), ['not-found']);
    assert.equal(out.warnings.length, 1, 'a missing frame is a warning, and the exit code stays 0');

    const gone = yad(T, 'story', 'frames', 'EP-shop-S09', '--json');
    assert.equal(gone.status, 1);
    const g = JSON.parse(gone.stdout);
    assert.equal(g.ok, false);
    assert.match(g.hint, /story id/);
    assert.equal(yad(T, 'story', 'paint').status, 1, 'an unknown action is refused');
  } finally { done(T); }
});

test('#354: doctor — no row without frames, an ok row with a count, one warn row naming the problems', () => {
  const run = (T) => { const checks = []; storyFrameChecks(checks, T); return checks; };
  let T = product({ 'EP-shop-S01': null });
  try { assert.deepEqual(run(T), []); } finally { done(T); }

  T = product({ 'EP-shop-S01': `${FRAMES_KEY}: [12:34]`, 'EP-shop-S02': `${FRAMES_KEY}: []` }, LINKS);
  try {
    const [row, ...rest] = run(T);
    assert.equal(rest.length, 0);
    assert.deepEqual([row.id, row.status], ['stories:design-frames', 'ok']);
    assert.match(row.message, /^2 story/);
  } finally { done(T); }

  T = product({ 'EP-shop-S01': `${FRAMES_KEY}: [12:34] # cart`, 'EP-shop-S02': `${FRAMES_KEY}: [77:1]` });
  try {
    const rows = run(T);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].id, rows[0].status], ['stories:design-frames', 'warn']);
    assert.match(rows[0].message, /^2 problem/);
    assert.match(rows[0].message, /EP-shop-S01: .*#/);
    assert.match(rows[0].message, /EP-shop-S02: .*77:1/);
    assert.deepEqual(allStoryFrames(T, ['EP-shop']).map((s) => s.findings[0].kind), ['commented', 'not-found']);
  } finally { done(T); }
});
