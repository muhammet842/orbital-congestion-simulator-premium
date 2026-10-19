import { describe, expect, it } from 'vitest';
import { CatalogPacer, MAX_CATALOG_INTERVAL_MS } from './catalogPacing';

describe('CatalogPacer', () => {
  it('updates every frame on a fast device', () => {
    const p = new CatalogPacer();
    p.done(0, 'k', 2); // 2 ms per update
    expect(p.intervalMs()).toBe(8);
    expect(p.isDue(16, 'k', false)).toBe(true); // next frame
  });

  it('spaces updates out on a slow device, within the ceiling', () => {
    const p = new CatalogPacer();
    p.done(0, 'k', 30); // 30 ms per update
    expect(p.intervalMs()).toBe(120);
    expect(p.isDue(60, 'k', false)).toBe(false);
    expect(p.isDue(120, 'k', false)).toBe(true);
    p.done(120, 'k', 400);
    expect(p.intervalMs()).toBe(MAX_CATALOG_INTERVAL_MS);
  });

  it('always updates at once when the user changes something or zooms in', () => {
    const p = new CatalogPacer();
    p.done(0, 'k', 100);
    expect(p.isDue(1, 'k', false)).toBe(false);
    expect(p.isDue(1, 'other filters', false)).toBe(true);
    expect(p.isDue(1, 'k', true)).toBe(true);
  });

  it('follows the measured cost smoothly instead of jumping on one slow frame', () => {
    const p = new CatalogPacer();
    p.done(0, 'k', 10);
    p.done(100, 'k', 110);
    expect(p.estimatedCostMs).toBeCloseTo(30);
  });
});
