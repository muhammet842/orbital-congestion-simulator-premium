import { describe, expect, it } from 'vitest';
import { dockedElementsKey, mergeDockedStacks } from './dockedStacks';
import type { TleRecord } from '../types';

// Live catalog, 2026-10-14: the ISS modules and a docked Progress share one
// published orbit; only catalog numbers, designators, revolution counts and
// checksums differ.
const ISS: TleRecord[] = [
  {
    noradId: 36086,
    name: 'POISK',
    line1: '1 36086U 09060A   26286.82178372  .00006592  00000+0  12831-3 0  9999',
    line2: '2 36086  51.6325  73.0089 0006710 259.3258 100.6975 15.48855783586351',
    category: 'stations',
  },
  {
    noradId: 25544,
    name: 'ISS (ZARYA)',
    line1: '1 25544U 98067A   26286.82178372  .00006592  00000+0  12831-3 0  9991',
    line2: '2 25544  51.6325  73.0089 0006710 259.3258 100.6975 15.48855783590140',
    category: 'stations',
  },
  {
    noradId: 68837,
    name: 'PROGRESS-MS 34',
    line1: '1 68837U 26093A   26286.82178372  .00006592  00000+0  12831-3 0  9993',
    line2: '2 68837  51.6325  73.0089 0006710 259.3258 100.6975 15.48855783587328',
    category: 'stations',
  },
  {
    noradId: 49044,
    name: 'ISS (NAUKA)',
    line1: '1 49044U 21066A   26286.82178372  .00006592  00000+0  12831-3 0  9997',
    line2: '2 49044  51.6325  73.0089 0006710 259.3258 100.6975 15.48855783586393',
    category: 'stations',
    radioFrequencies: [{ service: 'Telemetry', downlinkMHz: '922.76', mode: 'FM', sourceUrl: 'https://db.satnogs.org/' }],
  },
];

const TIANHE: TleRecord = {
  noradId: 48274,
  name: 'CSS (TIANHE)',
  line1: '1 48274U 21035A   26287.28427591  .00021633  00000+0  25637-3 0  9999',
  line2: '2 48274  41.4695 318.6409 0000496 117.1795 242.9094 15.60710014311760',
  category: 'stations',
};

describe('dockedElementsKey', () => {
  it('ignores catalog number, designator, revolution count and checksums', () => {
    expect(new Set(ISS.map(dockedElementsKey)).size).toBe(1);
    expect(dockedElementsKey(TIANHE)).not.toBe(dockedElementsKey(ISS[0]));
  });
});

describe('mergeDockedStacks', () => {
  it('shows a docked stack as its earliest-launched member, listing the rest', () => {
    const merged = mergeDockedStacks([...ISS, TIANHE]);
    expect(merged.map((r) => r.noradId)).toEqual([25544, 48274]);
    expect(merged[0].dockedComponents).toEqual([
      { noradId: 36086, name: 'POISK' },
      { noradId: 49044, name: 'ISS (NAUKA)' },
      { noradId: 68837, name: 'PROGRESS-MS 34' },
    ]);
    expect(merged[1]).toBe(TIANHE);
  });

  it('carries radio channels over from the docked parts', () => {
    const [stack] = mergeDockedStacks(ISS);
    expect(stack.radioFrequencies).toEqual([expect.objectContaining({ downlinkMHz: '922.76' })]);
  });

  it('separates a vehicle once it has its own elements again', () => {
    const undocked = { ...ISS[2], line2: ISS[2].line2.replace('100.6975', '101.0000') };
    const merged = mergeDockedStacks([ISS[0], ISS[1], undocked, ISS[3]]);
    expect(merged.map((r) => r.noradId).sort()).toEqual([25544, 68837]);
    expect(merged.find((r) => r.noradId === 25544)!.dockedComponents).toHaveLength(2);
  });

  it('leaves a catalog without docked objects unchanged', () => {
    expect(mergeDockedStacks([TIANHE])).toEqual([TIANHE]);
  });
});
