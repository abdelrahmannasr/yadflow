// `yad codeowners check [<repo>]` — warn where a code repo's CODEOWNERS has gone stale (E69). The rules for
// reading the file are E68's (cli/codeowners.mjs); this finds the repos, reads each file from disk, and
// prints. Part 3: "CODEOWNERS is a hint, never an authority — in practice these files rot." So this only
// ever WARNS: it never sets a failing exit code for a finding, never writes the file (there is no
// `--write`: any name yad wrote would become an owner the platform can enforce), and never says who owns
// code.
//
// Two kinds of answer, kept apart:
//   FACTS — a line that matches no file, a GitHub file of 3 MB or more, a second file the platform never
//     reads, a line this reader cannot read. `yad doctor` prints these too.
//   A HINT — the @logins with no commit in the last 90 days that carries their noreply address. Only a
//     hint: a person may commit under a work address. Printed by this command only, never by the doctor,
//     and only where a noreply address is evidence (a github.com or gitlab.com remote).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { c, fail, hand, info, log, ok, run, warn } from './lib.mjs';
import { deadLines, diskCodeowners, parseCodeowners } from './codeowners.mjs';
import { OWNER_WINDOW, recentLoginsFor, repoFiles, targets } from './riskmap-command.mjs';
import { PUBLIC_HOST, remoteHost } from './openpr.mjs';
import { detectPlatform } from './platform.mjs';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PLATFORM_NAME = { github: 'GitHub', gitlab: 'GitLab' };
// "90 days ago" → "90 days", for the sentences.
const WINDOW_WORDS = OWNER_WINDOW.replace(/ ago$/, '');

// The paths of a repo's submodules: their contents are not in its file list.
function submodulesOf(repoRoot) {
  const r = spawnSync('git', ['ls-files', '-z', '--stage'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) return [];
  return r.stdout.split('\0').filter((l) => l.startsWith('160000 ')).map((l) => l.slice(l.indexOf('\t') + 1));
}

// A pattern is printed as written unless it holds an `@`: E67's rule that no e-mail address is ever printed.
const shownPattern = (d) => (d.pattern.includes('@') ? '' : ` (\`${d.negate ? '!' : ''}${d.pattern}\`)`);

// One repo → { git, platform, path?, none?, unknown?, tooBig?, ignored, notRead, dead, inactive? }. With
// `hint`, `inactive` is { unknown } or { quiet, checked, notChecked } (see the header).
export function checkCodeowners(repoRoot, { platform = null, remote, hint = false } = {}) {
  // A work tree, not only a repo: a bare repo has no files on disk to check.
  if (run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot }).stdout !== 'true') return { git: false };
  // The platform reads CODEOWNERS from the repo's top folder, and the file list must be the whole repo's.
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd: repoRoot }).stdout;
  if (!top || fs.realpathSync(top) !== fs.realpathSync(repoRoot)) {
    return { git: true, platform: null, ignored: [], notRead: [], dead: [], unknown: 'this folder is inside a git repo but is not its top folder, where the platform reads CODEOWNERS — check the repo\'s top folder instead' };
  }
  const url = remote ?? run('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot }).stdout;
  const plat = platform || detectPlatform(url || '');
  const base = { git: true, platform: plat, ignored: [], notRead: [], dead: [] };
  if (!plat) return { ...base, unknown: 'yad cannot tell whether this repo is on GitHub or GitLab (no `platform` in repos.json, and the origin remote names neither) — pass --platform' };
  const co = diskCodeowners(repoRoot, plat);
  if (co.unknown) return { ...base, unknown: co.unknown };
  if (co.none) return { ...base, none: co.none };
  const out = { ...base, path: co.path, ignored: co.ignored };
  if (co.tooBig) return { ...out, tooBig: true };
  // Only now the file list: it is slow on a large repo, and a repo with no CODEOWNERS never needs it.
  const files = repoFiles(repoRoot);
  if (!files) return { ...base, unknown: 'git could not list the files in this repo' };
  const parsed = parseCodeowners(co.text, plat);
  out.notRead = parsed.skipped;
  out.dead = deadLines(parsed, files, { submodules: submodulesOf(repoRoot) });
  if (hint) out.inactive = inactiveOwners(repoRoot, parsed, plat, url);
  return out;
}

// The hint: which @logins no recent commit names. Only a person's login can be checked — a team, group,
// role or address has no noreply commits of its own — and only on the public host a noreply login
// belongs to. On GitLab an `@name` may be a group; the sentence printed is true either way.
function inactiveOwners(repoRoot, parsed, platform, url) {
  const persons = new Map();
  const others = new Map();
  for (const r of parsed.rules) {
    if (r.negate) continue;
    for (const o of r.owners) {
      if (o.kind === 'user' || o.kind === 'name') {
        const k = o.text.slice(1).toLowerCase();
        if (!persons.has(k)) persons.set(k, o.text);
      } else others.set(`${o.kind}\0${o.key || o.text}`, o.kind);
    }
  }
  const notChecked = {};
  for (const kind of others.values()) notChecked[kind] = (notChecked[kind] || 0) + 1;
  if (!persons.size) return { quiet: [], checked: 0, notChecked };
  const host = PUBLIC_HOST[platform];
  if (remoteHost(url) !== host) {
    return { unknown: `the origin remote is not on ${host}, and a noreply address is evidence only for a ${host} account (a self-managed server keeps its own accounts)` };
  }
  const h = recentLoginsFor(repoRoot, 'HEAD');
  if (h.unknown) return { unknown: h.unknown };
  const seen = new Set(h.logins.filter((l) => l.host === platform).map((l) => l.login.toLowerCase()));
  return { quiet: [...persons].filter(([k]) => !seen.has(k)).map(([, text]) => text), checked: persons.size, notChecked };
}

// The facts as a list: [{ code, line?, target?, message }] — what `yad doctor` summarises and `--json` prints.
export function codeownersFindings(r) {
  const out = [];
  const name = PLATFORM_NAME[r.platform] || r.platform;
  if (r.tooBig) out.push({ code: 'too-big', target: r.path, message: `${r.path} is 3 MB or more — GitHub does not load a file that large, so it lists no owner for any file` });
  for (const p of r.ignored) out.push({ code: 'never-read', target: p, message: `${p} is never read — ${name} reads ${r.path} first` });
  for (const s of r.notRead) out.push({ code: 'not-read', line: s.line, message: `line ${s.line} not read — ${s.why}` });
  for (const d of r.dead) {
    out.push({ code: 'matches-nothing', line: d.line, message: `line ${d.line}${shownPattern(d)} ${d.negate ? 'excludes' : 'matches'} no file in this repo` });
  }
  return out;
}

const KIND_WORD = { team: ['team'], group: ['group'], role: ['role'], email: ['e-mail address', 'e-mail addresses'] };

function printRepo(name, r) {
  log(c.bold(`\ncodeowners — ${name}`));
  if (!r.git) { warn('no files on disk to check (not a git repo, or a bare one) — skipped'); return; }
  if (r.unknown) { warn(`CODEOWNERS: not known — ${r.unknown}`); return; }
  if (r.none) { info(`none — ${r.none}; nothing to check`); return; }
  const findings = codeownersFindings(r);
  for (const f of findings) warn(f.message);
  if (!findings.length) ok(`${r.path}: every line yad can read matches a file`);
  const i = r.inactive;
  if (i?.unknown) info(`owners with recent commits: not known — ${i.unknown}`);
  else if (i) {
    const host = PUBLIC_HOST[r.platform];
    const partial = r.notRead.length ? ' (from the lines yad could read)' : '';
    if (i.quiet.length) {
      const gl = r.platform === 'gitlab' ? '; on GitLab an @name can also be a group, which never commits' : '';
      hand(`no commit on the checked-out branch in the last ${WINDOW_WORDS} carries a ${host} noreply address for ${i.quiet.join(', ')}${partial} — a hint only: they may commit under another address or work in other repos, so this does not mean they have left${gl}`);
    } else if (i.checked) {
      info(`every @login ${r.path} lists${partial} has a commit in the last ${WINDOW_WORDS} with its ${host} noreply address`);
    }
    const nc = Object.entries(i.notChecked).map(([k, n]) => plural(n, ...(KIND_WORD[k] || [k])));
    if (nc.length) info(`not checked for recent commits: ${nc.join(', ')} — the hint reads only @logins`);
  }
  if (findings.length) hand(`fix ${r.path} in ${name} through a PR — the warnings are advisory: CODEOWNERS is a hint, and yad never enforces it`);
}

export async function runCodeowners(root, { action = 'check', name, json = false, platform = null, write = false } = {}) {
  if (action !== 'check' || write) {
    // `--write` was part of E69's title and was dropped by decision: a name yad wrote into the file would
    // become an owner the platform can enforce ("Require review from Code Owners"), turning a hint into an
    // authority. Said plainly, so a habit or a script learns why.
    if (write || action === 'write' || action === '--write') {
      fail('yad never writes CODEOWNERS — any name it wrote would become an owner the platform can enforce');
      hand('edit CODEOWNERS by hand and commit it through a PR; `yad codeowners check` shows which lines look stale');
    } else fail(`unknown action: ${action} (use: yad codeowners check [repo])`);
    process.exitCode = 1;
    return { ok: false };
  }
  const t = targets(root, name);
  if (t.error) {
    if (json) log(JSON.stringify({ ok: false, error: t.error, hint: t.hint }, null, 2));
    else { fail(t.error); hand(t.hint); }
    process.exitCode = 1;
    return { ok: false };
  }
  const repos = t.list.map((x) => ({ name: x.name, root: x.root, ...checkCodeowners(x.root, { platform: platform || x.platform, hint: true }) }));
  if (json) {
    log(JSON.stringify({ ok: true, repos: repos.map((r) => ({
      name: r.name, git: r.git, platform: r.platform ?? null, path: r.path ?? null,
      ...(r.none ? { none: r.none } : {}), ...(r.unknown ? { unknown: r.unknown } : {}),
      findings: r.git && !r.unknown && !r.none ? codeownersFindings(r) : [],
      ...(r.inactive ? { inactive: r.inactive } : {}),
    })) }, null, 2));
    return { ok: true, repos };
  }
  for (const r of repos) printRepo(r.name, r);
  return { ok: true, repos };
}
