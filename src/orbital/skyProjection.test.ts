import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOV_DEG,
  horizonYForPitch,
  projectAzElToCanvas,
  skyAngularDistanceDeg,
  skyFovCenterDistanceDeg,
} from './skyProjection';

describe('projectAzElToCanvas', () => {
  const size = 300;
  const view = { headingDeg: 0, pitchDeg: 45 };

  it('places a matching az/el at the canvas center', () => {
    const p = projectAzElToCanvas(view, { azimuthDeg: 0, elevationDeg: 45 }, size, size);
    expect(p.x).toBeCloseTo(size / 2, 5);
    expect(p.y).toBeCloseTo(size / 2, 5);
    expect(p.inView).toBe(true);
  });

  it('places a target to the right of center for positive azimuth offset', () => {
    const p = projectAzElToCanvas(
      view,
      { azimuthDeg: 30, elevationDeg: 45 },
      size,
      size,
      DEFAULT_FOV_DEG,
    );
    expect(p.x).toBeGreaterThan(size / 2);
    expect(p.inView).toBe(true);
    // Camera-plane angle is smaller than raw Δaz at high elevation (not plate-carrée).
    expect(p.dAzDeg).toBeGreaterThan(0);
    expect(p.dAzDeg).toBeLessThan(30);
  });

  it('maps horizon-level Δaz≈half-FOV near the right edge', () => {
    const horizonView = { headingDeg: 0, pitchDeg: 0 };
    const p = projectAzElToCanvas(
      horizonView,
      { azimuthDeg: 30, elevationDeg: 0 },
      size,
      size,
      DEFAULT_FOV_DEG,
    );
    expect(p.x).toBeCloseTo(size, 0);
    expect(p.y).toBeCloseTo(size / 2, 0);
    expect(p.inView).toBe(true);
  });

  it('marks far targets as out of view', () => {
    const p = projectAzElToCanvas(view, { azimuthDeg: 90, elevationDeg: 45 }, size, size);
    expect(p.inView).toBe(false);
  });

  it('moves higher elevation toward the top of the screen', () => {
    const p = projectAzElToCanvas(view, { azimuthDeg: 0, elevationDeg: 60 }, size, size);
    expect(p.y).toBeLessThan(size / 2);
  });

  it('keeps near-zenith satellites in view when looking straight up', () => {
    const zenithView = { headingDeg: 0, pitchDeg: 90 };
    // Same azimuth family near zenith — old Δaz math wrongly marked these out of view.
    const a = projectAzElToCanvas(
      zenithView,
      { azimuthDeg: 0, elevationDeg: 80 },
      size,
      size,
      DEFAULT_FOV_DEG,
    );
    const b = projectAzElToCanvas(
      zenithView,
      { azimuthDeg: 180, elevationDeg: 80 },
      size,
      size,
      DEFAULT_FOV_DEG,
    );
    expect(a.inView).toBe(true);
    expect(b.inView).toBe(true);
    // Both are ~10° from zenith; angular distance between them is small.
    expect(skyAngularDistanceDeg(
      { azimuthDeg: 0, elevationDeg: 80 },
      { azimuthDeg: 180, elevationDeg: 80 },
    )).toBeLessThan(25);
  });
});

describe('skyFovCenterDistanceDeg', () => {
  it('is zero at the view center', () => {
    expect(
      skyFovCenterDistanceDeg(
        { headingDeg: 100, pitchDeg: 20 },
        { azimuthDeg: 100, elevationDeg: 20 },
      ),
    ).toBeCloseTo(0, 5);
  });

  it('does not explode for opposite azimuths near zenith', () => {
    const d = skyFovCenterDistanceDeg(
      { headingDeg: 0, pitchDeg: 90 },
      { azimuthDeg: 180, elevationDeg: 85 },
    );
    expect(d).toBeLessThan(15);
  });
});

describe('horizonYForPitch', () => {
  it('puts the horizon at mid-canvas when phone pitch is 0', () => {
    expect(horizonYForPitch(0, 300)).toBeCloseTo(150, 5);
  });

  it('moves the horizon down when looking up', () => {
    expect(horizonYForPitch(30, 300)).toBeGreaterThan(150);
  });
});
