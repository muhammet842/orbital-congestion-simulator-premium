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
