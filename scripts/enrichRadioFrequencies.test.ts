import { describe, expect, it } from 'vitest';
import {
  applyRadioFrequencies,
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
});

