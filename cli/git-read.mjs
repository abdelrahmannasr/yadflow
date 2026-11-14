// Read files straight from a git ref, without a checkout (E181; the reader E131 wrote for member files).
//   readBlobsAt(repo, specs)        one `git cat-file --batch` for every `<ref>:<path>` → Map(spec → Buffer | null)
//   readFilesAt(repo, ref, paths)   the same for one ref, as text → Map(path → string | null)
//   listTreeAt(repo, ref, dirs)     every file under `dirs` at `ref` (NUL-separated, so any name is read whole)
// Only blobs come back; a missing path, a tree or a submodule is null. Nothing is written.
import { spawnSync } from 'node:child_process';

export function readBlobsAt(repo, specs, { runner = spawnSync } = {}) {
  const res = new Map(specs.map((s) => [s, null]));
  if (!specs.length) return res;
  // A spec with a newline would split the batch: it is never read.
  const asked = specs.filter((s) => !/[\n\r]/.test(s));
  const batch = runner('git', ['cat-file', '--batch'], { cwd: repo, input: asked.map((s) => `${s}\n`).join(''), maxBuffer: 1 << 28 });
  const out = batch.status === 0 && batch.stdout ? Buffer.from(batch.stdout) : Buffer.alloc(0);
  let at = 0;
  for (const s of asked) {
    const nl = out.indexOf(10, at);
    if (nl < 0) break;
    const header = out.subarray(at, nl).toString();
    at = nl + 1;
    const m = header.match(/^[0-9a-f]+ (\w+) (\d+)$/);
    if (!m) continue;   // `<spec> missing` (or ambiguous): no body follows
    const body = out.subarray(at, at + Number(m[2]));
    at += Number(m[2]) + 1;   // every body is skipped, whatever its type
    if (m[1] === 'blob') res.set(s, body);
  }
  return res;
}

export function readFilesAt(repo, ref, paths, opts = {}) {
  const got = readBlobsAt(repo, paths.map((p) => `${ref}:./${p}`), opts);
  return new Map(paths.map((p) => { const b = got.get(`${ref}:./${p}`); return [p, b ? b.toString('utf8') : null]; }));
}

export function listTreeAt(repo, ref, dirs, { runner = spawnSync } = {}) {
  const r = runner('git', ['ls-tree', '-r', '-z', '--name-only', ref, '--', ...dirs], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  return r.status === 0 ? String(r.stdout).split('\0').filter(Boolean) : [];
}
