import { describe, expect, it } from 'vitest';
import { markForMeasurement, objectLimit, pickEvenly, workersDisabled } from './perfFlags';

describe('perfFlags', () => {
  it('changes nothing without the flags', () => {
    expect(workersDisabled('')).toBe(false);
    expect(workersDisabled('?object=25544')).toBe(false);
    expect(objectLimit('')).toBeNull();
  });

  it('reads ?worker=off only', () => {
    expect(workersDisabled('?worker=off')).toBe(true);
    expect(workersDisabled('?worker=on')).toBe(false);
    expect(workersDisabled('?worker')).toBe(false);
  });

  it('reads ?limit=N as a whole number of at least 1', () => {
    expect(objectLimit('?limit=5000')).toBe(5000);
    expect(objectLimit('?limit=0')).toBeNull();
    expect(objectLimit('?limit=-5')).toBeNull();
    expect(objectLimit('?limit=1e3')).toBeNull();
    expect(objectLimit('?limit=abc')).toBeNull();
  });

  it('picks evenly by NORAD number, the same way every time', () => {
    const items = [5, 1, 4, 2, 3, 6].map((noradId) => ({ noradId }));
    expect(pickEvenly(items, 3).map((o) => o.noradId)).toEqual([1, 3, 5]);
    expect(pickEvenly(items, 3)).toEqual(pickEvenly([...items].reverse(), 3));
    expect(pickEvenly(items, 10)).toHaveLength(6);
  });

  it('marks a moment the measurement can read', () => {
    markForMeasurement('perf-flags-test');
    expect(performance.getEntriesByName('perf-flags-test')).toHaveLength(1);
  });
});
