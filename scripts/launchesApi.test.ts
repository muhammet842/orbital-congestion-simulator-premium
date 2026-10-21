import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_LAUNCHES,
  RECENT_MS,
  classifyStatus,
  destinationOf,
  missionDescriptionOf,
  MAX_DESCRIPTION_CHARS,
  normalizeLaunch,
  normalizeLaunches,
  pickDetailTarget,
} from '../api/_launches.mjs';
import handler, { buildPayload, resetMemoryCache } from '../api/launches.js';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const HOUR = 3_600_000;

/** A launch as Launch Library 2 returns it (mode=normal), trimmed to what we read. */
function raw(overrides: Record<string, unknown> = {}) {
  return {
    id: 'abc-123',
    name: 'Falcon 9 Block 5 | Dragon CRS-2 SpX-35',
    net: new Date(NOW + 5 * HOUR).toISOString(),
    status: { abbrev: 'Go', name: 'Go for Launch' },
    rocket: { configuration: { full_name: 'Falcon 9 Block 5' } },
    launch_service_provider: { name: 'SpaceX' },
    pad: {
      name: 'Space Launch Complex 40',
      latitude: '28.56194122',
      longitude: '-80.57735736',
      location: { name: 'Cape Canaveral SFS, FL, USA' },
    },
    mission: { name: 'Dragon CRS-2 SpX-35', type: 'Resupply', orbit: { name: 'Low Earth Orbit' } },
    program: [{ name: 'Commercial Resupply Services' }, { name: 'International Space Station' }],
    ...overrides,
  };
}

describe('classifyStatus', () => {
  it.each([
    ['Go', 'Go for Launch', 'go'],
    ['TBC', 'To Be Confirmed', 'tbc'],
    ['TBD', 'To Be Determined', 'tbd'],
    ['Hold', 'On Hold', 'hold'],
    ['In Flight', 'Launch in Flight', 'in_flight'],
    ['Success', 'Launch Successful', 'success'],
    ['Failure', 'Launch Failure', 'failure'],
    ['Partial Failure', 'Launch was a Partial Failure', 'partial_failure'],
    [undefined, undefined, 'tbd'],
  ])('%s / %s -> %s', (abbrev, name, expected) => {
    expect(classifyStatus(abbrev, name)).toBe(expected);
  });
});

describe('destinationOf', () => {
  it('recognises the ISS from the program list', () => {
    expect(destinationOf([{ name: 'International Space Station' }], 'Low Earth Orbit')).toEqual({
      destination: 'International Space Station',
      toIss: true,
    });
  });

  it('recognises Tiangong, and otherwise falls back to the orbit name', () => {
    expect(destinationOf([{ name: 'Tiangong Space Station' }], 'LEO').destination).toBe('Tiangong');
    expect(destinationOf([], 'Polar Orbit')).toEqual({ destination: 'Polar Orbit', toIss: false });
    expect(destinationOf([], 'Unknown')).toEqual({ destination: null, toIss: false });
    expect(destinationOf(undefined, undefined)).toEqual({ destination: null, toIss: false });
  });
});

describe('normalizeLaunch', () => {
  it('maps the fields the panel needs', () => {
    expect(normalizeLaunch(raw())).toEqual({
      id: 'abc-123',
      name: 'Dragon CRS-2 SpX-35',
      rocket: 'Falcon 9 Block 5',
      provider: 'SpaceX',
      net: new Date(NOW + 5 * HOUR).toISOString(),
      status: 'go',
      padName: 'Space Launch Complex 40',
      locationName: 'Cape Canaveral SFS, FL, USA',
      latitude: 28.56194122,
      longitude: -80.57735736,
      orbit: 'Low Earth Orbit',
      missionType: 'Resupply',
      missionDescription: null,
      destination: 'International Space Station',
      toIss: true,
      webcastUrl: null,
    });
  });

  it('falls back to the name parts when mission/rocket details are missing', () => {
    const l = normalizeLaunch(raw({ rocket: undefined, mission: undefined, program: undefined }))!;
    expect(l.rocket).toBe('Falcon 9 Block 5');
    expect(l.name).toBe('Dragon CRS-2 SpX-35');
    expect(l.destination).toBeNull();
  });

  it('keeps only https webcast links', () => {
    const l = normalizeLaunch(
      raw({ vid_urls: [{ url: 'javascript:alert(1)' }, { url: 'http://insecure.test/x' }, { url: 'https://youtu.be/x' }] }),
    )!;
    expect(l.webcastUrl).toBe('https://youtu.be/x');
  });

  it('nulls coordinates it cannot parse and rejects unusable launches', () => {
    expect(normalizeLaunch(raw({ pad: { latitude: '', longitude: 'x' } }))).toMatchObject({
      latitude: null,
      longitude: null,
    });
    expect(normalizeLaunch(raw({ net: 'soon' }))).toBeNull();
    expect(normalizeLaunch(raw({ id: undefined }))).toBeNull();
    expect(normalizeLaunch(null)).toBeNull();
  });
});

describe('normalizeLaunches', () => {
  it('sorts soonest first, drops launches that finished long ago, and caps the list', () => {
    const list = {
      results: [
        raw({ id: 'late', net: new Date(NOW + 9 * HOUR).toISOString() }),
        raw({ id: 'old', status: { abbrev: 'Success', name: 'Launch Successful' }, net: new Date(NOW - RECENT_MS - HOUR).toISOString() }),
        raw({ id: 'just', status: { abbrev: 'Success', name: 'Launch Successful' }, net: new Date(NOW - HOUR).toISOString() }),
        raw({ id: 'soon', net: new Date(NOW + HOUR).toISOString() }),
        { not: 'a launch' },
      ],
    };
    expect(normalizeLaunches(list, NOW).map((l: { id: string }) => l.id)).toEqual(['just', 'soon', 'late']);

    const many = { results: Array.from({ length: 30 }, (_, i) => raw({ id: `l${i}`, net: new Date(NOW + (i + 1) * HOUR).toISOString() })) };
    expect(normalizeLaunches(many, NOW)).toHaveLength(MAX_LAUNCHES);
  });

  it('tolerates a malformed response', () => {
    expect(normalizeLaunches(null, NOW)).toEqual([]);
    expect(normalizeLaunches({ results: 'x' }, NOW)).toEqual([]);
  });
});

describe('pickDetailTarget', () => {
  const l = (status: string, offsetH: number) => ({ id: status + offsetH, status, net: new Date(NOW + offsetH * HOUR).toISOString() });

  it('prefers a launch in flight or within two hours; ignores far-off or finished ones', () => {
    expect(pickDetailTarget([l('go', 30), l('in_flight', 0)], NOW)?.status).toBe('in_flight');
    expect(pickDetailTarget([l('go', 1.5)], NOW)?.status).toBe('go');
    expect(pickDetailTarget([l('go', 30), l('success', -1)], NOW)).toBeNull();
  });
});

describe('buildPayload', () => {
  it('adds the webcast from a single detailed request', async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({ results: [raw({ status: { abbrev: 'In Flight', name: 'Launch in Flight' }, net: new Date(NOW - 60_000).toISOString() })] })
      .mockResolvedValueOnce(raw({ vid_urls: [{ url: 'https://www.youtube.com/watch?v=x' }] }));
    const payload = await buildPayload(NOW, fetchJson);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchJson.mock.calls[1][0]).toContain('/launches/abc-123/?mode=detailed');
    expect(payload.launches[0].webcastUrl).toBe('https://www.youtube.com/watch?v=x');
    expect(payload.source).toMatch(/Space Devs/);
  });

  it('still answers when the detailed request fails, and makes no detail request when none is needed', async () => {
    const failing = vi
      .fn()
      .mockResolvedValueOnce({ results: [raw()] })
      .mockRejectedValueOnce(new Error('429'));
    const payload = await buildPayload(NOW, failing);
    expect(payload.launches).toHaveLength(1);
    expect(payload.launches[0].webcastUrl).toBeNull();

    const far = vi.fn().mockResolvedValue({ results: [raw({ net: new Date(NOW + 48 * HOUR).toISOString() })] });
    await buildPayload(NOW, far);
    expect(far).toHaveBeenCalledTimes(1);
  });
});

describe('handler', () => {
  beforeEach(() => resetMemoryCache());

  function fakeResponse() {
    const headers: Record<string, string> = {};
    return {
      statusCode: 0,
      headers,
      body: '',
      setHeader(k: string, v: string) { headers[k] = v; },
      end(body: string) { this.body = body; },
    };
  }

  it('caches a good response at the CDN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [raw({ net: new Date(Date.now() + 48 * HOUR).toISOString() })] }) }));
    const res = fakeResponse();
    await handler({}, res);
    vi.unstubAllGlobals();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toMatch(/s-maxage=900/);
    expect(JSON.parse(res.body).launches).toHaveLength(1);
  });

  it('answers 502 and never caches an upstream failure (so the CDN keeps its last good copy)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fakeResponse();
    await handler({}, res);
    vi.unstubAllGlobals();
    spy.mockRestore();
    expect(res.statusCode).toBe(502);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual({ error: 'launch data unavailable' });
  });

  it('reuses a recent good result instead of calling the API again', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [raw({ net: new Date(Date.now() + 48 * HOUR).toISOString() })] }) });
    vi.stubGlobal('fetch', fetchMock);
    await handler({}, fakeResponse());
    const callsAfterFirst = fetchMock.mock.calls.length;
    const res = fakeResponse();
    await handler({}, res);
    vi.unstubAllGlobals();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
    expect(res.statusCode).toBe(200);
  });

  it('serves the last good data when the API is throttled later (instead of an error)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [raw()] }) }));
    await handler({}, fakeResponse());

    vi.setSystemTime(NOW + 30 * 60_000); // past the in-memory TTL, so it must refresh
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = fakeResponse();
    await handler({}, res);
    spy.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=60');
    expect(JSON.parse(res.body).launches).toHaveLength(1);
  });
});

describe('missionDescriptionOf', () => {
  it('passes a normal description through, trimmed, with paragraph breaks kept', () => {
    expect(missionDescriptionOf('  A batch of 27 satellites.\r\n\r\n\r\nSecond paragraph.  ')).toBe('A batch of 27 satellites.\n\nSecond paragraph.');
  });
  it('is null for missing or blank text', () => {
    expect(missionDescriptionOf(undefined)).toBeNull();
    expect(missionDescriptionOf('   ')).toBeNull();
    expect(missionDescriptionOf(42)).toBeNull();
  });
  it('cuts very long text at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(600);
    const out = missionDescriptionOf(long)!;
    expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS + 1);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });
  it('is mapped by normalizeLaunch', () => {
    const l = normalizeLaunch({
      id: 'x', name: 'Falcon 9 Block 5 | Starlink Group 15-15', net: '2026-10-21T12:00:00Z',
      status: { abbrev: 'Go' }, mission: { name: 'Starlink Group 15-15', description: 'A batch of 27 satellites for Starlink.' },
    })!;
    expect(l.missionDescription).toBe('A batch of 27 satellites for Starlink.');
  });
});
