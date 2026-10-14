import { describe, expect, it } from 'vitest';
import {
  correctedCategory,
  findCatalogRegressions,
  isAnalystObject,
  isValidTleLine,
  isValidTlePair,
  tleEpochMs,
} from './catalogGuard.mjs';

const ISS_L1 = '1 25544U 98067A   26285.14422154  .00005771  00000+0  11345-3 0  9992';
const ISS_L2 = '2 25544  51.6314  81.3064 0006731 252.4466 107.5787 15.48833724589888';

describe('isValidTleLine / isValidTlePair', () => {
  it('accepts a real TLE', () => {
    expect(isValidTleLine(ISS_L1)).toBe(true);
    expect(isValidTleLine(ISS_L2)).toBe(true);
    expect(isValidTlePair(ISS_L1, ISS_L2)).toBe(true);
  });

  it('rejects a corrupted digit (checksum mismatch)', () => {
    expect(isValidTleLine(ISS_L2.replace('51.6314', '51.6315'))).toBe(false);
  });

  it('rejects truncated lines', () => {
    expect(isValidTleLine(ISS_L1.slice(0, 60))).toBe(false);
  });

  it('rejects a pair whose catalog numbers differ', () => {
    // Same checksum-neutral swap of the catalog number digits (25544 → 25454).
    const otherL2 = ISS_L2.replace('2 25544', '2 25454');
    expect(isValidTleLine(otherL2)).toBe(true);
    expect(isValidTlePair(ISS_L1, otherL2)).toBe(false);
  });
});

describe('tleEpochMs', () => {
  it('parses the epoch year and fractional day', () => {
    expect(new Date(tleEpochMs(ISS_L1)).toISOString()).toBe('2026-10-12T03:27:40.741Z');
  });

  it('maps two-digit years 57–99 to the 1900s', () => {
    const old = '1 00005U 58002B   99001.50000000  .00000000  00000-0  00000-0 0  9990';
    expect(new Date(tleEpochMs(old)).toISOString()).toBe('1999-01-01T12:00:00.000Z');
  });
});

describe('isAnalystObject', () => {
  it('flags a track with no international designator', () => {
    expect(isAnalystObject('1 81011U          26279.02078069  .00001822  00000+0  10002-2 0  9996')).toBe(true);
    expect(isAnalystObject(ISS_L1)).toBe(false);
  });
});

describe('correctedCategory', () => {
  const radio = [{ service: 'Beacon', mode: 'CW', sourceUrl: 'https://db.satnogs.org/' }];

  it.each([
    ['FREGAT DEB', 'stations', undefined, 'debris'],
    ['HRC MONOBLOCK CAMERA', 'stations', undefined, 'active'],
    ['KNACKSAT-2', 'stations', undefined, 'active'],
    ['SZ-21 MODULE', 'stations', undefined, 'active'],
    ['ISS (ZARYA)', 'stations', undefined, 'stations'],
    ['POISK', 'stations', undefined, 'stations'],
    ['CSS (TIANHE)', 'stations', undefined, 'stations'],
    ['PROGRESS-MS 34', 'stations', undefined, 'stations'],
    ['SHENZHOU-23 (SZ-23)', 'stations', undefined, 'stations'],
    ['CZ-4B R/B', 'active', undefined, 'debris'],
    ['ATLAS 5 CENTAUR DEB', 'active', undefined, 'debris'],
    ['RS-44 & BREEZE-KM R/B', 'active', radio, 'active'],
    ['STARLINK-1007', 'active', undefined, 'active'],
    ['COSMOS 2251', 'debris', undefined, 'debris'],
  ])('%s in %s → %s', (name, category, radioFrequencies, expected) => {
    expect(correctedCategory({ name, category, radioFrequencies })).toBe(expected);
  });
});

describe('findCatalogRegressions', () => {
  const previous = { stations: 19, active: 6970, debris: 5000 };

  it('passes a normal day-to-day fluctuation', () => {
    expect(findCatalogRegressions({ stations: 18, active: 6900, debris: 4990 }, previous)).toEqual([]);
  });

  it('flags a partial outage that the absolute minimums would let through', () => {
    // Most of Starlink lost: still above MIN_TOTAL 8,000 and MIN_ACTIVE 3,000.
    const problems = findCatalogRegressions({ stations: 19, active: 3100, debris: 5000 }, previous);
    expect(problems.some((p) => p.startsWith('active:'))).toBe(true);
    expect(problems.some((p) => p.startsWith('total:'))).toBe(true);
  });

  it('flags a category that disappeared entirely', () => {
    const problems = findCatalogRegressions({ stations: 19, active: 6970 }, previous);
    expect(problems.some((p) => p.startsWith('debris:'))).toBe(true);
  });

  it('ignores large relative drops in tiny categories', () => {
    expect(findCatalogRegressions({ stations: 12, active: 6970, debris: 5000 }, previous)).toEqual([]);
  });

  it('skips the comparison when there is no previous catalog', () => {
    expect(findCatalogRegressions({ active: 1 }, null)).toEqual([]);
  });
});
