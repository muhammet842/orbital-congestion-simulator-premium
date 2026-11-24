/**
 * Thresholds and the scan result of the 24-hour close-approach sweep.
 */
import type { ConjunctionEvent, OrbitLayer } from '../../types';

export interface ConjunctionScanResult {
  alerts: ConjunctionEvent[];
  hiddenCount: number;
}

/** Called with each published sweep result. */
export type ConjunctionRefreshListener = (result: ConjunctionScanResult) => void;

export const THRESHOLD_KM = 3;
/** Max close-approach alerts shown in the left panel (soonest CPA first). */
export const MAX_DISPLAY_ALERTS = 5;
/** Max candidates kept in app state so UI filters still have a pool to draw from. */
export const MAX_STORED_ALERTS = 30;
export const SUBSET: OrbitLayer = 'LEO';
export const REFINE_WINDOW_MS = 2 * 60 * 60 * 1000;
export const REFINE_STEP_MS = 60 * 1000;
