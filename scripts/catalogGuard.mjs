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
