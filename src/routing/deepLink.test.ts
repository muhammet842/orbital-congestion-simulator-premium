// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { initDeepLink } from './deepLink';
import { getState, setState, selectObject, selectHistoricalEvent, clearObjectSelection } from '../state/appState';
import type { TrackedObject } from '../types';

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
  });
}

function makeObjects(): TrackedObject[] {
  return [
    { noradId: 25544, name: 'ISS (ZARYA)' } as unknown as TrackedObject,
    { noradId: 43013, name: 'TURKSAT 4A' } as unknown as TrackedObject,
    { noradId: 20580, name: 'HST' } as unknown as TrackedObject,
  ];
}

function goto(url: string): void {
  window.history.pushState(null, '', url);
}

beforeEach(() => {
  resetState();
  goto('/'); // clean URL before every test
});

describe('initDeepLink — restoring selection from the URL', () => {
  it('selects the matching satellite when ?object=<noradId> is present', () => {
    goto('/?object=43013');
    initDeepLink(makeObjects());
    expect(getState().selectedIndex).toBe(1);
  });

  it('opens the docked stack for the NORAD id of one of its modules', () => {
    const objects = makeObjects();
    (objects[0] as { dockedComponents?: unknown }).dockedComponents = [{ noradId: 49044, name: 'ISS (NAUKA)' }];
    goto('/?object=49044');
    initDeepLink(objects);
    expect(getState().selectedIndex).toBe(0);
  });

  it('selects the matching historical event when ?event=<id> is present', () => {
    goto('/?event=iridium-cosmos');
    initDeepLink(makeObjects());
    expect(getState().selectedEventId).toBe('iridium-cosmos');
  });

  it('does nothing when the URL has no recognized query params', () => {
    goto('/');
    initDeepLink(makeObjects());
    expect(getState().selectedIndex).toBeNull();
    expect(getState().selectedEventId).toBeNull();
  });

  it('ignores an unknown NORAD id and leaves selection cleared', () => {
    goto('/?object=999999');
    initDeepLink(makeObjects());
    expect(getState().selectedIndex).toBeNull();
  });

  it('ignores an unknown event id and leaves selection cleared', () => {
    goto('/?event=does-not-exist');
    initDeepLink(makeObjects());
    expect(getState().selectedEventId).toBeNull();
  });
});

describe('initDeepLink — writing the URL when selection changes', () => {
  it('pushes ?object=<noradId> to the URL when a satellite is selected', () => {
    initDeepLink(makeObjects());
    selectObject(2); // HST, noradId 20580
    expect(window.location.search).toBe('?object=20580');
  });

  it('pushes ?event=<id> to the URL when a historical event is selected', () => {
    initDeepLink(makeObjects());
    selectHistoricalEvent('cosmos-1408');
    expect(window.location.search).toBe('?event=cosmos-1408');
  });

  it('clears the URL (no query string) when selection is cleared', () => {
    initDeepLink(makeObjects());
    selectObject(0);
    clearObjectSelection();
    expect(window.location.search).toBe('');
  });

  it('switches the URL from ?object= to ?event= when an event replaces a satellite selection', () => {
    initDeepLink(makeObjects());
    selectObject(0);
    selectHistoricalEvent('fengyun-asat');
    expect(window.location.search).toBe('?event=fengyun-asat');
  });
});

describe('initDeepLink — browser Back/Forward (popstate)', () => {
  it('restores the previous selection when popstate fires with an earlier URL', () => {
    initDeepLink(makeObjects());
    selectObject(1); // pushes ?object=43013

    // Simulate the browser navigating back to the root URL.
    goto('/');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(getState().selectedIndex).toBeNull();
    expect(getState().selectedEventId).toBeNull();
  });

  it('re-selects an object when popstate fires with an ?object= URL', () => {
    initDeepLink(makeObjects());

    goto('/?object=25544');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(getState().selectedIndex).toBe(0);
  });

  it('clears a historical event when popstate navigates back to /', () => {
    initDeepLink(makeObjects());
    selectHistoricalEvent('iridium-cosmos');
    expect(getState().selectedEventId).toBe('iridium-cosmos');

    goto('/');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(getState().selectedEventId).toBeNull();
    expect(getState().eventReplay).toBeNull();
  });
});
