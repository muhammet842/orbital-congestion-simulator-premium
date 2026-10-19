/**
 * Close-approach (conjunction) detection for LEO traffic.
 *
 * Live scan: coarse spatial hash with DETECTION_RADIUS_KM, then fine refine
 * (LIVE_REFINE_*) so fast 5–12 km/s crossings are not skipped between ticks.
 * UI shows at most MAX_DISPLAY_ALERTS; more stay in state for filters.
 *
 * VERIFY mode: click an alert → dedicated verificationTime clock (T− adaptive
 * to relative speed → CPA → T+15s). Does not rewrite the global sim clock.
 * Co-orbiting stacks (ISS/CSS modules) are excluded from alerts, and so are
 * objects whose TLE is too old to screen (`staleElements`, set by tleLoader).
 *
 * invalidateUpcomingConjunctionScan() when catalog/time mode changes so a
 * stale idle callback cannot wipe cards mid-rescan.
 */
import { nameCollator } from '../data/nameOrder';
import { eciToScene } from './coordinates';
import { propagateObject, propagateState, type PropagationState } from './propagator';
import type { ConjunctionEvent, OrbitLayer, TrackedObject } from '../types';

export interface ConjunctionScanResult {
  alerts: ConjunctionEvent[];
  hiddenCount: number;
}

export const THRESHOLD_KM = 3;
export const MIN_DISTANCE_KM = 0.1;
export const CHECK_INTERVAL_MS = 1_500;
/** Minimum real-time gap between conjunction recomputes (all speed modes). */
export const CHECK_WALL_INTERVAL_MS = 1_500;
/**
 * Many crossing LEO pairs close at 5-12 km/s — at that speed a pair only
 * stays inside the final THRESHOLD_KM for roughly 0.5-2s. Point-sampling the
 * instantaneous distance every CHECK_WALL_INTERVAL_MS can step right over a
 * window that narrow. To catch these, the coarse spatial-hash pass casts a
 * wider net (DETECTION_RADIUS_KM) so fast-closing pairs are flagged as
 * candidates *before* they're actually within THRESHOLD_KM, then a fine-step
 * refine pass (see LIVE_REFINE_*) pinpoints the true minimum distance. The
 * final alert still requires the refined distance to be <= THRESHOLD_KM —
 * this only widens what gets a closer look, not what counts as a conjunction.
 */
export const DETECTION_RADIUS_KM = 20;
/** Max close-approach alerts shown in the left panel (soonest CPA first). */
export const MAX_DISPLAY_ALERTS = 5;
/** Max candidates kept in app state so UI filters still have a pool to draw from. */
export const MAX_STORED_ALERTS = 30;
export const SUBSET: OrbitLayer = 'LEO';
export const REFINE_WINDOW_MS = 2 * 60 * 60 * 1000;
export const REFINE_STEP_MS = 60 * 1000;
/** Tight, fine-grained refine window used by the live scan — precise enough
 *  to resolve sub-3-second close-approach windows, unlike the coarse
 *  ±2h/60s window used for one-off historical/verification lookups. Combined
 *  with the automatic zoom-in pass in refineCloseApproach, this resolves
 *  down to ~100ms precision at negligible extra cost per candidate. */
export const LIVE_REFINE_WINDOW_MS = 10 * 1000;
export const LIVE_REFINE_STEP_MS = 1_000;
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

  if (atOrPastCpa) {
    const confirmed = liveDistanceKm < COLLISION_THRESHOLD_KM;
    return {
      status: confirmed ? 'COLLISION CONFIRMED' : 'COLLISION AVERTED',
      riskLabel: confirmed ? 'COLLISION CONFIRMED' : 'COLLISION AVERTED',
      hint: confirmed
        ? `Closest approach ${liveDistanceKm.toFixed(3)} km — within collision threshold.`
        : `Closest approach ${liveDistanceKm.toFixed(3)} km — collision avoided.`,
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

interface CachedConjunctions {
  simTimeMs: number;
  wallTimeMs: number;
  scan: ConjunctionScanResult;
}

let cache: CachedConjunctions | null = null;

type ConjunctionRefreshListener = (result: ConjunctionScanResult) => void;

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

function distanceKm(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function relativeVelocityKmS(
  va: { x: number; y: number; z: number },
  vb: { x: number; y: number; z: number },
): number {
  const dx = va.x - vb.x;
  const dy = va.y - vb.y;
  const dz = va.z - vb.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function midpointScene(
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

/** LEO objects with elements fresh enough to trust for close approaches. */
export function isScreenable(obj: TrackedObject): boolean {
  return obj.layer === SUBSET && !obj.staleElements;
}

/** LEO objects left out of screening only because their TLE is too old. */
export function countStaleScreeningExclusions(objects: readonly TrackedObject[]): number {
  let count = 0;
  for (const obj of objects) if (obj.layer === SUBSET && obj.staleElements) count++;
  return count;
}

function findObjectIndex(objects: TrackedObject[], name: string): number {
  const exact = objects.findIndex((o) => o.name === name);
  if (exact >= 0) return exact;
  const upper = name.toUpperCase();
  return objects.findIndex((o) => o.name.toUpperCase() === upper);
}

/** Debris fields routinely contain many objects sharing the exact same
 *  display name — NORAD ID is the only identity that's actually unique. */
function findObjectIndexByNoradId(objects: TrackedObject[], noradId: number): number {
  return objects.findIndex((o) => o.noradId === noradId);
}

/** TLE identity — ISS modules often share identical ephemeris lines. */
export function orbitFingerprint(obj: TrackedObject): string {
  return `${obj.line1}|${obj.line2}`;
}

export function sharesOrbitData(a: TrackedObject, b: TrackedObject): boolean {
  return orbitFingerprint(a) === orbitFingerprint(b);
}

export function getColocatedObjectNames(objects: TrackedObject[], index: number): string[] {
  const ref = objects[index];
  if (!ref) return [];
  const fp = orbitFingerprint(ref);
  return objects
    .filter((o) => orbitFingerprint(o) === fp)
    .map((o) => o.name)
    .sort((a, b) => nameCollator.compare(a, b));
}

function quantizeEciKm(value: number): number {
  return Math.round(value * 10) / 10;
}

function positionFingerprint(x: number, y: number, z: number): string {
  return `${quantizeEciKm(x)},${quantizeEciKm(y)},${quantizeEciKm(z)}`;
}

/** Same real-world encounter even if catalog lists different co-located modules. */
export function physicalConjunctionKey(event: ConjunctionEvent, objects: TrackedObject[]): string {
  const propA = propagateObject(objects[event.indexA]?.satrec, event.time);
  const propB = propagateObject(objects[event.indexB]?.satrec, event.time);
  if (!propA || !propB) return conjunctionSessionKey(event);

  const fpA = positionFingerprint(
    propA.positionEci.x,
    propA.positionEci.y,
    propA.positionEci.z,
  );
  const fpB = positionFingerprint(
    propB.positionEci.x,
    propB.positionEci.y,
    propB.positionEci.z,
  );
  const [f1, f2] = [fpA, fpB].sort();
  const tSec = Math.floor(event.time.getTime() / 1000);
  return `${f1}|${f2}|${tSec}`;
}

function preferConjunctionEvent(
  a: ConjunctionEvent,
  b: ConjunctionEvent,
  objects: TrackedObject[],
): ConjunctionEvent {
  const objA = objects[a.indexA];
  const objB = objects[b.indexA];
  if (!objA || !objB) return a;

  if (objA.category === 'stations' && objB.category !== 'stations') return a;
  if (objB.category === 'stations' && objA.category !== 'stations') return b;
  if (objA.noradId !== objB.noradId) return objA.noradId < objB.noradId ? a : b;
  return nameCollator.compare(a.objectA, b.objectA) <= 0 ? a : b;
}

function deduplicatePhysicalConjunctions(
  events: ConjunctionEvent[],
  objects: TrackedObject[],
): ConjunctionEvent[] {
  const seen = new Map<string, ConjunctionEvent>();

  for (const event of events) {
    const key = physicalConjunctionKey(event, objects);
    const existing = seen.get(key);
    seen.set(key, existing ? preferConjunctionEvent(existing, event, objects) : event);
  }

  return rankConjunctionAlertsByTime(Array.from(seen.values()));
}

/**
 * Left-panel ordering helpers. The scan stores up to MAX_STORED_ALERTS in the
 * next 24h; the UI then picks the top MAX_DISPLAY_ALERTS by either soonest CPA
 * or tightest miss distance.
 */
export function rankConjunctionAlertsByTime(events: ConjunctionEvent[]): ConjunctionEvent[] {
  return [...events].sort((a, b) => {
    const dt = a.time.getTime() - b.time.getTime();
    if (dt !== 0) return dt;
    return a.distanceKm - b.distanceKm;
  });
}

export function rankConjunctionAlertsByCriticality(events: ConjunctionEvent[]): ConjunctionEvent[] {
  return [...events].sort((a, b) => {
    const dd = a.distanceKm - b.distanceKm;
    if (dd !== 0) return dd;
    return a.time.getTime() - b.time.getTime();
  });
}

/** @deprecated Prefer rankConjunctionAlertsByTime — kept for call sites during rename. */
export function rankConjunctionAlertsForDisplay(events: ConjunctionEvent[]): ConjunctionEvent[] {
  return rankConjunctionAlertsByTime(events);
}

/** How the left-panel close-approach list is ordered within the next 24h. */
export type ConjunctionSortMode = 'time' | 'criticality';

export interface SelectConjunctionAlertsOptions {
  nowMs: number;
  sortMode: ConjunctionSortMode;
  /** Cap after ranking (left panel shows at most this many). */
  limit?: number;
  /** Horizon from now; defaults to 24h (full predictive scan window). */
  horizonHours?: number;
}

/**
 * Keep events in the next horizon (default 24h), rank by sort mode, return top N.
 */
export function selectConjunctionAlertsForDisplay(
  events: ConjunctionEvent[],
  options: SelectConjunctionAlertsOptions,
): ConjunctionEvent[] {
  const limit = options.limit ?? MAX_DISPLAY_ALERTS;
  const ranked =
    options.sortMode === 'criticality'
      ? rankConjunctionAlertsByCriticality(filterConjunctionAlertsInHorizon(events, options))
      : rankConjunctionAlertsByTime(filterConjunctionAlertsInHorizon(events, options));

  return ranked.slice(0, limit);
}

/** Events whose CPA falls in [now − 1s, now + horizon] (default 24h). */
export function filterConjunctionAlertsInHorizon(
  events: ConjunctionEvent[],
  options: Pick<SelectConjunctionAlertsOptions, 'nowMs' | 'horizonHours'>,
): ConjunctionEvent[] {
  const horizonHours = options.horizonHours ?? 24;
  const endMs = options.nowMs + horizonHours * 3_600_000;
  return events.filter((event) => {
    const t = event.time.getTime();
    return t >= options.nowMs - 1_000 && t <= endMs;
  });
}

/**
 * "+N more" footer: remaining approaches in the next 24h beyond the cards shown,
 * plus any the scan found but did not keep in the stored pool. Independent of
 * sort mode — both radios must show the same N.
 */
export function countConjunctionOverflow(
  events: ConjunctionEvent[],
  options: {
    nowMs: number;
    displayedCount: number;
    hiddenCount: number;
    horizonHours?: number;
  },
): number {
  const inWindow = filterConjunctionAlertsInHorizon(events, options).length;
  return Math.max(0, inWindow - options.displayedCount) + Math.max(0, options.hiddenCount);
}

/** Freeze alert CPA metadata — always resolve indices by NORAD ID, never
 *  by name (debris fields have many same-named fragments) and never reuse
 *  stale indices. */
export function normalizeConjunctionAlert(
  alert: ConjunctionEvent,
  objects: TrackedObject[],
): ConjunctionEvent | null {
  const indexA = findObjectIndexByNoradId(objects, alert.noradIdA);
  const indexB = findObjectIndexByNoradId(objects, alert.noradIdB);

  if (indexA < 0 || indexB < 0 || indexA === indexB) return null;

  const time = new Date(alert.time.getTime());
  const propA = propagateObject(objects[indexA].satrec, time);
  const propB = propagateObject(objects[indexB].satrec, time);
  if (!propA || !propB) return null;

  return {
    objectA: alert.objectA,
    objectB: alert.objectB,
    noradIdA: alert.noradIdA,
    noradIdB: alert.noradIdB,
    indexA,
    indexB,
    distanceKm: alert.distanceKm,
    relativeVelocityKmS: relativeVelocityKmS(propA.velocityEci, propB.velocityEci),
    time,
    midpointScene: midpointScene(propA.positionEci, propB.positionEci),
  };
}

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

type CellGrid = Map<number, Map<number, Map<number, number[]>>>;

function getBucket(grid: CellGrid, ix: number, iy: number, iz: number): number[] | undefined {
  return grid.get(ix)?.get(iy)?.get(iz);
}

function getOrCreateBucket(grid: CellGrid, ix: number, iy: number, iz: number): number[] {
  let yz = grid.get(ix);
  if (!yz) {
    yz = new Map();
    grid.set(ix, yz);
  }
  let z = yz.get(iy);
  if (!z) {
    z = new Map();
    yz.set(iy, z);
  }
  let bucket = z.get(iz);
  if (!bucket) {
    bucket = [];
    z.set(iz, bucket);
  }
  return bucket;
}

/**
 * Finds every index pair whose Euclidean distance is <= radius, without the
 * O(n^2) all-pairs scan. LEO shells routinely hold several thousand tracked
 * objects; comparing every object against every other object (tens of
 * millions of iterations per refresh) is the actual bottleneck, since almost
 * all of those pairs are obviously kilometers apart.
 *
 * Uses a uniform spatial hash grid with cell size == radius: any two points
 * within `radius` of each other can only ever land in the same cell or one
 * of its 26 neighbors, so a 3x3x3 neighborhood search is guaranteed to find
 * every true match. Cell membership alone is only a superset (diagonal
 * neighbors can be farther apart than `radius`), so each candidate is still
 * verified with an exact distance check before being returned — the result
 * is exact, verified against a brute-force O(n^2) scan in conjunction.test.ts.
 *
 * Grid cells are nested Maps keyed by integer cell index (not a stringified
 * "x,y,z" key): numeric map keys avoid per-lookup string allocation/hashing,
 * which matters here since this runs once per tracked object per refresh —
 * benchmarked ~18x faster than brute force at ~9,000 LEO objects.
 */
export function findCandidatePairsWithinRadius(
  positions: ReadonlyArray<{ x: number; y: number; z: number }>,
  radiusKm: number,
): Array<[number, number]> {
  const cellSize = Math.max(radiusKm, 1e-6);
  const radiusSq = radiusKm * radiusKm;
  const cellIndexOf = (value: number): number => Math.floor(value / cellSize);

  const grid: CellGrid = new Map();
  const cells: Array<[number, number, number]> = new Array(positions.length);

  for (let i = 0; i < positions.length; i++) {
    const { x, y, z } = positions[i];
    const ix = cellIndexOf(x);
    const iy = cellIndexOf(y);
    const iz = cellIndexOf(z);
    cells[i] = [ix, iy, iz];
    getOrCreateBucket(grid, ix, iy, iz).push(i);
  }

  const candidates: Array<[number, number]> = [];

  for (let i = 0; i < positions.length; i++) {
    const [ix, iy, iz] = cells[i];
    const pi = positions[i];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = getBucket(grid, ix + dx, iy + dy, iz + dz);
          if (!bucket) continue;

          for (const j of bucket) {
            if (j <= i) continue;
            const pj = positions[j];
            const ddx = pi.x - pj.x;
            const ddy = pi.y - pj.y;
            const ddz = pi.z - pj.z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= radiusSq) {
              candidates.push([i, j]);
            }
          }
        }
      }
    }
  }

  return candidates;
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


// ── Predictive 24h scan ─────────────────────────────────────────────────────
/**
 * Unlike everything above (which only ever evaluates the *current* instant,
 * plus a ±10s refine window around it), this walks forward in time and asks
 * "what will actually pass close over the next N hours?".
 *
 * Approach — a linear-motion sieve that cannot skip fast crossings:
 *
 *  1. Sample every LEO object's position *and velocity* every
 *     `UPCOMING_SAMPLE_STEP_MS` (60 s).
 *  2. At each sample, find every pair within `upcomingDetectionRadiusKm`.
 *     The radius is chosen so that any pair whose true CPA falls inside this
 *     sample's ±30 s window is guaranteed to be inside it, even head-on at
 *     `UPCOMING_MAX_REL_VELOCITY_KM_S`.
 *  3. For each pair, solve the closest approach of the *linear* relative
 *     motion (r + v·τ). Over ±30 s, two nearby objects feel almost the same
 *     gravity, so this is accurate to well under a kilometre. Keep the pair
 *     only when that CPA lands inside this sample's window and its miss
 *     distance is under `UPCOMING_SCREEN_KM`.
 *  4. Refine each survivor with SGP4 by iterating the same linear CPA solve
 *     (Newton-style) until the CPA time converges to the millisecond.
 *
 * The old 10-minute snapshot + fixed-step refine missed ~97% of real
 * sub-3 km crossings on the live catalog (a 10–15 km/s crossing spends only
 * a few seconds inside any reasonable net). Each window of this sieve hands
 * off to the next with no gaps, so coverage does not depend on luck.
 */
export const UPCOMING_HORIZON_MS = 24 * 60 * 60 * 1000;
export const UPCOMING_SAMPLE_STEP_MS = 60 * 1000;
/** Upper bound on LEO relative speed (head-on circular orbits ≈ 15.6 km/s). */
export const UPCOMING_MAX_REL_VELOCITY_KM_S = 16;
/** Linear-CPA screen. The margin over THRESHOLD_KM absorbs the linear-motion
 *  approximation error (well under 1 km at 60 s sampling). */
export const UPCOMING_SCREEN_KM = THRESHOLD_KM + 5;
/** A sweep is a lot of SGP4 work, so re-run it at most this often (wall time). */
export const UPCOMING_RESCAN_INTERVAL_MS = 5 * 60 * 1000;
/** …unless simulated time has drifted this far from the last sweep start
 *  (fast-forward, rewind, historical jumps). */
export const UPCOMING_MAX_SIM_DRIFT_MS = 60 * 60 * 1000;

const CPA_MAX_ITERATIONS = 12;
const CPA_CONVERGED_MS = 1;
/** Clamp a single Newton step so a bad starting guess cannot jump orbits. */
const CPA_MAX_STEP_SEC = 120;

/** Net radius that guarantees every CPA inside a sample's ±step/2 window is
 *  caught at that sample (see the scan overview above). */
export function upcomingDetectionRadiusKm(sampleStepMs: number = UPCOMING_SAMPLE_STEP_MS): number {
  return UPCOMING_MAX_REL_VELOCITY_KM_S * (sampleStepMs / 2000) + UPCOMING_SCREEN_KM + 10;
}

type Vec3 = { x: number; y: number; z: number };

/** Closest approach of linear relative motion r(τ) = r + v·τ (km, km/s, s). */
export function linearClosestApproach(r: Vec3, v: Vec3): { tauSec: number; missKm: number } {
  const vv = v.x * v.x + v.y * v.y + v.z * v.z;
  const tauSec = vv > 1e-12 ? -(r.x * v.x + r.y * v.y + r.z * v.z) / vv : 0;
  const mx = r.x + v.x * tauSec;
  const my = r.y + v.y * tauSec;
  const mz = r.z + v.z * tauSec;
  return { tauSec, missKm: Math.sqrt(mx * mx + my * my + mz * mz) };
}

interface CpaSolution {
  timeMs: number;
  distanceKm: number;
  posA: PropagationState;
  posB: PropagationState;
}

/**
 * Converge on the true SGP4 closest approach near `guessMs` by repeatedly
 * solving the linear CPA from the current relative state. Typically 2–4
 * iterations; returns the closest evaluated state.
 */
export function solveClosestApproach(
  satrecA: TrackedObject['satrec'],
  satrecB: TrackedObject['satrec'],
  guessMs: number,
): CpaSolution | null {
  let t = guessMs;
  let best: CpaSolution | null = null;

  for (let i = 0; i < CPA_MAX_ITERATIONS; i++) {
    const date = new Date(t);
    const a = propagateState(satrecA, date);
    const b = propagateState(satrecB, date);
    if (!a || !b) return best;

    const r = {
      x: b.positionEci.x - a.positionEci.x,
      y: b.positionEci.y - a.positionEci.y,
      z: b.positionEci.z - a.positionEci.z,
    };
    const distance = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
    if (!best || distance < best.distanceKm) {
      best = { timeMs: t, distanceKm: distance, posA: a, posB: b };
    }

    const v = {
      x: b.velocityEci.x - a.velocityEci.x,
      y: b.velocityEci.y - a.velocityEci.y,
      z: b.velocityEci.z - a.velocityEci.z,
    };
    const { tauSec } = linearClosestApproach(r, v);
    const stepSec = Math.max(-CPA_MAX_STEP_SEC, Math.min(CPA_MAX_STEP_SEC, tauSec));
    if (Math.abs(stepSec * 1000) < CPA_CONVERGED_MS) break;
    t += stepSec * 1000;
  }

  return best;
}

/** Packs integer cell coordinates into one numeric Map key. The key is linear
 *  in (ix, iy, iz), so neighbour deltas stay exact; coordinates beyond ±512
 *  only merge buckets (extra distance checks), never drop pairs. */
function sweepCellKey(ix: number, iy: number, iz: number): number {
  return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
}

/** Own cell (delta 0) plus the 13 lexicographically "forward" neighbours, as
 *  key deltas. Together they cover every neighbouring cell pair exactly once. */
const SWEEP_FORWARD_OFFSETS: number[] = (() => {
  const offsets = [0];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx > 0 || (dx === 0 && (dy > 0 || (dy === 0 && dz > 0)))) {
          offsets.push((dx * 1024 + dy) * 1024 + dz);
        }
      }
    }
  }
  return offsets;
})();

/**
 * The stored pool feeds both left-panel sort modes, so keep the soonest
 * *and* the tightest approaches — a "soonest only" pool would make the
 * criticality sort re-order 30 arbitrary near-term events.
 */
function buildStoredAlertPool(ranked: ConjunctionEvent[]): ConjunctionScanResult {
  if (ranked.length <= MAX_STORED_ALERTS) return { alerts: ranked, hiddenCount: 0 };
  const keep = new Set<ConjunctionEvent>(ranked.slice(0, MAX_STORED_ALERTS));
  for (const event of rankConjunctionAlertsByCriticality(ranked).slice(0, MAX_STORED_ALERTS)) {
    keep.add(event);
  }
  const alerts = rankConjunctionAlertsByTime(Array.from(keep));
  return { alerts, hiddenCount: ranked.length - alerts.length };
}

/**
 * Cap on how much work happens per `step()` call: objects propagated,
 * spatial-hash cells bucketed/queried, or candidates refined. Keeps every
 * slice under a frame budget when the sweep runs on the main thread (the
 * fallback path); the worker just calls `step()` in a tight loop.
 */
const UPCOMING_PROPAGATE_CHUNK = 1000;
const UPCOMING_GRID_CHUNK = 1500;
const UPCOMING_QUERY_CHUNK = 500;
const UPCOMING_REFINE_CHUNK = 25;

export type UpcomingSweepStepResult = 'working' | 'sample-done' | 'done';

/** One resumable 24h sweep. `step()` advances it by one bounded unit of work. */
export class UpcomingConjunctionSweep {
  readonly startMs: number;
  readonly horizonMs: number;
  readonly sampleStepMs: number;
  private readonly objects: TrackedObject[];
  private readonly leoIndices: number[];
  private readonly totalSamples: number;
  private readonly radiusKm: number;
  private readonly bestByPair = new Map<string, ConjunctionEvent>();
  private sampleIndex = 0;
  private finished = false;

  // Per-sample progress (reset by `resetSample`). Positions/velocities live
  // in a flat typed array (x,y,z,vx,vy,vz per entry) because the neighbour
  // query is the hot loop of the whole sweep and must not allocate per pair.
  private objectCursor = 0;
  private entryCount = 0;
  private readonly entryIndex: Int32Array;
  private readonly entryState: Float64Array;
  private readonly entryCell: Float64Array;
  private grid: Map<number, number[]> | null = null;
  private gridCursor = 0;
  private queryCursor = 0;
  private candidates: Array<{ ei: number; ej: number; guessMs: number }> | null = null;
  private refineCursor = 0;

  constructor(
    objects: TrackedObject[],
    startMs: number,
    horizonMs: number = UPCOMING_HORIZON_MS,
    sampleStepMs: number = UPCOMING_SAMPLE_STEP_MS,
  ) {
    this.objects = objects;
    this.startMs = startMs;
    this.horizonMs = horizonMs;
    this.sampleStepMs = sampleStepMs;
    this.totalSamples = Math.floor(horizonMs / sampleStepMs);
    this.radiusKm = upcomingDetectionRadiusKm(sampleStepMs);
    this.leoIndices = [];
    for (let i = 0; i < objects.length; i++) {
      if (isScreenable(objects[i])) this.leoIndices.push(i);
    }
    const n = this.leoIndices.length;
    this.entryIndex = new Int32Array(n);
    this.entryState = new Float64Array(n * 6);
    this.entryCell = new Float64Array(n);
  }

  get done(): boolean {
    return this.finished;
  }

  get hitCount(): number {
    return this.bestByPair.size;
  }

  snapshot(): ConjunctionScanResult {
    const ranked = deduplicatePhysicalConjunctions(Array.from(this.bestByPair.values()), this.objects)
      // Drop CPAs already behind the sweep clock so the panel stays "what's next".
      .filter((event) => event.time.getTime() >= this.startMs - 1_000);
    return buildStoredAlertPool(ranked);
  }

  step(): UpcomingSweepStepResult {
    if (this.finished) return 'done';
    const sampleMs = this.startMs + this.sampleIndex * this.sampleStepMs;
    const state = this.entryState;

    // Phase 1: propagate a bounded chunk of this sample's LEO objects.
    if (this.objectCursor < this.leoIndices.length) {
      const date = new Date(sampleMs);
      const end = Math.min(this.objectCursor + UPCOMING_PROPAGATE_CHUNK, this.leoIndices.length);
      for (let k = this.objectCursor; k < end; k++) {
        const idx = this.leoIndices[k];
        const p = propagateState(this.objects[idx].satrec, date);
        if (!p) continue;
        const e = this.entryCount++;
        const o = e * 6;
        this.entryIndex[e] = idx;
        state[o] = p.positionEci.x;
        state[o + 1] = p.positionEci.y;
        state[o + 2] = p.positionEci.z;
        state[o + 3] = p.velocityEci.x;
        state[o + 4] = p.velocityEci.y;
        state[o + 5] = p.velocityEci.z;
      }
      this.objectCursor = end;
      return 'working';
    }

    const n = this.entryCount;
    if (this.grid === null) this.grid = new Map();

    // Phase 2a: bucket a bounded chunk of positions into the spatial hash.
    if (this.gridCursor < n) {
      const end = Math.min(this.gridCursor + UPCOMING_GRID_CHUNK, n);
      for (let i = this.gridCursor; i < end; i++) {
        const o = i * 6;
        const key = sweepCellKey(
          Math.floor(state[o] / this.radiusKm),
          Math.floor(state[o + 1] / this.radiusKm),
          Math.floor(state[o + 2] / this.radiusKm),
        );
        this.entryCell[i] = key;
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(i);
        else this.grid.set(key, [i]);
      }
      this.gridCursor = end;
      return 'working';
    }

    if (this.candidates === null) this.candidates = [];

    // Phase 2b: neighbour query + linear-CPA screen. Each unordered pair is
    // visited once: same-cell pairs with j > i, plus the 13 "forward"
    // neighbour cells.
    if (this.queryCursor < n) {
      const radiusSq = this.radiusKm * this.radiusKm;
      const halfWindowSec = this.sampleStepMs / 2000;
      const screenSq = UPCOMING_SCREEN_KM * UPCOMING_SCREEN_KM;
      const coOrbitSq = CROSSING_MIN_REL_VELOCITY_KM_S * CROSSING_MIN_REL_VELOCITY_KM_S;
      const end = Math.min(this.queryCursor + UPCOMING_QUERY_CHUNK, n);
      for (let i = this.queryCursor; i < end; i++) {
        const cell = this.entryCell[i];
        const oi = i * 6;
        const px = state[oi];
        const py = state[oi + 1];
        const pz = state[oi + 2];
        const vx = state[oi + 3];
        const vy = state[oi + 4];
        const vz = state[oi + 5];
        for (let c = 0; c < SWEEP_FORWARD_OFFSETS.length; c++) {
          const offset = SWEEP_FORWARD_OFFSETS[c];
          const bucket = this.grid.get(cell + offset);
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b++) {
            const j = bucket[b];
            if (offset === 0 && j <= i) continue;
            const oj = j * 6;
            const rx = state[oj] - px;
            const ry = state[oj + 1] - py;
            const rz = state[oj + 2] - pz;
            if (rx * rx + ry * ry + rz * rz > radiusSq) continue;
            const wx = state[oj + 3] - vx;
            const wy = state[oj + 4] - vy;
            const wz = state[oj + 5] - vz;
            const ww = wx * wx + wy * wy + wz * wz;
            if (ww < coOrbitSq) continue;
            const tauSec = -(rx * wx + ry * wy + rz * wz) / ww;
            // CPAs outside the half-window belong to a neighbouring sample.
            if (tauSec < -halfWindowSec || tauSec > halfWindowSec) continue;
            const mx = rx + wx * tauSec;
            const my = ry + wy * tauSec;
            const mz = rz + wz * tauSec;
            if (mx * mx + my * my + mz * mz > screenSq) continue;
            if (sharesOrbitData(this.objects[this.entryIndex[i]], this.objects[this.entryIndex[j]])) continue;
            this.candidates.push({ ei: i, ej: j, guessMs: sampleMs + tauSec * 1000 });
          }
        }
      }
      this.queryCursor = end;
      return 'working';
    }

    // Phase 3: refine a bounded chunk of this sample's candidates with SGP4.
    if (this.refineCursor < this.candidates.length) {
      const end = Math.min(this.refineCursor + UPCOMING_REFINE_CHUNK, this.candidates.length);
      for (let k = this.refineCursor; k < end; k++) {
        const { ei, ej, guessMs } = this.candidates[k];
        this.recordCandidate(this.entryIndex[ei], this.entryIndex[ej], guessMs);
      }
      this.refineCursor = end;
      return 'working';
    }

    this.sampleIndex++;
    this.resetSample();
    if (this.sampleIndex > this.totalSamples) {
      this.finished = true;
      return 'done';
    }
    return 'sample-done';
  }

  private recordCandidate(indexA: number, indexB: number, guessMs: number): void {
    const objA = this.objects[indexA];
    const objB = this.objects[indexB];
    const cpa = solveClosestApproach(objA.satrec, objB.satrec, guessMs);
    if (!cpa) return;
    if (cpa.timeMs < this.startMs || cpa.timeMs > this.startMs + this.horizonMs) return;
    if (cpa.distanceKm > THRESHOLD_KM) return;
    const relV = relativeVelocityKmS(cpa.posA.velocityEci, cpa.posB.velocityEci);
    if (isCoOrbitingPair(relV)) return;

    const event: ConjunctionEvent = {
      objectA: objA.name,
      objectB: objB.name,
      noradIdA: objA.noradId,
      noradIdB: objB.noradId,
      indexA,
      indexB,
      distanceKm: cpa.distanceKm,
      relativeVelocityKmS: relV,
      time: new Date(cpa.timeMs),
      midpointScene: midpointScene(cpa.posA.positionEci, cpa.posB.positionEci),
    };
    const pairKey = conjunctionPairKey(String(objA.noradId), String(objB.noradId));
    const existing = this.bestByPair.get(pairKey);
    if (!existing || event.distanceKm < existing.distanceKm) {
      this.bestByPair.set(pairKey, event);
    }
  }

  private resetSample(): void {
    this.objectCursor = 0;
    this.entryCount = 0;
    this.grid = null;
    this.gridCursor = 0;
    this.queryCursor = 0;
    this.candidates = null;
    this.refineCursor = 0;
  }
}

/**
 * Synchronous, one-shot version of the predictive scan. Fine for tests and
 * small catalogs; production uses `getUpcomingConjunctions`, which runs the
 * same sweep in a Web Worker (or in idle-time slices as a fallback).
 */
export function findUpcomingConjunctions(
  objects: TrackedObject[],
  startDate: Date,
  horizonMs: number = UPCOMING_HORIZON_MS,
  sampleStepMs: number = UPCOMING_SAMPLE_STEP_MS,
): ConjunctionScanResult {
  const sweep = new UpcomingConjunctionSweep(objects, startDate.getTime(), horizonMs, sampleStepMs);
  while (sweep.step() !== 'done') {
    // run to completion
  }
  return sweep.snapshot();
}

// ── Sweep orchestration (worker first, idle-slice fallback) ────────────────

/** Minimal per-object payload the conjunction worker needs (index-aligned
 *  with the main-thread catalog so event indices stay valid). */
export interface UpcomingWorkerObject {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
  category: TrackedObject['category'];
  layer: OrbitLayer;
  staleElements?: boolean;
}

export type UpcomingWorkerRequest =
  | {
      type: 'scan';
      scanId: number;
      startMs: number;
      horizonMs: number;
      sampleStepMs: number;
      /** Present only when the catalog changed since the last scan. */
      objects?: UpcomingWorkerObject[];
    }
  | { type: 'cancel'; scanId: number }
  /** Page hidden / visible again: stop and resume the sweep (battery). */
  | { type: 'pause' }
  | { type: 'resume' };

export type UpcomingWorkerResponse =
  | { type: 'progress'; scanId: number; result: ConjunctionScanResult }
  | { type: 'done'; scanId: number; result: ConjunctionScanResult }
  | { type: 'error'; scanId: number; message: string };

type UpcomingWorkerFactory = () => Worker;

let workerFactory: UpcomingWorkerFactory | null = null;
let worker: Worker | null = null;
let workerBroken = false;
let workerCatalog: TrackedObject[] | null = null;
let workerScanId: number | null = null;

let scanGeneration = 0;
let activeSweep: UpcomingConjunctionSweep | null = null;
let activeListener: ConjunctionRefreshListener | null = null;
let upcomingResult: ConjunctionScanResult = { alerts: [], hiddenCount: 0 };
let upcomingScanStartedWallMs = -Infinity;
let upcomingScanStartSimMs = NaN;
/** True once at least one sweep has finished since the last hard reset.
 *  Distinguishes "still scanning on first load" from "scan finished, none found". */
let upcomingScanCompletedOnce = false;

/**
 * Register how to create the conjunction worker. Kept out of this module so
 * the worker (which imports this file) does not try to spawn itself.
 */
export function setUpcomingConjunctionWorkerFactory(factory: UpcomingWorkerFactory | null): void {
  workerFactory = factory;
  workerBroken = false;
  if (worker) {
    worker.terminate();
    worker = null;
    workerCatalog = null;
  }
}

/** True while a 24h predictive sweep is mid-flight. */
export function isUpcomingConjunctionScanPending(): boolean {
  return activeSweep != null || workerScanId != null;
}

/** False until the first sweep after load/invalidate has produced a final result. */
export function hasUpcomingConjunctionScanCompleted(): boolean {
  return upcomingScanCompletedOnce;
}

function publishFinal(result: ConjunctionScanResult, listener: ConjunctionRefreshListener | null): void {
  upcomingResult = result;
  upcomingScanCompletedOnce = true;
  listener?.(result);
}

function markWorkerBroken(reason: unknown): void {
  console.error('[ConjunctionWorker] falling back to main-thread scan:', reason);
  workerBroken = true;
  worker?.terminate();
  worker = null;
  workerCatalog = null;
  if (workerScanId != null) {
    workerScanId = null;
    // Let the next getUpcomingConjunctions call restart on the fallback path.
    upcomingScanStartedWallMs = -Infinity;
  }
}

let visibilityHooked = false;

/**
 * Workers keep running when the page is hidden (a locked phone, another tab),
 * unlike the drawing loop. The 24-hour sweep can take minutes on a phone, so
 * pause it while nobody can see the results and resume where it left off.
 */
function pauseScanWhileHidden(): void {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  const sync = (): void => {
    worker?.postMessage({ type: document.hidden ? 'pause' : 'resume' } satisfies UpcomingWorkerRequest);
  };
  document.addEventListener('visibilitychange', sync);
  if (document.hidden) sync();
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (!workerFactory || workerBroken) return null;
  try {
    const created = workerFactory();
    created.onmessage = (e: MessageEvent<UpcomingWorkerResponse>) => {
      const msg = e.data;
      if (msg.scanId !== workerScanId) return; // stale (cancelled / superseded)
      if (msg.type === 'progress') {
        activeListener?.(msg.result);
      } else if (msg.type === 'done') {
        workerScanId = null;
        publishFinal(msg.result, activeListener);
      } else {
        markWorkerBroken(msg.message);
      }
    };
    created.onerror = (err) => markWorkerBroken(err.message || err);
    created.onmessageerror = (err) => markWorkerBroken(err);
    worker = created;
    pauseScanWhileHidden();
    return worker;
  } catch (err) {
    markWorkerBroken(err);
    return null;
  }
}

function startWorkerSweep(w: Worker, objects: TrackedObject[], startMs: number): void {
  const request: UpcomingWorkerRequest = {
    type: 'scan',
    scanId: scanGeneration,
    startMs,
    horizonMs: UPCOMING_HORIZON_MS,
    sampleStepMs: UPCOMING_SAMPLE_STEP_MS,
  };
  if (workerCatalog !== objects) {
    request.objects = objects.map((o) => ({
      noradId: o.noradId,
      name: o.name,
      line1: o.line1,
      line2: o.line2,
      category: o.category,
      layer: o.layer,
      staleElements: o.staleElements,
    }));
    workerCatalog = objects;
  }
  workerScanId = scanGeneration;
  w.postMessage(request);
}

/** Minimum wall-time spacing between streamed partial results (fallback path). */
const UPCOMING_PARTIAL_INTERVAL_MS = 2_000;

function scheduleUpcomingScanStep(sweep: UpcomingConjunctionSweep, lastPartial = { wallMs: -Infinity, hits: 0 }): void {
  const runStep = (): void => {
    // A newer sweep (or invalidate) replaced this one while the callback was
    // queued — never publish or reschedule for a superseded sweep.
    if (sweep !== activeSweep) return;

    const state = sweep.step();
    if (state === 'done') {
      activeSweep = null;
      publishFinal(sweep.snapshot(), activeListener);
      return;
    }
    // Stream partial hits as samples finish so the panel isn't blank for the
    // whole first sweep (throttled: a snapshot re-propagates every hit).
    if (
      state === 'sample-done' &&
      sweep.hitCount > lastPartial.hits &&
      performance.now() - lastPartial.wallMs >= UPCOMING_PARTIAL_INTERVAL_MS
    ) {
      lastPartial = { wallMs: performance.now(), hits: sweep.hitCount };
      activeListener?.(sweep.snapshot());
    }
    scheduleUpcomingScanStep(sweep, lastPartial);
  };

  const idle = globalThis.requestIdleCallback;
  if (typeof idle === 'function') {
    idle(runStep, { timeout: 1_000 });
  } else {
    globalThis.setTimeout(runStep, 0);
  }
}

/**
 * Forward-looking close-approach screen — the closest predicted approaches
 * over the next `UPCOMING_HORIZON_MS`, sorted by soonest CPA.
 *
 * Call it every frame: it is a cheap no-op between sweeps. A new sweep starts
 * when the rescan interval has elapsed or simulated time has drifted/jumped
 * away from the last sweep. Partial and final results arrive via `onUpdate`.
 */
export function getUpcomingConjunctions(
  objects: TrackedObject[],
  referenceTime: Date,
  onUpdate: ConjunctionRefreshListener,
): ConjunctionScanResult {
  activeListener = onUpdate;
  const nowWallMs = performance.now();
  const simMs = referenceTime.getTime();
  const pending = isUpcomingConjunctionScanPending();

  let start: boolean;
  if (pending) {
    // Restart an in-flight sweep only when its window no longer covers "now"
    // (rewind, or a jump beyond the horizon).
    start =
      simMs < upcomingScanStartSimMs - UPCOMING_SAMPLE_STEP_MS ||
      simMs > upcomingScanStartSimMs + UPCOMING_HORIZON_MS;
  } else {
    start =
      nowWallMs - upcomingScanStartedWallMs >= UPCOMING_RESCAN_INTERVAL_MS ||
      !(Math.abs(simMs - upcomingScanStartSimMs) <= UPCOMING_MAX_SIM_DRIFT_MS);
  }
  if (!start) return upcomingResult;

  scanGeneration++;
  upcomingScanStartedWallMs = nowWallMs;
  upcomingScanStartSimMs = simMs;
  activeSweep = null;
  workerScanId = null;

  const w = ensureWorker();
  if (w) {
    try {
      startWorkerSweep(w, objects, simMs);
      return upcomingResult;
    } catch (err) {
      markWorkerBroken(err);
    }
  }

  const sweep = new UpcomingConjunctionSweep(objects, simMs);
  activeSweep = sweep;
  scheduleUpcomingScanStep(sweep);
  return upcomingResult;
}

export function invalidateUpcomingConjunctionCache(): void {
  if (worker && workerScanId != null) {
    worker.postMessage({ type: 'cancel', scanId: workerScanId } satisfies UpcomingWorkerRequest);
  }
  activeSweep = null;
  workerScanId = null;
  // Keep the last published alerts visible until the replacement sweep
  // finishes — wiping them here made a refresh/exit look like "no approaches
  // exist" for the entire recompute window.
  upcomingScanStartedWallMs = -Infinity;
  upcomingScanStartSimMs = NaN;
  upcomingScanCompletedOnce = false;
}
