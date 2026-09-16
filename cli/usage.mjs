// `yad usage` — the team-member adoption & behavior report.
//
// DERIVED, READ-ONLY, NO NEW SOURCE OF TRUTH. This command reconstructs each contributor's audit
// trail entirely from data ALREADY in git — the approval/comment/ship ledgers + git authorship — and
// renders it as a portable report (HTML by default) to a location the caller chooses. It writes no
// tracked state, hooks no commands, and stores nothing that cannot be rebuilt from the repos. This
// mirrors how `yad-status` and `thread-resolved.md` derive their views (see docs/phase-5-build-plan.md:
// instrumentation is derived and read-only, never a new ledger).
//
// PRIVACY: the report is FACTUAL — names/logins, action kinds, epic IDs, integer counts, dates, and
// explainable hygiene flags. It NEVER emits emails, commit messages, or free-text comment bodies. It is
// a workflow-hygiene / adoption view for an EM, not a judgmental scorecard (see memory:
// no-private-data-in-reports).
//
// PEOPLE COME FROM ACTIVITY, NOT FROM A LIST (E62). Before the roster was removed this report seeded every
// member from it — so someone with no activity showed as `dormant` — and used it to join a person's
// ledger name, git name and login into one row. With no stored list, a person is whoever did something:
// the name a ledger records (the platform login since E62; the roster's name in older records) or the
// git author. One join survives because it is evidence rather than a claim: a GitHub or GitLab noreply
// commit address carries the login, so those commits land on the same row as that login's approvals.
// A person whose git name, older ledger name and login all differ appears on more than one row, and the
// report says so rather than guessing.
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, note, readJSON, run } from './lib.mjs';
import { PROJECT_FILES, epicFiles } from './manifest.mjs';
import { readShips } from './ledger.mjs';
import { epicRoot, FOUNDATION_DIR, FOUNDATION_EPIC, FOUNDATION_FILES } from './epic-state.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ledger read for the report. A MISSING file is normal (the epic hasn't reached that gate) and yields
// `def` silently; a file that EXISTS but fails to parse is surfaced to stderr and skipped — NOT thrown,
// since one corrupt ledger must not abort the whole derived view, but a silent under-count must never
// masquerade as "no activity" (an active reviewer wrongly left off the report). Mirrors the `readJSONStrict`
// hazard note in lib.mjs, softened to warn-and-continue for this read-only aggregation.
function readLedger(p, def) {
  if (!fs.existsSync(p)) return def;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    note(c.yellow(`skipped unreadable ledger ${path.basename(path.dirname(path.dirname(p)))}/${path.basename(p)}: ${e.message}`));
    return def;
  }
}

// The five kinds of workflow action we can attribute to an individual from git-tracked data.
export const ACTIONS = ['authored', 'commented', 'approved', 'shipped', 'committed'];

// Artifacts whose authoring commit counts as an "authored" event (a top-level epic artifact, or any
// story file). Ledger files under .sdlc/ are gate machinery, not authoring, and are excluded.
const ARTIFACT_FILES = new Set([
  'epic.md', 'analysis.md', 'architecture.md', 'contract.md', 'ui-design.md', 'DESIGN.md', 'test-cases.md',
]);

// ---- attribution -------------------------------------------------------------------------------

// The platform login a noreply commit address carries — `12345+octocat@users.noreply.github.com`,
// `octocat@users.noreply.github.com`, `12345-tanuki@users.noreply.gitlab.com` — else null. The address
// itself is never emitted; only the login, which the ledgers already record.
// The login keeps the case the address carries: a platform login is case-insensitive, but it is shown
// as written. Rows are joined case-insensitively in `analyze`.
export function loginFromEmail(email) {
  const e = String(email || '');
  const gh = e.match(/^(?:\d+\+)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)@users\.noreply\.github\.com$/i);
  if (gh) return gh[1];
  const gl = e.match(/^\d+-([a-z0-9._-]+)@users\.noreply\.gitlab\.com$/i);
  return gl ? gl[1] : null;
}

// ---- epic enumeration --------------------------------------------------------------------------

// The Foundation (E75) is appended when its ledger folder exists: approving or commenting on it is
// contribution like any other gate, and a report that left it out would under-count exactly the
// people who framed the product. The case-insensitive match on `epics/` is this report's own, older
// rule and is kept as it was.
function listEpics(root) {
  const dir = path.join(root, 'epics');
  const ids = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^EP-[a-z0-9-]+$/i.test(e.name) && e.name !== FOUNDATION_EPIC)
      .map((e) => e.name)
    : [];
  if (fs.existsSync(path.join(root, FOUNDATION_DIR, '.sdlc'))) ids.push(FOUNDATION_EPIC);
  return ids.sort();
}

const inWindow = (date, since, until) => !!date && (!since || date >= since) && (!until || date <= until);

// ---- event derivation --------------------------------------------------------------------------

// Ledger-sourced events for one epic: approvals, comments, and ship engineer-reviews, attributed to the
// name the ledger records — as recorded, with nothing to translate it through.
function ledgerEvents(root, epic) {
  const f = epicFiles(epicRoot(root, epic));
  const events = [];
  const emit = (rawName, action, date, extra = {}) => {
    if (!rawName || !date) return;
    events.push({ ts: date, actor: rawName, login: null, action, epic, ...extra });
  };
  for (const a of readLedger(f.approvals, []) || []) emit(a.approver, 'approved', a.date, { artifact: a.artifact });
  for (const cm of readLedger(f.comments, []) || []) emit(cm.commenter, 'commented', cm.date, { artifact: cm.artifact });
  for (const s of readShips(epicRoot(root, epic))) {
    for (const er of s.engineer_review || []) emit(er.approver, 'shipped', s.shippedAt, { story: s.story, task: s.task, repo: s.repo, risk: s.risk });
  }
  return events;
}

// True for `epics/<EP>/<artifact>.md`, `epics/<EP>/stories/<file>.md`, or a Foundation section
// `foundation/<section>.md` (E75).
export function isArtifactPath(rel) {
  const parts = rel.split('/');
  if (parts[0] === FOUNDATION_DIR) return parts.length === 2 && FOUNDATION_FILES.includes(parts[1]);
  if (parts[0] !== 'epics' || parts.length < 3) return false;
  if (parts[2] === 'stories') return parts.length >= 4 && parts[3].endsWith('.md');
  return parts.length === 3 && ARTIFACT_FILES.has(parts[2]);
}

// Parse `git log --name-only` output into a flat list of {an, ae, ad, files[]} commits. Uses \x01 as
// the record marker and \x00 as the field separator so author names containing spaces never confuse it.
function parseGitLog(stdout) {
  const commits = [];
  let cur = null;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('\x01')) {
      const [an, ae, ad] = line.slice(1).split('\x00');
      cur = { an, ae, ad, files: [] };
      commits.push(cur);
    } else if (line.trim() && cur) {
      cur.files.push(line.trim());
    }
  }
  return commits;
}

const GIT_PRETTY = '--pretty=format:\x01%an%x00%ae%x00%ad';

// git-sourced "authored" events: who committed which epic artifact, when. Degrades to [] when the Product
// is not a git repo (e.g. a test fixture dir), so the command never depends on git being present.
function gitAuthoredEvents(root) {
  const r = run('git', ['-C', root, 'log', '--no-merges', '--date=short', GIT_PRETTY, '--name-only', '--', 'epics', FOUNDATION_DIR]);
  if (!r.ok || !r.stdout) return [];
  const events = [];
  for (const cm of parseGitLog(r.stdout)) {
    const login = loginFromEmail(cm.ae);
    for (const rel of cm.files) {
      if (!isArtifactPath(rel)) continue;
      events.push({
        ts: cm.ad, actor: login || cm.an, login,
        action: 'authored', epic: rel.startsWith(`${FOUNDATION_DIR}/`) ? FOUNDATION_EPIC : rel.split('/')[1],
        artifact: rel.split('/').pop().replace(/\.md$/, ''),
      });
    }
  }
  return events;
}

// Optional (`--repos`): code commits in each connected code repo, attributed to the git author (or the
// login a noreply address carries).
function repoCommitEvents(root) {
  const reg = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
  const events = [];
  for (const repo of reg?.repos || []) {
    if (!repo.path) continue;
    const abs = path.isAbsolute(repo.path) ? repo.path : path.join(root, repo.path);
    const r = run('git', ['-C', abs, 'log', '--no-merges', '--date=short', GIT_PRETTY]);
    if (!r.ok || !r.stdout) continue;
    for (const cm of parseGitLog(r.stdout)) {
      const login = loginFromEmail(cm.ae);
      events.push({ ts: cm.ad, actor: login || cm.an, login, action: 'committed', repo: repo.name });
    }
  }
  return events;
}

// The full, window-filtered event stream. Deterministic: sorted by (date, action, epic/repo, actor).
export function deriveEvents(root, { since, until, repos = false } = {}) {
  const events = [...gitAuthoredEvents(root)];
  for (const epic of listEpics(root)) events.push(...ledgerEvents(root, epic));
  if (repos) events.push(...repoCommitEvents(root));
  return events
    .filter((e) => inWindow(e.ts, since, until))
    .sort((a, b) =>
      a.ts.localeCompare(b.ts) || a.action.localeCompare(b.action) ||
      String(a.epic || a.repo || '').localeCompare(String(b.epic || b.repo || '')) || a.actor.localeCompare(b.actor));
}

// ---- analysis ----------------------------------------------------------------------------------

const zeroCounts = () => Object.fromEntries(ACTIONS.map((a) => [a, 0]));

// Per-member rollup + explainable hygiene flags + team totals. `window` echoes the requested range.
// Everyone here did something in range: there is no stored list to seed an inactive person from (E62).
export function analyze(events, window = { since: null, until: null }) {
  const members = new Map();
  const seed = (key, name, login) => {
    if (!members.has(key)) {
      members.set(key, { key, name, login: login || null, counts: zeroCounts(), total: 0, firstActive: null, lastActive: null, epics: new Set(), timeline: [] });
    }
    const m = members.get(key);
    if (login && !m.login) m.login = login;
    return m;
  };
  for (const e of events) {
    // Keyed case-insensitively: GitHub and GitLab logins are, so `OctoCat` on an approval and `octocat`
    // in a noreply address are one person.
    const m = seed(String(e.login || e.actor).toLowerCase(), e.actor, e.login);
    m.counts[e.action] = (m.counts[e.action] || 0) + 1;
    m.total += 1;
    if (e.epic) m.epics.add(e.epic);
    if (!m.firstActive || e.ts < m.firstActive) m.firstActive = e.ts;
    if (!m.lastActive || e.ts > m.lastActive) m.lastActive = e.ts;
    m.timeline.push({ ts: e.ts, action: e.action, epic: e.epic || null, repo: e.repo || null, artifact: e.artifact || null });
  }
  const list = [...members.values()].map((m) => ({
    name: m.name, login: m.login,
    counts: m.counts, total: m.total, firstActive: m.firstActive, lastActive: m.lastActive,
    epics: [...m.epics].sort(), flags: memberFlags(m), timeline: m.timeline,
  }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  const totals = zeroCounts();
  for (const m of list) for (const a of ACTIONS) totals[a] += m.counts[a];
  return { window, generatedFrom: 'derived', members: list, totals };
}

// Factual, per-member flags — each is a plain derivation, never a score. The two that needed a stored
// list went with the roster (E62): `dormant` (listed, no activity) and `reviewer-not-reviewing` (holds a
// reviewer role, never reviews).
function memberFlags(m) {
  const flags = [];
  const reviews = m.counts.commented + m.counts.approved;
  // Only on a row whose person is known by LOGIN. A row built from a bare git name cannot see that
  // person's approvals, which are recorded under their login, so "never reviews" would be a false claim.
  if (m.login && m.total > 0 && m.counts.authored > 0 && reviews === 0) flags.push('no-review-participation'); // authors but never reviews
  return flags;
}

// Team-level hygiene, keyed by epic/story — a ship with no recorded engineer review is a process gap,
// not attributable to one person, so it lives here rather than in a member's flag list.
//
// A `retroactive: true` ship is EXCLUDED: it is a `yad checkpoint --retro-ship` reconciliation of a
// story that shipped before the ledger existed, so it never had a tracked PR to review — counting it
// as a missing review reports a gap the team could not have filled. It also scales with repo count
// (one backfill shard per repo since #166), which would swamp the real gaps with reconciliation noise.
export function shipHygiene(root, { since, until } = {}) {
  const items = [];
  for (const epic of listEpics(root)) {
    for (const s of readShips(epicRoot(root, epic))) {
      if (!inWindow(s.shippedAt, since, until)) continue;
      if (s.retroactive) continue;
      if (!Array.isArray(s.engineer_review) || s.engineer_review.length === 0) {
        items.push({ epic, story: s.story || null, task: s.task || null, repo: s.repo || null, shippedAt: s.shippedAt || null });
      }
    }
  }
  return items.sort((a, b) => String(a.epic).localeCompare(String(b.epic)) || String(a.story).localeCompare(String(b.story)));
}

// ---- rendering ---------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const rangeLabel = (w) => (!w.since && !w.until ? 'all time' : `${w.since || '…'} → ${w.until || '…'}`);

// A single self-contained HTML file — inline CSS + inline SVG bars, no build step, no external assets —
// so the caller can drop it anywhere and open it in a browser.
export function renderHtml(model, today = '') {
  const flagChip = (f) => `<span class="flag flag-${esc(f)}">${esc(f)}</span>`;
  const bar = (m) => {
    const max = Math.max(1, ...model.members.map((x) => x.total));
    const w = Math.round((m.total / max) * 100);
    return `<div class="bar"><span style="width:${w}%"></span></div>`;
  };
  const memberCard = (m) => `
    <section class="member${m.total === 0 ? ' idle' : ''}">
      <header>
        <h3>${esc(m.name)} ${m.login && m.login !== m.name ? `<span class="login">@${esc(m.login)}</span>` : ''}</h3>
        <div class="flags">${m.flags.map(flagChip).join(' ')}</div>
      </header>
      ${bar(m)}
      <table class="counts"><tr>${ACTIONS.map((a) => `<th>${a}</th>`).join('')}<th>total</th></tr>
        <tr>${ACTIONS.map((a) => `<td>${m.counts[a]}</td>`).join('')}<td><b>${m.total}</b></td></tr></table>
      <p class="meta">${m.total ? `active ${esc(m.firstActive)} → ${esc(m.lastActive)} · epics: ${m.epics.length ? esc(m.epics.join(', ')) : '—'}` : 'no activity in range'}</p>
      ${m.timeline.length ? `<details><summary>timeline (${m.timeline.length})</summary><ul class="timeline">${m.timeline
        .map((t) => `<li><time>${esc(t.ts)}</time> <b>${esc(t.action)}</b> ${esc(t.epic || t.repo || '')}${t.artifact ? ` · ${esc(t.artifact)}` : ''}</li>`)
        .join('')}</ul></details>` : ''}
    </section>`;
  const hygiene = model.hygiene?.length
    ? `<section class="hygiene"><h2>Workflow hygiene</h2><p>Ships with no recorded engineer review (process gaps, not attributed to one person):</p><ul>${model.hygiene
        .map((h) => `<li><b>${esc(h.epic)}</b> ${esc(h.story || '')}${h.task ? `/${esc(h.task)}` : ''} ${h.repo ? `(${esc(h.repo)})` : ''} — shipped ${esc(h.shippedAt || '?')}</li>`)
        .join('')}</ul></section>`
    : '<section class="hygiene"><h2>Workflow hygiene</h2><p>No ship-without-review gaps in range. ✓</p></section>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>yadflow — team usage report</title><style>
:root{--bg:#0f1115;--fg:#e6e8ee;--dim:#9aa0ad;--card:#181b22;--line:#262a33;--accent:#5b9dff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--dim);margin:0 0 24px}
.totals{display:flex;gap:16px;flex-wrap:wrap;margin:0 0 24px;padding:14px;background:var(--card);border:1px solid var(--line);border-radius:10px}
.totals div{font-size:13px;color:var(--dim)}.totals b{display:block;font-size:20px;color:var(--fg)}
.member{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 14px}
.member.idle{opacity:.6}.member header{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
h3{margin:0;font-size:15px}.login{color:var(--dim);font-weight:400;font-size:13px}
.bar{height:6px;background:var(--line);border-radius:4px;margin:10px 0;overflow:hidden}.bar span{display:block;height:100%;background:var(--accent)}
table.counts{border-collapse:collapse;font-size:12px;margin:6px 0}table.counts th{color:var(--dim);text-align:left;font-weight:500;padding:2px 14px 2px 0}table.counts td{padding:2px 14px 2px 0}
.meta{color:var(--dim);font-size:12px;margin:6px 0 0}
.flags{display:flex;gap:6px;flex-wrap:wrap}.flag{font-size:11px;border-radius:6px;padding:1px 8px;background:#3a2a12;color:#ffcf7a;border:1px solid #5a3f14}
details{margin-top:10px}summary{cursor:pointer;color:var(--dim);font-size:12px}
ul.timeline{list-style:none;padding:8px 0 0;margin:0;font-size:12px}ul.timeline li{padding:2px 0;border-top:1px solid var(--line)}
time{color:var(--dim);font-variant-numeric:tabular-nums;margin-right:6px}
.hygiene{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:24px 0 0}.hygiene h2{font-size:15px;margin:0 0 8px}.hygiene ul{margin:6px 0 0;padding-left:18px}
footer{color:var(--dim);font-size:12px;margin-top:28px;border-top:1px solid var(--line);padding-top:12px}
</style></head><body><div class="wrap">
<h1>Team usage &amp; behavior report</h1>
<p class="sub">Range: ${esc(rangeLabel(model.window))} · ${model.members.length} member(s)${today ? ` · generated ${esc(today)}` : ''}</p>
<div class="totals">${ACTIONS.map((a) => `<div>${a}<b>${model.totals[a]}</b></div>`).join('')}</div>
${model.members.map(memberCard).join('')}
${hygiene}
<footer>Derived, read-only view — reconstructed from git history and the SDLC ledgers. Regenerate any time with <code>yad usage</code>. No emails, commit messages, or comment bodies are included. People are listed as the ledgers and git name them: someone whose git name differs from their platform login may appear twice.</footer>
</div></body></html>\n`;
}

// A compact Markdown variant for quick reads / pasting into a PR. Dynamic values are sanitized so a
// name/repo containing `|` or a newline can't corrupt the table or list structure.
export function renderMarkdown(model, today = '') {
  const mdCell = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const mdText = (s) => String(s ?? '').replace(/\r?\n/g, ' ');
  const L = [`# Team usage & behavior report`, ``, `- Range: **${rangeLabel(model.window)}**${today ? ` · generated ${today}` : ''}`, `- Members: ${model.members.length}`, `- Totals: ${ACTIONS.map((a) => `${a} ${model.totals[a]}`).join(' · ')}`, ``, `| member | ${ACTIONS.join(' | ')} | total | flags |`, `|---|${ACTIONS.map(() => '--:').join('|')}|--:|---|`];
  for (const m of model.members) {
    L.push(`| ${mdCell(`${m.name}${m.login && m.login !== m.name ? ` (@${m.login})` : ''}`)} | ${ACTIONS.map((a) => m.counts[a]).join(' | ')} | ${m.total} | ${mdCell(m.flags.join(', ') || '—')} |`);
  }
  L.push('', '## Workflow hygiene');
  if (model.hygiene?.length) {
    L.push('Ships with no recorded engineer review:');
    for (const h of model.hygiene) L.push(`- **${mdText(h.epic)}** ${mdText(h.story || '')}${h.task ? `/${mdText(h.task)}` : ''} ${h.repo ? `(${mdText(h.repo)})` : ''} — shipped ${mdText(h.shippedAt || '?')}`);
  } else {
    L.push('No ship-without-review gaps in range. ✓');
  }
  L.push('', '_Derived, read-only — reconstructed from git + the SDLC ledgers; no emails/comment bodies. People are listed as the ledgers and git name them, so one person may appear twice._', '');
  return L.join('\n');
}

// ---- CLI entry ---------------------------------------------------------------------------------

export function buildModel(root, { since, until, repos = false, member } = {}) {
  const events = deriveEvents(root, { since, until, repos });
  const model = analyze(events, { since: since || null, until: until || null });
  model.hygiene = shipHygiene(root, { since, until });
  if (member) {
    model.members = model.members.filter((m) => m.name === member || m.login === member);
    const totals = zeroCounts();                                     // totals track the shown members, not the whole team
    for (const m of model.members) for (const a of ACTIONS) totals[a] += m.counts[a];
    model.totals = totals;
  }
  return model;
}

// Ensure a report's parent directory exists, then write it (mirrors copyFile/writeJSON in lib.mjs,
// which always mkdir the dirname first) so `--out sub/dir/report.html` never throws a raw ENOENT.
function writeReport(dest, content) {
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  fs.writeFileSync(dest, content);
}

export function runUsage(root, { out, since, until, all, member, format = 'html', repos = false, json = false, today = '' } = {}) {
  if (all) { since = undefined; until = undefined; }
  // Dates compare lexically as strings, so an unpadded value (2026-6-1) silently mis-windows — warn.
  for (const [flag, val] of [['--since', since], ['--until', until]]) {
    if (val && !DATE_RE.test(val)) note(c.yellow(`${flag} ${val} is not YYYY-MM-DD — dates compare lexically, so a non-padded value may filter incorrectly`));
  }
  let fmt = json ? 'json' : format;
  if (!['html', 'json', 'md'].includes(fmt)) { note(c.yellow(`unknown --format ${fmt} (html|json|md) — using html`)); fmt = 'html'; }
  const model = buildModel(root, { since, until, repos, member });

  if (fmt === 'json') {
    const s = JSON.stringify(model, null, 2);
    if (out) { writeReport(out, s + '\n'); note(`wrote JSON → ${out}`); } else { log(s); } // stdout stays pure JSON
    return model;
  }
  const content = fmt === 'md' ? renderMarkdown(model, today) : renderHtml(model, today);
  const dest = out || `usage-report.${fmt === 'md' ? 'md' : 'html'}`;
  writeReport(dest, content);
  ok(`wrote ${fmt.toUpperCase()} report → ${c.bold(dest)} (${model.members.length} member(s), range: ${rangeLabel(model.window)})`);
  return model;
}
