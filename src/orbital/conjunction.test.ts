import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conjunctionPairKey,
  conjunctionSessionKey,
  findCandidatePairsWithinRadius,
  findConjunctions,
  findUpcomingConjunctions,
  formatCloseApproachAlert,
  formatRelativeVelocityKmS,
  getConjunctions,
  getRiskAssessment,
  getUpcomingConjunctions,
  getVerificationRewindMs,
  invalidateConjunctionCache,
  invalidateUpcomingConjunctionCache,
  isCoOrbitingPair,
  linearClosestApproach,
  MAX_DISPLAY_ALERTS,
  MAX_STORED_ALERTS,
  UPCOMING_SAMPLE_STEP_MS,
  normalizeConjunctionAlert,
  rankConjunctionAlertsForDisplay,
  selectConjunctionAlertsForDisplay,
  countConjunctionOverflow,
  VERIFY_MIN_REWIND_MS,
  VERIFY_OPENING_SEPARATION_KM,
  VERIFY_REWIND_MS,
} from './conjunction';
import type { ConjunctionEvent, TrackedObject } from '../types';
import * as propagatorModule from './propagator';

type Vec3 = { x: number; y: number; z: number };

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe('getVerificationRewindMs', () => {
  it('keeps the full T−60s window for slow / co-orbiting pairs', () => {
    expect(getVerificationRewindMs(0.066)).toBe(VERIFY_REWIND_MS);
    expect(getVerificationRewindMs(0.4)).toBe(VERIFY_REWIND_MS);
    expect(getVerificationRewindMs(0)).toBe(VERIFY_REWIND_MS);
  });

  it('starts later for a 5 km/s crossing so the pair opens near ~80 km', () => {
    expect(getVerificationRewindMs(5)).toBe(Math.round((VERIFY_OPENING_SEPARATION_KM / 5) * 1000));
  });

  it('never starts closer than VERIFY_MIN_REWIND_MS', () => {
    expect(getVerificationRewindMs(50)).toBe(VERIFY_MIN_REWIND_MS);
  });
});

describe('rankConjunctionAlertsForDisplay', () => {
  function alert(partial: Partial<ConjunctionEvent> & Pick<ConjunctionEvent, 'objectA' | 'time' | 'distanceKm'>): ConjunctionEvent {
    return {
      objectB: 'B',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      relativeVelocityKmS: 7,
      midpointScene: { x: 0, y: 0, z: 0 },
      ...partial,
    };
  }

  it('lists the soonest CPA before a closer-but-later miss', () => {
    const soonFar = alert({
      objectA: 'SOON',
      time: new Date('2026-07-29T12:30:00Z'),
      distanceKm: 2.5,
    });
    const laterClose = alert({
      objectA: 'LATER',
      time: new Date('2026-07-29T18:00:00Z'),
      distanceKm: 0.2,
    });

    const ranked = rankConjunctionAlertsForDisplay([laterClose, soonFar]);
    expect(ranked.map((e) => e.objectA)).toEqual(['SOON', 'LATER']);
  });

  it('keeps only the soonest MAX_DISPLAY_ALERTS when sliced like the UI', () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      alert({
        objectA: `A${i}`,
        time: new Date(Date.UTC(2026, 6, 29, 12, i * 10)),
        // Later events are closer — distance-first ranking would invert the list.
        distanceKm: 3 - i * 0.3,
      }),
    );
    const top = rankConjunctionAlertsForDisplay(events).slice(0, MAX_DISPLAY_ALERTS);
    expect(top.map((e) => e.objectA)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4']);
  });
});

describe('selectConjunctionAlertsForDisplay', () => {
  const nowMs = Date.parse('2026-07-29T12:00:00Z');

  function alert(partial: Partial<ConjunctionEvent> & Pick<ConjunctionEvent, 'objectA' | 'time' | 'distanceKm'>): ConjunctionEvent {
    return {
      objectB: 'B',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      relativeVelocityKmS: 7,
      midpointScene: { x: 0, y: 0, z: 0 },
      ...partial,
    };
  }

  it('by time lists the soonest CPA within 24h first', () => {
    const soonFar = alert({
      objectA: 'SOON',
      time: new Date(nowMs + 2 * 3_600_000),
      distanceKm: 2.5,
    });
    const laterClose = alert({
      objectA: 'LATER',
      time: new Date(nowMs + 10 * 3_600_000),
      distanceKm: 0.2,
    });
    const visible = selectConjunctionAlertsForDisplay([laterClose, soonFar], {
      nowMs,
      sortMode: 'time',
    });
    expect(visible.map((e) => e.objectA)).toEqual(['SOON', 'LATER']);
  });

  it('by criticality lists the tightest miss distance first', () => {
    const soonFar = alert({
      objectA: 'SOON',
      time: new Date(nowMs + 2 * 3_600_000),
      distanceKm: 2.5,
    });
    const laterClose = alert({
      objectA: 'CLOSE',
      time: new Date(nowMs + 10 * 3_600_000),
      distanceKm: 0.2,
    });
    const visible = selectConjunctionAlertsForDisplay([soonFar, laterClose], {
      nowMs,
      sortMode: 'criticality',
    });
    expect(visible.map((e) => e.objectA)).toEqual(['CLOSE', 'SOON']);
  });

  it('caps at MAX_DISPLAY_ALERTS for both modes', () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      alert({
        objectA: `A${i}`,
        time: new Date(nowMs + (i + 1) * 60_000),
        distanceKm: 2.5 - i * 0.2,
      }),
    );
    const byTime = selectConjunctionAlertsForDisplay(events, { nowMs, sortMode: 'time' });
    const byCrit = selectConjunctionAlertsForDisplay(events, { nowMs, sortMode: 'criticality' });
    expect(byTime).toHaveLength(MAX_DISPLAY_ALERTS);
    expect(byCrit).toHaveLength(MAX_DISPLAY_ALERTS);
    expect(byTime.map((e) => e.objectA)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4']);
    expect(byCrit.map((e) => e.objectA)).toEqual(['A7', 'A6', 'A5', 'A4', 'A3']);
  });
});

describe('countConjunctionOverflow', () => {
  const nowMs = Date.parse('2026-07-29T12:00:00Z');

  function alert(partial: Partial<ConjunctionEvent> & Pick<ConjunctionEvent, 'objectA' | 'time' | 'distanceKm'>): ConjunctionEvent {
    return {
      objectB: 'B',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      relativeVelocityKmS: 7,
      midpointScene: { x: 0, y: 0, z: 0 },
      ...partial,
    };
  }

  it('is identical for time vs criticality display slices', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      alert({
        objectA: `A${i}`,
        time: new Date(nowMs + (i + 1) * 60_000),
        distanceKm: 2.5 - i * 0.1,
      }),
    );
    const byTime = selectConjunctionAlertsForDisplay(events, { nowMs, sortMode: 'time' });
    const byCrit = selectConjunctionAlertsForDisplay(events, { nowMs, sortMode: 'criticality' });
    const overflowTime = countConjunctionOverflow(events, {
      nowMs,
      displayedCount: byTime.length,
      hiddenCount: 3,
    });
    const overflowCrit = countConjunctionOverflow(events, {
      nowMs,
      displayedCount: byCrit.length,
      hiddenCount: 3,
    });
    expect(overflowTime).toBe(overflowCrit);
    expect(overflowTime).toBe(12 - MAX_DISPLAY_ALERTS + 3);
  });

  it('ignores CPAs outside the next 24h when counting the stored pool', () => {
    const events = [
      alert({ objectA: 'PAST', time: new Date(nowMs - 60_000), distanceKm: 0.5 }),
      alert({ objectA: 'SOON', time: new Date(nowMs + 60_000), distanceKm: 1 }),
      alert({ objectA: 'LATER', time: new Date(nowMs + 2 * 60_000), distanceKm: 1.2 }),
      alert({ objectA: 'FAR', time: new Date(nowMs + 30 * 3_600_000), distanceKm: 0.4 }),
    ];
    expect(
      countConjunctionOverflow(events, { nowMs, displayedCount: 2, hiddenCount: 0 }),
    ).toBe(0);
  });
});


/** Reference implementation: the exact O(n^2) scan the grid search replaces. */
function bruteForcePairsWithinRadius(positions: Vec3[], radiusKm: number): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (distance(positions[i], positions[j]) <= radiusKm) {
        pairs.add(`${i},${j}`);
      }
    }
  }
  return pairs;
}

function toPairKeySet(pairs: Array<[number, number]>): Set<string> {
  return new Set(pairs.map(([i, j]) => `${Math.min(i, j)},${Math.max(i, j)}`));
}

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function makeRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEvent(overrides: Partial<ConjunctionEvent> = {}): ConjunctionEvent {
  return {
    objectA: 'SAT-A',
    objectB: 'SAT-B',
    noradIdA: 100,
    noradIdB: 200,
    indexA: 0,
    indexB: 1,
    distanceKm: 1.5,
    relativeVelocityKmS: 1.2,
    time: new Date('2026-07-08T12:00:00.000Z'),
    midpointScene: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

describe('conjunctionPairKey', () => {
  it('is order-independent — same pair always produces the same key', () => {
    expect(conjunctionPairKey('SAT-A', 'SAT-B')).toBe(conjunctionPairKey('SAT-B', 'SAT-A'));
  });

  it('produces different keys for different pairs', () => {
    expect(conjunctionPairKey('SAT-A', 'SAT-B')).not.toBe(conjunctionPairKey('SAT-A', 'SAT-C'));
  });
});

describe('conjunctionSessionKey', () => {
  it('differs when the CPA time differs, even for the same pair', () => {
    const first = conjunctionSessionKey(makeEvent({ time: new Date('2026-07-08T12:00:00.000Z') }));
    const second = conjunctionSessionKey(makeEvent({ time: new Date('2026-07-08T13:00:00.000Z') }));
    expect(first).not.toBe(second);
  });

  it('differs when the object indices differ, even for the same names and time', () => {
    const first = conjunctionSessionKey(makeEvent({ indexA: 0, indexB: 1 }));
    const second = conjunctionSessionKey(makeEvent({ indexA: 2, indexB: 3 }));
    expect(first).not.toBe(second);
  });

  it('is stable for identical events', () => {
    const a = conjunctionSessionKey(makeEvent());
    const b = conjunctionSessionKey(makeEvent());
    expect(a).toBe(b);
  });
});

describe('getRiskAssessment', () => {
  it('classifies distance thresholds correctly, including boundaries', () => {
    expect(getRiskAssessment(10)).toBe('NO RISK');
    expect(getRiskAssessment(5)).toBe('NO RISK');
    expect(getRiskAssessment(4.999)).toBe('LOW RISK');
    expect(getRiskAssessment(3)).toBe('LOW RISK');
    expect(getRiskAssessment(2.999)).toBe('MONITORING');
    expect(getRiskAssessment(1)).toBe('MONITORING');
    expect(getRiskAssessment(0.999)).toBe('CRITICAL RISK');
    expect(getRiskAssessment(0)).toBe('CRITICAL RISK');
  });
});

describe('isCoOrbitingPair', () => {
  it('treats sub-threshold relative velocity as co-orbiting', () => {
    expect(isCoOrbitingPair(0.01)).toBe(true);
    expect(isCoOrbitingPair(0.049)).toBe(true);
  });

  it('treats at-or-above-threshold relative velocity as a crossing pair', () => {
    expect(isCoOrbitingPair(0.05)).toBe(false);
    expect(isCoOrbitingPair(1.2)).toBe(false);
  });
});

describe('formatRelativeVelocityKmS', () => {
  it('formats sub-10-m/s speeds in meters per second', () => {
    expect(formatRelativeVelocityKmS(0.005)).toBe('5.0 m/s');
  });

  it('formats sub-1-km/s speeds with 3 decimal places', () => {
    expect(formatRelativeVelocityKmS(0.05)).toBe('0.050 km/s');
  });

  it('formats speeds at or above 1 km/s with 2 decimal places', () => {
    expect(formatRelativeVelocityKmS(7.5)).toBe('7.50 km/s');
  });
});

describe('findCandidatePairsWithinRadius', () => {
  it('finds two points within radius', () => {
    const positions: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];
    const pairs = findCandidatePairsWithinRadius(positions, 3);
    expect(toPairKeySet(pairs)).toEqual(new Set(['0,1']));
  });

  it('excludes points farther apart than the radius', () => {
    const positions: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
    ];
    const pairs = findCandidatePairsWithinRadius(positions, 3);
    expect(pairs).toEqual([]);
  });

  it('finds pairs that straddle a grid cell boundary', () => {
    // With cell size == radius, points can be within radius of each other
    // while sitting in different (even non-adjacent-looking) grid cells —
    // this is exactly the case the 3x3x3 neighbor search must catch.
    const radius = 3;
    const positions: Vec3[] = [
      { x: 2.99, y: 0, z: 0 }, // just inside one cell
      { x: 3.01, y: 0, z: 0 }, // just inside the next cell, 0.02 km away
    ];
    const pairs = findCandidatePairsWithinRadius(positions, radius);
    expect(toPairKeySet(pairs)).toEqual(new Set(['0,1']));
  });

  it('never returns duplicate or self pairs', () => {
    const positions: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ];
    const pairs = findCandidatePairsWithinRadius(positions, 5);
    const keys = pairs.map(([i, j]) => `${i},${j}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [i, j] of pairs) {
      expect(i).not.toBe(j);
      expect(i).toBeLessThan(j);
    }
  });

  it('matches an exact brute-force O(n^2) scan over random point clouds', () => {
    const rng = makeRng(1337);
    const radius = 3;

    for (let trial = 0; trial < 20; trial++) {
      const positions: Vec3[] = Array.from({ length: 150 }, () => ({
        // Spread over a LEO-shell-like volume, with a tight sub-cluster so
        // some points are guaranteed to land within the radius of each other.
        x: (rng() - 0.5) * 20,
        y: (rng() - 0.5) * 20,
        z: (rng() - 0.5) * 20,
      }));

      const expected = bruteForcePairsWithinRadius(positions, radius);
      const actual = toPairKeySet(findCandidatePairsWithinRadius(positions, radius));
      expect(actual).toEqual(expected);
    }
  });

  it('returns no candidates for an empty or single-point input', () => {
    expect(findCandidatePairsWithinRadius([], 3)).toEqual([]);
    expect(findCandidatePairsWithinRadius([{ x: 0, y: 0, z: 0 }], 3)).toEqual([]);
  });
});

describe('formatCloseApproachAlert', () => {
  it('formats a human-readable close approach message', () => {
    expect(formatCloseApproachAlert('SAT-A', 'SAT-B', 1.234)).toBe(
      'SAT-A vs SAT-B - 1.23 km close approach!',
    );
  });
});

describe('getConjunctions — async refresh scheduling', () => {
  type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };
  type IdleCallback = (deadline: IdleDeadline) => void;

  beforeEach(() => {
    invalidateConjunctionCache();
  });

  afterEach(() => {
    invalidateConjunctionCache();
    vi.unstubAllGlobals();
  });

  /**
   * Regression test for a starvation bug: requestIdleCallback's `timeout`
   * option guarantees the callback eventually fires with `didTimeout: true`,
   * but a render-heavy page (this app draws thousands of objects every
   * frame) may never report a genuinely idle slice, so `timeRemaining()`
   * can stay near 0 forever. If the scheduler only checked `timeRemaining()`
   * without also checking `didTimeout`, it would keep deferring indefinitely
   * and the conjunction scan would never run — close approach alerts would
   * never appear in a busy browser tab even though the underlying detection
   * algorithm works fine.
   */
  it('still runs the scan once requestIdleCallback fires with didTimeout, even if timeRemaining stays near 0', () => {
    let capturedCallback: IdleCallback | null = null;
    const fakeRequestIdleCallback = vi.fn((cb: IdleCallback) => {
      capturedCallback = cb;
      return 1;
    });
    vi.stubGlobal('requestIdleCallback', fakeRequestIdleCallback);

    const onRefresh = vi.fn();
    const busyDeadline: IdleDeadline = { didTimeout: false, timeRemaining: () => 0 };

    getConjunctions([], new Date(), 1, onRefresh);
    expect(capturedCallback).not.toBeNull();

    // Simulate several busy frames where the browser never finds idle time —
    // each time it should defer again (schedule a new idle callback) rather
    // than force a scan through, and the listener must not fire yet.
    for (let i = 0; i < 5; i++) {
      const cb = capturedCallback!;
      capturedCallback = null;
      cb(busyDeadline);
      expect(capturedCallback).not.toBeNull(); // rescheduled
    }
    expect(onRefresh).not.toHaveBeenCalled();

    // The timeout budget is exhausted: didTimeout is true. Even though
    // timeRemaining() is still 0, the scan must run now.
    capturedCallback!({ didTimeout: true, timeRemaining: () => 0 });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith({ alerts: [], hiddenCount: 0 });
  });

  it('runs the scan immediately when the browser reports a real idle slice', () => {
    let capturedCallback: IdleCallback | null = null;
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: IdleCallback) => {
        capturedCallback = cb;
        return 1;
      }),
    );

    const onRefresh = vi.fn();
    getConjunctions([], new Date(), 1, onRefresh);

    capturedCallback!({ didTimeout: false, timeRemaining: () => 50 });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('findConjunctions — narrow high-speed window detection', () => {
  const CPA_MS = new Date('2026-07-08T12:00:00.000Z').getTime();
  // 16 km/s closing speed (8 km/s each, head-on), 2.4 km minimum separation.
  // Distance <= 3km only for |dt| <= 112.5ms around CPA — a ~225ms window,
  // the same order of magnitude as the real 0.5-2.6s windows found for fast
  // LEO crossings. A naive point-sample at the wrong instant would see this
  // pair many km apart and never flag it as a candidate at all.
  const REL_VELOCITY_KM_S = 16;
  const MIN_SEPARATION_KM = 2.4;

  function makeFastPair(): TrackedObject[] {
    const base = {
      country: 'US',
      owner: 'TEST',
      layer: 'LEO' as const,
      color: [1, 1, 1] as [number, number, number],
      functionGroup: 'debris' as const,
      meanAltitudeKm: 550,
      inclinationDeg: 53,
    };
    return [
      {
        ...base,
        noradId: 1,
        name: 'FAST-A',
        line1: 'A-LINE-1',
        line2: 'A-LINE-2',
        category: 'debris',
        satrec: { id: 'A' } as unknown as TrackedObject['satrec'],
      },
      {
        ...base,
        noradId: 2,
        name: 'FAST-B',
        line1: 'B-LINE-1',
        line2: 'B-LINE-2',
        category: 'debris',
        satrec: { id: 'B' } as unknown as TrackedObject['satrec'],
      },
    ];
  }

  beforeEach(() => {
    invalidateConjunctionCache();
    // Straight-line relative motion standing in for real orbital mechanics —
    // this test is only exercising the scan/refine scheduling logic, not
    // SGP4 itself (that's covered elsewhere).
    vi.spyOn(propagatorModule, 'propagateObject').mockImplementation((satrec, date) => {
      const id = (satrec as unknown as { id: string }).id;
      const dtSec = (date.getTime() - CPA_MS) / 1000;
      const sign = id === 'A' ? 1 : -1;
      return {
        positionEci: {
          x: sign * (REL_VELOCITY_KM_S / 2) * dtSec,
          y: id === 'A' ? 0 : MIN_SEPARATION_KM,
          z: 0,
        },
        velocityEci: { x: sign * (REL_VELOCITY_KM_S / 2), y: 0, z: 0 },
        altitudeKm: 550,
        velocityKmS: REL_VELOCITY_KM_S / 2,
        inclinationDeg: 53,
        layer: 'LEO',
      };
    });
  });

  afterEach(() => {
    invalidateConjunctionCache();
    vi.restoreAllMocks();
  });

  it('finds the close approach even when sampled ~0.7s away from the true CPA', () => {
    const objects = makeFastPair();
    // At dt=700ms the literal instantaneous distance is ~11.5 km — far
    // outside the 3km alert threshold — so this only succeeds if the coarse
    // pass casts a wider net and the fine refine locates the true 2.4km
    // minimum nearby.
    const sampleTime = new Date(CPA_MS + 700);
    const result = findConjunctions(objects, sampleTime);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].distanceKm).toBeCloseTo(MIN_SEPARATION_KM, 1);
    expect(Math.abs(result.alerts[0].time.getTime() - CPA_MS)).toBeLessThan(200);
  });

  it('finds the close approach when sampled ~1s away from the true CPA', () => {
    const objects = makeFastPair();
    const sampleTime = new Date(CPA_MS - 1000);
    const result = findConjunctions(objects, sampleTime);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].distanceKm).toBeCloseTo(MIN_SEPARATION_KM, 1);
  });

  it('does not fabricate an alert once the pair is well outside the detection net', () => {
    const objects = makeFastPair();
    // At dt=3s the pair is ~48km apart — outside even the widened
    // detection radius, so no candidate should be generated at all.
    const sampleTime = new Date(CPA_MS + 3000);
    const result = findConjunctions(objects, sampleTime);

    expect(result.alerts).toHaveLength(0);
  });
});

describe('findUpcomingConjunctions — forward-looking 24h screen', () => {
  const SAMPLE_STEP_MS = 30 * 60 * 1000; // 30 min
  const HORIZON_MS = 6 * SAMPLE_STEP_MS; // 3h, i.e. 6 samples (steps 0..6)
  const REL_VELOCITY_KM_S = 0.5;
  const MIN_SEPARATION_KM = 2.0;

  function makeSlowPair(): TrackedObject[] {
    const base = {
      country: 'US',
      owner: 'TEST',
      layer: 'LEO' as const,
      color: [1, 1, 1] as [number, number, number],
      functionGroup: 'debris' as const,
      meanAltitudeKm: 550,
      inclinationDeg: 53,
    };
    return [
      {
        ...base,
        noradId: 10,
        name: 'SLOW-A',
        line1: 'A-LINE-1',
        line2: 'A-LINE-2',
        category: 'debris',
        satrec: { id: 'A' } as unknown as TrackedObject['satrec'],
      },
      {
        ...base,
        noradId: 20,
        name: 'SLOW-B',
        line1: 'B-LINE-1',
        line2: 'B-LINE-2',
        category: 'debris',
        satrec: { id: 'B' } as unknown as TrackedObject['satrec'],
      },
    ];
  }

  /** Linear relative motion whose true closest approach sits exactly at `cpaMs`. */
  function mockLinearApproach(cpaMs: number): void {
    const impl = (satrec: unknown, date: Date) => {
      const id = (satrec as unknown as { id: string }).id;
      const dtSec = (date.getTime() - cpaMs) / 1000;
      const sign = id === 'A' ? 1 : -1;
      return {
        positionEci: {
          x: sign * (REL_VELOCITY_KM_S / 2) * dtSec,
          y: id === 'A' ? 0 : MIN_SEPARATION_KM,
          z: 0,
        },
        velocityEci: { x: sign * (REL_VELOCITY_KM_S / 2), y: 0, z: 0 },
        altitudeKm: 550,
        velocityKmS: REL_VELOCITY_KM_S / 2,
        inclinationDeg: 53,
        layer: 'LEO' as const,
      };
    };
    vi.spyOn(propagatorModule, 'propagateObject').mockImplementation(impl);
    vi.spyOn(propagatorModule, 'propagateState').mockImplementation(impl);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('predicts an approach whose CPA lands on one of the sampled snapshots', () => {
    const objects = makeSlowPair();
    const startMs = Date.now();
    // Align the true CPA exactly on the 3rd sample so the coarse pass is
    // guaranteed to see it well inside the detection net.
    const cpaMs = startMs + 3 * SAMPLE_STEP_MS;
    mockLinearApproach(cpaMs);

    const result = findUpcomingConjunctions(objects, new Date(startMs), HORIZON_MS, SAMPLE_STEP_MS);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].distanceKm).toBeCloseTo(MIN_SEPARATION_KM, 1);
    expect(Math.abs(result.alerts[0].time.getTime() - cpaMs)).toBeLessThan(5_000);
    // This is the whole point of the feature: the predicted event is in the
    // future relative to the scan's start time, not "happening right now".
    expect(result.alerts[0].time.getTime()).toBeGreaterThan(startMs);
  });

  it('reports nothing when the pair never comes within the detection radius', () => {
    const objects = makeSlowPair();
    const startMs = Date.now();
    // CPA far outside the horizon entirely — never sampled anywhere close.
    mockLinearApproach(startMs + 30 * HORIZON_MS);

    const result = findUpcomingConjunctions(objects, new Date(startMs), HORIZON_MS, SAMPLE_STEP_MS);

    expect(result.alerts).toHaveLength(0);
  });

  it('does not report a predicted approach whose true CPA falls outside the requested horizon', () => {
    const objects = makeSlowPair();
    const startMs = Date.now();
    // The last sample (step 6) sits at startMs + HORIZON_MS. Put the true
    // CPA just 60s beyond that — at 0.5 km/s relative velocity the raw
    // distance at the last sample is only ~30 km (well inside the 50 km
    // detection radius), so this specifically exercises the horizon
    // boundary clip on the *refined* CPA time, not "too far away to notice
    // at all".
    const cpaMs = startMs + HORIZON_MS + 60 * 1000;
    mockLinearApproach(cpaMs);

    const result = findUpcomingConjunctions(objects, new Date(startMs), HORIZON_MS, SAMPLE_STEP_MS);

    expect(result.alerts).toHaveLength(0);
  });
});

describe('upcoming sweep — fast crossings between samples', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  type Pair = { id: number; cpaMs: number; missKm: number; relV: number };

  /** Straight-line crossings: each pair's objects meet head-on at `cpaMs`
   *  with the given miss distance, far from every other pair. */
  function mockCrossings(pairs: Pair[]): TrackedObject[] {
    const objects: TrackedObject[] = [];
    for (const p of pairs) {
      for (const side of [0, 1]) {
        objects.push({
          noradId: p.id * 10 + side,
          name: `P${p.id}-${side}`,
          line1: `L1-${p.id}-${side}`,
          line2: `L2-${p.id}-${side}`,
          category: 'debris',
          country: 'US',
          owner: 'TEST',
          layer: 'LEO',
          color: [1, 1, 1],
          functionGroup: 'debris',
          meanAltitudeKm: 550,
          inclinationDeg: 53,
          satrec: { pair: p, side } as unknown as TrackedObject['satrec'],
        });
      }
    }
    const impl = (satrec: unknown, date: Date) => {
      const { pair, side } = satrec as { pair: Pair; side: number };
      const dt = (date.getTime() - pair.cpaMs) / 1000;
      const sign = side === 0 ? 1 : -1;
      const v = sign * (pair.relV / 2);
      // Pairs sit 100,000 km apart from each other along z.
      return {
        positionEci: { x: v * dt, y: side === 0 ? 0 : pair.missKm, z: pair.id * 100_000 },
        velocityEci: { x: v, y: 0, z: 0 },
        altitudeKm: 550,
        velocityKmS: Math.abs(v),
        inclinationDeg: 53,
        layer: 'LEO' as const,
      };
    };
    vi.spyOn(propagatorModule, 'propagateObject').mockImplementation(impl);
    vi.spyOn(propagatorModule, 'propagateState').mockImplementation(impl);
    return objects;
  }

  it('finds a 14 km/s crossing whose CPA falls between two samples, with exact distance and time', () => {
    const startMs = Date.UTC(2026, 0, 1);
    // 17 s past a sample: the pair is ~240 km apart at both neighbouring
    // samples, far outside any fixed snapshot net.
    const cpaMs = startMs + 5 * UPCOMING_SAMPLE_STEP_MS + 17_000;
    const objects = mockCrossings([{ id: 1, cpaMs, missKm: 1.2, relV: 14 }]);

    const result = findUpcomingConjunctions(objects, new Date(startMs), 10 * UPCOMING_SAMPLE_STEP_MS);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].distanceKm).toBeCloseTo(1.2, 6);
    expect(Math.abs(result.alerts[0].time.getTime() - cpaMs)).toBeLessThanOrEqual(1);
    expect(result.alerts[0].relativeVelocityKmS).toBeCloseTo(14, 6);
  });

  it('reports sub-100 m crossings (the most dangerous ones)', () => {
    const startMs = Date.UTC(2026, 0, 1);
    const cpaMs = startMs + 3 * UPCOMING_SAMPLE_STEP_MS + 29_000;
    const objects = mockCrossings([{ id: 1, cpaMs, missKm: 0.04, relV: 10 }]);

    const result = findUpcomingConjunctions(objects, new Date(startMs), 10 * UPCOMING_SAMPLE_STEP_MS);

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].distanceKm).toBeCloseTo(0.04, 6);
  });

  it('keeps both the soonest and the tightest approaches in the stored pool', () => {
    const startMs = Date.UTC(2026, 0, 1);
    const count = MAX_STORED_ALERTS + 10;
    // Later pairs are tighter, so a "soonest only" pool would drop them.
    const pairs = Array.from({ length: count }, (_, k) => ({
      id: k + 1,
      cpaMs: startMs + (k + 1) * UPCOMING_SAMPLE_STEP_MS + 7_000,
      missKm: 2.9 - k * 0.05,
      relV: 12,
    }));
    const objects = mockCrossings(pairs);

    const result = findUpcomingConjunctions(objects, new Date(startMs), (count + 2) * UPCOMING_SAMPLE_STEP_MS);

    const tightest = Math.min(...result.alerts.map((a) => a.distanceKm));
    expect(tightest).toBeCloseTo(2.9 - (count - 1) * 0.05, 6);
    expect(result.alerts.length + result.hiddenCount).toBe(count);
  });
});

describe('linearClosestApproach', () => {
  it('solves the CPA of straight-line relative motion', () => {
    const { tauSec, missKm } = linearClosestApproach({ x: -100, y: 3, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(tauSec).toBeCloseTo(10, 9);
    expect(missKm).toBeCloseTo(3, 9);
  });

  it('treats zero relative velocity as "closest now"', () => {
    const { tauSec, missKm } = linearClosestApproach({ x: 3, y: 4, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(tauSec).toBe(0);
    expect(missKm).toBeCloseTo(5, 9);
  });
});

describe('getUpcomingConjunctions — async, incremental scheduling', () => {
  type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };
  type IdleCallback = (deadline: IdleDeadline) => void;

  beforeEach(() => {
    invalidateUpcomingConjunctionCache();
  });

  afterEach(() => {
    invalidateUpcomingConjunctionCache();
    vi.unstubAllGlobals();
  });

  it('spreads a full sweep across many small idle-time slices before reporting a result', () => {
    const scheduled: IdleCallback[] = [];
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: IdleCallback) => {
        scheduled.push(cb);
        return scheduled.length;
      }),
    );

    const onUpdate = vi.fn();
    // Empty object list keeps every snapshot trivial (no LEO entries to
    // propagate) — this test only exercises the *scheduling* shape (many
    // small slices, self-rescheduling until done), not the scan itself.
    getUpcomingConjunctions([], new Date(), onUpdate);

    expect(scheduled.length).toBe(1);
    expect(onUpdate).not.toHaveBeenCalled();

    let guard = 0;
    while (onUpdate.mock.calls.length === 0 && guard < 5000) {
      const cb = scheduled[scheduled.length - 1];
      cb({ didTimeout: false, timeRemaining: () => 50 });
      guard++;
    }

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ alerts: [], hiddenCount: 0 });
    // A real sweep is many snapshots — this must not have finished in one shot.
    expect(guard).toBeGreaterThan(1);
  });

  it('regression: propagating one snapshot is itself chunked across multiple idle slices for a large catalog', () => {
    // This is the actual fix for a reported stutter: previously a single
    // idle callback propagated *every* LEO object for a snapshot in one
    // synchronous burst (thousands of SGP4 calls, 50-150ms+ on a real
    // catalog) before yielding back to the browser. It must instead take
    // several small idle slices to get through just one snapshot's worth
    // of objects when the catalog is large.
    const bigCatalog: TrackedObject[] = Array.from({ length: 1200 }, (_, i) => ({
      noradId: i,
      name: `OBJ-${i}`,
      line1: 'LINE-1',
      line2: 'LINE-2',
      category: 'debris' as const,
      country: 'US',
      owner: 'TEST',
      layer: 'LEO' as const,
      color: [1, 1, 1] as [number, number, number],
      functionGroup: 'debris' as const,
      meanAltitudeKm: 550,
      inclinationDeg: 53,
      satrec: { id: i } as unknown as TrackedObject['satrec'],
    }));

    const propagateSpy = vi.spyOn(propagatorModule, 'propagateState').mockReturnValue({
      positionEci: { x: 0, y: 0, z: 0 },
      velocityEci: { x: 0, y: 0, z: 0 },
    });

    const scheduled: IdleCallback[] = [];
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: IdleCallback) => {
        scheduled.push(cb);
        return scheduled.length;
      }),
    );

    getUpcomingConjunctions(bigCatalog, new Date(), vi.fn());
    expect(scheduled.length).toBe(1);

    // Fire exactly one idle slice — with 1200 objects and a chunk size well
    // under that, this must NOT have propagated the entire catalog yet.
    scheduled[0]({ didTimeout: false, timeRemaining: () => 50 });
    expect(propagateSpy.mock.calls.length).toBeGreaterThan(0);
    expect(propagateSpy.mock.calls.length).toBeLessThan(bigCatalog.length);

    propagateSpy.mockRestore();
  });

  it('regression: no single idle-time slice takes long enough to visibly stutter, even for a large, spread-out catalog', { retry: 2, timeout: 30_000 }, () => {
    // This targets a second stutter source found after the fix above: the
    // spatial-hash candidate search (grid build + neighbor query) for one
    // snapshot was still run as a single synchronous, unchunked call and
    // measured ~20-35ms on the real ~9,800-object catalog by itself — on
    // top of propagation, that's enough to blow a frame budget. Objects are
    // spread far apart here (no real candidates) so the refine phase stays
    // cheap and this isolates the search-phase cost specifically.
    const N = 3000;
    const bigCatalog: TrackedObject[] = Array.from({ length: N }, (_, i) => ({
      noradId: i,
      name: `OBJ-${i}`,
      line1: 'LINE-1',
      line2: 'LINE-2',
      category: 'debris' as const,
      country: 'US',
      owner: 'TEST',
      layer: 'LEO' as const,
      color: [1, 1, 1] as [number, number, number],
      functionGroup: 'debris' as const,
      meanAltitudeKm: 550,
      inclinationDeg: 53,
      satrec: { id: i } as unknown as TrackedObject['satrec'],
    }));

    const propagateSpy = vi.spyOn(propagatorModule, 'propagateState').mockImplementation((satrec) => {
      const id = (satrec as unknown as { id: number }).id;
      return {
        positionEci: { x: id * 10_000, y: 0, z: 0 },
        velocityEci: { x: 0, y: 0, z: 0 },
        altitudeKm: 550,
        velocityKmS: 7.5,
        inclinationDeg: 53,
        layer: 'LEO',
      };
    });

    const scheduled: IdleCallback[] = [];
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: IdleCallback) => {
        scheduled.push(cb);
        return scheduled.length;
      }),
    );

    let finished = false;
    getUpcomingConjunctions(bigCatalog, new Date(), () => {
      finished = true;
    });

    let maxCallMs = 0;
    let guard = 0;
    while (!finished && guard < 30_000) {
      const cb = scheduled[scheduled.length - 1];
      const t0 = performance.now();
      cb({ didTimeout: false, timeRemaining: () => 50 });
      maxCallMs = Math.max(maxCallMs, performance.now() - t0);
      guard++;
      // The spy records every call; a full 60 s-cadence sweep is millions of
      // them, so drop the history to keep memory flat.
      if (guard % 20 === 0) propagateSpy.mockClear();
    }

    expect(finished).toBe(true);
    // Generous ceiling for a slow/contended CI machine — the pre-fix
    // unchunked search alone measured 20-35ms on a real catalog a third
    // this size, so 250ms still comfortably catches a regression back to
    // "search the whole grid in one call" (which would land in the
    // seconds range for a 3,000-object catalog) without being flaky on
    // ordinary timing noise from other tests/workers competing for the
    // CPU when the full suite runs concurrently. A `retry` is layered on
    // top as a second line of defense against a one-off scheduler hiccup.
    expect(maxCallMs).toBeLessThan(250);
  });

  it('does not start a second sweep while one is still in progress', () => {
    const scheduled: IdleCallback[] = [];
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: IdleCallback) => {
        scheduled.push(cb);
        return scheduled.length;
      }),
    );

    const onUpdate = vi.fn();
    getUpcomingConjunctions([], new Date(), onUpdate);
    expect(scheduled.length).toBe(1);

    // Scan is still mid-flight — this must not kick off a second, concurrent sweep.
    getUpcomingConjunctions([], new Date(), onUpdate);
    expect(scheduled.length).toBe(1);
  });

  it('regression: a stale idle callback after invalidate must not publish an empty wipe', () => {
    const scheduled: IdleCallback[] = [];
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((cb: IdleCallback) => {
        scheduled.push(cb);
        return scheduled.length;
      }),
    );

    const onUpdate = vi.fn();
    getUpcomingConjunctions([], new Date(), onUpdate);
    expect(scheduled.length).toBe(1);

    // Tear the sweep down the way exiting verification / refreshing does.
    // The already-queued idle callback must not then push `{ alerts: [] }`
    // into the UI and blank out cards.
    invalidateUpcomingConjunctionCache();
    scheduled[0]!({ didTimeout: false, timeRemaining: () => 50 });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('normalizeConjunctionAlert — duplicate display names', () => {
  /**
   * Regression test: debris fields routinely contain dozens of fragments
   * that all share the exact same catalog display name (e.g. "FENGYUN 1C
   * DEB"). Re-resolving a stored alert's indices by name alone collapses
   * both objects to whichever one the array scan hits first, comparing an
   * object against itself — live separation reads 0.000 km, relative
   * velocity reads 0, while the frozen CPA distance (computed correctly at
   * detection time, before re-resolution) still shows its real value. NORAD
   * ID is the only field that's actually unique per object.
   */
  function makeDuplicateNamedObjects(): TrackedObject[] {
    const base = {
      name: 'FENGYUN 1C DEB',
      country: 'PRC',
      owner: 'PRC',
      layer: 'LEO' as const,
      color: [1, 1, 1] as [number, number, number],
      functionGroup: 'debris' as const,
      meanAltitudeKm: 850,
      inclinationDeg: 98.8,
      category: 'debris' as const,
      satrec: {} as unknown as TrackedObject['satrec'],
    };
    return [
      { ...base, noradId: 111, line1: 'LINE-1-A', line2: 'LINE-2-A' },
      { ...base, noradId: 222, line1: 'LINE-1-B', line2: 'LINE-2-B' },
    ];
  }

  beforeEach(() => {
    vi.spyOn(propagatorModule, 'propagateObject').mockImplementation(() => ({
      positionEci: { x: 1, y: 2, z: 3 },
      velocityEci: { x: 1, y: 0, z: 0 },
      altitudeKm: 850,
      velocityKmS: 7.5,
      inclinationDeg: 98.8,
      layer: 'LEO',
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves same-named objects to their distinct indices via NORAD ID, not the first name match', () => {
    const objects = makeDuplicateNamedObjects();
    const alert: ConjunctionEvent = {
      objectA: 'FENGYUN 1C DEB',
      objectB: 'FENGYUN 1C DEB',
      noradIdA: 222,
      noradIdB: 111,
      indexA: 1,
      indexB: 0,
      distanceKm: 2.55,
      relativeVelocityKmS: 6.2,
      time: new Date('2026-07-19T18:15:56.000Z'),
      midpointScene: { x: 0, y: 0, z: 0 },
    };

    const frozen = normalizeConjunctionAlert(alert, objects);

    expect(frozen).not.toBeNull();
    expect(frozen!.indexA).toBe(1);
    expect(frozen!.indexB).toBe(0);
    expect(frozen!.indexA).not.toBe(frozen!.indexB);
  });

  it('refuses to resolve when NORAD ID lookup degenerates to the same object', () => {
    const objects = makeDuplicateNamedObjects();
    const alert: ConjunctionEvent = {
      objectA: 'FENGYUN 1C DEB',
      objectB: 'FENGYUN 1C DEB',
      noradIdA: 111,
      noradIdB: 111,
      indexA: 0,
      indexB: 0,
      distanceKm: 2.55,
      relativeVelocityKmS: 6.2,
      time: new Date('2026-07-19T18:15:56.000Z'),
      midpointScene: { x: 0, y: 0, z: 0 },
    };

    expect(normalizeConjunctionAlert(alert, objects)).toBeNull();
  });
});
