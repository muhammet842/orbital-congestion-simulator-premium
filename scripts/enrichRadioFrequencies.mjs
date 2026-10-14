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

/**
 * ITU amateur-service allocations in MHz, the union over all three regions
 * (so AO-7's 432 MHz mode B uplink counts). A source may call a satellite
 * "amateur" while a given link sits elsewhere, e.g. a 401 MHz space-operation
 * downlink or a 2.2 GHz S-band telemetry link.
 */
const AMATEUR_BANDS_MHZ = [
  [1.8, 2], [3.5, 4], [7, 7.3], [10.1, 10.15], [14, 14.35], [18.068, 18.168],
  [21, 21.45], [24.89, 24.99], [28, 29.7], [50, 54], [144, 148], [219, 225],
  [420, 450], [902, 928], [1240, 1300], [2300, 2450], [3300, 3500], [5650, 5925],
  [10000, 10500], [24000, 24250], [47000, 47200], [76000, 81000],
  [122250, 123000], [134000, 141000], [241000, 250000],
];

/** true when every frequency the channel lists is in an amateur band, false
 *  when any is not, undefined when none can be parsed. */
export function isInAmateurBands(frequency) {
  const values = [frequency.uplinkMHz, frequency.downlinkMHz, frequency.listenMHz]
    .flatMap((value) => String(value ?? '').match(/\d+(?:\.\d+)?/g) ?? [])
    .map(Number);
  if (values.length === 0) return undefined;
  return values.every((mhz) => AMATEUR_BANDS_MHZ.some(([low, high]) => mhz >= low && mhz <= high));
}

/** Drops an amateur claim the band plan contradicts (leaves it unclassified). */
function checkAmateurClaim(frequency) {
  if (frequency.amateur !== true || isInAmateurBands(frequency) !== false) return frequency;
  const { amateur: _dropped, ...rest } = frequency;
  return rest;
}

/** One channel per frequency set and mode, whatever the sources call it. */
function channelKey(frequency) {
  return [frequency.uplinkMHz, frequency.downlinkMHz, frequency.listenMHz, frequency.mode].join('|');
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
  // The AMSAT active-frequency list only covers amateur satellites.
  const common = { mode, ...(note ? { note } : {}), sourceUrl: sourceUrl(row), amateur: true };
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

  return frequencies.map(checkAmateurClaim);
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
      const key = channelKey(frequency);
      if (!existing.some((candidate) => channelKey(candidate) === key)) existing.push(frequency);
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

/** SatNOGS `service` → amateur flag. "Unknown"/empty stays unclassified. */
function satnogsAmateurFlag(row) {
  const service = clean(row?.service);
  if (!service || service === 'Unknown') return undefined;
  return service === 'Amateur';
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
  // Some SatNOGS descriptions are only the frequency again ("137.932").
  const description = clean(row.description);
  const label = description && !/^[\d\s.,*/–-]+$/.test(description) ? description : undefined;
  const service = label ?? (clean(row.service) !== 'Unknown' ? clean(row.service) : undefined) ?? 'Radio link';

  return checkAmateurClaim({
    service,
    ...(uplinkMHz ? { uplinkMHz } : {}),
    ...(downlinkMHz ? { downlinkMHz } : {}),
    mode,
    sourceUrl: `https://db.satnogs.org/satellite/${Number(row.norad_cat_id)}/`,
    ...(satnogsAmateurFlag(row) !== undefined ? { amateur: satnogsAmateurFlag(row) } : {}),
  });
}

/**
 * Real catalog numbers of satellites with a confirmed, active amateur channel
 * in SatNOGS. Numbers from 80000 up are analyst objects or SatNOGS temporary
 * IDs, which have no public TLE.
 */
export function satnogsAmateurNoradIds(rows) {
  const ids = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const noradId = Number(row?.norad_cat_id);
    if (!Number.isInteger(noradId) || noradId <= 0 || noradId >= 80000) continue;
    if (satnogsRowToFrequency(row)?.amateur === true) ids.add(noradId);
  }
  return ids;
}

export function buildSatnogsRadioFrequencyMap(rows) {
  const byNorad = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const noradId = Number(row?.norad_cat_id);
    if (!Number.isInteger(noradId) || CURATED_RADIO_NORAD_IDS.has(noradId)) continue;
    const frequency = satnogsRowToFrequency(row);
    if (!frequency) continue;

    const existing = byNorad.get(noradId) ?? [];
    const key = channelKey(frequency);
    if (!existing.some((candidate) => channelKey(candidate) === key)) existing.push(frequency);
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
  amateur: false,
}));

const GALILEO_SAR_FREQUENCY = {
  service: 'Galileo SAR repeater',
  uplinkMHz: '406.0–406.1',
  downlinkMHz: '1544.0–1544.2',
  mode: 'Cospas-Sarsat transparent repeater',
  sourceUrl: GALILEO_SAR_SOURCE,
  amateur: false,
};

const GPS_FREQUENCIES = [
  { service: 'GPS L1 navigation', downlinkMHz: '1575.420', mode: 'BPSK(1)' },
  { service: 'GPS L2 navigation', downlinkMHz: '1227.600', mode: 'BPSK(1)' },
  { service: 'GPS L5 navigation', downlinkMHz: '1176.450', mode: 'BPSK(10)' },
].map((frequency) => ({ ...frequency, sourceUrl: GPS_SOURCE, amateur: false }));

const BEIDOU_FREQUENCIES = [
  { service: 'BeiDou B1I navigation', downlinkMHz: '1561.098', mode: 'BPSK(2)' },
  { service: 'BeiDou B1C navigation', downlinkMHz: '1575.420', mode: 'BOC(1,1) / QMBOC' },
  { service: 'BeiDou B2a navigation', downlinkMHz: '1176.450', mode: 'BPSK(10)' },
  { service: 'BeiDou B3I navigation', downlinkMHz: '1268.520', mode: 'BPSK(10)' },
].map((frequency) => ({ ...frequency, sourceUrl: BEIDOU_SOURCE, amateur: false }));

const STARLINK_FREQUENCIES = [{
  service: 'Starlink user broadband',
  uplinkMHz: '14000–14500',
  downlinkMHz: '10700–12700',
  mode: 'Ku-band broadband',
  note: 'Licensed operating range; individual beams use portions of the band.',
  sourceUrl: STARLINK_SOURCE,
  amateur: false,
}];

const ONEWEB_FREQUENCIES = [
  {
    service: 'OneWeb user broadband',
    uplinkMHz: '14000–14500',
    downlinkMHz: '10700–12700',
    mode: 'Ku-band broadband',
    note: 'Licensed operating range; individual beams use portions of the band.',
    sourceUrl: ONEWEB_SOURCE,
    amateur: false,
  },
  {
    service: 'OneWeb gateway link',
    uplinkMHz: '27500–29100 / 29500–30000',
    downlinkMHz: '17800–18600 / 18800–19300',
    mode: 'Ka-band gateway',
    sourceUrl: ONEWEB_SOURCE,
    amateur: false,
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

