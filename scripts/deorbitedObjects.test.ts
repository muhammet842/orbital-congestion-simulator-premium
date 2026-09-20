import { describe, expect, it } from 'vitest';
import { filterKnownDeorbitedObjects } from './deorbitedObjects.mjs';

describe('filterKnownDeorbitedObjects', () => {
  it('removes Progress MS-33 after its confirmed re-entry, not before', () => {
    const before = new Map([[68319, { noradId: 68319 }]]);
    expect(filterKnownDeorbitedObjects(before, new Date('2026-09-07T19:14:59Z'))).toBe(0);

    const after = new Map([[68319, { noradId: 68319 }]]);
    expect(filterKnownDeorbitedObjects(after, new Date('2026-09-07T19:15:00Z'))).toBe(1);
    expect(after.has(68319)).toBe(false);
  });
});
