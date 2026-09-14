#!/usr/bin/env node
// Which release would semantic-release cut from the commits since a tag? Prints one word:
// `major`, `minor`, `patch` or `none`.
//
//   node scripts/release-type.mjs v3.19.0-next.2
//
// The release checks used to answer this with their own `grep`, and it did not match semantic-release.
// This repo's `.releaserc.json` sets no preset, so the commit analyzer uses its default, `angular`,
// which does NOT read a `feat!:` subject as breaking (no bump at all), reads `BREAKING-CHANGE:` with a
// hyphen as a minor, and DOES read an indented or bulleted `BREAKING CHANGE:` footer as a major. A
// check that disagrees with the tool that publishes either misses a real major or blocks a minor on a
// break that is not there. So ask the tool: this runs semantic-release's own analyzer, with the config
// `.releaserc.json` gives it, over the same commits. It reads git and writes nothing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const tag = process.argv[2];
if (!tag) {
  console.error('usage: node scripts/release-type.mjs <tag>');
  process.exit(2);
}

let analyzeCommits;
try {
  ({ analyzeCommits } = await import('@semantic-release/commit-analyzer'));
} catch {
  console.error('release-type: @semantic-release/commit-analyzer is not installed — run `npm ci` first');
  process.exit(2);
}

// The analyzer's options exactly as the release uses them: the plugin entry in .releaserc.json, which
// is either the bare name or `[name, options]`.
let pluginConfig = {};
try {
  const rc = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.releaserc.json'), 'utf8'));
  const entry = (rc.plugins || []).find((p) => (Array.isArray(p) ? p[0] : p) === '@semantic-release/commit-analyzer');
  if (Array.isArray(entry) && entry[1]) pluginConfig = entry[1];
} catch { /* no config: the analyzer's defaults, which is what semantic-release would use too */ }

// One record per commit: hash, then the whole message. Separators that cannot appear in a message.
const log = execFileSync('git', ['log', `${tag}..HEAD`, '--format=%H%x1f%B%x1e'], { encoding: 'utf8' });
const commits = log.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
  const [hash, message = ''] = r.split('\x1f');
  return { hash, message: message.replace(/\n+$/, '') };
});

const silent = { log() {}, error() {}, warn() {}, info() {}, success() {} };
const type = await analyzeCommits(pluginConfig, { commits, logger: silent, cwd: process.cwd(), options: {} });
console.log(type || 'none');
