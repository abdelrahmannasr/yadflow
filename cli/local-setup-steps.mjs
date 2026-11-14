// E185 — the steps yadflow itself puts in a Product's local setup script (`.sdlc/local-setup.json`).
//
// The script is what a team member's agent follows on that person's own machine: after setup or join, and again
// after every update. Each step says what to run, why (`purpose`), and what it changes for the person (`impact`),
// so the person decides each one. This module builds yadflow's part, `yadflow[]`; the team's part, `team[]`, is
// written by `yad local-setup add` and never touched here.
//
// THE SAME ON EVERY MACHINE. The file is committed, so every step is built from what the Product records (its
// platform, its ledger, the team's toolbox choices) and from this release, never from what one machine has or
// lacks. Whether a step is already done on a machine is its `check`, run on that machine.
//
// CHECKS yad RUNS. A yadflow step's check is one of BUILTIN_CHECKS, worked out inside yad without running any
// program the file names. A team step's check is a shell command from a committed file: yad shows it and never
// runs it, so nobody who can merge to the Product can run a command on every member's machine.

import crypto from 'node:crypto';
import path from 'node:path';
import { readJSON, run, has } from './lib.mjs';
import { VERSION, isVerifiedLedger, productConfigPath } from './manifest.mjs';
import { cliFor, hostFromGitUrl, plainHost } from './platform.mjs';
import { TOOLBOX, compare, parseVersion, loadChoices, toolUse, toolStatus } from './toolbox.mjs';
import { detectInstalled } from './detect.mjs';
import { gitHookState } from './plan.mjs';
import { signingDoctorLine } from './signing.mjs';

// Bumped when the shipped steps change in a way a reader of the file should know about.
export const LOCAL_SETUP_CATALOGUE_VERSION = 1;
// The file's own format.
export const LOCAL_SETUP_VERSION = 1;
export const LOCAL_SETUP_FILE = '.sdlc/local-setup.json';
export const LOCAL_SETUP_DOC = 'LOCAL-SETUP.md';
export const STEP_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const WHEN = Object.freeze(['required', 'optional']);
export const BUILTIN_CHECKS = Object.freeze(['cli-version', 'platform-login', 'ledger-hook', 'commit-signing', 'tool']);

// One-off machine steps a release needs (a new hook to install, a tool to upgrade). `since` is the release that
// added the step. Add an entry here, in the step shape below, whenever a release asks something of each machine
// that the derived steps do not already cover.
export const RELEASE_STEPS = Object.freeze([]);

// The content hash: what the step RUNS and how it is checked — never its wording. A machine that did a step is
// asked again only when this changes, so fixing a typo in a purpose does not re-ask the whole team.
export function stepHash(step) {
  const body = JSON.stringify({ commands: step.commands ?? [], check: step.check ?? null, when: step.when ?? 'optional' });
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
}

const step = (s) => ({ source: 'yadflow', vetted: true, verify: null, since: null, ...s });

// The CLI version the script asks for: this release, or the one the file already asks for when that is newer. An
// older yad rewriting the file (any member's `yad check --fix`) must never lower it, or the members who are behind
// would stop being told to upgrade.
export function cliMinimum(current) {
  const have = parseVersion(VERSION);
  const was = typeof current === 'string' ? parseVersion(current) : null;
  return was && have && compare(was, have) > 0 ? current : VERSION;
}

// yadflow's steps for this Product, in the order a person would do them. `cliMin` is the version the CLI step asks
// for (cliMinimum).
export function yadflowSteps(root, { cliMin = VERSION } = {}) {
  const config = readJSON(productConfigPath(root), {}) || {};
  const steps = [];

  steps.push(step({
    id: 'yadflow-cli', title: `Install the yadflow CLI, version ${cliMin} or later`, when: 'required',
    purpose: 'yad is the command every step of this project runs. The project was last set up or updated with this version, and an older yad on your machine can misread its files.',
    impact: 'Replaces the yad command on your machine for every project that uses it. Nothing in any repo changes.',
    commands: [`npm install -g yadflow@${cliMin}`],
    check: { builtin: 'cli-version', min: cliMin },
    verify: 'yad --version',
  }));

  const cli = typeof config.platform === 'string' ? cliFor(config.platform) : null;
  if (cli) {
    steps.push(step({
      id: 'platform-login', title: `Sign in to ${config.platform === 'gitlab' ? 'GitLab' : 'GitHub'} with ${cli}`, when: 'required',
      purpose: `yad opens pull requests, reads reviews and approvals through ${cli}. Without a login those steps stop.`,
      impact: `Stores a login for ${cli} on your machine. It is yours alone: you type it, never the agent.`,
      commands: [`${cli} auth login`],
      check: { builtin: 'platform-login' },
      verify: `${cli} auth status`,
      person: true,
    }));
  }

  if (isVerifiedLedger(config)) {
    steps.push(step({
      id: 'ledger-hook', title: 'Install the pre-commit ledger guard in your clone', when: 'required',
      purpose: 'With a verified ledger, approvals and gate files are written by CI only. The hook stops a commit that edits them by hand, before CI refuses it.',
      impact: 'Adds a git hook to your clone of the Product. It runs on each commit there and only refuses ledger edits. Other repos are not touched.',
      commands: ['yad check --fix'],
      check: { builtin: 'ledger-hook' },
      verify: 'yad doctor',
    }));
    steps.push(step({
      id: 'commit-signing', title: 'Sign your commits', when: 'required',
      purpose: 'The verified-commits check refuses commits that are not signed by a known person.',
      impact: 'Changes your git settings so every commit you make is signed. A signing key is a secret: you make it and add it to your account yourself.',
      commands: ['yad signing check'],
      check: { builtin: 'commit-signing' },
      verify: 'yad signing check',
      person: true,
    }));
  }

  // The tools this team uses (the toolbox choices, E86). None is required: each says what happens without it.
  const choices = loadChoices(root);
  for (const tool of [...TOOLBOX, ...choices.custom]) {
    if (!toolUse(tool, choices).used) continue;
    const own = tool.tier === 'project';
    // A shipped tool has a recipe (E165): `yad toolbox connect` gives the agent its exact, pinned steps and the
    // one question to ask. A team's own tool has no recipe: its install commands are the team's.
    const commands = own ? (tool.install ?? []).map((i) => i.command) : [`yad toolbox connect ${tool.id} --json`];
    steps.push(step({
      id: `tool-${tool.id}`, title: `Install ${tool.name}`, when: 'optional',
      purpose: `Your team uses ${tool.name}: it ${tool.role}.`,
      impact: `Without it: ${tool.fallback}.`,
      commands: commands.length ? commands : [tool.manual ? `set it up by hand: ${tool.manual}` : `see ${tool.source ?? 'its own instructions'}`],
      check: { builtin: 'tool', tool: tool.id },
      verify: 'yad toolbox check',
      // A team's own tool is the team's to vet (E88), even though yad builds the step from it.
      vetted: !own,
    }));
  }

  for (const s of RELEASE_STEPS) steps.push(step(s));
  return steps;
}

// ---- the built-in checks --------------------------------------------------------------------------
// Each answers `{ ok, why }` for this machine. They run no program a file names: only git, the platform CLI's
// own `auth status`, and yad's own detection.

export function runBuiltinCheck(check, root, { items = null } = {}) {
  const kind = check?.builtin;
  if (kind === 'cli-version') {
    const have = parseVersion(VERSION);
    const need = parseVersion(check.min);
    const ok = !!(have && need) && compare(have, need) >= 0;
    return { ok, why: ok ? `yad ${VERSION} is installed` : `yad ${VERSION} is older than ${check.min}` };
  }
  if (kind === 'platform-login') {
    const config = readJSON(productConfigPath(root), {}) || {};
    const cli = cliFor(config.platform);
    if (!cli) return { ok: true, why: 'this Product uses no platform' };
    if (!has(cli)) return { ok: false, why: `${cli} is not installed` };
    const host = plainHost(hostFromGitUrl(config.git_url) || hostFromGitUrl(run('git', ['remote', 'get-url', 'origin'], { cwd: root }).stdout));
    // Scoped to the Product's host: an unscoped `auth status` fails when ANY saved login is stale (doctor.mjs).
    if (!host) return { ok: false, why: 'the Product\'s host is not known, so the login was not checked' };
    const ok = run(cli, ['auth', 'status', '--hostname', host]).ok;
    return { ok, why: ok ? `${cli} is signed in to ${host}` : `${cli} is not signed in to ${host}` };
  }
  if (kind === 'ledger-hook') {
    const st = gitHookState(root);
    if (!st.applies) return { ok: true, why: 'this Product does not use the hook' };
    return { ok: st.state === 'ok', why: st.state === 'ok' ? 'the hook is installed' : `the hook is ${st.state}` };
  }
  if (kind === 'commit-signing') {
    const line = signingDoctorLine(root);
    return { ok: line.status === 'ok', why: line.message };
  }
  if (kind === 'tool') {
    const choices = loadChoices(root);
    const tool = [...TOOLBOX, ...choices.custom].find((t) => t.id === check.tool);
    if (!tool) return { ok: false, why: `${check.tool} is not a tool this yadflow knows` };
    const st = toolStatus(tool, items ?? detectInstalled(root).items);
    const ok = st.state === 'installed' || st.state === 'available';
    return { ok, why: ok ? `${tool.name} is here (${st.found.join(', ')})` : `${tool.name} is ${st.state}` };
  }
  return { ok: false, why: 'not a check yad knows' };
}

export const localSetupPath = (root) => path.join(root, LOCAL_SETUP_FILE);
