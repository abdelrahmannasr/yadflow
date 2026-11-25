// EP-reported-agent-flow-S04 — `yad skip` / `yad unskip` once CI owns the epic's ledger. On a verified Product
// the ledger on the default branch is CI's alone, so the verb cannot write it. It opens a REQUEST instead: a
// branch `skip/<epic>/<step>` (or `unskip/…`) holding one empty commit on the base tip, and a PR/MR whose
// description carries the reason. Merging that PR/MR is the decision; `yad gate ci` then applies it with the
// same pure rule a local skip runs (cli/gate.mjs, `applySetAsideRequest`).
//
// Nothing is written in the working tree. Before anything is pushed, the rule is run on a copy of the base's
// state, so a refusal is today's refusal (YAD-STATE-004) and nothing leaves this machine. The commit is
// built with `commit-tree`, as `commitMember` builds a member commit, so the checkout is never touched. It is
// pushed with no force and no lease: a request branch already on origin is named and refused.
import { run, ok, info, warn, hand, fail, forTerminal } from './lib.mjs';
import { epicRel, skipStep, unskipStep, stepStatus } from './epic-state.mjs';
import { createPr, findPrForBranch } from './platform.mjs';
import { ciPin, olderThan, SET_ASIDE_SINCE } from './gate.mjs';
import { resolveHookBase } from './hook.mjs';

const STEP_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const requestBranch = (kind, epic, step) => `${kind}/${epic}/${step}`;
export const requestTitle = (kind, epic, step) => `chore(gate): ${kind} ${step} in ${epic}`;

// The reason sits between markers `gate ci` reads. One line, with no control character and no `-->`, so it
// can neither end the marker early nor start a command line in a CI log.
const oneLine = (s) => forTerminal(String(s ?? '')).replace(/\s+/g, ' ').replace(/-->/g, '-- >').trim();

// Passes `pr-template.sh --profile product` for a head that is not a review branch: `## Summary`,
// `## Impact & Risk` with a real `Risk level:`, `## Checklist`.
export function requestBody({ kind, epic, step, reason }) {
  const skip = kind === 'skip';
  return [
    '## Summary',
    '',
    skip
      ? `A request to skip the optional step \`${step}\` in \`${epic}\`.`
      : `A request to put the skipped step \`${step}\` in \`${epic}\` back in the chain.`,
    '',
    `**Merging this PR/MR is the decision.** CI (\`yad gate ci\`) then ${skip ? 'marks the step skipped' : 'un-skips the step'} on the default branch, ${skip ? 'with the reason below and ' : ''}naming the person who merged it. This PR/MR changes no file: its one commit is empty.`,
    '',
    ...(skip ? ['Reason:', '', '<!-- yad:reason -->', oneLine(reason), '<!-- /yad:reason -->', ''] : []),
    '## Impact & Risk',
    '',
    '- Risk level: low',
    `- Undo: \`yad ${skip ? 'unskip' : 'skip'} ${epic} ${step}\`${skip ? '' : ' --reason "<why>"'} opens the opposite request.`,
    '',
    '## Checklist',
    '',
    `- [x] Opened by \`yad ${kind}\`; its one commit changes no file`,
    `- [ ] The person who merges agrees ${skip ? 'the step is not needed' : 'the step is needed again'}`,
    '',
  ].join('\n');
}

export function openSetAsideRequest(root, { kind, epic, step, reason = null, debt = false, productConfig, by = null, today = null, runner = run, creator = createPr, finder = findPrForBranch } = {}) {
  const git = (...args) => runner('git', ['-C', root, ...args]);
  const no = (why, hint = null) => { fail(`\`yad ${kind}\` opened no request: ${why} — nothing is pushed`); if (hint) hand(hint); process.exitCode = 1; return null; };
  if (!STEP_RE.test(String(step))) return no(`'${forTerminal(step)}' is not a step id`);
  const platform = productConfig?.platform;
  if (platform !== 'github' && platform !== 'gitlab') return no('this Product has no GitHub or GitLab platform to open a PR/MR on');

  // R7: a CI pinned below the release that applies requests would never apply this one.
  const pin = ciPin(root, productConfig);
  if (pin && olderThan(pin, SET_ASIDE_SINCE)) {
    return no(`CI runs yadflow@${pin}, older than ${SET_ASIDE_SINCE}, the first release whose \`yad gate ci\` applies a ${kind} request`, 'run `yad update --open-pr` and merge it, then run this again');
  }
  if (!pin) warn(`CI's yadflow version is not pinned here, so it floats on the latest release of this major — a ${kind} request needs ${SET_ASIDE_SINCE} or later there`);

  // R2: the rule runs on the base's state, as CI will run it.
  const base = resolveHookBase(root, productConfig, runner);
  if (!base) return no('origin\'s default branch could not be read', 'run `git fetch origin`, then this again');
  const rel = `${epicRel(epic)}/.sdlc/state.json`;
  // `./`: a `<rev>:<path>` path is read from the repository's top, so a Product in a subfolder needs it relative.
  const shown = git('show', `${base}:./${rel}`);
  if (!shown.ok) return no(`${rel} could not be read from ${base}`);
  let state;
  try { state = JSON.parse(shown.stdout); } catch { return no(`${rel} on ${base} does not parse`); }
  const before = (Array.isArray(state.steps) ? state.steps : []).find((x) => x?.id === step);
  if (kind === 'skip' && stepStatus(before) === 'skipped') {
    const r = before.record || {};
    ok(`${step} was already marked N/A${r.by ? ` by ${r.by}` : ''}${r.date ? ` on ${r.date}` : ''} on ${base} — nothing changed`);
    if (r.reason) info(`reason: ${r.reason}`);
    return { epic, step, state: 'skipped', changed: false, record: r, request: null };
  }
  // Throws today's YadError (YAD-STATE-004) — a step that is not optional, no reason, an unskip too late or of a
  // step not skipped — which bin/yad.mjs renders, before anything is pushed.
  if (kind === 'skip') skipStep(state, step, { reason, by, at: today, debt: debt === true });
  else unskipStep(state, step);

  // A reason made only of control characters is empty once cleaned: CI would refuse it at merge, so refuse it now.
  if (kind === 'skip' && !oneLine(reason)) return no('the reason is empty once its control characters are removed');
  const branch = requestBranch(kind, epic, step);
  const trunk = base.replace(/^origin\//, '');
  const remote = git('ls-remote', '--heads', 'origin', `refs/heads/${branch}`);
  if (!remote.ok) return no(`could not read origin (${forTerminal(remote.stderr || 'git ls-remote failed')})`);
  if (String(remote.stdout || '').trim()) {
    const pr = finder(platform, branch, { cwd: root });
    return no(`${branch} is already on origin${pr?.ok ? ` (${pr.url || `#${pr.number}`})` : ''}`,
      `an earlier request used that branch. Delete it on the platform (or let it delete merged branches), then run this again; yad never force-pushes it`);
  }
  // R4: one empty commit on the base tip — its tree is the base tree, so it changes no file.
  const tip = git('rev-parse', `${base}^{commit}`);
  const tree = git('rev-parse', `${base}^{tree}`);
  if (!tip.ok || !tree.ok) return no(`could not read ${base}`);
  const sign = git('config', '--bool', 'commit.gpgsign').stdout === 'true';
  const title = requestTitle(kind, epic, step);
  const made = git('commit-tree', ...(sign ? ['-S'] : []), tree.stdout, '-p', tip.stdout, '-m', title,
    '-m', `A ${kind} request: merging its PR/MR is the decision, and \`yad gate ci\` applies it. This commit changes no file.`);
  if (!made.ok || !made.stdout) return no(`could not make the request commit${sign ? ' (git signs commits here — is the signing key available?)' : ''}: ${forTerminal(made.stderr || '')}`);
  const commit = made.stdout;
  // R5: no force, no lease.
  const pushed = git('push', 'origin', `${commit}:refs/heads/${branch}`);
  if (!pushed.ok) return no(`could not push ${branch} (${forTerminal(pushed.stderr || 'git push failed')})`);
  ok(`pushed ${branch}: one empty commit on ${base}`);

  const word = platform === 'github' ? 'PR' : 'MR';
  const body = requestBody({ kind, epic, step, reason });
  const r = creator(platform, { title, body, base: trunk, head: branch, cwd: root });
  const request = { kind, branch, commit, url: r?.ok ? r.url || null : null, opened: !!r?.ok };
  if (!r?.ok) {
    fail(`pushed ${branch}, but could not open the ${word}: ${forTerminal(r?.reason || 'failed')}`);
    hand(platform === 'github'
      ? `open it: gh pr create --head ${branch} --base ${trunk} --title "${title}" --body-file <a file with the description>`
      : `open it: glab mr create --source-branch ${branch} --target-branch ${trunk} --title "${title}" --description "<the description>"`);
    process.exitCode = 1;
  } else {
    ok(`opened the ${kind} request: ${request.url || branch}`);
    hand(`merging the ${word} is the decision: CI then ${kind === 'skip' ? 'marks' : 'un-skips'} ${step} on ${trunk}, and the merger is recorded as \`by\``);
  }
  return { epic, step, state: stepStatus(before), changed: false, request };
}
