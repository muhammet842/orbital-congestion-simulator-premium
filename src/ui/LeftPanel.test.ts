// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLeftPanel } from './LeftPanel';
import { setState } from '../state/appState';
import type { ConjunctionEvent, TrackedObject } from '../types';

// requestAnimationFrame is not implemented in jsdom — stub it so initLeftPanel
// can register the live-time refresh loop without throwing.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn());
});

describe('initLeftPanel – DOM smoke', () => {
  it('mounts without throwing', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    expect(() => initLeftPanel(container)).not.toThrow();
    document.body.removeChild(container);
  });

  it('creates the #object-search input', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    expect(container.querySelector('#object-search')).not.toBeNull();
    document.body.removeChild(container);
  });

  it('states that close-approach alerts are screening estimates, not operational', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    const note = container.querySelector('.conjunction-accuracy-note');
    expect(note?.textContent).toMatch(/not an operational conjunction assessment/i);
    document.body.removeChild(container);
  });

  it('says how many LEO objects are left out of screening for old TLEs', () => {
    const stale = { layer: 'LEO', staleElements: true } as unknown as TrackedObject;
    const fresh = { layer: 'LEO' } as unknown as TrackedObject;
    const staleGeo = { layer: 'GEO', staleElements: true } as unknown as TrackedObject;
    setState({ objects: [stale, stale, fresh, staleGeo] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    const note = container.querySelector<HTMLElement>('#conjunction-stale-note')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toMatch(/^2 low-orbit objects are left out of screening.*more than 7 days old/);

    setState({ objects: [fresh] });
    expect(note.hidden).toBe(true);
    document.body.removeChild(container);
    setState({ objects: [] });
  });

  it('creates the #layer-filters section', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    expect(container.querySelector('#layer-filters')).not.toBeNull();
    document.body.removeChild(container);
  });

  it('renders a toggle chip for each of the four orbit layers', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    const layerChips = container.querySelectorAll('button[data-layer]');
    expect(layerChips.length).toBe(4);
    const layers = Array.from(layerChips).map(
      (el) => (el as HTMLButtonElement).dataset.layer,
    );
    expect(layers).toContain('LEO');
    expect(layers).toContain('MEO');
    expect(layers).toContain('GEO');
    expect(layers).toContain('HEO');
    document.body.removeChild(container);
  });

  it('creates the category filter section with all / satellites / stations / debris', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    expect(container.querySelector('#category-filters')).not.toBeNull();
    const options = container.querySelectorAll('#category-filters input[data-category]');
    expect(options.length).toBe(4);
    const values = Array.from(options).map((el) => (el as HTMLInputElement).value);
    expect(values).toEqual(['all', 'active', 'stations', 'debris']);
    document.body.removeChild(container);
  });

  it('creates the advanced-filters section', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    expect(container.querySelector('#advanced-filters')).not.toBeNull();
    document.body.removeChild(container);
  });

  it('creates the event accordion inside the left panel', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    expect(container.querySelector('#event-accordion')).not.toBeNull();
    document.body.removeChild(container);
  });

  it('explains debris vs satellites and why close approaches matter', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    const ledes = container.querySelectorAll('.panel-lede');
    expect(ledes.length).toBeGreaterThanOrEqual(2);
    expect([...ledes].some((el) => /debris|junk/i.test(el.textContent ?? ''))).toBe(true);
    expect([...ledes].some((el) => /maneuver|Iridium/i.test(el.textContent ?? ''))).toBe(true);
    document.body.removeChild(container);
  });

  it('creates the conjunction-list section', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    expect(container.querySelector('#conjunction-list')).not.toBeNull();
    expect(container.querySelector('#conjunction-filters')).not.toBeNull();
    document.body.removeChild(container);
  });

  it('creates the #color-by-function display option toggle', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    expect(container.querySelector('#color-by-function')).not.toBeNull();
    document.body.removeChild(container);
  });

  it('hides the "recently launched" toggle when no object qualifies as recently launched', () => {
    setState({ objects: [] });
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    expect(container.querySelector('#show-recent-launches')).toBeNull();
    document.body.removeChild(container);
  });

  it('shows the "recently launched" toggle when at least one object was seen in the last 14 days', () => {
    const recentIso = new Date().toISOString();
    setState({
      objects: [
        {
          noradId: 1,
          name: 'TEST-NEW-SAT',
          line1: '',
          line2: '',
          category: 'active',
          country: 'Unknown',
          owner: 'Unknown',
          satrec: {} as never,
          layer: 'LEO',
          color: [1, 1, 1],
          functionGroup: 'active',
          meanAltitudeKm: 500,
          inclinationDeg: 50,
          firstSeenAt: recentIso,
        },
      ],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);
    expect(container.querySelector('#show-recent-launches')).not.toBeNull();
    document.body.removeChild(container);
    setState({ objects: [] });
  });
});

describe('renderConjunctions — predicted (future) close approaches', () => {
  // These tests build events relative to "now" and assert on rounded countdown
  // text. Freeze the clock so a slow or busy machine cannot shift the rounding
  // (and, through leftover DOM state, fail the tests after it).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeFutureConjunction(msFromNow: number): ConjunctionEvent {
    return {
      objectA: 'STARLINK-1',
      objectB: 'COSMOS-99',
      noradIdA: 1,
      noradIdB: 2,
      indexA: 0,
      indexB: 1,
      distanceKm: 1.85,
      relativeVelocityKmS: 7.2,
      time: new Date(Date.now() + msFromNow),
      midpointScene: { x: 0, y: 0, z: 0 },
    };
  }

  it('shows a "closest approach in <duration>" style message for a future event', () => {
    setState({ conjunctions: [makeFutureConjunction(3 * 60 * 60 * 1000 + 12 * 60 * 1000)], conjunctionHiddenCount: 0 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);

    const text = container.querySelector('.conjunction-alert-text')?.textContent ?? '';
    expect(text).toContain('STARLINK-1');
    expect(text).toContain('COSMOS-99');
    expect(text).toContain('1.85');
    // ~3h12m away — must not render as if it were already happening now.
    expect(text).toMatch(/3h ?12m|in 3h/);

    document.body.removeChild(container);
    setState({ conjunctions: [], conjunctionHiddenCount: 0 });
  });

  it('shows the plain "close approach!" message once an event is at/past CPA', () => {
    setState({ conjunctions: [makeFutureConjunction(0)], conjunctionHiddenCount: 0 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);

    const text = container.querySelector('.conjunction-alert-text')?.textContent ?? '';
    expect(text).toContain('close approach!');

    document.body.removeChild(container);
    setState({ conjunctions: [], conjunctionHiddenCount: 0 });
  });

  it('keeps alert countdowns on the global clock while verifying a selected CPA', () => {
    const near = makeFutureConjunction(40 * 60 * 1000); // ~40m from now
    const far = makeFutureConjunction(2 * 60 * 60 * 1000 + 20 * 60 * 1000); // ~2h20m
    far.objectA = 'STARLINK-FAR-A';
    far.objectB = 'STARLINK-FAR-B';

    setState({
      conjunctions: [far, near],
      conjunctionHiddenCount: 0,
      // Scrubbing near the far event's CPA must not make the near event look "imminent".
      verificationTime: {
        cpaTimeMs: far.time.getTime(),
        currentMs: far.time.getTime() - 60_000,
        playing: true,
        speed: 1,
      },
      selectedConjunctionSessionKey: 'far-session',
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);

    const texts = [...container.querySelectorAll('.conjunction-alert-text')].map(
      (el) => el.textContent ?? '',
    );
    const nearText = texts.find((t) => t.includes('STARLINK-1')) ?? '';
    const farText = texts.find((t) => t.includes('STARLINK-FAR-A')) ?? '';

    expect(nearText).toMatch(/40m|in 40/);
    expect(nearText).not.toContain('close approach!');
    expect(farText).toMatch(/2h|in 2h/);

    document.body.removeChild(container);
    setState({
      conjunctions: [],
      conjunctionHiddenCount: 0,
      verificationTime: null,
      selectedConjunctionSessionKey: null,
    });
  });

  it('does not remount alert cards when the same conjunction list is re-rendered', () => {
    const alert = makeFutureConjunction(15 * 60 * 1000);
    setState({ conjunctions: [alert], conjunctionHiddenCount: 0 });

    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);

    const first = container.querySelector('.conjunction-alert');
    expect(first).not.toBeNull();

    // Same payload again (e.g. identical scan publish) — nodes must stay put.
    setState({ conjunctions: [alert], conjunctionHiddenCount: 0 });
    const second = container.querySelector('.conjunction-alert');
    expect(second).toBe(first);

    document.body.removeChild(container);
    setState({ conjunctions: [], conjunctionHiddenCount: 0 });
  });

  it('reorders cards when switching from time sort to criticality sort', () => {
    const soonFar = makeFutureConjunction(20 * 60 * 1000);
    soonFar.objectA = 'SOON-A';
    soonFar.objectB = 'SOON-B';
    soonFar.distanceKm = 2.1;

    const laterClose = makeFutureConjunction(3 * 60 * 60 * 1000);
    laterClose.objectA = 'CLOSE-A';
    laterClose.objectB = 'CLOSE-B';
    laterClose.distanceKm = 0.4;

    setState({
      conjunctions: [soonFar, laterClose],
      conjunctionHiddenCount: 0,
      conjunctionSortMode: 'time',
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);

    let texts = [...container.querySelectorAll('.conjunction-alert-text')].map(
      (el) => el.textContent ?? '',
    );
    expect(texts[0]).toContain('SOON-A');

    setState({ conjunctionSortMode: 'criticality' });
    texts = [...container.querySelectorAll('.conjunction-alert-text')].map(
      (el) => el.textContent ?? '',
    );
    expect(texts[0]).toContain('CLOSE-A');
    expect(container.querySelector('input[data-sort="criticality"]')).toBeTruthy();

    document.body.removeChild(container);
    setState({
      conjunctions: [],
      conjunctionHiddenCount: 0,
      conjunctionSortMode: 'time',
    });
  });

  it('keeps the same "+N more" count for time and criticality sorts', () => {
    const alerts = Array.from({ length: 12 }, (_, i) => {
      const c = makeFutureConjunction((i + 1) * 10 * 60 * 1000);
      c.objectA = `A${i}`;
      c.objectB = `B${i}`;
      c.noradIdA = i * 2 + 1;
      c.noradIdB = i * 2 + 2;
      c.distanceKm = 2.5 - i * 0.1;
      return c;
    });

    setState({
      conjunctions: alerts,
      conjunctionHiddenCount: 4,
      conjunctionSortMode: 'time',
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);

    const moreByTime = container.querySelector('.conjunction-more')?.textContent ?? '';
    expect(moreByTime).toMatch(/\+?\s*11/);

    setState({ conjunctionSortMode: 'criticality' });
    const moreByCrit = container.querySelector('.conjunction-more')?.textContent ?? '';
    expect(moreByCrit).toBe(moreByTime);

    document.body.removeChild(container);
    setState({
      conjunctions: [],
      conjunctionHiddenCount: 0,
      conjunctionSortMode: 'time',
    });
  });

  it('updates "+N more" when the scan pool grows without changing the top cards', () => {
    const seed = Array.from({ length: 7 }, (_, i) => {
      const c = makeFutureConjunction((i + 1) * 5 * 60 * 1000);
      c.objectA = `SEED-${i}`;
      c.objectB = `SEED-B-${i}`;
      c.noradIdA = 100 + i * 2;
      c.noradIdB = 101 + i * 2;
      c.distanceKm = 1.5;
      return c;
    });

    setState({
      conjunctions: seed,
      conjunctionHiddenCount: 0,
      conjunctionSortMode: 'time',
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    initLeftPanel(container);

    expect(container.querySelector('.conjunction-more')?.textContent ?? '').toMatch(/\+?\s*2/);
    const firstCard = container.querySelector('.conjunction-alert');

    const grown = [
      ...seed,
      ...Array.from({ length: 8 }, (_, i) => {
        const c = makeFutureConjunction((i + 20) * 5 * 60 * 1000);
        c.objectA = `LATE-${i}`;
        c.objectB = `LATE-B-${i}`;
        c.noradIdA = 200 + i * 2;
        c.noradIdB = 201 + i * 2;
        c.distanceKm = 2.0;
        return c;
      }),
    ];
    setState({ conjunctions: grown, conjunctionHiddenCount: 0 });

    expect(container.querySelector('.conjunction-alert')).toBe(firstCard);
    expect(container.querySelector('.conjunction-more')?.textContent ?? '').toMatch(/\+?\s*10/);

    document.body.removeChild(container);
    setState({ conjunctions: [], conjunctionHiddenCount: 0 });
  });
});
