/**
 * Writes one day's catalog as a compressed, standard three-line TLE file
 * (name, line 1, line 2 per object) for the long-term TLE archive.
 *
 * Why: the `data` branch keeps only the latest snapshot, so older days are
 * lost. The daily workflow uploads this file to the `tle-archive` GitHub
 * Release, which stores files outside the git history: clones stay small.
 * The 3LE format is what CelesTrak serves, so any orbit tool can read it.
 * See docs/OPERATIONS.md ("TLE archive").
 *
 * Usage: node scripts/archive-tle.mjs [--in public/data/tle.json] [--out-dir .]
 * Prints the path of the written file (e.g. ./tle-2026-11-03.3le.gz).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const DEFAULT_IN = fileURLToPath(new URL('../public/data/tle.json', import.meta.url));

/** "tle-2026-11-03.3le.gz", named by the UTC day the catalog was fetched. */
export function archiveFileName(fetchedAt) {
  const ms = Date.parse(fetchedAt);
  if (!Number.isFinite(ms)) throw new Error(`bad fetchedAt: ${fetchedAt}`);
  return `tle-${new Date(ms).toISOString().slice(0, 10)}.3le.gz`;
}

/** The catalog as 3LE text: three lines per object, objects without both TLE lines skipped. */
export function toThreeLine(catalog) {
  if (!catalog || !Array.isArray(catalog.objects)) throw new Error('not a catalog: no "objects" array');
  const lines = [];
  for (const o of catalog.objects) {
    const line1 = String(o?.line1 ?? '').trim();
    const line2 = String(o?.line2 ?? '').trim();
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
    const name = String(o.name ?? o.noradId ?? '').replace(/[\r\n]+/g, ' ').trim();
    lines.push(name, line1, line2);
  }
  if (lines.length === 0) throw new Error('catalog has no complete TLEs');
  return `${lines.join('\n')}\n`;
}

/** Compressed archive file for a catalog: its name and bytes. */
export function buildArchive(catalog) {
  return { name: archiveFileName(catalog.fetchedAt), bytes: gzipSync(toThreeLine(catalog), { level: 9 }) };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const catalog = JSON.parse(await readFile(arg('in', DEFAULT_IN), 'utf8'));
  const { name, bytes } = buildArchive(catalog);
  const path = join(arg('out-dir', '.'), name);
  await writeFile(path, bytes);
  console.error(`archive-tle: ${path} (${(bytes.length / 1e6).toFixed(2)} MB, fetched ${catalog.fetchedAt})`);
  console.log(path);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`archive-tle: FAILED — ${err.message}`);
    process.exit(1);
  });
}
