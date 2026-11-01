// `yad signing check` (E160a) — will this person's commits be signed, and will the platform mark them
// Verified? Read-only: it reads the git config in the folder it runs in, the key it names, and the account
// on the Product's platform (the key listed for SIGNING, and a verified email). Every finding is `ok`, `gap`
// (with the person's fix), `suggest`, or `unknown` (a read that failed: never counted as ok).
//
// Setting signing up is the person's (a key is a secret, and adding it to the account is a platform
// setting): the agent hands over the fix and runs this again to confirm by reading. SSH is taught first
// (one key, no extra program), GPG second.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { c, log, ok, warn, fail, info, hand, run, has, forTerminal } from './lib.mjs';
import { api, loggedIn, whyFailed, PAGE, PLATFORM_NAME } from './protection.mjs';
import { productIdentity } from './members.mjs';

const SSH_MIN_GIT = [2, 34];

// The public key a `user.signingkey` names for SSH, as `<type> <base64>`, or `{ problem }`. A `key::` value is
// the key itself; a path names the public key, or the private key with its `.pub` beside it.
export function sshPublicKey(signingkey, { home = os.homedir(), dir = process.cwd() } = {}) {
  if (!signingkey) return { problem: 'no key is named (user.signingkey is not set)' };
  if (signingkey.startsWith('key::')) return { key: keyText(signingkey.slice(5)) };
  // The older form git still reads: the public key itself, with no `key::` in front.
  if (keyText(signingkey)) return { key: keyText(signingkey) };
  // A relative path is read from the repo's folder, as git reads it there.
  const file = path.resolve(dir, signingkey.replace(/^~(?=$|[\\/])/, home));
  if (!fs.existsSync(file)) return { problem: `${file} does not exist` };
  const pub = file.endsWith('.pub') ? file : `${file}.pub`;
  for (const f of [pub, file]) {
    try {
      const text = keyText(fs.readFileSync(f, 'utf8'));
      if (text) return { key: text, file: f };
    } catch { /* not readable: the next one */ }
  }
  return { problem: `no public key beside ${file} (make one: ssh-keygen -y -f ${file} > ${file}.pub)` };
}
// `<type> <base64>` from a public key line, or '' when the text is not one.
const keyText = (s) => {
  const m = String(s || '').trim().match(/^((?:ssh|ecdsa|sk)-[\w@.-]+)\s+([A-Za-z0-9+/=]+)/);
  return m ? `${m[1]} ${m[2]}` : '';
};

// The key ids (16 hex) and fingerprints in `gpg --with-colons` output: the key and its subkeys. With
// `signing`, only a key or subkey that can sign now: not expired, revoked, disabled or invalid (field 2: e,
// r, d, i; a disabled key is also `D` in field 12, printed on the primary only), with the sign capability
// (field 12: `s`, lower case: this key's own, not the whole key's), and its secret here (field 15 is `#` for
// a stub, whose secret is elsewhere; a card's serial number when the secret is on a smartcard). A primary that
// cannot be used makes its subkeys unusable too. With `live`, every key and subkey that is not expired,
// revoked, disabled or invalid (a platform's copy of a key, which signs nothing here). `keys` counts the
// primary keys (`sec`/`pub`) with a part that can sign now; `listed` counts every one.
// `parts` holds each part taken, as a Set of its id and fingerprint, with `sub` (a subkey), `created`
// (field 6), `primary` (which key it belongs to, counted in listing order) and `card` (a signing part whose
// secret is on a smartcard): gpg signs with ONE of them.
export function gpgIds(colons, { signing = false, live = false } = {}) {
  const ids = new Set();
  const parts = [];
  const signers = new Set();
  let listed = 0;
  let primary = null;
  let primaryDead = false;
  let take = false;
  for (const line of String(colons || '').split('\n')) {
    const f = line.split(':');
    if (['sec', 'ssb', 'pub', 'sub'].includes(f[0])) {
      // gpg prints `D` on the primary only; reading it on every line costs nothing.
      const dead = ['e', 'r', 'd', 'i'].includes(f[1]) || (f[11] || '').includes('D');
      if (f[0] === 'sec' || f[0] === 'pub') { primary = ++listed; primaryDead = dead; }
      // A subkey before any primary belongs to no key: skipped.
      const signs = primary !== null && !dead && !primaryDead && (f[11] || '').includes('s') && f[14] !== '#';
      if (signs) signers.add(primary);
      take = primary !== null && (signing ? signs : !live || (!dead && !primaryDead));
      if (take) parts.push(Object.assign(new Set(), { sub: f[0] === 'ssb' || f[0] === 'sub', created: Number(f[5]) || 0, primary, card: signs && !!f[14] && f[14] !== '+' }));
      // (Field 6 is seconds today; GnuPG may switch it to an ISO date, read as 0: then the first subkey wins.)
      if (take && /^[0-9A-F]{16}$/i.test(f[4] || '')) { ids.add(f[4].toUpperCase()); parts.at(-1).add(f[4].toUpperCase()); }
    } else if (f[0] === 'fpr' && take && /^[0-9A-F]{40}$/i.test(f[9] || '')) { ids.add(f[9].toUpperCase()); parts.at(-1).add(f[9].toUpperCase()); }
  }
  return Object.assign(ids, { keys: signers.size, listed, parts: parts.filter((x) => x.size) });
}
// A long key id matches its fingerprint's last 16 digits.
const sameKey = (a, b) => a === b || (a.length === 40 && a.endsWith(b)) || (b.length === 40 && b.endsWith(a));

// git's version as [major, minor], or null.
const gitVersion = (gitRun) => {
  const m = (gitRun('git', ['--version']).stdout || '').match(/(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const atLeast = (v, min) => !!v && (v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]));

// The check. `dir` is the folder whose git config counts; `root` the Product, when there is one (its platform
// and host). `runner` answers the platform CLIs (gh, glab); `gitRun` answers git, gpg and ssh-keygen; `haveTool`
// says whether a program is on PATH. All three are injectable for tests.
export function signingCheck(dir, { root = null, runner = run, gitRun = run, haveTool = has, env = process.env, home = os.homedir() } = {}) {
  const findings = [];
  const notes = [];
  const add = (id, status, message, fix = null) => findings.push({ id, status, message, ...(fix ? { fix: { actor: 'person', ...fix } } : {}) });
  const cfg = (key, bool = false) => {
    const r = gitRun('git', ['config', ...(bool ? ['--bool'] : []), '--get', key], { cwd: dir, env });
    return r.ok ? r.stdout : '';
  };
  const email = cfg('user.email');
  const signingkey = cfg('user.signingkey');
  const format = cfg('gpg.format') || 'openpgp';
  const method = format === 'ssh' ? 'ssh' : format === 'openpgp' ? 'gpg' : format;
  const sshSteps = [
    'Make a key (once): ssh-keygen -t ed25519 -C "<your email>" (press Enter for the default file).',
    'Tell git to sign with it: git config --global gpg.format ssh, then git config --global user.signingkey ~/.ssh/id_ed25519.pub',
    'Turn signing on: git config --global commit.gpgsign true',
    'Add the .pub file to your account as a SIGNING key (the platform\'s settings page, below), then run `yad signing check` again.',
  ];

  // --- this machine ---
  if (cfg('commit.gpgsign', true) === 'true') add('gpgsign', 'ok', 'signing is on (commit.gpgsign)');
  else add('gpgsign', 'gap', 'commits are not signed: commit.gpgsign is not true', { commands: ['git config --global commit.gpgsign true'], steps: ['If you have no signing key yet, make one first (SSH is the simplest):', ...sshSteps] });
  if (method === 'x509') add('format', 'unknown', 'gpg.format is x509: yad does not check X.509 certificates — the platform\'s documentation says whether it verifies yours');
  else if (method !== 'ssh' && method !== 'gpg') add('format', 'gap', `gpg.format is "${forTerminal(format)}", which git does not know`, { commands: ['git config --global gpg.format ssh'] });
  else add('format', 'ok', `signing with ${method === 'ssh' ? 'an SSH key' : 'a GPG key'}${format === 'openpgp' && !cfg('gpg.format') ? ' (git\'s default)' : ''}`);
  if (email) add('email', 'ok', `commits are made as ${forTerminal(email)}`);
  else add('email', 'gap', 'user.email is not set, so the platform cannot tie a commit to your account', { commands: ['git config --global user.email "<an email verified on your account>"'] });

  let localKey = null; // what to look for on the platform: { ssh } or { gpg: Set }
  if (method === 'ssh') {
    const v = gitVersion(gitRun);
    if (atLeast(v, SSH_MIN_GIT)) add('git-version', 'ok', `git ${v.join('.')} can sign with SSH`);
    else add('git-version', 'gap', `git ${v ? v.join('.') : '(unknown version)'} cannot sign with an SSH key: it needs 2.34 or later`, { steps: ['Install a newer git (https://git-scm.com/downloads), then run `yad signing check` again.'] });
    const pub = sshPublicKey(signingkey, { home, dir });
    const keyCommand = !signingkey && cfg('gpg.ssh.defaultKeyCommand');
    if (keyCommand) add('key', 'unknown', `git asks gpg.ssh.defaultKeyCommand (${forTerminal(keyCommand)}) for the key each time: yad cannot tell which key it is`);
    else if (!haveTool('ssh-keygen')) add('key', 'gap', 'ssh-keygen is not on PATH: git signs SSH commits with it', { steps: ['Install OpenSSH (it comes with git on Windows, and with macOS and Linux).'] });
    else if (pub.problem) add('key', 'gap', `the SSH signing key: ${forTerminal(pub.problem)}`, { steps: sshSteps });
    else { add('key', 'ok', `the SSH signing key is ${forTerminal(pub.file || 'given in user.signingkey')}`); localKey = { ssh: pub.key }; }
    if (cfg('gpg.ssh.allowedSignersFile')) add('allowed-signers', 'ok', 'gpg.ssh.allowedSignersFile is set, so git can check signatures here too');
    else {
      add('allowed-signers', 'suggest', 'gpg.ssh.allowedSignersFile is not set: the platform still verifies your commits, but `git log --show-signature` (and yad\'s local check) here cannot', {
        commands: ['echo "$(git config user.email) $(cat ~/.ssh/id_ed25519.pub)" >> ~/.ssh/allowed_signers', 'git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers'],
      });
    }
  } else if (method === 'gpg') {
    const gpgSteps = [
      'Make a key (once): gpg --full-generate-key (an RSA 4096 or ed25519 key, with your account\'s email).',
      'Find its id: gpg --list-secret-keys --keyid-format=long (the part after the slash on the "sec" line).',
      'Tell git: git config --global user.signingkey <that id>, then git config --global commit.gpgsign true',
      'Add it to your account: gpg --armor --export <that id>, pasted as a GPG key on the platform\'s settings page (below).',
    ];
    // By email, gpg matches any user id that CONTAINS it: `<email>` asks for that address exactly.
    const target = signingkey || (email ? `<${email}>` : '');
    if (!haveTool('gpg')) add('key', 'gap', 'gpg is not on PATH: git signs with it (or switch to an SSH key, which needs no extra program)', { steps: ['Install GnuPG (https://gnupg.org/download/), or use an SSH key:', ...sshSteps] });
    else if (!target) add('key', 'gap', 'no key is named (user.signingkey is not set) and there is no email to find one by', { steps: gpgSteps });
    else {
      const r = gitRun('gpg', ['--with-colons', '--list-secret-keys', target], { env });
      const ids = r.ok ? gpgIds(r.stdout, { signing: true }) : Object.assign(new Set(), { keys: 0, listed: 0, parts: [] });
      const { keys, listed } = ids;
      // The part gpg signs with (GnuPG's finish_lookup): the one a key id ending in `!` names, and no other;
      // else the newest signing subkey (the first listed, on a tie); the primary only when no subkey signs.
      const bang = String(signingkey || '').endsWith('!');
      const pinned = /^(?:0x)?([0-9A-F]{8}|[0-9A-F]{16}|[0-9A-F]{40})!$/i.exec(signingkey || '');
      const all = ids.parts || [];
      const subs = all.filter((part) => part.sub);
      const newest = Math.max(0, ...subs.map((part) => part.created));
      const pin = pinned?.[1].toUpperCase();
      // A short id is the end of the long id and of the fingerprint; a fingerprint ends with the long id (gpg
      // listed by that fingerprint, so a part with the same long id but another fingerprint is not here).
      const parts = pinned ? all.filter((part) => [...part].some((id) => id.endsWith(pin) || (pin.length === 40 && pin.endsWith(id))))
        : subs.length ? [subs.find((part) => part.created === newest)] : all;
      if (bang && !pinned && ids.size) add('key', 'unknown', `user.signingkey (${forTerminal(signingkey)}) ends in "!" but is not a key id, so yad cannot tell which part gpg signs with`);
      else if (pinned && !parts.length && !listed) add('key', 'gap', `gpg has no secret key for ${forTerminal(target)}`, { steps: gpgSteps });
      else if (pinned && !parts.length) add('key', 'gap', `the part user.signingkey names (${forTerminal(signingkey)}) cannot sign now (expired, revoked, without the sign capability, or its secret is not on this machine): gpg signs with that part only`, { steps: ['List the parts: gpg --list-secret-keys --keyid-format=long (the "ssb" lines with [S] are subkeys that sign)', 'Name one that signs: git config --global user.signingkey <its id>! (or drop the "!" to let gpg pick)'] });
      // A pin to one part settles which key, even when the email finds several.
      else if (keys > 1 && !(pinned && parts.length === 1)) add('key', 'gap', `gpg has ${keys} secret keys for ${forTerminal(target)}: git may sign with any of them`, { commands: ['git config --global user.signingkey <the key id to sign with>'], steps: ['List them: gpg --list-secret-keys --keyid-format=long'] });
      else if (ids.size) {
        add('key', 'ok', parts.some((part) => part.card) ? `the GPG key ${forTerminal(target)} can sign; the part gpg signs with is on a smartcard, so the card must be inserted` : `the GPG key ${forTerminal(target)} is on this machine and can sign`);
        // Every id of the key gpg signs with (dead parts too), for the "not the part" message: never another
        // key that only shares the email.
        const owners = new Set(parts.map((part) => part.primary));
        localKey = { gpg: parts, all: new Set(gpgIds(r.stdout).parts.filter((part) => owners.has(part.primary)).flatMap((part) => [...part])) };
      }
      else if (listed) add('key', 'gap', `the GPG key ${forTerminal(target)} cannot sign now (expired, revoked, without the sign capability, or its secret is not on this machine)`, { steps: gpgSteps });
      else add('key', 'gap', `gpg has no secret key for ${forTerminal(target)}`, { steps: gpgSteps });
    }
  }

  // --- the platform ---
  const identity = root ? productIdentity(root) : null;
  if (!identity?.platform) {
    notes.push(root ? 'the Product names no platform: nothing on an account to check' : 'no Product here: only this machine is checked (run it from the Product, or a repo it registers, to check the account too)');
  } else {
    platformRows({ identity, method, localKey, email, runner, gitRun, haveTool, env, add });
  }

  const count = (s) => findings.filter((f) => f.status === s).length;
  // Complete only when the account was read too: with no platform, half the question is open.
  const summary = { gaps: count('gap'), suggestions: count('suggest'), unknown: count('unknown'), complete: count('unknown') === 0 && !!identity?.platform, accountChecked: !!identity?.platform };
  return { method, platform: identity?.platform ?? null, host: identity?.host ?? null, findings, summary, ...(notes.length ? { notes } : {}) };
}

// The account's half: the key listed for SIGNING, and the commit email verified on it.
function platformRows({ identity, method, localKey, email, runner, gitRun, haveTool, env, add }) {
  const { platform, host } = identity;
  const name = PLATFORM_NAME[platform];
  const cli = platform === 'github' ? 'gh' : 'glab';
  const unknownBoth = (why, fix) => { add('platform-key', 'unknown', `${name}: ${why}`, fix); add('platform-email', 'unknown', `${name}: ${why}`, fix); };
  if (env.YAD_PLATFORM_READ === '0') return unknownBoth('platform reads are off (YAD_PLATFORM_READ=0)');
  if (!haveTool(cli)) return unknownBoth(`${cli} is not installed, so your account cannot be read`, { steps: [`Install ${cli}, log in, then run \`yad signing check\` again.`] });
  if (!loggedIn(runner, cli, host, new Map())) {
    return unknownBoth(`not logged in to ${host}, so your account cannot be read`, { commands: [platform === 'github' ? `gh auth login --hostname ${host}` : `glab auth login --hostname ${host}`] });
  }
  const read = (p) => api(runner, cli, host, p);
  const scopeFix = (scope) => (platform === 'github'
    ? { commands: [`gh auth refresh -h ${host} -s ${scope}`] }
    : { steps: ['Log glab in with a token that has the read_user scope: glab auth login --hostname ' + host] });
  const refused = (res) => res.status === 403 || res.status === 404 || res.status === 401;
  // A refusal of the user's own list means the login lacks the scope (GitHub answers 404 for that); anything
  // else (offline, an unreadable answer) is said as protection.mjs says it.
  const notRead = (res, what, scope) => (refused(res)
    ? `${name} would not list ${what} (HTTP ${res.status}): ${platform === 'github' ? `the login needs the ${scope} scope` : 'the token needs the read_user scope'}`
    : whyFailed(res, { platform, host, what, plural: true }));
  const keysPage = platform === 'github' ? `https://${host}/settings/keys` : `https://${host}/-/user_settings/${method === 'gpg' ? 'gpg_keys' : 'ssh_keys'}`;

  // The key.
  if (!localKey) add('platform-key', 'unknown', `${name}: the key on this machine could not be read, so it cannot be matched (fix the key above first)`);
  else if (method === 'ssh') {
    const path_ = platform === 'github' ? `user/ssh_signing_keys?per_page=${PAGE}` : `user/keys?per_page=${PAGE}`;
    const res = read(path_);
    if (!res.ok) add('platform-key', 'unknown', notRead(res, 'your SSH keys', 'read:ssh_signing_key'), refused(res) ? scopeFix('read:ssh_signing_key') : null);
    else {
      const list = Array.isArray(res.body) ? res.body : [];
      const hit = list.find((k) => keyText(k?.key) === localKey.ssh);
      const signing = platform === 'github' ? !!hit : !!hit && ['signing', 'auth_and_signing'].includes(hit.usage_type);
      if (signing) add('platform-key', 'ok', `${name} lists your SSH key for signing`);
      else if (!hit && list.length >= PAGE) add('platform-key', 'unknown', `${name}: your account has ${PAGE} or more keys and only the first ${PAGE} were read`);
      else {
        // GitHub keeps signing keys apart from authentication keys: say which it is, when the token can tell.
        let only = !!hit;
        if (platform === 'github') { const auth = read(`user/keys?per_page=${PAGE}`); only = auth.ok && Array.isArray(auth.body) && auth.body.some((k) => keyText(k?.key) === localKey.ssh); }
        add('platform-key', 'gap', only ? `${name} has your SSH key for logging in only, not for signing` : `${name} does not list your SSH key for signing`, {
          url: keysPage,
          steps: [platform === 'github' ? `Open ${keysPage} → New SSH key → Key type: Signing Key → paste your .pub file.` : `Open ${keysPage} → add (or edit) the key → Usage type: Authentication & Signing (or Signing) → paste your .pub file.`, 'Then run `yad signing check` again.'],
        });
      }
    }
  } else if (method === 'gpg') {
    const res = read(`user/gpg_keys?per_page=${PAGE}`);
    if (!res.ok) add('platform-key', 'unknown', notRead(res, 'your GPG keys', 'read:gpg_key'), refused(res) ? scopeFix('read:gpg_key') : null);
    else {
      const list = Array.isArray(res.body) ? res.body : [];
      // Every id the account lists, and those of copies still in force: an expired or revoked copy there
      // marks new commits Unverified even when the key here was renewed.
      let remote = new Set();
      let live = new Set();
      const unclear = new Set(); // an expiry date yad cannot read: neither in force nor out
      let readable = true;
      const now = Date.now();
      // 'live', 'dead', or 'unclear' for one GitHub key or subkey.
      const state = (k) => {
        if (k?.revoked === true) return 'dead';
        if (!k?.expires_at) return 'live';
        const t = Date.parse(k.expires_at);
        return Number.isNaN(t) ? 'unclear' : t <= now ? 'dead' : 'live';
      };
      if (platform === 'github') {
        for (const k of list) {
          const top = state(k);
          for (const sub of [k, ...(Array.isArray(k?.subkeys) ? k.subkeys : [])]) {
            if (typeof sub?.key_id !== 'string') continue;
            const id = sub.key_id.toUpperCase();
            const own = sub === k ? top : state(sub);
            remote.add(id);
            if (top === 'dead' || own === 'dead') continue;
            if (top === 'unclear' || own === 'unclear') unclear.add(id);
            else live.add(id);
          }
        }
      } else if (haveTool('gpg')) {
        // GitLab lists the armored key only: gpg reads its ids without importing it.
        for (const k of list) {
          if (typeof k?.key !== 'string') continue;
          const out = gitRun('gpg', ['--with-colons', '--import-options', 'show-only', '--import'], { input: k.key, env }).stdout;
          remote = new Set([...remote, ...gpgIds(out)]);
          live = new Set([...live, ...gpgIds(out, { live: true })]);
        }
      } else readable = false;
      // The part gpg signs with (see the key row) must be listed and in force, or commits show as Unverified.
      const has = (set) => (part) => [...part].some((a) => [...set].some((b) => sameKey(a, b)));
      const parts = localKey.gpg;
      const reupload = { url: keysPage, steps: ['Export it again: gpg --armor --export <your key id>', `Open ${keysPage} → remove the old copy → New GPG key → paste it.`, 'Then run `yad signing check` again.'] };
      if (parts.length && parts.every(has(live))) add('platform-key', 'ok', `${name} lists your GPG key`);
      else if (parts.some((p) => has(remote)(p) && !has(live)(p) && !has(unclear)(p))) add('platform-key', 'gap', `${name} lists your GPG key, but its copy there has expired, was revoked or is not valid: new commits show as Unverified`, reupload);
      else if (parts.some(has(unclear))) add('platform-key', 'unknown', `${name} lists your GPG key with an expiry date yad cannot read`);
      else if (has(remote)(localKey.all)) add('platform-key', 'gap', `${name} lists your GPG key, but not the part gpg signs with (a subkey added after the upload?)`, reupload);
      else if (!readable) add('platform-key', 'unknown', `${name} lists GPG keys yad cannot read without gpg`);
      else if (list.length >= PAGE) add('platform-key', 'unknown', `${name}: your account has ${PAGE} or more GPG keys and only the first ${PAGE} were read`);
      else add('platform-key', 'gap', `${name} does not list your GPG key`, { url: keysPage, steps: [`Export it: gpg --armor --export <your key id>`, `Open ${keysPage} → New GPG key → paste it.`, 'Then run `yad signing check` again.'] });
    }
  }

  // The email.
  if (!email) add('platform-email', 'unknown', `${name}: no commit email to look for (set user.email above)`);
  else if (platform === 'github') {
    const noreply = `users.noreply.${host === 'github.com' ? 'github.com' : host}`;
    if (email.toLowerCase().endsWith(`@${noreply}`)) {
      // A no-reply address is verified for the ONE account it names: `<id>+<login>@` or `<login>@`.
      const u = read('user');
      if (!u.ok) add('platform-email', 'unknown', notRead(u, 'your account', 'read:user'), refused(u) ? scopeFix('read:user') : null);
      else if (!u.body?.login) add('platform-email', 'unknown', `${name} did not say which account this login is, so the no-reply address cannot be matched`);
      else {
        const local = email.slice(0, email.lastIndexOf('@')).toLowerCase();
        const login = String(u.body.login).toLowerCase();
        const { id } = u.body;
        if (local === login || (id != null && local === `${id}+${login}`)) add('platform-email', 'ok', `${forTerminal(email)} is your ${name} no-reply address`);
        // `<id>+<login>@` with no id in the answer: it may be this account's.
        else if (id == null && local.endsWith(`+${login}`)) add('platform-email', 'unknown', `${name} did not give this account's id, so ${forTerminal(email)} cannot be matched`);
        else add('platform-email', 'gap', `${forTerminal(email)} is a ${name} no-reply address, but not this account's (${forTerminal(u.body.login)})`, { url: `https://${host}/settings/emails`, steps: [`Use your own: git config --global user.email "${id != null ? `${id}+` : ''}${u.body.login}@${noreply}"`] });
      }
    } else {
      const res = read(`user/emails?per_page=${PAGE}`);
      if (!res.ok) add('platform-email', 'unknown', notRead(res, 'your email addresses', 'user:email'), refused(res) ? scopeFix('user:email') : null);
      else {
        const list = Array.isArray(res.body) ? res.body : [];
        emailRow(add, name, email, list.filter((e) => e?.verified).map((e) => e.email), list.map((e) => e?.email), list.length >= PAGE, `https://${host}/settings/emails`);
      }
    }
  } else {
    const u = read('user');
    const e = read(`user/emails?per_page=${PAGE}`);
    if (!u.ok) add('platform-email', 'unknown', notRead(u, 'your account', 'read_user'), refused(u) ? scopeFix('read_user') : null);
    else {
      const others = e.ok && Array.isArray(e.body) ? e.body : [];
      const confirmed = [u.body?.email, u.body?.commit_email, ...others.filter((x) => x?.confirmed_at).map((x) => x.email)];
      const all = [...confirmed, ...others.map((x) => x?.email)];
      if (!e.ok && !confirmed.some((x) => sameEmail(x, email))) add('platform-email', 'unknown', `${name}: your other email addresses could not be read — the token needs the read_user scope`, scopeFix('read_user'));
      else emailRow(add, name, email, confirmed, all, others.length >= PAGE, `https://${host}/-/profile/emails`);
    }
  }
}
const sameEmail = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function emailRow(add, name, email, verified, all, full, url) {
  if (verified.some((x) => sameEmail(x, email))) return add('platform-email', 'ok', `${forTerminal(email)} is verified on your ${name} account`);
  if (all.some((x) => sameEmail(x, email))) return add('platform-email', 'gap', `${forTerminal(email)} is on your ${name} account but not verified, so your commits are not marked Verified`, { url, steps: [`Open ${url} and verify it (the platform emails you a link).`] });
  if (full) return add('platform-email', 'unknown', `${name}: only the first page of your email addresses was read`);
  return add('platform-email', 'gap', `${forTerminal(email)} is not on your ${name} account, so your commits are not marked Verified`, { url, steps: [`Add it at ${url} and verify it, or set user.email to an address that is: git config --global user.email "<that address>"`] });
}

// The doctor line: this machine only (no network), so `yad doctor` stays quick.
export function signingDoctorLine(dir, { gitRun = run } = {}) {
  const cfg = (key, bool = false) => { const r = gitRun('git', ['config', ...(bool ? ['--bool'] : []), '--get', key], { cwd: dir }); return r.ok ? r.stdout : ''; };
  const hint = '`yad signing check` says what to set up';
  if (cfg('commit.gpgsign', true) !== 'true') return { status: 'warn', message: 'commits made here are not signed', hint };
  const format = cfg('gpg.format') || 'openpgp';
  const method = { ssh: 'SSH', openpgp: 'GPG', x509: 'X.509' }[format];
  if (!method) return { status: 'warn', message: `gpg.format is "${forTerminal(format)}", which git does not know`, hint };
  if (method === 'SSH' && !cfg('user.signingkey') && !cfg('gpg.ssh.defaultKeyCommand')) return { status: 'warn', message: 'commits made here are set to be signed with SSH, but no key is named', hint };
  return { status: 'ok', message: `commits made here are signed (${method})`, hint: '`yad signing check` also confirms your account lists the key' };
}

// `yad signing check [--json]`.
export function runSigningCheck(dir, { root = null, json = false } = {}) {
  const r = signingCheck(dir, { root });
  if (!json) {
    log(c.bold('\nyad signing check'));
    const mark = { ok: ok, gap: fail, suggest: warn, unknown: info };
    for (const f of r.findings) {
      mark[f.status](`${f.status === 'unknown' ? 'not known — ' : ''}${f.message}`);
      for (const cmd of f.fix?.commands || []) hand(cmd);
      for (const s of f.fix?.steps || []) log(c.dim(`    ${s}`));
    }
    for (const n of r.notes || []) info(n);
    const { gaps, unknown } = r.summary;
    log('');
    if (gaps) log(c.bold(`${gaps} thing(s) to set up: these are yours (a key is a secret, and the account is yours) — then run \`yad signing check\` again.`));
    else if (unknown) log(c.bold(`${unknown} item(s) not read — not cleared.`));
    else if (!r.summary.accountChecked) ok('this machine is set to sign your commits — your account was not checked (see the note above)');
    else ok('your commits will be signed, and your account can verify them');
  }
  if (r.summary.gaps) process.exitCode = 1;
  return r;
}
