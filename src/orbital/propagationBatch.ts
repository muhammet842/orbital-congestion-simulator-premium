import { propagateObject, type PropagationResult } from './propagator';
import type { TrackedObject } from '../types';

/** Quantize sim time so high speed multipliers reuse SGP4 results across frames. */
export function quantizeSimulationTimeMs(simTimeMs: number, speed: number): number {
  if (speed <= 1) return simTimeMs;
  if (speed <= 10) return Math.floor(simTimeMs / 250) * 250;
  if (speed <= 100) return Math.floor(simTimeMs / 2_000) * 2_000;
  if (speed <= 500) return Math.floor(simTimeMs / 10_000) * 10_000;
  return Math.floor(simTimeMs / 30_000) * 30_000;
}

export function getDebrisUpdateStride(speed: number): number {
  if (speed >= 100) return 2;
  return 1;
}

let cachedTickMs = NaN;
let cachedResults: (PropagationResult | null)[] = [];

/**
 * Propagate all objects once per quantized sim-time tick (shared by debris + GLTF paths).
 * `minQuantumMs` coarsens the tick further — the main-thread fallback uses it
 * so a missing/failed Worker costs a few full-catalog passes per second
 * instead of one per frame.
 */
export function getPropagationResults(
  objects: TrackedObject[],
  simTime: Date,
  speed: number,
  minQuantumMs = 0,
): (PropagationResult | null)[] {
  let tickMs = quantizeSimulationTimeMs(simTime.getTime(), speed);
  if (minQuantumMs > 0) tickMs = Math.floor(tickMs / minQuantumMs) * minQuantumMs;
  if (tickMs === cachedTickMs && cachedResults.length === objects.length) {
    return cachedResults;
  }

  const tickDate = new Date(tickMs);
  const next = new Array<PropagationResult | null>(objects.length);
  for (let i = 0; i < objects.length; i++) {
    next[i] = propagateObject(objects[i].satrec, tickDate);
  }

  cachedTickMs = tickMs;
  cachedResults = next;
  return next;
}

export function invalidatePropagationBatch(): void {
  cachedTickMs = NaN;
  cachedResults = [];
}
