// @vitest-environment jsdom
// The file Spotter's measurement readout downloads (?spotter=measure) must fit
// the protocol's sheet and be readable by analyze.mjs without any editing.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeDevice } from '../../src/ui/spotter/deviceInfo';
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
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const records = [
  measurementFrom(sensors, new Date('2026-11-05T11:10:07Z'), describeDevice(ANDROID))!,
  measurementFrom({ ...sensors, accuracyMeters: null }, new Date('2026-11-05T11:11:00Z'), describeDevice(IPHONE))!,
  // Next to a car, compass not trusted: tilt only.
  measurementFrom({ ...sensors, headingDeg: null, headingReliable: false, headingSource: null, headingError: 'needs_compass' }, new Date('2026-11-05T11:12:00Z'), describeDevice(ANDROID))!,
];

describe('the downloaded measurement file', () => {
  it('has the protocol sheet’s columns, in its order, before the extra ones', () => {
    const template = readFileSync(join(__dirname, 'data', 'olcum-sablonu.csv'), 'utf8').trim();
    const header = measurementsCsv(records).replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(header.startsWith(`${template};`)).toBe(true);
    expect(header.endsWith(';platform;isletim_sistemi;pusula_kaynagi;pusula_guvenilir;pusula_durumu;gps_enlem;gps_boylam;kullanici_araci')).toBe(true);
  });

  it('is read back by the analysis with the same numbers and device details', () => {
    const rows = parseCsv(measurementsCsv(records));
    expect(rows).toHaveLength(3);
    expect(readNumber(rows[0].telefon_azimut)).toBe(48.5);
    expect(readNumber(rows[0].telefon_yukseklik)).toBe(3.1);
    expect(readNumber(rows[0].mag_sapma)).toBe(5.9);
    expect([rows[0].telefon, rows[0].platform, rows[0].isletim_sistemi, rows[0].pusula_kaynagi]).toEqual(['Pixel 7', 'Android', 'Android 14', 'absolute']);
    expect([rows[1].telefon, rows[1].platform, rows[1].isletim_sistemi]).toEqual(['iPhone', 'iOS', 'iOS 17.5']);
    expect(rows[1].kullanici_araci).toBe(IPHONE);
    expect(rows[1].gps_dogruluk_m).toBe('');
    expect([rows[2].pusula_guvenilir, rows[2].telefon_azimut]).toEqual(['hayir', '']);
    expect(rows[0].hedef_turu).toBe(''); // filled in by hand in Excel
  });

  it('analyses iPhone and Android apart, and counts an untrusted-compass row for the tilt only', () => {
    // As in the field: fill in the true direction, then run the analysis script.
    const filled = measurementsCsv(records).split('\r\n').map((line, i) => {
      if (i === 0 || line === '') return line;
      const f = line.split(';');
      f[4] = 'yer_isareti'; // hedef_turu
      f[12] = '50'; // gercek_azimut
      f[13] = '3'; // gercek_yukseklik
      return f.join(';');
    }).join('\r\n');
    const dir = mkdtempSync(join(tmpdir(), 'spotter-'));
    writeFileSync(join(dir, 'olcumler.csv'), filled);
    const out = execFileSync(process.execPath, ['--import', './research/perf/register-ts.mjs', 'research/spotter/analyze.mjs', '--in', join(dir, 'olcumler.csv'), '--out', dir], { encoding: 'utf8' });
    expect(out).toContain('3 ölçüm özetlendi');
    const summary = parseCsv(readFileSync(join(dir, 'summary.csv'), 'utf8'));
    const group = (grouping: string, name: string) => summary.find((r) => r.gruplama === grouping && r.grup === name)!;
    expect(group('platform', 'Android')).toMatchObject({ n_azimut: '1', n_yukseklik: '2' });
    expect(group('platform', 'iOS')).toMatchObject({ n_azimut: '1', n_yukseklik: '1' });
    expect(group('pusula_guvenilir', 'hayir')).toMatchObject({ n_azimut: '0', n_yukseklik: '1' });
  });
});
