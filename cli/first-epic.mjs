// The first setup epic the guide proposes once the Foundation has passed (EP-foundation-first-epic-S02).
//
// `bootstrap` for a new project, `pack` for an existing one: the kind that matches the setup answer
// (`profile.codebase` in product.json) comes first, then the other, each only while no epic of that kind
// exists. It is a PROPOSAL: the agent shows the person the command, and runs it only on their yes. Nothing
// here writes anything. The shape is the epic's locked contract (`firstEpic`, `FirstEpicProposal`).
import fs from 'node:fs';
import { c, hand, info } from './lib.mjs';
import { PRODUCT_DONE, PRODUCT_EPICS, SEED_KINDS, epicIds, epicRoot, loadLedger, nextAction } from './epic-state.mjs';

// One sentence for the person, per kind: what the epic does on a project of its kind, and what it does
// when offered beside the matching one (a brownfield project adding a repo that does not exist yet).
const WHY = {
  bootstrap: {
    matches: 'A new project: make the code repos, their tooling and CI, the design system, and one thin path deployed.',
    other: 'For any repo in repos.md that does not exist yet: make it, its tooling and CI, and one thin path deployed.',
  },
  pack: {
    matches: 'An existing project: bring the features already built into yadflow, one story per feature.',
    other: 'For code that already exists: bring the features already built into yadflow, one story per feature.',
  },
};

// The Product level's id, when it has passed its review (the Foundation, or the old `discovery` spelling).
function passedProductLevel(root) {
  const ids = epicIds(root);
  for (const id of PRODUCT_EPICS) {
    if (!ids.includes(id)) continue;
    let ledger;
    try { ledger = loadLedger(epicRoot(root, id)); } catch { return null; }
    if (!ledger?.state) return null;
    return PRODUCT_DONE.includes(nextAction(ledger, { epic: id }).kind) ? id : null;
  }
  return null;
}

// The seed kinds that already have an epic, in any state — or null when a ledger does not load. Unknown is
// not "none": that ledger may be the setup epic, and proposing it again would seed a second one.
function usedKinds(root) {
  const used = new Set();
  for (const id of epicIds(root)) {
    if (PRODUCT_EPICS.includes(id)) continue;
    try {
      const seed = loadLedger(epicRoot(root, id))?.state?.seed;
      if (SEED_KINDS.includes(seed)) used.add(seed);
    } catch { return null; }
  }
  return used;
}

// `EP-bootstrap`, or `EP-bootstrap-2`, `-3`, … when the id is taken by any folder under epics/.
function freeId(root, seed) {
  for (let n = 1; ; n += 1) {
    const id = `EP-${seed}${n === 1 ? '' : `-${n}`}`;
    if (!fs.existsSync(epicRoot(root, id))) return id;
  }
}

// `{ proposals, optional: true }`, or null: no Foundation that has passed, or every kind has an epic.
// `productConfig` is product.json as read; a missing `profile.codebase` reads as greenfield (setup's default).
export function firstEpicProposal(root, productConfig) {
  if (!passedProductLevel(root)) return null;
  const matching = productConfig?.profile?.codebase === 'brownfield' ? 'pack' : 'bootstrap';
  const used = usedKinds(root);
  if (!used) return null;
  const proposals = [matching, ...SEED_KINDS.filter((k) => k !== matching)]
    .filter((seed) => !used.has(seed))
    .map((seed) => {
      const proposedEpic = freeId(root, seed);
      const matches = seed === matching;
      return {
        seed,
        proposedEpic,
        command: `yad epic new ${proposedEpic.replace(/^EP-/, '')} --seed ${seed} --profile classic`,
        matches,
        why: WHY[seed][matches ? 'matches' : 'other'],
      };
    });
  return proposals.length ? { proposals, optional: true } : null;
}

// The words the person is asked, naming the kinds on offer.
export const firstEpicChoice = (fe) => `Say whether to start the ${fe.proposals.map((p) => p.seed).join(' or the ')} epic, or a roadmap item.`;

// The printed lines (ui-design.md §1): one `→` line per proposal, its `why` dim beneath, then the way out.
export function printFirstEpic(fe, { epicSkill = 'yad-epic' } = {}) {
  fe.proposals.forEach((p, i) => {
    hand(`${i === 0 ? 'propose' : 'or'} the ${p.seed} epic: ${c.bold(p.command)}`);
    info(c.dim(`  (${p.why.replace(/\.$/, '')})`));
  });
  info(c.dim(`optional — or pick a roadmap item and invoke the ${epicSkill} skill (\`yad foundation status\` shows which are started)`));
}
