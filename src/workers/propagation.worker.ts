/**
 * Propagation Web Worker
 *
 * Runs all SGP4 computations off the main thread.
 *
 * Message protocol
 * ────────────────
 * Main → Worker  { type: 'init',      generation: number, objects: InitObject[] }
 * Worker → Main  { type: 'ready',     generation, count: number }
 *
 * Main → Worker  { type: 'propagate', tickMs: number }
 * Worker → Main  { type: 'results',   generation, tickMs: number, data: Float64Array }
 *                 (data is TRANSFERRED — zero-copy, main thread owns it)
 * Worker → Main  { type: 'error',     generation, message: string }
 *
 * `generation` echoes the latest init so the main thread can drop replies
 * computed for a catalog it has since replaced.
 *
 * Buffer layout  (STRIDE = 10 Float64 values per object)
 * ──────────────
 *  [0]  pos.x  (ECI km)
 *  [1]  pos.y  (ECI km)
 *  [2]  pos.z  (ECI km)
 *  [3]  vel.x  (ECI km/s)
 *  [4]  vel.y  (ECI km/s)
 *  [5]  vel.z  (ECI km/s)
 *  [6]  altitudeKm
 *  [7]  velocityKmS
 *  [8]  inclinationDeg
 *  [9]  layerIndex  (0=LEO  1=MEO  2=GEO  3=HEO  -1=failed)
 */

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  type EciVec3,
  type SatRec,
} from 'satellite.js';

// ── Inline orbit classifier to avoid importing classify.ts which pulls in
//    browser-only transitive dependencies (objectMetadata, etc.) ────────────
function classifyLayer(altKm: number, ecco: number): number {
  if (ecco > 0.25) return 3; // HEO
  if (altKm < 2000) return 0; // LEO
  if (altKm < 35786 * 0.9) return 1; // MEO
  if (Math.abs(altKm - 35786) < 500) return 2; // GEO
  return 3; // HEO
}

const STRIDE = 10;

interface InitObject {
  line1: string;
  line2: string;
}

type WorkerInMessage =
  | { type: 'init'; generation?: number; objects: InitObject[] }
  | { type: 'propagate'; tickMs: number };

let generation = 0;
let satrecs: SatRec[] = [];
// Two alternating buffers — one is being filled while the other is in transit.
let bufA = new Float64Array(0);
let bufB = new Float64Array(0);
let useBufA = true;

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  try {
    handleMessage(e.data);
  } catch (err) {
    self.postMessage({
      type: 'error',
      generation,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

function handleMessage(msg: WorkerInMessage): void {
  if (msg.type === 'init') {
    generation = msg.generation ?? 0;
    satrecs = msg.objects.map((o) => twoline2satrec(o.line1, o.line2));
    const len = satrecs.length * STRIDE;
    bufA = new Float64Array(len);
    bufB = new Float64Array(len);
    useBufA = true;
    self.postMessage({ type: 'ready', generation, count: satrecs.length });
    return;
  }

  if (msg.type === 'propagate') {
    const date = new Date(msg.tickMs);
    const gst = gstime(date);
    const buf = useBufA ? bufA : bufB;

    for (let i = 0; i < satrecs.length; i++) {
      const base = i * STRIDE;
      const result = propagate(satrecs[i], date);

      if (!result || !result.position || !result.velocity) {
        buf[base + 9] = -1;
        continue;
      }

      const pos = result.position as EciVec3<number>;
      const vel = result.velocity as EciVec3<number>;
      const geo = eciToGeodetic(pos, gst);
      const altKm = geo.height;
      const vx = vel.x, vy = vel.y, vz = vel.z;
      const velKms = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const inclDeg = ((satrecs[i].inclo ?? 0) * 180) / Math.PI;
      const ecco = satrecs[i].ecco ?? 0;

      buf[base + 0] = pos.x;
      buf[base + 1] = pos.y;
      buf[base + 2] = pos.z;
      buf[base + 3] = vx;
      buf[base + 4] = vy;
      buf[base + 5] = vz;
      buf[base + 6] = altKm;
      buf[base + 7] = velKms;
      buf[base + 8] = inclDeg;
      buf[base + 9] = classifyLayer(altKm, ecco);
    }

    // Transfer ownership to the main thread (zero-copy)
    const transfer = buf.buffer;
    (self as unknown as Worker).postMessage(
      { type: 'results', generation, tickMs: msg.tickMs, data: buf },
      [transfer],
    );

    // The transferred buffer is now owned by main thread — allocate a fresh one
    // for the next cycle.
    if (useBufA) {
      bufA = new Float64Array(satrecs.length * STRIDE);
    } else {
      bufB = new Float64Array(satrecs.length * STRIDE);
    }
    useBufA = !useBufA;
  }
}
