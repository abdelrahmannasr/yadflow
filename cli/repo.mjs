// `yad repo list|refresh|pack|sync|clone|preview` — connected-repo maintenance as explicit HUMAN decisions.
// list/refresh: staleness of the cached code-context pack (HEAD != syncedHead). Skill steps no longer
// silently repack a stale repo; they flag it and point here. (`yad check --fix` refreshes too — also
// human-invoked.) sync: switch every connected repo to its registry default_branch and fast-forward
// it to origin — a working-tree-only op (it never writes the registry; a dirty tree is skipped).
// clone (E81): clone every registered repo that is missing on this machine — `yad join`'s clone step,
// for the repo a teammate registered after you joined. It never runs git in a repo already there.
// pack (#213): run Repomix on one registered repo the safe way, for an agent that needs a pack (the
// skills used to tell it to start Repomix with npx inside the repo, where a committed `.npmrc` picks the registry).
import fs from 'node:fs';
import path from 'node:path';
import { c, log, ok, info, warn, hand, fail, writeJSON, run, has } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { judgeRepo, cloneMissingRepos, reportClones, readRegistry, codeContextPathOk, CODE_CONTEXT_DIR, runnable, shown } from './workspace.mjs';
import { gitHead, packRepo, runRepomix } from './setup.mjs';
import { publishCodeContext, publishTarget, packOf, codeMapOf } from './repo-publish.mjs';
import { PREVIEW_KEY, patternProblems } from './preview.mjs';

// Why `refresh` will not pack this entry, or null when it will (E81): see the loop in `runRepo`.
function notPackable(root, repo, j) {
  if (j.state === 'missing') return 'not cloned on this machine (`yad repo clone`)';
  if (j.state === 'refused') return j.reason;
  if (j.linked) return 'a folder on its path, inside a repo, is a link, so the checkout is not where the path says';
  if (!codeContextPathOk(root, packOf(repo)) || !codeContextPathOk(root, codeMapOf(repo))) return `its contextPack or codeMap is not a path under ${CODE_CONTEXT_DIR}/ in the Product`;
  return null;
}

// Strict (E81): a registry that does not parse is said, not read as "no repos" — and `refresh` writes it
// back, so a lenient read would replace a broken file (and every entry in it) with an empty list.
function load(root) {
  return { regPath: path.join(root, PROJECT_FILES.reposRegistry), ...readRegistry(root) };
}

// HEAD != syncedHead => stale (config.yaml code_context.staleness: head-sha). A repo that has a HEAD but
// no syncedHead was registered without a pack (the greenfield path) — it needs an initial pack, which is
// also a "run `yad repo refresh`" state, kept distinct from HEAD-moved staleness.
function staleness(root, repo) {
  const head = gitHead(path.resolve(root, repo.path));
  const neverPacked = !!head && !repo.syncedHead;
  const stale = head && repo.syncedHead && head !== repo.syncedHead;
  return { head, stale: !!stale, unknown: !head, neverPacked };
}

// ---- git helpers for `sync` (local-user auth only — never embed credentials) ----
const git = (cwd, ...args) => run('git', args, { cwd });
const hasRemote = (cwd, remote = 'origin') => git(cwd, 'remote', 'get-url', remote).ok;
const isDirty = (cwd) => { const r = git(cwd, 'status', '--porcelain'); return r.ok && r.stdout.length > 0; };
const currentBranch = (cwd) => { const r = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD'); return r.ok ? r.stdout : null; };
// Registry default_branch wins; else origin/HEAD; else 'main'. The registry is shared content, and the
// name is handed to `git fetch` and `git checkout`: `--upload-pack=<command>` would run a command. So a
// recorded name must be a valid `refs/heads/<name>` (which also rules out `@{-1}`) and must not start
// with `-` or `+` (a forced refspec); anything else is null.
function defaultBranch(cwd, repo) {
  if (repo.default_branch != null && repo.default_branch !== '') {
    const b = repo.default_branch;
    return typeof b === 'string' && !/^[-+]/.test(b) && git(cwd, 'check-ref-format', `refs/heads/${b}`).ok ? b : null;
  }
  // origin/HEAD is what the remote says — the remote the registry chose — so it passes the same test.
  const r = git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  if (!r.ok || !r.stdout) return 'main';
  const b = r.stdout.replace(/^origin\//, '');
  return !/^[-+]/.test(b) && git(cwd, 'check-ref-format', `refs/heads/${b}`).ok ? b : null;
}

export async function runRepo(root, { action = 'list', name, pattern, clear = false, today, push = false, allowBranch = false, include, logs = false, out } = {}) {
  const { regPath, registry, problem } = load(root);
  // A refresh that stops here published nothing, and says so as every refused refresh does (`published: null`).
  if (problem) { fail(`${problem} — fix it in the Product and re-run`); process.exitCode = 1; return { action, repos: [], ...(action === 'refresh' ? { refreshed: 0, published: null, next: [] } : {}) }; }
  if (!registry.repos.length) { warn('no repos registered (.sdlc/repos.json) — run `yad setup`'); return { action, repos: [], ...(action === 'refresh' ? { next: [] } : {}) }; }
  // An entry that is not an object (`null`, `5`) is named where it would be acted on, never dereferenced.
  const isEntry = (r) => !!r && typeof r === 'object' && !Array.isArray(r);
  const odd = registry.repos.filter((r) => !isEntry(r)).length;
  if (odd) warn(`${odd} entr${odd > 1 ? 'ies' : 'y'} in ${PROJECT_FILES.reposRegistry} ${odd > 1 ? 'are' : 'is'} not an object — skipped; fix ${odd > 1 ? 'them' : 'it'} in the Product`);
  const entries = registry.repos.filter(isEntry);

  if (action === 'list') {
    log(c.bold('\nconnected repos'));
    let staleCount = 0;
    const rows = [];   // the --json answer (E1): each repo, as the list reads it
    let missing = 0;
    for (const repo of entries) {
      // Judged before git runs (E81): only a checkout that is there is read. A missing repo says so and
      // names the command that clones it; a refused entry says why — git is never run in it.
      const j = judgeRepo(root, repo);
      // A checkout behind a link inside a repo's tree is not read either, as `sync` and `refresh` skip it.
      if (j.linked) Object.assign(j, { state: 'refused', reason: 'a folder on its path, inside a repo, is a link, so the checkout is not where the path says' });
      if (j.state === 'missing' || j.state === 'refused') {
        rows.push({ name: repo.name ?? null, path: repo.path ?? null, head: null, syncedHead: repo.syncedHead ?? null, state: j.state === 'missing' ? 'missing' : 'refused', ...(j.reason ? { reason: j.reason } : {}) });
        if (j.state === 'missing') { missing++; warn(`${j.name} ${c.dim(`(${j.path})`)} — ${c.yellow('not cloned on this machine')}`); }
        else warn(`${j.name} ${c.dim(`(${j.path})`)} — ${j.reason}`);
        continue;
      }
      const { head, stale, unknown, neverPacked } = staleness(root, repo);
      rows.push({ name: repo.name ?? null, path: repo.path ?? null, head: head || null, syncedHead: repo.syncedHead ?? null,
        state: unknown ? 'unreadable' : neverPacked ? 'no-pack' : stale ? 'stale' : 'fresh',
        ...(typeof repo[PREVIEW_KEY] === 'string' ? { preview_url: repo[PREVIEW_KEY] } : {}) });
      if (typeof repo[PREVIEW_KEY] === 'string') info(`${j.name} ${c.dim('— preview')} ${shown(repo[PREVIEW_KEY])}`);
      if (unknown) { warn(`${j.name} ${c.dim(`(${j.path})`)} — HEAD unreadable`); continue; }
      if (neverPacked) { staleCount++; warn(`${j.name} ${c.dim(`(${j.path})`)} — ${c.yellow('no code-context pack yet')} (registered without one)`); }
      else if (stale) { staleCount++; warn(`${j.name} ${c.dim(`(${j.path})`)} — ${c.yellow('stale')} (HEAD moved since last pack)`); }
      else ok(`${j.name} ${c.dim('— fresh')}`);
    }
    if (missing) hand('clone the missing repo(s) with `yad repo clone`');
    if (staleCount) hand(`refresh with \`yad repo refresh${entries.length > 1 ? ' <name>' : ''}\` (or \`yad repo refresh\` for all)`);
    return { action, repos: rows, stale: staleCount, missing };
  }

  if (action === 'refresh') {
    const targets = name ? entries.filter((r) => r.name === name) : entries;
    if (name && !targets.length) { fail(`unknown repo: ${shown(name)}`); process.exitCode = 1; return { action, refreshed: 0, repos: [], published: null, next: [] }; }
    // With --push the branch is checked BEFORE the packs and the registry are written (#632): a refused
    // branch leaves the Product as it was.
    const target = push ? publishTarget(root, { allowBranch }) : null;
    if (push && !target) return { action, refreshed: 0, repos: [], published: null, next: [] };
    let refreshed = 0;
    let published = null;
    const rows = [];
    const packedNames = [];
    for (const repo of targets) {
      // Judged before git runs (E81), as `sync` judges it: only a checkout that is there is packed, never
      // one reached through a link inside a repo's tree (repomix would pack wherever the link points,
      // git logs included). And the pack is written only where the Product keeps code context.
      const j = judgeRepo(root, repo);
      const why = notPackable(root, repo, j);
      if (why) {
        warn(`${j.name}: ${why} — skipped`);
        rows.push({ name: repo.name ?? null, refreshed: false, head: null });
        continue;
      }
      const { head, unknown } = staleness(root, repo);
      if (unknown) { warn(`${j.name}: HEAD unreadable — skipped`); rows.push({ name: repo.name ?? null, refreshed: false, head: null }); continue; }
      log(`  ${c.bold(j.name)}`);
      const packed = !!packRepo(root, { ...repo, contextPack: packOf(repo) });
      if (packed) {
        repo.syncedHead = head;
        if (today) repo.lastSyncedAt = today;   // always stamp when a date is supplied (the CLI passes today)
        refreshed++;
        packedNames.push(repo.name);
      }
      rows.push({ name: repo.name ?? null, refreshed: packed, head: head || null });
    }
    // Never through a `.sdlc` the Product commits as a link: the rename would land in the folder it names
    // (E81 review 17).
    let sdlcLinked = false;
    try { sdlcLinked = fs.lstatSync(path.dirname(regPath)).isSymbolicLink(); } catch { /* not there */ }
    if (sdlcLinked) {
      // A refusal stops here, `--push` included (E81 review 18): nothing is published after it.
      fail(`${path.dirname(PROJECT_FILES.reposRegistry)} in the Product is a link — ${PROJECT_FILES.reposRegistry} was not written`);
      process.exitCode = 1;
      return { action, refreshed, repos: rows, published: null, next: [] };
    }
    writeJSON(regPath, registry);
    refreshed ? ok(`refreshed ${refreshed} repo(s)`) : info('nothing refreshed');
    if (push) {
      // Publish whatever tracked code-context now differs (the AI-regenerated code-maps + the stamped
      // registry) straight to the Product's default branch as one audit-trail commit. The pack itself is
      // gitignored (packRepo scaffolds the ignore; publish self-heals a pre-ignore tracked pack); the
      // code-map is regenerated by the AI (yad-connect-repos) — run that first if a repo's map is stale,
      // then `yad repo refresh --push` lands it.
      published = (await publishCodeContext(root, { push: true, allowBranch, name, target })) ?? null;
    } else {
      hand('regenerate the code-map in your AI agent (yad-connect-repos) — the pack is cached, the map is the AI step');
      hand('then publish it to the Product default branch with `yad repo refresh --push`');
    }
    // The pack and the registry are what the project brain reads (E176), so a refresh that packed a repo leaves
    // the brain behind: name the build as the next command (EP-brain-first-S01). `next` carries it for a
    // --json reader, whom the hand-off lines never reach. One repo packed: only its code graph is built again,
    // and its name goes on the command line only when it is a plain word.
    const next = [];
    if (packedNames.length) {
      const only = packedNames.length === 1 && typeof packedNames[0] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(packedNames[0]) ? packedNames[0] : null;
      next.push(only ? `yad brain build --repo ${only}` : 'yad brain build');
      hand(`${push ? 'then' : 'last, after the code-map is written again and published,'} build the project brain: \`${next[0]}\``);
    }
    // `published`: what `--push` did (`{ message, committed, pushed }`), or null when it committed nothing
    // — nothing to publish, or a refusal, which the answer's `error` then names.
    return { action, refreshed, repos: rows, published, next };
  }

  if (action === 'sync') {
    const targets = name ? entries.filter((r) => r.name === name) : entries;
    if (name && !targets.length) { fail(`unknown repo: ${shown(name)}`); process.exitCode = 1; return { action, synced: 0, skipped: 0, repos: [] }; }
    log(c.bold('\nsync connected repos'));
    let synced = 0, skipped = 0;
    for (const repo of targets) {
      // The registry is shared content, and sync runs git in each path (E81): the same judgement the
      // clone step makes comes first. A path outside the workspace or through `.git` is refused; so is a
      // folder with no `.git` (a committed folder shaped like a bare repo would have git read its
      // `config`), and a checkout reached through a link inside a repo's tree (the Product's
      // `evil -> ../../..`). A link of the person's own, directly in the workspace folder, is followed.
      const j = judgeRepo(root, repo);
      const tag = `${j.name} ${c.dim(`(${j.path})`)}`;
      if (j.state === 'missing') { warn(`${tag} — not cloned on this machine — skipped (\`yad repo clone\`)`); skipped++; continue; }
      if (j.state === 'refused') { warn(`${tag} — ${j.reason} — skipped`); skipped++; continue; }
      if (j.linked) { warn(`${tag} — a folder on its path, inside a repo, is a link, so the checkout is not where the path says — skipped`); skipped++; continue; }
      // A folder inside another checkout (a monorepo's `apps/web`): switching "its" branch would switch
      // the whole checkout, on this entry's say-so. Sync the checkout it belongs to instead.
      if (j.inside) { info(`${tag} — a folder inside the checkout ${shown(path.relative(root, j.inside) || '.')}, not a repo of its own — skipped (sync that checkout)`); skipped++; continue; }
      const repoRoot = j.target || path.resolve(root, repo.path);
      if (!gitHead(repoRoot)) { warn(`${tag} — not a git repo / HEAD unreadable — skipped`); skipped++; continue; }
      if (isDirty(repoRoot)) { warn(`${j.name} — ${c.yellow('dirty')} → SKIPPED (commit/stash first)`); skipped++; continue; }
      const branch = defaultBranch(repoRoot, repo);
      if (!branch) { warn(`${tag} — its default branch (recorded, or origin/HEAD) is not a plain branch name git accepts — skipped (fix default_branch in ${PROJECT_FILES.reposRegistry})`); skipped++; continue; }
      const remote = hasRemote(repoRoot);
      // Printed through `shown` (E81 review 9): git accepts bytes above 0x7f in a branch name, and the
      // remote a registered clone fetches from was chosen by the shared registry, so both can carry text
      // a terminal obeys.
      const b = shown(branch);
      const firstLine = (s) => shown(String(s || '').split('\n')[0]);
      if (remote) {
        const f = git(repoRoot, 'fetch', 'origin', branch, '--prune');
        if (!f.ok) { warn(`${j.name} — fetch failed (${firstLine(f.stderr) || 'auth?'}) — skipped`); skipped++; continue; }
      }
      if (currentBranch(repoRoot) !== branch) {
        const co = git(repoRoot, 'checkout', branch);
        if (!co.ok) { warn(`${j.name} — cannot switch to ${b} (${firstLine(co.stderr) || 'no such branch'}) — skipped`); skipped++; continue; }
      }
      if (remote) {
        const before = gitHead(repoRoot);
        const m = git(repoRoot, 'merge', '--ff-only', `origin/${branch}`);
        if (!m.ok) { warn(`${j.name} — ${c.yellow('diverged')} on ${b} → not fast-forwarded (resolve manually)`); skipped++; continue; }
        ok(`${j.name} ${c.dim('—')} ${before === gitHead(repoRoot) ? `already current on ${b}` : `switched to ${b}, pulled (ff)`}`);
      } else {
        ok(`${j.name} ${c.dim('—')} on ${b} (local-only, no remote)`);
      }
      synced++;
    }
    // A pulled repo's HEAD moves, so its cached code-context pack goes stale — point the human at refresh.
    // Only the checkouts the loop would run git in (E81) — never a refused or linked entry.
    const staleCount = entries.filter((r) => runnable(judgeRepo(root, r)) && staleness(root, r).stale).length;
    info(`synced ${synced}, skipped ${skipped}`);
    if (staleCount) hand(`${staleCount} repo(s) now have a stale code-context pack — \`yad repo refresh\` to repack`);
    return { action, synced, skipped, stale: staleCount };
  }

  if (action === 'clone') {
    const targets = name ? entries.filter((r) => r.name === name) : entries;
    if (name && !targets.length) { fail(`unknown repo: ${shown(name)}`); process.exitCode = 1; return { action, cloned: [], present: [], failed: [] }; }
    log(c.bold('\nclone missing repos'));
    const repos = cloneMissingRepos(root, { repos: targets });
    reportClones(repos);
    if (!repos.cloned.length && !repos.failed.length) info(name ? `${shown(name)} is already on this machine` : 'nothing missing — every registered repo is on this machine');
    // Unlike `join` (whose other steps still matter), cloning is this command's only job: a repo it could
    // not clone fails it, so a script sees it.
    if (repos.failed.length) { hand(`${repos.failed.length} repo(s) not cloned — fix what is named above and re-run \`yad repo clone\``); process.exitCode = 1; }
    if (repos.cloned.length) hand('build the cloned repos\' code-context pack with `yad repo refresh <name>` when you need it');
    return { action, ...repos };
  }

  if (action === 'preview') return previewAction(root, entries, regPath, registry, { name, pattern, clear, push });

  if (action === 'pack') return packAction(root, entries, { name, include, logs, out, push });

  fail(`unknown repo action: ${action} (list | refresh | pack | sync | clone | preview)`);
  process.exitCode = 1;
  return { action };
}

// `yad repo pack <name> [--include <globs>] [--logs] [-o <file>|-]` (#213): pack one registered repo with
// Repomix, judged first exactly as `refresh` judges it, and run as `refresh` runs it (from an empty folder of
// its own, the npm registry named, absolute paths). With no `-o` it writes the repo's usual code-context
// pack, as `refresh` does, but writes nothing else: the registry's `syncedHead` is `refresh`'s to stamp.
// `out` is absolute (the CLI resolves it where the person ran yad), or '-' for stdout.
function packAction(root, entries, { name, include, logs, out, push }) {
  const done = (extra) => ({ action: 'pack', name: name ?? null, out: out ?? null, packed: false, ...extra });
  const usage = 'yad repo pack <name> [--include <globs>] [--logs] [-o <file>|-]';
  const no = (s) => { fail(s); process.exitCode = 1; return done(); };
  if (push) return no('--push does not apply to `yad repo pack` — it writes one pack and commits nothing');
  if (!name) return no(`usage: ${usage}`);
  // A part of the repo in the usual pack would read as the whole repo to every Shape step that loads it.
  if (include !== undefined && out === undefined) return no('--include packs part of the repo — name where it goes with -o <file> (or -o - for stdout); the usual code-context pack holds the whole repo');
  if (include !== undefined && (typeof include !== 'string' || !include || include.startsWith('-'))) return no(`--include takes globs, such as "src/**/*.ts" (got: ${shown(String(include))})`);
  const matches = entries.filter((r) => r.name === name);
  if (!matches.length) return no(`unknown repo: ${shown(name)}`);
  if (matches.length > 1) return no(`${matches.length} entries in ${PROJECT_FILES.reposRegistry} are named ${shown(name)} — fix the registry first`);
  const repo = matches[0];
  // Judged before anything runs in it (E81, E125), as `refresh` judges it.
  const j = judgeRepo(root, repo);
  const why = notPackable(root, repo, j);
  if (why) return no(`${j.name}: ${why} — not packed`);
  if (out === undefined) {
    const packed = !!packRepo(root, { ...repo, contextPack: packOf(repo) }, { report: true });
    if (!packed) process.exitCode = 1;
    else hand(`\`yad repo list\` still says the pack is stale or missing: \`yad repo refresh ${shown(name)}\` is what records it`);
    return done({ out: path.resolve(root, packOf(repo)), packed });
  }
  if (!has('npx')) return no(`${j.name}: npx missing — not packed`);
  const repoRoot = j.target || path.resolve(root, repo.path);
  if (out !== '-') {
    const bad = outProblem(out);
    if (bad) return no(`${j.name}: ${shown(out)} ${bad} — not packed`);
    try { fs.mkdirSync(path.dirname(out), { recursive: true }); } catch (e) { return no(`${j.name}: cannot make the folder for ${shown(out)} (${shown(e.message)}) — not packed`); }
    // The folder made is the one judged: no link put on the way since.
    if (realOf(path.dirname(out)) !== path.dirname(realOf(out) ?? '')) return no(`${j.name}: the folder for ${shown(out)} changed while it was made — not packed`);
  }
  info(`${j.name}: packing with repomix …`);
  // Repomix's own report (files packed, its secret check) on stderr: a file it flags is left out of the pack,
  // and the person needs to hear which one.
  const r = runRepomix(repoRoot, { include: include ?? null, logs: !!logs, out, report: true, place: out !== '-' });
  if (r.noWork) return no(`${j.name}: could not make a temporary folder for repomix (${shown(r.noWork)}) — not packed`);
  if (!r.ok) return no(`${j.name}: repomix failed — ${shown(String(r.stderr || '').split('\n')[0]) || 'unknown error'}`);
  ok(`${j.name}: packed ${out === '-' ? 'to stdout' : shown(out)}`);
  return done({ packed: true });
}

// A path's real place, for a file that may not exist yet: the nearest folder on its way that exists, by its
// real path, then the parts still to be made. Null when a link on the way leads nowhere.
function realOf(p) {
  const there = (q) => { try { fs.lstatSync(q); return true; } catch { return false; } };
  const rest = [];
  let dir = p;
  while (!there(dir)) {
    const up = path.dirname(dir);
    if (up === dir) return null;
    rest.unshift(path.basename(dir));
    dir = up;
  }
  try { return path.join(fs.realpathSync(dir), ...rest); } catch { return null; }
}

// Why `yad repo pack -o <file>` will not write `out` (absolute), or null. The command is one an agent runs
// without asking, so it never writes into yad's own records (a `.sdlc` folder — the Product's ledgers, a repo's
// risk map) or into git's storage (a `.git` folder, whose hooks and config run code), by any path that leads
// there; and never over a link or anything but a plain file.
function outProblem(out) {
  let st = null;
  try { st = fs.lstatSync(out); } catch { /* a new file */ }
  if (st && (st.isSymbolicLink() || !st.isFile())) return 'is a link or not a plain file';
  const real = realOf(out);
  if (!real) return 'is reached through a link that leads nowhere';
  const parts = real.split(/[\\/]/).map((x) => x.toLowerCase());
  if (parts.includes('.git')) return 'is inside a .git folder';
  if (parts.includes('.sdlc')) return 'is inside a .sdlc folder (yad\'s own records; with no -o, the pack goes to the Product\'s code-context)';
  return null;
}

// `yad repo preview <name> [<pattern>] [--clear]` (#359): show, set or clear the repo's preview address
// pattern — `https://pr-{pr}.myapp.dev`, filled per PR/MR so a live design check runs against the
// deployed copy. A team setting in the Product's registry: written here, committed by the person.
function previewAction(root, entries, regPath, registry, { name, pattern, clear, push }) {
  const done = (extra) => ({ action: 'preview', name: name ?? null, ...extra });
  const usage = 'yad repo preview <name> [<pattern>] [--clear]';
  // It writes one shared file and commits nothing: `--push` would read as a promise it does not keep.
  if (push) { fail(`--push does not apply to \`yad repo preview\` — it writes ${PROJECT_FILES.reposRegistry}; commit that in the Product`); process.exitCode = 1; return done({ preview_url: null }); }
  if (!name) { fail(`usage: ${usage}`); process.exitCode = 1; return done({ preview_url: null }); }
  const matches = entries.filter((r) => r.name === name);
  if (!matches.length) { fail(`unknown repo: ${shown(name)}`); process.exitCode = 1; return done({ preview_url: null }); }
  if (matches.length > 1) { fail(`${matches.length} entries in ${PROJECT_FILES.reposRegistry} are named ${shown(name)} — fix the registry first`); process.exitCode = 1; return done({ preview_url: null }); }
  const repo = matches[0];
  const current = typeof repo[PREVIEW_KEY] === 'string' ? repo[PREVIEW_KEY] : null;
  if (clear && pattern !== undefined) { fail(`give a pattern or --clear, not both (${usage})`); process.exitCode = 1; return done({ preview_url: current }); }

  if (!clear && pattern === undefined) {
    if (repo[PREVIEW_KEY] == null) info(`${shown(name)} has no preview address pattern — set one with \`${usage}\``);
    else {
      const problems = patternProblems(repo[PREVIEW_KEY]);
      if (problems.length) warn(`${shown(name)}'s preview_url cannot be used: it ${problems.join('; ')} — set it again with \`${usage}\``);
      else ok(`${shown(name)} — preview ${shown(current)}`);
    }
    return done({ preview_url: current, problems: repo[PREVIEW_KEY] == null ? [] : patternProblems(repo[PREVIEW_KEY]) });
  }

  if (!clear) {
    const problems = patternProblems(pattern);
    if (problems.length) {
      fail(`the preview address pattern ${problems.join('; ')} — nothing written`);
      hand('a pattern is a URL that may hold {pr}, {branch} and {repo}, for example https://pr-{pr}.myapp.dev');
      process.exitCode = 1;
      return done({ preview_url: current, problems });
    }
  }
  // Never through a `.sdlc` the Product commits as a link (as `refresh`): the write would land where it points.
  let sdlcLinked = false;
  try { sdlcLinked = fs.lstatSync(path.dirname(regPath)).isSymbolicLink(); } catch { /* not there */ }
  if (sdlcLinked) {
    fail(`${path.dirname(PROJECT_FILES.reposRegistry)} in the Product is a link — ${PROJECT_FILES.reposRegistry} was not written`);
    process.exitCode = 1;
    return done({ preview_url: current });
  }
  if (clear) {
    if (!(PREVIEW_KEY in repo)) { info(`${shown(name)} has no preview address pattern — nothing to clear`); return done({ preview_url: null, changed: false }); }
    delete repo[PREVIEW_KEY];
  } else {
    if (current === pattern) { info(`${shown(name)} already has that preview address pattern`); return done({ preview_url: current, changed: false }); }
    repo[PREVIEW_KEY] = pattern;
  }
  writeJSON(regPath, registry);
  ok(clear ? `${shown(name)} — preview address pattern cleared` : `${shown(name)} — preview ${shown(pattern)}`);
  hand(`commit ${PROJECT_FILES.reposRegistry} in the Product so the team shares it`);
  return done({ preview_url: clear ? null : pattern, changed: true });
}
