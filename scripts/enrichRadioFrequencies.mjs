const AMSAT_ACTIVE_FREQUENCIES_URL =
  'https://raw.githubusercontent.com/palewire/amateur-satellite-database/main/data/amsat-active-frequencies.json';
const SATNOGS_TRANSMITTERS_URL = 'https://db.satnogs.org/api/transmitters/?format=json';
const GALILEO_OS_SOURCE =
  'https://www.gsc-europa.eu/sites/default/files/sites/all/files/Galileo_OS_SIS_ICD_v2.1.pdf';
const GALILEO_UPLINK_SOURCE =
  'https://www.itu.int/dms_pubrec/itu-r/rec/m/R-REC-M.1906-1-201509-I!!PDF-E.pdf';
const GALILEO_SAR_SOURCE =
  'https://www.gsc-europa.eu/system-service-status/sar-information/sargalileo-satellites-information/sar-payload-characteristics';
const GPS_SOURCE =
  'https://www.gsc-europa.eu/sites/default/files/sites/all/files/Galileo-HAS-SDD_v1.0.pdf';
const BEIDOU_SOURCE =
  'https://www.beidou.gov.cn/zt/xwfbh/bdshjbxtjc/gdxw4/201812/P020181227418920163239.pdf';
const STARLINK_SOURCE = 'https://docs.fcc.gov/public/attachments/FCC-22-91A1.pdf';
const ONEWEB_SOURCE = 'https://docs.fcc.gov/public/attachments/FCC-17-77A1.pdf';

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

function formatMHz(lowHz, highHz) {
  const low = Number(lowHz);
  const high = Number(highHz);
  if (!Number.isFinite(low) || low <= 0) return undefined;

  const render = (hz) => (hz / 1_000_000)
    .toFixed(6)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
  if (!Number.isFinite(high) || high <= 0 || high === low) return render(low);
  return `${render(low)}–${render(high)}`;
}

function satnogsRowToFrequency(row) {
  if (
    row?.status !== 'active' ||
    row?.alive !== true ||
    row?.unconfirmed === true ||
    row?.frequency_violation === true
  ) return undefined;

  const uplinkMHz = formatMHz(row.uplink_low, row.uplink_high);
  const downlinkMHz = formatMHz(row.downlink_low, row.downlink_high);
  if (!uplinkMHz && !downlinkMHz) return undefined;

  const modes = [clean(row.uplink_mode), clean(row.mode)]
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const baud = Number(row.baud);
  const mode = `${modes.join(' / ') || 'Unknown'}${Number.isFinite(baud) && baud > 0 ? ` · ${baud} baud` : ''}`;
  const description = clean(row.description);
  const service = description ?? (clean(row.service) !== 'Unknown' ? clean(row.service) : undefined) ?? 'Radio link';

  return {
    service,
    ...(uplinkMHz ? { uplinkMHz } : {}),
    ...(downlinkMHz ? { downlinkMHz } : {}),
    mode,
    sourceUrl: `https://db.satnogs.org/satellite/${Number(row.norad_cat_id)}/`,
  };
}

export function buildSatnogsRadioFrequencyMap(rows) {
  const byNorad = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const noradId = Number(row?.norad_cat_id);
    if (!Number.isInteger(noradId) || CURATED_RADIO_NORAD_IDS.has(noradId)) continue;
    const frequency = satnogsRowToFrequency(row);
    if (!frequency) continue;

    const existing = byNorad.get(noradId) ?? [];
    const signature = JSON.stringify(frequency);
    if (!existing.some((candidate) => JSON.stringify(candidate) === signature)) {
      existing.push(frequency);
    }
    byNorad.set(noradId, existing);
  }
  return byNorad;
}

export function applySatnogsRadioFrequencies(seen, rows) {
  const byNorad = buildSatnogsRadioFrequencyMap(rows);
  let matched = 0;
  let channels = 0;
  for (const [noradId, frequencies] of byNorad) {
    const object = seen.get(noradId);
    if (!object) continue;
    // Structured transmitter rows are more precise than AMSAT's combined
    // slash-delimited summary, so replace that summary when available.
    object.radioFrequencies = frequencies;
    matched++;
    channels += frequencies.length;
  }
  return { catalogSatellites: byNorad.size, matched, channels };
}

const GALILEO_FREQUENCIES = [
  {
    service: 'Galileo mission feeder uplink',
    uplinkMHz: '5000–5010',
    mode: 'C-band RNSS feeder link',
    note: 'Ground mission segment only; not intended for user access.',
    sourceUrl: GALILEO_UPLINK_SOURCE,
  },
  { service: 'Galileo E1 navigation', downlinkMHz: '1575.420', mode: 'CBOC(6,1,1/11)' },
  { service: 'Galileo E5 navigation', downlinkMHz: '1191.795', mode: 'AltBOC(15,10)' },
  { service: 'Galileo E5a navigation', downlinkMHz: '1176.450', mode: 'BPSK(10)' },
  { service: 'Galileo E5b navigation', downlinkMHz: '1207.140', mode: 'BPSK(10)' },
  { service: 'Galileo E6 navigation', downlinkMHz: '1278.750', mode: 'BPSK(5)' },
].map((frequency) => ({
  ...frequency,
  sourceUrl: frequency.sourceUrl ?? GALILEO_OS_SOURCE,
}));

const GALILEO_SAR_FREQUENCY = {
  service: 'Galileo SAR repeater',
  uplinkMHz: '406.0–406.1',
  downlinkMHz: '1544.0–1544.2',
  mode: 'Cospas-Sarsat transparent repeater',
  sourceUrl: GALILEO_SAR_SOURCE,
};

const GPS_FREQUENCIES = [
  { service: 'GPS L1 navigation', downlinkMHz: '1575.420', mode: 'BPSK(1)' },
  { service: 'GPS L2 navigation', downlinkMHz: '1227.600', mode: 'BPSK(1)' },
  { service: 'GPS L5 navigation', downlinkMHz: '1176.450', mode: 'BPSK(10)' },
].map((frequency) => ({ ...frequency, sourceUrl: GPS_SOURCE }));

const BEIDOU_FREQUENCIES = [
  { service: 'BeiDou B1I navigation', downlinkMHz: '1561.098', mode: 'BPSK(2)' },
  { service: 'BeiDou B1C navigation', downlinkMHz: '1575.420', mode: 'BOC(1,1) / QMBOC' },
  { service: 'BeiDou B2a navigation', downlinkMHz: '1176.450', mode: 'BPSK(10)' },
  { service: 'BeiDou B3I navigation', downlinkMHz: '1268.520', mode: 'BPSK(10)' },
].map((frequency) => ({ ...frequency, sourceUrl: BEIDOU_SOURCE }));

const STARLINK_FREQUENCIES = [{
  service: 'Starlink user broadband',
  uplinkMHz: '14000–14500',
  downlinkMHz: '10700–12700',
  mode: 'Ku-band broadband',
  note: 'Licensed operating range; individual beams use portions of the band.',
  sourceUrl: STARLINK_SOURCE,
}];

const ONEWEB_FREQUENCIES = [
  {
    service: 'OneWeb user broadband',
    uplinkMHz: '14000–14500',
    downlinkMHz: '10700–12700',
    mode: 'Ku-band broadband',
    note: 'Licensed operating range; individual beams use portions of the band.',
    sourceUrl: ONEWEB_SOURCE,
  },
  {
    service: 'OneWeb gateway link',
    uplinkMHz: '27500–29100 / 29500–30000',
    downlinkMHz: '17800–18600 / 18800–19300',
    mode: 'Ka-band gateway',
    sourceUrl: ONEWEB_SOURCE,
  },
];

const FAMILY_PROFILES = [
  { pattern: /^GPS\b/i, frequencies: GPS_FREQUENCIES },
  { pattern: /^BEIDOU\b/i, frequencies: BEIDOU_FREQUENCIES },
  { pattern: /^STARLINK-/i, frequencies: STARLINK_FREQUENCIES },
  { pattern: /^ONEWEB-/i, frequencies: ONEWEB_FREQUENCIES },
];

export function applyKnownConstellationFrequencies(seen) {
  let matched = 0;
  let channels = 0;
  for (const object of seen.values()) {
    if (/^(?:GSAT\d|GALILEO\b)/i.test(object.name)) {
      const frequencies = GALILEO_FREQUENCIES.map((frequency) => ({ ...frequency }));
      // The first two IOV spacecraft do not carry the SARR payload.
      if (object.noradId !== 37846 && object.noradId !== 37847) {
        frequencies.push({ ...GALILEO_SAR_FREQUENCY });
      }
      object.radioFrequencies = frequencies;
      matched++;
      channels += frequencies.length;
      continue;
    }

    const profile = FAMILY_PROFILES.find(({ pattern }) => pattern.test(object.name));
    if (profile) {
      object.radioFrequencies = profile.frequencies.map((frequency) => ({ ...frequency }));
      matched++;
      channels += profile.frequencies.length;
    }
  }
  return { matched, channels };
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

export async function fetchSatnogsTransmitters(fetchImpl = fetch, options = {}) {
  const response = await fetchImpl(SATNOGS_TRANSMITTERS_URL, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} for SatNOGS transmitter catalog`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('SatNOGS transmitter catalog is not an array');
  return rows;
}

