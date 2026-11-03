/**
 * Calculation time: how long one moment's positions take for N objects,
 * with the app's own propagateObject (src/orbital/propagator.ts) — the work
 * the propagation Web Worker (or, with ?worker=off, the main thread) does for
 * every catalogue update. Runs in Node, so no drawing is involved.
 *
 * Usage: npm run research:perf-node [-- --archive <folder>] [--repeats 30]
 * The objects come from one TLE archive day (default tle-2026-11-02.3le.gz),
 * picked evenly by NORAD number with the same pickEvenly as ?limit=N.
 */
import { cpus, platform, release, totalmem } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { twoline2satrec } from 'satellite.js';
import { propagateObject } from '../../src/orbital/propagator.ts';
import { pickEvenly } from '../../src/perfFlags.ts';
import { parseThreeLine, summarize } from '../tle-age/lib.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const SIZES = [1000, 5000, 10000, 28000];
const WARMUP = 5;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Milliseconds to compute every object's position at one moment. */
function timeOnePass(satrecs, date) {
  const t0 = performance.now();
  let ok = 0;
  for (const s of satrecs) if (propagateObject(s, date)) ok += 1;
  return { ms: performance.now() - t0, ok };
}

async function main() {
  const archive = arg('archive', join(HERE, '..', 'data', 'tle-archive'));
  const day = arg('day', '2026-11-02');
  const repeats = Number(arg('repeats', '30'));
  const text = gunzipSync(await readFile(join(archive, `tle-${day}.3le.gz`))).toString('utf8');
  const all = parseThreeLine(text);
  const start = Date.parse(`${day}T12:00:00Z`);

  const rows = [];
  const summary = [];
  for (const n of SIZES) {
    const satrecs = pickEvenly(all, n).map((o) => twoline2satrec(o.line1, o.line2));
    // Warm-up passes let the JavaScript engine optimise the code first; they are not counted.
    for (let w = 0; w < WARMUP; w += 1) timeOnePass(satrecs, new Date(start - (w + 1) * 60_000));
    const times = [];
    for (let r = 0; r < repeats; r += 1) {
      // A different minute every time, so no result can be reused.
      const { ms, ok } = timeOnePass(satrecs, new Date(start + r * 60_000));
      times.push(ms);
      rows.push(`${satrecs.length},${r + 1},${ms.toFixed(3)},${ok}`);
    }
    const s = summarize(times);
    summary.push(
      `${satrecs.length},${repeats},${s.median.toFixed(3)},${s.std.toFixed(3)},${s.q1.toFixed(3)},${s.q3.toFixed(3)},` +
        `${Math.min(...times).toFixed(3)},${Math.max(...times).toFixed(3)},${((1000 * s.median) / satrecs.length).toFixed(3)}`,
    );
    console.log(`${satrecs.length} objects: median ${s.median.toFixed(2)} ms, std ${s.std.toFixed(2)} ms (${repeats} repeats)`);
  }

  const env = {
    when: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 1e9),
    os: `${platform()} ${release()}`,
    archiveDay: day,
    catalogObjects: all.length,
    warmupPasses: WARMUP,
  };
  const out = join(HERE, 'results');
  await writeFile(join(out, 'sgp4-node-runs.csv'), `objects,repeat,ms,propagated\n${rows.join('\n')}\n`);
  await writeFile(
    join(out, 'sgp4-node-summary.csv'),
    `objects,repeats,median_ms,std_ms,q1_ms,q3_ms,min_ms,max_ms,median_us_per_object\n${summary.join('\n')}\n`,
  );
  await writeFile(join(out, 'sgp4-node-env.json'), `${JSON.stringify(env, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`sgp4-node: FAILED — ${err.message}`);
    process.exit(1);
  });
}
