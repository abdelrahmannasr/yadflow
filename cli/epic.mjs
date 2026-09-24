// `yad epic new <slug> --type <type> --profile <profile>` — the ENGINE seeds an epic's lifecycle.
//
// Roadmap E17. The chain a new epic walks used to be hand-written — five skills seeded one, four from
// a literal JSON block and `yad-change` in prose. Five copies of one table is five chances to
// disagree, and they already did: two of them were on different routes, a third was on the same route
// with different statuses, and nothing in the engine could tell. The catalogue (E4) says what each step IS and the profiles (E5) say which route an
// epic takes; this command is what finally writes one from the other.
//
// WHAT IT WRITES, AND WHAT IT DOES NOT. It writes the LEDGER — `state.json`, an empty `approvals.json`
// and `comments.json`, and the `reviews/` directory. It does not write `epic.md`, does not create a
// branch, and does not commit. `epic.md` is prose authored WITH the user, which is `yad-epic`'s job and
// stays there; a command that guessed a goal and a scope would produce a document nobody wrote. So the
// order is: seed the chain here, then run the authoring skill the chain names.
//
// THREE OF THE FIVE NOW CALL THIS (E17b): `yad-epic`, `yad-analysis` and `yad-stub` run it instead of
// carrying a chain, and their templates are gone — a test asserts no step chain comes back into those
// files, because nothing else would notice a copy quietly drifting from the catalogue again.
//
// `yad-discovery` now runs `yad foundation new` (E75, below) for the Product level, which is not an epic
// and has a command of its own.
//
// A THREADED CHAIN IS SEEDED HERE TOO, since E42. `yad-change` seeds a change, defect or hotfix with
// `--parent` and `--inherits`: its inherited steps are `satisfied` and bound to the owning epic's artifact
// hashes, its approvals ledger carries a provenance record per inherited gate, and an inherited
// architecture writes a pointer contract-lock. What stays in the skill is the depth triage that DECIDES
// which bases are inherited — a judgement made with a person, not a flag's default. A threaded type with
// no parent is still refused, and so is a genesis type with one.
//
// The seed is still built key-by-key in the order those templates used, because the chains on disk in
// every existing project were written that way and a re-seeded epic must not churn their bytes.
import fs from 'node:fs';
import path from 'node:path';

import { c, fail, hand, info, log, ok, readJSON, warn, emitJSON } from './lib.mjs';
import {
  DISCOVERY_EPIC, epicIds, epicLineage, epicRel, epicRoot, epicStories, featureStatus, FOUNDATION_EPIC, FOUNDATION_SECTIONS,
  isGenesisType, isValidEpicId, lifecycleProfile, loadLedger, loadSkillBindings, PRODUCT_DONE, PRODUCT_EPICS,
  planThreadedSeed, readFrontmatter, roadmapFeatures, seedableProfiles, seedFoundationState,
  seedState, staleFoundationGuards, stepSkills, typeNoun, WORK_ITEM_TYPES, workItemType, writeJSON, writeState,
} from './epic-state.mjs';
import { epicFiles, isVerifiedLedger, productConfigPath } from './manifest.mjs';
import { refreshIndexAfterWrite } from './product-index.mjs';

// `foo`, `EP-foo` and `epics/EP-foo` all name the same epic. Accepting only one spelling would make the
// command reject the id the user just read out of `yad next`.
export function epicIdFrom(slug) {
  const raw = String(slug || '').trim().replace(/^epics\//, '').replace(/\/+$/, '');
  if (!raw) return null;
  return raw.startsWith('EP-') ? raw : `EP-${raw}`;
}

// `type` defaults to null rather than `feature` so an explicit `--type` is distinguishable from no
// flag at all — which is what lets an existing `epic.md` supply the answer without overriding the user.
export async function runEpicNew(root, { slug, type = null, profile = null, stub = false, parent = null, inherits = null, today, json = false } = {}) {
  const bail = (message, hint) => {
    if (json) emitJSON({ ok: false, error: message, hint });
    else { fail(message); if (hint) hand(hint); }
    process.exitCode = 1;
  };

  const epic = epicIdFrom(slug);
  if (!epic) return bail(`usage: yad epic new <slug> [--type ${WORK_ITEM_TYPES.join('|')}] [--profile ${seedableProfiles().join('|')}] [--parent EP-<slug> --inherits <bases>]`);
  // The id becomes a path segment under epics/ — reject anything but EP-<slug> outright, the same
  // guard every other epic-taking command applies.
  if (!isValidEpicId(epic)) return bail(`invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`);
  // The Product level's ids are RESERVED, and refusing the profile is not enough to protect them: the
  // route defaults to `classic`, so `yad epic new discovery` would have written a 10-step feature chain
  // onto the one id a product may only ever have one of — with no `kind` marker, which is what every
  // reader of the product level keys off. Worse, it would then be permanent: the next run refuses the
  // id as already seeded. `EP-foundation` is sharper still (E75): its directory is not under `epics/` —
  // `epicRoot` sends it to `foundation/` — so a feature seed would land in the Foundation's own ledger.
  if (PRODUCT_EPICS.includes(epic)) {
    return bail(`${epic} is the Product level, not an epic on the ladder`,
      'it is one per product, has no epic.md and no work-item type, and its ledger carries a `kind` marker this command does not write. Run `yad foundation new`, then the yad-discovery skill');
  }

  const dir = epicRoot(root, epic);
  const files = epicFiles(dir);
  // Refuse rather than overwrite. A `state.json` is the epic's audit trail; replacing one is how a
  // project loses every approval it holds, and there is no flag for it on purpose. On a verified
  // Product it is also the line `ledger-guard` draws — creating a new epic's ledger is exempt
  // (creation is not mutation, #162), rewriting an existing one is not.
  if (fs.existsSync(files.state)) {
    return bail(`${epic} already has a lifecycle — ${path.relative(root, files.state)} exists`,
      `run \`yad next ${epic}\` to see where it is. Nothing here overwrites a ledger`);
  }

  // THE TYPE IS AUTHORED IN `epic.md`, and copied into the ledger — that is the shape-5 rule, and it
  // holds here too. Normally no `epic.md` exists yet, so the flag (or `feature`) is the answer. When
  // one is already there, it is the author's word and it wins over a default: seeding `feature` beside
  // a header that says `chore` would mint an epic whose two records disagree from its first second,
  // which `yad doctor` would then report as `type:ledger` on an epic nobody had touched.
  //
  // An explicit `--type` that CONTRADICTS the header is refused rather than silently resolved. Only
  // the person typing it knows which of the two they meant, and picking one would overwrite an answer.
  // The OLD frontmatter name wins inside `workItemType`, the same tie-break the stamper uses.
  //
  // DECLARES is the word, and it is not the same as what `workItemType` RESOLVES. That function
  // defaults to `feature`, so a header carrying no type at all resolves identically to one that says
  // `feature` — and clashing on the resolved value would refuse `--type chore` beside a drafted
  // epic.md whose frontmatter names no type, telling the author to go and fix a value their file does
  // not contain. So the raw keys decide whether there is anything to clash WITH, and `workItemType`
  // still decides what it says: the OLD name (`kind:`) wins there, the same tie-break the stamper uses.
  const mdPath = path.join(dir, 'epic.md');
  const fm = fs.existsSync(mdPath) ? readFrontmatter(mdPath) : {};
  if (fs.existsSync(mdPath)) {
    const declares = typeof fm.kind === 'string' && fm.kind.trim()
      || typeof fm.type === 'string' && fm.type.trim();
    if (declares) {
      const authored = workItemType(fm);
      if (type && type !== authored) {
        return bail(`${epic}: epic.md says \`${authored}\`, --type says \`${type}\``,
          'the type is authored in epic.md and copied into the ledger. Drop the flag to take the header\'s answer, or fix the header first — nothing here rewrites epic.md');
      }
      type = authored;
    }
  }
  type = type || 'feature';

  if (!WORK_ITEM_TYPES.includes(type)) {
    return bail(`unknown work-item type: ${type}`, `a work item is one of ${WORK_ITEM_TYPES.join(' · ')}`);
  }

  // THE PARENT AND WHAT IT CARRIES (E42) are authored in epic.md as well — `parent:` and `inherits:` —
  // and the same rule as the type holds: the header's word wins over no flag, and a flag that
  // contradicts it is refused. `yad thread` and the owner map read the header, so a ledger seeded from
  // a flag the header disagrees with would describe a thread nobody can see.
  // Normalised like the slug, so `--parent checkout` names the epic `yad next` printed as EP-checkout.
  parent = parent ? epicIdFrom(parent) : null;
  const declaredParent = typeof fm.parent === 'string' && fm.parent.trim() ? epicIdFrom(fm.parent) : null;
  if (parent && declaredParent && parent !== declaredParent) {
    return bail(`${epic}: epic.md says \`parent: ${declaredParent}\`, --parent says \`${parent}\``,
      'drop the flag to take the header\'s answer, or fix the header first — nothing here rewrites epic.md');
  }
  parent = parent || declaredParent;
  const flagInherits = inherits == null ? null : listOf(inherits);
  const declaredInherits = 'inherits' in fm ? listOf(fm.inherits) : null;
  // Every other reader — `yad thread`, the owner map, the next change threading off this one — takes the
  // header through `epicLineage`, which reads a list only in brackets. `inherits: epic, ui-design` is one
  // base named "epic, ui-design" to them, so seeding what this parse sees would describe a thread they
  // cannot. Refused, with the spelling they all read.
  if (declaredInherits && [...new Set(declaredInherits)].sort().join() !== [...new Set(epicLineage(root, epic).inherits)].sort().join()) {
    return bail(`${epic}: epic.md writes \`inherits:\` in a form the other readers take as [${epicLineage(root, epic).inherits.join(' | ')}]`,
      `write it as \`inherits: [${declaredInherits.join(', ')}]\` — in brackets — then run this again`);
  }
  if (flagInherits && declaredInherits
    && [...new Set(flagInherits)].sort().join() !== [...new Set(declaredInherits)].sort().join()) {
    return bail(`${epic}: epic.md inherits [${declaredInherits.join(', ')}], --inherits says [${flagInherits.join(', ')}]`,
      'drop the flag to take the header\'s answer, or fix the header first — nothing here rewrites epic.md');
  }

  // Checked before the type rules, so `--stub --type defect --parent …` is told what is actually wrong
  // rather than seeded as a threaded epic with the flag silently dropped.
  if (stub && parent) {
    return bail('a stub has no parent — it anchors a feature that shipped before it had an epic',
      'drop --stub to thread a change off the parent, or drop --parent to mint the anchor');
  }
  if (isGenesisType(type) && parent) {
    return bail(`a ${type} has no parent — it starts a thread`,
      `a change on ${parent} is \`--type change\` (or defect / hotfix). Drop --parent to start a new ${type}`);
  }
  if (!isGenesisType(type) && !parent) {
    return bail(`a ${type} epic cannot be seeded without its parent`,
      `a ${type} threads off an epic that already exists and inherits what it does not change. Run the yad-change skill — it triages which steps are inherited and then runs \`yad epic new <slug> --type ${type} --parent EP-<parent> --inherits <bases>\``);
  }
  if (!parent && flagInherits) {
    return bail('--inherits needs a parent', 'only a change, defect or hotfix carries steps by reference, from the epic named by --parent');
  }
  if (parent) {
    return seedThreaded(root, {
      epic, dir, files, mdPath, fm, type, parent, profile,
      inherits: flagInherits ?? declaredInherits ?? [], headerLists: declaredInherits !== null, today, json, bail,
    });
  }
  profile = profile || 'classic';

  // A STUB anchors a feature that was built before the Product existed, so a defect can thread off it
  // today. Two restrictions, both from what a stub IS rather than from anything technical:
  //   * always `classic`. A stub's whole chain is blocked behind the `backfill-pending` sentinel and
  //     `yad-backfill promote` wakes it at `epic`, so a route that starts somewhere else has nothing
  //     to wake into.
  //   * always `feature`. A stub is an anchor for shipped behaviour; upkeep leaves nothing to backfill
  //     and nothing to thread a defect off, so a `chore` stub would be an anchor for no feature.
  if (stub) {
    if (profile !== 'classic') {
      return bail(`a stub is always on the classic route, not '${profile}'`,
        '`yad-backfill promote` wakes a stub at its `epic` step, so a route starting anywhere else has nothing to wake into. Drop --profile');
    }
    if (type !== 'feature') {
      return bail(`a stub is always a feature, not a ${type}`,
        'a stub anchors behaviour that already shipped so a defect can thread off it. Upkeep leaves nothing to backfill. Drop --type');
    }
  }

  const known = lifecycleProfile(profile);
  const seedable = seedableProfiles();
  if (!seedable.includes(profile)) {
    return bail(
      known ? `the '${profile}' profile is not seeded from here` : `unknown lifecycle profile: ${profile}`,
      known
        // Today the only known-but-unseedable profiles are the two product routes, `discovery` and
        // `foundation`, and the reason is specific enough to be worth naming rather than listing the
        // alternatives again.
        ? `'${profile}' is the Product level, not an epic on the ladder: one per product, a fixed id, no epic.md and no work-item type. Run \`yad foundation new\` for it`
        : `pick one of ${seedable.join(' · ')}`,
    );
  }

  const state = seedState({ epic, profile, type, today, stub });
  writeState(files.state, state);
  // E19: the index lists the new work item — on the default branch of a local Product only; `quiet`
  // keeps a --json stdout one document.
  refreshIndexAfterWrite(root, readJSON(productConfigPath(root), null), { quiet: json });
  // The two ledgers the gate appends to, and the folder its markdown lands in. Empty is their correct
  // starting value: an approval is written only by a real review, never by a seed.
  for (const f of [files.approvals, files.comments]) if (!fs.existsSync(f)) writeJSON(f, []);
  fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });

  const first = state.steps[0];
  // A stub has no runnable step — its whole chain is blocked behind the sentinel — so the skill it
  // names is the one that wakes it, not the one that would have authored its first step.
  //
  // Everything else asks the PROJECT first (E6): a team that bound its own skill to `epic` must be
  // told to run that one, or this command would hand a brand-new epic straight to a skill their
  // `yad next` will never name again. `yad-backfill` is the one exception, because waking a stub is
  // the engine's own `promote` verb rather than a step on any chain.
  const skills = stub ? ['yad-backfill'] : stepSkills(first.id, loadSkillBindings(root));
  const skill = skills[0] || null;
  // `nextSkills` appears only for a bound chain, the same rule `yad next --json` follows — a key that
  // showed up on every seed would be one more always-null field for every reader to ignore.
  if (json) {
    return emitJSON({
      ok: true, epic, type, profile, stub, currentStep: state.currentStep,
      steps: state.steps.map((s) => s.id), next: skill,
      ...(skills.length > 1 ? { nextSkills: skills } : {}),
    });
  }
  ok(`${epic} seeded — ${stub ? 'stub anchor' : typeNoun(type)} on the ${c.bold(profile)} route (${state.steps.length} steps)`);
  info(`chain: ${state.steps.map((s) => (!stub && s.id === first.id ? c.bold(s.id) : s.id)).join(' → ')}`);
  hand(stub
    ? `every step is blocked behind \`${state.currentStep}\` — document the code with the ${skill} skill, then \`yad-backfill promote\` to wake the chain. Defects can thread off it now`
    : `${first.id} is open${skill ? ` — run the ${skills.join(' skill, then the ')} skill to author ${first.artifact}` : ''}`);
  // Closed decision 7: every surface that prints a chain of more than one says what the extra runs
  // cost. This one prints a chain too.
  if (skills.length > 1) info(`${skills.length} skills run for this step, one after another — each one costs tokens`);
  // Only worth saying when there is no header yet. When one exists it is where the type came FROM, so
  // telling its author to go and write what they already wrote reads as the command not having looked.
  if (!fs.existsSync(mdPath) && !stub) {
    // BOTH keys, old name first. `kind:` is the one that is read — by `workItemType` here and by
    // `lineage-check.sh` inside the user's own repo, which is refreshed by a different command
    // (`yad update`) with no ordering against this one. A header carrying only `type:` reads to that
    // gate as an epic with no type at all.
    info(`epic.md is authored by ${skills.length > 1 ? 'those skills' : 'that skill'}, not by this command. Give it \`kind: ${type}\` and \`type: ${type}\` so the ledger and the header agree.`);
  }
  // Nothing was committed here, and on a verified Product the seed HAS to ride the first review PR:
  // `ledger-guard` exempts a new epic's ledger only while it is absent from the base ref (creation,
  // not mutation, #162). Left uncommitted until then, it lands by no path at all.
  info('commit the seed on this epic\'s authoring branch — it reaches the default branch through the first review PR/MR.');
}

// `a,b`, `a b` and `[a, b]` all name the same list — the flag is typed, the header is YAML-ish.
const listOf = (v) => (Array.isArray(v) ? v : String(v ?? '').replace(/^\s*\[|\]\s*$/g, '').split(/[\s,]+/))
  .map((x) => String(x).trim()).filter(Boolean);

// The threaded half of `yad epic new` (E42): a change, defect or hotfix off an epic that exists. The
// engine plans the chain from the parent (`planThreadedSeed`) and this writes it — the ledger, one
// provenance record per inherited gate, and the pointer-lock when the contract is carried.
function seedThreaded(root, { epic, dir, files, mdPath, fm, type, parent, profile, inherits, headerLists, today, json, bail }) {
  const plan = planThreadedSeed(root, { epic, parent, inherits, type, today });
  if (!plan.ok) return bail(plan.message, plan.hint);
  // The route is the parent's. A flag naming the same one is harmless; a different one is refused
  // rather than obeyed, because a child on another route would inherit steps its route does not have.
  if (profile && profile !== plan.profile) {
    return bail(`a change takes its parent's route — ${parent} is on '${plan.profile}', --profile says '${profile}'`,
      'drop --profile. To change the route, start a new epic instead of threading one');
  }
  const declaredThread = typeof fm.thread === 'string' && fm.thread.trim() ? fm.thread.trim() : null;
  // A header that EXISTS must carry the lineage too. `resolveThread` reads only epic.md, so a header with
  // no `parent:` reads as a genesis of its own, and one with no `thread:` is a broken lineage the moment
  // it is seeded — a ledger nobody's thread view can find.
  if (fs.existsSync(mdPath) && !(typeof fm.parent === 'string' && fm.parent.trim())) {
    return bail(`${epic}: epic.md has no \`parent:\``,
      `add \`parent: ${parent}\` (and \`thread: ${plan.thread}\`) to epic.md — \`yad thread\` reads the header, not the flag`);
  }
  if (fs.existsSync(mdPath) && !declaredThread) {
    return bail(`${epic}: epic.md has no \`thread:\` — add \`thread: ${plan.thread}\``,
      'the thread is the genesis of the parent\'s line, and a change without the cache reads as a broken lineage');
  }
  if (declaredThread && declaredThread !== plan.thread) {
    return bail(`${epic}: epic.md says \`thread: ${declaredThread}\`, but ${parent}'s thread starts at ${plan.thread}`,
      `set \`thread: ${plan.thread}\` in epic.md — the thread is the genesis of the parent's line`);
  }
  // Refuse before writing anything. An existing lock is somebody's record, and nothing here overwrites one.
  if (plan.lock && fs.existsSync(files.contractLock)) {
    return bail(`${epic} already has a contract-lock.json`,
      'nothing here overwrites a lock. Remove it only if it is left over from a mistake, then run this again');
  }
  // The same for an approvals ledger holding anything at all. An empty list is what a seed writes, so it
  // is the one value that is safe to replace; a file that will not parse is not.
  if (fs.existsSync(files.approvals)) {
    const held = readJSON(files.approvals, null);
    if (!Array.isArray(held) || held.length) {
      return bail(`${epic} already has an approvals.json with records in it`,
        'nothing here overwrites an approval. Remove it only if it is left over from a mistake, then run this again');
    }
  }

  writeState(files.state, plan.state);
  refreshIndexAfterWrite(root, readJSON(productConfigPath(root), null), { quiet: json }); // E19, as above
  writeJSON(files.approvals, plan.approvals);
  if (!fs.existsSync(files.comments)) writeJSON(files.comments, []);
  fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });
  if (plan.lock) writeJSON(files.contractLock, plan.lock);

  const { state } = plan;
  const first = state.steps.find((s) => s.id === state.currentStep);
  const skills = stepSkills(first.id, loadSkillBindings(root));
  const carried = state.steps.filter((s) => s.inherited);
  if (json) {
    return emitJSON({
      ok: true, epic, type, profile: plan.profile, stub: false, parent, thread: plan.thread,
      inherits, inheritedFrom: plan.owners, pointerLock: plan.lock ? plan.lock.ref : null, anchor: plan.anchor,
      currentStep: state.currentStep, steps: state.steps.map((s) => s.id), next: skills[0] || null,
      ...(skills.length > 1 ? { nextSkills: skills } : {}),
    });
  }
  ok(`${epic} seeded — ${typeNoun(type)} threaded off ${parent}, on its ${c.bold(plan.profile)} route (${state.steps.length} steps, ${carried.length} carried by reference)`);
  info(`chain: ${state.steps.map((s) => (s.inherited ? c.dim(`${s.id}←${s.inheritedFrom}`) : s.id === first.id ? c.bold(s.id) : s.id)).join(' → ')}`);
  if (plan.lock) {
    info(`contract-lock.json points at ${plan.lock.inheritedFrom}'s lock (${plan.lock.hash.slice(0, 19)}…) — there is no contract.md here, so the surface cannot drift`);
  } else if (state.steps.some((s) => s.id === 'architecture' && !s.inherited)) {
    info('architecture is authored here — the change re-locks the contract, and its review is escalated');
  }
  if (plan.anchor) warn('a base is carried from a brownfield anchor — no hash and no contract lock yet; protection starts when the anchor is promoted');
  if (!carried.length) info('nothing is carried by reference — every step runs on this epic');
  hand(`${first.id} is open${skills.length ? ` — run the ${skills.join(' skill, then the ')} skill to author ${first.artifact}` : ''}`);
  if (!fs.existsSync(mdPath)) {
    info(`epic.md is authored by the yad-change skill, not by this command. Give it \`kind: ${type}\`, \`type: ${type}\`, \`parent: ${parent}\`, \`thread: ${plan.thread}\` and \`inherits: [${inherits.join(', ')}]\` so the header and the ledger agree.`);
  } else if (!headerLists && inherits.length) {
    warn(`epic.md lists no \`inherits:\` — add \`inherits: [${inherits.join(', ')}]\`. \`yad thread\` reads the header, and without it this epic reads as the owner of what it carries`);
  }
  info('commit the seed on this epic\'s authoring branch — it reaches the default branch through the first review PR/MR.');
}

// `yad foundation new` — the ENGINE seeds the Product level (E75).
//
// The Foundation's ledger was the last product-level chain written by hand: `yad-discovery` carried a
// literal JSON block, the same kind of copy E17 retired from the feature skills. This writes it from
// the `foundation` route and the catalogue instead, into `foundation/.sdlc/`, with the same two empty
// ledgers and `reviews/` folder `yad epic new` writes.
//
// WHAT IT DOES NOT WRITE is the same as `yad epic new`: no section files, no branch, no commit. The
// sections are prose authored with the user by the skill the chain names next.
//
// TWO REFUSALS, both about there being ONE product level:
//   * a Foundation that already exists — nothing here overwrites a ledger, and there is no flag for it;
//   * a product still in its OLD spelling (`epics/EP-discovery/`). Seeding beside it would make two
//     product levels, which the roadmap calls a bug in as many words. That project converts with
//     `yad migrate` when its ledger is local; a verified one keeps using what it has, because CI owns
//     that ledger and cannot be asked to move it.
export async function runFoundationNew(root, { today, json = false } = {}) {
  const bail = (message, hint) => {
    if (json) emitJSON({ ok: false, error: message, hint });
    else { fail(message); if (hint) hand(hint); }
    process.exitCode = 1;
  };
  const files = epicFiles(epicRoot(root, FOUNDATION_EPIC));
  if (fs.existsSync(files.state)) {
    return bail(`this product already has its Foundation — ${path.relative(root, files.state)} exists`,
      `run \`yad next ${FOUNDATION_EPIC}\` to see where it is. Nothing here overwrites a ledger`);
  }
  const legacy = epicFiles(epicRoot(root, DISCOVERY_EPIC)).state;
  if (fs.existsSync(legacy)) {
    return bail(`this product already has a product level, in its old spelling — ${path.relative(root, legacy)}`,
      `a product has ONE Foundation. On a local ledger, \`yad migrate --apply\` converts that one into ${epicRel(FOUNDATION_EPIC)}/; on a verified ledger keep using it — \`yad next ${DISCOVERY_EPIC}\``);
  }
  // On a verified Product the ledger is protected only by the checks committed in the repo. If they
  // predate the Foundation, seeding one now would put its ledger where CI stops nobody from hand-editing
  // it — so refuse, rather than seed and leave `yad doctor` to warn about it afterwards (rule 6).
  const stale = isVerifiedLedger(readJSON(productConfigPath(root), null)) ? staleFoundationGuards(root) : [];
  if (stale.length) {
    return bail(`the wired checks predate the Foundation: ${stale.join(', ')} ${stale.length === 1 ? 'does' : 'do'} not know ${epicRel(FOUNDATION_EPIC)}/ — on this verified Product, CI would not protect its ledger`,
      'run `yad update`, commit the refreshed checks, then run `yad foundation new` again');
  }

  const state = seedFoundationState({ today });
  writeState(files.state, state);
  refreshIndexAfterWrite(root, readJSON(productConfigPath(root), null), { quiet: json }); // E19, as above
  for (const f of [files.approvals, files.comments]) if (!fs.existsSync(f)) writeJSON(f, []);
  fs.mkdirSync(path.join(epicRoot(root, FOUNDATION_EPIC), 'reviews'), { recursive: true });

  const skills = stepSkills(state.steps[0].id, loadSkillBindings(root));
  const skill = skills[0] || null;
  const required = FOUNDATION_SECTIONS.filter((s) => !s.optional).map((s) => s.file);
  const optional = FOUNDATION_SECTIONS.filter((s) => s.optional).map((s) => s.file);
  if (json) {
    return emitJSON({
      ok: true, epic: FOUNDATION_EPIC, profile: state.profile, currentStep: state.currentStep,
      steps: state.steps.map((s) => s.id), next: skill,
      ...(skills.length > 1 ? { nextSkills: skills } : {}),
      sections: { required, optional },
    });
  }
  ok(`${FOUNDATION_EPIC} seeded — the Product level, in ${epicRel(FOUNDATION_EPIC)}/ (${state.steps.length} steps)`);
  info(`chain: ${state.steps.map((s, i) => (i === 0 ? c.bold(s.id) : s.id)).join(' → ')}`);
  hand(`foundation is open${skill ? ` — run the ${skills.join(' skill, then the ')} skill to author ${epicRel(FOUNDATION_EPIC)}/` : ''}`);
  info(`sections: ${required.join(', ')} ${c.dim(`(optional: ${optional.join(', ')})`)}`);
  if (skills.length > 1) info(`${skills.length} skills run for this step, one after another — each one costs tokens`);
  info('then `yad gate open EP-foundation foundation/`. Commit the seed on the Foundation\'s authoring branch — it reaches the default branch through the first review PR/MR.');
}

// `yad foundation status` — which roadmap features are started, READ from the epic ledgers (E76
// follow-up). Read-only: it never writes `roadmap.md`, whose table is part of what the Foundation's
// reviewers approved. See `roadmapFeatures` / `featureStatus` in epic-state.mjs for the rules.
//
// Both spellings of the product level are read (rule 2): a product still in `epics/EP-discovery/` has
// the same `roadmap.md`, with a `Requirements` column the reader steps over.
//
// A hand-written `Status` cell is shown only when it disagrees with the ledger, as a note — that column
// is no longer kept by hand, and a person reading an older Foundation needs to be told which answer is
// current. `epic-started` was the old word for a seeded epic, so it agrees with `in-shape` and `in-build`.
const WRITTEN_AGREES = { 'epic-started': ['in-shape', 'in-build'] };
const writtenDisagrees = (written, status) => {
  if (!written || !status) return false;
  const w = written.toLowerCase();
  return w !== status && !(WRITTEN_AGREES[w] || []).includes(status);
};

export async function runFoundationStatus(root, { json = false } = {}) {
  const bail = (message, hint) => {
    if (json) emitJSON({ ok: false, error: message, hint });
    else { fail(message); if (hint) hand(hint); }
    process.exitCode = 1;
  };
  const present = PRODUCT_EPICS.filter((id) => fs.existsSync(epicFiles(epicRoot(root, id)).state));
  const productId = present[0];
  // Two product levels is a fault `yad doctor` fails on. The Foundation is the one read — the same
  // choice `yad next` makes — and the other is named, so the answer is never silently from one of two.
  const warnings = present.length > 1
    ? [`two product levels: ${present.map((id) => `${epicRel(id)}/`).join(' and ')} — reading ${productId}; run \`yad doctor\``]
    : [];
  if (!productId) {
    return bail('this product has no Foundation yet, so there is no roadmap to read',
      'run `yad foundation new`, then the yad-discovery skill — its roadmap.md lists the features');
  }
  const dir = epicRoot(root, productId);
  const file = path.join(dir, 'roadmap.md');
  const rel = path.relative(root, file);
  if (!fs.existsSync(file)) return bail(`${rel} does not exist yet`, 'write the roadmap with the yad-discovery skill');

  let productState = null;
  try { productState = loadLedger(dir).state; } catch { /* `yad doctor` reports an unreadable ledger */ }
  const approved = PRODUCT_DONE.includes(productState?.currentStep);
  const features = roadmapFeatures(fs.readFileSync(file, 'utf8')).map((row) => {
    if (!isValidEpicId(row.epicId) || PRODUCT_EPICS.includes(row.epicId)) {
      return { ...row, status: null, problem: 'not a valid feature epic id' };
    }
    try {
      const epicDir = epicRoot(root, row.epicId);
      const status = featureStatus(loadLedger(epicDir), { stories: epicStories(epicDir) });
      return { ...row, status, ...(writtenDisagrees(row.written, status) ? { disagrees: true } : {}) };
    } catch {
      return { ...row, status: null, problem: 'its ledger does not load — run `yad doctor`' };
    }
  });
  // Feature epics no row proposes. `yad-epic` assigns the id, and it may not be the proposed one, so this
  // is where a started feature would otherwise disappear. Change, defect and hotfix epics are work ON a
  // feature, never a roadmap row, so they are not named.
  //
  // Only a folder with a ledger counts: an empty `epics/EP-x/` is not an epic. The type comes from
  // `epic.md` when it exists (that is where the author wrote it) and from the ledger's own `type` when it
  // does not — a `yad epic new --type chore` has no `epic.md` yet, and reading that absence as `feature`
  // would list a chore. Anything that cannot be read is left to `yad doctor`, never allowed to throw here.
  const listed = new Set(features.map((f) => f.epicId));
  const unlisted = epicIds(root).filter((id) => {
    if (PRODUCT_EPICS.includes(id) || listed.has(id)) return false;
    try {
      const state = loadLedger(epicRoot(root, id)).state;
      if (!state) return false;
      const type = fs.existsSync(path.join(epicRoot(root, id), 'epic.md')) ? epicLineage(root, id).type : state.type;
      return type === 'feature';
    } catch { return false; }
  });

  if (json) {
    return emitJSON({ ok: true, epic: productId, roadmap: rel, approved, features, unlisted, ...(warnings.length ? { warnings } : {}) });
  }
  for (const w of warnings) warn(w);
  log(`\n  ${c.bold(`${productId} roadmap`)}  ${c.dim(`${rel} — each status is read from the epic ledgers`)}`);
  if (!approved) info(c.dim('the Foundation has not passed its review yet, so this roadmap is still a draft'));
  if (!features.length) warn(`${rel} has no feature table — a table whose header has a "Proposed epic id" column`);
  let phase;
  for (const f of features) {
    if (f.phase !== phase) { phase = f.phase; log(`  ${c.bold(phase || '(no heading)')}`); }
    const name = `${f.feature || '(no name)'}  ${c.dim(f.epicId || '(no id)')}`;
    if (f.problem) { log(`    ${c.yellow('!')} ${name}  ${c.yellow(f.problem)}`); continue; }
    const mark = f.status === 'shipped' ? c.green('✓') : f.status === 'planned' ? c.dim('·') : c.cyan('•');
    log(`    ${mark} ${name}  ${f.status}`);
    if (f.disagrees) log(`      ${c.dim(`the row says "${f.written}" — that column is no longer kept by hand; the ledger's answer is shown`)}`);
  }
  if (unlisted.length) {
    info(`not on the roadmap: ${unlisted.join(', ')} ${c.dim('(feature epics no row proposes — an epic may have been given a different id)')}`);
  }
  const next = features.find((f) => f.status === 'planned');
  if (next) hand(`next planned feature: ${next.feature || next.epicId} — seed it with the yad-epic skill (proposed id ${next.epicId})`);
}
