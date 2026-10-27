// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeStats,
  createTrackedObjects,
  filterKnownDeorbitedRecords,
  loadTleDataset,
  STALE_TLE_AGE_DAYS,
  tleAgeDays,
} from './tleLoader';
import { DataUnavailableError } from '../bootErrors';
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

  it('reports every catalog failure as DataUnavailableError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(loadTleDataset()).rejects.toBeInstanceOf(DataUnavailableError);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(loadTleDataset()).rejects.toBeInstanceOf(DataUnavailableError);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ fetchedAt: '2026-01-01T00:00:00Z', objects: 'nope' }) }),
    );
    await expect(loadTleDataset()).rejects.toBeInstanceOf(DataUnavailableError);
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
    expect(objects[0].radioFrequencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ service: 'APRS digipeater', uplinkMHz: '145.825' }),
    ]));
  });

  it.each([
    ['fresh', '2019-09-07T00:00:00.000Z', false],
    ['a day-ahead predicted epoch', '2019-09-05T00:00:00.000Z', false],
    ['older than the screening limit', '2019-09-20T00:00:00.000Z', true],
    ['far in the future', '2019-08-20T00:00:00.000Z', true],
  ])('flags staleElements for %s elements', (_label, fetchedAt, stale) => {
    const dataset: TleDataset = {
      fetchedAt,
      source: 'test',
      count: 1,
      objects: [{ noradId: 25544, name: 'ISS (ZARYA)', line1: ISS_LINE1, line2: ISS_LINE2, category: 'stations' }],
    };
    const [object] = createTrackedObjects(dataset, new Date(Date.UTC(2019, 8, 6, 1, 10, 0)));
    expect(Boolean(object.staleElements)).toBe(stale);
  });

  it('measures TLE age from the satrec epoch', () => {
    const [object] = createTrackedObjects(
      {
        fetchedAt: '2019-09-06T00:00:00.000Z',
        source: 'test',
        count: 1,
        objects: [{ noradId: 25544, name: 'ISS (ZARYA)', line1: ISS_LINE1, line2: ISS_LINE2, category: 'stations' }],
      },
      new Date(Date.UTC(2019, 8, 6, 1, 10, 0)),
    );
    // Epoch 19249.04864348 = 2019-09-06T01:10:02Z.
    const epochMs = Date.UTC(2019, 8, 6) + 0.04864348 * 86_400_000;
    expect(tleAgeDays(object.satrec, epochMs + STALE_TLE_AGE_DAYS * 86_400_000)).toBeCloseTo(STALE_TLE_AGE_DAYS, 6);
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
    // Decades after the TLE epoch SGP4 reports the orbit as decayed.
    const objects = createTrackedObjects(dataset, new Date('2100-01-01T00:00:00Z'));
    expect(objects).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipping ISS (ZARYA)'));
    warn.mockRestore();
  });

  it('prefers a primary-source override over an incomplete aggregated row', () => {
    const dataset: TleDataset = {
      fetchedAt: '2019-09-06T00:00:00.000Z',
      source: 'test',
      count: 1,
      objects: [{
        noradId: 67687,
        name: 'LEOPARD',
        line1: ISS_LINE1.replace('25544', '67687'),
        line2: ISS_LINE2.replace('25544', '67687'),
        category: 'stations',
        radioFrequencies: [{
          service: 'Downlink',
          downlinkMHz: '400.960/2279.100',
          mode: '4k8_GMSK CW',
          sourceUrl: 'https://example.invalid/aggregated',
        }],
      }],
    };

    const [object] = createTrackedObjects(dataset, new Date(Date.UTC(2019, 8, 6, 1, 10, 0)));
    expect(object.radioFrequencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ uplinkMHz: '450 (nominal)' }),
      expect.objectContaining({ downlinkMHz: '2279.100', mode: 'BPSK · 64 kbps' }),
    ]));
    expect(object.radioFrequencies).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ downlinkMHz: '400.960/2279.100' }),
    ]));
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
