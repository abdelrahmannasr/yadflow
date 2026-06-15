// `yad roster` — manage the reviewer roster (.sdlc/hub.json) and per-repo roles at any time.
// The roster maps a platform login -> SDLC name + a per-scope roles map; it is the only thing that lets
// the review gate attribute approvals and route per-repo domain-owner reviewers. This is the standalone
// counterpart of the `yad setup` roster step and the `yad-connect-repos action: roster` skill action.
// Repo-driven: `add`/`edit` walks the connected repos from repos.json so roles are assigned against what
// is actually connected, not against repo names the user has to remember. Granting/revoking a
// `domain-owner` keeps repos.json `domain_owners` in sync so the gate never drifts from the roster.
import path from 'node:path';
import { c, log, ok, info, warn, hand, fail, ask, askYesNo, readJSON, writeJSON } from './lib.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import { rolesForScope } from './platform.mjs';
import { parseRolesSpec, upsertRosterEntry, addRepoRoles, removeRepoRole, setRepoDomainOwners, reconcileRepoRoles } from './setup.mjs';

const ROLES = ['owner', 'reviewer', 'domain-owner'];

const loadHub = (root) => readJSON(path.join(root, PROJECT_FILES.hubConfig), null);
const loadRepos = (root) => readJSON(path.join(root, PROJECT_FILES.reposRegistry), { repos: [] }).repos || [];
const ownersOf = (repo) => (Array.isArray(repo.domain_owners) ? repo.domain_owners : (repo.domain_owner ? [repo.domain_owner] : []));

// `list` — every member with their per-scope roles, plus a drift check between hub.json roles and
// repos.json domain_owners (the two should agree; the sync on grant/revoke keeps them aligned).
function rosterList(root) {
  const hub = loadHub(root);
  if (!hub || !Array.isArray(hub.roster) || !hub.roster.length) {
    warn('no roster yet (.sdlc/hub.json) — add one with `yad roster add <login>` or `yad setup`');
    return { members: 0 };
  }
  const repos = loadRepos(root);
  log(c.bold('\nreviewer roster'));
  for (const e of hub.roster) {
    const flag = e.unverified ? c.yellow(' (unverified)') : '';
    log(`  ${c.bold(e.name || e.login)} ${c.dim(`@${e.login}`)}${e.email ? c.dim(` <${e.email}>`) : ''}${flag}`);
    const hubRoles = rolesForScope(e, 'hub');
    log(`    hub: ${hubRoles.length ? hubRoles.join(', ') : c.dim('—')}`);
    for (const r of repos) {
      const rr = rolesForScope(e, r.name);
      if (rr.length) log(`    ${r.name}: ${rr.join(', ')}`);
    }
  }
  const drift = [];
  for (const r of repos) {
    const owners = ownersOf(r);
    for (const nm of owners) {
      const e = hub.roster.find((x) => x.name === nm);
      if (!e || !rolesForScope(e, r.name).includes('domain-owner')) {
        drift.push(`${nm} owns ${r.name} in repos.json but has no domain-owner role in hub.json`);
      }
    }
    for (const e of hub.roster) {
      if (rolesForScope(e, r.name).includes('domain-owner') && !owners.includes(e.name)) {
        drift.push(`${e.name} has domain-owner for ${r.name} in hub.json but is missing from repos.json domain_owners`);
      }
    }
  }
  if (drift.length) { log(''); for (const d of drift) warn(d); }
  return { members: hub.roster.length, repos: repos.length, drift: drift.length };
}

// The repo-driven walk: for each connected repo show the member's current role and offer to set it.
async function repoWalk(root, entry) {
  const repos = loadRepos(root);
  if (!repos.length) { info('no connected repos to assign roles for (.sdlc/repos.json) — connect one with `yad setup`'); return; }
  for (const r of repos) {
    const cur = rolesForScope(entry, r.name);
    if (!(await askYesNo(`  set ${entry.name}'s role on ${r.name}? (current: ${cur.length ? cur.join(', ') : 'none'})`, false))) continue;
    const input = await ask('    roles (domain-owner/reviewer/owner, space-separated; blank = clear)', cur.join(' '));
    const want = input.split(/\s+/).map((x) => x.trim()).filter(Boolean);
    const invalid = want.filter((x) => !ROLES.includes(x));
    if (invalid.length) warn(`ignoring unknown role(s): ${invalid.join(', ')} (allowed: ${ROLES.join(', ')})`);
    reconcileRepoRoles(root, entry.name, r.name, cur, want.filter((x) => ROLES.includes(x)));
  }
}

// Mirror any domain-owner scopes from a non-interactive `--roles` upsert into repos.json.
function syncDomainOwners(root, entry) {
  for (const [scope, list] of Object.entries(entry.roles || {})) {
    if (scope !== 'hub' && Array.isArray(list) && list.includes('domain-owner')) setRepoDomainOwners(root, scope, entry.name, { add: true });
  }
}

// `add`/`edit <login>` — upsert by login (from flags or interactive prompts), then either apply a
// `--roles` spec directly (scriptable) or run the repo-driven walk (interactive default).
async function rosterAdd(root, login, { name, email, roles } = {}) {
  if (!login) { fail('usage: yad roster add <login> [--name N] [--email E] [--roles "hub=owner,reviewer backend=domain-owner"]'); process.exitCode = 1; return {}; }
  const hub = loadHub(root);
  const platform = hub ? hub.platform : null;
  const existing = hub && Array.isArray(hub.roster) ? hub.roster.find((e) => e.login === login) : null;
  const scripted = !!roles;
  let nm = name;
  let em = email;
  let rolesMap;
  if (scripted) {
    rolesMap = parseRolesSpec(roles);
  } else {
    nm = nm || await ask('  yad name', (existing && existing.name) || login);
    em = em || await ask('  commit email (blank to skip)', (existing && existing.email) || '');
    const def = rolesForScope(existing, 'hub').join(' ') || 'reviewer';
    const hubRoles = (await ask('  hub roles (owner/reviewer, space-separated)', def)).split(/\s+/).filter(Boolean);
    rolesMap = hubRoles.length ? { hub: hubRoles } : {};
  }
  const { entry, created } = upsertRosterEntry(root, { login, name: nm, email: em || undefined, roles: rolesMap, platform });
  if (!entry) return {};
  ok(`${created ? 'added' : 'updated'} ${entry.name} (@${login})`);
  if (scripted) syncDomainOwners(root, entry);
  else await repoWalk(root, entry);
  return { entry: entry.name, created };
}

// `grant <name> <repo> <role...>` — scriptable per-repo grant (member must already be in the roster).
function rosterGrant(root, [name, repo, ...roles]) {
  if (!name || !repo || !roles.length) { fail('usage: yad roster grant <name> <repo> <role...>'); process.exitCode = 1; return {}; }
  const invalid = roles.filter((r) => !ROLES.includes(r));
  if (invalid.length) { fail(`unknown role(s): ${invalid.join(', ')} (allowed: ${ROLES.join(', ')})`); process.exitCode = 1; return {}; }
  const hub = loadHub(root);
  if (!hub || !Array.isArray(hub.roster) || !hub.roster.some((e) => e.name === name)) {
    fail(`'${name}' is not in the roster — add them first with \`yad roster add <login>\``); process.exitCode = 1; return {};
  }
  if (!loadRepos(root).some((r) => r.name === repo)) warn(`repo '${repo}' is not registered — the role is recorded and applies once it is connected`);
  addRepoRoles(root, repo, Object.fromEntries(roles.map((r) => [r, [name]])));
  if (roles.includes('domain-owner')) setRepoDomainOwners(root, repo, name, { add: true });
  ok(`granted ${name} ${roles.join(', ')} on ${repo}`);
  return { name, repo, roles };
}

// `revoke <name> <repo> <role...>` — scriptable per-repo revoke.
function rosterRevoke(root, [name, repo, ...roles]) {
  if (!name || !repo || !roles.length) { fail('usage: yad roster revoke <name> <repo> <role...>'); process.exitCode = 1; return {}; }
  removeRepoRole(root, name, repo, roles);
  if (roles.includes('domain-owner')) setRepoDomainOwners(root, repo, name, { add: false });
  ok(`revoked ${name} ${roles.join(', ')} on ${repo}`);
  return { name, repo, roles };
}

// `remove <login>` — delete a member; warn (do not cascade) if still a domain owner in repos.json.
function rosterRemove(root, login) {
  if (!login) { fail('usage: yad roster remove <login>'); process.exitCode = 1; return {}; }
  const hubPath = path.join(root, PROJECT_FILES.hubConfig);
  const hub = readJSON(hubPath, null);
  if (!hub || !Array.isArray(hub.roster)) { warn('no roster to remove from (.sdlc/hub.json)'); return { removed: 0 }; }
  const idx = hub.roster.findIndex((e) => e.login === login);
  if (idx < 0) { warn(`no roster member with login '${login}'`); return { removed: 0 }; }
  const [removed] = hub.roster.splice(idx, 1);
  writeJSON(hubPath, hub);
  ok(`removed ${removed.name} (@${login})`);
  const refs = loadRepos(root).filter((r) => ownersOf(r).includes(removed.name)).map((r) => r.name);
  if (refs.length) hand(`'${removed.name}' is still a domain owner in repos.json for: ${refs.join(', ')} — revoke with \`yad roster revoke ${removed.name} <repo> domain-owner\``);
  return { removed: 1 };
}

export async function runRoster(root, { action = 'list', args = [], name, email, roles } = {}) {
  switch (action) {
    case 'list': return rosterList(root);
    case 'add':
    case 'edit': return rosterAdd(root, args[0], { name, email, roles });
    case 'grant': return rosterGrant(root, args);
    case 'revoke': return rosterRevoke(root, args);
    case 'remove':
    case 'rm': return rosterRemove(root, args[0]);
    default:
      fail(`unknown roster action: ${action} (list | add | edit | grant | revoke | remove)`);
      process.exitCode = 1;
      return {};
  }
}
