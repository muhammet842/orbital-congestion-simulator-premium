// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../i18n/i18n';
import { getState, selectLaunch, setState } from '../state/appState';
import { initLaunchesPanel } from './LaunchesPanel';
import type { Launch } from '../data/launches';
import type { TrackedObject } from '../types';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const HOUR = 3_600_000;

function launch(overrides: Partial<Launch> = {}): Launch {
  return {
    id: 'l1',
    name: 'Dragon CRS-2 SpX-35',
    rocket: 'Falcon 9 Block 5',
    provider: 'SpaceX',
    net: new Date(NOW + 5 * HOUR).toISOString(),
    status: 'go',
    padName: 'SLC-40',
    locationName: 'Cape Canaveral SFS, FL, USA',
    latitude: 28.56,
    longitude: -80.58,
    orbit: 'Low Earth Orbit',
    missionType: 'Resupply',
    destination: 'International Space Station',
    toIss: true,
    webcastUrl: null,
    ...overrides,
  };
}

function stubApi(launches: Launch[] | 'fail') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () =>
      launches === 'fail' ? { ok: false, status: 502 } : { ok: true, json: async () => ({ launches }) },
    ),
  );
}

function issObject(): TrackedObject {
  return { noradId: 25544, name: 'ISS (ZARYA)', category: 'stations' } as unknown as TrackedObject;
}

let dispose: (() => void) | null = null;
let container: HTMLElement;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  dispose = initLaunchesPanel(container);
}

beforeEach(() => {
  setLang('en');
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  vi.setSystemTime(NOW);
  setState({ objects: [], selectedIndex: null, selectedLaunch: null });
});

afterEach(() => {
  dispose?.();
  dispose = null;
  container?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setState({ selectedLaunch: null });
});

describe('initLaunchesPanel', () => {
  it('shows a loading note, then a card per launch with rocket, pad, destination and countdown', async () => {
    stubApi([launch(), launch({ id: 'l2', name: 'Zhuque-2E mission', rocket: 'Zhuque-2E', destination: null, toIss: false })]);
    await mount();
    expect(container.querySelector('.launch-empty')?.textContent).toMatch(/Loading/i);

    await vi.advanceTimersByTimeAsync(0);
    const cards = container.querySelectorAll('.launch-card');
    expect(cards).toHaveLength(2);
    const text = cards[0].textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('Dragon CRS-2 SpX-35');
    expect(text).toContain('Falcon 9 Block 5 · SpaceX');
    expect(text).toContain('Cape Canaveral SFS, FL, USA');
    expect(text).toContain('→ International Space Station');
    expect(text).toContain('T− 5h 00m');
    expect(container.querySelector('.launch-credit')?.textContent).toMatch(/Space Devs/);
  });

  it('keeps countdowns ticking without re-rendering the cards', async () => {
    stubApi([launch({ net: new Date(NOW + 90_000).toISOString() })]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    const card = container.querySelector('.launch-card');
    expect(container.querySelector('.launch-countdown')?.textContent).toBe('T− 1m 30s');

    await vi.advanceTimersByTimeAsync(5_000);
    expect(container.querySelector('.launch-countdown')?.textContent).toBe('T− 1m 25s');
    expect(container.querySelector('.launch-card')).toBe(card);
  });

  it('marks a launch in flight and counts up from liftoff', async () => {
    stubApi([launch({ status: 'in_flight', net: new Date(NOW - 252_000).toISOString() })]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(container.querySelector('.launch-status')?.textContent).toBe('In flight');
    expect(container.querySelector('.launch-countdown')?.textContent).toBe('T+ 04:12');
  });

  it('selects a pad on click and toggles it off on a second click', async () => {
    stubApi([launch()]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    const main = () => container.querySelector<HTMLButtonElement>('.launch-card-main')!;

    main().click();
    expect(getState().selectedLaunch).toMatchObject({ id: 'l1', latitudeDeg: 28.56, longitudeDeg: -80.58 });
    expect(main().getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.launch-card--selected')).not.toBeNull();

    main().click();
    expect(getState().selectedLaunch).toBeNull();
    expect(main().getAttribute('aria-pressed')).toBe('false');
  });

  it('disables the pad action when the launch has no coordinates', async () => {
    stubApi([launch({ latitude: null, longitude: null })]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    const main = container.querySelector<HTMLButtonElement>('.launch-card-main')!;
    expect(main.disabled).toBe(true);
    main.click();
    expect(getState().selectedLaunch).toBeNull();
  });

  it('offers "Show ISS" for ISS missions (when the ISS is in the catalog) and selects it', async () => {
    stubApi([launch()]);
    setState({ objects: [issObject()] });
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    const iss = container.querySelector<HTMLButtonElement>('[data-action="iss"]')!;
    expect(iss.textContent).toBe('Show ISS');
    iss.click();
    expect(getState().selectedIndex).toBe(0);
  });

  it('hides "Show ISS" when the station is not in the catalog or the mission goes elsewhere', async () => {
    stubApi([launch(), launch({ id: 'l2', toIss: false })]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(container.querySelector('[data-action="iss"]')).toBeNull();
  });

  it('links the webcast safely and opens it in a new tab', async () => {
    stubApi([launch({ webcastUrl: 'https://www.youtube.com/watch?v=x' })]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    const a = container.querySelector<HTMLAnchorElement>('a.launch-action')!;
    expect(a.href).toBe('https://www.youtube.com/watch?v=x');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });

  it('escapes text coming from the data feed', async () => {
    stubApi([launch({ name: '<img src=x onerror=alert(1)>', rocket: '"><script>1</script>' })]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(container.querySelector('.launch-card img')).toBeNull();
    expect(container.querySelector('.launch-card script')).toBeNull();
    expect(container.querySelector('.launch-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('says so when launch data is unavailable, then recovers on the next poll', async () => {
    stubApi('fail');
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(container.querySelector('.launch-empty')?.textContent).toMatch(/temporarily unavailable/i);

    stubApi([launch()]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(container.querySelectorAll('.launch-card')).toHaveLength(1);
  });

  it('keeps showing the last launches if a later refresh fails', async () => {
    stubApi([launch()]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    stubApi('fail');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(container.querySelectorAll('.launch-card')).toHaveLength(1);
    expect(container.querySelector('.launch-empty')).toBeNull();
  });

  it('shows an empty-state note when there are no launches', async () => {
    stubApi([]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(container.querySelector('.launch-empty')?.textContent).toMatch(/No upcoming launches/i);
  });

  it('reflects a selection made elsewhere and stops polling after dispose', async () => {
    stubApi([launch()]);
    await mount();
    await vi.advanceTimersByTimeAsync(0);
    selectLaunch({ id: 'l1', name: 'x', latitudeDeg: 1, longitudeDeg: 2, padName: null });
    expect(container.querySelector('.launch-card--selected')).not.toBeNull();

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;
    dispose?.();
    dispose = null;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
