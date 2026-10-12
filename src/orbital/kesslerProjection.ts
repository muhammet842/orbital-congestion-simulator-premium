/**
 * Kessler Syndrome projection model (shell-aware).
 *
 * Educational "what if" model projecting tracked orbital populations by
 * altitude regime (LEO / MEO / GEO). Nearly all catastrophic collision risk
 * and launch-driven growth sit in LEO — matching ESA/NASA public reporting.
 * This is NOT an official forecast (LEGEND / DELTA use full fragmentation
 * physics); constants are loosely calibrated to mid-2020s public figures.
 *
 * Calibration anchors (~2025):
 *  - ~40,000 tracked objects >10 cm (USSPACECOM / ESA order of magnitude)
 *  - ~80–85% of those in LEO; MEO ~5–10%; GEO belt ~8–12%
 *  - ~2,600 new payloads/year, overwhelmingly LEO-bound (mega-constellations)
 *  - Catastrophic fragmentations historically ~once per 8–10 years → ~0.1/yr,
 *    almost exclusively in LEO
 *  - Collision opportunity scales ~density² within each shell (Kessler feedback)
 */

export interface KesslerScenarioParams {
  /** Multiplier on today's real-world annual launch cadence (~2,600/yr). 1 = business as usual. */
  launchRateMultiplier: number;
  /** Multiplier on active debris-mitigation effectiveness (deorbiting / end-of-life disposal). 1 = today's policy effort. */
  mitigationRate: number;
  /** Multiplier on collision / ASAT-test frequency risk. 1 = today's historical baseline. */
  collisionRiskMultiplier: number;
}

export const DEFAULT_KESSLER_SCENARIO: KesslerScenarioParams = {
  launchRateMultiplier: 1,
  mitigationRate: 1,
  collisionRiskMultiplier: 1,
};

/** Named presets for one-click realistic storylines. */
export const KESSLER_PRESETS = {
  bau: { launchRateMultiplier: 1, mitigationRate: 1, collisionRiskMultiplier: 1 },
  boom: { launchRateMultiplier: 2.5, mitigationRate: 0.7, collisionRiskMultiplier: 1.3 },
  green: { launchRateMultiplier: 0.85, mitigationRate: 2.2, collisionRiskMultiplier: 0.55 },
  asat: { launchRateMultiplier: 1.15, mitigationRate: 0.85, collisionRiskMultiplier: 3.2 },
} as const satisfies Record<string, KesslerScenarioParams>;

export type KesslerPresetId = keyof typeof KESSLER_PRESETS;

export interface KesslerYearPoint {
  year: number;
  /** Cumulative tracked objects (active + debris) at the end of this year. */
  totalObjects: number;
  /** Of which are debris. Always ≤ totalObjects. */
  debrisObjects: number;
  /** Objects in LEO (< ~2,000 km). Dominates risk and growth. */
  leoObjects: number;
  /** Objects in MEO (incl. GNSS shells). */
  meoObjects: number;
  /** Objects in / near the GEO belt. */
  geoObjects: number;
  /** Expected (fractional) catastrophic fragmentation events this year. */
  expectedCollisionsThisYear: number;
  /** Cumulative expected fragmentations since the start year. */
  cumulativeCollisions: number;
  /**
   * Collision-risk index relative to today: 100 = same LEO risk as the
   * baseline year. Display as `(riskIndex/100)×`, not as a raw percent.
   */
  riskIndex: number;
}

export type KesslerOutlookBand = 'stable' | 'concerning' | 'critical' | 'runaway';

/**
 * Real-world estimate of tracked objects (active + debris, >10 cm) in orbit
 * today. Independent of this app's filtered TLE catalog size.
 */
export const REAL_WORLD_BASELINE_OBJECTS = 40_000;

/** Approximate share of today's tracked catalog by regime. */
export const BASELINE_SHELL_FRACTIONS = {
  leo: 0.82,
  meo: 0.08,
  geo: 0.1,
} as const;

const BASELINE_ANNUAL_LAUNCHES = 2600;
/** Where new payloads go under today's launch mix. */
const LAUNCH_SHELL_FRACTIONS = { leo: 0.92, meo: 0.04, geo: 0.04 } as const;

/**
 * Baseline annual probability of a catastrophic fragmentation *in that shell*
 * at today's density. Nearly all real events are LEO.
 */
const BASELINE_COLLISION_P = { leo: 0.11, meo: 0.006, geo: 0.008 } as const;

/** Trackable fragments per catastrophic event (shell-dependent yields). */
const DEBRIS_PER_COLLISION = { leo: 1800, meo: 900, geo: 600 } as const;

/**
 * Annual removal of intact objects (payloads + rocket bodies), split into
 * natural decay (atmospheric drag — happens regardless of policy) and
 * policy-driven disposal (deorbit / graveyard), which scales with the
 * mitigation slider. GEO "removal" means relocation out of the protected belt.
 *
 * Calibrated so year-one business-as-usual net change matches the earlier
 * single-population model (~7%/yr of the LEO total at 1× mitigation).
 */
const INTACT_NATURAL_DECAY = { leo: 0.03, meo: 0, geo: 0 } as const;
const INTACT_POLICY_REMOVAL = { leo: 0.095, meo: 0.042, geo: 0.033 } as const;

/**
 * Annual debris removal, split the same way. LEO debris decays slowly by
 * drag; MEO/GEO debris is essentially permanent. The policy part stands for
 * active debris removal, which is tiny today.
 */
const DEBRIS_NATURAL_DECAY = { leo: 0.02, meo: 0.001, geo: 0 } as const;
const DEBRIS_POLICY_REMOVAL = { leo: 0.005, meo: 0.001, geo: 0.0004 } as const;

const INITIAL_DEBRIS_FRACTION = 0.55;
const MAX_TOTAL_OBJECTS = 5_000_000;
const MIN_PROJECTION_YEARS = 1;
const MAX_PROJECTION_YEARS = 100;

type ShellId = 'leo' | 'meo' | 'geo';
const SHELLS: ShellId[] = ['leo', 'meo', 'geo'];

interface ShellPop {
  total: number;
  debris: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keeps user-supplied scenario sliders within sane, non-explosive bounds. */
export function clampScenarioParams(params: KesslerScenarioParams): KesslerScenarioParams {
  return {
    launchRateMultiplier: clamp(params.launchRateMultiplier, 0, 6),
    mitigationRate: clamp(params.mitigationRate, 0, 3),
    collisionRiskMultiplier: clamp(params.collisionRiskMultiplier, 0, 6),
  };
}

function seedShells(startingObjectCount: number): Record<ShellId, ShellPop> {
  const baseline = Math.max(startingObjectCount, 1);
  const out = {} as Record<ShellId, ShellPop>;
  for (const shell of SHELLS) {
    const total = baseline * BASELINE_SHELL_FRACTIONS[shell];
    out[shell] = { total, debris: total * INITIAL_DEBRIS_FRACTION };
  }
  return out;
}

function stepShell(
  pop: ShellPop,
  shell: ShellId,
  params: KesslerScenarioParams,
  shellBaseline: number,
): { pop: ShellPop; expectedCollisions: number } {
  const densityRatio = pop.total / Math.max(shellBaseline, 1);
  const expectedCollisions =
    BASELINE_COLLISION_P[shell] *
    densityRatio *
    densityRatio *
    params.collisionRiskMultiplier;

  const newDebris = expectedCollisions * DEBRIS_PER_COLLISION[shell];
  const newLaunches =
    BASELINE_ANNUAL_LAUNCHES * params.launchRateMultiplier * LAUNCH_SHELL_FRACTIONS[shell];

  // Intact and debris populations are tracked separately so every object
  // removed is actually subtracted from the total (no relabelling).
  const intact = Math.max(0, pop.total - pop.debris);
  const intactRemovalRate = clamp(
    INTACT_NATURAL_DECAY[shell] + INTACT_POLICY_REMOVAL[shell] * params.mitigationRate,
    0,
    1,
  );
  const debrisRemovalRate = clamp(
    DEBRIS_NATURAL_DECAY[shell] + DEBRIS_POLICY_REMOVAL[shell] * params.mitigationRate,
    0,
    1,
  );

  let nextIntact = intact * (1 - intactRemovalRate) + newLaunches;
  let nextDebris = pop.debris * (1 - debrisRemovalRate) + newDebris;

  // Numerical safety cap for extreme slider combinations; scales both
  // populations together so the debris share is preserved.
  const cap = MAX_TOTAL_OBJECTS * BASELINE_SHELL_FRACTIONS[shell] * 2.5;
  const uncapped = nextIntact + nextDebris;
  if (uncapped > cap) {
    nextIntact *= cap / uncapped;
    nextDebris *= cap / uncapped;
  }

  return {
    pop: { total: nextIntact + nextDebris, debris: nextDebris },
    expectedCollisions,
  };
}

/**
 * Projects the orbital population year-by-year from `startYear` to `endYear`.
 * Returns one point per simulated year (not including the start year itself).
 *
 * `startingObjectCount` should normally be `REAL_WORLD_BASELINE_OBJECTS`;
 * shells are seeded from that total using {@link BASELINE_SHELL_FRACTIONS}.
 */
export function projectKesslerTimeline(
  startYear: number,
  endYear: number,
  startingObjectCount: number,
  rawParams: KesslerScenarioParams = DEFAULT_KESSLER_SCENARIO,
): KesslerYearPoint[] {
  const params = clampScenarioParams(rawParams);
  const years = clamp(Math.round(endYear - startYear), MIN_PROJECTION_YEARS, MAX_PROJECTION_YEARS);
  const baseline = Math.max(startingObjectCount, 1);
  const shellBaseline = {
    leo: baseline * BASELINE_SHELL_FRACTIONS.leo,
    meo: baseline * BASELINE_SHELL_FRACTIONS.meo,
    geo: baseline * BASELINE_SHELL_FRACTIONS.geo,
  };

  let shells = seedShells(baseline);
  let cumulativeCollisions = 0;
  const points: KesslerYearPoint[] = [];

  for (let i = 1; i <= years; i++) {
    let yearCollisions = 0;
    const next = {} as Record<ShellId, ShellPop>;

    for (const shell of SHELLS) {
      const stepped = stepShell(shells[shell], shell, params, shellBaseline[shell]);
      next[shell] = stepped.pop;
      yearCollisions += stepped.expectedCollisions;
    }

    shells = next;
    cumulativeCollisions += yearCollisions;

    const leoObjects = Math.round(shells.leo.total);
    const meoObjects = Math.round(shells.meo.total);
    const geoObjects = Math.round(shells.geo.total);
    const totalObjects = leoObjects + meoObjects + geoObjects;
    const debris = shells.leo.debris + shells.meo.debris + shells.geo.debris;

    // Kessler risk is a LEO story — index tracks LEO density² only.
    const leoDensityRatio = shells.leo.total / Math.max(shellBaseline.leo, 1);
    const riskIndex = leoDensityRatio * leoDensityRatio * params.collisionRiskMultiplier * 100;

    points.push({
      year: startYear + i,
      totalObjects,
      debrisObjects: Math.round(Math.min(debris, totalObjects)),
      leoObjects,
      meoObjects,
      geoObjects,
      expectedCollisionsThisYear: yearCollisions,
      cumulativeCollisions,
      riskIndex,
    });
  }

  return points;
}

/**
 * Buckets a risk index into a coarse narrative outlook used to pick UI copy.
 *
 * Because riskIndex scales with LEO density-ratio *squared*, a 3–4× LEO
 * population already yields ~900–1,600 — serious, but not yet a self-sustaining
 * runaway cascade. "Runaway" is reserved for extreme density / ASAT scenarios.
 */
export function classifyOutlook(riskIndex: number): KesslerOutlookBand {
  if (riskIndex >= 3000) return 'runaway';
  if (riskIndex >= 800) return 'critical';
  if (riskIndex >= 150) return 'concerning';
  return 'stable';
}
