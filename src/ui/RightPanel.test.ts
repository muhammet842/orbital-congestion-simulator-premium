// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { initRightPanel } from './RightPanel';
import {
  setState,
  selectObject,
  selectHistoricalEvent,
} from '../state/appState';
import type { TrackedObject } from '../types';

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
