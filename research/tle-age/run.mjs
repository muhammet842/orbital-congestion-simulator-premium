/**
 * Runs the TLE age measurement on the TLE archive and writes the results to
 * research/tle-age/results/. Method: research/tle-age/README.md.
 *
 * Usage: npm run research:tle-age [-- --archive <folder>] [--split 2026-10-19]
 *
 * --archive  folder of tle-YYYY-MM-DD.3le.gz files (default research/data/tle-archive).
 *            When it is empty or missing, the files are downloaded from the
 *            repository's `tle-archive` release first.
 * --split    first day of the main period (default 2026-10-19, the first full
 *            ~28,000-object catalog). Earlier days are reported separately.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { lineChart } from './chart.mjs';
import { ageBin, compareTles, distinctTlesByObject, parseThreeLine, summarize } from './lib.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = 'muhammet842/orbital-congestion-simulator-premium';
const FILE_RE = /^tle-(\d{4}-\d{2}-\d{2})\.3le\.gz$/;
/** How many of the largest outliers outliers.csv lists (the summaries count all of them). */
const OUTLIERS_LISTED = 1000;

const GROUPS = ['LEO', 'LEO_EXCL_STARLINK', 'STARLINK', 'STATIONS', 'MEO', 'GEO', 'HEO'];
const BINS = ['0', ...Array.from({ length: 14 }, (_, i) => String(i + 1)), '15-30', '31+'];
export const NOT_TRUE_ERROR =
  'Not the true error: the newer TLE is only a more recent estimate, so these are differences between two TLEs.';
const PERIOD_NAME = { main: 'Main period', early: 'Early period' };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Downloads every archive file from the `tle-archive` release (public, no login needed). */
async function downloadArchive(dir) {
  const api = async (path) => {
    const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub API ${path}: HTTP ${res.status}`);
    return res.json();
  };
  const release = await api('releases/tags/tle-archive');
  await mkdir(dir, { recursive: true });
  for (let page = 1; ; page += 1) {
    const assets = await api(`releases/${release.id}/assets?per_page=100&page=${page}`);
    if (assets.length === 0) break;
    for (const a of assets) {
      if (!FILE_RE.test(a.name) || existsSync(join(dir, a.name))) continue;
      const res = await fetch(a.browser_download_url);
      if (!res.ok) throw new Error(`${a.name}: HTTP ${res.status}`);
      await writeFile(join(dir, a.name), Buffer.from(await res.arrayBuffer()));
      console.log(`downloaded ${a.name}`);
    }
  }
}

/** The archive's catalogs, oldest first: [{ day, objects }]. */
async function loadArchive(dir) {
  const archiveFiles = async () => (existsSync(dir) ? (await readdir(dir)).filter((f) => FILE_RE.test(f)) : []);
  if ((await archiveFiles()).length === 0) {
    console.log(`No archive files in ${dir}; downloading them from the tle-archive release.`);
    await downloadArchive(dir);
  }
  const catalogs = [];
  for (const name of (await archiveFiles()).sort()) {
    const text = gunzipSync(await readFile(join(dir, name))).toString('utf8');
    catalogs.push({ day: FILE_RE.exec(name)[1], objects: parseThreeLine(text) });
  }
  return catalogs;
}

/** Every pair of different TLEs of the same object, older first. */
function* pairsOf(byObject) {
  for (const [noradId, tles] of byObject) {
    for (let j = 1; j < tles.length; j += 1) {
      for (let i = 0; i < j; i += 1) yield { noradId, older: tles[i], newer: tles[j] };
    }
  }
}

/**
 * First pass over one period: compares every pair once and collects the
 * differences per (group, age). Returns them with the counts the README reports.
 */
function measurePeriod(catalogs) {
  const byObject = distinctTlesByObject(catalogs.map((c) => c.objects));
  const cells = new Map(); // "GROUP|age" -> { distance: [], along: [], radial: [], cross: [] }
  const info = { objectsSeen: byObject.size, objectsNeverUpdated: 0, pairs: 0, sgp4Errors: 0, implausible: 0 };
  for (const tles of byObject.values()) if (tles.length < 2) info.objectsNeverUpdated += 1;
  for (const { older, newer } of pairsOf(byObject)) {
    const r = compareTles(older, newer);
    if (r.failed) {
      if (r.failed === 'sgp4') info.sgp4Errors += 1;
      else info.implausible += 1;
      continue;
    }
    info.pairs += 1;
    const bin = ageBin(r.ageDays);
    for (const group of r.groups) {
      const key = `${group}|${bin}`;
      const cell = cells.get(key) ?? { distance: [], along: [], radial: [], cross: [] };
      cell.distance.push(r.distanceKm);
      cell.along.push(Math.abs(r.along));
      cell.radial.push(Math.abs(r.radial));
      cell.cross.push(Math.abs(r.cross));
      cells.set(key, cell);
    }
  }
  return { cells, info, byObject };
}

/**
 * Second pass: the pairs above the Tukey limit of their orbit layer and age.
 * Recomputed instead of kept from the first pass, so millions of pairs never
 * sit in memory at once; the parsed TLEs are reused, so this pass is quick.
 */
function findOutliers(period, byObject, limits) {
  const found = [];
  for (const { noradId, older, newer } of pairsOf(byObject)) {
    const r = compareTles(older, newer);
    if (r.failed) continue;
    const limit = limits.get(`${r.groups[0]}|${ageBin(r.ageDays)}`);
    if (r.distanceKm > limit) found.push({ period, noradId, name: newer.name, older, newer, r, limit });
  }
  return found;
}

const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : '');
const csvText = (s) => `"${String(s).replace(/"/g, '""')}"`;

function summaryRows(period, cells) {
  const rows = [];
  const limits = new Map();
  for (const group of GROUPS) {
    for (const bin of BINS) {
      const cell = cells.get(`${group}|${bin}`);
      if (!cell) continue;
      const s = summarize(cell.distance);
      limits.set(`${group}|${bin}`, s.outlierLimit);
      rows.push({
        period,
        group,
        age_days: bin,
        n: s.n,
        median_km: f3(s.median),
        q1_km: f3(s.q1),
        q3_km: f3(s.q3),
        p95_km: f3(s.p95),
        mean_km: f3(s.mean),
        std_km: f3(s.std),
        median_abs_along_km: f3(summarize(cell.along).median),
        median_abs_radial_km: f3(summarize(cell.radial).median),
        median_abs_cross_km: f3(summarize(cell.cross).median),
        outlier_limit_km: f3(s.outlierLimit),
        outliers_n: s.outliers,
        outliers_pct: ((100 * s.outliers) / s.n).toFixed(2),
      });
    }
  }
  return { rows, limits };
}

function toCsv(rows) {
  const header = Object.keys(rows[0]);
  const body = rows.map((r) => header.map((h) => r[h]).join(','));
  return `${[`# ${NOT_TRUE_ERROR}`, header.join(','), ...body].join('\n')}\n`;
}

const CHART_SERIES = [
  { group: 'LEO_EXCL_STARLINK', label: 'LEO (no Starlink)', color: '#0072B2' },
  { group: 'STARLINK', label: 'Starlink', color: '#56B4E9' },
  { group: 'MEO', label: 'MEO', color: '#E69F00' },
  { group: 'GEO', label: 'GEO', color: '#D55E00' },
  { group: 'HEO', label: 'HEO', color: '#CC79A7' },
];
/** A chart point needs at least this many pairs, so one odd object cannot draw the line. */
const MIN_PAIRS_PER_POINT = 20;

function chart(period, days, cells) {
  return lineChart({
    title: 'Position difference vs. TLE age',
    subtitle: `${PERIOD_NAME[period]}: ${days[0]} to ${days.at(-1)} (${days.length} daily catalogs). Line: median, band: Q1–Q3.`,
    note: NOT_TRUE_ERROR,
    xLabel: 'TLE age (days, from the line-1 epochs)',
    yLabel: 'Position difference (km, log scale)',
    xMax: 14,
    series: CHART_SERIES.map((s) => ({
      ...s,
      points: Array.from({ length: 14 }, (_, i) => i + 1).flatMap((d) => {
        const cell = cells.get(`${s.group}|${d}`);
        if (!cell || cell.distance.length < MIN_PAIRS_PER_POINT) return [];
        const st = summarize(cell.distance);
        return [{ x: d, median: st.median, q1: st.q1, q3: st.q3 }];
      }),
    })),
  });
}

function outliersCsv(outliers) {
  const rows = outliers.slice(0, OUTLIERS_LISTED).map(({ period, noradId, name, older, newer, r, limit }) =>
    [
      period,
      noradId,
      csvText(name),
      r.groups[0],
      r.ageDays.toFixed(3),
      new Date(older.epochMs).toISOString(),
      new Date(newer.epochMs).toISOString(),
      f3(r.distanceKm),
      f3(r.along),
      f3(r.radial),
      f3(r.cross),
      f3(limit),
    ].join(','),
  );
  return `${[
    `# ${NOT_TRUE_ERROR}`,
    `# The ${Math.min(OUTLIERS_LISTED, outliers.length)} largest of ${outliers.length} pairs above the Tukey limit Q3 + 3 x (Q3 - Q1) of their orbit layer and age: often a manoeuvre or a re-entering object.`,
    'period,norad_id,name,layer,age_days,older_epoch_utc,newer_epoch_utc,distance_km,along_km,radial_km,cross_km,limit_km',
    ...rows,
  ].join('\n')}\n`;
}

async function main() {
  const archiveDir = arg('archive', join(HERE, '..', 'data', 'tle-archive'));
  const split = arg('split', '2026-10-19');
  const outDir = join(HERE, 'results');
  await mkdir(outDir, { recursive: true });

  const catalogs = await loadArchive(archiveDir);
  const periods = [
    ['main', catalogs.filter((c) => c.day >= split)],
    ['early', catalogs.filter((c) => c.day < split)],
  ];
  const runInfo = { note: NOT_TRUE_ERROR, split, periods: {} };
  const outliers = [];

  for (const [period, list] of periods) {
    if (list.length < 2) continue;
    const started = Date.now();
    const { cells, info, byObject } = measurePeriod(list);
    const { rows, limits } = summaryRows(period, cells);
    await writeFile(join(outDir, `summary-${period}.csv`), toCsv(rows));
    await writeFile(join(outDir, `error-vs-age-${period}.svg`), chart(period, list.map((c) => c.day), cells));
    for (const o of findOutliers(period, byObject, limits)) outliers.push(o); // too many for push(...list)
    runInfo.periods[period] = { days: list.map((c) => c.day), ...info, seconds: Math.round((Date.now() - started) / 1000) };
    console.log(`${period}: ${list.length} catalogs, ${info.pairs} pairs, ${runInfo.periods[period].seconds} s`);
  }

  outliers.sort((a, b) => b.r.distanceKm - a.r.distanceKm);
  await writeFile(join(outDir, 'outliers.csv'), outliersCsv(outliers));
  await writeFile(join(outDir, 'run-info.json'), `${JSON.stringify(runInfo, null, 2)}\n`);
  console.log(`Results in ${outDir}. ${outliers.length} outlier pairs (largest ${OUTLIERS_LISTED} listed).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`tle-age: FAILED — ${err.message}`);
    process.exit(1);
  });
}
