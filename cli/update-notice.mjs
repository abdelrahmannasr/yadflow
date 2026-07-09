// "A new yadflow is out" — the update disclaimer printed after every `yad` command.
//
// Three rules make this safe to run on every invocation:
//   1. It never throws and never touches process.exitCode. A dead registry, an unwritable home, or a
//      malformed cache degrades to silence, never to a failed command.
//   2. It prints to STDERR (the `note()` convention in lib.mjs), so `--json` commands, the grounding
//      bundles, and `yad -v` keep a machine-readable STDOUT.
//   3. It is cache-first: the network is touched at most once per TTL. Every other run is pure disk.
//
// Deliberately NOT suppressed on a non-TTY. Skills invoke `yad` through an agent's Bash tool, where
// stdout/stderr are piped — the usual "only notify on a TTY" guard would hide the notice from exactly
// the case we most want it in. `CI` is the suppression signal instead.
import os from 'node:os';
import path from 'node:path';
import { VERSION, PKG_NAME, UPSTREAM_REPO } from './manifest.mjs';
import { c, exists, readJSON, writeJSON, PKG_ROOT } from './lib.mjs';

export const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

// An env var counts as "set" only when it carries a meaningful value — `CI=false` and `CI=0` are
// common in shells that always export the name.
const truthy = (v) => !!v && v !== '0' && v !== 'false';

// ---- semver -------------------------------------------------------------
// A deliberately small parser: we only ever compare a released `x.y.z` against another. Anything the
// registry hands us that is not a clean triple (garbage, a range, undefined) yields null → no notice.
export function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}

// The canonical `x.y.z` form. `parseVersion` tolerates a leading `v`, so anything interpolated into
// the banner or the release-tag URL must be normalized first — otherwise a `v`-prefixed `latest`
// (from a mirror registry or a hand-edited cache) yields a dead `.../releases/tag/vv3.11.0` link.
export function normalizeVersion(v) {
  const p = parseVersion(v);
  return p ? `${p.major}.${p.minor}.${p.patch}${p.pre ? `-${p.pre}` : ''}` : null;
}

// True when `latest` is a release strictly newer than `current`. A prerelease `latest` never nags a
// user on a stable version — dist-tags.latest should never be one, but a mis-tagged publish would
// otherwise pester every user until it was fixed. Prereleases are not ordered against each other
// (rc.2 does not "beat" rc.1); the only prerelease transition we announce is rc → its stable.
export function isNewer(latest, current) {
  const l = parseVersion(latest);
  const cur = parseVersion(current);
  if (!l || !cur) return false;
  if (l.pre && !cur.pre) return false;
  if (l.major !== cur.major) return l.major > cur.major;
  if (l.minor !== cur.minor) return l.minor > cur.minor;
  if (l.patch !== cur.patch) return l.patch > cur.patch;
  // Same x.y.z: the stable release supersedes the prerelease of that same version, so a user sitting
  // on 4.0.0-rc.1 is told when 4.0.0 final ships.
  return !l.pre && !!cur.pre;
}

// ---- registry -----------------------------------------------------------
export function registryBase({ env = process.env } = {}) {
  const base = env.YAD_REGISTRY_URL || env.npm_config_registry || DEFAULT_REGISTRY;
  return base.replace(/\/+$/, '');
}

// The `dist-tags` endpoint returns a few dozen bytes (`{"latest":"3.10.1"}`); the packument at
// /<pkg> or /<pkg>/latest is orders of magnitude larger for the same one field.
// `fetchImpl` must NOT default to a bare `fetch` in the parameter list: default parameters are
// evaluated before the function body's try/catch is entered, so on a runtime without a global fetch
// (Node 18 started with --no-experimental-fetch) that would throw a ReferenceError straight past
// every guard here and out through bin/yad.mjs's .finally. Resolve it inside the try instead.
export async function fetchLatest({ env = process.env, timeoutMs = FETCH_TIMEOUT_MS, fetchImpl } = {}) {
  try {
    const doFetch = fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function') return null; // no fetch on this runtime — stay quiet
    const url = `${registryBase({ env })}/-/package/${encodeURIComponent(PKG_NAME)}/dist-tags`;
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const tags = await res.json();
    return typeof tags?.latest === 'string' ? tags.latest : null;
  } catch {
    return null; // offline, DNS failure, timeout, non-JSON body — all mean "we don't know", not "fail"
  }
}

// ---- cache --------------------------------------------------------------
// The CLI's only per-user state. Everything else it writes is project-scoped under .sdlc/.
export function cacheFile({ env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (env.YAD_CACHE_DIR) return path.join(env.YAD_CACHE_DIR, 'update-check.json');
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, 'yadflow', 'update-check.json');
  if (platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'yadflow', 'update-check.json');
  return path.join(home, '.cache', 'yadflow', 'update-check.json');
}

export const readCache = (file) => readJSON(file, null);

// A read-only home (CI images, locked-down laptops, a root-owned ~/.cache) must not break `yad`.
// Losing the cache only costs one registry round-trip per command.
export function writeCache(file, data) {
  try {
    writeJSON(file, data);
    return true;
  } catch {
    return false;
  }
}

// ---- suppression --------------------------------------------------------
// `pkgRoot` carrying a .git means yad is running from a source checkout (`npm run yad`, the test
// suite's execFileSync calls), not from a global npm install. Nagging a maintainer about the version
// they are editing is noise.
export function shouldSuppress({ env = process.env, pkgRoot = PKG_ROOT } = {}) {
  if (truthy(env.YAD_NO_UPDATE_NOTIFIER)) return true;
  if (truthy(env.CI)) return true;
  if (truthy(env.SDLC_NONINTERACTIVE)) return true;
  if (exists(path.join(pkgRoot, '.git'))) return true;
  return false;
}

// ---- banner -------------------------------------------------------------
// `yad update` is the necessary second half: upgrading the global CLI leaves this project's installed
// yad-* skills stamped at the old version in .sdlc/cli-version.json, which `yad doctor` then flags.
export function formatBanner(current, latest) {
  // Normalize so a `v`-prefixed input can never produce `.../releases/tag/vv3.11.0`. Callers only
  // reach here after isNewer(), so parseVersion has already accepted both — the ?? is belt and braces.
  const v = normalizeVersion(latest) ?? latest;
  const url = `https://github.com/${UPSTREAM_REPO}/releases/tag/v${v}`;
  return [
    '',
    `  ${c.yellow('!')} ${c.bold(`${PKG_NAME} update available`)} — ${c.dim(current)} → ${c.green(v)}`,
    `    ${c.dim('Changelog:')}  ${url}`,
    `    ${c.dim('Update:')}     ${c.cyan(`npm install ${PKG_NAME} -g`)}`,
    `    ${c.dim('Then:')}       ${c.cyan('yad update')}   ${c.dim("(re-sync this project's yad-* skills)")}`,
  ].join('\n');
}

// ---- orchestrator -------------------------------------------------------
// Returns true when a banner was printed (tests assert on this; callers ignore it).
export async function maybeNotifyUpdate({
  env = process.env,
  now = Date.now(),
  pkgRoot = PKG_ROOT,
  ttlMs = DAY_MS,
  current = VERSION,
  out = (s) => console.error(s),
  fetchImpl, // resolved to globalThis.fetch inside fetchLatest — see the note there
} = {}) {
  try {
    if (shouldSuppress({ env, pkgRoot })) return false;

    const file = cacheFile({ env });
    const cache = readCache(file);
    // `age >= 0` matters: a lastCheck stamped in the future (a clock that jumped forward, an NTP
    // correction, a cache synced from another machine) yields a negative age, which would read as
    // "fresh" and pin a stale `latest` until real time caught up. Treat it as expired instead.
    const age = now - cache?.lastCheck;
    const fresh = Number.isFinite(cache?.lastCheck) && age >= 0 && age < ttlMs;

    let latest = typeof cache?.latest === 'string' ? cache.latest : null;
    if (!fresh) {
      const fetched = await fetchLatest({ env, fetchImpl });
      if (fetched) latest = fetched;
      // Stamp lastCheck even when the fetch failed: an offline user would otherwise pay the full
      // timeout on every single command. We keep any previously-known `latest` so the banner survives
      // a temporary outage.
      writeCache(file, { lastCheck: now, latest });
    }

    if (!isNewer(latest, current)) return false;
    out(formatBanner(current, latest));
    return true;
  } catch {
    return false; // never let the notifier turn a successful command into a failed one
  }
}
