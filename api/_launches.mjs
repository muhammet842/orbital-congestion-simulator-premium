/**
 * Launch Library 2 (The Space Devs) -> the small, validated shape the app uses.
 *
 * Kept free of I/O so it can be unit-tested; api/launches.js does the fetching.
 * (Files starting with "_" in api/ are not exposed as routes by Vercel.)
 *
 * The free API allows 15 requests/hour per IP, so the handler asks for at most
 * two upstream resources per refresh and relies on CDN caching.
 */

export const LL2_LIST_URL =
  'https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=15&mode=normal';

export function detailUrl(id) {
  return `https://ll.thespacedevs.com/2.3.0/launches/${encodeURIComponent(id)}/?mode=detailed`;
}

/** How long a finished launch stays listed. */
export const RECENT_MS = 3 * 60 * 60 * 1000;
/** A launch this close (or in flight) gets a detailed request for its webcast. */
export const DETAIL_WINDOW_MS = 2 * 60 * 60 * 1000;
export const MAX_LAUNCHES = 8;

/** Maps LL2's status (abbrev + name vary) to a small fixed set. */
export function classifyStatus(abbrev, name) {
  const s = `${abbrev ?? ''} ${name ?? ''}`.toLowerCase();
  if (/partial/.test(s)) return 'partial_failure';
  if (/fail/.test(s)) return 'failure';
  if (/success/.test(s)) return 'success';
  if (/flight/.test(s)) return 'in_flight';
  if (/hold/.test(s)) return 'hold';
  if (/confirm|tbc/.test(s)) return 'tbc';
  if (/determin|tbd/.test(s)) return 'tbd';
  if (/\bgo\b/.test(s)) return 'go';
  return 'tbd';
}

function finiteOrNull(value) {
  const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}

function httpsUrlOrNull(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Where the mission is headed, as display text, plus whether it is the ISS. */
export function destinationOf(programs, orbitName) {
  const names = (Array.isArray(programs) ? programs : []).map((p) => String(p?.name ?? ''));
  if (names.some((n) => /international space station/i.test(n))) {
    return { destination: 'International Space Station', toIss: true };
  }
  if (names.some((n) => /tiangong|chinese space station/i.test(n))) {
    return { destination: 'Tiangong', toIss: false };
  }
  const orbit = typeof orbitName === 'string' ? orbitName.trim() : '';
  return { destination: orbit && !/unknown/i.test(orbit) ? orbit : null, toIss: false };
}

/** Normalises one LL2 launch object; returns null if it is unusable. */
export function normalizeLaunch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  const netMs = Date.parse(raw.net);
  if (!id || !name || !Number.isFinite(netMs)) return null;

  const [rocketFromName, ...missionFromName] = name.split('|').map((part) => part.trim());
  const pad = raw.pad ?? {};
  const { destination, toIss } = destinationOf(raw.program, raw.mission?.orbit?.name);
  const webcastUrl =
    (raw.vid_urls ?? raw.mission?.vid_urls ?? [])
      .map((v) => httpsUrlOrNull(v?.url ?? v))
      .find(Boolean) ?? null;

  return {
    id,
    name: raw.mission?.name || missionFromName.join(' | ') || name,
    rocket: raw.rocket?.configuration?.full_name || rocketFromName || name,
    provider: raw.launch_service_provider?.name ?? null,
    net: new Date(netMs).toISOString(),
    status: classifyStatus(raw.status?.abbrev, raw.status?.name),
    padName: pad.name ?? null,
    locationName: pad.location?.name ?? null,
    latitude: finiteOrNull(pad.latitude),
    longitude: finiteOrNull(pad.longitude),
    orbit: raw.mission?.orbit?.name ?? null,
    missionType: raw.mission?.type ?? null,
    destination,
    toIss,
    webcastUrl,
  };
}

/** Upcoming, in-flight and just-finished launches, soonest first. */
export function normalizeLaunches(rawList, nowMs = Date.now()) {
  const results = Array.isArray(rawList?.results) ? rawList.results : [];
  return results
    .map(normalizeLaunch)
    .filter(Boolean)
    .filter((l) => {
      const finished =
        l.status === 'success' || l.status === 'failure' || l.status === 'partial_failure';
      return !finished || nowMs - Date.parse(l.net) <= RECENT_MS;
    })
    .sort((a, b) => Date.parse(a.net) - Date.parse(b.net))
    .slice(0, MAX_LAUNCHES);
}

/** The launch worth a detailed (webcast) request, or null. */
export function pickDetailTarget(launches, nowMs = Date.now()) {
  return (
    launches.find(
      (l) =>
        l.status === 'in_flight' ||
        (l.status !== 'success' && Math.abs(Date.parse(l.net) - nowMs) <= DETAIL_WINDOW_MS),
    ) ?? null
  );
}
