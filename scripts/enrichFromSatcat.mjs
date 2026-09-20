import { resolveSatcatOwner } from './satcatOwnerMap.mjs';

export const SATCAT_CSV_URL = 'https://celestrak.org/pub/satcat.csv';

/**
 * Minimal CSV splitter that respects double-quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
export function splitCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * Build NORAD → SATCAT OWNER lookup from the official CSV dump.
 * @param {string} csvText
 * @returns {Map<number, string>}
 */
export function parseSatcatOwnerByNorad(csvText) {
  return new Map(
    Array.from(parseSatcatMetadataByNorad(csvText), ([norad, metadata]) => [norad, metadata.owner])
      .filter(([, owner]) => Boolean(owner)),
  );
}

/**
 * Build NORAD → owner/decay metadata from the official SATCAT CSV.
 * DECAY_DATE is empty for objects that are still catalogued as on-orbit.
 *
 * @param {string} csvText
 * @returns {Map<number, { owner?: string, decayDate?: string }>}
 */
export function parseSatcatMetadataByNorad(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return new Map();

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toUpperCase());
  const noradIdx = header.indexOf('NORAD_CAT_ID');
  const ownerIdx = header.indexOf('OWNER');
  const decayIdx = header.indexOf('DECAY_DATE');
  if (noradIdx < 0 || ownerIdx < 0 || decayIdx < 0) {
    throw new Error('satcat.csv missing NORAD_CAT_ID, OWNER, or DECAY_DATE column');
  }

  /** @type {Map<number, { owner?: string, decayDate?: string }>} */
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const norad = Number.parseInt(cols[noradIdx], 10);
    const owner = (cols[ownerIdx] ?? '').trim();
    const decayDate = (cols[decayIdx] ?? '').trim();
    if (!Number.isFinite(norad) || norad <= 0) continue;
    map.set(norad, {
      ...(owner ? { owner } : {}),
      ...(decayDate ? { decayDate } : {}),
    });
  }
  return map;
}

/**
 * Remove objects that SATCAT explicitly marks as decayed on or before `asOf`.
 * A date-only value is interpreted as the start of that UTC day; this is safe
 * for a catalogue generated after the reported decay day and intentionally
 * avoids speculative removal based only on low altitude or a stale TLE epoch.
 */
export function filterSatcatDecayedObjects(seen, metadataByNorad, asOf = new Date()) {
  let removed = 0;
  for (const [noradId, metadata] of metadataByNorad) {
    if (!metadata.decayDate) continue;
    const decayMs = Date.parse(`${metadata.decayDate}T00:00:00Z`);
    if (!Number.isFinite(decayMs) || decayMs > asOf.getTime()) continue;
    if (seen.delete(noradId)) removed++;
  }
  return removed;
}

/**
 * Attach country (and sometimes owner) from SATCAT onto objects in `seen`.
 * Country-code owners only set `country` so name heuristics can still supply
 * operator names (SpaceX, Türksat, …). Org codes set both.
 *
 * @param {Map<number, object>} seen
 * @param {Map<number, string>} ownerByNorad
 * @returns {{ matched: number, unmatched: number, withOwner: number }}
 */
export function applySatcatOwners(seen, ownerByNorad) {
  let matched = 0;
  let unmatched = 0;
  let withOwner = 0;

  for (const obj of seen.values()) {
    const code = ownerByNorad.get(obj.noradId);
    if (!code) {
      unmatched++;
      continue;
    }

    const resolved = resolveSatcatOwner(code);
    if (!resolved) {
      unmatched++;
      continue;
    }

    obj.country = resolved.country;
    if (resolved.owner) {
      obj.owner = resolved.owner;
      withOwner++;
    } else {
      // Drop stale owner from fallback/previous so heuristics can refill.
      delete obj.owner;
    }
    matched++;
  }

  return { matched, unmatched, withOwner };
}

/**
 * @param {typeof fetch} [fetchImpl]
 * @param {{ headers?: Record<string, string> }} [opts]
 * @returns {Promise<Map<number, string>>}
 */
export async function fetchSatcatOwnerMap(fetchImpl = fetch, opts = {}) {
  const metadata = await fetchSatcatMetadataMap(fetchImpl, opts);
  return new Map(
    Array.from(metadata, ([norad, value]) => [norad, value.owner]).filter(([, owner]) => Boolean(owner)),
  );
}

/** @returns {Promise<Map<number, { owner?: string, decayDate?: string }>>} */
export async function fetchSatcatMetadataMap(fetchImpl = fetch, opts = {}) {
  const response = await fetchImpl(SATCAT_CSV_URL, {
    headers: {
      Accept: 'text/csv,*/*',
      ...(opts.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${SATCAT_CSV_URL}`);
  }
  const text = await response.text();
  return parseSatcatMetadataByNorad(text);
}
