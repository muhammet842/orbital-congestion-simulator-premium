/**
 * The 24-hour prediction: sampled sweep, closest-approach math and the sweep state machine.
 */
import { propagateState, type PropagationState } from '../propagator';
import type { ConjunctionEvent, TrackedObject } from '../../types';
import {
  deduplicatePhysicalConjunctions,
  rankConjunctionAlertsByCriticality,
  rankConjunctionAlertsByTime,
} from './alerts';
import { isScreenable, sharesOrbitData } from './screening';
import { type ConjunctionScanResult, MAX_STORED_ALERTS, THRESHOLD_KM } from './settings';
import { midpointScene, relativeVelocityKmS } from './vectors';
import {
  conjunctionPairKey,
  CROSSING_MIN_REL_VELOCITY_KM_S,
  isCoOrbitingPair,
} from './verification';

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
/**
 * Close approaches are only predicted within this many days of the catalogue's
 * fetch time (the same limit that marks a single TLE as too old to screen).
 * Further out, propagated positions drift by tens of km, so a confident
 * "0.3 km in 4 h" would be fiction.
 */
export const PREDICTION_RANGE_DAYS = 7;

/** Whether `simMs` is close enough to the data's date for close-approach predictions. */
export function isWithinPredictionRange(simMs: number, fetchedAt: string): boolean {
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return true;
  return Math.abs(simMs - fetchedMs) <= PREDICTION_RANGE_DAYS * 86_400_000;
}
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
