const AMSAT_ACTIVE_FREQUENCIES_URL =
  'https://raw.githubusercontent.com/palewire/amateur-satellite-database/main/data/amsat-active-frequencies.json';

/** These have richer, manually verified entries in src/data/radioFrequencies.ts. */
export const CURATED_RADIO_NORAD_IDS = new Set([25544, 27607, 43017, 67687, 69920]);

function clean(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed !== '-' ? trimmed : undefined;
}

function sourceUrl(row) {
  const satnogsId = clean(row.satnogs_id);
  return satnogsId
    ? `https://db.satnogs.org/satellite/${encodeURIComponent(satnogsId)}/`
    : 'https://satdb.amsat.org/';
}

function rowToFrequencies(row) {
  const uplinkMHz = clean(row.uplink);
  const downlinkMHz = clean(row.downlink);
  const beaconMHz = clean(row.beacon);
  const mode = clean(row.mode) ?? 'See current satellite status';
  const note = clean(row.callsign) ? `Callsign: ${clean(row.callsign)}` : undefined;
  const common = { mode, ...(note ? { note } : {}), sourceUrl: sourceUrl(row) };
  const frequencies = [];

  if (uplinkMHz || downlinkMHz) {
    frequencies.push({
      service: uplinkMHz ? 'Amateur radio' : 'Downlink',
      ...(uplinkMHz ? { uplinkMHz } : {}),
      ...(downlinkMHz ? { downlinkMHz } : {}),
      ...common,
    });
  }

  if (beaconMHz && beaconMHz !== downlinkMHz) {
    frequencies.push({
      service: 'Beacon',
      listenMHz: beaconMHz,
      ...common,
    });
  }

  return frequencies;
}

export function buildRadioFrequencyMap(rows) {
  const byNorad = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const noradId = Number.parseInt(String(row?.norad_id ?? ''), 10);
    if (!Number.isInteger(noradId) || CURATED_RADIO_NORAD_IDS.has(noradId)) continue;

    const frequencies = rowToFrequencies(row);
    if (frequencies.length === 0) continue;

    const existing = byNorad.get(noradId) ?? [];
    for (const frequency of frequencies) {
      const signature = JSON.stringify(frequency);
      if (!existing.some((candidate) => JSON.stringify(candidate) === signature)) {
        existing.push(frequency);
      }
    }
    byNorad.set(noradId, existing);
  }

  return byNorad;
}

export function applyRadioFrequencies(seen, rows) {
  const byNorad = buildRadioFrequencyMap(rows);
  let matched = 0;
  let channels = 0;

  for (const [noradId, frequencies] of byNorad) {
    const object = seen.get(noradId);
    if (!object) continue;
    object.radioFrequencies = frequencies;
    matched++;
    channels += frequencies.length;
  }

  return { catalogSatellites: byNorad.size, matched, channels };
}

export async function fetchAmsatActiveFrequencies(fetchImpl = fetch, options = {}) {
  const response = await fetchImpl(AMSAT_ACTIVE_FREQUENCIES_URL, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for AMSAT frequency catalog`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('AMSAT frequency catalog is not an array');
  return rows;
}

