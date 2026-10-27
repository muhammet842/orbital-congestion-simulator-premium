/**
 * Finding the exact closest moment of a pair around a given time.
 */
import { propagateObject } from '../propagator';
import type { ConjunctionEvent, TrackedObject } from '../../types';
import { findObjectIndex } from './screening';
import { REFINE_STEP_MS, REFINE_WINDOW_MS } from './settings';
import { distanceKm, midpointScene, relativeVelocityKmS } from './vectors';

type Satrec = Parameters<typeof propagateObject>[0];

interface ScanResult {
  distance: number;
  time: Date;
  posA: NonNullable<ReturnType<typeof propagateObject>>;
  posB: NonNullable<ReturnType<typeof propagateObject>>;
}

function scanForMinimumDistance(
  satrecA: Satrec,
  satrecB: Satrec,
  centerMs: number,
  windowMs: number,
  stepMs: number,
): ScanResult | null {
  let best: ScanResult | null = null;

  for (let t = centerMs - windowMs; t <= centerMs + windowMs; t += stepMs) {
    const date = new Date(t);
    const propA = propagateObject(satrecA, date);
    const propB = propagateObject(satrecB, date);
    if (!propA || !propB) continue;

    const distance = distanceKm(propA.positionEci, propB.positionEci);
    if (!best || distance < best.distance) {
      best = { distance, time: date, posA: propA, posB: propB };
    }
  }

  return best;
}

export function refineCloseApproach(
  objects: TrackedObject[],
  indexA: number,
  indexB: number,
  centerTime: Date,
  windowMs: number = REFINE_WINDOW_MS,
  stepMs: number = REFINE_STEP_MS,
): ConjunctionEvent | null {
  const objA = objects[indexA];
  const objB = objects[indexB];
  if (!objA || !objB) return null;

  const coarse = scanForMinimumDistance(objA.satrec, objB.satrec, centerTime.getTime(), windowMs, stepMs);
  if (!coarse) return null;

  // Zoom in around the coarse minimum with a step ~10x finer — the coarse
  // pass alone can straddle the true minimum (especially for fast-closing
  // pairs, where a single coarse step can span many km), so this second
  // pass resolves sub-step precision cheaply (a handful of extra samples)
  // without needing a uniformly fine step across the whole window.
  const fineStepMs = Math.max(stepMs / 10, 50);
  const best =
    fineStepMs < stepMs
      ? scanForMinimumDistance(objA.satrec, objB.satrec, coarse.time.getTime(), stepMs, fineStepMs) ?? coarse
      : coarse;
  const winner = best.distance < coarse.distance ? best : coarse;

  const { distance: bestDistance, time: bestTime, posA: bestPosA, posB: bestPosB } = winner;

  return {
    objectA: objA.name,
    objectB: objB.name,
    noradIdA: objA.noradId,
    noradIdB: objB.noradId,
    indexA,
    indexB,
    distanceKm: bestDistance,
    relativeVelocityKmS: relativeVelocityKmS(bestPosA.velocityEci, bestPosB.velocityEci),
    time: bestTime,
    midpointScene: midpointScene(bestPosA.positionEci, bestPosB.positionEci),
  };
}

export function resolveConjunctionEvent(
  objects: TrackedObject[],
  objectA: string,
  objectB: string,
  referenceTime: Date,
): ConjunctionEvent | null {
  const indexA = findObjectIndex(objects, objectA);
  const indexB = findObjectIndex(objects, objectB);
  if (indexA < 0 || indexB < 0) return null;
  return refineCloseApproach(objects, indexA, indexB, referenceTime);
}
