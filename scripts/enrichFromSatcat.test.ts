import { describe, expect, it } from 'vitest';
import {
  applySatcatOwners,
  filterSatcatDecayedObjects,
  parseSatcatMetadataByNorad,
  parseSatcatOwnerByNorad,
  splitCsvLine,
} from './enrichFromSatcat.mjs';
import { resolveSatcatOwner } from './satcatOwnerMap.mjs';

describe('splitCsvLine', () => {
  it('splits plain CSV', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps commas inside quotes', () => {
    expect(splitCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
  });
});

describe('parseSatcatOwnerByNorad', () => {
  const csv = [
    'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,DECAY_DATE',
    'MARINA,2026-156BD,69920,PAY,+,SVK,2026-07-07,',
    'STARLINK-1000,2020-001A,45000,PAY,+,US,2020-01-01,',
    'ISS (ZARYA),1998-067A,25544,PAY,+,ISS,1998-11-20,',
  ].join('\n');

  it('indexes OWNER by NORAD', () => {
    const map = parseSatcatOwnerByNorad(csv);
    expect(map.get(69920)).toBe('SVK');
    expect(map.get(45000)).toBe('US');
    expect(map.get(25544)).toBe('ISS');
  });

  it('preserves the official decay date alongside the owner', () => {
    const csv = [
      'OBJECT_NAME,NORAD_CAT_ID,OWNER,DECAY_DATE',
      'PROGRESS MS-33,68319,RKKE,2026-09-07',
    ].join('\n');
    expect(parseSatcatMetadataByNorad(csv).get(68319)).toEqual({
      owner: 'RKKE', decayDate: '2026-09-07',
    });
  });
});

describe('filterSatcatDecayedObjects', () => {
  it('removes only objects whose recorded decay date has passed', () => {
    const seen = new Map([
      [68319, { noradId: 68319, name: 'PROGRESS MS-33' }],
      [25544, { noradId: 25544, name: 'ISS' }],
    ]);
    const metadata = new Map([
      [68319, { decayDate: '2026-09-07' }],
      [25544, {}],
    ]);

    expect(filterSatcatDecayedObjects(seen, metadata, new Date('2026-09-20T00:00:00Z'))).toBe(1);
    expect(seen.has(68319)).toBe(false);
    expect(seen.has(25544)).toBe(true);
  });
});

describe('resolveSatcatOwner', () => {
  it('maps SVK to Slovakia without forcing an org owner', () => {
    expect(resolveSatcatOwner('SVK')).toEqual({
      ownerCode: 'SVK',
      country: 'Slovakia 🇸🇰',
      owner: undefined,
    });
  });

  it('maps TURK to Türkiye', () => {
    expect(resolveSatcatOwner('TURK')?.country).toBe('Türkiye 🇹🇷');
    expect(resolveSatcatOwner('TURK')?.owner).toBeUndefined();
  });

  it('maps ISS as an organization (sets owner)', () => {
    expect(resolveSatcatOwner('ISS')).toEqual({
      ownerCode: 'ISS',
      country: 'International 🌍',
      owner: 'International Space Station',
    });
  });

  it('falls back to the raw code for unknown owners', () => {
    expect(resolveSatcatOwner('ZZZZ')).toEqual({
      ownerCode: 'ZZZZ',
      country: 'ZZZZ 🌐',
      owner: undefined,
    });
  });
});

describe('applySatcatOwners', () => {
  it('sets country for country codes and clears stale owner', () => {
    const seen = new Map([
      [69920, { noradId: 69920, name: 'MARINA', owner: 'stale' }],
      [45000, { noradId: 45000, name: 'STARLINK-1000' }],
    ]);
    const owners = new Map([
      [69920, 'SVK'],
      [45000, 'US'],
    ]);

    const stats = applySatcatOwners(seen, owners);
    expect(stats).toEqual({ matched: 2, unmatched: 0, withOwner: 0 });
    expect(seen.get(69920)).toMatchObject({ country: 'Slovakia 🇸🇰' });
    expect(seen.get(69920)).not.toHaveProperty('owner');
    expect(seen.get(45000)).toMatchObject({ country: 'USA 🇺🇸' });
    expect(seen.get(45000)).not.toHaveProperty('owner');
  });

  it('sets both country and owner for org codes', () => {
    const seen = new Map([[25544, { noradId: 25544, name: 'ISS' }]]);
    const stats = applySatcatOwners(seen, new Map([[25544, 'ISS']]));
    expect(stats.withOwner).toBe(1);
    expect(seen.get(25544)).toEqual({
      noradId: 25544,
      name: 'ISS',
      country: 'International 🌍',
      owner: 'International Space Station',
    });
  });

  it('leaves unmatched objects untouched', () => {
    const seen = new Map([[1, { noradId: 1, name: 'X' }]]);
    const stats = applySatcatOwners(seen, new Map());
    expect(stats.unmatched).toBe(1);
    expect(seen.get(1)).toEqual({ noradId: 1, name: 'X' });
  });
});
