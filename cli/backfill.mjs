// `yad backfill promote <epic> --repo <name> --feature <feature> [--full]` (Product #1, roadmap E17b) — turn a
// stub into a real anchor once its backfill spec is approved.
//
// A stub (`yad epic new --stub`, the yad-stub skill) is marked in two files: `stub: backfill-pending` and
// `verified: false` in epic.md, and `kind: "stub"` with the `backfill-pending` sentinel in state.json. The
// yad-backfill skill used to clear them by hand, which made it the last skill that told an agent to edit
// state.json, and a promote cut short left the two files disagreeing. This command writes both, or neither.
// The decisions were the person's (2026-11-19):
//   1. A LOCAL write, as `yad epic new` is: no PR, no platform. It refuses on a verified ledger, where CI is
//      the only writer of state.json, as `yad gate approve` does.
//   2. It refuses unless the epic is a stub and its backfill spec says `verified: true`, read the way the
//      backfill gate (checks/backfill-check.sh) reads it. It says which of the two is missing.
//   3. Light by default: `currentStep: "backfill-done"`, the chain left asleep. `--full` wakes the `epic` step.
//   4. A promote cut short (some stub markers left, the ledger on the sentinel or on the step this flavour
//      writes) is finished, not refused: a refusal would leave the person only a hand edit of `.sdlc/`.
//      Markers left on a chain that moved anywhere else are refused, naming the step.
//
// THE SPEC lives in a code repo, at `specs/backfill/<feature>/spec.md`, and nothing in the stub records which
// repo or feature, so the two are named on the command line (`--repo`, `--feature`), and epic.md records them
// in its `backfill:` line from then on. The spec is read from the repo's checkout on this machine. The gate
// reads it from the base branch, so a spec approved here but not merged passes this and still fails the gate.
import path from 'node:path';

import { emitJSON, hand, info, ok, readPlainFile, refuse, writeFileAtomic, forTerminal } from './lib.mjs';
import {
  epicRoot, FRONTMATTER_BLOCK, hasStubSignal, isValidEpicId, isWholeStub, loadLedger, PRODUCT_EPICS, readFrontmatter,
  stepStatus, stubSignals, writeState,
} from './epic-state.mjs';
import { epicFiles, isVerifiedLedger } from './manifest.mjs';
import { loadProduct } from './gate.mjs';
import { epicIdFrom } from './epic.mjs';
import { judgeRepo, readRegistry } from './workspace.mjs';
import { refreshIndexAfterWrite } from './product-index.mjs';

export const PROMOTE_USAGE = 'usage: yad backfill promote <epic> --repo <name> --feature <feature> [--full] [--json]';

// A feature is one folder name under `specs/backfill/` (and `src/`): a path segment, never a path.
const FEATURE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
// The repo name lands in epic.md's frontmatter, in a YAML flow map: only characters that need no quoting.
const REPO_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

// Is this spec approved? The same reading as checks/backfill-check.sh: only a frontmatter block that opens on
// the first line and closes, and the LAST line that could set the key (any case, quoted or not, a space before
// the colon), which must be exactly `verified: true` — the key in lower case, the value as YAML 1.1 reads it
// (`true`, `True`, `TRUE`), nothing after it. So what the gate passes, this passes, and nothing else. The space
// is ASCII only, as the gate's `[[:space:]]` is: JavaScript's `\s` would also take a no-break space.
export function specApproved(text) {
  const lines = String(text ?? '').split('\n');
  if (!/^---[ \t\r\f\v]*$/.test(lines[0] ?? '')) return false;
  const end = lines.findIndex((l, i) => i > 0 && /^---[ \t\r\f\v]*$/.test(l));
  if (end < 0) return false;
  const last = lines.slice(1, end).filter((l) => /^["']?verified["']?[ \t\r\f\v]*:/i.test(l)).at(-1);
  return last !== undefined && /^verified:[ \t\r\f\v]*(true|True|TRUE)[ \t\r\f\v]*$/.test(last);
}

// epic.md with the stub marker gone, `verified: true`, and the `backfill:` line naming the spec. Only the
// frontmatter changes. Null when the file has no frontmatter block to change.
export function promotedEpicMd(text, backfillLine) {
  const fm = String(text).match(FRONTMATTER_BLOCK);
  if (!fm) return null;
  const lines = fm[1].split('\n');
  const at = lines.findIndex((l) => /^verified\s*:/.test(l));
  const kept = [];
  lines.forEach((l, i) => {
    if (/^(stub|backfill)\s*:/.test(l)) return;
    if (/^verified\s*:/.test(l)) { if (i === at) kept.push('verified: true', backfillLine); return; }
    kept.push(l);
  });
  if (at < 0) kept.push('verified: true', backfillLine);
  // A function, not a string: `$'` or `$&` in a frontmatter value is a code in a replacement string.
  return text.replace(fm[1], () => kept.join('\n'));
}

// The ledger promoted. Light: off the sentinel onto `backfill-done`, the chain left as it is. Full: `currentStep`
// on `epic`, and that step opened when nobody has started it (a promote finished here may find it open).
// `type` stays: `kind: "stub"` is the lifecycle marker, `type` the work item, which a promoted stub still is.
export function promotedState(state, { full }) {
  const next = JSON.parse(JSON.stringify(state));
  if (next.kind === 'stub') delete next.kind;
  if (!full) { next.currentStep = 'backfill-done'; return next; }
  next.currentStep = 'epic';
  const epicStep = next.steps.find((s) => s?.id === 'epic');
  if (epicStep && ['todo', 'blocked'].includes(stepStatus(epicStep))) epicStep.status = 'in_progress';
  return next;
}

// The spec, found through the registry: { spec, problem }. `problem` names what is missing, for the refusal.
function readSpec(root, repoName, feature) {
  const spec = `specs/backfill/${feature}/spec.md`;
  const where = `${spec} in ${forTerminal(repoName)}`;
  const { registry, problem } = readRegistry(root);
  if (problem) return { spec, problem };
  const matches = registry.repos.filter((r) => r?.name === repoName);
  if (!matches.length) return { spec, problem: `no repo named ${forTerminal(repoName)} in .sdlc/repos.json` };
  if (matches.length > 1) return { spec, problem: `${matches.length} entries in .sdlc/repos.json are named ${forTerminal(repoName)}` };
  const j = judgeRepo(root, matches[0]);
  if (!['present', 'product'].includes(j.state) || j.linked) {
    return { spec, problem: `${j.name} cannot be read here (${j.state === 'missing' ? 'not cloned on this machine' : j.linked ? 'reached through a link' : j.reason})` };
  }
  let text;
  try { text = readPlainFile(path.join(j.target, ...spec.split('/')), { within: j.target }); }
  catch (e) { return { spec, problem: `${where} is not a plain file (${forTerminal(e.message)})` }; }
  if (text === null) return { spec, problem: `there is no ${where}` };
  if (!specApproved(text)) return { spec, problem: `${where} has no exact \`verified: true\` line in its frontmatter — it is not approved yet` };
  return { spec, problem: null };
}

// `io` is for a test: the two writes, so one can be made to fail.
export async function runBackfillPromote(root, { epic: given, repo, feature, full = false, today, json = false, io = {} } = {}) {
  const write = { state: io.writeState ?? writeState, file: io.writeFile ?? writeFileAtomic };
  const no = (message, hint = null, extra = {}) => refuse(message, hint, { json, ...extra });
  const epic = epicIdFrom(given);
  if (!epic || typeof repo !== 'string' || !repo || typeof feature !== 'string' || !feature) return no(PROMOTE_USAGE);
  if (!isValidEpicId(epic)) return no(`invalid epic id: ${forTerminal(epic)} (expected EP-<slug>, [a-z0-9-] only)`);
  if (PRODUCT_EPICS.includes(epic)) return no(`${epic} is the Product level, not a stub`, 'promote takes an anchor minted by `yad epic new --stub`');
  if (!FEATURE.test(feature)) return no(`--feature takes one folder name, as under specs/backfill/ (got: ${forTerminal(feature)})`);
  if (!REPO_NAME.test(repo)) return no(`--repo takes a repo name from .sdlc/repos.json made of letters, digits, '.', '_' and '-' (got: ${forTerminal(repo)})`);

  // As `yad gate approve` refuses (cli/gate-local.mjs): on a verified ledger CI is the only writer of state.json.
  const { productConfig } = loadProduct(root);
  if (isVerifiedLedger(productConfig)) {
    return no(`\`yad backfill promote\` writes ${epic}'s ledger, and this Product's ledger is verified — CI is its only writer, so nothing is written`,
      `CI has no promote yet. Leave ${epic} a stub: defects and changes still thread off it (the yad-change skill)`);
  }

  const dir = epicRoot(root, epic);
  const files = epicFiles(dir);
  const mdFile = path.join(dir, 'epic.md');
  const oldMd = readPlainFile(mdFile);
  const oldState = readPlainFile(files.state);
  if (oldMd === null || oldState === null) {
    return no(`${epic} is not an epic here — ${oldMd === null ? 'epic.md' : '.sdlc/state.json'} is missing`, 'mint the anchor first: the yad-stub skill runs `yad epic new <slug> --stub`');
  }
  const { state } = loadLedger(dir);
  const signals = stubSignals(root, epic, state);

  // Both conditions are read before refusing, so the answer names everything that is missing at once.
  const missing = [];
  const problems = [];
  if (!hasStubSignal(signals)) {
    missing.push('stub');
    const promoted = state.currentStep === 'backfill-done' || readFrontmatter(mdFile).verified === 'true';
    problems.push(promoted ? `${epic} is not a stub — it was promoted already (currentStep: ${forTerminal(state.currentStep)})` : `${epic} is not a stub — it has no stub marker in epic.md or state.json`);
  }
  const { spec, problem } = readSpec(root, repo, feature);
  if (problem) { missing.push('verified-spec'); problems.push(problem); }
  if (missing.length) {
    const hint = missing.includes('verified-spec')
      ? 'approve the backfill spec first (the yad-backfill skill, `approve`): its frontmatter line must read exactly `verified: true`'
      : 'promote takes an anchor minted by `yad epic new --stub`';
    return no(problems.join('; '), hint, { missing });
  }

  // A promote cut short. When only epic.md's marker is left, the ledger was promoted already and may have moved
  // on since (its steps run once `kind: "stub"` is gone): epic.md alone is finished, if the flavour asked for is
  // the one the ledger shows, and the ledger is not touched. With a ledger marker left, it is finished when the
  // ledger is still on the sentinel or already on the step this flavour writes; a chain cannot move on past a
  // ledger marker, so anywhere else nobody can tell which promote was meant.
  const target = full ? 'epic' : 'backfill-done';
  const finishing = !isWholeStub(signals);
  const markerOnly = !signals.ledger && !signals.sentinel;
  const ledgerFull = state.currentStep !== 'backfill-done';
  if (finishing && markerOnly && ledgerFull !== full) {
    return no(`${epic} is half promoted: only the stub: line in epic.md is left, and its ledger shows a ${ledgerFull ? 'full' : 'light'} promote (currentStep: ${forTerminal(state.currentStep)})`,
      ledgerFull ? 'run this again with --full to finish epic.md — the ledger is left as it is' : 'run this again without --full to finish it');
  }
  if (finishing && !markerOnly && !['backfill-pending', target].includes(state.currentStep)) {
    const at = forTerminal(state.currentStep);
    const hint = state.currentStep === 'backfill-done' ? 'a light promote was started — run this again without --full to finish it'
      : state.currentStep === 'epic' ? 'a full promote was started — run this again with --full to finish it'
        : `restore epic.md and .sdlc/state.json of ${epic} from git to the commit before the promote began (\`git log -- epics/${epic}\`), then run this again`;
    return no(`${epic} is half promoted: stub markers are left, but its ledger is on ${at}, which a ${full ? 'full' : 'light'} promote does not write`, hint);
  }

  const backfillLine = `backfill: { repo: ${repo}, spec: ${spec}, promoted: ${today} }`;
  const newMd = promotedEpicMd(oldMd, backfillLine);
  if (newMd === null) return no(`${epic}'s epic.md has no frontmatter block (--- lines at the top)`, 'put the stub\'s frontmatter back (the yad-stub skill shows it), then run this again');
  // Null when only epic.md is left to finish: the ledger is not written.
  const newState = markerOnly ? null : promotedState(state, { full });

  // Both files, or neither: the old bytes are kept, and put back when either write fails.
  try {
    if (newState) write.state(files.state, newState);
    write.file(mdFile, newMd);
  } catch (e) {
    const unrestored = [];
    for (const [file, bytes] of [[files.state, oldState], [mdFile, oldMd]]) {
      try { writeFileAtomic(file, bytes); } catch { unrestored.push(path.relative(root, file)); }
    }
    return no(`${epic} was not promoted — a write failed (${forTerminal(e.code || e.message)})${unrestored.length ? `, and ${unrestored.join(' and ')} could not be put back` : '; both files are as they were'}`,
      unrestored.length ? `restore them from git (\`git checkout -- ${unrestored.join(' ')}\`), then run this again` : 'fix the cause, then run this again');
  }
  refreshIndexAfterWrite(root, productConfig, { quiet: json });

  const currentStep = (newState ?? state).currentStep;
  const answer = { ok: true, epic, promote: full ? 'full' : 'light', currentStep, repo, spec, promoted: today, finished: finishing };
  if (json) return emitJSON(answer);
  ok(`${epic} promoted${finishing ? ' (a promote cut short, now finished)' : ''} — ${full ? 'a full' : 'a light'} promote`);
  info(`epic.md: verified: true, no stub: marker, ${backfillLine}`);
  info(newState ? `state.json: no kind: "stub", currentStep: ${currentStep}` : `state.json: already promoted, left as it is (currentStep: ${forTerminal(currentStep)})`);
  hand(full
    ? `the epic step is open: run the yad-epic skill to author epic.md, then its review. Commit epic.md and .sdlc/state.json together`
    : `${epic} is a documented anchor: thread a change or defect off it with the yad-change skill. Commit epic.md and .sdlc/state.json together`);
  return answer;
}
