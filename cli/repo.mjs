// `yad repo list|refresh|sync|clone` — connected-repo maintenance as explicit HUMAN decisions.
// list/refresh: staleness of the cached code-context pack (HEAD != syncedHead). Skill steps no longer
// silently repack a stale repo; they flag it and point here. (`yad check --fix` refreshes too — also
// human-invoked.) sync: switch every connected repo to its registry default_branch and fast-forward
// it to origin — a working-tree-only op (it never writes the registry; a dirty tree is skipped).
// clone (E81): clone every registered repo that is missing on this machine — `yad join`'s clone step,
// for the repo a teammate registered after you joined. It never runs git in a repo already there.
import path from 'node:path';
import { c, log, ok, info, warn, hand, fail, writeJSON, run } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { judgeRepo, cloneMissingRepos, reportClones, readRegistry, codeContextPathOk, CODE_CONTEXT_DIR, runnable, shown } from './workspace.mjs';
import { gitHead, packRepo } from './setup.mjs';
import { publishCodeContext, packOf, codeMapOf } from './repo-publish.mjs';

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
  const r = git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  return r.ok && r.stdout ? r.stdout.replace(/^origin\//, '') : 'main';
}

export async function runRepo(root, { action = 'list', name, today, push = false, allowBranch = false } = {}) {
  const { regPath, registry, problem } = load(root);
  if (problem) { fail(`${problem} — fix it in the Product and re-run`); process.exitCode = 1; return { action, repos: [] }; }
  if (!registry.repos.length) { warn('no repos registered (.sdlc/repos.json) — run `yad setup`'); return { action, repos: [] }; }
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
        state: unknown ? 'unreadable' : neverPacked ? 'no-pack' : stale ? 'stale' : 'fresh' });
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
    if (name && !targets.length) { fail(`unknown repo: ${shown(name)}`); process.exitCode = 1; return { action, refreshed: 0, repos: [], published: null }; }
    let refreshed = 0;
    let published = null;
    const rows = [];
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
      }
      rows.push({ name: repo.name ?? null, refreshed: packed, head: head || null });
    }
    writeJSON(regPath, registry);
    refreshed ? ok(`refreshed ${refreshed} repo(s)`) : info('nothing refreshed');
    if (push) {
      // Publish whatever tracked code-context now differs (the AI-regenerated code-maps + the stamped
      // registry) straight to the Product's default branch as one audit-trail commit. The pack itself is
      // gitignored (packRepo scaffolds the ignore; publish self-heals a pre-ignore tracked pack); the
      // code-map is regenerated by the AI (yad-connect-repos) — run that first if a repo's map is stale,
      // then `yad repo refresh --push` lands it.
      published = (await publishCodeContext(root, { push: true, allowBranch, name })) ?? null;
    } else {
      hand('regenerate the code-map in your AI agent (yad-connect-repos) — the pack is cached, the map is the AI step');
      hand('then publish it to the Product default branch with `yad repo refresh --push`');
    }
    // `published`: what `--push` did (`{ message, committed, pushed }`), or null when it committed nothing
    // — nothing to publish, or a refusal, which the answer's `error` then names.
    return { action, refreshed, repos: rows, published };
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
      if (!branch) { warn(`${tag} — the recorded default_branch is not a branch name git accepts — skipped (fix it in ${PROJECT_FILES.reposRegistry})`); skipped++; continue; }
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

  fail(`unknown repo action: ${action} (list | refresh | sync | clone)`);
  process.exitCode = 1;
  return { action };
}
