/**
 * The live scan: which pairs are close right now, refreshed in idle time and cached.
 */
import { propagateObject } from '../propagator';
import type { ConjunctionEvent, TrackedObject } from '../../types';
import { deduplicatePhysicalConjunctions } from './alerts';
import { refineCloseApproach } from './refine';
import { isScreenable, sharesOrbitData } from './screening';
import {
  CHECK_INTERVAL_MS,
  CHECK_WALL_INTERVAL_MS,
  type ConjunctionScanResult,
  DETECTION_RADIUS_KM,
  LIVE_REFINE_STEP_MS,
  LIVE_REFINE_WINDOW_MS,
  MAX_STORED_ALERTS,
  MIN_DISTANCE_KM,
  THRESHOLD_KM,
} from './settings';
import { findCandidatePairsWithinRadius } from './spatialGrid';
import { distanceKm } from './vectors';
import { isCoOrbitingPair } from './verification';

interface CachedConjunctions {
  simTimeMs: number;
  wallTimeMs: number;
  scan: ConjunctionScanResult;
}

let cache: CachedConjunctions | null = null;

export type ConjunctionRefreshListener = (result: ConjunctionScanResult) => void;

let pendingRefresh: {
  objects: TrackedObject[];
  simTimeMs: number;
  listener: ConjunctionRefreshListener;
} | null = null;
let refreshScheduled = false;
let refreshInFlight = false;

function runConjunctionRefresh(): void {
  if (refreshInFlight || !pendingRefresh) return;

  refreshInFlight = true;
  refreshScheduled = false;

  const { objects, simTimeMs, listener } = pendingRefresh;
  pendingRefresh = null;

  const scan = findConjunctions(objects, new Date(simTimeMs));
  cache = { simTimeMs, wallTimeMs: performance.now(), scan };
  refreshInFlight = false;
  listener(scan);

  if (pendingRefresh) {
    scheduleConjunctionRefresh();
  }
}

function scheduleConjunctionRefresh(): void {
  if (refreshScheduled || refreshInFlight) return;
  refreshScheduled = true;

  const idle = globalThis.requestIdleCallback;
  if (typeof idle === 'function') {
    idle(
      (deadline) => {
        refreshScheduled = false;
        // On a render-heavy page the main thread may never report a genuinely
        // idle slice, so `timeRemaining()` can sit near 0 indefinitely. Only
        // defer when the browser found real idle time but it was too short —
        // once the callback fires because the `timeout` budget was exhausted
        // (didTimeout), we must run now regardless of timeRemaining(), or the
        // scan starves forever and no conjunction is ever detected.
        if (!deadline.didTimeout && deadline.timeRemaining() < 6 && pendingRefresh) {
          scheduleConjunctionRefresh();
          return;
        }
        runConjunctionRefresh();
      },
      { timeout: 6_000 },
    );
    return;
  }

  globalThis.setTimeout(() => {
    refreshScheduled = false;
    runConjunctionRefresh();
  }, 0);
}

function queueConjunctionRefresh(
  objects: TrackedObject[],
  simTimeMs: number,
  listener: ConjunctionRefreshListener,
): void {
  pendingRefresh = { objects, simTimeMs, listener };
  scheduleConjunctionRefresh();
}

export function findConjunctions(objects: TrackedObject[], date: Date): ConjunctionScanResult {
  const leoEntries: { index: number; name: string; position: { x: number; y: number; z: number } }[] = [];

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!isScreenable(obj)) continue;
    const propagation = propagateObject(obj.satrec, date);
    if (!propagation) continue;
    leoEntries.push({ index: i, name: obj.name, position: propagation.positionEci });
  }

  // Cast a wider net than the final THRESHOLD_KM so fast-closing pairs are
  // caught as candidates before they've actually crossed the threshold —
  // see DETECTION_RADIUS_KM for why. The exact THRESHOLD_KM cutoff is
  // re-applied below against the fine-refined minimum distance.
  const candidatePairs = findCandidatePairsWithinRadius(
    leoEntries.map((e) => e.position),
    DETECTION_RADIUS_KM,
  );

  const pairs: ConjunctionEvent[] = [];

  for (const [ei, ej] of candidatePairs) {
    const objI = objects[leoEntries[ei].index];
    const objJ = objects[leoEntries[ej].index];
    if (sharesOrbitData(objI, objJ)) continue;

    const distance = distanceKm(leoEntries[ei].position, leoEntries[ej].position);
    if (distance <= DETECTION_RADIUS_KM) {
      const refined = refineCloseApproach(
        objects,
        leoEntries[ei].index,
        leoEntries[ej].index,
        date,
        LIVE_REFINE_WINDOW_MS,
        LIVE_REFINE_STEP_MS,
      );
      if (!refined) continue;
      if (refined.distanceKm < MIN_DISTANCE_KM || refined.distanceKm > THRESHOLD_KM) continue;
      if (isCoOrbitingPair(refined.relativeVelocityKmS)) continue;
      pairs.push(refined);
    }
  }

  pairs.sort((a, b) => a.time.getTime() - b.time.getTime() || a.distanceKm - b.distanceKm);
  const ranked = deduplicatePhysicalConjunctions(pairs, objects);
  return {
    alerts: ranked.slice(0, MAX_STORED_ALERTS),
    hiddenCount: Math.max(0, ranked.length - MAX_STORED_ALERTS),
  };
}

export function getConjunctions(
  objects: TrackedObject[],
  simTime: Date,
  _speed = 1,
  onRefresh?: ConjunctionRefreshListener,
): ConjunctionScanResult {
  const simTimeMs = simTime.getTime();
  const now = performance.now();
  const empty: ConjunctionScanResult = { alerts: [], hiddenCount: 0 };

  if (cache && simTimeMs < cache.simTimeMs) {
    cache = null;
  }

  if (cache && Math.abs(simTimeMs - cache.simTimeMs) < CHECK_INTERVAL_MS) {
    return cache.scan;
  }

  if (cache && now - cache.wallTimeMs < CHECK_WALL_INTERVAL_MS) {
    return cache.scan;
  }

  if (onRefresh) {
    queueConjunctionRefresh(objects, simTimeMs, onRefresh);
    return cache?.scan ?? empty;
  }

  const scan = findConjunctions(objects, simTime);
  cache = { simTimeMs, wallTimeMs: now, scan };
  return scan;
}

export function invalidateConjunctionCache(): void {
  cache = null;
  pendingRefresh = null;
}
