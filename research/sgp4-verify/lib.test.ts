import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { caseTimes, compareCase, errorAfterReference, parseReference, parseTestTles, referenceAgreement } from './lib.mjs';

const DATA = join(__dirname, 'data');
const cases = parseTestTles(readFileSync(join(DATA, 'SGP4-VER.TLE'), 'utf8'));
const matlab = parseReference(readFileSync(join(DATA, 'tmatverDec2015.out'), 'utf8'));
const fortran = parseReference(readFileSync(join(DATA, 'tforverf.out'), 'utf8'));
const MM = 1e-6; // one millimetre in km

describe('reading the verification files', () => {
  it('finds all 33 test cases, in the same order as both reference outputs', () => {
    expect(cases).toHaveLength(33);
    expect(matlab.map((b) => b.noradId)).toEqual(cases.map((c) => c.noradId));
    expect(fortran.map((b) => b.noradId)).toEqual(cases.map((c) => c.noradId));
  });

  it('reads the start, stop and step times after column 69 of line 2', () => {
    expect(cases[0]).toMatchObject({ noradId: 5, start: 0, stop: 4320, step: 360 });
  });

  it('lists the times like the reference programs: epoch first, 0 again when a case passes it', () => {
    expect(caseTimes({ start: 0, stop: 720, step: 360 })).toEqual([0, 360, 720]);
    expect(caseTimes({ start: -240, stop: 240, step: 120 })).toEqual([0, -240, -120, 0, 120, 240]);
    expect(caseTimes({ start: 0, stop: 100, step: 40 })).toEqual([0, 40, 80, 100]);
  });

  it('skips the one extra line at the end of the MATLAB output (its time goes backwards)', () => {
    expect(matlab.reduce((s, b) => s + b.skipped, 0)).toBe(1);
    expect(fortran.reduce((s, b) => s + b.skipped, 0)).toBe(0);
    expect(matlab.at(-1)!.points.map((p: { minutes: number }) => p.minutes)).toEqual(fortran.at(-1)!.points.map((p: { minutes: number }) => p.minutes));
  });

  it('finds the two reference outputs agreeing within 0.1 mm', () => {
    expect(referenceAgreement(matlab, fortran).maxPositionKm).toBeLessThan(0.1 * MM);
  });
});

describe('satellite.js against Vallado et al. (2006)', () => {
  const maxDiff = (r: { points: { dr: number }[] }) => Math.max(0, ...r.points.map((p) => p.dr));

  it('agrees within 1 mm in every case in the app’s mode, except 23599 (the documented Lyddane fix)', () => {
    const over = cases.filter((c, i) => maxDiff(compareCase(c, matlab[i], 'i')) >= MM).map((c) => c.noradId);
    expect(over).toEqual([23599]);
  });

  it('agrees within 1 mm in every case, 23599 included, when switched to the reference’s afspc mode', () => {
    cases.forEach((c, i) => expect(maxDiff(compareCase(c, matlab[i], 'a'))).toBeLessThan(MM));
  });

  it('reports an error at the next time wherever the reference program stopped early', () => {
    const early = cases.map((c, i) => errorAfterReference(c, matlab[i])).filter((s) => s !== null);
    expect(early).toHaveLength(7);
    for (const s of early) expect(s!.satelliteJsError).toBeGreaterThan(0);
  });
});
