import { describe, expect, it } from 'vitest';
import { satnogsLikelyObserved, satnogsObservationsUrl } from './satnogsLinks';

describe('satnogsObservationsUrl', () => {
  it('links to the SatNOGS Network observations for that NORAD ID', () => {
    expect(satnogsObservationsUrl(44909)).toBe('https://network.satnogs.org/observations/?norad=44909');
  });
  it('refuses IDs that are not catalog numbers', () => {
    expect(satnogsObservationsUrl(0)).toBeNull();
    expect(satnogsObservationsUrl(-5)).toBeNull();
    expect(satnogsObservationsUrl(1.5)).toBeNull();
  });
});

describe('satnogsLikelyObserved', () => {
  const base = { service: 'Beacon', mode: 'CW' };
  it('is true for SatNOGS-sourced or amateur channels', () => {
    expect(satnogsLikelyObserved([{ ...base, sourceUrl: 'https://db.satnogs.org/satellite/44909/' }])).toBe(true);
    expect(satnogsLikelyObserved([{ ...base, sourceUrl: 'https://www.amsat.org/x', amateur: true }])).toBe(true);
  });
  it('is false for official non-amateur services and for no data', () => {
    expect(satnogsLikelyObserved([{ ...base, sourceUrl: 'https://www.gps.gov/x', amateur: false }])).toBe(false);
    expect(satnogsLikelyObserved(undefined)).toBe(false);
  });
});
