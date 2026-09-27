import { describe, expect, it } from 'vitest';
import { getRadioFrequencies } from './radioFrequencies';

describe('getRadioFrequencies', () => {
  it('returns curated ISS channels with uplink and downlink metadata', () => {
    const frequencies = getRadioFrequencies(25544);
    expect(frequencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ uplinkMHz: '145.825', downlinkMHz: '145.825' }),
      expect.objectContaining({ uplinkMHz: '145.990', downlinkMHz: '437.800' }),
    ]));
  });

  it('returns undefined instead of inventing frequencies for unknown objects', () => {
    expect(getRadioFrequencies(999999)).toBeUndefined();
  });

  it('returns a copy so view code cannot mutate the catalogue', () => {
    const first = getRadioFrequencies(27607)!;
    first[0].mode = 'changed';
    expect(getRadioFrequencies(27607)![0].mode).not.toBe('changed');
  });

  it('keeps LEOPARD command, telemetry, beacon and science links distinct', () => {
    const frequencies = getRadioFrequencies(67687);
    expect(frequencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ service: 'Command uplink', uplinkMHz: '450 (nominal)' }),
      expect.objectContaining({ service: 'Telemetry downlink', downlinkMHz: '400.960' }),
      expect.objectContaining({ service: 'CW beacon', listenMHz: '400.960' }),
      expect.objectContaining({ service: 'Science data downlink', downlinkMHz: '2279.100' }),
    ]));
  });
});
