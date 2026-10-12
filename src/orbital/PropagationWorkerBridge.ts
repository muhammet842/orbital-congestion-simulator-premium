/**
 * PropagationWorkerBridge
 *
 * Main-thread façade for the propagation Web Worker.
 *
 * Usage
 * ─────
 *   const bridge = new PropagationWorkerBridge();
 *   bridge.init(objects);                      // call once when TLE data loads
 *   // every frame:
 *   bridge.request(simTime.getTime(), speed);  // fire-and-forget
 *   const results = bridge.getLatestResults(); // null until first reply
 *
 * When the Worker is still computing the previous frame, the bridge queues
 * only the LATEST requested tickMs and replays it the moment the Worker is
 * free — so the main thread always uses the most recent available data.
 *
 * If the Worker hasn't returned its first result yet, getLatestResults()
 * returns null; callers should fall back to synchronous propagation.
 *
 * Failure handling
 * ────────────────
 * Every `init` carries a generation number that the Worker echoes back, so a
 * reply computed for an older catalog is never decoded against a newer one.
 * A Worker error, a malformed message, or a reply that never arrives
 * (watchdog) restarts the Worker up to MAX_RESTARTS times. While restarting —
 * and permanently once restarts are exhausted — getLatestResults() returns
 * null so the scene falls back to synchronous propagation instead of freezing
 * on the last good frame.
 */

import type { TrackedObject, OrbitLayer } from '../types';
import type { PropagationResult } from './propagator';
import { quantizeSimulationTimeMs } from './propagationBatch';

const STRIDE = 10;
const LAYER_NAMES: OrbitLayer[] = ['LEO', 'MEO', 'GEO', 'HEO'];
const MAX_RESTARTS = 2;
/** A full-catalog pass takes tens of ms; init well under a second. */
export const WORKER_WATCHDOG_MS = 10_000;

function decodeBuffer(
  data: Float64Array,
  count: number,
): (PropagationResult | null)[] {
  const out: (PropagationResult | null)[] = new Array(count).fill(null);
  for (let i = 0; i < count; i++) {
    const base = i * STRIDE;
    const layerIdx = data[base + 9];
    if (!(layerIdx >= 0)) continue; // -1 = failed, NaN/undefined = short buffer
    out[i] = {
      positionEci: { x: data[base + 0], y: data[base + 1], z: data[base + 2] },
      velocityEci: { x: data[base + 3], y: data[base + 4], z: data[base + 5] },
      altitudeKm: data[base + 6],
      velocityKmS: data[base + 7],
      inclinationDeg: data[base + 8],
      layer: LAYER_NAMES[layerIdx] ?? 'LEO',
    };
  }
  return out;
}

type WorkerOutMessage =
  | { type: 'ready'; count: number; generation?: number }
  | { type: 'results'; tickMs: number; data: Float64Array; generation?: number }
  | { type: 'error'; message: string; generation?: number };

type InitPayload = { line1: string; line2: string }[];

export class PropagationWorkerBridge {
  private worker: Worker | null = null;
  private latestResults: (PropagationResult | null)[] | null = null;
  private workerReady = false;
  private pending = false;
  /** Queued tick to send as soon as the Worker finishes current job. */
  private queuedTickMs: number | null = null;
  private lastProcessedTickMs = NaN;
  private objectCount = 0;
  private generation = 0;
  private initPayload: InitPayload | null = null;
  /** Wall time of the outstanding init/propagate request (watchdog). */
  private awaitingSinceMs: number | null = null;
  private restarts = 0;
  private failed = false;

  constructor() {
    this.worker = this.spawn();
  }

  /** False once the Worker has failed more than MAX_RESTARTS times. */
  isAvailable(): boolean {
    return !this.failed;
  }

  /**
   * Send TLE data to the Worker once the object list is known.
   * Must be called again if the object list is replaced.
   */
  init(objects: TrackedObject[]): void {
    this.objectCount = objects.length;
    this.initPayload = objects.map((o) => ({ line1: o.line1, line2: o.line2 }));
    this.sendInit();
  }

  /**
   * Request propagation for a given sim time + speed.
   * The tick is quantized (mirrors propagationBatch logic) to avoid
   * redundant recomputes at fast time warp.
   * Non-blocking — result arrives via the internal message handler.
   */
  request(simTimeMs: number, speed: number): void {
    if (this.awaitingSinceMs !== null && performance.now() - this.awaitingSinceMs > WORKER_WATCHDOG_MS) {
      this.handleFailure(new Error('worker did not respond in time'));
    }
    if (!this.workerReady || !this.worker) return;
    const tickMs = quantizeSimulationTimeMs(simTimeMs, speed);
    if (tickMs === this.lastProcessedTickMs) return;

    if (this.pending) {
      // Worker is busy — queue this tick so it runs as soon as possible.
      this.queuedTickMs = tickMs;
      return;
    }

    this.dispatchToWorker(tickMs);
  }

  /**
   * Returns the last decoded results, or null before the first reply and
   * whenever the Worker is down.
   */
  getLatestResults(): (PropagationResult | null)[] | null {
    return this.latestResults;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.awaitingSinceMs = null;
  }

  private spawn(): Worker | null {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/propagation.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (err) {
      console.error('[PropagationWorker] could not start:', err);
      this.failed = true;
      return null;
    }
    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      if (worker !== this.worker) return; // message from a terminated instance
      this.handleMessage(e.data);
    };
    worker.onerror = (err) => {
      if (worker === this.worker) this.handleFailure(err);
    };
    worker.onmessageerror = (err) => {
      if (worker === this.worker) this.handleFailure(err);
    };
    return worker;
  }

  private handleMessage(msg: WorkerOutMessage): void {
    // Replies tagged for an older init are stale (catalog replaced since).
    if (msg.generation !== undefined && msg.generation !== this.generation) return;

    if (msg.type === 'ready') {
      this.workerReady = true;
      this.awaitingSinceMs = null;
      return;
    }
    if (msg.type === 'error') {
      this.handleFailure(new Error(msg.message));
      return;
    }
    if (msg.type === 'results') {
      this.pending = false;
      this.awaitingSinceMs = null;
      this.lastProcessedTickMs = msg.tickMs;
      this.latestResults = decodeBuffer(msg.data, this.objectCount);
      // A healthy reply resets the restart budget.
      this.restarts = 0;

      // If a newer request was queued while the Worker was busy, send it now.
      if (
        this.queuedTickMs !== null &&
        this.queuedTickMs !== this.lastProcessedTickMs
      ) {
        this.dispatchToWorker(this.queuedTickMs);
        this.queuedTickMs = null;
      }
    }
  }

  private handleFailure(reason: unknown): void {
    console.error('[PropagationWorker] error:', reason);
    this.worker?.terminate();
    this.worker = null;
    this.resetProgress();

    if (this.restarts >= MAX_RESTARTS) {
      this.failed = true;
      console.error('[PropagationWorker] giving up; using main-thread propagation');
      return;
    }
    this.restarts++;
    this.worker = this.spawn();
    if (this.initPayload) this.sendInit();
  }

  private resetProgress(): void {
    this.latestResults = null;
    this.workerReady = false;
    this.pending = false;
    this.queuedTickMs = null;
    this.lastProcessedTickMs = NaN;
    this.awaitingSinceMs = null;
  }

  private sendInit(): void {
    this.resetProgress();
    if (!this.worker || !this.initPayload) return;
    this.generation++;
    this.awaitingSinceMs = performance.now();
    this.worker.postMessage({
      type: 'init',
      generation: this.generation,
      objects: this.initPayload,
    });
  }

  private dispatchToWorker(tickMs: number): void {
    if (!this.worker) return;
    this.pending = true;
    this.queuedTickMs = null;
    this.awaitingSinceMs = performance.now();
    this.worker.postMessage({ type: 'propagate', tickMs });
  }
}
