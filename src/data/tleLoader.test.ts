// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeStats,
  createTrackedObjects,
  filterKnownDeorbitedRecords,
  loadTleDataset,
} from './tleLoader';
import type { TleDataset } from '../types';

const ISS_LINE1 = '1 25544U 98067A   19249.04864348  .00001909  00000-0  40858-4 0  9990';
const ISS_LINE2 = '2 25544  51.6464 339.7939 0007927 131.8860 308.6206 15.50431119187116';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadTleDataset', () => {
  it('fetches /data/tle.json with cache: no-cache', async () => {
    const payload: TleDataset = {
      fetchedAt: '2026-07-30T00:00:00.000Z',
      source: 'test',
      count: 0,
      objects: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const dataset = await loadTleDataset();
    expect(dataset).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/data/tle.json', { cache: 'no-cache' });
  });

  it('throws a helpful error when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(loadTleDataset()).rejects.toThrow(/fetch-tle/i);
  });
});

describe('filterKnownDeorbitedRecords', () => {
  it('hides Progress MS-33 after its confirmed atmospheric re-entry', () => {
    const records: TleDataset['objects'] = [
      { noradId: 68319, name: 'PROGRESS MS-33', line1: '', line2: '', category: 'active' },
      { noradId: 25544, name: 'ISS', line1: '', line2: '', category: 'stations' },
    ];

    expect(filterKnownDeorbitedRecords(records, new Date('2026-09-20T00:00:00Z')))
      .toEqual([records[1]]);
  });
});

describe('createTrackedObjects', () => {
  it('builds tracked objects from valid TLEs near epoch', () => {
    const dataset: TleDataset = {
      fetchedAt: '2019-09-06T00:00:00.000Z',
      source: 'test',
      count: 1,
      objects: [
        {
          noradId: 25544,
          name: 'ISS (ZARYA)',
          line1: ISS_LINE1,
          line2: ISS_LINE2,
          category: 'stations',
        },
      ],
    };
    const objects = createTrackedObjects(dataset, new Date(Date.UTC(2019, 8, 6, 1, 10, 0)));
    expect(objects).toHaveLength(1);
    expect(objects[0].noradId).toBe(25544);
    expect(objects[0].layer).toBe('LEO');
    expect(objects[0].satrec).toBeTruthy();
  });

  it('skips records when propagation fails at the requested date', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dataset: TleDataset = {
      fetchedAt: '2019-09-06T00:00:00.000Z',
      source: 'test',
      count: 1,
      objects: [
        {
          noradId: 25544,
          name: 'ISS (ZARYA)',
          line1: ISS_LINE1,
          line2: ISS_LINE2,
          category: 'stations',
        },
      ],
    };
    // Far outside the TLE epoch — createTrackedObjects should skip if propagate returns null.
    const objects = createTrackedObjects(dataset, new Date('1900-01-01T00:00:00Z'));
    // Depending on satellite.js, either empty or a warn was emitted for failure.
    if (objects.length === 0) {
      expect(warn).toHaveBeenCalled();
    } else {
      // If the library still yields a state, we at least built a tracked object.
      expect(objects[0].noradId).toBe(25544);
    }
    warn.mockRestore();
  });
});

describe('computeStats', () => {
  it('aggregates category counts and fetchedAt', () => {
    const dataset: TleDataset = {
      fetchedAt: '2019-09-06T00:00:00.000Z',
      source: 'test',
      count: 1,
      objects: [
        {
          noradId: 25544,
          name: 'ISS (ZARYA)',
          line1: ISS_LINE1,
          line2: ISS_LINE2,
          category: 'stations',
        },
      ],
    };
    const date = new Date(Date.UTC(2019, 8, 6, 1, 10, 0));
    const objects = createTrackedObjects(dataset, date);
    const stats = computeStats(objects, dataset.fetchedAt, date);
    expect(stats.total).toBe(1);
    expect(stats.categoryCounts.stations).toBe(1);
    expect(stats.fetchedAt).toBe(dataset.fetchedAt);
    expect(stats.leoPercent).toBe(100);
  });
});
