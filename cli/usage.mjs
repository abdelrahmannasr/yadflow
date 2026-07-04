// `yad usage` — the team-member adoption & behavior report.
//
// DERIVED, READ-ONLY, NO NEW SOURCE OF TRUTH. This command reconstructs each roster member's audit
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
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, note, readJSON, run } from './lib.mjs';
import { PROJECT_FILES, epicFiles } from './manifest.mjs';
import { readShips } from './ledger.mjs';
import { rolesForScope } from './platform.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ledger read for the report. A MISSING file is normal (the epic hasn't reached that gate) and yields
// `def` silently; a file that EXISTS but fails to parse is surfaced to stderr and skipped — NOT thrown,
// since one corrupt ledger must not abort the whole derived view, but a silent under-count must never
// masquerade as "no activity" (an active reviewer wrongly shown dormant). Mirrors the `readJSONStrict`
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

// ---- roster / attribution ----------------------------------------------------------------------

function loadRoster(root) {
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig), null);
  return hub && Array.isArray(hub.roster) ? hub.roster : [];
}

// A member's hub-scope role label (supports both the per-scope `roles` map and the legacy flat `role`).
function rosterRole(m) {
  const scoped = rolesForScope(m, 'hub');
  if (scoped.length) return scoped.join(', ');
  return m.role || '';
}

// Resolve a display name / login / git-author identity to a canonical roster member (or null when the
// person is not in the roster — we still attribute the event to the raw name so nothing is dropped).
function makeResolver(roster) {
  const byEmail = new Map();
  const byName = new Map();
  const byLogin = new Map();
  for (const m of roster) {
    if (m.email) byEmail.set(m.email.toLowerCase(), m);
    if (m.name) byName.set(m.name, m);
    if (m.login) byLogin.set(m.login, m);
  }
  return {
    // Ledgers store the roster `name` (approver/commenter) — map back to the full entry when possible.
    byNameOrLogin: (s) => (s == null ? null : byName.get(s) || byLogin.get(s) || null),
    // git authorship maps by commit email first (the reliable key), then by author name == roster name.
    byGitAuthor: (name, email) =>
      byEmail.get((email || '').toLowerCase()) || byName.get(name) || byLogin.get(name) || null,
  };
}

// ---- epic enumeration --------------------------------------------------------------------------

function listEpics(root) {
  const dir = path.join(root, 'epics');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^EP-[a-z0-9-]+$/i.test(e.name))
    .map((e) => e.name)
    .sort();
}

const inWindow = (date, since, until) => !!date && (!since || date >= since) && (!until || date <= until);

// ---- event derivation --------------------------------------------------------------------------

// Ledger-sourced events for one epic: approvals, comments, and ship engineer-reviews. Each carries the
// roster `name` already, so attribution is direct.
function ledgerEvents(root, epic, resolver) {
  const f = epicFiles(path.join(root, 'epics', epic));
  const events = [];
  const emit = (rawName, action, date, extra = {}) => {
    if (!rawName || !date) return;
    const m = resolver.byNameOrLogin(rawName);
    events.push({ ts: date, actor: m ? m.name || m.login : rawName, login: m ? m.login || null : null, rostered: !!m, action, epic, ...extra });
  };
  for (const a of readLedger(f.approvals, []) || []) emit(a.approver, 'approved', a.date, { artifact: a.artifact, role: a.role });
  for (const cm of readLedger(f.comments, []) || []) emit(cm.commenter, 'commented', cm.date, { artifact: cm.artifact, role: cm.role });
  for (const s of readShips(path.join(root, 'epics', epic))) {
    for (const er of s.engineer_review || []) emit(er.approver, 'shipped', s.shippedAt, { story: s.story, task: s.task, repo: s.repo, risk: s.risk });
  }
  return events;
}

// True for `epics/<EP>/<artifact>.md` or `epics/<EP>/stories/<file>.md`.
function isArtifactPath(rel) {
  const parts = rel.split('/');
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

// git-sourced "authored" events: who committed which epic artifact, when. Degrades to [] when the hub
// is not a git repo (e.g. a test fixture dir), so the command never depends on git being present.
function gitAuthoredEvents(root, resolver) {
  const r = run('git', ['-C', root, 'log', '--no-merges', '--date=short', GIT_PRETTY, '--name-only', '--', 'epics']);
  if (!r.ok || !r.stdout) return [];
  const events = [];
  for (const cm of parseGitLog(r.stdout)) {
    const m = resolver.byGitAuthor(cm.an, cm.ae);
    for (const rel of cm.files) {
      if (!isArtifactPath(rel)) continue;
      events.push({
        ts: cm.ad, actor: m ? m.name || m.login : cm.an, login: m ? m.login || null : null, rostered: !!m,
        action: 'authored', epic: rel.split('/')[1], artifact: rel.split('/').pop().replace(/\.md$/, ''),
      });
    }
  }
  return events;
}

// Optional (`--repos`): code commits in each connected code repo, attributed by author → roster.
function repoCommitEvents(root, resolver) {
  const reg = readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] });
  const events = [];
  for (const repo of reg?.repos || []) {
    if (!repo.path) continue;
    const abs = path.isAbsolute(repo.path) ? repo.path : path.join(root, repo.path);
    const r = run('git', ['-C', abs, 'log', '--no-merges', '--date=short', GIT_PRETTY]);
    if (!r.ok || !r.stdout) continue;
    for (const cm of parseGitLog(r.stdout)) {
      const m = resolver.byGitAuthor(cm.an, cm.ae);
      events.push({ ts: cm.ad, actor: m ? m.name || m.login : cm.an, login: m ? m.login || null : null, rostered: !!m, action: 'committed', repo: repo.name });
    }
  }
  return events;
}

// The full, window-filtered event stream. Deterministic: sorted by (date, action, epic/repo, actor).
export function deriveEvents(root, resolver, { since, until, repos = false } = {}) {
  const events = [...gitAuthoredEvents(root, resolver)];
  for (const epic of listEpics(root)) events.push(...ledgerEvents(root, epic, resolver));
  if (repos) events.push(...repoCommitEvents(root, resolver));
  return events
    .filter((e) => inWindow(e.ts, since, until))
    .sort((a, b) =>
      a.ts.localeCompare(b.ts) || a.action.localeCompare(b.action) ||
      String(a.epic || a.repo || '').localeCompare(String(b.epic || b.repo || '')) || a.actor.localeCompare(b.actor));
}

// ---- analysis ----------------------------------------------------------------------------------

const zeroCounts = () => Object.fromEntries(ACTIONS.map((a) => [a, 0]));

// Per-member rollup + explainable hygiene flags + team totals. `window` echoes the requested range.
export function analyze(events, roster, window = { since: null, until: null }) {
  const members = new Map();
  const seed = (key, name, login, role, rostered, isReviewer = false) => {
    if (!members.has(key)) {
      members.set(key, { key, name, login: login || null, role: role || '', rostered, isReviewer, counts: zeroCounts(), total: 0, firstActive: null, lastActive: null, epics: new Set(), timeline: [] });
    }
    return members.get(key);
  };
  // Seed every roster member first so dormant members appear at zero, not missing.
  for (const m of roster) seed(m.login || m.name, m.name || m.login, m.login || null, rosterRole(m), true, isReviewerAnywhere(m));
  for (const e of events) {
    const m = seed(e.login || e.actor, e.actor, e.login, '', e.rostered);
    m.counts[e.action] = (m.counts[e.action] || 0) + 1;
    m.total += 1;
    if (e.epic) m.epics.add(e.epic);
    if (!m.firstActive || e.ts < m.firstActive) m.firstActive = e.ts;
    if (!m.lastActive || e.ts > m.lastActive) m.lastActive = e.ts;
    m.timeline.push({ ts: e.ts, action: e.action, epic: e.epic || null, repo: e.repo || null, artifact: e.artifact || null });
  }
  const list = [...members.values()].map((m) => ({
    name: m.name, login: m.login, role: m.role, rostered: m.rostered,
    counts: m.counts, total: m.total, firstActive: m.firstActive, lastActive: m.lastActive,
    epics: [...m.epics].sort(), flags: memberFlags(m), timeline: m.timeline,
  }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  const totals = zeroCounts();
  for (const m of list) for (const a of ACTIONS) totals[a] += m.counts[a];
  return { window, generatedFrom: 'derived', members: list, totals };
}

// Is this roster entry a reviewer in ANY scope? Reviewer roles are usually repo-scoped
// (`roles: { backend: ['reviewer'] }`), not hub-scoped, so a hub-only check would miss most of them.
export function isReviewerAnywhere(entry) {
  if (!entry) return false;
  if ((entry.role || '') === 'reviewer') return true;                            // legacy flat role
  if (Array.isArray(entry.roles)) return entry.roles.includes('reviewer');       // legacy hub-scope array (rolesForScope shape)
  return Object.values(entry.roles || {}).some((list) => Array.isArray(list) && list.includes('reviewer'));
}

// Factual, per-member flags — each is a plain derivation, never a score.
function memberFlags(m) {
  const flags = [];
  if (m.rostered && m.total === 0) flags.push('dormant');                       // in the roster, no activity in range
  const reviews = m.counts.commented + m.counts.approved;
  if (m.total > 0 && m.counts.authored > 0 && reviews === 0) flags.push('no-review-participation'); // authors but never reviews
  if (m.total > 0 && m.isReviewer && reviews === 0) flags.push('reviewer-not-reviewing');            // a reviewer (any scope) who never reviews
  return flags;
}

// Team-level hygiene, keyed by epic/story — a ship with no recorded engineer review is a process gap,
// not attributable to one person, so it lives here rather than in a member's flag list.
export function shipHygiene(root, { since, until } = {}) {
  const items = [];
  for (const epic of listEpics(root)) {
    for (const s of readShips(path.join(root, 'epics', epic))) {
      if (!inWindow(s.shippedAt, since, until)) continue;
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
        <h3>${esc(m.name)} ${m.login ? `<span class="login">@${esc(m.login)}</span>` : ''} ${m.role ? `<span class="role">${esc(m.role)}</span>` : ''}${m.rostered ? '' : ' <span class="role">off-roster</span>'}</h3>
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
.role{color:var(--accent);font-size:11px;border:1px solid var(--line);border-radius:6px;padding:1px 6px;margin-left:4px}
.bar{height:6px;background:var(--line);border-radius:4px;margin:10px 0;overflow:hidden}.bar span{display:block;height:100%;background:var(--accent)}
table.counts{border-collapse:collapse;font-size:12px;margin:6px 0}table.counts th{color:var(--dim);text-align:left;font-weight:500;padding:2px 14px 2px 0}table.counts td{padding:2px 14px 2px 0}
.meta{color:var(--dim);font-size:12px;margin:6px 0 0}
.flags{display:flex;gap:6px;flex-wrap:wrap}.flag{font-size:11px;border-radius:6px;padding:1px 8px;background:#3a2a12;color:#ffcf7a;border:1px solid #5a3f14}
.flag-dormant{background:#2a2f3a;color:#9aa7bd;border-color:#39414f}
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
<footer>Derived, read-only view — reconstructed from git history and the SDLC ledgers. Regenerate any time with <code>yad usage</code>. No emails, commit messages, or comment bodies are included.</footer>
</div></body></html>\n`;
}

// A compact Markdown variant for quick reads / pasting into a PR. Dynamic values are sanitized so a
// name/role/repo containing `|` or a newline can't corrupt the table or list structure.
export function renderMarkdown(model, today = '') {
  const mdCell = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const mdText = (s) => String(s ?? '').replace(/\r?\n/g, ' ');
  const L = [`# Team usage & behavior report`, ``, `- Range: **${rangeLabel(model.window)}**${today ? ` · generated ${today}` : ''}`, `- Members: ${model.members.length}`, `- Totals: ${ACTIONS.map((a) => `${a} ${model.totals[a]}`).join(' · ')}`, ``, `| member | role | ${ACTIONS.join(' | ')} | total | flags |`, `|---|---|${ACTIONS.map(() => '--:').join('|')}|--:|---|`];
  for (const m of model.members) {
    L.push(`| ${mdCell(`${m.name}${m.login ? ` (@${m.login})` : ''}`)} | ${mdCell(m.role || '—')} | ${ACTIONS.map((a) => m.counts[a]).join(' | ')} | ${m.total} | ${mdCell(m.flags.join(', ') || '—')} |`);
  }
  L.push('', '## Workflow hygiene');
  if (model.hygiene?.length) {
    L.push('Ships with no recorded engineer review:');
    for (const h of model.hygiene) L.push(`- **${mdText(h.epic)}** ${mdText(h.story || '')}${h.task ? `/${mdText(h.task)}` : ''} ${h.repo ? `(${mdText(h.repo)})` : ''} — shipped ${mdText(h.shippedAt || '?')}`);
  } else {
    L.push('No ship-without-review gaps in range. ✓');
  }
  L.push('', '_Derived, read-only — reconstructed from git + the SDLC ledgers; no emails/comment bodies._', '');
  return L.join('\n');
}

// ---- CLI entry ---------------------------------------------------------------------------------

export function buildModel(root, { since, until, repos = false, member } = {}) {
  const roster = loadRoster(root);
  const resolver = makeResolver(roster);
  const events = deriveEvents(root, resolver, { since, until, repos });
  const model = analyze(events, roster, { since: since || null, until: until || null });
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
