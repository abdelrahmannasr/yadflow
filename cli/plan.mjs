// Builds the deterministic action list (module install + per-repo wiring) for a
// target project. Each action carries a current status and an apply() closure, so
// setup (apply all), update (apply changed), and check (report; fix non-ok) share it.
import fs from 'node:fs';
import path from 'node:path';
import {
  asset, exists, copyDir, copyFile, dirMatches, sameContent, readJSON,
} from './lib.mjs';
import {
  SKILLS, IDE_FOLDER_TARGETS, IDE_OPENCODE_DIR, MODULE_FILES, wiringFor, HUB_WIRING, PROJECT_FILES,
  LEGACY_SKILLS, LEGACY_MARKER, LEGACY_REPO_FILES, LEGACY_HUB_FILES,
} from './manifest.mjs';

// status: 'ok' | 'missing' | 'outdated'
const fileAction = (scope, item, src, dest, opts = {}) => ({
  scope,
  item,
  status: !exists(dest) ? 'missing' : sameContent(src, dest) ? 'ok' : 'outdated',
  apply: () => copyFile(src, dest, opts),
});
const dirAction = (scope, item, src, dest) => ({
  scope,
  item,
  status: !exists(dest) ? 'missing' : dirMatches(src, dest) ? 'ok' : 'outdated',
  apply: () => copyDir(src, dest),
});

// Which IDE targets this project wants. Recorded at setup time; falls back to
// whichever IDE base dirs already exist, else .claude.
export function ideTargetsFor(root) {
  const rec = readJSON(path.join(root, PROJECT_FILES.version));
  if (rec?.ideTargets?.length) return rec.ideTargets;
  const present = [...IDE_FOLDER_TARGETS, '.opencode'].filter((d) => exists(path.join(root, d)));
  return present.length ? present : ['.claude'];
}

// Module = skills installed into each IDE target + the _bmad/sdlc registration.
export function moduleActions(root, ideTargets = ideTargetsFor(root)) {
  const actions = [];
  for (const ide of ideTargets) {
    if (ide === '.opencode') {
      for (const s of SKILLS) {
        actions.push(fileAction(
          ide, s,
          asset('skills', s, 'SKILL.md'),
          path.join(root, IDE_OPENCODE_DIR, `${s}.md`),
        ));
      }
    } else {
      for (const s of SKILLS) {
        actions.push(dirAction(
          ide, s,
          asset('skills', s),
          path.join(root, ide, 'skills', s),
        ));
      }
    }
  }
  for (const f of MODULE_FILES) {
    actions.push(fileAction(
      '_bmad', f,
      asset('skills', 'sdlc', f),
      path.join(root, '_bmad', 'sdlc', f),
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
  const actions = [];
  for (const ide of ideTargets) {
    for (const [skill, old] of Object.entries(LEGACY_SKILLS)) {
      if (ide === '.opencode') {
        const oldDest = path.join(root, IDE_OPENCODE_DIR, `${old}.md`);
        if (!exists(oldDest)) continue;
        actions.push({
          scope: ide,
          item: `${old}.md → ${skill}.md`,
          status: 'legacy',
          apply: () => {
            fs.rmSync(oldDest, { force: true });
            copyFile(asset('skills', skill, 'SKILL.md'), path.join(root, IDE_OPENCODE_DIR, `${skill}.md`));
          },
        });
      } else {
        const oldDest = path.join(root, ide, 'skills', old);
        if (!exists(oldDest)) continue;
        actions.push({
          scope: ide,
          item: `${old} → ${skill}`,
          status: 'legacy',
          apply: () => {
            fs.rmSync(oldDest, { recursive: true, force: true });
            copyDir(asset('skills', skill), path.join(root, ide, 'skills', skill));
          },
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
    actions.push({
      scope,
      item: `${oldDest} → ${newDest}`,
      status: 'legacy',
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

// Per-repo wiring (gate scripts, CI, PR template, comment scaffold).
export function repoActions(root, repo) {
  const repoRoot = path.resolve(root, repo.path);
  return wiringFor(repo.platform).map((w) =>
    fileAction(repo.name, w.dest, asset(w.src), path.join(repoRoot, w.dest), { exec: !!w.exec }),
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
    fileAction('hub', w.dest, asset(w.src), path.join(root, w.dest), { exec: !!w.exec }),
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
    { scope: 'hub', dest: path.join(root, '.sdlc', 'verified-authors') },
    ...repos.map((r) => ({ scope: r.name, dest: path.join(path.resolve(root, r.path), '.sdlc', 'verified-authors') })),
  ];
  return targets.map(({ scope, dest }) => ({
    scope,
    item: '.sdlc/verified-authors',
    status: !exists(dest) ? 'missing' : fs.readFileSync(dest, 'utf8') === desired ? 'ok' : 'outdated',
    apply: () => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, desired);
    },
  }));
}
