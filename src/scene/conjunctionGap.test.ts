import { describe, expect, it } from 'vitest';
import { formatGap } from './ConjunctionLabels';

describe('formatGap', () => {
  it('shows kilometres to two decimals', () => {
    expect(formatGap(2.673)).toBe('2.67 km');
  });
  it('switches to metres under a kilometre', () => {
    expect(formatGap(0.06)).toBe('60 m');
  });
  it('is blank for a non-finite distance', () => {
    expect(formatGap(Number.NaN)).toBe('');
  });
});
