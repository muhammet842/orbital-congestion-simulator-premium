import { describe, expect, it } from 'vitest';
import { recordProblem, validateDataset } from './validateDataset';

const L1 = '1 25544U 98067A   19249.04864348  .00001909  00000-0  40858-4 0  9990';
const L2 = '2 25544  51.6464 320.1755 0007999  10.9066  53.2893 15.50437522187805';
const good = { noradId: 25544, name: 'ISS', line1: L1, line2: L2, category: 'stations' };
const wrap = (objects: unknown[]) => ({ fetchedAt: '2026-01-01T00:00:00Z', source: 's', count: objects.length, objects });

describe('recordProblem', () => {
  it('accepts a valid record', () => expect(recordProblem(good)).toBeNull());
  it.each([
    ['bad category', { ...good, category: 'evil' }],
    ['short line', { ...good, line1: L1.slice(1) }],
    ['id mismatch', { ...good, noradId: 1 }],
    ['non-string name', { ...good, name: 5 }],
    ['js url', { ...good, radioFrequencies: [{ service: 'a', mode: 'b', sourceUrl: 'javascript:1' }] }],
  ])('rejects %s', (_label, record) => expect(recordProblem(record)).not.toBeNull());
});

describe('validateDataset', () => {
  it('drops a few bad and duplicate records but keeps the rest', () => {
    const unique = Array.from({ length: 100 }, (_, i) => {
      const id = String(10000 + i);
      return { ...good, noradId: 10000 + i, line1: L1.replace('25544', id), line2: L2.replace('25544', id) };
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
