import { describe, expect, it } from 'vitest';
import {
  classifyOutlook,
  clampScenarioParams,
  DEFAULT_KESSLER_SCENARIO,
  KESSLER_PRESETS,
  projectKesslerTimeline,
  REAL_WORLD_BASELINE_OBJECTS,
} from './kesslerProjection';

describe('projectKesslerTimeline', () => {
  it('returns one point per projected year', () => {
    const points = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS);
    expect(points).toHaveLength(25);
    expect(points[0].year).toBe(2026);
    expect(points[24].year).toBe(2050);
  });

  it('clamps the span to at least one year even if end <= start', () => {
    expect(projectKesslerTimeline(2025, 2025, REAL_WORLD_BASELINE_OBJECTS)).toHaveLength(1);
    expect(projectKesslerTimeline(2025, 2020, REAL_WORLD_BASELINE_OBJECTS)).toHaveLength(1);
  });

  it('caps the projected span at 100 years', () => {
    expect(projectKesslerTimeline(2025, 3025, REAL_WORLD_BASELINE_OBJECTS)).toHaveLength(100);
  });

  it('keeps LEO + MEO + GEO equal to the reported total', () => {
    const points = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS);
    for (const p of points) {
      expect(p.leoObjects + p.meoObjects + p.geoObjects).toBe(p.totalObjects);
      expect(p.debrisObjects).toBeLessThanOrEqual(p.totalObjects);
    }
  });

  it('puts most of the catalog and nearly all collision risk in LEO', () => {
    const points = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS);
    const last = points[points.length - 1];
    expect(last.leoObjects).toBeGreaterThan(last.meoObjects);
    expect(last.leoObjects).toBeGreaterThan(last.geoObjects);
    expect(last.leoObjects / last.totalObjects).toBeGreaterThan(0.7);
  });

  it('grows the object population under the default (business-as-usual) scenario', () => {
    const points = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS);
    const last = points[points.length - 1];
    expect(last.totalObjects).toBeGreaterThan(REAL_WORLD_BASELINE_OBJECTS);
  });

  it('produces a larger population under a higher launch-rate multiplier', () => {
    const baseline = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, DEFAULT_KESSLER_SCENARIO);
    const aggressive = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, {
      ...DEFAULT_KESSLER_SCENARIO,
      launchRateMultiplier: 3,
    });
    expect(aggressive[aggressive.length - 1].totalObjects).toBeGreaterThan(
      baseline[baseline.length - 1].totalObjects,
    );
  });

  it('produces a smaller population under aggressive debris mitigation', () => {
    const baseline = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, DEFAULT_KESSLER_SCENARIO);
    const mitigated = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, {
      ...DEFAULT_KESSLER_SCENARIO,
      mitigationRate: 2.5,
    });
    expect(mitigated[mitigated.length - 1].totalObjects).toBeLessThan(
      baseline[baseline.length - 1].totalObjects,
    );
  });

  it('raises the risk index and cumulative collisions under higher collision risk', () => {
    const baseline = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, DEFAULT_KESSLER_SCENARIO);
    const risky = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, {
      ...DEFAULT_KESSLER_SCENARIO,
      collisionRiskMultiplier: 4,
    });
    const lastBase = baseline[baseline.length - 1];
    const lastRisky = risky[risky.length - 1];
    expect(lastRisky.riskIndex).toBeGreaterThan(lastBase.riskIndex);
    expect(lastRisky.cumulativeCollisions).toBeGreaterThan(lastBase.cumulativeCollisions);
  });

  it('never lets debris exceed the total population, even in an extreme runaway scenario', () => {
    const points = projectKesslerTimeline(2025, 2100, REAL_WORLD_BASELINE_OBJECTS, {
      launchRateMultiplier: 6,
      mitigationRate: 0,
      collisionRiskMultiplier: 6,
    });
    for (const p of points) {
      expect(p.debrisObjects).toBeLessThanOrEqual(p.totalObjects);
    }
  });

  it('seeds debris at a realistic non-zero fraction of the starting population', () => {
    const points = projectKesslerTimeline(2025, 2026, REAL_WORLD_BASELINE_OBJECTS);
    expect(points[0].debrisObjects).toBeGreaterThan(REAL_WORLD_BASELINE_OBJECTS * 0.3);
  });

  it('never lets any shell collapse below a small floor of its own baseline', () => {
    const points = projectKesslerTimeline(2025, 2100, REAL_WORLD_BASELINE_OBJECTS, {
      launchRateMultiplier: 0,
      mitigationRate: 3,
      collisionRiskMultiplier: 0,
    });
    for (const p of points) {
      expect(p.totalObjects).toBeGreaterThan(REAL_WORLD_BASELINE_OBJECTS * 0.07);
    }
  });

  it('never produces NaN or Infinity even under an extreme worst-case scenario over a long horizon', () => {
    const points = projectKesslerTimeline(2025, 2100, REAL_WORLD_BASELINE_OBJECTS, {
      launchRateMultiplier: 6,
      mitigationRate: 0,
      collisionRiskMultiplier: 6,
    });
    for (const p of points) {
      expect(Number.isFinite(p.totalObjects)).toBe(true);
      expect(Number.isFinite(p.debrisObjects)).toBe(true);
      expect(Number.isFinite(p.riskIndex)).toBe(true);
      expect(Number.isFinite(p.cumulativeCollisions)).toBe(true);
      expect(Number.isFinite(p.leoObjects)).toBe(true);
    }
  });

  it('keeps the default (business-as-usual) scenario in a believable "concerning" range over 25 years', () => {
    const points = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS);
    const last = points[points.length - 1];
    expect(classifyOutlook(last.riskIndex)).not.toBe('runaway');
  });

  it('keeps an aggressive-mitigation scenario "stable" over 25 years', () => {
    const points = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, {
      launchRateMultiplier: 0.5,
      mitigationRate: 2.5,
      collisionRiskMultiplier: 0.5,
    });
    const last = points[points.length - 1];
    expect(classifyOutlook(last.riskIndex)).toBe('stable');
  });

  it('exposes named presets that differ from each other in the expected direction', () => {
    const bau = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, KESSLER_PRESETS.bau);
    const boom = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, KESSLER_PRESETS.boom);
    const green = projectKesslerTimeline(2025, 2050, REAL_WORLD_BASELINE_OBJECTS, KESSLER_PRESETS.green);
    expect(boom[boom.length - 1].totalObjects).toBeGreaterThan(bau[bau.length - 1].totalObjects);
    expect(green[green.length - 1].totalObjects).toBeLessThan(bau[bau.length - 1].totalObjects);
    expect(boom[boom.length - 1].riskIndex).toBeGreaterThan(green[green.length - 1].riskIndex);
  });
});

describe('clampScenarioParams', () => {
  it('leaves in-range values untouched', () => {
    expect(clampScenarioParams({ launchRateMultiplier: 2, mitigationRate: 1, collisionRiskMultiplier: 1.5 })).toEqual({
      launchRateMultiplier: 2,
      mitigationRate: 1,
      collisionRiskMultiplier: 1.5,
    });
  });

  it('clamps extreme or negative values into range', () => {
    const clamped = clampScenarioParams({
      launchRateMultiplier: -5,
      mitigationRate: 999,
      collisionRiskMultiplier: 999,
    });
    expect(clamped.launchRateMultiplier).toBe(0);
    expect(clamped.mitigationRate).toBe(3);
    expect(clamped.collisionRiskMultiplier).toBe(6);
  });
});

describe('classifyOutlook', () => {
  it('classifies risk index bands correctly', () => {
    expect(classifyOutlook(0)).toBe('stable');
    expect(classifyOutlook(149)).toBe('stable');
    expect(classifyOutlook(150)).toBe('concerning');
    expect(classifyOutlook(799)).toBe('concerning');
    expect(classifyOutlook(800)).toBe('critical');
    expect(classifyOutlook(2999)).toBe('critical');
    expect(classifyOutlook(3000)).toBe('runaway');
    expect(classifyOutlook(50000)).toBe('runaway');
  });
});

describe('projectKesslerTimeline — population bookkeeping', () => {
  const noInputs = { launchRateMultiplier: 0, collisionRiskMultiplier: 0 };

  it('keeps natural LEO decay even with zero mitigation effort', () => {
    const points = projectKesslerTimeline(2025, 2035, REAL_WORLD_BASELINE_OBJECTS, {
      ...noInputs,
      mitigationRate: 0,
    });
    for (let i = 1; i < points.length; i++) {
      expect(points[i].leoObjects).toBeLessThan(points[i - 1].leoObjects);
    }
  });

  it('removes decayed debris from the total instead of relabelling it as active', () => {
    const points = projectKesslerTimeline(2025, 2026, REAL_WORLD_BASELINE_OBJECTS, {
      ...noInputs,
      mitigationRate: 1,
    });
    const start = REAL_WORLD_BASELINE_OBJECTS;
    // Nothing is added, so every removed debris object must leave the total.
    expect(points[0].totalObjects).toBeLessThan(start);
    expect(points[0].debrisObjects).toBeLessThan(start * 0.55);
    expect(points[0].totalObjects - points[0].debrisObjects).toBeLessThan(start * 0.45);
  });

  it('never creates objects from nothing (no population floor)', () => {
    const points = projectKesslerTimeline(2025, 2125, REAL_WORLD_BASELINE_OBJECTS, {
      ...noInputs,
      mitigationRate: 3,
    });
    const last = points[points.length - 1];
    expect(last.leoObjects).toBeLessThan(REAL_WORLD_BASELINE_OBJECTS * 0.82 * 0.08);
    for (const p of points) {
      expect(p.debrisObjects).toBeLessThanOrEqual(p.totalObjects);
      expect(p.totalObjects).toBeGreaterThanOrEqual(0);
    }
  });
});
