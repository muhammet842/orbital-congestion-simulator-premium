import { isValidTlePair, tleEpochMs } from './catalogGuard.mjs';

/**
 * Fallback orbit data from the SatNOGS DB (CC BY-SA 4.0) for active amateur
 * satellites CelesTrak publishes nothing for. LAPAN-A2 (IO-86) is the case
 * that prompted this: still a popular repeater, but no public GP elements.
 *
 * SatNOGS rows are kept only when they are recent. Many of them are years
 * old, and SGP4 from such elements would put the satellite somewhere it isn't.
 */
export const SATNOGS_TLE_URL = 'https://db.satnogs.org/api/tle/?format=json';
export const SATNOGS_SATELLITES_URL = 'https://db.satnogs.org/api/satellites/?format=json';
export const MAX_SATNOGS_TLE_AGE_DAYS = 30;

const DAY_MS = 86_400_000;

async function fetchJsonArray(url, what, fetchImpl, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} for SatNOGS ${what}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error(`SatNOGS ${what} is not an array`);
  return rows;
}

export function fetchSatnogsTles(fetchImpl = fetch, options = {}) {
  return fetchJsonArray(SATNOGS_TLE_URL, 'TLE list', fetchImpl, options);
}

export function fetchSatnogsSatellites(fetchImpl = fetch, options = {}) {
  return fetchJsonArray(SATNOGS_SATELLITES_URL, 'satellite list', fetchImpl, options);
}

/** "LAPAN-A2" + aliases "ORARI, IO-86, YB0X" -> "LAPAN-A2 (IO-86)": the OSCAR
 *  number is what operators search for. */
export function satnogsDisplayName(name, aliases = '') {
  const base = String(name ?? '').replace(/^0\s+/, '').trim();
  const oscar = String(aliases ?? '')
    .split(',')
    .map((a) => a.trim())
    .find((a) => /^[A-Z]{1,3}-\d{1,3}$/.test(a));
  return oscar && !base.includes(oscar) ? `${base} (${oscar})` : base;
}

/**
 * Catalogue records for `wantedIds` from SatNOGS TLE rows: valid lines, the
 * same catalog number on both lines, and an epoch at most `maxAgeDays` old.
 * `satellites` (optional) supplies names and aliases.
 */
export function satnogsTleObjects(rows, wantedIds, nowMs, { satellites = [], maxAgeDays = MAX_SATNOGS_TLE_AGE_DAYS } = {}) {
  const wanted = new Set(wantedIds);
  const satByNorad = new Map();
  for (const sat of Array.isArray(satellites) ? satellites : []) {
    if (Number.isInteger(sat?.norad_cat_id)) satByNorad.set(sat.norad_cat_id, sat);
  }

  const objects = [];
  const tooOld = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const noradId = Number(row?.norad_cat_id);
    if (!wanted.has(noradId)) continue;
    const line1 = String(row.tle1 ?? '').trimEnd();
    const line2 = String(row.tle2 ?? '').trimEnd();
    if (!isValidTlePair(line1, line2) || Number(line1.slice(2, 7)) !== noradId) continue;

    const ageDays = (nowMs - tleEpochMs(line1)) / DAY_MS;
    // A small negative age is a predicted epoch; anything else is suspect.
    if (!Number.isFinite(ageDays) || ageDays < -2) continue;
    if (ageDays > maxAgeDays) {
      tooOld.push(noradId);
      continue;
    }

    const sat = satByNorad.get(noradId);
    objects.push({
      noradId,
      name: satnogsDisplayName(sat?.name ?? row.tle0, sat?.names),
      line1,
      line2,
      category: 'active',
      tleSource: 'satnogs',
    });
    wanted.delete(noradId); // one record per satellite
  }
  return { objects, tooOld };
}
