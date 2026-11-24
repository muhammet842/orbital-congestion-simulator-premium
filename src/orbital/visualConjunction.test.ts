import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  getConjunctionCameraPose,
  getConjunctionViewDistance,
  getVisualConjunctionLayout,
  PAIR_FOCUS_NEAR,
  PAIR_INSPECT_MIN_DISTANCE,
  wholePairViewDistance,
} from './visualConjunction';
import { EARTH_RADIUS_KM } from '../types';

describe('PAIR_INSPECT_MIN_DISTANCE', () => {
  it('allows zoom closer than the old ~13 km floor for tiny models', () => {
    expect(PAIR_INSPECT_MIN_DISTANCE).toBeLessThanOrEqual(0.0002);
    expect(PAIR_INSPECT_MIN_DISTANCE).toBeGreaterThan(PAIR_FOCUS_NEAR);
  });
});

describe('getConjunctionViewDistance', () => {
  it('zooms in as the framed separation shrinks', () => {
    const far = getConjunctionViewDistance(0.012);
    const near = getConjunctionViewDistance(0.004);
    expect(near).toBeLessThan(far);
  });

  it('never collapses below a usable minimum', () => {
    expect(getConjunctionViewDistance(0)).toBeGreaterThan(0);
  });

  it('does not open on a globe-scale shot for a wide live gap', () => {
    const wide = getConjunctionViewDistance(0.08);
    expect(wide).toBeLessThanOrEqual(0.085);
  });
});

describe('getVisualConjunctionLayout', () => {
  it('keeps true positions without on-screen exaggeration', () => {
    const a = { x: 1.1, y: 0, z: 0 };
    const b = { x: 1.10001, y: 0, z: 0 };
    const layout = getVisualConjunctionLayout(a, b, 0.5);
    expect(layout.exaggerated).toBe(false);
    expect(layout.visualA.x).toBeCloseTo(a.x, 8);
    expect(layout.visualB.x).toBeCloseTo(b.x, 8);
    expect(layout.separationScene).toBeCloseTo(0.00001, 8);
  });
});

describe('getConjunctionCameraPose', () => {
  const dirTo = (p: { cameraPos: Vector3; target: Vector3 }) => p.cameraPos.clone().sub(p.target).normalize();

  it('views the pair side-on, never along the line that joins them', () => {
    // Pair separated along the radial direction: the worst case for overlap.
    const radialPair = getConjunctionCameraPose({ x: 1.1, y: 0, z: 0 }, { x: 1.1 + 0.0003, y: 0, z: 0 }, 2);
    // Pair separated sideways.
    const sidePair = getConjunctionCameraPose({ x: 1.1, y: 0, z: 0 }, { x: 1.1, y: 0.0003, z: 0 }, 2);
    expect(Math.abs(dirTo(radialPair).dot({ x: 1, y: 0, z: 0 } as never))).toBeLessThan(0.01);
    expect(Math.abs(dirTo(sidePair).y)).toBeLessThan(0.01);
  });
});

describe('getConjunctionCameraPose with frameWholePair (historical event replays)', () => {
  // Two objects at 789 km altitude, 2,739 km apart (Iridium 33 / Cosmos 2251 at T-5 min).
  const r = 1 + 789 / EARTH_RADIUS_KM;
  const half = 2739 / 2 / EARTH_RADIUS_KM / r; // half the angle between them, seen from Earth's centre
  const a = { x: r * Math.cos(half), y: r * Math.sin(half), z: 0 };
  const b = { x: r * Math.cos(half), y: -r * Math.sin(half), z: 0 };
  const sepKm = 2739;

  it('moves back until both objects are inside the view, with room to spare', () => {
    const pose = getConjunctionCameraPose(a, b, sepKm, { frameWholePair: true });
    const forward = pose.target.clone().sub(pose.cameraPos).normalize();
    const halfFov = (pose.fov * Math.PI) / 360;
    for (const p of [a, b]) {
      const towards = new Vector3(p.x, p.y, p.z).sub(pose.cameraPos).normalize();
      expect(forward.angleTo(towards)).toBeLessThan(halfFov * 0.75);
    }
    // The capped close-approach pose cannot: it is far too close for this gap.
    const capped = getConjunctionCameraPose(a, b, sepKm);
    expect(capped.cameraPos.distanceTo(capped.target)).toBeLessThan(0.1);
  });

  it('looks from the side and 30 degrees above the local horizon, so the edge of Earth shows', () => {
    const pose = getConjunctionCameraPose(a, b, sepKm, { frameWholePair: true });
    const fromPair = pose.cameraPos.clone().sub(pose.target).normalize();
    const up = pose.target.clone().normalize();
    expect((Math.asin(fromPair.dot(up)) * 180) / Math.PI).toBeCloseTo(30, 6);
    // Across the line joining the pair, so neither hides the other.
    expect(Math.abs(fromPair.dot(new Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize()))).toBeLessThan(1e-9);
    expect(pose.cameraPos.length()).toBeGreaterThan(r);
    expect(pose.cameraPos.distanceTo(pose.target)).toBeCloseTo(wholePairViewDistance(2739 / EARTH_RADIUS_KM), 3);
  });

  it('keeps the usual close-approach pose when the pair already fits', () => {
    const near = { x: 1.1, y: 0, z: 0 };
    const nearB = { x: 1.1, y: 0.0003, z: 0 };
    const usual = getConjunctionCameraPose(near, nearB, 2);
    const option = getConjunctionCameraPose(near, nearB, 2, { frameWholePair: true });
    expect(option.cameraPos.distanceTo(usual.cameraPos)).toBeLessThan(1e-12);
  });
});
