import { describe, expect, it } from 'vitest';
import { prepareRadioRows } from './radioDisplay';
import type { RadioFrequency } from '../types';

const row = (over: Partial<RadioFrequency>): RadioFrequency => ({
  service: 'Telemetry',
  downlinkMHz: '437.65',
  mode: 'FM',
  sourceUrl: 'https://db.satnogs.org/satellite/1/',
  ...over,
});

describe('prepareRadioRows', () => {
  it('removes a frequency repeated inside the service label', () => {
    const [r] = prepareRadioRows([row({ service: 'ARGOS-3 A-DCS 465.9875MHz', downlinkMHz: '465.9875' })]);
    expect(r.service).toBe('ARGOS-3 A-DCS');
    expect(r.genericService).toBe(false);
  });

  it('flags bare-number and empty labels as generic', () => {
    const rows = prepareRadioRows([
      row({ service: '137.932', downlinkMHz: '137.932' }),
      row({ service: '  ', downlinkMHz: '1.0' }),
    ]);
    expect(rows.map((r) => r.genericService)).toEqual([true, true]);
  });

  it('keeps a numeric part that is not this row\'s own frequency', () => {
    const [r] = prepareRadioRows([row({ service: 'GPS L1 navigation', downlinkMHz: '1575.420' })]);
    expect(r.service).toBe('GPS L1 navigation');
  });

  it('drops identical rows but keeps rows differing only by mode', () => {
    const rows = prepareRadioRows([
      row({ mode: 'MSK · 4800 baud' }),
      row({ mode: 'MSK · 4800 baud' }),
      row({ mode: 'CW · 25 baud' }),
    ]);
    expect(rows.map((r) => r.mode)).toEqual(['MSK · 4800 baud', 'CW · 25 baud']);
  });

  it('puts amateur rows first, then unclassified, then non-amateur, stably', () => {
    const rows = prepareRadioRows([
      row({ service: 'Weather', amateur: false }),
      row({ service: 'Unknown-a' }),
      row({ service: 'Ham-1', amateur: true }),
      row({ service: 'Unknown-b' }),
      row({ service: 'Ham-2', amateur: true }),
    ]);
    expect(rows.map((r) => r.service)).toEqual(['Ham-1', 'Ham-2', 'Unknown-a', 'Unknown-b', 'Weather']);
  });

  it('marks AMSAT-style asterisk modes', () => {
    const rows = prepareRadioRows([row({ mode: 'SSB CW*' }), row({ service: 'B', mode: 'FM' })]);
    expect(rows.map((r) => r.hasMarker)).toEqual([true, false]);
  });
});
