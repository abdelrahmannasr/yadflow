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
// TWO DO NOT, and neither is an oversight. `yad-discovery` seeds the product front-zero, which E75
// absorbs into Foundation. `yad-change` seeds a THREADED chain: its inherited steps are pre-marked
// done and bound to the parent's artifact hashes, its approvals ledger carries a provenance record per
// inherited gate, and an inherited architecture materialises a pointer contract-lock — inheritance is
// E42's, and the depth triage that decides which steps are inherited is a design, not a flag. Both are
// refused here by name rather than half-supported.
//
// The seed is still built key-by-key in the order those templates used, because the chains on disk in
// every existing project were written that way and a re-seeded epic must not churn their bytes.
import fs from 'node:fs';
import path from 'node:path';

import { c, fail, hand, info, log, ok } from './lib.mjs';
import {
  DISCOVERY_EPIC, epicRoot, isGenesisType, isValidEpicId, lifecycleProfile, loadSkillBindings,
  readFrontmatter, seedableProfiles, seedState, stepSkills, typeNoun, WORK_ITEM_TYPES, workItemType,
  writeJSON, writeState,
} from './epic-state.mjs';
import { epicFiles } from './manifest.mjs';

// The genesis types — the two a work item may be without naming a parent. A `change`, `defect` or
// `hotfix` describes work ON something that already exists, and its chain is NOT a plain route: the
// inherited steps are pre-marked done and bound to the parent's artifact hashes, `approvals.json` is
// seeded with one provenance record per inherited gate, and an inherited architecture materialises a
// pointer contract-lock (yad-change, Step 5). Seeding a bare profile for one of those would produce an
// epic that looks threaded and re-reviews everything its parent already approved — wrong, not merely
// incomplete. So this command refuses them and sends the user to the skill that does it properly.
const SEEDABLE_TYPES = WORK_ITEM_TYPES.filter(isGenesisType);

// `foo`, `EP-foo` and `epics/EP-foo` all name the same epic. Accepting only one spelling would make the
// command reject the id the user just read out of `yad next`.
export function epicIdFrom(slug) {
  const raw = String(slug || '').trim().replace(/^epics\//, '').replace(/\/+$/, '');
  if (!raw) return null;
  return raw.startsWith('EP-') ? raw : `EP-${raw}`;
}

// `type` defaults to null rather than `feature` so an explicit `--type` is distinguishable from no
// flag at all — which is what lets an existing `epic.md` supply the answer without overriding the user.
export async function runEpicNew(root, { slug, type = null, profile = 'classic', stub = false, today, json = false } = {}) {
  const bail = (message, hint) => {
    if (json) log(JSON.stringify({ ok: false, error: message, hint }, null, 2));
    else { fail(message); if (hint) hand(hint); }
    process.exitCode = 1;
  };

  const epic = epicIdFrom(slug);
  if (!epic) return bail(`usage: yad epic new <slug> [--type feature|chore] [--profile ${seedableProfiles().join('|')}]`);
  // The id becomes a path segment under epics/ — reject anything but EP-<slug> outright, the same
  // guard every other epic-taking command applies.
  if (!isValidEpicId(epic)) return bail(`invalid epic id: ${epic} (expected EP-<slug>, [a-z0-9-] only)`);
  // The front-zero's id is RESERVED, and refusing the profile is not enough to protect it: the route
  // defaults to `classic`, so `yad epic new discovery` would have written a 10-step feature chain onto
  // the one id a product may only ever have one of — with no `kind: "discovery"` marker, which is what
  // every reader of the front-zero keys off. Worse, it would then be permanent: the next run refuses
  // the id as already seeded, and `yad-discovery` would be authoring over a foreign ledger.
  if (epic === DISCOVERY_EPIC) {
    return bail(`${DISCOVERY_EPIC} is the product front-zero, not an epic on the ladder`,
      'it is one per product, has no epic.md and no work-item type, and its ledger carries a `kind: "discovery"` marker this command does not write. Run the yad-discovery skill for it');
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
  if (fs.existsSync(mdPath)) {
    const fm = readFrontmatter(mdPath);
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

  if (!SEEDABLE_TYPES.includes(type)) {
    const known = WORK_ITEM_TYPES.includes(type);
    return bail(
      known
        ? `a ${type} epic cannot be seeded from a plain profile`
        : `unknown work-item type: ${type}`,
      known
        ? `a ${type} threads off an epic that already exists, so its chain inherits that epic's approved steps rather than re-running them. Run the yad-change skill, which seeds the inheritance and the provenance records too`
        : `a work item is one of ${WORK_ITEM_TYPES.join(' · ')}; this command seeds ${SEEDABLE_TYPES.join(' and ')}`,
    );
  }

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
        // Today the only known-but-unseedable profile is `discovery`, and the reason is specific
        // enough to be worth naming rather than listing the alternatives again.
        ? `'${profile}' is the product front-zero, not an epic on the ladder: one per product, a fixed id, no epic.md and no work-item type. Run the yad-discovery skill for it`
        : `pick one of ${seedable.join(' · ')}`,
    );
  }

  const state = seedState({ epic, profile, type, today, stub });
  writeState(files.state, state);
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
    return log(JSON.stringify({
      ok: true, epic, type, profile, stub, currentStep: state.currentStep,
      steps: state.steps.map((s) => s.id), next: skill,
      ...(skills.length > 1 ? { nextSkills: skills } : {}),
    }, null, 2));
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
