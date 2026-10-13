/**
 * GET /api/launches - upcoming launches for the "Upcoming Launches" panel.
 *
 * Runs server-side so visitors only ever talk to this site (no third-party
 * requests from the browser) and so the upstream free tier (15 requests/hour
 * per IP) is shared across all visitors via CDN caching. If the upstream call
 * fails the response is not cached, so the CDN keeps serving its last good copy
 * (stale-while-revalidate) instead of replacing it with an error.
 */
import {
  LL2_LIST_URL,
  detailUrl,
  normalizeLaunch,
  normalizeLaunches,
  pickDetailTarget,
} from './_launches.mjs';

const TIMEOUT_MS = 8_000;
const HEADERS = { Accept: 'application/json', 'User-Agent': 'orbital-congestion-simulator' };
/** Reuse a good result this long inside one server instance (also keeps tests and local runs gentle on the API). */
const MEMORY_TTL_MS = 10 * 60_000;

let memory = null; // { at: number, payload }

/** For tests. */
export function resetMemoryCache() {
  memory = null;
}

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  return res.json();
}

export async function buildPayload(now = Date.now(), fetchJson = getJson) {
  const launches = normalizeLaunches(await fetchJson(LL2_LIST_URL), now);

  // The list response has no webcast links; one detailed request covers the
  // launch people are most likely to be watching. Failure here is non-fatal.
  const target = pickDetailTarget(launches, now);
  if (target) {
    try {
      const detailed = normalizeLaunch(await fetchJson(detailUrl(target.id)));
      if (detailed?.webcastUrl) target.webcastUrl = detailed.webcastUrl;
    } catch {
      // keep the launch without a webcast link
    }
  }

  return {
    source: 'The Space Devs (Launch Library 2)',
    fetchedAt: new Date(now).toISOString(),
    launches,
  };
}

function send(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(body));
}

export default async function handler(_req, res) {
  const now = Date.now();
  if (memory && now - memory.at < MEMORY_TTL_MS) {
    // 15 min at the CDN: stays well inside the upstream rate limit even with several regions.
    return send(res, 200, memory.payload, 'public, s-maxage=900, stale-while-revalidate=3600');
  }
  try {
    const payload = await buildPayload(now);
    memory = { at: now, payload };
    return send(res, 200, payload, 'public, s-maxage=900, stale-while-revalidate=3600');
  } catch (err) {
    console.error('launches: upstream failed:', err?.message ?? err);
    if (memory) {
      // Throttled or down: the last good data beats an error. Short CDN life so we retry soon.
      return send(res, 200, memory.payload, 'public, s-maxage=60');
    }
    // Never cache an error, so the CDN keeps its last good copy.
    return send(res, 502, { error: 'launch data unavailable' }, 'no-store');
  }
}
