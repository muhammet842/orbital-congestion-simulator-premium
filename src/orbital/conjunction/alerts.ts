/**
 * Turning raw close approaches into cards: de-duplicate, rank, choose what to show.
 */
import { nameCollator } from '../../data/nameOrder';
import { propagateObject } from '../propagator';
import type { ConjunctionEvent, TrackedObject } from '../../types';
import { findObjectIndexByNoradId } from './screening';
import { MAX_DISPLAY_ALERTS } from './settings';
import { midpointScene, relativeVelocityKmS } from './vectors';
import { conjunctionSessionKey } from './verification';

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

export function deduplicatePhysicalConjunctions(
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
