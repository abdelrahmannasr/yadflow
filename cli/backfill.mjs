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
//   4. A promote cut short is finished, not refused, when the evidence says which promote it was: a refusal
//      would leave the person only a hand edit of `.sdlc/`. Anything else is refused, naming the step.
//
// THE SPEC lives in a code repo, at `specs/backfill/<feature>/spec.md`, and nothing in the stub records which
// repo or feature, so the two are named on the command line (`--repo`, `--feature`), and epic.md records them
// in its `backfill:` line from then on. The spec must be approved twice over: in the repo's checkout on this
// machine, and as committed at that repo's HEAD — so an edit nobody committed promotes nothing. The gate reads
// it from the base branch, so a spec committed on a branch but not merged passes this and still fails the gate.
import fs from 'node:fs';
import path from 'node:path';

import {
  emitJSON, hand, info, ok, readPlainFile, refuse, writeFileAtomic, forTerminal, NOT_PLAIN_FILE, FILE_TOO_BIG, LINKED_FOLDER_FIX, notPlainSaid,
} from './lib.mjs';
import {
  epicRoot, FRONTMATTER_BLOCK, hasStubSignal, isValidEpicId, isWholeStub, loadLedger, PRODUCT_EPICS, readFrontmatter,
  stepStatus, stubSignals, writeState,
} from './epic-state.mjs';
import { epicFiles, isVerifiedLedger } from './manifest.mjs';
import { loadProduct } from './gate.mjs';
import { epicIdFrom } from './epic.mjs';
import { judgeRepo, notRunnableWhy, readRegistry, runnable } from './workspace.mjs';
import { readFilesAt } from './git-read.mjs';
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
// is ASCII only, as the gate's `[[:space:]]` is: JavaScript's `\s` would also take a no-break space. A NUL in the
// frontmatter is refused: the shell gate cannot hold one in a variable, so the two would read different text.
export function specApproved(text) {
  const lines = String(text ?? '').split('\n');
  if (!/^---[ \t\r\f\v]*$/.test(lines[0] ?? '')) return false;
  const end = lines.findIndex((l, i) => i > 0 && /^---[ \t\r\f\v]*$/.test(l));
  if (end < 0) return false;
  const block = lines.slice(1, end);
  if (block.some((l) => l.includes('\0'))) return false;
  const last = block.filter((l) => /^["']?verified["']?[ \t\r\f\v]*:/i.test(l)).at(-1);
  return last !== undefined && /^verified:[ \t\r\f\v]*(true|True|TRUE)[ \t\r\f\v]*$/.test(last);
}

// A key this command owns in epic.md, in any spelling YAML reads as that key (quoted or not, a space before
// the colon). Its block-style children (indented lines, or a `- ` list under it) go with it, or they would be
// left hanging under the key before them.
const OWNED_KEY = /^["']?(stub|verified|backfill)["']?[ \t]*:/;
const childOf = (l) => /^[ \t]/.test(l) || /^-([ \t]|$)/.test(l);

// epic.md with the stub marker gone, `verified: true`, and the `backfill:` line naming the spec. Only the
// frontmatter changes, spliced by position (an empty block has no text to find). A file written with CRLF line
// ends keeps them. Null when the file has no frontmatter block to change.
export function promotedEpicMd(text, backfillLine) {
  const crlf = String(text).includes('\r\n');
  const lf = crlf ? String(text).replace(/\r\n/g, '\n') : String(text);
  const fm = lf.match(FRONTMATTER_BLOCK);
  if (!fm) return null;
  const lines = fm[1] === '' ? [] : fm[1].split('\n');
  const kept = [];
  let placed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(OWNED_KEY);
    if (!m) { kept.push(lines[i]); continue; }
    while (i + 1 < lines.length && childOf(lines[i + 1])) i++;
    if (m[1] === 'verified' && !placed) { kept.push('verified: true', backfillLine); placed = true; }
  }
  if (!placed) kept.push('verified: true', backfillLine);
  const start = fm.index + '---\n'.length;
  const out = lf.slice(0, start) + kept.join('\n') + lf.slice(start + fm[1].length);
  return crlf ? out.replace(/\n/g, '\r\n') : out;
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

const APPROVE_HINT = 'approve the backfill spec first (the yad-backfill skill, `approve`): its frontmatter line must read exactly `verified: true`';

// The spec, found through the registry: { spec, problem, hint }. `problem` names what is missing, for the
// refusal; `hint` says what to do about that one.
export function readSpec(root, repoName, feature, { readAtHead = readFilesAt } = {}) {
  const spec = `specs/backfill/${feature}/spec.md`;
  const where = `${spec} in ${forTerminal(repoName)}`;
  const say = (problem, hint) => ({ spec, problem, hint });
  const { registry, problem } = readRegistry(root);
  if (problem) return say(problem, 'fix .sdlc/repos.json, then run this again');
  const matches = registry.repos.filter((r) => r?.name === repoName);
  if (!matches.length) return say(`no repo named ${forTerminal(repoName)} in .sdlc/repos.json`, '`yad repo list` shows the names');
  if (matches.length > 1) return say(`${matches.length} entries in .sdlc/repos.json are named ${forTerminal(repoName)}`, 'keep one entry per name in .sdlc/repos.json');
  const j = judgeRepo(root, matches[0]);
  if (!runnable(j)) {
    return say(`${j.name} cannot be read here (${notRunnableWhy(j)})`,
      j.state === 'missing' ? '`yad repo clone` clones it' : 'fix the repo\'s entry or its folder, then run this again');
  }
  // The folder by its exact name. On a disk that ignores case (macOS, Windows) `Cart` opens `cart/`, and the
  // path recorded would then name a folder git and Linux do not have.
  let names = [];
  try { names = fs.readdirSync(path.join(j.target, 'specs', 'backfill')); } catch { /* no folder: no spec */ }
  if (!names.includes(feature)) {
    const near = names.find((n) => n.toLowerCase() === feature.toLowerCase());
    return near
      ? say(`there is no ${where} — the folder is spelled ${forTerminal(near)}`, `run this again with --feature ${forTerminal(near)}`)
      : say(`there is no ${where}`, 'draft and approve the spec first (the yad-backfill skill), or check --repo and --feature');
  }
  let text;
  try { text = readPlainFile(path.join(j.target, ...spec.split('/')), { within: j.target }); }
  catch (e) {
    const plain = e?.code === NOT_PLAIN_FILE || e?.code === FILE_TOO_BIG;
    return say(`${where} ${plain ? notPlainSaid(e, 'is not a plain file (a link, a folder, a device, or too big), so it was not read') : `cannot be read (${forTerminal(e?.message)})`}`,
      e?.folder ? LINKED_FOLDER_FIX : 'put the real spec file there (restore it from git), then run this again');
  }
  if (text === null) return say(`there is no ${where}`, 'draft and approve the spec first (the yad-backfill skill), or check --repo and --feature');
  if (!specApproved(text)) return say(`${where} has no exact \`verified: true\` line in its frontmatter — it is not approved yet`, APPROVE_HINT);
  // As committed at HEAD too: an edit nobody committed is not an approval anybody can see.
  const committed = readAtHead(j.target, 'HEAD', [spec]).get(spec);
  if (committed == null) return say(`${where} is approved in the checkout but not committed (it is not in HEAD)`, 'commit the approved spec first, then run this again');
  if (!specApproved(committed)) return say(`${where} is approved in the checkout, but not as committed at HEAD`, 'commit the approved spec first, then run this again');
  return { spec, problem: null, hint: null };
}

// A file of the epic, as a plain file: { text } or { refusal } (a link, a folder, a device: never read through).
function readEpicFile(file, label) {
  try { return { text: readPlainFile(file) }; }
  catch (e) {
    if (e?.code !== NOT_PLAIN_FILE && e?.code !== FILE_TOO_BIG) throw e;
    return { refusal: [`${label} ${notPlainSaid(e, 'is not a plain file (a link, a folder, a device, or too big), so it was not read')}`,
      e.folder ? `${LINKED_FOLDER_FIX}, then run this again` : `replace it with the real file from git (\`git checkout -- ${label}\`) — never delete a ledger blindly`] };
  }
}

// `io` is for a test: the two writes (so one can be made to fail), and the read at HEAD.
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
  const md = readEpicFile(mdFile, `epics/${epic}/epic.md`);
  if (md.refusal) return no(...md.refusal, { code: 'YAD-STATE-001' });
  const st = readEpicFile(files.state, `epics/${epic}/.sdlc/state.json`);
  if (st.refusal) return no(...st.refusal, { code: 'YAD-STATE-001' });
  const oldMd = md.text;
  const oldState = st.text;
  if (oldMd === null || oldState === null) {
    return no(`${epic} is not an epic here — ${oldMd === null ? 'epic.md' : '.sdlc/state.json'} is missing`, 'mint the anchor first: the yad-stub skill runs `yad epic new <slug> --stub`');
  }
  const { state } = loadLedger(dir);
  const signals = stubSignals(root, epic, state);
  const fm = readFrontmatter(mdFile);

  // Both conditions are read before refusing, so the answer names everything that is missing at once. The hint
  // answers the first problem said.
  const missing = [];
  const problems = [];
  const hints = [];
  if (!hasStubSignal(signals)) {
    missing.push('stub');
    const promoted = state.currentStep === 'backfill-done' || fm.verified === 'true';
    problems.push(promoted ? `${epic} is not a stub — it was promoted already (currentStep: ${forTerminal(state.currentStep)})` : `${epic} is not a stub — it has no stub marker in epic.md or state.json`);
    hints.push(promoted && full && state.currentStep === 'backfill-done'
      ? `promote does not wake a documented anchor: a light promote cannot be made full later. To bring ${epic} under Shape, thread a change off it with the yad-change skill, which runs the Shape steps on the change`
      : promoted ? `${epic} is a documented anchor already: thread a change or defect off it with the yad-change skill`
        : 'promote takes an anchor minted by `yad epic new --stub`');
  }
  const found = readSpec(root, repo, feature, io.readAtHead ? { readAtHead: io.readAtHead } : {});
  const { spec } = found;
  if (found.problem) { missing.push('verified-spec'); problems.push(found.problem); hints.push(found.hint); }
  if (missing.length) return no(problems.join('; '), hints[0], { missing });

  // A promote cut short.
  //   * With a ledger marker left (`kind: stub` or the sentinel), it is finished when the ledger is still on the
  //     sentinel or already on the step this flavour writes. No step runs past a ledger marker, so on any other
  //     step nobody can tell which promote was meant.
  //   * With only epic.md's `stub:` line left, the ledger was promoted and may have moved on, so epic.md alone is
  //     finished and the ledger is kept — when the ledger shows it was a stub promoted by this command: on
  //     `backfill-done` (only a light promote writes it) for a light promote; for a full one, a ledger off the
  //     sentinel whose epic.md says `origin: brownfield`, as every stub's does. A stray `stub:` line on an epic
  //     that never was a stub is refused: finishing it would mark an unreviewed epic verified.
  const target = full ? 'epic' : 'backfill-done';
  const finishing = !isWholeStub(signals);
  const markerOnly = !signals.ledger && !signals.sentinel;
  if (finishing && markerOnly) {
    const lightDone = state.currentStep === 'backfill-done';
    const brownfield = fm.origin === 'brownfield';
    if (!lightDone && !brownfield) {
      return no(`${epic} has a stub: line in epic.md, but its ledger was never a stub that this command promoted (currentStep: ${forTerminal(state.currentStep)}, and epic.md has no origin: brownfield)`,
        `if ${epic} is not a stub, remove the stray stub: line from epic.md (epic.md is not under .sdlc/, so it is yours to edit)`);
    }
    if (lightDone === full) {
      return no(`${epic} is half promoted: only the stub: line in epic.md is left, and its ledger shows a ${lightDone ? 'light' : 'full'} promote (currentStep: ${forTerminal(state.currentStep)})`,
        lightDone ? 'run this again without --full to finish it' : 'run this again with --full to finish epic.md — the ledger is left as it is');
    }
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

  // Both files, or neither: the old bytes are kept, and every file this run touched is put back when a write
  // fails. A write that throws may have replaced its file first, so it counts as touched.
  const touched = [];
  try {
    if (newState) { touched.push([files.state, oldState]); write.state(files.state, newState); }
    touched.push([mdFile, oldMd]);
    write.file(mdFile, newMd);
  } catch (e) {
    const unrestored = [];
    for (const [file, bytes] of touched) {
      try { writeFileAtomic(file, bytes); } catch { unrestored.push(path.relative(root, file)); }
    }
    const why = forTerminal(`${e?.message ?? e}${e?.code && !String(e?.message).includes(e.code) ? ` (${e.code})` : ''}`);
    return no(`${epic} was not promoted — a write failed: ${why}${unrestored.length ? `; ${unrestored.join(' and ')} could not be put back` : '; both files are as they were'}`,
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
    : `${epic} is a documented anchor: thread a change or defect off it with the yad-change skill. Light cannot be made full by promote later. Commit epic.md and .sdlc/state.json together`);
  return answer;
}
