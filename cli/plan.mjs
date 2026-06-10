// Builds the deterministic action list (module install + per-repo wiring) for a
// target project. Each action carries a current status and an apply() closure, so
// setup (apply all), update (apply changed), and check (report; fix non-ok) share it.
import path from 'node:path';
import {
  asset, exists, copyDir, copyFile, dirMatches, sameContent, readJSON,
} from './lib.mjs';
import {
  SKILLS, IDE_FOLDER_TARGETS, IDE_OPENCODE_DIR, MODULE_FILES, wiringFor, HUB_WIRING, PROJECT_FILES,
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

// Per-repo wiring (gate scripts, CI, PR template, comment scaffold).
export function repoActions(root, repo) {
  const repoRoot = path.resolve(root, repo.path);
  return wiringFor(repo.platform).map((w) =>
    fileAction(repo.name, w.dest, asset(w.src), path.join(repoRoot, w.dest), { exec: !!w.exec }),
  );
}

// Hub wiring (event-driven gate-sync CI on the product hub itself). Only when the hub has a
// platform and the bridge is explicitly enabled — a file-only hub stays file-only, with no error.
export function hubActions(root) {
  const hub = readJSON(path.join(root, PROJECT_FILES.hubConfig));
  // `bridge_enabled` is the canonical flag (the documented hub-config schema); older setup versions
  // wrote `bridge` — accept an explicit true in either spelling, wire nothing otherwise.
  if (!hub?.platform || !(hub.bridge_enabled === true || hub.bridge === true)) return [];
  return (HUB_WIRING[hub.platform] || []).map((w) =>
    fileAction('hub', w.dest, asset(w.src), path.join(root, w.dest)),
  );
}
