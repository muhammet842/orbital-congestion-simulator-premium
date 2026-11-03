/**
 * TLE age vs. position difference: the calculations, with no file access.
 * research/tle-age/README.md explains the method; run.mjs reads the archive
 * and writes the results.
 *
 * What is measured: an older TLE of an object is propagated with SGP4 to the
 * epoch of a newer TLE of the same object, and compared with the position the
 * newer TLE gives at its own epoch. The newer TLE is NOT the true position,
 * only a more recent estimate, so the result is the disagreement between two
 * TLEs, not the true error.
 */
import { sgp4, twoline2satrec } from 'satellite.js';
import { EARTH_MEAN_RADIUS_KM, classifyOrbitFromElements, semiMajorAxisKm } from '../../src/orbital/classify.ts';

const DAY_MS = 86_400_000;

/**
 * The TLE epoch from line 1 (columns 19–32: two-digit year, then day of year
 * with fraction, e.g. "26285.85396186"), as a UTC timestamp in milliseconds.
 * Years 57–99 are 1957–1999 and 00–56 are 2000–2056, the standard TLE rule.
 */
export function epochFromLine1(line1) {
  const field = line1.slice(18, 32).trim();
  const yy = Number(field.slice(0, 2));
  const dayOfYear = Number(field.slice(2));
  if (!Number.isFinite(yy) || !Number.isFinite(dayOfYear) || dayOfYear < 1) {
    throw new Error(`bad epoch in line 1: "${field}"`);
  }
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * DAY_MS;
}

/** Objects of a 3LE text: [{ name, noradId, line1, line2 }]. */
export function parseThreeLine(text) {
  const lines = text.split(/\r?\n/);
  const objects = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const [name, line1, line2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (!line1?.startsWith('1 ') || !line2?.startsWith('2 ')) continue;
    objects.push({ name: name.trim(), noradId: Number(line1.slice(2, 7)), line1, line2 });
  }
  return objects;
}

/**
 * Every different TLE of each object across the given catalogs, oldest first:
 * Map<noradId, [{ name, line1, line2, epochMs }]>. The same TLE often appears
 * in several daily catalogs (it was not updated in between); it is kept once,
 * so an object that is rarely updated does not count more than others.
 */
export function distinctTlesByObject(catalogs) {
  const byObject = new Map();
  for (const catalog of catalogs) {
    for (const o of catalog) {
      const epochMs = epochFromLine1(o.line1);
      const list = byObject.get(o.noradId) ?? [];
      if (!list.some((t) => t.epochMs === epochMs)) list.push({ ...o, epochMs });
      byObject.set(o.noradId, list);
    }
  }
  for (const list of byObject.values()) list.sort((a, b) => a.epochMs - b.epochMs);
  return byObject;
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => Math.sqrt(dot(a, a));
const unit = (a) => {
  const n = norm(a);
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};

/**
 * Splits a position difference into three directions around the reference
 * orbit (position r, velocity v):
 *  - radial: up/down (away from Earth's centre),
 *  - along: forwards/backwards along the orbit (the object is early or late),
 *  - cross: sideways, out of the orbit plane.
 */
export function splitDifference(diff, r, v) {
  const radialDir = unit(r);
  const crossDir = unit(cross(r, v));
  const alongDir = cross(crossDir, radialDir);
  return { radial: dot(diff, radialDir), along: dot(diff, alongDir), cross: dot(diff, crossDir) };
}

/**
 * How far (km) a predicted distance from Earth's centre may fall outside the
 * newer orbit's lowest-to-highest range before the prediction counts as
 * impossible. Real changes are far smaller: Starlink raises its orbit from
 * about 350 to 550 km, a 200 km change.
 */
export const RADIUS_MARGIN_KM = 1000;

/**
 * SGP4 can return a position without flagging an error for an orbit that is
 * long gone (e.g. a just-launched object's first TLE, propagated months
 * ahead). A position is plausible when it is outside the Earth and its
 * distance from Earth's centre lies within the newer orbit's perigee–apogee
 * range, widened by RADIUS_MARGIN_KM.
 */
export function isPlausiblePosition(p, satrec) {
  const r = norm(p);
  if (!Number.isFinite(r) || r <= EARTH_MEAN_RADIUS_KM) return false;
  const a = semiMajorAxisKm(satrec.no);
  return r > a * (1 - satrec.ecco) - RADIUS_MARGIN_KM && r < a * (1 + satrec.ecco) + RADIUS_MARGIN_KM;
}

/** Orbit group of an object, from the newer TLE: its layer, plus Starlink and crewed stations apart. */
export function orbitGroups(name, satrec) {
  const layer = classifyOrbitFromElements(semiMajorAxisKm(satrec.no) - EARTH_MEAN_RADIUS_KM, satrec.ecco);
  const groups = [layer];
  if (/STARLINK/i.test(name)) groups.push('STARLINK');
  else if (layer === 'LEO') groups.push('LEO_EXCL_STARLINK');
  if (/^ISS \(ZARYA\)|^CSS \(TIANHE\)/.test(name)) groups.push('STATIONS');
  return groups;
}

/**
 * Compares one older and one newer TLE of the same object. When it cannot,
 * returns { failed: 'sgp4' } (SGP4 reported an error, e.g. a re-entering
 * object) or { failed: 'implausible' } (see isPlausiblePosition).
 */
export function compareTles(older, newer) {
  // Reading a TLE is the slow part, and each TLE is used in many pairs, so the
  // parsed orbit (and the newer TLE's position at its own epoch) is kept on it.
  older.satrec ??= twoline2satrec(older.line1, older.line2);
  newer.satrec ??= twoline2satrec(newer.line1, newer.line2);
  newer.atEpoch ??= sgp4(newer.satrec, 0);
  const predicted = sgp4(older.satrec, (newer.epochMs - older.epochMs) / 60_000);
  const reference = newer.atEpoch;
  if (!predicted?.position || !reference?.position) return { failed: 'sgp4' };
  if (!isPlausiblePosition(predicted.position, newer.satrec) || !isPlausiblePosition(reference.position, newer.satrec)) {
    return { failed: 'implausible' };
  }
  const diff = sub(predicted.position, reference.position);
  return {
    ageDays: (newer.epochMs - older.epochMs) / DAY_MS,
    distanceKm: norm(diff),
    ...splitDifference(diff, reference.position, reference.velocity),
    groups: (newer.groups ??= orbitGroups(newer.name, newer.satrec)),
  };
}

/** Age group label: whole days 1–14 (rounded), then "15-30" and "31+"; under half a day is "0". */
export function ageBin(ageDays) {
  const days = Math.round(ageDays);
  if (days <= 14) return String(days);
  return days <= 30 ? '15-30' : '31+';
}

/** Linear-interpolation quantile (the same rule as Excel's PERCENTILE.INC) of sorted numbers. */
export function quantile(sorted, q) {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Summary of one group: count, median and quartiles, 95th percentile, mean,
 * sample standard deviation, and the Tukey "far out" limit Q3 + 3 × (Q3 − Q1)
 * above which a value is flagged as an outlier (usually a manoeuvre).
 */
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const outlierLimit = q3 + 3 * (q3 - q1);
  return {
    n,
    median: quantile(sorted, 0.5),
    q1,
    q3,
    p95: quantile(sorted, 0.95),
    mean,
    std: Math.sqrt(variance),
    outlierLimit,
    outliers: sorted.filter((v) => v > outlierLimit).length,
  };
}
