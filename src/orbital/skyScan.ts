/**
 * Throttled above-horizon sky scan for Spotter sky mode.
 * Filters catalog objects to FOV-ranked candidates (no debris by default).
 */

import type { SatRec } from 'satellite.js';
import type { ObjectCategory, ObjectFunctionGroup } from '../types';
import {
  computeLookAngles,
  type LookAngles,
  type ObserverLocation,
} from './lookAngles';
import {
  DEFAULT_FOV_DEG,
  skyFovCenterDistanceDeg,
  type SkyViewCenter,
} from './skyProjection';

export interface SkyScanObject {
  noradId: number;
  name: string;
  satrec: SatRec;
  /** Skip debris-heavy clutter in V1 unless selected. */
  category: ObjectCategory | string;
  functionGroup: ObjectFunctionGroup;
}

export interface SkyScanHit {
  noradId: number;
  name: string;
  look: LookAngles;
  /** Angular distance from phone FOV center (degrees). */
  centerDistDeg: number;
  functionGroup: ObjectFunctionGroup;
  category: ObjectCategory | string;
}

export interface SkyScanOptions {
  /** Max satellites returned (selected always forced in if above horizon). */
  maxCount?: number;
  /** Horizontal FOV used for soft ranking preference. */
  fovDeg?: number;
  /** Minimum elevation to include (degrees). */
  minElevationDeg?: number;
  /** Include debris category when true. */
  includeDebris?: boolean;
  /** NORAD of the Spotter target — always kept if above horizon. */
  selectedNoradId?: number | null;
}

const DEFAULT_MAX = 60;
/** Soft cap on how many catalog objects a Spotter scan will SGP4. */
export const DEFAULT_SKY_SCAN_POOL = 1_200;

/**
 * Build a priority-ordered, size-capped scan pool so mobile never SGP4s the
 * entire ~28k catalog in one Spotter session.
 * Order: selected → stations → stratified sample of the rest (no debris).
 */
export function buildSkyScanPool(
  objects: SkyScanObject[],
  selectedNoradId: number | null,
  maxPool = DEFAULT_SKY_SCAN_POOL,
): SkyScanObject[] {
  const selected: SkyScanObject[] = [];
  const stations: SkyScanObject[] = [];
  const rest: SkyScanObject[] = [];

  for (const obj of objects) {
    if (obj.category === 'debris' && obj.noradId !== selectedNoradId) continue;
    if (selectedNoradId != null && obj.noradId === selectedNoradId) {
      selected.push(obj);
    } else if (obj.category === 'stations' || obj.functionGroup === 'station') {
      stations.push(obj);
    } else {
      rest.push(obj);
    }
  }

  const head = [...selected, ...stations];
  const budget = Math.max(0, maxPool - head.length);
  if (budget <= 0 || rest.length === 0) return head.slice(0, maxPool);

  const step = Math.max(1, Math.ceil(rest.length / budget));
  const sampled: SkyScanObject[] = [];
  for (let i = 0; i < rest.length && sampled.length < budget; i += step) {
    sampled.push(rest[i]);
  }
  return head.concat(sampled);
}

function pushHitIfVisible(
  obj: SkyScanObject,
  observer: ObserverLocation,
  date: Date,
  view: SkyViewCenter,
  minEl: number,
  includeDebris: boolean,
  selectedId: number | null,
  into: SkyScanHit[],
): void {
  if (!includeDebris && obj.category === 'debris' && obj.noradId !== selectedId) {
    return;
  }
  const look = computeLookAngles(obj.satrec, observer, date);
  if (!look || look.elevationDeg < minEl) return;

  const centerDistDeg = skyFovCenterDistanceDeg(view, {
    azimuthDeg: look.azimuthDeg,
    elevationDeg: look.elevationDeg,
  });
  into.push({
    noradId: obj.noradId,
    name: obj.name,
    look,
    centerDistDeg,
    functionGroup: obj.functionGroup,
    category: obj.category,
  });
}

/** Sort + cap a collected hit list (selected NORAD forced first when present). */
export function finalizeSkyScanHits(
  hits: SkyScanHit[],
  opts: Pick<SkyScanOptions, 'maxCount' | 'fovDeg' | 'selectedNoradId'> = {},
): SkyScanHit[] {
  const maxCount = opts.maxCount ?? DEFAULT_MAX;
  const fovDeg = opts.fovDeg ?? DEFAULT_FOV_DEG;
  const selectedId = opts.selectedNoradId ?? null;
  const ranked = [...hits];

  ranked.sort((a, b) => {
    const aIn = a.centerDistDeg <= fovDeg * 0.75 ? 0 : 1;
    const bIn = b.centerDistDeg <= fovDeg * 0.75 ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    if (a.centerDistDeg !== b.centerDistDeg) return a.centerDistDeg - b.centerDistDeg;
    return b.look.elevationDeg - a.look.elevationDeg;
  });

  let selected: SkyScanHit | null = null;
  if (selectedId != null) {
    const idx = ranked.findIndex((h) => h.noradId === selectedId);
    if (idx >= 0) {
      selected = ranked[idx];
      ranked.splice(idx, 1);
    }
  }

  const capped = ranked.slice(0, selected ? maxCount - 1 : maxCount);
  if (selected) capped.unshift(selected);
  return capped;
}

/**
 * Scan a slice of the catalog (for cooperative multitasking — avoids main-thread stalls).
 * Appends above-horizon hits into `into`. Returns the next index to resume from.
 * When `budgetMs` is set, stops early once the time budget is exhausted.
 */
export function scanSkyCandidatesChunk(
  objects: SkyScanObject[],
  observer: ObserverLocation,
  date: Date,
  view: SkyViewCenter,
  opts: SkyScanOptions,
  fromIndex: number,
  chunkSize: number,
  into: SkyScanHit[],
  budgetMs?: number,
): { nextIndex: number; done: boolean } {
  const minEl = opts.minElevationDeg ?? 0;
  const includeDebris = opts.includeDebris ?? false;
  const selectedId = opts.selectedNoradId ?? null;
  const start = Math.max(0, fromIndex);
  const hardEnd = Math.min(objects.length, start + Math.max(1, chunkSize));
  const t0 = typeof budgetMs === 'number' && typeof performance !== 'undefined' ? performance.now() : null;

  let i = start;
  for (; i < hardEnd; i++) {
    pushHitIfVisible(objects[i], observer, date, view, minEl, includeDebris, selectedId, into);
    if (t0 != null && typeof budgetMs === 'number' && performance.now() - t0 >= budgetMs) {
      i += 1;
      break;
    }
  }

  return { nextIndex: i, done: i >= objects.length };
}

/**
 * Scan catalog for above-horizon satellites and rank by distance to FOV center.
 * Pure / sync — prefer `scanSkyCandidatesChunk` from the UI when the catalog is large.
 */
export function scanSkyCandidates(
  objects: SkyScanObject[],
  observer: ObserverLocation,
  date: Date,
  view: SkyViewCenter,
  opts: SkyScanOptions = {},
): SkyScanHit[] {
  const hits: SkyScanHit[] = [];
  scanSkyCandidatesChunk(objects, observer, date, view, opts, 0, objects.length, hits);
  return finalizeSkyScanHits(hits, opts);
}
