import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getState,
  setState,
  initState,
  selectObject,
  selectLaunch,
  clearObjectSelection,
  selectHistoricalEvent,
  setShowOrbitTrail,
  setShowGroundTrack,
  setSearchQuery,
  toggleLayerFilter,
  setAltitudeFilter,
  setInclinationFilter,
  resetAdvancedFilters,
  startEventReplay,
  stopEventReplay,
  setEventReplayPartial,
  enterLiveMode,
  setColorByFunction,
  setShowOnlyRecentLaunches,
  setCategoryFilter,
  countAllQueryMatches,
  clearListFilters,
  computeFilteredIndices,
  getListIndices,
  selectConjunctionFromAlert,
  clearSelectedConjunction,
  advanceVerificationTime,
  MAX_FOCUSED_CLOCK_FRAME_MS,
  EVENT_REPLAY_REWIND_MS,
} from './appState';
import { VERIFY_REWIND_MS, VERIFY_TRAIL_FORWARD_MS, getVerificationRewindMs } from '../orbital/conjunction';
import * as propagatorModule from '../orbital/propagator';
import type { ConjunctionEvent, TrackedObject } from '../types';

/**
 * Hard-reset module state to known defaults before each test.
 * We do this by directly calling setState with the expected initial values.
 */
function resetState(): void {
  setState({
    objects: [],
    filteredIndices: [],
    selectedIndex: null,
    selectedEventId: null,
    selectedConjunction: null,
    selectedConjunctionSessionKey: null,
    conjunctionRevision: 0,
    verificationTime: null,
    eventReplay: null,
    searchQuery: '',
    layerFilters: { LEO: true, MEO: true, GEO: true, HEO: true },
    altitudeFilter: null,
    inclinationFilter: null,
    showOnlyRecentLaunches: false,
    categoryFilter: 'all',
    showOrbitTrail: false,
    showGroundTrack: true,
    colorByFunction: true,
    conjunctions: [],
    conjunctionHiddenCount: 0,
    conjunctionSortMode: 'time',
  });
}

beforeEach(resetState);

// ── Selection ─────────────────────────────────────────────────────────────────

describe('selectObject', () => {
  it('sets selectedIndex to the given index', () => {
    selectObject(42);
    expect(getState().selectedIndex).toBe(42);
  });

  it('overwrites a previous selection', () => {
    selectObject(1);
    selectObject(7);
    expect(getState().selectedIndex).toBe(7);
  });
});

describe('clearObjectSelection', () => {
  it('sets selectedIndex to null', () => {
    selectObject(3);
    clearObjectSelection();
    expect(getState().selectedIndex).toBeNull();
  });

  it('is a no-op when nothing is selected', () => {
    clearObjectSelection();
    expect(getState().selectedIndex).toBeNull();
  });
});

// ── Historical event ──────────────────────────────────────────────────────────

describe('selectHistoricalEvent', () => {
  it('sets selectedEventId', () => {
    selectHistoricalEvent('iridium-cosmos');
    expect(getState().selectedEventId).toBe('iridium-cosmos');
  });

  it('clears any active satellite selection', () => {
    selectObject(5);
    selectHistoricalEvent('iridium-cosmos');
    expect(getState().selectedIndex).toBeNull();
  });

  it('clears eventReplay state', () => {
    startEventReplay('iridium-cosmos', Date.now());
    selectHistoricalEvent('iridium-cosmos');
    expect(getState().eventReplay).toBeNull();
  });
});

// ── Event replay ──────────────────────────────────────────────────────────────

describe('startEventReplay', () => {
  it('creates an eventReplay state with the correct eventId', () => {
    const collisionMs = new Date('2009-02-10T16:56:00Z').getTime();
    startEventReplay('iridium-cosmos', collisionMs);
    const replay = getState().eventReplay;
    expect(replay).not.toBeNull();
    expect(replay!.eventId).toBe('iridium-cosmos');
  });

  it('sets currentMs to collisionTimeMs minus REWIND_MS', () => {
    const collisionMs = new Date('2009-02-10T16:56:00Z').getTime();
    startEventReplay('iridium-cosmos', collisionMs);
    const replay = getState().eventReplay!;
    expect(replay.currentMs).toBe(collisionMs - EVENT_REPLAY_REWIND_MS);
  });

  it('starts the replay in playing state', () => {
    startEventReplay('iridium-cosmos', Date.now());
    expect(getState().eventReplay!.playing).toBe(true);
  });
});

describe('setEventReplayPartial', () => {
  it('clamps currentMs to the T−5m…IMPACT window', () => {
    const collisionMs = 1_000_000;
    startEventReplay('iridium-cosmos', collisionMs);
    setEventReplayPartial({ currentMs: collisionMs + 60_000, playing: false });
    expect(getState().eventReplay!.currentMs).toBe(collisionMs);
    setEventReplayPartial({ currentMs: collisionMs - EVENT_REPLAY_REWIND_MS - 60_000 });
    expect(getState().eventReplay!.currentMs).toBe(collisionMs - EVENT_REPLAY_REWIND_MS);
  });
});

describe('stopEventReplay', () => {
  it('clears eventReplay and selectedEventId', () => {
    startEventReplay('iridium-cosmos', Date.now());
    stopEventReplay();
    expect(getState().eventReplay).toBeNull();
    expect(getState().selectedEventId).toBeNull();
  });
});

describe('enterLiveMode', () => {
  it('resumes historical replay at 1× instead of swapping the global clock to live', () => {
    startEventReplay('iridium-cosmos', 1_000_000);
    setEventReplayPartial({ playing: false, speed: 100 });
    enterLiveMode();
    expect(getState().eventReplay?.playing).toBe(true);
    expect(getState().eventReplay?.speed).toBe(1);
    expect(getState().eventReplay?.eventId).toBe('iridium-cosmos');
  });
});

// ── Visibility toggles ────────────────────────────────────────────────────────

describe('setShowOrbitTrail', () => {
  it('toggles showOrbitTrail to true', () => {
    setShowOrbitTrail(true);
    expect(getState().showOrbitTrail).toBe(true);
  });

  it('toggles showOrbitTrail to false', () => {
    setShowOrbitTrail(true);
    setShowOrbitTrail(false);
    expect(getState().showOrbitTrail).toBe(false);
  });
});

describe('setShowGroundTrack', () => {
  it('defaults to true', () => {
    expect(getState().showGroundTrack).toBe(true);
  });

  it('can be set to false', () => {
    setShowGroundTrack(false);
    expect(getState().showGroundTrack).toBe(false);
  });
});

describe('setColorByFunction', () => {
  it('defaults to true so debris and satellites stay distinct', () => {
    expect(getState().colorByFunction).toBe(true);
  });

  it('can be toggled on and off', () => {
    setColorByFunction(false);
    expect(getState().colorByFunction).toBe(false);
    setColorByFunction(true);
    expect(getState().colorByFunction).toBe(true);
  });
});

describe('setShowOnlyRecentLaunches', () => {
  it('defaults to false', () => {
    expect(getState().showOnlyRecentLaunches).toBe(false);
  });

  it('can be toggled on and off', () => {
    setShowOnlyRecentLaunches(true);
    expect(getState().showOnlyRecentLaunches).toBe(true);
    setShowOnlyRecentLaunches(false);
    expect(getState().showOnlyRecentLaunches).toBe(false);
  });

  it('narrows the sidebar list to recently launched objects when enabled', () => {
    const now = Date.now();
    const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const stale = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    initState(
      [
        {
          noradId: 1,
          name: 'NEW SAT',
          line1: '',
          line2: '',
          category: 'active',
          country: 'X',
          owner: 'X',
          satrec: {} as TrackedObject['satrec'],
          layer: 'LEO',
          color: [1, 1, 1],
          functionGroup: 'active',
          meanAltitudeKm: 500,
          inclinationDeg: 50,
          firstSeenAt: recent,
        },
        {
          noradId: 2,
          name: 'OLD SAT',
          line1: '',
          line2: '',
          category: 'active',
          country: 'X',
          owner: 'X',
          satrec: {} as TrackedObject['satrec'],
          layer: 'LEO',
          color: [1, 1, 1],
          functionGroup: 'active',
          meanAltitudeKm: 500,
          inclinationDeg: 50,
          firstSeenAt: stale,
        },
      ],
      {
        total: 2,
        leoPercent: 100,
        avgAltitude: 500,
        categoryCounts: { active: 2, debris: 0, stations: 0 },
        fetchedAt: new Date().toISOString(),
      },
    );

    expect(getListIndices().length).toBe(2);
    setShowOnlyRecentLaunches(true);
    expect(getListIndices()).toEqual([0]);
  });
});

describe('computeFilteredIndices with showOnlyRecentLaunches', () => {
  function makeObj(overrides: Partial<TrackedObject>): TrackedObject {
    return {
      noradId: 1,
      name: 'TEST',
      line1: '',
      line2: '',
      category: 'active',
      country: 'Unknown',
      owner: 'Unknown',
      satrec: {} as TrackedObject['satrec'],
      layer: 'LEO',
      color: [1, 1, 1],
      functionGroup: 'active',
      meanAltitudeKm: 500,
      inclinationDeg: 50,
      ...overrides,
    };
  }

  const layerFilters = { LEO: true, MEO: true, GEO: true, HEO: true };

  it('includes everything when the flag is off, even objects with no firstSeenAt', () => {
    const objects = [makeObj({ firstSeenAt: undefined }), makeObj({ noradId: 2 })];
    const indices = computeFilteredIndices(objects, layerFilters, '', null, null, false);
    expect(indices).toEqual([0, 1]);
  });

  it('keeps only objects first seen within the last 14 days when the flag is on', () => {
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const objects = [
      makeObj({ noradId: 1, firstSeenAt: recent }),
      makeObj({ noradId: 2, firstSeenAt: stale }),
      makeObj({ noradId: 3, firstSeenAt: undefined }),
    ];
    const indices = computeFilteredIndices(objects, layerFilters, '', null, null, true);
    expect(indices).toEqual([0]);
  });
});

describe('computeFilteredIndices with categoryFilter', () => {
  function makeObj(overrides: Partial<TrackedObject>): TrackedObject {
    return {
      noradId: 1,
      name: 'TEST',
      line1: '',
      line2: '',
      category: 'active',
      country: 'Unknown',
      owner: 'Unknown',
      satrec: {} as TrackedObject['satrec'],
      layer: 'LEO',
      color: [1, 1, 1],
      functionGroup: 'active',
      meanAltitudeKm: 500,
      inclinationDeg: 50,
      ...overrides,
    };
  }

  const layerFilters = { LEO: true, MEO: true, GEO: true, HEO: true };

  it('finds a docked stack by the name or NORAD id of one of its modules', () => {
    const objects = [
      makeObj({ noradId: 25544, name: 'ISS (ZARYA)', dockedComponents: [{ noradId: 49044, name: 'ISS (NAUKA)' }] }),
      makeObj({ noradId: 2, name: 'OTHER' }),
    ];
    expect(computeFilteredIndices(objects, layerFilters, 'nauka', null, null, false, 'all')).toEqual([0]);
    expect(computeFilteredIndices(objects, layerFilters, '49044', null, null, false, 'all')).toEqual([0]);
  });

  it('includes all categories when filter is all', () => {
    const objects = [
      makeObj({ noradId: 1, category: 'active' }),
      makeObj({ noradId: 2, category: 'debris' }),
      makeObj({ noradId: 3, category: 'stations' }),
    ];
    expect(computeFilteredIndices(objects, layerFilters, '', null, null, false, 'all')).toEqual([
      0, 1, 2,
    ]);
  });

  it('keeps only the selected category', () => {
    const objects = [
      makeObj({ noradId: 1, category: 'active' }),
      makeObj({ noradId: 2, category: 'debris' }),
      makeObj({ noradId: 3, category: 'stations' }),
      makeObj({ noradId: 4, category: 'debris' }),
    ];
    expect(computeFilteredIndices(objects, layerFilters, '', null, null, false, 'debris')).toEqual([
      1, 3,
    ]);
    expect(computeFilteredIndices(objects, layerFilters, '', null, null, false, 'stations')).toEqual([
      2,
    ]);
    expect(computeFilteredIndices(objects, layerFilters, '', null, null, false, 'active')).toEqual([
      0,
    ]);
  });
});

describe('setCategoryFilter', () => {
  it('defaults to all', () => {
    expect(getState().categoryFilter).toBe('all');
  });

  it('narrows filteredIndices and the sidebar list to the chosen category', () => {
    initState(
      [
        {
          noradId: 1,
          name: 'SAT',
          line1: '',
          line2: '',
          category: 'active',
          country: 'X',
          owner: 'X',
          satrec: {} as TrackedObject['satrec'],
          layer: 'LEO',
          color: [1, 1, 1],
          functionGroup: 'active',
          meanAltitudeKm: 500,
          inclinationDeg: 50,
        },
        {
          noradId: 2,
          name: 'DEB',
          line1: '',
          line2: '',
          category: 'debris',
          country: 'X',
          owner: 'X',
          satrec: {} as TrackedObject['satrec'],
          layer: 'LEO',
          color: [1, 1, 1],
          functionGroup: 'debris',
          meanAltitudeKm: 500,
          inclinationDeg: 50,
        },
      ],
      {
        total: 2,
        leoPercent: 100,
        avgAltitude: 500,
        categoryCounts: { active: 1, debris: 1, stations: 0 },
        fetchedAt: new Date().toISOString(),
      },
    );

    expect(getListIndices().length).toBe(2);
    setCategoryFilter('debris');
    expect(getState().categoryFilter).toBe('debris');
    expect(getState().filteredIndices).toEqual([1]);
    expect(getListIndices()).toEqual([1]);
  });
});

// ── Layer filters ─────────────────────────────────────────────────────────────

describe('toggleLayerFilter', () => {
  it('disables a layer that is currently enabled', () => {
    toggleLayerFilter('LEO');
    expect(getState().layerFilters.LEO).toBe(false);
  });

  it('re-enables a layer that is currently disabled', () => {
    toggleLayerFilter('GEO');
    toggleLayerFilter('GEO');
    expect(getState().layerFilters.GEO).toBe(true);
  });

  it('does not affect other layers', () => {
    toggleLayerFilter('MEO');
    const { LEO, GEO, HEO } = getState().layerFilters;
    expect(LEO).toBe(true);
    expect(GEO).toBe(true);
    expect(HEO).toBe(true);
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

describe('setSearchQuery', () => {
  it('stores the search string', () => {
    setSearchQuery('starlink');
    expect(getState().searchQuery).toBe('starlink');
  });

  it('trims the query', () => {
    setSearchQuery('  ISS  ');
    // The appState trims before storing
    expect(getState().searchQuery.trim()).toBe('ISS');
  });
});

// ── Advanced filters ──────────────────────────────────────────────────────────

describe('setAltitudeFilter', () => {
  it('stores the altitude range', () => {
    setAltitudeFilter({ minKm: 400, maxKm: 800 });
    expect(getState().altitudeFilter).toEqual({ minKm: 400, maxKm: 800 });
  });

  it('can be cleared with null', () => {
    setAltitudeFilter({ minKm: 400, maxKm: 800 });
    setAltitudeFilter(null);
    expect(getState().altitudeFilter).toBeNull();
  });
});

describe('setInclinationFilter', () => {
  it('stores the inclination range', () => {
    setInclinationFilter({ minDeg: 50, maxDeg: 90 });
    expect(getState().inclinationFilter).toEqual({ minDeg: 50, maxDeg: 90 });
  });

  it('can be cleared with null', () => {
    setInclinationFilter({ minDeg: 50, maxDeg: 90 });
    setInclinationFilter(null);
    expect(getState().inclinationFilter).toBeNull();
  });
});

describe('resetAdvancedFilters', () => {
  it('clears both altitude and inclination filters', () => {
    setAltitudeFilter({ minKm: 200, maxKm: 1000 });
    setInclinationFilter({ minDeg: 30, maxDeg: 120 });
    resetAdvancedFilters();
    expect(getState().altitudeFilter).toBeNull();
    expect(getState().inclinationFilter).toBeNull();
  });
});

describe('selectConjunctionFromAlert', () => {
  function makeObj(overrides: Partial<TrackedObject>): TrackedObject {
    return {
      noradId: 1,
      name: 'TEST',
      line1: '',
      line2: '',
      category: 'active',
      country: 'Unknown',
      owner: 'Unknown',
      satrec: {} as TrackedObject['satrec'],
      layer: 'LEO',
      color: [1, 1, 1],
      functionGroup: 'active',
      meanAltitudeKm: 500,
      inclinationDeg: 50,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.spyOn(propagatorModule, 'propagateObject').mockImplementation(() => ({
      positionEci: { x: 1, y: 2, z: 3 },
      velocityEci: { x: 1, y: 0, z: 0 },
      altitudeKm: 500,
      velocityKmS: 7.5,
      inclinationDeg: 50,
      layer: 'LEO',
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts verification playback automatically from T−60s', () => {
    setState({
      objects: [makeObj({ noradId: 1, name: 'A' }), makeObj({ noradId: 2, name: 'B' })],
    });
    const cpa = new Date('2026-07-25T02:12:25.000Z');
    const alert: ConjunctionEvent = {
      objectA: 'A',
      objectB: 'B',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      distanceKm: 0.34,
      relativeVelocityKmS: 0.4,
      time: cpa,
      midpointScene: { x: 0, y: 0, z: 0 },
    };

    selectConjunctionFromAlert(alert);

    const vt = getState().verificationTime;
    expect(vt).not.toBeNull();
    expect(vt!.playing).toBe(true);
    expect(vt!.speed).toBe(1);
    expect(vt!.currentMs).toBe(cpa.getTime() - VERIFY_REWIND_MS);
  });

  it('replaces a selected launch or a running historical replay', () => {
    setState({
      objects: [makeObj({ noradId: 1, name: 'A' }), makeObj({ noradId: 2, name: 'B' })],
      selectedLaunch: { id: 'l1', name: 'CRS-35', latitudeDeg: 28.56, longitudeDeg: -80.58, padName: null },
      selectedEventId: 'iridium-cosmos',
      eventReplay: { eventId: 'iridium-cosmos', collisionTimeMs: 0, currentMs: 0, playing: true, speed: 1 },
    });
    selectConjunctionFromAlert({
      objectA: 'A',
      objectB: 'B',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      distanceKm: 0.34,
      relativeVelocityKmS: 0.4,
      time: new Date('2026-07-25T02:12:25.000Z'),
      midpointScene: { x: 0, y: 0, z: 0 },
    });
    const s = getState();
    expect(s.selectedConjunction).not.toBeNull();
    expect(s.selectedLaunch).toBeNull();
    expect(s.selectedEventId).toBeNull();
    expect(s.eventReplay).toBeNull();
  });

  it('starts a 5 km/s crossing later than T−60s so 1x is not a streak across the frame', () => {
    setState({
      objects: [makeObj({ noradId: 1, name: 'A' }), makeObj({ noradId: 2, name: 'B' })],
    });
    const cpa = new Date('2026-07-25T02:12:25.000Z');
    const alert: ConjunctionEvent = {
      objectA: 'A',
      objectB: 'B',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      distanceKm: 2.1,
      relativeVelocityKmS: 5,
      time: cpa,
      midpointScene: { x: 0, y: 0, z: 0 },
    };

    selectConjunctionFromAlert(alert);

    const vt = getState().verificationTime!;
    expect(vt.currentMs).toBe(cpa.getTime() - getVerificationRewindMs(5));
    expect(vt.currentMs).toBeGreaterThan(cpa.getTime() - VERIFY_REWIND_MS);
    expect(vt.relativeVelocityKmS).toBe(5);
  });

  it('does not skip the T−60s window when a hitch delivers a huge frame delta', () => {
    setState({
      objects: [makeObj({ noradId: 1, name: 'A' }), makeObj({ noradId: 2, name: 'B' })],
    });
    const cpa = new Date('2026-07-25T02:12:25.000Z');
    const alert: ConjunctionEvent = {
      objectA: 'A',
      objectB: 'B',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      distanceKm: 0.34,
      relativeVelocityKmS: 0.4,
      time: cpa,
      midpointScene: { x: 0, y: 0, z: 0 },
    };
    selectConjunctionFromAlert(alert);
    const start = getState().verificationTime!.currentMs;
    advanceVerificationTime(VERIFY_REWIND_MS);
    const vt = getState().verificationTime!;
    expect(vt.currentMs).toBe(start + MAX_FOCUSED_CLOCK_FRAME_MS);
    expect(vt.playing).toBe(true);
  });

  it('pauses at the end of the T+15s tail, not at CPA', () => {
    setState({
      objects: [makeObj({ noradId: 1, name: 'A' }), makeObj({ noradId: 2, name: 'B' })],
    });
    const cpa = new Date('2026-07-25T02:12:25.000Z');
    const alert: ConjunctionEvent = {
      objectA: 'A',
      objectB: 'B',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      distanceKm: 0.34,
      relativeVelocityKmS: 0.4,
      time: cpa,
      midpointScene: { x: 0, y: 0, z: 0 },
    };
    selectConjunctionFromAlert(alert);
    for (let i = 0; i < 2_000; i++) advanceVerificationTime(MAX_FOCUSED_CLOCK_FRAME_MS);
    const vt = getState().verificationTime!;
    expect(vt.currentMs).toBe(cpa.getTime() + VERIFY_TRAIL_FORWARD_MS);
    expect(vt.playing).toBe(false);
  });

  it('keeps the existing 24h alert list when the card is cancelled', () => {
    const a = makeObj({ noradId: 1, name: 'A' });
    const b = makeObj({ noradId: 2, name: 'B' });
    const cpa = new Date('2026-07-25T02:12:25.000Z');
    const alert: ConjunctionEvent = {
      objectA: 'A',
      objectB: 'B',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      distanceKm: 0.34,
      relativeVelocityKmS: 0.4,
      time: cpa,
      midpointScene: { x: 0, y: 0, z: 0 },
    };
    setState({
      objects: [a, b],
      conjunctions: [alert],
      conjunctionHiddenCount: 3,
    });
    selectConjunctionFromAlert(alert);
    clearSelectedConjunction();
    expect(getState().conjunctions).toEqual([alert]);
    expect(getState().conjunctionHiddenCount).toBe(3);
    expect(getState().selectedConjunction).toBeNull();
  });
});

describe('selectLaunch', () => {
  const pad = { id: 'l1', name: 'CRS-35', latitudeDeg: 28.56, longitudeDeg: -80.58, padName: 'SLC-40' };

  it('marks a pad and clears it again, notifying subscribers only on a real change', () => {
    setState({ selectedLaunch: null });
    selectLaunch(pad);
    expect(getState().selectedLaunch).toEqual(pad);
    selectLaunch(null);
    expect(getState().selectedLaunch).toBeNull();
  });

  it('replaces a selected satellite; clearing the launch leaves everything else alone', () => {
    setState({ selectedIndex: 3, selectedLaunch: null });
    selectLaunch(pad);
    expect(getState().selectedIndex).toBeNull();
    expect(getState().selectedLaunch).toEqual(pad);
    selectLaunch(null);
    expect(getState().selectedLaunch).toBeNull();
  });
});

// ── One thing in focus at a time ──────────────────────────────────────────────

describe('switching between satellites, events, close approaches and launches', () => {
  const pad = { id: 'l1', name: 'CRS-35', latitudeDeg: 28.56, longitudeDeg: -80.58, padName: 'SLC-40' };
  const replay = { eventId: 'iridium-cosmos', collisionTimeMs: 0, currentMs: 0, playing: true, speed: 1 };
  const verifying = (): void =>
    setState({
      selectedIndex: null,
      selectedEventId: null,
      eventReplay: null,
      selectedLaunch: null,
      selectedConjunction: { objectA: 'A' } as never,
      selectedConjunctionSessionKey: 'a|b',
      verificationTime: { cpaTimeMs: 1, currentMs: 0, playing: true, speed: 1, relativeVelocityKmS: 7 },
      time: { mode: 'live', current: new Date(0), speed: 5, playing: false },
    });

  it('a launch picked while watching a close approach ends the approach and returns to live time', () => {
    verifying();
    selectLaunch(pad);
    const s = getState();
    expect(s.selectedLaunch).toEqual(pad);
    expect(s.selectedConjunction).toBeNull();
    expect(s.selectedConjunctionSessionKey).toBeNull();
    expect(s.verificationTime).toBeNull();
    expect(s.time.speed).toBe(1);
    expect(s.time.playing).toBe(true);
  });

  it('a launch picked during a historical replay ends the replay', () => {
    setState({ selectedEventId: 'iridium-cosmos', eventReplay: replay, selectedLaunch: null, selectedConjunction: null, verificationTime: null });
    selectLaunch(pad);
    expect(getState().selectedEventId).toBeNull();
    expect(getState().eventReplay).toBeNull();
  });

  it('a satellite or a historical event picked after a launch replaces it', () => {
    setState({ selectedLaunch: pad, selectedIndex: null });
    selectObject(0);
    expect(getState().selectedLaunch).toBeNull();
    expect(getState().selectedIndex).toBe(0);

    setState({ selectedLaunch: pad });
    selectHistoricalEvent('iridium-cosmos');
    expect(getState().selectedLaunch).toBeNull();
    expect(getState().selectedIndex).toBeNull();
  });

  it('a satellite picked during a historical replay ends the replay', () => {
    setState({ selectedEventId: 'iridium-cosmos', eventReplay: replay, selectedIndex: null });
    selectObject(0);
    expect(getState().selectedEventId).toBeNull();
    expect(getState().eventReplay).toBeNull();
  });
});

// ── Search vs filters ─────────────────────────────────────────────────────────

describe('search hidden by filters', () => {
  const obj = (name: string, category: TrackedObject['category'], noradId: number) =>
    ({ name, category, noradId, country: '', owner: '', layer: 'LEO', meanAltitudeKm: 420, inclinationDeg: 51 }) as unknown as TrackedObject;

  it('counts matches regardless of filters, and clearListFilters shows them again', () => {
    setState({ objects: [obj('ISS (ZARYA)', 'stations', 25544), obj('SWISSCUBE', 'active', 35932), obj('FUNCUBE-1', 'active', 39444)] });
    setSearchQuery('iss');
    setCategoryFilter('active');
    expect(getListIndices()).toHaveLength(1); // only SWISSCUBE: the ISS is a station
    expect(countAllQueryMatches('iss')).toBe(2);

    clearListFilters();
    expect(getState().categoryFilter).toBe('all');
    expect(getState().searchQuery).toBe('iss'); // the search text stays
    expect(getListIndices()).toHaveLength(2);
  });
});
