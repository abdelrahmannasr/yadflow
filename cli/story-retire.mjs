// `yad story retire <story> --reason "<why>" [--json]` (engine #621) — set aside a whole story that the
// stories review approved but that will not be built. The rules are the pure `retireStory` in
// epic-state.mjs; this reads the story, its build-state and the ships, and writes
// `build-state/<story>.json`, which `yad checkpoint --push` commits — as the lane skip (`runLaneSkip`,
// cli/skip.mjs) does. Retire only: there is no command that puts a retired story back, and none that
// moves a story to another epic.
//
// What it writes: `retired: { reason, by, date }` at the top of the file, and each lane the story declares
// skipped with the reason. The story file, `state.json` and the approvals are not touched: the story file
// is under the stories-review fingerprint (`storiesHash`), so the approval stays. A lane skip does not ask
// whether CI owns the epic's ledger (`ciOwnsLedger`), and neither does this: build-state is not the ledger.
//
// Every refusal throws a YadError (YAD-STATE-004, or YAD-STATE-001 for a build-state that does not parse);
// bin/yad.mjs renders it, in JSON too.
import fs from 'node:fs';
import path from 'node:path';

import { forTerminal, hand, info, ok, readJSONStrict, writeJSON } from './lib.mjs';
import { err } from './errors.mjs';
import { declaredRepos, epicRel, epicRoot, epicStories, loadLedger, readFrontmatter, retireStory, retiredRecord, stepStatus, storyRetired } from './epic-state.mjs';
import { epicFiles } from './manifest.mjs';
import { readShips } from './ledger.mjs';
import { STORY_RE, storyEpic } from './build.mjs';
import { recordActor } from './skip.mjs';

const CODE = 'YAD-STATE-004';
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const said = (v) => forTerminal(String(v ?? ''));

export async function runStoryRetire(root, { story, reason, today = null } = {}) {
  if (!story || story === true) throw err(CODE, 'yad story retire needs a story id', 'use: yad story retire <story-id> --reason "<why it will not be built>"');
  if (!STORY_RE.test(String(story))) throw err(CODE, `'${said(story)}' is not a story id`, 'expected EP-<slug>-S<n>, such as EP-checkout-S01');
  const epic = storyEpic(story);
  const epicDir = epicRoot(root, epic);
  const ledger = loadLedger(epicDir);
  if (!ledger.state) throw err(CODE, `no epic state at ${epicRel(epic)}`, 'check the story id; the epic is seeded with yad-epic');
  // The story is read by its file, as the epic seal and `yad tidy` read it.
  const storyFile = path.join(epicDir, 'stories', `${story}.md`);
  if (!isFile(storyFile)) throw err(CODE, `no story file ${epicRel(epic)}/stories/${story}.md`, 'check the story id; the stories step writes one file per story');
  const fm = readFrontmatter(storyFile);
  // An EARNED stories review only (`done`, or `satisfied` in a parent epic), as the lane skip asks.
  const review = (Array.isArray(ledger.state.steps) ? ledger.state.steps : []).find((st) => st?.id === 'stories-review');
  const file = path.join(epicFiles(epicDir).buildStateDir, `${story}.json`);
  const current = readJSONStrict(file, null);
  const ships = readShips(epicDir);
  const others = epicStories(epicDir).filter((st) => st.id !== story);
  const by = recordActor(root);
  const { buildState, already, lanes } = retireStory(current, {
    story, reason, by, date: today,
    declared: declaredRepos(fm),
    storiesPassed: ['done', 'satisfied'].includes(stepStatus(review)),
    storyStatus: typeof fm.status === 'string' ? fm.status : null,
    shipped: ships.some((sh) => sh.story === story),
    othersOwed: others.filter((st) => !storyRetired(epicDir, st.id)).length,
    anyShipped: others.some((st) => isFile(path.join(epicDir, 'stories', `${st.id}.md`)) && readFrontmatter(path.join(epicDir, 'stories', `${st.id}.md`)).status === 'shipped'),
  });
  const rel = path.relative(root, file);
  if (already) {
    const r = retiredRecord(current) || {};
    ok(`${story} was already retired${r.by ? ` by ${said(r.by)}` : ''}${r.date ? ` on ${said(r.date)}` : ''} — nothing changed`);
    if (typeof r.reason === 'string' && r.reason.trim()) info(`reason: ${said(r.reason)}`);
    return { epic, story, retired: true, changed: false, record: r, lanes: [], file: rel };
  }
  writeJSON(file, buildState);
  ok(`${story} retired${by ? ` by ${said(by)}` : ''}${today ? ` on ${today}` : ''} — it will not be built`);
  info(`reason: ${said(buildState.retired.reason)}`);
  if (lanes.length) info(`lanes skipped: ${lanes.map(said).join(', ')}`);
  hand(`it owes no Build work now, and the epic can seal once its other stories ship; commit this with \`yad checkpoint --push\``);
  return { epic, story, retired: true, changed: true, record: buildState.retired, lanes, file: rel };
}
