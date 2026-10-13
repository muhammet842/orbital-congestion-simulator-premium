import { describe, expect, it, vi } from 'vitest';
import { ATTEMPTS, MIN_OBJECTS, pullSnapshot, snapshotUrl, validateSnapshot } from './pull-data.mjs';
import { buildDataRef } from './write-data-ref.mjs';

const SHA = 'a'.repeat(40);
const REF = { repository: 'octo/cat', sha: SHA };
const NOW = Date.parse('2026-10-13T12:00:00Z');

function catalog(n = MIN_OBJECTS, fetchedAt = '2026-10-13T06:00:00Z') {
  return {
    fetchedAt,
    objects: Array.from({ length: n }, (_, i) => ({ noradId: i + 1, line1: '1 x', line2: '2 x' })),
  };
}

const okResponse = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

describe('snapshotUrl', () => {
  it('builds an immutable raw URL from repository and commit sha', () => {
    expect(snapshotUrl(REF)).toBe(`https://raw.githubusercontent.com/octo/cat/${SHA}/tle.json`);
  });

  it.each([
    ['branch name instead of sha', { repository: 'octo/cat', sha: 'data' }],
    ['short sha', { repository: 'octo/cat', sha: 'abc123' }],
    ['path traversal in repository', { repository: '../evil/x', sha: SHA }],
    ['repository with a url', { repository: 'https://evil.test/x', sha: SHA }],
    ['missing', null],
  ])('rejects %s', (_label, ref) => {
    expect(() => snapshotUrl(ref)).toThrow();
  });
});

describe('validateSnapshot', () => {
  it('accepts a complete, current catalog', () => {
    expect(() => validateSnapshot(catalog(), NOW)).not.toThrow();
  });

  it('rejects a thin catalog, a bad timestamp, a future timestamp and bad records', () => {
    expect(() => validateSnapshot(catalog(MIN_OBJECTS - 1), NOW)).toThrow(/only/);
    expect(() => validateSnapshot({ objects: catalog().objects, fetchedAt: 'nope' }, NOW)).toThrow(/fetchedAt/);
    expect(() => validateSnapshot(catalog(MIN_OBJECTS, '2027-01-01T00:00:00Z'), NOW)).toThrow(/future/);
    const broken = catalog();
    broken.objects[0] = { noradId: 1 } as never;
    expect(() => validateSnapshot(broken, NOW)).toThrow(/malformed/);
    expect(() => validateSnapshot({ fetchedAt: '2026-10-13T06:00:00Z' }, NOW)).toThrow(/objects/);
  });
});

describe('pullSnapshot', () => {
  it('returns the validated snapshot text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(catalog()));
    const { data, url } = await pullSnapshot(REF, { fetchImpl, sleep: async () => {}, now: NOW });
    expect(data.objects).toHaveLength(MIN_OBJECTS);
    expect(url).toContain(SHA);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures with backoff, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue(okResponse(catalog()));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await pullSnapshot(REF, { fetchImpl, sleep, now: NOW });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('gives up after the configured attempts so the build fails closed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(pullSnapshot(REF, { fetchImpl, sleep: async () => {}, now: NOW })).rejects.toThrow(/HTTP 404/);
    expect(fetchImpl).toHaveBeenCalledTimes(ATTEMPTS);
  });

  it('rejects a snapshot that downloads fine but fails validation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(catalog(10)));
    await expect(pullSnapshot(REF, { fetchImpl, sleep: async () => {}, now: NOW })).rejects.toThrow(/only 10/);
    const notJson = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<html>' });
    await expect(pullSnapshot(REF, { fetchImpl: notJson, sleep: async () => {}, now: NOW })).rejects.toThrow(/JSON/);
  });
});

describe('buildDataRef', () => {
  it('records the snapshot commit with the catalog timestamp and size', () => {
    expect(buildDataRef({ sha: SHA, repository: 'octo/cat' }, catalog(9000, '2026-10-13T06:00:00Z'))).toEqual({
      repository: 'octo/cat',
      branch: 'data',
      sha: SHA,
      fetchedAt: '2026-10-13T06:00:00Z',
      count: 9000,
    });
  });

  it('refuses a bad sha, a bad repository or a non-catalog', () => {
    expect(() => buildDataRef({ sha: 'x', repository: 'octo/cat' }, catalog())).toThrow(/sha/);
    expect(() => buildDataRef({ sha: SHA, repository: 'nope' }, catalog())).toThrow(/repository/);
    expect(() => buildDataRef({ sha: SHA, repository: 'octo/cat' }, {})).toThrow(/catalog/);
  });
});
