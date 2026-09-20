/**
 * Load and enrich the static TLE catalog for the running app.
 *
 * Uses cache: 'no-cache' so CDN Cache-Control cannot keep a post-deploy stale
 * tle.json (and its firstSeenAt stamps) in the browser for hours.
 * createTrackedObjects builds satellite.js satrecs and drops objects that fail
 * to propagate at the reference epoch.
 */
import { twoline2satrec } from 'satellite.js';
import { getCategoryColor, inferFunctionGroup } from '../orbital/classify';
import { propagateObject } from '../orbital/propagator';
import { enrichRecord } from './objectMetadata';
import type { TleDataset, TrackedObject, ObjectCategory } from '../types';

/**
 * Emergency client-side guard for confirmed re-entries.
 *
 * The build-time SATCAT DECAY_DATE filter in scripts/fetch-tle.mjs is the
 * normal path. This small date-based list deliberately duplicates only
 * high-confidence, noteworthy cases so an already-published stale tle.json
 * cannot render a vehicle after its confirmed atmospheric re-entry. Keep it
 * in sync with scripts/deorbitedObjects.mjs.
 */
const KNOWN_DEORBITED_AT: ReadonlyMap<number, string> = new Map([
  [68319, '2026-09-07T19:15:00Z'], // Progress MS-33 — controlled Pacific re-entry
]);

export function filterKnownDeorbitedRecords(
  records: TleDataset['objects'],
  asOf = new Date(),
): TleDataset['objects'] {
  return records.filter((record) => {
    const deorbitedAt = KNOWN_DEORBITED_AT.get(record.noradId);
    if (!deorbitedAt) return true;
    const deorbitedMs = Date.parse(deorbitedAt);
    return !Number.isFinite(deorbitedMs) || deorbitedMs > asOf.getTime();
  });
}

export async function loadTleDataset(): Promise<TleDataset> {
  // Always revalidate with the server. tle.json is covered by a CDN
  // Cache-Control that can otherwise keep a stale catalog (and its
  // firstSeenAt stamps) in the browser for hours after a deploy.
  const response = await fetch('/data/tle.json', { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error('Orbital data not found. Run: npm run fetch-tle');
  }
  const dataset = await response.json() as TleDataset;
  const objects = filterKnownDeorbitedRecords(dataset.objects);
  return {
    ...dataset,
    objects,
    // `count` must describe the in-memory catalogue, otherwise Live Stats
    // can disagree with the actual 3-D/side-panel population.
    count: objects.length,
  };
}

export function createTrackedObjects(dataset: TleDataset, date = new Date()): TrackedObject[] {
  const tracked: TrackedObject[] = [];

  for (const record of dataset.objects) {
    try {
      const enriched = enrichRecord({
        ...record,
        category: record.category as ObjectCategory,
      });

      const satrec = twoline2satrec(enriched.line1, enriched.line2);
      const propagation = propagateObject(satrec, date);
      if (!propagation) {
        console.warn(`Skipping ${enriched.name}: propagation failed at ${date.toISOString()}`);
        continue;
      }

      // Derive mean altitude and inclination directly from satrec (no propagation needed).
      // satrec.no is mean motion in rad/min; satrec.inclo is inclination in radians.
      const GM_KM3_S2 = 398600.4418;
      const nRadS = satrec.no / 60; // rad/s
      const semiMajorKm = Math.cbrt(GM_KM3_S2 / (nRadS * nRadS));
      const meanAltitudeKm = Math.max(0, semiMajorKm - 6371);
      const inclinationDeg = satrec.inclo * (180 / Math.PI);

      tracked.push({
        ...enriched,
        satrec,
        layer: propagation.layer,
        color: getCategoryColor(enriched.category, propagation.layer, enriched.country),
        functionGroup: inferFunctionGroup(enriched.name, enriched.category),
        meanAltitudeKm,
        inclinationDeg,
      });
    } catch (err) {
      console.warn(`Skipping invalid TLE for ${record.name}:`, err);
    }
  }

  return tracked;
}

export function computeStats(objects: TrackedObject[], fetchedAt: string, date = new Date()) {
  const categoryCounts: Record<ObjectCategory, number> = {
    active: 0,
    debris: 0,
    stations: 0,
  };

  let leoCount = 0;
  let altitudeSum = 0;
  let altitudeCount = 0;

  for (const obj of objects) {
    categoryCounts[obj.category]++;
    const propagation = propagateObject(obj.satrec, date);
    if (!propagation) continue;
    if (propagation.layer === 'LEO') leoCount++;
    altitudeSum += propagation.altitudeKm;
    altitudeCount++;
  }

  const total = objects.length;
  return {
    total,
    leoPercent: altitudeCount > 0 ? Math.round((leoCount / altitudeCount) * 100) : 0,
    avgAltitude: altitudeCount > 0 ? Math.round(altitudeSum / altitudeCount) : 0,
    categoryCounts,
    fetchedAt,
  };
}
