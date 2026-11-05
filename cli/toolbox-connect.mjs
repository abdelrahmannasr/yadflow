// `yad toolbox connect <tool>` (E165): what the agent may run to put a toolbox tool on this machine, after
// one yes from the person, and the record of the team's choice once it is found.
//
// E85 made the toolbox print-only, and the install lines (`install` in cli/toolbox.mjs) stay text for people:
// some start an interactive installer, some are slash commands only a person types, one runs a remote
// script. So each tool also has a RECIPE here: the exact steps, each marked for the agent or the person.
// The agent runs only package-manager installs pinned to the vetted version (E88); everything else — a
// remote script, an interactive installer, a slash command, an app, a sign-in — is the person's, with why.
// The user's decisions (2026-11-05): one yes per tool covers installing it here AND recording the team's
// choice; nothing here ever installs on its own.
//
//   yad toolbox connect <tool> [--json]            read: the steps, the question to ask, what will be recorded
//   yad toolbox connect <tool> --verify [--json]   finds it here, then records the choice (or says what is missing)
import fs from 'node:fs';
import path from 'node:path';
import { emitJSON, hand, info, ok, readJSONStrict, refuse, warn } from './lib.mjs';
import { clean, detectInstalled } from './detect.mjs';
import { PROJECT_FILES } from './manifest.mjs';
import {
  TOOLBOX, connectorFile, loadChoices, onPath, readToolboxFile, recordToolUse, toolStatus, toolUse,
} from './toolbox.mjs';
import { registerDesign, registerLearning, registerTesting } from './setup.mjs';

// Each shipped tool's recipe. `null`: nothing to install here (the person's app, account or service — the
// tool's `manual` says how). Every agent step is pinned to the vetted version; `recipeProblems` checks it.
const A = (run) => ({ who: 'agent', run, scope: 'user' });
const P = (run, why) => ({ who: 'person', run, why });
// A person step that is a thing to do, not a command to type.
const PT = (run, why) => ({ who: 'person', run, why, text: true });
const INTERACTIVE = 'an interactive installer: it asks you questions, which an agent cannot answer';
const SCRIPT = 'a remote install script: no version pin covers what it runs, so you read and run it yourself';
export const RECIPES = Object.freeze({
  repomix: [A('npm install -g repomix@1.18.1')],
  'spec-kit': [
    A('uv tool install specify-cli==1.0.13'),
    P('specify init <project> --integration claude', 'it sets Spec Kit up inside one code repo, and asks you questions'),
  ],
  impeccable: [P('npx impeccable install', INTERACTIVE)],
  'bmad-method': [P('npx bmad-method install', INTERACTIVE)],
  ecc: [P('npx ecc-universal install --guided', INTERACTIVE)],
  'mattpocock-skills': [A('claude plugins install mattpocock-skills')],
  'docker-mcp': [PT('set up the MCP Toolkit in Docker Desktop: https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/', 'it is a feature of the Docker Desktop app')],
  figma: [
    A('claude plugin install figma@claude-plugins-official'),
    PT('sign in to Figma in your agent (its Figma MCP server)', 'a sign-in is yours: it is your Figma account'),
  ],
  pencil: [PT('install the Pencil desktop app, open a .pen file, then Settings → MCP → enable your agent: https://docs.pencil.dev/getting-started/installation', 'it is a desktop app, set up inside the app')],
  openpencil: [
    A('npm install -g @open-pencil/mcp@0.16.0 @open-pencil/cli@0.16.0'),
    A('claude mcp add --scope user open-pencil -- openpencil-mcp'),
  ],
  playwright: [A('claude mcp add playwright -- npx @playwright/mcp@0.0.83')],
  cypress: [PT('connect the Cypress Cloud MCP: https://docs.cypress.io/cloud/integrations/cloud-mcp', 'it reads your Cypress Cloud account')],
  pytest: [PT('connect a pytest MCP server you trust, under the name pytest: https://docs.pytest.org/', 'pytest has no official MCP server, and the community ones are not vetted, so the choice is yours')],
  maestro: [
    P('curl -fsSL "https://get.maestro.mobile.dev" | bash', SCRIPT),
    A('claude mcp add maestro -- maestro mcp'),
  ],
  deeptutor: [
    P('pip install deeptutor==1.6.12', 'where Python packages go (pip, pipx or a virtual environment) is your choice'),
    P('deeptutor init', INTERACTIVE),
  ],
});

// What an agent step may never hold: a version other than a pin, or a way to run what no pin covers.
const FORBIDDEN = [
  [/@latest\b/, '@latest'],
  [/\|\s*(ba|z)?sh\b/, 'a pipe into a shell'],
  [/\bcurl\b|\bwget\b/, 'a download'],
  [/\bgit clone\b/, 'a git clone'],
  [/^\//, 'a slash command'],
  [/&&|;/, 'two commands on one line'],
];

// Every way a tool's recipe breaks the rules, as sentences. [] means it is sound.
export function recipeProblems(tool, steps = Object.hasOwn(RECIPES, tool.id) ? RECIPES[tool.id] : undefined) {
  const out = [];
  if (steps === undefined) return [`${tool.id} has no recipe (null when there is nothing to install)`];
  if (steps === null) return out;
  if (!Array.isArray(steps) || !steps.length) return [`${tool.id}: a recipe is a list of steps, or null`];
  const agentRuns = steps.filter((s) => s.who === 'agent').map((s) => s.run).join('\n');
  for (const s of steps) {
    if (!['agent', 'person'].includes(s.who) || typeof s.run !== 'string' || !s.run) out.push(`${tool.id}: a step has who (agent or person) and run`);
    if (s.who === 'person' && !(typeof s.why === 'string' && s.why)) out.push(`${tool.id}: a person step says why it is the person's`);
    if (s.who === 'agent') for (const [re, what] of FORBIDDEN) if (re.test(s.run)) out.push(`${tool.id}: the agent step \`${s.run}\` holds ${what}`);
  }
  // A vetted package the agent installs is installed at its vetted version, and never another.
  for (const p of tool.vetted?.packages ?? []) {
    const names = new RegExp(`(^|[\\s/])${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[@=\\s]|$)`, 'm');
    if (!names.test(agentRuns)) continue;
    const pin = p.registry === 'pypi' ? `${p.name}==${p.version}` : `${p.name}@${p.version}`;
    if (!agentRuns.includes(pin)) out.push(`${tool.id}: the agent installs ${p.name}, but not at the vetted ${pin}`);
  }
  return out;
}

const tools = () => TOOLBOX;
const byId = (id) => tools().find((t) => t.id === id) ?? null;

// The files `--verify` writes for a tool: the team's choice, and a connector's own file.
function recordFiles(tool) {
  const file = tool.tier === 'connector' ? connectorFile(tool) : null;
  return [PROJECT_FILES.toolboxConfig, ...(file ? [file] : [])];
}

// The question the agent asks, word for word: every step it will run, where it installs, what it records.
function askText(tool, steps, record, found) {
  const files = record.join(' and ');
  if (!steps.length && found) return `${tool.name} is already on this machine. Record it as this team's choice in ${files}?`;
  if (!steps.length) return `${tool.name} has nothing yad can install: set it up as ${tool.manual ?? tool.source} says, then I will check that it is found and record it as this team's choice in ${files}.`;
  // In the recipe's order: a step of the person's that comes first (Maestro's installer) is said first.
  const parts = [];
  for (const s of steps) {
    const last = parts[parts.length - 1];
    if (last && last.who === s.who) last.runs.push(s.who === 'agent' ? s.run : s);
    else parts.push({ who: s.who, runs: [s.who === 'agent' ? s.run : s] });
  }
  const said = parts.map((p, i) => {
    const lead = i === 0 ? (p.who === 'person' ? 'first, ' : '') : 'then ';
    if (p.who === 'agent') return `${lead}I will run ${p.runs.map((r) => `\`${r}\``).join(', then ')} (for your user account on this machine)`;
    return `${lead}you ${p.runs.map((r) => (r.text ? r.run : `run \`${r.run}\``)).join(', then ')} (see why below)`;
  });
  if (said[0]) said[0] = said[0][0].toUpperCase() + said[0].slice(1);
  const anyAgent = steps.some((s) => s.who === 'agent');
  return `${anyAgent ? `Connect ${tool.name}? ` : `${tool.name} needs steps only you can do. `}${said.join('; ')}; then I will check that it is found and record it as this team's choice in ${files}.`;
}

const personBlock = (tool, steps) => (steps.length ? {
  act: 'install',
  why: steps.map((s) => s.why).filter((w, i, all) => all.indexOf(w) === i).join('; '),
  steps: steps.map((s) => s.run),
  commands: steps.filter((s) => !s.text).map((s) => s.run),
  verify: `yad toolbox connect ${tool.id} --verify --json`,
} : null);

// The read: what connecting `id` takes here. Runs nothing, writes nothing.
export function connectPlan(id, { items = null, has = onPath, detectRoot = process.cwd() } = {}) {
  const tool = byId(id);
  if (!tool) return { error: `${id} is not in the toolbox`, ids: tools().map((t) => t.id) };
  const found = items ?? detectInstalled(detectRoot).items;
  const status = toolStatus(tool, found, { has });
  const recipe = RECIPES[tool.id] ?? [];
  // Already here: nothing to install, only the record.
  const here = status.state === 'installed' || status.state === 'available';
  const steps = here ? [] : recipe;
  const personSteps = steps.filter((s) => s.who === 'person');
  const record = recordFiles(tool);
  return {
    tool: tool.id, name: tool.name, state: status.state, found: status.found,
    steps: steps.map((s) => ({ who: s.who, run: s.run, ...(s.scope ? { scope: s.scope } : {}), ...(s.why ? { why: s.why } : {}), ...(s.text ? { text: true } : {}) })),
    ask: askText(tool, steps, record, here),
    record,
    person: personBlock(tool, personSteps),
    manual: tool.manual,
    verify: `yad toolbox connect ${tool.id} --verify --json`,
  };
}

export function runToolboxConnect(detectRoot, productRoot, { id, verify = false, json = false, items = null, has = onPath, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!id) return refuse('yad toolbox connect needs a tool id', 'usage: yad toolbox connect <id> [--verify] [--json]', { json });
  const plan = connectPlan(id, { items, has, detectRoot });
  if (plan.error) return refuse(plan.error, `the tools: ${plan.ids.join(', ')}`, { json });
  if (!verify) {
    if (json) return emitJSON({ ok: true, ...plan });
    info(`${plan.name}: ${plan.state === 'installed' || plan.state === 'available' ? 'found here' : 'not found here'}`);
    for (const s of plan.steps) info(`${s.who === 'agent' ? 'agent runs' : 'you run'}: ${clean(s.run)}${s.why ? ` — ${s.why}` : ''}`);
    hand(plan.ask);
    hand(`then: ${plan.verify}`);
    return plan;
  }
  return verifyAndRecord(productRoot, plan, { json, today });
}

// `--verify`: found here → record the choice; not found → say what is left, and record nothing.
function verifyAndRecord(productRoot, plan, { json, today }) {
  const found = plan.state === 'installed' || plan.state === 'available';
  if (!found) {
    const left = plan.steps.length ? plan.steps.map((s) => s.run) : [plan.manual].filter(Boolean);
    return refuse(`${plan.name} is not found here yet, so nothing was recorded`,
      left.length ? `still to do: ${left.join('; then ')}` : 'install it, then run this again',
      { json, person: plan.person ?? { act: 'install', why: 'the tool is not found on this machine', steps: left, commands: left, verify: plan.verify } });
  }
  if (!productRoot) return refuse(`${plan.name} is found here, but there is no Product to record it in`, 'run it from the Product, or a repo it registers', { json });
  const tool = byId(plan.tool);
  const written = [];
  // A connector's own file first: it is what makes a connector used (`connectedTools`). Read strictly — a file
  // that does not parse is never written over, and the same tool already recorded is left as it is.
  const file = tool.tier === 'connector' ? connectorFile(tool) : null;
  if (file) {
    const abs = path.join(productRoot, file);
    let prev = null;
    if (fs.existsSync(abs)) {
      try { prev = readJSONStrict(abs); } catch (e) { return refuse(`${file} does not parse (${e.message})`, 'fix it or restore it from git first: writing over it would lose what it holds', { json }); }
    }
    if (!prev || prev.tool !== tool.id) {
      const write = { [PROJECT_FILES.designConfig]: registerDesign, [PROJECT_FILES.testingConfig]: registerTesting, [PROJECT_FILES.learningConfig]: registerLearning }[file];
      write(productRoot, { tool: tool.id, today });
      written.push(file);
    }
  }
  const { error } = readToolboxFile(productRoot);
  if (error) return refuse(`${PROJECT_FILES.toolboxConfig} ${error}`, 'fix it (or restore it from git) first — writing over it would delete every choice it holds', { json });
  if (recordToolUse(productRoot, tool)) written.push(PROJECT_FILES.toolboxConfig);
  const used = toolUse(tool, loadChoices(productRoot)).used;
  const out = { ok: true, tool: tool.id, found: plan.found, used, written };
  if (json) return emitJSON(out);
  ok(`${plan.name} is found here${used ? ' and used by this team' : ''}`);
  if (written.length) hand(`recorded in ${written.join(' and ')} — commit ${written.length > 1 ? 'them' : 'it'} with your next change, so the team shares the choice`);
  else info('already recorded — nothing to change');
  if (!used) warn(`${plan.name} is still not used here — a line in ${PROJECT_FILES.toolboxConfig} turns it off`);
  return out;
}
