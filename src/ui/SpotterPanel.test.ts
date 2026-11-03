// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { twoline2satrec } from 'satellite.js';
import { initState, selectObject, clearObjectSelection } from '../state/appState';
import type { TrackedObject } from '../types';
import { closeSpotterPanel, isSpotterOpen, openSpotterPanel } from './SpotterPanel';
import { setManualLocation, stopObserverSensors } from './observerSensors';
import { initRightPanel } from './RightPanel';

function makeIssObject(): TrackedObject {
  const satrec = twoline2satrec(
    '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
    '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
  );
  return {
    noradId: 25544,
    name: 'ISS (ZARYA)',
    line1: '',
    line2: '',
    category: 'stations',
    country: 'ISS',
    owner: 'ISS',
    satrec,
    layer: 'LEO',
    color: [1, 1, 1],
    functionGroup: 'station',
    meanAltitudeKm: 420,
    inclinationDeg: 51.6,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    return window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));

  const obj = makeIssObject();
  initState([obj], {
    total: 1,
    leoPercent: 100,
    avgAltitude: 420,
    categoryCounts: { active: 0, debris: 0, stations: 1 },
    fetchedAt: new Date().toISOString(),
  });
  selectObject(0);
  setManualLocation({ latitudeDeg: 41.01, longitudeDeg: 28.97, altitudeKm: 0.05 });
});

afterEach(() => {
  closeSpotterPanel();
  stopObserverSensors();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('SpotterPanel', () => {
  it('does not open without a selected object', () => {
    clearObjectSelection();
    openSpotterPanel();
    expect(isSpotterOpen()).toBe(false);
  });

  it('opens a dialog with sky map and turn/tilt cues', () => {
    openSpotterPanel();
    expect(isSpotterOpen()).toBe(true);
    expect(document.getElementById('spotter-panel')).not.toBeNull();
    expect(document.getElementById('spotter-sky')).not.toBeNull();
    expect(document.getElementById('spotter-zoom-in')).not.toBeNull();
    expect(document.getElementById('spotter-lat')).not.toBeNull();
    expect(document.getElementById('spotter-turn')?.textContent?.length).toBeGreaterThan(0);
  });

  it('shows the measurement readout only with ?spotter=measure', () => {
    openSpotterPanel();
    expect(document.getElementById('spotter-measure')).toBeNull();
    closeSpotterPanel();

    window.history.replaceState(null, '', '/?spotter=measure');
    try {
      openSpotterPanel();
      expect(document.getElementById('spotter-measure')).not.toBeNull();
      // No compass in the test: nothing to save yet.
      expect(document.querySelector<HTMLButtonElement>('#spotter-measure-save')?.disabled).toBe(true);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('closes on Escape', () => {
    openSpotterPanel();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isSpotterOpen()).toBe(false);
  });
});

describe('RightPanel spotter entry', () => {
  it('renders the Spot from here button for a selected object', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initRightPanel(container);
    expect(document.getElementById('btn-spotter')).not.toBeNull();
  });

  it('opens the spotter when the button is clicked', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initRightPanel(container);
    document.getElementById('btn-spotter')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isSpotterOpen()).toBe(true);
  });
});
