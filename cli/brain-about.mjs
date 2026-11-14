// E179 — two focused questions over the project brain (E176), for an agent planning or editing:
//   fileAbout(brain, target)  — one file: who declares it, what it defines, which files use it or it uses, its
//                               ships, the contract surfaces that reach it;
//   storyAbout(brain, id)     — one story: its epic, repos, tasks with their declared files and ships, surfaces.
// Both are pure: they read the brain object (`.sdlc/brain/graph.json`) and never the disk, so a test needs no
// Graphify. Every list is cut at `limit`, and `more` says how many were left out.

const RANK = { EXTRACTED: 3, INFERRED: 2, AMBIGUOUS: 1 };

// The edges of the brain, indexed both ways once per question.
function indexOf(brain) {
  const byId = new Map(brain.nodes.map((n) => [n.id, n]));
  const out = new Map();
  const into = new Map();
  for (const e of brain.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source).push(e);
    if (!into.has(e.target)) into.set(e.target, []);
    into.get(e.target).push(e);
  }
  return {
    byId,
    out: (id, rel) => (out.get(id) || []).filter((e) => !rel || e.relation === rel),
    into: (id, rel) => (into.get(id) || []).filter((e) => !rel || e.relation === rel),
  };
}

const cut = (list, limit) => ({ items: list.slice(0, limit), more: Math.max(0, list.length - limit) });
const filePath = (n) => n.id.slice(`file:${n.repo}:`.length);
const brief = (n) => (n ? { id: n.id, label: n.label } : null);

// A task's own short id (`T01`) from its node id `task:<story>:<repo>:<Tnn>`.
const taskShort = (id) => id.slice(id.lastIndexOf(':') + 1);

// The file nodes `target` names: `<repo>/<path>` when the first word is a repo the brain holds, and a bare
// `<path>` matched in every repo. Both readings are taken, so a repo named like a folder cannot hide a file.
export function fileCandidates(brain, target) {
  const t = String(target).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const files = brain.nodes.filter((n) => n.kind === 'file' && typeof n.repo === 'string');
  const found = new Map();
  const slash = t.indexOf('/');
  if (slash > 0) {
    const id = `file:${t.slice(0, slash)}:${t.slice(slash + 1)}`;
    const n = files.find((x) => x.id === id);
    if (n) found.set(n.id, n);
  }
  for (const n of files) if (filePath(n) === t) found.set(n.id, n);
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// The "did you mean" list for a file the brain does not hold: files with the same name in any folder, then the
// files in the folder named (a typo in the name).
export function fileSuggestions(brain, target, max = 5) {
  const t = String(target).trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const cutAt = t.lastIndexOf('/');
  const name = t.slice(cutAt + 1);
  const folder = cutAt > 0 ? t.slice(0, cutAt) : null;
  if (!name) return [];
  const all = brain.nodes.filter((n) => n.kind === 'file' && typeof n.repo === 'string').map((n) => `${n.repo}/${filePath(n)}`);
  const sameName = all.filter((f) => f.toLowerCase().endsWith(`/${name}`));
  const sameFolder = folder ? all.filter((f) => f.toLowerCase().startsWith(`${folder}/`) && !f.slice(folder.length + 1).includes('/')) : [];
  return [...new Set([...sameName.sort(), ...sameFolder.sort()])].slice(0, max);
}

// `{ found: 'none' | 'many' | 'one', candidates?, about? }`.
export function fileAbout(brain, target, { limit = 25 } = {}) {
  const candidates = fileCandidates(brain, target);
  if (!candidates.length) return { found: 'none', suggestions: fileSuggestions(brain, target) };
  if (candidates.length > 1) return { found: 'many', candidates: candidates.map((n) => `${n.repo}/${filePath(n)}`) };
  const f = candidates[0];
  const ix = indexOf(brain);
  const repo = f.repo;
  const here = filePath(f);

  // Who declares it: task → story → epic.
  const declaredBy = ix.into(f.id, 'declares-file').map((e) => {
    const task = ix.byId.get(e.source);
    const storyEdge = ix.into(task.id, 'has-task')[0];
    const story = storyEdge ? ix.byId.get(storyEdge.source) : null;
    const epicEdge = story ? ix.into(story.id, 'has-story')[0] : null;
    return { task: { id: task.id, short: taskShort(task.id), label: task.label }, story: brief(story), epic: brief(epicEdge ? ix.byId.get(epicEdge.source) : null), repo: task.repo ?? repo };
  }).sort((a, b) => a.task.id.localeCompare(b.task.id));

  // What it defines, in file order where Graphify gave a line.
  const line = (n) => { const m = /^L(\d+)/.exec(String(n.at ?? '')); return m ? Number(m[1]) : Infinity; };
  const symbols = ix.out(f.id, 'defines').map((e) => ix.byId.get(e.target)).filter((n) => n.kind === 'code');
  const defines = [...symbols].sort((a, b) => line(a) - line(b) || a.id.localeCompare(b.id))
    .map((n) => ({ id: n.id, label: n.label, ...(n.at ? { at: n.at } : {}) }));
  const mine = new Set(symbols.map((n) => n.id));

  // Other files joined to this one by the code's own edges (calls, imports, …), one row per file: the
  // relations seen, the strongest confidence, how many edges. An edge inside the file is not a use.
  const joined = (edges, otherEnd) => {
    const rows = new Map();
    for (const e of edges) {
      const other = ix.byId.get(otherEnd(e));
      if (!other || other.kind !== 'code' || typeof other.file !== 'string') continue;
      if (other.repo === repo && other.file === here) continue;
      const key = `${other.repo}/${other.file}`;
      const row = rows.get(key) || { file: key, repo: other.repo, path: other.file, relations: [], confidence: 'AMBIGUOUS', edges: 0 };
      if (!row.relations.includes(e.relation)) row.relations.push(e.relation);
      if ((RANK[e.confidence] || 0) > (RANK[row.confidence] || 0)) row.confidence = e.confidence;
      row.edges += 1;
      rows.set(key, row);
    }
    return [...rows.values()].map((r) => ({ ...r, relations: r.relations.sort() }))
      .sort((a, b) => b.edges - a.edges || a.file.localeCompare(b.file));
  };
  const usedBy = joined([...mine].flatMap((id) => ix.into(id).filter((e) => e.relation !== 'defines')), (e) => e.source);
  const uses = joined([...mine].flatMap((id) => ix.out(id)), (e) => e.target);

  // The ships of the tasks that declare it.
  const ships = new Map();
  for (const d of declaredBy) {
    for (const e of ix.out(d.task.id, 'shipped-as')) {
      const s = ix.byId.get(e.target);
      ships.set(s.id, { id: s.id, label: s.label, ...(s.pr ? { pr: s.pr } : {}), ...(s.date ? { date: s.date } : {}) });
    }
  }

  // The contract surfaces that reach it: by its path (code-map), or by one of its symbols (name, handler).
  const surfaces = new Map();
  const surfaceEdge = (e) => {
    const s = ix.byId.get(e.source);
    if (s?.kind === 'surface') surfaces.set(s.id, { id: s.id, label: s.label, via: [...new Set([...(surfaces.get(s.id)?.via || []), e.relation])].sort() });
  };
  ix.into(f.id, 'mapped-to').forEach(surfaceEdge);
  for (const id of mine) for (const e of ix.into(id)) if (e.relation === 'named-as' || e.relation === 'handled-by') surfaceEdge(e);

  const lists = {
    declaredBy: cut(declaredBy, limit),
    defines: cut(defines, limit),
    usedBy: cut(usedBy, limit),
    uses: cut(uses, limit),
    shippedIn: cut([...ships.values()].sort((a, b) => a.id.localeCompare(b.id)), limit),
    surfaces: cut([...surfaces.values()].sort((a, b) => a.id.localeCompare(b.id)), limit),
  };
  return {
    found: 'one',
    about: {
      file: { id: f.id, repo, path: here, ...(f.missing ? { missing: true } : {}) },
      ...Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.items])),
      more: Object.fromEntries(Object.entries(lists).filter(([, v]) => v.more).map(([k, v]) => [k, v.more])),
    },
  };
}

// The story nodes whose id holds the text: the "did you mean" list for a story the brain does not hold.
export function storySuggestions(brain, id, max = 5) {
  const t = String(id).trim().toLowerCase();
  if (!t) return [];
  return brain.nodes.filter((n) => n.kind === 'story' && n.id.slice('story:'.length).toLowerCase().includes(t))
    .map((n) => n.id.slice('story:'.length)).sort().slice(0, max);
}

// `{ found: 'none', suggestions } | { found: 'one', about }`. A story's files are the files its tasks declare
// in the repos cloned here: a repo not cloned has no tasks in the brain, and `reposWithoutTasks` names it.
export function storyAbout(brain, id, { limit = 50 } = {}) {
  const sid = `story:${String(id).trim()}`;
  const ix = indexOf(brain);
  const story = ix.byId.get(sid);
  if (!story || story.kind !== 'story') return { found: 'none', suggestions: storySuggestions(brain, id) };
  const epicEdge = ix.into(sid, 'has-story')[0];
  const repos = ix.out(sid, 'builds-in').map((e) => ix.byId.get(e.target).label).sort();
  const shipOf = (s) => ({ id: s.id, label: s.label, ...(s.pr ? { pr: s.pr } : {}), ...(s.date ? { date: s.date } : {}) });
  const tasks = ix.out(sid, 'has-task').map((e) => ix.byId.get(e.target)).sort((a, b) => a.id.localeCompare(b.id)).map((t) => ({
    id: t.id,
    short: taskShort(t.id),
    label: t.label,
    repo: t.repo ?? null,
    files: ix.out(t.id, 'declares-file').map((x) => ix.byId.get(x.target))
      .map((n) => ({ repo: n.repo, path: filePath(n), ...(n.missing ? { missing: true } : {}) }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    shipped: ix.out(t.id, 'shipped-as').map((x) => shipOf(ix.byId.get(x.target))),
  }));
  const files = new Map();
  for (const t of tasks) {
    for (const f of t.files) {
      const key = `${f.repo}/${f.path}`;
      const row = files.get(key) || { file: key, repo: f.repo, path: f.path, ...(f.missing ? { missing: true } : {}), tasks: [] };
      row.tasks.push(t.short);
      files.set(key, row);
    }
  }
  const withTasks = new Set(tasks.map((t) => t.repo));
  const shownTasks = cut(tasks, limit);
  const shownFiles = cut([...files.values()].sort((a, b) => a.file.localeCompare(b.file)), limit);
  return {
    found: 'one',
    about: {
      story: { id: sid.slice('story:'.length), ...(story.status ? { status: story.status } : {}), ...(story.summary ? { summary: story.summary } : {}) },
      epic: epicEdge ? brief(ix.byId.get(epicEdge.source)) : null,
      repos,
      reposWithoutTasks: repos.filter((r) => !withTasks.has(r)),
      tasks: shownTasks.items,
      files: shownFiles.items,
      // Ships recorded on the story itself (a ship whose task has no node here).
      shipped: ix.out(sid, 'shipped-as').map((x) => shipOf(ix.byId.get(x.target))),
      surfaces: ix.out(sid, 'touches-surface').map((x) => ix.byId.get(x.target).label).sort(),
      more: Object.fromEntries([['tasks', shownTasks.more], ['files', shownFiles.more]].filter(([, v]) => v)),
    },
  };
}
