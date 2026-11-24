/**
 * Sky-map projection for Spotter: phone heading/pitch as camera look direction,
 * satellite az/el → canvas pixels.
 *
 * Uses a camera-basis / local-tangent projection (not raw Δaz×Δel). Plate-carrée
 * Δaz breaks near the zenith — azimuth is singular and distances explode, which
 * made “point phone straight up” show zero satellites.
 */

export const DEFAULT_FOV_DEG = 60;
/** Narrowest Spotter sky FOV (pinch / zoom in). */
export const MIN_FOV_DEG = 25;
/** Widest Spotter sky FOV (pinch / zoom out). */
export const MAX_FOV_DEG = 90;

export interface SkyViewCenter {
  headingDeg: number;
  pitchDeg: number;
}

export interface SkyAzEl {
  azimuthDeg: number;
  elevationDeg: number;
}

export interface SkyProjectResult {
  /** Pixel X from left (0…width). */
  x: number;
  /** Pixel Y from top (0…height). */
  y: number;
  /** True when inside the rectangular FOV (±fov/2 in both axes) and in front. */
  inView: boolean;
  /** Signed horizontal offset in the camera plane, degrees (−180…180]. */
  dAzDeg: number;
  /** Signed vertical offset in the camera plane, degrees. */
  dElDeg: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function wrap360(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Az/el (degrees) → ENU unit vector (x=east, y=north, z=up). */
export function azElToEnu(azimuthDeg: number, elevationDeg: number): Vec3 {
  const a = (wrap360(azimuthDeg) * Math.PI) / 180;
  const e = (clamp(elevationDeg, -90, 90) * Math.PI) / 180;
  const c = Math.cos(e);
  return {
    x: Math.sin(a) * c,
    y: Math.cos(a) * c,
    z: Math.sin(e),
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v: Vec3): Vec3 {
  const L = len(v);
  if (L < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}

/**
 * Camera orthonormal basis for a look direction (heading = az, pitch = el).
 * Handles zenith/nadir by falling back to a heading-defined “right” axis.
 */
export function lookBasis(headingDeg: number, pitchDeg: number): {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
} {
  const forward = azElToEnu(headingDeg, pitchDeg);
  const worldUp: Vec3 = { x: 0, y: 0, z: 1 };
  let right = cross(forward, worldUp);
  if (len(right) < 1e-4) {
    // Looking nearly straight up/down — pick right from heading.
    right = azElToEnu(headingDeg + 90, 0);
  } else {
    right = normalize(right);
  }
  const up = normalize(cross(right, forward));
  return { forward, right, up };
}

/** Great-circle angle between two az/el directions (degrees). */
export function skyAngularDistanceDeg(a: SkyAzEl, b: SkyAzEl): number {
  const u = azElToEnu(a.azimuthDeg, a.elevationDeg);
  const v = azElToEnu(b.azimuthDeg, b.elevationDeg);
  return (Math.acos(clamp(dot(u, v), -1, 1)) * 180) / Math.PI;
}

/**
 * Project a sky direction into a canvas centered on the phone look direction.
 * +x = right of facing, +y = down on screen (lower elevation / tip phone down).
 */
export function projectAzElToCanvas(
  view: SkyViewCenter,
  target: SkyAzEl,
  width: number,
  height: number,
  fovDeg = DEFAULT_FOV_DEG,
): SkyProjectResult {
  const basis = lookBasis(view.headingDeg, view.pitchDeg);
  const t = azElToEnu(target.azimuthDeg, target.elevationDeg);
  const forward = dot(t, basis.forward);
  const right = dot(t, basis.right);
  const up = dot(t, basis.up);

  // Angle offsets in the camera plane (equal-angle, stable at zenith).
  const dAzDeg = (Math.atan2(right, forward) * 180) / Math.PI;
  const dElDeg = (Math.atan2(up, forward) * 180) / Math.PI;
  const halfFov = fovDeg / 2;
  const pxPerDegX = width / fovDeg;
  const pxPerDegY = height / fovDeg;

  const x = width / 2 + dAzDeg * pxPerDegX;
  const y = height / 2 - dElDeg * pxPerDegY;
  const inView =
    forward > 0.02 &&
    Math.abs(dAzDeg) <= halfFov &&
    Math.abs(dElDeg) <= halfFov &&
    x >= 0 &&
    x <= width &&
    y >= 0 &&
    y <= height;

  return { x, y, inView, dAzDeg, dElDeg };
}

/** Angular distance from FOV center used for ranking candidates (degrees). */
export function skyFovCenterDistanceDeg(view: SkyViewCenter, target: SkyAzEl): number {
  return skyAngularDistanceDeg(
    { azimuthDeg: view.headingDeg, elevationDeg: view.pitchDeg },
    target,
  );
}

/**
 * Horizon line Y in canvas pixels for the current pitch
 * (elevation 0 along the look azimuth).
 */
export function horizonYForPitch(pitchDeg: number, height: number, fovDeg = DEFAULT_FOV_DEG): number {
  // Along look heading, horizon is el=0 → vertical camera angle = -pitch.
  return height / 2 - (0 - pitchDeg) * (height / fovDeg);
}

/** Cardinal label azimuths (true north = 0). */
export const CARDINAL_AZIMUTHS: ReadonlyArray<{ az: number; key: 'N' | 'E' | 'S' | 'W' }> = [
  { az: 0, key: 'N' },
  { az: 90, key: 'E' },
  { az: 180, key: 'S' },
  { az: 270, key: 'W' },
];
