/**
 * Which objects are screened, and which ones share orbit data (docked stacks, copies).
 */
import { nameCollator } from '../../data/nameOrder';
import { perigeeAltitudeKm } from '../classify';
import type { TrackedObject } from '../../types';
import { SUBSET } from './settings';

/**
 * Objects whose orbit reaches low Earth orbit at its lowest point. Using the
 * perigee (not the layer) includes stretched orbits that dip into LEO, such
 * as much of the Fengyun-1C debris; using the orbit's shape (not where the
 * object is right now) keeps the set the same on every visit.
 */
export const SCREEN_MAX_PERIGEE_KM = 2000;

function reachesLowOrbit(obj: TrackedObject): boolean {
  const perigee = perigeeAltitudeKm(obj.satrec);
  return Number.isFinite(perigee) ? perigee < SCREEN_MAX_PERIGEE_KM : obj.layer === SUBSET;
}

/** Objects reaching LEO with elements fresh enough to trust for close approaches. */
export function isScreenable(obj: TrackedObject): boolean {
  return reachesLowOrbit(obj) && !obj.staleElements;
}

/** LEO objects left out of screening only because their TLE is too old. */
export function countStaleScreeningExclusions(objects: readonly TrackedObject[]): number {
  let count = 0;
  for (const obj of objects) if (reachesLowOrbit(obj) && obj.staleElements) count++;
  return count;
}

export function findObjectIndex(objects: TrackedObject[], name: string): number {
  const exact = objects.findIndex((o) => o.name === name);
  if (exact >= 0) return exact;
  const upper = name.toUpperCase();
  return objects.findIndex((o) => o.name.toUpperCase() === upper);
}

/** Debris fields routinely contain many objects sharing the exact same
 *  display name — NORAD ID is the only identity that's actually unique. */
export function findObjectIndexByNoradId(objects: TrackedObject[], noradId: number): number {
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
