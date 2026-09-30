// Builds the deterministic action list (module install + per-repo wiring) for a
// target project. Each action carries a current status and an apply() closure, so
// setup (apply all), update (apply changed), and check (report; fix non-ok) share it.
import fs from 'node:fs';
import path from 'node:path';
import { err } from './errors.mjs';
import {
  asset, exists, copyDir, copyFile, dirMatches, sameContent, readJSON, readJSONStrict, writeJSON, contentSha, warn, info, isPlainObject, run, samePath,
} from './lib.mjs';
import {
  VERSION, SKILLS, IDE_TARGETS, IDE_OPENCODE_DIR, IDE_OPENCODE_TARGET, IDE_RECOVERY_TARGET, MODULE_CONFIG, wiringFor, PRODUCT_WIRING, PROJECT_FILES, isVerifiedLedger,
  HOOK_WIRING, HOOK_ADAPTERS, CLAUDE_HOOK_ADAPTER, CAPTURE_WIRING, CAPTURE_ADAPTERS,
  legacySkillPairs, REMOVED_SKILLS, LEGACY_REPO_FILES, LEGACY_PRODUCT_FILES, LEGACY_HOOK_SCRIPTS, MANAGED_LEDGER, BACKUP_SUFFIX,
  productConfigPath, PRODUCT_LINK, PRODUCT_LINK_DEFAULT_PATH,
} from './manifest.mjs';

// A git pathspec (forward slashes, relative to a repo root) for `dest` under `root`. Actions carry
// these so `yad update --push` can stage an EXPLICIT allowlist of exactly what it wrote per repo —
// never `git add -A` (see cli/update-commit.mjs). A directory pathspec stages every added/changed/
// removed file underneath it, so a dirAction needs only its top-level dest.
const rel = (root, dest) => path.relative(root, dest).split(path.sep).join('/');

// status: 'ok' | 'missing' | 'outdated'. `root` is the repo the write lands in (the Product for module
// installs, a connected repo for its wiring); `paths` is the pathspec(s) touched, for the push stage.
// An `exec` file whose execute bit is gone is OUTDATED, not ok — its bytes are right and it cannot
// run. `chmod` lives inside `apply()`, which an `ok` action never reaches, so a content-only status
// meant `yad check --fix` had nothing to do and the mode was never restored. For a gate script that
// is a failed pipeline; for `hooks/ledger-guard*.sh` it is worse, because the harness entry pointing
// at it carries fail-open semantics, so every ledger edit is quietly PERMITTED while `yad check` and
// `yad doctor` both report the guard healthy. Reachable without anyone doing anything odd: a zip or
// tarball download, `cp` without `-p`, a restrictive umask, `core.fileMode=false`.
//
// WINDOWS HAS NO EXECUTE BIT ON DISK (E113): Node reports every file there without one, so the test
// below would call every gate script outdated for ever, and `--fix` could never clear it. The gates run
// on the team's CI as `bash checks/<gate>.sh`, which needs no bit, so on Windows a file present counts.
const isExecutable = (dest) => {
  try { return process.platform === 'win32' || !!(fs.statSync(dest).mode & 0o111); } catch { return false; }
};
const fileAction = (scope, item, src, dest, { root, exec = false } = {}) => ({
  scope,
  item,
  status: !exists(dest) ? 'missing'
    : sameContent(src, dest) && (!exec || isExecutable(dest)) ? 'ok'
      : 'outdated',
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

// ---- managed-file provenance (#164) --------------------------------------------------------
// Read one repo root's ledger of "files yad wrote, and the sha it wrote". Strict, like every other
// ledger read: only an ABSENT ledger means "no record" ({}). One that exists but does not parse — or
// parses into something that is not a `files` map — must throw. Defaulting either to {} would
// silently downgrade every locally-modified file to an unrecorded one and re-open, one backup short,
// the silent clobber this record exists to prevent.
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export function readManagedLedger(root) {
  const file = path.join(root, MANAGED_LEDGER);
  const rec = readJSONStrict(file, null);
  if (rec === null && !exists(file)) return {};
  if (!isMap(rec) || !isMap(rec.files)) {
    // Parses, but is not a record — YAD-STATE-002 (wrong shape), not -001 (does not parse).
    throw err('YAD-STATE-002', `unreadable provenance record in ${file}: expected an object with a "files" map`,
      'restore it from git — or delete it to start over, which costs the record (the next update then backs up every managed file it replaces)');
  }
  return rec.files;
}

// Where the pre-overwrite copy of `dest` goes.
export const backupPathFor = (dest) => `${dest}${BACKUP_SUFFIX}`;

// A wired file (gate script, CI fragment, PR/MR template) — a fileAction plus provenance:
//   'ok'        bytes are the shipped template
//   'missing'   not installed
//   'outdated'  differs, and the recorded sha proves WE wrote what is there (a stale copy) — or the
//               file predates the ledger (no record at all), in which case nothing is proven and
//               apply() saves a .yad-orig copy before replacing it
//   'modified'  differs, and the recorded sha says someone edited our copy — never overwritten by a
//               plain update; `--overwrite-local` replaces it (after a .yad-orig backup)
// apply() backs up whenever provenance is not proven, so no unproven content is ever discarded.
const wiredFileAction = (scope, item, src, dest, { root, exec = false, ledger = {} } = {}) => {
  const base = fileAction(scope, item, src, dest, { root, exec });
  const managed = { src, dest, root };
  if (base.status !== 'outdated') return { ...base, managed };
  const recorded = ledger[rel(root, dest)];
  // Compares CONTENT. A file that is outdated only because its execute bit was lost still has the
  // sha we recorded, so it reads as ours and is re-applied with no backup — which is right: nothing
  // of the team's is being discarded, the mode is simply restored.
  const ours = !!recorded && recorded === contentSha(dest);
  const backup = ours ? null : backupPathFor(dest);
  return {
    ...base,
    // No record at all is a pre-ledger install, not evidence of an edit: keep the routine upgrade
    // working (still 'outdated'), but never discard content we cannot prove we wrote — hence backup.
    status: ours || !recorded ? 'outdated' : 'modified',
    managed,
    backup,
    apply: () => {
      if (backup) fs.copyFileSync(dest, backup);
      copyFile(src, dest, { exec });
    },
  };
};

// Persist the provenance of every managed file whose on-disk bytes ARE the shipped template — the
// ones just applied AND the ones already correct. Seeding the already-correct ones is what migrates
// an install made before this ledger existed: from then on, an edit to any of them is detectable.
// A file we skipped as `modified` is deliberately NOT recorded — it is the team's copy, not ours.
// Keys are sorted so two repos' updates produce mergeable, byte-stable ledgers.
// Returns the roots written, so the caller can stage them alongside what they describe.
export function recordManagedWrites(actions = []) {
  const byRoot = new Map();
  for (const a of actions) {
    const m = a?.managed;
    if (!m || !m.root) continue;
    if (!sameContent(m.src, m.dest)) continue;
    if (!byRoot.has(m.root)) byRoot.set(m.root, {});
    byRoot.get(m.root)[rel(m.root, m.dest)] = contentSha(m.dest);
  }
  const roots = [];
  for (const [root, written] of byRoot) {
    const files = { ...readManagedLedger(root), ...written };
    const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
    writeJSON(path.join(root, MANAGED_LEDGER), { version: VERSION, files: sorted });
    roots.push(root);
  }
  return roots;
}

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
    // Every code here means "there is nothing I can read at this path", which is what the callers ask.
    //   ENOENT   nothing there.
    //   ENOTDIR  an ancestor is a file, so the child cannot exist — the caller that cares about the
    //            broken ancestor reports it properly.
    //   EACCES / EPERM  a directory we are not allowed to look inside. Newly reachable: `.cursor/` is
    //            an install target now, so a repo holding one at mode 000 would otherwise abort
    //            `yad check` and `yad setup` outright, on a directory yad has no business reading.
    //   ELOOP / ENAMETOOLONG  a symlink cycle or an unusable path; not a target either way.
    // Not installing into something we cannot stat is the safe answer in all of them.
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG'].includes(e?.code)) return null;
    throw e;
  }
};
// The directory yad installs INTO for a target — `.opencode`'s flat commands folder, everyone else's
// `skills/`. One definition, because `ideContainers` (safety) and `hasInstallContainer` (detection)
// asking the same question two different ways is how they drift: the second spelling of this already
// had `'.opencode'` as a literal where the first had the constant.
const installContainer = (ide) => (ide === IDE_OPENCODE_TARGET ? IDE_OPENCODE_DIR : path.join(ide, 'skills'));
const ideContainers = (ide) => [ide, installContainer(ide)];

// The ROOT itself, before any target under it, on BOTH paths into the planner — detection and an
// explicit target list. Widening `lstatIfPresent` to swallow ENOTDIR made a non-directory root
// silently yield "nothing here", and the planner then built a full install plan against a path that
// is a regular file. It used to abort by accident, on the raw ENOTDIR; aborting on purpose, with a
// sentence naming the problem, is what it should have been doing.
function assertRootIsDirectory(root) {
  const stat = lstatIfPresent(root);
  if (stat && !stat.isDirectory()) {
    throw ideTargetError(`not a directory: ${root} — a project root must be a directory`);
  }
}

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
  assertRootIsDirectory(root);
  for (const ide of targets) assertSafeIdeContainers(root, ide);
  return targets;
}

// Is a wired hook script present? Shared by the planner and `yad doctor`, so the two cannot disagree about
// whether the guard is installed. Since E113 every hook is a Node script the entry runs as `node <file>`,
// so an execute bit is no longer part of "ready" — and Windows could never show one.
export const hookScriptReady = (root, relPath) => !!lstatIfPresent(path.join(root, relPath))?.isFile();

// Which of these targets are safe to write through, without throwing on the ones that are not.
// `safeIdeTargetsFor` throws on the first bad target, which is right for an installer and wrong for a
// report: `yad doctor` has to NAME the unusable one rather than die on it.
export function safeIdeTargetStateFor(root, input) {
  const targets = [];
  const unsafe = [];
  assertRootIsDirectory(root);
  for (const ide of canonicalIdeTargets(input)) {
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

// Fallback discovery must not promote a supported-looking file/symlink into an install target.
// Keep unsafe entries for diagnostics, while returning only real IDE directories with safe install
// containers. Unexpected filesystem errors remain fatal instead of being mistaken for bad input.
//
// THE DIRECTORY IS NOT ENOUGH — the INSTALL CONTAINER has to be there (E11). `.cursor/` is an ordinary
// sight in a repo that uses Cursor for rules alone, and `.claude/` in one that only ever set
// permissions. Detecting on the bare directory meant that adding `.cursor` to the supported list
// silently enrolled every such project: no `ideTargets` in the stamp, so this fallback runs, `.cursor`
// is "detected", and the next `yad check --fix` writes 38 skill folders into `.cursor/skills/`, adds
// `.cursor/hooks.json`, and stamps the target permanently — for a team that never asked. Requiring
// `<ide>/skills/` (or `.opencode/commands/`) means detection finds only a directory yad already
// installs into, which is the question this function was always trying to answer.
//
// A `.claude/` holding only `settings.json` is therefore no longer DETECTED — and still ends up as
// `.claude`, because that is `IDE_RECOVERY_TARGET`, the fallback when detection finds nothing. The
// outcome is unchanged only while those two happen to be the same directory; if the recovery target
// ever moves, this stops being a coincidence and starts being a behaviour change. The test named
// "a project with a broken stamp recovers to .claude alone" is what would catch it.
const hasInstallContainer = (root, ide) => !!lstatIfPresent(path.join(root, installContainer(ide)));

// The OTHER evidence that a directory is an install of ours: its harness settings file names a hook
// command we wrote. Without this, requiring a skills container was an upgrade REGRESSION rather than
// a tightening — a project that keeps its skills in `.agents/` and has an armed `.claude/settings.json`
// (which a previous `yad check --fix` put there) lost `.claude` from detection, and `needsRepair`
// then wrote the loss into the stamp. The live entry would still fire on every edit while nothing
// updated it, normalised its legacy spelling, or reported it. Reading the FILE, not just its
// existence, is what keeps this from re-admitting a `.claude/` that only ever held permissions.
// Either of our hooks counts: the guard's, or — on a local-ledger Product, where it is the only one — the
// capture entry (E43). Missing the capture entry here would drop `.claude` from detection and let the next
// `--fix` unwire it as a removed target, the regression described above.
const hasOurHookEntry = (root, ide) => [HOOK_ADAPTERS[ide], CAPTURE_ADAPTERS[ide]].some((adapter) => {
  if (!adapter) return false;
  const full = path.join(root, adapter.settings);
  if (!lstatIfPresent(full)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    const entries = parsed?.hooks?.[adapter.event];
    if (!Array.isArray(entries)) return false;
    return entries.some((entry) => entryIsOurs(adapter, entry));
  } catch { return false; }
});

export function detectedIdeTargetStateFor(root) {
  assertRootIsDirectory(root);
  const targets = [];
  const unsafe = [];
  for (const ide of IDE_TARGETS) {
    if (!lstatIfPresent(path.join(root, ide))) continue;
    try {
      // Safety FIRST, and the container second. An `.agents` that is a file or a symlink is a finding
      // this function must report, not something to quietly skip because no `skills/` could be found
      // underneath it — the diagnostic is the whole reason `unsafe` exists.
      assertSafeIdeContainers(root, ide);
      if (!hasInstallContainer(root, ide) && !hasOurHookEntry(root, ide)) continue;
      targets.push(ide);
    } catch (e) {
      if (e?.code !== IDE_TARGET_ERROR_CODE) throw e;
      unsafe.push({ target: ide, message: e.message });
    }
  }
  return { targets, unsafe };
}

// Which IDE targets this project wants. Persisted values are recovery-oriented: repair the one known
// alias, filter everything else, then fall back to supported IDE dirs already present (or, with none,
// `IDE_RECOVERY_TARGET`). That last fallback is deliberately the MINIMUM and not `DEFAULT_IDE_TARGETS`
// — a recovery restores a project to a working state, it does not enrol it in a newer default and
// write skill folders nobody asked for. A fresh `yad setup` is where the default applies.
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
    targets = detected.targets.length ? detected.targets : [IDE_RECOVERY_TARGET];
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
// excludes literal 'missing', so 'new' survives. Used for the module — the skills and the config they
// read — and for the hook wiring (see `hookActions`): repo/Product wiring stays 'missing' (excluded from
// update), so `update` never does one-time setup. The config rides too because E3 moved it. Every
// existing install is missing `.sdlc/config.yaml`, and an update that brought the skills pointing at it
// without the file would leave them reading nothing.
const asNew = (a) => (a.status === 'missing' ? { ...a, status: 'new' } : a);

// Module = skills installed into each IDE target + the module config in `.sdlc/`.
export function moduleActions(root, ideTargets = ideTargetsFor(root)) {
  const targets = safeIdeTargetsFor(root, ideTargets);
  if (targets.includes('.opencode')) assertSafeOpenCodeWriteDestinations(root, SKILLS);
  const actions = [];
  for (const ide of targets) {
    if (ide === '.opencode') {
      for (const s of SKILLS) {
        actions.push(asNew(fileAction(
          ide, s,
          asset('skills', s, 'SKILL.md'),
          path.join(root, IDE_OPENCODE_DIR, `${s}.md`),
          { root },
        )));
      }
    } else {
      for (const s of SKILLS) {
        actions.push(asNew(dirAction(
          ide, s,
          asset('skills', s),
          path.join(root, ide, 'skills', s),
          { root },
        )));
      }
    }
  }
  // A wired file, like the Product wiring, because the team may edit it — a language, a code repos root.
  // An edited copy reads `modified` and is kept; only `--overwrite-local` replaces it, after a backup. A
  // plain fileAction would copy the shipped file over that edit on every update, with no backup.
  actions.push(asNew(wiredFileAction(
    '.sdlc', 'config.yaml',
    asset('skills', 'sdlc', 'config.yaml'),
    path.join(root, MODULE_CONFIG),
    { root, ledger: readManagedLedger(root) },
  )));
  return actions;
}

// Migration of an install carrying an old skill name (the 2.0 sdlc-* -> yad-* rename, and E123's
// yad-hub-bridge -> yad-product-bridge; see LEGACY_SKILLS). Status is 'legacy' — unlike
// 'missing' it is applied by `yad update` (--scope=changed) too, because the skill IS
// installed, just under its old name. apply() removes the old copy AND installs the renamed
// one, so a single update completes the rename even when the new copy would otherwise be
// skipped as missing-scope.
export function legacyModuleActions(root, ideTargets = ideTargetsFor(root)) {
  const targets = safeIdeTargetsFor(root, ideTargets);
  if (targets.includes('.opencode')) {
    const writes = legacySkillPairs()
      .filter(([, old]) => exists(path.join(root, IDE_OPENCODE_DIR, `${old}.md`)))
      .map(([skill]) => skill);
    assertSafeOpenCodeWriteDestinations(root, writes);
  }
  const actions = [];
  for (const ide of targets) {
    for (const [skill, old] of legacySkillPairs()) {
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
          rename: { from: rel(root, oldDest), to: rel(root, newDest) },
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
          rename: { from: rel(root, oldDest), to: rel(root, newDest) },
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

// True only for a file WE installed: its first line starts with the ownership marker its rename entry
// names (`# sdlc-managed` for the pre-2.0 files, `# yad-managed: yad-checks` for E123's). A same-named
// user-authored file is never ours.
function ownedByOldInstall(p, marker) {
  try { return fs.readFileSync(p, 'utf8').startsWith(marker); } catch { return false; }
}

// old-dest -> new-dest migrations for wired CI files: remove the marker-owned old file and
// install its renamed replacement from the current wiring. GitLab fragments are referenced by
// path from the root `.gitlab-ci.yml` (`include: - local: ...`, written by the wire step), so
// the migration must also rewrite that include — otherwise the pipeline hard-fails on a
// `local file does not exist` the moment the old fragment is removed.
//
// The marker says who installed the file, not that nobody changed it since, so the provenance record
// decides what happens to its content — the three states every managed file has (`wiredFileAction`):
//   recorded, and the bytes are what yad wrote   → removed ('legacy')
//   no record (installed before the record)      → removed, after a <file>.yad-orig copy ('legacy')
//   recorded, and the bytes differ (edited)      → 'modified': left, with the rename not done; only
//                                                  `--overwrite-local` removes it, after the same copy.
//                                                  Meanwhile the new name is not installed beside it
//                                                  (`withoutKeptRenames`), or both would run
// The copy is inert where it lands: GitHub runs only `.yml`/`.yaml` files, and nothing includes it.
// When the old file goes, its line leaves the record, so the record lists only files that are there.
function legacyFileActions(scope, baseRoot, fileMap, wiring) {
  const actions = [];
  let ledger = null;
  for (const [oldDest, { to: newDest, marker }] of Object.entries(fileMap || {})) {
    const oldPath = path.join(baseRoot, oldDest);
    if (!ownedByOldInstall(oldPath, marker)) continue;
    const w = wiring.find((x) => x.dest === newDest);
    if (!w) continue; // never delete a working file without a replacement to install
    ledger ??= readManagedLedger(baseRoot);
    const recorded = ledger[oldDest];
    const ours = !!recorded && recorded === contentSha(oldPath);
    const backup = ours ? null : backupPathFor(oldPath);
    // Only claim the root .gitlab-ci.yml when apply() will actually rewrite it (it references the old
    // fragment) — else a --push would sweep the user's unrelated edits to that shared-ownership file
    // into the chore(yad-update) commit. The old (deletion) + new (add) paths are always ours.
    let rewritesRootCi = false;
    try { rewritesRootCi = fs.readFileSync(path.join(baseRoot, '.gitlab-ci.yml'), 'utf8').includes(oldDest); } catch { /* no root ci */ }
    actions.push({
      scope,
      item: `${oldDest} → ${newDest}`,
      status: ours || !recorded ? 'legacy' : 'modified',
      root: baseRoot,
      paths: [oldDest, newDest, ...(rewritesRootCi ? ['.gitlab-ci.yml'] : []), ...(recorded ? [MANAGED_LEDGER] : [])],
      backup,
      rename: { from: oldDest, to: newDest },
      // The new file it installs, so `recordManagedWrites` records it when it is the template. Without this a
      // rename done by `--overwrite-local` (the new name's own action is left out then, `withoutKeptRenames`)
      // left the new file unrecorded, and the next update replaced the edits a person copied into it (review 2).
      managed: { src: asset(w.src), dest: path.join(baseRoot, newDest), root: baseRoot },
      apply: () => {
        if (backup) fs.copyFileSync(oldPath, backup);
        fs.rmSync(oldPath, { force: true });
        // Only into an empty path. A file already at the new name is the new name's own wired-file action's
        // to judge — with its provenance and its backup — and may hold the team's edits (review 1).
        if (!exists(path.join(baseRoot, newDest))) copyFile(asset(w.src), path.join(baseRoot, newDest), { exec: !!w.exec });
        const rootCi = path.join(baseRoot, '.gitlab-ci.yml');
        try {
          const txt = fs.readFileSync(rootCi, 'utf8');
          if (txt.includes(oldDest)) fs.writeFileSync(rootCi, txt.split(oldDest).join(newDest));
        } catch { /* no root .gitlab-ci.yml (github repo, or fragment-only gitlab) — nothing to rewrite */ }
        const current = readManagedLedger(baseRoot);
        if (Object.hasOwn(current, oldDest)) {
          delete current[oldDest];
          writeJSON(path.join(baseRoot, MANAGED_LEDGER), { version: VERSION, files: current });
        }
      },
    });
  }
  return actions;
}

// E123: the team's own files that name something the hub -> Product rename moved. yad owns none of them
// and never edits them — except the one GitLab include line `legacyFileActions` rewrites — so each hit is
// named, with its file and line, by `yad doctor` and `yad check`/`update`, and left for a person.
// Old -> new, the exact literals the old templates carried (`yad-hub-checks.yml`, and the one job in
// `yad-verified-commits.yml`). `yad-hub-checks` covers the file name (`.github/workflows/…`, `.gitlab/ci/…`,
// the include path, the badge URL that names the file) and the GitHub workflow `name:` (a `workflow_run:`
// trigger, the older badge URL). Nothing broader: a bare `yad-hub-` prefix would claim a team's own
// `yad-hub-deploy` job.
export const RENAMED_CI_NAMES = Object.freeze([
  ['yad-hub-checks', 'yad-product-checks'],
  ['yad-hub-commit-message', 'yad-product-commit-message'],
  ['yad-hub-pr-title', 'yad-product-pr-title'],
  ['yad-hub-pr-template', 'yad-product-pr-template'],
  ['yad-hub-ledger-guard', 'yad-product-ledger-guard'],
  ['yad-hub-verified-commits', 'yad-product-verified-commits'],
  ['.yad_hub_mr_only', '.yad_product_mr_only'],
]);
// The profile value a team's own CI file may pass (E124 review 1). The gates still accept `--profile hub` until
// v5, but a gate edited after 4.0 without the line that would turn `hub` into `product` lets `--profile hub`
// skip the Product's rules (the cell `productProfileGap` does not judge) — so the CI line is named instead.
// Its own pattern: `=` or any run of spaces, the value bare or quoted, and nothing after it that could be part
// of a longer word (`--profile hubble`, `--profile hub.x`). Only the literal is seen: a value passed through a
// variable (`--profile "$P"`) is not. Only in CI files — a README that quotes the command is prose.
const OLD_PROFILE_RE = /(?<![\w-])--profile(?:=|[ \t]+)(["']?)hub\1(?![\w.-])/g;
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Bounded on both sides by anything that cannot be part of a name, so `yad-hub-checks-extra` is not a hit.
const RENAMED_CI_RE = new RegExp(`(?<![\\w.-])(${RENAMED_CI_NAMES.map(([o]) => escapeRe(o)).join('|')})(?![\\w-])`, 'g');
// Where a person's own reference to our CI lives. The CI folders are read only for files yad did not install:
// every file yad writes there starts `# yad-managed` (`# yad-managed:`, `# yad-managed-include:`,
// `# yad-managed —`), so the FIRST line decides, never a mention further down.
const CODEOWNERS_DIRS = ['', '.github', '.gitlab', 'docs'];
function renamedNameFiles(root) {
  const listYml = (dir) => {
    try {
      return fs.readdirSync(path.join(root, dir), { withFileTypes: true })
        .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name)).map((e) => `${dir}/${e.name}`).sort();
    } catch { return []; }
  };
  const notOurs = (rel) => {
    try { return !fs.readFileSync(path.join(root, rel), 'utf8').split('\n', 1)[0].startsWith('# yad-managed'); } catch { return false; }
  };
  return [
    '.gitlab-ci.yml',
    ...[...listYml('.gitlab/ci'), ...listYml('.github/workflows')].filter(notOurs),
    'README.md',
    ...CODEOWNERS_DIRS.map((d) => (d ? `${d}/CODEOWNERS` : 'CODEOWNERS')),
  ];
}
// Every hit: { file, line, old, new, rewrittenBy }. `rewrittenBy` marks a match inside the old fragment's path
// on a line of the root .gitlab-ci.yml, which yad rewrites itself when it replaces that fragment: 'update'
// for a fragment `yad update` replaces, 'overwrite-local' for an edited one it keeps until that flag; null
// for every other hit, which is the team's to change.
export function renamedNameHits(root) {
  const fragments = new Map();
  try {
    for (const a of legacyProductActions(root)) {
      if (a.paths.includes('.gitlab-ci.yml') || a.status === 'modified') fragments.set(a.rename.from, a.status === 'modified' ? 'overwrite-local' : 'update');
    }
  } catch { /* an unreadable provenance record: nothing is promised, so every hit reads as the team's to change */ }
  const hits = [];
  for (const file of renamedNameFiles(root)) {
    let text;
    try {
      if (!fs.lstatSync(path.join(root, file)).isFile()) continue;
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch { continue; }
    const ci = /\.ya?ml$/.test(file);
    text.split(/\r?\n/).forEach((line, i) => {
      if (ci) {
        for (const m of line.matchAll(OLD_PROFILE_RE)) {
          hits.push({ file, line: i + 1, old: m[0], new: m[0].replace(/hub(["']?)$/, 'product$1'), rewrittenBy: null, profile: true });
        }
      }
      for (const m of line.matchAll(RENAMED_CI_RE)) {
        const next = RENAMED_CI_NAMES.find(([o]) => o === m[1])[1];
        // Per match, not per line: only the fragment path itself is rewritten, not a job named beside it.
        let rewrittenBy = null;
        if (file === '.gitlab-ci.yml') {
          for (const [f, by] of fragments) {
            for (let at = line.indexOf(f); at !== -1 && !rewrittenBy; at = line.indexOf(f, at + 1)) {
              if (m.index >= at && m.index < at + f.length) rewrittenBy = by;
            }
          }
        }
        hits.push({ file, line: i + 1, old: m[1], new: next, rewrittenBy });
      }
    });
  }
  return hits;
}

// The Product's pattern gates, whose workflow passes `--profile product` since E123. A copy the team edited
// is kept by `yad update` — and one from before 4.0 accepts only `code|hub`, so it fails every Product PR
// with "unknown --profile 'product'" (review 1). 'rejects' when the gate's own `case "$PROFILE" in …)` list lacks
// `product`; 'unmapped' when it has it, but the gate branches on `= hub` with no line turning `product`
// into `hub` — then `product` passes the list and silently skips every Product rule (review 2); null otherwise,
// and for a copy with no such list, which is not judged. The shipped copies branch on `= product` since
// E124 (and turn `hub` into `product`), so they read null here; the `= hub` shape is an older copy's.
//
// Every case, as gate shape × the value a workflow passes (E124):
//   gate                                           passes product     passes hub
//   branches on `= hub`, maps product -> hub       ok                 ok
//   branches on `= hub`, no mapping                'unmapped'         ok
//   list without `product` (before 4.0)            'rejects'          ok
//   branches on `= product`, maps hub -> product   ok (shipped)       ok (shipped)
//   branches on `= product`, no mapping            ok                 skips the Product rules — see below
// The last cell is not judged here, from the gate: it is closed from the workflow side instead. A team's own CI
// line that passes `--profile hub` literally is a `renamed-ref:` hit (OLD_PROFILE_RE), and yad's own old
// workflow is a `renamed:` one. A value passed through a variable is not seen.
export const PRODUCT_PROFILE_GATES = Object.freeze(['checks/commit-message.sh', 'checks/pr-title.sh', 'checks/pr-template.sh']);
export function productProfileGap(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const list = text.match(/^\s*case\s+"\$PROFILE"\s+in\s+([^)]*)\)/m);
  if (!list) return null;
  if (!list[1].split('|').map((x) => x.trim()).includes('product')) return 'rejects';
  // Any spelling of the mapping on one line — `[ "$PROFILE" = product ] && PROFILE=hub`, `[[ $PROFILE == product ]]
  // && …`, a `product) PROFILE=hub ;;` arm — and any spelling of the branch: quoted or not, `=` or `==`.
  // A comment is prose, not code: the shipped copies explain the mapping in one.
  const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const mapped = /product[^\n]*\bPROFILE=["']?hub\b/.test(code);
  // The line that maps the old name (the shipped shape since E124: turn `hub` into `product`) compares with `= hub` too, but it is
  // the mapping, not a branch — so it is not what the branch test below looks for.
  const branches = code.split('\n').filter((l) => !/\bPROFILE=["']?product\b/.test(l)).join('\n');
  return /\$\{?PROFILE\}?"?\s*==?\s*["']?hub\b/.test(branches) && !mapped ? 'unmapped' : null;
}
// What each gap does to a Product PR, and the one fix for both — shared by `yad doctor` and `yad update`.
export const productProfileEffect = (gap, gate, passing) => (gap === 'rejects'
  ? `${gate} does not accept \`--profile product\`, which ${passing} — every Product PR fails that check`
  : `${gate} accepts \`--profile product\` but never turns it into \`hub\`, which ${passing} — so it skips the Product's rules and passes what it should stop`);
export const PRODUCT_PROFILE_FIX = 'add `product` to its `case "$PROFILE" in` list and `[ "$PROFILE" = product ] && PROFILE=hub` after it — or replace it with the shipped copy, which branches on `product` itself: `yad update --overwrite-local`';

// The Product's checks workflows, under the new name and the old (E123): an edited old one is kept, and runs.
export const PRODUCT_CHECK_WORKFLOWS = Object.freeze([
  '.github/workflows/yad-product-checks.yml', '.gitlab/ci/yad-product-checks.yml',
  '.github/workflows/yad-hub-checks.yml', '.gitlab/ci/yad-hub-checks.yml',
]);
// Those of them on disk that pass `--profile product` to the gates.
// yad's own workflows, and the team's own CI files (E124 review 2): a team that follows `renamed-ref:` and changes
// its `--profile hub` to `product` must then hear from `profile:` if an edited gate still rejects it.
export const workflowsPassingProduct = (root) => [...new Set([...PRODUCT_CHECK_WORKFLOWS,
  ...renamedNameFiles(root).filter((rel) => /\.ya?ml$/.test(rel))])].filter((rel) => {
  try { return /--profile(?:=|[ \t]+)(["']?)product\1(?![\w.-])/.test(fs.readFileSync(path.join(root, rel), 'utf8')); } catch { return false; }
});
// The Product gates that would mishandle `--profile product` (E124 reviews 2–4): refuse it ('rejects'), or take it
// and skip the Product's rules ('unmapped'). Each gate's state decides what to do first, and is read from the
// provenance record through `productActions` — never guessed from the file:
//   state          what it is                                            before a run      on update   --overwrite-local
//   'outdated'     yad's own copy, older than this release               run yad update    replaced    replaced
//   'unrecorded'   no record (a pre-3.16 install): update backs it up    run yad update    replaced    replaced
//   'kept'         edited since yad wrote it: update keeps it            fix it            fix it      replaced
//   'unreadable'   the settings do not read (or are not an object), or   restore the file, then run yad update
//                  the provenance record does not: yad cannot tell (with
//                  an unreadable record, update itself refuses until then)
//   'drift'        a file under two names says different things (E122):  run yad migrate, then yad update
//                  every command but doctor/migrate refuses until one copy
//                  is chosen — so nothing else can be the first step
//   'unmanaged'    yad has no action for it (Product not verified)       fix it by hand    same        same
// The last two are read from the file on disk.
// On a run that fixes, a gate that run replaces is left out: after it, the gate is the shipped copy.
// `drift`: the pairs `productDrift` found, as the caller lists them (plan.mjs lists no epics) — the same pairs
// that make every command refuse (`productDriftError`).
export function productGateBlockers(root, { fix = false, overwriteLocal = false, drift = [] } = {}) {
  let actions = [];
  let unreadable = null; // the file that does not read, for 'unreadable' (review 5)
  const settings = productConfigPath(root);
  try {
    // Not an object is as unreadable as not parsing: `yad doctor` fails both (review 6).
    if (exists(settings) && !isPlainObject(readJSONStrict(settings, null))) throw new Error('not an object');
  } catch { unreadable = path.relative(root, settings).split(path.sep).join('/'); }
  const drifted = !unreadable && drift.length ? drift : null;
  if (!unreadable && !drifted) {
    try { actions = productActions(root); } catch { unreadable = MANAGED_LEDGER; }
  }
  const byGate = new Map(actions.filter((a) => a.managed)
    .map((a) => [path.relative(root, a.managed.dest).split(path.sep).join('/'), a]));
  const out = [];
  for (const gate of PRODUCT_PROFILE_GATES) {
    const gap = productProfileGap(path.join(root, gate));
    if (!gap) continue;
    const a = byGate.get(gate);
    let state;
    if (unreadable) state = 'unreadable';
    else if (drifted) state = 'drift';
    else if (!a) state = 'unmanaged';
    else if (a.status === 'modified') state = fix && overwriteLocal ? null : 'kept';
    else state = fix ? null : (a.backup ? 'unrecorded' : 'outdated');
    if (state) out.push({ gate, gap, state, ...(unreadable ? { file: unreadable } : {}), ...(drifted ? { pairs: drifted } : {}) });
  }
  return out;
}
const gapWords = (b) => `${b.gate} (it ${b.gap === 'rejects' ? 'refuses `--profile product`, so every Product PR would fail it' : 'takes `--profile product` but then skips the Product\'s rules'})`;
// The drifted pairs, said once: which files say different things (E122).
const driftWords = (pairs) => `${pairs.map((p) => `${p.canonical} and ${p.legacy}`).join('; ')} say different things`;
const saved = (b) => `${b.gate}${BACKUP_SUFFIX}`;
// What to do about ONE gate — `yad doctor`'s `profile:<gate>` hint.
export function gateProfileFix(b) {
  if (b.state === 'outdated') return 'run `yad update`: it replaces this copy, which yad wrote, with the shipped one';
  if (b.state === 'unrecorded') return `run \`yad update\`: it replaces it with the shipped one and saves yours as ${saved(b)}`;
  if (b.state === 'kept') return `it was changed by hand, so \`yad update\` keeps it: ${PRODUCT_PROFILE_FIX} (your copy is saved as ${saved(b)})`;
  if (b.state === 'drift') return `${driftWords(b.pairs)}, so \`yad update\` refuses until one copy is chosen: run \`yad migrate\` to see the difference and keep one, then \`yad update\` and \`yad doctor\` again`;
  if (b.state === 'unreadable') return `restore ${b.file} from git — it does not read, so yad cannot tell whether this copy is its own${b.file === MANAGED_LEDGER ? ' (and `yad update` refuses until then)' : ''} — then run \`yad update\` and \`yad doctor\` again`;
  return `fix it by hand — yad does not manage the checks on this Product, so no \`yad update\` replaces it: ${PRODUCT_PROFILE_FIX.split(' — ')[0]}`;
}
// What to do before a team changes its `--profile hub` to `product`, or '' when nothing stands in the way —
// one sentence for `yad doctor` and `yad check`/`update` alike, naming EVERY gate in the way, each group with
// its own step (review 4: naming only the edited one let a stale one fail every PR).
export function oldProfileAdvice(blockers) {
  if (!blockers.length) return '';
  const parts = [];
  const split = blockers.filter((b) => b.state === 'drift');
  if (split.length) {
    parts.push(`run \`yad migrate\` to choose one copy — ${driftWords(split[0].pairs)}, so every yad command but \`yad doctor\` and \`yad migrate\` refuses until then — and \`yad doctor\` again: it says what ${split.length > 1 ? `${split.map((b) => b.gate).join(', ')} need` : `${split[0].gate} needs`}`);
  }
  const lost = blockers.filter((b) => b.state === 'unreadable');
  if (lost.length) {
    parts.push(`restore ${lost[0].file} from git (it does not read, so yad cannot tell ${lost.length > 1 ? `which of ${lost.map(gapWords).join('; and ')} are` : `whether ${gapWords(lost[0])} is`} its own), then run \`yad update\` and \`yad doctor\` again`);
  }
  const replace = blockers.filter((b) => b.state === 'outdated' || b.state === 'unrecorded');
  if (replace.length) {
    const backed = replace.filter((b) => b.state === 'unrecorded');
    parts.push(`run \`yad update\`, which replaces ${replace.map(gapWords).join('; and ')}${backed.length ? ` (saving your ${backed.length > 1 ? 'copies' : 'copy'} as ${backed.map(saved).join(', ')})` : ''}`);
  }
  const kept = blockers.filter((b) => b.state === 'kept');
  if (kept.length) {
    parts.push(`fix ${kept.map(gapWords).join('; and ')} — ${kept.length > 1 ? 'they were' : 'it was'} edited, so \`yad update\` keeps ${kept.length > 1 ? 'them; for each one' : 'it'}: ${PRODUCT_PROFILE_FIX}`);
  }
  const own = blockers.filter((b) => b.state === 'unmanaged');
  if (own.length) {
    parts.push(`fix ${own.map(gapWords).join('; and ')} by hand — yad does not manage the checks on this Product`);
  }
  // `; then`, never `; and` — the gate lists inside a part already use `; and` (review 5).
  return `but first ${parts.join('; then ')}`;
}

// The new name of a renamed CI file is not installed while an edited old one is kept (`modified`): both
// would run on GitHub — every gate twice, the stock one undoing whatever the team's edit loosened — and on
// GitLab the new one would sit there included by nothing. `--overwrite-local` installs it with the rename.
export function withoutKeptRenames(actions) {
  const kept = new Set(actions.filter((a) => a.rename && a.status === 'modified').map((a) => path.join(a.root, a.rename.to)));
  if (!kept.size) return actions;
  return actions.filter((a) => a.rename || !(a.managed && !exists(a.managed.dest) && kept.has(a.managed.dest)));
}

export function legacyRepoActions(root, repo) {
  return legacyFileActions(repo.name, path.resolve(root, repo.path), LEGACY_REPO_FILES[repo.platform], wiringFor(repo.platform));
}

export function legacyProductActions(root) {
  const productConfig = readJSON(productConfigPath(root));
  if (!isVerifiedLedger(productConfig)) return [];
  const wiring = [...PRODUCT_WIRING.common, ...(PRODUCT_WIRING[productConfig.platform] || [])];
  return legacyFileActions('product', root, LEGACY_PRODUCT_FILES[productConfig.platform], wiring);
}

// Per-repo wiring (gate scripts, CI, PR template).
export function repoActions(root, repo) {
  const repoRoot = path.resolve(root, repo.path);
  const ledger = readManagedLedger(repoRoot);
  const actions = wiringFor(repo.platform).map((w) =>
    wiredFileAction(repo.name, w.dest, asset(w.src), path.join(repoRoot, w.dest), { root: repoRoot, exec: !!w.exec, ledger }),
  );
  // A repo that already carries ANY of its wiring is a wired repo, and a template a later release
  // ADDED to the wiring is `new` there, not `missing` — the same relabel a new first-party skill
  // gets, for the same reason: `yad update` (--scope=changed) excludes only the literal 'missing'.
  // Without it an upgrade rewrites the files that CALL the new template (`outdated`) while skipping
  // the template itself, and every PR fails the gate with "file not found" until someone runs
  // `yad check --fix`. The ledger tells the two absences apart: a file yad RECORDED writing and
  // someone since removed stays `missing` (the team's deletion is respected, as before), while one
  // yad never wrote is the new template. A repo with none of its wiring stays `missing` throughout:
  // update never does one-time setup.
  //
  // "Wired" means yad wired it: the ledger has records, or (an install from before the ledger) a
  // gate script under checks/ is present. A team-owned file that merely occupies a wired path — a
  // hand-written PR template reads as `outdated` — is not evidence, or update would perform the
  // whole one-time setup on a repo that never asked for it.
  const wired = Object.keys(ledger).length > 0
    || actions.some((a) => a.status !== 'missing' && a.item.startsWith('checks/'));
  const link = productLinkAction(root, repo, repoRoot);
  if (link) actions.push(link);
  if (!wired) return actions;
  // The record is not a template: an absent one on a wired repo is always `new` (nothing to respect).
  const neverWritten = (a) => !a.managed || !ledger[rel(a.managed.root, a.managed.dest)];
  return actions.map((a) => (a.status === 'missing' && neverWritten(a) ? { ...a, status: 'new' } : a));
}

// The git repo a folder belongs to (its top level), or '' when it is not in one.
const gitTop = (dir) => {
  const r = run('git', ['rev-parse', '--show-toplevel'], { cwd: dir });
  return r.ok ? path.resolve(r.stdout.trim()) : '';
};

// The Product's git_url as a code repo may carry it: no user name or password (review 1). `setup` takes
// it from `git remote get-url origin`, which can hold a token; the record is committed to every code
// repo, some of which may be seen by more people than the Product.
export function publicGitUrl(u) {
  if (typeof u !== 'string' || !u) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u; // scp-style ssh (git@host:org/repo) holds no password
  try {
    const x = new URL(u);
    // An ssh user (`git@`) is the login name, not a secret, and the checkout reads the url by it.
    if (!/^(git\+)?ssh:$/i.test(x.protocol)) x.username = '';
    x.password = '';
    // A token can ride in the query or the fragment too (`?access_token=…`); a clone url needs neither.
    x.search = '';
    x.hash = '';
    return x.toString();
  } catch { return null; }
}

// E120. `.sdlc/product-link.json` in a connected code repo: where its Product lives. Generated, not
// copied from a template, so it is not in the managed ledger. `git_url` and `default_branch` come from
// the Product's own settings every time; `path` (where CI checks the Product out) is the team's to
// change and is kept. Any other key in the file is kept too. A code repo that IS the Product's git repo
// (a monorepo) gets none: the gates already read a Product kept in the repo from the base.
function productLinkAction(root, repo, repoRoot) {
  if (!exists(repoRoot)) return null;
  const top = gitTop(repoRoot);
  if (!top || top === gitTop(root)) return null;
  const dest = path.join(repoRoot, PRODUCT_LINK);
  const productConfig = readJSON(productConfigPath(root), {}) || {};
  let current;
  try { current = readJSONStrict(dest, null); } catch { current = undefined; }
  const base = {
    scope: repo.name,
    item: PRODUCT_LINK,
    root: repoRoot,
    paths: [PRODUCT_LINK],
  };
  const want = {
    git_url: publicGitUrl(productConfig.git_url),
    path: isPlainObject(current) && typeof current.path === 'string' && current.path ? current.path : PRODUCT_LINK_DEFAULT_PATH,
    // Unknown stays null (review 1): a guessed `main` failed every clone of a Product whose trunk is
    // `master`; with none, checks/product-checkout.sh clones the remote's own default branch.
    default_branch: typeof productConfig.default_branch === 'string' && productConfig.default_branch ? productConfig.default_branch : null,
  };
  // A record that does not parse, or is not an object, is someone's: reported and never overwritten by
  // a plain update; `--overwrite-local` saves it beside itself first, like any managed file.
  if (current === undefined || (current !== null && !isPlainObject(current))) {
    const backup = backupPathFor(dest);
    return {
      ...base, status: 'modified', backup,
      apply: () => { fs.copyFileSync(dest, backup); writeJSON(dest, want); },
    };
  }
  const same = current && ['git_url', 'path', 'default_branch'].every((k) => current[k] === want[k]);
  // Right on disk is `ok` — like every wired file `yad setup` leaves for the team to commit, so a fresh
  // setup reports no drift. But the gates read the record from the default branch, so `--push` must
  // commit one that is not committed AS IT IS on disk (reviews 1–2: a record setup or a plain --fix had
  // written, or rewritten, was never committed by a later --push): `pendingCommit` makes reconcile
  // stage it with the rest. `git diff HEAD` also sees a staged-only change. One the repo's .gitignore
  // covers cannot be committed by --push at all — `yad doctor` says what to do instead.
  const git = (...a) => run('git', a, { cwd: repoRoot }).ok;
  const committed = () => git('ls-files', '--error-unmatch', '--', PRODUCT_LINK) && git('diff', '--quiet', 'HEAD', '--', PRODUCT_LINK);
  const ignored = () => git('check-ignore', '-q', '--', PRODUCT_LINK);
  const status = current === null ? 'missing' : !same ? 'outdated' : 'ok';
  return {
    ...base,
    status,
    pendingCommit: status === 'ok' && !committed() && !ignored(),
    apply: () => writeJSON(dest, { ...(current || {}), ...want }),
  };
}

// Product wiring (gate-sync + verified-commits CI on the Product itself). Only when the Product has a
// platform and the verified ledger is explicitly enabled — a local Product stays local, with no error.
export function productActions(root) {
  const productConfig = readJSON(productConfigPath(root));
  // `ledger` is the canonical switch and `bridge_enabled` its older spelling (the documented Product settings schema); older setup versions
  // wrote `bridge` — `isVerifiedLedger` accepts an explicit true in either spelling, and is the one
  // predicate the CLI, the wiring, and the ledger hook all read (#186). Wire nothing otherwise.
  if (!isVerifiedLedger(productConfig)) return [];
  const ledger = readManagedLedger(root);
  return [...PRODUCT_WIRING.common, ...(PRODUCT_WIRING[productConfig.platform] || [])].map((w) =>
    wiredFileAction('product', w.dest, asset(w.src), path.join(root, w.dest), { root, exec: !!w.exec, ledger }),
  );
}

// ---- harness hooks (#171, two harnesses since E11) ---------------------------------------------
//
// Every function here takes an ADAPTER — the per-harness record in `HOOK_ADAPTERS` that says which
// file, which event key, which tool-name matcher, which command, and which of the two entry shapes.
// It defaults to Claude Code's, so the callers and tests written when there was only one harness read
// exactly as they did. What changed is that "the hook" is no longer a single spelling compiled in.
// The desired hook entry, in the shape THIS harness reads it. `nested: true` is Claude Code's, where
// one matcher entry carries a list of commands; `false` is Cursor's flat entry. `failClosed: false`
// is written once, on a new entry, to state the stance the script already takes — only an explicit
// deny blocks. It is never enforced afterwards: a team that turns it on has made a choice.
// An `observe` hook (E43's capture) only watches, so it states no `failClosed`; a null matcher is an
// event that takes none.
export const hookEntry = (adapter = CLAUDE_HOOK_ADAPTER) => (adapter.nested
  ? { ...(adapter.matcher ? { matcher: adapter.matcher } : {}), hooks: [{ type: 'command', command: adapter.command }] }
  : { ...(adapter.matcher ? { matcher: adapter.matcher } : {}), command: adapter.command, ...(adapter.observe ? {} : { failClosed: false }) });

// Ours is a hook command EXACTLY equal to one we have written — the current spelling or a
// documented past one, FOR THIS HARNESS. Never "the entry at index N", never "the entry with our
// matcher", and deliberately never a substring test: `includes('hooks/ledger-guard.sh')` would also
// claim a team's own wrapper at `.claude/hooks/ledger-guard.sh` and silently rewrite it to ours, on
// the `outdated` path that takes no backup. Matching exactly means the worst case is a second entry
// (the guard runs twice — harmless) instead of someone else's hook disappearing.
//
// Per-harness and not one shared set: the two commands name different variables, and a `.cursor`
// entry spelled with `$CLAUDE_PROJECT_DIR` is someone else's, not an old one of ours to normalise.
const isOurCommand = (adapter, command) => typeof command === 'string'
  && (command === adapter.command || adapter.legacyCommands.includes(command));
const entryIsOurs = (adapter, entry) => (adapter.nested
  ? Array.isArray(entry?.hooks) && entry.hooks.some((h) => isOurCommand(adapter, h?.command))
  : isOurCommand(adapter, entry?.command));

// Additive merge of our pre-edit entry into a parsed settings object. Returns `{ settings, changed }`;
// `settings` is a new object, so a caller can compare without mutating.
// A matcher the team NARROWED is left alone (only the command is normalised) — the same respect for
// a local edit that `modified` gives a managed file. Widening it back would silently undo their choice.
export function mergeHookSettings(input, adapter = CLAUDE_HOOK_ADAPTER) {
  // A SHAPE WE DO NOT RECOGNISE IS REFUSED, not overwritten. `hooks` that is not an object, or an
  // event whose value is not a list, means the team's file says something this merge cannot read —
  // and rebuilding it from our own entry would delete whatever was there. That runs on the `outdated`
  // path, which takes no backup, in a file yadflow has never written before and does not own.
  //
  // `unreadable` is returned rather than thrown so the caller can report it exactly as it reports a
  // file that will not parse: warn, status `modified`, write nothing, and let a human look at it.
  // (An input that is not an object at all is a different case — there is nothing to lose, so it is
  // synthesized as before.)
  if (isPlainObject(input)) {
    if (Object.hasOwn(input, 'hooks') && !isPlainObject(input.hooks)) {
      return { settings: input, changed: false, unreadable: 'hooks is not an object' };
    }
    const existing = isPlainObject(input.hooks) ? input.hooks[adapter.event] : undefined;
    if (existing !== undefined && !Array.isArray(existing)) {
      return { settings: input, changed: false, unreadable: `hooks.${adapter.event} is not a list` };
    }
  }
  const settings = { ...(isPlainObject(input) ? input : {}) };
  let changed = false;
  // Keys the FILE requires beside `hooks` (Cursor's `version`), added only when absent — see the
  // `preamble` note in the manifest. A file we create gets them; a file the team wrote keeps theirs.
  for (const [key, value] of Object.entries(adapter.preamble || {})) {
    if (Object.hasOwn(settings, key)) continue;
    settings[key] = value;
    changed = true;
  }
  const hooks = { ...(isPlainObject(settings.hooks) ? settings.hooks : {}) };
  const entries = Array.isArray(hooks[adapter.event]) ? hooks[adapter.event].map((e) => ({ ...e })) : [];
  let found = false;
  for (const entry of entries) {
    if (adapter.nested) {
      if (!Array.isArray(entry.hooks)) continue;
      entry.hooks = entry.hooks.map((h) => {
        if (!isOurCommand(adapter, h?.command)) return h;
        found = true;
        if (h.command === adapter.command && h.type === 'command') return h;
        changed = true;
        return { ...h, type: 'command', command: adapter.command };
      });
    } else {
      if (!isOurCommand(adapter, entry.command)) continue;
      found = true;
      if (entry.command === adapter.command) continue;
      entry.command = adapter.command;
      changed = true;
    }
  }
  if (!found) { entries.push(hookEntry(adapter)); changed = true; }
  hooks[adapter.event] = entries;
  settings.hooks = hooks;
  return { settings, changed };
}

// The inverse of the merge: take OUR entry out and leave everything else exactly as it was. Returns
// `{ settings, changed }`, and `changed: false` when there was nothing of ours to remove.
//
// An entry is removed whole only when it carried nothing but our command. Claude Code's shape lets a
// single matcher entry hold several commands, so a team that added theirs beside ours keeps their
// entry, minus our line. The same refusal as the merge applies to a shape we cannot read: it is not
// ours to rewrite.
export function unmergeHookSettings(input, adapter = CLAUDE_HOOK_ADAPTER) {
  if (!isPlainObject(input) || !isPlainObject(input.hooks)) return { settings: input, changed: false };
  const entries = input.hooks[adapter.event];
  if (!Array.isArray(entries)) return { settings: input, changed: false };
  let changed = false;
  const kept = [];
  for (const entry of entries) {
    if (!entryIsOurs(adapter, entry)) { kept.push(entry); continue; }
    changed = true;
    if (!adapter.nested) continue;                       // flat entry: ours entirely, drop it
    const others = entry.hooks.filter((h) => !isOurCommand(adapter, h?.command));
    if (others.length) kept.push({ ...entry, hooks: others });
  }
  if (!changed) return { settings: input, changed: false };
  const hooks = { ...input.hooks };
  // Leave no empty array behind where the team had no such key before us.
  if (kept.length) hooks[adapter.event] = kept; else delete hooks[adapter.event];
  const settings = { ...input };
  if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;
  return { settings, changed: true };
}

// A hand-wired command that names OUR guard but would not work — returned as a sentence, or null.
//
// The discipline everywhere else is that a command we did not write is the team's, and we leave it
// alone. This is the one exception, and it is narrow on purpose: it fires only on a command that
// references our own script names, only for a harness whose hook answers with a JSON verdict, and it
// only REPORTS. The reason it earns the exception is that the mistake is catastrophic and silent —
// wiring `ledger-guard.sh` straight into Cursor, or adding `--format cursor` in a spelling the
// command string never splits, makes the guard answer with empty stdout, which Cursor reads as
// "deny", which blocks EVERY file write in the project with nothing saying why.
//
// `check-gates.md` documents hand-wiring for other harnesses, so this is a path people are invited
// down; it should have a handrail.
export function miswiredGuardCommand(entry, adapter) {
  if (!adapter?.requiresJsonVerdict) return null;
  const command = adapter.nested
    ? (Array.isArray(entry?.hooks) ? entry.hooks.map((h) => h?.command).find((cmdStr) => typeof cmdStr === 'string' && /ledger-guard/.test(cmdStr)) : undefined)
    : entry?.command;
  if (typeof command !== 'string' || !/ledger-guard/.test(command)) return null;
  if (command === adapter.command) return null;
  if (adapter.legacyCommands.includes(command)) return null;
  // Names the shared script rather than the adapter's wrapper.
  if (!/ledger-guard-cursor/.test(command) && !/--format[= ]cursor/.test(command)) {
    return `${command} answers with an exit code, not the JSON verdict this harness needs — it will block every file write`;
  }
  // Names the right protocol but through a spelling we do not own, so we cannot vouch for it.
  return `${command} is not the command yad wires (${adapter.command}) — check it answers with a JSON verdict, or it will block every file write`;
}

// Does the installed entry still select at least one file-editing tool? The merge deliberately
// leaves a narrowed `matcher` alone — it is the team's — but a matcher narrowed to nothing (blanked,
// or pointed at `Bash`) means the guard is installed and never fires, which must not read as healthy.
// The matcher is a regex the harness tests tool names against, so test it as one; an invalid regex
// cannot fire either. The tool names tested are the ADAPTER's: Cursor's `Delete` is a file write and
// Claude's `MultiEdit` is a tool Cursor does not have, so one shared list would be wrong for both.
export function hookMatcherFires(settings, adapter = CLAUDE_HOOK_ADAPTER) {
  const entries = settings?.hooks?.[adapter.event];
  if (!Array.isArray(entries)) return false;
  // An event that takes no matcher (Cursor's `afterFileEdit`) fires whenever our entry is there.
  if (!adapter.matcher) return entries.some((e) => entryIsOurs(adapter, e));
  const tools = adapter.matcher.split('|');
  for (const entry of entries) {
    if (!entryIsOurs(adapter, entry)) continue;
    // Both harnesses document an empty matcher as matching every tool; Cursor documents `*` the same
    // way. `*` is NOT a valid regex on its own (`new RegExp('*')` throws "Nothing to repeat"), so
    // testing it as one would drop into the catch below and report a correctly configured project as
    // an installed-but-dead guard — a warning the team can only clear by breaking their own config.
    if (!entry.matcher || entry.matcher === '*') return true;
    let re;
    try { re = new RegExp(entry.matcher); } catch { continue; }
    if (tools.some((t) => re.test(t))) return true;
  }
  return false;
}

// One harness's settings file as an action. Not a `wiredFileAction`: there is no template to compare
// bytes against — the file belongs to the team and we own exactly one entry inside it. So it is also
// deliberately NOT recorded in `.sdlc/managed.json` (recordManagedWrites only records a dest that
// byte-matches its src); the marker above is its provenance instead.
function hookSettingsAction(root, adapter) {
  const ide = adapter.target;
  const relDest = adapter.settings;
  const dest = path.join(root, relDest);
  const raw = exists(dest) ? fs.readFileSync(dest, 'utf8') : null;
  let parsed = null;
  let unreadable = false;
  if (raw !== null) {
    try { parsed = JSON.parse(raw); } catch { unreadable = true; }
    if (!unreadable && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) unreadable = true;
  }
  // Scope is the IDE target, item the file under it, so the report reads `.claude/settings.json`
  // once — the same scope the skills for that target are grouped under.
  //
  // `paths` is EMPTY, unlike every other action's: it is the pathspec `yad update --push` stages, and
  // every other entry in that allowlist is a file yad wrote in full. This one the team co-owns, so
  // staging it wholesale would sweep their unrelated working-tree edits into a `chore(yad-update)`
  // commit pushed straight to the default branch, bypassing review. The entry is theirs to commit.
  const base = { scope: ide, item: path.basename(relDest), root, paths: [] };
  // A settings file we cannot READ is never rewritten — not even by `--overwrite-local`.
  //
  // For a managed file, `--overwrite-local` restores the shipped template, which is coherent. Here
  // there is no template: only the parse failed, and everything the file holds — permissions, env,
  // other hooks — is the team's. Synthesizing a replacement from an empty object would discard all of
  // it, and `--overwrite-local` is a generic recovery command someone runs for an unrelated drifted
  // gate script. So this reports `modified` forever and writes nothing; the human fixes the JSON.
  //
  // Warned at PLAN time, not from apply(): reconcile only reaches a `modified` action's apply() with
  // `--overwrite-local`, so a plain `yad check --fix` would print nothing but the generic drift
  // hand — "replace them with `yad update --overwrite-local`" — advice that can never clear this,
  // since this action deliberately writes nothing. The specific reason has to surface either way.
  if (unreadable) {
    warn(`${relDest} does not parse — the ${adapter.label || 'ledger guard'} cannot be wired; fix the JSON, then re-run \`yad check --fix\``);
    return { ...base, status: 'modified', apply: () => {} };
  }
  const { changed, unreadable: unmergeable } = mergeHookSettings(parsed, adapter);
  // Same treatment as a file that does not parse, and for the same reason: everything in it is the
  // team's, there is no shipped template to restore, and `--overwrite-local` must not invent one.
  if (unmergeable) {
    warn(`${relDest}: ${unmergeable} — the ${adapter.label || 'ledger guard'} cannot be wired without discarding what is there; fix it by hand, then re-run \`yad check --fix\``);
    return { ...base, status: 'modified', apply: () => {} };
  }
  return {
    ...base,
    status: raw === null ? 'missing' : changed ? 'outdated' : 'ok',
    // Re-read at apply() time rather than closing over the merge computed above: setup and reconcile
    // build every action before applying any, so the file may have been written since.
    //
    // A no-op when the entry is already there. `yad setup` re-applies with force:true, which reaches
    // an `ok` action — and an unconditional write would reformat a team's hand-formatted (but valid)
    // settings.json to writeJSON's style on every re-run. Nothing is lost, but the diff noise lands
    // in a committed file we only own one entry of.
    //
    // The re-read is STRICT. `readJSON`'s swallow-and-default would turn a file that became
    // unparseable between plan and apply into `{}` and write the team's whole config away — with no
    // backup, since that is the branch above. Re-check instead, and refuse the same way.
    apply: () => {
      if (!changed && raw !== null) return;
      if (exists(dest)) {
        let current;
        try { current = JSON.parse(fs.readFileSync(dest, 'utf8')); } catch { /* unreadable — refused below */ }
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
          warn(`${relDest} does not parse — left untouched; fix the JSON, then re-run \`yad check --fix\``);
          return;
        }
        const merged = mergeHookSettings(current, adapter);
        if (merged.unreadable) {
          warn(`${relDest}: ${merged.unreadable} — left untouched; fix it by hand, then re-run \`yad check --fix\``);
          return;
        }
        writeJSON(dest, merged.settings);
        return;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      writeJSON(dest, mergeHookSettings({}, adapter).settings);
    },
  };
}

// Harness-hook wiring on the Product: the guard script plus, per IDE target that defines a hook protocol,
// the entry that invokes it. Verified-only exactly like `productActions` — with a local ledger it is
// locally owned, the hand-edit the authoring skills describe is CORRECT, and a guard would be wrong.
export function hookActions(root, ideTargets = ideTargetsFor(root)) {
  const productConfig = readJSON(productConfigPath(root));
  if (!isVerifiedLedger(productConfig)) return [];
  const ledger = readManagedLedger(root);
  const actions = HOOK_WIRING.map((w) =>
    wiredFileAction('product', w.dest, asset(w.src), path.join(root, w.dest), { root, exec: !!w.exec, ledger }),
  );
  for (const ide of safeIdeTargetsFor(root, ideTargets)) {
    const adapter = HOOK_ADAPTERS[ide];
    if (!adapter) continue;
    // A harness whose protocol the shared script cannot speak brings its own wrapper, and it is
    // installed ONLY for a project that selected that target — an unused adapter script in a
    // `.claude`-only tree is a file nobody can explain. It is pushed BEFORE the settings entry that
    // points at it, so the two land in the order `asNew` already guarantees they land together.
    for (const w of adapter.wiring) {
      actions.push(wiredFileAction('product', w.dest, asset(w.src), path.join(root, w.dest), { root, exec: !!w.exec, ledger }));
    }
    actions.push(hookSettingsAction(root, adapter));
  }
  // The two halves must land TOGETHER, so `missing` is relabelled `new` — the same relabel a new
  // first-party skill gets, and for the same reason: `yad update` (--scope=changed) excludes only
  // the literal 'missing'. Without it, an upgrade on a Product that already has a settings.json applies
  // the entry (`outdated`) while skipping the script (`missing`), leaving every file edit firing a
  // PreToolUse command that does not exist — a hook error per edit, and no guarding at all.
  return actions.map(asNew);
}

// A target that has LEFT `ideTargets`, but whose wiring is still on disk and still running.
//
// Dropping `.cursor` used to leave `hooks/ledger-guard-cursor.sh` behind AND `.cursor/hooks.json`
// still invoking it on every write. That is not merely untidy: the entry keeps firing while nothing
// checks it for drift any more (every check here is keyed on the current targets), so the next
// release that changes the wrapper's protocol leaves that project running the old one, silently. The
// entry goes first and the script follows, and only a script no REMAINING target still needs is
// removed.
//
// Verified-only, like `hookActions`, and for the same reason: with a local ledger none of this was
// installed in the first place.
export function orphanHookActions(root, ideTargets = ideTargetsFor(root)) {
  const productConfig = readJSON(productConfigPath(root));
  if (!isVerifiedLedger(productConfig)) return [];
  const kept = new Set(safeIdeTargetsFor(root, ideTargets));
  const stillNeeded = new Set(
    [...kept].flatMap((ide) => (HOOK_ADAPTERS[ide]?.wiring || []).map((w) => w.dest)),
  );
  const actions = [];
  for (const adapter of Object.values(HOOK_ADAPTERS)) {
    if (kept.has(adapter.target)) continue;
    const settingsPath = path.join(root, adapter.settings);
    if (exists(settingsPath)) {
      // Read STRICTLY. A file that will not parse is the team's to fix, and rewriting it from a
      // default would throw their whole harness config away — the same refusal the merge makes.
      //
      // Only OUR entry comes out. A `version` the merge added stays, because nothing on disk records
      // whether we wrote it or the team did, and a key that might be theirs is not ours to delete —
      // so a hooks.json we emptied is left as `{"version": 1}` rather than removed.
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* refused below */ }
      if (isPlainObject(parsed) && unmergeHookSettings(parsed, adapter).changed) {
        actions.push({
          scope: adapter.target,
          item: `${path.basename(adapter.settings)} (removed)`,
          status: 'removed',
          root,
          // Co-owned, exactly like the merge side: never staged into a `yad update --push` commit.
          paths: [],
          apply: () => {
            let current;
            try { current = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { return; }
            if (!isPlainObject(current)) return;
            const { settings, changed } = unmergeHookSettings(current, adapter);
            if (changed) writeJSON(settingsPath, settings);
          },
        });
      }
    }
    for (const w of adapter.wiring) {
      if (stillNeeded.has(w.dest)) continue;
      const dest = path.join(root, w.dest);
      if (!exists(dest)) continue;
      actions.push({
        scope: 'product',
        item: `${w.dest} (removed)`,
        status: 'removed',
        root,
        paths: [w.dest],
        apply: () => fs.rmSync(dest, { force: true }),
      });
    }
  }
  return actions;
}

// ---- the git pre-commit hook (E48) ----------------------------------------------------------------
//
// The person's half of the ledger guard. `hooks/ledger-guard.mjs` refuses an AGENT's edit; this refuses a
// PERSON's `git commit` of the same files, by running that same script with `--staged`. Verified-only,
// like `hookActions`: with a local ledger the person owns the ledger and there is nothing to refuse.
//
// PER CLONE, NOT COMMITTED. Git never commits `.git/hooks`, so every clone needs its own copy, and
// `yad check --fix` (or setup, or update) installs it. That is why nothing here touches the provenance
// record: that file is committed, and recording this hook in it would tell every teammate's `yad check`
// the hook is there when their clone has none. Ours is recognised by its marker line instead, and
// `paths` is empty so `yad update --push` never stages it.
//
// NEVER SOMEONE ELSE'S HOOK. A `pre-commit` without our marker is the team's (or husky's, or
// pre-commit's), and `core.hooksPath` means a tool manages hooks from a folder that is usually committed.
// Either way nothing is written: `gitHookState` says so, with the one line to add by hand, and doctor
// and `yad check` print it.
export const GIT_HOOK_MARKER = '# yadflow ledger-guard (E48)';
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export function gitPreCommitScript(prefix = '') {
  return [
    '#!/bin/sh',
    `${GIT_HOOK_MARKER} — installed in this clone by \`yad check --fix\`.`,
    '# Refuses a commit that changes a file only CI may change on a verified Product (the gate ledger and',
    '# the Product index), the same files the `ledger-guard` check in CI refuses. It fails open: with no',
    '# node, or no guard script, it allows. Skip it once with YAD_HOOK_DISABLE=1. Git runs it from the top',
    '# of the repo. yad rewrites this file; to stop it, delete the file.',
    `guard=${shQuote(`${prefix}hooks/ledger-guard.mjs`)}`,
    'command -v node >/dev/null 2>&1 || exit 0',
    '[ -f "$guard" ] || exit 0',
    'node "$guard" --staged || [ $? -ne 2 ] || exit 1',
    'exit 0',
    '',
  ].join('\n');
}
// The line a person adds to a hook yad will not touch, run from the top of the repo.
// It fails open as the script does: only the guard's refusal (2) stops the commit, and its own status is
// 0 otherwise, so it is safe as the last line of a hook. Every command that can fail sits on the left of
// `||`, so it is safe under `sh -e` too (husky runs hooks that way): no guard file, no node, or a crash
// never stops the commit.
export const gitHookLine = (prefix = '') => {
  const guard = shQuote(`${prefix}hooks/ledger-guard.mjs`);
  return `[ ! -f ${guard} ] || node ${guard} --staged || [ $? -ne 2 ] || exit 1`;
};

// Where this clone's pre-commit hook is, and whose it is. `{ applies: false }` when there is nothing to
// install (a local ledger, or no git). Otherwise `{ applies: true, file, expected, prefix, state }` with
// `state` one of: 'missing' | 'ok' | 'outdated' (ours, different bytes) | 'foreign' (a hook that is not
// ours) | 'hooks-path' (core.hooksPath is set). The last two carry `line`, the one to add by hand.
export function gitHookState(root) {
  if (!isVerifiedLedger(readJSON(productConfigPath(root)))) return { applies: false };
  const where = run('git', ['-C', root, 'rev-parse', '--git-path', 'hooks/pre-commit', '--show-prefix']);
  if (!where.ok) return { applies: false };
  const [hookRel, prefix = ''] = where.stdout.split('\n');
  const file = path.resolve(root, hookRel);
  const expected = gitPreCommitScript(prefix);
  const line = gitHookLine(prefix);
  const hooksPath = run('git', ['-C', root, 'config', '--get', 'core.hooksPath']);
  // A core.hooksPath that names the default folder anyway (some tools set it so) is not a tool's folder.
  // `--path-format` needs git 2.31; an older git fails the call, and the setting is then treated as a tool's.
  const common = run('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  // The folder is compared through its PARENT, which always exists: `.git/hooks` itself may not (a clone
  // made with an empty template), and a path that does not exist cannot be resolved to compare.
  // When the folder does exist, it is compared whole: a setting typed `.git/Hooks` on a disk that ignores
  // case is the same folder, and the OS gives both sides one spelling.
  const hooksDir = path.dirname(file);
  const isDefault = common.ok && (samePath(hooksDir, path.join(common.stdout, 'hooks'))
    || (path.basename(hooksDir) === 'hooks' && samePath(path.dirname(hooksDir), common.stdout)));
  if (hooksPath.ok && hooksPath.stdout && !isDefault) {
    // husky points core.hooksPath at `.husky/_`, a folder it generates; the hook a person edits is the one
    // beside it, `.husky/pre-commit`. Name that one, or the advice sends them to a file husky rewrites.
    const dir = hooksPath.stdout.replace(/[\\/]+$/, '');
    const edit = /(^|[\\/])_$/.test(dir) ? `${dir.replace(/[\\/]?_$/, '') || '.'}/pre-commit` : `${dir}/pre-commit`;
    return { applies: true, file, expected, prefix, line, hooksPath: hooksPath.stdout, editFile: edit, state: 'hooks-path' };
  }
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* absent */ }
  if (text === null) return { applies: true, file, expected, prefix, state: 'missing' };
  if (!text.includes(GIT_HOOK_MARKER)) return { applies: true, file, expected, prefix, line, state: 'foreign' };
  // Git silently skips a hook that is not executable (everywhere but Windows), so right bytes without the
  // bit are not an installed hook.
  let runnable = true;
  if (process.platform !== 'win32') { try { runnable = (fs.statSync(file).mode & 0o111) !== 0; } catch { runnable = false; } }
  if (text === expected && runnable) return { applies: true, file, expected, prefix, state: 'ok' };
  return { applies: true, file, expected, prefix, state: 'outdated', why: text === expected ? 'not-executable' : 'changed' };
}

// The install action. 'foreign' and 'hooks-path' build no action — there is nothing yad may write —
// and are reported by `gitHookAdvice` instead.
export function gitHookActions(root) {
  const st = gitHookState(root);
  if (!st.applies || st.state === 'foreign' || st.state === 'hooks-path') return [];
  const status = st.state === 'missing' ? 'new' : st.state;
  // An outdated copy may carry a person's edit below our marker, so it is saved beside itself first —
  // the same rule `wiredFileAction` keeps for content it cannot prove it wrote. Not when only the execute
  // bit is missing: nothing of anyone's is being replaced then.
  const sameBytes = st.state === 'outdated' && (() => { try { return fs.readFileSync(st.file, 'utf8') === st.expected; } catch { return false; } })();
  const backup = st.state === 'outdated' && !sameBytes ? backupPathFor(st.file) : null;
  return [{
    scope: 'product',
    item: 'pre-commit git hook (this clone)',
    status,
    root,
    paths: [],
    backup,
    apply: () => {
      if (backup) fs.copyFileSync(st.file, backup);
      fs.mkdirSync(path.dirname(st.file), { recursive: true });
      fs.writeFileSync(st.file, st.expected, { mode: 0o755 });
      fs.chmodSync(st.file, 0o755);
    },
  }];
}

// A local ledger: the hook yad installed while the Product was verified has nothing to guard. Removed
// only when its bytes are exactly what yad writes — an edited copy is left for its owner.
export function orphanGitHookActions(root) {
  if (isVerifiedLedger(readJSON(productConfigPath(root)))) return [];
  const where = run('git', ['-C', root, 'rev-parse', '--git-path', 'hooks/pre-commit', '--show-prefix']);
  if (!where.ok) return [];
  const [hookRel, prefix = ''] = where.stdout.split('\n');
  const file = path.resolve(root, hookRel);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  if (text !== gitPreCommitScript(prefix)) return [];
  return [{ scope: 'product', item: 'pre-commit git hook (this clone) (removed)', status: 'removed', root, paths: [], apply: () => fs.rmSync(file, { force: true }) }];
}

// The sentence for a clone where yad may not write the hook, or null.
// A tool that owns the hook (the pre-commit framework, husky v4) may rewrite it on reinstall, which drops
// an added line, so the advice says to check after one.
export function gitHookAdvice(st) {
  if (st?.state === 'hooks-path') return `git's core.hooksPath is set (${st.hooksPath}), so yad did not install its pre-commit ledger guard; add this line to ${st.editFile}: ${st.line}`;
  if (st?.state === 'foreign') return `${st.file} is not yad's, so yad left it alone; add this line to it to refuse a hand commit to the CI-owned ledger (and again if a tool rewrites the hook): ${st.line}`;
  return null;
}

// ---- background capture wiring (E43) -----------------------------------------------------------
//
// The post-edit capture hook: `hooks/yad-capture.mjs`, plus one entry per IDE target that has a post-edit
// protocol. Unlike `hookActions` it is wired in BOTH ledger modes — never losing a draft matters whoever
// owns the ledger — on any Product (a `.sdlc/hub.json` or `product.json`) whose config does not say
// `"capture": false`. Only the CONFIG turns the wiring off: `YAD_CAPTURE=0` is one shell's choice, and
// letting it unwire a committed file would make `yad check` flip-flop between two people's shells.
function captureWanted(root) {
  const cfgPath = productConfigPath(root);
  if (!exists(cfgPath)) return false;
  const cfg = readJSON(cfgPath, null);
  return !(cfg && cfg.capture === false);
}

export function captureHookActions(root, ideTargets = ideTargetsFor(root)) {
  if (!captureWanted(root)) return [];
  const ledger = readManagedLedger(root);
  const actions = CAPTURE_WIRING.map((w) =>
    wiredFileAction('product', w.dest, asset(w.src), path.join(root, w.dest), { root, exec: !!w.exec, ledger }),
  );
  for (const ide of safeIdeTargetsFor(root, ideTargets)) {
    const adapter = CAPTURE_ADAPTERS[ide];
    if (!adapter) continue;
    actions.push(hookSettingsAction(root, adapter));
  }
  // The script and its entries land together, for the reason `hookActions` gives.
  return actions.map(asNew);
}

// Capture wiring that should no longer run: an entry for a target that left `ideTargets`, or every entry
// and the script once the config says `"capture": false`. Only OUR entry comes out, as `orphanHookActions`
// does it; the script goes only when capture is off (a remaining target still invokes it otherwise).
export function orphanCaptureHookActions(root, ideTargets = ideTargetsFor(root)) {
  if (!exists(productConfigPath(root))) return [];
  const on = captureWanted(root);
  const kept = on ? new Set(safeIdeTargetsFor(root, ideTargets)) : new Set();
  const actions = [];
  for (const adapter of Object.values(CAPTURE_ADAPTERS)) {
    if (kept.has(adapter.target)) continue;
    const settingsPath = path.join(root, adapter.settings);
    if (!exists(settingsPath)) continue;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { continue; }
    if (!isPlainObject(parsed) || !unmergeHookSettings(parsed, adapter).changed) continue;
    actions.push({
      scope: adapter.target,
      item: `${path.basename(adapter.settings)} (capture entry removed)`,
      status: 'removed',
      root,
      paths: [],
      apply: () => {
        let current;
        try { current = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { return; }
        if (!isPlainObject(current)) return;
        const { settings, changed } = unmergeHookSettings(current, adapter);
        if (changed) writeJSON(settingsPath, settings);
      },
    });
  }
  if (!on) {
    for (const w of CAPTURE_WIRING) {
      const dest = path.join(root, w.dest);
      if (!exists(dest)) continue;
      actions.push({ scope: 'product', item: `${w.dest} (removed)`, status: 'removed', root, paths: [w.dest], apply: () => fs.rmSync(dest, { force: true }) });
    }
  }
  return actions;
}

// ---- the shell-script hooks, retired (E113) -----------------------------------------------------------
//
// Every hook was a bash script until E113; each is now a Node script, and the adapters list the old
// commands as `legacyCommands`, so the same `yad check --fix` that rewrites an entry also installs the new
// file. This removes the old one — status `removed`, so `yad update` applies it too.
//
// ONLY A COPY YAD PROVABLY WROTE. The provenance record (`.sdlc/managed.json`) must hold the script's sha,
// and the file on disk must still match it. An edited copy, or one from before the record existed, is left
// alone: the header of each script invited a team to wire it into another harness by hand, and deleting a
// file their own hook runs would switch that hook off without a word.
//
// And never while anything still RUNS it — in two places, both read at PLAN time so `yad check` shows only
// what `--fix` will really do (an action that plans a removal and then keeps the file would be pending on
// every run, for ever):
//   - the settings files AS COMMITTED (HEAD). The rewritten entry is the team's to commit (a settings file is
//     never staged by `--push`), so until it is, everyone who pulls runs the old command — deleting the
//     script under it would leave them all a hook that does not exist. The removal waits for a later run,
//     after the new entry is committed.
//   - the settings files ON DISK AS THIS RUN WILL LEAVE THEM: each adapter's own entry merged or unmerged
//     exactly as this run's actions do it (review 2 — excusing our old commands wherever they appeared
//     also excused copies no action touches, under another event or in `settings.local.json`, and those
//     were planned, kept, and pending for ever).
// Both harness settings files are read, plus Claude Code's personal `settings.local.json`, and a command
// is matched with either kind of slash (`hooks\yad-capture.sh` on Windows).
const HOOK_SETTINGS_FILES = [...new Set([...Object.values(HOOK_ADAPTERS), ...Object.values(CAPTURE_ADAPTERS)].map((a) => a.settings)), '.claude/settings.local.json'];
function commandsIn(value, out = []) {
  if (Array.isArray(value)) { for (const v of value) commandsIn(v, out); return out; }
  if (!isPlainObject(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (k === 'command' && typeof v === 'string') out.push(v);
    else if (k === 'args' && Array.isArray(v)) out.push(...v.filter((a) => typeof a === 'string'));
    else commandsIn(v, out);
  }
  return out;
}
const namesScript = (text, scriptRel) => text.replace(/\\/g, '/').includes(scriptRel);
// Which settings files name the script, read from `raw(file)` (null = absent). A file that will not parse
// names it when its text does: nothing can be proved about it, so it keeps the script.
function namedIn(raw, scriptRel) {
  const where = [];
  for (const file of HOOK_SETTINGS_FILES) {
    const text = raw(file);
    if (text === null) continue;
    let parsed;
    try { parsed = JSON.parse(text); } catch { if (namesScript(text, scriptRel)) where.push(file); continue; }
    if (commandsIn(parsed).some((cmd) => namesScript(cmd, scriptRel))) where.push(file);
  }
  return where;
}
const onDisk = (root) => (file) => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
// `HEAD:./<file>` is read relative to the Product (the `./`), so a Product in a subfolder of its repository
// reads its own files. Not a repository, no commit yet, or a file never committed: nothing is committed.
// The old scripts that belonged to the ledger guard, which only a verified Product has.
const GUARD_SCRIPTS = new Set(['hooks/ledger-guard.sh', 'hooks/ledger-guard-cursor.sh']);

// What to do with an entry that still runs an old script: repoint it at the Node script yad now writes —
// except a guard script on a Product whose ledger is not verified (or cannot be read), where no guard is
// installed to point at, so the entry is removed. One sentence for the plan's note AND apply's warning, so
// the two cannot give different advice (review 5).
//
// It never promises what `yad check --fix` will do: both callers are reached only for entries that run has
// NOT taken out (another event, `settings.local.json`, a file changed since the plan), so the reader acts.
export function entryAdvice(root, scriptRel) {
  const productConfig = readJSON(productConfigPath(root), null);
  // Capture off: no Node capture script is installed, so there is nothing to point at (review 8).
  if (!GUARD_SCRIPTS.has(scriptRel) && !captureWanted(root)) {
    return 'remove each entry that runs it — capture is off here (`"capture": false` in the Product config), so no capture hook should run';
  }
  if (!GUARD_SCRIPTS.has(scriptRel) || isVerifiedLedger(productConfig)) {
    return 'point each entry that runs it at the `node hooks/….mjs` command yad now writes, or remove it if that harness should no longer run the hook';
  }
  return productConfig === null
    ? 'the Product config does not read, so yad cannot tell whether a ledger guard belongs here — fix the config, or remove each entry that runs it'
    : 'remove each entry that runs it — this Product has no ledger guard (its ledger is not verified), so `yad check --fix` leaves those entries alone';
}

// Read once per file per plan, however many old scripts ask (review 3).
const committed = (root) => {
  const seen = new Map();
  return (file) => {
    if (!seen.has(file)) {
      const r = run('git', ['-C', root, 'show', `HEAD:./${file}`]);
      seen.set(file, r.ok ? r.stdout : null);
    }
    return seen.get(file);
  };
};
// The settings files on disk as this run's hook actions will leave them. The same choices the actions make:
// the guard's entry merged for a verified Product's current targets and unmerged for its dropped ones
// (`hookActions` / `orphanHookActions`), nothing done to it with a local ledger; capture's merged for the
// current targets while capture is wanted and unmerged otherwise (`captureHookActions` /
// `orphanCaptureHookActions`). A file the merge cannot read is left as it is, as the action leaves it.
function afterThisRun(root, ideTargets) {
  const targets = new Set(safeIdeTargetsFor(root, ideTargets));
  const verified = isVerifiedLedger(readJSON(productConfigPath(root)));
  const capture = captureWanted(root);
  const plans = [
    ...(verified ? Object.values(HOOK_ADAPTERS) : []).map((a) => [a, targets.has(a.target)]),
    ...Object.values(CAPTURE_ADAPTERS).map((a) => [a, capture && targets.has(a.target)]),
  ];
  const read = onDisk(root);
  return (file) => {
    const text = read(file);
    if (text === null) return null;
    let settings;
    try { settings = JSON.parse(text); } catch { return text; }
    if (!isPlainObject(settings)) return text;
    for (const [adapter, wired] of plans) {
      if (adapter.settings !== file) continue;
      const r = wired ? mergeHookSettings(settings, adapter) : unmergeHookSettings(settings, adapter);
      if (!r.unreadable) settings = r.settings;
    }
    return JSON.stringify(settings);
  };
}
export function legacyHookScriptActions(root, ideTargets = ideTargetsFor(root)) {
  if (!exists(productConfigPath(root))) return [];
  const ledger = readManagedLedger(root);
  const actions = [];
  const head = committed(root);
  const ours = new Set([...Object.values(HOOK_ADAPTERS), ...Object.values(CAPTURE_ADAPTERS)].flatMap((a) => a.legacyCommands));
  for (const scriptRel of LEGACY_HOOK_SCRIPTS) {
    const file = path.join(root, scriptRel);
    if (!lstatIfPresent(file)?.isFile()) continue;
    const recorded = ledger[scriptRel];
    if (!recorded || recorded !== contentSha(file)) continue;
    const after = afterThisRun(root, ideTargets);
    const onDiskAfter = namedIn(after, scriptRel);
    if (onDiskAfter.length) {
      // Kept because something still runs it. A command of the team's own is their choice and is left in
      // silence; one of OURS that no action reaches — another event, `settings.local.json` — is stuck, and
      // is named with the way out (review 3).
      const stuck = onDiskAfter.filter((f) => {
        try { return commandsIn(JSON.parse(after(f))).some((cmd) => ours.has(cmd) && namesScript(cmd, scriptRel)); } catch { return false; }
      });
      if (stuck.length) {
        info(`${scriptRel} stays — ${stuck.join(' and ')} still ${stuck.length > 1 ? 'run' : 'runs'} it through an old yad hook command. To clear it: ${entryAdvice(root, scriptRel)}; then \`yad check --fix\` removes the script`);
      }
      continue;
    }
    const inHead = namedIn(head, scriptRel);
    if (inHead.length) {
      // The one wait a person ends: committing the rewritten settings. Said, so the second run is not a mystery.
      info(`${scriptRel} stays until ${inHead.join(' and ')} ${inHead.length > 1 ? 'are' : 'is'} committed as ${inHead.length > 1 ? 'they now stand' : 'it now stands'} — then \`yad check --fix\` removes it`);
      continue;
    }
    actions.push({
      scope: 'product',
      item: `${scriptRel} (removed)`,
      status: 'removed',
      root,
      paths: [scriptRel, MANAGED_LEDGER],
      apply: () => {
        // Checked once more, on disk and with nothing excused: the rewrites above have run by now, so any
        // command still naming the script is one this run did not take out.
        const where = namedIn(onDisk(root), scriptRel);
        if (where.length) {
          // Reached when a plan's assumption did not hold at apply — e.g. `yad setup`, which does not unwire a
          // dropped target the way `yad check --fix` does (review 3).
          warn(`${scriptRel} kept — ${where.join(', ')} still ${where.length > 1 ? 'run' : 'runs'} it. To clear it: ${entryAdvice(root, scriptRel)}`);
          return;
        }
        fs.rmSync(file, { force: true });
        // Drop its line from the provenance record, so the record lists only files that are there.
        const current = readManagedLedger(root);
        if (Object.hasOwn(current, scriptRel)) {
          delete current[scriptRel];
          writeJSON(path.join(root, MANAGED_LEDGER), { version: VERSION, files: current });
        }
      },
    });
  }
  return actions;
}
