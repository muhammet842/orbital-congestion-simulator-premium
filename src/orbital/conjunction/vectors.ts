/**
 * Small vector helpers: distance, relative speed, midpoint in scene units.
 */
import { eciToScene } from '../coordinates';

export function distanceKm(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function relativeVelocityKmS(
  va: { x: number; y: number; z: number },
  vb: { x: number; y: number; z: number },
): number {
  const dx = va.x - vb.x;
  const dy = va.y - vb.y;
  const dz = va.z - vb.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function midpointScene(
  posA: { x: number; y: number; z: number },
  posB: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const sceneA = eciToScene(posA.x, posA.y, posA.z);
  const sceneB = eciToScene(posB.x, posB.y, posB.z);
  return {
    x: (sceneA.x + sceneB.x) / 2,
    y: (sceneA.y + sceneB.y) / 2,
    z: (sceneA.z + sceneB.z) / 2,
  };
}
