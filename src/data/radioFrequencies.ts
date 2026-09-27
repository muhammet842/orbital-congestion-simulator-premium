/**
 * Manually verified amateur-radio overrides keyed by NORAD catalogue number.
 *
 * The fetch pipeline adds the broader AMSAT/SatNOGS catalog directly to each
 * TLE record. Keep only richer or mission-specific overrides here: a missing
 * entry means "no manual override", not "no radio payload".
 * Frequencies can be retuned or disabled, so the detail panel always links to
 * the status/source page and intentionally does not claim live availability.
 */
import type { RadioFrequency } from '../types';

const AMSAT_ISS = 'https://www.amsat.org/amateur-radio-on-the-iss/';
const AMSAT_SO50 = 'https://www.amsat.org/two-way-satellites/so-50-satellite-information/';
const AMSAT_AO91 = 'https://www.amsat.org/two-way-satellites/ao-91/';
const AMSAT_DIGIPEATER = 'https://www.amsat.org/live-digipeater-satellites/';
const LEOPARD_TECHNICAL_PAPER =
  'https://kyutech.repo.nii.ac.jp/record/2001973/files/10464095.pdf';
const SATNOGS_LEOPARD = 'https://db.satnogs.org/satellite/67687/';

const BY_NORAD: ReadonlyMap<number, readonly RadioFrequency[]> = new Map([
  [25544, [
    {
      service: 'APRS digipeater',
      uplinkMHz: '145.825',
      downlinkMHz: '145.825',
      mode: 'FM · 1200 bps packet',
      note: 'Worldwide APRS mode; check ARISS status before transmitting.',
      sourceUrl: AMSAT_ISS,
    },
    {
      service: 'Cross-band voice repeater',
      uplinkMHz: '145.990',
      downlinkMHz: '437.800',
      mode: 'FM · CTCSS 67.0 Hz',
      note: 'Operation is schedule and status dependent.',
      sourceUrl: AMSAT_ISS,
    },
    {
      service: 'SSTV',
      listenMHz: '145.800',
      mode: 'FM',
      note: 'Occasional image downlink.',
      sourceUrl: AMSAT_ISS,
    },
  ]],
  [27607, [{
    service: 'FM voice repeater',
    uplinkMHz: '145.850',
    downlinkMHz: '436.795',
    mode: 'FM · CTCSS 67.0 Hz',
    note: 'A 74.4 Hz tone arms the 10-minute repeater timer.',
    sourceUrl: AMSAT_SO50,
  }]],
  [43017, [{
    service: 'FM voice repeater',
    uplinkMHz: '435.250',
    downlinkMHz: '145.960',
    mode: 'FM',
    note: 'AO-91 availability is power-dependent; verify current status.',
    sourceUrl: AMSAT_AO91,
  }]],
  [67687, [
    {
      service: 'UHF command / telemetry',
      uplinkMHz: '450 (nominal)',
      downlinkMHz: '400.960',
      mode: '4k8 GMSK',
      note: '450 MHz is the nominal command uplink from the mission paper; SatNOGS lists the 400.960 MHz telemetry downlink. Do not transmit without operator authorization.',
      sourceUrl: LEOPARD_TECHNICAL_PAPER,
    },
    {
      service: 'CW beacon',
      listenMHz: '400.960',
      mode: 'CW',
      sourceUrl: SATNOGS_LEOPARD,
    },
    {
      service: 'Science data downlink',
      downlinkMHz: '2279.100',
      mode: 'BPSK · 64 kbps',
      note: 'S-band mission data downlink; SatNOGS lists BPSK and the technical paper specifies a 64 kbps link.',
      sourceUrl: SATNOGS_LEOPARD,
    },
  ]],
  [69920, [{
    service: 'Packet digipeater',
    listenMHz: '145.925 / 436.680',
    mode: '9k6 GFSK/G3RUH',
    note: 'Published as a live digipeater; check operating mode before transmit.',
    sourceUrl: AMSAT_DIGIPEATER,
  }]],
]);

export function getRadioFrequencies(noradId: number): RadioFrequency[] | undefined {
  const frequencies = BY_NORAD.get(noradId);
  return frequencies ? frequencies.map((frequency) => ({ ...frequency })) : undefined;
}
