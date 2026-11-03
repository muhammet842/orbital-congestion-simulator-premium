/**
 * Summarizes the Spotter measurements filled in by hand.
 *
 * Usage: npm run research:spotter-analyze [-- --in research/spotter/data/measurements.csv] [--out <folder>]
 * Writes results/errors.csv (each measurement with its error) and
 * results/summary.csv (per group). Method: research/spotter/PROTOCOL.md.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from '../tle-age/lib.mjs';
import { parseCsv, pointingError, readNumber, trueDirection } from './lib.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Groupings the summary reports, by column of the measurement sheet. */
/**
 * Groupings the summary reports, by column of the measurement sheet. platform,
 * os and compass_trusted come from the Spotter readout's file
 * (iPhone and Android apart; readings taken while Spotter did not trust the
 * compass apart).
 */
const GROUPINGS = [
  ['all'], ['platform'], ['os'], ['phone_model'], ['target_type'], ['calibrated'], ['surroundings'], ['mount'],
  ['compass_trusted'], ['platform', 'target_type'], ['phone_model', 'target_type'],
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/**
 * The true direction of a row: written in, or worked out from the two
 * coordinates. With only the elevation written in (the spirit-level test,
 * where the direction is unknown), az is NaN and the row counts for the
 * elevation only.
 */
function trueOf(row) {
  const az = readNumber(row.true_azimuth);
  const el = readNumber(row.true_elevation);
  if (Number.isFinite(el) && (Number.isFinite(az) || String(row.true_azimuth ?? '').trim() === '')) {
    const fromCoordinates = !Number.isFinite(az) ? coordinateDirection(row) : null;
    return fromCoordinates ?? { az, el };
  }
  return coordinateDirection(row);
}

function coordinateDirection(row) {
  const from = { latDeg: readNumber(row.observer_lat), lonDeg: readNumber(row.observer_lon), heightM: readNumber(row.observer_height_m) || 0 };
  const to = { latDeg: readNumber(row.target_lat), lonDeg: readNumber(row.target_lon), heightM: readNumber(row.target_height_m) || 0 };
  if ([from.latDeg, from.lonDeg, to.latDeg, to.lonDeg].every(Number.isFinite)) {
    const d = trueDirection(from, to);
    return { az: d.azimuthDeg, el: d.elevationDeg };
  }
  return null;
}

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '');

async function main() {
  const input = arg('in', join(HERE, 'data', 'measurements.csv'));
  const rows = parseCsv(await readFile(input, 'utf8'));
  const measured = [];
  const skipped = [];
  for (const row of rows) {
    const truth = trueOf(row);
    const phoneAz = readNumber(row.phone_azimuth);
    const phoneEl = readNumber(row.phone_elevation);
    // A row without the phone's azimuth (the compass was not trusted) still counts for the elevation.
    if (!truth || !Number.isFinite(phoneEl)) {
      skipped.push(row.measurement_no || '?');
      continue;
    }
    measured.push({ row, truth, err: pointingError(truth.az, truth.el, phoneAz, phoneEl) });
  }
  if (measured.length === 0) {
    throw new Error(
      `no complete measurements in ${input}. Each row needs the phone's values and the true direction ` +
        '(true_azimuth and true_elevation, or the observer and target coordinates); see PROTOCOL.md, step 4.',
    );
  }

  const outDir = arg('out', join(HERE, 'results'));
  await mkdir(outDir, { recursive: true });
  const errorRows = measured.map(({ row, truth, err }) =>
    [row.measurement_no, row.platform, row.phone_model, row.compass_trusted, row.target_type, row.target_name, f2(Number(f2(truth.az)) % 360), f2(truth.el), row.phone_azimuth, row.phone_elevation, f2(err.azimuth), f2(err.elevation), f2(err.total)]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(','),
  );
  await writeFile(
    join(outDir, 'errors.csv'),
    `measurement_no,platform,phone_model,compass_trusted,target_type,target_name,true_azimuth,true_elevation,phone_azimuth,phone_elevation,azimuth_error,elevation_error,total_error\n${errorRows.join('\n')}\n`,
  );

  // Each measure is summarized over the rows that have it (elevation-only rows have no azimuth or total).
  const stats = (values) => {
    const ok = values.filter(Number.isFinite);
    return ok.length ? { ...summarize(ok), max: Math.max(...ok) } : { n: 0 };
  };
  const lines = ['grouping,group,n_azimuth,azimuth_error_mean,azimuth_error_median,azimuth_error_std,n_elevation,elevation_error_mean,elevation_error_median,elevation_error_std,total_error_median,total_error_p95,total_error_max'];
  for (const keys of GROUPINGS) {
    const groups = new Map();
    for (const m of measured) {
      const label = keys[0] === 'all' ? 'all' : keys.map((k) => m.row[k] || '(empty)').join(' / ');
      groups.set(label, [...(groups.get(label) ?? []), m]);
    }
    for (const [label, list] of [...groups.entries()].sort()) {
      const az = stats(list.map((m) => m.err.azimuth));
      const el = stats(list.map((m) => m.err.elevation));
      const total = stats(list.map((m) => m.err.total));
      lines.push(
        [keys.join('+'), `"${label}"`, az.n, f2(az.mean), f2(az.median), f2(az.std), el.n, f2(el.mean), f2(el.median), f2(el.std), f2(total.median), f2(total.p95), f2(total.max)].join(','),
      );
    }
  }
  await writeFile(join(outDir, 'summary.csv'), `${lines.join('\n')}\n`);
  console.log(`${measured.length} measurements summarized${skipped.length ? `, ${skipped.length} incomplete rows skipped (${skipped.join(', ')})` : ''}.`);
  console.log(`Results: ${join(outDir, 'summary.csv')} and errors.csv`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`spotter-analyze: FAILED — ${err.message}`);
    process.exit(1);
  });
}
