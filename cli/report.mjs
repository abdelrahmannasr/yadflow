// `yad report` — the self issue reporter. When a flow breaks, help the user file a well-formed bug
// in the upstream yadflow repo with diagnostics attached, so recurring issues surface to maintainers.
//
// PRIVACY IS THE POINT: the issue posts to a PUBLIC repo, so this module is allowlist-first. It
// assembles ONLY a known-safe set of fields (version, node/os, tool booleans, platform enum, error
// code/hint, a path-scrubbed message, and command + flag NAMES) and actively strips everything else —
// no absolute paths, hostnames, git URLs, repo names, roster logins/emails, epic/story IDs, branch
// names, or flag values ever leave the machine. The user sees the exact payload and confirms before
// anything is posted. See memory: no-private-data-in-reports.
import path from 'node:path';
import { c, log, info, ok, warn, note, ask, askYesNo, has, readJSON, run } from './lib.mjs';
import { VERSION, UPSTREAM_REPO, PROJECT_FILES } from './manifest.mjs';
import { createIssue, searchIssues, issueUrl, platformAuthed } from './platform.mjs';

// The upstream lives on GitHub — file there regardless of the user's own hub platform.
const UPSTREAM_PLATFORM = 'github';
const PLACEHOLDER = '‹redacted›';

// ---- scrubbing ----------------------------------------------------------------------------------

// Strip anything that could carry private context from a free-text string. Ordered so broader
// structures (URLs, hosts) go first. Over-redaction is the safe direction — a redacted timestamp or
// filename beats a leaked home directory, internal hostname, or branch name. Covers: URLs of any
// scheme, scp-style ssh remotes, emails, IPv4/IPv6 (+port), multi-label hostnames, Windows UNC and
// drive paths, unix/home paths, epic/story IDs, and remaining `a/b`-style refs (branch names).
export function scrub(s = '') {
  return String(s)
    .replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, '‹url›')          // scheme://... (http, https, ssh, git, ftp, file)
    .replace(/\b[\w.+-]+@[\w.-]+:[^\s'"]+/g, '‹url›')       // scp-style ssh remote: user@host:path
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+/g, PLACEHOLDER)       // email
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '‹ip›') // IPv4 (+ optional :port)
    .replace(/\b(?:[0-9a-f]{1,4}:){3,}[0-9a-f]{0,4}\b/gi, '‹ip›') // IPv6 (>=3 hextet groups)
    .replace(/\b(?:[\w-]+\.){2,}[a-z]{2,}\b/gi, '‹host›')   // FQDN (>=3 labels — spares 2-label filenames)
    .replace(/\\\\[\w.-]+(?:\\[\w.$-]+)+/g, '‹path›')       // Windows UNC \\host\share\...
    .replace(/\b[A-Za-z]:\\[\w.\\-]+/g, '‹path›')           // Windows drive path C:\...
    .replace(/(?:~)?\/[\w.-]+(?:\/[\w.-]+)*/g, '‹path›')    // unix/home path (>=1 segment)
    .replace(/\bEP-[a-z0-9-]+\b/gi, '‹id›')                 // epic / story IDs (standalone)
    .replace(/\b[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*\b/g, '‹ref›'); // remaining a/b refs (branch names, origin/x)
}

// The verbs `yad` understands (top-level commands + their sub-actions). Anything NOT in this set —
// roster logins, repo names, roles, epic IDs, filenames, and every flag VALUE — is dropped, so the
// reported command carries only structure, never data.
const SAFE_VERBS = new Set([
  'setup', 'check', 'update', 'doctor', 'report', 'sync-status', 'next', 'gate', 'review', 'commit',
  'open-pr', 'ship', 'repo', 'roster', 'docs', 'thread', 'reconcile',
  'open', 'sync', 'comments', 'status', 'walkthrough', 'trailer', 'ci', 'context', 'chat', 'cards',
  'nudge', 'list', 'add', 'grant', 'revoke', 'remove', 'build', 'deploy', 'refresh', 'wire',
]);

// Reduce an argv to a safe command line: the leading verb chain (at most `command subcommand`, and
// only tokens in SAFE_VERBS) plus flag NAMES only. Every positional that isn't a known verb — epic
// IDs (`EP-foo`), logins, repo names, roles, filenames — and every flag VALUE is dropped, so both
// `yad gate sync EP-x --dir /p -m "secret"` and `yad roster add joesmith` reduce to structure only.
export function sanitizeArgv(argv = []) {
  const out = [];
  let i = 0;
  for (; i < argv.length && out.length < 2; i++) {
    const t = argv[i];
    if (t.startsWith('-') || !SAFE_VERBS.has(t)) break; // stop at the first flag or non-verb token
    out.push(t);
  }
  for (; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('-')) out.push(t.split('=')[0]); // flag names only — values and positionals are never kept
  }
  return out.join(' ');
}

// ---- context (allowlist) ------------------------------------------------------------------------

// Build the safe, postable context — the ONLY data that can reach the issue. Reads doctor for tool
// state but keeps just the booleans, never the raw checks (which carry names + paths).
export function sanitizeContext(dir, { error = null, argv = process.argv.slice(2) } = {}) {
  const hub = readJSON(path.join(dir, PROJECT_FILES.hubConfig), null);
  const platform = hub && ['github', 'gitlab'].includes(hub.platform) ? hub.platform : 'file-only';
  // Derive tool auth from doctor's checks without keeping any check text.
  const toolState = (cli, p) => (has(cli) ? (platformAuthed(p) ? 'present + authenticated' : 'present, not authenticated') : 'not installed');
  const ctx = {
    version: VERSION,
    node: process.versions.node,
    os: process.platform,
    git: has('git') ? 'present' : 'not found',
    gh: toolState('gh', 'github'),
    // The hub CLI's auth is a useful diagnostic for a GitLab user (issues still file to GitHub upstream).
    ...(platform === 'gitlab' ? { glab: toolState('glab', 'gitlab') } : {}),
    platform,
    command: sanitizeArgv(argv) || '(none)',
  };
  if (error) {
    ctx.error = {
      code: /^YAD-/.test(error.code || '') ? error.code : null,
      message: scrub(error.message || String(error)),
      hint: error.hint ? scrub(error.hint) : null,
    };
  }
  return ctx;
}

// ---- body assembly ------------------------------------------------------------------------------

// Title: prefer the error code + command; fall back to the (scrubbed) summary.
export function buildTitle(ctx, summary) {
  const code = ctx.error?.code ? ` [${ctx.error.code}]` : '';
  const cmd = ctx.command && ctx.command !== '(none)' ? `\`yad ${ctx.command}\`` : 'yad';
  if (ctx.error) return `[report] ${cmd} failed${code}`;
  return `[report] ${summary ? summary.slice(0, 72) : 'yad issue'}`;
}

// Body mirrors the fields of .github/ISSUE_TEMPLATE/bug_report.yml — but only the safe subset.
export function buildBody(ctx, summary) {
  const lines = [];
  lines.push('### What happened?', '', summary || '_(no summary provided)_', '');
  lines.push(`Command: \`yad ${ctx.command}\``, '');
  lines.push('### Environment');
  lines.push(`- yadflow: \`${ctx.version}\``);
  lines.push(`- node: \`${ctx.node}\``);
  lines.push(`- os: \`${ctx.os}\``);
  lines.push(`- git: ${ctx.git}`);
  lines.push(`- gh: ${ctx.gh}`);
  if (ctx.glab) lines.push(`- glab: ${ctx.glab}`);
  lines.push(`- platform: ${ctx.platform}`);
  lines.push('');
  if (ctx.error) {
    lines.push('### Error');
    if (ctx.error.code) lines.push(`- code: \`${ctx.error.code}\``);
    lines.push(`- message: ${ctx.error.message}`);
    if (ctx.error.hint) lines.push(`- hint: ${ctx.error.hint}`);
    lines.push('');
  }
  lines.push('---', '_Filed via `yad report`. Diagnostics are auto-scrubbed — no paths, hostnames, repo names, logins, or flag values._');
  return lines.join('\n');
}

// ---- open a URL (best-effort) -------------------------------------------------------------------
function openUrl(url, { runner = run } = {}) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  if (has(cmd)) runner(cmd, [url]);
}

// ---- the flow -----------------------------------------------------------------------------------

// Never throws — a failure while reporting must not crash the CLI (and, from the top-level catch,
// must not re-trigger a report). Returns { filed, url } for tests/callers.
export async function runReport(dir, opts = {}) {
  const {
    error = null,
    message = null,
    // injectable seams (tests never shell out or prompt)
    filer = createIssue,
    searcher = searchIssues,
    prompter = askYesNo,
    asker = ask,
    opener = openUrl,
    authed = () => platformAuthed(UPSTREAM_PLATFORM),
    argv = process.argv.slice(2),
    interactive = !process.env.SDLC_NONINTERACTIVE,
  } = opts;

  try {
    const ctx = sanitizeContext(dir, { error, argv });

    // Summary — the user's own description (scrubbed for stray paths/urls). Ask if interactive.
    let summary = message ? scrub(message) : '';
    if (!summary && interactive) {
      const a = await asker('One line — what went wrong?', '');
      summary = a ? scrub(a) : '';
    }

    const title = buildTitle(ctx, summary);
    const body = buildBody(ctx, summary);
    const labels = ['bug'];

    // Dedup — search open issues by the error code (or the first summary word). Advisory: a failed
    // search just skips this step, it never blocks filing.
    const query = ctx.error?.code || (summary.split(/\s+/)[0] || '').replace(/[^\w-]/g, '');
    if (query) {
      const { ok: searchedOk, matches } = searcher(UPSTREAM_PLATFORM, UPSTREAM_REPO, `${query} in:title`);
      if (searchedOk && matches.length) {
        log(c.bold(`\nFound ${matches.length} possibly-related open issue(s):`));
        for (const m of matches) info(`#${m.number} — ${m.title}  ${c.dim(m.url)}`);
        if (interactive && await prompter('Open an existing issue instead of filing a new one?', true)) {
          opener(matches[0].url);
          log(`\n  → ${c.cyan(matches[0].url)}`);
          return { filed: false, url: matches[0].url, deduped: true };
        }
      }
    }

    // Preview — show EXACTLY what will be posted to the public repo before anything leaves.
    log(c.bold(`\nThis will be posted to ${c.cyan(UPSTREAM_REPO)} (a public repo):\n`));
    log(c.bold(title));
    log(c.dim('─'.repeat(60)));
    log(body);
    log(c.dim('─'.repeat(60)));

    // Posting to a public repo is always a deliberate act — require an explicit yes. Non-interactive
    // runs never auto-post; they hand back the prefilled URL instead.
    const confirmed = interactive ? await prompter('Post this now?', false) : false;
    if (!confirmed) {
      const url = issueUrl(UPSTREAM_PLATFORM, UPSTREAM_REPO, { title, body, labels });
      note(interactive ? 'Not posted. You can file it yourself here (prefilled):' : 'Non-interactive — not posted. File it here (prefilled):');
      log(`  → ${c.cyan(url)}`);
      return { filed: false, url };
    }

    // File directly when the CLI is authenticated; otherwise fall back to the prefilled URL.
    if (authed()) {
      const r = filer(UPSTREAM_PLATFORM, UPSTREAM_REPO, { title, body, labels });
      if (r.ok) {
        ok(`Issue filed: ${c.cyan(r.url)}`);
        return { filed: true, url: r.url };
      }
      warn(`Could not file automatically: ${r.reason || 'unknown error'}`);
    } else {
      note('gh is not authenticated — opening a prefilled issue in your browser instead.');
    }
    const url = issueUrl(UPSTREAM_PLATFORM, UPSTREAM_REPO, { title, body, labels });
    opener(url);
    log(`  → ${c.cyan(url)}`);
    return { filed: false, url };
  } catch (e) {
    // Reporting itself must never crash the CLI.
    note(`could not complete the report (${e?.message || e}) — please file manually at https://github.com/${UPSTREAM_REPO}/issues`);
    return { filed: false, url: null, failed: true };
  }
}
