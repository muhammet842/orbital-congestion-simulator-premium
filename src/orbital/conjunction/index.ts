/**
 * Close-approach (conjunction) detection for LEO traffic.
 *
 * Live scan: coarse spatial hash with DETECTION_RADIUS_KM, then fine refine
 * (LIVE_REFINE_*) so fast 5–12 km/s crossings are not skipped between ticks.
 * UI shows at most MAX_DISPLAY_ALERTS; more stay in state for filters.
 *
 * VERIFY mode: click an alert → dedicated verificationTime clock (T− adaptive
 * to relative speed → CPA → T+15s). Does not rewrite the global sim clock.
 * Co-orbiting stacks (ISS/CSS modules) are excluded from alerts, and so are
 * objects whose TLE is too old to screen (`staleElements`, set by tleLoader).
 *
 * invalidateUpcomingConjunctionScan() when catalog/time mode changes so a
 * stale idle callback cannot wipe cards mid-rescan.
 */
export {
  THRESHOLD_KM,
  MIN_DISTANCE_KM,
  CHECK_INTERVAL_MS,
  CHECK_WALL_INTERVAL_MS,
  DETECTION_RADIUS_KM,
  MAX_DISPLAY_ALERTS,
  MAX_STORED_ALERTS,
  SUBSET,
  REFINE_WINDOW_MS,
  REFINE_STEP_MS,
  LIVE_REFINE_WINDOW_MS,
  LIVE_REFINE_STEP_MS,
} from './settings';
export type {
  ConjunctionScanResult,
} from './settings';
export {
  VERIFY_REWIND_MS,
  VERIFY_OPENING_SEPARATION_KM,
  VERIFY_MIN_REWIND_MS,
  VERIFY_TRAIL_BACK_MS,
  VERIFY_TRAIL_FORWARD_MS,
  VERIFY_TRAIL_STEP_MS,
  VERIFY_SCRUB_STEP_MS,
  getVerificationRewindMs,
  getVerificationWindowMs,
  clampVerificationTimeMs,
  COLLISION_THRESHOLD_KM,
  CROSSING_MIN_REL_VELOCITY_KM_S,
  RISK_NO_KM,
  RISK_LOW_KM,
  RISK_CRITICAL_KM,
  conjunctionPairKey,
  conjunctionSessionKey,
  formatCloseApproachAlert,
  getRiskAssessment,
  formatRelativeVelocityKmS,
  isCoOrbitingPair,
  getDistanceAtTime,
  getRelativeVelocityAtTime,
  getVerificationAssessment,
} from './verification';
export type {
  VerificationStatus,
} from './verification';
export {
  findConjunctions,
  getConjunctions,
  invalidateConjunctionCache,
} from './liveScan';
export {
  SCREEN_MAX_PERIGEE_KM,
  isScreenable,
  countStaleScreeningExclusions,
  orbitFingerprint,
  sharesOrbitData,
  getColocatedObjectNames,
} from './screening';
export {
  physicalConjunctionKey,
  rankConjunctionAlertsByTime,
  rankConjunctionAlertsByCriticality,
  rankConjunctionAlertsForDisplay,
  selectConjunctionAlertsForDisplay,
  filterConjunctionAlertsInHorizon,
  countConjunctionOverflow,
  normalizeConjunctionAlert,
} from './alerts';
export type {
  ConjunctionSortMode,
  SelectConjunctionAlertsOptions,
} from './alerts';
export {
  refineCloseApproach,
  resolveConjunctionEvent,
} from './refine';
export {
  findCandidatePairsWithinRadius,
} from './spatialGrid';
export {
  UPCOMING_HORIZON_MS,
  UPCOMING_SAMPLE_STEP_MS,
  UPCOMING_MAX_REL_VELOCITY_KM_S,
  UPCOMING_SCREEN_KM,
  UPCOMING_RESCAN_INTERVAL_MS,
  PREDICTION_RANGE_DAYS,
  isWithinPredictionRange,
  UPCOMING_MAX_SIM_DRIFT_MS,
  upcomingDetectionRadiusKm,
  linearClosestApproach,
  solveClosestApproach,
  UpcomingConjunctionSweep,
  findUpcomingConjunctions,
} from './upcomingSweep';
export type {
  UpcomingSweepStepResult,
} from './upcomingSweep';
export {
  setUpcomingConjunctionWorkerFactory,
  isUpcomingConjunctionScanPending,
  hasUpcomingConjunctionScanCompleted,
  getUpcomingConjunctions,
  invalidateUpcomingConjunctionCache,
} from './upcomingScan';
export type {
  UpcomingWorkerObject,
  UpcomingWorkerRequest,
  UpcomingWorkerResponse,
} from './upcomingScan';
