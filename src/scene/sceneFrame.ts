/**
 * Per-frame decisions for the 3D scene, kept free of Three.js so they can be
 * tested: which clock moves, how fast time runs, when the catalogue needs new
 * positions, which overlays are shown, and what happens when the clock leaves
 * the range the close-approach prediction covers.
 */
import { isWithinPredictionRange } from '../orbital/conjunction';
import type { AppState, SelectedLaunch } from '../state/appState';

/** Which clock this frame moves forward, if any. */
export type ClockToAdvance = 'verification' | 'replay' | 'simulation' | null;

/**
 * One clock moves per frame. The verification clock is held during the
 * opening camera fly-in so a fast pair does not use up its short window while
 * the camera is still moving.
 */
export function clockToAdvance(state: AppState, cameraFlying: boolean): ClockToAdvance {
  if (state.verificationTime?.playing && !cameraFlying) return 'verification';
  if (state.eventReplay?.playing) return 'replay';
  if (state.time.mode === 'historical' && state.time.playing) return 'simulation';
  return null;
}

/** How fast time runs this frame: the verification speed, else the chosen speed (1 in live mode). */
export function frameTimeSpeed(state: AppState): number {
  return state.verificationTime?.speed ?? (state.time.mode === 'historical' ? state.time.speed : 1);
}

/**
 * Everything that changes which dots are drawn, or how. The catalogue is
 * updated at once when this changes, instead of waiting for its next paced turn.
 */
export function catalogUpdateKey(state: AppState, timeSpeed: number): string {
  return [
    state.objects.length,
    state.selectedIndex,
    state.selectedConjunctionSessionKey,
    Object.values(state.layerFilters).join(','),
    state.searchQuery,
    state.colorByFunction,
    state.altitudeFilter ? `${state.altitudeFilter.minKm}-${state.altitudeFilter.maxKm}` : '',
    state.inclinationFilter ? `${state.inclinationFilter.minDeg}-${state.inclinationFilter.maxDeg}` : '',
    state.showOnlyRecentLaunches,
    state.categoryFilter,
    timeSpeed,
  ].join('|');
}

export interface OverlayTargets {
  /** Coverage cone under the selected satellite. */
  footprintIndex: number | null;
  /** Selection marker and orbit trail. */
  selectionIndex: number | null;
  groundTrackIndex: number | null;
  launchPad: SelectedLaunch | null;
}

/**
 * The single-object overlays belong to the globe view. While a close approach
 * is verified they are hidden, so a satellite selected before opening it does
 * not linger in the zoomed-in view. The ground track and launch pad also hide
 * during an event replay, and the footprint and launch pad while the Earth is
 * hidden.
 */
export function overlayTargets(state: AppState, earthVisible: boolean): OverlayTargets {
  const verifying = Boolean(state.selectedConjunction);
  return {
    footprintIndex: verifying || !earthVisible ? null : state.selectedIndex,
    selectionIndex: verifying ? null : state.selectedIndex,
    groundTrackIndex: !state.eventReplay && !verifying && state.showGroundTrack ? state.selectedIndex : null,
    launchPad: verifying || state.eventReplay || !earthVisible ? null : state.selectedLaunch,
  };
}

/** What the close-approach prediction should do this frame. */
export type PredictionStep = 'pause' | 'stop' | 'scan' | 'resume-and-scan';

/**
 * Close approaches are predicted only near the data's date. Leaving that range
 * stops a sweep in flight (its results would arrive afterwards) and shows the
 * out-of-range note; coming back clears the note and scans again. While a
 * close approach is being verified nothing changes.
 */
export function predictionStep(state: AppState, simMs: number): PredictionStep {
  if (state.selectedConjunction) return 'pause';
  const inRange = isWithinPredictionRange(simMs, state.stats.fetchedAt);
  if (!inRange) return state.conjunctionsOutOfRange ? 'pause' : 'stop';
  return state.conjunctionsOutOfRange ? 'resume-and-scan' : 'scan';
}
