/**
 * Confirmed atmospheric re-entries that must not be shown as on-orbit.
 *
 * This is deliberately a small override layer, not a second catalog. SATCAT's
 * DECAY_DATE is the primary source of truth; entries belong here only when a
 * noteworthy re-entry needs to disappear before external catalogues converge.
 */
export const KNOWN_DEORBITED_OBJECTS = [
  {
    noradId: 68319,
    deorbitedAt: '2026-09-07T19:15:00Z',
    name: 'PROGRESS MS-33',
    note: 'Controlled Pacific Ocean re-entry after ISS undocking.',
  },
];

function hasPassed(dateIso, asOf) {
  const time = Date.parse(dateIso);
  return Number.isFinite(time) && time <= asOf.getTime();
}

/** Remove only entries whose explicitly recorded re-entry time has passed. */
export function filterKnownDeorbitedObjects(seen, asOf = new Date()) {
  let removed = 0;
  for (const entry of KNOWN_DEORBITED_OBJECTS) {
    if (!hasPassed(entry.deorbitedAt, asOf)) continue;
    if (seen.delete(entry.noradId)) removed++;
  }
  return removed;
}
