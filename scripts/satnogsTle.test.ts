import { describe, expect, it } from 'vitest';
import { satnogsDisplayName, satnogsTleObjects } from './satnogsTle.mjs';
import { tleEpochMs } from './catalogGuard.mjs';

// LAPAN-A2 (IO-86) as served by the SatNOGS DB: no international designator,
// zeroed drag terms, epoch 2026-09-22.
const IO86 = {
  tle0: 'LAPAN-A2',
  tle1: '1 40931U          26265.05814803  .00000000  00000-0  10000-5 0    06',
  tle2: '2 40931   6.0006 191.5217 0012733 338.8432 319.8135 14.79311918    08',
  tle_source: 'SatNOGS Team',
  norad_cat_id: 40931,
};
const EPOCH = tleEpochMs(IO86.tle1);
const DAY = 86_400_000;
const SATS = [{ norad_cat_id: 40931, name: 'LAPAN-A2', names: 'ORARI, IO-86, YB0X' }];

describe('satnogsTleObjects', () => {
  it('turns a recent SatNOGS TLE into a catalogue record, named the way operators search for it', () => {
    const { objects, tooOld } = satnogsTleObjects([IO86], [40931], EPOCH + 24 * DAY, { satellites: SATS });
    expect(tooOld).toEqual([]);
    expect(objects).toEqual([
      { noradId: 40931, name: 'LAPAN-A2 (IO-86)', line1: IO86.tle1, line2: IO86.tle2, category: 'active', tleSource: 'satnogs' },
    ]);
  });

  it('keeps out elements older than the limit, and reports them', () => {
    const { objects, tooOld } = satnogsTleObjects([IO86], [40931], EPOCH + 31 * DAY);
    expect(objects).toEqual([]);
    expect(tooOld).toEqual([40931]);
  });

  it('only returns the satellites asked for, with valid lines for that catalog number', () => {
    expect(satnogsTleObjects([IO86], [12345], EPOCH).objects).toEqual([]);
    const corrupt = { ...IO86, tle2: IO86.tle2.slice(0, -1) + '9' }; // bad checksum
    expect(satnogsTleObjects([corrupt], [40931], EPOCH).objects).toEqual([]);
    const otherId = { ...IO86, norad_cat_id: 40932 };
    expect(satnogsTleObjects([otherId], [40932], EPOCH).objects).toEqual([]);
  });

  it('rejects an epoch far in the future', () => {
    expect(satnogsTleObjects([IO86], [40931], EPOCH - 5 * DAY).objects).toEqual([]);
  });

  it('falls back to the TLE name without the satellite list', () => {
    expect(satnogsTleObjects([IO86], [40931], EPOCH).objects[0].name).toBe('LAPAN-A2');
  });
});

describe('satnogsDisplayName', () => {
  it('adds the OSCAR number once', () => {
    expect(satnogsDisplayName('LAPAN-A2', 'ORARI, IO-86, YB0X')).toBe('LAPAN-A2 (IO-86)');
    expect(satnogsDisplayName('FUNCUBE-1 (AO-73)', 'AO-73')).toBe('FUNCUBE-1 (AO-73)');
    expect(satnogsDisplayName('0 NORBY-2', '')).toBe('NORBY-2');
  });
});
