/**
 * Upcoming launches, as served by our own /api/launches function.
 *
 * The browser only ever talks to this site; the function fetches Launch Library 2
 * (The Space Devs) server-side. Everything coming back is re-validated here so a
 * malformed response can never reach the UI.
 */

export type LaunchStatus =
  | 'go'
  | 'tbc'
  | 'tbd'
  | 'hold'
  | 'in_flight'
  | 'success'
  | 'failure'
  | 'partial_failure';

export interface Launch {
  id: string;
  /** Mission name, e.g. "Dragon CRS-2 SpX-35". */
  name: string;
  /** Launch vehicle, e.g. "Falcon 9 Block 5". */
  rocket: string;
  provider: string | null;
  /** "No earlier than" time (ISO). Moves when the launch slips. */
  net: string;
  status: LaunchStatus;
  padName: string | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  orbit: string | null;
  missionType: string | null;
  /** What the mission is for, as published by The Space Devs (English, plain text). */
  missionDescription: string | null;
  /** Where the mission is headed, e.g. "International Space Station" or an orbit name. */
  destination: string | null;
  toIss: boolean;
  /** https URL of the official webcast, when known. */
  webcastUrl: string | null;
}

/** The ISS in the catalog; used by the "Show ISS" action. */
export const ISS_NORAD_ID = 25544;

export class LaunchesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchesUnavailableError';
  }
}

const STATUSES: ReadonlySet<string> = new Set([
  'go',
  'tbc',
  'tbd',
  'hold',
  'in_flight',
  'success',
  'failure',
  'partial_failure',
]);

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function coordOrNull(value: unknown, limit: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit
    ? value
    : null;
}

function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function parseLaunch(raw: unknown): Launch | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = strOrNull(r.id);
  const name = strOrNull(r.name);
  const rocket = strOrNull(r.rocket);
  const status = typeof r.status === 'string' && STATUSES.has(r.status) ? (r.status as LaunchStatus) : null;
  if (!id || !name || !rocket || !status) return null;
  const netMs = typeof r.net === 'string' ? Date.parse(r.net) : NaN;
  if (!Number.isFinite(netMs)) return null;

  return {
    id,
    name,
    rocket,
    provider: strOrNull(r.provider),
    net: new Date(netMs).toISOString(),
    status,
    padName: strOrNull(r.padName),
    locationName: strOrNull(r.locationName),
    latitude: coordOrNull(r.latitude, 90),
    longitude: coordOrNull(r.longitude, 180),
    orbit: strOrNull(r.orbit),
    missionType: strOrNull(r.missionType),
    missionDescription: strOrNull(r.missionDescription),
    destination: strOrNull(r.destination),
    toIss: r.toIss === true,
    webcastUrl: httpsUrlOrNull(r.webcastUrl),
  };
}

/** Validates the function's JSON; unusable launches are dropped, a bad envelope throws. */
let latestLaunches: readonly Launch[] = [];

/** Keep the most recent launch list so other panels can show a launch's details. */
export function rememberLaunches(launches: readonly Launch[]): void {
  latestLaunches = launches;
}

/** The launch with this id from the most recent list, or null. */
export function findLaunch(id: string | null | undefined): Launch | null {
  if (!id) return null;
  return latestLaunches.find((launch) => launch.id === id) ?? null;
}

export function parseLaunchesResponse(json: unknown): Launch[] {
  if (typeof json !== 'object' || json === null || !Array.isArray((json as { launches?: unknown }).launches)) {
    throw new LaunchesUnavailableError('Launch data has an unexpected shape.');
  }
  return ((json as { launches: unknown[] }).launches)
    .map(parseLaunch)
    .filter((launch): launch is Launch => launch !== null);
}

export async function fetchLaunches(fetchImpl: typeof fetch = fetch): Promise<Launch[]> {
  let response: Response;
  try {
    response = await fetchImpl('/api/launches');
  } catch (err) {
    throw new LaunchesUnavailableError(err instanceof Error ? err.message : 'request failed');
  }
  if (!response.ok) throw new LaunchesUnavailableError(`HTTP ${response.status}`);
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new LaunchesUnavailableError('Launch data is not valid JSON.');
  }
  return parseLaunchesResponse(json);
}

export function isFinished(status: LaunchStatus): boolean {
  return status === 'success' || status === 'failure' || status === 'partial_failure';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Unit templates for countdowns: "{n}" is replaced by the number. */
export interface DurationUnits {
  d: string;
  h: string;
  m: string;
  s: string;
}

export const EN_DURATION_UNITS: DurationUnits = { d: '{n}d', h: '{n}h', m: '{n}m', s: '{n}s' };

const unit = (template: string, n: number | string): string => template.replace('{n}', String(n));

/** "T− 22h 41m" before liftoff, "T+ 04:12" after. `msUntil` is net minus now. */
export function formatCountdown(msUntil: number, u: DurationUnits = EN_DURATION_UNITS): string {
  if (msUntil > 0) {
    const total = Math.ceil(msUntil / 1000) * 1000;
    const days = Math.floor(total / (24 * HOUR));
    const hours = Math.floor((total % (24 * HOUR)) / HOUR);
    const minutes = Math.floor((total % HOUR) / MINUTE);
    const seconds = Math.floor((total % MINUTE) / 1000);
    if (days >= 2) return `T− ${unit(u.d, days)} ${unit(u.h, hours)}`;
    if (total >= HOUR) return `T− ${unit(u.h, Math.floor(total / HOUR))} ${unit(u.m, pad2(minutes))}`;
    return `T− ${unit(u.m, minutes)} ${unit(u.s, pad2(seconds))}`;
  }
  const since = Math.floor(-msUntil / 1000) * 1000;
  const hours = Math.floor(since / HOUR);
  const minutes = Math.floor((since % HOUR) / MINUTE);
  const seconds = Math.floor((since % MINUTE) / 1000);
  return hours >= 1 ? `T+ ${unit(u.h, hours)} ${unit(u.m, pad2(minutes))}` : `T+ ${pad2(minutes)}:${pad2(seconds)}`;
}

/** Poll quickly around a launch, slowly otherwise (the server caches either way). */
export function launchPollIntervalMs(launches: readonly Launch[], nowMs: number): number {
  const busy = launches.some(
    (l) => !isFinished(l.status) && (l.status === 'in_flight' || Math.abs(Date.parse(l.net) - nowMs) <= HOUR),
  );
  return busy ? 60_000 : 5 * 60_000;
}
