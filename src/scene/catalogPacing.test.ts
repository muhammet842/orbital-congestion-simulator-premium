import { describe, expect, it } from 'vitest';
import { CatalogPacer, MAX_CATALOG_INTERVAL_MS, MOTION_INTERVAL_AT_1X_MS, motionIntervalMs } from './catalogPacing';

describe('CatalogPacer', () => {
  it('does not redo the catalogue every frame at 1x, where dots move less than a pixel', () => {
    const p = new CatalogPacer();
    p.done(0, 'k', 2); // a fast device: 2 ms per update
    expect(p.intervalMs(1)).toBe(MOTION_INTERVAL_AT_1X_MS);
    expect(p.isDue(16, 'k', false, 1)).toBe(false); // next frame
    expect(p.isDue(MOTION_INTERVAL_AT_1X_MS, 'k', false, 1)).toBe(true);
  });

  it('updates every frame on a fast device when the clock runs fast', () => {
    const p = new CatalogPacer();
    p.done(0, 'k', 2);
    expect(p.intervalMs(100)).toBe(8); // cost-based: 2 ms × 4
    expect(p.isDue(16, 'k', false, 100)).toBe(true);
  });

  it('spaces updates out on a slow device, within the ceiling', () => {
    const p = new CatalogPacer();
    p.done(0, 'k', 30); // 30 ms per update
    expect(p.intervalMs(100)).toBe(120);
    expect(p.isDue(60, 'k', false, 100)).toBe(false);
    expect(p.isDue(120, 'k', false, 100)).toBe(true);
    p.done(120, 'k', 400);
    expect(p.intervalMs(100)).toBe(MAX_CATALOG_INTERVAL_MS);
  });

  it('shortens the motion interval in proportion to the clock speed', () => {
    expect(motionIntervalMs(1)).toBe(MOTION_INTERVAL_AT_1X_MS);
    expect(motionIntervalMs(10)).toBe(MOTION_INTERVAL_AT_1X_MS / 10);
    expect(motionIntervalMs(0.5)).toBe(MOTION_INTERVAL_AT_1X_MS); // paused/slow clocks: no faster than 1x
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
