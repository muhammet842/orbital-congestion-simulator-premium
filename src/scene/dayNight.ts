const SUN_DISTANCE = 15;

export interface DayNightState {
  earthRotationY: number;
  sunPosition: { x: number; y: number; z: number };
  /** Normalized sun direction from Earth center (for night-side emissive masking). */
  sunDirection: { x: number; y: number; z: number };
  utcDecimalHours: number;
}

function getUtcDecimalHours(date: Date): number {
  return (
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3_600_000
  );
}

function toJulianDate(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

/**
 * Sun direction as a unit vector in ECI (TEME-compatible) frame.
 * Uses the same low-precision solar longitude as before, but now also
 * computes the right ascension so we can place the sun correctly in the
 * inertial scene (ECI X → scene X, ECI Z → scene Y, −ECI Y → scene Z).
 * This makes the day/night terminator consistent with GMST-aligned Earth
 * texture and SGP4-propagated satellite positions.
 */
/** Unit sun direction in ECI (TEME-compatible) — shared with ground-observer photo hints. */
export function getSunEci(date: Date): { x: number; y: number; z: number } {
  const jd = toJulianDate(date);
  const n = jd - 2_451_545.0;
  const meanLongitudeDeg = (280.46 + 0.9856474 * n) % 360;
  const meanAnomalyRad = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambdaRad =
    (meanLongitudeDeg + 1.915 * Math.sin(meanAnomalyRad) + 0.02 * Math.sin(2 * meanAnomalyRad)) *
    (Math.PI / 180);
  const obliquityRad = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const sinLambda = Math.sin(lambdaRad);
  const cosLambda = Math.cos(lambdaRad);
  const cosObl = Math.cos(obliquityRad);
  const sinObl = Math.sin(obliquityRad);
  // ECI (vernal-equinox frame)
  return {
    x: cosLambda,
    y: cosObl * sinLambda,
    z: sinObl * sinLambda,
  };
}

/**
 * Greenwich Mean Sidereal Time (radians) — IAU 1982 / Meeus low-precision
 * formula, driven by the full Julian date (not just time-of-day).
 *
 * This is the piece that was previously missing: a solar day (24h, what
 * `utcDecimalHours` tracks) and a sidereal day (Earth's true rotation
 * period relative to the stars, ~23h56m4s) differ by ~3m56s. Computing the
 * spin angle from `(utcDecimalHours / 24)` resets to the *same* angle every
 * UTC midnight regardless of the date, silently discarding that drift.
 * Since satellite ECI/TEME positions from SGP4 live in the true inertial
 * frame, any days-long accumulated offset here shows up as the visible
 * globe (continents) rotating out of sync with real satellite longitudes —
 * a GEO satellite parked over a fixed real-world longitude will appear to
 * have drifted to a completely different part of the globe.
 */
export function getGmstRad(date: Date): number {
  const jd = toJulianDate(date);
  const daysSinceJ2000 = jd - 2_451_545.0;
  const centuriesSinceJ2000 = daysSinceJ2000 / 36525;

  let gmstDeg =
    280.46061837 +
    360.98564736629 * daysSinceJ2000 +
    0.000387933 * centuriesSinceJ2000 * centuriesSinceJ2000 -
    (centuriesSinceJ2000 * centuriesSinceJ2000 * centuriesSinceJ2000) / 38_710_000;

  gmstDeg = ((gmstDeg % 360) + 360) % 360;
  return gmstDeg * (Math.PI / 180);
}

/**
 * UTC-accurate day/night: Earth spins with simulated UTC; sun stays in inertial space
 * (seasonal declination only). Do not rotate sun with Earth — that cancels the terminator.
 */
export function getDayNightState(date: Date): DayNightState {
  const utcDecimalHours = getUtcDecimalHours(date);

  // earthRotationY = GMST (no extra offset).  Proof: at GMST θ, the Three.js
  // SphereGeometry UV formula puts texture-longitude λ at world direction
  // (cos θ · cos λ_local − sin θ · sin λ_local, …), which equals the scene
  // projection of the ECEF unit vector at longitude λ only when θ = GMST.
  const earthRotationY = getGmstRad(date);

  // Full ECI sun direction (right-ascension + declination), then mapped to
  // scene space: ECI X → scene X, ECI Z → scene Y, −ECI Y → scene Z.
  const sunEci = getSunEci(date);
  const sunScene = {
    x: sunEci.x,
    y: sunEci.z,   // ECI Z → scene Y
    z: -sunEci.y,  // −ECI Y → scene Z
  };
  const sunPosition = {
    x: sunScene.x * SUN_DISTANCE,
    y: sunScene.y * SUN_DISTANCE,
    z: sunScene.z * SUN_DISTANCE,
  };

  return {
    earthRotationY,
    sunPosition,
    sunDirection: sunScene,
    utcDecimalHours,
  };
}
