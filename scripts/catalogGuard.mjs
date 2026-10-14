/**
 * Sanity checks applied before `fetch-tle.mjs` overwrites public/data/tle.json.
 *
 * The absolute minimums in fetch-tle.mjs only catch a catastrophic outage. A
 * partial upstream failure (one 503 on the Starlink group, a truncated debris
 * response) can still lose thousands of objects while staying above them, and
 * the daily bot would ship that to production. These checks compare against
 * the previous catalog and validate individual TLE lines.
 */

/** Largest allowed day-over-day drop per category / in total. */
export const MAX_CATALOG_DROP_FRACTION = 0.15;
/** Drops smaller than this many objects are noise (e.g. a 19-object stations
 *  group losing 3), and are covered by the absolute minimums instead. */
export const MIN_ABSOLUTE_DROP = 50;

/**
 * TLE line checksum (column 69): sum of digits, '-' counts as 1, mod 10.
 * Also enforces the fixed 69-character line length.
 */
export function isValidTleLine(line) {
  if (typeof line !== 'string' || line.length !== 69) return false;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const c = line[i];
    if (c >= '0' && c <= '9') sum += c.charCodeAt(0) - 48;
    else if (c === '-') sum += 1;
  }
  const check = line.charCodeAt(68) - 48;
  return check >= 0 && check <= 9 && sum % 10 === check;
}

/** Both lines valid and referring to the same catalog number. */
export function isValidTlePair(line1, line2) {
  return (
    isValidTleLine(line1) &&
    isValidTleLine(line2) &&
    line1.startsWith('1 ') &&
    line2.startsWith('2 ') &&
    line1.slice(2, 7) === line2.slice(2, 7)
  );
}

/** TLE epoch (line 1, columns 19–32) as Unix ms; NaN when unparseable. */
export function tleEpochMs(line1) {
  const yy = Number(line1.slice(18, 20));
  const dayOfYear = Number(line1.slice(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(dayOfYear) || dayOfYear < 1) return NaN;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000;
}

/**
 * Analyst objects (the 80000–89999 range) are uncorrelated tracks with no
 * international designator: CelesTrak cannot say what they are, so they must
 * not be presented as debris (or anything else).
 */
export function isAnalystObject(line1) {
  return line1.slice(9, 17).trim() === '';
}

/** Crewed station modules and the vehicles that visit them. CelesTrak's
 *  `stations` group also carries ISS-deployed CubeSats, jettisoned hardware
 *  and stray debris, which are not stations. */
const STATION_NAME =
  /^(ISS|CSS)\b|ZARYA|POISK|NAUKA|PRICHAL|TIANHE|WENTIAN|MENGTIAN|TIANGONG|PROGRESS|SOYUZ|DRAGON|CYGNUS|HTV|STARLINER|TIANZHOU|SHENZHOU/i;
const DEBRIS_OR_ROCKET_BODY_NAME = /\bDEB\b|\bR\/B\b/i;

/**
 * Category implied by the object itself rather than by the CelesTrak group it
 * came from. Debris-named or rocket-body objects become debris unless they
 * have a published radio channel (some upper stages carry live payloads, e.g.
 * RS-44 on its Breeze-KM). Non-station members of `stations` become active.
 *
 * @param {{ name: string, category: string, radioFrequencies?: unknown[] }} obj
 */
export function correctedCategory(obj) {
  const transmits = Array.isArray(obj.radioFrequencies) && obj.radioFrequencies.length > 0;
  if (obj.category !== 'debris' && DEBRIS_OR_ROCKET_BODY_NAME.test(obj.name) && !transmits) return 'debris';
  if (obj.category === 'stations' && !STATION_NAME.test(obj.name)) return 'active';
  return obj.category;
}

/**
 * Compare category counts with the previous catalog. Returns human-readable
 * problems; empty means OK. Categories absent from the previous catalog (or a
 * missing previous catalog) are not checked.
 *
 * @param {Record<string, number>} current
 * @param {Record<string, number> | null} previous
 * @param {number} [maxDropFraction]
 * @param {number} [minAbsoluteDrop]
 */
export function findCatalogRegressions(
  current,
  previous,
  maxDropFraction = MAX_CATALOG_DROP_FRACTION,
  minAbsoluteDrop = MIN_ABSOLUTE_DROP,
) {
  if (!previous) return [];
  const problems = [];
  const sum = (counts) => Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
  const check = (label, now, before) => {
    if (!(before > 0)) return;
    const drop = (before - now) / before;
    if (drop > maxDropFraction && before - now >= minAbsoluteDrop) {
      problems.push(
        `${label}: ${now} vs ${before} previously (−${(drop * 100).toFixed(1)}%, limit ${(maxDropFraction * 100).toFixed(0)}%)`,
      );
    }
  };
  check('total', sum(current), sum(previous));
  for (const [category, before] of Object.entries(previous)) {
    check(category, Number(current[category]) || 0, Number(before) || 0);
  }
  return problems;
}
