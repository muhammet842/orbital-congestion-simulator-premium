import { describe, expect, it } from 'vitest';
import { enrichRecord, inferMetadata, isTurkishSatellite } from './objectMetadata';

describe('inferMetadata', () => {
  it('prioritizes the featured NORAD ID override above name matching', () => {
    // 41875 = GOKTURK-1, hardcoded in FEATURED_OVERRIDES regardless of name text.
    expect(inferMetadata('SOME UNRELATED NAME', 'active', 41875)).toEqual({
      country: 'Türkiye 🇹🇷',
      owner: 'TSK / TAI',
    });
  });

  it('matches well-known constellations by name', () => {
    expect(inferMetadata('STARLINK-3938', 'active', 999999)).toEqual({
      country: 'USA 🇺🇸',
      owner: 'SpaceX',
    });
  });

  it('falls back to an unclassified operator for unrecognized active satellites', () => {
    expect(inferMetadata('RANDOM-SAT-9999', 'active', 999999)).toEqual({
      country: 'Unknown 🌐',
      owner: 'Commercial / state operator (unclassified)',
    });
  });

  it('falls back to a generic catalogued fragment for unrecognized debris', () => {
    expect(inferMetadata('UNKNOWN FRAGMENT', 'debris', 999999)).toEqual({
      country: 'Unknown 🌐',
      owner: 'Catalogued debris fragment',
    });
  });

  it('attributes Russian-named debris to Roscosmos via the generic name rule', () => {
    // Note: the debris-specific "COSMOS 2251 (collision debris)" branch in
    // inferMetadata is currently unreachable — any name containing "COSMOS"
    // is already intercepted by the broader NAME_RULES entry first.
    expect(inferMetadata('COSMOS 2251 DEB', 'debris', 1)).toEqual({
      country: 'Russia 🇷🇺',
      owner: 'Roscosmos',
    });
  });

  it('gives stations a default international attribution when unmatched', () => {
    expect(inferMetadata('UNKNOWN STATION MODULE', 'stations', 999999)).toEqual({
      country: 'International 🌍',
      owner: 'Space Agency Consortium',
    });
  });
});

describe('isTurkishSatellite', () => {
  it('recognizes the Turkish flag label', () => {
    expect(isTurkishSatellite('Türkiye 🇹🇷')).toBe(true);
  });

  it('recognizes the English spelling', () => {
    expect(isTurkishSatellite('Turkey')).toBe(true);
  });

  it('rejects other countries', () => {
    expect(isTurkishSatellite('USA 🇺🇸')).toBe(false);
    expect(isTurkishSatellite('')).toBe(false);
  });
});

describe('enrichRecord', () => {
  it('infers country/owner when the record has none', () => {
    const record = { name: 'STARLINK-3938', category: 'active' as const, noradId: 1 };
    const enriched = enrichRecord(record);
    expect(enriched.country).toBe('USA 🇺🇸');
    expect(enriched.owner).toBe('SpaceX');
  });

  it('preserves an existing non-empty country/owner instead of overriding it', () => {
    const record = {
      name: 'STARLINK-3938',
      category: 'active' as const,
      noradId: 1,
      country: 'Custom Country',
      owner: 'Custom Owner',
    };
    const enriched = enrichRecord(record);
    expect(enriched.country).toBe('Custom Country');
    expect(enriched.owner).toBe('Custom Owner');
  });

  it('treats a blank/whitespace-only country as missing and infers instead', () => {
    const record = {
      name: 'STARLINK-3938',
      category: 'active' as const,
      noradId: 1,
      country: '   ',
      owner: '',
    };
    const enriched = enrichRecord(record);
    expect(enriched.country).toBe('USA 🇺🇸');
    expect(enriched.owner).toBe('SpaceX');
  });

  it('keeps SATCAT country and fills operator from name heuristics when owner is absent', () => {
    // Country-code SATCAT owners (US, SVK, …) only write `country` into
    // tle.json so constellation heuristics can still supply SpaceX etc.
    const record = {
      name: 'STARLINK-3938',
      category: 'active' as const,
      noradId: 1,
      country: 'USA 🇺🇸',
    };
    const enriched = enrichRecord(record);
    expect(enriched.country).toBe('USA 🇺🇸');
    expect(enriched.owner).toBe('SpaceX');
  });

  it('attributes MARINA via SATCAT country even without a name-rule owner', () => {
    const record = {
      name: 'MARINA',
      category: 'active' as const,
      noradId: 69920,
      country: 'Slovakia 🇸🇰',
    };
    const enriched = enrichRecord(record);
    expect(enriched.country).toBe('Slovakia 🇸🇰');
    // Featured override / name rule still supplies a better operator label.
    expect(enriched.owner).toBe('Amateur radio (OM9MAR)');
  });
});

describe('enrichRecord operator guesses', () => {
  it('does not show a guessed operator whose country contradicts the catalogue', () => {
    // "FUNCUBE" contains "NCUBE" (a Norwegian satellite family): the UK satellite must not get a Norwegian operator.
    const funcube = enrichRecord({ name: 'FUNCUBE-1 (AO-73)', category: 'active', noradId: 39444, country: 'United Kingdom 🇬🇧' });
    expect(funcube.owner).not.toMatch(/Norwegian/);
    expect(funcube.owner).toBe('Commercial / state operator (unclassified)');
    const skymed = enrichRecord({ name: 'COSMO-SKYMED 1', category: 'active', noradId: 31598, country: 'Italy 🇮🇹' });
    expect(skymed.owner).not.toMatch(/Optus/);
  });

  it('keeps a guessed operator when the countries agree, ignoring flags', () => {
    expect(enrichRecord({ name: 'NORSAT 2', category: 'active', noradId: 42828, country: 'Norway 🇳🇴' }).owner).toBe('Norwegian Space Agency');
    expect(enrichRecord({ name: 'STARLINK-3100', category: 'active', noradId: 1, country: 'USA' }).owner).toBe('SpaceX');
  });

  it('keeps the guess when the catalogue has no country', () => {
    expect(enrichRecord({ name: 'NORSAT 2', category: 'active', noradId: 42828 }).owner).toBe('Norwegian Space Agency');
  });
});
