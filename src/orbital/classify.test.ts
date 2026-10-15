import { describe, expect, it } from 'vitest';
import {
  classifyOrbit,
  getCategoryColor,
  getCategoryScale,
  getFunctionGroupColor,
  getLayerColor,
  inferFunctionGroup,
} from './classify';

describe('classifyOrbit', () => {
  it('classifies low altitude, low eccentricity orbits as LEO', () => {
    expect(classifyOrbit(0, 0)).toBe('LEO');
    expect(classifyOrbit(420, 0.001)).toBe('LEO'); // ISS-like
    expect(classifyOrbit(1999, 0.1)).toBe('LEO');
  });

  it('classifies mid altitude orbits as MEO', () => {
    expect(classifyOrbit(2000, 0)).toBe('MEO');
    expect(classifyOrbit(20200, 0.01)).toBe('MEO'); // GPS-like
    expect(classifyOrbit(35786 * 0.9 - 1, 0)).toBe('MEO');
  });

  it('classifies orbits near the geostationary belt as GEO', () => {
    expect(classifyOrbit(35786, 0)).toBe('GEO');
    expect(classifyOrbit(35786 + 499, 0.01)).toBe('GEO');
    expect(classifyOrbit(35786 - 499, 0.01)).toBe('GEO');
  });

  it('classifies highly eccentric orbits as HEO regardless of altitude', () => {
    expect(classifyOrbit(500, 0.26)).toBe('HEO');
    expect(classifyOrbit(35786, 0.3)).toBe('HEO');
  });

  it('falls through to HEO outside the GEO tolerance band, including the MEO/GEO gap', () => {
    // Documents current threshold behavior: altitudes between the MEO cutoff
    // (35786 * 0.9) and the GEO tolerance band (35786 +/- 500) are neither —
    // they fall through to HEO even at low eccentricity.
    expect(classifyOrbit(35786 + 501, 0.01)).toBe('HEO');
    expect(classifyOrbit(35786 * 0.9, 0.01)).toBe('HEO');
  });
});

describe('getLayerColor', () => {
  it('returns a distinct RGB triple for every orbit layer', () => {
    const layers = ['LEO', 'MEO', 'GEO', 'HEO'] as const;
    const colors = layers.map((layer) => getLayerColor(layer).join(','));
    expect(new Set(colors).size).toBe(layers.length);
  });
});

describe('getCategoryColor', () => {
  it('treats Turkish and other countries the same for coloring', () => {
    expect(getCategoryColor('active', 'GEO', 'Türkiye 🇹🇷')).toEqual(
      getCategoryColor('active', 'GEO', 'USA 🇺🇸'),
    );
  });

  it('gives stations a distinct near-white color', () => {
    expect(getCategoryColor('stations', 'LEO')).toEqual([0.95, 0.98, 1.0]);
  });
});

describe('getCategoryScale', () => {
  it('does not enlarge Turkish satellites beyond their category scale', () => {
    expect(getCategoryScale('active', 'Türkiye 🇹🇷')).toBe(getCategoryScale('active'));
  });

  it('scales stations largest among categories', () => {
    const stationScale = getCategoryScale('stations');
    const activeScale = getCategoryScale('active');
    const debrisScale = getCategoryScale('debris');
    expect(stationScale).toBeGreaterThan(activeScale);
    expect(activeScale).toBeGreaterThan(debrisScale);
  });
});

describe('inferFunctionGroup', () => {
  it('classifies debris and stations by category first', () => {
    expect(inferFunctionGroup('STARLINK-1234', 'debris')).toBe('debris');
    expect(inferFunctionGroup('ANY NAME', 'stations')).toBe('station');
  });

  it('classifies Starlink satellites by name', () => {
    expect(inferFunctionGroup('STARLINK-3938', 'active')).toBe('starlink');
  });

  it('puts satellites with an amateur-radio channel in their own group', () => {
    expect(inferFunctionGroup('FUNCUBE-1 (AO-73)', 'active', true)).toBe('amateur');
    // Stations and Starlink keep their group even with amateur equipment (the ISS has an amateur station).
    expect(inferFunctionGroup('ISS (ZARYA)', 'stations', true)).toBe('station');
    expect(inferFunctionGroup('FUNCUBE-1 (AO-73)', 'active')).toBe('active');
  });

  it('falls back to "active" for other operational satellites', () => {
    expect(inferFunctionGroup('GOKTURK-1', 'active')).toBe('active');
  });
});

describe('getFunctionGroupColor', () => {
  it('returns a distinct color per function group', () => {
    const groups = ['starlink', 'debris', 'station', 'active', 'amateur'] as const;
    const colors = groups.map((group) => getFunctionGroupColor(group).join(','));
    expect(new Set(colors).size).toBe(groups.length);
  });
});
