/**
 * Runs the 24-hour sweep: in a Web Worker when possible, otherwise in idle-time slices.
 */
import type { OrbitLayer, TrackedObject } from '../../types';
import type { ConjunctionRefreshListener } from './liveScan';
import type { ConjunctionScanResult } from './settings';
import {
  UPCOMING_HORIZON_MS,
  UPCOMING_MAX_SIM_DRIFT_MS,
  UPCOMING_RESCAN_INTERVAL_MS,
  UPCOMING_SAMPLE_STEP_MS,
  UpcomingConjunctionSweep,
} from './upcomingSweep';

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
