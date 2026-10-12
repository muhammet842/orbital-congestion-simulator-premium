import { describe, expect, it } from 'vitest';
import { findCatalogRegressions, isValidTleLine, isValidTlePair } from './catalogGuard.mjs';

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
