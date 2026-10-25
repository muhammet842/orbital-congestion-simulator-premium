/**
 * Ground-observer look angles for a selected satellite.
 *
 * Uses satellite.js SGP4 + ECF topocentric transforms so any catalog object
 * (ISS, Starlink, debris, …) can be aimed at from a phone GPS location.
 */

import {
  degreesToRadians,
  ecfToEci,
  ecfToLookAngles,
  eciToEcf,
  geodeticToEcf,
  gstime,
  propagate,
  type EciVec3,
  type SatRec,
} from 'satellite.js';

export interface ObserverLocation {
  /** Geodetic latitude, degrees (−90…+90). */
  latitudeDeg: number;
  /** Geodetic longitude, degrees (−180…+180). */
  longitudeDeg: number;
  /** Height above WGS84 ellipsoid, km (default 0). */
  altitudeKm?: number;
}

export interface LookAngles {
  /** Azimuth from true north, degrees clockwise (0 = N, 90 = E). */
  azimuthDeg: number;
  /** Elevation above local horizon, degrees (−90…+90). */
  elevationDeg: number;
  /** Slant range, km. */
  rangeKm: number;
  /** True when the satellite is above the geometric horizon. */
  visible: boolean;
}

export interface PassEvent {
  rise: { time: Date; azimuthDeg: number } | null;
  max: { time: Date; elevationDeg: number; azimuthDeg: number } | null;
  set: { time: Date; azimuthDeg: number } | null;
}

const DEG = 180 / Math.PI;
const VISIBLE_ELEV_DEG = 0;
/** Practical “worth aiming” threshold for photography guidance. */
export const GOOD_ELEV_DEG = 10;
const EARTH_RADIUS_KM = 6378.137;

function wrap360(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

/**
 * Signed turn from device heading to target azimuth, degrees in (−180, 180].
 * Positive = turn right (clockwise); negative = turn left.
 */
export function headingDelta(deviceHeadingDeg: number, targetAzimuthDeg: number): number {
  let d = wrap360(targetAzimuthDeg) - wrap360(deviceHeadingDeg);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Angular separation on the sky between two az/el directions (degrees).
 * Used to decide whether the phone is aimed at the satellite.
 */
export function skyAngularSeparationDeg(
  az1Deg: number,
  el1Deg: number,
  az2Deg: number,
  el2Deg: number,
): number {
  const toRad = Math.PI / 180;
  const a1 = wrap360(az1Deg) * toRad;
  const a2 = wrap360(az2Deg) * toRad;
  const e1 = el1Deg * toRad;
  const e2 = el2Deg * toRad;
  const c1 = Math.cos(e1);
  const c2 = Math.cos(e2);
  const x1 = c1 * Math.sin(a1);
  const y1 = c1 * Math.cos(a1);
  const z1 = Math.sin(e1);
  const x2 = c2 * Math.sin(a2);
  const y2 = c2 * Math.cos(a2);
  const z2 = Math.sin(e2);
  const dot = Math.min(1, Math.max(-1, x1 * x2 + y1 * y2 + z1 * z2));
  return Math.acos(dot) * (180 / Math.PI);
}

function observerGd(observer: ObserverLocation) {
  return {
    latitude: degreesToRadians(observer.latitudeDeg),
    longitude: degreesToRadians(observer.longitudeDeg),
    height: observer.altitudeKm ?? 0,
  };
}

/**
 * Instantaneous look angles from an observer to a satellite at `date`.
 * Returns null if SGP4 fails (decayed / invalid epoch).
 */
export function computeLookAngles(
  satrec: SatRec,
  observer: ObserverLocation,
  date: Date,
): LookAngles | null {
  const result = propagate(satrec, date);
  if (!result?.position) return null;

  const position = result.position as EciVec3<number>;
  const gmst = gstime(date);
  const positionEcf = eciToEcf(position, gmst);
  const look = ecfToLookAngles(observerGd(observer), positionEcf);

  const elevationDeg = look.elevation * DEG;
  return {
    azimuthDeg: wrap360(look.azimuth * DEG),
    elevationDeg,
    rangeKm: look.rangeSat,
    visible: elevationDeg > VISIBLE_ELEV_DEG,
  };
}

/**
 * Coarse scan for the next rise / max elevation / set within `horizonHours`.
 * Step size trades accuracy for speed — fine enough for photographer guidance.
 */
/**
 * The next pass that rises after `start` and climbs to at least
 * `minElevationDeg`: skips a pass already under way at `start` (its rise is
 * in the past) and low grazers, which findNextPass alone would return.
 */
export function findNextUsefulPass(
  satrec: SatRec,
  observer: ObserverLocation,
  start: Date,
  minElevationDeg: number,
  horizonHours = 18,
  stepSeconds = 60,
): PassEvent | null {
  const endMs = start.getTime() + horizonHours * 3_600_000;
  let fromMs = start.getTime();
  // A handful of passes is plenty: low-orbit passes come every ~90 minutes.
  for (let i = 0; i < 12 && fromMs < endMs; i++) {
    const pass = findNextPass(satrec, observer, new Date(fromMs), (endMs - fromMs) / 3_600_000, stepSeconds);
    if (!pass.max) return null;
    if (pass.rise && pass.max.elevationDeg >= minElevationDeg) return pass;
    if (!pass.set) return null;
    fromMs = pass.set.time.getTime() + stepSeconds * 1000;
  }
  return null;
}

export function findNextPass(
  satrec: SatRec,
  observer: ObserverLocation,
  start: Date,
  horizonHours = 18,
  stepSeconds = 60,
): PassEvent {
  const empty: PassEvent = { rise: null, max: null, set: null };
  const endMs = start.getTime() + horizonHours * 3_600_000;
  const stepMs = stepSeconds * 1000;

  let prev: LookAngles | null = null;
  let prevTime = start;
  let rise: PassEvent['rise'] = null;
  let max: PassEvent['max'] = null;
  let set: PassEvent['set'] = null;
  let tracking = false;

  for (let t = start.getTime(); t <= endMs; t += stepMs) {
    const time = new Date(t);
    const look = computeLookAngles(satrec, observer, time);
    if (!look) {
      prev = null;
      prevTime = time;
      continue;
    }

    if (prev && !tracking && prev.elevationDeg <= VISIBLE_ELEV_DEG && look.elevationDeg > VISIBLE_ELEV_DEG) {
      // Refine rise time within the step for a tighter clock display.
      const refined = refineHorizonCrossing(satrec, observer, prevTime, time, true);
      rise = { time: refined.time, azimuthDeg: refined.azimuthDeg };
      tracking = true;
      max = { time: refined.time, elevationDeg: refined.elevationDeg, azimuthDeg: refined.azimuthDeg };
    }

    if (tracking) {
      if (!max || look.elevationDeg > max.elevationDeg) {
        max = { time, elevationDeg: look.elevationDeg, azimuthDeg: look.azimuthDeg };
      }
      if (prev && prev.elevationDeg > VISIBLE_ELEV_DEG && look.elevationDeg <= VISIBLE_ELEV_DEG) {
        const refined = refineHorizonCrossing(satrec, observer, prevTime, time, false);
        set = { time: refined.time, azimuthDeg: refined.azimuthDeg };
        break;
      }
    }

    // Already up at scan start — treat as mid-pass.
    if (!tracking && look.elevationDeg > VISIBLE_ELEV_DEG && !rise) {
      tracking = true;
      max = { time, elevationDeg: look.elevationDeg, azimuthDeg: look.azimuthDeg };
    }

    prev = look;
    prevTime = time;
  }

  if (!tracking && !rise) return empty;

  // Refine the max-elevation sample with a ternary search (±1 coarse step).
  if (max) {
    const windowMs = stepMs;
    const refinedMax = refineMaxElevation(
      satrec,
      observer,
      new Date(max.time.getTime() - windowMs),
      new Date(max.time.getTime() + windowMs),
    );
    if (refinedMax) max = refinedMax;
  }

  return { rise, max, set };
}

/** Ternary-search peak elevation in [t0, t1] (~1–2 s accuracy). */
function refineMaxElevation(
  satrec: SatRec,
  observer: ObserverLocation,
  t0: Date,
  t1: Date,
): PassEvent['max'] {
  let lo = t0.getTime();
  let hi = t1.getTime();
  if (!(hi > lo)) return null;

  let best: PassEvent['max'] = null;
  for (let i = 0; i < 18; i++) {
    const m1 = Math.floor(lo + (hi - lo) / 3);
    const m2 = Math.floor(hi - (hi - lo) / 3);
    const a = computeLookAngles(satrec, observer, new Date(m1));
    const b = computeLookAngles(satrec, observer, new Date(m2));
    if (!a || !b) break;
    if (a.elevationDeg < b.elevationDeg) {
      lo = m1;
      best = { time: new Date(m2), elevationDeg: b.elevationDeg, azimuthDeg: b.azimuthDeg };
    } else {
      hi = m2;
      best = { time: new Date(m1), elevationDeg: a.elevationDeg, azimuthDeg: a.azimuthDeg };
    }
  }
  return best;
}

/** Binary-search the horizon crossing inside [t0, t1] (~1s accuracy). */
function refineHorizonCrossing(
  satrec: SatRec,
  observer: ObserverLocation,
  t0: Date,
  t1: Date,
  lookingForRise: boolean,
): { time: Date; azimuthDeg: number; elevationDeg: number } {
  let lo = t0.getTime();
  let hi = t1.getTime();
  let best = computeLookAngles(satrec, observer, lookingForRise ? t1 : t0);
  for (let i = 0; i < 12; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const look = computeLookAngles(satrec, observer, new Date(mid));
    if (!look) break;
    best = look;
    const above = look.elevationDeg > VISIBLE_ELEV_DEG;
    if (lookingForRise ? above : !above) hi = mid;
    else lo = mid;
  }
  const time = new Date(lookingForRise ? hi : lo);
  const look = computeLookAngles(satrec, observer, time) ?? best!;
  return { time, azimuthDeg: look.azimuthDeg, elevationDeg: look.elevationDeg };
}

/**
 * Rough photo-quality hint: satellite sunlit + observer in darkness.
 * Uses a simple umbra cylinder (Earth radius) in ECI — good enough for UI copy.
 */
export function assessPhotoConditions(
  satrec: SatRec,
  observer: ObserverLocation,
  date: Date,
  sunEciUnit: { x: number; y: number; z: number },
): { satelliteLit: boolean; observerDark: boolean; favorable: boolean } | null {
  const result = propagate(satrec, date);
  if (!result?.position) return null;
  const pos = result.position as EciVec3<number>;

  const satLit = isPositionSunlit(pos, sunEciUnit);
  const observerDark = isObserverDark(observerToApproxEci(observer, date), sunEciUnit);

  return {
    satelliteLit: satLit,
    observerDark,
    favorable: satLit && observerDark,
  };
}

/** The sky is dark enough to see satellites once the Sun is this far below the horizon (end of civil twilight). */
export const OBSERVER_DARK_SUN_DEPRESSION_DEG = 6;

/** Sun at least 6° below the observer's horizon (a surface point, so no Earth-shadow geometry). */
export function isObserverDark(
  observerEci: { x: number; y: number; z: number },
  sunUnit: { x: number; y: number; z: number },
): boolean {
  const r = Math.hypot(observerEci.x, observerEci.y, observerEci.z);
  if (r === 0) return false;
  const sinSunElevation = (observerEci.x * sunUnit.x + observerEci.y * sunUnit.y + observerEci.z * sunUnit.z) / r;
  return sinSunElevation < -Math.sin((OBSERVER_DARK_SUN_DEPRESSION_DEG * Math.PI) / 180);
}

function observerToApproxEci(observer: ObserverLocation, date: Date): { x: number; y: number; z: number } {
  const ecf = geodeticToEcf(observerGd(observer));
  return ecfToEci(ecf, gstime(date));
}

function isPositionSunlit(
  positionEci: { x: number; y: number; z: number },
  sunUnit: { x: number; y: number; z: number },
): boolean {
  const along = positionEci.x * sunUnit.x + positionEci.y * sunUnit.y + positionEci.z * sunUnit.z;
  if (along > 0) return true;
  const rx = positionEci.x - along * sunUnit.x;
  const ry = positionEci.y - along * sunUnit.y;
  const rz = positionEci.z - along * sunUnit.z;
  const radial = Math.sqrt(rx * rx + ry * ry + rz * rz);
  return radial > EARTH_RADIUS_KM;
}
