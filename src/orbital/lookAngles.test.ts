import { describe, expect, it } from 'vitest';
import { twoline2satrec } from 'satellite.js';
import {
  computeLookAngles,
  findNextPass,
  headingDelta,
  skyAngularSeparationDeg,
} from './lookAngles';

/** Classic ISS sample TLE (epoch mid-2019) — good enough for geometry unit tests. */
const ISS_TLE1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
const ISS_TLE2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';

describe('headingDelta', () => {
  it('returns 0 when already facing the target', () => {
    expect(headingDelta(40, 40)).toBe(0);
  });

  it('returns a positive value for a right turn', () => {
    expect(headingDelta(10, 40)).toBe(30);
  });

  it('returns a negative value for a left turn', () => {
    expect(headingDelta(40, 10)).toBe(-30);
  });

  it('wraps across north correctly', () => {
    expect(headingDelta(350, 10)).toBe(20);
    expect(headingDelta(10, 350)).toBe(-20);
  });
});

describe('skyAngularSeparationDeg', () => {
  it('is 0 for identical directions', () => {
    expect(skyAngularSeparationDeg(40, 30, 40, 30)).toBeCloseTo(0, 5);
  });

  it('measures pure elevation difference on the same azimuth', () => {
    expect(skyAngularSeparationDeg(10, 20, 10, 50)).toBeCloseTo(30, 5);
  });
});

describe('computeLookAngles', () => {
  const satrec = twoline2satrec(ISS_TLE1, ISS_TLE2);
  // Near TLE epoch so propagation is valid.
  const date = new Date(Date.UTC(2019, 5, 5, 12, 12, 0));

  it('returns finite az/el/range for a ground observer', () => {
    const look = computeLookAngles(
      satrec,
      { latitudeDeg: 41.0, longitudeDeg: 29.0, altitudeKm: 0.05 },
      date,
    );
    expect(look).not.toBeNull();
    expect(Number.isFinite(look!.azimuthDeg)).toBe(true);
    expect(Number.isFinite(look!.elevationDeg)).toBe(true);
    expect(look!.rangeKm).toBeGreaterThan(100);
    expect(look!.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(look!.azimuthDeg).toBeLessThan(360);
  });

  it('marks visible consistently with elevation sign', () => {
    const look = computeLookAngles(
      satrec,
      { latitudeDeg: 41.0, longitudeDeg: 29.0 },
      date,
    );
    expect(look).not.toBeNull();
    expect(look!.visible).toBe(look!.elevationDeg > 0);
  });
});

describe('findNextPass', () => {
  const satrec = twoline2satrec(ISS_TLE1, ISS_TLE2);
  const start = new Date(Date.UTC(2019, 5, 5, 0, 0, 0));

  it('returns a structured pass result without throwing', () => {
    const pass = findNextPass(
      satrec,
      { latitudeDeg: 41.0, longitudeDeg: 29.0 },
      start,
      12,
      60,
    );
    expect(pass).toHaveProperty('rise');
    expect(pass).toHaveProperty('max');
    expect(pass).toHaveProperty('set');
    // The ISS passes over Istanbul several times in 12 hours.
    expect(pass.max?.elevationDeg).toBeGreaterThan(0);
    expect(pass.max?.azimuthDeg).toBeGreaterThanOrEqual(0);
  });

  it('finds a future rise when the ISS is below the horizon from Istanbul', () => {
    // Mid-day epoch sample — ISS is typically not continuously visible from TR.
    const pass = findNextPass(
      satrec,
      { latitudeDeg: 41.01, longitudeDeg: 28.97 },
      start,
      18,
      60,
    );
    // Either already up (rise null + max set) or a future rise within 18h.
    expect(pass.max != null || pass.rise != null).toBe(true);
    const riseMs = pass.rise?.time.getTime();
    expect(riseMs == null || (riseMs >= start.getTime() && riseMs <= start.getTime() + 18 * 3_600_000)).toBe(true);
  });

  it('refines max elevation similarly for coarse vs fine step sizes', () => {
    const observer = { latitudeDeg: 41.01, longitudeDeg: 28.97 };
    const coarse = findNextPass(satrec, observer, start, 18, 60);
    const fine = findNextPass(satrec, observer, start, 18, 30);
    expect(coarse.max).not.toBeNull();
    expect(fine.max).not.toBeNull();
    // Ternary refine should keep peaks within ~1° even when step differs.
    expect(Math.abs(coarse.max!.elevationDeg - fine.max!.elevationDeg)).toBeLessThan(1.5);
    expect(Math.abs(coarse.max!.time.getTime() - fine.max!.time.getTime())).toBeLessThan(90_000);
  });
});
