// #352 — the machine setup local work depends on, for `yad doctor`. Three checks, each from what is on disk
// here (no network):
//   node    the Node running yad (the active one, e.g. nvm's default) against the version each repo pins:
//           .nvmrc, .node-version, .tool-versions (nodejs), package.json `engines.node` and `volta.node`.
//           A pin yad cannot read as a version (`lts/*`, a URL) is left out, never guessed.
//   docker  Docker running, only where a repo itself asks for it: a compose file, a Dockerfile, a `docker`
//           call in its package.json scripts, or a docker hook in its pre-commit config. yad's own gates
//           need no Docker, so a repo that names none is never asked about.
//   glab    more than one glab config file. glab then reads only one and ignores the other (a login saved
//           there is not used), and warns on every run, which breaks JSON for a tool that reads its output
//           and its errors together.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, readJSON, isPlainObject, forTerminal } from './lib.mjs';

const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// The Node versions a folder pins, each { source, want }.
export function nodePins(dir) {
  const pins = [];
  for (const f of ['.nvmrc', '.node-version']) {
    const t = read(path.join(dir, f));
    const v = t?.split('\n').map((l) => l.replace(/#.*/, '').trim()).find(Boolean);
    if (v) pins.push({ source: f, want: v });
  }
  const tv = read(path.join(dir, '.tool-versions'));
  // A line may list fallbacks (`nodejs 24.2.0 22.0.0`): the first is the one in use, and the one read.
  const line = tv?.split('\n').map((l) => l.replace(/#.*/, '').trim()).find((l) => /^(nodejs|node)\s/.test(l));
  if (line) pins.push({ source: '.tool-versions', want: line.split(/\s+/)[1] });
  const pkg = readJSON(path.join(dir, 'package.json'), null);
  if (isPlainObject(pkg)) {
    if (typeof pkg.engines?.node === 'string' && pkg.engines.node.trim()) pins.push({ source: 'package.json engines.node', want: pkg.engines.node.trim() });
    if (typeof pkg.volta?.node === 'string' && pkg.volta.node.trim()) pins.push({ source: 'package.json volta.node', want: pkg.volta.node.trim() });
  }
  return pins;
}

const parts = (v) => {
  const m = /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i.exec(String(v).trim());
  if (!m) return null;
  const n = (x) => (x === undefined || /^[x*]$/i.test(x) ? null : Number(x));
  return [Number(m[1]), n(m[2]), n(m[3])];
};
const cmp = (a, b) => { for (let i = 0; i < 3; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };

// Does `version` (x.y.z) meet `spec`? true / false, or null when the spec is not one yad reads (a name such
// as `lts/*`, a URL): never guessed. Reads exact and partial versions (`24`, `22.8`), `x` and `*`, the
// operators >= > <= < = (with or without a space before the version), ^ and ~, `a - b`, spaces (all must
// hold) and `||` (any may). A pre-release (`24.0.0-rc.1`), in the spec or the running Node, is not read.
export function satisfies(version, spec) {
  const have = parts(version);
  if (!have) return null;
  const alts = String(spec).split('||').map((s) => s.trim());
  let unknown = false;
  for (const alt of alts) {
    if (alt === '' || alt === '*' || /^x$/i.test(alt)) return true;
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(alt);
    // `>= 22` is `>=22`: an operator is joined to its version before the spaces split the terms.
    const joined = alt.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
    const terms = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : joined.split(/\s+/).filter(Boolean);
    let all = true;
    for (const term of terms) {
      const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(term);
      const want = m && parts(m[2]);
      if (!want) { unknown = true; all = false; break; }
      const op = m[1] || '';
      const c = cmp(have, want);
      const lead = want.findIndex((x) => x === null);
      let ok;
      if (op === '>=') ok = c >= 0;
      // `>24` is above every 24.x.y (npm reads it as >=25.0.0): only the parts it names are compared.
      else if (op === '>') ok = lead >= 0 ? cmp(have.slice(0, lead), want.slice(0, lead)) > 0 : c > 0;
      else if (op === '<=') ok = c <= 0 || (lead >= 0 && have.slice(0, lead).every((x, i) => x === want[i]));
      else if (op === '<') ok = c < 0;
      else if (op === '^') {
        ok = c >= 0 && (want[0] > 0 ? have[0] === want[0]
          : want[1] === null || want[1] > 0 ? have[0] === 0 && (want[1] === null || have[1] === want[1])
            : have[0] === 0 && have[1] === 0 && (want[2] === null || have[2] === want[2]));
      }
      else if (op === '~') ok = c >= 0 && have[0] === want[0] && (want[1] === null || have[1] === want[1]);
      // A bare or `=` version: the parts it names must match (`24` is any 24.x.y).
      else ok = want.every((x, i) => x === null || x === have[i]);
      if (!ok) { all = false; break; }
    }
    if (all) return true;
  }
  return unknown ? null : false;
}

// What the person runs to fix a Node mismatch: nvm's commands when nvm is here, else plain words.
export function nodeFix(rawWant, { env = process.env, home = os.homedir() } = {}) {
  const want = forTerminal(rawWant);
  const exact = /^v?\d+(\.\d+){0,2}$/.test(want) ? want.replace(/^v/, '') : null;
  const nvm = !!env.NVM_DIR || fs.existsSync(path.join(home, '.nvm'));
  if (nvm && exact) return `nvm install ${exact} && nvm use ${exact} (and \`nvm alias default ${exact}\` to make it the default in new shells)`;
  if (nvm) return `nvm install <a version that meets ${want}> && nvm use <that version>`;
  return `install Node ${want} (or switch to it with your version manager)`;
}

// Why a folder needs Docker: the files and lines that ask for it ([] when none). Script names come from the
// repo, so they are cleaned for the terminal here.
export function dockerReasons(dir) {
  const why = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* not readable: no reasons */ }
  for (const f of names) {
    if (/^(docker-)?compose\.ya?ml$/i.test(f) || /^dockerfile(\..+)?$/i.test(f) || /\.dockerfile$/i.test(f)) why.push(forTerminal(f));
  }
  const pkg = readJSON(path.join(dir, 'package.json'), null);
  const scripts = isPlainObject(pkg?.scripts) ? pkg.scripts : {};
  // docker run as a command: at the start, after `&&` `||` `;` `|` `(`, after `npx`, or by its path —
  // not the word inside another command (`--ignore-pattern docker`, `echo docker`).
  const cmd = /(^|[;&|(]\s*|\bnpx\s+(-y\s+)?)(\S*\/)?docker(-compose)?(\s|$)/;
  const named = Object.entries(scripts).filter(([, v]) => typeof v === 'string' && cmd.test(v)).map(([k]) => forTerminal(k));
  if (named.length) why.push(`package.json scripts: ${named.join(', ')}`);
  const pre = read(path.join(dir, '.pre-commit-config.yaml'));
  if (pre && /^\s*language:\s*["']?(docker|docker_image)["']?\s*(#.*)?$/m.test(pre)) why.push('.pre-commit-config.yaml (a docker hook)');
  return why;
}

// Is Docker here and running? 'running' | 'stopped' (the CLI is here, the daemon does not answer) |
// 'missing' (no docker command).
export function dockerState({ runner = run } = {}) {
  if (!runner(process.platform === 'win32' ? 'where' : 'which', ['docker']).ok) return 'missing';
  return runner('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 8000 }).ok ? 'running' : 'stopped';
}

// The glab config files that exist on this machine, in the places glab looks. GLAB_CONFIG_DIR, or else
// XDG_CONFIG_HOME, names the one place glab reads (it then warns about no other); without them glab looks
// in ~/.config and the system's own folder, and warns when both hold a config.
export function glabConfigs({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const places = env.GLAB_CONFIG_DIR ? [path.join(env.GLAB_CONFIG_DIR, 'config.yml')]
    : env.XDG_CONFIG_HOME ? [path.join(env.XDG_CONFIG_HOME, 'glab-cli', 'config.yml')]
      : [
        path.join(home, '.config', 'glab-cli', 'config.yml'),
        platform === 'darwin' && path.join(home, 'Library', 'Application Support', 'glab-cli', 'config.yml'),
        platform === 'win32' && env.APPDATA && path.join(env.APPDATA, 'glab-cli', 'config.yml'),
      ].filter(Boolean);
  return [...new Set(places)].filter((f) => fs.existsSync(f));
}
