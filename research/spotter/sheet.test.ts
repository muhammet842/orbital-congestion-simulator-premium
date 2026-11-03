// @vitest-environment jsdom
// The file Spotter's measurement readout downloads (?spotter=measure) must fit
// the protocol's sheet and be readable by analyze.mjs without any editing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { measurementFrom, measurementsCsv } from '../../src/ui/spotter/measureTool';
import { parseCsv, readNumber } from './lib.mjs';

const sensors = {
  location: { latitudeDeg: 40.88765, longitudeDeg: 29.30012, altitudeKm: 0.035 },
  locationSource: 'gps' as const,
  locationError: null,
  accuracyMeters: 6,
  headingDeg: 48.456,
  headingReliable: true,
  headingSource: 'absolute' as const,
  pitchDeg: 3.14,
  declinationDeg: 5.93,
  headingError: null,
  orientationPermission: 'granted' as const,
};
const records = [
  measurementFrom(sensors, new Date('2026-11-05T11:10:07Z'), 'Mozilla/5.0 (Linux; Android 14)')!,
  measurementFrom({ ...sensors, accuracyMeters: null }, new Date('2026-11-05T11:11:00Z'), 'x')!,
];

describe('the downloaded measurement file', () => {
  it('has the protocol sheet’s columns, in its order, before the extra ones', () => {
    const template = readFileSync(join(__dirname, 'data', 'olcum-sablonu.csv'), 'utf8').trim();
    const header = measurementsCsv(records).replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(header.startsWith(`${template};`)).toBe(true);
    expect(header.endsWith('utc_saat;pusula_kaynagi;gps_enlem;gps_boylam')).toBe(true);
  });

  it('is read back by the analysis with the same numbers', () => {
    const rows = parseCsv(measurementsCsv(records));
    expect(rows).toHaveLength(2);
    expect(readNumber(rows[0].telefon_azimut)).toBe(48.5);
    expect(readNumber(rows[0].telefon_yukseklik)).toBe(3.1);
    expect(readNumber(rows[0].mag_sapma)).toBe(5.9);
    expect(rows[0].tarayici).toBe('Mozilla/5.0 (Linux; Android 14)');
    expect(rows[0].olcum_no).toBe('1');
    expect(rows[1].gps_dogruluk_m).toBe('');
    expect(rows[1].hedef_turu).toBe(''); // filled in by hand in Excel
  });
});
