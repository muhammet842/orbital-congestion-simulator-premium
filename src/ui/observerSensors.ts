/**
 * Live GPS + device-compass sensors for the satellite spotter.
 *
 * Location is persisted so a denied permission still allows manual lat/lon.
 * Compass uses DeviceOrientationEvent (iOS requires an explicit permission grant).
 *
 * Orientation updates write into a mutable snapshot without notifying listeners on
 * every sensor tick — the Spotter interval polls instead (avoids UI jank).
 *
 * Heading is only trusted from iOS `webkitCompassHeading` or
 * `deviceorientationabsolute`. Plain relative `deviceorientation` uses an
 * arbitrary reference frame and must not drive turn cues.
 */

import type { ObserverLocation } from '../orbital/lookAngles';
import { trueHeadingAtLocationDeg } from '../orbital/magneticDeclination';

const LS_LOCATION_KEY = 'orbital-spotter-location';

/**
 * When the back-camera look vector is near zenith/nadir its azimuth is undefined —
 * freeze the last stable camera heading.
 */
const GIMBAL_LOCK_ELEV_DEG = 85;
/** Ignore heading micro-jitter below this before updating the snapshot (degrees). */
const ORIENT_EPSILON_HEADING_DEG = 0.45;
/** Ignore pitch micro-jitter below this — pitch noise causes sky “bounce”. */
const ORIENT_EPSILON_PITCH_DEG = 1.25;
/** EMA when nearly still (lower = calmer sky). */
const HEADING_SMOOTH_SLOW = 0.1;
const PITCH_SMOOTH_SLOW = 0.03;
/** EMA when the user makes a clear intentional move. */
const HEADING_SMOOTH_FAST = 0.35;
const PITCH_SMOOTH_FAST = 0.18;
/** Delta (deg) at which smoothing reaches the fast rate — keep high so noise ≠ “move”. */
const ORIENT_FAST_DELTA_DEG = 16;
/** Drop single-sample pitch spikes farther than this from the median (degrees). */
const PITCH_SPIKE_REJECT_DEG = 6;
/** Rolling window for pitch median pre-filter. */
const PITCH_MEDIAN_WINDOW = 7;
/** Horizontal GPS accuracy above this (meters) is treated as “poor”. */
export const GPS_ACCURACY_WARN_M = 80;
/**
 * If absolute orientation goes silent this long, drop sticky absolute preference
 * and clear heading (do not fall back to relative-as-compass).
 */
export const ABSOLUTE_HEADING_STALE_MS = 2_500;

export type HeadingSource = 'webkit' | 'absolute' | null;

export interface SensorSnapshot {
  location: ObserverLocation | null;
  locationSource: 'gps' | 'manual' | 'cached' | null;
  locationError: string | null;
  /** Horizontal GPS accuracy in meters (GeolocationCoordinates.accuracy), if known. */
  accuracyMeters: number | null;
  /** True-north heading in degrees (magnetic compass corrected by WMM declination). */
  headingDeg: number | null;
  /** True when headingDeg comes from webkit or absolute orientation (safe for turn cues). */
  headingReliable: boolean;
  /** Which trusted API produced the current heading. */
  headingSource: HeadingSource;
  /**
   * Back-camera look elevation above the horizon (degrees): 0 = horizon, 90 = zenith.
   * Matches pointing the rear camera / looking “through” the screen into the sky.
   */
  pitchDeg: number | null;
  /** WMM declination applied at the current location (east-positive), or null. */
  declinationDeg: number | null;
  headingError: string | null;
  orientationPermission: 'unknown' | 'granted' | 'denied' | 'unsupported';
}

type Listener = (snap: SensorSnapshot) => void;

let watchId: number | null = null;
let orientationBound = false;
let listeners = new Set<Listener>();
/** Last heading accepted outside gimbal lock (looking straight up). */
let lastStableHeadingDeg: number | null = null;
let lastStableHeadingSource: Exclude<HeadingSource, null> | null = null;
/** Prefer absolute events when the browser provides them (Android). */
let preferAbsoluteHeading = false;
/** Last time a trusted absolute/webkit heading sample arrived. */
let lastTrustedHeadingMs = 0;
/** Smoothed magnetic heading before WMM true-north correction. */
let smoothedMagneticHeading: number | null = null;
let smoothedPitch: number | null = null;
/** Recent raw pitch samples for median spike rejection. */
let pitchRawWindow: number[] = [];

let snapshot: SensorSnapshot = {
  location: loadCachedLocation(),
  locationSource: loadCachedLocation() ? 'cached' : null,
  locationError: null,
  accuracyMeters: null,
  headingDeg: null,
  headingReliable: false,
  headingSource: null,
  pitchDeg: null,
  declinationDeg: null,
  headingError: null,
  orientationPermission: 'unknown',
};

function loadCachedLocation(): ObserverLocation | null {
  try {
    const raw = localStorage.getItem(LS_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ObserverLocation;
    if (
      typeof parsed.latitudeDeg === 'number' &&
      typeof parsed.longitudeDeg === 'number' &&
      Number.isFinite(parsed.latitudeDeg) &&
      Number.isFinite(parsed.longitudeDeg) &&
      // A value outside the Earth's ranges would feed nonsense into the pass maths.
      Math.abs(parsed.latitudeDeg) <= 90 &&
      Math.abs(parsed.longitudeDeg) <= 180
    ) {
      const altitudeKm = typeof parsed.altitudeKm === 'number' && Number.isFinite(parsed.altitudeKm) ? parsed.altitudeKm : 0;
      return {
        latitudeDeg: parsed.latitudeDeg,
        longitudeDeg: parsed.longitudeDeg,
        // Between the Dead Sea shore and the top of Everest, with room to spare.
        altitudeKm: Math.min(10, Math.max(-1, altitudeKm)),
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function persistLocation(loc: ObserverLocation): void {
  try {
    localStorage.setItem(LS_LOCATION_KEY, JSON.stringify(loc));
  } catch {
    /* ignore */
  }
}

function cloneSnap(): SensorSnapshot {
  return {
    ...snapshot,
    location: snapshot.location ? { ...snapshot.location } : null,
  };
}

function emit(): void {
  const snap = cloneSnap();
  for (const fn of listeners) fn(snap);
}

/** Location / permission changes notify subscribers. Orientation does not. */
function setPartial(partial: Partial<SensorSnapshot>, notify = true): void {
  snapshot = { ...snapshot, ...partial };
  if (notify) emit();
}

export function getSensorSnapshot(): SensorSnapshot {
  return cloneSnap();
}

export function subscribeSensors(fn: Listener): () => void {
  listeners.add(fn);
  fn(getSensorSnapshot());
  return () => {
    listeners.delete(fn);
  };
}

export function setManualLocation(loc: ObserverLocation): void {
  const next = {
    latitudeDeg: clamp(loc.latitudeDeg, -90, 90),
    longitudeDeg: clamp(loc.longitudeDeg, -180, 180),
    altitudeKm: loc.altitudeKm ?? 0,
  };
  persistLocation(next);
  setPartial({
    location: next,
    locationSource: 'manual',
    locationError: null,
    accuracyMeters: null,
  });
  refreshTrueHeadingFromMagnetic();
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Shortest signed delta degrees in (−180, 180]. */
function signedDeltaDeg(from: number, to: number): number {
  let d = wrap360(to) - wrap360(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function smoothAngle360(prev: number | null, next: number, alpha: number): number {
  if (prev == null) return next;
  return wrap360(prev + signedDeltaDeg(prev, next) * alpha);
}

function smoothLinear(prev: number | null, next: number, alpha: number): number {
  if (prev == null) return next;
  return prev + (next - prev) * alpha;
}

/** Heavier smoothing when nearly still; snappier on intentional sweeps. */
function adaptiveSmoothAlpha(deltaDeg: number, slow: number, fast: number): number {
  const t = Math.min(1, Math.max(0, Math.abs(deltaDeg) / ORIENT_FAST_DELTA_DEG));
  return slow + (fast - slow) * t * t;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Median-filter raw pitch, reject wild single-sample spikes, then return the
 * value to feed into the EMA. Returns null when the sample should be ignored.
 */
function stabilizeRawPitch(rawPitch: number): number | null {
  pitchRawWindow.push(rawPitch);
  if (pitchRawWindow.length > PITCH_MEDIAN_WINDOW) pitchRawWindow.shift();
  const med = medianOf(pitchRawWindow);
  if (Math.abs(rawPitch - med) > PITCH_SPIKE_REJECT_DEG && pitchRawWindow.length >= 3) {
    return med;
  }
  return med;
}

/**
 * Compass heading of the back-camera / through-screen look vector (−Z), in
 * degrees from magnetic north. Stable when the phone is held upright (unlike
 * raw `360 - alpha`, which flips around β ≈ ±90°).
 *
 * Based on the W3C / Opera deviceorientation compass derivation (horizontal
 * projection of the device −Z axis after Rz(α)·Rx(β)·Ry(γ)).
 */
export function compassHeadingFromEuler(alpha: number, beta: number, gamma: number): number {
  return cameraLookFromEuler(alpha, beta, gamma).headingDeg;
}

/**
 * Back-camera look direction in the W3C Earth frame (X east, Y north, Z up).
 * Elevation: 0 = horizon, +90 = zenith, negative = below horizon.
 * Upright portrait (β≈90): horizon ahead; tip camera up (β→180): toward zenith.
 */
export function cameraLookFromEuler(
  alpha: number,
  beta: number,
  gamma: number,
): { headingDeg: number; elevationDeg: number } {
  const toRad = Math.PI / 180;
  const a = alpha * toRad;
  const b = beta * toRad;
  const g = gamma * toRad;

  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);

  // R * (0, 0, -1) with R = Rz(α) Rx(β) Ry(γ)
  const x = -ca * sg - sa * sb * cg;
  const y = -sa * sg + ca * sb * cg;
  const z = -cb * cg;

  return {
    headingDeg: wrap360(Math.atan2(x, y) * (180 / Math.PI)),
    elevationDeg: clamp(Math.asin(clamp(z, -1, 1)) * (180 / Math.PI), -90, 90),
  };
}

/** Horizontal projection of the device +Y (top bezel) axis. */
function topAxisFromEuler(
  alpha: number,
  beta: number,
  gamma: number,
): { headingDeg: number; elevationDeg: number } {
  const toRad = Math.PI / 180;
  const a = alpha * toRad;
  const b = beta * toRad;
  // Ry does not move +Y; R*(0,1,0) = (−sinα·cosβ, cosα·cosβ, sinβ)
  void gamma;
  const x = -Math.sin(a) * Math.cos(b);
  const y = Math.cos(a) * Math.cos(b);
  const z = Math.sin(b);
  return {
    headingDeg: wrap360(Math.atan2(x, y) * (180 / Math.PI)),
    elevationDeg: clamp(Math.asin(clamp(z, -1, 1)) * (180 / Math.PI), -90, 90),
  };
}

/**
 * iOS `webkitCompassHeading` is the top-of-device bearing. Convert it to the
 * back-camera bearing using the top↔camera azimuth offset from β/γ.
 * When the top axis is near vertical (upright), iOS already reports facing ≈ camera.
 */
export function webkitCompassToCameraHeading(
  webkitHeadingDeg: number,
  beta: number,
  gamma: number,
): number {
  const top = topAxisFromEuler(0, beta, gamma);
  if (Math.abs(top.elevationDeg) >= GIMBAL_LOCK_ELEV_DEG) {
    return wrap360(webkitHeadingDeg);
  }
  const cam = cameraLookFromEuler(0, beta, gamma);
  const offset = signedDeltaDeg(top.headingDeg, cam.headingDeg);
  return wrap360(webkitHeadingDeg + offset);
}

/**
 * Back-camera elevation above the horizon (degrees).
 * 0 = aimed at horizon, +90 = zenith, negative = below horizon.
 */
export function lookElevationFromEuler(beta: number, gamma: number): number {
  return cameraLookFromEuler(0, beta, gamma).elevationDeg;
}

export function screenOrientationOffsetDeg(): number {
  if (typeof window === 'undefined') return 0;
  const so = window.screen?.orientation?.angle;
  if (typeof so === 'number' && Number.isFinite(so)) return so;
  const legacy = (window as Window & { orientation?: number }).orientation;
  if (typeof legacy === 'number' && Number.isFinite(legacy)) return legacy;
  return 0;
}

export interface ParsedOrientationHeading {
  /** Magnetic heading degrees [0, 360), already screen-orientation compensated. */
  heading: number;
  source: Exclude<HeadingSource, null>;
}

/**
 * Extract a *trusted* compass heading from a DeviceOrientation event.
 * Returns null for untrusted relative-only Euler frames (arbitrary zero).
 * Heading is the back-camera / through-screen look azimuth (not the top bezel).
 */
export function headingFromOrientationEvent(
  event: DeviceOrientationEvent,
  opts: { treatAsAbsolute?: boolean } = {},
): ParsedOrientationHeading | null {
  const beta = typeof event.beta === 'number' && Number.isFinite(event.beta) ? event.beta : null;
  const gamma = typeof event.gamma === 'number' && Number.isFinite(event.gamma) ? event.gamma : 0;

  // Camera near zenith/nadir → azimuth undefined; keep last stable heading.
  if (beta != null) {
    const camElev = lookElevationFromEuler(beta, gamma);
    if (Math.abs(camElev) >= GIMBAL_LOCK_ELEV_DEG) {
      if (lastStableHeadingDeg == null || lastStableHeadingSource == null) return null;
      return { heading: lastStableHeadingDeg, source: lastStableHeadingSource };
    }
  }

  const webkit = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  if (typeof webkit === 'number' && Number.isFinite(webkit)) {
    const b = beta ?? 0;
    const cameraHeading = webkitCompassToCameraHeading(webkit, b, gamma);
    // Screen-rotation compensation so landscape UI still matches camera yaw.
    const heading = wrap360(cameraHeading - screenOrientationOffsetDeg());
    lastStableHeadingDeg = heading;
    lastStableHeadingSource = 'webkit';
    return { heading, source: 'webkit' };
  }

  const trustedAbsolute = opts.treatAsAbsolute === true || event.absolute === true;
  if (!trustedAbsolute) {
    // Relative deviceorientation without webkitCompassHeading is not a compass.
    return null;
  }

  if (typeof event.alpha !== 'number' || !Number.isFinite(event.alpha)) return null;

  const b = beta ?? 0;
  const raw =
    beta != null
      ? cameraLookFromEuler(event.alpha, b, gamma).headingDeg
      : wrap360(360 - event.alpha);
  // Same screen-angle compensation as the webkit path (landscape Android).
  const heading = wrap360(raw - screenOrientationOffsetDeg());
  lastStableHeadingDeg = heading;
  lastStableHeadingSource = 'absolute';
  return { heading, source: 'absolute' };
}

export function pitchFromOrientationEvent(event: DeviceOrientationEvent): number | null {
  if (typeof event.beta !== 'number' || !Number.isFinite(event.beta)) return null;
  const gamma = typeof event.gamma === 'number' && Number.isFinite(event.gamma) ? event.gamma : 0;
  return lookElevationFromEuler(event.beta, gamma);
}

export function startGeolocation(): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    setPartial({ locationError: 'unsupported' });
    return;
  }
  if (watchId != null) return;

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const next: ObserverLocation = {
        latitudeDeg: pos.coords.latitude,
        longitudeDeg: pos.coords.longitude,
        altitudeKm: (pos.coords.altitude ?? 0) / 1000,
      };
      persistLocation(next);
      const accuracyMeters =
        typeof pos.coords.accuracy === 'number' && Number.isFinite(pos.coords.accuracy)
          ? pos.coords.accuracy
          : null;
      setPartial({
        location: next,
        locationSource: 'gps',
        locationError: null,
        accuracyMeters,
      });
      refreshTrueHeadingFromMagnetic();
    },
    (err) => {
      const code =
        err.code === err.PERMISSION_DENIED
          ? 'denied'
          : err.code === err.POSITION_UNAVAILABLE
            ? 'unavailable'
            : 'timeout';
      setPartial({ locationError: code });
    },
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
  );
}

export function stopGeolocation(): void {
  if (watchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function onOrientationAbsolute(event: DeviceOrientationEvent): void {
  preferAbsoluteHeading = true;
  lastTrustedHeadingMs = nowMs();
  applyOrientation(event, { treatAsAbsolute: true });
}

function onOrientationRelative(event: DeviceOrientationEvent): void {
  if (preferAbsoluteHeading) {
    if (nowMs() - lastTrustedHeadingMs > ABSOLUTE_HEADING_STALE_MS) {
      // Absolute stream died — do not silently fall back to relative-as-compass.
      preferAbsoluteHeading = false;
      clearTrustedHeading('stale');
      applyPitchOnly(event);
      return;
    }
    // Absolute is healthy: still update pitch from relative (often higher rate).
    applyPitchOnly(event);
    return;
  }
  applyOrientation(event, { treatAsAbsolute: false });
}

function clearTrustedHeading(reason: string): void {
  smoothedMagneticHeading = null;
  snapshot = {
    ...snapshot,
    headingDeg: null,
    headingReliable: false,
    headingSource: null,
    headingError: reason,
  };
}

function applyPitchOnly(event: DeviceOrientationEvent): void {
  const rawPitch = pitchFromOrientationEvent(event);
  if (rawPitch == null) return;
  const stable = stabilizeRawPitch(rawPitch);
  if (stable == null) return;
  const pitchDelta = smoothedPitch == null ? ORIENT_FAST_DELTA_DEG : Math.abs(stable - smoothedPitch);
  smoothedPitch = smoothLinear(
    smoothedPitch,
    stable,
    adaptiveSmoothAlpha(pitchDelta, PITCH_SMOOTH_SLOW, PITCH_SMOOTH_FAST),
  );
  const prevP = snapshot.pitchDeg;
  if (prevP != null && Math.abs(prevP - smoothedPitch) < ORIENT_EPSILON_PITCH_DEG) return;
  snapshot = {
    ...snapshot,
    pitchDeg: smoothedPitch,
    orientationPermission: 'granted',
  };
}

/** Write smoothed orientation into snapshot without notifying listeners. */
function applyOrientation(
  event: DeviceOrientationEvent,
  opts: { treatAsAbsolute: boolean },
): void {
  const parsed = headingFromOrientationEvent(event, opts);
  const rawPitch = pitchFromOrientationEvent(event);

  if (parsed == null && rawPitch == null) {
    if (snapshot.headingError !== 'unavailable' && snapshot.headingDeg == null) {
      setPartial({ headingError: 'unavailable' }, false);
    }
    return;
  }

  if (parsed != null) {
    const headingDelta =
      smoothedMagneticHeading == null
        ? ORIENT_FAST_DELTA_DEG
        : Math.abs(signedDeltaDeg(smoothedMagneticHeading, parsed.heading));
    smoothedMagneticHeading = smoothAngle360(
      smoothedMagneticHeading,
      parsed.heading,
      adaptiveSmoothAlpha(headingDelta, HEADING_SMOOTH_SLOW, HEADING_SMOOTH_FAST),
    );
    lastTrustedHeadingMs = nowMs();
  } else if (snapshot.headingDeg == null && snapshot.headingError !== 'needs_compass') {
    // Pitch-only relative stream — tell the UI that turn cues are unavailable.
    snapshot = {
      ...snapshot,
      headingReliable: false,
      headingSource: null,
      headingError: 'needs_compass',
    };
  }

  if (rawPitch != null) {
    const stable = stabilizeRawPitch(rawPitch);
    if (stable != null) {
      const pitchDelta = smoothedPitch == null ? ORIENT_FAST_DELTA_DEG : Math.abs(stable - smoothedPitch);
      smoothedPitch = smoothLinear(
        smoothedPitch,
        stable,
        adaptiveSmoothAlpha(pitchDelta, PITCH_SMOOTH_SLOW, PITCH_SMOOTH_FAST),
      );
    }
  }

  const nextTrue = parsed != null ? toTrueHeading(smoothedMagneticHeading) : snapshot.headingDeg;
  const nextPitch = smoothedPitch ?? snapshot.pitchDeg;
  const prevH = snapshot.headingDeg;
  const prevP = snapshot.pitchDeg;

  const headingChanged =
    parsed != null &&
    nextTrue != null &&
    (prevH == null || Math.abs(signedDeltaDeg(prevH, nextTrue)) >= ORIENT_EPSILON_HEADING_DEG);
  const pitchChanged =
    nextPitch != null && (prevP == null || Math.abs(prevP - nextPitch) >= ORIENT_EPSILON_PITCH_DEG);

  if (!headingChanged && !pitchChanged && parsed == null) return;

  const loc = snapshot.location;
  const declinationDeg =
    loc != null
      ? trueHeadingAtLocationDeg(0, loc.latitudeDeg, loc.longitudeDeg, loc.altitudeKm ?? 0)
      : snapshot.declinationDeg;

  snapshot = {
    ...snapshot,
    headingDeg: parsed != null ? nextTrue : snapshot.headingDeg,
    headingReliable: parsed != null || snapshot.headingReliable,
    headingSource: parsed?.source ?? snapshot.headingSource,
    pitchDeg: nextPitch,
    declinationDeg,
    headingError: parsed != null ? null : snapshot.headingError,
    orientationPermission: 'granted',
  };
}

function toTrueHeading(magnetic: number | null): number | null {
  if (magnetic == null) return null;
  const loc = snapshot.location;
  if (!loc) return magnetic;
  return trueHeadingAtLocationDeg(
    magnetic,
    loc.latitudeDeg,
    loc.longitudeDeg,
    loc.altitudeKm ?? 0,
  );
}

/** Re-apply WMM correction after GPS/manual location changes. */
function refreshTrueHeadingFromMagnetic(): void {
  if (smoothedMagneticHeading == null || !snapshot.headingReliable) return;
  const nextTrue = toTrueHeading(smoothedMagneticHeading);
  const loc = snapshot.location;
  const declinationDeg =
    loc != null
      ? trueHeadingAtLocationDeg(0, loc.latitudeDeg, loc.longitudeDeg, loc.altitudeKm ?? 0)
      : null;
  snapshot = {
    ...snapshot,
    headingDeg: nextTrue,
    declinationDeg,
  };
}

export async function startOrientation(): Promise<void> {
  if (typeof window === 'undefined') {
    setPartial({ orientationPermission: 'unsupported', headingError: 'unsupported' });
    return;
  }

  const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };

  if (typeof DOE.requestPermission === 'function') {
    try {
      const result = await DOE.requestPermission();
      if (result !== 'granted') {
        setPartial({ orientationPermission: 'denied', headingError: 'denied' });
        return;
      }
      setPartial({ orientationPermission: 'granted' });
    } catch {
      setPartial({ orientationPermission: 'denied', headingError: 'denied' });
      return;
    }
  } else if (!('DeviceOrientationEvent' in window)) {
    setPartial({ orientationPermission: 'unsupported', headingError: 'unsupported' });
    return;
  } else {
    setPartial({ orientationPermission: 'granted' });
  }

  if (!orientationBound) {
    window.addEventListener('deviceorientationabsolute', onOrientationAbsolute as EventListener, true);
    window.addEventListener('deviceorientation', onOrientationRelative, true);
    orientationBound = true;
  }
}

export function stopOrientation(): void {
  if (orientationBound) {
    window.removeEventListener('deviceorientationabsolute', onOrientationAbsolute as EventListener, true);
    window.removeEventListener('deviceorientation', onOrientationRelative, true);
    orientationBound = false;
  }
  lastStableHeadingDeg = null;
  lastStableHeadingSource = null;
  preferAbsoluteHeading = false;
  lastTrustedHeadingMs = 0;
  smoothedMagneticHeading = null;
  smoothedPitch = null;
  pitchRawWindow = [];
  snapshot = {
    ...snapshot,
    headingDeg: null,
    headingReliable: false,
    headingSource: null,
    pitchDeg: null,
    declinationDeg: null,
  };
}

/** Start both sensors (call when Spotter opens). */
export function startObserverSensors(): void {
  startGeolocation();
  void startOrientation();
}

/** Tear down watches (call when Spotter closes). */
export function stopObserverSensors(): void {
  stopGeolocation();
  stopOrientation();
}

/** Test helper — reset module-level orientation state between cases. */
export function __resetOrientationStateForTests(): void {
  lastStableHeadingDeg = null;
  lastStableHeadingSource = null;
  preferAbsoluteHeading = false;
  lastTrustedHeadingMs = 0;
  smoothedMagneticHeading = null;
  smoothedPitch = null;
  pitchRawWindow = [];
  snapshot = {
    ...snapshot,
    headingDeg: null,
    headingReliable: false,
    headingSource: null,
    pitchDeg: null,
    declinationDeg: null,
    headingError: null,
  };
}
