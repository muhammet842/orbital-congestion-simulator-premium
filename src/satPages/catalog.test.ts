import { describe, expect, it } from 'vitest';
import tleRaw from '../../public/data/tle.json?raw';
import { buildSatPageCatalog } from './catalog';
import { createTrackedObjects, prepareCatalog } from '../data/tleLoader';
import { validateDataset } from '../data/validateDataset';
import { buildRadioIndex, DEFAULT_RADIO_FILTERS, filterRadioEntries } from '../data/radioIndex';

const raw = JSON.parse(tleRaw) as { fetchedAt: string };
// The catalogue's own date, so the result does not depend on when the test runs.
const asOf = new Date(raw.fetchedAt);
const catalog = buildSatPageCatalog(raw, asOf);

describe('buildSatPageCatalog', () => {
  it('lists exactly the satellites of the Radio panel default view, in its order', () => {
    // The app's path: loadTleDataset → createTrackedObjects → RadioPanel.
    const { dataset } = validateDataset(raw);
    const objects = createTrackedObjects(prepareCatalog(dataset, asOf), asOf, () => {});
    const panel = filterRadioEntries(buildRadioIndex(objects), DEFAULT_RADIO_FILTERS).map((m) => m.entry.noradId);

    expect(panel.length).toBeGreaterThan(300);
    expect(catalog.entries.map((e) => e.noradId)).toEqual(panel);
  });

  it('lists amateur satellites first', () => {
    const firstOther = catalog.entries.findIndex((e) => !e.amateur);
    expect(firstOther).toBeGreaterThan(0);
    expect(catalog.entries.slice(firstOther).every((e) => !e.amateur)).toBe(true);
  });

  it('shows the ISS as one object with its docked parts, and no page for the parts', () => {
    const iss = catalog.entries.find((e) => e.noradId === 25544);
    expect(iss).toBeDefined();
    expect(iss?.category).toBe('stations');
    expect(iss?.dockedComponents?.length).toBeGreaterThan(0);
    const partIds = new Set(iss?.dockedComponents?.map((p) => p.noradId));
    expect(catalog.entries.some((e) => partIds.has(e.noradId))).toBe(false);
  });

  it('derives the orbit summary from the elements', () => {
    const iss = catalog.entries.find((e) => e.noradId === 25544);
    expect(iss?.layer).toBe('LEO');
    expect(iss?.inclinationDeg).toBeCloseTo(51.6, 0);
    expect(iss?.periodMin).toBeGreaterThan(91);
    expect(iss?.periodMin).toBeLessThan(94);
    expect(iss?.perigeeKm).toBeGreaterThan(350);
    expect(iss?.apogeeKm).toBeGreaterThanOrEqual(iss?.perigeeKm ?? Infinity);
    expect(iss?.apogeeKm).toBeLessThan(450);
  });

  it('uses the hand-checked frequencies where the app does (they replace the catalogue rows)', () => {
    const iss = catalog.entries.find((e) => e.noradId === 25544);
    expect(iss?.radioFrequencies.some((f) => f.service.includes('APRS'))).toBe(true);
    expect(iss?.listFrequenciesMHz).toContain(145.8);
  });

  it('keeps only receive frequencies inside the Easy band for the list', () => {
    for (const entry of catalog.entries) {
      expect(entry.listFrequenciesMHz.length).toBeGreaterThan(0);
      for (const f of entry.listFrequenciesMHz) {
        expect(f).toBeGreaterThanOrEqual(30);
        expect(f).toBeLessThanOrEqual(500);
      }
    }
  });
});
