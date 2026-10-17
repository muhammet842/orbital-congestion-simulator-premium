import { describe, expect, it } from 'vitest';
import { shouldEnableAnalytics } from './analytics';

describe('shouldEnableAnalytics', () => {
  it('counts visits only on a production build served from a real host', () => {
    expect(shouldEnableAnalytics(true, 'orbital-congestion.vercel.app')).toBe(true);
  });

  it('stays off in development and on local preview / e2e servers', () => {
    expect(shouldEnableAnalytics(false, 'orbital-congestion.vercel.app')).toBe(false);
    expect(shouldEnableAnalytics(true, 'localhost')).toBe(false);
    expect(shouldEnableAnalytics(true, '127.0.0.1')).toBe(false);
    expect(shouldEnableAnalytics(true, '[::1]')).toBe(false);
  });
});
