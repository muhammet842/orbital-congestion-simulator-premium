import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RADIO_FILTERS,
  buildCsv,
  buildRadioIndex,
  channelMatches,
  csvCell,
  filterRadioEntries,
  formatMHz,
  radioFiltersFromSearch,
  radioLinkSearch,
  receiveFrequencies,
  type RadioFilters,
} from './radioIndex';
import type { RadioFrequency, TrackedObject } from '../types';

function ch(over: Partial<RadioFrequency>): RadioFrequency {
  return { service: 'Service', mode: 'FM', sourceUrl: 'https://example.org/x', ...over };
}

function obj(name: string, noradId: number, frequencies: RadioFrequency[] | undefined, category = 'active'): TrackedObject {
  return { name, noradId, category, radioFrequencies: frequencies } as unknown as TrackedObject;
}

const SATS: TrackedObject[] = [
  obj('NO-RADIO', 1, undefined),
  obj('ISS (ZARYA)', 25544, [
    ch({ service: 'APRS digipeater', uplinkMHz: '145.825', downlinkMHz: '145.825', mode: 'FM · 1200 bps packet', amateur: true }),
    ch({ service: 'Cross-band repeater', uplinkMHz: '145.990', downlinkMHz: '437.800', mode: 'FM · CTCSS 67.0 Hz', amateur: true }),
  ], 'stations'),
  obj('RS-44', 44909, [
    ch({ service: 'Amateur radio', uplinkMHz: '145.935-145.995', downlinkMHz: '435.670-435.610', mode: 'SSB CW*', amateur: true }),
    ch({ service: 'Beacon', listenMHz: '435.605', mode: 'CW', amateur: true }),
  ]),
  obj('NOAA 19', 33591, [
    ch({ service: 'APT', downlinkMHz: '137.1', mode: 'FM', amateur: false }),
    ch({ service: 'HRPT', downlinkMHz: '1698', mode: 'HRPT · 665400 baud', amateur: false }),
  ]),
  obj('STARLINK-1', 100, [
    ch({ service: 'Starlink user broadband', uplinkMHz: '14000–14500', downlinkMHz: '10700–12700', mode: 'Ku-band broadband', amateur: false }),
  ]),
  obj('CUBESAT-X', 200, [ch({ service: 'TLM', downlinkMHz: '437.65', mode: 'MSK · 4800 baud' })]), // unclassified
  obj('UPLINK-ONLY', 300, [ch({ service: 'Command', uplinkMHz: '145.9', mode: 'FM' })]),
];

const INDEX = buildRadioIndex(SATS);
const f = (over: Partial<RadioFilters> = {}): RadioFilters => ({ ...DEFAULT_RADIO_FILTERS, ...over });
const names = (filters: RadioFilters) => filterRadioEntries(INDEX, filters).map((m) => m.entry.name);

describe('buildRadioIndex', () => {
  it('keeps only satellites with something to receive, and remembers the catalog index', () => {
    expect(INDEX.map((e) => e.name)).toEqual(['ISS (ZARYA)', 'RS-44', 'NOAA 19', 'STARLINK-1', 'CUBESAT-X']);
    expect(INDEX[0].index).toBe(1); // position in the objects array
  });

  it('ignores uplinks: an uplink-only channel is not receivable', () => {
    expect(INDEX.some((e) => e.name === 'UPLINK-ONLY')).toBe(false);
  });

  it('summarises the amateur flag per satellite', () => {
    const by = (n: string) => INDEX.find((e) => e.name === n)!.amateur;
    expect(by('ISS (ZARYA)')).toBe(true);
    expect(by('NOAA 19')).toBe(false);
    expect(by('CUBESAT-X')).toBeUndefined();
  });
});

describe('filterRadioEntries', () => {
  it('"Easy" keeps what a simple antenna can hear and drops dish-only and Ku-band satellites', () => {
    expect(names(f())).toEqual(['ISS (ZARYA)', 'RS-44', 'CUBESAT-X', 'NOAA 19']);
  });

  it('lists amateur satellites first, then the rest by name', () => {
    const order = filterRadioEntries(INDEX, f()).map((m) => m.entry.name);
    expect(order.slice(0, 2)).toEqual(['ISS (ZARYA)', 'RS-44']);
    expect(order.slice(2)).toEqual(['CUBESAT-X', 'NOAA 19']);
  });

  it('lists named satellites before bare launch designators, within the same group', () => {
    const objs = [
      obj('2023-091J', 1, [ch({ downlinkMHz: '435.79', mode: 'AFSK', amateur: true })]),
      obj('ZEBRA-1', 2, [ch({ downlinkMHz: '436.1', mode: 'FM', amateur: true })]),
      obj('ALPHA-SAT', 3, [ch({ downlinkMHz: '436.2', mode: 'FM', amateur: true })]),
    ];
    const order = filterRadioEntries(buildRadioIndex(objs), f({ band: 'ham70cm' })).map((m) => m.entry.name);
    expect(order).toEqual(['ALPHA-SAT', 'ZEBRA-1', '2023-091J']);
  });

  it('narrows by band', () => {
    expect(names(f({ band: 'ham2m' }))).toEqual(['ISS (ZARYA)']);
    expect(names(f({ band: 'ham70cm' }))).toEqual(['ISS (ZARYA)', 'RS-44', 'CUBESAT-X']);
    expect(names(f({ band: 'vhf137' }))).toEqual(['NOAA 19']);
    expect(names(f({ band: 'dish' }))).toEqual(['NOAA 19']);
    expect(names(f({ band: 'all' }))).toHaveLength(5);
  });

  it('narrows by mode, matching any class of a channel', () => {
    expect(names(f({ band: 'ham70cm', mode: 'cw' }))).toEqual(['RS-44']);
    expect(names(f({ band: 'ham70cm', mode: 'ssb' }))).toEqual(['RS-44']);
    expect(names(f({ band: 'ham70cm', mode: 'fm' }))).toEqual(['ISS (ZARYA)']);
    expect(names(f({ band: 'ham70cm', mode: 'digital' }))).toEqual(['CUBESAT-X']);
  });

  it('"Amateur only" keeps channels flagged amateur, not unclassified ones', () => {
    expect(names(f({ amateurOnly: true }))).toEqual(['ISS (ZARYA)', 'RS-44']);
  });

  it('searches by name or NORAD id, case-insensitively', () => {
    expect(names(f({ band: 'all', query: 'rs-4' }))).toEqual(['RS-44']);
    expect(names(f({ band: 'all', query: '25544' }))).toEqual(['ISS (ZARYA)']);
    expect(names(f({ band: 'all', query: 'zzz' }))).toEqual([]);
  });

  it('returns only the matching channels of each satellite', () => {
    const iss = filterRadioEntries(INDEX, f({ band: 'ham2m' }))[0];
    expect(iss.channels.map((c) => c.service)).toEqual(['APRS digipeater']);
  });
});

describe('channel helpers', () => {
  it('shows the frequencies inside the band, or all of them for "All"', () => {
    const iss = INDEX[0];
    const repeater = iss.channels[1];
    expect(receiveFrequencies(repeater, 'ham70cm')).toEqual([437.8]);
    expect(receiveFrequencies(repeater, 'all')).toEqual([437.8]);
    expect(channelMatches(repeater, f({ band: 'ham2m' }))).toBe(false);
  });

  it('formats frequencies without noise', () => {
    expect(formatMHz(145.8250001)).toBe('145.825');
    expect(formatMHz(435.67)).toBe('435.67');
    expect(formatMHz(1698)).toBe('1698');
  });
});

describe('buildCsv', () => {
  const matches = filterRadioEntries(INDEX, f({ band: 'ham70cm' }));

  it('writes a header and one row per matching channel, UTF-8 with BOM and CRLF', () => {
    const csv = buildCsv(matches);
    expect(csv.startsWith('﻿name,norad_id,category,amateur,service,downlink_mhz')).toBe(true);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toHaveLength(1 + 4); // ISS repeater + RS-44 (amateur) x2 + CUBESAT-X
    expect(lines[1]).toContain('ISS (ZARYA),25544,stations,yes,Cross-band repeater,437.8');
    expect(csv).toContain(',unclassified,');
  });

  it('adds elevation and next pass when known', () => {
    const csv = buildCsv(matches, new Map([[25544, { elevationDeg: 47.26, nextPassUtc: '2026-10-14T05:12:00Z' }]]));
    expect(csv).toContain(',47.3,2026-10-14T05:12:00Z');
  });

  it('quotes cells with commas/quotes and neutralises spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(25544)).toBe('25544');
  });
});

describe('shareable links', () => {
  it('round-trips the filters and never carries the location-specific toggle', () => {
    const filters = f({ band: 'ham70cm', mode: 'fm', amateurOnly: true, query: 'iss' });
    const search = radioLinkSearch(filters);
    expect(search).toBe('?radio=ham70cm&mode=fm&amateur=1&rq=iss');
    expect(radioFiltersFromSearch(search)).toEqual(filters);
  });

  it('omits defaults', () => {
    expect(radioLinkSearch(f())).toBe('?radio=easy');
  });

  it('ignores URLs that do not ask for the panel, and repairs junk values', () => {
    expect(radioFiltersFromSearch('?object=25544')).toBeNull();
    expect(radioFiltersFromSearch('')).toBeNull();
    expect(radioFiltersFromSearch('?radio=bogus&mode=nope&amateur=2')).toEqual(DEFAULT_RADIO_FILTERS);
    expect(radioFiltersFromSearch('?radio=2m')).toEqual(DEFAULT_RADIO_FILTERS); // unknown band id
  });

  it('bounds the search text', () => {
    const long = 'x'.repeat(500);
    expect(radioFiltersFromSearch(`?radio=easy&rq=${long}`)!.query).toHaveLength(60);
  });
});
