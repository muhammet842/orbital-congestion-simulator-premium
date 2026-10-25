import { describe, expect, it } from 'vitest';
import { twoline2satrec } from 'satellite.js';
import { classifyOrbitFromElements, EARTH_MEAN_RADIUS_KM, perigeeAltitudeKm } from './classify';
import { isScreenable, isWithinPredictionRange, PREDICTION_RANGE_DAYS } from './conjunction';
import { findNextPass, findNextUsefulPass, isObserverDark } from './lookAngles';
import type { TrackedObject } from '../types';

const GM = 398600.4418;
/** SGP4-style mean motion (rad/min) for a semi-major axis in km. */
const meanMotion = (aKm: number): number => Math.sqrt(GM / aKm ** 3) * 60;
const satrecFor = (perigeeKm: number, apogeeKm: number) => {
  const rp = perigeeKm + EARTH_MEAN_RADIUS_KM;
  const ra = apogeeKm + EARTH_MEAN_RADIUS_KM;
  return { no: meanMotion((rp + ra) / 2), ecco: (ra - rp) / (ra + rp) };
};

describe('orbit layer from the orbit shape', () => {
  it('labels by mean altitude and eccentricity', () => {
    expect(classifyOrbitFromElements(420, 0.001)).toBe('LEO');
    expect(classifyOrbitFromElements(20_200, 0.01)).toBe('MEO');
    expect(classifyOrbitFromElements(35_786, 0.0002)).toBe('GEO');
    // Graveyard orbit ~300 km above GEO and an inclined GSO stay "GEO", not "HEO".
    expect(classifyOrbitFromElements(36_080, 0.003)).toBe('GEO');
    expect(classifyOrbitFromElements(35_249, 0.07)).toBe('GEO');
    expect(classifyOrbitFromElements(30_000, 0.01)).toBe('MEO');
    expect(classifyOrbitFromElements(10_000, 0.6)).toBe('HEO');
  });

  it('computes the perigee height from the elements', () => {
    expect(perigeeAltitudeKm(satrecFor(751, 2070))).toBeCloseTo(751, 0);
    expect(perigeeAltitudeKm(undefined)).toBeNaN();
  });
});

describe('close-approach screening', () => {
  const obj = (satrec: object, layer: TrackedObject['layer']) => ({ satrec, layer }) as unknown as TrackedObject;

  it('includes stretched orbits that dip into low orbit, whatever their layer label', () => {
    // Fengyun-1C-like debris, 751 × 2070 km: mean altitude above 2,000 km.
    expect(isScreenable(obj(satrecFor(751, 2070), 'MEO'))).toBe(true);
    expect(isScreenable(obj(satrecFor(20_000, 20_400), 'MEO'))).toBe(false);
  });

  it('still leaves out objects whose elements are too old', () => {
    expect(isScreenable({ ...obj(satrecFor(500, 520), 'LEO'), staleElements: true } as TrackedObject)).toBe(false);
  });

  it('only predicts within a week of the data date', () => {
    const fetchedAt = '2026-10-25T08:00:00Z';
    const t0 = Date.parse(fetchedAt);
    expect(isWithinPredictionRange(t0 + 2 * 86_400_000, fetchedAt)).toBe(true);
    expect(isWithinPredictionRange(t0 - (PREDICTION_RANGE_DAYS + 1) * 86_400_000, fetchedAt)).toBe(false);
    expect(isWithinPredictionRange(t0 + 30 * 86_400_000, fetchedAt)).toBe(false);
    expect(isWithinPredictionRange(t0, '')).toBe(true); // unknown date: do not block
  });
});

describe('observer darkness', () => {
  const observer = { x: 6371, y: 0, z: 0 };
  const sunAt = (elevationDeg: number) => {
    const e = (elevationDeg * Math.PI) / 180;
    return { x: Math.sin(e), y: Math.cos(e), z: 0 };
  };

  it('needs the Sun at least 6° below the horizon (end of civil twilight)', () => {
    expect(isObserverDark(observer, sunAt(10))).toBe(false);
    expect(isObserverDark(observer, sunAt(-3))).toBe(false); // bright twilight
    expect(isObserverDark(observer, sunAt(-7))).toBe(true);
  });
});

describe('next useful pass', () => {
  const satrec = twoline2satrec(
    '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
    '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
  );
  const observer = { latitudeDeg: 41.01, longitudeDeg: 28.97, altitudeKm: 0 };
  const start = new Date('2019-06-05T12:00:00Z');

  it('returns a pass that rises after the start and climbs to the minimum elevation', () => {
    const pass = findNextUsefulPass(satrec, observer, start, 30, 24);
    expect(pass?.rise?.time.getTime()).toBeGreaterThan(start.getTime());
    expect(pass?.max?.elevationDeg).toBeGreaterThanOrEqual(30);
  });

  it('skips low passes that the plain search would return first', () => {
    const first = findNextPass(satrec, observer, start, 24);
    const useful = findNextUsefulPass(satrec, observer, start, 60, 24);
    if (first.max && first.max.elevationDeg < 60) {
      expect(useful?.rise?.time.getTime() ?? Infinity).toBeGreaterThan(first.rise!.time.getTime());
    }
    if (useful) expect(useful.max!.elevationDeg).toBeGreaterThanOrEqual(60);
  });
});
