// EP-plannotator-review: the Plannotator Inbox. yad shapes the messages; the agent posts them (cli/inbox.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { inboxReady, INBOX_TOOL } = await import('./inbox.mjs');

// A Product with an optional toolbox file; nothing else is needed to read the choices.
function product(toolbox) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'yad-inbox-'));
  fs.mkdirSync(path.join(p, '.sdlc'), { recursive: true });
  fs.writeFileSync(path.join(p, '.sdlc/product.json'), '{"schemaVersion":10,"platform":null}\n');
  if (toolbox !== undefined) fs.writeFileSync(path.join(p, '.sdlc/toolbox.json'), typeof toolbox === 'string' ? toolbox : JSON.stringify(toolbox));
  return p;
}
const found = (b) => b === 'plannotator';
const absent = () => false;
const plugin = (enabled) => ({ kind: 'plugin', name: 'plannotator@plannotator', enabled, agents: ['Claude Code'], where: 'Claude Code plugins' });

test('S01 inboxReady: true only when the Product chose Plannotator AND this machine has it (TC-03)', () => {
  assert.equal(INBOX_TOOL, 'plannotator');
  const chosen = product({ schemaVersion: 10, shipped: { plannotator: 'use' } });
  const notChosen = product();
  const skipped = product({ schemaVersion: 10, shipped: { plannotator: 'skip' } });
  try {
    assert.equal(inboxReady(chosen, { items: [], has: found }), true, 'chosen + found');
    assert.equal(inboxReady(chosen, { items: [], has: absent }), false, 'chosen, not found');
    assert.equal(inboxReady(notChosen, { items: [], has: found }), false, 'found, not chosen: a recommended tool is not used by default');
    assert.equal(inboxReady(notChosen, { items: [], has: absent }), false, 'neither');
    assert.equal(inboxReady(skipped, { items: [], has: found }), false, 'removed by the team');
    // Each signal alone counts as found.
    assert.equal(inboxReady(chosen, { items: [plugin(true)], has: absent }), true, 'the plugin');
    assert.equal(inboxReady(chosen, { items: [{ kind: 'mcp', name: 'plannotator-inbox', where: '.mcp.json' }], has: absent }), true, 'the Inbox server');
    // A plugin the settings turn off is not loaded: disabled, not installed.
    assert.equal(inboxReady(chosen, { items: [plugin(false)], has: absent }), false, 'a disabled plugin');
  } finally { for (const p of [chosen, notChosen, skipped]) fs.rmSync(p, { recursive: true, force: true }); }
});

test('S01 inboxReady: no Product, or a toolbox file that does not parse, is not ready', () => {
  assert.equal(inboxReady(null, { items: [], has: found }), false);
  assert.equal(inboxReady('', { items: [], has: found }), false);
  const broken = product('{ not json');
  try {
    // A broken file is read leniently: the defaults stand, and a recommended tool is not in use by default.
    assert.equal(inboxReady(broken, { items: [], has: found }), false);
  } finally { fs.rmSync(broken, { recursive: true, force: true }); }
});

test('S01 inboxReady reads only: it writes nothing in the Product', () => {
  const p = product({ schemaVersion: 10, shipped: { plannotator: 'use' } });
  try {
    const list = (dir) => fs.readdirSync(dir, { recursive: true }).sort();
    const before = list(p);
    const text = fs.readFileSync(path.join(p, '.sdlc/toolbox.json'), 'utf8');
    inboxReady(p, { items: [], has: found });
    assert.deepEqual(list(p), before);
    assert.equal(fs.readFileSync(path.join(p, '.sdlc/toolbox.json'), 'utf8'), text);
  } finally { fs.rmSync(p, { recursive: true, force: true }); }
});
