/**
 * One-off: rebuilds archive files (see archive-tle.mjs) for the days before the
 * archive existed, from two places the old catalogs still survive:
 *
 *  1. main's history of public/data/tle.json — until 2026-10-13 the daily
 *     refresh committed the whole catalog to main;
 *  2. main's history of public/data/data-ref.json — each names the commit on
 *     the (force-replaced) data branch that held that day's catalog. GitHub
 *     may delete such unreferenced commits at any time; ones that are gone
 *     are reported and skipped.
 *
 * When a day has several catalogs, the last one fetched that day is kept, as
 * the daily workflow would have done. Files already in the output folder are
 * left alone, so the script can be re-run. It only writes local files; upload
 * them with: gh release upload tle-archive <out-dir>/*.3le.gz
 *
 * Usage: node scripts/backfill-tle-archive.mjs [--out-dir tle-archive] [--ref origin/main]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveFileName, buildArchive } from './archive-tle.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

/** Keeps the latest-fetched catalog source for each archive day. */
export function latestPerDay(sources) {
  const byDay = new Map();
  for (const s of sources) {
    const day = archiveFileName(s.fetchedAt);
    const kept = byDay.get(day);
    if (!kept || Date.parse(s.fetchedAt) > Date.parse(kept.fetchedAt)) byDay.set(day, s);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Every catalog main ever pointed to, as { fetchedAt, load() } without loading them yet. */
function listSources(ref) {
  const sources = [];
  for (const commit of git('log', '--format=%H', ref, '--', 'public/data/tle.json').split('\n').filter(Boolean)) {
    let head;
    try {
      head = git('show', `${commit}:public/data/tle.json`).slice(0, 400);
    } catch {
      continue; // the file was deleted in this commit
    }
    const fetchedAt = /"fetchedAt":\s*"([^"]+)"/.exec(head)?.[1];
    if (fetchedAt) sources.push({ fetchedAt, from: `main ${commit.slice(0, 7)}`, load: async () => JSON.parse(git('show', `${commit}:public/data/tle.json`)) });
  }
  for (const commit of git('log', '--format=%H', ref, '--', 'public/data/data-ref.json').split('\n').filter(Boolean)) {
    let dataRef;
    try {
      dataRef = JSON.parse(git('show', `${commit}:public/data/data-ref.json`));
    } catch {
      continue;
    }
    if (!/^[0-9a-f]{40}$/.test(String(dataRef.sha)) || !dataRef.fetchedAt) continue;
    const url = `https://raw.githubusercontent.com/${dataRef.repository}/${dataRef.sha}/tle.json`;
    sources.push({
      fetchedAt: dataRef.fetchedAt,
      from: `data ${dataRef.sha.slice(0, 7)}`,
      load: async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} (the commit may have been deleted)`);
        return res.json();
      },
    });
  }
  return sources;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const outDir = arg('out-dir', 'tle-archive');
  await mkdir(outDir, { recursive: true });
  const days = latestPerDay(listSources(arg('ref', 'origin/main')));
  let written = 0;
  for (const [name, source] of days) {
    const path = join(outDir, name);
    if (existsSync(path)) continue;
    try {
      const archive = buildArchive(await source.load());
      await writeFile(path, archive.bytes);
      written += 1;
      console.log(`${name}  ${(archive.bytes.length / 1e6).toFixed(2)} MB  from ${source.from}`);
    } catch (err) {
      console.error(`${name}  SKIPPED from ${source.from}: ${err.message}`);
    }
  }
  console.log(`backfill: ${days.length} days found, ${written} new files in ${outDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`backfill: FAILED — ${err.message}`);
    process.exit(1);
  });
}
