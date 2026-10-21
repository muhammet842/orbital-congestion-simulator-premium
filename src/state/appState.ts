/**
 * Central app store (subscribe / setState).
 *
 * Selection exclusivity: picking an object, historical event, or conjunction
 * clears the other two. Do not set selectedIndex and selectedEventId together.
 *
 * Clock priority (see getSimulationTime):
 *   verificationTime  →  eventReplay  →  global time.live/historical
 * Cap focused-clock advances with MAX_FOCUSED_CLOCK_FRAME_MS so a hitch after
 * selecting a card cannot skip the whole VERIFY/replay window in one frame.
 *
 * UI panels should read via getState() + subscribe(); SceneManager advances
 * clocks each animation frame without full panel re-renders where possible.
 */
import { nameCollator } from '../data/nameOrder';
import type { ConjunctionScanResult, ConjunctionSortMode } from '../orbital/conjunction';
import {
  clampVerificationTimeMs,
  conjunctionSessionKey,
  getVerificationRewindMs,
  getVerificationWindowMs,
  hasUpcomingConjunctionScanCompleted,
  normalizeConjunctionAlert,
} from '../orbital/conjunction';
import type { AppStats, ConjunctionEvent, ObjectCategory, OrbitLayer, TimeMode, TimeState, TrackedObject } from '../types';
import { isRecentlyLaunched } from '../data/newLaunches';

/** How far before the collision to start the replay (ms). */
export const EVENT_REPLAY_REWIND_MS = 5 * 60 * 1000;
/** Playback multiplier for event replays. */
export const EVENT_REPLAY_SPEED = 15;
/** Transport nudge while scrubbing an event replay (±). */
export const EVENT_REPLAY_SCRUB_STEP_MS = 5_000;
/**
 * Wall-clock cap per animation frame for verify/replay clocks.
 * A hitch after selecting a card (trail rebuild, fly-in) can be hundreds of
 * ms; without a cap that one frame skips the whole T−60s window and freeze.
 */
export const MAX_FOCUSED_CLOCK_FRAME_MS = 50;

export interface EventReplayState {
  eventId: string;
  /** Collision/destruction moment (ms UTC). */
  collisionTimeMs: number;
  /** Current replay clock position (ms UTC). */
  currentMs: number;
  playing: boolean;
  speed: number;
}

export interface VerificationTimeState {
  /** Immutable CPA instant from the alert card (ms UTC). */
  cpaTimeMs: number;
  /** Playback clock for verification only — does not mutate global time. */
  currentMs: number;
  playing: boolean;
  speed: number;
  /** CPA relative velocity — shortens the T− window for fast crossings. */
  relativeVelocityKmS?: number;
}

/** A launch chosen in the Upcoming Launches panel: its pad is marked on the globe. */
export interface SelectedLaunch {
  id: string;
  name: string;
  latitudeDeg: number;
  longitudeDeg: number;
  padName: string | null;
}

export interface AppState {
  objects: TrackedObject[];
  filteredIndices: number[];
  selectedIndex: number | null;
  selectedEventId: string | null;
  selectedConjunction: ConjunctionEvent | null;
  /** Pad marker + camera target set from the Upcoming Launches panel (independent of object selection). */
  selectedLaunch: SelectedLaunch | null;
  selectedConjunctionSessionKey: string | null;
  conjunctionRevision: number;
  verificationTime: VerificationTimeState | null;
  /** Active historical event replay clock — overrides global sim time when set. */
  eventReplay: EventReplayState | null;
  searchQuery: string;
  layerFilters: Record<OrbitLayer, boolean>;
  /** Optional altitude band filter applied to the list and 3-D scene. */
  altitudeFilter: { minKm: number; maxKm: number } | null;
  /** Optional inclination band filter applied to the list and 3-D scene. */
  inclinationFilter: { minDeg: number; maxDeg: number } | null;
  /** When true, only objects first observed in the last ~14 days are shown. */
  showOnlyRecentLaunches: boolean;
  /** Object-category filter for list + globe (`all` = no cut). */
  categoryFilter: ObjectCategory | 'all';
  time: TimeState;
  stats: AppStats;
  conjunctions: ConjunctionEvent[];
  conjunctionHiddenCount: number;
  /** Left-panel close-approach list order within the next 24h. */
  conjunctionSortMode: ConjunctionSortMode;
  showOrbitTrail: boolean;
  showGroundTrack: boolean;
  colorByFunction: boolean;
}

type Listener = () => void;

/** One-shot wake after an empty predictive sweep so the UI leaves "Scanning…". */
let emptyConjunctionScanAcked = false;

const defaultLayerFilters: Record<OrbitLayer, boolean> = {
  LEO: true,
  MEO: true,
  GEO: true,
  HEO: true,
};

let state: AppState = {
  objects: [],
  filteredIndices: [],
  selectedIndex: null,
  selectedEventId: null,
  selectedConjunction: null,
  selectedLaunch: null,
  selectedConjunctionSessionKey: null,
  conjunctionRevision: 0,
  verificationTime: null,
  eventReplay: null,
  searchQuery: '',
  layerFilters: { ...defaultLayerFilters },
  altitudeFilter: null,
  inclinationFilter: null,
  showOnlyRecentLaunches: false,
  categoryFilter: 'all',
  time: {
    mode: 'live',
    current: new Date(),
    speed: 1,
    playing: true,
  },
  stats: {
    total: 0,
    leoPercent: 0,
    avgAltitude: 0,
    categoryCounts: { active: 0, debris: 0, stations: 0 },
    fetchedAt: '',
  },
  conjunctions: [],
  conjunctionHiddenCount: 0,
  conjunctionSortMode: 'time',
  showOrbitTrail: false,
  showGroundTrack: true,
  colorByFunction: true,
};

const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

/** Time used for SGP4 propagation — verification overlay → event replay → live/historical global clock. */
export function getSimulationTime(): Date {
  if (state.verificationTime) {
    return new Date(state.verificationTime.currentMs);
  }
  if (state.eventReplay) {
    return new Date(state.eventReplay.currentMs);
  }
  return getGlobalSimulationTime();
}

/**
 * Live/historical catalog clock only — ignores verification & event-replay overlays.
 * Use for UI that must stay anchored to “now” (e.g. close-approach alert countdowns)
 * while the 3D view is scrubbing a selected CPA.
 */
export function getGlobalSimulationTime(): Date {
  return state.time.mode === 'live' ? new Date() : state.time.current;
}

let lastFormattedSecond = Number.NaN;
let lastFormatted = '';

export function formatUtcDateTime(date: Date): string {
  // Several panels format the clock every frame; the text only changes once a second.
  const second = Math.floor(date.getTime() / 1000);
  if (second === lastFormattedSecond) return lastFormatted;
  lastFormattedSecond = second;
  lastFormatted = formatUtcDateTimeUncached(date);
  return lastFormatted;
}

function formatUtcDateTimeUncached(date: Date): string {
  const utcTime = date.toISOString().slice(11, 19);
  // Zero-pad the day so the string width does not jump between "3 Jan"
  // and "13 Jan" (which was shoving wrapped labels up/down every second).
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  const year = date.getUTCFullYear();
  return `${utcTime} UTC · ${day} ${month} ${year}`;
}

export function enterLiveMode(): void {
  if (state.verificationTime) {
    setVerificationPartial({ playing: true, speed: 1 });
    return;
  }
  if (state.eventReplay) {
    // Keep the replay clock — flipping `time.mode` to live while 3D stays in
    // 2009 desyncs the time bar from the globe.
    setEventReplayPartial({ playing: true, speed: 1 });
    return;
  }

  setState({
    time: {
      mode: 'live',
      current: new Date(),
      speed: 1,
      playing: true,
    },
    selectedConjunction: null,
    selectedConjunctionSessionKey: null,
    verificationTime: null,
  });
}

/** Reset simulated clock to the current UTC moment (historical mode). */
export function jumpToNow(): void {
  enterHistoricalMode({
    current: new Date(),
    speed: 1,
    playing: state.time.playing,
  });
}

export function enterHistoricalMode(updates: Partial<TimeState> = {}): void {
  const speed =
    updates.speed !== undefined ? Math.min(updates.speed, 100) : undefined;
  setState({
    time: {
      ...state.time,
      mode: 'historical',
      ...updates,
      ...(speed !== undefined ? { speed } : {}),
    },
  });
}

export function setState(partial: Partial<AppState>): void {
  state = { ...state, ...partial };

  if (
    partial.layerFilters !== undefined ||
    partial.searchQuery !== undefined ||
    partial.altitudeFilter !== undefined ||
    partial.inclinationFilter !== undefined ||
    partial.showOnlyRecentLaunches !== undefined ||
    partial.categoryFilter !== undefined
  ) {
    state.filteredIndices = computeFilteredIndices(
      state.objects, state.layerFilters, state.searchQuery,
      state.altitudeFilter, state.inclinationFilter, state.showOnlyRecentLaunches,
      state.categoryFilter,
    );
  }

  listeners.forEach((fn) => fn());
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function computeFilteredIndices(
  objects: TrackedObject[],
  layerFilters: Record<OrbitLayer, boolean>,
  searchQuery = '',
  altitudeFilter: { minKm: number; maxKm: number } | null = null,
  inclinationFilter: { minDeg: number; maxDeg: number } | null = null,
  showOnlyRecentLaunches = false,
  categoryFilter: ObjectCategory | 'all' = 'all',
): number[] {
  const q = searchQuery.trim().toLowerCase();
  const now = Date.now();
  const indices: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!layerFilters[obj.layer]) continue;
    if (categoryFilter !== 'all' && obj.category !== categoryFilter) continue;
    if (q && !objectMatchesQuery(obj, q)) continue;
    if (altitudeFilter && (obj.meanAltitudeKm < altitudeFilter.minKm || obj.meanAltitudeKm > altitudeFilter.maxKm)) continue;
    if (inclinationFilter && (obj.inclinationDeg < inclinationFilter.minDeg || obj.inclinationDeg > inclinationFilter.maxDeg)) continue;
    if (showOnlyRecentLaunches && !isRecentlyLaunched(obj, now)) continue;
    indices.push(i);
  }
  return indices;
}

export function objectMatchesQuery(obj: TrackedObject, queryLower: string): boolean {
  const normalized = queryLower
    .replace(/turkiye/g, 'türkiye')
    .replace(/turkey/g, 'türkiye');

  return (
    obj.name.toLowerCase().includes(normalized) ||
    String(obj.noradId).includes(normalized) ||
    obj.country.toLowerCase().includes(normalized) ||
    obj.owner.toLowerCase().includes(normalized) ||
    // "Nauka" or 49044 finds the ISS stack it is docked to.
    (obj.dockedComponents?.some(
      (part) => part.name.toLowerCase().includes(normalized) || String(part.noradId).includes(normalized),
    ) ?? false)
  );
}

export function matchesSearchQuery(obj: TrackedObject, searchQuery: string): boolean {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return true;
  return objectMatchesQuery(obj, q);
}

let sortedAllIndices: number[] = [];

export function getSortedObjectIndices(): number[] {
  return sortedAllIndices;
}

/** Indices for the sidebar list (same filters as the globe, A–Z order). */
export function getListIndices(): number[] {
  const allowed = new Set(state.filteredIndices);
  return sortedAllIndices.filter((i) => allowed.has(i));
}

export function setSearchQuery(query: string): void {
  setState({ searchQuery: query });
}

function restoreGlobalLiveTime(): TimeState {
  return {
    mode: 'live',
    current: new Date(),
    speed: 1,
    playing: true,
  };
}

/**
 * One thing is in focus at a time: picking a satellite, a historical event, a
 * close approach or a launch cancels whichever of the others was active
 * (including a close-approach or replay clock), so a click always shows the
 * card that was clicked. `keep` names the one being picked.
 */
function cancelOtherFocus(keep: 'object' | 'event' | 'conjunction' | 'launch'): Partial<AppState> {
  const wasVerifying = state.verificationTime != null;
  return {
    ...(keep !== 'object' ? { selectedIndex: null } : {}),
    ...(keep !== 'event' ? { selectedEventId: null, eventReplay: null } : {}),
    ...(keep !== 'conjunction'
      ? {
          selectedConjunction: null,
          selectedConjunctionSessionKey: null,
          verificationTime: null,
          ...(wasVerifying ? { time: restoreGlobalLiveTime() } : {}),
        }
      : {}),
    ...(keep !== 'launch' ? { selectedLaunch: null } : {}),
  };
}

export function selectObject(index: number): void {
  setState({ ...cancelOtherFocus('object'), selectedIndex: index });
}

/**
 * Marks a launch pad on the globe and flies the camera there (cancelling a
 * selected satellite, event or close approach); null clears it.
 */
export function selectLaunch(launch: SelectedLaunch | null): void {
  if (launch == null) {
    if (state.selectedLaunch == null) return;
    setState({ selectedLaunch: null });
    return;
  }
  setState({ ...cancelOtherFocus('launch'), selectedLaunch: launch });
}

export function clearObjectSelection(): void {
  if (state.selectedIndex == null) return;
  setState({ selectedIndex: null });
}

export function selectHistoricalEvent(eventId: string): void {
  setState({
    ...cancelOtherFocus('event'),
    selectedEventId: eventId,
    // A new event starts without the previous event's replay.
    eventReplay: null,
    showOrbitTrail: false,
    showGroundTrack: true,
  });
}

/** Start a timed replay of a historical event — sets a dedicated replay clock. */
export function startEventReplay(eventId: string, collisionTimeMs: number): void {
  const startMs = collisionTimeMs - EVENT_REPLAY_REWIND_MS;
  setState({
    eventReplay: {
      eventId,
      collisionTimeMs,
      currentMs: startMs,
      playing: true,
      speed: EVENT_REPLAY_SPEED,
    },
  });
}

export function setEventReplayPartial(
  partial: Partial<Pick<EventReplayState, 'playing' | 'speed' | 'currentMs'>>,
): void {
  if (!state.eventReplay) return;
  const next = { ...state.eventReplay, ...partial };
  if (partial.currentMs !== undefined) {
    const { startMs, endMs } = getEventReplayWindowMs(next.collisionTimeMs);
    next.currentMs = Math.min(endMs, Math.max(startMs, partial.currentMs));
  }
  state.eventReplay = next;
  listeners.forEach((fn) => fn());
}

export function stopEventReplay(): void {
  if (!state.eventReplay) return;
  // Also clear the card selection so the event card is deselected and
  // SceneManager.onStateChange() cleans up the 3-D visuals + restores
  // catalog satellite visibility.
  setState({ eventReplay: null, selectedEventId: null });
}

/** Clear historical event selection even when replay has not started yet. */
export function clearHistoricalEventSelection(): void {
  if (state.selectedEventId == null && state.eventReplay == null) return;
  setState({ eventReplay: null, selectedEventId: null });
}

/** Advance event replay clock without triggering full re-render. */
export function advanceEventReplayTime(deltaMs: number): void {
  if (!state.eventReplay?.playing) return;
  const { startMs, endMs } = getEventReplayWindowMs(state.eventReplay.collisionTimeMs);
  const step = Math.min(Math.max(0, deltaMs), MAX_FOCUSED_CLOCK_FRAME_MS) * state.eventReplay.speed;
  const nextMs = state.eventReplay.currentMs + step;
  if (nextMs >= endMs) {
    state.eventReplay = { ...state.eventReplay, currentMs: endMs, playing: false };
    return;
  }
  state.eventReplay.currentMs = Math.max(startMs, nextMs);
}

export function getEventReplayState(): EventReplayState | null {
  return state.eventReplay;
}

/** Replay clock window: T−5m … IMPACT (T+0). */
export function getEventReplayWindowMs(collisionTimeMs: number): {
  startMs: number;
  endMs: number;
} {
  return {
    startMs: collisionTimeMs - EVENT_REPLAY_REWIND_MS,
    endMs: collisionTimeMs,
  };
}

export function selectConjunctionFromAlert(alert: ConjunctionEvent): void {
  const frozen = normalizeConjunctionAlert(alert, state.objects);
  if (!frozen) return;

  const cpaTimeMs = frozen.time.getTime();
  const sessionKey = conjunctionSessionKey(frozen);
  const relativeVelocityKmS =
    frozen.relativeVelocityKmS > 1e-6
      ? frozen.relativeVelocityKmS
      : alert.relativeVelocityKmS;
  const startMs = cpaTimeMs - getVerificationRewindMs(relativeVelocityKmS);

  setState({
    ...cancelOtherFocus('conjunction'),
    selectedConjunction: frozen,
    selectedConjunctionSessionKey: sessionKey,
    conjunctionRevision: state.conjunctionRevision + 1,
    verificationTime: {
      cpaTimeMs,
      currentMs: startMs,
      // Auto-play so selecting an alert immediately shows the approach —
      // users shouldn't need a second click on VERIFY/Play.
      playing: true,
      speed: 1,
      relativeVelocityKmS,
    },
    showOrbitTrail: false,
    showGroundTrack: true,
  });
}

export function toggleConjunctionFromAlert(alert: ConjunctionEvent): void {
  const frozen = normalizeConjunctionAlert(alert, state.objects);
  if (!frozen) return;

  const sessionKey = conjunctionSessionKey(frozen);
  if (state.selectedConjunctionSessionKey === sessionKey) {
    clearSelectedConjunction();
    return;
  }
  selectConjunctionFromAlert(alert);
}

export function clearSelectedConjunction(): void {
  if (!state.selectedConjunction && !state.verificationTime) return;
  setState({
    selectedConjunction: null,
    selectedConjunctionSessionKey: null,
    verificationTime: null,
    time: restoreGlobalLiveTime(),
  });
}

export function exitConjunctionView(): void {
  clearSelectedConjunction();
}

export function setVerificationPartial(
  partial: Partial<Pick<VerificationTimeState, 'playing' | 'speed' | 'currentMs'>>,
): void {
  if (!state.verificationTime) return;
  const speed =
    partial.speed !== undefined ? Math.min(partial.speed, 100) : partial.speed;
  const next = { ...state.verificationTime, ...partial, ...(speed !== undefined ? { speed } : {}) };
  if (partial.currentMs !== undefined) {
    next.currentMs = clampVerificationTimeMs(
      next.cpaTimeMs,
      partial.currentMs,
      next.relativeVelocityKmS ?? 0,
    );
  }
  state.verificationTime = next;
  listeners.forEach((fn) => fn());
}

/** Advance verification playback clock without touching global time state. */
export function advanceVerificationTime(deltaMs: number): void {
  if (!state.verificationTime?.playing) return;
  const vt = state.verificationTime;
  const { endMs } = getVerificationWindowMs(vt.cpaTimeMs, vt.relativeVelocityKmS ?? 0);
  const step = Math.min(Math.max(0, deltaMs), MAX_FOCUSED_CLOCK_FRAME_MS) * vt.speed;
  const nextMs = vt.currentMs + step;
  if (nextMs >= endMs) {
    state.verificationTime = { ...vt, currentMs: endMs, playing: false };
    listeners.forEach((fn) => fn());
    return;
  }
  state.verificationTime.currentMs = nextMs;
}

export function setShowOrbitTrail(show: boolean): void {
  setState({ showOrbitTrail: show });
}

export function setShowGroundTrack(show: boolean): void {
  setState({ showGroundTrack: show });
}

export function setColorByFunction(enabled: boolean): void {
  if (state.colorByFunction === enabled) return;
  setState({ colorByFunction: enabled });
}

export function setShowOnlyRecentLaunches(enabled: boolean): void {
  if (state.showOnlyRecentLaunches === enabled) return;
  setState({ showOnlyRecentLaunches: enabled });
}

export function setCategoryFilter(filter: ObjectCategory | 'all'): void {
  if (state.categoryFilter === filter) return;
  setState({ categoryFilter: filter });
}

export function setAltitudeFilter(filter: { minKm: number; maxKm: number } | null): void {
  setState({ altitudeFilter: filter });
}

export function setInclinationFilter(filter: { minDeg: number; maxDeg: number } | null): void {
  setState({ inclinationFilter: filter });
}

/** How many objects match a search when no filter is applied (for "N hidden by filters"). */
export function countAllQueryMatches(searchQuery: string): number {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return state.objects.length;
  let n = 0;
  for (const obj of state.objects) if (objectMatchesQuery(obj, q)) n++;
  return n;
}

/** Every list/globe filter back to "show everything" (the search text stays). */
export function clearListFilters(): void {
  setState({
    layerFilters: { ...defaultLayerFilters },
    categoryFilter: 'all',
    altitudeFilter: null,
    inclinationFilter: null,
    showOnlyRecentLaunches: false,
  });
}

export function resetAdvancedFilters(): void {
  setState({ altitudeFilter: null, inclinationFilter: null });
}

export function setConjunctions({ alerts, hiddenCount }: ConjunctionScanResult): void {
  const prev = state.conjunctions;
  const sameContent =
    state.conjunctionHiddenCount === hiddenCount &&
    prev.length === alerts.length &&
    prev.every(
      (c, i) =>
        c.objectA === alerts[i].objectA &&
        c.objectB === alerts[i].objectB &&
        Math.abs(c.distanceKm - alerts[i].distanceKm) < 0.001 &&
        Math.abs(c.time.getTime() - alerts[i].time.getTime()) < 1_000,
    );

  if (sameContent) {
    // Empty→empty still needs one wake so the panel can leave "Scanning…"
    // when the first sweep finishes with no hits. Later identical publishes
    // must stay silent — they were remounting alert cards every idle tick.
    if (alerts.length === 0 && hasUpcomingConjunctionScanCompleted() && !emptyConjunctionScanAcked) {
      emptyConjunctionScanAcked = true;
      listeners.forEach((fn) => fn());
    }
    return;
  }

  emptyConjunctionScanAcked =
    alerts.length === 0 && hasUpcomingConjunctionScanCompleted();
  setState({ conjunctions: alerts, conjunctionHiddenCount: hiddenCount });
}

export function initState(
  objects: TrackedObject[],
  stats: AppStats,
): void {
  sortedAllIndices = objects
    .map((_, i) => i)
    .sort((a, b) => nameCollator.compare(objects[a].name, objects[b].name));

  state = {
    ...state,
    objects,
    filteredIndices: computeFilteredIndices(
      objects, state.layerFilters, '', null, null, false, 'all',
    ),
    stats,
    selectedIndex: null,
    selectedEventId: null,
    selectedConjunction: null,
    selectedLaunch: null,
    selectedConjunctionSessionKey: null,
    conjunctionRevision: 0,
    verificationTime: null,
    eventReplay: null,
    searchQuery: '',
    altitudeFilter: null,
    inclinationFilter: null,
    showOnlyRecentLaunches: false,
    categoryFilter: 'all',
    conjunctions: [],
    conjunctionHiddenCount: 0,
    conjunctionSortMode: 'time',
    showOrbitTrail: false,
    showGroundTrack: true,
    colorByFunction: true,
    time: {
      mode: 'live',
      current: new Date(),
      speed: 1,
      playing: true,
    },
  };
  listeners.forEach((fn) => fn());
}

export function setConjunctionSortMode(mode: ConjunctionSortMode): void {
  if (state.conjunctionSortMode === mode) return;
  setState({ conjunctionSortMode: mode });
}

export function toggleLayerFilter(layer: OrbitLayer): void {
  setState({
    layerFilters: {
      ...state.layerFilters,
      [layer]: !state.layerFilters[layer],
    },
  });
}

export function setTimePartial(partial: Partial<TimeState>): void {
  if (state.verificationTime) {
    if (partial.playing !== undefined) {
      setVerificationPartial({ playing: partial.playing });
    }
    if (partial.speed !== undefined) {
      setVerificationPartial({ speed: partial.speed });
    }
    return;
  }

  const next: TimeState = { ...state.time, ...partial };
  if (next.mode === 'live') {
    next.speed = 1;
  }
  setState({ time: next });
}

/** Advance historical sim clock without re-rendering UI panels every frame. */
export function advanceSimulationTime(current: Date): void {
  if (state.time.mode !== 'historical') return;
  state.time.current = current;
}

export function isLiveMode(): boolean {
  return state.time.mode === 'live';
}

export function isConjunctionVerificationActive(): boolean {
  return state.verificationTime != null;
}

export function isEventReplayActive(): boolean {
  return state.eventReplay != null;
}

export function isVerificationPlaying(): boolean {
  return state.verificationTime?.playing ?? false;
}

export function getVerificationTimeState(): VerificationTimeState | null {
  return state.verificationTime;
}

export function getTimeModeLabel(mode: TimeMode): string {
  return mode === 'live' ? 'LIVE' : 'Historical';
}
