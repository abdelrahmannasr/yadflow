// E172 — the findings of a scan, filed on the repo's own GitHub issues or GitLab work items. The CLI never starts an
// AI: the yad-scan skill does the judging and hands a findings file to `yad scan file`, which does everything that
// must be exact: checking the file, finding duplicates, routing security findings, labels, milestones and filing.
//
// A finding's text came from a model that read possibly hostile code, so it is untrusted. Secrets are redacted, and
// it is escaped so it cannot notify a person, link anywhere, or forge a fingerprint.
// The platform is the record of what was filed: a fingerprint in each body, so there is no file here to keep.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { run, readJSON, forTerminal, c, log, fail, hand, info, warn, emitJSON } from './lib.mjs';
import { productConfigPath } from './manifest.mjs';
import { productIdentity } from './members.mjs';
import { prTarget } from './pr-list.mjs';
import { repoSources } from './standup.mjs';
import { api, httpStatus, shown, whyFailed } from './protection.mjs';
import { createFinding, createDraftAdvisory, createMilestone } from './platform.mjs';
import { createLabel, labelRules, mdEscape, PRIORITIES, readLabels } from './issues.mjs';

export const CATEGORIES = ['security', 'tech-debt', 'suggestion'];
export const MAX_FILED = 20;
const MAX_IN_FILE = 200;
const PAGE = 100;
const MAX_PAGES = 10;
export const FINDING_LABEL = 'yad: finding';
export const DEFAULT_MILESTONES = { security: 'yad: Security', 'tech-debt': 'yad: Technical debt', suggestion: 'yad: Suggestions' };
const CATEGORY_NAME = { security: 'Security', 'tech-debt': 'Technical debt', suggestion: 'Suggestion' };
const SEVERITY = { P0: 'critical', P1: 'high', P2: 'medium', P3: 'low' };
const MARKER = /<!-- yad-finding: ([0-9a-f]{64}) -->/g;

// ---- checking the file -------------------------------------------------------------------------------

export function badPath(p) {
  if (typeof p !== 'string' || !p || p.length > 300) return true;
  if (/^[/\\]|^[a-zA-Z]:|\\/.test(p) || [...p].some((ch) => ch.charCodeAt(0) < 32)) return true;
  return p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '');
}

const text = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

// Why one finding is refused, or null.
function problemWith(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return 'it is not an object';
  if (!CATEGORIES.includes(f.category)) return `category must be one of ${CATEGORIES.join(', ')}`;
  if (!PRIORITIES.includes(f.priority)) return `priority must be one of ${PRIORITIES.join(', ')}`;
  if (f.category === 'security' ? !/^CWE-\d{1,6}$/.test(f.rule ?? '') : !/^[a-z0-9][a-z0-9-]{0,63}$/.test(f.rule ?? '')) return f.category === 'security' ? 'a security rule must be a CWE number, such as CWE-79' : 'rule must be a short lower-case slug';
  if (typeof f.symbol !== 'string' || f.symbol.length > 200) return 'symbol must be a string (it may be empty)';
  if (badPath(f.file)) return 'file must be a path relative to the repo';
  if (!Number.isInteger(f.line) || f.line < 1) return 'line must be a positive whole number';
  if (!text(f.title, 200)) return 'title must be text of at most 200 characters';
  if (!text(f.why, 4000)) return 'why must be text of at most 4000 characters';
  if (!text(f.fix, 4000)) return 'fix must be text of at most 4000 characters';
  return null;
}

// `{ findings }` or `{ error }`. One bad finding refuses the whole file: the skill wrote it, and should fix it.
export function parseFindings(raw) {
  let doc;
  try { doc = JSON.parse(raw); } catch { return { error: 'the findings file is not JSON' }; }
  const list = Array.isArray(doc) ? doc : doc?.findings;
  if (!Array.isArray(list)) return { error: 'the findings file needs a "findings" list' };
  if (list.length > MAX_IN_FILE) return { error: `the findings file has more than ${MAX_IN_FILE} findings` };
  const problems = list.flatMap((f, i) => { const p = problemWith(f); return p ? [`finding ${i + 1}: ${p}`] : []; });
  return problems.length ? { error: problems.slice(0, 10).join('; ') } : { findings: list };
}

// Not the line: it moves. Not the title: two runs word it differently.
export const fingerprint = (f) => createHash('sha256').update(JSON.stringify([f.category, f.file, f.rule, f.symbol])).digest('hex');

// ---- making text safe to post ------------------------------------------------------------------------

const SECRET = /(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{12,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|-----BEGIN[^-]*-----|[A-Za-z0-9+_=-]{40,})/g;
export const redact = (s) => String(s ?? '').replace(SECRET, '[redacted]');
const plain = (s, max) => { const t = forTerminal(redact(s)).replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
// An invisible space after each trigger stops a mention or a reference. GitHub reads backslashes and HTML entities as
// the real character before it looks for one, so neither of those is enough (checked against its renderer).
const ZWSP = '\u200b';
const breakRefs = (t) => t.replace(/GH-(?=\d)/gi, (m) => `${m}${ZWSP}`).replace(/[%$](?=[\w"])/g, (m) => `${m}${ZWSP}`);
// A title is not Markdown, but a mention in one can still notify.
export const safeTitle = (s) => breakRefs(plain(s, 200).replace(/[@#!~&](?=\S)/g, (m) => `${m}${ZWSP}`));
// `mdEscape` stops links, images, tags and code.
// A leading `/` is broken too: at the start of a line GitLab runs it as a quick action, such as `/assign`.
export const safeMd = (s, max = 2000) => breakRefs(mdEscape(plain(s, max)).replace(/\\([@#!~&])/g, `$1${ZWSP}`)).replace(/^\//, `${ZWSP}/`);

export function findingBody(f, fp, { task = null, labelled = true } = {}) {
  return [
    `**Category:** ${CATEGORY_NAME[f.category]} · **Priority:** ${f.priority}${labelled ? '' : ` · **Rule:** ${safeMd(f.rule, 80)}`}`,
    `**Where:** ${safeMd(f.file, 300)}, line ${f.line}${f.symbol ? ` (${safeMd(f.symbol, 200)})` : ''}`,
    '', '### Why it matters', safeMd(f.why, 4000),
    '', '### What to do', safeMd(f.fix, 4000),
    '', `_Found by the yadflow scan${task ? ` of task ${safeMd(task, 80)}` : ''}. Check it before acting on it._`,
    `<!-- yad-finding: ${fp} -->`,
  ].join('\n');
}

// ---- reading what is already there -------------------------------------------------------------------

// Every fingerprint on items labelled as findings, open and closed. Null if any page failed or the limit was reached.
function filedFingerprints(t, runner) {
  const gh = t.platform === 'github';
  const label = encodeURIComponent(FINDING_LABEL);
  const at = gh ? `repos/${t.repo}/issues?labels=${label}&state=all&per_page=${PAGE}` : `projects/${encodeURIComponent(t.repo)}/issues?labels=${label}&scope=all&per_page=${PAGE}`;
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = api(runner, t.cli, t.host, `${at}&page=${page}`);
    if (!res.ok || !Array.isArray(res.body)) return { why: whyFailed(res.ok ? { unreadable: true } : res, { platform: t.platform, host: t.host, what: `the findings already filed on ${shown(t.repo)}`, plural: true }) };
    for (const it of res.body) for (const m of String((gh ? it?.body : it?.description) ?? '').matchAll(MARKER)) seen.add(m[1]);
    if (res.body.length < PAGE) return { seen };
  }
  return { why: `${shown(t.repo)} has more filed findings than yad reads` };
}

// Paging here is by cursor, so a full page is treated as not fully read.
function draftAdvisories(t, runner) {
  // Every state: a draft a person closed or published must not come back.
  const res = api(runner, t.cli, t.host, `repos/${t.repo}/security-advisories?per_page=${PAGE}`);
  if (!res.ok || !Array.isArray(res.body)) return { why: res.ok ? 'the advisories could not be understood' : `the advisories could not be read${res.status ? ` (HTTP ${res.status})` : ''}: an administrator or security manager must run this` };
  if (res.body.length >= PAGE) return { why: 'there are too many advisories to read them all' };
  const seen = new Set();
  for (const a of res.body) for (const m of String(a?.description ?? '').matchAll(MARKER)) seen.add(m[1]);
  return { seen };
}

// `vis` is public, private, internal, or null. `noPush` is true only when GitHub says so: it silently drops the labels
// and milestone of an item made without push access, and the next run could not recognise that item.
export function repoFacts(t, runner) {
  const res = api(runner, t.cli, t.host, `repos/${t.repo}`);
  if (!res.ok || !res.body || typeof res.body !== 'object') return { vis: null, noPush: false };
  const b = res.body;
  const vis = ['public', 'private', 'internal'].includes(b.visibility) ? b.visibility : (b.private === true ? 'private' : null);
  return { vis, noPush: b.permissions?.push === false };
}

// What the platform really did with an item: why it is not what was asked, or null.
function droppedFrom(stdout, confidential) {
  let b;
  try { b = JSON.parse(stdout); } catch { return 'the answer could not be read'; }
  const names = (Array.isArray(b?.labels) ? b.labels : []).map((l) => String(typeof l === 'string' ? l : l?.name).toLowerCase());
  if (confidential && b?.confidential !== true) return 'it was NOT made confidential: restrict it now';
  if (!names.includes(FINDING_LABEL)) return 'the platform dropped its label, so a later scan would file it again';
  return null;
}

// Map(title → id), across open and closed. Null if unread. GitHub assigns by number, GitLab by id.
function readMilestones(t, runner) {
  const gh = t.platform === 'github';
  const at = gh ? `repos/${t.repo}/milestones?state=all&per_page=${PAGE}` : `projects/${encodeURIComponent(t.repo)}/milestones?per_page=${PAGE}`;
  const map = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = api(runner, t.cli, t.host, `${at}&page=${page}`);
    if (!res.ok || !Array.isArray(res.body)) return null;
    for (const m of res.body) { const id = gh ? m?.number : m?.id; if (typeof m?.title === 'string' && Number.isInteger(id)) map.set(m.title, id); }
    if (res.body.length < PAGE) return map;
  }
  return null;
}

// ---- routing ------------------------------------------------------------------------------------------

// Where one finding goes: 'issue', 'confidential', 'advisory', or 'none'. Only a repo known to be private gets a
// normal issue for a security finding on GitHub: an unknown one is treated as public.
export function routeFor(category, platform, vis) {
  if (category !== 'security') return 'issue';
  if (platform === 'gitlab') return 'confidential';
  if (vis === 'private') return 'issue';
  return vis === 'public' ? 'advisory' : 'none';
}
const ROUTE_WHY = 'this repo\'s visibility could not be confirmed as private or public, so it was kept off the tracker';

function scanSettings(productConfig) {
  const set = productConfig?.issues?.scan;
  const titles = { ...DEFAULT_MILESTONES };
  for (const k of CATEGORIES) if (typeof set?.milestones?.[k] === 'string' && set.milestones[k].trim()) titles[k] = set.milestones[k].trim();
  return { enabled: set?.enabled !== false, titles };
}

function targetFor(root, productConfig, repo, { env, runner }) {
  const identity = productIdentity(root, { productConfig, runner });
  const notRead = [];
  // The first source is the Product itself. Findings belong to a registered code repo, even one named `Product`.
  const s = repoSources(root, identity, productConfig, notRead, env, { localPaths: false }).slice(1).find((x) => x.label === repo);
  if (!s) return { why: notRead.length ? 'the repo list could not be read' : `no registered repo is called ${forTerminal(repo)}` };
  const t = prTarget({ platform: s.platform, gitUrl: s.gitUrl }, { env, runner });
  return t.ok ? { t } : { why: t.why };
}

const NO_PUSH = 'your login cannot push to this repo, so the platform would drop its labels';
const rank = (p) => PRIORITIES.indexOf(p);

// ---- the command --------------------------------------------------------------------------------------

export async function runScanFile(root, { file, repo, task = null, dryRun = false, json = false, env = process.env, runner = run } = {}) {
  const refuse = (message, hint) => {
    process.exitCode = 1;
    if (json) return emitJSON({ ok: false, error: message, hint: hint ?? null });
    fail(message); if (hint) hand(hint);
    return undefined;
  };
  if (!fs.existsSync(productConfigPath(root))) return refuse('not a Product (no .sdlc/product.json here)', 'run it from the Product, or pass --dir');
  if (!file || !repo) return refuse('usage: yad scan file <findings.json> --repo <name> [--task <id>] [--dry-run] [--json]');
  if (task !== null && !/^[A-Za-z0-9._-]{1,64}$/.test(task)) return refuse('--task must be a plain task id');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return refuse('the findings file could not be read'); }
  const parsed = parseFindings(raw);
  if (parsed.error) return refuse(`findings refused: ${forTerminal(parsed.error)}`, 'fix the file and run it again. Nothing was filed');
  const productConfig = readJSON(productConfigPath(root), null);
  const settings = scanSettings(productConfig);
  const skip = (why) => { if (json) return emitJSON({ ok: true, skipped: why, filed: [], duplicates: 0, notFiled: [], failed: [], notes: [], overCap: 0, dryRun }); info(`scan not filed: ${why}`); return undefined; };
  if (!settings.enabled) return skip('issues.scan.enabled is false in .sdlc/product.json');
  if (env.YAD_PLATFORM_READ === '0') return skip('platform reads are turned off (YAD_PLATFORM_READ=0)');
  const where = targetFor(root, productConfig, repo, { env, runner });
  if (!where.t) return refuse(`${forTerminal(repo)}: ${where.why}`, 'nothing was filed. The findings file can be run again');
  const { t } = where;
  // A read that failed is unknown, not "nothing filed yet": filing now could post every finding a second time.
  const filed = filedFingerprints(t, runner);
  if (!filed.seen) return refuse(`nothing was filed: ${filed.why}`, 'the findings file can be run again');

  const unique = [...new Map(parsed.findings.map((f) => [fingerprint(f), f])).entries()];
  const fresh = unique.filter(([fp]) => !filed.seen.has(fp));
  let duplicates = unique.length - fresh.length;
  const { vis, noPush } = t.platform === 'github' && fresh.length ? repoFacts(t, runner) : { vis: null, noPush: false };
  const notFiled = [];
  const ordered = [];
  let drafts = null;
  for (const [fp, f] of fresh) {
    const route = routeFor(f.category, t.platform, vis);
    if (route === 'none') { notFiled.push({ fingerprint: fp, category: f.category, priority: f.priority, title: plain(f.title, 200), file: f.file, line: f.line, why: ROUTE_WHY }); continue; }
    if (route === 'advisory') {
      drafts ??= draftAdvisories(t, runner);
      if (!drafts.seen) { notFiled.push({ fingerprint: fp, category: f.category, priority: f.priority, title: plain(f.title, 200), file: f.file, line: f.line, why: drafts.why }); continue; }
      if (drafts.seen.has(fp)) { duplicates++; continue; }
    }
    ordered.push({ fp, f, route });
  }
  ordered.sort((a, b) => rank(a.f.priority) - rank(b.f.priority));
  const chosen = ordered.slice(0, MAX_FILED);
  const overCap = ordered.length - chosen.length;
  const rules = labelRules(productConfig);
  const result = { ok: true, skipped: null, dryRun, filed: [], duplicates, notFiled, failed: [], notes: [], overCap };
  const labelsOf = (f) => [FINDING_LABEL, rules.priority[f.priority][0], rules.type[f.category][0]];

  const wantsTracker = chosen.filter((x) => x.route !== 'advisory');
  if (dryRun) {
    for (const { fp, f, route } of chosen) {
      const row = { fingerprint: fp, category: f.category, priority: f.priority, title: plain(f.title, 200) };
      if (noPush && route !== 'advisory') result.failed.push({ ...row, why: NO_PUSH });
      else result.filed.push({ ...row, to: route, url: null, wouldFile: true });
    }
  } else {
    // A finding without its label could not be recognised next time, and would be filed again: labels come first.
    let labelsReady = !noPush;
    if (wantsTracker.length && labelsReady) {
      const have = readLabels(t, runner);
      if (!have.ok) labelsReady = false;
      else for (const name of new Set(wantsTracker.flatMap(({ f }) => labelsOf(f)))) {
        if (have.names.has(name.toLowerCase())) continue;
        if (!createLabel(t, name, name === FINDING_LABEL ? '5319e7' : '1d76db', runner).ok) labelsReady = false;
      }
    }
    const milestones = new Map();
    const existing = wantsTracker.length && labelsReady ? readMilestones(t, runner) : null;
    if (wantsTracker.length && labelsReady && !existing) result.notes.push('the milestones could not be read, so these findings have none');
    const milestoneFor = (category) => {
      if (!existing) return null;
      if (milestones.has(category)) return milestones.get(category);
      const title = settings.titles[category];
      let id = existing.get(title) ?? null;
      if (id === null) {
        const r = createMilestone(t, title, { runner });
        try { id = r.ok ? (t.platform === 'github' ? JSON.parse(r.stdout).number : JSON.parse(r.stdout).id) ?? null : null; } catch { id = null; }
        if (id === null) result.notes.push(`the milestone ${forTerminal(title)} could not be created`);
      }
      milestones.set(category, id);
      return id;
    };
    // Once the platform has dropped something, the next item would lose the same thing.
    let halted = false;
    for (const { fp, f, route } of chosen) {
      const title = safeTitle(f.title);
      const row = { fingerprint: fp, category: f.category, priority: f.priority, title };
      if (route === 'advisory') {
        const r = createDraftAdvisory(t, { summary: title, description: findingBody(f, fp, { task, labelled: false }), severity: SEVERITY[f.priority], cwe: f.rule }, { runner });
        if (r.ok) { let url = null; try { url = JSON.parse(r.stdout).html_url ?? null; } catch { /* filed, with no address */ } result.filed.push({ ...row, to: 'advisory', url }); }
        else notFiled.push({ ...row, file: f.file, line: f.line, why: [403, 404].includes(httpStatus(r)) ? `the draft advisory was refused (HTTP ${httpStatus(r)}): an administrator or security manager must run this` : `GitHub did not accept the draft advisory${httpStatus(r) ? ` (HTTP ${httpStatus(r)})` : ''}` });
        continue;
      }
      if (halted) { result.failed.push({ ...row, why: 'not sent: an earlier finding in this run did not come back as asked. Fix that first; running the scan again would send one more' }); continue; }
      if (!labelsReady) { result.failed.push({ ...row, why: noPush ? NO_PUSH : 'the labels could not be read or created, so it would not be recognised next time' }); continue; }
      const r = createFinding(t, { title, body: findingBody(f, fp, { task }), labels: labelsOf(f), milestone: milestoneFor(f.category), confidential: route === 'confidential' }, { runner });
      if (r.ok) {
        let url = null;
        try { const b = JSON.parse(r.stdout); url = b.html_url ?? b.web_url ?? null; } catch { /* the check below says so */ }
        const dropped = droppedFrom(r.stdout, route === 'confidential');
        if (dropped) { halted = true; result.failed.push({ ...row, url, why: dropped }); } else result.filed.push({ ...row, to: route, url });
      }
      else result.failed.push({ ...row, why: httpStatus(r) ? `${t.host} answered HTTP ${httpStatus(r)}` : 'the platform refused it' });
    }
  }
  if (result.failed.length) { process.exitCode = 1; result.ok = false; }
  // The answer of a --json run: the command runner prints what is returned, once.
  if (json) return result;
  for (const x of result.filed) {
    const line = `${x.priority} ${x.category}: ${forTerminal(x.title)} ${c.dim(`→ ${dryRun ? 'would file as ' : ''}${x.to}`)}${x.url ? ` ${x.url}` : ''}`;
    if (x.priority === 'P0') warn(line); else log(`  ${line}`);
  }
  for (const x of notFiled) warn(`NOT FILED ${x.priority} ${x.category}: ${forTerminal(x.title)} (${forTerminal(x.file)}:${x.line}): ${forTerminal(x.why)}`);
  for (const x of result.failed) warn(`failed ${x.priority} ${x.category}: ${forTerminal(x.title)}: ${forTerminal(x.why)}${x.url ? ` ${x.url}` : ''}`);
  for (const n of result.notes) info(n);
  if (overCap) info(`${overCap} more finding(s) were left out: at most ${MAX_FILED} are filed per run, most urgent first. Run the scan again to file them`);
  info(`${result.filed.length} ${dryRun ? 'would be filed' : 'filed'}, ${duplicates} already filed, ${notFiled.length} not filed`);
  return undefined;
}
