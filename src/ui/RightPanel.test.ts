// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { initRightPanel } from './RightPanel';
import {
  setState,
  selectObject,
  selectHistoricalEvent,
} from '../state/appState';
import type { TrackedObject } from '../types';
import { rememberLaunches, type Launch } from '../data/launches';
import { setLang } from '../i18n/i18n';

/** Minimal TrackedObject stub so selectObject + render don't blow up. */
function makeFakeObject(name = 'TEST-SAT'): TrackedObject {
  return {
    noradId: 99999,
    name,
    line1: '1 99999U 21001A   21001.00000000  .00000000  00000-0  00000-0 0    01',
    line2: '2 99999  97.4000  10.0000 0001000  90.0000 270.0000 15.00000000    02',
    category: 'active',
    country: 'US',
    owner: 'Test',
    satrec: {} as never,
    layer: 'LEO',
    color: [0, 1, 0],
    functionGroup: 'active',
    meanAltitudeKm: 550,
    inclinationDeg: 97.4,
  };
}

function resetState(): void {
  setState({
    selectedIndex: null,
    selectedEventId: null,
    objects: [],
    filteredIndices: [],
    showOrbitTrail: false,
    showGroundTrack: true,
    eventReplay: null,
    selectedConjunction: null,
    selectedConjunctionSessionKey: null,
    selectedLaunch: null,
  });
}

beforeEach(resetState);

describe('initRightPanel – DOM smoke', () => {
  it('mounts without throwing', () => {
    const container = document.createElement('div');
    expect(() => initRightPanel(container)).not.toThrow();
  });

  it('creates the #object-detail root element', () => {
    const container = document.createElement('div');
    initRightPanel(container);
    expect(container.querySelector('#object-detail')).not.toBeNull();
  });

  it('renders empty state when nothing is selected', () => {
    const container = document.createElement('div');
    initRightPanel(container);
    const detail = container.querySelector('#object-detail')!;
    // No satellite info present in empty state
    expect(detail.querySelector('[data-field="altitude"]')).toBeNull();
  });

  it('shows orbit-trail and ground-track buttons when a satellite is selected', () => {
    const obj = makeFakeObject();
    setState({ objects: [obj], filteredIndices: [0] });
    selectObject(0);

    const container = document.createElement('div');
    initRightPanel(container);

    expect(container.querySelector('#btn-orbit-trail')).not.toBeNull();
    expect(container.querySelector('#btn-ground-track')).not.toBeNull();
  });

  it('lists the docked parts of a stack', () => {
    const obj = {
      ...makeFakeObject('ISS (ZARYA)'),
      dockedComponents: [
        { noradId: 36086, name: 'POISK' },
        { noradId: 49044, name: 'ISS (NAUKA)' },
      ],
    };
    setState({ objects: [obj], filteredIndices: [0] });
    selectObject(0);

    const container = document.createElement('div');
    initRightPanel(container);

    const items = Array.from(container.querySelectorAll('.docked-parts li')).map((li) => li.textContent);
    expect(items).toEqual(['POISK NORAD 36086', 'ISS (NAUKA) NORAD 49044']);
  });

  it('shows no docked-parts row for a single object', () => {
    setState({ objects: [makeFakeObject()], filteredIndices: [0] });
    selectObject(0);
    const container = document.createElement('div');
    initRightPanel(container);
    expect(container.querySelector('.docked-parts')).toBeNull();
  });

  it('shows a dashed radio-frequency row when no verified data exists', () => {
    const obj = makeFakeObject();
    setState({ objects: [obj], filteredIndices: [0] });
    selectObject(0);

    const container = document.createElement('div');
    initRightPanel(container);

    const emptyRow = container.querySelector('.radio-frequency-empty');
    expect(emptyRow).not.toBeNull();
    expect(emptyRow?.textContent).toContain('—');
  });

  it('badges amateur channels, lists them first and cleans labels', () => {
    const obj = {
      ...makeFakeObject(),
      radioFrequencies: [
        { service: 'Weather 137.932', downlinkMHz: '137.932', mode: 'APT', sourceUrl: 'https://x.org', amateur: false },
        { service: 'FM repeater', uplinkMHz: '145.85', downlinkMHz: '436.795', mode: 'FM', sourceUrl: 'https://x.org', amateur: true },
        { service: '145.9', listenMHz: '145.9', mode: 'SSB CW*', sourceUrl: 'https://x.org' },
      ],
    };
    setState({ objects: [obj], filteredIndices: [0] });
    selectObject(0);

    const container = document.createElement('div');
    initRightPanel(container);

    const labels = [...container.querySelectorAll('.radio-frequency-table tbody tr:not(.radio-frequency-note):not(.radio-frequency-source) td:first-child')]
      .map((td) => td.textContent?.replace(/\s+/g, ' ').trim());
    expect(labels[0]).toMatch(/^FM repeater/);
    expect(container.querySelectorAll('.radio-badge')).toHaveLength(1);
    expect(labels[1]).toBe('Transmitter');
    expect(labels[2]).toBe('Weather');
    expect(container.querySelector('.radio-frequency-marker')).not.toBeNull();
  });

  it('labels every value cell and marks empty ones, for the stacked phone layout', () => {
    const obj = {
      ...makeFakeObject(),
      radioFrequencies: [
        { service: 'Beacon', listenMHz: '435.605', mode: 'CW', sourceUrl: 'https://x.org' },
      ],
    };
    setState({ objects: [obj], filteredIndices: [0] });
    selectObject(0);

    const container = document.createElement('div');
    initRightPanel(container);

    const cells = [...container.querySelectorAll('.radio-frequency-main td[data-label]')];
    expect(cells.map((c) => c.getAttribute('data-label'))).toEqual([
      'Uplink MHz', 'Downlink MHz', 'Listen MHz', 'Mode',
    ]);
    expect(cells.map((c) => c.classList.contains('radio-cell-empty'))).toEqual([true, true, false, false]);
  });

  it('does not show the radio-frequency section for debris', () => {
    const obj = { ...makeFakeObject('TEST DEB'), category: 'debris' as const };
    setState({ objects: [obj], filteredIndices: [0] });
    selectObject(0);

    const container = document.createElement('div');
    initRightPanel(container);

    expect(container.querySelector('.radio-frequency-section')).toBeNull();
  });

  it('orbit-trail button reflects showOrbitTrail state', () => {
    const obj = makeFakeObject();
    setState({ objects: [obj], filteredIndices: [0], showOrbitTrail: true });
    selectObject(0);

    const container = document.createElement('div');
    initRightPanel(container);

    const btn = container.querySelector<HTMLButtonElement>('#btn-orbit-trail')!;
    expect(btn.classList.contains('active')).toBe(true);
  });

  it('re-renders when state changes', () => {
    const container = document.createElement('div');
    initRightPanel(container);

    // Initially nothing is selected
    expect(container.querySelector('#btn-orbit-trail')).toBeNull();

    // Select a satellite — panel should re-render
    const obj = makeFakeObject();
    setState({ objects: [obj], filteredIndices: [0] });
    selectObject(0);

    expect(container.querySelector('#btn-orbit-trail')).not.toBeNull();
  });

  it('shows event info card when a historical event is selected', () => {
    selectHistoricalEvent('iridium-cosmos');
    const container = document.createElement('div');
    initRightPanel(container);
    // The right panel should show the event information card
    const detail = container.querySelector('#object-detail')!;
    expect(detail.innerHTML.length).toBeGreaterThan(50);
  });
});

describe('launch details', () => {
  const launch = (over: Partial<Launch> = {}): Launch => ({
    id: 'L1',
    name: 'Starlink Group 15-15',
    rocket: 'Falcon 9 Block 5',
    provider: 'SpaceX',
    net: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    status: 'go',
    padName: 'Space Launch Complex 40',
    locationName: 'Cape Canaveral SFS, FL, USA',
    latitude: 28.56,
    longitude: -80.58,
    orbit: 'Low Earth Orbit',
    missionType: 'Communications',
    missionDescription: 'A batch of 27 satellites for the Starlink mega-constellation.',
    destination: 'Low Earth Orbit',
    toIss: true,
    webcastUrl: 'https://www.youtube.com/watch?v=abc',
    ...over,
  });
  const open = (l: Launch) => {
    rememberLaunches([l]);
    const container = document.createElement('div');
    initRightPanel(container);
    setState({ selectedLaunch: { id: l.id, name: l.name, latitudeDeg: 1, longitudeDeg: 2, padName: null } });
    return container;
  };

  beforeEach(() => setLang('en'));

  it('shows what the launch is for, where it goes and when, without a Show ISS button', () => {
    const c = open(launch());
    const text = c.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Upcoming launch');
    expect(text).toContain('Starlink Group 15-15');
    expect(text).toContain('A batch of 27 satellites for the Starlink mega-constellation.');
    expect(text).toContain('Communications');
    expect(text).toContain('Falcon 9 Block 5');
    expect(text).toContain('Space Launch Complex 40, Cape Canaveral SFS, FL, USA');
    expect(c.querySelector('[data-field="launch-countdown"]')?.textContent).toMatch(/^T− /);
    expect(c.querySelector<HTMLAnchorElement>('.launch-detail-watch')?.href).toBe('https://www.youtube.com/watch?v=abc');
    expect(text).not.toContain('Show ISS');
  });

  it('says when no description exists, and notes that descriptions are in English', () => {
    setLang('tr');
    const c = open(launch({ missionDescription: null }));
    expect(c.textContent).toContain('Henüz bir görev açıklaması yayımlanmadı.');
    expect(c.querySelector('.launch-detail-lang')).toBeNull(); // no English text to flag
    const c2 = open(launch());
    expect(c2.querySelector('.launch-detail-lang')?.textContent).toContain('İngilizce');
  });

  it('treats the published text as text, and only links https webcasts', () => {
    const c = open(launch({ missionDescription: '<img src=x onerror=alert(1)>', webcastUrl: 'javascript:alert(1)' }));
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(c.querySelector('.launch-detail-watch')).toBeNull();
  });

  it('calls a launch that already happened a recent launch', () => {
    const c = open(launch({ status: 'success', net: new Date(Date.now() - 3_600_000).toISOString() }));
    expect(c.querySelector('.norad-id')?.textContent).toBe('Recent launch');
    expect(c.querySelector('[data-field="launch-countdown"]')?.textContent).toMatch(/^T\+ /);
  });

  it('shows a satellite instead once one is selected', () => {
    const c = open(launch());
    setState({ objects: [makeFakeObject('SAT-A')] });
    selectObject(0);
    expect(c.textContent).not.toContain('Upcoming launch');
  });
});
