/**
 * Pulls the latest published TLE snapshot into public/data/tle.json.
 *
 * Why: the daily refresh used to commit the ~5 MB catalog to `main`, so every
 * clone carried every day's copy. Snapshots now live on a single-commit `data`
 * branch (force-replaced on each run, no history) and `main` only carries a tiny
 * pointer, public/data/data-ref.json, naming the snapshot's commit SHA.
 *
 * At build time on Vercel (VERCEL=1) this fetches that exact commit — an
 * immutable URL, so a CDN can never serve yesterday's file — validates it and
 * writes it over the committed seed. Elsewhere it does nothing unless run with
 * `--force` (`npm run pull-data`), so local builds, CI and tests keep using the
 * committed tle.json.
 *
 * Failing closed on purpose: if the snapshot named by data-ref.json cannot be
 * fetched or fails validation the build fails, and Vercel keeps serving the
 * previous (good) deployment instead of silently shipping a stale catalog.
 * Set PULL_DATA_OPTIONAL=1 to downgrade that to a warning.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REF_PATH = new URL('../public/data/data-ref.json', import.meta.url);
const OUT_PATH = new URL('../public/data/tle.json', import.meta.url);

/** Same floor fetch-tle.mjs enforces before it will write a catalog. */
export const MIN_OBJECTS = 8_000;
export const ATTEMPTS = 4;
const FETCH_TIMEOUT_MS = 60_000;
const SHA_RE = /^[0-9a-f]{40}$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9_.-]+$/;

/** Validates a parsed data-ref.json and returns the immutable snapshot URL. */
export function snapshotUrl(ref) {
  if (!ref || typeof ref !== 'object') throw new Error('data-ref.json is not an object');
  if (!REPO_RE.test(String(ref.repository))) throw new Error('data-ref.json has a bad "repository"');
  if (!SHA_RE.test(String(ref.sha))) throw new Error('data-ref.json has a bad "sha"');
  return `https://raw.githubusercontent.com/${ref.repository}/${ref.sha}/tle.json`;
}

/**
 * The current snapshot on the data branch: used only when the pinned commit is
 * gone. Each daily run force-replaces that branch, so commits named by older
 * data-ref.json files (rollbacks, redeploys, previews of old branches) are no
 * longer referenced by any branch and GitHub may delete them.
 */
export function branchSnapshotUrl(ref) {
  if (!REPO_RE.test(String(ref?.repository))) throw new Error('data-ref.json has a bad "repository"');
  if (!BRANCH_RE.test(String(ref?.branch))) throw new Error('data-ref.json has a bad "branch"');
  return `https://raw.githubusercontent.com/${ref.repository}/${ref.branch}/tle.json`;
}

/** Throws unless `data` looks like a complete, current catalog. */
export function validateSnapshot(data, now = Date.now()) {
  if (!data || !Array.isArray(data.objects)) throw new Error('snapshot has no "objects" array');
  if (data.objects.length < MIN_OBJECTS) {
    throw new Error(`snapshot has only ${data.objects.length} objects (need >= ${MIN_OBJECTS})`);
  }
  const fetchedMs = Date.parse(data.fetchedAt);
  if (!Number.isFinite(fetchedMs)) throw new Error('snapshot has no valid "fetchedAt"');
  if (fetchedMs > now + 60 * 60 * 1000) throw new Error('snapshot "fetchedAt" is in the future');
  const sample = data.objects.filter((_, i) => i % 97 === 0);
  const bad = sample.find(
    (o) => !Number.isInteger(o?.noradId) || typeof o?.line1 !== 'string' || typeof o?.line2 !== 'string',
  );
  if (bad) throw new Error('snapshot contains malformed records');
}

async function fetchWithRetry(url, fetchImpl, sleep) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < ATTEMPTS) await sleep(1_000 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`could not fetch ${url}: ${lastError?.message ?? lastError}`);
}

/**
 * Fetches and validates the snapshot named by `ref`; returns its raw text.
 * `fetchImpl` / `sleep` are injectable for tests.
 */
export async function pullSnapshot(
  ref,
  { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now() } = {},
) {
  let url = snapshotUrl(ref);
  let fallback = false;
  let text;
  try {
    text = await fetchWithRetry(url, fetchImpl, sleep);
  } catch (err) {
    // Only a missing commit falls back; any other failure still fails closed.
    if (!/HTTP 404/.test(err.message) || !ref.branch) throw err;
    url = branchSnapshotUrl(ref);
    fallback = true;
    text = await fetchWithRetry(url, fetchImpl, sleep);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('snapshot is not valid JSON');
  }
  validateSnapshot(data, now);
  return { text, data, url, fallback };
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force && !process.env.VERCEL) {
    console.log('pull-data: not a Vercel build — keeping the committed public/data/tle.json.');
    return;
  }

  let ref;
  try {
    ref = JSON.parse(await readFile(fileURLToPath(REF_PATH), 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') {
      console.log('pull-data: no data-ref.json yet — keeping the committed public/data/tle.json.');
      return;
    }
    throw new Error(`data-ref.json is unreadable: ${err.message}`, { cause: err });
  }

  try {
    const { text, data, url, fallback } = await pullSnapshot(ref);
    if (fallback) {
      console.warn(`pull-data: snapshot ${ref.sha} is gone — using the current '${ref.branch}' branch instead.`);
    }
    await writeFile(fileURLToPath(OUT_PATH), text);
    console.log(
      `pull-data: wrote ${data.objects.length} objects (fetchedAt ${data.fetchedAt}) from ${url}`,
    );
  } catch (err) {
    if (process.env.PULL_DATA_OPTIONAL === '1') {
      console.warn(`pull-data: ${err.message} — PULL_DATA_OPTIONAL=1, keeping the committed catalog.`);
      return;
    }
    throw err;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`pull-data: FAILED — ${err.message}`);
    process.exit(1);
  });
}
