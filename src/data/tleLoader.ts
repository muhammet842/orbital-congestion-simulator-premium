/**
 * Load and enrich the static TLE catalog for the running app.
 *
 * Uses cache: 'no-cache' so CDN Cache-Control cannot keep a post-deploy stale
 * tle.json (and its firstSeenAt stamps) in the browser for hours.
 * createTrackedObjects builds satellite.js satrecs and drops objects that fail
 * to propagate at the reference epoch.
 */
import { twoline2satrec } from 'satellite.js';
import {
  EARTH_MEAN_RADIUS_KM,
  classifyOrbitFromElements,
  getCategoryColor,
  inferFunctionGroup,
  semiMajorAxisKm,
} from '../orbital/classify';
import { propagateObject, propagateState } from '../orbital/propagator';
import { enrichRecord } from './objectMetadata';
import { getRadioFrequencies } from './radioFrequencies';
import { validateDataset } from './validateDataset';
import { mergeDockedStacks } from './dockedStacks';
import { DataUnavailableError } from '../bootErrors';
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
  let response: Response;
  try {
    response = await fetch('/data/tle.json', { cache: 'no-cache' });
  } catch (err) {
    throw new DataUnavailableError(`Orbital data request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new DataUnavailableError('Orbital data not found. Run: npm run fetch-tle');
  }
  let validated: ReturnType<typeof validateDataset>;
  try {
    validated = validateDataset(await response.json());
  } catch (err) {
    throw new DataUnavailableError(err instanceof Error ? err.message : 'Orbital data is unusable.');
  }
  const { dataset, droppedCount, problems } = validated;
  if (droppedCount > 0) {
    console.warn(`[tleLoader] Dropped ${droppedCount} invalid record(s):`, problems);
  }
  // Docked modules share one published orbit: show each stack as one object.
  const objects = mergeDockedStacks(filterKnownDeorbitedRecords(dataset.objects));
  return {
    ...dataset,
    objects,
    // `count` must describe the in-memory catalogue, otherwise Live Stats
    // can disagree with the actual 3-D/side-panel population.
    count: objects.length,
  };
}

/**
 * Elements older (or, for predicted elements, further ahead) than this relative
 * to the catalog fetch are too uncertain for close-approach screening. CelesTrak
 * keeps serving debris whose last update is up to ~30 days old.
 */
export const STALE_TLE_AGE_DAYS = 7;

const UNIX_EPOCH_JD = 2440587.5;

/** Days between the TLE epoch and `referenceMs`; negative for a future epoch. */
export function tleAgeDays(satrec: TrackedObject['satrec'], referenceMs: number): number {
  const epochMs = (satrec.jdsatepoch - UNIX_EPOCH_JD) * 86_400_000;
  return (referenceMs - epochMs) / 86_400_000;
}

export function createTrackedObjects(dataset: TleDataset, date = new Date()): TrackedObject[] {
  const tracked: TrackedObject[] = [];
  const fetchedAtMs = Date.parse(dataset.fetchedAt);

  for (const record of dataset.objects) {
    try {
      const enriched = enrichRecord({
        ...record,
        category: record.category as ObjectCategory,
      });
      // Mission/operator-sourced overrides are more precise than aggregated
      // catalog rows (which can omit command receivers or combine modes).
      const radioFrequencies = getRadioFrequencies(record.noradId) ?? record.radioFrequencies;

      const satrec = twoline2satrec(enriched.line1, enriched.line2);
      // One SGP4 step to drop objects whose elements fail or have re-entered.
      if (!propagateState(satrec, date)) {
        console.warn(`Skipping ${enriched.name}: propagation failed at ${date.toISOString()}`);
        continue;
      }

      // Mean altitude and inclination straight from the elements (no propagation).
      // satrec.no is mean motion in rad/min; satrec.inclo is inclination in radians.
      const meanAltitudeKm = Math.max(0, semiMajorAxisKm(satrec.no) - EARTH_MEAN_RADIUS_KM);
      const inclinationDeg = satrec.inclo * (180 / Math.PI);
      // The layer comes from the orbit's shape, not from where the object is
      // right now, so it is the same on every visit.
      const propagation = { layer: classifyOrbitFromElements(meanAltitudeKm, satrec.ecco ?? 0) };
      // Absolute age: predicted elements (e.g. Chandra) can carry an epoch a
      // day or so after the fetch, which is fine; far either way is not.
      const staleElements =
        Number.isFinite(fetchedAtMs) && Math.abs(tleAgeDays(satrec, fetchedAtMs)) > STALE_TLE_AGE_DAYS;

      tracked.push({
        ...enriched,
        ...(radioFrequencies ? { radioFrequencies } : {}),
        satrec,
        layer: propagation.layer,
        color: getCategoryColor(enriched.category, propagation.layer, enriched.country),
        functionGroup: inferFunctionGroup(
          enriched.name,
          enriched.category,
          radioFrequencies?.some((f) => f.amateur === true) ?? false,
        ),
        meanAltitudeKm,
        inclinationDeg,
        ...(staleElements ? { staleElements } : {}),
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
