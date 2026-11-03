/**
 * Summarizes the Spotter measurements filled in by hand.
 *
 * Usage: npm run research:spotter-analyze [-- --in research/spotter/data/olcumler.csv]
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
const GROUPINGS = [['tumu'], ['telefon'], ['hedef_turu'], ['kalibrasyon'], ['ortam'], ['tutus'], ['telefon', 'hedef_turu']];

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
  const az = readNumber(row.gercek_azimut);
  const el = readNumber(row.gercek_yukseklik);
  if (Number.isFinite(el) && (Number.isFinite(az) || String(row.gercek_azimut ?? '').trim() === '')) {
    const fromCoordinates = !Number.isFinite(az) ? coordinateDirection(row) : null;
    return fromCoordinates ?? { az, el };
  }
  return coordinateDirection(row);
}

function coordinateDirection(row) {
  const from = { latDeg: readNumber(row.gozlemci_enlem), lonDeg: readNumber(row.gozlemci_boylam), heightM: readNumber(row.gozlemci_yukseklik_m) || 0 };
  const to = { latDeg: readNumber(row.hedef_enlem), lonDeg: readNumber(row.hedef_boylam), heightM: readNumber(row.hedef_yukseklik_m) || 0 };
  if ([from.latDeg, from.lonDeg, to.latDeg, to.lonDeg].every(Number.isFinite)) {
    const d = trueDirection(from, to);
    return { az: d.azimuthDeg, el: d.elevationDeg };
  }
  return null;
}

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '');

async function main() {
  const input = arg('in', join(HERE, 'data', 'olcumler.csv'));
  const rows = parseCsv(await readFile(input, 'utf8'));
  const measured = [];
  const skipped = [];
  for (const row of rows) {
    const truth = trueOf(row);
    const phoneAz = readNumber(row.telefon_azimut);
    const phoneEl = readNumber(row.telefon_yukseklik);
    if (!truth || !Number.isFinite(phoneAz) || !Number.isFinite(phoneEl)) {
      skipped.push(row.olcum_no || '?');
      continue;
    }
    measured.push({ row, truth, err: pointingError(truth.az, truth.el, phoneAz, phoneEl) });
  }
  if (measured.length === 0) throw new Error(`no complete measurements in ${input}`);

  const outDir = join(HERE, 'results');
  await mkdir(outDir, { recursive: true });
  const errorRows = measured.map(({ row, truth, err }) =>
    [row.olcum_no, row.telefon, row.hedef_turu, row.hedef_adi, f2(Number(f2(truth.az)) % 360), f2(truth.el), row.telefon_azimut, row.telefon_yukseklik, f2(err.azimuth), f2(err.elevation), f2(err.total)]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(','),
  );
  await writeFile(
    join(outDir, 'errors.csv'),
    `olcum_no,telefon,hedef_turu,hedef_adi,gercek_azimut,gercek_yukseklik,telefon_azimut,telefon_yukseklik,azimut_hatasi,yukseklik_hatasi,toplam_hata\n${errorRows.join('\n')}\n`,
  );

  // Each measure is summarized over the rows that have it (elevation-only rows have no azimuth or total).
  const stats = (values) => {
    const ok = values.filter(Number.isFinite);
    return ok.length ? { ...summarize(ok), max: Math.max(...ok) } : { n: 0 };
  };
  const lines = ['gruplama,grup,n_azimut,azimut_hatasi_ortalama,azimut_hatasi_ortanca,azimut_hatasi_std,n_yukseklik,yukseklik_hatasi_ortalama,yukseklik_hatasi_ortanca,yukseklik_hatasi_std,toplam_hata_ortanca,toplam_hata_p95,toplam_hata_en_buyuk'];
  for (const keys of GROUPINGS) {
    const groups = new Map();
    for (const m of measured) {
      const label = keys[0] === 'tumu' ? 'tumu' : keys.map((k) => m.row[k] || '(bos)').join(' / ');
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
  console.log(`${measured.length} ölçüm özetlendi${skipped.length ? `, ${skipped.length} eksik satır atlandı (${skipped.join(', ')})` : ''}.`);
  console.log(`Sonuçlar: ${join(outDir, 'summary.csv')} ve errors.csv`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`spotter-analyze: FAILED — ${err.message}`);
    process.exit(1);
  });
}
