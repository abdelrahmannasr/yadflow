#!/usr/bin/env node
// The `hub` keep list (E124) — every `hub` that survives the `hub` → `Product` rename, sorted by the
// reason it stays. A hit that no rule claims is a miss, and a miss fails.
//
// E30 kept its list in a commit message, and "nothing left" was remembered rather than re-run. This is
// the re-runnable form: `node scripts/hub-keep-list.mjs` scans every file git tracks, and a test in
// cli/test.mjs runs it, so a new `hub` in code, a skill or a doc fails the suite until it is renamed or
// given a rule here.
//
// A hit is any `hub`, in any case, that is not the end of `github` (`GitHub`, `GITHUB_TOKEN`). The test
// is made per match, not per line, so a line that says `GitHub` does not hide a `hub` beside it.
//
// Each rule is as narrow as its reason. A rule that matched the bare word would hide every miss, which
// is how an earlier keep list went wrong (`docs/roadmap-idea-1.md`, E30). So a line rule claims only the
// characters its pattern covers: `.sdlc/hub.json` on a line keeps that one hit, not a second `hub`
// beside it.
//
//   node scripts/hub-keep-list.mjs           print the misses and a count per rule; exit 1 on a miss
//   node scripts/hub-keep-list.mjs --rules   also print how many hits each rule kept, per file
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A `hub` that is not the tail of `github`, in any case.
export const HIT = /(?<!git)hub/gi;

// Whole files that keep every `hub` they hold. Each is history, or a copy of an old release that a test
// compares against, or a guide whose job is to name the old names.
export const FILE_RULES = [
  { rule: 'history', why: 'the release history — old entries keep the words they shipped with', test: (f) => f === 'CHANGELOG.md' },
  { rule: 'history', why: 'the decision record — each row keeps the words of the day it was decided', test: (f) => f === 'docs/roadmap-idea-1.md' },
  { rule: 'history', why: 'notes written before the rename, kept as they were', test: (f) => f === 'RESEARCH-NOTES.md' || f === 'docs/phase-4-build-plan.md' },
  { rule: 'migration-guide', why: 'a shape guide describes the files of its own day', test: (f) => /^docs\/migrations\/shape-\d+\.md$/.test(f) },
  { rule: 'migration-guide', why: 'the hub → Product guide names every old name, with a before and after', test: (f) => f === 'docs/migrations/hub-to-product.md' },
  { rule: 'v3-fixture', why: 'a frozen v3 project — the golden test feeds it in unchanged', test: (f) => f.startsWith('cli/fixtures/golden-v3/') },
  { rule: 'v3-fixture', why: 'the ledger guard as 3.18.1 shipped it — tests run the old gate against new files', test: (f) => f === 'cli/fixtures/ledger-guard-v3.18.1.sh' },
  { rule: 'installed-copy', why: "this repo's own installed gate, replaced by the next `yad update` here; until then it carries a hand-applied permission and action-pin fix, not the template's other changes", test: (f) => f === '.github/workflows/yad-gate-sync.yml' },
  { rule: 'not-a-word', why: 'a lockfile hash — base64 that happens to spell hub', test: (f) => f.endsWith('package-lock.json') },
  { rule: 'keep-list', why: 'this script, which must spell every form it keeps', test: (f) => f === 'scripts/hub-keep-list.mjs' },
];

// Rules that keep only the characters their pattern covers. `re` must be global.
export const LINE_RULES = [
  // Read until v5 — E122's ladder. `hub.json` / `hub-prs.json` are still read and written beside the
  // new names, and the environment variable is still honoured. The escaped forms are the same names
  // inside a regular expression; `(product|hub)\.json` is a gate's grep for either name.
  { rule: 'old-file-name', why: 'hub.json / hub-prs.json are read and mirrored until v5 deletes them (E122)', re: /hub(?:-prs)?\\?\.json/gi },
  { rule: 'old-file-name', why: 'the per-epic mirror named without its extension', re: /\bhub-prs\b/g },
  { rule: 'old-file-name', why: "a gate's grep for either settings name", re: /\(product\|hub\)\\\.json/g },
  { rule: 'old-env-var', why: 'SDLC_HUB_CONFIG is honoured until v5 (E122)', re: /SDLC_HUB_CONFIG/g },
  // Old installed names — E123 removes or rewrites them in users' repos, so the code that does it must
  // spell them. No word boundary in front: a test writes them after a `\n` inside a string.
  { rule: 'old-installed-name', why: 'the pre-E123 workflow, skill, route script, template folder and GitLab jobs', re: /(?:yad|sdlc)-hub-[a-z0-9-]*|\.yad_hub_mr_only|hub-route\.sh|templates\/hub\b|hub-config\.md/g },
  // A name in the code for a file that really is still called hub (the user's call, 2026-09-30).
  { rule: 'legacy-referent', why: 'a variable that holds an old hub-named file or its path', re: /\boldHubChecks\b|\bhubPath\b|legacy \? 'hub'/g },
  // `yad migrate --keep hub` names the old FILE, hub.json, so it keeps the word (E122).
  { rule: 'keep-flag', why: '`--keep hub` picks the copy under the old name', re: /--keep (?:product\|)?hub\b|KEEP_CHOICES = \['product', 'hub'\]|keep === 'product' \? 'hub'|keep === 'hub' \? \['hub', 'product'\] : \['product', 'hub'\]|keep: 'hub'|keep of \['hub', 'product'\]|\[\['hub', \[\{ login|return 'hub';|product or hub\b|or hub \\?\(the old name\\?\)/g },
  // The roster's `roles.hub` key: the shape-3 step reads it and adds `product` beside it (E30); tests
  // feed it old rosters.
  { rule: 'old-roster-role', why: 'the roster key an old project holds, which the shape-3 step reads', re: /roles: ?\{ ?hub(?=:)|"roles":\{"hub"|roles\.hub\b|\bhub: \['(?:owner|reviewer)'|'hub=owner'|role under `hub`|no hub role|spelling beside `hub`|role key beside `hub`|product scope as `hub`/g },
  // The gates still accept `--profile hub` (a workflow the team edited may pass it), and the E123
  // check (`productProfileGap`) recognises a gate copy that branches on `= hub` — an older copy's shape.
  { rule: 'old-profile-name', why: 'the gates accept `--profile hub` until v5; old gate copies branch on `= hub`', re: /code\|hub\|product|code\|hub\b|\[ "\$PROFILE" = hub \] && PROFILE=product|PROFILE=["']?hub\b|\$\{?PROFILE\}?"?\s*==?\s*["']?hub\b|\$PROFILE" = hub|`= hub`|as `hub` and|into \\?`hub\\?`|turn `hub` into|passing `hub`|passes hub|--profile(?:=|[ \t]+)["']?hub|'--profile', 'hub'|profile of \['hub', 'product'\]|\/--profile hub\/|'--profile hub'|`hub` stays|or hub, the old name|<code>hub<\/code> is the old name|old spelling of the `product`|`hub` is the old spelling|stays `hub`|maps product -> hub\b|\(\["'\]\?\)hub\\1|\/hub\(\["'\]\?\)\$\/|\["'\]\?hub\\b/g },
  // Sentences that describe the rename itself, and the notes that name what an older project says.
  { rule: 'rename-described', why: 'names the old word in order to say it changed', re: /`hub` (?:→|->|becomes|became)|\bhub (?:→|->) (?:Product|`?product)|the `hub` -> Product|hub-to-product|older projects: `?hub[\w.:]*|older name: `detect-hub`|`detect-hub`, the old name|Renamed from `hub:`|still says `hub:`|still said `hub`|`hub` in an older|says `"scope": "hub"`|says `hub`, the old name|old name:? `?hub`?|`hub`, the old name|`hub` is (?:its|the) old name/g },
  // Not our word: English, and an icon library's own name.
  { rule: 'not-our-word', why: 'ordinary English (a docs landing page, a diagram layout) or a Material icon name', re: /Documentation Hub|hub-and-spoke|central hub|platform: 'hub'/g },
  // The region markers below name their own rule.
  { rule: 'region-marker', why: 'the marker that opens or closes a kept region', re: /hub-keep:(?:start|end)/g },
];

// Regions a file opts into with `hub-keep:start <rule>` … `hub-keep:end`, each a comment line of its own.
// For a block where the old name is the subject on every line, so a pattern per line would only
// repeat the block. The rule must be named here, with its reason.
export const REGION_RULES = {
  'shape-3-step': 'the shape-3 migration step (cli/migrate.mjs): it reads the old roster key and describes the old name',
  'moved-names': 'the table of --json names that moved in jsonVersion 2 (docs/CLI.md): it names each old value',
  'keep-list-tests': "this script's own tests (cli/test.mjs), which feed it stray hits on purpose",
};

// A marker is a comment line of its own — `// …`, `# …` or `<!-- … -->` — so a string that merely quotes one
// (a test's sample text) is not a marker.
const REGION_START = /^\s*(?:\/\/|#|<!--)\s*hub-keep:start ([a-z0-9-]+)\s*(?:-->)?\s*$/;
const REGION_END = /^\s*(?:\/\/|#|<!--)\s*hub-keep:end\s*(?:-->)?\s*$/;

export function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

// Every hit in one file, each with the rule that kept it, or null for a miss.
export function classifyFile(file, text) {
  const fileRule = FILE_RULES.find((r) => r.test(file));
  const out = [];
  const lines = text.split('\n');
  let region = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = line.match(REGION_START);
    if (open) {
      if (!Object.hasOwn(REGION_RULES, open[1])) throw new Error(`${file}:${i + 1}: unknown kept region '${open[1]}'`);
      region = open[1];
    }
    HIT.lastIndex = 0;
    let m;
    const spans = [];
    if (!fileRule) {
      for (const r of LINE_RULES) {
        r.re.lastIndex = 0;
        let k;
        while ((k = r.re.exec(line))) {
          spans.push({ from: k.index, to: k.index + k[0].length, rule: r.rule });
          if (k[0] === '') r.re.lastIndex++;
        }
      }
    }
    while ((m = HIT.exec(line))) {
      const at = m.index;
      const rule = fileRule ? fileRule.rule : spans.find((s) => s.from <= at && at + 3 <= s.to)?.rule ?? region;
      out.push({ file, line: i + 1, col: at + 1, rule, text: line });
    }
    if (REGION_END.test(line)) region = null;
  }
  if (region) throw new Error(`${file}: kept region '${region}' is never closed`);
  return out;
}

export function scan(root) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean);
  const hits = [];
  for (const f of files) {
    const abs = path.join(root, f);
    let buf;
    try {
      const st = fs.lstatSync(abs);
      if (!st.isFile()) continue;
      buf = fs.readFileSync(abs);
    } catch { continue; }
    if (isBinary(buf)) continue;
    hits.push(...classifyFile(f, buf.toString('utf8')));
  }
  return hits;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hits = scan(root);
  const misses = hits.filter((h) => !h.rule);
  const byRule = new Map();
  for (const h of hits) if (h.rule) byRule.set(h.rule, (byRule.get(h.rule) || 0) + 1);
  for (const h of misses) console.log(`${h.file}:${h.line}:${h.col}: ${h.text.trim().slice(0, 200)}`);
  console.error(`\nkept: ${[...byRule].map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}`);
  if (process.argv.includes('--rules')) {
    const per = new Map();
    for (const h of hits) if (h.rule) per.set(`${h.rule}\t${h.file}`, (per.get(`${h.rule}\t${h.file}`) || 0) + 1);
    for (const [k, n] of [...per].sort()) console.error(`  ${n}\t${k}`);
  }
  console.error(misses.length ? `FAIL: ${misses.length} hub hit(s) no rule keeps — rename them, or add a rule with its reason` : 'PASS: every hub hit is kept by a named rule');
  process.exitCode = misses.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
