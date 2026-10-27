// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The panel reads the observer location from the Spotter's sensor store and uses
// the look-angle code for "above my horizon". Both are replaced so the tests are
// deterministic: a fake satrec carries the elevation it should report.
const sensors = vi.hoisted(() => ({
  location: null as null | { latitudeDeg: number; longitudeDeg: number },
  setManual: vi.fn(),
}));

vi.mock('./observerSensors', () => ({
  getSensorSnapshot: () => ({ location: sensors.location }),
  setManualLocation: (loc: { latitudeDeg: number; longitudeDeg: number }) => {
    sensors.setManual(loc);
    sensors.location = loc;
  },
}));

vi.mock('../orbital/lookAngles', () => ({
  computeLookAngles: vi.fn((sat: { __elev?: number }) => {
    const elevationDeg = sat.__elev ?? -20;
    return { azimuthDeg: 0, elevationDeg, rangeKm: 1000, visible: elevationDeg > 0 };
  }),
  findNextUsefulPass: vi.fn(() => ({
    rise: { time: new Date(Date.now() + 3_600_000 + 30_000), azimuthDeg: 0 },
    max: { time: new Date(Date.now() + 3_900_000), elevationDeg: 33, azimuthDeg: 0 },
    set: null,
  })),
}));

import { setLang } from '../i18n/i18n';
import { getState, setState } from '../state/appState';
import { computeLookAngles } from '../orbital/lookAngles';
import {
  closeRadioPanel,
  initRadioPanel,
  isRadioPanelOpen,
  openRadioPanel,
  parseCoordinates,
  resetRadioPanelForTests,
} from './RadioPanel';
import type { RadioFrequency, TrackedObject } from '../types';

const NOW = Date.parse('2026-10-14T12:00:00Z');

function ch(over: Partial<RadioFrequency>): RadioFrequency {
  return { service: 'Service', mode: 'FM', sourceUrl: 'https://example.org/src', ...over };
}

function sat(name: string, noradId: number, frequencies: RadioFrequency[], elevationDeg = -20): TrackedObject {
  return {
    name,
    noradId,
    category: 'active',
    radioFrequencies: frequencies,
    satrec: { __elev: elevationDeg },
  } as unknown as TrackedObject;
}

const OBJECTS: TrackedObject[] = [
  sat('ISS (ZARYA)', 25544, [ch({ downlinkMHz: '145.825', mode: 'FM · 1200 bps packet', amateur: true })], 40),
  sat('RS-44', 44909, [ch({ downlinkMHz: '435.670-435.610', mode: 'SSB CW*', amateur: true })], -20),
  sat('NOAA 19', 33591, [ch({ downlinkMHz: '137.1', mode: 'FM', amateur: false })], 10),
  sat('STARLINK-1', 100, [ch({ downlinkMHz: '10700–12700', mode: 'Ku-band', amateur: false })]),
  sat('2023-091J', 400, [ch({ downlinkMHz: '435.79', mode: 'AFSK', amateur: true })]),
  sat('NO-RADIO', 500, []),
];

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const rowNames = (): string[] =>
  [...document.querySelectorAll('.radio-row-name')].map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim());
const summary = (): string => $('#radio-summary').textContent ?? '';
const pressed = (): string[] =>
  [...document.querySelectorAll('#radio-panel .radio-chip[aria-pressed="true"]')].map((e) => (e.textContent ?? '').trim());

function type(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function toggle(el: HTMLInputElement, checked: boolean): void {
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
  vi.setSystemTime(NOW);
  document.body.innerHTML = `<header class="app-header"><div id="header-actions"><button id="kessler-panel-btn"></button><div class="header-lang"><button id="lang-toggle" type="button">Language</button></div></div></header>`;
  resetRadioPanelForTests();
  setLang('en');
  sensors.location = null;
  sensors.setManual.mockClear();
  vi.mocked(computeLookAngles).mockClear();
  setState({ objects: OBJECTS, selectedIndex: null });
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  resetRadioPanelForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('opening the panel', () => {
  it('opens as a labelled dialog with the easy VHF/UHF filter and lists amateur satellites first', () => {
    openRadioPanel();
    const dialog = $('#radio-panel');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Satellite radio');

    expect(pressed()).toEqual(['Easy · VHF/UHF', 'All modes']);
    // Ku-band, no-radio and (for "easy") nothing else; amateur first, designator-only names last.
    expect(rowNames()).toEqual(['ISS (ZARYA) Amateur', 'RS-44 Amateur', '2023-091J Amateur', 'NOAA 19']);
    expect(summary()).toBe('4 satellites · 4 channels');
  });

  it('starts simple: "All satellites" chosen, filters and notes folded, with a summary of the filters', () => {
    openRadioPanel();
    const scope = [...document.querySelectorAll('[data-scope]')].map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`);
    expect(scope).toEqual(['Over me now:false', 'All satellites:true']);
    expect(($('#radio-filters') as HTMLDetailsElement).open).toBe(false);
    expect(($('#radio-about') as HTMLDetailsElement).open).toBe(false);
    expect($('#radio-filter-summary').textContent).toBe('Easy · VHF/UHF, All modes');
    expect($('#radio-location').textContent).toBe('');
  });

  it('explains the chosen mode in plain words and keeps the summary up to date', () => {
    openRadioPanel();
    $('[data-mode="fm"]').click();
    expect($('#radio-mode-hint').textContent).toMatch(/handheld FM radio/);
    toggle($('#radio-amateur'), true);
    expect($('#radio-filter-summary').textContent).toBe('Easy · VHF/UHF, FM, Amateur only');
  });

  it('keeps a fold open when the language changes (the panel is drawn again)', () => {
    initRadioPanel(); // registers the language listener
    openRadioPanel();
    const filters = $('#radio-filters') as HTMLDetailsElement;
    filters.open = true;
    filters.dispatchEvent(new Event('toggle'));
    setLang('tr');
    expect($('#radio-filters .radio-fold-title').textContent).toBe('Filtreler');
    expect(($('#radio-filters') as HTMLDetailsElement).open).toBe(true);
    setLang('en');
  });

  it('links amateur satellites to their SatNOGS observations, but not other services', () => {
    openRadioPanel();
    $('[data-band="all"]').click();
    const obsFor = (name: string) =>
      [...document.querySelectorAll('.radio-row')].find((r) => r.querySelector('.radio-row-name')?.textContent?.includes(name))?.querySelector<HTMLAnchorElement>('.radio-row-obs');
    expect(obsFor('RS-44')?.href).toBe('https://network.satnogs.org/observations/?norad=44909');
    expect(obsFor('RS-44')?.rel).toBe('noopener noreferrer');
    expect(obsFor('NOAA 19')).toBeNull();
    expect(document.querySelector('#radio-panel')?.textContent).toContain('Only transmitters listed as active');
  });

  it('adds a header button before the projection button, and opens from it', () => {
    initRadioPanel();
    const btn = $('#radio-panel-btn');
    expect(btn.nextElementSibling?.id).toBe('kessler-panel-btn');
    expect(btn.getAttribute('aria-label')).toBe('Radio');
    btn.click();
    expect(isRadioPanelOpen()).toBe(true);
  });

  it('closes on the ✕ button, Escape and a backdrop click, and gives the focus back', () => {
    initRadioPanel();
    const btn = $('#radio-panel-btn');
    btn.focus();

    btn.click();
    $('#radio-close').click();
    expect(isRadioPanelOpen()).toBe(false);
    expect(document.activeElement).toBe(btn);

    btn.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isRadioPanelOpen()).toBe(false);

    btn.click();
    $('#radio-panel-backdrop').click();
    expect(isRadioPanelOpen()).toBe(false);
  });

  it('does not open twice', () => {
    openRadioPanel();
    openRadioPanel();
    expect(document.querySelectorAll('#radio-panel')).toHaveLength(1);
  });
});

describe('filters', () => {
  it('narrows by band and mode, with the pressed state following', () => {
    openRadioPanel();
    $('[data-band="ham70cm"]').click();
    expect(rowNames()).toEqual(['RS-44 Amateur', '2023-091J Amateur']);
    expect(pressed()).toContain('70 cm');

    $('[data-mode="cw"]').click();
    expect(rowNames()).toEqual(['RS-44 Amateur']);
    expect(summary()).toBe('1 satellites · 1 channels');

    $('[data-band="vhf137"]').click();
    $('[data-mode="all"]').click();
    expect(rowNames()).toEqual(['NOAA 19']);
  });

  it('keeps amateur channels only, and searches by name or NORAD id', () => {
    openRadioPanel();
    toggle($('#radio-amateur'), true);
    expect(rowNames()).toEqual(['ISS (ZARYA) Amateur', 'RS-44 Amateur', '2023-091J Amateur']);

    type($('#radio-search'), 'rs-');
    expect(rowNames()).toEqual(['RS-44 Amateur']);
    type($('#radio-search'), '25544');
    expect(rowNames()).toEqual(['ISS (ZARYA) Amateur']);
    type($('#radio-search'), 'zzz');
    expect($('.radio-empty').textContent).toBe('No satellites match these filters.');
    expect(($('[data-action="export"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps the search text when the language changes', () => {
    initRadioPanel();
    openRadioPanel();
    type($('#radio-search'), 'noaa');
    setLang('tr');
    expect($('#radio-search').getAttribute('value') ?? ($('#radio-search') as HTMLInputElement).value).toContain('noaa');
    expect(($('#radio-bands').textContent ?? '')).toContain('Tümü');
  });

  it('shows each frequency line once and counts the rest', () => {
    setState({
      objects: [
        sat('TWIN', 1, [
          ch({ service: 'A', downlinkMHz: '435.95', mode: 'GMSK · 4800 baud', amateur: true }),
          ch({ service: 'B', downlinkMHz: '435.95', mode: 'GMSK · 4800 baud', amateur: true }),
          ch({ service: 'C', downlinkMHz: '436.1', mode: 'FM', amateur: true }),
          ch({ service: 'D', downlinkMHz: '436.2', mode: 'CW', amateur: true }),
        ]),
      ],
    });
    openRadioPanel();
    const lines = [...document.querySelectorAll('.radio-row-line')].map((e) => e.textContent);
    expect(lines).toEqual(['435.95 MHz · GMSK · 4800 baud', '436.1 MHz · FM', '+1 more']);
  });

  it('caps a long list and says so', () => {
    setState({
      objects: Array.from({ length: 200 }, (_, i) => sat(`SAT-${String(i).padStart(3, '0')}`, 1000 + i, [ch({ downlinkMHz: '145.9' })])),
    });
    openRadioPanel();
    expect(document.querySelectorAll('.radio-row')).toHaveLength(150);
    expect($('.radio-empty').textContent).toBe('Showing the first 150. Narrow the filters to see the rest.');
    expect(summary()).toBe('200 satellites · 200 channels');
  });

  it('escapes names from the catalog', () => {
    setState({ objects: [sat('<img src=x onerror=alert(1)>', 7, [ch({ downlinkMHz: '145.9' })])] });
    openRadioPanel();
    expect(document.querySelector('#radio-list img')).toBeNull();
    expect(rowNames()[0]).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('picking a satellite', () => {
  it('selects it in the app and closes the panel', () => {
    openRadioPanel();
    ($('.radio-row-main') as HTMLButtonElement).click(); // ISS is listed first
    expect(getState().selectedIndex).toBe(0);
    expect(isRadioPanelOpen()).toBe(false);
  });

  it('links to the source in a new tab, https only', () => {
    setState({ objects: [sat('BAD-LINK', 9, [ch({ downlinkMHz: '145.9', sourceUrl: 'javascript:alert(1)' })])] });
    openRadioPanel();
    expect(document.querySelector('.radio-row-src')).toBeNull();

    resetRadioPanelForTests();
    setState({ objects: [sat('GOOD-LINK', 9, [ch({ downlinkMHz: '145.9', sourceUrl: 'https://db.satnogs.org/satellite/9/' })])] });
    openRadioPanel();
    const a = $('.radio-row-src') as HTMLAnchorElement;
    expect(a.href).toBe('https://db.satnogs.org/satellite/9/');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
  });
});

describe('above my horizon now', () => {
  /** 'ok', or a GeolocationPositionError code: 1 blocked, 2 unavailable, 3 timeout. */
  function stubGeolocation(result: 'ok' | 1 | 2 | 3) {
    const getCurrentPosition = vi.fn((success: (p: unknown) => void, failure: (e: { code: number }) => void) => {
      if (result === 'ok') success({ coords: { latitude: 41, longitude: 29, altitude: null } });
      else failure({ code: result });
    });
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    return getCurrentPosition;
  }

  it('asks for the location as soon as the box is ticked, then lists what is up, highest first', () => {
    const geo = stubGeolocation('ok');
    openRadioPanel();
    $('[data-scope="now"]').click();
    expect(geo).toHaveBeenCalledTimes(1); // one shot, never a continuous watch
    expect(sensors.setManual).toHaveBeenCalledWith({ latitudeDeg: 41, longitudeDeg: 29, altitudeKm: 0 });
    expect(rowNames()).toEqual(['ISS (ZARYA) Amateur', 'NOAA 19']); // 40 deg and 10 deg
    expect([...document.querySelectorAll('.radio-row-when')].map((e) => e.textContent)).toEqual(['▲ 40°', '▲ 10°']);
    expect($('#radio-location').textContent).toContain('Your location: 41.0000° N, 29.0000° E');
  });

  it('applies the minimum elevation to "above my horizon" (default 5°, adjustable)', () => {
    sensors.location = { latitudeDeg: 41, longitudeDeg: 29 };
    openRadioPanel();
    $('[data-scope="now"]').click();
    const select = $('#radio-minelev') as unknown as HTMLSelectElement;
    expect(select.value).toBe('5');
    expect(rowNames()).toEqual(['ISS (ZARYA) Amateur', 'NOAA 19']); // 40° and 10°

    select.value = '15';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rowNames()).toEqual(['ISS (ZARYA) Amateur']);
    expect($('#radio-minelev-hint').textContent).toContain('15°');
  });

  it.each([
    [1, 'blocked for this site'],
    [2, 'could not find its location'],
    [3, 'took too long'],
  ] as const)('explains geolocation error %i and does not show an unfiltered list', (code, message) => {
    stubGeolocation(code);
    openRadioPanel();
    $('[data-scope="now"]').click();
    expect($('#radio-location').textContent).toContain(message);
    expect(document.querySelectorAll('.radio-row')).toHaveLength(0);
    expect($('#radio-list').textContent).toContain('Add your location above');
    expect(document.querySelector('#radio-manual')).not.toBeNull(); // the way out: type coordinates
  });

  it('works with typed coordinates when the device cannot locate (comma decimals too)', () => {
    stubGeolocation(2);
    openRadioPanel();
    $('[data-scope="now"]').click();
    ($('#radio-lat') as HTMLInputElement).value = '41,01';
    ($('#radio-lon') as HTMLInputElement).value = '28.97';
    $('#radio-manual').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(sensors.setManual).toHaveBeenCalledWith({ latitudeDeg: 41.01, longitudeDeg: 28.97, altitudeKm: 0 });
    expect(rowNames()).toEqual(['ISS (ZARYA) Amateur', 'NOAA 19']);
  });

  it('rejects coordinates out of range and keeps what was typed', () => {
    stubGeolocation(2);
    openRadioPanel();
    $('[data-scope="now"]').click();
    ($('#radio-lat') as HTMLInputElement).value = '141';
    ($('#radio-lon') as HTMLInputElement).value = '29';
    $('#radio-manual').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(sensors.setManual).not.toHaveBeenCalled();
    expect($('#radio-location').textContent).toContain('between −90 and 90');
    expect(($('#radio-lat') as HTMLInputElement).value).toBe('141');
  });

  it('says so when the browser cannot locate at all, and still offers typed coordinates', () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    openRadioPanel();
    $('[data-scope="now"]').click();
    expect($('#radio-location').textContent).toContain('cannot provide a location');
    expect(document.querySelector('[data-action="locate"]')).toBeNull();
    expect(document.querySelector('#radio-manual')).not.toBeNull();
  });

  it('uses a stored location straight away and fills in next-pass times for satellites below the horizon', async () => {
    sensors.location = { latitudeDeg: 41, longitudeDeg: 29 };
    openRadioPanel();
    await vi.advanceTimersByTimeAsync(0);
    const when = (name: string) =>
      [...document.querySelectorAll('.radio-row')].find((r) => r.textContent?.includes(name))!.querySelector('.radio-row-when')!.textContent;
    expect(when('ISS (ZARYA)')).toBe('▲ 40°');
    expect(when('RS-44')).toBe('in 1h 01m · max 33°');
  });

  it('refreshes quietly while open and stops completely once closed', async () => {
    sensors.location = { latitudeDeg: 41, longitudeDeg: 29 };
    openRadioPanel();
    vi.mocked(computeLookAngles).mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.mocked(computeLookAngles).mock.calls.length).toBeGreaterThan(0);
    expect(document.querySelector('#radio-list[aria-live], #radio-list [aria-live]')).toBeNull();

    closeRadioPanel();
    vi.mocked(computeLookAngles).mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(computeLookAngles).not.toHaveBeenCalled();
  });
});

describe('export and sharing', () => {
  it('downloads the filtered channels as a CSV', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:radio');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });

    openRadioPanel();
    $('[data-band="ham2m"]').click();
    ($('[data-action="export"]') as HTMLButtonElement).click();

    expect(clicked).toEqual([{ download: 'satellite-radio-ham2m-2026-10-14.csv', href: 'blob:radio' }]);
    const csv = await readBlob(createObjectURL.mock.calls[0][0]);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0].startsWith('name,norad_id,category,amateur,service,downlink_mhz')).toBe(true);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('ISS (ZARYA),25544,active,yes');
  });

  it('copies a link that carries the filters (and not the location)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    sensors.location = { latitudeDeg: 41, longitudeDeg: 29 };

    openRadioPanel();
    $('[data-band="ham70cm"]').click();
    $('[data-mode="fm"]').click();
    toggle($('#radio-amateur'), true);
    $('[data-scope="now"]').click();
    $('#radio-copy').click();
    await vi.advanceTimersByTimeAsync(0);

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?radio=ham70cm&mode=fm&amateur=1`);
    expect($('#radio-copy').textContent).toBe('Link copied');
    await vi.advanceTimersByTimeAsync(2100);
    expect($('#radio-copy').textContent).toBe('Copy link');
  });

  it('says so when the link cannot be copied', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    openRadioPanel();
    $('#radio-copy').click();
    await vi.advanceTimersByTimeAsync(0);
    expect($('#radio-copy').textContent).toBe('Could not copy');
  });

  it('opens with the shared filters when the page is loaded from such a link', () => {
    window.history.replaceState(null, '', '/?radio=ham70cm&mode=cw&amateur=1&rq=rs');
    initRadioPanel();
    expect(isRadioPanelOpen()).toBe(true);
    // The link changed the filters, so they are shown, not folded away.
    expect(($('#radio-filters') as HTMLDetailsElement).open).toBe(true);
    expect(pressed()).toEqual(['70 cm', 'CW']);
    expect(($('#radio-amateur') as HTMLInputElement).checked).toBe(true);
    expect(($('#radio-search') as HTMLInputElement).value).toBe('rs');
    expect(rowNames()).toEqual(['RS-44 Amateur']);
  });

  it('stays closed for a normal page load', () => {
    initRadioPanel();
    expect(isRadioPanelOpen()).toBe(false);
  });
});

describe('parseCoordinates', () => {
  it('accepts dot or comma decimals within range', () => {
    expect(parseCoordinates('41.01', '28.97')).toEqual({ latitudeDeg: 41.01, longitudeDeg: 28.97 });
    expect(parseCoordinates(' -33,9 ', '-70,66')).toEqual({ latitudeDeg: -33.9, longitudeDeg: -70.66 });
  });
  it('rejects empty, non-numeric and out-of-range values', () => {
    expect(parseCoordinates('', '29')).toBeNull();
    expect(parseCoordinates('abc', '29')).toBeNull();
    expect(parseCoordinates('91', '29')).toBeNull();
    expect(parseCoordinates('41', '181')).toBeNull();
  });
});
