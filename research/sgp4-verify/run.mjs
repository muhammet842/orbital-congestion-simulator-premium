/**
 * Runs the SGP4 verification and writes research/sgp4-verify/results/.
 * Usage: npm run research:sgp4-verify. Method: research/sgp4-verify/README.md.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseTimes, compareCase, errorAfterReference, parseReference, parseTestTles, referenceAgreement } from './lib.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DATA = join(HERE, 'data');
const OUT = join(HERE, 'results');

const mm = (km) => (km * 1e6).toFixed(3); // km -> mm
const csvText = (s) => `"${String(s).replace(/"/g, '""')}"`;
const maxOf = (points, key) => points.reduce((m, p) => Math.max(m, p[key]), 0);

async function main() {
  const cases = parseTestTles(await readFile(join(DATA, 'SGP4-VER.TLE'), 'utf8'));
  const matlab = parseReference(await readFile(join(DATA, 'tmatverDec2015.out'), 'utf8'));
  const fortran = parseReference(await readFile(join(DATA, 'tforverf.out'), 'utf8'));
  if (cases.length !== matlab.length || cases.length !== fortran.length) throw new Error('case counts differ');
  cases.forEach((c, i) => {
    if (c.noradId !== matlab[i].noradId || c.noradId !== fortran[i].noradId) throw new Error(`case ${i + 1}: NORAD numbers differ`);
  });

  const summary = [];
  const points = [];
  for (const [i, c] of cases.entries()) {
    const app = compareCase(c, matlab[i], 'i');
    const appFortran = compareCase(c, fortran[i], 'i');
    const afspc = compareCase(c, matlab[i], 'a');
    const stop = errorAfterReference(c, matlab[i]);
    const appStopsSame = app.stoppedAt === null || (app.stoppedAt.minutes === 0 && app.initError !== 0);
    summary.push({
      case: i + 1,
      norad_id: c.noradId,
      description: csvText(c.comment),
      times_planned: caseTimes(c).length,
      reference_points: matlab[i].points.length,
      compared_points: app.points.length,
      max_position_diff_mm: mm(maxOf(app.points, 'dr')),
      max_velocity_diff_mm_s: mm(maxOf(app.points, 'dv')),
      max_position_diff_mm_vs_fortran: mm(maxOf(appFortran.points, 'dr')),
      max_position_diff_mm_afspc_mode: mm(maxOf(afspc.points, 'dr')),
      reference_stops_early: stop ? 'yes' : 'no',
      satellitejs_error_after_reference: stop ? stop.satelliteJsError : '',
      satellitejs_error_at_start: app.initError || '',
      stops_where_reference_stops: (stop ? stop.satelliteJsError !== 0 : true) && appStopsSame ? 'yes' : 'NO',
    });
    for (const p of app.points) {
      points.push([i + 1, c.noradId, p.minutes, mm(p.dr), mm(p.dv)].join(','));
    }
  }

  const header = Object.keys(summary[0]);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'summary.csv'), `${[header.join(','), ...summary.map((r) => header.map((h) => r[h]).join(','))].join('\n')}\n`);
  await writeFile(join(OUT, 'points.csv'), `case,norad_id,minutes,position_diff_mm,velocity_diff_mm_s\n${points.join('\n')}\n`);

  const agreement = referenceAgreement(matlab, fortran);
  const totals = {
    cases: cases.length,
    comparedPoints: points.length,
    skippedReferenceRows: { matlab: matlab.reduce((s, b) => s + b.skipped, 0), fortran: fortran.reduce((s, b) => s + b.skipped, 0) },
    referencesAgreeWithinMm: Number(mm(agreement.maxPositionKm)),
    referencesAgreeWithinMmPerS: Number(mm(agreement.maxVelocityKmS)),
    casesWithin1mm: summary.filter((r) => Number(r.max_position_diff_mm) < 1).length,
    casesWithin1mmInAfspcMode: summary.filter((r) => Number(r.max_position_diff_mm_afspc_mode) < 1).length,
    casesStoppingWhereReferenceStops: summary.filter((r) => r.stops_where_reference_stops === 'yes').length,
    satelliteJs: '7.1.0 (twoline2satrec: opsmode i, WGS-72)',
    reference: 'Vallado et al. (2006), AIAA 2006-6753: MATLAB output tmatverDec2015.out (opsmode a, WGS-72), cross-checked with tforverf.out',
  };
  await writeFile(join(OUT, 'totals.json'), `${JSON.stringify(totals, null, 2)}\n`);
  console.log(JSON.stringify(totals, null, 2));
  for (const r of summary.filter((x) => Number(x.max_position_diff_mm) >= 1)) {
    console.log(`case ${r.case} (${r.norad_id}): ${r.max_position_diff_mm} mm in mode i, ${r.max_position_diff_mm_afspc_mode} mm in mode a`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`sgp4-verify: FAILED — ${err.message}`);
    process.exit(1);
  });
}
