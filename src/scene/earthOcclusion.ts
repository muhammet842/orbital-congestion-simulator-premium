import type { PropagationResult } from '../orbital/propagator';
import { ORBIT_DISPLAY_SCALE } from '../types';

/** Earth is a unit sphere in scene space (see Earth.ts). */
const EARTH_SCENE_RADIUS = 1;

/**
 * True when the straight line from the camera to `point` passes through the
 * Earth sphere, i.e. the object is genuinely hidden behind the globe.
 *
 * Objects on the far side of the globe but outside Earth's silhouette (most of
 * the far GEO ring, MEO, HEO apogees) remain visible.
 */
export function isOccludedByEarth(
  point: { x: number; y: number; z: number },
  camera: { x: number; y: number; z: number },
): boolean {
  const dx = point.x - camera.x;
  const dy = point.y - camera.y;
  const dz = point.z - camera.z;
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) return false;
  const b = 2 * (camera.x * dx + camera.y * dy + camera.z * dz);
  const c =
    camera.x * camera.x +
    camera.y * camera.y +
    camera.z * camera.z -
    EARTH_SCENE_RADIUS * EARTH_SCENE_RADIUS;
  // Camera inside the globe: nothing sensible to occlude against.
  if (c <= 0) return false;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 && t < 1;
}

/** Scene-space visibility test for a propagated object (ECI km → scene units). */
export function isVisibleFromCamera(
  result: PropagationResult,
  camera: { x: number; y: number; z: number },
): boolean {
  // Same axis swap as eciToScene, without allocating.
  const p = result.positionEci;
  return !isOccludedByEarth(
    {
      x: p.x * ORBIT_DISPLAY_SCALE,
      y: p.z * ORBIT_DISPLAY_SCALE,
      z: -p.y * ORBIT_DISPLAY_SCALE,
    },
    camera,
  );
}
