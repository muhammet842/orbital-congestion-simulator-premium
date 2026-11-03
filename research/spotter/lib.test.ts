import { describe, expect, it } from 'vitest';
import { parseCsv, pointingError, readNumber, trueDirection } from './lib.mjs';

describe('trueDirection', () => {
  const at = (latDeg: number, lonDeg: number, heightM = 0) => ({ latDeg, lonDeg, heightM });

  it('gives 0° for a point due north and 90° for one due east', () => {
    // Due north may come out as 359.99999…°, the same direction as 0°.
    const north = trueDirection(at(40, 29), at(40.01, 29)).azimuthDeg;
    expect(Math.min(north, 360 - north)).toBeLessThan(1e-6);
    expect(trueDirection(at(40, 29), at(40, 29.01)).azimuthDeg).toBeCloseTo(90, 1);
    expect(trueDirection(at(40, 29), at(39.99, 29)).azimuthDeg).toBeCloseTo(180, 6);
    expect(trueDirection(at(40, 29), at(40, 28.99)).azimuthDeg).toBeCloseTo(270, 1);
  });

  it('finds the distance: 0.01° of latitude is about 1.11 km', () => {
    expect(trueDirection(at(40, 29), at(40.01, 29)).distanceKm).toBeCloseTo(1.111, 2);
  });

  it('finds a 100 m taller target 1 km away about 5.7° up, less a little for the Earth’s curvature', () => {
    const d = trueDirection(at(40, 29, 0), at(40.009, 29, 100));
    expect(d.distanceKm).toBeCloseTo(1.004, 2);
    // atan(100 / 1000 m) = 5.71°; the curvature lowers a target 1 km away by about 0.005°.
    expect(d.elevationDeg).toBeGreaterThan(5.6);
    expect(d.elevationDeg).toBeLessThan(5.71);
  });

  it('sees a same-height target far away slightly below the horizon, because the Earth curves', () => {
    expect(trueDirection(at(40, 29), at(40.5, 29)).elevationDeg).toBeLessThan(0);
  });
});

describe('pointingError', () => {
  it('is positive when the phone shows a direction to the right of, or higher than, the true one', () => {
    expect(pointingError(10, 20, 13, 21)).toMatchObject({ azimuth: 3, elevation: 1 });
  });

  it('wraps around north: true 359°, phone 2° is 3° off, not 357°', () => {
    expect(pointingError(359, 0, 2, 0).azimuth).toBeCloseTo(3, 9);
    expect(pointingError(359, 0, 2, 0).total).toBeCloseTo(3, 9);
  });

  it('counts an azimuth error less near the zenith, where all directions meet', () => {
    expect(pointingError(0, 85, 10, 85).total).toBeLessThan(1);
  });
});

describe('reading the measurement sheet', () => {
  it('reads a CSV with quoted fields and skips # notes', () => {
    const rows = parseCsv('# note\na,b,c\n1,"x, y",3\n');
    expect(rows).toEqual([{ a: '1', b: 'x, y', c: '3' }]);
  });

  it('reads the semicolon CSV that a Turkish Excel saves', () => {
    expect(parseCsv('\uFEFFa;b\n12,5;"x; y"\n')).toEqual([{ a: '12,5', b: 'x; y' }]);
  });

  it('accepts decimal commas from a Turkish Excel', () => {
    expect(readNumber('12,5')).toBe(12.5);
    expect(readNumber('12.5')).toBe(12.5);
    expect(readNumber('')).toBeNaN();
  });
});
