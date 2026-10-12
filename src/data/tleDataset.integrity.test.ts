/**
 * Gate for the committed catalog. The TLE refresh workflow runs `npm test`
 * before pushing, so a malformed tle.json fails here instead of reaching
 * production.
 */
import { describe, expect, it } from 'vitest';
import tleRaw from '../../public/data/tle.json?raw';
import { validateDataset } from './validateDataset';

describe('public/data/tle.json', () => {
  it('has no malformed or duplicate records', () => {
    const raw = JSON.parse(tleRaw);
    const { problems, droppedCount, dataset } = validateDataset(raw);
    expect(problems).toEqual([]);
    expect(droppedCount).toBe(0);
    expect(dataset.objects.length).toBeGreaterThan(0);
  });
});
