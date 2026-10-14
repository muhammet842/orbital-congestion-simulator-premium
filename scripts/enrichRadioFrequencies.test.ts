import { describe, expect, it } from 'vitest';
import {
  applyKnownConstellationFrequencies,
  applyRadioFrequencies,
  buildSatnogsRadioFrequencyMap,
  buildRadioFrequencyMap,
  isInAmateurBands,
  satnogsAmateurNoradIds,
} from './enrichRadioFrequencies.mjs';

describe('radio-frequency enrichment', () => {
  const rows = [
    {
      norad_id: '12345',
      uplink: '145.900',
      downlink: '435.100',
      beacon: '435.500',
      mode: 'FM',
      callsign: 'TEST-1',
      satnogs_id: 'ABCD-1234',
    },
    {
      norad_id: '12345',
      uplink: null,
      downlink: '2401.200',
      beacon: null,
      mode: 'GMSK',
      callsign: null,
      satnogs_id: 'ABCD-1234',
    },
  ];

  it('converts all published channels and groups them by NORAD ID', () => {
    const frequencies = buildRadioFrequencyMap(rows).get(12345)!;
    expect(frequencies).toHaveLength(3);
    expect(frequencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ uplinkMHz: '145.900', downlinkMHz: '435.100' }),
      expect.objectContaining({ service: 'Beacon', listenMHz: '435.500' }),
      expect.objectContaining({ downlinkMHz: '2401.200', mode: 'GMSK' }),
    ]));
  });

  it('does not replace manually curated satellites', () => {
    expect(buildRadioFrequencyMap([{ ...rows[0], norad_id: '25544' }]).has(25544)).toBe(false);
  });

  it('enriches only objects present in the current TLE catalog', () => {
    const object = { noradId: 12345, name: 'TESTSAT' };
    const seen = new Map([[12345, object]]);
    const stats = applyRadioFrequencies(seen, [
      ...rows,
      { ...rows[0], norad_id: '54321' },
    ]);

    expect(stats).toMatchObject({ catalogSatellites: 2, matched: 1, channels: 3 });
    expect(object).toHaveProperty('radioFrequencies');
  });

  it('accepts only confirmed, active SatNOGS transmitters and formats ranges', () => {
    const base = {
      norad_cat_id: 12345,
      status: 'active',
      alive: true,
      unconfirmed: false,
      frequency_violation: false,
      description: 'Telemetry and command',
      uplink_low: 145_800_000,
      uplink_high: 145_900_000,
      downlink_low: 437_500_000,
      downlink_high: 437_500_000,
      uplink_mode: 'FM',
      mode: 'GMSK',
      baud: 9600,
    };
    const frequencies = buildSatnogsRadioFrequencyMap([
      base,
      { ...base, norad_cat_id: 12346, unconfirmed: true },
      { ...base, norad_cat_id: 12347, status: 'inactive' },
    ]);

    expect(frequencies.get(12345)).toEqual([
      expect.objectContaining({
        uplinkMHz: '145.8–145.9',
        downlinkMHz: '437.5',
        mode: 'FM / GMSK · 9600 baud',
      }),
    ]);
    expect(frequencies.has(12346)).toBe(false);
    expect(frequencies.has(12347)).toBe(false);
  });

  it('classifies amateur channels from the source service', () => {
    const base = {
      norad_cat_id: 12345,
      status: 'active',
      alive: true,
      unconfirmed: false,
      frequency_violation: false,
      downlink_low: 437_500_000,
      downlink_high: 437_500_000,
      mode: 'FM',
    };
    const get = (id: number, service: string) =>
      buildSatnogsRadioFrequencyMap([{ ...base, norad_cat_id: id, service }]).get(id)![0];

    expect(get(1, 'Amateur').amateur).toBe(true);
    expect(get(2, 'Meteorological').amateur).toBe(false);
    expect(get(3, 'Unknown')).not.toHaveProperty('amateur');
    // AMSAT rows only list amateur satellites.
    expect(buildRadioFrequencyMap(rows).get(12345)!.every((f: { amateur?: boolean }) => f.amateur === true)).toBe(true);
    // Official constellation plans are not amateur services.
    const seen = new Map([[1, { noradId: 1, name: 'STARLINK-1' }]]);
    applyKnownConstellationFrequencies(seen);
    expect(seen.get(1)!.radioFrequencies![0].amateur).toBe(false);
  });

  it('keeps the amateur badge only for links inside amateur bands', () => {
    const amsat = buildRadioFrequencyMap([
      { norad_id: '46912', downlink: '401.030', mode: 'GFSK', satnogs_id: 'KSM1' },
      { norad_id: '40055', downlink: '2234.4', mode: 'BPSK', satnogs_id: 'CANX' },
      { norad_id: '24278', uplink: '145.900-146.000', downlink: '435.900-435.800', mode: 'SSB/CW' },
      { norad_id: '7530', uplink: '432.125-432.175', downlink: '145.975-145.925', mode: 'SSB/CW' },
    ]);
    expect(amsat.get(46912)![0]).not.toHaveProperty('amateur');
    expect(amsat.get(40055)![0]).not.toHaveProperty('amateur');
    expect(amsat.get(24278)![0].amateur).toBe(true);
    // AO-7 mode B uplinks at 432 MHz: outside the satellite sub-band, but
    // still the amateur service, so the badge stays.
    expect(amsat.get(7530)![0].amateur).toBe(true);

    const satnogs = buildSatnogsRadioFrequencyMap([{
      norad_cat_id: 67685, status: 'active', alive: true, service: 'Amateur',
      downlink_low: 401_140_000, mode: 'GMSK',
    }]);
    expect(satnogs.get(67685)![0]).not.toHaveProperty('amateur');
  });

  it('checks every listed frequency against the band plan', () => {
    expect(isInAmateurBands({ uplinkMHz: '145.850/145.930', downlinkMHz: '435.225*/435.325' })).toBe(true);
    expect(isInAmateurBands({ downlinkMHz: '465.988/1703.000/2203.200' })).toBe(false);
    expect(isInAmateurBands({ listenMHz: '10489.550' })).toBe(true);
    expect(isInAmateurBands({ downlinkMHz: 'TBD' })).toBeUndefined();
  });

  it('replaces a SatNOGS description that is only a frequency', () => {
    const base = { status: 'active', alive: true, downlink_low: 137_932_000, mode: 'FM' };
    const map = buildSatnogsRadioFrequencyMap([
      { ...base, norad_cat_id: 1, description: '137.932', service: 'Meteorological' },
      { ...base, norad_cat_id: 2, description: '2208.722', service: 'Unknown' },
      { ...base, norad_cat_id: 3, description: 'APT', service: 'Meteorological' },
    ]);
    expect(map.get(1)![0].service).toBe('Meteorological');
    expect(map.get(2)![0].service).toBe('Radio link');
    expect(map.get(3)![0].service).toBe('APT');
  });

  it('merges channels that differ only in their name', () => {
    const base = { norad_cat_id: 6235, status: 'active', alive: true, downlink_low: 136_770_000, mode: 'FM' };
    const map = buildSatnogsRadioFrequencyMap([
      { ...base, description: 'Beacon' },
      { ...base, description: 'Telemetry' },
    ]);
    expect(map.get(6235)).toHaveLength(1);
  });

  it('lists real catalog numbers with an active amateur channel', () => {
    const base = { status: 'active', alive: true, service: 'Amateur', downlink_low: 437_500_000, mode: 'FM' };
    const ids = satnogsAmateurNoradIds([
      { ...base, norad_cat_id: 60238 },
      { ...base, norad_cat_id: 98268 }, // SatNOGS temporary ID: no public TLE
      { ...base, norad_cat_id: 62616, unconfirmed: true },
      { ...base, norad_cat_id: 64535, service: 'Space Operation' },
      { ...base, norad_cat_id: 46912, downlink_low: 401_030_000 }, // labelled Amateur, but 401 MHz
    ]);
    expect([...ids]).toEqual([60238]);
  });

  it('applies the official Galileo plan to every Galileo-family object', () => {
    const galileo: { noradId: number; name: string; radioFrequencies?: unknown[] } = {
      noradId: 37846,
      name: 'GSAT0101 (GALILEO-PFM)',
    };
    const other = { noradId: 99999, name: 'OTHER' };
    const seen = new Map([[37846, galileo], [99999, other]]);
    const stats = applyKnownConstellationFrequencies(seen);

    expect(stats).toEqual({ matched: 1, channels: 6 });
    expect(galileo.radioFrequencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ service: 'Galileo mission feeder uplink', uplinkMHz: '5000–5010' }),
      expect.objectContaining({ service: 'Galileo E1 navigation', downlinkMHz: '1575.420' }),
      expect.objectContaining({ service: 'Galileo E6 navigation', downlinkMHz: '1278.750' }),
    ]));
    expect(other).not.toHaveProperty('radioFrequencies');
  });

  it('uses published family plans beyond Galileo', () => {
    const objects = [
      { noradId: 1, name: 'STARLINK-1000' },
      { noradId: 2, name: 'ONEWEB-0001' },
      { noradId: 3, name: 'GPS BIIR-5 (PRN 22)' },
      { noradId: 4, name: 'BEIDOU-3 M1' },
    ];
    const seen = new Map(objects.map((object) => [object.noradId, object]));
    const stats = applyKnownConstellationFrequencies(seen);

    expect(stats.matched).toBe(4);
    expect((objects[0] as typeof objects[number] & { radioFrequencies: unknown[] }).radioFrequencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ uplinkMHz: '14000–14500', downlinkMHz: '10700–12700' }),
    ]));
    expect((objects[2] as typeof objects[number] & { radioFrequencies: unknown[] }).radioFrequencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ service: 'GPS L1 navigation', downlinkMHz: '1575.420' }),
    ]));
    expect((objects[3] as typeof objects[number] & { radioFrequencies: unknown[] }).radioFrequencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ service: 'BeiDou B1I navigation', downlinkMHz: '1561.098' }),
    ]));
  });
});

