import { describe, expect, it } from 'vitest';
import {
  degreesLat,
  degreesLong,
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
  type EciVec3,
} from 'satellite.js';
import {
  buildSkyScanPool,
  finalizeSkyScanHits,
  scanSkyCandidates,
  type SkyScanHit,
} from './skyScan';
import { skyFovCenterDistanceDeg } from './skyProjection';

/** ISS TLE near a known epoch — used only for elev filter shape, not absolute sky. */
function issObject() {
  const satrec = twoline2satrec(
    '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
    '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
  );
  return {
    noradId: 25544,
    name: 'ISS (ZARYA)',
    satrec,
    category: 'stations' as const,
    functionGroup: 'station' as const,
  };
}

describe('scanSkyCandidates', () => {
  const observer = { latitudeDeg: 41.01, longitudeDeg: 28.97, altitudeKm: 0.05 };
  const date = new Date('2019-06-05T12:00:00Z');
  const view = { headingDeg: 0, pitchDeg: 45 };

  it('excludes debris unless selected', () => {
    const debrisSat = issObject();
    const debris = {
      ...debrisSat,
      noradId: 99999,
      name: 'DEB',
      category: 'debris',
    };
    const hits = scanSkyCandidates([debris], observer, date, view, {
      includeDebris: false,
      selectedNoradId: null,
      maxCount: 50,
    });
    expect(hits.every((h) => h.noradId !== 99999)).toBe(true);
  });

  it('never returns below-horizon hits', () => {
    const hits = scanSkyCandidates([issObject()], observer, date, view, { maxCount: 20 });
    for (const h of hits) {
      expect(h.look.elevationDeg).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the selected NORAD first when above horizon', () => {
    const iss = issObject();
    // Stand right under the ISS so it is overhead, next to an identical twin
    // listed first: only the selection can put the ISS ahead of it.
    const pv = propagate(iss.satrec, date);
    const ground = eciToGeodetic(pv!.position as EciVec3<number>, gstime(date));
    const underIss = {
      latitudeDeg: degreesLat(ground.latitude),
      longitudeDeg: degreesLong(ground.longitude),
      altitudeKm: 0,
    };
    const twin = { ...issObject(), noradId: 11111, name: 'TWIN' };
    const hits = scanSkyCandidates([twin, iss], underIss, date, view, {
      selectedNoradId: 25544,
      maxCount: 5,
    });
    expect(hits.map((h) => h.noradId)).toEqual([25544, 11111]);
  });

  it('buildSkyScanPool prioritizes stations and caps size', () => {
    const objects = [];
    for (let i = 0; i < 500; i++) {
      objects.push({
        ...issObject(),
        noradId: i,
        name: i < 5 ? `STATION-${i}` : `SAT-${i}`,
        category: i < 5 ? ('stations' as const) : ('active' as const),
        functionGroup: i < 5 ? ('station' as const) : ('active' as const),
      });
    }
    const pool = buildSkyScanPool(objects, 42, 50);
    expect(pool.length).toBeLessThanOrEqual(50);
    expect(pool.some((o) => o.noradId === 42)).toBe(true);
    expect(pool.filter((o) => o.category === 'stations').length).toBe(5);
  });
});

describe('finalizeSkyScanHits near zenith', () => {
  it('prefers near-zenith sats over opposite-azimuth horizon ones', () => {
    const zenithView = { headingDeg: 0, pitchDeg: 90 };
    const near: SkyScanHit = {
      noradId: 1,
      name: 'NEAR',
      look: {
        azimuthDeg: 180,
        elevationDeg: 85,
        rangeKm: 500,
        visible: true,
      },
      centerDistDeg: skyFovCenterDistanceDeg(zenithView, {
        azimuthDeg: 180,
        elevationDeg: 85,
      }),
      functionGroup: 'active',
      category: 'active',
    };
    const far: SkyScanHit = {
      noradId: 2,
      name: 'FAR',
      look: {
        azimuthDeg: 0,
        elevationDeg: 10,
        rangeKm: 800,
        visible: true,
      },
      centerDistDeg: skyFovCenterDistanceDeg(zenithView, {
        azimuthDeg: 0,
        elevationDeg: 10,
      }),
      functionGroup: 'active',
      category: 'active',
    };
    expect(near.centerDistDeg).toBeLessThan(15);
    expect(far.centerDistDeg).toBeGreaterThan(60);
    const ranked = finalizeSkyScanHits([far, near], { maxCount: 1, fovDeg: 60 });
    expect(ranked[0].noradId).toBe(1);
  });
});
