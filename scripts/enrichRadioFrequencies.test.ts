import { describe, expect, it } from 'vitest';
import {
  applyKnownConstellationFrequencies,
  applyRadioFrequencies,
  buildSatnogsRadioFrequencyMap,
  buildRadioFrequencyMap,
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

