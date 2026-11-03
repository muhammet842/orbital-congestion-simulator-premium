/**
 * SGP4 verification: reads the published test cases of Vallado et al. (2006)
 * and compares satellite.js (the library the app uses) with the reference
 * output of the authors' own implementation. No file access here; run.mjs
 * reads the files. Method: research/sgp4-verify/README.md.
 */
import { sgp4, twoline2satrec } from 'satellite.js';

/**
 * Test cases of SGP4-VER.TLE: [{ noradId, comment, line1, line2 }]. A "#"
 * line before a TLE describes what that case tests; line 2 carries the
 * start, stop and step times after column 69, which are not needed here
 * because the reference output lists every time it computed.
 */
export function parseTestTles(text) {
  const cases = [];
  let comment = '';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('#')) {
      const note = line.replace(/^#+/, '').trim();
      if (note && !/Verification test cases/.test(note)) comment = note.replace(/\s+/g, ' ');
      continue;
    }
    if (line.startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      const [start, stop, step] = lines[i + 1].slice(69).trim().split(/\s+/).map(Number);
      cases.push({
        noradId: Number(line.slice(2, 7)),
        comment,
        line1: line.slice(0, 69),
        line2: lines[i + 1].slice(0, 69),
        start,
        stop,
        step,
      });
      comment = '';
      i += 1;
    }
  }
  return cases;
}

/**
 * The times (minutes from epoch) the reference programs compute for a case:
 * the epoch (0) first, then start, start + step, … and the stop time itself.
 * A case starting at 0 does not repeat the epoch; one starting before it
 * passes 0 again on the way, as the reference programs do.
 */
export function caseTimes({ start, stop, step }) {
  const times = [0];
  for (let t = start; t < stop - 1e-9; t += step) if (!(t === 0 && start === 0)) times.push(t);
  if (stop !== 0) times.push(stop);
  return times;
}

/**
 * Reference output: [{ noradId, points: [{ minutes, r: [x,y,z] km, v: [vx,vy,vz] km/s }], skipped }].
 * Each block starts with "<NORAD> xx"; each row starts with the minutes since
 * epoch, then position and velocity (later columns are not used).
 *
 * A row whose time goes backwards (other than right after the epoch row,
 * when a case starts at a negative time) is not a computed point: the MATLAB
 * output ends with one such extra line. Such rows are counted in `skipped`.
 */
export function parseReference(text) {
  const blocks = [];
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*(\d+)\s+xx\s*$/.exec(line);
    if (header) {
      blocks.push({ noradId: Number(header[1]), points: [], skipped: 0 });
      continue;
    }
    const cols = line.trim().split(/\s+/).map(Number);
    if (blocks.length === 0 || cols.length < 7 || cols.slice(0, 7).some((n) => !Number.isFinite(n))) continue;
    const block = blocks.at(-1);
    const previous = block.points.at(-1)?.minutes;
    if (previous !== undefined && previous !== 0 && cols[0] < previous) {
      block.skipped += 1;
      continue;
    }
    block.points.push({ minutes: cols[0], r: cols.slice(1, 4), v: cols.slice(4, 7) });
  }
  return blocks;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Propagates one test case with satellite.js at every reference time.
 * Returns per-point differences (position in km, velocity in km/s) and, when
 * satellite.js reports an error, the time and error code it stopped at.
 *
 * `mode` is SGP4's operation mode. The app (twoline2satrec) always uses 'i'
 * ("improved"); the reference outputs were made in 'a' ("afspc", the older
 * behaviour). 'a' here only switches the propagation-time part of the
 * algorithm and is used as a diagnostic, to show where a difference comes from.
 */
export function compareCase(testCase, reference, mode = 'i') {
  const satrec = twoline2satrec(testCase.line1, testCase.line2);
  const initError = satrec.error;
  satrec.operationmode = mode;
  const points = [];
  let stoppedAt = null;
  for (const ref of reference.points) {
    const out = sgp4(satrec, ref.minutes);
    if (!out?.position || !out?.velocity) {
      stoppedAt = { minutes: ref.minutes, error: satrec.error };
      break;
    }
    const r = [out.position.x, out.position.y, out.position.z];
    const v = [out.velocity.x, out.velocity.y, out.velocity.z];
    points.push({ minutes: ref.minutes, dr: dist(r, ref.r), dv: dist(v, ref.v) });
  }
  return { points, stoppedAt, initError };
}

/**
 * When the reference stops before the case's last time (the reference
 * program hit an SGP4 error, e.g. the object decayed), satellite.js should
 * report an error at the next time too. Returns null when the reference ran
 * to the end, else { minutes, satelliteJsError } (0 = no error: a mismatch).
 */
export function errorAfterReference(testCase, reference) {
  const times = caseTimes(testCase);
  const last = reference.points.at(-1)?.minutes;
  const next = times[times.indexOf(last) + 1];
  if (last === undefined || next === undefined) return null;
  const satrec = twoline2satrec(testCase.line1, testCase.line2);
  if (satrec.error) return { minutes: 0, satelliteJsError: satrec.error };
  const out = sgp4(satrec, next);
  return { minutes: next, satelliteJsError: out?.position ? 0 : satrec.error };
}

/** Largest position and velocity difference between two reference outputs at the times both list. */
export function referenceAgreement(a, b) {
  let dr = 0;
  let dv = 0;
  let n = 0;
  for (let k = 0; k < Math.min(a.length, b.length); k += 1) {
    const byTime = new Map(b[k].points.map((p) => [p.minutes, p]));
    for (const p of a[k].points) {
      const q = byTime.get(p.minutes);
      if (!q) continue;
      dr = Math.max(dr, dist(p.r, q.r));
      dv = Math.max(dv, dist(p.v, q.v));
      n += 1;
    }
  }
  return { maxPositionKm: dr, maxVelocityKmS: dv, points: n };
}
