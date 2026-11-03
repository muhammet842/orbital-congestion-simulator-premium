import { describe, expect, it } from 'vitest';
import {
  ageBin,
  compareTles,
  distinctTlesByObject,
  epochFromLine1,
  isPlausiblePosition,
  orbitGroups,
  parseThreeLine,
  quantile,
  splitDifference,
  summarize,
} from './lib.mjs';
import { twoline2satrec } from 'satellite.js';

// A real ISS TLE from the published catalog.
const ISS_OLD = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26285.85396186  .00006018  00000+0  11791-3 0  9995',
  line2: '2 25544  51.6314  77.7958 0006705 255.2292 104.7953 15.48843879589996',
};

describe('epochFromLine1', () => {
  it('reads the year and day of year from columns 19–32 of line 1', () => {
    // Day 285.85396186 of 2026 = 12 October 2026, 20:29:42.3047 UTC (Date keeps whole ms).
    expect(new Date(epochFromLine1(ISS_OLD.line1)).toISOString()).toBe('2026-10-12T20:29:42.304Z');
  });

  it('uses the TLE rule for two-digit years: 57–99 are 1900s, 00–56 are 2000s', () => {
    const line = (yy: string) => `1 00005U 58002B   ${yy}001.00000000  .00000000  00000-0  00000-0 0  9990`;
    expect(new Date(epochFromLine1(line('57'))).getUTCFullYear()).toBe(1957);
    expect(new Date(epochFromLine1(line('56'))).getUTCFullYear()).toBe(2056);
    expect(new Date(epochFromLine1(line('00'))).toISOString()).toBe('2000-01-01T00:00:00.000Z');
  });

  it('refuses a line without a readable epoch', () => {
    expect(() => epochFromLine1('1 25544U 98067A   xxxxx')).toThrow('bad epoch');
  });
});

describe('parseThreeLine and distinctTlesByObject', () => {
  const text = `${ISS_OLD.name}\n${ISS_OLD.line1}\n${ISS_OLD.line2}\n`;

  it('reads name, NORAD number and both lines', () => {
    expect(parseThreeLine(text)).toEqual([{ ...ISS_OLD, noradId: 25544 }]);
  });

  it('keeps a TLE that appears in several daily catalogs only once', () => {
    const day = parseThreeLine(text);
    const byObject = distinctTlesByObject([day, day, day]);
    expect(byObject.get(25544)).toHaveLength(1);
  });

  it('sorts each object’s TLEs oldest first', () => {
    const newer = { ...ISS_OLD, noradId: 25544, line1: ISS_OLD.line1.replace('26285.85396186', '26290.50000000') };
    const byObject = distinctTlesByObject([[newer], parseThreeLine(text)]);
    expect(byObject.get(25544)!.map((t: { line1: string }) => t.line1.slice(18, 32))).toEqual([
      '26285.85396186',
      '26290.50000000',
    ]);
  });
});

describe('splitDifference', () => {
  // A circular orbit seen at one moment: position along x, velocity along y.
  const r = { x: 7000, y: 0, z: 0 };
  const v = { x: 0, y: 7.5, z: 0 };

  it('puts a forward shift into along-track, up into radial, sideways into cross-track', () => {
    expect(splitDifference({ x: 0, y: 2, z: 0 }, r, v)).toEqual({ radial: 0, along: 2, cross: 0 });
    expect(splitDifference({ x: 3, y: 0, z: 0 }, r, v)).toEqual({ radial: 3, along: 0, cross: 0 });
    expect(splitDifference({ x: 0, y: 0, z: -4 }, r, v)).toEqual({ radial: 0, along: 0, cross: -4 });
  });
});

describe('compareTles', () => {
  const epochMs = epochFromLine1(ISS_OLD.line1);

  it('gives zero difference when a TLE is compared with itself at its own epoch', () => {
    const result = compareTles({ ...ISS_OLD, epochMs }, { ...ISS_OLD, epochMs })!;
    expect(result.ageDays).toBe(0);
    expect(result.distanceKm).toBeCloseTo(0, 9);
  });

  it('measures age from the two epochs and finds the object as LEO and a station', () => {
    // The same orbit labelled one day later: propagating it a day lands far from
    // where its own epoch says it is, so the difference is large, never zero.
    const later = { ...ISS_OLD, epochMs: epochMs + 86_400_000 };
    const result = compareTles({ ...ISS_OLD, epochMs }, later)!;
    expect(result.ageDays).toBe(1);
    expect(result.distanceKm).toBeGreaterThan(100);
    expect(result.groups).toEqual(['LEO', 'LEO_EXCL_STARLINK', 'STATIONS']);
  });

  it('reports a failure when SGP4 cannot propagate the older TLE', () => {
    const farFuture = { ...ISS_OLD, epochMs: epochMs + 1e12 };
    expect(compareTles({ ...ISS_OLD, epochMs }, farFuture)).toEqual({ failed: 'sgp4' });
  });
});

describe('isPlausiblePosition', () => {
  // The ISS orbit: about 6,790–6,800 km from Earth's centre, so 5,790–7,800 km
  // with the 1,000 km margin, and never inside the Earth (6,371 km).
  const iss = twoline2satrec(ISS_OLD.line1, ISS_OLD.line2);

  it('accepts a position at the orbit’s own height', () => {
    expect(isPlausiblePosition({ x: 6800, y: 0, z: 0 }, iss)).toBe(true);
  });

  it('rejects positions SGP4 can return for long-gone orbits', () => {
    expect(isPlausiblePosition({ x: 9000, y: 0, z: 0 }, iss)).toBe(false); // 1,200 km above the margin
    expect(isPlausiblePosition({ x: 4000, y: 4000, z: 0 }, iss)).toBe(false); // 5,657 km: inside the Earth
    expect(isPlausiblePosition({ x: 8e9, y: 0, z: 0 }, iss)).toBe(false); // 8 billion km
    expect(isPlausiblePosition({ x: Number.NaN, y: 0, z: 0 }, iss)).toBe(false);
  });
});

describe('orbitGroups', () => {
  it('puts Starlink in its own group and not in "LEO without Starlink"', () => {
    const satrec = twoline2satrec(ISS_OLD.line1, ISS_OLD.line2);
    expect(orbitGroups('STARLINK-1007', satrec)).toEqual(['LEO', 'STARLINK']);
  });
});

describe('statistics', () => {
  it('bins ages to whole days, then 15–30 and 31+', () => {
    expect([0.3, 0.6, 1.4, 14.4, 15, 30.4, 31].map(ageBin)).toEqual(['0', '1', '1', '14', '15-30', '15-30', '31+']);
  });

  it('interpolates quantiles like Excel PERCENTILE.INC', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });

  it('summarizes with median, quartiles, sample standard deviation and Tukey outliers', () => {
    const s = summarize([1, 2, 3, 4, 100]);
    expect(s.n).toBe(5);
    expect(s.median).toBe(3);
    expect(s.q1).toBe(2);
    expect(s.q3).toBe(4);
    expect(s.outlierLimit).toBe(10); // 4 + 3 × (4 − 2)
    expect(s.outliers).toBe(1); // 100 is a "manoeuvre"
    expect(s.mean).toBe(22);
    expect(s.std).toBeCloseTo(Math.sqrt(((1 - 22) ** 2 + (2 - 22) ** 2 + (3 - 22) ** 2 + (4 - 22) ** 2 + 78 ** 2) / 4), 9);
  });
});
