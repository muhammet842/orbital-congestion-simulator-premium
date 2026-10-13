/**
 * Writes public/data/data-ref.json: the pointer from `main` to the snapshot
 * commit on the `data` branch (see pull-data.mjs).
 *
 * Usage: node scripts/write-data-ref.mjs --sha <40-hex> --repository owner/name [--branch data]
 * Reads fetchedAt / count from the freshly fetched public/data/tle.json.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TLE_PATH = new URL('../public/data/tle.json', import.meta.url);
const REF_PATH = new URL('../public/data/data-ref.json', import.meta.url);

/** Builds the pointer object (throws on a bad sha/repository). */
export function buildDataRef({ sha, repository, branch = 'data' }, tle) {
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error('--sha must be a 40-character commit hash');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository))) {
    throw new Error('--repository must look like owner/name');
  }
  if (!tle || !Array.isArray(tle.objects) || !tle.fetchedAt) throw new Error('tle.json is not a catalog');
  return { repository, branch, sha, fetchedAt: tle.fetchedAt, count: tle.objects.length };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const tle = JSON.parse(await readFile(fileURLToPath(TLE_PATH), 'utf8'));
  const ref = buildDataRef({ sha: arg('sha'), repository: arg('repository'), branch: arg('branch') }, tle);
  await writeFile(fileURLToPath(REF_PATH), `${JSON.stringify(ref, null, 2)}\n`);
  console.log(`write-data-ref: ${REF_PATH.pathname} -> ${ref.sha} (${ref.count} objects, ${ref.fetchedAt})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`write-data-ref: FAILED — ${err.message}`);
    process.exit(1);
  });
}
