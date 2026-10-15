import { describe, expect, it, vi } from 'vitest';
import {
  LaunchesUnavailableError,
  fetchLaunches,
  formatCountdown,
  isFinished,
  launchPollIntervalMs,
  parseLaunchesResponse,
  type Launch,
} from './launches';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function launch(overrides: Partial<Launch> = {}): Launch {
  return {
    id: 'l1',
    name: 'Dragon CRS-2 SpX-35',
    rocket: 'Falcon 9 Block 5',
    provider: 'SpaceX',
    net: new Date(NOW + 5 * HOUR).toISOString(),
    status: 'go',
    padName: 'SLC-40',
    locationName: 'Cape Canaveral SFS, FL, USA',
    latitude: 28.56,
    longitude: -80.58,
    orbit: 'Low Earth Orbit',
    missionType: 'Resupply',
    destination: 'International Space Station',
    toIss: true,
    webcastUrl: null,
    ...overrides,
  };
}

describe('parseLaunchesResponse', () => {
  it('accepts a well-formed response', () => {
    const [l] = parseLaunchesResponse({ launches: [launch()] });
    expect(l).toMatchObject({ id: 'l1', status: 'go', toIss: true, latitude: 28.56 });
  });

  it('drops unusable launches but keeps the rest', () => {
    const list = parseLaunchesResponse({
      launches: [launch(), { ...launch(), id: 'bad-status', status: 'exploded' }, { ...launch(), id: 'bad-net', net: 'soon' }, 'junk', null],
    });
    expect(list.map((l) => l.id)).toEqual(['l1']);
  });

  it('sanitises coordinates and webcast links', () => {
    const [l] = parseLaunchesResponse({
      launches: [{ ...launch(), latitude: 123, longitude: 'x', webcastUrl: 'javascript:alert(1)' }],
    });
    expect(l.latitude).toBeNull();
    expect(l.longitude).toBeNull();
    expect(l.webcastUrl).toBeNull();
    expect(parseLaunchesResponse({ launches: [{ ...launch(), webcastUrl: 'https://youtu.be/x' }] })[0].webcastUrl).toBe('https://youtu.be/x');
  });

  it('throws on a bad envelope', () => {
    expect(() => parseLaunchesResponse(null)).toThrow(LaunchesUnavailableError);
    expect(() => parseLaunchesResponse({ launches: 'x' })).toThrow(LaunchesUnavailableError);
    expect(() => parseLaunchesResponse({ error: 'launch data unavailable' })).toThrow(LaunchesUnavailableError);
  });
});

describe('fetchLaunches', () => {
  it('returns parsed launches from /api/launches', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ launches: [launch()] }) });
    expect(await fetchLaunches(fetchImpl as unknown as typeof fetch)).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/launches');
  });

  it('reports every failure as LaunchesUnavailableError', async () => {
    const http = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    await expect(fetchLaunches(http as unknown as typeof fetch)).rejects.toBeInstanceOf(LaunchesUnavailableError);
    const network = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchLaunches(network as unknown as typeof fetch)).rejects.toBeInstanceOf(LaunchesUnavailableError);
    const notJson = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('x'); } });
    await expect(fetchLaunches(notJson as unknown as typeof fetch)).rejects.toBeInstanceOf(LaunchesUnavailableError);
  });
});

describe('formatCountdown', () => {
  it.each([
    [3 * 24 * HOUR + 5 * HOUR, 'T− 3d 5h'],
    [22 * HOUR + 41 * MIN, 'T− 22h 41m'],
    [12 * MIN + 8_000, 'T− 12m 08s'],
    [1_000, 'T− 0m 01s'],
    [-4 * MIN - 12_000, 'T+ 04:12'],
    [-(HOUR + 2 * MIN), 'T+ 1h 02m'],
    [0, 'T+ 00:00'],
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected);
  });

  it('uses the unit templates it is given', () => {
    const tr = { d: '{n}g', h: '{n}sa', m: '{n}dk', s: '{n}sn' };
    expect(formatCountdown(3 * 24 * HOUR + 5 * HOUR, tr)).toBe('T− 3g 5sa');
    expect(formatCountdown(12 * MIN + 8_000, tr)).toBe('T− 12dk 08sn');
    expect(formatCountdown(-(HOUR + 2 * MIN), tr)).toBe('T+ 1sa 02dk');
  });
});

describe('launchPollIntervalMs', () => {
  it('polls every minute around a launch and every five minutes otherwise', () => {
    expect(launchPollIntervalMs([launch({ net: new Date(NOW + 30 * MIN).toISOString() })], NOW)).toBe(60_000);
    expect(launchPollIntervalMs([launch({ status: 'in_flight', net: new Date(NOW - 5 * MIN).toISOString() })], NOW)).toBe(60_000);
    expect(launchPollIntervalMs([launch({ net: new Date(NOW + 20 * HOUR).toISOString() })], NOW)).toBe(5 * 60_000);
    expect(launchPollIntervalMs([launch({ status: 'success', net: new Date(NOW - 10 * MIN).toISOString() })], NOW)).toBe(5 * 60_000);
    expect(launchPollIntervalMs([], NOW)).toBe(5 * 60_000);
  });
});

describe('isFinished', () => {
  it('is true only for outcomes', () => {
    expect(['success', 'failure', 'partial_failure'].every((s) => isFinished(s as Launch['status']))).toBe(true);
    expect(['go', 'tbc', 'tbd', 'hold', 'in_flight'].some((s) => isFinished(s as Launch['status']))).toBe(false);
  });
});
