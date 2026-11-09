// E170 — which tracker items (GitHub issues, GitLab work items) belong to an epic. One sidecar per epic,
// `.sdlc/issue-links.json`, holding only where the item is: its text stays on the platform, so private text
// does not spread into the repo. It is a separate file so `state.json` and `epic.md` keep their bytes, and
// the approvals bound to them stay valid.
import fs from 'node:fs';
import path from 'node:path';
import { readJSONStrict, writeJSON } from './lib.mjs';
import { err } from './errors.mjs';
import { epicIds, epicRoot, epicStories, featureStatus, loadLedger, PRODUCT_EPICS } from './epic-state.mjs';

export const ISSUE_LINKS_FILE = path.join('.sdlc', 'issue-links.json');
export const linksPath = (root, epic) => path.join(epicRoot(root, epic), ISSUE_LINKS_FILE);
export const itemKey = ({ host, repo, number }) => `${String(host).toLowerCase()}/${String(repo).toLowerCase()}#${number}`;

// Strict: this is read before a write, and a file that cannot be understood is refused, never replaced.
export function readLinks(root, epic) {
  const p = linksPath(root, epic);
  const doc = readJSONStrict(p, { items: [] });
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items) || doc.items.some((l) => !l || typeof l !== 'object')) throw err('YAD-STATE-001', `${p} is not an issue-links file (it needs an "items" list of records)`, 'fix the file or restore it from git');
  return doc.items;
}
export function writeLinks(root, epic, items) {
  const p = linksPath(root, epic);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  writeJSON(p, { items });
}

const featureEpics = (root) => epicIds(root).filter((e) => !PRODUCT_EPICS.includes(e));

// Every link in the Product, as Map(itemKey → [epic id]). An epic whose sidecar cannot be read is named in
// `unreadable`: its items would otherwise look unlinked, and "unknown" must never read as "none".
export function allLinks(root) {
  const byItem = new Map();
  const unreadable = [];
  for (const epic of featureEpics(root)) {
    let items;
    try { items = readLinks(root, epic); } catch { unreadable.push(epic); continue; }
    for (const l of items) {
      if (!l || !l.host || !l.repo || !Number.isInteger(l.number)) continue;
      const k = itemKey(l);
      byItem.set(k, [...(byItem.get(k) || []), epic]);
    }
  }
  return { byItem, unreadable };
}

// An epic's stage (`featureStatus`), or null when its ledger cannot be read.
export function epicStage(root, epic) {
  try {
    const dir = epicRoot(root, epic);
    return featureStatus(loadLedger(dir), { stories: epicStories(dir) });
  } catch { return null; }
}

// One stage for an item with several epics: the first that has not shipped, else shipped. Null if any is unread.
export function combinedStage(stages) {
  if (!stages.length || stages.some((s) => s === null)) return null;
  return stages.find((s) => s !== 'shipped') ?? 'shipped';
}
