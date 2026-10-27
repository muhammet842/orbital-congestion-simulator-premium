import { describe, expect, it } from 'vitest';
import { formatGroundPosition, formatSlot, normalizeLongitudeDeg } from './groundPosition';

describe('groundPosition', () => {
  it('formats hemispheres', () => {
    expect(formatGroundPosition(41.234, 29.05)).toBe('41.2° N, 29.1° E');
    expect(formatGroundPosition(-33.9, -70.66)).toBe('33.9° S, 70.7° W');
    expect(formatGroundPosition(40.88765, 29.30012, 4)).toBe('40.8877° N, 29.3001° E');
  });
  it('formats a GEO slot by longitude only', () => {
    expect(formatSlot(42)).toBe('42.0° E');
    expect(formatSlot(-61.5)).toBe('61.5° W');
  });
  it('wraps longitudes into -180..180', () => {
    expect(normalizeLongitudeDeg(190)).toBe(-170);
    expect(normalizeLongitudeDeg(-190)).toBe(170);
    expect(normalizeLongitudeDeg(0)).toBe(0);
  });
  it('shows a dash for non-finite input', () => {
    expect(formatGroundPosition(NaN, 0)).toBe('—');
    expect(formatSlot(NaN)).toBe('—');
  });
});
