import { describe, expect, it } from 'vitest';
import { hasValidTleChecksum, recordProblem, validateDataset } from './validateDataset';

const L1 = '1 25544U 98067A   19249.04864348  .00001909  00000-0  40858-4 0  9990';
const L2 = '2 25544  51.6464 320.1755 0007999  10.9066  53.2893 15.50437522187805';
const good = { noradId: 25544, name: 'ISS', line1: L1, line2: L2, category: 'stations' };
/** Rewrites column 69 so a line edited by a test stays checksum-valid. */
const withChecksum = (line: string) => {
  let sum = 0;
  for (const c of line.slice(0, 68)) sum += c === '-' ? 1 : /\d/.test(c) ? Number(c) : 0;
  return line.slice(0, 68) + String(sum % 10);
};
const wrap = (objects: unknown[]) => ({ fetchedAt: '2026-01-01T00:00:00Z', source: 's', count: objects.length, objects });

describe('recordProblem', () => {
  it('accepts a valid record', () => expect(recordProblem(good)).toBeNull());
  it.each([
    ['bad category', { ...good, category: 'evil' }],
    ['short line', { ...good, line1: L1.slice(1) }],
    ['id mismatch', { ...good, noradId: 1 }],
    ['corrupted digit', { ...good, line2: L2.replace('51.6464', '51.6465') }],
    ['non-string name', { ...good, name: 5 }],
    ['non-boolean amateur flag', { ...good, radioFrequencies: [{ service: 'a', mode: 'b', sourceUrl: 'https://x.org', amateur: 'yes' }] }],
    ['js url', { ...good, radioFrequencies: [{ service: 'a', mode: 'b', sourceUrl: 'javascript:1' }] }],
  ])('rejects %s', (_label, record) => expect(recordProblem(record)).not.toBeNull());
});

describe('hasValidTleChecksum', () => {
  it('accepts real lines and rejects a single changed digit', () => {
    expect(hasValidTleChecksum(L1)).toBe(true);
    expect(hasValidTleChecksum(L2)).toBe(true);
    expect(hasValidTleChecksum(L1.replace('40858-4', '40859-4'))).toBe(false);
  });
});

describe('validateDataset', () => {
  it('drops a few bad and duplicate records but keeps the rest', () => {
    const unique = Array.from({ length: 100 }, (_, i) => {
      const id = String(10000 + i);
      return {
        ...good,
        noradId: 10000 + i,
        line1: withChecksum(L1.replace('25544', id)),
        line2: withChecksum(L2.replace('25544', id)),
      };
    });
    const r = validateDataset(wrap([...unique, { ...unique[0] }, { nope: true }]));
    expect(r.dataset.count).toBe(100);
    expect(r.droppedCount).toBe(2);
    expect(r.problems.join('\n')).toMatch(/duplicate/);
  });

  it('throws when too many records are invalid', () => {
    expect(() => validateDataset(wrap([good, { nope: true }]))).toThrow(/rejected/);
  });

  it('throws on structural damage', () => {
    expect(() => validateDataset(null)).toThrow();
    expect(() => validateDataset({ fetchedAt: 'x', objects: [] })).toThrow(/timestamp/);
    expect(() => validateDataset({ fetchedAt: '2026-01-01', objects: 'x' })).toThrow(/object list/);
  });
});

describe('tleSource', () => {
  it('accepts SatNOGS-sourced elements and rejects anything else', () => {
    expect(recordProblem({ ...good, tleSource: 'satnogs' })).toBeNull();
    expect(recordProblem({ ...good, tleSource: 'somewhere' })).toBe('bad tleSource');
  });
});
