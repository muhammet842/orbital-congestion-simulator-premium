/**
 * Close-approach Web Worker
 *
 * Runs the 24h predictive conjunction sweep (`UpcomingConjunctionSweep`) off
 * the main thread. The sweep is ~15M SGP4 calls per 24h, far too much to
 * interleave with rendering.
 *
 * Message protocol (types live in orbital/conjunction.ts)
 * ────────────────
 * Main → Worker  { type: 'scan', scanId, startMs, horizonMs, sampleStepMs, objects? }
 *                 (`objects` only when the catalog changed; index-aligned)
 * Main → Worker  { type: 'cancel', scanId }
 * Worker → Main  { type: 'progress' | 'done', scanId, result }
 * Worker → Main  { type: 'error', scanId, message }
 */

import { twoline2satrec } from 'satellite.js';
import {
  UpcomingConjunctionSweep,
  type UpcomingWorkerRequest,
  type UpcomingWorkerResponse,
} from '../orbital/conjunction';
import type { TrackedObject } from '../types';

/** Work slice before yielding so `cancel`/new `scan` messages get through. */
const SLICE_MS = 50;
/** Minimum spacing between streamed partial results. */
const PROGRESS_INTERVAL_MS = 1_000;

let catalog: TrackedObject[] = [];
let current: { scanId: number; sweep: UpcomingConjunctionSweep } | null = null;
/** Page hidden: the sweep waits here instead of using the CPU. */
let paused = false;
let parked: { scanId: number; lastProgressMs: number } | null = null;

function post(msg: UpcomingWorkerResponse): void {
  (self as unknown as Worker).postMessage(msg);
}

function pump(scanId: number, lastProgressMs: number): void {
  if (!current || current.scanId !== scanId) return;
  if (paused) {
    parked = { scanId, lastProgressMs };
    return;
  }
  const { sweep } = current;
  try {
    const deadline = performance.now() + SLICE_MS;
    while (performance.now() < deadline) {
      if (sweep.step() === 'done') {
        current = null;
        post({ type: 'done', scanId, result: sweep.snapshot() });
        return;
      }
    }
    let nextProgressMs = lastProgressMs;
    const now = performance.now();
    if (sweep.hitCount > 0 && now - lastProgressMs >= PROGRESS_INTERVAL_MS) {
      post({ type: 'progress', scanId, result: sweep.snapshot() });
      nextProgressMs = now;
    }
    setTimeout(() => pump(scanId, nextProgressMs), 0);
  } catch (err) {
    current = null;
    post({ type: 'error', scanId, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (e: MessageEvent<UpcomingWorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'pause') {
    paused = true;
    return;
  }
  if (msg.type === 'resume') {
    paused = false;
    const resume = parked;
    parked = null;
    if (resume) pump(resume.scanId, resume.lastProgressMs);
    return;
  }
  if (msg.type === 'cancel') {
    if (current?.scanId === msg.scanId) current = null;
    return;
  }

  try {
    if (msg.objects) {
      catalog = msg.objects.map((o) => ({
        ...o,
        satrec: twoline2satrec(o.line1, o.line2),
      })) as unknown as TrackedObject[];
    }
    current = {
      scanId: msg.scanId,
      sweep: new UpcomingConjunctionSweep(catalog, msg.startMs, msg.horizonMs, msg.sampleStepMs),
    };
    pump(msg.scanId, performance.now());
  } catch (err) {
    current = null;
    post({ type: 'error', scanId: msg.scanId, message: err instanceof Error ? err.message : String(err) });
  }
};
