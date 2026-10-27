/**
 * Thresholds, scan intervals and the scan result shared by the live and 24-hour scans.
 */
import type { ConjunctionEvent, OrbitLayer } from '../../types';

export interface ConjunctionScanResult {
  alerts: ConjunctionEvent[];
  hiddenCount: number;
}

export const THRESHOLD_KM = 3;
export const MIN_DISTANCE_KM = 0.1;
export const CHECK_INTERVAL_MS = 1_500;
/** Minimum real-time gap between conjunction recomputes (all speed modes). */
export const CHECK_WALL_INTERVAL_MS = 1_500;
/**
 * Many crossing LEO pairs close at 5-12 km/s — at that speed a pair only
 * stays inside the final THRESHOLD_KM for roughly 0.5-2s. Point-sampling the
 * instantaneous distance every CHECK_WALL_INTERVAL_MS can step right over a
 * window that narrow. To catch these, the coarse spatial-hash pass casts a
 * wider net (DETECTION_RADIUS_KM) so fast-closing pairs are flagged as
 * candidates *before* they're actually within THRESHOLD_KM, then a fine-step
 * refine pass (see LIVE_REFINE_*) pinpoints the true minimum distance. The
 * final alert still requires the refined distance to be <= THRESHOLD_KM —
 * this only widens what gets a closer look, not what counts as a conjunction.
 */
export const DETECTION_RADIUS_KM = 20;
/** Max close-approach alerts shown in the left panel (soonest CPA first). */
export const MAX_DISPLAY_ALERTS = 5;
/** Max candidates kept in app state so UI filters still have a pool to draw from. */
export const MAX_STORED_ALERTS = 30;
export const SUBSET: OrbitLayer = 'LEO';
export const REFINE_WINDOW_MS = 2 * 60 * 60 * 1000;
export const REFINE_STEP_MS = 60 * 1000;
/** Tight, fine-grained refine window used by the live scan — precise enough
 *  to resolve sub-3-second close-approach windows, unlike the coarse
 *  ±2h/60s window used for one-off historical/verification lookups. Combined
 *  with the automatic zoom-in pass in refineCloseApproach, this resolves
 *  down to ~100ms precision at negligible extra cost per candidate. */
export const LIVE_REFINE_WINDOW_MS = 10 * 1000;
export const LIVE_REFINE_STEP_MS = 1_000;
