// `yad mode` / `yad mode solo --reason <text>` / `yad mode team [--reason <text>]` — who must approve (E10).
//
// Solo mode waives the approval requirement on every review gate: the merge and the resolved threads
// still decide. Until E10 only `yad setup --solo` / `--team <n>` set it, and nothing recorded who turned it
// on, when, or why. This command sets it and records that.
//
// TWO NAMES, THE OLD ONE DECIDES. The roadmap's word is `mode: solo | team`. It is written beside the
// `solo` flag every reader already knows — the gate, `yad next`, `yad doctor`, and CI in the user's repo
// running whatever release it pins — and `solo` stays the one READ for this major (the staged-rename
// pattern). `yad doctor` warns when a hand edit leaves the two disagreeing (`mode:disagree`).
//
// NOTHING LOOKS BACK. A gate that already passed keeps its closing record. An open review follows the new
// mode from its next sync, and this command names each one, so the change is never a surprise.
//
// A REASON FOR SOLO. Turning solo on stops every open gate from counting approvals, CI's included on a
// verified Product, so it needs `--reason`. Turning it off makes the gates stricter, and the reason is
// optional — the same split as `yad kill` / `yad unkill`.
import path from 'node:path';

import { c, fail, hand, info, log, ok, readJSONStrict, warn, writeProductConfig } from './lib.mjs';
import { isVerifiedLedger, productConfigPath, PROJECT_FILES } from './manifest.mjs';
import { epicIds, epicRoot, loadLedger, stepStatus } from './epic-state.mjs';
import { isSolo } from './gate.mjs';
import { recordActor } from './skip.mjs';

export const MODES = ['solo', 'team'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// The mode the gates act on today. Read from `solo` (and the older `review_gate.solo`), never from `mode`.
export const modeOf = (hub) => (isSolo(hub) ? 'solo' : 'team');

// PURE. The fields a write of mode `to` puts on the Product config, given what is there now. Shared by this
// command and `yad setup`, so the two writers can never spell the switch differently (staged-rename trap 1).
//   solo / mode   always both, in step.
//   review_gate   `review_gate.solo: true` also switches solo on, so switching to team turns it off too;
//                 otherwise the old flag would keep the gates waived under a file that says `team`.
//   mode_set      only when the mode the gates act on actually changes: who, when, why, and from what.
export function modeFields(hub, to, { by = null, date = null, reason = null } = {}) {
  const cur = isObj(hub) ? hub : {};
  const from = modeOf(cur);
  const fields = { solo: to === 'solo', mode: to };
  if (to === 'team' && isObj(cur.review_gate) && cur.review_gate.solo === true) {
    fields.review_gate = { ...cur.review_gate, solo: false };
  }
  if (from !== to) fields.mode_set = { from, to, by: by || null, date: date || null, reason: reason || null };
  return fields;
}

// PURE. What `yad mode <to>` would do.
//   changed: false          the file already says it both ways — nothing to write.
//   flipped: true           the gates act differently from the next sync; `mode_set` records it.
//   flipped: false, changed the gates act the same, and the new name is added beside the old one.
export function planMode(hub, { to, reason = null, by = null, date = null } = {}) {
  if (!MODES.includes(to)) {
    return { ok: false, message: `unknown mode: ${to ?? '(none)'}`, hint: 'usage: yad mode [solo --reason "<why>" | team [--reason "<why>"]]' };
  }
  const cur = isObj(hub) ? hub : {};
  const from = modeOf(cur);
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (from !== to && to === 'solo' && !why) {
    return {
      ok: false,
      message: 'turning solo mode on needs a reason',
      hint: 'yad mode solo --reason "<why>" — every open review gate stops counting approvals, CI\'s included',
    };
  }
  const fields = modeFields(cur, to, { by, date, reason: why || null });
  const next = { ...cur, ...fields };
  const changed = Object.keys(fields).some((k) => JSON.stringify(cur[k]) !== JSON.stringify(fields[k]));
  return { ok: true, from, to, flipped: from !== to, changed, hub: next };
}

// Every review gate that is open right now, across the feature epics and the Foundation. These are the ones
// whose rule changes with the mode; a passed gate keeps its record and a gate not yet opened reads the mode
// when it opens. An epic whose ledger cannot be read is left out here — `yad doctor` names it.
export function openReviews(root) {
  const out = [];
  for (const epic of epicIds(root)) {
    let state;
    try { state = loadLedger(epicRoot(root, epic)).state; } catch { continue; }
    for (const s of Array.isArray(state?.steps) ? state.steps : []) {
      if (s?.type === 'review+approve' && stepStatus(s) === 'in_review') out.push({ epic, step: s.id });
    }
  }
  return out;
}

const makeBail = (json) => (message, hint) => {
  if (json) log(JSON.stringify({ ok: false, error: message, hint: hint || null }, null, 2));
  else { fail(message); if (hint) hand(hint); }
  process.exitCode = 1;
};

const MEANING = {
  solo: 'review gates stop counting approvals — the merge and the resolved threads decide, and each gate that passes records `waived: "solo"`',
  team: 'review gates count approvals again',
};

const setLine = (set) => {
  if (!isObj(set)) return '';
  const who = [set.by ? `by ${set.by}` : '', set.date ? `on ${set.date}` : ''].filter(Boolean).join(' ');
  return `set to ${set.to}${set.from ? ` from ${set.from}` : ''}${who ? ` ${who}` : ''}${set.reason ? `: ${set.reason}` : ''}`;
};

// `yad mode` reads; `yad mode solo|team` sets.
export async function runMode(root, { to = null, reason = null, json = false, today = null } = {}) {
  const bail = makeBail(json);
  const file = productConfigPath(root);
  const rel = path.relative(root, file).split(path.sep).join('/');
  let hub;
  try {
    hub = readJSONStrict(file, null);
  } catch {
    return bail(`${rel} does not parse — nothing is written over it`, 'fix the JSON or restore it from git, then run this again');
  }
  if (hub !== null && !isObj(hub)) return bail(`${rel} has the wrong shape — nothing is written over it`, 'expected a JSON object; fix it or re-run `yad setup`');

  if (to === null) {
    const mode = modeOf(hub);
    const name = isObj(hub) && hub.mode !== undefined ? hub.mode : null;
    const set = isObj(hub) && isObj(hub.mode_set) ? hub.mode_set : null;
    if (json) return log(JSON.stringify({ ok: true, mode, name, agrees: name === null || name === mode, set }, null, 2));
    ok(`mode: ${mode} — ${MEANING[mode]}`);
    if (!hub) info('no Product config yet — team mode is the default; `yad setup` records it');
    if (set) info(setLine(set));
    if (name !== null && name !== mode) warn(`the file also says mode: ${JSON.stringify(name)}, but the old \`solo\` flag is the one read — run \`yad mode ${mode}\` to make them agree`);
    return;
  }

  // The word is checked first, so a typo on a fresh directory is named as a typo, not as a missing setup.
  if (!MODES.includes(to)) return bail(`unknown mode: ${to}`, 'usage: yad mode [solo --reason "<why>" | team [--reason "<why>"]]');
  if (!hub) return bail(`no Product config at ${rel}`, 'run `yad setup` first — it records the mode with everything else');
  const plan = planMode(hub, { to, reason, by: recordActor(root), date: today });
  if (!plan.ok) return bail(plan.message, plan.hint);
  if (plan.changed) writeProductConfig(root, plan.hub);
  // On a verified Product CI writes the ledger only at a merge, so an open review is never `in_review` in
  // state.json — the platform's open PRs are the list. Say so, rather than print nothing and read as "none".
  const verified = isVerifiedLedger(hub);
  const open = plan.flipped && !verified ? openReviews(root) : [];
  if (json) {
    return log(JSON.stringify({ ok: true, mode: to, changed: plan.changed, flipped: plan.flipped, set: plan.flipped ? plan.hub.mode_set : null, openReviews: open, openReviewsKnown: !verified }, null, 2));
  }
  if (!plan.changed) return ok(`already ${to} — nothing changed`);
  if (!plan.flipped) {
    // Reached two ways: `mode` was absent (a Product set up before E10), or a hand edit left it saying the
    // other mode — which is where `mode:disagree` sends people. Say which one happened.
    const what = hub.mode === undefined ? 'the new name `mode` was added beside `solo`' : '`mode` now matches `solo`';
    ok(`already ${to} — ${what}; the gates act exactly as before`);
  } else {
    ok(`mode: ${to} — ${MEANING[to]}`);
    if (plan.hub.mode_set.reason) info(`reason: ${plan.hub.mode_set.reason}`);
    if (verified) {
      info(`this Product's ledger is verified, so its open reviews live on the platform, not in state.json — every open review PR/MR follows the ${to} rule from its next CI run`);
    } else if (open.length) {
      info(`${open.length} open review(s) follow the ${to} rule from their next sync: ${open.map((r) => `${r.epic} ${r.step}`).join(', ')}`);
    }
    info(c.dim('a gate that already passed keeps its record'));
    if (to === 'solo') info(c.dim('`yad doctor` warns if branch protection still requires an approval you cannot give yourself'));
  }
  const back = to === 'solo' ? 'yad mode team' : 'yad mode solo --reason "<why>"';
  hand(`commit ${PROJECT_FILES.productConfig} and ${PROJECT_FILES.hubConfig} so every machine and CI run sees it  (reverse with \`${back}\`)`);
}
