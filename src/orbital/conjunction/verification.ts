/**
 * Verification (replay) clock, risk levels and the verdict shown for a close approach.
 */
import { propagateObject } from '../propagator';
import type { ConjunctionEvent, TrackedObject } from '../../types';
import { distanceKm, relativeVelocityKmS } from './vectors';

export const VERIFY_REWIND_MS = 60 * 1000;
/**
 * Opening separation the close-approach camera is framed for (~80 km snapshot).
 * Fast crossings (5–12 km/s) cover that gap in seconds; starting a full 60s
 * earlier puts them hundreds of km apart in an 80 km shot, so they streak
 * across the view even at 1x.
 */
export const VERIFY_OPENING_SEPARATION_KM = 80;
/** Never start closer than this, even for hypervelocity crossings. */
export const VERIFY_MIN_REWIND_MS = 8 * 1000;
/**
 * Orbit preview window around CPA. The trail always covers the full T−60s
 * span so a shorter high-speed playback still has path context behind the
 * markers.
 */
export const VERIFY_TRAIL_BACK_MS = VERIFY_REWIND_MS;
export const VERIFY_TRAIL_FORWARD_MS = 15 * 1000;
export const VERIFY_TRAIL_STEP_MS = 2_000;
/** Keyboard / transport nudge while scrubbing a verification session. */
export const VERIFY_SCRUB_STEP_MS = 5_000;

/**
 * How far before CPA to start 1x playback so the pair opens near the
 * camera's ~80 km frame. Slow/co-orbiting pairs keep the full T−60s window.
 */
export function getVerificationRewindMs(relativeVelocityKmS: number): number {
  const v = Number.isFinite(relativeVelocityKmS) ? relativeVelocityKmS : 0;
  if (v <= 0) return VERIFY_REWIND_MS;
  const leadMs = (VERIFY_OPENING_SEPARATION_KM / v) * 1000;
  return Math.min(VERIFY_REWIND_MS, Math.max(VERIFY_MIN_REWIND_MS, Math.round(leadMs)));
}

/** Inclusive playback window around CPA (slider + clock). */
export function getVerificationWindowMs(
  cpaTimeMs: number,
  relativeVelocityKmS = 0,
): { startMs: number; endMs: number } {
  return {
    startMs: cpaTimeMs - getVerificationRewindMs(relativeVelocityKmS),
    endMs: cpaTimeMs + VERIFY_TRAIL_FORWARD_MS,
  };
}

export function clampVerificationTimeMs(
  cpaTimeMs: number,
  currentMs: number,
  relativeVelocityKmS = 0,
): number {
  const { startMs, endMs } = getVerificationWindowMs(cpaTimeMs, relativeVelocityKmS);
  return Math.min(endMs, Math.max(startMs, currentMs));
}
export const COLLISION_THRESHOLD_KM = 0.1;
/** Crossing-orbit pairs below this relative speed are co-orbiting, not collision flybys. */
export const CROSSING_MIN_REL_VELOCITY_KM_S = 0.05;
export const RISK_NO_KM = 5;
export const RISK_LOW_KM = 3;
export const RISK_CRITICAL_KM = 1;

export type VerificationStatus =
  | 'PENDING'
  | 'APPROACHING'
  | 'COLLISION CONFIRMED'
  | 'COLLISION AVERTED';

export function conjunctionPairKey(objectA: string, objectB: string): string {
  return [objectA, objectB].sort().join('|');
}

/** Unique key per verification session — pair, CPA instant, and object indices. */
export function conjunctionSessionKey(event: ConjunctionEvent): string {
  return `${conjunctionPairKey(event.objectA, event.objectB)}|${event.time.getTime()}|${event.indexA}|${event.indexB}`;
}

export function formatCloseApproachAlert(objectA: string, objectB: string, distanceKm: number): string {
  return `${objectA} vs ${objectB} - ${distanceKm.toFixed(2)} km close approach!`;
}

export function getRiskAssessment(
  distanceKm: number,
): 'NO RISK' | 'LOW RISK' | 'MONITORING' | 'CRITICAL RISK' {
  if (distanceKm >= RISK_NO_KM) return 'NO RISK';
  if (distanceKm >= RISK_LOW_KM) return 'LOW RISK';
  if (distanceKm >= RISK_CRITICAL_KM) return 'MONITORING';
  return 'CRITICAL RISK';
}

export function formatRelativeVelocityKmS(kmS: number): string {
  if (kmS < 0.01) return `${(kmS * 1000).toFixed(1)} m/s`;
  if (kmS < 1) return `${kmS.toFixed(3)} km/s`;
  return `${kmS.toFixed(2)} km/s`;
}

export function isCoOrbitingPair(relativeVelocityKmS: number): boolean {
  return relativeVelocityKmS < CROSSING_MIN_REL_VELOCITY_KM_S;
}

export function getDistanceAtTime(
  objects: TrackedObject[],
  indexA: number,
  indexB: number,
  date: Date,
): number | null {
  const objA = objects[indexA];
  const objB = objects[indexB];
  if (!objA || !objB) return null;

  const propA = propagateObject(objA.satrec, date);
  const propB = propagateObject(objB.satrec, date);
  if (!propA || !propB) return null;

  return distanceKm(propA.positionEci, propB.positionEci);
}

export function getRelativeVelocityAtTime(
  objects: TrackedObject[],
  indexA: number,
  indexB: number,
  date: Date,
): number | null {
  const objA = objects[indexA];
  const objB = objects[indexB];
  if (!objA || !objB) return null;

  const propA = propagateObject(objA.satrec, date);
  const propB = propagateObject(objB.satrec, date);
  if (!propA || !propB) return null;

  return relativeVelocityKmS(propA.velocityEci, propB.velocityEci);
}

export function getVerificationAssessment(
  liveDistanceKm: number | null,
  simTimeMs: number,
  cpaTimeMs: number,
  cpaDistanceKm: number,
  playing: boolean,
): {
  status: VerificationStatus;
  riskLabel: string;
  hint: string;
} {
  const msToCpa = cpaTimeMs - simTimeMs;
  const atOrPastCpa = msToCpa <= 500;

  if (liveDistanceKm == null) {
    return {
      status: 'PENDING',
      riskLabel: 'UNAVAILABLE',
      hint: 'Propagation unavailable at current simulation time.',
    };
  }

  // Judge the pass by its closest approach, not by where the clock happens to
  // be: a few seconds after CPA two objects crossing at ~10 km/s are already
  // tens of kilometres apart, so the live distance would always say "missed".
  if (atOrPastCpa) {
    const confirmed = cpaDistanceKm < COLLISION_THRESHOLD_KM;
    return {
      status: confirmed ? 'COLLISION CONFIRMED' : 'COLLISION AVERTED',
      riskLabel: confirmed ? 'COLLISION CONFIRMED' : 'COLLISION AVERTED',
      hint: confirmed
        ? `Closest approach ${cpaDistanceKm.toFixed(3)} km — within collision threshold.`
        : `Closest approach ${cpaDistanceKm.toFixed(3)} km — collision avoided.`,
    };
  }

  if (playing || msToCpa < VERIFY_REWIND_MS) {
    const risk = getRiskAssessment(liveDistanceKm);
    return {
      status: 'APPROACHING',
      riskLabel: risk,
      hint: 'Simulation ongoing… Tracking live separation and relative velocity.',
    };
  }

  return {
    status: 'PENDING',
    riskLabel: getRiskAssessment(cpaDistanceKm),
    hint: 'Simulation paused. Press Play or LIVE to run verification.',
  };
}
