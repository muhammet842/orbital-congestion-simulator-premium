import { describe, expect, it } from 'vitest';
import { SURFACE_LIFT } from '../orbital/coordinates';
import { LaunchPadMarker, padScenePosition } from './LaunchPadMarker';

const DATE = new Date('2026-10-13T12:00:00Z');

describe('padScenePosition', () => {
  it('sits just above the surface at any pad', () => {
    for (const [lat, lon] of [[28.56, -80.58], [34.63, -120.61], [-39.26, 177.87], [90, 0], [0, 180]]) {
      const p = padScenePosition(lat, lon, DATE);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(SURFACE_LIFT, 6);
    }
  });

  it('puts latitude on the scene Y axis (north = up), independent of the time of day', () => {
    const lat = 28.56;
    const expectedY = SURFACE_LIFT * Math.sin((lat * Math.PI) / 180);
    // Geodetic latitude differs from geocentric by < 0.2 deg; allow for that.
    expect(padScenePosition(lat, -80.58, DATE).y).toBeCloseTo(expectedY, 2);
    expect(padScenePosition(lat, -80.58, new Date(DATE.getTime() + 6 * 3_600_000)).y).toBeCloseTo(expectedY, 2);
  });

  it('turns with the Earth: the same pad moves in inertial space as time passes', () => {
    const a = padScenePosition(28.56, -80.58, DATE);
    const b = padScenePosition(28.56, -80.58, new Date(DATE.getTime() + 6 * 3_600_000));
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.5);
    // ...and returns after one sidereal day.
    const c = padScenePosition(28.56, -80.58, new Date(DATE.getTime() + 86_164_090));
    expect(Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z)).toBeLessThan(0.01);
  });

  it('places different longitudes at different spots', () => {
    const a = padScenePosition(0, 0, DATE);
    const b = padScenePosition(0, 90, DATE);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(1);
  });
});

describe('LaunchPadMarker', () => {
  const launch = { id: 'l1', name: 'CRS-35', latitudeDeg: 28.56, longitudeDeg: -80.58, padName: 'SLC-40' };

  it('is hidden until a launch is selected, then follows the pad', () => {
    const marker = new LaunchPadMarker();
    expect(marker.group.visible).toBe(false);

    marker.update(launch, DATE, 0);
    expect(marker.group.visible).toBe(true);
    const expected = padScenePosition(launch.latitudeDeg, launch.longitudeDeg, DATE);
    expect(marker.group.position.x).toBeCloseTo(expected.x, 6);
    expect(marker.group.position.y).toBeCloseTo(expected.y, 6);

    marker.update(null, DATE, 0);
    expect(marker.group.visible).toBe(false);
  });
});
