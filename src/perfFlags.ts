/**
 * Switches for the performance measurements in research/perf, read from the
 * address bar. None is set in normal use, and the app then behaves exactly as
 * without this file.
 *
 *   ?worker=off   start no Web Workers: positions and the close-approach scan
 *                 run on the main thread, through the same fallback the app
 *                 uses when a browser has no workers.
 *   ?limit=5000   use only this many objects of the catalog, picked evenly
 *                 by NORAD number so the mix of orbits stays the same.
 */

/** True when the address asks for no Web Workers (`?worker=off`). */
export function workersDisabled(search = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('worker') === 'off';
}

/** The object limit from `?limit=N` (a whole number of at least 1), or null. */
export function objectLimit(search = globalThis.location?.search ?? ''): number | null {
  const raw = new URLSearchParams(search).get('limit');
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/**
 * `limit` items spread evenly over the list sorted by NORAD number, e.g. every
 * 28th object for 1,000 of 28,000. The same catalog always gives the same
 * selection, and the share of each orbit type stays about the same.
 */
export function pickEvenly<T extends { noradId: number }>(items: readonly T[], limit: number): T[] {
  if (limit >= items.length) return [...items];
  const sorted = [...items].sort((a, b) => a.noradId - b.noradId);
  return Array.from({ length: limit }, (_, i) => sorted[Math.floor((i * sorted.length) / limit)]);
}

/**
 * Marks a moment the measurement script reads (performance.getEntriesByName).
 * Costs next to nothing and shows nothing to the user.
 */
export function markForMeasurement(name: string): void {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(name);
}
