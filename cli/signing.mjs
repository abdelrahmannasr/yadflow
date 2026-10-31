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
// `signing`, only a key or subkey that can sign now: not expired, revoked or disabled (field 2: e, r, d, i),
// with the sign capability (field 12: `s`). `keys` counts the primary keys (`sec`/`pub`) listed.
export function gpgIds(colons, { signing = false } = {}) {
  const ids = new Set();
  let keys = 0;
  let take = false;
  for (const line of String(colons || '').split('\n')) {
    const f = line.split(':');
    if (['sec', 'ssb', 'pub', 'sub'].includes(f[0])) {
      if (f[0] === 'sec' || f[0] === 'pub') keys++;
      take = !signing || (!['e', 'r', 'd', 'i'].includes(f[1]) && (f[11] || '').includes('s'));
      if (take && /^[0-9A-F]{16}$/i.test(f[4] || '')) ids.add(f[4].toUpperCase());
    } else if (f[0] === 'fpr' && take && /^[0-9A-F]{40}$/i.test(f[9] || '')) ids.add(f[9].toUpperCase());
  }
  return Object.assign(ids, { keys });
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
      const ids = r.ok ? gpgIds(r.stdout, { signing: true }) : new Set();
      const keys = r.ok ? gpgIds(r.stdout).keys : 0;
      if (keys > 1) add('key', 'gap', `gpg has ${keys} secret keys for ${forTerminal(target)}: git may sign with any of them`, { commands: ['git config --global user.signingkey <the key id to sign with>'], steps: ['List them: gpg --list-secret-keys --keyid-format=long'] });
      else if (ids.size) { add('key', 'ok', `the GPG key ${forTerminal(target)} is on this machine and can sign`); localKey = { gpg: ids }; }
      else if (keys) add('key', 'gap', `the GPG key ${forTerminal(target)} cannot sign now (expired, revoked, or without the sign capability)`, { steps: gpgSteps });
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
      let remote = new Set();
      let readable = true;
      if (platform === 'github') {
        for (const k of list) for (const id of [k?.key_id, ...(k?.subkeys || []).map((s) => s?.key_id)]) if (typeof id === 'string') remote.add(id.toUpperCase());
      } else if (haveTool('gpg')) {
        // GitLab lists the armored key only: gpg reads its ids without importing it.
        for (const k of list) if (typeof k?.key === 'string') remote = new Set([...remote, ...gpgIds(gitRun('gpg', ['--with-colons', '--import-options', 'show-only', '--import'], { input: k.key, env }).stdout)]);
      } else readable = false;
      const hit = [...localKey.gpg].some((a) => [...remote].some((b) => sameKey(a, b)));
      if (hit) add('platform-key', 'ok', `${name} lists your GPG key`);
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
      else {
        const local = email.slice(0, email.lastIndexOf('@')).toLowerCase();
        const login = String(u.body?.login || '').toLowerCase();
        const mine = login && (local === login || local === `${u.body?.id}+${login}`);
        if (mine) add('platform-email', 'ok', `${forTerminal(email)} is your ${name} no-reply address`);
        else add('platform-email', 'gap', `${forTerminal(email)} is a ${name} no-reply address, but not this account's (${forTerminal(u.body?.login || '?')})`, { url: `https://${host}/settings/emails`, steps: [`Use your own: git config --global user.email "${u.body?.id ? `${u.body.id}+` : ''}${u.body?.login || '<login>'}@${noreply}"`] });
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
