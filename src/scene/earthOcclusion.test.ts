import { describe, expect, it } from 'vitest';
import { isOccludedByEarth } from './earthOcclusion';

const camera = { x: 0, y: 0, z: 4.5 };

describe('isOccludedByEarth', () => {
  it('keeps objects in front of the globe visible', () => {
    expect(isOccludedByEarth({ x: 0, y: 0, z: 1.1 }, camera)).toBe(false);
  });

  it('hides objects directly behind the globe', () => {
    expect(isOccludedByEarth({ x: 0, y: 0, z: -1.1 }, camera)).toBe(true);
    expect(isOccludedByEarth({ x: 0.3, y: 0.2, z: -6.6 }, camera)).toBe(true);
  });

  it('keeps far-side GEO objects outside the silhouette visible', () => {
    // GEO radius ≈ 6.6 Earth radii; behind the globe but well off-axis.
    expect(isOccludedByEarth({ x: 6.0, y: 0, z: -2.7 }, camera)).toBe(false);
    expect(isOccludedByEarth({ x: 0, y: -5.5, z: -3.6 }, camera)).toBe(false);
  });

  it('keeps LEO objects just past the limb visible', () => {
    // Tangent from camera at z=4.5 touches the unit sphere near z≈0.22.
    expect(isOccludedByEarth({ x: 1.05, y: 0, z: 0 }, camera)).toBe(false);
  });

  it('never occludes when the camera is inside the sphere', () => {
    expect(isOccludedByEarth({ x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 0.5 })).toBe(false);
  });
});
