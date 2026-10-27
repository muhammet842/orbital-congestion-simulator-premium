import { describe, expect, it } from 'vitest';
import { getState, type AppState, type SelectedLaunch } from '../state/appState';
import type { ConjunctionEvent } from '../types';
import {
  catalogUpdateKey,
  clockToAdvance,
  frameTimeSpeed,
  overlayTargets,
  predictionStep,
} from './sceneFrame';

const FETCHED_AT = '2026-10-20T06:00:00Z';
const DAY_MS = 86_400_000;

/** The app's starting state with a few fields changed. */
function stateWith(overrides: Partial<AppState>): AppState {
  const base = getState();
  return {
    ...base,
    stats: { ...base.stats, fetchedAt: FETCHED_AT },
    ...overrides,
  };
}

const historical = (playing: boolean, speed = 10) =>
  ({ ...getState().time, mode: 'historical', playing, speed }) as AppState['time'];
const live = () => ({ ...getState().time, mode: 'live', playing: true, speed: 100 }) as AppState['time'];
const verifying = (playing: boolean, speed = 1) => ({ cpaTimeMs: 0, currentMs: 0, playing, speed });
const replaying = (playing: boolean) => ({ eventId: 'e', collisionTimeMs: 0, currentMs: 0, playing, speed: 15 });
const conjunction = { indexA: 1, indexB: 2 } as ConjunctionEvent;
const launch: SelectedLaunch = { id: 'l', name: 'L', latitudeDeg: 28, longitudeDeg: -80, padName: null };

describe('clockToAdvance', () => {
  it('moves the verification clock while a close approach plays', () => {
    expect(clockToAdvance(stateWith({ verificationTime: verifying(true), time: historical(true) }), false)).toBe(
      'verification',
    );
  });

  it('holds the verification clock during the opening camera flight', () => {
    expect(clockToAdvance(stateWith({ verificationTime: verifying(true), time: live() }), true)).toBeNull();
  });

  it('moves the replay clock during a historical event replay', () => {
    expect(clockToAdvance(stateWith({ eventReplay: replaying(true) }), false)).toBe('replay');
    expect(clockToAdvance(stateWith({ eventReplay: replaying(false), time: live() }), false)).toBeNull();
  });

  it('moves the simulation clock only when the chosen time is playing', () => {
    expect(clockToAdvance(stateWith({ time: historical(true) }), false)).toBe('simulation');
    expect(clockToAdvance(stateWith({ time: historical(false) }), false)).toBeNull();
    expect(clockToAdvance(stateWith({ time: live() }), false)).toBeNull();
  });
});

describe('frameTimeSpeed', () => {
  it('uses the verification speed, else the chosen speed, and 1 in live mode', () => {
    expect(frameTimeSpeed(stateWith({ verificationTime: verifying(true, 5), time: historical(true, 100) }))).toBe(5);
    expect(frameTimeSpeed(stateWith({ time: historical(true, 100) }))).toBe(100);
    expect(frameTimeSpeed(stateWith({ time: live() }))).toBe(1);
  });
});

describe('catalogUpdateKey', () => {
  it('stays the same while nothing that changes the dots changes', () => {
    expect(catalogUpdateKey(stateWith({}), 1)).toBe(catalogUpdateKey(stateWith({}), 1));
  });

  it.each<[string, Partial<AppState>]>([
    ['selection', { selectedIndex: 3 }],
    ['search', { searchQuery: 'iss' }],
    ['layer filter', { layerFilters: { LEO: false, MEO: true, GEO: true, HEO: true } }],
    ['altitude band', { altitudeFilter: { minKm: 300, maxKm: 600 } }],
    ['inclination band', { inclinationFilter: { minDeg: 50, maxDeg: 60 } }],
    ['category', { categoryFilter: 'debris' }],
    ['recent launches', { showOnlyRecentLaunches: true }],
    ['colours', { colorByFunction: !getState().colorByFunction }],
  ])('changes with the %s', (_label, change) => {
    expect(catalogUpdateKey(stateWith(change), 1)).not.toBe(catalogUpdateKey(stateWith({}), 1));
  });

  it('changes with the time speed', () => {
    expect(catalogUpdateKey(stateWith({}), 10)).not.toBe(catalogUpdateKey(stateWith({}), 1));
  });
});

describe('overlayTargets', () => {
  it('shows every overlay for the selected satellite on the globe', () => {
    expect(overlayTargets(stateWith({ selectedIndex: 7, showGroundTrack: true, selectedLaunch: launch }), true)).toEqual({
      footprintIndex: 7,
      selectionIndex: 7,
      groundTrackIndex: 7,
      launchPad: launch,
    });
  });

  it('shows the ground track only when it is switched on', () => {
    expect(overlayTargets(stateWith({ selectedIndex: 7, showGroundTrack: false }), true).groundTrackIndex).toBeNull();
  });

  it('hides all of them while a close approach is verified', () => {
    const state = stateWith({ selectedIndex: 7, showGroundTrack: true, selectedLaunch: launch, selectedConjunction: conjunction });
    expect(overlayTargets(state, true)).toEqual({
      footprintIndex: null,
      selectionIndex: null,
      groundTrackIndex: null,
      launchPad: null,
    });
  });

  it('hides the ground track and launch pad during an event replay', () => {
    const state = stateWith({ selectedIndex: 7, showGroundTrack: true, selectedLaunch: launch, eventReplay: replaying(true) });
    const overlays = overlayTargets(state, true);
    expect(overlays.groundTrackIndex).toBeNull();
    expect(overlays.launchPad).toBeNull();
  });

  it('hides the footprint and launch pad while the Earth is hidden', () => {
    const overlays = overlayTargets(stateWith({ selectedIndex: 7, selectedLaunch: launch }), false);
    expect(overlays.footprintIndex).toBeNull();
    expect(overlays.launchPad).toBeNull();
    expect(overlays.selectionIndex).toBe(7);
  });
});

describe('predictionStep', () => {
  const inRange = Date.parse(FETCHED_AT) + DAY_MS;
  const outOfRange = Date.parse(FETCHED_AT) + 30 * DAY_MS;

  it('scans while the clock is near the data date', () => {
    expect(predictionStep(stateWith({}), inRange)).toBe('scan');
  });

  it('stops once when the clock leaves the range, then waits', () => {
    expect(predictionStep(stateWith({ conjunctionsOutOfRange: false }), outOfRange)).toBe('stop');
    expect(predictionStep(stateWith({ conjunctionsOutOfRange: true }), outOfRange)).toBe('pause');
  });

  it('clears the note and scans again when the clock comes back', () => {
    expect(predictionStep(stateWith({ conjunctionsOutOfRange: true }), inRange)).toBe('resume-and-scan');
  });

  it('changes nothing while a close approach is verified', () => {
    expect(predictionStep(stateWith({ selectedConjunction: conjunction }), outOfRange)).toBe('pause');
  });
});
