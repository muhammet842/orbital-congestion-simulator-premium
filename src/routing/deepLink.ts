/**
 * URL Deep Linking
 *
 * Keeps the browser URL in sync with the current satellite/event selection so
 * that links can be copied and shared, and selections survive a page refresh.
 *
 * URL format
 * ──────────
 *   ?object=25544          — satellite selected by NORAD catalogue number
 *   ?event=iridium-cosmos  — historical event selected by ID
 *   (no params)            — nothing selected
 *
 * History behaviour
 * ─────────────────
 *   Selecting a satellite or event   → pushState  (creates a history entry)
 *   Clearing a selection             → replaceState (no extra history entry)
 *   Browser back / forward           → restores the selection at that URL
 *
 * Clearing: when the URL has no valid object/event, call
 * clearHistoricalEventSelection() — stopEventReplay() alone is a no-op if
 * selectedEventId is set but eventReplay has not started yet.
 */

import {
  getState,
  subscribe,
  selectObject,
  clearObjectSelection,
  selectHistoricalEvent,
  clearHistoricalEventSelection,
} from '../state/appState';
import { getHistoricalEvent } from '../ui/EventCards';
import type { TrackedObject } from '../types';

// ── Internal helpers ──────────────────────────────────────────────────────────

function getParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

function buildSearch(key: string | null, value: string | null): string {
  if (!key || !value) return '';
  const p = new URLSearchParams();
  p.set(key, value);
  return '?' + p.toString();
}

/** NORAD ID → array index lookup built once from the objects list. */
let noradToIndex: Map<number, number> = new Map();

function buildLookup(objects: TrackedObject[]): void {
  noradToIndex = new Map(objects.map((o, i) => [o.noradId, i]));
  // ?object=49044 (Nauka) opens the ISS stack it is docked to.
  objects.forEach((o, i) => {
    for (const part of o.dockedComponents ?? []) {
      if (!noradToIndex.has(part.noradId)) noradToIndex.set(part.noradId, i);
    }
  });
}

// ── URL ↔ state sync ──────────────────────────────────────────────────────────

/**
 * Guard flag: when the popstate handler is updating state we skip the
 * resulting state-change notification to avoid a URL → state → URL loop.
 */
let suppressNextUrlWrite = false;

/** Last URL search string we wrote — lets us skip no-op writes. */
let lastWrittenSearch = window.location.search;

function writeUrl(search: string, push: boolean): void {
  if (search === lastWrittenSearch) return;
  lastWrittenSearch = search;
  const url = window.location.pathname + search;
  if (push) {
    history.pushState(null, '', url);
  } else {
    history.replaceState(null, '', url);
  }
}

/**
 * Called on every state change.  Derives the canonical URL from the current
 * selection and pushes / replaces it into the browser history.
 */
function onStateChange(objects: TrackedObject[]): void {
  if (suppressNextUrlWrite) {
    suppressNextUrlWrite = false;
    return;
  }

  const { selectedIndex, selectedEventId } = getState();

  if (selectedEventId) {
    // Event selected — push so Back returns to whatever was open before.
    writeUrl(buildSearch('event', selectedEventId), true);
    return;
  }

  if (selectedIndex != null) {
    const obj = objects[selectedIndex];
    if (obj) {
      writeUrl(buildSearch('object', String(obj.noradId)), true);
      return;
    }
  }

  // Nothing selected — replace (don't pollute history with empty entries).
  writeUrl('', false);
}

/**
 * Parse the current URL and restore the matching selection.
 * Called once on startup and again whenever the user navigates with Back/Forward.
 */
function applyUrl(): void {
  const eventId = getParam('event');
  const noradStr = getParam('object');

  if (eventId && getHistoricalEvent(eventId)) {
    selectHistoricalEvent(eventId);
    return;
  }

  if (noradStr) {
    const norad = parseInt(noradStr, 10);
    if (!Number.isNaN(norad)) {
      const idx = noradToIndex.get(norad);
      if (idx != null) {
        selectObject(idx);
        return;
      }
    }
  }

  // URL has no valid object/event — clear any leftover selection silently.
  const { selectedIndex, selectedEventId, eventReplay } = getState();
  if (eventReplay || selectedEventId) clearHistoricalEventSelection();
  if (selectedIndex != null) clearObjectSelection();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call once after the object list is loaded and the scene is ready.
 *
 * 1. Builds the NORAD→index lookup.
 * 2. Applies any ?object= / ?event= from the current URL.
 * 3. Subscribes to state changes to keep the URL in sync going forward.
 * 4. Listens to popstate for browser Back / Forward support.
 */
export function initDeepLink(objects: TrackedObject[]): void {
  buildLookup(objects);

  // Restore selection from the current URL (shared link or page refresh).
  // Record the current URL as "already written" so the first state-change
  // notification from selectObject/selectHistoricalEvent doesn't push a
  // duplicate entry on top of it.
  lastWrittenSearch = window.location.search;
  applyUrl();

  // Keep URL in sync with every future state change.
  subscribe(() => onStateChange(objects));

  // Browser Back / Forward — restore the selection described by that URL.
  window.addEventListener('popstate', () => {
    suppressNextUrlWrite = true;
    lastWrittenSearch = window.location.search; // record before applyUrl mutates state
    applyUrl();
  });
}
