// Builds the deterministic action list (module install + per-repo wiring) for a
// target project. Each action carries a current status and an apply() closure, so
// setup (apply all), update (apply changed), and check (report; fix non-ok) share it.
import fs from 'node:fs';
import path from 'node:path';
import {
  asset, exists, copyDir, copyFile, dirMatches, sameContent, readJSON,
} from './lib.mjs';
import {
  SKILLS, IDE_TARGETS, IDE_OPENCODE_DIR, MODULE_FILES, wiringFor, HUB_WIRING, PROJECT_FILES,
  LEGACY_SKILLS, REMOVED_SKILLS, LEGACY_MARKER, LEGACY_REPO_FILES, LEGACY_HUB_FILES,
} from './manifest.mjs';

// A git pathspec (forward slashes, relative to a repo root) for `dest` under `root`. Actions carry
// these so `yad update --push` can stage an EXPLICIT allowlist of exactly what it wrote per repo —
// never `git add -A` (see cli/update-commit.mjs). A directory pathspec stages every added/changed/
// removed file underneath it, so a dirAction needs only its top-level dest.
const rel = (root, dest) => path.relative(root, dest).split(path.sep).join('/');

// status: 'ok' | 'missing' | 'outdated'. `root` is the repo the write lands in (the hub for module
// installs, a connected repo for its wiring); `paths` is the pathspec(s) touched, for the push stage.
const fileAction = (scope, item, src, dest, { root, exec = false } = {}) => ({
  scope,
  item,
  status: !exists(dest) ? 'missing' : sameContent(src, dest) ? 'ok' : 'outdated',
  root,
  paths: root ? [rel(root, dest)] : [],
  apply: () => copyFile(src, dest, { exec }),
});
const dirAction = (scope, item, src, dest, { root } = {}) => ({
  scope,
  item,
  status: !exists(dest) ? 'missing' : dirMatches(src, dest) ? 'ok' : 'outdated',
  root,
  paths: root ? [rel(root, dest)] : [],
  apply: () => copyDir(src, dest),
});

// Persisted state gets one deliberately narrow compatibility repair. Explicit setup/planner input
// does not: a caller typo is an error, while the known v3.11.1 `.cluade` stamp is safely migrated.
const PERSISTED_IDE_ALIASES = new Map([['.cluade', '.claude']]);
const IDE_TARGET_ERROR_CODE = 'YAD_IDE_TARGET';
const sameTargets = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const displayTarget = (value) => {
  if (value === undefined) return 'undefined';
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
};
const ideTargetError = (message) => Object.assign(new Error(message), { code: IDE_TARGET_ERROR_CODE });
const lstatIfPresent = (full) => {
  try {
    return fs.lstatSync(full);
  } catch (e) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
};
const ideContainers = (ide) => ide === '.opencode'
  ? [ide, IDE_OPENCODE_DIR]
  : [ide, path.join(ide, 'skills')];

function assertSafeIdeContainers(root, ide) {
  for (const relPath of ideContainers(ide)) {
    const stat = lstatIfPresent(path.join(root, relPath));
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      const kind = stat.isSymbolicLink() ? 'a symbolic link' : 'not a directory';
      throw ideTargetError(`unsafe IDE target '${ide}': ${relPath} is ${kind}`);
    }
  }
}

function assertSafeOpenCodeWriteDestinations(root, skills) {
  for (const skill of new Set(skills)) {
    const relPath = path.join(IDE_OPENCODE_DIR, `${skill}.md`);
    const stat = lstatIfPresent(path.join(root, relPath));
    if (!stat) continue;
    let kind = null;
    if (stat.isSymbolicLink()) kind = 'a symbolic link';
    else if (!stat.isFile()) kind = 'not a regular file';
    else if (stat.nlink > 1) kind = 'linked to multiple paths';
    if (kind) throw ideTargetError(`unsafe IDE target '.opencode': ${relPath} is ${kind}`);
  }
}

// Pure target inspection. Valid entries are trimmed and deduplicated in input order; unsupported
// entries are returned to the caller for reporting rather than ever becoming filesystem paths.
export function normalizeIdeTargets(input, { repairAliases = false } = {}) {
  const shapeValid = Array.isArray(input);
  const invalid = shapeValid ? [] : [input];
  const repaired = [];
  const targets = [];
  const seen = new Set();
  for (const raw of shapeValid ? input : []) {
    if (typeof raw !== 'string') { invalid.push(raw); continue; }
    const trimmed = raw.trim();
    const target = repairAliases ? (PERSISTED_IDE_ALIASES.get(trimmed) || trimmed) : trimmed;
    if (!IDE_TARGETS.includes(target)) { invalid.push(raw); continue; }
    if (target !== trimmed) repaired.push({ from: trimmed, to: target });
    if (!seen.has(target)) { seen.add(target); targets.push(target); }
  }
  return { targets, invalid, repaired, shapeValid };
}

// Strict boundary for every explicit action-builder/setup input. Returning only canonical values
// makes path construction below safe by construction.
export function canonicalIdeTargets(input) {
  const state = normalizeIdeTargets(input);
  if (!state.shapeValid) {
    throw ideTargetError(`IDE targets must be a non-empty array (supported: ${IDE_TARGETS.join(', ')})`);
  }
  if (state.invalid.length) {
    throw ideTargetError(`unsupported IDE target(s): ${state.invalid.map(displayTarget).join(', ')} (supported: ${IDE_TARGETS.join(', ')})`);
  }
  if (!state.targets.length) {
    throw ideTargetError(`at least one IDE target is required (supported: ${IDE_TARGETS.join(', ')})`);
  }
  return state.targets;
}

// A canonical relative name is necessary but not sufficient: an existing IDE root (or its install
// container) could be a file or symlink that redirects writes/removals outside the project. Validate
// every target before constructing ANY actions, so a bad later target cannot cause a partial install.
export function safeIdeTargetsFor(root, input) {
  const targets = canonicalIdeTargets(input);
  for (const ide of targets) assertSafeIdeContainers(root, ide);
  return targets;
}

// Fallback discovery must not promote a supported-looking file/symlink into an install target.
// Keep unsafe entries for diagnostics, while returning only real IDE directories with safe install
// containers. Unexpected filesystem errors remain fatal instead of being mistaken for bad input.
export function detectedIdeTargetStateFor(root) {
  const targets = [];
  const unsafe = [];
  for (const ide of IDE_TARGETS) {
    if (!lstatIfPresent(path.join(root, ide))) continue;
    try {
      assertSafeIdeContainers(root, ide);
      targets.push(ide);
    } catch (e) {
      if (e?.code !== IDE_TARGET_ERROR_CODE) throw e;
      unsafe.push({ target: ide, message: e.message });
    }
  }
  return { targets, unsafe };
}

// Which IDE targets this project wants. Persisted values are recovery-oriented: repair the one known
// alias, filter everything else, then fall back to supported IDE dirs already present (or .claude).
// The full state lets reconcile report drift without mutating during a read-only check.
export function ideTargetStateFor(root) {
  const stampPath = path.join(root, PROJECT_FILES.version);
  const hasStamp = exists(stampPath);
  const rec = readJSON(stampPath);
  const recordIsObject = !!rec && typeof rec === 'object' && !Array.isArray(rec);
  const hasField = recordIsObject && Object.hasOwn(rec, 'ideTargets');
  const raw = hasField ? rec.ideTargets : undefined;
  const normalized = normalizeIdeTargets(raw, { repairAliases: true });
  let targets = normalized.targets;
  let usedFallback = false;
  let unsafeDetected = [];
  if (!targets.length) {
    const detected = detectedIdeTargetStateFor(root);
    targets = detected.targets.length ? detected.targets : ['.claude'];
    unsafeDetected = detected.unsafe;
    usedFallback = true;
  }
  return {
    ...normalized,
    targets,
    hasStamp,
    recordIsObject,
    hasField,
    usedFallback,
    unsafeDetected,
    needsRepair: hasStamp && !sameTargets(raw, targets),
  };
}

export function ideTargetsFor(root) {
  return ideTargetStateFor(root).targets;
}

// A brand-new first-party skill is `missing` on every existing install. Relabel that to status `'new'`
// so it rides `yad update` (--scope=changed) — like 'legacy'/'removed', the `changed` filter only
// excludes literal 'missing', so 'new' survives. Scoped to SKILL installs ONLY: repo/hub wiring and
// _bmad files stay 'missing' (excluded from update), so `update` never does one-time setup.
const asNewSkill = (a) => (a.status === 'missing' ? { ...a, status: 'new' } : a);

// Module = skills installed into each IDE target + the _bmad/sdlc registration.
export function moduleActions(root, ideTargets = ideTargetsFor(root)) {
  const targets = safeIdeTargetsFor(root, ideTargets);
  if (targets.includes('.opencode')) assertSafeOpenCodeWriteDestinations(root, SKILLS);
  const actions = [];
  for (const ide of targets) {
    if (ide === '.opencode') {
      for (const s of SKILLS) {
        actions.push(asNewSkill(fileAction(
          ide, s,
          asset('skills', s, 'SKILL.md'),
          path.join(root, IDE_OPENCODE_DIR, `${s}.md`),
          { root },
        )));
      }
    } else {
      for (const s of SKILLS) {
        actions.push(asNewSkill(dirAction(
          ide, s,
          asset('skills', s),
          path.join(root, ide, 'skills', s),
          { root },
        )));
      }
    }
  }
  for (const f of MODULE_FILES) {
    actions.push(fileAction(
      '_bmad', f,
      asset('skills', 'sdlc', f),
      path.join(root, '_bmad', 'sdlc', f),
      { root },
    ));
  }
  return actions;
}

// Migration of a pre-2.0 install (the sdlc-* -> yad-* rename). Status is 'legacy' — unlike
// 'missing' it is applied by `yad update` (--scope=changed) too, because the skill IS
// installed, just under its old name. apply() removes the old copy AND installs the renamed
// one, so a single update completes the rename even when the new copy would otherwise be
// skipped as missing-scope.
export function legacyModuleActions(root, ideTargets = ideTargetsFor(root)) {
  const targets = safeIdeTargetsFor(root, ideTargets);
  if (targets.includes('.opencode')) {
    const writes = Object.entries(LEGACY_SKILLS)
      .filter(([, old]) => exists(path.join(root, IDE_OPENCODE_DIR, `${old}.md`)))
      .map(([skill]) => skill);
    assertSafeOpenCodeWriteDestinations(root, writes);
  }
  const actions = [];
  for (const ide of targets) {
    for (const [skill, old] of Object.entries(LEGACY_SKILLS)) {
      if (ide === '.opencode') {
        const oldDest = path.join(root, IDE_OPENCODE_DIR, `${old}.md`);
        const newDest = path.join(root, IDE_OPENCODE_DIR, `${skill}.md`);
        if (!exists(oldDest)) continue;
        actions.push({
          scope: ide,
          item: `${old}.md → ${skill}.md`,
          status: 'legacy',
          root,
          paths: [rel(root, oldDest), rel(root, newDest)],
          apply: () => {
            fs.rmSync(oldDest, { force: true });
            copyFile(asset('skills', skill, 'SKILL.md'), newDest);
          },
        });
      } else {
        const oldDest = path.join(root, ide, 'skills', old);
        const newDest = path.join(root, ide, 'skills', skill);
        if (!exists(oldDest)) continue;
        actions.push({
          scope: ide,
          item: `${old} → ${skill}`,
          status: 'legacy',
          root,
          paths: [rel(root, oldDest), rel(root, newDest)],
          apply: () => {
            fs.rmSync(oldDest, { recursive: true, force: true });
            copyDir(asset('skills', skill), newDest);
          },
        });
      }
    }
  }
  return actions;
}

// Purge of skills removed in a later release (REMOVED_SKILLS). Status is 'removed' — like 'legacy'
// it is applied by `yad update` (--scope=changed) too, because the skill IS installed and a
// breaking removal must actually delete it. An action is emitted ONLY when a copy is present, so a
// clean tree yields nothing and the purge is idempotent. apply() just deletes the install (no
// replacement — that is what makes this a removal, not a rename).
export function removedModuleActions(root, ideTargets = ideTargetsFor(root)) {
  const targets = safeIdeTargetsFor(root, ideTargets);
  const actions = [];
  for (const ide of targets) {
    for (const skill of REMOVED_SKILLS) {
      if (ide === '.opencode') {
        const dest = path.join(root, IDE_OPENCODE_DIR, `${skill}.md`);
        if (!exists(dest)) continue;
        actions.push({
          scope: ide,
          item: `${skill}.md (removed)`,
          status: 'removed',
          root,
          paths: [rel(root, dest)],
          apply: () => fs.rmSync(dest, { force: true }),
        });
      } else {
        const dest = path.join(root, ide, 'skills', skill);
        if (!exists(dest)) continue;
        actions.push({
          scope: ide,
          item: `${skill} (removed)`,
          status: 'removed',
          root,
          paths: [rel(root, dest)],
          apply: () => fs.rmSync(dest, { recursive: true, force: true }),
        });
      }
    }
  }
  return actions;
}

// True only for a file WE installed pre-2.0: its first line carries the old ownership marker
// (`# sdlc-managed:` / `# sdlc-managed-include:`). A same-named user-authored file is never ours.
function ownedByOldInstall(p) {
  try { return fs.readFileSync(p, 'utf8').startsWith(LEGACY_MARKER); } catch { return false; }
}

// old-dest -> new-dest migrations for wired CI files: remove the marker-owned old file and
// install its renamed replacement from the current wiring. GitLab fragments are referenced by
// path from the root `.gitlab-ci.yml` (`include: - local: ...`, written by the wire step), so
// the migration must also rewrite that include — otherwise the pipeline hard-fails on a
// `local file does not exist` the moment the old fragment is removed.
function legacyFileActions(scope, baseRoot, fileMap, wiring) {
  const actions = [];
  for (const [oldDest, newDest] of Object.entries(fileMap || {})) {
    const oldPath = path.join(baseRoot, oldDest);
    if (!ownedByOldInstall(oldPath)) continue;
    const w = wiring.find((x) => x.dest === newDest);
    if (!w) continue; // never delete a working file without a replacement to install
    // Only claim the root .gitlab-ci.yml when apply() will actually rewrite it (it references the old
    // fragment) — else a --push would sweep the user's unrelated edits to that shared-ownership file
    // into the chore(yad-update) commit. The old (deletion) + new (add) paths are always ours.
    let rewritesRootCi = false;
    try { rewritesRootCi = fs.readFileSync(path.join(baseRoot, '.gitlab-ci.yml'), 'utf8').includes(oldDest); } catch { /* no root ci */ }
    actions.push({
      scope,
      item: `${oldDest} → ${newDest}`,
      status: 'legacy',
      root: baseRoot,
      paths: rewritesRootCi ? [oldDest, newDest, '.gitlab-ci.yml'] : [oldDest, newDest],
      apply: () => {
        fs.rmSync(oldPath, { force: true });
        copyFile(asset(w.src), path.join(baseRoot, newDest), { exec: !!w.exec });
        const rootCi = path.join(baseRoot, '.gitlab-ci.yml');
        try {
          const txt = fs.readFileSync(rootCi, 'utf8');
          if (txt.includes(oldDest)) fs.writeFileSync(rootCi, txt.split(oldDest).join(newDest));
        } catch { /* no root .gitlab-ci.yml (github repo, or fragment-only gitlab) — nothing to rewrite */ }
      },
    });
  }
  return actions;
}

export function legacyRepoActions(root, repo) {
  return legacyFileActions(repo.name, path.resolve(root, repo.path), LEGACY_REPO_FILES[repo.platform], wiringFor(repo.platform));
}

export function legacyHubActions(root) {
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig));
  if (!hub?.platform || !(hub.bridge_enabled === true || hub.bridge === true)) return [];
  const wiring = [...HUB_WIRING.common, ...(HUB_WIRING[hub.platform] || [])];
  return legacyFileActions('hub', root, LEGACY_HUB_FILES[hub.platform], wiring);
}

// Per-repo wiring (gate scripts, CI, PR template).
export function repoActions(root, repo) {
  const repoRoot = path.resolve(root, repo.path);
  return wiringFor(repo.platform).map((w) =>
    fileAction(repo.name, w.dest, asset(w.src), path.join(repoRoot, w.dest), { root: repoRoot, exec: !!w.exec }),
  );
}

// Hub wiring (gate-sync + verified-commits CI on the product hub itself). Only when the hub has a
// platform and the bridge is explicitly enabled — a file-only hub stays file-only, with no error.
export function hubActions(root) {
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig));
  // `bridge_enabled` is the canonical flag (the documented hub-config schema); older setup versions
  // wrote `bridge` — accept an explicit true in either spelling, wire nothing otherwise.
  if (!hub?.platform || !(hub.bridge_enabled === true || hub.bridge === true)) return [];
  return [...HUB_WIRING.common, ...(HUB_WIRING[hub.platform] || [])].map((w) =>
    fileAction('hub', w.dest, asset(w.src), path.join(root, w.dest), { root, exec: !!w.exec }),
  );
}

// Every email the verified-commits gate should accept as a known author: the hub roster's `email`
// (or `emails`) fields plus hub.json's free-form `verified_authors` list. Lower-cased, deduped,
// sorted — deterministic so the generated file is drift-checkable like any wired file.
export function verifiedAuthorEmails(hub) {
  const out = new Set();
  for (const r of hub?.roster || []) {
    for (const e of [r.email, ...(Array.isArray(r.emails) ? r.emails : [])]) {
      if (e) out.add(String(e).toLowerCase());
    }
  }
  for (const e of hub?.verified_authors || []) if (e) out.add(String(e).toLowerCase());
  return [...out].sort();
}

// Generate .sdlc/verified-authors (one email per line) in the hub AND every registered repo, from
// the hub config. No emails configured → no actions (the gate then warns instead of blocking —
// never enforce an empty allowlist).
export function authorsActions(root, repos = []) {
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig));
  const emails = verifiedAuthorEmails(hub);
  if (!emails.length) return [];
  const desired = [
    '# Generated by `yad check --fix` from .sdlc/hub.json (roster emails + verified_authors).',
    '# The verified-commits gate accepts only these author emails. Edit hub.json, not this file.',
    ...emails,
  ].join('\n') + '\n';
  const targets = [
    { scope: 'hub', root, dest: path.join(root, '.sdlc', 'verified-authors') },
    ...repos.map((r) => {
      const repoRoot = path.resolve(root, r.path);
      return { scope: r.name, root: repoRoot, dest: path.join(repoRoot, '.sdlc', 'verified-authors') };
    }),
  ];
  return targets.map(({ scope, root: targetRoot, dest }) => ({
    scope,
    item: '.sdlc/verified-authors',
    status: !exists(dest) ? 'missing' : fs.readFileSync(dest, 'utf8') === desired ? 'ok' : 'outdated',
    root: targetRoot,
    paths: [rel(targetRoot, dest)],
    apply: () => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, desired);
    },
  }));
}
