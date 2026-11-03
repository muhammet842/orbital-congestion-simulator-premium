import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { archiveFileName, buildArchive, toThreeLine } from './archive-tle.mjs';
import { latestPerDay } from './backfill-tle-archive.mjs';

const ISS = {
  noradId: 25544,
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26285.85396186  .00006018  00000+0  11791-3 0  9995',
  line2: '2 25544  51.6314  77.7958 0006705 255.2292 104.7953 15.48843879589996',
};

describe('archive-tle', () => {
  it('names the file by the UTC day the catalog was fetched', () => {
    expect(archiveFileName('2026-11-03T03:20:11.000Z')).toBe('tle-2026-11-03.3le.gz');
    expect(archiveFileName('2026-11-03T23:59:59+02:00')).toBe('tle-2026-11-03.3le.gz');
    expect(() => archiveFileName('not a date')).toThrow('bad fetchedAt');
  });

  it('writes three lines per object and skips objects without both TLE lines', () => {
    const text = toThreeLine({ objects: [ISS, { noradId: 1, name: 'BROKEN', line1: '', line2: '' }] });
    expect(text).toBe(`ISS (ZARYA)\n${ISS.line1}\n${ISS.line2}\n`);
  });

  it('keeps a name on one line and falls back to the NORAD number', () => {
    const text = toThreeLine({ objects: [{ ...ISS, name: 'A\nB' }, { ...ISS, name: undefined }] });
    expect(text.split('\n')[0]).toBe('A B');
    expect(text.split('\n')[3]).toBe('25544');
  });

  it('refuses something that is not a usable catalog', () => {
    expect(() => toThreeLine({})).toThrow('no "objects" array');
    expect(() => toThreeLine({ objects: [] })).toThrow('no complete TLEs');
  });

  it('compresses with gzip so any computer can open it', () => {
    const { name, bytes } = buildArchive({ fetchedAt: '2026-11-03T03:20:11Z', objects: [ISS] });
    expect(name).toBe('tle-2026-11-03.3le.gz');
    expect(gunzipSync(bytes).toString()).toBe(`ISS (ZARYA)\n${ISS.line1}\n${ISS.line2}\n`);
  });
});

describe('backfill-tle-archive', () => {
  it('keeps the last catalog fetched each day, in date order', () => {
    const days = latestPerDay([
      { fetchedAt: '2026-10-13T10:46:05Z', from: 'late' },
      { fetchedAt: '2026-10-12T03:20:00Z', from: 'only' },
      { fetchedAt: '2026-10-13T07:32:50Z', from: 'early' },
    ]);
    expect(days.map(([name, s]) => `${name} ${s.from}`)).toEqual([
      'tle-2026-10-12.3le.gz only',
      'tle-2026-10-13.3le.gz late',
    ]);
  });
});
