import { describe, expect, it } from 'vitest';
import {
  getConjunctionCameraPose,
  getConjunctionViewDistance,
  getVisualConjunctionLayout,
  PAIR_FOCUS_NEAR,
  PAIR_INSPECT_MIN_DISTANCE,
} from './visualConjunction';

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
  const dirTo = (p: { cameraPos: { clone(): any }; target: { clone(): any } }) => p.cameraPos.clone().sub(p.target).normalize();

  it('views the pair side-on, never along the line that joins them', () => {
    // Pair separated along the radial direction: the worst case for overlap.
    const radialPair = getConjunctionCameraPose({ x: 1.1, y: 0, z: 0 }, { x: 1.1 + 0.0003, y: 0, z: 0 }, 2);
    // Pair separated sideways.
    const sidePair = getConjunctionCameraPose({ x: 1.1, y: 0, z: 0 }, { x: 1.1, y: 0.0003, z: 0 }, 2);
    expect(Math.abs(dirTo(radialPair).dot({ x: 1, y: 0, z: 0 } as never))).toBeLessThan(0.01);
    expect(Math.abs(dirTo(sidePair).y)).toBeLessThan(0.01);
  });
});
